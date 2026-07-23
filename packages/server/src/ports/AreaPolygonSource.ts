import type { AlertAreaPolygon } from '@pyrmap/shared';

/** Best-effort boundary polygon for a free-text place-name query, for highlighting an area on the
 * map rather than just pinning a point. Returns null if the service found nothing, was
 * unreachable, timed out, or the top trusted-type match has no real boundary geometry (common for
 * small OSM-mapped hamlets stored as a point node, not a way/relation). */
export interface AreaPolygonSource {
  findAreaPolygon(query: string): Promise<AlertAreaPolygon | null>;
}
