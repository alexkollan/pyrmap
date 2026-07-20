// h5wasm: WASM-compiled HDF5 (no native build step, portable to Windows dev machines). LSA SAF's
// FRP-PIXEL product ships only as HDF5 (no NetCDF/OPeNDAP option) — see docs/DECISIONS.md 2026-07-20.
import { File, Dataset, ready } from 'h5wasm/node';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FireAlertCircle } from '../../ports/FireAlertSource.js';

let readyPromise: Promise<unknown> | null = null;

/** Applies a dataset's own SCALING_FACTOR/OFFSET/MISSING_VALUE attrs: real = raw/scale + offset. */
function realValues(file: File, datasetName: string): (number | null)[] {
  const ds = file.get(datasetName);
  if (!(ds instanceof Dataset)) {
    throw new Error(`FRP-PIXEL file missing expected dataset "${datasetName}"`);
  }
  const scale = Number(ds.attrs.SCALING_FACTOR.value);
  const offset = Number(ds.attrs.OFFSET.value);
  const missing = Number(ds.attrs.MISSING_VALUE.value);
  const raw = ds.value as ArrayLike<number> | null;
  if (raw === null) return [];
  return Array.from(raw).map((v) => (v === missing ? null : v / scale + offset));
}

/** Fallback pixel diameter (km) if a row's own PIXEL_SIZE is missing — matches the nominal 3km spec. */
const DEFAULT_PIXEL_SIZE_KM = 3;

/**
 * Parses an LSA SAF MSG SEVIRI FRP-PIXEL "ListProduct" HDF5 file: one row per detected fire
 * pixel, no significance threshold applied upstream (unlike the EUMETSAT CAP alert bulletin).
 * Field names and the SCALING_FACTOR/OFFSET/MISSING_VALUE convention were verified against a
 * real downloaded file, 2026-07-20 — see docs/DECISIONS.md.
 */
export async function parseFrpPixelList(buffer: Buffer): Promise<FireAlertCircle[]> {
  readyPromise ??= ready;
  await readyPromise;

  // h5wasm's Node build opens real filesystem paths; a temp file bridges the in-memory HTTP
  // response buffer to that API (verified against a live sample file before writing this).
  const tmpPath = join(tmpdir(), `frp-pixel-${randomUUID()}.h5`);
  await writeFile(tmpPath, buffer);
  try {
    const file = new File(tmpPath, 'r');
    try {
      const lat = realValues(file, 'LATITUDE');
      const lon = realValues(file, 'LONGITUDE');
      const frp = realValues(file, 'FRP');
      const confidence = realValues(file, 'FIRE_CONFIDENCE');
      const pixelSize = realValues(file, 'PIXEL_SIZE');

      const circles: FireAlertCircle[] = [];
      for (let i = 0; i < lat.length; i++) {
        const latitude = lat[i];
        const longitude = lon[i];
        if (latitude === null || longitude === null) continue;
        circles.push({
          latitude,
          longitude,
          radiusKm: (pixelSize[i] ?? DEFAULT_PIXEL_SIZE_KM) / 2,
          frpMw: frp[i] ?? null,
          confidence: confidence[i] ?? null,
        });
      }
      return circles;
    } finally {
      file.close();
    }
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }
}
