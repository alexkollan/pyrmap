import Database, { type Database as DatabaseType } from 'better-sqlite3';
import type {
  NewPushSubscription,
  PushSubscriptionRepository,
  StoredPushSubscription,
} from '../../ports/PushSubscriptionRepository.js';
import { runMigrations } from './migrations.js';

/** Own connection to the same DB file as the other repositories (WAL mode makes that safe). */
export class SqlitePushSubscriptionRepository implements PushSubscriptionRepository {
  private readonly db: DatabaseType;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    runMigrations(this.db);
  }

  saveSubscription(subscription: NewPushSubscription): void {
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
         VALUES (@endpoint, @p256dh, @auth, @createdAt)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .run({ ...subscription, createdAt: new Date().toISOString() });
  }

  listSubscriptions(): StoredPushSubscription[] {
    return this.db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all() as StoredPushSubscription[];
  }

  deleteSubscription(endpoint: string): void {
    this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }

  close(): void {
    this.db.close();
  }
}
