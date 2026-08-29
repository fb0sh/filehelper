// FileHelper Telegram-style wallpaper tile generator.
//
// Produces web/public/wallpaper.svg — a seamless 1024×1024 doodle tile.
// Colors follow the Telegram Web A runtime values:
//   base: #bdcd8c (painted by CSS as --tg-wallpaper-base, under a soft
//         multi-point gradient color field in --tg-wallpaper-gradient)
//   pattern stroke: #77854b (olive), intensity applied in CSS as
//   --tg-wallpaper-opacity (0.4) on the tile layer — one opacity knob.
//
// Regenerate with:  node scripts/gen-wallpaper.mjs
// Tuning knobs below (density/scale/rotation/seed) are the only things
// you should need; keep the doodle library as simple line art.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../public/wallpaper.svg');

// ── knobs ──────────────────────────────────────────────────────────────
const TILE = 1024; // big tile ⇒ repetition is far apart, seams invisible
const SEED = 20260831;
const COUNT = 400; // doodles per tile (≈ 0.38/1024² — denser than before)
const MIN_DIST = 34; // min center distance (px)
const SCALE_MIN = 0.35;
const SCALE_MAX = 2.1;
const ROT_MIN = -26; // degrees
const ROT_MAX = 26;
const STROKE = '#77854b';
const STROKE_WIDTH = 1.4; // finer line work at the larger tile size
const ACCENTS = 150; // tiny abstract marks filling the gaps
const OPACITY_MIN = 0.72; // per-doodle fade → natural depth, less mechanical

// deterministic PRNG (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const between = (min, max) => min + rand() * (max - min);
// size distribution biased small (many little doodles, a few big ones)
const pickScale = () => SCALE_MIN + Math.pow(rand(), 1.6) * (SCALE_MAX - SCALE_MIN);

// ── doodle library (line art, local coords ≈ ±20) ──────────────────────
const D = {
  duck: '<path d="M-13 3 C-16 -3 -11 -10 -3 -11 C3 -12 9 -9 9 -4 C13 -3 14 2 10 5 C7 8 1 9 -3 7 C-8 10 -11 8 -13 3 Z"/><circle cx="8" cy="-9" r="5"/><path d="M12 -11 L16 -9 L12 -7"/>',
  pizza: '<circle r="13"/><path d="M0 0 L-12 3 A13 13 0 0 1 -4 -12 Z"/><circle cx="4" cy="-5" r="1.4"/><circle cx="-2" cy="6" r="1.4"/><circle cx="6" cy="5" r="1.4"/><circle cx="-5" cy="-2" r="1.4"/>',
  flower: '<circle cx="0" cy="-9" r="4.5"/><circle cx="8.5" cy="-3" r="4.5"/><circle cx="5.5" cy="7.5" r="4.5"/><circle cx="-5.5" cy="7.5" r="4.5"/><circle cx="-8.5" cy="-3" r="4.5"/><circle r="3.5"/><path d="M0 12 L0 20"/><path d="M0 16 C-3 18 -4 19 -5 21"/>',
  cactus: '<path d="M-4 -14 L-4 6 A4 4 0 0 0 4 6 L4 -14 A4 4 0 0 0 -4 -14 Z"/><path d="M-4 -6 C-11 -7 -11 -14 -5 -12"/><path d="M4 -9 C11 -10 11 -17 5 -15"/><path d="M-7 6 L7 6 L5 12 L-5 12 Z"/><circle cx="0" cy="-16" r="2"/>',
  balloon: '<ellipse cx="0" cy="-8" rx="8.5" ry="10.5"/><path d="M-1.5 2 L0 6 L1.5 2"/><path d="M0 6 C-3 11 2 14 0 19"/>',
  star: '<path d="M0 -13 L3.4 -4.4 L12.4 -4.4 L5 1.2 L7.4 10.2 L0 5.2 L-7.4 10.2 L-5 1.2 L-12.4 -4.4 L-3.4 -4.4 Z"/>',
  cloud: '<path d="M-16 5 C-16 0 -12 -2 -8 -2 C-7 -8 -1 -11 3 -8 C6 -12 13 -10 14 -4 C19 -3 20 4 15 5 Z"/>',
  rocket: '<path d="M0 -15 C7 -8 7 1 5 8 L-5 8 C-7 1 -7 -8 0 -15 Z"/><path d="M5 4 L10 9 L5 8 Z"/><path d="M-5 4 L-10 9 L-5 8 Z"/><circle cx="0" cy="-3" r="2.6"/><path d="M-3 12 L0 8 L3 12 Z"/>',
  icecream: '<path d="M-8 -10 C-8 -17 8 -17 8 -10 Z"/><path d="M-6 -10 L-3 7 L3 7 L6 -10"/><path d="M-8 -10 L8 -10"/>',
  gift: '<rect x="-10" y="-4" width="20" height="13" rx="2"/><path d="M0 -4 L0 9"/><path d="M-10 1 L10 1"/><path d="M0 -4 C0 -9 -6 -11 -5 -6 C-4 -3 0 -3 0 -4 Z M0 -4 C0 -9 6 -11 5 -6 C4 -3 0 -3 0 -4 Z"/>',
  fish: '<path d="M-9 0 C-5 -9 7 -9 10 0 C7 9 -5 9 -9 0 Z"/><path d="M-9 0 L-15 -5 L-15 5 Z"/><circle cx="5" cy="-1.5" r="1.3"/><path d="M0 -4 C-1 -7 1 -8 3 -8"/>',
  castle: '<rect x="-15" y="-6" width="7" height="14"/><rect x="8" y="-6" width="7" height="14"/><rect x="-8" y="0" width="16" height="8"/><path d="M-8 0 L-8 -4 L-4 -4 L-4 0 M0 0 L0 -4 L4 -4 L4 0"/><path d="M-12 -6 L-12 -14 L-7 -12.5 L-12 -11"/><path d="M-1.5 8 L-1.5 3.5 A1.5 1.5 0 0 1 1.5 3.5 L1.5 8"/>',
  bottle: '<path d="M-5 0 L-5 -7 L5 -7 L5 0"/><rect x="-6" y="0" width="12" height="13" rx="3"/><rect x="-4" y="-10" width="8" height="3" rx="1.5"/>',
  apple: '<path d="M-5.5 -2 C-9 -6 -4.5 -10 0 -6 C4.5 -10 9 -6 5.5 -2 C7 3.5 3.5 10 0 10 C-3.5 10 -7 3.5 -5.5 -2 Z"/><path d="M0 -5 C0 -8 2 -9 4 -8.5"/><path d="M0 -5 L0 -8"/>',
  plant: '<path d="M-7 7 L7 7 L5 13 L-5 13 Z"/><path d="M0 7 C0 2 -2 0 0 -6"/><path d="M0 -2 C-7 -3 -9 1 -7 4"/><path d="M0 -2 C7 -3 9 1 7 4"/><circle cx="0" cy="-9" r="2.2"/>',
  cat: '<circle cx="0" cy="0" r="9"/><path d="M-7.5 -5.5 L-9 -12 L-3 -7.5"/><path d="M7.5 -5.5 L9 -12 L3 -7.5"/><circle cx="-3.5" cy="-1" r="1.2"/><circle cx="3.5" cy="-1" r="1.2"/><path d="M-2.5 3.5 C-1.5 4.5 1.5 4.5 2.5 3.5"/><path d="M-9 -3 L-13 -4 M-9 0 L-13 0"/><path d="M9 -3 L13 -4 M9 0 L13 0"/>',
  heart: '<path d="M0 7 C-9 -1 -9 -10 0 -4 C9 -10 9 -1 0 7 Z"/>',
  moon: '<circle r="9"/><path d="M10 -12 l1.6 3.6 l3.6 1.6 l-3.6 1.6 l-1.6 3.6 l-1.6 -3.6 l-3.6 -1.6 l3.6 -1.6 Z"/>',
  spiral: '<path d="M0 0 a3 3 0 0 1 6 0 a6 6 0 0 1 -12 0 a9 9 0 0 1 18 0 a12 12 0 0 1 -24 0"/>',
  note: '<path d="M7 -15 L7 0"/><path d="M7 -15 C2 -13 0 -10 0 -7"/><ellipse cx="3.5" cy="0" rx="3.5" ry="2.6"/>',
  camera: '<rect x="-11" y="-5" width="22" height="13" rx="3.5"/><rect x="-6" y="-8" width="7" height="4" rx="1.5"/><circle cx="0" cy="1.5" r="3.5"/>',
  sun: '<circle r="6"/><path d="M0 -9.5 L0 -12.5 M0 9.5 L0 12.5 M-9.5 0 L-12.5 0 M9.5 0 L12.5 0 M-6.7 -6.7 L-8.8 -8.8 M6.7 6.7 L8.8 8.8 M6.7 -6.7 L8.8 -8.8 M-6.7 6.7 L-8.8 8.8"/>',
  leaf: '<path d="M0 7 C-2.5 1 -2.5 -6 0 -8 C2.5 -6 2.5 1 0 7 Z"/><path d="M0 -8 L0 7 M0 -3 L-2.5 -0.5 M0 1.5 L2.5 4"/>',
  book: '<rect x="-9" y="-8" width="18" height="16" rx="2"/><path d="M0 -8 L0 8"/><path d="M-9 0 L9 0"/>',
  house: '<path d="M-11 4 L-11 -3 L0 -11 L11 -3 L11 4 Z"/><rect x="-7" y="4" width="14" height="9"/><rect x="-3" y="6" width="6" height="7"/><rect x="-5" y="6.5" width="2.5" height="3.5"/>',
  bell: '<path d="M-5.5 -7 C-5.5 -13 5.5 -13 5.5 -7 C5.5 -3 8 -2 8 1 L-8 1 C-8 -2 -5.5 -3 -5.5 -7 Z"/><path d="M-3.5 4 L3.5 4"/><circle cx="0" cy="5" r="1.8"/>',
  ghost: '<path d="M-7 -7 A7 7 0 0 1 7 -7 L7 6 L4 3.5 L1 6 L-2 3.5 L-5 6 L-7 3.5 Z"/><circle cx="-3" cy="-3.5" r="1.3"/><circle cx="3" cy="-3.5" r="1.3"/>',
  diamond: '<path d="M0 -9 L7 0 L0 9 L-7 0 Z"/>',
  triangle: '<path d="M0 -9 L8 7 L-8 7 Z"/>',
  plus: '<path d="M-7 0 L7 0 M0 -7 L0 7"/>',
  banana: '<path d="M-11 -2 C-8 -11 7 -13 11 -6 C14 1 6 8 -1 8 C-8 8 -13 6 -11 -2 Z"/><path d="M-11 -2 L-13 -5"/>',
  cake: '<rect x="-10" y="-2" width="20" height="9" rx="2"/><rect x="-7" y="-7" width="14" height="5" rx="2"/><path d="M-2 -7 L-2 -12 M-3 -12 L-1 -12"/><circle cx="-2" cy="-13" r="1.4"/><circle cx="-5" cy="1.5" r="1.1"/><circle cx="0" cy="3" r="1.1"/><circle cx="5" cy="1" r="1.1"/>',
  teapot: '<path d="M-7 -2 C-7 -8 7 -8 7 -2 C7 3 3 6 -1 6 C-5 6 -7 3 -7 -2 Z"/><path d="M7 -2 C10 -2 11 1 9 3"/><path d="M-7 -2 L-9 -2 L-9 1"/><path d="M-1 6 C-1 9 -2 10 -4 10"/>',
  mushroom: '<path d="M-10 -1 C-10 -9 10 -9 10 -1 Z"/><path d="M-5 -1 L-5 8 L5 8 L5 -1"/>',
  acorn: '<path d="M-8 1 C-8 -4 8 -4 8 1 C8 6 4 9 0 9 C-4 9 -8 6 -8 1 Z"/><path d="M-5 1 L5 1"/><path d="M0 1 L0 -3"/>',
  pinguin: '<path d="M-7 -6 C-7 -12 7 -12 7 -6 L7 6 C7 10 -7 10 -7 6 Z"/><path d="M-4 -2 L4 -2 L4 2 L-4 2 Z"/><circle cx="-3" cy="-9" r="1"/><circle cx="3" cy="-9" r="1"/><path d="M-2 -12 L0 -15 L2 -12"/>',
  butterfly: '<path d="M0 0 C-6 -8 -16 -6 -14 2 C-12 9 -3 7 0 1 Z"/><path d="M0 0 C6 -8 16 -6 14 2 C12 9 3 7 0 1 Z"/><path d="M0 0 C-4 7 -11 12 -13 9 C-15 6 -6 4 0 0 Z"/><path d="M0 0 C4 7 11 12 13 9 C15 6 6 4 0 0 Z"/><path d="M0 -1 L0 14"/>',
  bird: '<path d="M-8 2 C-11 -4 -7 -9 -2 -8 C1 -11 8 -10 8 -4 C13 -4 13 2 9 3 C7 8 1 8 -3 5 C-6 7 -8 6 -8 2 Z"/><path d="M6 -3 L10 -6 L7 -1"/>',
  snail: '<circle cx="-4" cy="0" r="7"/><path d="M-4 0 a3.5 3.5 0 0 1 7 0 a7 7 0 0 1 -14 0"/><path d="M3 0 C8 0 11 3 14 8"/><path d="M11 6 L14 9 L12 10"/><circle cx="-4" cy="0" r="1.4"/>',
  tree: '<path d="M0 4 L0 16"/><circle cx="0" cy="-6" r="10"/><path d="M0 -16 C-4 -12 -4 -8 0 -4 C4 -8 4 -12 0 -16 Z"/>',
  umbrella: '<path d="M-12 -2 A12 12 0 0 1 12 -2 Z"/><path d="M0 -2 L0 8"/><path d="M0 8 C-2 10 -1 12 1 12 C3 12 2 10 0 8 Z"/>',
  envelope: '<rect x="-11" y="-8" width="22" height="16" rx="2"/><path d="M-11 -8 L0 1 L11 -8"/>',
  pencil: '<rect x="-3" y="-13" width="6" height="19" rx="1.5"/><path d="M-3 -13 L0 -19 L3 -13"/><path d="M-3 6 L3 6"/>',
  watermelon: '<path d="M-12 0 A12 12 0 0 1 12 0 Z"/><path d="M-12 0 L12 0"/><circle cx="-6" cy="-4" r="1.4"/><circle cx="0" cy="-6" r="1.4"/><circle cx="6" cy="-4" r="1.4"/><circle cx="-3" cy="2" r="1.4"/><circle cx="3" cy="2" r="1.4"/>',
  key: '<circle cx="-7" cy="-6" r="4.5"/><path d="M-2.5 -6 L12 -6"/><path d="M8 -6 L8 -1"/><path d="M11 -6 L11 -1"/>',
  globe: '<circle r="10"/><path d="M-10 0 L10 0"/><path d="M0 -10 A7 7 0 0 0 0 10 A7 7 0 0 0 0 -10"/><path d="M-7 -3 L7 3 M-7 3 L7 -3"/><path d="M-3 10 L-3 14 L3 14 L3 10"/>',
  snowman: '<circle cy="-9" r="6"/><circle cy="2" r="8"/><path d="M0 -15 L0 -19"/><path d="M-10 0 L-14 0 M10 0 L14 0"/><circle cx="-2.5" cy="-10" r="1"/><circle cx="2.5" cy="-10" r="1"/><path d="M-2 3 L2 3"/>',
  mug: '<path d="M-9 -6 L-9 6 C-9 10 -2 10 -2 6 L-2 -6 Z"/><path d="M-2 -4 C4 -6 6 -2 4 2 C3 5 -1 5 -2 3"/><path d="M-6 -9 C-8 -13 -4 -14 -3 -11"/>',
};

const KEYS = Object.keys(D);
const RADIUS = 26; // doodle bounding radius for wrap/overlap math (scaled)

// ── scatter placement (seeded random, min distance, size-biased small) ─
const placed = [];
for (let i = 0; i < COUNT; i++) {
  let x = 0;
  let y = 0;
  let ok = false;
  for (let attempt = 0; attempt < 160 && !ok; attempt++) {
    x = between(0, TILE);
    y = between(0, TILE);
    ok = placed.every((p) => Math.hypot(p.x - x, p.y - y) >= MIN_DIST);
  }
  const scale = pickScale();
  const rot = between(ROT_MIN, ROT_MAX);
  const opacity = between(OPACITY_MIN, 1);
  const name = KEYS[Math.floor(rand() * KEYS.length)];
  const r = RADIUS * scale;
  placed.push({ x, y, scale, rot, opacity, name, r });
}

// ── emit ───────────────────────────────────────────────────────────────
function doodleG(x, y, scale, rot, opacity, inner) {
  return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(3)}) rotate(${rot.toFixed(1)})" opacity="${opacity.toFixed(3)}">${inner}</g>`;
}

const groups = [];
for (const p of placed) {
  const inner = D[p.name];
  groups.push(doodleG(p.x, p.y, p.scale, p.rot, p.opacity, inner));
  // seamless wrap: mirror across tile edges
  if (p.x - p.r < 0) groups.push(doodleG(p.x + TILE, p.y, p.scale, p.rot, p.opacity, inner));
  if (p.x + p.r > TILE) groups.push(doodleG(p.x - TILE, p.y, p.scale, p.rot, p.opacity, inner));
  if (p.y - p.r < 0) groups.push(doodleG(p.x, p.y + TILE, p.scale, p.rot, p.opacity, inner));
  if (p.y + p.r > TILE) groups.push(doodleG(p.x, p.y - TILE, p.scale, p.rot, p.opacity, inner));
  if (p.x - p.r < 0 && p.y - p.r < 0) groups.push(doodleG(p.x + TILE, p.y + TILE, p.scale, p.rot, p.opacity, inner));
  if (p.x + p.r > TILE && p.y + p.r > TILE) groups.push(doodleG(p.x - TILE, p.y - TILE, p.scale, p.rot, p.opacity, inner));
}

// small abstract accents (dot clusters, tiny pluses, dashes, sparkles)
const accents = [];
const accentKind = () => {
  const k = Math.floor(rand() * 5);
  if (k === 0) return '<circle r="1.8"/>';
  if (k === 1) return '<path d="M-4 0 L4 0 M0 -4 L0 4"/>';
  if (k === 2) return '<path d="M-5 0 L-2.5 -3.5 L0 0 L2.5 -3.5 L5 0"/>';
  if (k === 3) return '<circle r="1.2"/><circle cx="3.2" cy="0" r="1.2"/><circle cx="-3.2" cy="0" r="1.2"/>';
  return '<path d="M-4 -4 L4 4 M4 -4 L-4 4"/>';
};
for (let i = 0; i < ACCENTS; i++) {
  const x = between(0, TILE);
  const y = between(0, TILE);
  const s = between(0.5, 1.1);
  const r = between(-35, 35);
  const o = between(0.6, 1);
  accents.push(doodleG(x, y, s, r, o, accentKind()));
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">
  <!-- FileHelper wallpaper tile, seamless ${TILE}x${TILE}. Olive line-art
       doodles (stroke ${STROKE}); tile-layer opacity is controlled by CSS
       (var tg-wallpaper-opacity = 0.4), the base + gradient color field by
       var tg-wallpaper-base / var tg-wallpaper-gradient.
       Regenerate: node scripts/gen-wallpaper.mjs -->
  <rect width="${TILE}" height="${TILE}" fill="none"/>
  <g fill="none" stroke="${STROKE}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round">
${groups.join('\n')}
${accents.join('\n')}
  </g>
</svg>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, svg);
console.log(`wrote ${OUT} (${groups.length} doodle groups, ${accents.length} accents)`);
