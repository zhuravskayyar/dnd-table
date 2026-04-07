export type StrictActionClassification = 'impossible' | 'clarify' | 'immediate' | 'sequence';
export type GateTrigger = 'risk' | 'advantage' | 'control' | 'harm' | 'resource' | 'social_shift';
export type StakesField = 'success' | 'cost' | 'fail';
export type SceneAxis = 'position' | 'information' | 'threat' | 'resources' | 'social_state';
export type HostResponseTemplateField =
  | 'world_state'
  | 'action_reaction'
  | 'gate_or_stakes'
  | 'consequence'
  | 'next_actor';

export type HostUiTerminology = {
  activeCheckTitle: string;
  stakesLabel: string;
  consequenceLabel: string;
  nextActorLabel: string;
  historyTitle: string;
  codexTitle: string;
  checklistTitle: string;
};

export type HostRuleSet = {
  coreRules: string[];
  hostCodex: string[];
  operationalChecklist: string[];
  classificationModes: StrictActionClassification[];
  gateTriggers: GateTrigger[];
  requiredStakes: StakesField[];
  sceneAxes: Array<{ id: SceneAxis; label: string }>;
  responseTemplate: Array<{ id: HostResponseTemplateField; label: string }>;
  promptRules: string[];
  uiTerminology: HostUiTerminology;
};

export const STRICT_HOST_RULES: HostRuleSet = {
  coreRules: [
    'Веди гру в логіці DnD: спочатку намір гравця, потім перевірка, потім наслідок.',
    'Один пост гравця = одна основна дія або одна чітка спроба вплинути на сцену.',
    'Не розігруй успіх наперед. Якщо результат невизначений і є ризик, вимагай d20-перевірку.',
    'Перед кидком завжди оголошуй ставку: що дає успіх, яка ціна навіть при частковому успіху, що станеться при провалі.',
    'Перевага, позиційний бонус, хороший інструмент або сильний план мають відбиватися у художній перевазі сцени, але не скасовують сам ризик.',
    'Провал не означає “нічого не сталося”. Після кидка сцена мусить змінитися: позиція, інформація, загроза, ресурси або соціальний стан.',
    'У бійках, переслідуваннях, скритних атаках, складній магії та соціальному тиску не даруй безкоштовний результат.',
    'Тримай причинно-наслідковий ланцюг. Наслідки не відкочуються без окремої внутрішньоігрової дії.',
    'Поважай інвентар, біографії, відкриті нитки сюжету, попередні сцени та концепт світу як канон.',
    'Коли сумніваєшся, суди як ведучий DnD: чесно, послідовно, з цікавим, але обмеженим простором для героїзму.',
  ],
  hostCodex: [
    'Якщо зрозуміло, що хоче гравець, розігруй дію. Кларифікація — лише якщо фізично неможливо визначити ціль або спосіб.',
    'Огляд місцевості, дослідження оточення, прості рухи — це валідні дії, описуй їх результат.',
    'У ризиковій сцені не дозволяй гравцю одночасно “підійти, обшукати, вбити і втекти” одним постом.',
    'Стелс-ліквідація розкладається щонайменше на підхід, удар і наслідок урону.',
    'Соціальний тиск потребує важеля: статус, брехня, погроза, угода, доказ або емоційний тиск.',
    'Пошук, магія, рух через перешкоду і використання предметів мають або рухати сцену, або коштувати темпу і ресурсу.',
    'У кімнаті може бути тільки одна активна послідовність перевірок.',
    'Після кожної перевірки передай сцену далі: тому ж гравцю, іншому гравцю або світові.',
  ],
  operationalChecklist: [
    'Зафіксуй, де відбувається сцена і хто в ній присутній.',
    'Прочитай пост гравця як декларацію дії, а не як уже здійснений результат.',
    'Визнач тип: неможливо, треба уточнення, негайна реакція або ланцюг перевірок.',
    'Якщо є ризик або значущий виграш, сформулюй d20-перевірку й ставки.',
    'Після результату обовʼязково зміни сцену і онови тиск, інформацію чи позицію.',
    'Зафіксуй новий стан NPC, загроз, ресурсів та відкритих сюжетних ниток.',
    'Поверни хід тому, хто природно має діяти далі за логікою сцени.',
  ],
  classificationModes: ['impossible', 'clarify', 'immediate', 'sequence'],
  gateTriggers: ['risk', 'advantage', 'control', 'harm', 'resource', 'social_shift'],
  requiredStakes: ['success', 'cost', 'fail'],
  sceneAxes: [
    { id: 'position', label: 'Позиція' },
    { id: 'information', label: 'Інформація' },
    { id: 'threat', label: 'Загроза' },
    { id: 'resources', label: 'Ресурси' },
    { id: 'social_state', label: 'Соціальний стан' },
  ],
  responseTemplate: [
    { id: 'world_state', label: 'Фіксація світу' },
    { id: 'action_reaction', label: 'Реакція на дію' },
    { id: 'gate_or_stakes', label: 'Gate / ставка' },
    { id: 'consequence', label: 'Наслідок' },
    { id: 'next_actor', label: 'Передача ходу' },
  ],
  promptRules: [
    'Run the room like a disciplined DnD game master inside a deterministic d20 engine.',
    'Treat one player post as one main declared action, not a bundle of resolved outcomes.',
    'If the outcome is uncertain and the stakes matter, require a d20 gate before narrating success.',
    'State the stakes before the roll: what success gives, what cost still applies, and what failure changes.',
    'Respect established inventory, scene actors, backstories, open threads, and the world concept as canon.',
    'Do not speak for player choices and do not narrate success inside the player intent itself.',
    'Use stealth, attack, damage, perception, social pressure, mobility, and magic as distinct gates when the fiction demands it.',
    'Translate advantage, strong positioning, tools, and leverage into better fictional framing, but do not skip meaningful risk.',
    'After every resolved roll, the scene must change concretely on position, information, threat, resources, or social state.',
    'Failure must still move the story through consequence, exposure, escalation, resource loss, or lost opportunity.',
    'Keep only one active check sequence per room and hand the scene to the next natural actor after resolution.',
    'Prefer concise GM replies that follow: world state -> reaction -> stakes or consequence -> next actor.',
  ],
  uiTerminology: {
    activeCheckTitle: 'Поточна перевірка',
    stakesLabel: 'Ставка',
    consequenceLabel: 'Наслідок',
    nextActorLabel: 'Хто діє далі',
    historyTitle: 'Історія наслідків',
    codexTitle: 'Кодекс ведучого',
    checklistTitle: 'Операційний чекліст',
  },
};
