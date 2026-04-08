import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { createApp } from '../server/app';

type GenerateTextInput = {
  prompt: string;
  systemPrompt: string;
};

function createRoller(results: number[]) {
  let index = 0;
  return () => {
    const result = results[index] ?? results[results.length - 1] ?? 10;
    index += 1;
    return result;
  };
}

function extractGuardActorId(prompt: string) {
  const match = prompt.match(/-\s+([0-9a-f-]{8,})\s+\|\s+Вартовий Бор/i);
  return match?.[1] ?? 'guard-1';
}

function extractRollResult(prompt: string) {
  const match = prompt.match(/Rolled d20 result:\s*([0-9]+)/i);
  return Number(match?.[1] ?? 10);
}

function extractPlayerAction(prompt: string) {
  const match = prompt.match(/Player action:\s*([\s\S]*?)\s*Return JSON:/i);
  return match?.[1]?.trim() ?? '';
}

function extractCurrentStepType(prompt: string) {
  const match = prompt.match(/Current step:\s*(\{[\s\S]*?\})\s*Resolved checks so far:/i);
  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]) as { type?: string };
    return parsed.type ?? null;
  } catch {
    return null;
  }
}

function extractFirstCharacter(prompt: string) {
  const match = prompt.match(/-\s+([^\n]+)\s+PlayerId:\s+([^\n]+)/i);
  return {
    displayName: match?.[1]?.trim() ?? 'Арін',
    playerId: match?.[2]?.trim() ?? 'p1',
  };
}

function buildGuardActor(actorId: string, overrides?: Partial<{
  awareness: 'unaware' | 'suspicious' | 'alerted' | 'engaged';
  woundState: 'healthy' | 'wounded' | 'critical' | 'dead';
  notes: string;
  currentLocation: string;
}>) {
  return {
    id: actorId,
    name: 'Вартовий Бор',
    kind: 'npc' as const,
    role: 'Вартовий брами',
    currentLocation: overrides?.currentLocation ?? 'Opening scene',
    awareness: overrides?.awareness ?? 'unaware',
    woundState: overrides?.woundState ?? 'healthy',
    disposition: 'Сторожкий ветеран брами',
    notes: overrides?.notes ?? 'Сторожить вхід до міста.',
  };
}

function createMockGenerateText({
  invalidMemoryUpdate = false,
  invalidActionPlanJson = false,
  invalidCheckEvaluationJson = false,
  invalidOpeningJson = false,
}: {
  invalidMemoryUpdate?: boolean;
  invalidActionPlanJson?: boolean;
  invalidCheckEvaluationJson?: boolean;
  invalidOpeningJson?: boolean;
} = {}) {
  return async ({ prompt, systemPrompt }: GenerateTextInput) => {
    if (systemPrompt.includes('player character')) {
      const character = extractFirstCharacter(prompt);
      return JSON.stringify({
        bioSummary: 'Мовчазний мечник з прикордоння.',
        backstory: 'Виріс серед руїн старої марки й виживав мечем і хитрістю.',
        motivation: 'Повернути честь дому та відшукати давній знак роду.',
        classFantasy: 'Слідопит-мечник темної межі',
        inventory: [
          {
            name: 'Меч',
            quantity: 1,
            description: 'Старий родовий меч.',
            kind: 'weapon',
          },
          {
            name: 'Плащ',
            quantity: 1,
            description: 'Темний плащ для дороги й тіні.',
            kind: 'gear',
          },
          {
            name: 'Ліхтар',
            quantity: 1,
            description: 'Надійний ліхтар для нічної варти.',
            kind: 'tool',
          },
        ],
      });
    }

    if (systemPrompt.includes('opening the first scene for players')) {
      const character = extractFirstCharacter(prompt);
      const isEnglish = systemPrompt.includes('Respond in English.');
      const isGroup = (prompt.match(/PlayerId:/g) ?? []).length > 1;
      if (invalidOpeningJson) {
        return `{
          "synopsis": "broken opening",
          "openingScene": "broken opening"
        }`;
      }

      return JSON.stringify(isEnglish ? {
        synopsis: 'Something is already pressing against the gate before the city is ready to admit it.',
        openingScene: `Rain runs down the gate stones while a draft leaks through the half-open seam, carrying cold iron and something fouler underneath. Gate Warden Bor keeps one hand near the spear shaft, watching the approach like he expects trouble to move first. When he shifts in the lantern glow, Arin catches a worn mark on the leather that belongs too close to unfinished business. Bor lowers his voice. Speak now, or the gate closes. ${isGroup ? 'What do you all do?' : 'What do you do?'}`,
        conflicts: ['Learn what is waiting behind the gate before the chance closes.'],
        npcs: [
          {
            name: 'Gate Warden Bor',
            description: 'A wary veteran at the gate who knows more than he says.',
            role: 'Gate warden',
          },
        ],
        playerStartHooks: [
          {
            playerId: character.playerId,
            displayName: character.displayName,
            cue: 'The mark on the warden\'s gear points back to unfinished business.',
          },
        ],
      } : {
        synopsis: 'Тінь наближається до брами швидше, ніж місто готове це визнати.',
        openingScene: `Біля брами мокрий камінь блищить під ліхтарем, а з вузької щілини в воротах тягне холодом і старим залізом. Вартовий Бор не відводить руки від списа, ніби чекає не гостей, а удару з темряви. Коли він трохи повертається, Арін помічає на ремені затертий знак зі свого минулого. Бор стишує голос: ${isGroup ? 'або ви говорите зараз, або ворота зачиняються. Що ви робите?' : 'або ти говориш зараз, або ворота зачиняються. Що ти робиш?'}`,
        conflicts: ['Зрозуміти, що ховається за брамою'],
        npcs: [
          {
            name: 'Вартовий Бор',
            description: 'Сторожкий ветеран брами, який знає більше, ніж каже.',
            role: 'Вартовий брами',
          },
        ],
        playerStartHooks: [
          {
            playerId: character.playerId,
            displayName: character.displayName,
            cue: 'Знак на спорядженні вартового перегукується з незакритим боргом.',
          },
        ],
      });
    }

    if (systemPrompt.includes('validate whether a player action fits')) {

      if (prompt.includes('лазерний танк')) {
        return JSON.stringify({
          result: 'blocked',
          explanation: 'Світ не приймає цієї дії: вона руйнує тон і логіку сцени.',
        });
      }

      return JSON.stringify({
        result: 'allowed',
        explanation: 'Дія сумісна з концептом гри.',
      });
    }

    if (systemPrompt.includes('action-resolution planner')) {
      if (invalidActionPlanJson) {
        return `{
          "mode": "sequence",
          "message": "broken json",
        }`;
      }

      const guardId = extractGuardActorId(prompt);
      const playerAction = extractPlayerAction(prompt);

      if (playerAction.includes('cut their throat') || playerAction.includes('move behind the guard')) {
        return JSON.stringify({
          mode: 'sequence',
          message: 'Roll d20 for stealth before the guard notices you.',
          targetActorId: guardId,
          itemName: 'Sword',
          steps: [
            {
              id: 'stealth-step',
              type: 'stealth',
              label: 'Stealth',
              stakes: 'Reach the target unnoticed.',
              die: 'd20',
              targetActorId: guardId,
              itemName: 'Sword',
            },
            {
              id: 'attack-step',
              type: 'attack',
              label: 'Attack',
              stakes: 'Land the strike before the guard reacts.',
              die: 'd20',
              targetActorId: guardId,
              itemName: 'Sword',
            },
            {
              id: 'damage-step',
              type: 'damage',
              label: 'Damage',
              stakes: 'Determine how severe the wound becomes.',
              die: 'd20',
              targetActorId: guardId,
              itemName: 'Sword',
            },
          ],
        });
      }

      if (prompt.includes('беру це') || prompt.includes('роблю щось')) {
        return JSON.stringify({
          mode: 'clarify',
          message: 'Уточни, чим саме дієш і кого саме хочеш атакувати.',
          targetActorId: null,
          itemName: null,
          steps: [],
        });
      }

      if (prompt.includes('кажу вартовому')) {
        return JSON.stringify({
          mode: 'immediate',
          message: 'Майстер відповість одразу.',
          targetActorId: guardId,
          itemName: null,
          steps: [],
        });
      }

      if (prompt.includes('ріжу горло') || prompt.includes('підкрадаюсь ззаду')) {
        return JSON.stringify({
          mode: 'sequence',
          message: 'Кинь d20 на скритність, щоб непомітно підкрастися до вартового.',
          targetActorId: guardId,
          itemName: 'Меч',
          steps: [
            {
              id: 'stealth-step',
              type: 'stealth',
              label: 'Stealth',
              stakes: 'Чи підкрадешся непомітно до цілі.',
              die: 'd20',
              targetActorId: guardId,
              itemName: 'Меч',
            },
            {
              id: 'attack-step',
              type: 'attack',
              label: 'Attack',
              stakes: 'Чи встигнеш точно вразити ціль до реакції.',
              die: 'd20',
              targetActorId: guardId,
              itemName: 'Меч',
            },
            {
              id: 'damage-step',
              type: 'damage',
              label: 'Damage',
              stakes: 'Наскільки фатальним буде удар.',
              die: 'd20',
              targetActorId: guardId,
              itemName: 'Меч',
            },
          ],
        });
      }

      return JSON.stringify({
        mode: 'immediate',
        message: 'Майстер відповість одразу.',
        targetActorId: null,
        itemName: null,
        steps: [],
      });
    }

    if (systemPrompt.includes('resolving a dice result')) {
      if (invalidCheckEvaluationJson) {
        return `{
          "resolvedCheck": {
            "stepId": "broken",
          },
        }`;
      }

      const guardId = extractGuardActorId(prompt);
      const roll = extractRollResult(prompt);
      const currentStepType = extractCurrentStepType(prompt);

      if (currentStepType === 'stealth') {
        if (roll < 12) {
          return JSON.stringify({
            resolvedCheck: {
              stepId: 'stealth-step',
              type: 'stealth',
              result: roll,
              outcome: 'fail',
              consequence: 'Вартовий чує крок і різко розвертається.',
            },
            continueSequence: false,
            updatedSceneActors: [
              buildGuardActor(guardId, {
                awareness: 'alerted',
                notes: 'Почув підозрілий рух і тягнеться до зброї.',
              }),
            ],
            dmText: 'Твоя тінь ковзає невдало: вартовий Бор помічає рух, хапається за зброю і піднімає тривогу.',
          });
        }

        return JSON.stringify({
          resolvedCheck: {
            stepId: 'stealth-step',
            type: 'stealth',
            result: roll,
            outcome: roll >= 18 ? 'strong_pass' : 'pass',
            consequence: 'Ти підкрадаєшся непомітно.',
          },
          continueSequence: true,
          updatedSceneActors: [
            buildGuardActor(guardId, {
              awareness: 'unaware',
              notes: 'Нічого не підозрює.',
            }),
          ],
          dmText: 'Ти зливаєшся з тінню за спиною вартового. Кинь d20 на попадання.',
        });
      }

      if (currentStepType === 'attack') {
        if (roll < 12) {
          return JSON.stringify({
            resolvedCheck: {
              stepId: 'attack-step',
              type: 'attack',
              result: roll,
              outcome: 'fail',
              consequence: 'Клинок ковзає повз смертельну точку.',
            },
            continueSequence: false,
            updatedSceneActors: [
              buildGuardActor(guardId, {
                awareness: 'engaged',
                woundState: 'wounded',
                notes: 'Поранений, але вже встиг обернутися і чинить опір.',
              }),
            ],
            dmText: 'Удар збивається в останню мить: Бор хрипко скрикує, отримує рану і входить у бій.',
          });
        }

        return JSON.stringify({
          resolvedCheck: {
            stepId: 'attack-step',
            type: 'attack',
            result: roll,
            outcome: roll >= 18 ? 'strong_pass' : 'pass',
            consequence: 'Клинок знаходить ціль.',
          },
          continueSequence: true,
          updatedSceneActors: [
            buildGuardActor(guardId, {
              awareness: 'engaged',
              notes: 'Запізно відчуває загрозу.',
            }),
          ],
          dmText: 'Ти виводиш меч точно на горло. Кинь d20 на урон.',
        });
      }

      return JSON.stringify({
        resolvedCheck: {
          stepId: 'damage-step',
          type: 'damage',
          result: roll,
          outcome: roll >= 18 ? 'strong_pass' : roll >= 12 ? 'pass' : roll >= 8 ? 'mixed' : 'fail',
          consequence: roll >= 18
            ? 'Удар майже миттєво вбиває ціль.'
            : roll >= 12
              ? 'Удар критично калічить ціль.'
              : roll >= 8
                ? 'Удар важкий, але не миттєво смертельний.'
                : 'Ти лише рвеш шкіру, не доводячи атаку до кінця.',
        },
        continueSequence: false,
        updatedSceneActors: [
          buildGuardActor(guardId, {
            awareness: 'engaged',
            woundState: roll >= 18 ? 'dead' : roll >= 12 ? 'critical' : 'wounded',
            notes: roll >= 18
              ? 'Падає без звуку.'
              : roll >= 12
                ? 'Заливається кров’ю й хитається на межі смерті.'
                : 'Зривається в паніку й кличе на допомогу.',
          }),
        ],
        dmText: roll >= 18
          ? 'Меч проходить чисто й фатально: Бор осідає біля брами, так і не піднявши тривоги.'
          : roll >= 12
            ? 'Твій удар рве горло й валить Бора на коліна. Він ще сіпається, але вже майже мертвий.'
            : 'Удар виходить брудним і шумним: Бор затискає рану, хрипить і кличе на допомогу.',
      });
    }

    if (systemPrompt.includes('narrative memory system')) {
      if (invalidMemoryUpdate) {
        return 'не-json';
      }

      return JSON.stringify({
        campaignSummary: 'Прокляте королівство хилиться до занепаду.',
        sceneSummary: 'Сцена біля брами загострюється.',
        activeLocation: 'Міська брама',
        canonFacts: ['Місто закривається на ніч'],
        openThreads: ['Знайти джерело прокляття'],
        activeNpcs: [
          {
            name: 'Вартовий Бор',
            role: 'Вартовий брами',
            disposition: 'Напружений',
            goal: 'Не впустити чужинців',
            lastSeen: 'Міська брама',
          },
        ],
        playerHooks: [],
        recentRolls: [],
        lastUpdatedTurn: 1,
      });
    }

    if (systemPrompt.includes('final narrator game-master voice')) {
      return 'Майстер коротко описує реакцію сцени та чекає вашого наступного рішення.';
    }

    throw new Error(`Unhandled mock prompt: ${systemPrompt}`);
  };
}

async function startTestServer({
  generateText = createMockGenerateText(),
  generatePromptText,
  generateParallelPromptText,
  generatePromptImage,
  generateSpeech,
  getAiStatus,
  rollD20 = createRoller([15, 15, 18]),
}: {
  generateText?: (input: GenerateTextInput) => Promise<string>;
  generatePromptText?: (input: GenerateTextInput & { model?: string }) => Promise<{
    text: string;
    model: string;
    provider: 'nvidia';
    durationMs: number;
    keySlot: number | null;
  }>;
  generateParallelPromptText?: (input: { prompts: string[]; systemPrompt: string; model?: string }) => Promise<Array<{
    id: string;
    prompt: string;
    status: 'success' | 'error';
    text: string | null;
    error: string | null;
    model: string;
    provider: 'nvidia' | null;
    durationMs: number;
    keySlot: number | null;
  }>>;
  generatePromptImage?: (input: {
    prompt: string;
    systemPrompt?: string;
    model?: string;
    aspectRatio?: string;
    imageSize?: string;
  }) => Promise<{
    images: string[];
    text: string;
    model: string;
    provider: 'openrouter';
    durationMs: number;
    keySlot: number | null;
  }>;
  generateSpeech?: (input: {
    input: string;
    voice?: string;
    model?: string;
    responseFormat?: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac' | 'pcm';
    speed?: number;
  }) => Promise<{
    audioBuffer: Buffer;
    contentType: string;
    fileName: string;
    metadata: {
      provider: 'edge-tts';
      model: string;
      voice: string;
      durationMs: number;
      format: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac' | 'pcm';
    };
  }>;
  getAiStatus?: () => {
    textProvider: 'nvidia' | 'unconfigured';
    textModel: string | null;
    imageProvider: 'openrouter' | null;
    imageModel: string | null;
    ttsProvider: 'edge-tts' | null;
    ttsBaseUrl: string | null;
    ttsDefaultVoice: string | null;
    ttsReachable: boolean;
    ttsStatusMessage: string | null;
    parallelKeyCount: number;
  };
  rollD20?: () => number;
} = {}) {
  const app = createApp({
    generateText,
    generatePromptText: generatePromptText ?? (async (input) => ({
      text: await generateText(input),
      model: input.model ?? 'test-text-model',
      provider: 'nvidia',
      durationMs: 4,
      keySlot: null,
    })),
    generateParallelPromptText: generateParallelPromptText ?? (async (input) => {
      return input.prompts.map((prompt, index) => ({
        id: `parallel-${index}`,
        prompt,
        status: 'success' as const,
        text: `parallel:${prompt}`,
        error: null,
        model: input.model ?? 'test-text-model',
        provider: 'nvidia' as const,
        durationMs: 5 + index,
        keySlot: null,
      }));
    }),
    generatePromptImage: generatePromptImage ?? (async (input) => ({
      images: [`data:image/png;base64,${Buffer.from(`image:${input.prompt}`).toString('base64')}`],
      text: 'generated image',
      model: input.model ?? 'test-image-model',
      provider: 'openrouter',
      durationMs: 7,
      keySlot: 0,
    })),
    generateSpeech: generateSpeech ?? (async (input) => ({
      audioBuffer: Buffer.from(`audio:${input.input}`),
      contentType: 'audio/mpeg',
      fileName: 'speech.mp3',
      metadata: {
        provider: 'edge-tts',
        model: input.model ?? 'tts-1',
        voice: input.voice ?? 'uk-UA-PolinaNeural',
        durationMs: 6,
        format: input.responseFormat ?? 'mp3',
      },
    })),
    getAiStatus: getAiStatus ?? (() => ({
      textProvider: 'nvidia',
      textModel: 'nvidia/llama-3.3-nemotron-super-49b-v1',
      imageProvider: null,
      imageModel: null,
      ttsProvider: null,
      ttsBaseUrl: null,
      ttsDefaultVoice: null,
      ttsReachable: false,
      ttsStatusMessage: null,
      parallelKeyCount: 1,
    })),
    rollD20,
  });
  const server = app.listen(0);

  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
}

async function createRoomAndJoinPlayer(baseUrl: string) {
  const createResponse = await fetch(`${baseUrl}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hostName: 'Host',
      title: 'Тінь Короля Ліча',
      language: 'Українська',
      filters: {
        setting: 'Темне фентезі',
        tone: 'Похмурий та серйозний',
        structure: 'Дослідження підземель',
        combatIntensity: 'Висока',
        magicLevel: 'Середня магія',
        darknessLevel: 'Стандартний',
        worldConcept: 'Старі брами шепочуть імена мертвих, а місто тримається на крихкому ритуалі стримування.',
      },
      sessionType: 'Один постріл',
    }),
  });

  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();

  const joinResponse = await fetch(`${baseUrl}/api/rooms/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomCode: created.roomCode,
      displayName: 'Арін',
    }),
  });

  assert.equal(joinResponse.status, 201);
  const joined = await joinResponse.json();

  return {
    created,
    joined,
  };
}

test('host creates room and player joins with auto-generated character', async () => {
  const server = await startTestServer();

  try {
    const { created, joined } = await createRoomAndJoinPlayer(server.baseUrl);

    assert.equal(created.role, 'host');
    assert.match(created.roomCode, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(joined.role, 'player');
    assert.equal(joined.room.characters.length, 1);
    assert.equal(joined.room.characters[0]?.displayName, 'Арін');
    assert.equal(joined.room.characters[0]?.inventory[0]?.name, 'Меч');
  } finally {
    await server.close();
  }
});

test('room accepts up to eight players and rejects the ninth join', async () => {
  const server = await startTestServer();

  try {
    const { created } = await createRoomAndJoinPlayer(server.baseUrl);

    for (let index = 2; index <= 8; index += 1) {
      const response = await fetch(`${server.baseUrl}/api/rooms/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode: created.roomCode,
          displayName: `Player-${index}`,
        }),
      });

      assert.equal(response.status, 201);
    }

    const ninthJoin = await fetch(`${server.baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomCode: created.roomCode,
        displayName: 'Player-9',
      }),
    });

    assert.equal(ninthJoin.status, 409);
    const payload = await ninthJoin.json();
    assert.match(payload.error.message, /maximum is 8 players/i);

    const state = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/state?participantId=${created.participantId}`);
    assert.equal(state.status, 200);
    const roomState = await state.json();
    assert.equal(roomState.room.participants.filter((participant: { role: string }) => participant.role === 'player').length, 8);
    assert.equal(roomState.room.characters.length, 8);
  } finally {
    await server.close();
  }
});

test('joined players receive distinct character bios, roles, and inventory loadouts', async () => {
  const server = await startTestServer();

  try {
    const { created } = await createRoomAndJoinPlayer(server.baseUrl);

    for (let index = 2; index <= 8; index += 1) {
      const response = await fetch(`${server.baseUrl}/api/rooms/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode: created.roomCode,
          displayName: `Player-${index}`,
        }),
      });

      assert.equal(response.status, 201);
    }

    const state = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/state?participantId=${created.participantId}`);
    assert.equal(state.status, 200);
    const roomState = await state.json();
    const characters = roomState.room.characters as Array<{
      bioSummary: string;
      classFantasy: string;
      inventory: Array<{ name: string }>;
    }>;

    const bios = new Set(characters.map((character) => character.bioSummary));
    const roles = new Set(characters.map((character) => character.classFantasy));
    const inventories = new Set(characters.map((character) => (
      character.inventory.map((item) => item.name.toLowerCase()).sort().join('|')
    )));

    assert.equal(characters.length, 8);
    assert.equal(bios.size, 8);
    assert.equal(roles.size >= 1, true);
  } finally {
    await server.close();
  }
});

test('join rejects unknown room codes', async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomCode: 'BAD123',
        displayName: 'Арін',
      }),
    });

    assert.equal(response.status, 404);
  } finally {
    await server.close();
  }
});

test('only host can edit character sheets and start the game', async () => {
  const server = await startTestServer();

  try {
    const { created, joined } = await createRoomAndJoinPlayer(server.baseUrl);
    const character = joined.room.characters[0];
    assert.ok(character);

    const forbiddenPatch = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/characters/${character.playerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: joined.participantId,
        character,
      }),
    });
    assert.equal(forbiddenPatch.status, 403);

    const hostStart = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: created.participantId }),
    });
    assert.equal(hostStart.status, 200);
    const started = await hostStart.json();
    const dmMessages = started.room.messages.filter((message: { authorType: string }) => message.authorType === 'dm');
    const openingText = started.room.messages.at(-1)?.content ?? '';

    assert.equal(started.room.state, 'in_game');
    assert.equal(started.room.sceneActors.length, 1);
    assert.equal(dmMessages.length, 1);
    assert.equal(started.room.messages.at(-1)?.authorType, 'dm');
    assert.match(openingText, /\?$/);
    assert.doesNotMatch(openingText, /Why you are here|What you can do now/i);
    assert.ok(!openingText.includes('\u0427\u043e\u043c\u0443 \u0442\u0438 \u0442\u0443\u0442'));
    assert.ok(!openingText.includes('\u0429\u043e \u043c\u043e\u0436\u043d\u0430 \u0437\u0440\u043e\u0431\u0438\u0442\u0438 \u043f\u0440\u043e\u0441\u0442\u043e \u0437\u0430\u0440\u0430\u0437'));
  } finally {
    await server.close();
  }
});

test('opening fallback stays short, concrete, and free of briefing labels', async () => {
  const server = await startTestServer({
    generateText: createMockGenerateText({ invalidOpeningJson: true }),
  });

  try {
    const { created } = await createRoomAndJoinPlayer(server.baseUrl);

    const hostStart = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: created.participantId }),
    });

    assert.equal(hostStart.status, 200);
    const started = await hostStart.json();
    const openingText = started.room.messages.at(-1)?.content ?? '';

    assert.match(openingText, /\?$/);
    assert.doesNotMatch(openingText, /visible obstacle|scene demands|Why you are here|What you can do now/i);
    assert.ok(!openingText.includes('\u041f\u0435\u0440\u0435\u0434 \u0433\u0435\u0440\u043e\u044f\u043c\u0438'));
    assert.ok(!openingText.includes('\u0432\u0438\u0434\u0438\u043c\u0430 \u043f\u0435\u0440\u0435\u0448\u043a\u043e\u0434\u0430'));
    assert.ok(!openingText.includes('\u0441\u0446\u0435\u043d\u0430 \u0432\u0438\u043c\u0430\u0433\u0430\u0454'));
    assert.ok(openingText.split(/[.!?](?:\s+|$)/u).filter(Boolean).length <= 6);
    assert.ok(started.room.memory.playerHooks.some((hook: string) => hook.startsWith('\u0410\u0440\u0456\u043d:')));
    assert.ok(started.room.memory.playerHooks.some((hook: string) => hook.includes('\u0447\u0435\u0441\u0442\u044c \u0434\u043e\u043c\u0443') || hook.includes('unfinished business')));
    assert.equal(started.room.messages.filter((message: { authorType: string }) => message.authorType === 'dm').length, 1);
  } finally {
    await server.close();
  }
});

test('opening question switches between singular and plural', async () => {
  const soloServer = await startTestServer();

  try {
    const { created } = await createRoomAndJoinPlayer(soloServer.baseUrl);

    const soloStart = await fetch(`${soloServer.baseUrl}/api/rooms/${created.roomCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: created.participantId }),
    });

    assert.equal(soloStart.status, 200);
    const soloStarted = await soloStart.json();
    assert.match(soloStarted.room.messages.at(-1)?.content ?? '', /\u0429\u043e \u0442\u0438 \u0440\u043e\u0431\u0438\u0448\?|What do you do\?$/i);
  } finally {
    await soloServer.close();
  }

  const groupServer = await startTestServer();

  try {
    const { created } = await createRoomAndJoinPlayer(groupServer.baseUrl);

    const joinResponse = await fetch(`${groupServer.baseUrl}/api/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomCode: created.roomCode,
        displayName: 'Scout',
      }),
    });
    assert.ok(joinResponse.status === 200 || joinResponse.status === 201);

    const groupStart = await fetch(`${groupServer.baseUrl}/api/rooms/${created.roomCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: created.participantId }),
    });

    assert.equal(groupStart.status, 200);
    const groupStarted = await groupStart.json();
    assert.match(groupStarted.room.messages.at(-1)?.content ?? '', /\u0429\u043e \u0432\u0438 \u0440\u043e\u0431\u0438\u0442\u0435\?|What do you all do\?$/i);
  } finally {
    await groupServer.close();
  }
});

test('stealth kill action creates a pending multi-step resolution', async () => {
  const server = await startTestServer();

  try {
    const { created, joined } = await createRoomAndJoinPlayer(server.baseUrl);

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: created.participantId }),
    });

    const actionResponse = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: joined.participantId,
        content: 'беру меч, підкрадаюсь ззаду і ріжу горло вартовому',
      }),
    });

    assert.equal(actionResponse.status, 200);
    const actionPayload = await actionResponse.json();
    assert.equal(actionPayload.room.pendingResolution.playerId, joined.participantId);
    assert.equal(actionPayload.room.pendingResolution.steps.length, 3);
    assert.equal(actionPayload.room.pendingResolution.steps[0].type, 'stealth');
    assert.match(actionPayload.room.messages.at(-1).content, /скритність|d20/i);
  } finally {
    await server.close();
  }
});

test('malformed action planner JSON falls back to deterministic planning', async () => {
  const server = await startTestServer({
    generateText: createMockGenerateText({ invalidActionPlanJson: true }),
  });

  try {
    const { created, joined } = await createRoomAndJoinPlayer(server.baseUrl);

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: created.participantId }),
    });

    const actionResponse = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: joined.participantId,
        content: 'I take my sword, move behind the guard, and cut their throat.',
      }),
    });

    assert.equal(actionResponse.status, 200);
    const payload = await actionResponse.json();
    assert.equal(payload.room.pendingResolution.steps[0].type, 'stealth');
    assert.equal(payload.room.pendingResolution.steps[1].type, 'attack');
    assert.equal(payload.room.pendingResolution.steps[2].type, 'damage');
  } finally {
    await server.close();
  }
});

test('successful sequence advances through stealth, attack, and damage to update wound state', async () => {
  const server = await startTestServer({
    rollD20: createRoller([16, 15, 19]),
  });

  try {
    const { created, joined } = await createRoomAndJoinPlayer(server.baseUrl);

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: created.participantId }),
    });

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: joined.participantId,
        content: 'беру меч, підкрадаюсь ззаду і ріжу горло вартовому',
      }),
    });

    const stealthRoll = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/roll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: joined.participantId }),
    });
    assert.equal(stealthRoll.status, 200);
    const stealthPayload = await stealthRoll.json();
    assert.equal(stealthPayload.room.pendingResolution.currentStepIndex, 1);
    assert.equal(stealthPayload.room.pendingResolution.resolvedChecks[0].type, 'stealth');

    const attackRoll = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/roll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: joined.participantId }),
    });
    assert.equal(attackRoll.status, 200);
    const attackPayload = await attackRoll.json();
    assert.equal(attackPayload.room.pendingResolution.currentStepIndex, 2);
    assert.equal(attackPayload.room.pendingResolution.resolvedChecks[1].type, 'attack');

    const damageRoll = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/roll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: joined.participantId }),
    });
    assert.equal(damageRoll.status, 200);
    const damagePayload = await damageRoll.json();
    assert.equal(damagePayload.room.pendingResolution, null);
    assert.equal(damagePayload.room.sceneActors[0].woundState, 'dead');
  } finally {
    await server.close();
  }
});

test('failed stealth ends the sequence and alerts the target', async () => {
  const server = await startTestServer({
    rollD20: createRoller([5]),
  });

  try {
    const { created, joined } = await createRoomAndJoinPlayer(server.baseUrl);

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: created.participantId }),
    });

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: joined.participantId,
        content: 'беру меч, підкрадаюсь ззаду і ріжу горло вартовому',
      }),
    });

    const rollResponse = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/roll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: joined.participantId }),
    });
    assert.equal(rollResponse.status, 200);
    const payload = await rollResponse.json();
    assert.equal(payload.room.pendingResolution, null);
    assert.equal(payload.room.sceneActors[0].awareness, 'alerted');
    assert.match(payload.room.messages.at(-1).content, /помічає|тривогу/i);
  } finally {
    await server.close();
  }
});

test('malformed check evaluation JSON falls back to deterministic resolution', async () => {
  const baseGenerateText = createMockGenerateText({ invalidCheckEvaluationJson: true });
  const server = await startTestServer({
    generateText: async (input) => {
      if (input.systemPrompt.includes('action-resolution planner')) {
        const guardId = extractGuardActorId(input.prompt);
        return JSON.stringify({
          mode: 'sequence',
          message: 'Roll d20 for stealth before the guard notices you.',
          targetActorId: guardId,
          itemName: 'Sword',
          steps: [
            {
              id: 'stealth-step',
              type: 'stealth',
              label: 'Stealth',
              stakes: 'Reach the target unnoticed.',
              die: 'd20',
              targetActorId: guardId,
              itemName: 'Sword',
            },
            {
              id: 'attack-step',
              type: 'attack',
              label: 'Attack',
              stakes: 'Land the strike before the guard reacts.',
              die: 'd20',
              targetActorId: guardId,
              itemName: 'Sword',
            },
            {
              id: 'damage-step',
              type: 'damage',
              label: 'Damage',
              stakes: 'Determine how severe the wound becomes.',
              die: 'd20',
              targetActorId: guardId,
              itemName: 'Sword',
            },
          ],
        });
      }

      return baseGenerateText(input);
    },
    rollD20: createRoller([16]),
  });

  try {
    const { created, joined } = await createRoomAndJoinPlayer(server.baseUrl);

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: created.participantId }),
    });

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: joined.participantId,
        content: 'беру меч, підкрадаюсь ззаду і ріжу горло вартовому',
      }),
    });

    const rollResponse = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/roll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: joined.participantId }),
    });

    assert.equal(rollResponse.status, 200);
    const payload = await rollResponse.json();
    assert.equal(payload.room.pendingResolution.currentStepIndex, 1);
    assert.equal(payload.room.pendingResolution.resolvedChecks[0].type, 'stealth');
  } finally {
    await server.close();
  }
});

test('ambiguous action returns clarification without opening a check sequence', async () => {
  const server = await startTestServer();

  try {
    const { created, joined } = await createRoomAndJoinPlayer(server.baseUrl);

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: created.participantId }),
    });

    const response = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: joined.participantId,
        content: 'беру це і роблю щось',
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.room.pendingResolution, null);
    assert.match(payload.room.messages.at(-1).content, /Уточни/i);
  } finally {
    await server.close();
  }
});

test('compound action is rejected until the player chooses one intended action', async () => {
  const server = await startTestServer();

  try {
    const { created, joined } = await createRoomAndJoinPlayer(server.baseUrl);

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: created.participantId }),
    });

    const response = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: joined.participantId,
        content: 'я підбігаю, хапаю ніж, б’ю охоронця і ховаюсь за шафу',
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.room.pendingResolution, null);
    assert.match(payload.room.messages.at(-1).content, /один пост = одна намірена дія|один пост = одна дія/i);
  } finally {
    await server.close();
  }
});

test('social pressure without leverage returns clarification instead of auto-success', async () => {
  const server = await startTestServer();

  try {
    const { created, joined } = await createRoomAndJoinPlayer(server.baseUrl);

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: created.participantId }),
    });

    const response = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: joined.participantId,
        content: 'переконую вартового пустити мене',
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.room.pendingResolution, null);
    assert.match(payload.room.messages.at(-1).content, /Уточни|кому саме|чим тиснеш/i);
  } finally {
    await server.close();
  }
});

test('broad search asks for a single zone instead of resolving the whole scene', async () => {
  const server = await startTestServer();

  try {
    const { created, joined } = await createRoomAndJoinPlayer(server.baseUrl);

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: created.participantId }),
    });

    const response = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: joined.participantId,
        content: 'обшукую всю кімнату і шукаю все цінне',
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.room.pendingResolution, null);
    assert.match(payload.room.messages.at(-1).content, /Обери один сектор|один сектор або контейнер/i);
  } finally {
    await server.close();
  }
});

test('room keeps only one active check sequence at a time', async () => {
  const server = await startTestServer();

  try {
    const { created, joined } = await createRoomAndJoinPlayer(server.baseUrl);

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: created.participantId }),
    });

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: joined.participantId,
        content: 'беру меч, підкрадаюсь ззаду і ріжу горло вартовому',
      }),
    });

    const secondAction = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: joined.participantId,
        content: 'атакую ще раз',
      }),
    });

    assert.equal(secondAction.status, 409);
  } finally {
    await server.close();
  }
});

test('invalid memory updates do not corrupt room state after immediate actions', async () => {
  const server = await startTestServer({
    generateText: createMockGenerateText({ invalidMemoryUpdate: true }),
  });

  try {
    const { created, joined } = await createRoomAndJoinPlayer(server.baseUrl);

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: created.participantId }),
    });

    const response = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: joined.participantId,
        content: 'кажу вартовому, що шукаю нічліг',
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.room.pendingResolution, null);
    assert.equal(payload.room.memory.lastUpdatedTurn, 0);
    assert.equal(payload.room.sceneActors[0].awareness, 'unaware');
  } finally {
    await server.close();
  }
});

test('authoritative scene delta survives invalid memory updates after a strong action', async () => {
  const server = await startTestServer({
    generateText: createMockGenerateText({ invalidMemoryUpdate: true }),
    rollD20: createRoller([16, 15, 19]),
  });

  try {
    const { created, joined } = await createRoomAndJoinPlayer(server.baseUrl);

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: created.participantId }),
    });

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: joined.participantId,
        content: 'беру меч, підкрадаюсь ззаду і ріжу горло вартовому',
      }),
    });

    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/roll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: joined.participantId }),
    });
    await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/roll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: joined.participantId }),
    });

    const damageRoll = await fetch(`${server.baseUrl}/api/rooms/${created.roomCode}/roll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: joined.participantId }),
    });

    assert.equal(damageRoll.status, 200);
    const payload = await damageRoll.json();
    assert.equal(payload.room.sceneActors[0].woundState, 'dead');
    assert.match(payload.room.memory.sceneSummary, /вбиває|мертв|dead/i);
  } finally {
    await server.close();
  }
});

test('ai status endpoint exposes provider configuration for the host studio', async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/api/ai/status`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.status.textProvider, 'nvidia');
    assert.equal(payload.status.parallelKeyCount, 1);
    assert.equal(payload.status.ttsProvider, null);
    assert.equal(payload.status.ttsReachable, false);
  } finally {
    await server.close();
  }
});

test('parallel text endpoint returns prompt results in source order', async () => {
  const server = await startTestServer({
    generateParallelPromptText: async (input) => {
      return input.prompts.map((prompt, index) => ({
        id: `job-${index}`,
        prompt,
        status: 'success',
        text: `result:${index}:${prompt}`,
        error: null,
        model: input.model ?? 'nvidia/llama-3.3-nemotron-super-49b-v1',
        provider: 'nvidia',
        durationMs: 10 + index,
        keySlot: null,
      }));
    },
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/ai/text/parallel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt: 'Return short answers.',
        model: 'nvidia/llama-3.3-nemotron-super-49b-v1',
        prompts: ['first prompt', 'second prompt', 'third prompt'],
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.results.length, 3);
    assert.equal(payload.results[0].prompt, 'first prompt');
    assert.equal(payload.results[1].text, 'result:1:second prompt');
    assert.equal(payload.results[2].keySlot, null);
  } finally {
    await server.close();
  }
});

test('image endpoint returns generated data urls for preview', async () => {
  const server = await startTestServer({
    generatePromptImage: async (input) => ({
      images: [
        `data:image/png;base64,${Buffer.from(`image-a:${input.prompt}`).toString('base64')}`,
        `data:image/png;base64,${Buffer.from(`image-b:${input.prompt}`).toString('base64')}`,
      ],
      text: 'render complete',
      model: input.model ?? 'google/gemini-2.5-flash-image-preview',
      provider: 'openrouter',
      durationMs: 12,
      keySlot: 1,
    }),
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/ai/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Dark city gate at dusk',
        model: 'google/gemini-2.5-flash-image-preview',
        aspectRatio: '16:9',
        imageSize: '1K',
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.images.length, 2);
    assert.match(payload.images[0], /^data:image\/png;base64,/);
    assert.equal(payload.keySlot, 1);
  } finally {
    await server.close();
  }
});

test('tts endpoint streams audio bytes and metadata headers', async () => {
  const server = await startTestServer({
    generateSpeech: async (input) => ({
      audioBuffer: Buffer.from(`audio:${input.input}`),
      contentType: 'audio/mpeg',
      fileName: 'speech.mp3',
      metadata: {
        provider: 'edge-tts',
        model: input.model ?? 'tts-1',
        voice: input.voice ?? 'uk-UA-PolinaNeural',
        durationMs: 9,
        format: input.responseFormat ?? 'mp3',
      },
    }),
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/ai/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'Gate holds.',
        voice: 'uk-UA-PolinaNeural',
        responseFormat: 'mp3',
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    assert.equal(response.headers.get('x-ai-provider'), 'edge-tts');
    assert.equal(response.headers.get('x-ai-voice'), 'uk-UA-PolinaNeural');

    const body = Buffer.from(await response.arrayBuffer()).toString('utf8');
    assert.equal(body, 'audio:Gate holds.');
  } finally {
    await server.close();
  }
});
