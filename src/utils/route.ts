import type { StoredSession } from './session';

export type RouteState =
  | { screen: 'landing' }
  | { screen: 'host'; roomCode: string }
  | { screen: 'player'; roomCode: string };

export function parseRoute(pathname: string): RouteState {
  const cleaned = pathname.replace(/\/+$/, '') || '/';
  const hostMatch = cleaned.match(/^\/host\/([A-Z0-9]{1,})$/i);
  if (hostMatch) {
    return { screen: 'host', roomCode: hostMatch[1].toUpperCase() };
  }

  const roomMatch = cleaned.match(/^\/room\/([A-Z0-9]{1,})$/i);
  if (roomMatch) {
    return { screen: 'player', roomCode: roomMatch[1].toUpperCase() };
  }

  return { screen: 'landing' };
}

export function navigate(path: string, replace = false) {
  if (replace) {
    window.history.replaceState(null, '', path);
    return;
  }

  window.history.pushState(null, '', path);
}

export function getRoomPath(role: StoredSession['role'], roomCode: string) {
  return role === 'host' ? `/host/${roomCode}` : `/room/${roomCode}`;
}

export function hasValidSessionForRoute(route: RouteState, session: StoredSession | null) {
  return route.screen !== 'landing'
    && session !== null
    && session.roomCode === route.roomCode
    && session.role === route.screen;
}
