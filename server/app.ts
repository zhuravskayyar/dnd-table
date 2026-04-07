import crypto from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import {
  addRollToMemory,
  createInitialSessionMemory,
  mergeSessionMemory,
  synchronizePlayerHooks,
} from '../src/lib/sessionMemory';
import { MAX_PLAYERS_PER_ROOM } from '../src/constants/room';
import type {
  CampaignFilters,
  CheckOutcome,
  CheckStep,
  CreateRoomRequest,
  EvaluateCheckStepDecision,
  JoinRoomRequest,
  Participant,
  PendingResolution,
  PlayerCharacter,
  Room,
  RoomActionRequest,
  RoomMessage,
  RoomRollRequest,
  SceneActor,
  SessionType,
  UpdateCharacterRequest,
} from '../src/types';
import {
  GenerateTextFn,
  evaluateCheckStep,
  generateCharacter,
  generateDmReply,
  generateOpening,
  planActionResolution,
  runConceptGuard,
  updateMemory,
} from './roomAi';
import {
  generateImage,
  generateParallelText,
  generateServerText,
  generateTextWithMetadata,
  getAiServiceStatus,
  synthesizeSpeech,
} from './aiGateway';
import { RoomStore } from './roomStore';
import { applySceneDeltaToMemory, classifyPlayerAction } from './strictHost';

const filtersSchema = z.object({
  setting: z.string().min(1),
  tone: z.string().min(1),
  structure: z.string().min(1),
  combatIntensity: z.string().min(1),
  magicLevel: z.string().min(1),
  darknessLevel: z.string().min(1),
  worldConcept: z.string().max(2000).default(''),
});

const inventoryItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  description: z.string().min(1),
  kind: z.string().min(1),
});

const playerCharacterSchema = z.object({
  playerId: z.string().min(1),
  displayName: z.string().min(1),
  bioSummary: z.string().min(1),
  backstory: z.string().min(1),
  motivation: z.string().min(1),
  classFantasy: z.string().min(1),
  inventory: z.array(inventoryItemSchema),
});

const createRoomRequestSchema = z.object({
  hostName: z.string().min(1),
  title: z.string().min(1),
  language: z.string().min(1),
  filters: filtersSchema,
  sessionType: z.enum(['Один постріл', 'Коротка', 'Довга']),
});

const joinRoomRequestSchema = z.object({
  roomCode: z.string().min(1),
  displayName: z.string().min(1),
});

const participantOnlySchema = z.object({
  participantId: z.string().min(1),
});

const updateCharacterRequestSchema = z.object({
  participantId: z.string().min(1),
  character: playerCharacterSchema,
});

const roomActionRequestSchema = z.object({
  participantId: z.string().min(1),
  content: z.string().min(1),
});

const roomRollRequestSchema = z.object({
  participantId: z.string().min(1),
});

const textRequestSchema = z.object({
  prompt: z.string().min(1),
  systemPrompt: z.string().min(1),
  model: z.string().min(1).optional(),
});

const parallelTextRequestSchema = z.object({
  prompts: z.array(z.string().min(1)).min(1).max(12),
  systemPrompt: z.string().min(1),
  model: z.string().min(1).optional(),
});

const imageRequestSchema = z.object({
  prompt: z.string().min(1),
  systemPrompt: z.string().optional(),
  model: z.string().min(1).optional(),
  aspectRatio: z.string().min(1).optional(),
  imageSize: z.string().min(1).optional(),
});

const ttsRequestSchema = z.object({
  input: z.string().min(1),
  voice: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  responseFormat: z.enum(['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm']).optional(),
  speed: z.number().min(0.25).max(4).optional(),
});

function createParticipant(role: 'host' | 'player', displayName: string): Participant {
  return {
    id: crypto.randomUUID(),
    role,
    displayName,
    joinedAt: new Date().toISOString(),
  };
}

function createMessage({
  authorType,
  authorId,
  authorName,
  content,
  actionId,
  rollId,
}: {
  authorType: RoomMessage['authorType'];
  authorId: string;
  authorName: string;
  content: string;
  actionId?: string;
  rollId?: string;
}): RoomMessage {
  return {
    id: crypto.randomUUID(),
    authorType,
    authorId,
    authorName,
    content,
    createdAt: new Date().toISOString(),
    actionId,
    rollId,
  };
}

function createSceneActorsFromCampaign(room: Room, campaign: Awaited<ReturnType<typeof generateOpening>>): SceneActor[] {
  return campaign.npcs.map((npc) => ({
    id: crypto.randomUUID(),
    name: npc.name,
    kind: 'npc',
    role: npc.role,
    currentLocation: room.memory.activeLocation ?? 'Opening scene',
    awareness: 'unaware',
    woundState: 'healthy',
    disposition: npc.description,
    notes: npc.description,
  }));
}

function touchRoom(room: Room) {
  room.updatedAt = new Date().toISOString();
}

function appendMessage(room: Room, message: RoomMessage) {
  room.messages.push(message);
  touchRoom(room);
}

function findRoomOrSend404(store: RoomStore, roomCode: string, res: express.Response) {
  const room = store.get(roomCode.toUpperCase());
  if (!room) {
    res.status(404).json({ error: { message: 'Room not found.' } });
    return null;
  }

  return room;
}

function findParticipantOrSend403(room: Room, participantId: string, res: express.Response) {
  const participant = room.participants.find((entry) => entry.id === participantId);
  if (!participant) {
    res.status(403).json({ error: { message: 'Participant does not belong to this room.' } });
    return null;
  }

  return participant;
}

function assertRoleOrSend403(
  participant: Participant,
  role: Participant['role'],
  res: express.Response,
) {
  if (participant.role !== role) {
    res.status(403).json({ error: { message: `Only ${role} can perform this action.` } });
    return false;
  }

  return true;
}

function handleValidationError(error: z.ZodError, res: express.Response) {
  res.status(400).json({
    error: {
      message: error.issues[0]?.message ?? 'Invalid request payload.',
    },
  });
}

function isInvalidModelJsonError(error: unknown) {
  return error instanceof z.ZodError
    || error instanceof SyntaxError
    || (error instanceof Error && error.message === 'Text AI did not return JSON.');
}

function getCharacterByPlayerId(room: Room, playerId: string) {
  return room.characters.find((character) => character.playerId === playerId) ?? null;
}

function updateRoomMemory(room: Room, nextMemory: Room['memory']) {
  room.memory = synchronizePlayerHooks(nextMemory, room.characters);
  touchRoom(room);
}

function mergeSceneActors(current: SceneActor[], incoming: SceneActor[]) {
  if (incoming.length === 0) {
    return current;
  }

  const orderedIds = current.map((actor) => actor.id);
  const mergedById = new Map<string, SceneActor>();

  for (const actor of current) {
    mergedById.set(actor.id, actor);
  }

  for (const actor of incoming) {
    const previous = mergedById.get(actor.id);
    mergedById.set(actor.id, previous ? { ...previous, ...actor } : actor);
  }

  const existing = orderedIds
    .map((id) => mergedById.get(id))
    .filter((actor): actor is SceneActor => Boolean(actor));

  const appended = Array.from(mergedById.values()).filter((actor) => !orderedIds.includes(actor.id));
  return [...existing, ...appended];
}

function getCurrentCheck(pendingResolution: PendingResolution | null) {
  if (!pendingResolution) {
    return null;
  }

  return pendingResolution.steps[pendingResolution.currentStepIndex] ?? null;
}

function shouldContinueSequence(step: CheckStep, evaluation: EvaluateCheckStepDecision, hasMoreSteps: boolean) {
  if (!hasMoreSteps) {
    return false;
  }

  if (step.type === 'damage') {
    return false;
  }

  if ((step.type === 'stealth' || step.type === 'attack') && evaluation.resolvedCheck.outcome === 'fail') {
    return false;
  }

  return evaluation.continueSequence;
}

function normalizeSteps(steps: CheckStep[], defaults: { targetActorId?: string | null; itemName?: string | null }) {
  return steps.map((step) => ({
    ...step,
    die: 'd20' as const,
    targetActorId: step.targetActorId ?? defaults.targetActorId ?? null,
    itemName: step.itemName ?? defaults.itemName ?? null,
  }));
}

async function maybeRefreshMemory({
  generateText,
  room,
  assistantReply,
  resolvedChecks = [],
  sceneDelta = null,
}: {
  generateText: GenerateTextFn;
  room: Room;
  assistantReply: string;
  resolvedChecks?: PendingResolution['resolvedChecks'];
  sceneDelta?: EvaluateCheckStepDecision['sceneDelta'] | null;
}) {
  const baseMemory = sceneDelta ? applySceneDeltaToMemory(room.memory, sceneDelta) : room.memory;

  try {
    const candidateMemory = await updateMemory({
      generateText,
      room: sceneDelta ? { ...room, memory: baseMemory } : room,
      assistantReply,
      resolvedChecks,
      sceneDelta,
    });
    updateRoomMemory(room, mergeSessionMemory(baseMemory, candidateMemory));
  } catch (error) {
    if (isInvalidModelJsonError(error)) {
      if (sceneDelta) {
        updateRoomMemory(room, baseMemory);
      }
      console.warn('Memory update returned invalid JSON; keeping previous room memory.');
      return;
    }

    console.error('Memory update failed:', error);
  }
}

async function resolveImmediateAction({
  generateText,
  room,
}: {
  generateText: GenerateTextFn;
  room: Room;
}) {
  const reply = await generateDmReply({
    generateText,
    room,
    resolvedChecks: [],
  });

  appendMessage(room, createMessage({
    authorType: 'dm',
    authorId: 'dm',
    authorName: 'Майстер',
    content: reply,
  }));

  await maybeRefreshMemory({
    generateText,
    room,
    assistantReply: reply,
  });
}

type MaybePromise<T> = T | Promise<T>;

export function createApp({
  generateText = generateServerText,
  generatePromptText = generateTextWithMetadata,
  generateParallelPromptText = generateParallelText,
  generatePromptImage = generateImage,
  generateSpeech = synthesizeSpeech,
  getAiStatus = getAiServiceStatus,
  roomStore = new RoomStore(),
  rollD20 = () => Math.floor(Math.random() * 20) + 1,
}: {
  generateText?: GenerateTextFn;
  generatePromptText?: typeof generateTextWithMetadata;
  generateParallelPromptText?: typeof generateParallelText;
  generatePromptImage?: typeof generateImage;
  generateSpeech?: typeof synthesizeSpeech;
  getAiStatus?: () => MaybePromise<Awaited<ReturnType<typeof getAiServiceStatus>>>;
  roomStore?: RoomStore;
  rollD20?: () => number;
} = {}) {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/ai/status', async (_req, res) => {
    try {
      const status = await Promise.resolve(getAiStatus());
      res.json({ status });
    } catch (error) {
      console.error('AI status check failed:', error);
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Failed to load AI status.',
        },
      });
    }
  });

  app.post('/api/ai/text', async (req, res) => {
    const parsed = textRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      handleValidationError(parsed.error, res);
      return;
    }

    try {
      const result = await generatePromptText(parsed.data);
      res.json(result);
    } catch (error) {
      console.error('Text generation failed:', error);
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Failed to contact the text AI provider.',
        },
      });
    }
  });

  app.post('/api/ai/text/parallel', async (req, res) => {
    const parsed = parallelTextRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      handleValidationError(parsed.error, res);
      return;
    }

    try {
      const results = await generateParallelPromptText(parsed.data);
      res.json({ results });
    } catch (error) {
      console.error('Parallel text generation failed:', error);
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Failed to run prompts in parallel.',
        },
      });
    }
  });

  app.post('/api/ai/image', async (req, res) => {
    const parsed = imageRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      handleValidationError(parsed.error, res);
      return;
    }

    try {
      const result = await generatePromptImage(parsed.data);
      res.json(result);
    } catch (error) {
      console.error('Image generation failed:', error);
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Failed to generate image.',
        },
      });
    }
  });

  app.post('/api/ai/tts', async (req, res) => {
    const parsed = ttsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      handleValidationError(parsed.error, res);
      return;
    }

    try {
      const result = await generateSpeech(parsed.data);
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
      res.setHeader('X-AI-Provider', result.metadata.provider);
      res.setHeader('X-AI-Model', result.metadata.model);
      res.setHeader('X-AI-Voice', result.metadata.voice);
      res.setHeader('X-AI-Duration-Ms', String(result.metadata.durationMs));
      res.setHeader('X-AI-Format', result.metadata.format);
      res.send(result.audioBuffer);
    } catch (error) {
      console.error('Speech synthesis failed:', error);
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Failed to synthesize speech.',
        },
      });
    }
  });

  app.post('/api/rooms', async (req, res) => {
    const parsed = createRoomRequestSchema.safeParse(req.body satisfies CreateRoomRequest);
    if (!parsed.success) {
      handleValidationError(parsed.error, res);
      return;
    }

    const host = createParticipant('host', parsed.data.hostName.trim());
    const room = roomStore.createRoom({
      host,
      title: parsed.data.title.trim(),
      language: parsed.data.language.trim(),
      filters: parsed.data.filters as CampaignFilters,
      sessionType: parsed.data.sessionType as SessionType,
    });

    appendMessage(room, createMessage({
      authorType: 'system',
      authorId: 'system',
      authorName: 'Система',
      content: `Кімнату ${room.roomCode} створено. Host ${host.displayName} очікує гравців.`,
    }));

    res.status(201).json({
      roomCode: room.roomCode,
      participantId: host.id,
      role: 'host',
      room,
    });
  });

  app.post('/api/rooms/join', async (req, res) => {
    const parsed = joinRoomRequestSchema.safeParse(req.body satisfies JoinRoomRequest);
    if (!parsed.success) {
      handleValidationError(parsed.error, res);
      return;
    }

    const room = findRoomOrSend404(roomStore, parsed.data.roomCode, res);
    if (!room) {
      return;
    }

    if (room.state !== 'lobby') {
      res.status(409).json({ error: { message: 'The game has already started.' } });
      return;
    }

    const displayName = parsed.data.displayName.trim();
    if (!displayName) {
      res.status(400).json({ error: { message: 'Display name is required.' } });
      return;
    }

    const playerCount = room.participants.filter((participant) => participant.role === 'player').length;

    if (playerCount >= MAX_PLAYERS_PER_ROOM) {
      res.status(409).json({
        error: {
          message: `This room is full. The maximum is ${MAX_PLAYERS_PER_ROOM} players.`,
        },
      });
      return;
    }

    const duplicateName = room.participants.some((participant) => (
      participant.role === 'player'
      && participant.displayName.trim().toLowerCase() === displayName.toLowerCase()
    ));
    if (duplicateName) {
      res.status(409).json({
        error: {
          message: 'A player with this name is already in the room. Choose a different display name.',
        },
      });
      return;
    }

    const participant = createParticipant('player', displayName);

    try {
      const character = await generateCharacter({
        generateText,
        room,
        playerId: participant.id,
        displayName: participant.displayName,
      });

      roomStore.addParticipant(room.roomCode, participant);
      roomStore.addCharacter(room.roomCode, character);
      appendMessage(room, createMessage({
        authorType: 'system',
        authorId: 'system',
        authorName: 'Система',
        content: `${participant.displayName} увійшов до кімнати.`,
      }));

      res.status(201).json({
        participantId: participant.id,
        role: 'player',
        room,
      });
    } catch (error) {
      console.error('Character generation failed:', error);
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Failed to generate character.',
        },
      });
    }
  });

  app.get('/api/rooms/:roomCode/state', (req, res) => {
    const participantId = z.string().min(1).safeParse(req.query.participantId);
    if (!participantId.success) {
      handleValidationError(participantId.error, res);
      return;
    }

    const room = findRoomOrSend404(roomStore, req.params.roomCode, res);
    if (!room) {
      return;
    }

    const participant = findParticipantOrSend403(room, participantId.data, res);
    if (!participant) {
      return;
    }

    res.json({ room });
  });

  app.patch('/api/rooms/:roomCode/characters/:playerId', (req, res) => {
    const parsed = updateCharacterRequestSchema.safeParse(req.body satisfies UpdateCharacterRequest);
    if (!parsed.success) {
      handleValidationError(parsed.error, res);
      return;
    }

    const room = findRoomOrSend404(roomStore, req.params.roomCode, res);
    if (!room) {
      return;
    }

    const participant = findParticipantOrSend403(room, parsed.data.participantId, res);
    if (!participant || !assertRoleOrSend403(participant, 'host', res)) {
      return;
    }

    if (room.state !== 'lobby') {
      res.status(409).json({ error: { message: 'Characters can only be edited in the lobby.' } });
      return;
    }

    if (parsed.data.character.playerId !== req.params.playerId) {
      res.status(400).json({ error: { message: 'Player id mismatch.' } });
      return;
    }

    const characterIndex = room.characters.findIndex((entry) => entry.playerId === req.params.playerId);
    if (characterIndex === -1) {
      res.status(404).json({ error: { message: 'Character not found.' } });
      return;
    }

    room.characters[characterIndex] = parsed.data.character as PlayerCharacter;
    touchRoom(room);
    appendMessage(room, createMessage({
      authorType: 'system',
      authorId: 'system',
      authorName: 'Система',
      content: `Host оновив лист персонажа ${parsed.data.character.displayName}.`,
    }));

    res.json({ room });
  });

  app.post('/api/rooms/:roomCode/start', async (req, res) => {
    const parsed = participantOnlySchema.safeParse(req.body);
    if (!parsed.success) {
      handleValidationError(parsed.error, res);
      return;
    }

    const room = findRoomOrSend404(roomStore, req.params.roomCode, res);
    if (!room) {
      return;
    }

    const participant = findParticipantOrSend403(room, parsed.data.participantId, res);
    if (!participant || !assertRoleOrSend403(participant, 'host', res)) {
      return;
    }

    if (room.state !== 'lobby') {
      res.status(409).json({ error: { message: 'The room is not in lobby state.' } });
      return;
    }

    if (room.characters.length === 0) {
      res.status(409).json({ error: { message: 'At least one player must join before the game starts.' } });
      return;
    }

    try {
      const campaign = await generateOpening({
        generateText,
        room,
      });

      room.state = 'in_game';
      updateRoomMemory(room, createInitialSessionMemory(campaign, room.characters));
      room.sceneActors = createSceneActorsFromCampaign(room, campaign);
      room.pendingResolution = null;
      touchRoom(room);
      appendMessage(room, createMessage({
        authorType: 'system',
        authorId: 'system',
        authorName: 'Система',
        content: 'Гру запущено. Майстер відкриває першу сцену.',
      }));
      appendMessage(room, createMessage({
        authorType: 'dm',
        authorId: 'dm',
        authorName: 'Майстер',
        content: campaign.openingScene,
      }));

      res.json({ room });
    } catch (error) {
      console.error('Failed to start room:', error);
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Failed to start game.',
        },
      });
    }
  });

  app.post('/api/rooms/:roomCode/actions', async (req, res) => {
    const parsed = roomActionRequestSchema.safeParse(req.body satisfies RoomActionRequest);
    if (!parsed.success) {
      handleValidationError(parsed.error, res);
      return;
    }

    const room = findRoomOrSend404(roomStore, req.params.roomCode, res);
    if (!room) {
      return;
    }

    const participant = findParticipantOrSend403(room, parsed.data.participantId, res);
    if (!participant || !assertRoleOrSend403(participant, 'player', res)) {
      return;
    }

    if (room.state !== 'in_game') {
      res.status(409).json({ error: { message: 'The game has not started yet.' } });
      return;
    }

    if (room.pendingResolution) {
      res.status(409).json({ error: { message: 'Finish the current check sequence before sending a new action.' } });
      return;
    }

    const character = getCharacterByPlayerId(room, participant.id);
    if (!character) {
      res.status(404).json({ error: { message: 'Character not found for this player.' } });
      return;
    }

    const actionId = crypto.randomUUID();
    const actionText = parsed.data.content.trim();
    const playerMessage = createMessage({
      authorType: 'player',
      authorId: participant.id,
      authorName: participant.displayName,
      content: actionText,
      actionId,
    });

    const simulationRoom: Room = {
      ...room,
      messages: [...room.messages, playerMessage],
    };

    try {
      const strictDecision = classifyPlayerAction({
        room: simulationRoom,
        character,
        action: actionText,
      });

      if (strictDecision.mode === 'blocked' || strictDecision.mode === 'clarify') {
        appendMessage(room, playerMessage);
        appendMessage(room, createMessage({
          authorType: 'dm',
          authorId: 'dm',
          authorName: 'Майстер',
          content: strictDecision.message,
          actionId,
        }));
        res.json({ room });
        return;
      }

      const conceptDecision = await runConceptGuard({
        generateText,
        room: simulationRoom,
        character,
        action: actionText,
      });

      if (conceptDecision.result === 'blocked') {
        appendMessage(room, playerMessage);
        appendMessage(room, createMessage({
          authorType: 'dm',
          authorId: 'dm',
          authorName: 'Майстер',
          content: conceptDecision.explanation,
          actionId,
        }));
        res.json({ room });
        return;
      }

      appendMessage(room, playerMessage);

      if (strictDecision.mode === 'immediate') {
        await resolveImmediateAction({
          generateText,
          room,
        });
        res.json({ room });
        return;
      }

      const actionPlan = await planActionResolution({
        generateText,
        room: simulationRoom,
        character,
        action: actionText,
        deterministicDecision: strictDecision,
      });

      if (actionPlan.mode === 'blocked' || actionPlan.mode === 'clarify') {
        appendMessage(room, createMessage({
          authorType: 'dm',
          authorId: 'dm',
          authorName: 'Майстер',
          content: actionPlan.message,
          actionId,
        }));
        res.json({ room });
        return;
      }

      if (actionPlan.mode === 'immediate') {
        await resolveImmediateAction({
          generateText,
          room,
        });
        res.json({ room });
        return;
      }

      const steps = normalizeSteps(actionPlan.steps ?? [], {
        targetActorId: actionPlan.targetActorId,
        itemName: actionPlan.itemName,
      });

      room.pendingResolution = {
        actionId,
        playerId: participant.id,
        actionText,
        targetActorId: actionPlan.targetActorId ?? null,
        itemName: actionPlan.itemName ?? null,
        steps,
        currentStepIndex: 0,
        resolvedChecks: [],
        createdAt: new Date().toISOString(),
      };
      touchRoom(room);

      appendMessage(room, createMessage({
        authorType: 'dm',
        authorId: 'dm',
        authorName: 'Майстер',
        content: actionPlan.message,
        actionId,
      }));

      res.json({ room });
    } catch (error) {
      console.error('Failed to resolve player action:', error);
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Failed to resolve action.',
        },
      });
    }
  });

  app.post('/api/rooms/:roomCode/roll', async (req, res) => {
    const parsed = roomRollRequestSchema.safeParse(req.body satisfies RoomRollRequest);
    if (!parsed.success) {
      handleValidationError(parsed.error, res);
      return;
    }

    const room = findRoomOrSend404(roomStore, req.params.roomCode, res);
    if (!room) {
      return;
    }

    const participant = findParticipantOrSend403(room, parsed.data.participantId, res);
    if (!participant || !assertRoleOrSend403(participant, 'player', res)) {
      return;
    }

    if (!room.pendingResolution) {
      res.status(409).json({ error: { message: 'There is no active check sequence for this room.' } });
      return;
    }

    if (room.pendingResolution.playerId !== participant.id) {
      res.status(409).json({ error: { message: 'Only the targeted player can resolve this check sequence.' } });
      return;
    }

    const character = getCharacterByPlayerId(room, participant.id);
    if (!character) {
      res.status(404).json({ error: { message: 'Character not found for this player.' } });
      return;
    }

    const currentStep = getCurrentCheck(room.pendingResolution);
    if (!currentStep) {
      res.status(409).json({ error: { message: 'The current check sequence is malformed.' } });
      return;
    }

    const rollId = crypto.randomUUID();
    const rollResult = rollD20();

    appendMessage(room, createMessage({
      authorType: 'system',
      authorId: 'system',
      authorName: 'Система',
      content: `${participant.displayName} кидає ${currentStep.die} на ${currentStep.label}: ${rollResult}.`,
      actionId: room.pendingResolution.actionId,
      rollId,
    }));

    try {
      const evaluation = await evaluateCheckStep({
        generateText,
        room,
        character,
        pendingResolution: room.pendingResolution,
        currentStep,
        rollResult,
      });

      room.memory = addRollToMemory(room.memory, {
        kind: currentStep.type,
        result: rollResult,
        consequence: evaluation.resolvedCheck.consequence,
      });
      room.sceneActors = mergeSceneActors(room.sceneActors, evaluation.updatedSceneActors);

      const nextResolvedChecks = [...room.pendingResolution.resolvedChecks, evaluation.resolvedCheck];
      const hasMoreSteps = room.pendingResolution.currentStepIndex < room.pendingResolution.steps.length - 1;

      appendMessage(room, createMessage({
        authorType: 'dm',
        authorId: 'dm',
        authorName: 'Майстер',
        content: evaluation.dmText,
        actionId: room.pendingResolution.actionId,
        rollId,
      }));

      if (shouldContinueSequence(currentStep, evaluation, hasMoreSteps)) {
        room.pendingResolution = {
          ...room.pendingResolution,
          currentStepIndex: room.pendingResolution.currentStepIndex + 1,
          resolvedChecks: nextResolvedChecks,
        };
        touchRoom(room);
        res.json({ room });
        return;
      }

      room.pendingResolution = null;
      touchRoom(room);

      await maybeRefreshMemory({
        generateText,
        room,
        assistantReply: evaluation.dmText,
        resolvedChecks: nextResolvedChecks,
        sceneDelta: evaluation.sceneDelta,
      });

      res.json({ room });
    } catch (error) {
      console.error('Failed to resolve check sequence:', error);
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Failed to resolve check sequence.',
        },
      });
    }
  });

  return app;
}
