// Minimal dependency-free PNG encoder (RGBA 8-bit, uncompressed deflate) plus a
// structural parser. Used as a deterministic fallback where canvas encoding is
// unavailable (workers without OffscreenCanvas, unit tests). Browser exports
// prefer canvas.toBlob for proper compression; both produce valid PNG bytes.

import type { ImageValue } from './pixel';

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function chunk(type: string, data: Uint8Array): number[] {
  const t = Array.from(new TextEncoder().encode(type));
  const body = [...t, ...data];
  const crc = crc32(new Uint8Array(body));
  return [...u32(data.length), ...body, ...u32(crc)];
}

/** Encode RGBA pixels to a valid (uncompressed) PNG. Deterministic. */
export function encodePNG(img: ImageValue): Uint8Array {
  const { width: w, height: h, data } = img;
  // raw scanlines with filter byte 0
  const stride = w * 4 + 1;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    raw.set(data.subarray(y * w * 4, (y + 1) * w * 4), y * stride + 1);
  }
  // zlib header for no compression + stored deflate blocks
  const out: number[] = [0x78, 0x01];
  const MAX = 65535;
  for (let off = 0; off < raw.length; off += MAX) {
    const len = Math.min(MAX, raw.length - off);
    const final = off + len >= raw.length ? 1 : 0;
    out.push(final & 1);
    out.push(len & 255, (len >> 8) & 255, (~len) & 255, ((~len) >> 8) & 255);
    for (let i = 0; i < len; i++) out.push(raw[off + i]);
  }
  // adler32
  let a = 1, b = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  out.push((adler >>> 24) & 255, (adler >>> 16) & 255, (adler >>> 8) & 255, adler & 255);

  const ihdr = new Uint8Array([...u32(w), ...u32(h), 8, 6, 0, 0, 0]);
  const bytes = [...SIG, ...chunk('IHDR', ihdr), ...chunk('IDAT', new Uint8Array(out)), ...chunk('IEND', new Uint8Array(0))];
  return new Uint8Array(bytes);
}

export interface PNGInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  valid: boolean;
  error?: string;
}

/** Structural parse: signature, IHDR, chunk CRCs. Does not decompress pixels. */
export function parsePNG(bytes: Uint8Array): PNGInfo {
  const fail = (error: string): PNGInfo => ({ width: 0, height: 0, bitDepth: 0, colorType: 0, valid: false, error });
  if (bytes.length < 33) return fail('too short');
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return fail('bad signature');
  let off = 8;
  let info: PNGInfo | null = null;
  let sawIEND = false;
  while (off + 8 <= bytes.length) {
    const len = (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3];
    if (len < 0 || off + 12 + len > bytes.length) return fail('truncated chunk');
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const body = bytes.subarray(off + 4, off + 8 + len);
    const want = ((bytes[off + 8 + len] << 24) | (bytes[off + 9 + len] << 16) | (bytes[off + 10 + len] << 8) | bytes[off + 11 + len]) >>> 0;
    if (crc32(body) !== want) return fail(`CRC mismatch in ${type}`);
    if (type === 'IHDR') {
      if (len !== 13) return fail('bad IHDR length');
      const w = (bytes[off + 8] << 24) | (bytes[off + 9] << 16) | (bytes[off + 10] << 8) | bytes[off + 11];
      const h = (bytes[off + 12] << 24) | (bytes[off + 13] << 16) | (bytes[off + 14] << 8) | bytes[off + 15];
      info = { width: w, height: h, bitDepth: bytes[off + 16], colorType: bytes[off + 17], valid: true };
    }
    if (type === 'IEND') { sawIEND = true; break; }
    off += 12 + len;
  }
  if (!info) return fail('missing IHDR');
  if (!sawIEND) return fail('missing IEND');
  return info;
}
