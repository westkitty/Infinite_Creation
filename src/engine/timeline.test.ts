import { describe, expect, it } from 'vitest';
import { renderTimelineFrame } from './executors';
import { createImage } from '../media/pixel';
import type { TimelineDoc } from '../types/graph';

const ctrl = () => new AbortController();

describe('timeline renderer', () => {
  it('renders an empty timeline as a dark frame', async () => {
    const tl: TimelineDoc = { schemaVersion: 1, fps: 30, duration: 4, timebase: '30fps', tracks: [], playhead: 0 };
    const frame = await renderTimelineFrame(
      { loadImageAsset: async () => { throw new Error('should not load'); }, signal: ctrl().signal },
      tl, 1.5, 64, 48,
    );
    expect(frame.width).toBe(64);
    expect(frame.height).toBe(48);
    expect(Array.from(frame.data.slice(0, 4))).toEqual([16, 17, 20, 255]);
  });

  it('is a pure function of time (no drift)', async () => {
    const tl: TimelineDoc = { schemaVersion: 1, fps: 30, duration: 4, timebase: '30fps', tracks: [], playhead: 0 };
    const mk = () => renderTimelineFrame(
      { loadImageAsset: async () => { throw new Error('x'); }, signal: ctrl().signal },
      tl, 2.25, 8, 8,
    );
    const a = await mk();
    const b = await mk();
    expect(a.data).toEqual(b.data);
  });

  it('composites an image track inside its clip window only', async () => {
    const red = createImage(8, 8, [255, 0, 0, 255]);
    const tl: TimelineDoc = {
      schemaVersion: 1, fps: 2, duration: 4, timebase: '2fps', playhead: 0,
      tracks: [{ id: 't', name: 'stills', kind: 'image', assetIds: ['a1'], clipStart: 1, clipDuration: 2, keyframes: [], muted: false }],
    };
    const loader = async (id: string) => {
      if (id !== 'a1') throw new Error('unknown');
      return red;
    };
    const inside = await renderTimelineFrame({ loadImageAsset: loader, signal: ctrl().signal }, tl, 1.5, 8, 8);
    expect(inside.data[0]).toBe(255);
    const outside = await renderTimelineFrame({ loadImageAsset: loader, signal: ctrl().signal }, tl, 0.25, 8, 8);
    expect(Array.from(outside.data.slice(0, 3))).toEqual([16, 17, 20]);
  });
});
