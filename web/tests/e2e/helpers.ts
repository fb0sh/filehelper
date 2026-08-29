import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptRootKey, deriveDomainKeys } from '../../src/lib/crypto/core';
import { encryptMessagePayload } from '../../src/lib/crypto/messages';

// Playwright runs with cwd = web/
const BIN = path.join(process.cwd(), '../target/release/filehelper');

export interface ServerOptions {
  dataDir?: string;
  ephemeral?: boolean;
  port?: number;
}

export interface ServerHandle {
  port: number;
  dataDir: string;
  stop: () => Promise<void>;
}

function randomPort(): number {
  return 18000 + Math.floor(Math.random() * 2000);
}

export async function startServer(opts: ServerOptions = {}): Promise<ServerHandle> {
  const port = opts.port ?? randomPort();
  const dataDir = opts.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fh-e2e-'));

  const args = ['--addr', `127.0.0.1:${port}`, '--data-dir', dataDir];
  if (opts.ephemeral) args.push('--ephemeral');

  const proc = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr?.on('data', () => {});

  await waitForReady(port, proc);
  return {
    port,
    dataDir,
    stop: () => stopServer(proc),
  };
}

function waitForReady(port: number, proc: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const timer = setInterval(async () => {
      if (proc.exitCode !== null) {
        clearInterval(timer);
        reject(new Error(`server exited early with code ${proc.exitCode}`));
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/info`);
        if (res.ok) {
          clearInterval(timer);
          resolve();
        }
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error('server did not become ready in time'));
      }
    }, 200);
  });
}

function stopServer(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) {
      resolve();
      return;
    }
    const done = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve();
    }, 8000);
    proc.once('exit', () => {
      clearTimeout(done);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

// ---------------------------------------------------------------------------
// Node-side crypto + API helpers (mirrors the browser client exactly:
// same scrypt/HKDF/domain separation, same message envelope).
// ---------------------------------------------------------------------------

export interface DerivedTestKeys {
  spaceId: string;
  authKey: string;
  messageKey: string;
  fileMasterKey: string;
}

export async function deriveKeys(
  code: string,
  instanceId: string
): Promise<DerivedTestKeys> {
  const root = await scryptRootKey(code, instanceId);
  return deriveDomainKeys(root);
}

async function api(base: string, method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-FileHelper-Request': '1',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Create the space (if needed) and log in. Returns the Bearer token. */
export async function ensureSpace(base: string, code: string): Promise<string> {
  const info = await api(base, 'GET', '/info');
  const keys = await deriveKeys(code, info.body.instanceId);
  let login = await api(base, 'POST', '/auth/login', undefined, {
    spaceId: keys.spaceId,
    authKey: keys.authKey,
  });
  if (login.status === 404) {
    const created = await api(base, 'POST', '/auth/create', undefined, {
      spaceId: keys.spaceId,
      authKey: keys.authKey,
    });
    if (created.status !== 204 && created.status !== 409) {
      throw new Error(`create failed: ${JSON.stringify(created)}`);
    }
    login = await api(base, 'POST', '/auth/login', undefined, {
      spaceId: keys.spaceId,
      authKey: keys.authKey,
    });
  }
  if (login.status !== 200) {
    throw new Error(`login failed: ${JSON.stringify(login)}`);
  }
  return login.body.sessionToken as string;
}

/** Seed an encrypted text message through the real API. */
export async function seedEncryptedText(
  base: string,
  token: string,
  messageKey: string,
  spaceId: string,
  text: string
): Promise<string> {
  const payload = encryptMessagePayload(messageKey, spaceId, { type: 'text', text });
  const res = await api(base, 'POST', '/messages', token, { payload });
  if (res.status !== 200) throw new Error(`seed failed: ${JSON.stringify(res)}`);
  return res.body.id as string;
}

import { createHash } from 'node:crypto';

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export { BIN, randomPort };
