// Draws the placeholder app icons, splash marks and notification icons for the
// passenger and driver apps (an original location-pin mark; replace once the
// brand is final). Pure Node, no image libraries: `node scripts/generate-app-assets.mjs`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BERRY = [0x7a, 0x1f, 0x5c];
const SAFFRON = [0xe8, 0x89, 0x2b];
const WHITE = [0xff, 0xff, 0xff];

// ---------- PNG encoding ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- shapes as signed distance functions (negative = inside) ----------

const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;

function polygon(points) {
  return (x, y) => {
    let d = Infinity;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      const ex = xj - xi;
      const ey = yj - yi;
      const t = Math.max(0, Math.min(1, ((x - xi) * ex + (y - yi) * ey) / (ex * ex + ey * ey)));
      d = Math.min(d, Math.hypot(x - xi - ex * t, y - yi - ey * t));
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside ? -d : d;
  };
}

const union = (a, b) => (x, y) => Math.min(a(x, y), b(x, y));
const subtract = (a, b) => (x, y) => Math.max(a(x, y), -b(x, y));

/** A map pin: head of radius r centred at (cx, cy), tip below. All in 0..1 units. */
function pin(cx, cy, r) {
  const tip = 1.9 * r;
  const phi = Math.acos(r / tip);
  const tangentY = cy + r * Math.cos(phi);
  const outline = union(
    circle(cx, cy, r),
    polygon([
      [cx - r * Math.sin(phi), tangentY],
      [cx + r * Math.sin(phi), tangentY],
      [cx, cy + tip],
    ]),
  );
  return { outline, hole: circle(cx, cy, 0.42 * r) };
}

// ---------- rendering ----------

/** Layers are [sdf, rgb], painted in order over the background (null = transparent). */
function render(size, background, layers) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      let [r, g, b, a] = background ? [...background, 1] : [0, 0, 0, 0];
      for (const [sdf, colour] of layers) {
        // Distance in pixels gives one pixel of anti-aliasing at any size.
        const cover = Math.max(0, Math.min(1, 0.5 - sdf(u, v) * size));
        if (!cover) continue;
        const outA = cover + a * (1 - cover);
        r = (colour[0] * cover + r * a * (1 - cover)) / outA;
        g = (colour[1] * cover + g * a * (1 - cover)) / outA;
        b = (colour[2] * cover + b * a * (1 - cover)) / outA;
        a = outA;
      }
      const i = (y * size + x) * 4;
      px[i] = Math.round(r);
      px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, px);
}

function writeAssets(app, { background, mark, dot }) {
  const dir = new URL(`../apps/${app}/assets/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  const out = (name, png) => writeFileSync(new URL(name, dir), png);

  // Full icon (iOS forbids transparency): pin centred, a little above middle.
  const big = pin(0.5, 0.42, 0.22);
  out(
    'icon.png',
    render(1024, background, [
      [big.outline, mark],
      [big.hole, dot],
    ]),
  );
  // Google Play listing icon (512 × 512); App Store Connect takes the 1024 icon from the build.
  out(
    'store-icon-512.png',
    render(512, background, [
      [big.outline, mark],
      [big.hole, dot],
    ]),
  );
  // Android adaptive icon: the launcher crops to the middle ~66%, so keep the mark small.
  const safe = pin(0.5, 0.44, 0.15);
  out(
    'adaptive-icon.png',
    render(1024, null, [
      [safe.outline, mark],
      [safe.hole, dot],
    ]),
  );
  // Android 13 themed icon and notification icon: single-colour silhouettes.
  out('monochrome-icon.png', render(1024, null, [[subtract(safe.outline, safe.hole), WHITE]]));
  const small = pin(0.5, 0.4, 0.27);
  out('notification-icon.png', render(96, null, [[subtract(small.outline, small.hole), WHITE]]));
  // Splash mark, drawn on the splash background colour set in app.config.ts.
  out(
    'splash-icon.png',
    render(512, null, [
      [big.outline, mark],
      [big.hole, dot],
    ]),
  );
}

writeAssets('passenger', { background: BERRY, mark: WHITE, dot: SAFFRON });
writeAssets('driver', { background: SAFFRON, mark: WHITE, dot: BERRY });
console.log('Wrote apps/passenger/assets and apps/driver/assets');
