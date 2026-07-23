import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { credentialsMatch, signSession, verifySession } from '../domain/session.js';

const COOKIE_NAME = 'pyrmap_session';
const SESSION_DAYS = 90;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

export interface AuthConfig {
  username: string;
  password: string;
  sessionSecret: string;
}

interface LoginBody {
  username?: string;
  password?: string;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function cookieAttributes(secure: boolean, maxAgeSeconds: number): string {
  return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.header('set-cookie', `${COOKIE_NAME}=${token}; ${cookieAttributes(secure, SESSION_DAYS * 24 * 60 * 60)}`);
}

function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.header('set-cookie', `${COOKIE_NAME}=; ${cookieAttributes(secure, 0)}`);
}

/** Reads and verifies the session cookie on a request; null means "not logged in" (any reason). */
export function getSession(request: FastifyRequest, sessionSecret: string): { username: string } | null {
  const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  const payload = verifySession(token, sessionSecret);
  return payload ? { username: payload.username } : null;
}

/** Fastify onRequest hook: rejects with 401 unless a valid session cookie is present. */
export function requireAuth(sessionSecret: string) {
  return async function requireAuthHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!getSession(request, sessionSecret)) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  };
}

/** POST /api/login, POST /api/logout, GET /api/me — the only routes reachable without a session. */
export function authRoutes(auth: AuthConfig) {
  return async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
    const secure = process.env.NODE_ENV === 'production';

    app.post<{ Body: LoginBody }>(
      '/api/login',
      { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const { username, password } = request.body ?? {};
        if (
          typeof username !== 'string' ||
          typeof password !== 'string' ||
          !credentialsMatch(username, password, auth.username, auth.password)
        ) {
          reply.code(401);
          return { ok: false };
        }
        const token = signSession({ username, expiresAt: Date.now() + SESSION_MS }, auth.sessionSecret);
        setSessionCookie(reply, token, secure);
        return { ok: true };
      },
    );

    app.post('/api/logout', async (request, reply) => {
      clearSessionCookie(reply, secure);
      return { ok: true };
    });

    app.get('/api/me', async (request) => {
      const session = getSession(request, auth.sessionSecret);
      return { authenticated: session !== null };
    });
  };
}
