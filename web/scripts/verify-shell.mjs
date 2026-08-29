// Structural verification for the windowed-shell layout:
//   shell owns ONE full-area wallpaper; sidebar is a floating white card
//   on it; chat content floats directly on the same wallpaper.
// Prints a pass/fail report. Run: node scripts/verify-shell.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import zlib from 'node:zlib';

const PORT = 19100 + Math.floor(Math.random() * 300);
const BIN = path.join(process.cwd(), '..', 'target', 'release', 'filehelper');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-probe-'));
const base = `http://127.0.0.1:${PORT}`;
const code = `probe-${Date.now() % 1000000}`;

const proc = spawn(BIN, ['--addr', `127.0.0.1:${PORT}`, '--data-dir', dataDir], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
proc.stderr?.on('data', () => {});
process.on('exit', () => proc.kill('SIGKILL'));

async function waitReady() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/api/v1/info`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server not ready');
}

function decodePng(buf) {
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : 3;
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
      let v = line[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[i] = v;
    }
    cur.copy(out, y * stride);
    prev = cur;
    pos += stride;
  }
  return { width, height, channels, data: out };
}

const pix = (img, x, y) => {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const near = (a, b, tol = 8) =>
  Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
const greenFamily = (p) => p[1] > p[0] && p[0] > p[2] && p[0] > 90;
// median of a small box — robust to doodle ink landing on single pixels
const boxMedian = (cx, cy) => {
  const pts = [];
  for (let dy = -6; dy <= 6; dy += 3) {
    for (let dx = -6; dx <= 6; dx += 3) pts.push(pix(img, cx + dx, cy + dy));
  }
  const med = (i) => pts.map((p) => p[i]).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
  return [med(0), med(1), med(2)];
};

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

await waitReady();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1584, height: 960 } });
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
await page.waitForTimeout(400);

// ── Computed styles ───────────────────────────────────────────
const styles = await page.evaluate(() => {
  const shell = document.querySelector('[data-tg="shell"]');
  const sb = document.querySelector('[data-tg="sidebar"]');
  const chat = document.querySelector('[data-tg="chat"]');
  const body = getComputedStyle(document.body);
  const ss = getComputedStyle(sb);
  const cs = getComputedStyle(chat);
  const sh = getComputedStyle(shell);
  const sr = sb.getBoundingClientRect();
  const cr = chat.getBoundingClientRect();
  const column = sb.parentElement;
  const col = getComputedStyle(column);
  return {
    bodyBg: body.backgroundColor,
    shellPadding: sh.padding,
    shellRadius: sh.borderRadius,
    shellGap: sh.gap,
    shellBg: sh.backgroundColor,
    shellWallpaper: getComputedStyle(shell, '::before').backgroundImage,
    sidebarBg: ss.backgroundColor,
    sidebarRadius: ss.borderRadius,
    sidebarShadow: ss.boxShadow,
    sidebarRect: { x: sr.x, y: sr.y, w: sr.width, h: sr.height },
    sidebarColumnBg: col.backgroundColor,
    chatRect: { x: cr.x, y: cr.y, w: cr.width, h: cr.height },
    chatBg: cs.backgroundColor,
    chatRadius: cs.borderRadius,
    chatShadow: cs.boxShadow,
  };
});

const white = [255, 255, 255];
const windowBg = [199, 206, 214]; // #c7ced6
const olive = [189, 205, 140]; // #bdcd8c

check('shell padding is 12px', styles.shellPadding === '12px', styles.shellPadding);
check('shell radius is 24px', styles.shellRadius === '24px', styles.shellRadius);
check('column gap is 12px', styles.shellGap === '12px', styles.shellGap);
check('body uses window bg', near(hexToRgb(styles.bodyBg), windowBg), styles.bodyBg);
check('shell owns the wallpaper (gradient on ::before)',
  styles.shellWallpaper.includes('radial-gradient'),
  styles.shellWallpaper.slice(0, 60));
check('sidebar column is transparent', styles.sidebarColumnBg === 'rgba(0, 0, 0, 0)', styles.sidebarColumnBg);
check('chat content column is transparent (no panel)', styles.chatBg === 'rgba(0, 0, 0, 0)', styles.chatBg);
check('chat content column has no radius (no panel)', styles.chatRadius === '0px', styles.chatRadius);
check('chat content column has no shadow (no panel)', styles.chatShadow === 'none', styles.chatShadow);
check('sidebar card is white', near(hexToRgb(styles.sidebarBg), white), styles.sidebarBg);
check('sidebar radius 28px', styles.sidebarRadius === '28px', styles.sidebarRadius);
check('sidebar casts shadow', /rgba/.test(styles.sidebarShadow), styles.sidebarShadow.slice(0, 60));
check('sidebar card at 12,12 ≈29% wide × 936 (floating island)',
  styles.sidebarRect.x === 12 && styles.sidebarRect.y === 12 &&
  Math.round(styles.sidebarRect.w) === 459 && Math.round(styles.sidebarRect.h) === 936,
  JSON.stringify(styles.sidebarRect));
check('chat column at 483,12 size 1089×936',
  Math.round(styles.chatRect.x) === 483 && Math.round(styles.chatRect.y) === 12 &&
  Math.round(styles.chatRect.w) === 1089 && Math.round(styles.chatRect.h) === 936,
  JSON.stringify(styles.chatRect));

// ── Rendered pixels ───────────────────────────────────────────
const shot = await page.screenshot();
const img = decodePng(shot);

// shell corner: outside the rounded app-shell → window bg
check('viewport corner shows window bg', near(pix(img, 3, 3), windowBg), pix(img, 3, 3).join(','));
// ── Wallpaper is continuous across the WHOLE shell ──
// Derive probe points from the measured rects so width changes never
// break the checks: the gap = middle of (card right → chat left), the
// ring = left of the card, plus fixed probes in the chat area.
const sr = styles.sidebarRect;
const cr = styles.chatRect;
const gapX = Math.round((sr.x + sr.w + cr.x) / 2); // between card and chat
const ringX = sr.x - 6; // shell padding ring, left of the card
for (const [label, x, y] of [
  ['top ring (above sidebar)', 200, 6],
  ['left ring (left of card)', ringX, 480],
  ['sidebar↔chat gap', gapX, 500],
  ['chat area', 1200, 500],
  ['far right', 1560, 300],
]) {
  const m = boxMedian(x, y);
  check(`wallpaper continuous at ${label}`, greenFamily(m), m.join(','));
}
// ── Sidebar card is a white island on the wallpaper ──
check('sidebar surface is white', near(boxMedian(200, 500), white, 10), boxMedian(200, 500).join(','));
check('sidebar corner is rounded (px at card corner = wallpaper)',
  greenFamily(boxMedian(14, 14)),
  boxMedian(14, 14).join(','));
check('sidebar interior below row is white', near(boxMedian(410, 260), white, 10), boxMedian(410, 260).join(','));
check('sidebar whitespace right of row is white', near(boxMedian(415, 300), white, 10), boxMedian(415, 300).join(','));
// card right edge: 1px past the card is wallpaper, not gray
check('right of card is wallpaper', greenFamily(boxMedian(Math.round(sr.x + sr.w) + 1, 500)), boxMedian(Math.round(sr.x + sr.w) + 1, 500).join(','));

// ── Gradient color field: four regions olive-family, top-left brighter ──
const gTL = boxMedian(520, 60);
const gTR = boxMedian(1500, 60);
const gBL = boxMedian(520, 900);
const gBR = boxMedian(1500, 900);
for (const [label, p] of [['top-left', gTL], ['top-right', gTR], ['bottom-left', gBL], ['bottom-right', gBR]]) {
  check(`gradient region ${label} is olive-green family`, greenFamily(p), p.join(','));
}
const lum = (p) => p[0] + p[1] + p[2];
check('gradient: bottom-right deeper than top-left',
  lum(gBR) < lum(gTL) && lum(gTL) - lum(gBR) > 6,
  `tl=${lum(gTL)} br=${lum(gBR)}`);

// ── FAB: blue circle bottom-right of the sidebar card ──
// center = (cardRight-16-27, cardBottom-16-27); scan a 30×30 box and
// require mostly primary blue (the white pencil icon sits at center).
const fabCx = Math.round(sr.x + sr.w) - 16 - 27;
const fabCy = Math.round(sr.y + sr.h) - 16 - 27;
let blueHits = 0;
let fabTotal = 0;
for (let y = fabCy - 15; y <= fabCy + 15; y += 2) {
  for (let x = fabCx - 15; x <= fabCx + 15; x += 2) {
    fabTotal++;
    if (near(pix(img, x, y), [51, 144, 236], 14)) blueHits++;
  }
}
check('FAB is a primary-blue circle at sidebar bottom-right',
  blueHits / fabTotal > 0.5,
  `blue=${blueHits}/${fabTotal}`);

// ── Segmented chips container + active pill ──
const chipsInfo = await page.evaluate(() => {
  const c = getComputedStyle(document.querySelector('[role="tablist"]'));
  const active = getComputedStyle(document.querySelector('[role="tab"][aria-selected="true"]'));
  return { containerBg: c.backgroundColor, activeBg: active.backgroundColor, activeColor: active.color };
});
check('chips container is light gray',
  chipsInfo.containerBg === 'rgb(241, 243, 245)',
  chipsInfo.containerBg);
check('active chip is a white pill with blue accent',
  chipsInfo.activeBg === 'rgb(255, 255, 255)' && chipsInfo.activeColor === 'rgb(51, 144, 236)',
  `${chipsInfo.activeBg} / ${chipsInfo.activeColor}`);

// ── Header/composer float white over wallpaper ──
const headerMid = pix(img, 1000, 56); // header pill y=28..84
const composerMid = pix(img, 1000, 904); // composer pill y=876..932
for (const [label, p] of [['header', headerMid], ['composer', composerMid]]) {
  check(`${label} pill is near-white (floating)`, p[0] >= 246 && p[1] >= 246 && p[2] >= 246, p.join(','));
}

// ── FAB behavior: click focuses the sidebar search ──
await page.click('button[aria-label="New chat"]');
const fabFocus = await page.evaluate(
  () => document.activeElement?.getAttribute('aria-label') ?? 'none'
);
check('FAB click focuses the search input', fabFocus === 'Search chats', fabFocus);

// ── Diagnostics: sidebar internal rhythm ──────────────────────
const rhythm = await page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  return {
    header: box('[data-tg="sidebar"] div:first-child'),
    search: box('div[class*="searchBar"]'),
    chips: box('[role="tablist"]'),
    row: box('div[class*="chatRow"]'),
    avatar: box('div[class*="chatRow"] div[class*="avatar"]'),
  };
});
console.log('\n── sidebar rhythm ──');
for (const [k, v] of Object.entries(rhythm)) console.log(`${k.padEnd(8)} ${JSON.stringify(v)}`);

await browser.close();
proc.kill('SIGKILL');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

function hexToRgb(s) {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
