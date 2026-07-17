import type { FiresResponse } from '@pyrmap/shared';

export async function fetchFires(hours: number): Promise<FiresResponse> {
  const response = await fetch(`/api/fires?hours=${hours}`);
  if (!response.ok) {
    throw new Error(`GET /api/fires failed: HTTP ${response.status}`);
  }
  return (await response.json()) as FiresResponse;
}
