import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PASSWORD = 'test123';
// Playwright runs with cwd = web/
const SCREENSHOT_DIR = path.join(process.cwd(), '../docs/screenshots');
const FILES_DIR = path.join(process.cwd(), '../test-data-e2e/files');

async function login(page: Page) {
  await page.goto('/');
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page.locator('input[type="password"]')).toBeHidden({ timeout: 10000 });
  await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible({ timeout: 5000 });
}

async function seedMessage(page: Page, text: string) {
  return page.evaluate(async (t) => {
    const res = await fetch('/api/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FileHelper-Request': '1' },
      body: JSON.stringify({ text: t }),
    });
    return res.status;
  }, text);
}

function shot(page: Page, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  return page.screenshot({ path: path.join(SCREENSHOT_DIR, name), fullPage: false });
}


async function waitUploadDone(page: Page, name: string) {
  // The upload progress bubble (with Cancel) must disappear and the final
  // message bubble (with Download) must appear before interacting.
  await page.locator('button[aria-label="Cancel"]').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  await page
    .locator('div[data-message-id]', { hasText: name })
    .locator('button[aria-label="Download"]')
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(300);
}

test.describe('FileHelper bugfix pass', () => {
  test('login page, wrong password error', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('FileHelper');
    await page.fill('input[type="password"]', 'wrong');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Invalid password')).toBeVisible({ timeout: 5000 });
  });

  test('desktop: sidebar + chat fill viewport without huge blank margins', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.waitForTimeout(500);

    await expect(page.getByText('file transfer assistant').first()).toBeVisible();

    // Chat area occupies the remaining width: composer extends well past
    // the sidebar (~380px), proving the chat is not a narrow centered strip.
    const composer = page.locator('textarea[placeholder="Message"]');
    const composerBox = await composer.boundingBox();
    expect(composerBox).not.toBeNull();
    expect(composerBox!.x).toBeGreaterThan(300);
    expect(composerBox!.x + composerBox!.width).toBeGreaterThan(1000);

    await shot(page, 'desktop-normal.png');
  });

  test('desktop: search opens right panel (no fullscreen white overlay) and jumps to result', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    const marker = `needle-${Date.now()} message 1`;
    expect(await seedMessage(page, marker)).toBe(200);
    await page.reload();
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible();

    await page.click('button[aria-label="Search"]');
    // Right-side panel: input visible, chat must remain visible too.
    const input = page.locator('input[placeholder="Search messages..."]');
    await expect(input).toBeVisible();
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible();

    await input.fill('1');
    const result = page.locator('button[class*="resultItem"]', { hasText: marker }).first();
    await expect(result).toBeVisible({ timeout: 5000 });

    await shot(page, 'desktop-search.png');

    // Click result → panel closes, message is visible in the list.
    await result.click();
    await expect(input).toBeHidden();
    const target = page.locator('div[data-message-id]', { hasText: marker }).first();
    await expect(target).toBeVisible({ timeout: 5000 });
  });

  test('scroll-to-bottom button works even when all history is loaded', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    // Seed fewer than 50 messages so hasNextPage=false — the button must
    // still appear (regression: handler used to skip the whole update).
    const batch = Date.now() % 100000;
    for (let i = 0; i < 30; i++) {
      await seedMessage(page, `scroll-${batch}-${i}`);
    }
    await page.reload();
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible();
    await page.waitForTimeout(800);

    const scrollBtn = page.locator('button[aria-label="Scroll to bottom"]');
    await page.evaluate(() => {
      const el = document.querySelector('div[class*="container"]') as HTMLElement;
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    await expect(scrollBtn).toBeVisible({ timeout: 5000 });

    await scrollBtn.click();
    await expect(scrollBtn).toBeHidden({ timeout: 5000 });
  });

  test('context menu on bottom message stays inside viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    const stamp = `menu-${Date.now()}`;
    await seedMessage(page, stamp);
    await page.reload();
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible();
    await page.waitForTimeout(500);

    const bubble = page.locator('div[data-message-id]', { hasText: stamp }).last();
    await bubble.scrollIntoViewIfNeeded();
    await bubble.click({ button: 'right' });
    await page.waitForTimeout(300);

    const menu = page.locator('div[class*="menu"]').first();
    await expect(menu).toBeVisible({ timeout: 5000 });
    // Text message: Copy + Delete.
    await expect(menu.locator('text=Copy')).toBeVisible();
    await expect(menu.locator('text=Delete')).toBeVisible();

    const menuBox = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    expect(menuBox.left).toBeGreaterThanOrEqual(0);
    expect(menuBox.top).toBeGreaterThanOrEqual(0);
    expect(menuBox.right).toBeLessThanOrEqual(1440);
    expect(menuBox.bottom).toBeLessThanOrEqual(900);

    await shot(page, 'desktop-context-menu-bottom.png');

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('deleting an uploaded file removes the bubble and the disk file', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    const name = `doomed-${Date.now()}.txt`;
    await page.locator('input[type="file"]').setInputFiles({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from('delete me'),
    });
    await waitUploadDone(page, name);

    const before = fs.readdirSync(FILES_DIR);
    expect(before.length).toBeGreaterThan(0);

    page.on('dialog', (d) => d.accept());
    await page
      .locator('div[data-message-id]', { hasText: name })
      .first()
      .click({ button: 'right' });
    await page.locator('div[class*="menu"] button', { hasText: 'Delete' }).first().click();

    // UI: bubble disappears.
    await expect(page.locator(`text=${name}`).first()).toBeHidden({ timeout: 10000 });

    // Backend: physical file removed from data/files.
    await page.waitForTimeout(500);
    const after = fs.readdirSync(FILES_DIR);
    expect(after.length).toBeLessThan(before.length);
  });

  test('save-as downloads the file', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    const name = `saveas-${Date.now()}.txt`;
    await page.locator('input[type="file"]').setInputFiles({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from('save me'),
    });
    await waitUploadDone(page, name);

    const downloadPromise = page.waitForEvent('download');
    await page
      .locator('div[data-message-id]', { hasText: name })
      .first()
      .click({ button: 'right' });
    await page.locator('div[class*="menu"] button', { hasText: 'Save as' }).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(name);
  });

  test('mobile: single-column with sidebar first, search goes fullscreen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    // On mobile we start on the sidebar panel.
    await expect(page.getByText('file transfer assistant')).toBeVisible();

    // Chat opens via the chat row.
    await page.locator('div[class*="chatRow"]').click();
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible();

    await shot(page, 'mobile-normal.png');

    // Search button in header → fullscreen search mode.
    await page.click('button[aria-label="Search"]');
    const input = page.locator('input[placeholder="Search messages..."]');
    await expect(input).toBeVisible();
    await input.fill('1');
    await expect(
      page.locator('text=No results').or(page.locator('button[class*="resultItem"]').first())
    ).toBeVisible({ timeout: 5000 });

    await shot(page, 'mobile-search.png');
  });

  test('send text message end-to-end', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    const text = `hello-${Date.now()}`;
    await page.locator('textarea[placeholder="Message"]').fill(text);
    await page.keyboard.press('Enter');
    await expect(page.locator(`text=${text}`).first()).toBeVisible({ timeout: 5000 });
  });
});