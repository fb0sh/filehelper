import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers';

const SCREENSHOT_DIR = path.join(process.cwd(), '../docs/screenshots');

function shot(page: Page, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  return page.screenshot({ path: path.join(SCREENSHOT_DIR, name), fullPage: false });
}

async function login(page: Page, base: string, code: string) {
  await page.goto(`${base}/`);
  await page.fill('input[placeholder="Access code"]', code);
  await page.click('button[type="submit"]');
  await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible({ timeout: 10000 });
}

async function seedMessage(page: Page, base: string, text: string) {
  return page.evaluate(async (t) => {
    const res = await fetch('/api/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FileHelper-Request': '1' },
      body: JSON.stringify({ text: t }),
    });
    return res.status;
  }, text);
}

test.describe('FileHelper E2E', () => {
  // -----------------------------------------------------------------
  // Layout acceptance
  // -----------------------------------------------------------------
  test('desktop layout: sidebar + chat fill viewport', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, server.accessCode!);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);

    const composer = page.locator('textarea[placeholder="Message"]');
    const box = await composer.boundingBox();
    expect(box).not.toBeNull();
    // Chat area starts after the ~380px sidebar and reaches the right edge.
    expect(box!.x).toBeGreaterThan(300);
    expect(box!.x + box!.width).toBeGreaterThan(1000);

    // Sidebar chat row is selected.
    await expect(page.locator('div[class*="chatRow"]').first()).toBeVisible();

    await shot(page, 'desktop-main.png');
    await server.stop();
  });

  test('wide viewport keeps chat filling and messages centered', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await page.setViewportSize({ width: 1920, height: 1080 });
    await login(page, base, server.accessCode!);
    await page.waitForTimeout(500);

    const composer = page.locator('textarea[placeholder="Message"]');
    const box = await composer.boundingBox();
    expect(box!.x).toBeGreaterThan(300);
    expect(box!.x + box!.width).toBeGreaterThan(1400);

    // Messages content stays bounded (centered column inside chat).
    const wrapper = page.locator('div[class*="messagesWrapper"]').first();
    const wbox = await wrapper.boundingBox();
    expect(wbox!.width).toBeLessThan(800);

    await server.stop();
  });

  test('desktop search: topbar search mode with counter and navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, server.accessCode!);

    const stamp = Date.now();
    const markerA = `needle-${stamp}-a`;
    const markerB = `needle-${stamp}-b`;
    expect(await seedMessage(page, base, markerA)).toBe(200);
    expect(await seedMessage(page, base, markerB)).toBe(200);
    await page.reload();
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible();

    // Click Search → header turns into the Telegram-style topbar search.
    await page.click('button[aria-label="Search"]');
    const input = page.locator('input[placeholder="Search messages..."]');
    await expect(input).toBeVisible();
    // Chat stays visible: no right-side panel, no overlay.
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible();

    await input.fill('needle');
    await expect(page.locator('text=1 of 2').first()).toBeVisible({ timeout: 5000 });
    await shot(page, 'desktop-search.png');

    // Navigate with ↑; the search mode must stay open after jumping.
    await page.click('button[aria-label="Older match"]');
    await expect(page.locator('text=2 of 2').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[placeholder="Search messages..."]')).toBeVisible();
    await expect(page.locator('div[data-message-id]', { hasText: markerA }).first()).toBeVisible({ timeout: 5000 });

    // X closes back to the normal header.
    await page.click('button[aria-label="Close search"]');
    await expect(input).toBeHidden();
    await server.stop();
  });

  test('scrolled up: new message shows the unread badge button', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, server.accessCode!);

    const batch = Date.now() % 100000;
    for (let i = 0; i < 25; i++) await seedMessage(page, base, `hist-${batch}-${i}`);
    await page.reload();
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible();
    await page.waitForTimeout(600);

    // Scroll up into history.
    await page.evaluate(() => {
      const el = document.querySelector('div[class*="container"]') as HTMLElement;
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(300);

    // A new message arrives while the user is scrolled up.
    const fresh = `fresh-${Date.now()}`;
    await seedMessage(page, base, fresh);
    await page.waitForTimeout(800);

    // Badge button visible with count, user NOT pulled to bottom.
    const btn = page.locator('button[aria-label*="new messages"]');
    await expect(btn).toBeVisible({ timeout: 5000 });
    const badge = btn.locator('span').first();
    await expect(badge).toHaveText('1');
    await shot(page, 'desktop-scrolled-new-message.png');

    // Click → back to bottom, badge clears.
    await btn.click();
    await expect(btn).toBeHidden({ timeout: 5000 });
    await expect(page.locator(`text=${fresh}`).first()).toBeVisible();
    await server.stop();
  });

  test('scroll-to-bottom works even with all history loaded', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, server.accessCode!);
    const batch = Date.now() % 100000;
    for (let i = 0; i < 30; i++) await seedMessage(page, base, `scroll-${batch}-${i}`);
    await page.reload();
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible();
    await page.waitForTimeout(800);

    const btn = page.locator('button[aria-label="Scroll to bottom"]');
    await page.evaluate(() => {
      const el = document.querySelector('div[class*="container"]') as HTMLElement;
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.click();
    await expect(btn).toBeHidden({ timeout: 5000 });
    await server.stop();
  });

  test('context menu on bottom message stays inside viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, server.accessCode!);
    const stamp = `menu-${Date.now()}.txt`;
    await page.locator('input[type="file"]').setInputFiles({ name: stamp, mimeType: 'text/plain', buffer: Buffer.from('menu') });
    await page.locator('button[aria-label="Cancel"]').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await page.locator('div[data-message-id]', { hasText: stamp }).locator('button[aria-label="Download"]').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(300);

    const bubble = page.locator('div[data-message-id]', { hasText: stamp }).last();
    await bubble.scrollIntoViewIfNeeded();
    await bubble.click({ button: 'right' });
    await page.waitForTimeout(300);

    const menu = page.locator('div[class*="menu"]').first();
    await expect(menu).toBeVisible({ timeout: 5000 });
    // File message menu: Download + Delete always; Save as… when the
    // native picker is available (Chromium secure context → yes).
    await expect(menu.locator('text=Download')).toBeVisible();
    await expect(menu.locator('text=Save as…')).toBeVisible();
    await expect(menu.locator('text=Delete')).toBeVisible();
    const box = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(1440);
    expect(box.bottom).toBeLessThanOrEqual(900);
    await shot(page, 'desktop-context-menu.png');
    await page.keyboard.press('Escape');
    await server.stop();
  });

  test('mobile: sidebar first, chat via row, search fullscreen', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, base, server.accessCode!);
    await expect(page.getByText('file transfer assistant').first()).toBeVisible();
    await shot(page, 'mobile-sidebar.png');

    await page.locator('div[class*="chatRow"]').click();
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, 'mobile-chat.png');

    await page.click('button[aria-label="Search"]');
    await expect(page.locator('input[placeholder="Search messages..."]')).toBeVisible();
    await server.stop();
  });

  test('deleting an uploaded file removes bubble and disk file', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, server.accessCode!);

    const name = `doomed-${Date.now()}.txt`;
    await page.locator('input[type="file"]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from('x') });
    await page.locator('button[aria-label="Cancel"]').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await page.locator('div[data-message-id]', { hasText: name }).locator('button[aria-label="Download"]').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(300);

    const filesDir = path.join(server.dataDir, 'files');
    const before = fs.readdirSync(filesDir);
    expect(before.length).toBeGreaterThan(0);

    page.on('dialog', (d) => d.accept());
    await page.locator('div[data-message-id]', { hasText: name }).first().click({ button: 'right' });
    await page.locator('div[class*="menu"] button', { hasText: 'Delete' }).first().click();
    await expect(page.locator(`text=${name}`).first()).toBeHidden({ timeout: 10000 });
    await page.waitForTimeout(500);
    expect(fs.readdirSync(filesDir).length).toBeLessThan(before.length);
    await server.stop();
  });

  // -----------------------------------------------------------------
  // Spec 25: lifecycle tests (Test A / B / C)
  // -----------------------------------------------------------------
  test('A: restart changes code but keeps messages and files', async ({ page }) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-e2e-a-'));
    const port = 19000 + Math.floor(Math.random() * 500);
    const base1 = `http://127.0.0.1:${port}`;

    const server1 = await startServer({ dataDir, port });
    await login(page, base1, server1.accessCode!);
    const hello = `hello-${Date.now()}`;
    await page.locator('textarea[placeholder="Message"]').fill(hello);
    await page.keyboard.press('Enter');
    await expect(page.locator(`text=${hello}`).first()).toBeVisible({ timeout: 5000 });

    const fileName = `restart-${Date.now()}.txt`;
    await page.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: Buffer.from('kept') });
    await page.locator('button[aria-label="Cancel"]').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await page.locator('div[data-message-id]', { hasText: fileName }).first().waitFor({ state: 'visible', timeout: 15000 });

    await server1.stop();

    // Restart the same data dir: fresh access code, old session invalid.
    const server2 = await startServer({ dataDir, port });
    expect(server2.accessCode).not.toBe(server1.accessCode);

    await page.reload();
    await expect(page.locator('input[placeholder="Access code"]')).toBeVisible({ timeout: 10000 });

    // The new code lets the user in; history and files are preserved.
    await page.fill('input[placeholder="Access code"]', server2.accessCode!);
    await page.click('button[type="submit"]');
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text=${hello}`).first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator(`text=${fileName}`).first()).toBeVisible({ timeout: 5000 });

    await server2.stop();
  });

  test('B: reset-code invalidates sessions, new code works, history kept', async ({ page }) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-e2e-b-'));
    const port = 19500 + Math.floor(Math.random() * 400);
    const base = `http://127.0.0.1:${port}`;

    const server1 = await startServer({ dataDir, port });
    await login(page, base, server1.accessCode!);
    await seedMessage(page, base, 'history-marker');
    await expect(page.locator('text=history-marker').first()).toBeVisible({ timeout: 5000 });
    await server1.stop();

    // Restart with --reset-code.
    const server2 = await startServer({ dataDir, port, resetCode: true });
    expect(server2.accessCode).not.toBe(server1.accessCode);

    // Old cookie invalid → login page.
    await page.reload();
    await expect(page.locator('input[placeholder="Access code"]')).toBeVisible({ timeout: 10000 });

    // Old code fails.
    await page.fill('input[placeholder="Access code"]', server1.accessCode!);
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Invalid access code')).toBeVisible({ timeout: 5000 });

    // New code succeeds and history is preserved.
    await page.fill('input[placeholder="Access code"]', server2.accessCode!);
    await page.click('button[type="submit"]');
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=history-marker').first()).toBeVisible({ timeout: 5000 });

    await server2.stop();
  });

  test('C: ephemeral run cleans up its temp data on shutdown', async ({ page }) => {
    const before = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('filehelper-ephemeral-')));
    const server = await startServer({ ephemeral: true });
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, server.accessCode!);

    await page.locator('input[type="file"]').setInputFiles({ name: 'ephemeral.txt', mimeType: 'text/plain', buffer: Buffer.from('gone') });
    await page.locator('button[aria-label="Cancel"]').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await page.locator('div[data-message-id]', { hasText: 'ephemeral.txt' }).first().waitFor({ state: 'visible', timeout: 15000 });

    await server.stop();

    // No ephemeral dirs were left behind.
    await page.waitForTimeout(1000);
    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('filehelper-ephemeral-'));
    for (const n of after) {
      expect(before.has(n)).toBe(true);
    }
  });

  test('send text message end-to-end', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, server.accessCode!);
    const text = `hello-${Date.now()}`;
    await page.locator('textarea[placeholder="Message"]').fill(text);
    await page.keyboard.press('Enter');
    await expect(page.locator(`text=${text}`).first()).toBeVisible({ timeout: 5000 });
    await server.stop();
  });
});