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

function buildFallbackOpening(room: Room): GeneratedCampaign {
  const playerStartHooks = normalizePlayerStartHooks(room, room.characters, []);
  const english = isEnglishLanguage(room.language);

  return {
    synopsis: english
      ? `"${room.title}" begins under uncertain circumstances shaped by ${room.filters.setting.toLowerCase()} realities.`
      : `"${room.title}" починається за невизначених обставин у дусі "${room.filters.setting}".`,
    openingScene: english
      ? `The group finds itself at a crossroads with little time and even less clarity. Something has already gone wrong. ${getOpeningQuestion(room)}`
      : `Група опиняється на роздоріжжі — часу мало, ясності ще менше. Щось уже пішло не так. ${getOpeningQuestion(room)}`,
    conflicts: [
      english
        ? 'Figure out what is happening before the window closes.'
        : 'Зрозуміти, що відбувається, перш ніж можливість зникне.',
    ],
    npcs: [],
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

function normalizeIdentityText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яіїєґ\s]/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function buildFallbackCharacter(room: Room, playerId: string, displayName: string): GenerateCharacterResult {
  const english = isEnglishLanguage(room.language);

  return {
    playerId,
    displayName,
    bioSummary: english
      ? `${displayName} is an adventurer drawn to the events of "${room.title}".`
      : `${displayName} — авантюрист, якого привели сюди події "${room.title}".`,
    backstory: english
      ? `${displayName} carries a past that few would believe and fewer still would forgive.`
      : `${displayName} має минуле, у яке мало хто повірить і ще менше — пробачить.`,
    motivation: english
      ? `Survive whatever "${room.title}" has in store and turn it to advantage.`
      : `Пережити все, що принесе "${room.title}", і обернути на свою користь.`,
    classFantasy: english ? 'wanderer' : 'мандрівник',
    inventory: [],
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
