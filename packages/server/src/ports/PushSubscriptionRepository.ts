export interface NewPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface StoredPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Persists browser push subscriptions (one row per device/browser installation). SQL lives only in the sqlite adapter implementing this port. */
export interface PushSubscriptionRepository {
  /** Upserts by endpoint — re-subscribing the same device updates its keys instead of duplicating. */
  saveSubscription(subscription: NewPushSubscription): void;
  /** All stored subscriptions, to broadcast a new-detection notification to every device. */
  listSubscriptions(): StoredPushSubscription[];
  deleteSubscription(endpoint: string): void;
  close(): void;
}
