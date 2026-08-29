// Telegram-style UI acceptance screenshots (round 3: floating sidebar card).
// Boots the release binary (embedded web/dist), logs in at 1584×960, and
// captures the four desktop scenarios:
//   1. home — empty chat / wallpaper
//   2. chat — messages flowing, bubbles + file upload
//   3. search — topbar search open with results
//   4. attach — pre-send modal with caption input
// Usage: node scripts/screenshots.mjs [outdir]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import zlib from 'node:zlib';

const OUT = process.argv[2] ?? path.join(process.cwd(), 'scripts', 'shots');
const PORT = 18760 + Math.floor(Math.random() * 300);
const BIN = path.join(process.cwd(), '..', 'target', 'release', 'filehelper');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-shot-'));
const base = `http://127.0.0.1:${PORT}`;
const code = `shot-${Date.now() % 1000000}`;

const proc = spawn(BIN, ['--addr', `127.0.0.1:${PORT}`, '--data-dir', dataDir], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
proc.stderr?.on('data', () => {});
process.on('exit', () => proc.kill('SIGKILL'));

async function waitReady() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/v1/info`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not become ready');
}

async function login(page) {
  await page.goto(base);
  await page.fill('input[placeholder="••••••••••••••"]', code);
  await page.click('button[type="submit"]');
  const composer = page.locator('textarea[placeholder="Message"]');
  const createBtn = page.locator('button', { hasText: 'Create' });
  const outcome = await Promise.race([
    createBtn.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'create'),
    composer.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'composer'),
  ]);
  if (outcome === 'create') await createBtn.click();
  await composer.waitFor({ state: 'visible', timeout: 20000 });
}

async function sendText(page, text) {
  await page.locator('textarea[placeholder="Message"]').fill(text);
  await page.keyboard.press('Enter');
  await page.locator(`text=${text}`).first().waitFor({ state: 'visible', timeout: 10000 });
}

function solidPng(width, height, rgb) {
  // Minimal valid PNG (truecolor) for a realistic file/photo attachment.
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
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
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
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

await waitReady();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1584, height: 960 } });
await login(page);

fs.mkdirSync(OUT, { recursive: true });

// ── 1. Home: empty chat / wallpaper ───────────────────────────
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, '01-home-wallpaper.png') });

// ── 2. Chat: messages + an image upload ───────────────────────
const texts = [
  'Hey! The draft is ready 🎉',
  'Check the attachment below — it’s the new wallpaper tile.',
  'I tuned the olive stroke color to match Telegram Web A.',
  'Small geometry pass: sidebar is now a floating rounded card.',
  'What do you think of the windowed shell?',
];
for (const t of texts) await sendText(page, t);

const png = solidPng(480, 320, [51, 144, 236]);
await page.locator('input[type="file"]').setInputFiles({
  name: 'wallpaper-preview.png',
  mimeType: 'image/png',
  buffer: png,
});
await page.locator('button[aria-label="Send file"]').click();
await page.locator('button[aria-label="Cancel"]').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
await page.waitForFunction(
  (n) => document.querySelectorAll('div[data-message-id]').length > n,
  texts.length,
  { timeout: 20000 }
);
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, '02-chat.png') });

// ── 3. Search state ───────────────────────────────────────────
await page.click('button[aria-label="Search"]');
const input = page.locator('input[placeholder="Search messages..."]');
await input.waitFor({ state: 'visible', timeout: 5000 });
await input.fill('sidebar');
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(OUT, '03-search.png') });
await page.click('button[aria-label="Close search"]');

// ── 4. Pre-send modal with caption ────────────────────────────
await page.locator('input[type="file"]').setInputFiles({
  name: 'quarterly-report.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 mock report body'),
});
const dialog = page.locator('[role="dialog"]');
await dialog.waitFor({ state: 'visible', timeout: 5000 });
const caption = dialog.locator('input[type="text"], textarea').first();
await caption.fill('Final numbers for the quarter, encrypted.');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, '04-attach-caption.png') });

await browser.close();
proc.kill('SIGKILL');
console.log('screenshots written to', OUT);
