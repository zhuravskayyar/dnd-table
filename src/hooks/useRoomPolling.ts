import { useEffect, useEffectEvent } from 'react';
import { fetchRoomState } from '../api/rooms';
import type { Room } from '../types';
import type { StoredSession } from '../utils/session';

type UseRoomPollingParams = {
  enabled: boolean;
  session: StoredSession | null;
  roomState: Room['state'] | undefined;
  onRoom: (room: Room) => void;
  onError: (message: string) => void;
};

export function useRoomPolling({
  enabled,
  session,
  roomState,
  onRoom,
  onError,
}: UseRoomPollingParams) {
  const handleRoom = useEffectEvent(onRoom);
  const handleError = useEffectEvent(onError);

  useEffect(() => {
    if (!enabled || !session) return;

    let cancelled = false;
    let pollInFlight = false;

    const poll = async () => {
      if (pollInFlight) return;

      pollInFlight = true;
      try {
        const response = await fetchRoomState(session.roomCode, session.participantId);
        if (!cancelled) {
          handleRoom(response.room);
        }
      } catch (error) {
        if (!cancelled) {
          handleError(error instanceof Error ? error.message : 'Не вдалося оновити стан кімнати.');
        }
      } finally {
        pollInFlight = false;
      }
    };

    void poll();
    const interval = window.setInterval(poll, roomState === 'in_game' ? 1000 : 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, handleError, handleRoom, roomState, session]);
}
