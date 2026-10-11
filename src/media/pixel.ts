// Core in-memory image representation: plain RGBA pixels.
// Deliberately DOM-free so workers and unit tests can use it.

export interface ImageValue {
  kind: 'image';
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** Content hash (fnv/sha short) — filled by engine for cache identity. */
  hash?: string;
}

export function createImage(width: number, height: number, fill?: [number, number, number, number]): ImageValue {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const data = new Uint8ClampedArray(w * h * 4);
  if (fill) {
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = fill[0]; data[i * 4 + 1] = fill[1]; data[i * 4 + 2] = fill[2]; data[i * 4 + 3] = fill[3];
    }
  }
  return { kind: 'image', width: w, height: h, data };
}

export function cloneImage(img: ImageValue): ImageValue {
  return { kind: 'image', width: img.width, height: img.height, data: new Uint8ClampedArray(img.data), hash: img.hash };
}

export function assertImage(img: ImageValue): void {
  if (!img || img.kind !== 'image') throw new Error('Expected an image value');
  if (!Number.isInteger(img.width) || !Number.isInteger(img.height) || img.width < 1 || img.height < 1) {
    throw new Error(`Invalid image dimensions ${img.width}x${img.height}`);
  }
  if (!(img.data instanceof Uint8ClampedArray) || img.data.length !== img.width * img.height * 4) {
    throw new Error('Image pixel buffer does not match dimensions');
  }
}

export function pixelAt(img: ImageValue, x: number, y: number): [number, number, number, number] {
  const cx = Math.min(img.width - 1, Math.max(0, x | 0));
  const cy = Math.min(img.height - 1, Math.max(0, y | 0));
  const i = (cy * img.width + cx) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

export function setPixel(img: ImageValue, x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
}

/** Fast FNV-1a over pixels (sampled for large images) for cache identity. */
export function hashPixels(img: ImageValue): string {
  let h = 0x811c9dc5;
  const { data, width, height } = img;
  const step = data.length > 4 * 1024 * 1024 ? 16 : 4;
  h ^= width & 0xff; h = Math.imul(h, 0x01000193);
  h ^= (width >> 8) & 0xff; h = Math.imul(h, 0x01000193);
  h ^= height & 0xff; h = Math.imul(h, 0x01000193);
  h ^= (height >> 8) & 0xff; h = Math.imul(h, 0x01000193);
  for (let i = 0; i < data.length; i += step) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193);
  }
  return `px_${(h >>> 0).toString(16).padStart(8, '0')}_${width}x${height}`;
}
