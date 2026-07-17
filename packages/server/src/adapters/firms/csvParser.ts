export interface ParsedFirmsRow {
  latitude: number;
  longitude: number;
  acquiredAt: string; // ISO 8601 UTC
  frp: number | null;
  confidence: string | null;
  satellite: string | null;
  instrument: string | null;
  daynight: string | null;
  scanKm: number | null;
  trackKm: number | null;
}

export interface ParseCsvResult {
  rows: ParsedFirmsRow[];
  parsed: number;
  skipped: number;
}

const REQUIRED_COLUMNS = ['latitude', 'longitude', 'acq_date', 'acq_time'] as const;
const ACQ_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACQ_TIME_RE = /^\d{1,4}$/;

/** Parses a FIRMS area/csv body by header name. Handles empty bodies and "No data found" as []. */
export function parseFirmsCsv(body: string): ParseCsvResult {
  const trimmed = body.trim();
  if (!trimmed || !trimmed.toLowerCase().startsWith('latitude')) {
    return { rows: [], parsed: 0, skipped: 0 };
  }

  const lines = trimmed.split(/\r?\n/);
  const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
  const colIndex = (name: string): number => header.indexOf(name);

  for (const col of REQUIRED_COLUMNS) {
    if (colIndex(col) === -1) {
      return { rows: [], parsed: 0, skipped: 0 };
    }
  }

  const idx = {
    latitude: colIndex('latitude'),
    longitude: colIndex('longitude'),
    acqDate: colIndex('acq_date'),
    acqTime: colIndex('acq_time'),
    frp: colIndex('frp'),
    confidence: colIndex('confidence'),
    satellite: colIndex('satellite'),
    instrument: colIndex('instrument'),
    daynight: colIndex('daynight'),
    scan: colIndex('scan'),
    track: colIndex('track'),
  };

  const rows: ParsedFirmsRow[] = [];
  let skipped = 0;

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split(',');
    const row = parseRow(cols, idx);
    if (row) {
      rows.push(row);
    } else {
      skipped++;
    }
  }

  return { rows, parsed: rows.length, skipped };
}

function field(cols: string[], index: number): string | undefined {
  return index >= 0 ? cols[index]?.trim() : undefined;
}

function parseOptionalFloat(cols: string[], index: number): number | null {
  const raw = field(cols, index);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseRow(cols: string[], idx: Record<string, number>): ParsedFirmsRow | null {
  const latitudeRaw = field(cols, idx.latitude);
  const longitudeRaw = field(cols, idx.longitude);
  const acqDate = field(cols, idx.acqDate);
  const acqTimeRaw = field(cols, idx.acqTime);

  if (!latitudeRaw || !longitudeRaw) return null;
  const latitude = Number(latitudeRaw);
  const longitude = Number(longitudeRaw);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (!acqDate || !ACQ_DATE_RE.test(acqDate)) return null;
  if (!acqTimeRaw || !ACQ_TIME_RE.test(acqTimeRaw)) return null;

  const acqTime = acqTimeRaw.padStart(4, '0');
  const acquiredAt = `${acqDate}T${acqTime.slice(0, 2)}:${acqTime.slice(2, 4)}:00Z`;

  return {
    latitude,
    longitude,
    acquiredAt,
    frp: parseOptionalFloat(cols, idx.frp),
    confidence: field(cols, idx.confidence) || null,
    satellite: field(cols, idx.satellite) || null,
    instrument: field(cols, idx.instrument) || null,
    daynight: field(cols, idx.daynight) || null,
    scanKm: parseOptionalFloat(cols, idx.scan),
    trackKm: parseOptionalFloat(cols, idx.track),
  };
}
