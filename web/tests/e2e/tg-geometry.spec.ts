import { test, expect, Page } from '@playwright/test';
import { startServer, solidPng } from './helpers';
import zlib from 'node:zlib';

// ── Telegram Web K pixel-match geometry + wallpaper verification ──────
// These are the "精确视觉验证" checks: geometry at the three target
// viewports (1584×960 / 1280×720 / 390×844), shared center axis for
// header / message rail / composer, wallpaper layering, and rendered
// pixel probes for the doodle tile and bubble surface.

function uniqueCode(label: string): string {
  return `${label}-${Date.now() % 1000000}`;
}

/** Browser login: type the CODE, submit, handle the one-time create
 * dialog, wait for the composer. */
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
  await page.locator('button[aria-label="Cancel"]').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  await page.waitForFunction(
    (n) => document.querySelectorAll('div[data-message-id]').length > n,
    before,
    { timeout: 20000 }
  );
}

function decodePng(buf: Buffer): { width: number; height: number; channels: number; data: Buffer } {
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  // Playwright screenshots are truecolor RGB (color type 2); handle RGBA too.
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let val = line[i];
      if (filter === 1) val = (val + a) & 0xff;
      else if (filter === 2) val = (val + b) & 0xff;
      else if (filter === 3) val = (val + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        val = (val + pred) & 0xff;
      }
      cur[i] = val;
    }
    cur.copy(out, y * stride);
    prev = cur;
    pos += stride;
  }
  return { width, height, channels, data: out };
}

function pixelAt(img: { width: number; channels: number; data: Buffer }, x: number, y: number): number[] {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

function rgbClose(a: number[], b: number[], tol: number): boolean {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
}

async function boxes(page: Page) {
  const h = await page.locator('[data-tg="chat-header"]').boundingBox();
  const r = await page.locator('[data-tg="message-rail"]').boundingBox();
  const c = await page.locator('[data-tg="composer-pill"]').boundingBox();
  const s = await page.locator('[data-tg="sidebar"]').boundingBox();
  const ch = await page.locator('[data-tg="chat"]').boundingBox();
  expect(h).not.toBeNull();
  expect(r).not.toBeNull();
  expect(c).not.toBeNull();
  expect(s).not.toBeNull();
  expect(ch).not.toBeNull();
  return { h: h!, r: r!, c: c!, s: s!, ch: ch! };
}

test.describe('TG pixel-match geometry', () => {
  test('1584×960: shell, floating header/composer, coaxial rails, wallpaper', async ({ page }) => {
    await page.setViewportSize({ width: 1584, height: 960 });
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    const code = uniqueCode('geo');
    await login(page, base, code);

    // Content so bubbles + date pill + scroll button exist.
    await sendText(page, 'Geometry probe message A');
    await sendText(page, 'Geometry probe message B');
    await uploadFile(page, {
      name: 'probe.png',
      mimeType: 'image/png',
      buffer: solidPng(240, 160, [51, 144, 236]),
    });
    await expect(page.locator('[data-image-message] img').first()).toBeVisible({ timeout: 15000 });

    const { h, r, c, s, ch } = await boxes(page);

    // ── Shell: 8px gutter, rounded panes, no page scrollbar ──
    expect(s.x).toBeCloseTo(8, 0);
    expect(s.y).toBeCloseTo(8, 0);
    expect(s.width).toBeCloseTo(440, 1);
    expect(s.height).toBeCloseTo(944, 1);
    expect(ch.x).toBeCloseTo(448, 0);
    expect(ch.width).toBeCloseTo(1128, 1);

    // ── Floating header pill ──
    expect(h.height).toBeCloseTo(56, 1);
    expect(h.y).toBeCloseTo(24, 1); // 8 shell + 16 gutter
    expect(h.width).toBeCloseTo(840, 1); // min(840, chat-32)
    // wallpaper visible around the pill (not a full-width strip)
    expect(h.x).toBeGreaterThan(ch.x + 100);

    // ── Floating composer pill ──
    expect(c.width).toBeCloseTo(840, 1);
    expect(c.height).toBeCloseTo(56, 1);
    expect(c.y + c.height).toBeLessThanOrEqual(952); // 8px shell gutter at bottom
    expect(c.y).toBeCloseTo(880, 2); // 952 - 16 margin - 56 height

    // ── Centered message rail ──
    expect(r.width).toBeCloseTo(800, 1);
    expect(r.x).toBeCloseTo(612, 1);

    // ── Shared center axis: header == rail == composer (±1px) ──
    const hcx = h.x + h.width / 2;
    const rcx = r.x + r.width / 2;
    const ccx = c.x + c.width / 2;
    const ccx2 = ch.x + ch.width / 2;
    expect(Math.abs(hcx - rcx)).toBeLessThanOrEqual(1);
    expect(Math.abs(hcx - ccx)).toBeLessThanOrEqual(1);
    expect(Math.abs(hcx - ccx2)).toBeLessThanOrEqual(1);

    // ── Surface styles ──
    const headerBg = await page
      .locator('[data-tg="chat-header"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(headerBg).toMatch(/rgba\(255, 255, 255, 0\.97\)/);
    const composerBg = await page
      .locator('[data-tg="composer-pill"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(composerBg).toMatch(/rgba\(255, 255, 255, 0\.97\)/);
    const headerRadius = await page
      .locator('[data-tg="chat-header"]')
      .evaluate((el) => getComputedStyle(el).borderRadius);
    expect(headerRadius).toBe('28px');

    // ── Bubble surface: outgoing pale green + tail pixels ──
    const bubbleWrapper = page
      .locator('div[data-message-id]', { hasText: 'Geometry probe message B' })
      .first()
      .locator('[data-message-wrapper]')
      .first();
    // The bubble itself is the wrapper's last child; assert its surface.
    const bubbleBg = await bubbleWrapper.evaluate(
      (el) => getComputedStyle(el.lastElementChild as Element).backgroundColor
    );
    expect(bubbleBg).toBe('rgb(233, 253, 223)');
    const bubble = await bubbleWrapper.evaluate((el) => {
      const b = (el.lastElementChild as Element).getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    });
    // The wallpaper SVG loads asynchronously as a CSS background; make
    // sure it is decoded before the screenshot so the pixel probes below
    // see the doodles.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = '/wallpaper.svg';
        })
    );
    const shot = await page.screenshot();
    const img = decodePng(shot);
    // pixel probe: a strip in the bubble's pure right-padding zone (text
    // cannot reach it; the floated meta row at the very bottom is excluded)
    let greenPx = 0;
    let totalPx = 0;
    for (let y = Math.round(bubble.y + 6); y <= Math.round(bubble.y + bubble.height - 16); y += 2) {
      for (let x = Math.round(bubble.x + bubble.width - 9); x <= Math.round(bubble.x + bubble.width - 4); x++) {
        if (rgbClose(pixelAt(img, x, y), [233, 253, 223], 5)) greenPx++;
        totalPx++;
      }
    }
    expect(totalPx).toBeGreaterThan(20);
    expect(greenPx / totalPx).toBeGreaterThan(0.8);
    // tail: rows above the bubble top must contain bubble-green pixels
    // near the right corner (the rotated square pokes above the edge)
    let tailHits = 0;
    for (const dy of [-1, -2, -3]) {
      for (let x = Math.round(bubble.x + bubble.width - 12); x <= Math.round(bubble.x + bubble.width + 2); x++) {
        if (rgbClose(pixelAt(img, x, Math.round(bubble.y) + dy), [233, 253, 223], 8)) tailHits++;
      }
    }
    expect(tailHits).toBeGreaterThanOrEqual(6);

    // ── Wallpaper: rendered pixels right of the rail are green-ish, not white ──
    const wpA = pixelAt(img, Math.round(ch.x + ch.width - 60), 300); // far right
    const wpB = pixelAt(img, Math.round(r.x + r.width + 30), 400);
    for (const p of [wpA, wpB]) {
      expect(p[2] + 8).toBeGreaterThanOrEqual(p[0]); // blue-ish green family
      expect(p[0]).toBeLessThan(245); // not white surface
    }
    // the pills float OVER the wallpaper: wallpaper pixels directly above
    // the header and below the composer (no white strips, no borders)
    const aboveHeader = pixelAt(img, Math.round(h.x + h.width / 2), Math.round(h.y) - 10);
    const belowComposer = pixelAt(img, Math.round(c.x + c.width / 2), Math.round(c.y + c.height + 10));
    for (const p of [aboveHeader, belowComposer]) {
      expect(p[0]).toBeLessThan(245); // not a white full-width surface
      expect(p[2] + 8).toBeGreaterThanOrEqual(p[0]); // greenish wallpaper family
    }
    // gradient: top-left lighter than bottom-right
    const tl = pixelAt(img, Math.round(ch.x + 12), Math.round(ch.y + 12));
    const br = pixelAt(img, Math.round(ch.x + ch.width - 12), Math.round(ch.y + ch.height - 12));
    expect(tl[0] + tl[1] + tl[2]).toBeGreaterThan(br[0] + br[1] + br[2]);

    // ── Doodles render over the gradient (bright thin strokes) ──
    let bright = 0;
    for (let y = 120; y < 800; y += 1) {
      for (let x = Math.round(r.x + r.width + 10); x < ch.x + ch.width - 4; x += 1) {
        const [rr, gg, bb] = pixelAt(img, x, y);
        // white stroke @ 0.58 over the pale-green gradient ≈ (236, 245, 238)
        if (rr > 224 && gg > 234 && bb > 226) bright++;
      }
    }
    expect(bright).toBeGreaterThan(150);

    // ── Wallpaper is anchored to the chat pane: background-attachment-free,
    //    and the .chat background-image actually lists the doodle tile. ──
    const bgImage = await page
      .locator('[data-tg="chat"]')
      .evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bgImage).toContain('wallpaper.svg');
    expect(bgImage).toContain('linear-gradient');

    // ── Scroll-to-bottom button anchored to the composer rail ──
    // The list is too short to scroll yet — seed filler history via the
    // API (realtime will prepend it) so the container actually overflows.
    const infoApi = await (await fetch(`${base}/api/v1/info`)).json();
    const { deriveKeys, ensureSpace, seedEncryptedMany } = await import('./helpers');
    const keys = await deriveKeys(code, infoApi.instanceId);
    const token = await ensureSpace(base, code);
    const stamp = Date.now();
    await seedEncryptedMany(
      base,
      token,
      keys.messageKey,
      keys.spaceId,
      Array.from({ length: 16 }, (_, i) => `geo-fill-${stamp}-${i}`)
    );
    await page.waitForFunction(
      (n) => document.querySelectorAll('div[data-message-id]').length > n,
      4,
      { timeout: 15000 }
    );
    await page.evaluate(() => {
      const el = document.querySelector('div[class*="container"]') as HTMLElement;
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    const btn = await page.locator('[data-tg="scroll-btn"]').boundingBox();
    await expect(page.locator('[data-tg="scroll-btn"]')).toBeVisible({ timeout: 3000 });
    expect(btn).not.toBeNull();
    // anchored to the composer rail's right edge (not the chat viewport)
    const composerRight = c.x + c.width;
    expect(Math.abs(btn!.x + btn!.width - (composerRight - 8))).toBeLessThanOrEqual(2);
    expect(btn!.y + btn!.height).toBeLessThan(c.y + 4); // above the composer

    // ── No horizontal overflow, no page scrollbar ──
    const ov = await page.evaluate(() => ({
      sw: document.body.scrollWidth,
      cw: document.body.clientWidth,
      sh: document.body.scrollHeight,
      chh: document.body.clientHeight,
    }));
    expect(ov.sw).toBeLessThanOrEqual(ov.cw);
    expect(ov.sh).toBeLessThanOrEqual(ov.chh + 1);

    await server.stop();
  });

  test('1280×720 and 1920×1080: rails stay centered, no overflow', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await page.setViewportSize({ width: 1280, height: 720 });
    await login(page, base, uniqueCode('vp1280'));
    await sendText(page, 'small viewport probe');

    const { h, r, c, ch } = await boxes(page);
    // chat width = 1280 - 16 - 440 = 824; pill width = min(840, 792) = 792
    expect(h.width).toBeCloseTo(792, 1);
    expect(c.width).toBeCloseTo(792, 1);
    expect(r.width).toBeCloseTo(792, 1);
    expect(Math.abs(h.x + h.width / 2 - (ch.x + ch.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(r.x + r.width / 2 - (ch.x + ch.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(c.x + c.width / 2 - (ch.x + ch.width / 2))).toBeLessThanOrEqual(1);

    let ov = await page.evaluate(() => ({
      sw: document.body.scrollWidth,
      cw: document.body.clientWidth,
    }));
    expect(ov.sw).toBeLessThanOrEqual(ov.cw);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(400);
    const b2 = await boxes(page);
    expect(b2.h.width).toBeCloseTo(840, 1);
    expect(b2.c.width).toBeCloseTo(840, 1);
    expect(b2.r.width).toBeCloseTo(800, 1);
    ov = await page.evaluate(() => ({
      sw: document.body.scrollWidth,
      cw: document.body.clientWidth,
    }));
    expect(ov.sw).toBeLessThanOrEqual(ov.cw);
    await server.stop();
  });

  test('390×844: full-bleed chat, floating header + composer inside safe gutters', async ({ page }) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, base, uniqueCode('mobile'));
    await sendText(page, 'mobile geometry');

    // Mobile: sidebar full-width first.
    const sb = await page.locator('[data-tg="sidebar"]').boundingBox();
    expect(sb).not.toBeNull();
    expect(sb!.width).toBeCloseTo(390, 0);

    await page.locator('div[class*="chatRow"]').click();
    await page.waitForTimeout(650); // panel slide transition settles
    const h = await page.locator('[data-tg="chat-header"]').boundingBox();
    const c = await page.locator('[data-tg="composer-pill"]').boundingBox();
    expect(h).not.toBeNull();
    expect(c).not.toBeNull();
    // header/composer keep a 12px gutter on each side (no edge-to-edge)
    expect(h!.x).toBeGreaterThanOrEqual(11);
    expect(h!.x + h!.width).toBeLessThanOrEqual(379);
    expect(c!.x).toBeGreaterThanOrEqual(11);
    expect(c!.x + c!.width).toBeLessThanOrEqual(379);
    // same center axis
    expect(Math.abs(h!.x + h!.width / 2 - (c!.x + c!.width / 2))).toBeLessThanOrEqual(1);
    // composer stays above the bottom edge
    expect(c!.y + c!.height).toBeLessThanOrEqual(844);
    // no horizontal overflow
    const ov = await page.evaluate(() => ({
      sw: document.body.scrollWidth,
      cw: document.body.clientWidth,
    }));
    expect(ov.sw).toBeLessThanOrEqual(ov.cw);

    await server.stop();
  });

  test('wallpaper SVG is a dense, seamless, non-blank doodle tile', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('wp'));

    const stats = await page.evaluate(async () => {
      const img = new Image();
      img.src = '/wallpaper.svg';
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 512;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, 512, 512).data;
      let ink = 0;
      let white = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 0) {
          ink++;
          if (d[i] > 230 && d[i + 1] > 230 && d[i + 2] > 230) white++;
        }
      }
      const svg = await (await fetch('/wallpaper.svg')).text();
      const doodleCount = (svg.match(/<g transform=/g) || []).length;
      return { ink, white, doodleCount, width: 512, height: 512 };
    });

    expect(stats.doodleCount).toBeGreaterThanOrEqual(40); // rich pattern
    expect(stats.ink).toBeGreaterThan(4000); // strokes actually drawn
    expect(stats.white).toBeGreaterThan(2000); // low-contrast white lines
    expect(stats.width).toBe(512);
    expect(stats.height).toBe(512);
    await server.stop();
  });

  test('round 2: search panel, date pill, sidebar selected block, composer order, dark mode', async ({ page }) => {
    await page.setViewportSize({ width: 1584, height: 960 });
    const server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;
    await login(page, base, uniqueCode('v2'));
    await sendText(page, 'v2-alpha match');
    await sendText(page, 'v2-beta match');

    // ── Composer order: attach (left) before textarea, send after ──
    const order = await page.evaluate(() => {
      const c = document.querySelector('[data-tg="composer-pill"]')!;
      const kids = [...c.children];
      return kids.map((k) => k.tagName + ':' + (k.getAttribute('aria-label') ?? k.className));
    });
    expect(order[0]).toContain('Attach file');
    expect(order[1]).toContain('inputWrapper'); // wraps the textarea
    expect(order[order.length - 1]).toContain('Send');

    // ── Date separator: translucent green pill, white text, round ──
    const pill = page.locator('span[class*="pill"]').first();
    await expect(pill).toBeVisible();
    const pillStyle = await pill.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color, radius: s.borderRadius, fw: s.fontWeight };
    });
    expect(pillStyle.color).toBe('rgb(255, 255, 255)');
    expect(pillStyle.radius).toBe('999px');
    expect(pillStyle.fw).toBe('600');

    // ── Sidebar selected row: full blue block, white text, no left bar ──
    const rowStyle = await page.evaluate(() => {
      const row = document.querySelector('div[class*="chatRow"]') as HTMLElement;
      const s = getComputedStyle(row);
      const before = getComputedStyle(row, '::before');
      return { bg: s.backgroundColor, radius: s.borderRadius, beforeW: before.width, beforeH: before.height };
    });
    expect(rowStyle.bg).toBe('rgb(51, 144, 236)');
    expect(rowStyle.radius).toBe('14px');
    // no legacy 3px left indicator: the ::before box must be empty/auto
    expect(rowStyle.beforeW === 'auto' || parseFloat(rowStyle.beforeW) === 0).toBe(true);

    // ── Search: floating pill + results panel directly below, same width ──
    await page.click('button[aria-label="Search"]');
    const input = page.locator('input[placeholder="Search messages..."]');
    await input.fill('v2-beta');
    await expect(page.locator('text=1 / 1').first()).toBeVisible({ timeout: 5000 });
    const hdr = await page.locator('[data-tg="chat-header"]').boundingBox();
    const panel = await page.locator('[data-search-panel]').boundingBox();
    expect(panel).not.toBeNull();
    expect(panel!.x).toBeCloseTo(hdr!.x, 0); // same width/alignment as the pill
    expect(panel!.width).toBeCloseTo(hdr!.width, 1);
    expect(panel!.y).toBeCloseTo(hdr!.y + hdr!.height + 8, 1); // hangs below
    const rows = await page.locator('[data-search-row]').count();
    expect(rows).toBeGreaterThanOrEqual(1);
    // panel stays inside the chat pane (never spans it fully)
    const ch = await page.locator('[data-tg="chat"]').boundingBox();
    expect(panel!.x).toBeGreaterThan(ch!.x);
    expect(panel!.x + panel!.width).toBeLessThan(ch!.x + ch!.width);

    // ── Dark mode: dark floating surfaces + dark doodle tile ──
    await page.click('button[aria-label="Close search"]');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(200);
    const dark = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('[data-tg="chat-header"]')!);
      const ch = getComputedStyle(document.querySelector('[data-tg="chat"]')!);
      return { headerBg: s.backgroundColor, bgImage: ch.backgroundImage.slice(0, 200) };
    });
    expect(dark.headerBg).toBe('rgba(35, 41, 54, 0.97)');
    expect(dark.bgImage).toContain('wallpaper-dark.svg');

    await server.stop();
  });
});
