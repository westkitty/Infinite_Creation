// Pure, DOM-free image operations over ImageValue (RGBA, sRGB-encoded bytes).
// Every op returns a NEW ImageValue (copy-on-write); inputs are never mutated.

import { assertImage, cloneImage, createImage, type ImageValue } from './pixel';
import { hslToRgb, rgbToHsl } from './color';

export interface CropParams { mode: 'pixels' | 'normalized'; x: number; y: number; width: number; height: number; lockAspect?: boolean }
export interface ResizeParams { mode: 'dimensions' | 'percent'; width: number; height: number; percent: number; keepAspect: boolean; quality: string }
export interface RotateParams { angle: number; fit: 'expand' | 'crop' }
export interface FlipParams { horizontal: boolean; vertical: boolean }
export interface CompositeParams { x: number; y: number; scale: number; opacity: number; blend: string }

export function opCrop(src: ImageValue, p: CropParams): ImageValue {
  assertImage(src);
  let x = p.x, y = p.y, w = p.width, h = p.height;
  if (p.mode === 'normalized') {
    x = p.x * src.width; y = p.y * src.height; w = p.width * src.width; h = p.height * src.height;
  }
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
    throw new Error('Crop parameters must be finite numbers');
  }
  if (w < 1 || h < 1) throw new Error('Crop width/height must be >= 1px');
  if (x < 0 || y < 0 || x + w > src.width || y + h > src.height) {
    throw new Error(`Crop rect (${x},${y} ${w}x${h}) exceeds image ${src.width}x${src.height}`);
  }
  const out = createImage(w, h);
  for (let row = 0; row < h; row++) {
    const srcOff = ((y + row) * src.width + x) * 4;
    out.data.set(src.data.subarray(srcOff, srcOff + w * 4), row * w * 4);
  }
  return out;
}

function sampleBilinear(src: ImageValue, fx: number, fy: number): [number, number, number, number] {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(src.width - 1, x0 + 1);
  const y1 = Math.min(src.height - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, fx - x0));
  const ty = Math.min(1, Math.max(0, fy - y0));
  const i00 = (Math.min(src.height - 1, Math.max(0, y0)) * src.width + Math.min(src.width - 1, Math.max(0, x0))) * 4;
  const i10 = (Math.min(src.height - 1, Math.max(0, y0)) * src.width + x1) * 4;
  const i01 = (y1 * src.width + Math.min(src.width - 1, Math.max(0, x0))) * 4;
  const i11 = (y1 * src.width + x1) * 4;
  const d = src.data;
  const mix = (a: number, b: number, c: number, e: number) => a + (b - a) * tx + (c - a) * ty + (a - b - c + e) * tx * ty;
  return [mix(d[i00], d[i10], d[i01], d[i11]), mix(d[i00 + 1], d[i10 + 1], d[i01 + 1], d[i11 + 1]), mix(d[i00 + 2], d[i10 + 2], d[i01 + 2], d[i11 + 2]), mix(d[i00 + 3], d[i10 + 3], d[i01 + 3], d[i11 + 3])];
}

export function opResize(src: ImageValue, p: ResizeParams): ImageValue {
  assertImage(src);
  let w: number, h: number;
  if (p.mode === 'percent') {
    if (!Number.isFinite(p.percent) || p.percent < 1 || p.percent > 1600) throw new Error('Percent must be within 1..1600');
    w = Math.max(1, Math.round((src.width * p.percent) / 100));
    h = Math.max(1, Math.round((src.height * p.percent) / 100));
  } else {
    w = Math.round(p.width); h = Math.round(p.height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) throw new Error('Resize dimensions must be >= 1px');
    if (p.keepAspect) {
      // Fit inside the requested box preserving aspect ratio.
      const s = Math.min(w / src.width, h / src.height);
      w = Math.max(1, Math.round(src.width * s));
      h = Math.max(1, Math.round(src.height * s));
    }
  }
  if (w > 8192 || h > 8192) throw new Error('Resize result exceeds 8192px limit');
  const pixelated = p.quality === 'pixelated';
  const out = createImage(w, h);
  if (pixelated) {
    for (let y = 0; y < h; y++) {
      const sy = Math.min(src.height - 1, Math.floor((y * src.height) / h));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(src.width - 1, Math.floor((x * src.width) / w));
        const si = (sy * src.width + sx) * 4;
        const di = (y * w + x) * 4;
        out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1]; out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = src.data[si + 3];
      }
    }
    return out;
  }
  for (let y = 0; y < h; y++) {
    const fy = ((y + 0.5) * src.height) / h - 0.5;
    for (let x = 0; x < w; x++) {
      const fx = ((x + 0.5) * src.width) / w - 0.5;
      const [r, g, b, a] = sampleBilinear(src, fx, fy);
      const di = (y * w + x) * 4;
      out.data[di] = r; out.data[di + 1] = g; out.data[di + 2] = b; out.data[di + 3] = a;
    }
  }
  return out;
}

export function opRotate(src: ImageValue, p: RotateParams): ImageValue {
  assertImage(src);
  if (!Number.isFinite(p.angle)) throw new Error('Angle must be finite');
  const norm = ((Math.round(p.angle) % 360) + 360) % 360;
  // Fast paths for right angles (exact).
  if (norm % 90 === 0 && p.fit === 'expand') {
    const turns = (norm / 90) % 4;
    if (turns === 0) return cloneImage(src);
    const swap = turns % 2 === 1;
    const out = createImage(swap ? src.height : src.width, swap ? src.width : src.height);
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const si = (y * src.width + x) * 4;
        let dx = 0, dy = 0;
        if (turns === 1) { dx = src.height - 1 - y; dy = x; }
        else if (turns === 2) { dx = src.width - 1 - x; dy = src.height - 1 - y; }
        else { dx = y; dy = src.width - 1 - x; }
        const di = (dy * out.width + dx) * 4;
        out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1]; out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = src.data[si + 3];
      }
    }
    return out;
  }
  const rad = (p.angle * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  let w: number, h: number;
  if (p.fit === 'expand') {
    w = Math.max(1, Math.ceil(Math.abs(src.width * cos) + Math.abs(src.height * sin)));
    h = Math.max(1, Math.ceil(Math.abs(src.width * sin) + Math.abs(src.height * cos)));
  } else {
    w = src.width; h = src.height;
  }
  if (w > 8192 || h > 8192) throw new Error('Rotated canvas exceeds 8192px limit');
  const out = createImage(w, h, [0, 0, 0, 0]);
  const cx = src.width / 2, cy = src.height / 2;
  const ox = w / 2, oy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - ox, dy = y + 0.5 - oy;
      const sx = dx * cos + dy * sin + cx - 0.5;
      const sy = -dx * sin + dy * cos + cy - 0.5;
      if (sx < -0.5 || sy < -0.5 || sx > src.width - 0.5 || sy > src.height - 0.5) continue;
      const [r, g, b, a] = sampleBilinear(src, sx, sy);
      const di = (y * w + x) * 4;
      out.data[di] = r; out.data[di + 1] = g; out.data[di + 2] = b; out.data[di + 3] = a;
    }
  }
  return out;
}

export function opFlip(src: ImageValue, p: FlipParams): ImageValue {
  assertImage(src);
  const out = createImage(src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    const sy = p.vertical ? src.height - 1 - y : y;
    for (let x = 0; x < src.width; x++) {
      const sx = p.horizontal ? src.width - 1 - x : x;
      const si = (sy * src.width + sx) * 4;
      const di = (y * src.width + x) * 4;
      out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1]; out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

// --- Color operations ---

export function opBrightness(src: ImageValue, brightness: number, exposure: number): ImageValue {
  assertImage(src);
  if (!Number.isFinite(brightness) || !Number.isFinite(exposure)) throw new Error('Brightness/exposure must be finite');
  const gain = Math.pow(2, exposure);
  const offset = (brightness / 100) * 255;
  const out = cloneImage(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i] * gain + offset;
    d[i + 1] = d[i + 1] * gain + offset;
    d[i + 2] = d[i + 2] * gain + offset;
  }
  return out;
}

export function opContrast(src: ImageValue, contrast: number): ImageValue {
  assertImage(src);
  if (!Number.isFinite(contrast)) throw new Error('Contrast must be finite');
  // contrast -100..100 → factor
  const c = Math.max(-100, Math.min(100, contrast));
  const f = (259 * (c + 255)) / (255 * (259 - c));
  const out = cloneImage(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = f * (d[i] - 128) + 128;
    d[i + 1] = f * (d[i + 1] - 128) + 128;
    d[i + 2] = f * (d[i + 2] - 128) + 128;
  }
  return out;
}

export function opSaturation(src: ImageValue, saturation: number): ImageValue {
  assertImage(src);
  if (!Number.isFinite(saturation)) throw new Error('Saturation must be finite');
  const k = 1 + Math.max(-100, Math.min(100, saturation)) / 100;
  const out = cloneImage(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    const [r, g, b] = hslToRgb(h, s * k, l);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  return out;
}

export function opHue(src: ImageValue, degrees: number): ImageValue {
  assertImage(src);
  if (!Number.isFinite(degrees)) throw new Error('Hue must be finite');
  const shift = degrees / 360;
  const out = cloneImage(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    const [r, g, b] = hslToRgb(h + shift, s, l);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  return out;
}

export function opColorBalance(src: ImageValue, r: number, g: number, b: number): ImageValue {
  assertImage(src);
  for (const v of [r, g, b]) if (!Number.isFinite(v)) throw new Error('Color balance values must be finite');
  const fr = 1 + Math.max(-100, Math.min(100, r)) / 100;
  const fg = 1 + Math.max(-100, Math.min(100, g)) / 100;
  const fb = 1 + Math.max(-100, Math.min(100, b)) / 100;
  const out = cloneImage(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i] * fr; d[i + 1] = d[i + 1] * fg; d[i + 2] = d[i + 2] * fb;
  }
  return out;
}

export function opOpacity(src: ImageValue, opacityPct: number): ImageValue {
  assertImage(src);
  if (!Number.isFinite(opacityPct)) throw new Error('Opacity must be finite');
  const k = Math.min(1, Math.max(0, opacityPct / 100));
  const out = cloneImage(src);
  const d = out.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] * k;
  return out;
}

// --- Spatial filters ---

function boxBlur(src: ImageValue, radius: number): ImageValue {
  const r = Math.max(0, Math.min(50, Math.round(radius)));
  if (r === 0) return cloneImage(src);
  const { width: w, height: h } = src;
  const tmp = new Float32Array(w * h * 4);
  const s = src.data;
  // horizontal
  for (let y = 0; y < h; y++) {
    let acc = [0, 0, 0, 0];
    for (let x = -r; x < w + r; x++) {
      const addX = Math.min(w - 1, Math.max(0, x + r));
      const remX = Math.min(w - 1, Math.max(0, x - r - 1));
      const ai = (y * w + addX) * 4;
      const ri = (y * w + remX) * 4;
      if (x + r >= 0 && x - r - 1 < 0) {
        // warming: accumulate
        acc[0] += s[ai]; acc[1] += s[ai + 1]; acc[2] += s[ai + 2]; acc[3] += s[ai + 3];
      } else {
        acc[0] += s[ai] - s[ri]; acc[1] += s[ai + 1] - s[ri + 1]; acc[2] += s[ai + 2] - s[ri + 2]; acc[3] += s[ai + 3] - s[ri + 3];
      }
      if (x >= 0 && x < w) {
        const n = Math.min(x + r, w - 1) - Math.max(x - r, 0) + 1;
        const ti = (y * w + x) * 4;
        tmp[ti] = acc[0] / n; tmp[ti + 1] = acc[1] / n; tmp[ti + 2] = acc[2] / n; tmp[ti + 3] = acc[3] / n;
      }
    }
  }
  // vertical
  const out = createImage(w, h);
  for (let x = 0; x < w; x++) {
    let acc = [0, 0, 0, 0];
    for (let y = -r; y < h + r; y++) {
      const addY = Math.min(h - 1, Math.max(0, y + r));
      const remY = Math.min(h - 1, Math.max(0, y - r - 1));
      const ai = (addY * w + x) * 4;
      const ri = (remY * w + x) * 4;
      if (y + r >= 0 && y - r - 1 < 0) {
        acc[0] += tmp[ai]; acc[1] += tmp[ai + 1]; acc[2] += tmp[ai + 2]; acc[3] += tmp[ai + 3];
      } else {
        acc[0] += tmp[ai] - tmp[ri]; acc[1] += tmp[ai + 1] - tmp[ri + 1]; acc[2] += tmp[ai + 2] - tmp[ri + 2]; acc[3] += tmp[ai + 3] - tmp[ri + 3];
      }
      if (y >= 0 && y < h) {
        const n = Math.min(y + r, h - 1) - Math.max(y - r, 0) + 1;
        const di = (y * w + x) * 4;
        out.data[di] = acc[0] / n; out.data[di + 1] = acc[1] / n; out.data[di + 2] = acc[2] / n; out.data[di + 3] = acc[3] / n;
      }
    }
  }
  return out;
}

export function opBlur(src: ImageValue, radius: number): ImageValue {
  assertImage(src);
  if (!Number.isFinite(radius)) throw new Error('Blur radius must be finite');
  // Two box passes approximate a gaussian.
  return boxBlur(boxBlur(src, radius / 2), radius / 2);
}

export function opSharpen(src: ImageValue, amount: number): ImageValue {
  assertImage(src);
  if (!Number.isFinite(amount)) throw new Error('Sharpen amount must be finite');
  const k = Math.min(2, Math.max(0, amount / 100));
  if (k === 0) return cloneImage(src);
  const blurred = boxBlur(src, 1.5);
  const out = cloneImage(src);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = out.data[i] + (out.data[i] - blurred.data[i]) * k;
    out.data[i + 1] = out.data[i + 1] + (out.data[i + 1] - blurred.data[i + 1]) * k;
    out.data[i + 2] = out.data[i + 2] + (out.data[i + 2] - blurred.data[i + 2]) * k;
  }
  return out;
}

// --- Mask & composite ---

export function opMask(src: ImageValue, mask: ImageValue, invert: boolean): ImageValue {
  assertImage(src);
  assertImage(mask);
  // Mask is resampled to source size with nearest sampling (explicit, documented).
  const out = cloneImage(src);
  for (let y = 0; y < src.height; y++) {
    const my = Math.min(mask.height - 1, Math.floor((y * mask.height) / src.height));
    for (let x = 0; x < src.width; x++) {
      const mx = Math.min(mask.width - 1, Math.floor((x * mask.width) / src.width));
      const mi = (my * mask.width + mx) * 4;
      // luminance of mask rgb × mask alpha
      const lum = (0.2126 * mask.data[mi] + 0.7152 * mask.data[mi + 1] + 0.0722 * mask.data[mi + 2]) * (mask.data[mi + 3] / 255);
      const k = (invert ? 255 - lum : lum) / 255;
      out.data[(y * src.width + x) * 4 + 3] = src.data[(y * src.width + x) * 4 + 3] * k;
    }
  }
  return out;
}

type BlendFn = (b: number, f: number) => number;
const BLENDS: Record<string, BlendFn> = {
  'source-over': (_b, f) => f,
  multiply: (b, f) => (b * f) / 255,
  screen: (b, f) => 255 - ((255 - b) * (255 - f)) / 255,
  overlay: (b, f) => (b < 128 ? (2 * b * f) / 255 : 255 - (2 * (255 - b) * (255 - f)) / 255),
  darken: (b, f) => Math.min(b, f),
  lighten: (b, f) => Math.max(b, f),
  difference: (b, f) => Math.abs(b - f),
};

export function opComposite(bg: ImageValue, fg: ImageValue, p: CompositeParams): ImageValue {
  assertImage(bg);
  assertImage(fg);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.scale) || !Number.isFinite(p.opacity)) {
    throw new Error('Composite parameters must be finite');
  }
  const blend = BLENDS[p.blend] ?? BLENDS['source-over'];
  const k = Math.min(1, Math.max(0, p.opacity / 100));
  const scale = Math.min(16, Math.max(0.01, p.scale / 100));
  const fw = Math.max(1, Math.round(fg.width * scale));
  const fh = Math.max(1, Math.round(fg.height * scale));
  const scaled = opResize(fg, { mode: 'dimensions', width: fw, height: fh, percent: 100, keepAspect: false, quality: 'high' });
  const out = cloneImage(bg);
  const ox = Math.round(p.x), oy = Math.round(p.y);
  for (let y = 0; y < scaled.height; y++) {
    const dy = oy + y;
    if (dy < 0 || dy >= bg.height) continue;
    for (let x = 0; x < scaled.width; x++) {
      const dx = ox + x;
      if (dx < 0 || dx >= bg.width) continue;
      const si = (y * scaled.width + x) * 4;
      const di = (dy * bg.width + dx) * 4;
      const fa = (scaled.data[si + 3] / 255) * k;
      if (fa <= 0) continue;
      const ba = out.data[di + 3] / 255;
      const oa = fa + ba * (1 - fa);
      for (let c = 0; c < 3; c++) {
        const blended = blend(out.data[di + c], scaled.data[si + c]);
        // straight-alpha "over": result = (blended*fa + b*ba*(1-fa)) / oa
        out.data[di + c] = oa > 0 ? (blended * fa + out.data[di + c] * ba * (1 - fa)) / oa : 0;
      }
      out.data[di + 3] = oa * 255;
    }
  }
  return out;
}
