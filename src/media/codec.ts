// Browser codec bridge: decode bytes/files to ImageValue, encode ImageValue to
// downloadable bytes. Prefers canvas APIs; falls back to the pure-TS PNG
// encoder where canvas is unavailable. JPEG/WebP require canvas.

import { createImage, type ImageValue } from './pixel';
import { encodePNG } from './png';

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export function mimeFor(format: ExportFormat): string {
  return format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
}

export function extFor(format: ExportFormat): string {
  return format;
}

function hasDocument(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

function imageValueToCanvas(img: ImageValue): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return canvas;
}

export async function encodeImage(img: ImageValue, format: ExportFormat, quality = 0.92): Promise<Uint8Array> {
  if (format === 'png') {
    try {
      if (!hasDocument()) return encodePNG(img);
      const canvas = imageValueToCanvas(img);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return encodePNG(img);
      return new Uint8Array(await blob.arrayBuffer());
    } catch {
      return encodePNG(img); // canvas unavailable/broken (workers, tests) — pure encoder
    }
  }
  if (!hasDocument()) throw new Error(`${format} encoding requires a browser canvas`);
  try {
    const canvas = imageValueToCanvas(img);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeFor(format), quality));
    if (!blob) throw new Error(`Browser cannot encode ${mimeFor(format)} (format unsupported here)`);
    return new Uint8Array(await blob.arrayBuffer());
  } catch (e) {
    throw new Error(`JPEG/WebP encoding failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function decodeImageBlob(blob: Blob): Promise<ImageValue> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob);
      try {
        if (!hasDocument()) throw new Error('no canvas');
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('2D canvas context unavailable');
        ctx.drawImage(bmp, 0, 0);
        const id = ctx.getImageData(0, 0, bmp.width, bmp.height);
        return { kind: 'image', width: bmp.width, height: bmp.height, data: new Uint8ClampedArray(id.data) };
      } finally {
        bmp.close();
      }
    } catch (e) {
      throw new Error(`Cannot decode image (${blob.type || 'unknown type'}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error('Image decoding requires createImageBitmap (browser)');
}

export async function decodeImageBytes(bytes: Uint8Array, mime = 'image/png'): Promise<ImageValue> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = globalThis.Blob as any;
  if (!B) throw new Error('Blob unavailable in this runtime');
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return decodeImageBlob(new B([ab], { type: mime }));
}

export function imageToDataURL(img: ImageValue): string {
  if (!hasDocument()) throw new Error('Preview rendering requires a browser');
  return imageValueToCanvas(img).toDataURL('image/png');
}

export async function makeThumbnail(blob: Blob, maxSize = 256): Promise<{ blob: Blob; width: number; height: number } | null> {
  try {
    const img = await decodeImageBlob(blob);
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const src = imageValueToCanvas(img);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0, w, h);
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    return out ? { blob: out, width: w, height: h } : null;
  } catch {
    return null;
  }
}

/** Probe dimensions without keeping pixels. */
export async function probeImage(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob);
    const out = { width: bmp.width, height: bmp.height };
    bmp.close();
    return out;
  }
  throw new Error('Image probing requires createImageBitmap');
}

export { createImage };
