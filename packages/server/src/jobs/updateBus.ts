type Listener = () => void;

/**
 * In-memory pub/sub so scheduler jobs can notify connected browsers the instant new data lands,
 * via /api/events (Server-Sent Events). Deliberately just a signal, not a data payload — a
 * listener's job is to refetch /api/fires itself, not to receive a diff. Single-process only;
 * fine for this app's scale (dev-plan never assumes horizontal scaling).
 */
export class UpdateBus {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(): void {
    for (const listener of this.listeners) listener();
  }
}
