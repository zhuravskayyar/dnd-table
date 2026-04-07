import { z } from 'zod';
import { STRICT_HOST_RULES } from '../src/constants/hostRules';
import { getRecentMessages } from '../src/lib/sessionMemory';
import {
  ActionPlanDecision,
  CampaignFilters,
  CheckOutcome,
  CheckStep,
  ConceptGuardDecision,
  EvaluateCheckStepDecision,
  GenerateCharacterResult,
  GeneratedCampaign,
  GeneratedPlayerStartHook,
  PendingResolution,
  PlayerCharacter,
  ResolvedCheck,
  Room,
  RoomMessage,
  SceneActor,
  SceneDelta,
  SessionMemory,
} from '../src/types';
import {
  buildSceneDeltaFromCheck,
  formatStrictRulesForPrompt,
  getDeterministicStepFrame,
  type StrictActionDecision,
} from './strictHost';

const CHARACTER_SYSTEM_PROMPT = 'You generate a tabletop RPG player character and return strict JSON only.';
const OPENING_SYSTEM_PROMPT = 'You generate an opening tabletop RPG scene and return strict JSON only.';
const CONCEPT_GUARD_SYSTEM_PROMPT = 'You validate whether a player action fits the campaign concept and return strict JSON only.';
const ACTION_RESOLUTION_SYSTEM_PROMPT = `
You plan a player action resolution sequence for a tabletop RPG inside a deterministic host engine.
Return strict JSON only.
${formatStrictRulesForPrompt()}
`.trim();
const EVALUATE_CHECK_STEP_SYSTEM_PROMPT = `
You evaluate one tabletop RPG d20 check step inside a deterministic host engine.
Return strict JSON only.
${formatStrictRulesForPrompt()}
`.trim();
const PROFESSIONAL_DM_SYSTEM_PROMPT = `
You are a professional tabletop RPG game master.
- Keep continuity with established canon, NPCs, inventory, player backstories, and scene actors.
- Do not speak for the players.
- Respect prior check outcomes and mechanical scene state.
- Be concise, atmospheric, and actionable.
- Follow the host response template: world state -> action reaction -> stakes or consequence -> next actor.
- Never grant success in a risky scene without the server-authorized gate result.
`.trim();
const MEMORY_UPDATE_SYSTEM_PROMPT = `
You are the narrative memory system for a tabletop RPG campaign.
Return strict JSON only.
Update narrative memory from the conversation, but do not invent or overwrite mechanical scene-actor state.
- Treat any authoritative scene delta as canon.
- Do not rollback established consequences.
`.trim();

const checkTypeSchema = z.enum(['stealth', 'attack', 'damage', 'perception', 'social', 'mobility', 'magic', 'custom']);
const checkOutcomeSchema = z.enum(['fail', 'mixed', 'pass', 'strong_pass']);

const inventoryItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  description: z.string().min(1),
  kind: z.string().min(1),
});

const generatedCharacterSchema = z.object({
  bioSummary: z.string().min(1),
  backstory: z.string().min(1),
  motivation: z.string().min(1),
  classFantasy: z.string().min(1),
  inventory: z.array(inventoryItemSchema).min(3).max(6),
});

const generatedPlayerStartHookSchema = z.object({
  playerId: z.string().min(1),
  displayName: z.string().min(1),
  cue: z.string().min(1),
});

const generatedOpeningSchema = z.object({
  synopsis: z.string().min(1),
  openingScene: z.string().min(1),
  conflicts: z.array(z.string()).min(1),
  npcs: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    role: z.string().min(1),
  })).min(1),
  playerStartHooks: z.array(generatedPlayerStartHookSchema).default([]),
});

const conceptGuardSchema = z.object({
  result: z.enum(['allowed', 'blocked']),
  explanation: z.string().min(1),
});

const sceneActorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['npc', 'monster']),
  role: z.string().min(1),
  currentLocation: z.string().min(1),
  awareness: z.enum(['unaware', 'suspicious', 'alerted', 'engaged']),
  woundState: z.enum(['healthy', 'wounded', 'critical', 'dead']),
  disposition: z.string().min(1),
  notes: z.string().min(1),
});

const checkStepSchema = z.object({
  id: z.string().min(1),
  type: checkTypeSchema,
  label: z.string().min(1),
  stakes: z.string().min(1),
  die: z.literal('d20'),
  targetActorId: z.string().nullable().optional(),
  itemName: z.string().nullable().optional(),
});

const actionPlanSchema = z.object({
  mode: z.enum(['blocked', 'clarify', 'immediate', 'sequence']),
  message: z.string().min(1),
  targetActorId: z.string().nullable().optional(),
  itemName: z.string().nullable().optional(),
  steps: z.array(checkStepSchema).optional(),
});

const resolvedCheckSchema = z.object({
  stepId: z.string().min(1),
  type: checkTypeSchema,
  result: z.number().int().min(1).max(20),
  outcome: checkOutcomeSchema,
  consequence: z.string().min(1),
});

const evaluateCheckStepSchema = z.object({
  resolvedCheck: resolvedCheckSchema,
  continueSequence: z.boolean(),
  updatedSceneActors: z.array(sceneActorSchema),
  dmText: z.string().min(1),
});

const sessionMemorySchema = z.object({
  campaignSummary: z.string(),
  sceneSummary: z.string(),
  activeLocation: z.string().nullable(),
  canonFacts: z.array(z.string()),
  openThreads: z.array(z.string()),
  activeNpcs: z.array(z.object({
    name: z.string(),
    role: z.string(),
    disposition: z.string(),
    goal: z.string(),
    lastSeen: z.string().nullable(),
  })),
  playerHooks: z.array(z.string()),
  recentRolls: z.array(z.object({
    kind: z.string(),
    result: z.number().int(),
    consequence: z.string(),
  })),
  lastUpdatedTurn: z.number().int().nonnegative(),
});

export type GenerateTextFn = (input: { prompt: string; systemPrompt: string }) => Promise<string>;

export function extractMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        return part.text;
      }

      return '';
    })
    .join('')
    .trim();
}

export function extractJsonPayload(text: string): string {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)\s*```/i) ?? text.match(/```\s*([\s\S]*?)\s*```/);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1).trim();
  }

  throw new Error('Text AI did not return JSON.');
}

async function generateJson<T>({
  generateText,
  prompt,
  systemPrompt,
  schema,
}: {
  generateText: GenerateTextFn;
  prompt: string;
  systemPrompt: string;
  schema: z.ZodType<T>;
}) {
  const text = await generateText({ prompt, systemPrompt });
  let jsonPayload = text;
  try {
    jsonPayload = extractJsonPayload(text);
  } catch {
    jsonPayload = text;
  }
  const candidates = [
    jsonPayload,
    sanitizeJsonPayload(jsonPayload),
    sanitizeJsonPayload(text),
  ];

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return schema.parse(JSON.parse(candidate));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Text AI returned invalid JSON.');
}

function sanitizeJsonPayload(text: string) {
  return text
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, '\'')
    .replace(/,\s*([}\]])/g, '$1');
}

function getLanguageInstruction(language: string) {
  return language === 'English' ? 'Respond in English.' : 'Відповідай українською мовою.';
}

function formatFilters(filters: CampaignFilters) {
  const lines = [
    `Setting: ${filters.setting}`,
    `Tone: ${filters.tone}`,
    `Structure: ${filters.structure}`,
    `Combat intensity: ${filters.combatIntensity}`,
    `Magic level: ${filters.magicLevel}`,
    `Darkness level: ${filters.darknessLevel}`,
  ];

  if (filters.worldConcept.trim()) {
    lines.push(`World concept: ${filters.worldConcept.trim()}`);
  }

  return lines.join('\n');
}

function formatCharacters(characters: PlayerCharacter[]) {
  if (characters.length === 0) {
    return '- No characters.';
  }

  return characters.map((character) => `
- ${character.displayName}
  PlayerId: ${character.playerId}
  Summary: ${character.bioSummary}
  Backstory: ${character.backstory}
  Motivation: ${character.motivation}
  Class fantasy: ${character.classFantasy}
  Inventory: ${character.inventory.map((item) => `${item.name} x${item.quantity}`).join(', ')}
`).join('\n');
}

function formatSceneActors(sceneActors: SceneActor[]) {
  if (sceneActors.length === 0) {
    return '- No scene actors.';
  }

  return sceneActors.map((actor) => `
- ${actor.id} | ${actor.name}
  Kind: ${actor.kind}
  Role: ${actor.role}
  Location: ${actor.currentLocation}
  Awareness: ${actor.awareness}
  Wounds: ${actor.woundState}
  Disposition: ${actor.disposition}
  Notes: ${actor.notes}
`).join('\n');
}

function isEnglishLanguage(language: string) {
  return language === 'English';
}

function includesAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern));
}

function normalizeActionText(action: string) {
  return action.toLowerCase();
}

function getLeadSentence(text: string) {
  const cleaned = text.trim();
  if (!cleaned) {
    return '';
  }

  const match = cleaned.match(/^[^.!?]+[.!?]?/);
  return (match?.[0] ?? cleaned).trim();
}

function getOpeningQuestion(room: Room) {
  if (isEnglishLanguage(room.language)) {
    return room.characters.length <= 1 ? 'What do you do?' : 'What do you all do?';
  }

  return room.characters.length <= 1 ? 'Що ти робиш?' : 'Що ви робите?';
}

function buildDefaultPlayerStartHook(room: Room, character: PlayerCharacter): GeneratedPlayerStartHook {
  const summary = getLeadSentence(character.bioSummary).replace(/[.!?]+$/, '');
  const backstoryLead = getLeadSentence(character.backstory).replace(/[.!?]+$/, '');
  const motivationLead = getLeadSentence(character.motivation).replace(/[.!?]+$/, '');

  if (isEnglishLanguage(room.language)) {
    return {
      playerId: character.playerId,
      displayName: character.displayName,
      cue: `${character.displayName} should catch a detail that cuts into ${motivationLead || character.classFantasy || summary || backstoryLead}.`,
    };
  }

  return {
    playerId: character.playerId,
    displayName: character.displayName,
    cue: `${character.displayName} має вловити деталь, яка боляче чіпляє ${motivationLead || character.classFantasy || summary || backstoryLead}.`,
  };
}

function normalizePlayerStartHooks(room: Room, characters: PlayerCharacter[], hooks: GeneratedPlayerStartHook[]) {
  const hooksByPlayerId = new Map(hooks.map((hook) => [hook.playerId, hook]));

  return characters.map((character) => {
    const hook = hooksByPlayerId.get(character.playerId);
    if (!hook) {
      return buildDefaultPlayerStartHook(room, character);
    }

    return {
      playerId: character.playerId,
      displayName: character.displayName,
      cue: hook.cue,
    };
  });
}
function buildFallbackOpeningScene(room: Room, firstNpcName: string, firstHook: GeneratedPlayerStartHook | undefined) {
  const question = getOpeningQuestion(room);

  if (isEnglishLanguage(room.language)) {
    const hookLine = firstHook
      ? `When ${firstNpcName} shifts in the torchlight, ${firstHook.displayName} catches a detail that lands too close to unfinished business.`
      : 'When the figure shifts in the torchlight, something about the scene feels too deliberate to be routine.';

    return [
      `${firstNpcName} stands in the chokepoint with rain on the stone, one hand near a weapon and the other on the half-open gate.`,
      'Behind the gap, metal drags once across the floor and then goes still.',
      hookLine,
      `${firstNpcName} lifts their chin just enough to stop the group in place.`,
      question,
    ].join(' ');
  }

  const hookLine = firstHook
    ? `Коли ${firstNpcName} трохи повертається в рваному світлі, ${firstHook.displayName} впізнає деталь, яка занадто близько ріже по незакритій справі.`
    : `Коли ${firstNpcName} трохи повертається в рваному світлі, стає ясно: це не звичайна затримка і не проста формальність.`;

  return [
    `${firstNpcName} стоїть у проході, мокрий камінь блищить під ногами, а рука вже лежить надто близько до зброї.`,
    'За напівпрочиненими воротами щось раз скрегоче по металу й затихає.',
    hookLine,
    `${firstNpcName} ледь нахиляє голову, ніби дає останню мить перед тим, як усе піде гірше.`,
    question,
  ].join(' ');
}

function buildFallbackOpening(room: Room): GeneratedCampaign {
  const playerStartHooks = normalizePlayerStartHooks(room, room.characters, []);
  const firstNpcName = isEnglishLanguage(room.language) ? 'Gate Warden' : 'Вартовий брами';

  return {
    synopsis: isEnglishLanguage(room.language)
      ? `${room.title} opens in a tense ${room.filters.setting.toLowerCase()} situation shaped by ${room.filters.tone.toLowerCase()} stakes.`
      : `"${room.title}" починається з напруженої сцени в дусі "${room.filters.setting}" і з тоном "${room.filters.tone}".`,
    openingScene: buildFallbackOpeningScene(room, firstNpcName, playerStartHooks[0]),
    conflicts: [
      isEnglishLanguage(room.language)
        ? 'Understand what is wrong here before the situation closes.'
        : 'Зрозуміти, що тут пішло не так, перш ніж можливість зникне.',
    ],
    npcs: [
      {
        name: firstNpcName,
        description: isEnglishLanguage(room.language)
          ? 'A tense local authority who controls access and knows more than they say.'
          : 'Напружений місцевий сторож, який контролює доступ і знає більше, ніж каже.',
        role: isEnglishLanguage(room.language) ? 'First contact at the gate' : 'Перший контакт біля брами',
      },
    ],
    playerStartHooks,
  };
}

function createDeterministicSeed(input: string) {
  let hash = 0;

  for (const character of input) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}

function pickBySeed<T>(items: T[], seed: number, offset = 0) {
  return items[(seed + offset) % items.length];
}

function detectSettingFamily(room: Room) {
  const normalized = `${room.filters.setting} ${room.filters.worldConcept}`.toLowerCase();

  if (includesAny(normalized, [
    'кібер',
    'cyber',
    'sci-fi',
    'sci fi',
    'science fiction',
    'космо',
    'space',
    'postapoc',
    'post-apoc',
    'постапок',
  ])) {
    return 'cyber';
  }

  if (includesAny(normalized, ['стімпанк', 'steampunk'])) {
    return 'steampunk';
  }

  return 'fantasy';
}

function normalizeIdentityText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яіїєґ\s]/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getConceptLead(worldConcept: string) {
  const trimmed = worldConcept.trim();
  if (!trimmed) {
    return '';
  }

  const firstSentence = trimmed.match(/^[^.!?]+[.!?]?/);
  return (firstSentence?.[0] ?? trimmed).trim().slice(0, 180);
}

function pickUniqueFromPool(items: string[], seed: number, usedValues: Set<string>) {
  for (let offset = 0; offset < items.length; offset += 1) {
    const candidate = pickBySeed(items, seed, offset);
    if (!usedValues.has(normalizeIdentityText(candidate))) {
      return candidate;
    }
  }

  return pickBySeed(items, seed);
}

function pickDistinctBySeed<T>(items: T[], seed: number, count: number) {
  const result: T[] = [];
  const limit = Math.min(count, items.length);

  for (let offset = 0; offset < items.length && result.length < limit; offset += 1) {
    result.push(items[(seed + offset) % items.length]);
  }

  return result;
}

function normalizeInventoryKey(name: string) {
  return normalizeIdentityText(name);
}

function makeInventorySignature(inventory: PlayerCharacter['inventory']) {
  return inventory
    .map((item) => normalizeInventoryKey(item.name))
    .sort()
    .join('|');
}

function countSharedInventoryItems(left: PlayerCharacter['inventory'], right: PlayerCharacter['inventory']) {
  const rightKeys = new Set(right.map((item) => normalizeInventoryKey(item.name)));
  return left.reduce((count, item) => (
    rightKeys.has(normalizeInventoryKey(item.name)) ? count + 1 : count
  ), 0);
}

function buildInventoryVariant(
  pool: PlayerCharacter['inventory'],
  seed: number,
  existingCharacters: PlayerCharacter[],
  desiredCount = 4,
) {
  const usedSignatures = new Set(existingCharacters.map((character) => makeInventorySignature(character.inventory)));
  let fallbackVariant: PlayerCharacter['inventory'] | null = null;

  for (let shift = 0; shift < pool.length; shift += 1) {
    const candidate = pickDistinctBySeed(pool, seed + shift, desiredCount).map((item) => ({ ...item }));
    const signature = makeInventorySignature(candidate);

    if (!fallbackVariant) {
      fallbackVariant = candidate;
    }

    if (!usedSignatures.has(signature)) {
      return candidate;
    }
  }

  return fallbackVariant ?? pool.slice(0, desiredCount).map((item) => ({ ...item }));
}

function buildFallbackCharacter(room: Room, playerId: string, displayName: string): GenerateCharacterResult {
  const seed = createDeterministicSeed(`${room.roomCode}:${playerId}:${displayName}:${room.filters.setting}:${room.filters.worldConcept}`);
  const family = detectSettingFamily(room);
  const english = isEnglishLanguage(room.language);
  const conceptLead = getConceptLead(room.filters.worldConcept);
  const existingCharacters = room.characters;

  const fantasyRoles = english
    ? ['trail warden', 'grave scout', 'bog alchemist', 'oathscar sellsword', 'witchlight seeker', 'lantern archivist', 'relic cantor', 'raven duelist']
    : ['слідопит прикордоння', 'розвідник крипт', 'болотний алхімік', 'найманець зі шрамом-присягою', 'шукач відьомського світла', 'ліхтарний архіваріус', 'кантор реліквій', 'воронячий дуелянт'];
  const cyberRoles = english
    ? ['breach runner', 'signal ghost', 'forensic rigger', 'blackout infiltrator', 'contract sentinel', 'scrapyard medic', 'drone wrangler', 'memory smuggler']
    : ['брич-ранер', 'сигнальний привид', 'судовий ригер', 'інфільтратор блекауту', 'контрактний сентинел', 'медик зі скрап-району', 'доглядач дронів', 'контрабандист памʼяті'];
  const steampunkRoles = english
    ? ['coil duelist', 'aether cartographer', 'boiler saboteur', 'brass courier', 'smoke inspector', 'clockwork naturalist', 'pressure surgeon', 'rail marshal']
    : ['котушковий дуелянт', 'етерний картограф', 'саботажник котлів', 'латунний курʼєр', 'інспектор димних кварталів', 'годинниковий натураліст', 'хірург тиску', 'рейковий маршал'];
  const descriptorPool = english
    ? ['reads danger before it blooms', 'trusts tools more than promises', 'moves like an ambush is always one breath away', 'keeps a cold head while others rush', 'notices lies faster than faces', 'treats every corridor like a trap', 'speaks briefly and with intent', 'does not waste light, time, or leverage']
    : ['читає небезпеку ще до того, як вона оформиться', 'довіряє інструментам більше, ніж обіцянкам', 'рухається так, ніби засідка завжди поруч', 'тримає холодну голову, коли інші поспішають', 'брехню помічає швидше за обличчя', 'сприймає кожен коридор як пастку', 'говорить коротко й по суті', 'не марнує світло, час і перевагу'];
  const scarPool = english
    ? ['lost a whole team to a false trail', 'survived a job that should have ended in silence', 'watched a patron sell people out for safety', 'carried blame for a disaster built by someone richer', 'buried the one witness who knew the full truth', 'was betrayed at the exact moment the gate opened', 'walked out of a cleanup that erased everyone else', 'still follows the ruin left by one wrong choice']
    : ['втратив цілу команду через хибний слід', 'пережив справу, яка мала закінчитися тишею', 'бачив, як патрон продав людей заради безпеки', 'поніс на собі вину за катастрофу, яку побудував хтось багатший', 'поховав єдиного свідка, що знав правду', 'був зраджений саме в мить відкриття брами', 'вийшов із зачистки, де стерли всіх інших', 'досі йде по сліду руїни від одного хибного вибору'];
  const keepsakePool = english
    ? ['a damaged map scrap', 'a split coin with an old crest', 'a soot-stained glove patch', 'a key without a known lock', 'a sealed note never delivered', 'a broken badge from a dead crew', 'a black-feather charm', 'a maintenance token with erased numbers']
    : ['пошкоджений клапоть мапи', 'розколоту монету зі старим гербом', 'закіптюжену латку від рукавиці', 'ключ без відомого замка', 'запечатану записку, яку так і не віддали', 'зламаний жетон мертвої команди', 'талісман із чорного пера', 'сервісну бирку зі стертими номерами'];
  const fantasyDrives = english
    ? ['the one who opened the black gate', 'the patron who sold the caravan', 'the relic map hidden behind a false cult', 'the proof that the marsh voices were real', 'the grave ledger everyone pretends was burned', 'the hunter who taught monsters to pray', 'the debt still owed to the dead', 'the name behind the counterfeit blessing']
    : ['того, хто відкрив чорну браму', 'патрона, який продав караван', 'мапу реліквій, сховану за фальшивим культом', 'доказ, що болотні голоси були справжніми', 'цвинтарний реєстр, який усі вдають спаленим', 'мисливця, що навчив чудовиськ молитися', 'борг, який досі винні мертвим', 'імʼя за підробленим благословенням'];
  const cyberDrives = english
    ? ['the executive behind the silent cleanup', 'the archive key that restores stolen memories', 'the broker who sold the team into blackout', 'the ledger proving who profits from the ration war', 'the witness erased from every camera', 'the shipment that rewrote a district overnight', 'the backdoor hidden in obsolete city firmware', 'the debt chain binding the wrong people together']
    : ['топменеджера за тихою зачисткою', 'архівний ключ, що повертає вкрадену памʼять', 'брокера, який здав команду в блекаут', 'реєстр, що показує, хто заробляє на війні пайків', 'свідка, стертоого з усіх камер', 'партію, яка переписала район за одну ніч', 'бекдор у застарілій прошивці міста', 'ланцюг боргів, що тримає не тих людей'];
  const steampunkDrives = english
    ? ['the minister who sold disaster as progress', 'the patent file that proves sabotage at the top', 'the conductor who left civilians sealed in smoke', 'the missing engine core everyone wants dead for', 'the blackbook of favors owed by the rail houses', 'the investor behind the engine riots', 'the forged safety seals that killed a district', 'the design that could free whole neighborhoods from debt']
    : ['міністра, який продав катастрофу як прогрес', 'патентний файл, що доводить саботаж нагорі', 'кондуктора, який залишив цивільних у димі', 'зникле ядро двигуна, за яке вже готові вбивати', 'чорну книгу боргів рейкових домів', 'інвестора за двигунними бунтами', 'підроблені пломби безпеки, що вбили район', 'креслення, яке могло б звільнити цілі квартали від боргу'];
  const fantasyInventory = english
    ? [
      { name: 'Hunter knife', quantity: 1, kind: 'Weapon', description: 'Balanced for sudden close work in ruined halls.' },
      { name: 'Pitch torch', quantity: 2, kind: 'Utility', description: 'Burns hot through damp fog and cellar air.' },
      { name: 'Field tonic', quantity: 2, kind: 'Alchemy', description: 'A harsh draught that keeps pain from setting in.' },
      { name: 'Bone ward charm', quantity: 1, kind: 'Keepsake', description: 'A crude talisman carried against grave-born luck.' },
      { name: 'Iron grapnel', quantity: 1, kind: 'Gear', description: 'Useful on broken walls and collapsed stairs.' },
      { name: 'Salt packet', quantity: 2, kind: 'Ritual', description: 'Thrown across thresholds and strange remains.' },
      { name: 'Crow-feather tokens', quantity: 3, kind: 'Marks', description: 'Quiet trail signs between hunters and scouts.' },
      { name: 'Lock picks', quantity: 1, kind: 'Tools', description: 'Slim steel tools wrapped in oilcloth.' },
    ]
    : [
      { name: 'Клинок мисливця', quantity: 1, kind: 'Зброя', description: 'Збалансований для раптової роботи в тісних руїнах.' },
      { name: 'Смоляний факел', quantity: 2, kind: 'Утиліта', description: 'Горить крізь сирий туман і підвальний сморід.' },
      { name: 'Польова настоянка', quantity: 2, kind: 'Алхімія', description: 'Різкий засіб, що не дає болю взяти гору.' },
      { name: 'Кістяний оберіг', quantity: 1, kind: 'Талісман', description: 'Грубий захист від злої удачі та могильного холоду.' },
      { name: 'Залізний гак', quantity: 1, kind: 'Спорядження', description: 'Стає в пригоді на мурах і зруйнованих сходах.' },
      { name: 'Пакунок солі', quantity: 2, kind: 'Ритуал', description: 'Йде на пороги, останки та все підозріло тихе.' },
      { name: 'Жетони з воронячим пером', quantity: 3, kind: 'Мітки', description: 'Тихі сигнали між мисливцями та розвідниками.' },
      { name: 'Відмички', quantity: 1, kind: 'Інструменти', description: 'Тонкі сталеві ключі в промасленій тканині.' },
    ];
  const cyberInventory = english
    ? [
      { name: 'Shock baton', quantity: 1, kind: 'Weapon', description: 'Compact leverage for tight corridors and lifts.' },
      { name: 'Signal jammer', quantity: 2, kind: 'Utility', description: 'Briefly muddies cameras, locks, and cheap drones.' },
      { name: 'Med patch', quantity: 2, kind: 'Biotech', description: 'A peel-and-stick stabilizer for pain and blood loss.' },
      { name: 'Ghost card', quantity: 1, kind: 'Access', description: 'A cloned pass with a narrow life span.' },
      { name: 'Fiber line spool', quantity: 1, kind: 'Gear', description: 'Good for climbs, quick ties, and ugly repairs.' },
      { name: 'Data shard', quantity: 1, kind: 'Intel', description: 'Encrypted residue from a failed run.' },
      { name: 'Pulse beacon', quantity: 2, kind: 'Signals', description: 'A tiny locator for marking exits or targets.' },
      { name: 'Spare drone eye', quantity: 1, kind: 'Hardware', description: 'Useful for jury-rigged vision or trade.' },
    ]
    : [
      { name: 'Шокова палиця', quantity: 1, kind: 'Зброя', description: 'Компактний важіль ближнього бою для ліфтів і вузьких проходів.' },
      { name: 'Глушник сигналу', quantity: 2, kind: 'Утиліта', description: 'Ненадовго збиває камери, замки та дешеві дрони.' },
      { name: 'Мед-патч', quantity: 2, kind: 'Біотех', description: 'Липка стабілізація проти болю й крововтрати.' },
      { name: 'Примарна картка', quantity: 1, kind: 'Доступ', description: 'Клонований пропуск із коротким, але цінним життям.' },
      { name: 'Котушка фібер-лінії', quantity: 1, kind: 'Спорядження', description: 'Для підйомів, швидких вузлів і негарних ремонтів.' },
      { name: 'Дата-шард', quantity: 1, kind: 'Інтел', description: 'Зашифрований уламок із проваленого забігу.' },
      { name: 'Пульс-маяк', quantity: 2, kind: 'Сигнал', description: 'Малий локатор для позначення виходів або цілей.' },
      { name: 'Запасне око дрона', quantity: 1, kind: 'Залізо', description: 'Стане в пригоді для кустарного огляду або обміну.' },
    ];
  const steampunkInventory = english
    ? [
      { name: 'Coil pistol', quantity: 1, kind: 'Weapon', description: 'A compact sidearm with an unreliable discharge.' },
      { name: 'Brass lantern', quantity: 1, kind: 'Utility', description: 'Warm light for tunnels, ducts, and engine decks.' },
      { name: 'Pressure vial', quantity: 2, kind: 'Chemistry', description: 'A restorative dose mixed for field emergencies.' },
      { name: 'Tool roll', quantity: 1, kind: 'Tools', description: 'Picks, screws, valves, and winding keys in one wrap.' },
      { name: 'Steam gloves', quantity: 1, kind: 'Gear', description: 'Insulated gloves for hot rails and angry metal.' },
      { name: 'Signal whistle', quantity: 1, kind: 'Command', description: 'Carries sharply over machinery and crowd noise.' },
      { name: 'Wire saw', quantity: 1, kind: 'Utility', description: 'Cuts thin bars, bolts, and stubborn fittings.' },
      { name: 'Gauge chalk', quantity: 2, kind: 'Marks', description: 'Marks routes, valve states, and hidden service signs.' },
    ]
    : [
      { name: 'Котушковий пістоль', quantity: 1, kind: 'Зброя', description: 'Компактна бічна зброя з норовливим зарядом.' },
      { name: 'Латунний ліхтар', quantity: 1, kind: 'Утиліта', description: 'Тепле світло для тунелів, шахт і машинних палуб.' },
      { name: 'Колба тиску', quantity: 2, kind: 'Хімія', description: 'Відновлювальний засіб для польових криз.' },
      { name: 'Рулон інструментів', quantity: 1, kind: 'Інструменти', description: 'Відмички, гвинти, клапани й заводні ключі в одному наборі.' },
      { name: 'Паростійкі рукавиці', quantity: 1, kind: 'Спорядження', description: 'Захист для гарячих рейок і злого металу.' },
      { name: 'Сигнальний свисток', quantity: 1, kind: 'Команда', description: 'Пробиває шум механізмів і натовпу.' },
      { name: 'Дротяна пилка', quantity: 1, kind: 'Утиліта', description: 'Бере тонкі прути, болти й уперту арматуру.' },
      { name: 'Крейда манометрів', quantity: 2, kind: 'Мітки', description: 'Позначає маршрути, клапани та сервісні знаки.' },
    ];

  const rolePool = family === 'cyber' ? cyberRoles : family === 'steampunk' ? steampunkRoles : fantasyRoles;
  const drivePool = family === 'cyber' ? cyberDrives : family === 'steampunk' ? steampunkDrives : fantasyDrives;
  const inventoryPool = family === 'cyber' ? cyberInventory : family === 'steampunk' ? steampunkInventory : fantasyInventory;
  const classFantasy = pickUniqueFromPool(
    rolePool,
    seed,
    new Set(existingCharacters.map((character) => normalizeIdentityText(character.classFantasy))),
  );
  const descriptor = pickBySeed(descriptorPool, seed, 1);
  const scar = pickBySeed(scarPool, seed, 2);
  const drive = pickBySeed(drivePool, seed, 3);
  const keepsake = pickBySeed(keepsakePool, seed, 4);
  const inventory = buildInventoryVariant(inventoryPool, seed + 5, existingCharacters, 4);
  const conceptSentence = conceptLead
    ? (english ? ` The room premise revolves around "${conceptLead}".` : ` Рамка світу тримається на ідеї: "${conceptLead}".`)
    : '';
  const bioSummary = english
    ? `${displayName} is a ${classFantasy} who ${descriptor}.${conceptSentence}`
    : `${displayName} — ${classFantasy}, який ${descriptor}.${conceptSentence}`;
  const backstory = english
    ? `${displayName} ${scar}. Since then they have carried ${keepsake.toLowerCase()} and followed every lead that smells like ${room.title}.`
    : `${displayName} ${scar}. Відтоді він носить при собі ${keepsake.toLowerCase()} й хапається за кожен слід, що пахне історією "${room.title}".`;
  const motivation = english
    ? `Track down ${drive}, settle the old debt before it destroys another crew, and turn the next dangerous clue into leverage.`
    : `Вистежити ${drive}, закрити старий борг до того, як він зламає ще одну команду, і перетворити наступну небезпечну зачіпку на власну перевагу.`;

  return {
    playerId,
    displayName,
    bioSummary,
    backstory,
    motivation,
    classFantasy,
    inventory,
  };
}

function normalizeGeneratedInventory(
  inventory: PlayerCharacter['inventory'],
  fallbackInventory: PlayerCharacter['inventory'],
) {
  const normalized: PlayerCharacter['inventory'] = [];
  const usedNames = new Set<string>();

  for (const item of inventory) {
    const name = item.name.trim();
    if (!name) {
      continue;
    }

    const key = normalizeInventoryKey(name);
    if (usedNames.has(key)) {
      continue;
    }

    usedNames.add(key);
    normalized.push({
      name,
      quantity: Math.max(1, Math.round(item.quantity)),
      description: item.description.trim(),
      kind: item.kind.trim(),
    });
  }

  for (const item of fallbackInventory) {
    if (normalized.length >= 6) {
      break;
    }

    const key = normalizeInventoryKey(item.name);
    if (usedNames.has(key)) {
      continue;
    }

    usedNames.add(key);
    normalized.push({ ...item });
  }

  return normalized.slice(0, 6);
}

function ensureCharacterVariety({
  room,
  playerId,
  displayName,
  character,
}: {
  room: Room;
  playerId: string;
  displayName: string;
  character: Omit<GenerateCharacterResult, 'playerId' | 'displayName'>;
}): GenerateCharacterResult {
  const fallback = buildFallbackCharacter(room, playerId, displayName);
  const existingCharacters = room.characters;
  const normalizedInventory = normalizeGeneratedInventory(character.inventory, fallback.inventory);
  const normalizedCandidate = {
    bioSummary: normalizeIdentityText(character.bioSummary),
    backstory: normalizeIdentityText(character.backstory),
    motivation: normalizeIdentityText(character.motivation),
    classFantasy: normalizeIdentityText(character.classFantasy),
  };
  const inventorySignature = makeInventorySignature(normalizedInventory);

  const exactClone = existingCharacters.some((existing) => (
    normalizeIdentityText(existing.bioSummary) === normalizedCandidate.bioSummary
    && normalizeIdentityText(existing.backstory) === normalizedCandidate.backstory
    && normalizeIdentityText(existing.motivation) === normalizedCandidate.motivation
    && normalizeIdentityText(existing.classFantasy) === normalizedCandidate.classFantasy
  ));
  if (exactClone) {
    return fallback;
  }

  const hasTextCollision = existingCharacters.some((existing) => (
    normalizeIdentityText(existing.bioSummary) === normalizedCandidate.bioSummary
    || normalizeIdentityText(existing.backstory) === normalizedCandidate.backstory
    || normalizeIdentityText(existing.motivation) === normalizedCandidate.motivation
  ));
  const classCollision = existingCharacters.some((existing) => (
    normalizeIdentityText(existing.classFantasy) === normalizedCandidate.classFantasy
  ));
  const inventoryClone = existingCharacters.some((existing) => (
    inventorySignature !== '' && makeInventorySignature(existing.inventory) === inventorySignature
  ));
  const heavyInventoryOverlap = existingCharacters.some((existing) => (
    countSharedInventoryItems(normalizedInventory, existing.inventory) >= 3
  ));

  return {
    playerId,
    displayName,
    bioSummary: hasTextCollision ? fallback.bioSummary : character.bioSummary.trim(),
    backstory: hasTextCollision ? fallback.backstory : character.backstory.trim(),
    motivation: hasTextCollision ? fallback.motivation : character.motivation.trim(),
    classFantasy: classCollision ? fallback.classFantasy : character.classFantasy.trim(),
    inventory: inventoryClone || heavyInventoryOverlap ? fallback.inventory : normalizedInventory,
  };
}

function findTargetActor(room: Room, action: string) {
  const normalizedAction = normalizeActionText(action);

  for (const actor of room.sceneActors) {
    const normalizedName = actor.name.toLowerCase();
    if (normalizedAction.includes(normalizedName)) {
      return actor;
    }

    const tokens = normalizedName.split(/[^a-zа-яіїєґ0-9]+/i).filter((token) => token.length >= 3);
    if (tokens.some((token) => normalizedAction.includes(token))) {
      return actor;
    }
  }

  if (room.sceneActors.length === 1) {
    return room.sceneActors[0];
  }

  return null;
}

function findInventoryItemName(character: PlayerCharacter, action: string) {
  const normalizedAction = normalizeActionText(action);

  for (const item of character.inventory) {
    if (normalizedAction.includes(item.name.toLowerCase())) {
      return item.name;
    }
  }

  const weapon = character.inventory.find((item) => item.kind.toLowerCase() === 'weapon');
  if (weapon && includesAny(normalizedAction, ['меч', 'клинок', 'ніж', 'кинджал', 'sword', 'blade', 'dagger', 'knife'])) {
    return weapon.name;
  }

  return null;
}

function makeCheckMessage(room: Room, label: string, stakes: string) {
  return isEnglishLanguage(room.language)
    ? `Roll d20 for ${label}. Stakes: ${stakes}`
    : `Кинь d20 на ${label}. На кону: ${stakes}`;
}

function buildFallbackActionPlan(room: Room, character: PlayerCharacter, action: string): ActionPlanDecision {
  const normalizedAction = normalizeActionText(action);
  const targetActor = findTargetActor(room, action);
  const itemName = findInventoryItemName(character, action);

  const ambiguous = includesAny(normalizedAction, ['щось', 'це', 'somehow', 'something'])
    && !targetActor
    && !itemName;
  if (ambiguous) {
    return {
      mode: 'clarify',
      message: isEnglishLanguage(room.language)
        ? 'Clarify what exactly you do, what you use, and who or what you target.'
        : 'Уточни, що саме робиш, чим дієш і кого або що саме зачіпаєш.',
      targetActorId: null,
      itemName: null,
      steps: [],
    };
  }

  const isStealth = includesAny(normalizedAction, ['підкра', 'непоміт', 'тихо', 'ззаду', 'stealth', 'sneak', 'behind']);
  const isAttack = includesAny(normalizedAction, ['атак', 'вдар', 'бʼю', "б'ю", 'ріж', 'удар', 'kill', 'attack', 'stab', 'slash', 'cut']);
  const isSearch = includesAny(normalizedAction, ['обшук', 'шука', 'огляда', 'search', 'inspect', 'look for']);
  const isSocial = includesAny(normalizedAction, ['перекон', 'бреш', 'заляк', 'прос', 'говор', 'persuade', 'convince', 'intimidate', 'ask']);
  const isMobility = includesAny(normalizedAction, ['стриб', 'лізу', 'тіка', 'біжу', 'перелаз', 'jump', 'climb', 'run', 'escape']);
  const isMagic = includesAny(normalizedAction, ['чакл', 'магі', 'заклин', 'spell', 'magic', 'cast']);

  if (isStealth && isAttack) {
    const targetLabel = targetActor?.name ?? (isEnglishLanguage(room.language) ? 'the target' : 'цілі');
    return {
      mode: 'sequence',
      message: makeCheckMessage(
        room,
        isEnglishLanguage(room.language) ? 'stealth' : 'скритність',
        isEnglishLanguage(room.language)
          ? `whether you reach ${targetLabel} unnoticed`
          : `чи підійдеш непомітно до ${targetLabel}`,
      ),
      targetActorId: targetActor?.id ?? null,
      itemName,
      steps: [
        {
          id: 'fallback-stealth',
          type: 'stealth',
          label: isEnglishLanguage(room.language) ? 'Stealth' : 'Скритність',
          stakes: isEnglishLanguage(room.language)
            ? 'Reach the target unnoticed.'
            : 'Підійти до цілі непомітно.',
          die: 'd20',
          targetActorId: targetActor?.id ?? null,
          itemName,
        },
        {
          id: 'fallback-attack',
          type: 'attack',
          label: isEnglishLanguage(room.language) ? 'Attack' : 'Влучання',
          stakes: isEnglishLanguage(room.language)
            ? 'Strike before the target can react.'
            : 'Встигнути точно вдарити до реакції цілі.',
          die: 'd20',
          targetActorId: targetActor?.id ?? null,
          itemName,
        },
        {
          id: 'fallback-damage',
          type: 'damage',
          label: isEnglishLanguage(room.language) ? 'Damage' : 'Урон',
          stakes: isEnglishLanguage(room.language)
            ? 'Determine how severe the wound is.'
            : 'Визначити, наскільки тяжкою буде рана.',
          die: 'd20',
          targetActorId: targetActor?.id ?? null,
          itemName,
        },
      ],
    };
  }

  if (isAttack) {
    return {
      mode: 'sequence',
      message: makeCheckMessage(
        room,
        isEnglishLanguage(room.language) ? 'attack' : 'влучання',
        isEnglishLanguage(room.language)
          ? 'whether you land the hit before the target reacts'
          : 'чи встигнеш влучити до реакції цілі',
      ),
      targetActorId: targetActor?.id ?? null,
      itemName,
      steps: [
        {
          id: 'fallback-attack',
          type: 'attack',
          label: isEnglishLanguage(room.language) ? 'Attack' : 'Влучання',
          stakes: isEnglishLanguage(room.language)
            ? 'Land the hit.'
            : 'Завдати точного удару.',
          die: 'd20',
          targetActorId: targetActor?.id ?? null,
          itemName,
        },
        {
          id: 'fallback-damage',
          type: 'damage',
          label: isEnglishLanguage(room.language) ? 'Damage' : 'Урон',
          stakes: isEnglishLanguage(room.language)
            ? 'Determine wound severity.'
            : 'Визначити тяжкість рани.',
          die: 'd20',
          targetActorId: targetActor?.id ?? null,
          itemName,
        },
      ],
    };
  }

  if (isSearch) {
    return {
      mode: 'sequence',
      message: makeCheckMessage(
        room,
        isEnglishLanguage(room.language) ? 'perception' : 'уважність',
        isEnglishLanguage(room.language)
          ? 'whether you notice something useful'
          : 'чи знайдеш або помітиш щось корисне',
      ),
      targetActorId: targetActor?.id ?? null,
      itemName,
      steps: [
        {
          id: 'fallback-perception',
          type: 'perception',
          label: isEnglishLanguage(room.language) ? 'Perception' : 'Уважність',
          stakes: isEnglishLanguage(room.language)
            ? 'Notice something useful.'
            : 'Помітити щось корисне.',
          die: 'd20',
          targetActorId: targetActor?.id ?? null,
          itemName,
        },
      ],
    };
  }

  if (isSocial) {
    return {
      mode: 'sequence',
      message: makeCheckMessage(
        room,
        isEnglishLanguage(room.language) ? 'social pressure' : 'соціальну перевірку',
        isEnglishLanguage(room.language)
          ? 'whether your words change the target'
          : 'чи вплинуть твої слова на співрозмовника',
      ),
      targetActorId: targetActor?.id ?? null,
      itemName,
      steps: [
        {
          id: 'fallback-social',
          type: 'social',
          label: isEnglishLanguage(room.language) ? 'Social' : 'Соціум',
          stakes: isEnglishLanguage(room.language)
            ? 'Shift the target response.'
            : 'Змінити реакцію співрозмовника.',
          die: 'd20',
          targetActorId: targetActor?.id ?? null,
          itemName,
        },
      ],
    };
  }

  if (isMobility) {
    return {
      mode: 'sequence',
      message: makeCheckMessage(
        room,
        isEnglishLanguage(room.language) ? 'mobility' : 'рух/спритність',
        isEnglishLanguage(room.language)
          ? 'whether you get through cleanly'
          : 'чи пройдеш перешкоду без втрат',
      ),
      targetActorId: targetActor?.id ?? null,
      itemName,
      steps: [
        {
          id: 'fallback-mobility',
          type: 'mobility',
          label: isEnglishLanguage(room.language) ? 'Mobility' : 'Спритність',
          stakes: isEnglishLanguage(room.language)
            ? 'Get through the obstacle.'
            : 'Подолати перешкоду.',
          die: 'd20',
          targetActorId: targetActor?.id ?? null,
          itemName,
        },
      ],
    };
  }

  if (isMagic) {
    return {
      mode: 'sequence',
      message: makeCheckMessage(
        room,
        isEnglishLanguage(room.language) ? 'magic' : 'магію',
        isEnglishLanguage(room.language)
          ? 'whether the effect manifests as intended'
          : 'чи спрацює ефект так, як задумано',
      ),
      targetActorId: targetActor?.id ?? null,
      itemName,
      steps: [
        {
          id: 'fallback-magic',
          type: 'magic',
          label: isEnglishLanguage(room.language) ? 'Magic' : 'Магія',
          stakes: isEnglishLanguage(room.language)
            ? 'Make the spell work.'
            : 'Провести ефект закляття.',
          die: 'd20',
          targetActorId: targetActor?.id ?? null,
          itemName,
        },
      ],
    };
  }

  return {
    mode: 'immediate',
    message: isEnglishLanguage(room.language)
      ? 'Immediate scene response.'
      : 'Негайна реакція сцени.',
    targetActorId: targetActor?.id ?? null,
    itemName,
    steps: [],
  };
}

function buildFallbackConceptGuard(room: Room, action: string): ConceptGuardDecision {
  const normalizedAction = normalizeActionText(action);
  const normalizedSetting = room.filters.setting.toLowerCase();
  const allowsModernTech = includesAny(normalizedSetting, ['кібер', 'cyber', 'sci', 'science', 'modern', 'стімпанк', 'steampunk']);
  const modernTechKeywords = [
    'лазер',
    'laser',
    'tank',
    'танк',
    'rocket launcher',
    'гранатомет',
    'iphone',
    'smartphone',
    'смартфон',
    'nuke',
    'nuclear',
    'spaceship',
    'космоліт',
  ];

  if (!allowsModernTech && includesAny(normalizedAction, modernTechKeywords)) {
    return {
      result: 'blocked',
      explanation: isEnglishLanguage(room.language)
        ? 'That action breaks the world logic and tone of the current campaign.'
        : 'Ця дія ламає логіку світу й тон поточної кампанії.',
    };
  }

  return {
    result: 'allowed',
    explanation: isEnglishLanguage(room.language)
      ? 'The action fits the scene and character concept.'
      : 'Дія вкладається в концепт сцени й персонажа.',
  };
}

function outcomeFromRoll(rollResult: number): CheckOutcome {
  if (rollResult <= 7) {
    return 'fail';
  }

  if (rollResult <= 11) {
    return 'mixed';
  }

  if (rollResult <= 17) {
    return 'pass';
  }

  return 'strong_pass';
}

function nextAwarenessOnFail(currentAwareness: SceneActor['awareness'], escalateToEngaged: boolean) {
  if (escalateToEngaged) {
    return 'engaged';
  }

  return currentAwareness === 'engaged' ? 'engaged' : 'alerted';
}

function nextWoundStateFromDamage(outcome: CheckOutcome): SceneActor['woundState'] {
  if (outcome === 'strong_pass') {
    return 'dead';
  }

  if (outcome === 'pass') {
    return 'critical';
  }

  return 'wounded';
}

function buildFallbackCheckEvaluation({
  room,
  pendingResolution,
  currentStep,
  rollResult,
}: {
  room: Room;
  pendingResolution: PendingResolution;
  currentStep: CheckStep;
  rollResult: number;
}): EvaluateCheckStepDecision {
  const withSceneDelta = (decision: Omit<EvaluateCheckStepDecision, 'sceneDelta'>): EvaluateCheckStepDecision => ({
    ...decision,
    sceneDelta: buildSceneDeltaFromCheck({
      room,
      currentStep,
      outcome: decision.resolvedCheck.outcome,
      consequence: decision.resolvedCheck.consequence,
      updatedSceneActors: decision.updatedSceneActors,
      continueSequence: decision.continueSequence,
    }),
  });

  const outcome = outcomeFromRoll(rollResult);
  const nextStep = pendingResolution.steps[pendingResolution.currentStepIndex + 1] ?? null;
  const targetActor = currentStep.targetActorId
    ? room.sceneActors.find((actor) => actor.id === currentStep.targetActorId) ?? null
    : null;
  const updatedTarget = targetActor ? { ...targetActor } : null;

  if (currentStep.type === 'stealth') {
    if (updatedTarget) {
      updatedTarget.awareness = outcome === 'fail'
        ? nextAwarenessOnFail(updatedTarget.awareness, false)
        : outcome === 'mixed'
          ? 'suspicious'
          : 'unaware';
      updatedTarget.notes = outcome === 'fail'
        ? (isEnglishLanguage(room.language)
          ? 'Caught movement and reacts immediately.'
          : 'Помічає рух і різко реагує.')
        : outcome === 'mixed'
          ? (isEnglishLanguage(room.language)
            ? 'Feels that something is off.'
            : 'Відчуває, що щось не так.')
          : (isEnglishLanguage(room.language)
            ? 'Remains unaware.'
            : 'Нічого не підозрює.');
    }

    const failDmText = isEnglishLanguage(room.language)
      ? `${targetActor?.name ?? 'The target'} catches the movement and reacts before you can finish the approach.`
      : `${targetActor?.name ?? 'Ціль'} помічає рух і реагує ще до завершення підходу.`;
    const successDmText = nextStep
      ? makeCheckMessage(
        room,
        nextStep.label,
        nextStep.stakes,
      )
      : (isEnglishLanguage(room.language)
        ? 'You slip into position unnoticed.'
        : 'Ти непомітно займаєш позицію.');

    return withSceneDelta({
      resolvedCheck: {
        stepId: currentStep.id,
        type: currentStep.type,
        result: rollResult,
        outcome,
        consequence: outcome === 'fail'
          ? (isEnglishLanguage(room.language)
            ? 'The target notices you.'
            : 'Ціль помічає тебе.')
          : (isEnglishLanguage(room.language)
            ? 'You keep your approach hidden.'
            : 'Твій підхід лишається непомітним.'),
      },
      continueSequence: outcome !== 'fail' && Boolean(nextStep),
      updatedSceneActors: updatedTarget ? [updatedTarget] : [],
      dmText: outcome === 'fail' ? failDmText : successDmText,
    });
  }

  if (currentStep.type === 'attack') {
    if (updatedTarget) {
      updatedTarget.awareness = outcome === 'fail'
        ? nextAwarenessOnFail(updatedTarget.awareness, true)
        : 'engaged';
      updatedTarget.notes = outcome === 'fail'
        ? (isEnglishLanguage(room.language)
          ? 'The attack goes wrong and open combat starts.'
          : 'Атака зривається й починається відкрита сутичка.')
        : (isEnglishLanguage(room.language)
          ? 'The target is fully engaged in the clash.'
          : 'Ціль уже повністю втягнута в сутичку.');
    }

    return withSceneDelta({
      resolvedCheck: {
        stepId: currentStep.id,
        type: currentStep.type,
        result: rollResult,
        outcome,
        consequence: outcome === 'fail'
          ? (isEnglishLanguage(room.language)
            ? 'The strike misses its lethal moment.'
            : 'Удар не встигає в смертельне вікно.')
          : (isEnglishLanguage(room.language)
            ? 'The hit lands and opens the target up to damage.'
            : 'Удар проходить і відкриває шлях до урону.'),
      },
      continueSequence: outcome !== 'fail' && Boolean(nextStep),
      updatedSceneActors: updatedTarget ? [updatedTarget] : [],
      dmText: outcome === 'fail'
        ? (isEnglishLanguage(room.language)
          ? `${targetActor?.name ?? 'The target'} twists away and turns the scene into an active confrontation.`
          : `${targetActor?.name ?? 'Ціль'} виривається й переводить сцену у відкриту конфронтацію.`)
        : (nextStep
          ? makeCheckMessage(room, nextStep.label, nextStep.stakes)
          : (isEnglishLanguage(room.language)
            ? 'The strike lands cleanly.'
            : 'Удар лягає чисто.')),
    });
  }

  if (currentStep.type === 'damage') {
    if (updatedTarget) {
      updatedTarget.awareness = updatedTarget.woundState === 'dead' ? updatedTarget.awareness : 'engaged';
      updatedTarget.woundState = nextWoundStateFromDamage(outcome);
      updatedTarget.notes = isEnglishLanguage(room.language)
        ? `Wound state is now ${updatedTarget.woundState}.`
        : `Стан рани тепер: ${updatedTarget.woundState}.`;
    }

    const damageState = updatedTarget?.woundState ?? nextWoundStateFromDamage(outcome);
    return withSceneDelta({
      resolvedCheck: {
        stepId: currentStep.id,
        type: currentStep.type,
        result: rollResult,
        outcome,
        consequence: isEnglishLanguage(room.language)
          ? `The target becomes ${damageState}.`
          : `Ціль переходить у стан ${damageState}.`,
      },
      continueSequence: false,
      updatedSceneActors: updatedTarget ? [updatedTarget] : [],
      dmText: isEnglishLanguage(room.language)
        ? `The damage resolves and the target is now ${damageState}.`
        : `Урон застосовано. Стан цілі тепер: ${damageState}.`,
    });
  }

  return withSceneDelta({
    resolvedCheck: {
      stepId: currentStep.id,
      type: currentStep.type,
      result: rollResult,
      outcome,
      consequence: outcome === 'fail'
        ? (isEnglishLanguage(room.language)
          ? 'The attempt does not pay off.'
          : 'Спроба не дає результату.')
        : (isEnglishLanguage(room.language)
          ? 'The attempt creates progress.'
          : 'Спроба дає прогрес.'),
    },
    continueSequence: outcome !== 'fail' && Boolean(nextStep),
    updatedSceneActors: updatedTarget ? [updatedTarget] : [],
    dmText: outcome !== 'fail' && nextStep
      ? makeCheckMessage(room, nextStep.label, nextStep.stakes)
      : (isEnglishLanguage(room.language)
        ? 'The scene reacts to the attempt.'
        : 'Сцена реагує на спробу.'),
  });
}

function formatRecentMessages(messages: RoomMessage[]) {
  return getRecentMessages(messages).map((message) => {
    return `[${message.authorType.toUpperCase()} ${message.authorName}]: ${message.content}`;
  }).join('\n\n');
}

function formatResolvedChecks(resolvedChecks: ResolvedCheck[]) {
  if (resolvedChecks.length === 0) {
    return '- No resolved checks yet.';
  }

  return resolvedChecks.map((check) => `
- ${check.type} (${check.stepId})
  Roll: ${check.result}
  Outcome: ${check.outcome}
  Consequence: ${check.consequence}
`).join('\n');
}

function formatPendingResolution(pendingResolution: PendingResolution | null | undefined) {
  if (!pendingResolution) {
    return 'No active pending resolution.';
  }

  return JSON.stringify(pendingResolution, null, 2);
}

export async function generateCharacter({
  generateText,
  room,
  playerId,
  displayName,
}: {
  generateText: GenerateTextFn;
  room: Room;
  playerId: string;
  displayName: string;
}): Promise<GenerateCharacterResult> {
  try {
    const generated = await generateJson({
      generateText,
      systemPrompt: CHARACTER_SYSTEM_PROMPT,
      schema: generatedCharacterSchema,
      prompt: `
Create a player character for ${displayName}.

Campaign:
Title: ${room.title}
Session type: ${room.sessionType}
${formatFilters(room.filters)}

Existing characters:
${formatCharacters(room.characters)}

Return JSON:
{
  "bioSummary": "string",
  "backstory": "string",
  "motivation": "string",
  "classFantasy": "string",
  "inventory": [
    {
      "name": "string",
      "quantity": 1,
      "description": "string",
      "kind": "string"
    }
  ]
}

Requirements:
- The new character must be meaningfully different from every existing character in biography, backstory, motivation, role fantasy, and starting inventory.
- Do not clone another character's class fantasy or starting loadout.
- Make the character fit the campaign tone, world concept, and current cast.
- Use 3-6 inventory items that fit the campaign without breaking tone or balance.
${getLanguageInstruction(room.language)}
`.trim(),
    });

    return ensureCharacterVariety({
      room,
      playerId,
      displayName,
      character: generated,
    });
  } catch (error) {
    console.warn('Character generator failed; using deterministic fallback.', error);
    return buildFallbackCharacter(room, playerId, displayName);
  }
}

export async function generateOpening({
  generateText,
  room,
}: {
  generateText: GenerateTextFn;
  room: Room;
}): Promise<GeneratedCampaign> {
  try {
    const opening = await generateJson({
      generateText,
      systemPrompt: OPENING_SYSTEM_PROMPT,
      schema: generatedOpeningSchema,
      prompt: `
Create the opening setup for this room.

Title: ${room.title}
Session type: ${room.sessionType}
${formatFilters(room.filters)}

Characters:
${formatCharacters(room.characters)}

Return JSON:
{
  "synopsis": "string",
  "openingScene": "string",
  "conflicts": ["string"],
  "npcs": [
    {
      "name": "string",
      "description": "string",
      "role": "string"
    }
  ],
  "playerStartHooks": [
    {
      "playerId": "string",
      "displayName": "string",
      "cue": "string"
    }
  ]
}

- Start the openingScene inside a concrete moment that is already happening.
- The openingScene must follow this rhythm: concrete scene -> threat or pressure -> what is sensed right now -> one personal sting -> final question.
- Keep openingScene to 3-6 sentences with no lists, labels, meta commentary, or biography dump.
- Do not use phrases like "visible obstacle", "scene demands", "this scene is about", "NPC controls", "the hero must act", or their equivalents in other languages.
- Show tension through place, sound, movement, danger, and NPC behavior instead of explanation.
- End the openingScene with exactly "${getOpeningQuestion(room)}"
- For every character, return one short internal cue in playerStartHooks. Each cue must be a single sentence and should help personalize later scenes without reading like a briefing.
- Use each character's summary, backstory, motivation, and class fantasy to shape the cues, but weave at most 1-2 of those hooks into the openingScene itself.
- Return strict JSON only.
- Do not use markdown.
- Use double-quoted property names.
- Do not add trailing commas.
${getLanguageInstruction(room.language)}
`.trim(),
    });

    return {
      ...opening,
      playerStartHooks: normalizePlayerStartHooks(room, room.characters, opening.playerStartHooks),
    };
  } catch (error) {
    console.warn('Opening generator returned invalid JSON; using deterministic fallback.', error);
    return buildFallbackOpening(room);
  }
}

export async function runConceptGuard({
  generateText,
  room,
  character,
  action,
}: {
  generateText: GenerateTextFn;
  room: Room;
  character: PlayerCharacter;
  action: string;
}): Promise<ConceptGuardDecision> {
  try {
    return await generateJson({
      generateText,
      systemPrompt: CONCEPT_GUARD_SYSTEM_PROMPT,
      schema: conceptGuardSchema,
      prompt: `
Campaign:
Title: ${room.title}
${formatFilters(room.filters)}

Narrative memory:
${JSON.stringify(room.memory, null, 2)}

Scene actors:
${formatSceneActors(room.sceneActors)}

Character:
${JSON.stringify(character, null, 2)}

Player action:
${action}

Return JSON:
{
  "result": "allowed or blocked",
  "explanation": "string"
}

Block only if the action breaks campaign tone, world logic, or the player's character concept.
- Return strict JSON only.
- Do not use markdown.
- Use double-quoted property names.
- Do not add trailing commas.
${getLanguageInstruction(room.language)}
`.trim(),
    });
  } catch (error) {
    console.warn('Concept guard returned invalid JSON; using deterministic fallback.', error);
    return buildFallbackConceptGuard(room, action);
  }
}

export async function planActionResolution({
  generateText,
  room,
  character,
  action,
  deterministicDecision,
}: {
  generateText: GenerateTextFn;
  room: Room;
  character: PlayerCharacter;
  action: string;
  deterministicDecision?: StrictActionDecision;
}): Promise<ActionPlanDecision> {
  if (deterministicDecision) {
    const lockedPlanSchema = z.object({
      message: z.string().min(1),
    });

    try {
      const lockedPlan = await generateJson({
        generateText,
        systemPrompt: ACTION_RESOLUTION_SYSTEM_PROMPT,
        schema: lockedPlanSchema,
        prompt: `
The host engine already classified this action. Do not reinterpret it.

Campaign:
Title: ${room.title}
${formatFilters(room.filters)}

Current scene summary:
${room.memory.sceneSummary}

Scene actors:
${formatSceneActors(room.sceneActors)}

Character:
${JSON.stringify(character, null, 2)}

Player action:
${action}

Locked host decision:
${JSON.stringify(deterministicDecision, null, 2)}

Task:
- Keep the exact mode, targetActorId, itemName, and ordered steps from the locked host decision.
- Do not add new checks, remove checks, or soften the stakes.
- Rewrite only the DM-facing instruction message for the first gate.
- The message must explicitly ask for the first check and mention the locked stakes.

Return JSON:
{
  "message": "string"
}

${getLanguageInstruction(room.language)}
`.trim(),
      });

      return {
        ...deterministicDecision,
        message: lockedPlan.message,
      };
    } catch (error) {
      console.warn('Action planner returned invalid JSON; using deterministic locked decision.', error);
      return deterministicDecision;
    }
  }

  try {
    const plan = await generateJson({
      generateText,
      systemPrompt: ACTION_RESOLUTION_SYSTEM_PROMPT,
      schema: actionPlanSchema,
      prompt: `
Plan how to resolve this player action.

Campaign:
Title: ${room.title}
${formatFilters(room.filters)}

Current scene summary:
${room.memory.sceneSummary}

Scene actors:
${formatSceneActors(room.sceneActors)}

Character:
${JSON.stringify(character, null, 2)}

Player action:
${action}

Return JSON:
{
  "mode": "blocked | clarify | immediate | sequence",
  "message": "string",
  "targetActorId": "string or null",
  "itemName": "string or null",
  "steps": [
    {
      "id": "string",
      "type": "stealth | attack | damage | perception | social | mobility | magic | custom",
      "label": "string",
      "stakes": "string",
      "die": "d20",
      "targetActorId": "string or null",
      "itemName": "string or null"
    }
  ]
}

Rules:
- If the action is ambiguous about target or used item and you cannot infer them from scene actors or inventory, return "clarify".
- If the action is a simple roleplay or low-stakes action, return "immediate".
- If the action is risky, layered, or can create a major advantage, return "sequence".
- For stealth kill examples like "I take my sword, move behind them, and cut their throat", use ordered checks: stealth, attack, damage.
- Keep the first DM-facing prompt in "message". If mode is "sequence", that message must explicitly ask for the first check.
- Return strict JSON only.
- Do not use markdown.
- Use double-quoted property names.
- Do not add trailing commas.
${getLanguageInstruction(room.language)}
`.trim(),
    });

    if (plan.mode === 'sequence' && (!plan.steps || plan.steps.length === 0)) {
      throw new Error('Action planner returned sequence mode without steps.');
    }

    return {
      mode: plan.mode,
      message: plan.message,
      targetActorId: plan.targetActorId ?? null,
      itemName: plan.itemName ?? null,
      steps: plan.steps?.map((step) => ({
        id: step.id,
        type: step.type,
        label: step.label,
        stakes: step.stakes,
        die: 'd20',
        targetActorId: step.targetActorId ?? null,
        itemName: step.itemName ?? null,
      })),
    };
  } catch (error) {
    console.warn('Action planner returned invalid JSON; using deterministic fallback.', error);
    return buildFallbackActionPlan(room, character, action);
  }
}

export async function evaluateCheckStep({
  generateText,
  room,
  character,
  pendingResolution,
  currentStep,
  rollResult,
}: {
  generateText: GenerateTextFn;
  room: Room;
  character: PlayerCharacter;
  pendingResolution: PendingResolution;
  currentStep: CheckStep;
  rollResult: number;
}): Promise<EvaluateCheckStepDecision> {
  const deterministicFrame = getDeterministicStepFrame(room, currentStep, pendingResolution);

  try {
    const evaluation = await generateJson({
      generateText,
      systemPrompt: EVALUATE_CHECK_STEP_SYSTEM_PROMPT,
      schema: evaluateCheckStepSchema,
      prompt: `
Evaluate a single d20 check step.

Campaign:
Title: ${room.title}
${formatFilters(room.filters)}

Narrative memory:
${JSON.stringify(room.memory, null, 2)}

Scene actors:
${formatSceneActors(room.sceneActors)}

Character:
${JSON.stringify(character, null, 2)}

Active resolution:
${JSON.stringify(pendingResolution, null, 2)}

Current step:
${JSON.stringify(currentStep, null, 2)}

Resolved checks so far:
${formatResolvedChecks(pendingResolution.resolvedChecks)}

Authoritative step frame:
${JSON.stringify({
  stakes: deterministicFrame.stakes,
  sceneAxis: deterministicFrame.axis,
  gateTriggers: deterministicFrame.triggers,
}, null, 2)}

Rolled d20 result:
${rollResult}

Return JSON:
{
  "resolvedCheck": {
    "stepId": "${currentStep.id}",
    "type": "${currentStep.type}",
    "result": ${rollResult},
    "outcome": "fail | mixed | pass | strong_pass",
    "consequence": "string"
  },
  "continueSequence": true,
  "updatedSceneActors": [
    {
      "id": "string",
      "name": "string",
      "kind": "npc | monster",
      "role": "string",
      "currentLocation": "string",
      "awareness": "unaware | suspicious | alerted | engaged",
      "woundState": "healthy | wounded | critical | dead",
      "disposition": "string",
      "notes": "string"
    }
  ],
  "dmText": "string"
}

Default policy:
- 1-7 usually means fail.
- 8-11 usually means mixed.
- 12-17 usually means pass.
- 18-20 usually means strong_pass.
- If stealth or attack fails, the target should usually react and awareness should become at least alerted.
- Damage updates woundState and is normally the final step.
- Preserve ids for existing scene actors.
- If you continue the sequence, dmText must ask for the next check explicitly.
- Stakes are locked by the host engine. Respect them exactly.
- Your consequence must move the scene on the locked axis and never leave the scene unchanged.
- Return strict JSON only.
- Do not use markdown.
- Use double-quoted property names.
- Do not add trailing commas.
${getLanguageInstruction(room.language)}
`.trim(),
    });

    const updatedSceneActors = evaluation.updatedSceneActors.map((actor) => ({
      id: actor.id,
      name: actor.name,
      kind: actor.kind,
      role: actor.role,
      currentLocation: actor.currentLocation,
      awareness: actor.awareness,
      woundState: actor.woundState,
      disposition: actor.disposition,
      notes: actor.notes,
    }));

    return {
      resolvedCheck: {
        stepId: evaluation.resolvedCheck.stepId,
        type: evaluation.resolvedCheck.type,
        result: evaluation.resolvedCheck.result,
        outcome: evaluation.resolvedCheck.outcome as CheckOutcome,
        consequence: evaluation.resolvedCheck.consequence,
      },
      continueSequence: evaluation.continueSequence,
      updatedSceneActors,
      dmText: evaluation.dmText,
      sceneDelta: buildSceneDeltaFromCheck({
        room,
        currentStep,
        outcome: evaluation.resolvedCheck.outcome as CheckOutcome,
        consequence: evaluation.resolvedCheck.consequence,
        updatedSceneActors,
        continueSequence: evaluation.continueSequence,
      }),
    };
  } catch (error) {
    console.warn('Check evaluation returned invalid JSON; using deterministic fallback.', error);
    return buildFallbackCheckEvaluation({
      room,
      pendingResolution,
      currentStep,
      rollResult,
    });
  }
}

export async function generateDmReply({
  generateText,
  room,
  resolvedChecks = [],
}: {
  generateText: GenerateTextFn;
  room: Room;
  resolvedChecks?: ResolvedCheck[];
}) {
  return generateText({
    systemPrompt: PROFESSIONAL_DM_SYSTEM_PROMPT,
    prompt: `
Campaign:
Title: ${room.title}
${formatFilters(room.filters)}

Narrative memory:
${JSON.stringify(room.memory, null, 2)}

Characters:
${formatCharacters(room.characters)}

Scene actors:
${formatSceneActors(room.sceneActors)}

Recent messages:
${formatRecentMessages(room.messages)}

Recent resolved checks:
${formatResolvedChecks(resolvedChecks)}

Pending resolution:
${formatPendingResolution(room.pendingResolution)}

Task:
- Write the next GM response.
- Respect inventory, scene actors, canon facts, and prior checks.
- Do not resolve any step that has not been rolled yet.
- Use this host terminology when relevant: ${STRICT_HOST_RULES.uiTerminology.stakesLabel}, ${STRICT_HOST_RULES.uiTerminology.consequenceLabel}, ${STRICT_HOST_RULES.uiTerminology.nextActorLabel}.
- Keep the answer inside the host template: world state -> action reaction -> consequence -> next actor.

${getLanguageInstruction(room.language)}
`.trim(),
  });
}

export async function updateMemory({
  generateText,
  room,
  assistantReply,
  resolvedChecks = [],
  sceneDelta = null,
}: {
  generateText: GenerateTextFn;
  room: Room;
  assistantReply: string;
  resolvedChecks?: ResolvedCheck[];
  sceneDelta?: SceneDelta | null;
}): Promise<SessionMemory> {
  const memory = await generateJson({
    generateText,
    systemPrompt: MEMORY_UPDATE_SYSTEM_PROMPT,
    schema: sessionMemorySchema,
    prompt: `
Current memory:
${JSON.stringify(room.memory, null, 2)}

Characters:
${formatCharacters(room.characters)}

Scene actors:
${formatSceneActors(room.sceneActors)}

Recent messages:
${formatRecentMessages(room.messages)}

Resolved checks:
${formatResolvedChecks(resolvedChecks)}

Authoritative scene delta:
${sceneDelta ? JSON.stringify(sceneDelta, null, 2) : 'null'}

New GM reply:
${assistantReply}

Return JSON:
{
  "campaignSummary": "string",
  "sceneSummary": "string",
  "activeLocation": "string or null",
  "canonFacts": ["string"],
  "openThreads": ["string"],
  "activeNpcs": [
    {
      "name": "string",
      "role": "string",
      "disposition": "string",
      "goal": "string",
      "lastSeen": "string or null"
    }
  ],
  "playerHooks": ["string"],
  "recentRolls": [
    {
      "kind": "string",
      "result": 1,
      "consequence": "string"
    }
  ],
  "lastUpdatedTurn": ${room.memory.lastUpdatedTurn + 1}
}

Do not encode mechanical states like awareness or woundState into new rules; only reflect them narratively where relevant.
Authoritative scene delta is canon and must be reflected in memory.
${getLanguageInstruction(room.language)}
`.trim(),
  });

  return {
    campaignSummary: memory.campaignSummary,
    sceneSummary: memory.sceneSummary,
    activeLocation: memory.activeLocation ?? null,
    canonFacts: memory.canonFacts,
    openThreads: memory.openThreads,
    activeNpcs: memory.activeNpcs.map((npc) => ({
      name: npc.name,
      role: npc.role,
      disposition: npc.disposition,
      goal: npc.goal,
      lastSeen: npc.lastSeen ?? null,
    })),
    playerHooks: memory.playerHooks,
    recentRolls: memory.recentRolls.map((roll) => ({
      kind: roll.kind,
      result: roll.result,
      consequence: roll.consequence,
    })),
    lastUpdatedTurn: memory.lastUpdatedTurn,
  };
}
