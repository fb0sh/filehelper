// API client with per-tab Bearer sessions. On SESSION_EXPIRED / 401 it
// attempts exactly one silent re-login (spaceId + authKey from the crypto
// session) and retries the original request once; on failure it calls the
// lock handler so the app returns to Enter Code. No infinite retry loop.

const API_BASE = '/api/v1';

/** Server-returned URLs (downloadUrl) are already absolute API paths;
 * handler paths are relative. Never double-prefix. */
function fullUrl(path: string): string {
  return path.startsWith('/api/') ? path : `${API_BASE}${path}`;
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

let sessionToken: string | null = null;
let reauthFn: (() => Promise<string | null>) | null = null;
let lockFn: (() => void) | null = null;

export function setSessionToken(token: string | null) {
  sessionToken = token;
}

export function getSessionToken(): string | null {
  return sessionToken;
}

/** Registered by the auth store: returns a fresh token using the stored
 * crypto session, or null when no session exists. */
export function setReauthHandler(fn: (() => Promise<string | null>) | null) {
  reauthFn = fn;
}

/** Registered by the auth store: force-lock (clear everything). */
export function setLockHandler(fn: (() => void) | null) {
  lockFn = fn;
}

export function clearSessionToken() {
  sessionToken = null;
}

/** One silent re-auth attempt (used by the WebSocket reconnect path). */
export async function reauthOnce(): Promise<string | null> {
  if (!reauthFn) return null;
  return reauthFn();
}

async function doFetch(path: string, options: RequestInit, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };
  const isMutation = options?.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method);
  if (isMutation) headers['X-FileHelper-Request'] = '1';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(fullUrl(path), { ...options, headers });
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    return new ApiError(
      body?.error?.code || 'UNKNOWN',
      body?.error?.message || 'Request failed',
      res.status
    );
  } catch {
    return new ApiError('UNKNOWN', `Request failed (${res.status})`, res.status);
  }
}

async function requestWithToken<T>(
  path: string,
  options: RequestInit,
  token: string | null,
  allowRetry: boolean
): Promise<T> {
  const res = await doFetch(path, options, token);

  if (res.status === 401 && allowRetry) {
    const fresh = reauthFn ? await reauthFn() : null;
    if (fresh) {
      // Exactly one retry with the fresh token.
      return requestWithToken<T>(path, options, fresh, false);
    }
    lockFn?.();
    throw await parseError(res);
  }

  if (!res.ok) {
    throw await parseError(res);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  return requestWithToken<T>(path, options ?? {}, sessionToken, true);
}

/** Raw fetch for streaming (downloads): attaches the Bearer token. */
export async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;
  return fetch(fullUrl(path), { ...init, headers });
}

export { API_BASE };
