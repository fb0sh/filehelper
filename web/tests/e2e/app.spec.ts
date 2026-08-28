import { test, expect } from '@playwright/test';

test.describe('FileHelper E2E', () => {
  test('login page is shown', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('FileHelper');
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toHaveText('Next');
  });

  test('wrong password shows error', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="password"]', 'wrong');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Invalid password')).toBeVisible({ timeout: 5000 });
  });

  test('correct password enters main UI', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="password"]', 'test123');
    await page.click('button[type="submit"]');
    await expect(page.locator('input[type="password"]')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible({ timeout: 5000 });
  });

  test('send text message', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="password"]', 'test123');
    await page.click('button[type="submit"]');
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible({ timeout: 10000 });

    const uniqueText = `Hello ${Date.now()}`;
    await page.locator('textarea[placeholder="Message"]').fill(uniqueText);
    await page.keyboard.press('Enter');
    await expect(page.locator(`text=${uniqueText}`)).toBeVisible({ timeout: 5000 });
  });

  test('upload a file', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="password"]', 'test123');
    await page.click('button[type="submit"]');
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible({ timeout: 10000 });

    const filename = `e2e-${Date.now()}.txt`;
    await page.locator('input[type="file"]').setInputFiles({
      name: filename,
      mimeType: 'text/plain',
      buffer: Buffer.from('e2e test content'),
    });
    await expect(page.locator(`text=${filename}`)).toBeVisible({ timeout: 10000 });
  });

  test('search panel opens', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="password"]', 'test123');
    await page.click('button[type="submit"]');
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible({ timeout: 10000 });

    // Click search button in header
    await page.locator('button[aria-label="Search"]').click();
    await expect(page.locator('input[placeholder="Search messages..."]')).toBeVisible({ timeout: 5000 });
  });

  test('dark theme', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="password"]', 'test123');
    await page.click('button[type="submit"]');
    await expect(page.locator('textarea[placeholder="Message"]')).toBeVisible({ timeout: 10000 });

    const html = page.locator('html');
    const theme = await html.getAttribute('data-theme');
    expect(['light', 'dark']).toContain(theme);
  });

  test('mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('FileHelper');
  });
});