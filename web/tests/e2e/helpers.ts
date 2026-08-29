import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Playwright runs with cwd = web/
const BIN = path.join(process.cwd(), '../target/release/filehelper');

export interface ServerOptions {
  dataDir?: string;
  ephemeral?: boolean;
  resetCode?: boolean;
  password?: string;
  port?: number;
}

export interface ServerHandle {
  port: number;
  dataDir: string;
  accessCode: string | null;
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
  if (opts.resetCode) args.push('--reset-code');
  if (opts.password) args.push('--password', opts.password);

  const proc = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  proc.stdout?.on('data', (d) => { stdout += d.toString(); });
  proc.stderr?.on('data', () => {});

  await waitForReady(port, proc);

  const match = stdout.match(/Access code:\s*(\d{6})/);
  return {
    port,
    dataDir,
    accessCode: match ? match[1] : null,
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

export { BIN, randomPort };