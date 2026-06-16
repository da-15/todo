// 依存ライブラリなしで PWA アイコン（PNG）と favicon(SVG) を生成する。
// 青背景の角丸 + 白いチェックマークのシンプルなアイコン。
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public");
mkdirSync(outDir, { recursive: true });

// ---- 最小 PNG エンコーダ ----
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
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 各行先頭にフィルタバイト(0)
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- アイコン描画 ----
function makeIcon(size, square = false) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const bg = [37, 99, 235]; // #2563eb

  const inCorner = (x, y) => {
    if (square) return true; // 角まで塗りつぶす（iOS の apple-touch-icon 用）
    // 角丸判定
    const corners = [
      [radius, radius],
      [size - radius, radius],
      [radius, size - radius],
      [size - radius, size - radius],
    ];
    if (x >= radius && x <= size - radius) return true;
    if (y >= radius && y <= size - radius) return true;
    for (const [cx, cy] of corners) {
      const within =
        (x < radius || x > size - radius) && (y < radius || y > size - radius);
      if (within) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= radius * radius) return true;
      }
    }
    return false;
  };

  // チェックマークのストローク。2本の線分で表現。
  const thickness = size * 0.08;
  const p1 = [size * 0.28, size * 0.52];
  const p2 = [size * 0.44, size * 0.68];
  const p3 = [size * 0.74, size * 0.34];

  const distToSeg = (px, py, [ax, ay], [bx, by]) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;
      if (!inCorner(px, py)) {
        rgba[i] = 0;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
        rgba[i + 3] = 0; // 透明
        continue;
      }
      const onCheck =
        distToSeg(px, py, p1, p2) <= thickness / 2 ||
        distToSeg(px, py, p2, p3) <= thickness / 2;
      if (onCheck) {
        rgba[i] = 255;
        rgba[i + 1] = 255;
        rgba[i + 2] = 255;
        rgba[i + 3] = 255;
      } else {
        rgba[i] = bg[0];
        rgba[i + 1] = bg[1];
        rgba[i + 2] = bg[2];
        rgba[i + 3] = 255;
      }
    }
  }
  return encodePng(size, size, rgba);
}

writeFileSync(join(outDir, "icon-192.png"), makeIcon(192));
writeFileSync(join(outDir, "icon-512.png"), makeIcon(512));
// iOS の apple-touch-icon は透過非対応なので 180x180 全面塗り（角丸は iOS 側が付与）
writeFileSync(join(outDir, "apple-touch-icon.png"), makeIcon(180, true));

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#2563eb"/>
  <path d="M18 33 L28 43 L47 22" fill="none" stroke="#fff" stroke-width="6"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
writeFileSync(join(outDir, "favicon.svg"), favicon);

console.log("icons generated in public/");
