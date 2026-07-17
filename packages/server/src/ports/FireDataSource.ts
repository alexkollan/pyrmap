export interface FirmsFetchResult {
  httpStatus: number;
  body: string;
}

/** Fetches raw FIRMS CSV bodies. Implementations apply their own timeout/retry policy per dev-plan §5 step 1. */
export interface FireDataSource {
  fetchAreaCsv(sourceId: string, bboxString: string, dayRange: number): Promise<FirmsFetchResult>;
  fetchAvailableSourceIds(): Promise<string[]>;
}
