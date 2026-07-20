import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFrpPixelList } from '../src/adapters/lsasaf/frpPixelParser.js';

// Real LSA SAF MSG FRP-PIXEL "ListProduct" file for 2026-07-20T08:45:00Z, downloaded live and
// verified by hand (see docs/DECISIONS.md 2026-07-20). Contains real Greece-area detections.
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const FIXTURE_PATH = path.join(fixturesDir, 'msg_frp_pixel_sample.h5');

describe('parseFrpPixelList', () => {
  it('decodes real lat/lon/FRP/confidence values using each dataset\'s own scaling attrs', async () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const circles = await parseFrpPixelList(buffer);

    expect(circles.length).toBeGreaterThan(100);

    // A real, sustained detection in the Aegean at this timestamp (verified live).
    const hit = circles.find((c) => Math.abs(c.latitude - 39.7) < 0.01 && Math.abs(c.longitude - 29.07) < 0.01);
    expect(hit).toBeDefined();
    expect(hit!.frpMw).toBeCloseTo(111.5, 0);
    expect(hit!.confidence).toBeCloseTo(0.86, 1);
    expect(hit!.radiusKm).toBeGreaterThan(0);

    // A real Peloponnese (Greece proper) detection at this timestamp.
    const peloponnese = circles.find((c) => Math.abs(c.latitude - 37.4) < 0.01 && Math.abs(c.longitude - 22.1) < 0.01);
    expect(peloponnese).toBeDefined();
    expect(peloponnese!.frpMw).toBeCloseTo(69.4, 0);
  });

  it('produces plausible geographic values, not raw unscaled integers', async () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const circles = await parseFrpPixelList(buffer);

    for (const circle of circles) {
      expect(circle.latitude).toBeGreaterThanOrEqual(-90);
      expect(circle.latitude).toBeLessThanOrEqual(90);
      expect(circle.longitude).toBeGreaterThanOrEqual(-180);
      expect(circle.longitude).toBeLessThanOrEqual(180);
    }
  });
});
