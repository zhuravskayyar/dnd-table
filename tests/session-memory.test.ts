import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addRollToMemory,
  createInitialSessionMemory,
  mergeSessionMemory,
} from '../src/lib/sessionMemory';
import { GeneratedCampaign, PlayerCharacter, SessionMemory } from '../src/types';

const characters: PlayerCharacter[] = [
  {
    playerId: 'p1',
    displayName: 'Арін',
    bioSummary: 'Мисливець за реліквіями.',
    backstory: 'Виріс у руїнах північної марки.',
    motivation: 'Знайти втрачений меч роду.',
    classFantasy: 'Слідопит з темного лісу',
    inventory: [
      {
        name: 'Лук',
        quantity: 1,
        description: 'Старий, але надійний.',
        kind: 'weapon',
      },
    ],
  },
];

const campaign: GeneratedCampaign = {
  synopsis: 'Прокляте королівство на межі голоду й бунту.',
  openingScene: 'Герої прибувають до міської брами перед заходом сонця.',
  conflicts: ['Знайти джерело прокляття'],
  npcs: [
    {
      name: 'Вартовий Бор',
      description: 'Підозрілий прикордонник.',
      role: 'Вартовий брами',
    },
  ],
  playerStartHooks: [
    {
      playerId: 'p1',
      displayName: 'Арін',
      cue: 'Знак на обладунку вартового нагадує слід з його минулого.',
    },
  ],
};

test('createInitialSessionMemory initializes room memory from campaign and characters', () => {
  const memory = createInitialSessionMemory(campaign, characters);

  assert.equal(memory.campaignSummary, campaign.synopsis);
  assert.equal(memory.sceneSummary, campaign.openingScene);
  assert.deepEqual(memory.openThreads, campaign.conflicts);
  assert.equal(memory.activeNpcs[0]?.name, 'Вартовий Бор');
  assert.ok(memory.playerHooks.includes(`${characters[0].displayName}: ${characters[0].motivation}`));
  assert.ok(memory.playerHooks.includes(`${characters[0].displayName}: ${characters[0].classFantasy}`));
  assert.ok(memory.playerHooks.includes(`${campaign.playerStartHooks[0]?.displayName}: ${campaign.playerStartHooks[0]?.cue}`));
});

test('mergeSessionMemory deduplicates facts and updates NPCs by name', () => {
  const current: SessionMemory = {
    campaignSummary: 'A',
    sceneSummary: 'Сцена A',
    activeLocation: 'Брама',
    canonFacts: ['Факт 1'],
    openThreads: ['Нитка 1'],
    activeNpcs: [
      {
        name: 'Вартовий Бор',
        role: 'Вартовий',
        disposition: 'Підозрілий',
        goal: 'Не впустити чужинців',
        lastSeen: 'Брама',
      },
    ],
    playerHooks: ['Арін: Знайти втрачений меч роду.'],
    recentRolls: [],
    lastUpdatedTurn: 0,
  };

  const incoming: SessionMemory = {
    campaignSummary: 'B',
    sceneSummary: 'Сцена B',
    activeLocation: 'Внутрішнє подвір’я',
    canonFacts: ['Факт 1', 'Факт 2'],
    openThreads: ['Нитка 1', 'Нитка 2'],
    activeNpcs: [
      {
        name: 'Вартовий Бор',
        role: 'Вартовий',
        disposition: 'Менш різкий',
        goal: 'Знайти інформатора',
        lastSeen: 'Внутрішнє подвір’я',
      },
    ],
    playerHooks: ['Арін: Слідопит з темного лісу'],
    recentRolls: [],
    lastUpdatedTurn: 1,
  };

  const merged = mergeSessionMemory(current, incoming);

  assert.equal(merged.campaignSummary, 'B');
  assert.equal(merged.sceneSummary, 'Сцена B');
  assert.deepEqual(merged.canonFacts, ['Факт 1', 'Факт 2']);
  assert.deepEqual(merged.openThreads, ['Нитка 1', 'Нитка 2']);
  assert.equal(merged.activeNpcs[0]?.goal, 'Знайти інформатора');
  assert.equal(merged.activeNpcs[0]?.lastSeen, 'Внутрішнє подвір’я');
  assert.equal(merged.lastUpdatedTurn, 1);
});

test('addRollToMemory keeps only five latest rolls', () => {
  let memory = createInitialSessionMemory(campaign, characters);

  for (let result = 1; result <= 6; result += 1) {
    memory = addRollToMemory(memory, {
      kind: 'd20',
      result,
      consequence: `Кидок ${result}`,
    });
  }

  assert.equal(memory.recentRolls.length, 5);
  assert.deepEqual(memory.recentRolls.map((roll) => roll.result), [2, 3, 4, 5, 6]);
});
