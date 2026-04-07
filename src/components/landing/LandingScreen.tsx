import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ChevronLeft, Crown, UserRound } from 'lucide-react';
import { LANGUAGE_OPTIONS, MAX_PLAYERS_PER_ROOM, SESSION_TYPE_OPTIONS } from '../../constants/room';
import type { CreateRoomRequest, JoinRoomRequest } from '../../types';
import { Banner } from '../ui/Banner';
import { FilterEditor } from '../ui/FilterEditor';
import { FormField } from '../ui/FormField';
import { HeaderBar } from '../ui/HeaderBar';
import { Panel } from '../ui/Panel';
import { SectionCard } from '../ui/SectionCard';

export type LandingScreenView = 'role' | 'host' | 'player';

type LandingScreenProps = {
  hostForm: CreateRoomRequest;
  joinForm: JoinRoomRequest;
  busyKey: string | null;
  error: string | null;
  notice: string | null;
  initialView: LandingScreenView;
  onHostFormChange: (updater: (current: CreateRoomRequest) => CreateRoomRequest) => void;
  onJoinFormChange: (updater: (current: JoinRoomRequest) => JoinRoomRequest) => void;
  onCreateRoom: (event: FormEvent<HTMLFormElement>) => void;
  onJoinRoom: (event: FormEvent<HTMLFormElement>) => void;
};

function RoleCard({
  title,
  description,
  detail,
  accent,
  icon,
  onClick,
}: {
  title: string;
  description: string;
  detail: string;
  accent: 'blue' | 'gold';
  icon: ReactNode;
  onClick: () => void;
}) {
  const accentClass = accent === 'gold'
    ? 'border-[#d4af37] bg-[radial-gradient(circle_at_top,rgba(212,175,55,0.12),transparent_45%),linear-gradient(180deg,#17100c_0%,#0a0705_100%)] text-[#f3deac]'
    : 'border-[#4a8bd4] bg-[radial-gradient(circle_at_top,rgba(74,139,212,0.12),transparent_45%),linear-gradient(180deg,#101723_0%,#0a0705_100%)] text-[#d6e8ff]';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex h-full flex-col rounded-sm border p-6 text-left transition hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(0,0,0,0.35)] ${accentClass}`}
    >
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-sm border border-current/30 bg-black/20">
          {icon}
        </div>
        <span className="text-xs uppercase tracking-[0.26em] text-current/70">Обрати роль</span>
      </div>
      <h2 className="mb-3 text-2xl rpg-title">{title}</h2>
      <p className="mb-4 text-base leading-6 text-current/90">{description}</p>
      <p className="mt-auto text-sm leading-6 text-current/70">{detail}</p>
    </button>
  );
}

function ChangeRoleButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-4 inline-flex items-center gap-2 rounded-sm border border-[#5c4033] bg-[rgba(10,7,5,0.85)] px-3 py-2 text-sm text-[#d4af37] transition hover:bg-[rgba(20,14,10,0.95)]"
    >
      <ChevronLeft className="h-4 w-4" />
      Змінити роль
    </button>
  );
}

function HostEntryForm({
  hostForm,
  busyKey,
  onHostFormChange,
  onCreateRoom,
}: {
  hostForm: CreateRoomRequest;
  busyKey: string | null;
  onHostFormChange: LandingScreenProps['onHostFormChange'];
  onCreateRoom: LandingScreenProps['onCreateRoom'];
}) {
  return (
    <Panel as="section" tone="sub" className="p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl rpg-title">Панель хоста</h2>
          <p className="mt-1 text-sm rpg-text">
            Створи кімнату, задай рамки кампанії та запроси гравців за кодом.
          </p>
        </div>
        <div className="rounded-sm border border-[#d4af37]/30 bg-[rgba(212,175,55,0.08)] px-3 py-1 text-xs uppercase tracking-[0.24em] text-[#d4af37]">
          Хост
        </div>
      </div>

      <form onSubmit={onCreateRoom} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Ім'я хоста">
            <input
              className="rpg-input"
              value={hostForm.hostName}
              onChange={(event) => onHostFormChange((current) => ({ ...current, hostName: event.target.value }))}
            />
          </FormField>
          <FormField label="Назва кампанії">
            <input
              className="rpg-input"
              value={hostForm.title}
              onChange={(event) => onHostFormChange((current) => ({ ...current, title: event.target.value }))}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[0.9fr_1.1fr]">
          <FormField label="Мова">
            <select
              className="rpg-input"
              value={hostForm.language}
              onChange={(event) => onHostFormChange((current) => ({ ...current, language: event.target.value }))}
            >
              {LANGUAGE_OPTIONS.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Тип сесії">
            <div className="grid grid-cols-3 gap-2">
              {SESSION_TYPE_OPTIONS.map((sessionType) => (
                <button
                  key={sessionType}
                  type="button"
                  className={`rpg-button rounded-sm py-2 ${
                    hostForm.sessionType === sessionType ? 'rpg-btn-blue' : 'rpg-btn-dark'
                  }`}
                  onClick={() => onHostFormChange((current) => ({ ...current, sessionType }))}
                >
                  {sessionType}
                </button>
              ))}
            </div>
          </FormField>
        </div>

        <FilterEditor
          filters={hostForm.filters}
          onChange={(filters) => onHostFormChange((current) => ({ ...current, filters }))}
        />

        <button
          type="submit"
          disabled={
            busyKey !== null ||
            !hostForm.hostName.trim() ||
            !hostForm.title.trim() ||
            !hostForm.filters.setting ||
            !hostForm.filters.tone ||
            !hostForm.filters.structure ||
            !hostForm.filters.combatIntensity ||
            !hostForm.filters.magicLevel ||
            !hostForm.filters.darknessLevel
          }
          className="rpg-button rpg-btn-green w-full rounded-sm py-3"
        >
          {busyKey === 'create-room' ? 'Створюємо кімнату...' : 'Створити кімнату'}
        </button>
      </form>
    </Panel>
  );
}

function PlayerEntryForm({
  joinForm,
  busyKey,
  onJoinFormChange,
  onJoinRoom,
}: {
  joinForm: JoinRoomRequest;
  busyKey: string | null;
  onJoinFormChange: LandingScreenProps['onJoinFormChange'];
  onJoinRoom: LandingScreenProps['onJoinRoom'];
}) {
  return (
    <Panel as="section" tone="sub" className="mx-auto w-full max-w-2xl p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl rpg-title">Вхід гравця</h2>
          <p className="mt-1 text-sm rpg-text">
            Увійди до кімнати за кодом та отримай свій автоматично згенерований лист персонажа.
          </p>
        </div>
        <div className="rounded-sm border border-[#4a8bd4]/30 bg-[rgba(74,139,212,0.08)] px-3 py-1 text-xs uppercase tracking-[0.24em] text-[#4a8bd4]">
          Гравець
        </div>
      </div>

      <form onSubmit={onJoinRoom} className="space-y-4">
        <FormField label="Код кімнати">
          <input
            className="rpg-input uppercase"
            value={joinForm.roomCode}
            onChange={(event) => onJoinFormChange((current) => ({
              ...current,
              roomCode: event.target.value.toUpperCase(),
            }))}
          />
        </FormField>
        <FormField label="Ім'я гравця">
          <input
            className="rpg-input"
            value={joinForm.displayName}
            onChange={(event) => onJoinFormChange((current) => ({ ...current, displayName: event.target.value }))}
          />
        </FormField>
        <SectionCard className="text-sm rpg-text leading-6">
          Після входу сервер одразу згенерує вам біо, мотивацію, рольову фантазію та стартовий інвентар.
          На сторінці гравця ви побачите тільки свій актуальний стан, чат і поточні дії.
          У кімнаті може бути максимум {MAX_PLAYERS_PER_ROOM} гравців, а кожен новий герой створюється як окрема унікальна картка.
        </SectionCard>
        <button
          type="submit"
          disabled={busyKey !== null}
          className="rpg-button rpg-btn-blue w-full rounded-sm py-3"
        >
          {busyKey === 'join-room' ? 'Входимо до кімнати...' : 'Увійти в кімнату'}
        </button>
      </form>
    </Panel>
  );
}

export function LandingScreen({
  hostForm,
  joinForm,
  busyKey,
  error,
  notice,
  initialView,
  onHostFormChange,
  onJoinFormChange,
  onCreateRoom,
  onJoinRoom,
}: LandingScreenProps) {
  const [view, setView] = useState<LandingScreenView>(initialView);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  return (
    <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
      <Panel tone="main" className="w-full max-w-6xl rounded-sm p-6">
        <HeaderBar
          title="Кімнати майстра"
          subtitle="Спочатку оберіть роль, а далі працюйте тільки з тим інтерфейсом, який потрібен саме вам."
        />

        {notice ? <Banner tone="info" message={notice} /> : null}
        {error ? <Banner tone="error" message={error} /> : null}

        {view === 'role' ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <RoleCard
              title="Я хост"
              description="Створити кімнату, керувати сценами, запускати гру та вести журнал сесії."
              detail="Після створення кімнати відкриється нова мінімальна панель хоста з оглядом, персонажами та інструментами."
              accent="gold"
              icon={<Crown className="h-6 w-6" />}
              onClick={() => setView('host')}
            />
            <RoleCard
              title="Я гравець"
              description="Увійти до існуючої кімнати за кодом і грати через компактний інтерфейс персонажа."
              detail="Підійде для швидкого входу з телефону чи вузького екрана: чат, інвентар, біо та дії персонажа."
              accent="blue"
              icon={<UserRound className="h-6 w-6" />}
              onClick={() => setView('player')}
            />
          </div>
        ) : null}

        {view === 'host' ? (
          <>
            <ChangeRoleButton onClick={() => setView('role')} />
            <HostEntryForm
              hostForm={hostForm}
              busyKey={busyKey}
              onHostFormChange={onHostFormChange}
              onCreateRoom={onCreateRoom}
            />
          </>
        ) : null}

        {view === 'player' ? (
          <>
            <ChangeRoleButton onClick={() => setView('role')} />
            <PlayerEntryForm
              joinForm={joinForm}
              busyKey={busyKey}
              onJoinFormChange={onJoinFormChange}
              onJoinRoom={onJoinRoom}
            />
          </>
        ) : null}
      </Panel>
    </div>
  );
}
