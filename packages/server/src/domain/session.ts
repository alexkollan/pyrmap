import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionPayload {
  username: string;
  expiresAt: number; // unix ms
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf-8').toString('base64url');
}

/** Signs a session token: base64url(JSON payload) + '.' + base64url(HMAC-SHA256 of the payload). */
export function signSession(payload: SessionPayload, secret: string): string {
  const encoded = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

/**
 * Verifies a session token's signature (timing-safe) and expiry. Returns the payload if valid,
 * null otherwise — callers treat null as "not logged in", never distinguishing why.
 */
export function verifySession(token: string, secret: string, now: () => Date = () => new Date()): SessionPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;

  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expectedSignature = createHmac('sha256', secret).update(encoded).digest('base64url');

  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf)) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as SessionPayload).username !== 'string' ||
    typeof (payload as SessionPayload).expiresAt !== 'number'
  ) {
    return null;
  }
  const { username, expiresAt } = payload as SessionPayload;
  if (expiresAt < now().getTime()) return null;

  return { username, expiresAt };
}

/** Constant-time string comparison — avoids a timing side-channel leaking how many leading chars matched. */
function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf-8');
  const bBuf = Buffer.from(b, 'utf-8');
  if (aBuf.length !== bBuf.length) {
    // Compare against itself anyway so the elapsed time doesn't reveal the length mismatch.
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/** Checks a submitted username/password pair against the configured single-user credentials. */
export function credentialsMatch(
  username: string,
  password: string,
  expectedUsername: string,
  expectedPassword: string,
): boolean {
  const userOk = timingSafeEqualString(username, expectedUsername);
  const passOk = timingSafeEqualString(password, expectedPassword);
  return userOk && passOk;
}
