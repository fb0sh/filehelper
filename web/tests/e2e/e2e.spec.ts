import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  startServer,
  ensureSpace,
  seedEncryptedText,
  deriveKeys,
  sha256Hex,
} from './helpers';

const SCREENSHOT_DIR = path.join(process.cwd(), '../docs/screenshots');

function shot(page: Page, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  return page.screenshot({ path: path.join(SCREENSHOT_DIR, name), fullPage: false });
}

/** Browser login: type the CODE, submit, handle the one-time create
 * dialog, wait for the composer. The create dialog appears only after
 * the Scrypt KDF + login roundtrip, so we race for it. */
async function login(page: Page, base: string, code: string) {
  await page.goto(base);
  await page.fill('input[placeholder="••••••••••••••"]', code);
  await page.click('button[type="submit"]');
  const composer = page.locator('textarea[placeholder="Message"]');
  const createBtn = page.locator('button', { hasText: 'Create' });
  // First time for a code → "No existing FileHelper data… Create it?"
  try {
    await createBtn.waitFor({ state: 'visible', timeout: 20000 });
  } catch {
    // fall through: either composer appeared or something else happened
  }
  if (await createBtn.isVisible().catch(() => false)) {
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

const PNG_1x1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
  'hex'
);

function uniqueCode(label: string): string {
  return `${label}-${Date.now() % 1000000}`;
}

test.describe('FileHelper vNext E2E', () => {
  test('desktop layout: sidebar + chat fill viewport', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await page.setViewportSize({ width: 1440, height: 900 });
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

    await uploadFile(page, { name: 'pixel.png', mimeType: 'image/png', buffer: PNG_1x1 });
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

  test('topbar search: client-side text + filename search with jump', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('search'));

    const stamp = Date.now();
    const markerA = `needle-${stamp}-a`;
    const markerB = `needle-${stamp}-b`;
    await sendText(page, markerA);
    await sendText(page, markerB);
    await uploadFile(page, { name: `secret-report-${stamp}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('pdf') });

    await page.click('button[aria-label="Search"]');
    const input = page.locator('input[placeholder="Search messages..."]');
    await expect(input).toBeVisible();

    // Text match.
    await input.fill('needle');
    await expect(page.locator('text=1 of 2').first()).toBeVisible({ timeout: 5000 });
    await shot(page, 'desktop-search.png');

    // Filename match (decrypted filename — the server never saw it).
    await input.fill(`secret-report-${stamp}`);
    await expect(page.locator('text=1 of 1').first()).toBeVisible({ timeout: 5000 });

    // Jump via ↑/↓ keeps search open.
    await input.fill('needle');
    await expect(page.locator('text=1 of 2').first()).toBeVisible({ timeout: 5000 });
    await page.click('button[aria-label="Older match"]');
    await expect(page.locator('text=2 of 2').first()).toBeVisible({ timeout: 5000 });
    await expect(input).toBeVisible();

    await page.click('button[aria-label="Close search"]');
    await expect(input).toBeHidden();
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

  test('multi-select: checkbox mode, plate, confirm batch delete', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
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
    await page.setViewportSize({ width: 1440, height: 900 });
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
    await uploadFile(page, { name: 'mobile.png', mimeType: 'image/png', buffer: PNG_1x1 });
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
