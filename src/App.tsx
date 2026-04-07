import { startTransition, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createRoom,
  joinRoom,
  saveCharacter,
  shouldReplaceRoom,
  startRoom,
  submitAction,
  submitRoll,
} from './api/rooms';
import { LandingScreen } from './components/landing/LandingScreen';
import { HostConsole } from './components/room/HostConsole';
import { PlayerRoomView } from './components/room/PlayerRoomView';
import { Banner } from './components/ui/Banner';
import { HeaderBar } from './components/ui/HeaderBar';
import { Panel } from './components/ui/Panel';
import { createDefaultHostForm } from './constants/room';
import { useRoomPolling } from './hooks/useRoomPolling';
import type { JoinRoomRequest, PlayerCharacter, Room } from './types';
import { getRoomPath, hasValidSessionForRoute, navigate, parseRoute, type RouteState } from './utils/route';
import { loadSession, persistSession, type StoredSession } from './utils/session';

export default function App() {
  const [route, setRoute] = useState<RouteState>(() => parseRoute(window.location.pathname));
  const [session, setSession] = useState<StoredSession | null>(() => loadSession());
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionInput, setActionInput] = useState('');
  const [hostForm, setHostForm] = useState(createDefaultHostForm);
  const [joinForm, setJoinForm] = useState<JoinRoomRequest>(() => ({
    roomCode: route.screen === 'player' ? route.roomCode : '',
    displayName: '',
  }));

  const hasValidSession = hasValidSessionForRoute(route, session);

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    persistSession(session);
  }, [session]);

  useEffect(() => {
    if (route.screen === 'player') {
      setJoinForm((current) => ({ ...current, roomCode: route.roomCode }));
    }
  }, [route]);

  useEffect(() => {
    if (route.screen === 'landing' && session) {
      const nextPath = getRoomPath(session.role, session.roomCode);
      navigate(nextPath, true);
      setRoute(parseRoute(nextPath));
    }
  }, [route, session]);

  useRoomPolling({
    enabled: hasValidSession,
    session,
    roomState: room?.state,
    onRoom: (nextRoom) => {
      startTransition(() => {
        setRoom((current) => (shouldReplaceRoom(current, nextRoom) ? nextRoom : current));
        setError(null);
      });
    },
    onError: setError,
  });

  const resetToLanding = (message?: string) => {
    setRoom(null);
    setSession(null);
    setError(null);
    setBusyKey(null);
    setActionInput('');
    if (message) {
      setNotice(message);
    }
    navigate('/', true);
    setRoute({ screen: 'landing' });
  };

  const copyRoomCode = (roomCode: string) => {
    if (!navigator.clipboard) {
      setNotice(`Код кімнати: ${roomCode}`);
      return;
    }

    void navigator.clipboard.writeText(roomCode)
      .then(() => setNotice(`Код ${roomCode} скопійовано.`))
      .catch(() => setNotice(`Код кімнати: ${roomCode}`));
  };

  const handleCreateRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyKey('create-room');
    setError(null);
    setNotice(null);

    try {
      const response = await createRoom({
        ...hostForm,
        hostName: hostForm.hostName.trim(),
        title: hostForm.title.trim(),
      });

      const nextSession: StoredSession = {
        participantId: response.participantId,
        role: response.role,
        roomCode: response.roomCode,
      };

      startTransition(() => {
        setSession(nextSession);
        setRoom(response.room);
        navigate(getRoomPath(response.role, response.roomCode));
        setRoute({ screen: 'host', roomCode: response.roomCode });
        setNotice(`Кімнату ${response.roomCode} створено.`);
      });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Не вдалося створити кімнату.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleJoinRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyKey('join-room');
    setError(null);
    setNotice(null);

    try {
      const response = await joinRoom({
        roomCode: joinForm.roomCode.trim().toUpperCase(),
        displayName: joinForm.displayName.trim(),
      });

      const nextSession: StoredSession = {
        participantId: response.participantId,
        role: response.role,
        roomCode: response.room.roomCode,
      };

      startTransition(() => {
        setSession(nextSession);
        setRoom(response.room);
        navigate(getRoomPath(response.role, response.room.roomCode));
        setRoute({ screen: 'player', roomCode: response.room.roomCode });
        setNotice(`Ви зайшли до кімнати ${response.room.roomCode}.`);
      });
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Не вдалося увійти до кімнати.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleStartGame = async () => {
    if (!session || !room) {
      return;
    }

    setBusyKey('start-game');
    setError(null);

    try {
      const response = await startRoom(room.roomCode, session.participantId);
      startTransition(() => {
        setRoom(response.room);
        setNotice('Гру запущено.');
      });
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Не вдалося запустити гру.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveCharacter = async (character: PlayerCharacter) => {
    if (!session || !room) {
      return;
    }

    setBusyKey(`save-${character.playerId}`);
    setError(null);

    try {
      const response = await saveCharacter(room.roomCode, {
        participantId: session.participantId,
        character,
      });
      startTransition(() => {
        setRoom(response.room);
        setNotice(`Персонажа ${character.displayName} оновлено.`);
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Не вдалося оновити персонажа.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleSubmitAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session || !room || !actionInput.trim()) {
      return;
    }

    setBusyKey('submit-action');
    setError(null);
    setNotice(null);

    try {
      const response = await submitAction(room.roomCode, {
        participantId: session.participantId,
        content: actionInput.trim(),
      });

      startTransition(() => {
        setRoom(response.room);
        setActionInput('');
      });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Не вдалося відправити дію.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleRoll = async () => {
    if (!session || !room) {
      return;
    }

    setBusyKey('roll');
    setError(null);

    try {
      const response = await submitRoll(room.roomCode, {
        participantId: session.participantId,
      });
      startTransition(() => {
        setRoom(response.room);
      });
    } catch (rollError) {
      setError(rollError instanceof Error ? rollError.message : 'Не вдалося кинути d20.');
    } finally {
      setBusyKey(null);
    }
  };

  const playerCharacter = session && room
    ? room.characters.find((character) => character.playerId === session.participantId) ?? null
    : null;

  const currentCheck = room?.pendingResolution
    ? room.pendingResolution.steps[room.pendingResolution.currentStepIndex] ?? null
    : null;
  const isOwnCurrentCheck = Boolean(
    room?.pendingResolution
      && currentCheck
      && session
      && room.pendingResolution.playerId === session.participantId,
  );
  const actionDisabled = busyKey !== null || !room || room.state !== 'in_game' || Boolean(room.pendingResolution);
  const landingInitialView = route.screen === 'player'
    ? 'player'
    : route.screen === 'host'
      ? 'host'
      : 'role';

  if (!hasValidSession) {
    return (
      <LandingScreen
        hostForm={hostForm}
        joinForm={joinForm}
        busyKey={busyKey}
        error={error}
        notice={notice}
        initialView={landingInitialView}
        onHostFormChange={setHostForm}
        onJoinFormChange={setJoinForm}
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
      />
    );
  }

  if (!room || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
        <Panel tone="main" className="w-full max-w-3xl rounded-sm p-6">
          <HeaderBar
            title="Завантаження кімнати"
            subtitle={`Підтягуємо актуальний стан кімнати ${route.screen === 'landing' ? '' : route.roomCode}.`}
          />
          {error ? <Banner tone="error" message={error} /> : null}
          <Panel tone="sub" className="p-6 text-center rpg-text">
            Зачекайте, триває синхронізація.
          </Panel>
        </Panel>
      </div>
    );
  }

  if (route.screen === 'player') {
    return (
      <PlayerRoomView
        room={room}
        viewerParticipantId={session.participantId}
        playerCharacter={playerCharacter}
        actionInput={actionInput}
        actionDisabled={actionDisabled}
        busyKey={busyKey}
        currentCheck={currentCheck}
        isOwnCurrentCheck={isOwnCurrentCheck}
        error={error}
        notice={notice}
        onActionInputChange={setActionInput}
        onSubmitAction={handleSubmitAction}
        onRoll={handleRoll}
        onCopyRoomCode={() => copyRoomCode(room.roomCode)}
        onLeaveRoom={() => resetToLanding('Сесію в браузері очищено.')}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
      <Panel tone="main" className="w-full max-w-7xl rounded-sm p-6">
        <div className="mb-6 flex flex-col gap-4 border-b-2 border-[#5c4033] pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[#d4af37]">Кімната {room.roomCode}</p>
            <h1 className="text-3xl rpg-title">{room.title}</h1>
            <p className="text-sm rpg-text">
              Панель майстра • {room.state === 'lobby' ? 'Лобі' : 'Гра в процесі'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rpg-button rpg-btn-dark rounded-sm px-4 py-2"
              onClick={() => copyRoomCode(room.roomCode)}
            >
              Скопіювати код
            </button>
            <button
              type="button"
              className="rpg-button rpg-btn-red rounded-sm px-4 py-2"
              onClick={() => resetToLanding('Сесію в браузері очищено.')}
            >
              Вийти
            </button>
          </div>
        </div>

        {notice ? <Banner tone="info" message={notice} /> : null}
        {error ? <Banner tone="error" message={error} /> : null}

        <HostConsole
          room={room}
          busyKey={busyKey}
          onStartGame={handleStartGame}
          onSaveCharacter={handleSaveCharacter}
        />
      </Panel>
    </div>
  );
}
