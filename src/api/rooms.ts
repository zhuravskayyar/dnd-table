import type {
  AiImageRequest,
  AiImageResponse,
  AiParallelTextRequest,
  AiParallelTextResponse,
  AiStatusResponse,
  AiTextRequest,
  AiTextResponse,
  AiTtsMetadata,
  AiTtsRequest,
  CreateRoomRequest,
  CreateRoomResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  Room,
  RoomActionRequest,
  RoomRollRequest,
  RoomStateResponse,
  UpdateCharacterRequest,
} from '../types';

type ApiError = {
  error?: {
    message?: string;
  };
};

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? 'Request failed.');
  }

  return payload;
}

export function shouldReplaceRoom(currentRoom: Room | null, nextRoom: Room) {
  if (!currentRoom) {
    return true;
  }

  return currentRoom.updatedAt !== nextRoom.updatedAt;
}

export function createRoom(request: CreateRoomRequest) {
  return apiRequest<CreateRoomResponse>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function joinRoom(request: JoinRoomRequest) {
  return apiRequest<JoinRoomResponse>('/api/rooms/join', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function fetchRoomState(roomCode: string, participantId: string) {
  return apiRequest<RoomStateResponse>(
    `/api/rooms/${roomCode}/state?participantId=${encodeURIComponent(participantId)}`,
  );
}

export function saveCharacter(roomCode: string, request: UpdateCharacterRequest) {
  return apiRequest<RoomStateResponse>(`/api/rooms/${roomCode}/characters/${request.character.playerId}`, {
    method: 'PATCH',
    body: JSON.stringify(request),
  });
}

export function startRoom(roomCode: string, participantId: string) {
  return apiRequest<RoomStateResponse>(`/api/rooms/${roomCode}/start`, {
    method: 'POST',
    body: JSON.stringify({ participantId }),
  });
}

export function submitAction(roomCode: string, request: RoomActionRequest) {
  return apiRequest<RoomStateResponse>(`/api/rooms/${roomCode}/actions`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function submitRoll(roomCode: string, request: RoomRollRequest) {
  return apiRequest<RoomStateResponse>(`/api/rooms/${roomCode}/roll`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function fetchAiStatus() {
  return apiRequest<AiStatusResponse>('/api/ai/status');
}

export function generateAiText(request: AiTextRequest) {
  return apiRequest<AiTextResponse>('/api/ai/text', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function generateAiTextParallel(request: AiParallelTextRequest) {
  return apiRequest<AiParallelTextResponse>('/api/ai/text/parallel', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function generateAiImage(request: AiImageRequest) {
  return apiRequest<AiImageResponse>('/api/ai/image', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

function parseDurationHeader(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function generateAiSpeech(request: AiTtsRequest) {
  const response = await fetch('/api/ai/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiError;
    throw new Error(payload?.error?.message ?? 'Request failed.');
  }

  const audioBlob = await response.blob();
  const metadata: AiTtsMetadata = {
    provider: 'edge-tts',
    model: response.headers.get('X-AI-Model') ?? request.model ?? 'tts-1',
    voice: response.headers.get('X-AI-Voice') ?? request.voice ?? '',
    durationMs: parseDurationHeader(response.headers.get('X-AI-Duration-Ms')),
    format: (response.headers.get('X-AI-Format') as AiTtsMetadata['format'] | null) ?? request.responseFormat ?? 'mp3',
  };

  return {
    audioBlob,
    metadata,
  };
}
