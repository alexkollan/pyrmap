import type { FireAlertCircle } from '../../ports/FireAlertSource.js';

export interface ParsedCapAlert {
  /** Sensing start (<effective>), normalized to ISO 8601 UTC with Z suffix. */
  acquiredAt: string | null;
  circles: FireAlertCircle[];
}

const EFFECTIVE_RE = /<effective>([^<]+)<\/effective>/;
const CIRCLE_RE = /<circle>\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*<\/circle>/g;

/**
 * Parses an EUMETSAT MTG FCI Active Fire Monitoring CAP bulletin (machine-generated XML;
 * one <circle>lat,lon radiusKm</circle> per detected fire pixel). Regex is deliberate: the
 * format is fixed by the producing processor and a full XML parser would be a new dependency.
 */
export function parseFireCap(xml: string): ParsedCapAlert {
  const effectiveMatch = EFFECTIVE_RE.exec(xml);
  const acquiredAt = effectiveMatch ? normalizeToUtcIso(effectiveMatch[1]!.trim()) : null;

  const circles: FireAlertCircle[] = [];
  for (const match of xml.matchAll(CIRCLE_RE)) {
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    const radiusKm = Number(match[3]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude) && Number.isFinite(radiusKm)) {
      circles.push({ latitude, longitude, radiusKm });
    }
  }

  return { acquiredAt, circles };
}

/** "2026-07-18T09:20:00+00:00" -> "2026-07-18T09:20:00Z"; returns null for unparseable input. */
function normalizeToUtcIso(value: string): string | null {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
