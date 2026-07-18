export interface FireAlertCircle {
  latitude: number;
  longitude: number;
  /** Detection footprint radius in km, as reported by the satellite operator. */
  radiusKm: number;
}

export interface FireAlert {
  productId: string;
  /** Sensing start time, ISO 8601 UTC — applies to every circle in the alert. */
  acquiredAt: string;
  circles: FireAlertCircle[];
}

/** Fetches recent geostationary fire-alert bulletins (10-min cadence, full disc). */
export interface FireAlertSource {
  fetchRecentAlerts(count: number): Promise<FireAlert[]>;
}
