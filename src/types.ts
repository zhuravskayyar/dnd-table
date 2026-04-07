import type { SceneAxis } from './constants/hostRules';

export type SessionType = 'Один постріл' | 'Коротка' | 'Довга';
export type RoomState = 'lobby' | 'in_game' | 'closed';
export type ParticipantRole = 'host' | 'player';
export type MessageAuthorType = 'host' | 'player' | 'dm' | 'system';
export type ConceptGuardResult = 'allowed' | 'blocked' | 'requires_roll';
export type ActionPlanMode = 'blocked' | 'clarify' | 'immediate' | 'sequence';
export type CheckType = 'stealth' | 'attack' | 'damage' | 'perception' | 'social' | 'mobility' | 'magic' | 'custom';
export type CheckOutcome = 'fail' | 'mixed' | 'pass' | 'strong_pass';
export type SceneActorKind = 'npc' | 'monster';
export type SceneActorAwareness = 'unaware' | 'suspicious' | 'alerted' | 'engaged';
export type WoundState = 'healthy' | 'wounded' | 'critical' | 'dead';

export type CampaignFilters = {
  setting: string;
  tone: string;
  structure: string;
  combatIntensity: string;
  magicLevel: string;
  darknessLevel: string;
  worldConcept: string;
};

export type InventoryItem = {
  name: string;
  quantity: number;
  description: string;
  kind: string;
};

export type PlayerCharacter = {
  playerId: string;
  displayName: string;
  bioSummary: string;
  backstory: string;
  motivation: string;
  classFantasy: string;
  inventory: InventoryItem[];
};

export type Participant = {
  id: string;
  role: ParticipantRole;
  displayName: string;
  joinedAt: string;
};

export type GeneratedNpc = {
  name: string;
  description: string;
  role: string;
};

export type GeneratedPlayerStartHook = {
  playerId: string;
  displayName: string;
  cue: string;
};

export type GeneratedCampaign = {
  synopsis: string;
  openingScene: string;
  conflicts: string[];
  npcs: GeneratedNpc[];
  playerStartHooks: GeneratedPlayerStartHook[];
};

export type NpcState = {
  name: string;
  role: string;
  disposition: string;
  goal: string;
  lastSeen: string | null;
};

export type RollRecord = {
  kind: string;
  result: number;
  consequence: string;
};

export type SessionMemory = {
  campaignSummary: string;
  sceneSummary: string;
  activeLocation: string | null;
  canonFacts: string[];
  openThreads: string[];
  activeNpcs: NpcState[];
  playerHooks: string[];
  recentRolls: RollRecord[];
  lastUpdatedTurn: number;
};

export type RoomMessage = {
  id: string;
  authorType: MessageAuthorType;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
  actionId?: string;
  rollId?: string;
};

export type CheckStep = {
  id: string;
  type: CheckType;
  label: string;
  stakes: string;
  die: 'd20';
  targetActorId?: string | null;
  itemName?: string | null;
};

export type ResolvedCheck = {
  stepId: string;
  type: CheckType;
  result: number;
  outcome: CheckOutcome;
  consequence: string;
};

export type PendingResolution = {
  actionId: string;
  playerId: string;
  actionText: string;
  targetActorId?: string | null;
  itemName?: string | null;
  steps: CheckStep[];
  currentStepIndex: number;
  resolvedChecks: ResolvedCheck[];
  createdAt: string;
};

export type SceneActor = {
  id: string;
  name: string;
  kind: SceneActorKind;
  role: string;
  currentLocation: string;
  awareness: SceneActorAwareness;
  woundState: WoundState;
  disposition: string;
  notes: string;
};

export type PlayerAction = {
  id: string;
  playerId: string;
  content: string;
  createdAt: string;
  status: 'blocked' | 'clarification_requested' | 'awaiting_checks' | 'resolved_success' | 'resolved_failure';
};

export type Room = {
  roomCode: string;
  hostId: string;
  state: RoomState;
  title: string;
  language: string;
  filters: CampaignFilters;
  sessionType: SessionType;
  participants: Participant[];
  characters: PlayerCharacter[];
  messages: RoomMessage[];
  memory: SessionMemory;
  sceneActors: SceneActor[];
  pendingResolution: PendingResolution | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateRoomRequest = {
  hostName: string;
  title: string;
  language: string;
  filters: CampaignFilters;
  sessionType: SessionType;
};

export type CreateRoomResponse = {
  roomCode: string;
  participantId: string;
  role: 'host';
  room: Room;
};

export type JoinRoomRequest = {
  roomCode: string;
  displayName: string;
};

export type JoinRoomResponse = {
  participantId: string;
  role: 'player';
  room: Room;
};

export type RoomStateResponse = {
  room: Room;
};

export type UpdateCharacterRequest = {
  participantId: string;
  character: PlayerCharacter;
};

export type RoomActionRequest = {
  participantId: string;
  content: string;
};

export type RoomRollRequest = {
  participantId: string;
};

export type GenerateCharacterResult = PlayerCharacter;

export type ConceptGuardDecision = {
  result: Extract<ConceptGuardResult, 'allowed' | 'blocked'>;
  explanation: string;
};

export type ActionPlanDecision = {
  mode: ActionPlanMode;
  message: string;
  targetActorId?: string | null;
  itemName?: string | null;
  steps?: CheckStep[];
};

export type EvaluateCheckStepDecision = {
  resolvedCheck: ResolvedCheck;
  continueSequence: boolean;
  updatedSceneActors: SceneActor[];
  dmText: string;
  sceneDelta: SceneDelta;
};

export type SceneDelta = {
  axis: SceneAxis;
  summary: string;
  pressure: string;
  consequence: string;
  nextActor: string;
  activeLocation: string | null;
  openThreads: string[];
  actorStateNotes: string[];
};

export type AiTextProvider = 'nvidia';
export type AiImageProvider = 'openrouter';
export type AiTtsProvider = 'edge-tts';

export type AiServiceStatus = {
  textProvider: AiTextProvider | 'unconfigured';
  textModel: string | null;
  imageProvider: AiImageProvider | null;
  imageModel: string | null;
  ttsProvider: AiTtsProvider | null;
  ttsBaseUrl: string | null;
  ttsDefaultVoice: string | null;
  ttsReachable: boolean;
  ttsStatusMessage: string | null;
  parallelKeyCount: number;
};

export type AiTextRequest = {
  prompt: string;
  systemPrompt: string;
  model?: string;
};

export type AiTextResponse = {
  text: string;
  model: string;
  provider: AiTextProvider;
  durationMs: number;
  keySlot: number | null;
};

export type AiParallelTextRequest = {
  prompts: string[];
  systemPrompt: string;
  model?: string;
};

export type AiParallelTextJobResult = {
  id: string;
  prompt: string;
  status: 'success' | 'error';
  text: string | null;
  error: string | null;
  model: string;
  provider: AiTextProvider | null;
  durationMs: number;
  keySlot: number | null;
};

export type AiParallelTextResponse = {
  results: AiParallelTextJobResult[];
};

export type AiImageRequest = {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
};

export type AiImageResponse = {
  images: string[];
  text: string;
  model: string;
  provider: AiImageProvider;
  durationMs: number;
  keySlot: number | null;
};

export type AiTtsFormat = 'mp3' | 'wav' | 'opus' | 'aac' | 'flac' | 'pcm';

export type AiTtsRequest = {
  input: string;
  voice?: string;
  model?: string;
  responseFormat?: AiTtsFormat;
  speed?: number;
};

export type AiTtsMetadata = {
  provider: AiTtsProvider;
  model: string;
  voice: string;
  durationMs: number;
  format: AiTtsFormat;
};

export type AiStatusResponse = {
  status: AiServiceStatus;
};
