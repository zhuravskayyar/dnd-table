import { GeneratedCampaign, NpcState, PlayerCharacter, RollRecord, SessionMemory } from '../types';

export const MAX_RECENT_MESSAGES = 12;
export const MAX_RECENT_ROLLS = 5;

export function createEmptySessionMemory(): SessionMemory {
  return {
    campaignSummary: '',
    sceneSummary: '',
    activeLocation: null,
    canonFacts: [],
    openThreads: [],
    activeNpcs: [],
    playerHooks: [],
    recentRolls: [],
    lastUpdatedTurn: 0,
  };
}

function deriveCharacterHooks(characters: PlayerCharacter[]): string[] {
  return characters.flatMap((character) => ([
    `${character.displayName}: ${character.motivation}`,
    `${character.displayName}: ${character.classFantasy}`,
  ]));
}

function deriveOpeningHooks(campaign: GeneratedCampaign): string[] {
  return campaign.playerStartHooks.map((hook) => `${hook.displayName}: ${hook.cue}`);
}

export function derivePlayerHooks(
  characters: PlayerCharacter[],
  openingHooks: string[] = [],
): string[] {
  return Array.from(new Set([
    ...deriveCharacterHooks(characters),
    ...openingHooks,
  ]));
}

export function createInitialSessionMemory(
  campaign: GeneratedCampaign,
  characters: PlayerCharacter[],
): SessionMemory {
  return {
    campaignSummary: campaign.synopsis,
    sceneSummary: campaign.openingScene,
    activeLocation: null,
    canonFacts: [
      campaign.synopsis,
      ...campaign.conflicts,
    ],
    openThreads: campaign.conflicts,
    activeNpcs: campaign.npcs.map((npc) => ({
      name: npc.name,
      role: npc.role,
      disposition: npc.description,
      goal: npc.role,
      lastSeen: 'Початок кампанії',
    })),
    playerHooks: derivePlayerHooks(characters, deriveOpeningHooks(campaign)),
    recentRolls: [],
    lastUpdatedTurn: 0,
  };
}

export function synchronizePlayerHooks(memory: SessionMemory, characters: PlayerCharacter[]): SessionMemory {
  return {
    ...memory,
    playerHooks: derivePlayerHooks(characters, memory.playerHooks),
  };
}

export function addRollToMemory(memory: SessionMemory, roll: RollRecord): SessionMemory {
  return {
    ...memory,
    recentRolls: [...memory.recentRolls, roll].slice(-MAX_RECENT_ROLLS),
  };
}

export function getRecentMessages<T>(messages: T[], maxCount = MAX_RECENT_MESSAGES): T[] {
  return messages.slice(-maxCount);
}

export function mergeSessionMemory(current: SessionMemory, incoming: SessionMemory): SessionMemory {
  return {
    campaignSummary: incoming.campaignSummary,
    sceneSummary: incoming.sceneSummary,
    activeLocation: incoming.activeLocation,
    canonFacts: dedupeStrings([...current.canonFacts, ...incoming.canonFacts]),
    openThreads: dedupeStrings([...current.openThreads, ...incoming.openThreads]),
    activeNpcs: mergeActiveNpcs(current.activeNpcs, incoming.activeNpcs),
    playerHooks: dedupeStrings([...current.playerHooks, ...incoming.playerHooks]),
    recentRolls: mergeRecentRolls(current.recentRolls, incoming.recentRolls),
    lastUpdatedTurn: incoming.lastUpdatedTurn,
  };
}

export function mergeActiveNpcs(current: NpcState[], incoming: NpcState[]): NpcState[] {
  const mergedByName = new Map<string, NpcState>();

  for (const npc of current) {
    mergedByName.set(npc.name, npc);
  }

  for (const npc of incoming) {
    const previous = mergedByName.get(npc.name);
    mergedByName.set(npc.name, previous ? { ...previous, ...npc } : npc);
  }

  return Array.from(mergedByName.values());
}

export function mergeRecentRolls(current: RollRecord[], incoming: RollRecord[]): RollRecord[] {
  const nextRolls = incoming.length > 0 ? incoming : current;
  return nextRolls.slice(-MAX_RECENT_ROLLS);
}

function dedupeStrings(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}
