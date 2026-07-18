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

/** Source id for Meteosat MTG FCI fire alerts ingested directly from EUMETSAT (geo tier, 10-min cadence). */
export const MTG_FIR_SOURCE_ID = 'MTG_FCI_FIR';

/** Confirmation rule thresholds, dev-plan §6.3. */
export const CONFIRMATION_MAX_DISTANCE_KM = 5;
export const CONFIRMATION_MAX_TIME_HOURS = 6;
/** Coarse SQL pre-filter box (degrees) around a geo detection before exact haversine/time checks. */
export const CONFIRMATION_BBOX_MARGIN_DEG = 0.1;
/** Only geo detections acquired within this window are eligible for confirmation. */
export const CONFIRMATION_ELIGIBILITY_HOURS = 24;

/** Decay rule threshold, dev-plan §6.4. */
export const DECAY_MAX_AGE_HOURS = 12;

/** Retention window, dev-plan §4.2. */
export const RETENTION_DETECTIONS_DAYS = 7;
export const RETENTION_FETCH_LOG_DAYS = 14;

/** Nominal pixel footprint (km), used to size map markers when a detection has no scan/track of its own. */
export const GEO_PIXEL_SIZE_KM = 3; // Meteosat SEVIRI nominal resolution
export const POLAR_FALLBACK_PIXEL_SIZE_KM = 0.5; // VIIRS nominal nadir resolution, for polar rows missing scan/track

/** Detections within this distance of each other are grouped into one approximate fire-extent shape (frontend "area view"). */
export const FIRE_CLUSTER_DISTANCE_KM = 3;
