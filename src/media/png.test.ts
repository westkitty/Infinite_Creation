import { describe, expect, it } from 'vitest';
import { createImage } from './pixel';
import { encodePNG, parsePNG } from './png';

describe('minimal PNG codec', () => {
  it('round-trips dimensions with valid structure', () => {
    const img = createImage(13, 7, [200, 100, 50, 255]);
    const bytes = encodePNG(img);
    expect(bytes.length).toBeGreaterThan(8);
    const info = parsePNG(bytes);
    expect(info.valid).toBe(true);
    expect(info.width).toBe(13);
    expect(info.height).toBe(7);
    expect(info.bitDepth).toBe(8);
    expect(info.colorType).toBe(6);
  });

  it('has the PNG signature', () => {
    const bytes = encodePNG(createImage(1, 1, [0, 0, 0, 255]));
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('rejects corrupted bytes', () => {
    const bytes = encodePNG(createImage(4, 4, [1, 2, 3, 255]));
    bytes[40] ^= 0xff;
    expect(parsePNG(bytes).valid).toBe(false);
    expect(parsePNG(new Uint8Array([1, 2, 3])).valid).toBe(false);
  });

  it('is deterministic', () => {
    const a = encodePNG(createImage(3, 3, [9, 9, 9, 255]));
    const b = encodePNG(createImage(3, 3, [9, 9, 9, 255]));
    expect(a).toEqual(b);
  });
});
