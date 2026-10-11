import { describe, expect, it } from 'vitest';
import { EXECUTORS, evalKeyframes, type ExecContext, type ExecValue } from './executors';
import { createImage, type ImageValue } from '../media/pixel';
import { parsePNG } from '../media/png';

function ctx(over: Partial<ExecContext> = {}): ExecContext {
  return {
    projectId: 'p_test',
    runId: 'run_test',
    signal: new AbortController().signal,
    loadImageAsset: async () => { throw new Error('no assets in this test'); },
    getAssetMeta: async () => null,
    getTimeline: () => ({ schemaVersion: 1, fps: 30, duration: 4, timebase: '30fps', tracks: [], playhead: 0 }),
    ...over,
  };
}

function img(v: ImageValue): ExecValue {
  return { kind: 'image', image: v };
}

describe('executors', () => {
  it('solidColor creates exact pixels', async () => {
    const out = await EXECUTORS['source.solidColor'](ctx(), {}, { color: '#ff0000', width: 3, height: 2 });
    const v = out['image'];
    expect(v.kind).toBe('image');
    if (v.kind !== 'image') throw new Error('x');
    expect(v.image.width).toBe(3);
    expect(v.image.height).toBe(2);
    expect(Array.from(v.image.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it('rejects invalid colors', async () => {
    await expect(EXECUTORS['source.solidColor'](ctx(), {}, { color: 'nope', width: 4, height: 4 })).rejects.toThrow(/Invalid color/);
  });

  it('crop → composite → export produces a valid PNG', async () => {
    const base = createImage(16, 16, [0, 0, 255, 255]);
    const badge = createImage(4, 4, [255, 0, 0, 255]);
    const c = ctx();
    const cropped = await EXECUTORS['image.crop'](c, { image: [img(base)] }, { mode: 'pixels', x: 0, y: 0, width: 8, height: 8 });
    expect((cropped['image'] as { image: ImageValue }).image.width).toBe(8);
    const comp = await EXECUTORS['image.composite'](
      c,
      { background: [cropped['image']], foreground: [img(badge)] },
      { x: 2, y: 2, scale: 100, opacity: 100, blend: 'source-over' },
    );
    const art = await EXECUTORS['image.export'](c, { image: [comp['image']] }, { format: 'png', quality: 92, filename: 't' });
    const a = art['artifact'];
    expect(a.kind).toBe('artifact');
    if (a.kind !== 'artifact') throw new Error('x');
    expect(a.mime).toBe('image/png');
    expect(a.filename).toBe('t.png');
    const info = parsePNG(a.bytes);
    expect(info.valid).toBe(true);
    expect(info.width).toBe(8);
    expect(info.height).toBe(8);
  });

  it('branch fans out identical images', async () => {
    const v = img(createImage(2, 2, [1, 2, 3, 255]));
    const out = await EXECUTORS['util.branch'](ctx(), { image: [v] }, {});
    expect(out['a']).toBe(v);
    expect(out['b']).toBe(v);
  });

  it('metadata describes images', async () => {
    const out = await EXECUTORS['util.metadata'](ctx(), { input: [img(createImage(5, 6))] }, {});
    expect(out['metadata']).toMatchObject({ kind: 'metadata' });
    if (out['metadata'].kind === 'metadata') {
      expect(out['metadata'].value).toMatchObject({ width: 5, height: 6 });
    }
  });

  it('keyframes interpolate linearly', async () => {
    const out = await EXECUTORS['timeline.keyframes'](ctx(), {}, { time: 0.5, keys: '0:0,1:100' });
    expect(out['value']).toEqual({ kind: 'number', value: 50 });
  });

  it('evalKeyframes honors hold interpolation', () => {
    const keys = [
      { time: 0, value: 10, interpolation: 'hold' as const },
      { time: 5, value: 99, interpolation: 'linear' as const },
    ];
    expect(evalKeyframes(keys, 2)).toBe(10);
    expect(evalKeyframes(keys, 9)).toBe(99);
  });

  it('provider nodes throw honestly', async () => {
    await expect(EXECUTORS['provider.imageGen'](ctx(), {}, {})).rejects.toThrow(/No generation provider/);
  });

  it('missing required input throws', async () => {
    await expect(EXECUTORS['image.crop'](ctx(), {}, { mode: 'pixels', x: 0, y: 0, width: 2, height: 2 })).rejects.toThrow(/Missing required input/);
  });
});
