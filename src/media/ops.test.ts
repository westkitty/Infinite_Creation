import { describe, expect, it } from 'vitest';
import { createImage, pixelAt } from './pixel';
import {
  opBlur, opBrightness, opColorBalance, opComposite, opContrast, opCrop,
  opFlip, opHue, opMask, opOpacity, opResize, opRotate, opSaturation, opSharpen,
} from './ops';

function gradient(w = 8, h = 8) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      img.data[i] = Math.round((x / (w - 1)) * 255);
      img.data[i + 1] = Math.round((y / (h - 1)) * 255);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

describe('pixel ops', () => {
  it('crops exact pixels and dimensions', () => {
    const out = opCrop(gradient(), { mode: 'pixels', x: 2, y: 2, width: 3, height: 3 });
    expect(out.width).toBe(3);
    expect(out.height).toBe(3);
    // src(2,2) -> r=73ish, g=73ish
    const [r, g, b, a] = pixelAt(out, 0, 0);
    expect(r).toBe(pixelAt(gradient(), 2, 2)[0]);
    expect(g).toBe(pixelAt(gradient(), 2, 2)[1]);
    expect(b).toBe(128);
    expect(a).toBe(255);
  });

  it('rejects out-of-bounds crops', () => {
    expect(() => opCrop(gradient(), { mode: 'pixels', x: 6, y: 6, width: 4, height: 4 })).toThrow(/exceeds image/);
    expect(() => opCrop(gradient(), { mode: 'pixels', x: 0, y: 0, width: 0, height: 4 })).toThrow(/>= 1px/);
  });

  it('resizes to explicit dimensions', () => {
    const out = opResize(gradient(), { mode: 'dimensions', width: 4, height: 2, percent: 100, keepAspect: false, quality: 'high' });
    expect(out.width).toBe(4);
    expect(out.height).toBe(2);
  });

  it('resizes by percent with aspect preserved', () => {
    const out = opResize(gradient(8, 4), { mode: 'percent', width: 1, height: 1, percent: 50, keepAspect: true, quality: 'high' });
    expect(out.width).toBe(4);
    expect(out.height).toBe(2);
  });

  it('rotates 90° exactly', () => {
    const src = createImage(2, 1, [10, 20, 30, 255]);
    src.data[4] = 200; src.data[5] = 100; src.data[6] = 50; src.data[7] = 255;
    const out = opRotate(src, { angle: 90, fit: 'expand' });
    expect(out.width).toBe(1);
    expect(out.height).toBe(2);
  });

  it('flips horizontally', () => {
    const src = createImage(2, 1, [0, 0, 0, 255]);
    src.data[0] = 11;
    src.data[4] = 22;
    const out = opFlip(src, { horizontal: true, vertical: false });
    expect(pixelAt(out, 0, 0)[0]).toBe(22);
    expect(pixelAt(out, 1, 0)[0]).toBe(11);
  });

  it('brightness/exposure shift pixels', () => {
    const src = createImage(2, 2, [100, 100, 100, 255]);
    const up = opBrightness(src, 10, 0);
    expect(pixelAt(up, 0, 0)[0]).toBeGreaterThan(100);
    const down = opBrightness(src, -10, 0);
    expect(pixelAt(down, 0, 0)[0]).toBeLessThan(100);
    const stop = opBrightness(src, 0, 1);
    expect(pixelAt(stop, 0, 0)[0]).toBe(200);
  });

  it('contrast pivots around midpoint', () => {
    const src = createImage(1, 1, [200, 200, 200, 255]);
    const out = opContrast(src, 50);
    expect(pixelAt(out, 0, 0)[0]).toBeGreaterThan(200);
  });

  it('saturation -100 yields gray', () => {
    const src = createImage(1, 1, [255, 0, 0, 255]);
    const out = opSaturation(src, -100);
    const [r, g, b] = pixelAt(out, 0, 0);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(1);
  });

  it('hue rotation changes red', () => {
    const src = createImage(1, 1, [255, 0, 0, 255]);
    const out = opHue(src, 120);
    const [r, g] = pixelAt(out, 0, 0);
    expect(g).toBeGreaterThan(r);
  });

  it('color balance scales channels', () => {
    const src = createImage(1, 1, [100, 100, 100, 255]);
    const out = opColorBalance(src, 50, 0, -50);
    const [r, g, b] = pixelAt(out, 0, 0);
    expect(r).toBe(150);
    expect(g).toBe(100);
    expect(b).toBe(50);
  });

  it('opacity scales alpha only', () => {
    const src = createImage(1, 1, [100, 120, 140, 200]);
    const out = opOpacity(src, 50);
    expect(pixelAt(out, 0, 0)).toEqual([100, 120, 140, 100]);
  });

  it('blur smooths an impulse and sharpen restores contrast', () => {
    const src = createImage(5, 5, [0, 0, 0, 255]);
    src.data[(2 * 5 + 2) * 4] = 255; src.data[(2 * 5 + 2) * 4 + 1] = 255; src.data[(2 * 5 + 2) * 4 + 2] = 255;
    const blurred = opBlur(src, 2);
    expect(pixelAt(blurred, 2, 2)[0]).toBeLessThan(255);
    expect(pixelAt(blurred, 0, 0)[0]).toBeGreaterThanOrEqual(0);
    const sharp = opSharpen(blurred, 100);
    expect(pixelAt(sharp, 2, 2)[0]).toBeGreaterThan(pixelAt(blurred, 2, 2)[0]);
  });

  it('mask multiplies alpha by luminance', () => {
    const src = createImage(2, 1, [255, 255, 255, 255]);
    const mask = createImage(2, 1, [0, 0, 0, 255]);
    mask.data[4] = 255; mask.data[5] = 255; mask.data[6] = 255;
    const out = opMask(src, mask, false);
    expect(pixelAt(out, 0, 0)[3]).toBe(0);
    expect(pixelAt(out, 1, 0)[3]).toBe(255);
  });

  it('composite layers foreground over background', () => {
    const bg = createImage(4, 4, [0, 0, 255, 255]);
    const fg = createImage(2, 2, [255, 0, 0, 255]);
    const out = opComposite(bg, fg, { x: 1, y: 1, scale: 100, opacity: 100, blend: 'source-over' });
    expect(pixelAt(out, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(pixelAt(out, 1, 1)[0]).toBe(255);
    expect(pixelAt(out, 2, 2)[0]).toBe(255);
    expect(pixelAt(out, 3, 3)).toEqual([0, 0, 255, 255]);
  });

  it('composite honors partial opacity', () => {
    const bg = createImage(1, 1, [0, 0, 0, 255]);
    const fg = createImage(1, 1, [255, 255, 255, 255]);
    const out = opComposite(bg, fg, { x: 0, y: 0, scale: 100, opacity: 50, blend: 'source-over' });
    const [r] = pixelAt(out, 0, 0);
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(160);
  });

  it('inputs are never mutated (copy-on-write)', () => {
    const src = gradient();
    const before = Array.from(src.data);
    opCrop(src, { mode: 'pixels', x: 0, y: 0, width: 4, height: 4 });
    opBlur(src, 3);
    opComposite(src, src, { x: 0, y: 0, scale: 100, opacity: 100, blend: 'multiply' });
    expect(Array.from(src.data)).toEqual(before);
  });
});
