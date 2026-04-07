import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomStore } from '../server/roomStore';
import { CampaignFilters, Participant, PlayerCharacter } from '../src/types';

const filters: CampaignFilters = {
  setting: 'Темне фентезі',
  tone: 'Похмурий та серйозний',
  structure: 'Дослідження підземель',
  combatIntensity: 'Висока',
  magicLevel: 'Середня магія',
  darknessLevel: 'Стандартний',
  worldConcept: 'Старі брами прокидаються, а прикордонні доми приховують ціну цього пробудження.',
};

const host: Participant = {
  id: 'host-1',
  role: 'host',
  displayName: 'Host',
  joinedAt: new Date().toISOString(),
};

const character: PlayerCharacter = {
  playerId: 'player-1',
  displayName: 'Арін',
  bioSummary: 'Мисливець за реліквіями.',
  backstory: 'Шукає спадок свого дому.',
  motivation: 'Повернути меч роду.',
  classFantasy: 'Слідопит',
  inventory: [
    {
      name: 'Лук',
      quantity: 1,
      description: 'Старий лук з темного тиса.',
      kind: 'weapon',
    },
  ],
};

test('RoomStore creates valid room codes and supports basic CRUD operations', () => {
  const store = new RoomStore();
  const room = store.createRoom({
    host,
    title: 'Тінь Короля Ліча',
    language: 'Українська',
    filters,
    sessionType: 'Один постріл',
  });

  assert.match(room.roomCode, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(store.get(room.roomCode)?.hostId, host.id);

  const player: Participant = {
    id: 'player-1',
    role: 'player',
    displayName: 'Player',
    joinedAt: new Date().toISOString(),
  };

  store.addParticipant(room.roomCode, player);
  store.addCharacter(room.roomCode, character);

  assert.equal(store.get(room.roomCode)?.participants.length, 2);
  assert.equal(store.get(room.roomCode)?.characters[0]?.displayName, 'Арін');

  store.delete(room.roomCode);
  assert.equal(store.get(room.roomCode), undefined);
});
