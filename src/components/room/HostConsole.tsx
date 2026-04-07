import { useState } from 'react';
import { MAX_PLAYERS_PER_ROOM } from '../../constants/room';
import type { PlayerCharacter, Room } from '../../types';
import { cn } from '../../lib/utils';
import { formatClockTime } from '../../utils/time';
import { HostCharacterEditor } from './HostCharacterEditor';
import { HostCodexPanel } from './HostCodexPanel';
import { MessageLog } from './MessageLog';
import { SectionCard } from '../ui/SectionCard';
import { SectionPanel } from '../ui/SectionPanel';

type HostConsoleProps = {
  room: Room;
  busyKey: string | null;
  onStartGame: () => void;
  onSaveCharacter: (character: PlayerCharacter) => Promise<void> | void;
};

type HostTab = 'overview' | 'characters' | 'tools';

function getRoomStateLabel(room: Room) {
  if (room.state === 'lobby') {
    return 'Лобі';
  }

  return room.pendingResolution ? 'Активна перевірка' : 'У грі';
}

function OverviewMetric({
  label,
  value,
  accent = 'default',
}: {
  label: string;
  value: string;
  accent?: 'default' | 'gold' | 'blue';
}) {
  const accentClass = accent === 'gold'
    ? 'text-[#f3deac]'
    : accent === 'blue'
      ? 'text-[#d6e8ff]'
      : 'text-[#e6d5c3]';

  return (
    <SectionCard className="h-full">
      <div className="text-[11px] uppercase tracking-[0.22em] text-[#d4af37]/70">{label}</div>
      <div className={cn('mt-2 text-lg font-semibold', accentClass)}>{value}</div>
    </SectionCard>
  );
}

function HostOverview({
  room,
  busyKey,
  onStartGame,
}: {
  room: Room;
  busyKey: string | null;
  onStartGame: () => void;
}) {
  const playerParticipants = room.participants.filter((participant) => participant.role === 'player');
  const pendingPlayerName = room.pendingResolution
    ? room.participants.find((participant) => participant.id === room.pendingResolution?.playerId)?.displayName ?? 'Невідомий'
    : null;
  const currentCheck = room.pendingResolution
    ? room.pendingResolution.steps[room.pendingResolution.currentStepIndex] ?? null
    : null;
  const currentTarget = currentCheck?.targetActorId
    ? room.sceneActors.find((actor) => actor.id === currentCheck.targetActorId) ?? null
    : null;
  const visibleThreads = room.memory.openThreads.slice(0, 3);
  const sceneSummary = room.memory.sceneSummary || room.memory.campaignSummary || 'Майстер ще не підготував короткий опис поточної сцени.';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OverviewMetric label="Код кімнати" value={room.roomCode} accent="gold" />
        <OverviewMetric label="Стан" value={getRoomStateLabel(room)} accent="blue" />
        <OverviewMetric label="Гравці" value={`${playerParticipants.length} / ${MAX_PLAYERS_PER_ROOM}`} />
        <OverviewMetric label="Оновлено" value={formatClockTime(room.updatedAt)} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.15fr]">
        <SectionPanel
          title="Гравці"
          subtitle={room.state === 'lobby'
            ? 'Поки гра не стартувала, тут видно склад кімнати та готовність до запуску.'
            : 'Після старту тут залишається короткий огляд активних гравців.'}
          actions={room.state === 'lobby' ? (
            <button
              type="button"
              className="rpg-button rpg-btn-green rounded-sm px-4 py-3"
              onClick={onStartGame}
              disabled={busyKey !== null || room.state !== 'lobby' || room.characters.length === 0}
            >
              {busyKey === 'start-game' ? 'Запускаємо...' : 'Почати гру'}
            </button>
          ) : null}
        >
          {playerParticipants.length === 0 ? (
            <SectionCard className="text-sm rpg-text">
              Гравці ще не приєдналися. Передайте код кімнати і дочекайтеся першого входу.
            </SectionCard>
          ) : (
            <div className="space-y-3">
              {playerParticipants.map((participant) => {
                const character = room.characters.find((entry) => entry.playerId === participant.id) ?? null;

                return (
                  <div key={participant.id}>
                    <SectionCard className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-lg text-[#f3deac]">{participant.displayName}</div>
                        <div className="mt-1 text-sm text-[#d4af37]">
                          {character?.classFantasy ?? 'Персонаж ще генерується'}
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[#c6b39f]">
                          {character?.bioSummary ?? "Щойно генерація завершиться, тут з'явиться короткий опис персонажа."}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-xs uppercase tracking-[0.18em] text-[#bba389]">
                        <div>{character ? 'Готовий' : 'Підготовка'}</div>
                        <div className="mt-1">Увійшов {formatClockTime(participant.joinedAt)}</div>
                      </div>
                    </SectionCard>
                  </div>
                );
              })}
            </div>
          )}
        </SectionPanel>

        <div className="space-y-6">
          <SectionPanel title="Поточна сцена" subtitle={room.memory.activeLocation ? `Локація: ${room.memory.activeLocation}` : 'Локація ще не визначена.'}>
            <SectionCard className="text-sm leading-7 rpg-text whitespace-pre-wrap">
              {sceneSummary}
            </SectionCard>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <SectionCard>
                <div className="text-xs uppercase tracking-[0.22em] text-[#d4af37]">Відкриті нитки</div>
                {visibleThreads.length === 0 ? (
                  <p className="mt-3 text-sm text-[#c6b39f]">Зараз немає відкритих ниток або вони ще не зафіксовані в пам'яті сесії.</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm text-[#e6d5c3]">
                    {visibleThreads.map((thread) => (
                      <li key={thread}>{thread}</li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <SectionCard>
                <div className="text-xs uppercase tracking-[0.22em] text-[#d4af37]">Тон і рамка</div>
                <div className="mt-3 space-y-2 text-sm text-[#e6d5c3]">
                  <div><strong>Сетинг:</strong> {room.filters.setting}</div>
                  <div><strong>Тон:</strong> {room.filters.tone}</div>
                  <div><strong>Тип сесії:</strong> {room.sessionType}</div>
                  <div><strong>Ліміт гравців:</strong> {MAX_PLAYERS_PER_ROOM}</div>
                </div>
              </SectionCard>
            </div>

            {room.filters.worldConcept.trim() ? (
              <SectionCard className="mt-4">
                <div className="text-xs uppercase tracking-[0.22em] text-[#d4af37]">Концепт світу</div>
                <p className="mt-3 text-sm leading-7 text-[#e6d5c3] whitespace-pre-wrap">
                  {room.filters.worldConcept}
                </p>
              </SectionCard>
            ) : null}
          </SectionPanel>

          <SectionPanel title="Активна перевірка" subtitle="Показує тільки поточний тактичний стан, без другорядних панелей.">
            {room.pendingResolution && currentCheck ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <SectionCard>
                  <div className="text-xs uppercase tracking-[0.22em] text-[#d4af37]">Зараз кидає</div>
                  <div className="mt-2 text-lg text-[#f3deac]">{pendingPlayerName}</div>
                  <div className="mt-3 space-y-2 text-sm text-[#e6d5c3]">
                    <div><strong>Крок:</strong> {room.pendingResolution.currentStepIndex + 1}/{room.pendingResolution.steps.length}</div>
                    <div><strong>Перевірка:</strong> {currentCheck.label}</div>
                    <div><strong>Тип:</strong> {currentCheck.type}</div>
                    <div><strong>Ставка:</strong> {currentCheck.stakes}</div>
                    {currentCheck.itemName ? <div><strong>Предмет:</strong> {currentCheck.itemName}</div> : null}
                    {currentTarget ? <div><strong>Ціль:</strong> {currentTarget.name}</div> : null}
                  </div>
                </SectionCard>

                <SectionCard>
                  <div className="text-xs uppercase tracking-[0.22em] text-[#d4af37]">Історія поточної дії</div>
                  {room.pendingResolution.resolvedChecks.length === 0 ? (
                    <p className="mt-3 text-sm text-[#c6b39f]">Це перший крок ланцюжка. Чекаємо перший результат d20.</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {room.pendingResolution.resolvedChecks.map((check) => (
                        <div key={check.stepId} className="border-b border-[#2b2018] pb-3 last:border-b-0 last:pb-0">
                          <div className="text-sm text-[#f3deac]">
                            {check.type}: {check.result} ({check.outcome})
                          </div>
                          <div className="mt-1 text-sm leading-6 text-[#c6b39f]">{check.consequence}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>
            ) : (
              <SectionCard className="text-sm rpg-text">
                Активної перевірки зараз немає. Основний фокус на журналі кімнати та короткому стані сцени.
              </SectionCard>
            )}
          </SectionPanel>
        </div>
      </div>

      <MessageLog messages={room.messages} />
    </div>
  );
}

function HostCharacters({
  room,
  busyKey,
  onSaveCharacter,
}: {
  room: Room;
  busyKey: string | null;
  onSaveCharacter: (character: PlayerCharacter) => Promise<void> | void;
}) {
  const canEdit = room.state === 'lobby' && busyKey === null;

  return (
    <SectionPanel
      title="Персонажі"
      subtitle={room.state === 'lobby'
        ? 'У лобі хост може редагувати листи персонажів перед стартом гри.'
        : 'Після старту гри всі листи доступні тільки для перегляду.'}
    >
      {room.characters.length === 0 ? (
        <SectionCard className="text-sm rpg-text">
          Тут з'являться персонажі після входу перших гравців до кімнати.
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {room.characters.map((character) => (
            <div key={character.playerId}>
              <HostCharacterEditor
                character={character}
                disabled={!canEdit}
                busy={busyKey === `save-${character.playerId}`}
                onSave={onSaveCharacter}
              />
            </div>
          ))}
        </div>
      )}
    </SectionPanel>
  );
}

export function HostConsole({
  room,
  busyKey,
  onStartGame,
  onSaveCharacter,
}: HostConsoleProps) {
  const [tab, setTab] = useState<HostTab>('overview');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <button
          type="button"
          onClick={() => setTab('overview')}
          className={cn(
            'rounded-sm border px-4 py-3 text-sm uppercase tracking-[0.22em] transition',
            tab === 'overview'
              ? 'border-[#d4af37] bg-[rgba(212,175,55,0.12)] text-[#f3deac]'
              : 'border-[#3a281c] bg-[#0a0705] text-[#bba389] hover:bg-[#120d0a]',
          )}
        >
          Огляд
        </button>
        <button
          type="button"
          onClick={() => setTab('characters')}
          className={cn(
            'rounded-sm border px-4 py-3 text-sm uppercase tracking-[0.22em] transition',
            tab === 'characters'
              ? 'border-[#d4af37] bg-[rgba(212,175,55,0.12)] text-[#f3deac]'
              : 'border-[#3a281c] bg-[#0a0705] text-[#bba389] hover:bg-[#120d0a]',
          )}
        >
          Персонажі
        </button>
        <button
          type="button"
          onClick={() => setTab('tools')}
          className={cn(
            'rounded-sm border px-4 py-3 text-sm uppercase tracking-[0.22em] transition',
            tab === 'tools'
              ? 'border-[#d4af37] bg-[rgba(212,175,55,0.12)] text-[#f3deac]'
              : 'border-[#3a281c] bg-[#0a0705] text-[#bba389] hover:bg-[#120d0a]',
          )}
        >
          Інструменти
        </button>
      </div>

      {tab === 'overview' ? (
        <HostOverview room={room} busyKey={busyKey} onStartGame={onStartGame} />
      ) : null}

      {tab === 'characters' ? (
        <HostCharacters room={room} busyKey={busyKey} onSaveCharacter={onSaveCharacter} />
      ) : null}

      {tab === 'tools' ? <HostCodexPanel room={room} /> : null}
    </div>
  );
}
