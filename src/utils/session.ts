export type StoredSession = {
  participantId: string;
  role: 'host' | 'player';
  roomCode: string;
};

const SESSION_STORAGE_KEY = 'rpg-room-session';

export function loadSession(): StoredSession | null {
  const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export function persistSession(session: StoredSession | null) {
  if (!session) {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}
