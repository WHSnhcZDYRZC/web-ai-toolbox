/**
 * 生成扩展图标：public/icons/{16,32,48,128}.png
 * 纯 Node 内置模块实现（zlib 编码 PNG），无额外依赖。
 * 设计：蓝紫渐变圆角方块 + 白色纸飞机（呼应“发送前展开”）。
 * 用法：node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'icons');
const SIZES = [16, 32, 48, 128];
const SS = 4; // 超采样倍率（抗锯齿）

// ---------- CRC32 ----------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 几何 ----------
const lerp = (a, b, t) => a + (b - a) * t;
// 渐变端色：DeepSeek 蓝 → 紫
const C1 = [0x4d, 0x6b, 0xfe];
const C2 = [0x7a, 0x5c, 0xff];

function inRoundedRect(x, y, s, radius) {
  // x, y 为像素中心坐标（0..s）
  const r = radius;
  const cx = Math.min(Math.max(x, r), s - r);
  const cy = Math.min(Math.max(y, r), s - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function pointInTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// 纸飞机：两个三角形组成的剪影（0..1 归一化坐标，y 向下）
const PLANE_A = [[0.86, 0.16], [0.16, 0.58], [0.52, 0.56]];
const PLANE_B = [[0.86, 0.16], [0.52, 0.56], [0.42, 0.84]];

function renderPixel(x, y, s) {
  const radius = s * 0.22;
  if (!inRoundedRect(x, y, s, radius)) return [0, 0, 0, 0];
  const t = (x + y) / (2 * s); // 对角渐变
  const bg = [lerp(C1[0], C2[0], t), lerp(C1[1], C2[1], t), lerp(C1[2], C2[2], t)];
  const nx = x / s;
  const ny = y / s;
  if (pointInTriangle(nx, ny, ...PLANE_A)) return [255, 255, 255, 255];
  if (pointInTriangle(nx, ny, ...PLANE_B)) return [226, 232, 255, 255]; // 折痕面稍暗
  return [...bg.map(Math.round), 255];
}

function renderIcon(size) {
  const big = size * SS;
  const hi = Buffer.alloc(big * big * 4);
  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      const [r, g, b, a] = renderPixel(x + 0.5, y + 0.5, big);
      const i = (y * big + x) * 4;
      hi[i] = r; hi[i + 1] = g; hi[i + 2] = b; hi[i + 3] = a;
    }
  }
  // 盒式降采样
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * big + (x * SS + sx)) * 4;
          r += hi[i]; g += hi[i + 1]; b += hi[i + 2]; a += hi[i + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(renderIcon(size), size);
  writeFileSync(join(OUT_DIR, `${size}.png`), png);
  console.log(`✓ public/icons/${size}.png (${png.length} bytes)`);
}
