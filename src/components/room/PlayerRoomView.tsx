import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Backpack,
  Copy,
  Dices,
  LogOut,
  Send,
  Shield,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react';
import { MAX_PLAYERS_PER_ROOM } from '../../constants/room';
import { cn } from '../../lib/utils';
import type { CheckStep, PlayerCharacter, Room } from '../../types';
import { formatClockTime } from '../../utils/time';

type PlayerRoomViewProps = {
  room: Room;
  viewerParticipantId: string;
  playerCharacter: PlayerCharacter | null;
  actionInput: string;
  actionDisabled: boolean;
  busyKey: string | null;
  currentCheck: CheckStep | null;
  isOwnCurrentCheck: boolean;
  error: string | null;
  notice: string | null;
  onActionInputChange: (value: string) => void;
  onSubmitAction: (event: FormEvent<HTMLFormElement>) => void;
  onRoll: () => void;
  onCopyRoomCode: () => void;
  onLeaveRoom: () => void;
};

type PlayerTab = 'chat' | 'inventory' | 'bio';
type AlertTone = 'error' | 'info' | 'muted';

function StatBar({ label, value }: { label: string; value: number }) {
  const width = `${Math.min(100, Math.max(0, value * 6))}%`;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-amber-200/70">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-black/50 ring-1 ring-amber-500/20">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-500 via-amber-300 to-yellow-100" style={{ width }} />
      </div>
    </div>
  );
}

function StatusBanner({ tone, message }: { tone: AlertTone; message: string }) {
  const className = tone === 'error'
    ? 'border-red-400/30 bg-red-950/60 text-red-100'
    : tone === 'info'
      ? 'border-sky-400/20 bg-sky-950/30 text-sky-100'
      : 'border-amber-500/15 bg-black/25 text-zinc-300';

  return (
    <div className={cn('rounded-2xl border px-4 py-3 text-sm leading-6 shadow-[0_8px_24px_rgba(0,0,0,0.24)]', className)}>
      {message}
    </div>
  );
}

function describeRoll(result: number | null) {
  if (result === null) {
    return 'Натисни, коли майстер попросить кинути d20';
  }

  if (result >= 18) {
    return 'Критично сильний результат';
  }

  if (result >= 12) {
    return 'Успішний кидок';
  }

  if (result >= 7) {
    return 'Сумнівний результат';
  }

  return 'Невдалий кидок';
}

function getRoomStateLabel(room: Room) {
  if (room.state === 'lobby') {
    return 'Лобі';
  }

  return room.pendingResolution ? 'Перевірка' : 'В грі';
}

function getTurnLabel(room: Room, isOwnCurrentCheck: boolean, pendingPlayerName: string | null) {
  if (room.state === 'lobby') {
    return 'Очікування старту';
  }

  if (room.pendingResolution) {
    return isOwnCurrentCheck ? 'Твій кидок' : `Хід ${pendingPlayerName ?? 'іншого гравця'}`;
  }

  return 'Хід гравця';
}

function DiceWidget({
  room,
  currentCheck,
  canRoll,
  isRolling,
  pendingPlayerName,
  latestResult,
  latestConsequence,
  onRoll,
}: {
  room: Room;
  currentCheck: CheckStep | null;
  canRoll: boolean;
  isRolling: boolean;
  pendingPlayerName: string | null;
  latestResult: number | null;
  latestConsequence: string | null;
  onRoll: () => void;
}) {
  let status = describeRoll(latestResult);
  let details = latestConsequence;

  if (room.state === 'lobby') {
    status = 'Майстер ще не запустив гру';
    details = 'Поки що доступні журнал кімнати, інвентар і біографія персонажа.';
  } else if (isRolling) {
    status = 'Кубик крутиться...';
    details = currentCheck ? `${currentCheck.label}. Ставка: ${currentCheck.stakes}` : 'Зачекай на результат перевірки.';
  } else if (currentCheck) {
    details = `Ставка: ${currentCheck.stakes}`;

    if (canRoll) {
      status = `Твоя перевірка: ${currentCheck.label}`;
    } else if (room.pendingResolution) {
      status = `Чекаємо кидок: ${pendingPlayerName ?? 'інший гравець'}`;
    }
  }

  return (
    <div className="rounded-3xl border border-amber-500/20 bg-gradient-to-b from-[#17100c] to-[#0d0907] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-amber-300/60">Перевірка</p>
          <h3 className="font-serif text-lg text-amber-100">{currentCheck?.label ?? 'Кидок d20'}</h3>
        </div>
        <div className="rounded-full border border-amber-400/20 bg-amber-300/5 p-2 text-amber-200/80">
          <Dices className="h-5 w-5" />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] items-center gap-3">
        <div className="rounded-2xl border border-white/5 bg-black/30 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-400">Результат</div>
          <div className="mt-1 flex items-end gap-2">
            <AnimatePresence mode="wait">
              <motion.div
                key={isRolling ? 'rolling' : String(latestResult ?? 'empty')}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.18 }}
                className="text-4xl font-bold leading-none text-amber-100"
              >
                {isRolling ? '…' : latestResult ?? '--'}
              </motion.div>
            </AnimatePresence>
            <span className="pb-1 text-xs text-zinc-400">/ 20</span>
          </div>
          <p className="mt-2 text-sm text-zinc-200">{status}</p>
          {details ? <p className="mt-2 text-xs leading-5 text-zinc-400">{details}</p> : null}
        </div>

        <button
          type="button"
          onClick={onRoll}
          disabled={!canRoll}
          className={cn(
            'flex h-16 w-16 items-center justify-center rounded-2xl border text-amber-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_20px_rgba(0,0,0,0.35)] transition active:translate-y-[1px]',
            canRoll
              ? 'border-amber-400/30 bg-gradient-to-b from-amber-700 to-amber-900'
              : 'cursor-not-allowed border-white/5 bg-zinc-900/60 text-zinc-500 opacity-60',
          )}
        >
          <motion.div
            animate={isRolling ? { rotate: 360, scale: [1, 1.15, 1] } : { rotate: 0, scale: 1 }}
            transition={{ duration: 0.8 }}
          >
            <Dices className="h-7 w-7" />
          </motion.div>
        </button>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  viewerParticipantId,
}: {
  message: Room['messages'][number];
  viewerParticipantId: string;
}) {
  const isViewer = message.authorType === 'player' && message.authorId === viewerParticipantId;
  const isSystem = message.authorType === 'system';
  const isPlayer = message.authorType === 'player';
  const isHost = message.authorType === 'host';

  return (
    <div className={cn('flex', isViewer ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[88%] rounded-3xl px-4 py-3 shadow-[0_6px_20px_rgba(0,0,0,0.28)]',
          isViewer
            ? 'rounded-br-md border border-emerald-400/20 bg-gradient-to-br from-emerald-900/80 to-emerald-950 text-emerald-50'
            : isSystem
              ? 'border border-red-400/20 bg-gradient-to-br from-red-950/70 to-[#1c0d0d] text-red-100'
              : isPlayer
                ? 'border border-sky-400/20 bg-gradient-to-br from-sky-950/70 to-[#0e1620] text-sky-50'
                : isHost
                  ? 'border border-violet-400/15 bg-gradient-to-br from-[#1a1320] to-[#0d0a12] text-zinc-100'
                  : 'rounded-bl-md border border-amber-400/15 bg-gradient-to-br from-[#201611] to-[#0f0b09] text-zinc-100',
        )}
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <span
            className={cn(
              'text-[11px] uppercase tracking-[0.22em]',
              isViewer
                ? 'text-emerald-200/70'
                : isSystem
                  ? 'text-red-200/70'
                  : isPlayer
                    ? 'text-sky-200/70'
                    : isHost
                      ? 'text-violet-200/70'
                      : 'text-amber-200/70',
            )}
          >
            {message.authorName}
          </span>
          <span className="text-[10px] text-zinc-500">{formatClockTime(message.createdAt)}</span>
        </div>
        <p className="text-[15px] leading-6 whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
}

function InventoryTab({ playerCharacter }: { playerCharacter: PlayerCharacter | null }) {
  if (!playerCharacter) {
    return <StatusBanner tone="muted" message="Майстер ще формує лист персонажа. Інвентар з'явиться тут, щойно він буде готовий." />;
  }

  if (playerCharacter.inventory.length === 0) {
    return <StatusBanner tone="muted" message="Інвентар порожній. Перевір ще раз після наступної сцени або луту." />;
  }

  return (
    <div className="space-y-3">
      {playerCharacter.inventory.map((item) => (
        <div key={`${item.name}-${item.kind}`} className="rounded-2xl border border-amber-500/15 bg-black/25 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-serif text-base text-amber-100">{item.name}</h4>
              <p className="mt-1 text-xs uppercase tracking-[0.22em] text-amber-300/55">{item.kind}</p>
            </div>
            <div className="rounded-full border border-amber-400/15 bg-amber-300/5 px-2.5 py-1 text-sm text-amber-50">
              x{item.quantity}
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-300">{item.description}</p>
        </div>
      ))}
    </div>
  );
}

function BioTab({
  room,
  playerCharacter,
}: {
  room: Room;
  playerCharacter: PlayerCharacter | null;
}) {
  const pulseStats = [
    { label: 'Предмети', value: Math.min(16, (playerCharacter?.inventory.length ?? 0) * 4) },
    { label: 'Партія', value: Math.min(16, room.characters.length * 4) },
    { label: 'NPC сцени', value: Math.min(16, room.sceneActors.length * 4) },
    { label: 'Нитки сюжету', value: Math.min(16, room.memory.openThreads.length * 3) },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-500/15 bg-black/25 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-serif text-xl text-amber-100">{playerCharacter?.displayName ?? 'Персонаж готується'}</h3>
            <p className="mt-1 text-sm text-zinc-400">{playerCharacter?.classFantasy ?? 'Лист персонажа ще не заповнений'}</p>
          </div>
          <div className="rounded-full border border-amber-400/15 bg-amber-300/5 px-3 py-1 text-xs uppercase tracking-[0.18em] text-amber-200/75">
            {room.filters.tone}
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-zinc-300">
          {playerCharacter?.bioSummary ?? 'Майстер ще не додав короткий опис персонажа.'}
        </p>
      </div>

      <div className="rounded-2xl border border-amber-500/15 bg-black/25 p-4">
        <div className="mb-3 flex items-center gap-2 text-amber-100">
          <Sparkles className="h-4 w-4" />
          <h4 className="font-serif text-base">Мотивація</h4>
        </div>
        <p className="text-sm leading-6 text-zinc-300">
          {playerCharacter?.motivation ?? "Мотивація з'явиться після генерації або редагування персонажа."}
        </p>
      </div>

      <div className="rounded-2xl border border-amber-500/15 bg-black/25 p-4">
        <div className="mb-3 flex items-center gap-2 text-amber-100">
          <Shield className="h-4 w-4" />
          <h4 className="font-serif text-base">Пульс сесії</h4>
        </div>
        <div className="space-y-3">
          {pulseStats.map((stat) => (
            <div key={stat.label}>
              <StatBar label={stat.label} value={stat.value} />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-amber-500/15 bg-black/25 p-4">
        <div className="mb-3 flex items-center gap-2 text-amber-100">
          <Users className="h-4 w-4" />
          <h4 className="font-serif text-base">Кімната</h4>
        </div>
        <div className="space-y-2 text-sm leading-6 text-zinc-300">
          <p><span className="text-amber-100">Сетинг:</span> {room.filters.setting}</p>
          <p><span className="text-amber-100">Тип сесії:</span> {room.sessionType}</p>
          <p><span className="text-amber-100">Гравці:</span> {room.characters.length} / {MAX_PLAYERS_PER_ROOM}</p>
          <p><span className="text-amber-100">Локація:</span> {room.memory.activeLocation ?? 'Ще не визначено'}</p>
          <p><span className="text-amber-100">Оновлено:</span> {formatClockTime(room.updatedAt)}</p>
        </div>
      </div>

      {room.filters.worldConcept.trim() ? (
        <div className="rounded-2xl border border-amber-500/15 bg-black/25 p-4">
          <h4 className="font-serif text-base text-amber-100">Концепт світу</h4>
          <p className="mt-3 text-sm leading-6 whitespace-pre-wrap text-zinc-300">
            {room.filters.worldConcept}
          </p>
        </div>
      ) : null}

      <div className="rounded-2xl border border-amber-500/15 bg-black/25 p-4">
        <h4 className="font-serif text-base text-amber-100">Передісторія</h4>
        <p className="mt-3 text-sm leading-6 whitespace-pre-wrap text-zinc-300">
          {playerCharacter?.backstory ?? "Передісторія з'явиться після того, як майстер збереже картку персонажа."}
        </p>
      </div>

      {room.sceneActors.length > 0 ? (
        <div className="rounded-2xl border border-amber-500/15 bg-black/25 p-4">
          <h4 className="font-serif text-base text-amber-100">У сцені</h4>
          <div className="mt-3 space-y-3">
            {room.sceneActors.map((actor) => (
              <div key={actor.id} className="rounded-2xl border border-white/5 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-amber-100">{actor.name}</strong>
                  <span className="text-[11px] uppercase tracking-[0.2em] text-amber-300/65">{actor.kind}</span>
                </div>
                <p className="mt-2 text-sm text-zinc-300">{actor.role}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {actor.currentLocation} • {actor.awareness} • {actor.woundState}
                </p>
                {actor.notes ? <p className="mt-2 text-xs leading-5 text-zinc-400">{actor.notes}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PlayerRoomView({
  room,
  viewerParticipantId,
  playerCharacter,
  actionInput,
  actionDisabled,
  busyKey,
  currentCheck,
  isOwnCurrentCheck,
  error,
  notice,
  onActionInputChange,
  onSubmitAction,
  onRoll,
  onCopyRoomCode,
  onLeaveRoom,
}: PlayerRoomViewProps) {
  const [tab, setTab] = useState<PlayerTab>('chat');
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const pendingPlayerName = room.pendingResolution
    ? room.participants.find((participant) => participant.id === room.pendingResolution?.playerId)?.displayName ?? 'інший гравець'
    : null;
  const latestRoll = room.memory.recentRolls.at(-1) ?? null;
  const inventoryCount = playerCharacter?.inventory.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const canRoll = room.state === 'in_game' && isOwnCurrentCheck && busyKey === null;
  const submitLabel = busyKey === 'submit-action' ? 'Надсилаємо...' : 'Надіслати';
  const inputPlaceholder = room.state === 'lobby'
    ? 'Майстер ще не запустив гру...'
    : room.pendingResolution
      ? isOwnCurrentCheck
        ? 'Спершу заверши кидок d20 для поточної перевірки...'
        : `Чекаємо, поки ${pendingPlayerName ?? 'інший гравець'} завершить перевірку...`
      : 'Опиши дію персонажа...';

  useEffect(() => {
    if (tab !== 'chat' || !messagesRef.current) {
      return;
    }

    messagesRef.current.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [tab, room.messages.length]);

  const handleActionSubmit = (event: FormEvent<HTMLFormElement>) => {
    setTab('chat');
    onSubmitAction(event);
  };

  return (
    <div className="min-h-screen bg-[#090707] text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-[radial-gradient(circle_at_top,rgba(180,120,40,0.15),transparent_26%),linear-gradient(180deg,#140d09_0%,#090707_100%)] shadow-[0_0_60px_rgba(0,0,0,0.55)]">
        <header className="sticky top-0 z-20 border-b border-amber-500/15 bg-[#120c09]/90 px-4 pb-3 pt-[max(14px,env(safe-area-inset-top))] backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.32em] text-amber-300/55">Кімната {room.roomCode}</p>
              <h1 className="truncate font-serif text-xl text-amber-100">{room.title}</h1>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-300/5 px-3 py-1.5 text-sm text-amber-50">
              <Shield className="h-4 w-4" />
              {getRoomStateLabel(room)}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onCopyRoomCode}
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/5 bg-black/20 px-3 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-black/30"
            >
              <Copy className="h-4 w-4" />
              Код кімнати
            </button>
            <button
              type="button"
              onClick={onLeaveRoom}
              className="flex items-center justify-center gap-2 rounded-2xl border border-red-400/20 bg-red-950/20 px-3 py-2.5 text-sm font-medium text-red-100 transition hover:bg-red-950/30"
            >
              <LogOut className="h-4 w-4" />
              Вийти
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setTab('chat')}
              className={cn(
                'rounded-2xl px-3 py-2.5 text-sm font-medium transition',
                tab === 'chat' ? 'bg-amber-700 text-amber-50 shadow-lg' : 'border border-white/5 bg-black/20 text-zinc-300',
              )}
            >
              Чат
            </button>
            <button
              type="button"
              onClick={() => setTab('inventory')}
              className={cn(
                'rounded-2xl px-3 py-2.5 text-sm font-medium transition',
                tab === 'inventory' ? 'bg-amber-700 text-amber-50 shadow-lg' : 'border border-white/5 bg-black/20 text-zinc-300',
              )}
            >
              Інвентар
            </button>
            <button
              type="button"
              onClick={() => setTab('bio')}
              className={cn(
                'rounded-2xl px-3 py-2.5 text-sm font-medium transition',
                tab === 'bio' ? 'bg-amber-700 text-amber-50 shadow-lg' : 'border border-white/5 bg-black/20 text-zinc-300',
              )}
            >
              Біо
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-hidden px-3 pb-24 pt-3">
          <div className="flex h-full flex-col gap-3">
            {error ? <StatusBanner tone="error" message={error} /> : null}
            {notice ? <StatusBanner tone="info" message={notice} /> : null}

            <AnimatePresence mode="wait">
              {tab === 'chat' ? (
                <motion.div
                  key="chat"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18 }}
                  className="flex h-full flex-col gap-3"
                >
                  <DiceWidget
                    room={room}
                    currentCheck={currentCheck}
                    canRoll={canRoll}
                    isRolling={busyKey === 'roll'}
                    pendingPlayerName={pendingPlayerName}
                    latestResult={latestRoll?.result ?? null}
                    latestConsequence={latestRoll?.consequence ?? null}
                    onRoll={onRoll}
                  />

                  {room.pendingResolution && isOwnCurrentCheck ? (
                    <StatusBanner tone="info" message={`Твоя активна перевірка: ${currentCheck?.label ?? 'd20'}. Ставка: ${currentCheck?.stakes ?? 'очікуємо деталі від майстра'}.`} />
                  ) : null}

                  {room.pendingResolution && !isOwnCurrentCheck ? (
                    <StatusBanner tone="muted" message={`Зараз перевірку проходить ${pendingPlayerName ?? 'інший гравець'}. Нові дії тимчасово заблоковані.`} />
                  ) : null}

                  {room.state === 'lobby' ? (
                    <StatusBanner tone="muted" message="Гра ще не стартувала. Тут уже видно журнал кімнати, інвентар і біографію, а дії відкриються після запуску сесії." />
                  ) : null}

                  <div ref={messagesRef} className="custom-scrollbar flex-1 space-y-3 overflow-y-auto pr-1 pb-2">
                    {room.messages.map((message) => (
                      <div key={message.id}>
                        <MessageBubble message={message} viewerParticipantId={viewerParticipantId} />
                      </div>
                    ))}
                  </div>
                </motion.div>
              ) : null}

              {tab === 'inventory' ? (
                <motion.div
                  key="inventory"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18 }}
                  className="h-full overflow-y-auto pb-4 custom-scrollbar"
                >
                  <InventoryTab playerCharacter={playerCharacter} />
                </motion.div>
              ) : null}

              {tab === 'bio' ? (
                <motion.div
                  key="bio"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18 }}
                  className="h-full overflow-y-auto pb-4 custom-scrollbar"
                >
                  <BioTab room={room} playerCharacter={playerCharacter} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </main>

        <footer className="sticky bottom-0 z-20 border-t border-amber-500/15 bg-[#120c09]/92 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <form onSubmit={handleActionSubmit} className="flex items-end gap-2">
            <div className="flex-1 rounded-3xl border border-amber-500/15 bg-black/35 px-4 py-3 shadow-inner">
              <textarea
                value={actionInput}
                onChange={(event) => onActionInputChange(event.target.value)}
                rows={1}
                disabled={actionDisabled}
                placeholder={inputPlaceholder}
                className="max-h-28 w-full resize-none bg-transparent text-[15px] leading-6 text-zinc-100 outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:text-zinc-500"
              />
            </div>
            <button
              type="submit"
              disabled={actionDisabled || !actionInput.trim()}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b from-amber-600 to-amber-800 text-amber-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_10px_24px_rgba(0,0,0,0.35)] transition active:translate-y-[1px] disabled:cursor-not-allowed disabled:from-zinc-700 disabled:to-zinc-900 disabled:text-zinc-500"
              aria-label={submitLabel}
            >
              <Send className="h-5 w-5" />
            </button>
          </form>

          <div className="mt-3 flex items-center justify-between px-1 text-[11px] uppercase tracking-[0.22em] text-zinc-500">
            <div className="flex items-center gap-2">
              <Backpack className="h-3.5 w-3.5" />
              {inventoryCount} предметів
            </div>
            <div className="flex items-center gap-2">
              <UserRound className="h-3.5 w-3.5" />
              {getTurnLabel(room, isOwnCurrentCheck, pendingPlayerName)}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
