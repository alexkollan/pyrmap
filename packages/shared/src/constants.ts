/** Greece bounding box for FIRMS area queries: west,south,east,north (degrees). */
export const GREECE_BBOX = {
  west: 19.0,
  south: 34.5,
  east: 29.7,
  north: 42.0,
} as const;

export const GREECE_BBOX_STRING = `${GREECE_BBOX.west},${GREECE_BBOX.south},${GREECE_BBOX.east},${GREECE_BBOX.north}`;

/** FIRMS source id -> tier, per dev-plan §3.4. */
export const FIRMS_SOURCES = {
  MSG_NRT: 'geo',
  VIIRS_NOAA21_NRT: 'polar',
  VIIRS_NOAA20_NRT: 'polar',
  VIIRS_SNPP_NRT: 'polar',
  MODIS_NRT: 'polar',
} as const;

/** Confirmation rule thresholds, dev-plan §6.3. */
export const CONFIRMATION_MAX_DISTANCE_KM = 5;
export const CONFIRMATION_MAX_TIME_HOURS = 6;

/** Decay rule threshold, dev-plan §6.4. */
export const DECAY_MAX_AGE_HOURS = 12;

/** Retention window, dev-plan §4.2. */
export const RETENTION_DETECTIONS_DAYS = 7;
export const RETENTION_FETCH_LOG_DAYS = 14;
