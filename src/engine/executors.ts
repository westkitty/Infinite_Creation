// Node executors: the real per-node implementations behind the graph.
// Each executor is a pure function of (loaded inputs, params) plus an explicit
// context for asset loading and cancellation. No React here.

import type { AssetKind, TimelineDoc } from '../types/graph';
import type { ImageValue } from '../media/pixel';
import { createImage } from '../media/pixel';
import { parseHex } from '../media/color';
import { runOp } from './workerPool';
import { encodeImage, type ExportFormat } from '../media/codec';
import { opResize } from '../media/ops';

export type ExecValue =
  | { kind: 'image'; image: ImageValue; formatHint?: ExportFormat; qualityHint?: number }
  | { kind: 'artifact'; bytes: Uint8Array; mime: string; filename: string; width?: number; height?: number }
  | { kind: 'collection'; items: ExecValue[] }
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'color'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'transform'; value: TransformParams }
  | { kind: 'metadata'; value: Record<string, unknown> }
  | { kind: 'assetRef'; assetId: string; assetKind: AssetKind; mime: string; name: string }
  | { kind: 'sequence'; images: ImageValue[]; fps: number; framesPerImage: number };

export interface TransformParams { x: number; y: number; scale: number; rotation: number; opacity: number }

export interface ExecContext {
  projectId: string;
  runId: string;
  signal: AbortSignal;
  loadImageAsset: (assetId: string) => Promise<ImageValue>;
  getAssetMeta: (assetId: string) => Promise<{ kind: AssetKind; mime: string; name: string; width?: number; height?: number } | null>;
  getTimeline: () => TimelineDoc;
  captureSnapshot?: () => Promise<ImageValue | null>;
}

export type Executor = (
  ctx: ExecContext,
  inputs: Record<string, ExecValue[]>,
  params: Record<string, unknown>,
) => Promise<Record<string, ExecValue>>;

function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Parameter "${key}" must be a finite number`);
  return n;
}
function str(params: Record<string, unknown>, key: string, fallback: string): string {
  const v = params[key];
  return v === undefined || v === null ? fallback : String(v);
}
function bool(params: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = params[key];
  return v === undefined || v === null ? fallback : !!v;
}

function single(inputs: Record<string, ExecValue[]>, port: string): ExecValue {
  const arr = inputs[port] ?? [];
  if (arr.length === 0) throw new Error(`Missing required input "${port}"`);
  return arr[0];
}
function asImage(v: ExecValue, port: string): ImageValue {
  if (v.kind !== 'image') throw new Error(`Input "${port}" must be an image (got ${v.kind})`);
  return v.image;
}
function check(ctx: ExecContext): void {
  if (ctx.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
}

async function imageRefOrInput(ctx: ExecContext, params: Record<string, unknown>, key: string): Promise<ImageValue> {
  const id = str(params, key, '');
  if (!id) throw new Error('No asset selected — choose an asset in the inspector');
  return ctx.loadImageAsset(id);
}

// ---------------------------------------------------------------- sources ---

const srcImageImport: Executor = async (ctx, _i, p) => ({ image: { kind: 'image', image: await imageRefOrInput(ctx, p, 'assetId') } });

const srcMediaRef = (port: string): Executor => async (ctx, _i, p) => {
  const id = str(p, 'assetId', '');
  if (!id) throw new Error('No asset selected');
  const meta = await ctx.getAssetMeta(id);
  if (!meta) throw new Error(`Asset ${id} is missing (deleted or corrupt record)`);
  return { [port]: { kind: 'assetRef', assetId: id, assetKind: meta.kind, mime: meta.mime, name: meta.name } };
};

const srcPrompt: Executor = async (_c, _i, p) => ({ text: { kind: 'text', value: str(p, 'text', '') } });

const srcSolidColor: Executor = async (ctx, _i, p) => {
  check(ctx);
  const [r, g, b] = parseHex(str(p, 'color', '#c8102e'));
  const w = num(p, 'width', 512), h = num(p, 'height', 512);
  if (w < 1 || h < 1 || w > 8192 || h > 8192) throw new Error('Dimensions must be within 1..8192');
  return { image: { kind: 'image', image: createImage(w, h, [r, g, b, 255]) } };
};

const srcAssetRef: Executor = async (ctx, _i, p) => {
  const id = str(p, 'assetId', '');
  if (!id) throw new Error('No asset selected');
  const meta = await ctx.getAssetMeta(id);
  if (!meta) throw new Error(`Asset ${id} is missing`);
  return { collection: { kind: 'collection', items: [{ kind: 'assetRef', assetId: id, assetKind: meta.kind, mime: meta.mime, name: meta.name }] } };
};

// ------------------------------------------------------------------ image ---

const imgCrop: Executor = async (ctx, i, p) => ({
  image: {
    kind: 'image',
    image: await runOp('crop', [asImage(single(i, 'image'), 'image')], {
      mode: str(p, 'mode', 'pixels'), x: num(p, 'x', 0), y: num(p, 'y', 0),
      width: num(p, 'width', 256), height: num(p, 'height', 256), lockAspect: bool(p, 'lockAspect', false),
    }, ctx.signal),
  },
});

const imgResize: Executor = async (ctx, i, p) => ({
  image: {
    kind: 'image',
    image: await runOp('resize', [asImage(single(i, 'image'), 'image')], {
      mode: str(p, 'mode', 'dimensions'), width: num(p, 'width', 512), height: num(p, 'height', 512),
      percent: num(p, 'percent', 100), keepAspect: bool(p, 'keepAspect', true), quality: str(p, 'quality', 'high'),
    }, ctx.signal),
  },
});

const imgRotate: Executor = async (ctx, i, p) => ({
  image: {
    kind: 'image',
    image: await runOp('rotate', [asImage(single(i, 'image'), 'image')], { angle: num(p, 'angle', 0), fit: str(p, 'fit', 'expand') }, ctx.signal),
  },
});

const imgFlip: Executor = async (ctx, i, p) => ({
  image: {
    kind: 'image',
    image: await runOp('flip', [asImage(single(i, 'image'), 'image')], { horizontal: bool(p, 'horizontal', true), vertical: bool(p, 'vertical', false) }, ctx.signal),
  },
});

const imgExposure: Executor = async (ctx, i, p) => ({
  image: {
    kind: 'image',
    image: await runOp('brightness', [asImage(single(i, 'image'), 'image')], { brightness: num(p, 'brightness', 0), exposure: num(p, 'exposure', 0) }, ctx.signal),
  },
});

const imgContrast: Executor = async (ctx, i, p) => ({
  image: { kind: 'image', image: await runOp('contrast', [asImage(single(i, 'image'), 'image')], { contrast: num(p, 'contrast', 0) }, ctx.signal) },
});
const imgSaturation: Executor = async (ctx, i, p) => ({
  image: { kind: 'image', image: await runOp('saturation', [asImage(single(i, 'image'), 'image')], { saturation: num(p, 'saturation', 0) }, ctx.signal) },
});
const imgHue: Executor = async (ctx, i, p) => ({
  image: { kind: 'image', image: await runOp('hue', [asImage(single(i, 'image'), 'image')], { hue: num(p, 'hue', 0) }, ctx.signal) },
});
const imgColorBalance: Executor = async (ctx, i, p) => ({
  image: {
    kind: 'image',
    image: await runOp('colorBalance', [asImage(single(i, 'image'), 'image')], { red: num(p, 'red', 0), green: num(p, 'green', 0), blue: num(p, 'blue', 0) }, ctx.signal),
  },
});
const imgOpacity: Executor = async (ctx, i, p) => ({
  image: { kind: 'image', image: await runOp('opacity', [asImage(single(i, 'image'), 'image')], { opacity: num(p, 'opacity', 100) }, ctx.signal) },
});
const imgBlur: Executor = async (ctx, i, p) => ({
  image: { kind: 'image', image: await runOp('blur', [asImage(single(i, 'image'), 'image')], { radius: num(p, 'radius', 4) }, ctx.signal) },
});
const imgSharpen: Executor = async (ctx, i, p) => ({
  image: { kind: 'image', image: await runOp('sharpen', [asImage(single(i, 'image'), 'image')], { amount: num(p, 'amount', 50) }, ctx.signal) },
});

const imgMask: Executor = async (ctx, i, p) => ({
  image: {
    kind: 'image',
    image: await runOp('mask', [asImage(single(i, 'image'), 'image'), asImage(single(i, 'mask'), 'mask')], { invert: bool(p, 'invert', false) }, ctx.signal),
  },
});

const imgComposite: Executor = async (ctx, i, p) => ({
  image: {
    kind: 'image',
    image: await runOp('composite', [asImage(single(i, 'background'), 'background'), asImage(single(i, 'foreground'), 'foreground')], {
      x: num(p, 'x', 0), y: num(p, 'y', 0), scale: num(p, 'scale', 100),
      opacity: num(p, 'opacity', 100), blend: str(p, 'blend', 'source-over'),
    }, ctx.signal),
  },
});

const imgConvert: Executor = async (_ctx, i, p) => {
  const v = single(i, 'image');
  if (v.kind !== 'image') throw new Error('Convert input must be an image');
  const format = str(p, 'format', 'png') as ExportFormat;
  if (!['png', 'jpeg', 'webp'].includes(format)) throw new Error(`Unsupported format "${format}"`);
  return { image: { kind: 'image', image: v.image, formatHint: format, qualityHint: num(p, 'quality', 92) } };
};

const SUPPORTED_EXPORTS: ExportFormat[] = ['png', 'jpeg', 'webp'];

const imgExport: Executor = async (ctx, i, p) => {
  check(ctx);
  const v = single(i, 'image');
  if (v.kind !== 'image') throw new Error('Export input must be an image');
  const format = str(p, 'format', 'png') as ExportFormat;
  if (!SUPPORTED_EXPORTS.includes(format)) throw new Error(`Unsupported export format "${format}"`);
  const quality = Math.min(100, Math.max(1, num(p, 'quality', 92))) / 100;
  const base = str(p, 'filename', 'output').trim().replace(/[^\w\- ]+/g, '_').slice(0, 80) || 'output';
  const bytes = await encodeImage(v.image, format, quality);
  check(ctx);
  const mime = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
  return { artifact: { kind: 'artifact', bytes, mime, filename: `${base}.${format}`, width: v.image.width, height: v.image.height } };
};

// ---------------------------------------------------------------- utility ---

const utilNumeric: Executor = async (_c, _i, p) => ({ value: { kind: 'number', value: num(p, 'value', 0) } });
const utilColor: Executor = async (_c, _i, p) => {
  const v = str(p, 'value', '#ffffff');
  parseHex(v); // validate
  return { value: { kind: 'color', value: v } };
};
const utilMetadata: Executor = async (_c, i) => {
  const arr = i['input'] ?? [];
  if (arr.length === 0) return { metadata: { kind: 'metadata', value: { empty: true } } };
  const v = arr[0];
  if (v.kind === 'image') {
    return { metadata: { kind: 'metadata', value: { kind: 'image', width: v.image.width, height: v.image.height, pixels: v.image.width * v.image.height } } };
  }
  if (v.kind === 'artifact') {
    return { metadata: { kind: 'metadata', value: { kind: 'artifact', mime: v.mime, bytes: v.bytes.length, width: v.width, height: v.height } } };
  }
  return { metadata: { kind: 'metadata', value: { kind: v.kind } } };
};
const utilCompare: Executor = async (_c, i) => ({ image: single(i, 'a') });
const utilBranch: Executor = async (_c, i) => {
  const v = single(i, 'image');
  return { a: v, b: v };
};
const utilMerge: Executor = async (_c, i) => ({ collection: { kind: 'collection', items: [...(i['images'] ?? [])] } });
const utilInspector: Executor = async (_c, i) => ({ image: single(i, 'input') });
const utilSubgraph: Executor = async () => {
  throw new Error('Reusable subgraphs execute in Phase 6 — this node is not runnable yet');
};

// --------------------------------------------------------------- timeline ---

const tlSequence: Executor = async (_c, i, p) => {
  const imgs = (i['images'] ?? []).map((v, k) => {
    if (v.kind !== 'image') throw new Error(`Sequence input #${k} must be an image`);
    return v.image;
  });
  if (imgs.length === 0) throw new Error('Sequence needs at least one image');
  return { sequence: { kind: 'sequence', images: imgs, fps: num(p, 'fps', 30), framesPerImage: 12 } };
};
const tlFrameDuration: Executor = async (_c, i, p) => {
  const v = single(i, 'sequence');
  if (v.kind !== 'sequence') throw new Error('Frame Duration input must be a sequence');
  return { sequence: { ...v, framesPerImage: num(p, 'frames', 12) } };
};
const tlKeyframes: Executor = async (_c, _i, p) => {
  const t = num(p, 'time', 0);
  const pairs = str(p, 'keys', '0:0,1:100').split(',').map((s) => {
    const [a, b] = s.split(':').map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`Invalid key "${s}" — expected t:v pairs`);
    return { t: a, v: b };
  }).sort((a, b) => a.t - b.t);
  if (pairs.length === 0) throw new Error('At least one keyframe is required');
  if (t <= pairs[0].t) return { value: { kind: 'number', value: pairs[0].v } };
  for (let k = 0; k < pairs.length - 1; k++) {
    const A = pairs[k], B = pairs[k + 1];
    if (t <= B.t) {
      const f = B.t === A.t ? 0 : (t - A.t) / (B.t - A.t);
      return { value: { kind: 'number', value: A.v + (B.v - A.v) * f } };
    }
  }
  return { value: { kind: 'number', value: pairs[pairs.length - 1].v } };
};
const tlTransform: Executor = async (_c, _i, p) => ({
  transform: {
    kind: 'transform',
    value: { x: num(p, 'x', 0), y: num(p, 'y', 0), scale: num(p, 'scale', 100), rotation: num(p, 'rotation', 0), opacity: num(p, 'opacity', 100) },
  },
});
const tlPreview: Executor = async (ctx, _i, p) => {
  const t = num(p, 'time', 0);
  const w = num(p, 'width', 512), h = num(p, 'height', 512);
  const frame = await renderTimelineFrame(ctx, ctx.getTimeline(), t, w, h);
  return { image: { kind: 'image', image: frame } };
};

// --------------------------------------------------------------------- 3D ---

const modelPass: Executor = async (_c, i) => ({ model: single(i, 'model') });
const modelLoader: Executor = async (_c, i) => {
  const v = single(i, 'model');
  if (v.kind !== 'assetRef') throw new Error('GLB Loader input must be a model asset');
  return { model: v };
};
const modelSnapshot: Executor = async (ctx) => {
  if (!ctx.captureSnapshot) throw new Error('Model Snapshot requires the interactive 3D viewer: open the INSPECT workspace, load the model, then use the viewer Snapshot button');
  const img = await ctx.captureSnapshot();
  if (!img) throw new Error('3D viewer has no frame to capture (blank or unloaded viewer)');
  return { image: { kind: 'image', image: img } };
};

// -------------------------------------------------------------- providers ---

const providerStub: Executor = async () => {
  throw new Error('No generation provider is configured — this node is visibly unavailable and cannot execute');
};

// ---------------------------------------------------------------- registry ---

export const EXECUTORS: Record<string, Executor> = {
  'source.imageImport': srcImageImport,
  'source.audioImport': srcMediaRef('audio'),
  'source.videoImport': srcMediaRef('video'),
  'source.glbImport': srcMediaRef('model'),
  'source.prompt': srcPrompt,
  'source.solidColor': srcSolidColor,
  'source.assetRef': srcAssetRef,
  'image.crop': imgCrop,
  'image.resize': imgResize,
  'image.rotate': imgRotate,
  'image.flip': imgFlip,
  'image.exposure': imgExposure,
  'image.contrast': imgContrast,
  'image.saturation': imgSaturation,
  'image.hue': imgHue,
  'image.colorBalance': imgColorBalance,
  'image.opacity': imgOpacity,
  'image.blur': imgBlur,
  'image.sharpen': imgSharpen,
  'image.mask': imgMask,
  'image.composite': imgComposite,
  'image.convert': imgConvert,
  'image.export': imgExport,
  'util.numeric': utilNumeric,
  'util.color': utilColor,
  'util.metadata': utilMetadata,
  'util.compare': utilCompare,
  'util.branch': utilBranch,
  'util.merge': utilMerge,
  'util.subgraph': utilSubgraph,
  'util.inspector': utilInspector,
  'timeline.sequence': tlSequence,
  'timeline.frameDuration': tlFrameDuration,
  'timeline.keyframes': tlKeyframes,
  'timeline.transform': tlTransform,
  'timeline.preview': tlPreview,
  'model.loader': modelLoader,
  'model.viewer': modelPass,
  'model.camera': modelPass,
  'model.snapshot': modelSnapshot,
  'provider.imageGen': providerStub,
  'provider.videoGen': providerStub,
  'provider.audioGen': providerStub,
};

// ------------------------------------------------------- timeline renderer ---

/** Evaluate numeric keyframes (linear/hold) at time t. */
export function evalKeyframes(keys: Array<{ time: number; value?: unknown; interpolation: 'linear' | 'hold' }>, t: number): number {
  const pts = keys.filter((k) => typeof k.value === 'number').sort((a, b) => a.time - b.time) as Array<{ time: number; value: number; interpolation: 'linear' | 'hold' }>;
  if (pts.length === 0) return 0;
  if (t <= pts[0].time) return pts[0].value;
  for (let k = 0; k < pts.length - 1; k++) {
    const A = pts[k], B = pts[k + 1];
    if (t <= B.time) {
      if (A.interpolation === 'hold' || B.time === A.time) return A.value;
      const f = (t - A.time) / (B.time - A.time);
      return A.value + (B.value - A.value) * f;
    }
  }
  return pts[pts.length - 1].value;
}

/**
 * Render the project timeline at time t.
 * Semantics (documented): image tracks composite bottom-to-top; a transform or
 * opacity track applies to the nearest image track below it; a track is active
 * while clipStart <= t < clipStart+clipDuration; animated transform/opacity
 * come from that track's keyframes when present.
 */
export async function renderTimelineFrame(
  ctx: Pick<ExecContext, 'loadImageAsset' | 'signal'>,
  timeline: TimelineDoc,
  t: number,
  width: number,
  height: number,
): Promise<ImageValue> {
  if (width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('Preview dimensions must be within 1..4096');
  let canvas: ImageValue = createImage(width, height, [16, 17, 20, 255]);
  let pendingFx: { opacity: number; x: number; y: number; scale: number } | null = null;
  for (const track of timeline.tracks) {
    if (track.muted) continue;
    const active = t >= track.clipStart && t < track.clipStart + track.clipDuration;
    if (track.kind === 'opacity') {
      const v = track.keyframes.length ? evalKeyframes(track.keyframes, t) : 100;
      pendingFx = { ...(pendingFx ?? { x: 0, y: 0, scale: 100 }), opacity: Math.min(100, Math.max(0, v)) };
      continue;
    }
    if (track.kind === 'transform') {
      // Numeric keyframes drive x; scale/rotation come from keyframe objects when provided.
      const x = track.keyframes.length ? evalKeyframes(track.keyframes, t) : 0;
      pendingFx = { ...(pendingFx ?? { opacity: 100, y: 0, scale: 100 }), x };
      continue;
    }
    if (track.kind !== 'image' || !active) { if (track.kind === 'image') pendingFx = null; continue; }
    if (track.assetIds.length === 0) { pendingFx = null; continue; }
    // Frame select: quantize elapsed time to the track fps grid (no drift: pure function of t).
    const fps = Math.max(1, timeline.fps);
    const elapsed = t - track.clipStart;
    const frameIdx = Math.floor(elapsed * fps);
    const assetId = track.assetIds[frameIdx % track.assetIds.length];
    if (ctx.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const img = await ctx.loadImageAsset(assetId);
    const fitted = opResize(img, { mode: 'dimensions', width, height, percent: 100, keepAspect: true, quality: 'high' });
    const fx = pendingFx ?? { opacity: 100, x: 0, y: 0, scale: 100 };
    const { opComposite } = await import('../media/ops');
    canvas = opComposite(canvas, fitted, {
      x: Math.round((width - fitted.width) / 2 + fx.x),
      y: Math.round((height - fitted.height) / 2 + fx.y),
      scale: fx.scale, opacity: fx.opacity, blend: 'source-over',
    });
    pendingFx = null;
  }
  return canvas;
}

export function describeValue(v: ExecValue): string {
  switch (v.kind) {
    case 'image': return `image ${v.image.width}x${v.image.height}`;
    case 'artifact': return `artifact ${v.mime} ${(v.bytes.length / 1024).toFixed(1)} KB`;
    case 'collection': return `collection[${v.items.length}]`;
    case 'sequence': return `sequence[${v.images.length}] @${v.fps}fps`;
    case 'number': return `number ${v.value}`;
    case 'text': return `text (${v.value.length} chars)`;
    case 'color': return `color ${v.value}`;
    case 'boolean': return `bool ${v.value}`;
    case 'transform': return `transform x=${v.value.x} y=${v.value.y}`;
    case 'metadata': return `metadata`;
    case 'assetRef': return `asset ${v.name}`;
  }
}
