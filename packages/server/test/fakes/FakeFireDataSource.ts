import type { FireDataSource, FirmsFetchResult } from '../../src/ports/FireDataSource.js';

/** Injectable fake FireDataSource for tests — never hits the real FIRMS API. */
export class FakeFireDataSource implements FireDataSource {
  constructor(
    private readonly bodiesBySource: Record<string, string> = {},
    private readonly availableSourceIds: string[] = [],
  ) {}

  async fetchAreaCsv(sourceId: string): Promise<FirmsFetchResult> {
    return { httpStatus: 200, body: this.bodiesBySource[sourceId] ?? '' };
  }

  async fetchAvailableSourceIds(): Promise<string[]> {
    return this.availableSourceIds;
  }
}
