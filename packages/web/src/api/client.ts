import type { CivilProtectionAlert, FiresResponse, IncidentReport, LocationSearchResult } from '@pyrmap/shared';

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

interface RescanSourceResult {
  postsChecked: number;
  rowsInserted: number;
  postsSkippedAlreadyResolved: number;
  postsFailed: number;
  error: string | null;
}

export interface RescanResponse {
  satellite: { sourcesChanged: number };
  incidents: RescanSourceResult | null;
  alerts: RescanSourceResult | null;
}

export async function triggerRescan(hours: 6 | 12 | 24): Promise<RescanResponse> {
  const response = await fetch('/api/rescan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours }),
  });
  if (!response.ok) {
    throw new Error(`POST /api/rescan failed: HTTP ${response.status}`);
  }
  return (await response.json()) as RescanResponse;
}

export async function updateIncidentLocation(id: number, latitude: number, longitude: number): Promise<IncidentReport> {
  const response = await fetch(`/api/incidents/${id}/location`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude, longitude }),
  });
  if (!response.ok) {
    throw new Error(`PATCH /api/incidents/${id}/location failed: HTTP ${response.status}`);
  }
  return (await response.json()) as IncidentReport;
}

export async function hideIncident(id: number): Promise<void> {
  const response = await fetch(`/api/incidents/${id}/hide`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`POST /api/incidents/${id}/hide failed: HTTP ${response.status}`);
  }
}

export async function deleteIncident(id: number): Promise<void> {
  const response = await fetch(`/api/incidents/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`DELETE /api/incidents/${id} failed: HTTP ${response.status}`);
  }
}

export async function searchLocations(query: string): Promise<LocationSearchResult[]> {
  const response = await fetch(`/api/geocode/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    throw new Error(`GET /api/geocode/search failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { results: LocationSearchResult[] };
  return body.results;
}

export async function updateAlertLocation(id: number, latitude: number, longitude: number): Promise<CivilProtectionAlert> {
  const response = await fetch(`/api/alerts/${id}/location`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude, longitude }),
  });
  if (!response.ok) {
    throw new Error(`PATCH /api/alerts/${id}/location failed: HTTP ${response.status}`);
  }
  return (await response.json()) as CivilProtectionAlert;
}

export async function hideAlert(id: number): Promise<void> {
  const response = await fetch(`/api/alerts/${id}/hide`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`POST /api/alerts/${id}/hide failed: HTTP ${response.status}`);
  }
}

export async function deleteAlert(id: number): Promise<void> {
  const response = await fetch(`/api/alerts/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`DELETE /api/alerts/${id} failed: HTTP ${response.status}`);
  }
}
