// dependency-whitelist deviation: web-push added 2026-07-22 for push notifications (explicit user
// request), outside the closed dependency whitelist — see docs/DECISIONS.md.
import webpush from 'web-push';
import { buildDetectionPayload, buildIncidentPayload, type NotificationPayload } from '../domain/notificationPayload.js';
import type { PushSubscriptionRepository } from '../ports/PushSubscriptionRepository.js';
import type { NewDetectionRow } from '../ports/FireRepository.js';
import type { NewIncidentReportRow } from '../ports/IncidentReportRepository.js';

/** VAPID identity for signing push messages: the keypair plus a mailto: contact required by the protocol. */
export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** Configures web-push's VAPID identity once at startup. Must be called before any notify* function runs. */
export function initializePushVapid(vapid: VapidConfig): void {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
}

/** Matches web-push's own sendNotification signature, so a real or fake implementation can be injected. */
export type SendFn = typeof webpush.sendNotification;

/** Sends one payload to every stored subscription; prunes subscriptions the push service reports
 * as gone (404/410 — the browser unsubscribed or the endpoint expired). Never throws — failures
 * are logged and skipped, same convention as the ingest services. `send` is injectable so tests
 * never hit a real push service. */
async function sendToAllSubscriptions(
  repository: PushSubscriptionRepository,
  payload: NotificationPayload,
  onLog: ((message: string) => void) | undefined,
  send: SendFn,
): Promise<void> {
  for (const subscription of repository.listSubscriptions()) {
    try {
      await send(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        repository.deleteSubscription(subscription.endpoint);
        onLog?.(`push: pruned expired subscription`);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        onLog?.(`push: send failed: ${message}`);
      }
    }
  }
}

/** Notifies every subscribed device of each newly inserted satellite detection, one push per row. */
export async function notifyNewDetections(
  repository: PushSubscriptionRepository,
  detections: NewDetectionRow[],
  onLog?: (message: string) => void,
  send: SendFn = webpush.sendNotification,
): Promise<void> {
  for (const detection of detections) {
    await sendToAllSubscriptions(repository, buildDetectionPayload(detection), onLog, send);
  }
}

/** Notifies every subscribed device of each newly inserted incident report, one push per row. */
export async function notifyNewIncidents(
  repository: PushSubscriptionRepository,
  reports: NewIncidentReportRow[],
  onLog?: (message: string) => void,
  send: SendFn = webpush.sendNotification,
): Promise<void> {
  for (const report of reports) {
    await sendToAllSubscriptions(repository, buildIncidentPayload(report), onLog, send);
  }
}
