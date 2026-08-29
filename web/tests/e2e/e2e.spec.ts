import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  startServer,
  ensureSpace,
  seedEncryptedText,
  seedEncryptedMany,
  deriveKeys,
  sha256Hex,
  solidPng,
} from './helpers';

const SCREENSHOT_DIR = path.join(process.cwd(), '../docs/screenshots');

function shot(page: Page, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  return page.screenshot({ path: path.join(SCREENSHOT_DIR, name), fullPage: false });
}

/** Browser login: type the CODE, submit, handle the one-time create
 * dialog, wait for the composer. The create dialog appears only after
 * the Scrypt KDF + login roundtrip, so we race for it. For an existing
 * space the composer appears directly — racing avoids a 20 s stall. */
async function login(page: Page, base: string, code: string) {
  await page.goto(base);
  await page.fill('input[placeholder="••••••••••••••"]', code);
  await page.click('button[type="submit"]');
  const composer = page.locator('textarea[placeholder="Message"]');
  const createBtn = page.locator('button', { hasText: 'Create' });
  const outcome = await Promise.race([
    createBtn.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'create' as const),
    composer.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'composer' as const),
  ]);
  if (outcome === 'create') {
    await createBtn.click();
  }
  await expect(composer).toBeVisible({ timeout: 20000 });
}

async function sendText(page: Page, text: string) {
  await page.locator('textarea[placeholder="Message"]').fill(text);
  await page.keyboard.press('Enter');
  await expect(page.locator(`text=${text}`).first()).toBeVisible({ timeout: 10000 });
}

async function uploadFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const before = await page.locator('div[data-message-id]').count();
  await page.locator('input[type="file"]').setInputFiles(file);
  // Pre-send dialog (Telegram-style Send File/Photo) — confirm without caption.
  await page.locator('button[aria-label="Send file"]').click();
  await page.locator('button[aria-label="Cancel"]').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  // The message bubble replaces the upload task row (image bubbles do not
  // render the filename as text, so wait on the count instead).
  await page
    .waitForFunction(
      (n) => document.querySelectorAll('div[data-message-id]').length > n,
      before,
      { timeout: 20000 }
    );
}

/** Upload with a caption through the pre-send dialog. */
async function uploadFileWithCaption(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, caption: string) {
  const before = await page.locator('div[data-message-id]').count();
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.locator('textarea[aria-label="Add a caption"]').fill(caption);
  await page.locator('button[aria-label="Send file"]').click();
  await page.locator('button[aria-label="Cancel"]').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  await page
    .waitForFunction(
      (n) => document.querySelectorAll('div[data-message-id]').length > n,
      before,
      { timeout: 20000 }
    );
}

function uniqueCode(label: string): string {
  return `${label}-${Date.now() % 1000000}`;
}

test.describe('FileHelper v2.0 E2E', () => {
  test('login screenshots: desktop + mobile CODE prompt', async ({ page }) => {
    // Desktop (1584×960): fresh server → CODE prompt, empty and with a
    // code typed (strength hint visible).
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await page.setViewportSize({ width: 1584, height: 960 });
    await page.goto(base);
    await expect(page.locator('input[placeholder="••••••••••••••"]')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(400);
    await shot(page, 'desktop-login.png');
    await page.fill('input[placeholder="••••••••••••••"]', 'FileHelper#2026-安全!');
    await page.waitForTimeout(300);
    await shot(page, 'desktop-login-filled.png');

    // Mobile (390×844): same CODE prompt full-bleed, clean state.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.fill('input[placeholder="••••••••••••••"]', '');
    await page.waitForTimeout(400);
    await shot(page, 'mobile-login.png');
    await server.stop();
  });

  test('desktop layout: sidebar + chat fill viewport', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await page.setViewportSize({ width: 1584, height: 960 });
    await login(page, base, uniqueCode('layout'));

    const composer = page.locator('textarea[placeholder="Message"]');
    const box = await composer.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThan(300);
    expect(box!.x + box!.width).toBeGreaterThan(1000);

    await shot(page, 'desktop-main.png');
    await server.stop();
  });

  test('unicode code login (Chinese + emoji) roundtrips', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, '我的私人文件#2026！🚀');
    await sendText(page, 'unicode-ok');
    await shot(page, 'desktop-unicode.png');
    await server.stop();
  });

  test('same code on two tabs: realtime decrypted messages both ways', async ({ page, context }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    const code = uniqueCode('rt');
    await login(page, base, code);
    const pageB = await context.newPage();
    await login(pageB, base, code);

    // A sends → B sees it decrypted in real time.
    await sendText(page, 'hello from A');
    await expect(pageB.locator('text=hello from A').first()).toBeVisible({ timeout: 10000 });

    // B sends → A sees it.
    await sendText(pageB, 'hello from B');
    await expect(page.locator('text=hello from B').first()).toBeVisible({ timeout: 10000 });
    await server.stop();
  });

  test('different codes are fully isolated', async ({ browser }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await login(pageA, base, uniqueCode('iso-A'));
    await login(pageB, base, uniqueCode('iso-B'));

    await sendText(pageA, 'ONLY A CAN SEE THIS');
    await pageB.waitForTimeout(1200);
    await expect(pageB.locator('text=ONLY A CAN SEE THIS')).toHaveCount(0);
    // B's list is empty of A's content.
    await expect(pageB.locator('textarea[placeholder="Message"]')).toBeVisible();

    // B uploads a file; A must not see its filename.
    await uploadFile(pageB, { name: 'iso-b-file.txt', mimeType: 'text/plain', buffer: Buffer.from('bbb') });
    await pageA.waitForTimeout(800);
    await expect(pageA.locator('text=iso-b-file.txt')).toHaveCount(0);

    await ctxA.close();
    await ctxB.close();
    await server.stop();
  });

  test('text message end-to-end (encrypted roundtrip through the UI)', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('text'));
    await sendText(page, `hello-${Date.now()}`);
    await server.stop();
  });

  test('https (--tls): secure context over LAN — native Save-as dialog API is exposed', async ({ browser }) => {
    const server = await startServer({ tls: true });
    const base = `https://127.0.0.1:${server.port}`;
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await login(page, base, uniqueCode('tls'));
    await sendText(page, 'tls-works');

    // Over https the origin is a secure context, so Chromium exposes
    // showSaveFilePicker — the OS "Save as" folder dialog. Plain LAN
    // http never has it (browser platform rule); --tls restores it.
    const api = await page.evaluate(() => ({
      hasPicker: typeof (window as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function',
      isSecure: window.isSecureContext,
    }));
    expect(api.isSecure).toBe(true);
    expect(api.hasPicker).toBe(true);

    // The upload flow works over https too (wss realtime).
    const before = await page.locator('div[data-message-id]').count();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'tls-upload.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('secure-context-upload'),
    });
    await page.locator('button[aria-label="Send file"]').click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('div[data-message-id]').length > n,
      before,
      { timeout: 20000 }
    );
    await ctx.close();
    await server.stop();
  });

  test('upload works without crypto.randomUUID (LAN HTTP has no secure context)', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('nouuid'));

    // Simulate an insecure context (plain-HTTP LAN access): there,
    // crypto.randomUUID is undefined and the old code crashed with
    // "TypeError: crypto.randomUUID is not a function" on upload.
    await page.evaluate(() => {
      Object.defineProperty(window.crypto, 'randomUUID', { value: undefined });
    });

    const before = await page.locator('div[data-message-id]').count();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'lan-upload.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('insecure-context-simulation'),
    });
    await page.locator('button[aria-label="Send file"]').click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('div[data-message-id]').length > n,
      before,
      { timeout: 20000 }
    );
    await server.stop();
  });

  test('file upload + download: decrypted bytes match the original', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('dl'));

    const payload = Buffer.from('DOWNLOAD_ME_12345'.repeat(1000));
    const expected = sha256Hex(payload);
    await uploadFile(page, {
      name: 'roundtrip.bin',
      mimeType: 'application/octet-stream',
      buffer: payload,
    });

    // Force the Blob fallback path so Playwright can capture the file.
    await page.evaluate(() => {
      (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
    });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-download-button]').first().click(),
    ]);
    const filePath = await download.path();
    const downloaded = fs.readFileSync(filePath!);
    expect(downloaded.length).toBe(payload.length);
    expect(sha256Hex(downloaded)).toBe(expected);
    await server.stop();
  });

  test('image upload: preview decrypts to a blob and opens the viewer', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('img'));

    await uploadFile(page, { name: 'pixel.png', mimeType: 'image/png', buffer: solidPng(320, 200, [51, 144, 236]) });
    const img = page.locator('[data-image-message] img');
    await expect(img).toBeVisible({ timeout: 15000 });
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^blob:/);
    await shot(page, 'desktop-image-preview.png');

    // Click → MediaViewer uses the same decrypted blob.
    await img.click();
    await expect(page.locator('[data-viewer] img').first()).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await server.stop();
  });

  test('caption: send file + caption, modal flow, search hits caption, delete works', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('cap'));
    const stamp = Date.now();
    const caption = `Quarterly report ${stamp}`;

    // Selecting a file opens the Telegram-style pre-send dialog.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'q1.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('pdf'),
    });
    await expect(page.locator('[role="dialog"]', { hasText: 'Send File' })).toBeVisible();
    await page.locator('textarea[aria-label="Add a caption"]').fill(caption);
    await page.waitForTimeout(300);
    await shot(page, 'desktop-caption-modal.png');
    await page.click('button[aria-label="Send file"]');

    // The caption renders inside the file bubble below the card.
    const card = page.locator('[data-file-card]', { hasText: 'q1.pdf' }).first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card.locator('[data-caption]')).toContainText(caption);
    await expect(card.locator('img')).toHaveCount(0); // pdf stays a card

    // Search finds the caption and auto-jumps with the term highlighted.
    await page.click('button[aria-label="Search"]');
    const input = page.locator('input[placeholder="Search messages..."]');
    await input.fill('Quarterly');
    await expect(page.locator('text=1 / 1').first()).toBeVisible({ timeout: 5000 });
    const hit = page.locator('div[data-message-id][data-search-active="true"]', { hasText: caption }).first();
    await expect(hit).toBeVisible();
    await expect(hit.locator('mark', { hasText: 'Quarterly' }).first()).toBeVisible();
    await page.click('button[aria-label="Close search"]');

    // Delete the message (caption + attachment go together).
    await card.click({ button: 'right' });
    await page.locator('div[class*="menu"] button', { hasText: 'Delete' }).first().click();
    await page.locator('button', { hasText: 'Delete' }).last().click();
    await expect(page.locator(`text=${caption}`).first()).toHaveCount(0);
    await server.stop();
  });

  test('caption: image caption syncs to a second tab and survives refresh', async ({ page, context }) => {
    await page.setViewportSize({ width: 1584, height: 960 });
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    const code = uniqueCode('capimg');
    await login(page, base, code);
    const pageB = await context.newPage();
    await login(pageB, base, code);

    const caption = '照片说明 📷 请查收';
    await uploadFileWithCaption(page, {
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: solidPng(320, 200, [51, 144, 236]),
    }, caption);

    // Both tabs render the image + caption (realtime sync, decrypted).
    await expect(page.locator('[data-image-message] img').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-image-message] [data-caption]')).toContainText(caption);
    await expect(pageB.locator('[data-image-message] img').first()).toBeVisible({ timeout: 15000 });
    await expect(pageB.locator('[data-image-message] [data-caption]')).toContainText(caption);

    // Refresh → history restores the caption (persisted in the envelope).
    await page.reload();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-image-message] img').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-image-message] [data-caption]')).toContainText(caption);
    await server.stop();
  });

  test('caption: empty caption sends a plain file with no caption block', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('nocap'));
    await uploadFile(page, { name: 'plain.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });

    const card = page.locator('[data-file-card]', { hasText: 'plain.bin' }).first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card.locator('[data-caption]')).toHaveCount(0);
    await server.stop();
  });

  test('fake PNG (HTML bytes) never previews — plain file card', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('fakeimg'));

    const evil = Buffer.from('<html><script>alert(1)</script></html>');
    await uploadFile(page, { name: 'evil.png', mimeType: 'image/png', buffer: evil });
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-image-message] img')).toHaveCount(0);
    // File card with the (decrypted) filename instead.
    await expect(page.locator('[data-file-card]', { hasText: 'evil.png' }).first()).toBeVisible();
    await server.stop();
  });

  test('video upload: file card only, no <video>, no viewer', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('video'));

    const video = Buffer.concat([Buffer.from('fake-mp4'), Buffer.alloc(64 * 1024, 1)]);
    await uploadFile(page, { name: 'holiday.mp4', mimeType: 'video/mp4', buffer: video });
    await page.waitForTimeout(500);
    await expect(page.locator('video')).toHaveCount(0);
    const card = page.locator('[data-file-card]', { hasText: 'holiday.mp4' }).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('video');
    await shot(page, 'desktop-video-file.png');
    await server.stop();
  });

  test('search: auto-jump, highlight, keyboard navigation, clean close', async ({ page }) => {
    await page.setViewportSize({ width: 1584, height: 960 });
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('search'));

    // Console errors are only asserted for the search flow below — the
    // login step legitimately produces a 404 (SPACE_NOT_FOUND) when a
    // brand-new code needs its create dialog.
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const stamp = Date.now();
    const markerA = `needle-${stamp}-a`;
    const markerB = `needle-${stamp}-b`;
    const markerC = `needle-${stamp}-c`;
    await sendText(page, markerA);
    await sendText(page, markerB);
    await sendText(page, markerC);
    await uploadFile(page, { name: `secret-report-${stamp}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('pdf') });

    // Scroll the chat far away from the matches so the auto-jump is real.
    await page.evaluate(() => {
      const el = document.querySelector('div[class*="container"]') as HTMLElement;
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(300);

    await page.click('button[aria-label="Search"]');
    const input = page.locator('input[placeholder="Search messages..."]');
    await expect(input).toBeVisible();

    // Type → debounce → auto-jump to the NEWEST match with no extra click.
    await input.fill('needle');
    await expect(page.locator('text=1 / 3').first()).toBeVisible({ timeout: 5000 });
    const newestMatch = page.locator('div[data-message-id]', { hasText: markerC }).first();
    await expect(newestMatch).toBeInViewport({ timeout: 5000 });
    // The active result carries persistent emphasis + term highlight.
    await expect(
      page.locator('div[data-message-id][data-search-active="true"]', { hasText: markerC })
    ).toBeVisible();
    await expect(newestMatch.locator('mark', { hasText: 'needle' }).first()).toBeVisible();

    // ↑ / ArrowUp → older match.
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('text=2 / 3').first()).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('div[data-message-id][data-search-active="true"]', { hasText: markerB })
    ).toBeVisible();

    // ↓ / ArrowDown → newer match.
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('text=1 / 3').first()).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('div[data-message-id][data-search-active="true"]', { hasText: markerC })
    ).toBeVisible();

    // Enter → older; Shift+Enter → newer.
    await page.keyboard.press('Enter');
    await expect(page.locator('text=2 / 3').first()).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Shift+Enter');
    await expect(page.locator('text=1 / 3').first()).toBeVisible({ timeout: 5000 });

    // Jump to the oldest match, then back — search stays open.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('text=3 / 3').first()).toBeVisible({ timeout: 5000 });
    await expect(input).toBeVisible();

    // Filename match (decrypted filename — the server never saw it).
    await input.fill(`secret-report-${stamp}`);
    await expect(page.locator('text=1 / 1').first()).toBeVisible({ timeout: 5000 });
    const fileCard = page.locator('[data-file-card]', { hasText: `secret-report-${stamp}` }).first();
    await expect(fileCard).toBeInViewport({ timeout: 5000 });
    await expect(fileCard.locator('mark', { hasText: 'secret-report' }).first()).toBeVisible();

    // Close → everything is cleaned up: no marks, no active emphasis.
    await page.click('button[aria-label="Close search"]');
    await expect(input).toBeHidden();
    await expect(page.locator('mark')).toHaveCount(0);
    await expect(page.locator('[data-search-active="true"]')).toHaveCount(0);

    // No console errors during the whole search flow.
    expect(consoleErrors).toEqual([]);
    await server.stop();
  });

  test('search: deep history (>50 messages) is found and auto-jumped', async ({ page }) => {
    await page.setViewportSize({ width: 1584, height: 960 });
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    const code = uniqueCode('deep');

    // Seed 620 encrypted messages through the API; the target is far
    // older than the initial 50-message page.
    const info = await (await fetch(`${base}/api/v1/info`)).json();
    const keys = await deriveKeys(code, info.instanceId);
    const token = await ensureSpace(base, code);
    const stamp = Date.now();
    const target = `DEEP_HISTORY_TARGET_${stamp}`;
    const texts: string[] = [];
    texts.push(target);
    for (let i = 0; i < 619; i++) {
      texts.push(`deep-filler-${stamp}-${i}`);
    }
    await seedEncryptedMany(base, token, keys.messageKey, keys.spaceId, texts);

    await login(page, base, code);
    await expect(page.locator(`text=deep-filler-${stamp}-618`).first()).toBeVisible({ timeout: 20000 });
    // The target is NOT in the initial viewport (only the newest 50 are).
    await expect(page.locator(`text=${target}`).first()).toHaveCount(0);

    await page.click('button[aria-label="Search"]');
    const input = page.locator('input[placeholder="Search messages..."]');
    await input.fill(target);
    await expect(page.locator('text=1 / 1').first()).toBeVisible({ timeout: 15000 });
    const targetBubble = page.locator('div[data-message-id]', { hasText: target }).first();
    await expect(targetBubble).toBeInViewport({ timeout: 10000 });
    await expect(targetBubble.locator('mark', { hasText: target }).first()).toBeVisible();
    await expect(targetBubble.getAttribute('data-search-active')).resolves.toBe('true');
    await server.stop();
  });

  test('search: realtime matching messages grow the counter without stealing the active result', async ({ page, context }) => {
    await page.setViewportSize({ width: 1584, height: 960 });
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    const code = uniqueCode('rtsearch');
    await login(page, base, code);
    const pageB = await context.newPage();
    await login(pageB, base, code);

    const stamp = Date.now();
    await sendText(page, `rt-needle-${stamp}-1`);
    await sendText(page, `rt-needle-${stamp}-2`);

    await page.click('button[aria-label="Search"]');
    const input = page.locator('input[placeholder="Search messages..."]');
    await input.fill(`rt-needle-${stamp}`);
    await expect(page.locator('text=1 / 2').first()).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('div[data-message-id][data-search-active="true"]', { hasText: `rt-needle-${stamp}-2` })
    ).toBeVisible();

    // Another device sends a matching message while search is open.
    await sendText(pageB, `rt-needle-${stamp}-3`);

    // Counter grows to 2 / 3; the active result stays on the OLD newest
    // (the new message arrives above it, so its position shifts).
    await expect(page.locator('text=2 / 3').first()).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('div[data-message-id][data-search-active="true"]', { hasText: `rt-needle-${stamp}-2` })
    ).toBeVisible();
    // Navigation still works on the grown list.
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('text=3 / 3').first()).toBeVisible({ timeout: 5000 });
    await server.stop();
  });

  test('search screenshot: real app demo data (desktop-search.png)', async ({ page }) => {
    await page.setViewportSize({ width: 1584, height: 960 });
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('shot'));

    // Real, non-lorem demo history: 3 texts + 4 files (video/image/pdf/zip).
    await sendText(page, 'Encrypted file transfer works across devices.');
    await sendText(page, 'FileHelper v1.0 is ready for release.');
    await sendText(page, 'Search now highlights FileHelper results.');
    await uploadFile(page, { name: 'release-video.mp4', mimeType: 'video/mp4', buffer: Buffer.concat([Buffer.from('fake-mp4'), Buffer.alloc(64 * 1024, 1)]) });
    await uploadFile(page, { name: 'project-notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf-demo') });
    await uploadFile(page, { name: 'photo-demo.png', mimeType: 'image/png', buffer: solidPng(320, 200, [51, 144, 236]) });
    await uploadFile(page, { name: 'archive.zip', mimeType: 'application/zip', buffer: Buffer.from('zip-demo') });

    // Wait for the image preview to decrypt and render.
    await expect(page.locator('[data-image-message] img').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('video')).toHaveCount(0);

    await page.click('button[aria-label="Search"]');
    const input = page.locator('input[placeholder="Search messages..."]');
    await input.fill('FileHelper');

    // Auto-jump to the newest match, centered with the term highlighted.
    await expect(page.locator('text=1 / 2').first()).toBeVisible({ timeout: 5000 });
    const active = page.locator('div[data-message-id][data-search-active="true"]').first();
    await expect(active).toContainText('Search now highlights FileHelper results.');
    await expect(active.locator('mark', { hasText: 'FileHelper' }).first()).toBeVisible();
    await expect(active).toBeInViewport({ timeout: 5000 });

    // Give the smooth scroll + entrance animation a moment to settle so
    // the capture is deterministic.
    await page.waitForTimeout(900);
    await shot(page, 'desktop-search.png');
    await server.stop();
  });

  test('desktop viewport acceptance: no horizontal overflow at 1280x720 and 1920x1080', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;

    await page.setViewportSize({ width: 1280, height: 720 });
    await login(page, base, uniqueCode('vp'));
    await sendText(page, 'viewport-1280');
    await page.waitForTimeout(400);
    let overflow = await page.evaluate(() => ({
      sw: document.body.scrollWidth,
      cw: document.body.clientWidth,
    }));
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw);

    // Same logged-in session, resized to a larger desktop viewport.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(400);
    overflow = await page.evaluate(() => ({
      sw: document.body.scrollWidth,
      cw: document.body.clientWidth,
    }));
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw);
    await server.stop();
  });

  test('selected text: Copy selected text copies only the snapshot', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('seltext'));
    await sendText(page, 'abcdefg');
    await page.waitForTimeout(300);

    // Select "cde" inside the message text node.
    await page.evaluate(() => {
      const wrap = document.querySelector('[data-message-wrapper]')!;
      const walker = document.createTreeWalker(wrap, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const idx = node.textContent?.indexOf('cde') ?? -1;
        if (idx >= 0) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + 3);
          const sel = window.getSelection()!;
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        }
      }
    });
    await page.waitForTimeout(100);

    // Synthetic contextmenu: headless CDP right-click clears the browser
    // selection, which would defeat the snapshot logic under test. A real
    // right-click outside the selection preserves it.
    await page.evaluate(() => {
      const wrap = document.querySelector('[data-message-wrapper]') as HTMLElement;
      const rect = wrap.getBoundingClientRect();
      wrap.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: rect.right - 10,
          clientY: rect.top + 10,
        })
      );
    });
    await page.locator('div[class*="menu"] button', { hasText: 'Copy selected text' }).first().click();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe('cde');
    await shot(page, 'desktop-text-selection-menu.png');
    await server.stop();
  });

  test('context menu: only one menu is ever open at a time', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('onemenu'));
    await sendText(page, 'menu-one');
    await sendText(page, 'menu-two');
    await page.waitForTimeout(300);

    // The context menu is portaled to <body> (the sidebar hamburger menu
    // is not), so count only body-level menu roots. Synthetic contextmenu
    // dispatches target the bubble directly (a real pointer right-click
    // would be intercepted by the first menu, which is position:fixed).
    const menus = page.locator('body > div[class*="menu"]');
    const rightClick = (idx: number, cx: number, cy: number) =>
      page.evaluate(({ idx, cx, cy }) => {
        const wraps = document.querySelectorAll('[data-message-wrapper]');
        const el = wraps[idx] as HTMLElement;
        el.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: cx,
            clientY: cy,
          })
        );
      }, { idx, cx, cy });

    // Right-click the first bubble → its menu opens.
    await rightClick(0, 300, 160);
    await expect(page.locator('div[class*="menu"] button', { hasText: 'Copy' }).first()).toBeVisible();
    expect(await menus.count()).toBe(1);

    // Right-click a second bubble → the first menu closes, no stacking.
    await rightClick(1, 300, 240);
    await page.waitForTimeout(200);
    expect(await menus.count()).toBe(1);

    // Left-click anywhere closes it.
    await page.mouse.click(10, 10);
    await page.waitForTimeout(200);
    expect(await menus.count()).toBe(0);
    await server.stop();
  });

  test('multi-select: checkbox mode, plate, confirm batch delete', async ({ page }) => {
    await page.setViewportSize({ width: 1584, height: 960 });
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('multisel'));

    const a = `sel-a-${Date.now()}`;
    const b = `sel-b-${Date.now()}`;
    await sendText(page, a);
    await sendText(page, b);

    // Right-click A → Select → enters selection mode with A checked.
    const bubbleA = page.locator('div[data-message-id]', { hasText: a }).first();
    await bubbleA.click({ button: 'right' });
    await page.locator('div[class*="menu"] button', { hasText: 'Select' }).first().click();
    await expect(page.locator('button[aria-label="Select message"]').first()).toBeVisible({ timeout: 5000 });
    await shot(page, 'desktop-selection-mode.png');

    // Click message B → both selected.
    await page.locator('div[data-message-id]', { hasText: b }).first().click();
    await expect(page.locator('text=2 selected').first()).toBeVisible();

    // Delete → confirm dialog.
    await page.click('button[aria-label="Delete selected"]');
    await expect(page.locator('text=Delete 2 messages?')).toBeVisible({ timeout: 5000 });
    await shot(page, 'desktop-selection-confirm.png');
    await page.locator('div[class*="dialog"] button', { hasText: 'Delete' }).click();

    await expect(page.locator(`text=${a}`).first()).toBeHidden({ timeout: 10000 });
    await expect(page.locator(`text=${b}`).first()).toBeHidden({ timeout: 10000 });
    await server.stop();
  });

  test('scrolled up: new message shows the unread badge', async ({ page }) => {
    await page.setViewportSize({ width: 1584, height: 960 });
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    const code = uniqueCode('badge');
    await login(page, base, code);

    // Seed history through the API (fast, no smooth-scroll interference).
    const info = await (await fetch(`${base}/api/v1/info`)).json();
    const keys = await deriveKeys(code, info.instanceId);
    const token = await ensureSpace(base, code);
    const batch = Date.now() % 100000;
    for (let i = 0; i < 25; i++) {
      await seedEncryptedText(base, token, keys.messageKey, keys.spaceId, `hist-${batch}-${i}`);
    }
    await page.reload();
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator(`text=hist-${batch}-24`).first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(400);

    await page.evaluate(() => {
      const el = document.querySelector('div[class*="container"]') as HTMLElement;
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(300);

    await sendText(page, `fresh-${Date.now()}`);
    await page.waitForTimeout(800);

    const btn = page.locator('button[aria-label*="new messages"]');
    await expect(btn).toBeVisible({ timeout: 5000 });
    await expect(btn.locator('span').first()).toHaveText('1');
    await shot(page, 'desktop-scrolled-new-message.png');
    await btn.click();
    await expect(btn).toBeHidden({ timeout: 5000 });
    await server.stop();
  });

  test('A: restart keeps encrypted messages and files, auto re-login on refresh', async ({ page }) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-e2e-a-'));
    const port = 19000 + Math.floor(Math.random() * 500);
    const base = `http://127.0.0.1:${port}`;
    const code = uniqueCode('restart');

    const server1 = await startServer({ dataDir, port });
    await login(page, base, code);
    const hello = `hello-${Date.now()}`;
    await sendText(page, hello);
    await uploadFile(page, { name: `kept-${Date.now()}.txt`, mimeType: 'text/plain', buffer: Buffer.from('kept') });
    await server1.stop();

    // Restart the same data dir. sessionStorage (per-tab crypto session)
    // survives the reload → auto re-login, no CODE prompt.
    const server2 = await startServer({ dataDir, port });
    await page.reload();
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator(`text=${hello}`).first()).toBeVisible({ timeout: 10000 });
    await server2.stop();
  });

  test('C: ephemeral run cleans up its temp data on shutdown', async ({ page }) => {
    const before = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('filehelper-ephemeral-')));
    const server = await startServer({ ephemeral: true });
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('eph'));
    await sendText(page, 'ephemeral-text');
    await server.stop();

    await page.waitForTimeout(1000);
    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('filehelper-ephemeral-'));
    for (const n of after) {
      expect(before.has(n)).toBe(true);
    }
  });

  test('lock: returns to Enter Code, re-login restores history; About shows the server version', async ({ page }) => {
    await page.setViewportSize({ width: 1584, height: 960 });
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    const code = uniqueCode('lock');
    await login(page, base, code);
    const msg = `locked-msg-${Date.now()}`;
    await sendText(page, msg);

    // About → version comes from the server info endpoint (never hardcode).
    const info = await (await fetch(`${base}/api/v1/info`)).json();
    await page.click('button[aria-label="Open menu"]');
    await page.locator('div[class*="menu"] button', { hasText: 'About' }).click();
    await expect(page.locator(`text=Version ${info.version}`).first()).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');

    // Lock → back to the CODE prompt.
    await page.click('button[aria-label="Open menu"]');
    await page.locator('div[class*="menu"] button', { hasText: 'Lock' }).click();
    await expect(page.locator('input[placeholder="••••••••••••••"]')).toBeVisible({ timeout: 5000 });

    // Same code → history restored from the server.
    await page.fill('input[placeholder="••••••••••••••"]', code);
    await page.click('button[type="submit"]');
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator(`text=${msg}`).first()).toBeVisible({ timeout: 10000 });
    await server.stop();
  });

  test('mobile: sidebar → chat, selection plate inside viewport', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, base, uniqueCode('mobile'));
    await sendText(page, 'mobile-msg');
    await shot(page, 'mobile-sidebar.png');

    await page.locator('div[class*="chatRow"]').click();
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, 'mobile-chat.png');

    // Mobile image preview.
    await uploadFile(page, { name: 'mobile.png', mimeType: 'image/png', buffer: solidPng(320, 200, [51, 144, 236]) });
    await expect(page.locator('[data-image-message] img').first()).toBeVisible({ timeout: 15000 });
    await shot(page, 'mobile-image-preview.png');

    // Enter selection mode; the plate must stay within the viewport.
    await page.locator('div[data-message-id]').first().click({ button: 'right' });
    await page.locator('div[class*="menu"] button', { hasText: 'Select' }).first().click();
    await expect(page.locator('text=1 selected').first()).toBeVisible({ timeout: 5000 });
    const plate = page.locator('div[class*="plate"]').first();
    const pbox = await plate.boundingBox();
    expect(pbox).not.toBeNull();
    expect(pbox!.y + pbox!.height).toBeLessThanOrEqual(844);
    await shot(page, 'mobile-selection.png');
    await server.stop();
  });
});
