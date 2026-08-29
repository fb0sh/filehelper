import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { scryptRootKey, deriveDomainKeys } from '../../src/lib/crypto/core';
import { encryptMessagePayload } from '../../src/lib/crypto/messages';
import zlib from 'node:zlib';

// Playwright runs with cwd = web/
const BIN = path.join(process.cwd(), '../target/release/filehelper');

export interface ServerOptions {
  dataDir?: string;
  ephemeral?: boolean;
  port?: number;
  tls?: boolean;
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
  // HTTPS is the default; the plain-HTTP tests opt out explicitly.
  if (!opts.tls) args.push('--no-tls');

  const proc = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr?.on('data', () => {});

  await waitForReady(port, proc, opts.tls);
  return {
    port,
    dataDir,
    stop: () => stopServer(proc),
  };
}

function waitForReady(port: number, proc: ChildProcess, tls = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const timer = setInterval(async () => {
      if (proc.exitCode !== null) {
        clearInterval(timer);
        reject(new Error(`server exited early with code ${proc.exitCode}`));
        return;
      }
      try {
        if (tls) {
          // Self-signed cert — probe with validation disabled.
          const ok = await new Promise<boolean>((res) => {
            const req = https.get(
              {
                host: '127.0.0.1',
                port,
                path: '/api/v1/info',
                rejectUnauthorized: false,
                timeout: 2000,
              },
              (r) => res(r.statusCode === 200)
            );
            req.on('error', () => res(false));
            req.on('timeout', () => {
              req.destroy();
              res(false);
            });
          });
          if (ok) {
            clearInterval(timer);
            resolve();
            return;
          }
        } else {
          const res = await fetch(`http://127.0.0.1:${port}/api/v1/info`);
          if (res.ok) {
            clearInterval(timer);
            resolve();
            return;
          }
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

/** Seed many encrypted text messages (bounded concurrency; order within a
 * batch is not significant — the server sorts by (created_at, uuidv7)). */
export async function seedEncryptedMany(
  base: string,
  token: string,
  messageKey: string,
  spaceId: string,
  texts: string[]
): Promise<void> {
  const CONCURRENCY = 10;
  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const batch = texts.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map((t) => seedEncryptedText(base, token, messageKey, spaceId, t))
    );
  }
}


export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Build a real, valid PNG (solid color) for preview screenshots —
 * a real raster that passes the client magic-header check. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 3;
      raw[p] = rgb[0];
      raw[p + 1] = rgb[1];
      raw[p + 2] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export { BIN, randomPort };
