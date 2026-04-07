import { createEmptySessionMemory } from '../src/lib/sessionMemory';
import { CampaignFilters, Participant, PlayerCharacter, Room, SessionType } from '../src/types';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

function generateRoomCode(): string {
  let code = '';

  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    const randomIndex = Math.floor(Math.random() * ROOM_CODE_CHARS.length);
    code += ROOM_CODE_CHARS[randomIndex];
  }

  return code;
}

export class RoomStore {
  private readonly rooms = new Map<string, Room>();

  createRoom({
    host,
    title,
    language,
    filters,
    sessionType,
  }: {
    host: Participant;
    title: string;
    language: string;
    filters: CampaignFilters;
    sessionType: SessionType;
  }) {
    let roomCode = generateRoomCode();
    while (this.rooms.has(roomCode)) {
      roomCode = generateRoomCode();
    }

    const now = new Date().toISOString();
    const room: Room = {
      roomCode,
      hostId: host.id,
      state: 'lobby',
      title,
      language,
      filters,
      sessionType,
      participants: [host],
      characters: [],
      messages: [],
      memory: createEmptySessionMemory(),
      sceneActors: [],
      pendingResolution: null,
      createdAt: now,
      updatedAt: now,
    };

    this.rooms.set(roomCode, room);
    return room;
  }

  get(roomCode: string) {
    return this.rooms.get(roomCode);
  }

  set(room: Room) {
    this.rooms.set(room.roomCode, room);
  }

  delete(roomCode: string) {
    this.rooms.delete(roomCode);
  }

  addParticipant(roomCode: string, participant: Participant) {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return null;
    }

    room.participants.push(participant);
    room.updatedAt = new Date().toISOString();
    return room;
  }

  addCharacter(roomCode: string, character: PlayerCharacter) {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return null;
    }

    room.characters.push(character);
    room.updatedAt = new Date().toISOString();
    return room;
  }
}
