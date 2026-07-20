import type { FiresResponse } from '@pyrmap/shared';

export async function fetchFires(hours: number): Promise<FiresResponse> {
  const response = await fetch(`/api/fires?hours=${hours}`);
  if (!response.ok) {
    throw new Error(`GET /api/fires failed: HTTP ${response.status}`);
  }
  return (await response.json()) as FiresResponse;
}

export interface AuthStatus {
  /** False when the server has no AUTH_* env vars set at all — open access, no login needed. */
  enabled: boolean;
  authenticated: boolean;
}

/** GET /api/me doesn't exist at all when auth is disabled server-side (404), vs a real "not logged in" (200, authenticated:false). */
export async function checkAuth(): Promise<AuthStatus> {
  const response = await fetch('/api/me');
  if (response.status === 404) {
    return { enabled: false, authenticated: true };
  }
  if (!response.ok) {
    return { enabled: true, authenticated: false };
  }
  const body = (await response.json()) as { authenticated: boolean };
  return { enabled: true, authenticated: body.authenticated };
}

export async function login(username: string, password: string): Promise<boolean> {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return response.ok;
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' });
}
