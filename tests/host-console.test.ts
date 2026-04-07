import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HostConsole } from '../src/components/room/HostConsole';
import type { Room } from '../src/types';

function createHostRoom(): Room {
  return {
    roomCode: 'ABC123',
    hostId: 'host-1',
    state: 'in_game',
    title: 'Тінь Короля Ліча',
    language: 'Українська',
    filters: {
      setting: 'Темне фентезі',
      tone: 'Похмурий та серйозний',
      structure: 'Дослідження підземель',
      combatIntensity: 'Висока',
      magicLevel: 'Середня магія',
      darknessLevel: 'Стандартний',
      worldConcept: 'Прикордонне місто тримається на межі між мертвою брамою й останніми живими кварталами.',
    },
    sessionType: 'Один постріл',
    participants: [
      {
        id: 'host-1',
        role: 'host',
        displayName: 'Майстер',
        joinedAt: new Date().toISOString(),
      },
      {
        id: 'player-1',
        role: 'player',
        displayName: 'Арін',
        joinedAt: new Date().toISOString(),
      },
    ],
    characters: [
      {
        playerId: 'player-1',
        displayName: 'Арін',
        bioSummary: 'Мовчазний мечник з прикордоння.',
        backstory: 'Виріс серед руїн старої марки й виживав мечем і хитрістю.',
        motivation: 'Повернути честь дому.',
        classFantasy: 'Слідопит-мечник',
        inventory: [
          {
            name: 'Меч',
            quantity: 1,
            description: 'Старий родовий меч.',
            kind: 'weapon',
          },
        ],
      },
    ],
    messages: [],
    memory: {
      campaignSummary: 'Прокляте королівство хилиться до занепаду.',
      sceneSummary: 'Сцена біля брами загострюється.',
      activeLocation: 'Міська брама',
      canonFacts: ['Місто закривається на ніч'],
      openThreads: ['Знайти джерело прокляття'],
      activeNpcs: [],
      playerHooks: ['Арін: Повернути честь дому.'],
      recentRolls: [],
      lastUpdatedTurn: 2,
    },
    sceneActors: [
      {
        id: 'guard-1',
        name: 'Вартовий Бор',
        kind: 'npc',
        role: 'Вартовий брами',
        currentLocation: 'Міська брама',
        awareness: 'alerted',
        woundState: 'wounded',
        disposition: 'Сторожкий',
        notes: 'Відчуває загрозу.',
      },
    ],
    pendingResolution: {
      actionId: 'action-1',
      playerId: 'player-1',
      actionText: 'беру меч, підкрадаюсь ззаду і ріжу горло вартовому',
      targetActorId: 'guard-1',
      itemName: 'Меч',
      steps: [
        {
          id: 'stealth-1',
          type: 'stealth',
          label: 'Скритність',
          stakes: 'Успіх: Ти підходиш непомітно. Ціна: Ти витрачаєш темп. Провал: Вартовий підіймає тривогу.',
          die: 'd20',
          targetActorId: 'guard-1',
          itemName: 'Меч',
        },
        {
          id: 'attack-1',
          type: 'attack',
          label: 'Влучання',
          stakes: 'Успіх: Ти влучаєш. Ціна: Ти відкриваєшся. Провал: Сцена переходить у відкриту сутичку.',
          die: 'd20',
          targetActorId: 'guard-1',
          itemName: 'Меч',
        },
      ],
      currentStepIndex: 1,
      resolvedChecks: [
        {
          stepId: 'stealth-1',
          type: 'stealth',
          result: 14,
          outcome: 'pass',
          consequence: 'Ти підходиш непомітно і займаєш позицію.',
        },
      ],
      createdAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test('host console renders overview with active check terminology', () => {
  const html = renderToStaticMarkup(React.createElement(HostConsole, {
    room: createHostRoom(),
    busyKey: null,
    onStartGame: () => undefined,
    onSaveCharacter: () => undefined,
  }));

  assert.match(html, /Концепт світу/);
  assert.match(html, /8/);
  assert.match(html, /Активна перевірка/);
  assert.match(html, /Ставка/);
  assert.match(html, /Арін/);
});
