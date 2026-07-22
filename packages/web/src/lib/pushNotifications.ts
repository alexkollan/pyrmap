import type { PushSubscriptionPayload } from '@pyrmap/shared';

/** Converts a URL-safe base64 VAPID public key into the Uint8Array PushManager.subscribe's
 * applicationServerKey option requires. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export interface PushSupport {
  supported: boolean;
  /** True when push requires installing to the home screen first (iOS Safari) and it isn't yet. */
  needsInstall: boolean;
}

/** Feature-detects push support. iOS Safari only supports the Push API when running as an
 * installed PWA (standalone display mode) — a regular Safari tab silently lacks PushManager. */
export function checkPushSupport(): PushSupport {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  return { supported, needsInstall: isIos && !isStandalone && !supported };
}

function subscriptionToPayload(subscription: PushSubscription): PushSubscriptionPayload {
  const json = subscription.toJSON();
  return { endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! } };
}

/** Requests notification permission, subscribes via the service worker, and registers the
 * subscription with the server. Throws if permission is denied or the server has no VAPID key. */
export async function enablePushNotifications(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission denied');

  const keyResponse = await fetch('/api/push/vapid-public-key');
  if (!keyResponse.ok) throw new Error('Push notifications not configured on the server');
  const { publicKey } = (await keyResponse.json()) as { publicKey: string };

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscriptionToPayload(subscription)),
  });
}

/** Unsubscribes this device both from the browser's push manager and the server's record of it. */
export async function disablePushNotifications(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}

/** Whether this device currently has an active push subscription — used to initialize the bell-icon toggle's state. */
export async function isPushEnabled(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription !== null;
}
