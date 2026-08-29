// Quantitative wallpaper analysis for round-2 tuning — measures from the
// captured PNG: doodle ink density, tiling-seam continuity, and gradient
// smoothness. Prints numbers; no assertions (humans decide the knobs).
import fs from 'node:fs';
import zlib from 'node:zlib';

const SHOT = process.argv[2] ?? 'scripts/shots/01-home-wallpaper.png';

function decodePng(buf) {
  let off = 8;
  let width = 0, height = 0, colorType = 0;
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

const img = decodePng(fs.readFileSync(SHOT));
const pix = (x, y) => {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

// chat pane at 1584×960 shell: x 440..1574, y 10..950 (doodle region).
// Pick a wallpaper-only band clear of pills/rails: x 480..1560, y 120..860.
const X0 = 480, X1 = 1560, Y0 = 120, Y1 = 860;

// ── 1. Doodle ink density: fraction of pixels darker than local 9×9 mean ──
function localMean(x, y, r = 4) {
  let s = 0, n = 0;
  for (let dy = -r; dy <= r; dy += 2) {
    for (let dx = -r; dx <= r; dx += 2) {
      const [rr, gg, bb] = pix(x + dx, y + dy);
      s += rr + gg + bb; n++;
    }
  }
  return s / n;
}
let ink = 0, total = 0;
for (let y = Y0; y < Y1; y += 3) {
  for (let x = X0; x < X1; x += 3) {
    const p = pix(x, y);
    if (p[0] + p[1] + p[2] < localMean(x, y) - 22) ink++;
    total++;
  }
}
console.log(`ink coverage:   ${(100 * ink / total).toFixed(1)}%  (${ink}/${total})`);

// ── 2. Tiling seam: mean color of strips left/right of x=440+1024=1464 ──
function stripMean(xStart, xEnd, y = 400) {
  let s = 0, n = 0;
  for (let yy = y; yy < y + 60; yy += 2) {
    for (let xx = xStart; xx < xEnd; xx += 1) {
      const [r, g, b] = pix(xx, yy);
      s += r + g + b; n++;
    }
  }
  return s / n;
}
const seam = 1024; // first tile boundary (tile is anchored to the shell at 0,0)
const left = stripMean(seam - 6, seam - 1);
const right = stripMean(seam + 1, seam + 6);
console.log(`seam at x=${seam}: meanL=${left.toFixed(1)} meanR=${right.toFixed(1)} delta=${Math.abs(left - right).toFixed(1)}`);

// ── 3. Gradient smoothness: adjacent-pixel delta along a horizontal line ──
let maxDelta = 0, sumDelta = 0, nD = 0;
for (let x = X0; x < X1 - 1; x += 1) {
  const a = pix(x, 400);
  const b = pix(x + 1, 400);
  const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  if (d > maxDelta) maxDelta = d;
  sumDelta += d; nD++;
}
console.log(`gradient smooth: avgAdjDelta=${(sumDelta / nD).toFixed(2)} maxAdjDelta=${maxDelta}`);

// ── 4. Overall tonal spread across the pane (gradient strength) ──
const corners = {
  TL: pix(500, 40), TR: pix(1540, 40), BL: pix(500, 920), BR: pix(1540, 920),
};
for (const [k, p] of Object.entries(corners)) {
  console.log(`corner ${k}: rgb(${p.join(',')}) lum=${p[0] + p[1] + p[2]}`);
}
