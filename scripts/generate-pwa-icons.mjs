#!/usr/bin/env node
/**
 * Generates minimal placeholder PNG icons for PWA manifest.
 * Solid #0f172a background — replace with branded assets later.
 */
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

function createSolidPNG(width, height, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // RGB colour type
  // bytes 10-12: compression=0, filter=0, interlace=0 (default)

  // Build raw scanlines: one filter byte (0 = None) + RGB per pixel per row
  const rowLen = 1 + width * 3;
  const raw = Buffer.alloc(height * rowLen);
  for (let y = 0; y < height; y++) {
    const base = y * rowLen;
    raw[base] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      raw[base + 1 + x * 3] = r;
      raw[base + 1 + x * 3 + 1] = g;
      raw[base + 1 + x * 3 + 2] = b;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdrData),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

const iconsDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

// CropsIntel brand dark navy: #0f172a = rgb(15, 23, 42)
const [r, g, b] = [15, 23, 42];

fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), createSolidPNG(192, 192, r, g, b));
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), createSolidPNG(512, 512, r, g, b));
fs.writeFileSync(path.join(iconsDir, 'maskable-icon-512.png'), createSolidPNG(512, 512, r, g, b));

console.log('PWA icons generated → public/icons/');
