import { STRICT_HOST_RULES, type GateTrigger, type SceneAxis } from '../src/constants/hostRules';
import type {
  CheckOutcome,
  CheckStep,
  CheckType,
  PendingResolution,
  PlayerCharacter,
  Room,
  SceneActor,
  SceneDelta,
  SessionMemory,
} from '../src/types';

export type HostStakes = {
  success: string;
  cost: string;
  fail: string;
};

export type StrictActionDecision = {
  mode: 'blocked' | 'clarify' | 'immediate' | 'sequence';
  reason: string;
  message: string;
  targetActorId: string | null;
  itemName: string | null;
  steps: CheckStep[];
  gateTriggers: GateTrigger[];
  sceneAxes: SceneAxis[];
};

type StepFrame = {
  stakes: HostStakes;
  axis: SceneAxis;
  triggers: GateTrigger[];
};

type ClassificationContext = {
  room: Room;
  character: PlayerCharacter;
  action: string;
};

function isEnglishLanguage(language: string) {
  return language === 'English';
}

function normalizeActionText(action: string) {
  return action
    .toLowerCase()
    .replace(/[!?.,;:()[\]"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern));
}

function dedupe<T>(items: T[]) {
  return Array.from(new Set(items));
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

function hasModernTechMismatch(room: Room, normalizedAction: string) {
  const normalizedWorldSignal = `${room.filters.setting} ${room.filters.worldConcept}`.toLowerCase();
  const allowsModernTech = includesAny(normalizedWorldSignal, [
    'кібер',
    'cyber',
    'sci',
    'science',
    'modern',
    'стімпанк',
    'steampunk',
  ]);

  return !allowsModernTech && includesAny(normalizedAction, [
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
  ]);
}

function getStepFrame(
  room: Room,
  stepType: CheckType,
  targetActor: SceneActor | null,
  itemName: string | null,
): StepFrame {
  const targetLabel = targetActor?.name ?? (isEnglishLanguage(room.language) ? 'the target' : 'ціль');
  const itemLabel = itemName ?? (isEnglishLanguage(room.language) ? 'your approach' : 'твою дію');

  switch (stepType) {
    case 'stealth':
      return {
        axis: 'position',
        triggers: ['risk', 'advantage', 'control'],
        stakes: isEnglishLanguage(room.language)
          ? {
            success: `You reach ${targetLabel} unnoticed and seize positional advantage.`,
            cost: 'You spend time and expose yourself to a narrow reaction window.',
            fail: `${targetLabel} notices you, escalates alertness, and the scene turns hostile.`,
          }
          : {
            success: `Ти підходиш до ${targetLabel} непомітно і забираєш позиційну перевагу.`,
            cost: 'Ти витрачаєш темп і залишаєш вузьке вікно на реакцію сцени.',
            fail: `${targetLabel} помічає тебе, піднімає настороженість і загострює сцену.`,
          },
      };
    case 'attack':
      return {
        axis: 'threat',
        triggers: ['risk', 'harm', 'advantage'],
        stakes: isEnglishLanguage(room.language)
          ? {
            success: `You land the strike with ${itemLabel} before ${targetLabel} recovers.`,
            cost: 'You commit to the exchange and give up concealment or spacing.',
            fail: `${targetLabel} survives the opening, reacts, and turns this into open pressure.`,
          }
          : {
            success: `Ти встигаєш влучити ${itemLabel} до того, як ${targetLabel} оговтається.`,
            cost: 'Ти входиш у розмін і віддаєш укриття або дистанцію.',
            fail: `${targetLabel} переживає вікно атаки, реагує і переводить сцену у відкритий тиск.`,
          },
      };
    case 'damage':
      return {
        axis: 'threat',
        triggers: ['harm', 'risk'],
        stakes: isEnglishLanguage(room.language)
          ? {
            success: `The blow becomes decisive and changes ${targetLabel}'s wound state.`,
            cost: 'You spend the opening fully and leave evidence, noise, or exposure behind.',
            fail: `${targetLabel} remains active enough to keep the danger in play.`,
          }
          : {
            success: `Удар стає вирішальним і змінює стан поранень цілі ${targetLabel}.`,
            cost: 'Ти повністю витрачаєш вікно атаки і лишаєш по собі шум, сліди або відкриття.',
            fail: `${targetLabel} лишається достатньо активною, щоб небезпека не зникла.`,
          },
      };
    case 'perception':
      return {
        axis: 'information',
        triggers: ['risk', 'advantage', 'control'],
        stakes: isEnglishLanguage(room.language)
          ? {
            success: 'You notice something useful and turn it into actionable information.',
            cost: 'The search consumes time and attention.',
            fail: 'You come up empty while the scene keeps moving without you.',
          }
          : {
            success: 'Ти знаходиш щось корисне і перетворюєш це на дієву інформацію.',
            cost: 'Пошук з’їдає час і увагу.',
            fail: 'Ти не отримуєш результату, а сцена рухається далі без тебе.',
          },
      };
    case 'social':
      return {
        axis: 'social_state',
        triggers: ['risk', 'social_shift', 'control'],
        stakes: isEnglishLanguage(room.language)
          ? {
            success: `Your pressure changes ${targetLabel}'s response.`,
            cost: 'You reveal leverage, intent, or dependence while pressing the point.',
            fail: `${targetLabel} resists, hardens, or turns the exchange against you.`,
          }
          : {
            success: `Твій тиск змінює реакцію ${targetLabel}.`,
            cost: 'Ти відкриваєш свій важіль, намір або залежність, поки тиснеш.',
            fail: `${targetLabel} опирається, жорсткішає або розвертає розмову проти тебе.`,
          },
      };
    case 'mobility':
      return {
        axis: 'position',
        triggers: ['risk', 'advantage'],
        stakes: isEnglishLanguage(room.language)
          ? {
            success: 'You cross the obstacle and improve your position.',
            cost: 'You spend tempo, footing, or stamina to get through.',
            fail: 'You lose tempo, position, or safety while the obstacle holds.',
          }
          : {
            success: 'Ти проходиш перешкоду і покращуєш позицію.',
            cost: 'Ти витрачаєш темп, опору або витривалість, щоб пролізти.',
            fail: 'Ти втрачаєш темп, позицію або безпеку, а перешкода лишається.',
          },
      };
    case 'magic':
      return {
        axis: 'resources',
        triggers: ['risk', 'advantage', 'resource', 'control'],
        stakes: isEnglishLanguage(room.language)
          ? {
            success: 'The effect manifests and gives you the intended edge.',
            cost: 'You spend focus, exposure, or magical stability to force the effect.',
            fail: 'The effect misfires, weakens, or creates fresh pressure.',
          }
          : {
            success: 'Ефект спрацьовує і дає тобі задуману перевагу.',
            cost: 'Ти витрачаєш фокус, відкриття або магічну стабільність, щоб продавити ефект.',
            fail: 'Ефект зривається, слабшає або створює новий тиск.',
          },
      };
    default:
      return {
        axis: 'resources',
        triggers: ['risk', 'advantage'],
        stakes: isEnglishLanguage(room.language)
          ? {
            success: 'The action works and changes the scene in your favor.',
            cost: 'You pay with time, exposure, or a limited resource.',
            fail: 'The scene worsens instead of yielding the intended gain.',
          }
          : {
            success: 'Дія спрацьовує і змінює сцену на твою користь.',
            cost: 'Ти платиш часом, відкриттям або обмеженим ресурсом.',
            fail: 'Сцена погіршується замість того, щоб дати бажаний виграш.',
          },
      };
  }
}

function formatStakes(room: Room, stakes: HostStakes) {
  return isEnglishLanguage(room.language)
    ? `Success: ${stakes.success} Cost: ${stakes.cost} Fail: ${stakes.fail}`
    : `Успіх: ${stakes.success} Ціна: ${stakes.cost} Провал: ${stakes.fail}`;
}

function createStep(
  room: Room,
  id: string,
  type: CheckType,
  label: string,
  targetActor: SceneActor | null,
  itemName: string | null,
) {
  const frame = getStepFrame(room, type, targetActor, itemName);

  return {
    step: {
      id,
      type,
      label,
      stakes: formatStakes(room, frame.stakes),
      die: 'd20' as const,
      targetActorId: targetActor?.id ?? null,
      itemName,
    },
    frame,
  };
}

function formatGatePrompt(room: Room, step: CheckStep, stakes: HostStakes) {
  return isEnglishLanguage(room.language)
    ? `Intent fixed. Roll d20 for ${step.label}. Success: ${stakes.success} Cost: ${stakes.cost} Fail: ${stakes.fail}`
    : `Намір зафіксовано. Кинь d20 на ${step.label}. Успіх: ${stakes.success} Ціна: ${stakes.cost} Провал: ${stakes.fail}`;
}

function buildClarifyMessage(room: Room, variant: 'vague' | 'combo' | 'search' | 'social' | 'item') {
  if (isEnglishLanguage(room.language)) {
    switch (variant) {
      case 'combo':
        return 'One post equals one intended action. Choose one priority: movement, search, attack, hiding, social pressure, or item use.';
      case 'search':
        return 'Choose one zone or container to search. “I search everything” is too broad to move the scene.';
      case 'social':
        return 'Clarify who you address, what you want, and what leverage you are using: logic, status, threat, lie, or bargain.';
      case 'item':
        return 'Clarify which item you use, on what, and with what intended effect.';
      default:
        return 'Clarify one concrete action: what exactly you do, what or whom you affect, how you do it, and what you want from it.';
    }
  }

  switch (variant) {
    case 'combo':
      return 'Один пост = одна намірена дія. Обери один пріоритет: рух, обшук, атаку, схованку, соціальний тиск або використання предмета.';
    case 'search':
      return 'Обери один сектор або контейнер для обшуку. Формула “я обшукую все” не рухає сцену.';
    case 'social':
      return 'Уточни, кому саме говориш, чого хочеш і чим тиснеш: логіка, статус, брехня, погроза чи торг.';
    case 'item':
      return 'Уточни, який саме предмет використовуєш, на що і з якою метою.';
    default:
      return 'Уточни одну конкретну дію: що саме робиш, на що або кого впливаєш, яким способом і з якою метою.';
  }
}

export function classifyPlayerAction({
  room,
  character,
  action,
}: ClassificationContext): StrictActionDecision {
  const normalizedAction = normalizeActionText(action);
  const targetActor = findTargetActor(room, action);
  const itemName = findInventoryItemName(character, action);

  if (hasModernTechMismatch(room, normalizedAction)) {
    return {
      mode: 'blocked',
      reason: 'world_logic',
      message: isEnglishLanguage(room.language)
        ? 'That action breaks the world logic and tone of the current campaign.'
        : 'Ця дія ламає логіку світу й тон поточної кампанії.',
      targetActorId: null,
      itemName: null,
      steps: [],
      gateTriggers: [],
      sceneAxes: [],
    };
  }

  const isVague = normalizedAction.length < 18
    || includesAny(normalizedAction, [
      'щось',
      'якось',
      'роблю',
      'пробую',
      'вплинути',
      'думаю',
      'something',
      'somehow',
      'do something',
      'try something',
    ]);

  const isSearch = includesAny(normalizedAction, [
    'обшук', 'шука', 'огляда', 'оглян', 'дивл', 'роздивл', 'оглядаюсь',
    'перевір', 'осмотр', 'вивч', 'дослід',
    'search', 'inspect', 'look for', 'look around', 'examine', 'survey', 'scout',
  ]);
  const isSocial = includesAny(normalizedAction, ['перекон', 'бреш', 'заляк', 'прос', 'вмов', 'кажу', 'говор', 'persuade', 'convince', 'intimidate', 'ask', 'tell']);
  const isStealth = includesAny(normalizedAction, ['підкра', 'непоміт', 'тихо', 'ззаду', 'хова', 'stealth', 'sneak', 'behind', 'hide']);
  const isAttack = includesAny(normalizedAction, ['атак', 'вдар', 'бʼю', "б'ю", 'ріж', 'удар', 'kill', 'attack', 'stab', 'slash', 'cut']);
  const isMobility = includesAny(normalizedAction, ['стриб', 'лізу', 'тіка', 'біжу', 'перелаз', 'підбіга', 'jump', 'climb', 'run', 'escape', 'dash']);
  const isMagic = includesAny(normalizedAction, ['чакл', 'магі', 'заклин', 'spell', 'magic', 'cast']);
  const isItemUse = includesAny(normalizedAction, ['використ', 'кидаю', 'ставлю', 'запалюю', 'беру', 'use', 'throw', 'light', 'grab']);
  const hasSocialLeverage = includesAny(normalizedAction, [
    'бо ',
    'тому що',
    'наказ',
    'накаже',
    'барон',
    'заплачу',
    'монета',
    'золото',
    'погрож',
    'бреш',
    'клянусь',
    'торг',
    'if',
    'because',
    'order',
    'coin',
    'gold',
    'threat',
    'lie',
    'bargain',
  ]);

  const strongTags = [isSearch, isSocial, isStealth, isAttack, isMobility, isMagic, isItemUse].filter(Boolean).length;
  const hasCompoundFlow = includesAny(normalizedAction, [' і ', ' потім ', ' then ', ' after ', ' afterward ', 'далі ']);

  if (isVague && !targetActor && !itemName && !isSearch) {
    return {
      mode: 'clarify',
      reason: 'vague_action',
      message: buildClarifyMessage(room, 'vague'),
      targetActorId: null,
      itemName: null,
      steps: [],
      gateTriggers: [],
      sceneAxes: [],
    };
  }

  if (isSearch && includesAny(normalizedAction, ['все', 'усе', 'кімнату', 'всю', 'усю', 'everything', 'whole room', 'entire room'])) {
    return {
      mode: 'clarify',
      reason: 'search_scope',
      message: buildClarifyMessage(room, 'search'),
      targetActorId: targetActor?.id ?? null,
      itemName,
      steps: [],
      gateTriggers: [],
      sceneAxes: ['information'],
    };
  }

  if (isSocial && (!targetActor || !hasSocialLeverage)) {
    return {
      mode: 'clarify',
      reason: 'social_missing_target_or_leverage',
      message: buildClarifyMessage(room, 'social'),
      targetActorId: targetActor?.id ?? null,
      itemName: null,
      steps: [],
      gateTriggers: [],
      sceneAxes: ['social_state'],
    };
  }

  if (isItemUse && !itemName && strongTags <= 2) {
    return {
      mode: 'clarify',
      reason: 'item_missing_context',
      message: buildClarifyMessage(room, 'item'),
      targetActorId: targetActor?.id ?? null,
      itemName: null,
      steps: [],
      gateTriggers: [],
      sceneAxes: ['resources'],
    };
  }

  if (isStealth && isAttack) {
    const stealth = createStep(room, 'strict-stealth', 'stealth', isEnglishLanguage(room.language) ? 'Stealth' : 'Скритність', targetActor, itemName);
    const attack = createStep(room, 'strict-attack', 'attack', isEnglishLanguage(room.language) ? 'Attack' : 'Влучання', targetActor, itemName);
    const damage = createStep(room, 'strict-damage', 'damage', isEnglishLanguage(room.language) ? 'Damage' : 'Урон', targetActor, itemName);
    return {
      mode: 'sequence',
      reason: 'stealth_attack_sequence',
      message: formatGatePrompt(room, stealth.step, stealth.frame.stakes),
      targetActorId: targetActor?.id ?? null,
      itemName,
      steps: [stealth.step, attack.step, damage.step],
      gateTriggers: dedupe([...stealth.frame.triggers, ...attack.frame.triggers, ...damage.frame.triggers]),
      sceneAxes: dedupe([stealth.frame.axis, attack.frame.axis, damage.frame.axis]),
    };
  }

  if (strongTags >= 3 || (hasCompoundFlow && strongTags >= 2)) {
    return {
      mode: 'clarify',
      reason: 'compound_action',
      message: buildClarifyMessage(room, 'combo'),
      targetActorId: targetActor?.id ?? null,
      itemName,
      steps: [],
      gateTriggers: [],
      sceneAxes: [],
    };
  }

  if (isAttack) {
    const attack = createStep(room, 'strict-attack', 'attack', isEnglishLanguage(room.language) ? 'Attack' : 'Влучання', targetActor, itemName);
    const damage = createStep(room, 'strict-damage', 'damage', isEnglishLanguage(room.language) ? 'Damage' : 'Урон', targetActor, itemName);
    return {
      mode: 'sequence',
      reason: 'attack_sequence',
      message: formatGatePrompt(room, attack.step, attack.frame.stakes),
      targetActorId: targetActor?.id ?? null,
      itemName,
      steps: [attack.step, damage.step],
      gateTriggers: dedupe([...attack.frame.triggers, ...damage.frame.triggers]),
      sceneAxes: dedupe([attack.frame.axis, damage.frame.axis]),
    };
  }

  if (isSearch) {
    const search = createStep(room, 'strict-perception', 'perception', isEnglishLanguage(room.language) ? 'Perception' : 'Уважність', targetActor, itemName);
    return {
      mode: 'sequence',
      reason: 'search_sequence',
      message: formatGatePrompt(room, search.step, search.frame.stakes),
      targetActorId: targetActor?.id ?? null,
      itemName,
      steps: [search.step],
      gateTriggers: search.frame.triggers,
      sceneAxes: [search.frame.axis],
    };
  }

  if (isSocial) {
    const social = createStep(room, 'strict-social', 'social', isEnglishLanguage(room.language) ? 'Social pressure' : 'Соціальний тиск', targetActor, itemName);
    return {
      mode: 'sequence',
      reason: 'social_sequence',
      message: formatGatePrompt(room, social.step, social.frame.stakes),
      targetActorId: targetActor?.id ?? null,
      itemName,
      steps: [social.step],
      gateTriggers: social.frame.triggers,
      sceneAxes: [social.frame.axis],
    };
  }

  if (isStealth) {
    const stealth = createStep(room, 'strict-stealth', 'stealth', isEnglishLanguage(room.language) ? 'Stealth' : 'Скритність', targetActor, itemName);
    return {
      mode: 'sequence',
      reason: 'stealth_sequence',
      message: formatGatePrompt(room, stealth.step, stealth.frame.stakes),
      targetActorId: targetActor?.id ?? null,
      itemName,
      steps: [stealth.step],
      gateTriggers: stealth.frame.triggers,
      sceneAxes: [stealth.frame.axis],
    };
  }

  if (isMobility) {
    const mobility = createStep(room, 'strict-mobility', 'mobility', isEnglishLanguage(room.language) ? 'Mobility' : 'Спритність', targetActor, itemName);
    return {
      mode: 'sequence',
      reason: 'mobility_sequence',
      message: formatGatePrompt(room, mobility.step, mobility.frame.stakes),
      targetActorId: targetActor?.id ?? null,
      itemName,
      steps: [mobility.step],
      gateTriggers: mobility.frame.triggers,
      sceneAxes: [mobility.frame.axis],
    };
  }

  if (isMagic || isItemUse) {
    const custom = createStep(room, 'strict-custom', 'custom', isEnglishLanguage(room.language) ? 'Custom action' : 'Особлива дія', targetActor, itemName);
    return {
      mode: 'sequence',
      reason: 'custom_sequence',
      message: formatGatePrompt(room, custom.step, custom.frame.stakes),
      targetActorId: targetActor?.id ?? null,
      itemName,
      steps: [custom.step],
      gateTriggers: custom.frame.triggers,
      sceneAxes: [custom.frame.axis],
    };
  }

  return {
    mode: 'immediate',
    reason: 'low_stakes_immediate',
    message: isEnglishLanguage(room.language) ? 'Immediate scene response.' : 'Негайна реакція сцени.',
    targetActorId: targetActor?.id ?? null,
    itemName,
    steps: [],
    gateTriggers: [],
    sceneAxes: ['information'],
  };
}

export function getDeterministicStepFrame(room: Room, step: CheckStep, pendingResolution?: PendingResolution | null) {
  const targetActor = step.targetActorId
    ? room.sceneActors.find((actor) => actor.id === step.targetActorId) ?? null
    : pendingResolution?.targetActorId
      ? room.sceneActors.find((actor) => actor.id === pendingResolution.targetActorId) ?? null
      : null;
  return getStepFrame(room, step.type, targetActor, step.itemName ?? pendingResolution?.itemName ?? null);
}

export function buildSceneDeltaFromCheck({
  room,
  currentStep,
  outcome,
  consequence,
  updatedSceneActors,
  continueSequence,
}: {
  room: Room;
  currentStep: CheckStep;
  outcome: CheckOutcome;
  consequence: string;
  updatedSceneActors: SceneActor[];
  continueSequence: boolean;
}): SceneDelta {
  const frame = getDeterministicStepFrame(room, currentStep, room.pendingResolution);
  const targetActor = currentStep.targetActorId
    ? updatedSceneActors.find((actor) => actor.id === currentStep.targetActorId)
      ?? room.sceneActors.find((actor) => actor.id === currentStep.targetActorId)
      ?? null
    : null;
  const activeLocation = targetActor?.currentLocation ?? room.memory.activeLocation ?? null;
  const threatEscalated = outcome === 'fail' || (currentStep.type === 'damage' && outcome !== 'strong_pass');
  const nextActor = continueSequence
    ? (isEnglishLanguage(room.language) ? 'The acting player continues the check chain.' : 'Той самий гравець продовжує ланцюг перевірок.')
    : (isEnglishLanguage(room.language) ? 'The GM resolves the new scene state.' : 'Майстер фіксує новий стан сцени.');
  const pressure = threatEscalated
    ? (isEnglishLanguage(room.language)
      ? `Pressure rises around ${targetActor?.name ?? 'the scene'} after the ${currentStep.label.toLowerCase()} check.`
      : `Тиск у сцені зростає навколо ${targetActor?.name ?? 'ситуації'} після перевірки "${currentStep.label}".`)
    : (isEnglishLanguage(room.language)
      ? `The scene shifts through ${STRICT_HOST_RULES.sceneAxes.find((axis) => axis.id === frame.axis)?.label ?? frame.axis.toLowerCase()}.`
      : `Сцена зміщується по осі "${STRICT_HOST_RULES.sceneAxes.find((axis) => axis.id === frame.axis)?.label ?? frame.axis}".`);

  const openThreads = dedupe([
    pressure,
    outcome === 'mixed'
      ? (isEnglishLanguage(room.language)
        ? 'The gain holds, but the scene still carries an open cost.'
        : 'Виграш спрацьовує, але сцена лишає відкриту ціну.')
      : '',
    targetActor
      ? (isEnglishLanguage(room.language)
        ? `${targetActor.name} is now ${targetActor.awareness} and ${targetActor.woundState}.`
        : `${targetActor.name}: уважність ${targetActor.awareness}, стан ${targetActor.woundState}.`)
      : '',
  ].filter(Boolean));

  return {
    axis: frame.axis,
    summary: consequence,
    pressure,
    consequence,
    nextActor,
    activeLocation,
    openThreads,
    actorStateNotes: updatedSceneActors.map((actor) => (
      isEnglishLanguage(room.language)
        ? `${actor.name}: ${actor.awareness}, ${actor.woundState}, ${actor.currentLocation}.`
        : `${actor.name}: уважність ${actor.awareness}, стан ${actor.woundState}, локація ${actor.currentLocation}.`
    )),
  };
}

export function applySceneDeltaToMemory(memory: SessionMemory, sceneDelta: SceneDelta): SessionMemory {
  const canonFacts = dedupe([
    ...memory.canonFacts,
    sceneDelta.consequence,
    ...sceneDelta.actorStateNotes,
  ].filter(Boolean));

  const openThreads = dedupe([
    ...memory.openThreads,
    ...sceneDelta.openThreads,
  ].filter(Boolean));

  return {
    ...memory,
    activeLocation: sceneDelta.activeLocation ?? memory.activeLocation,
    sceneSummary: sceneDelta.summary || memory.sceneSummary,
    canonFacts,
    openThreads,
  };
}

export function formatStrictRulesForPrompt() {
  return STRICT_HOST_RULES.promptRules.map((rule) => `- ${rule}`).join('\n');
}
