import { beforeEach, describe, expect, it } from 'vitest';
import { buildSample, buildSampleA, buildSampleB, buildSampleC } from './builders';
import { validateGraph } from '../graph/validation';
import { executeGraph } from '../engine/scheduler';
import { resultCache } from '../engine/cache';
import { db } from '../assets/db';
import { useExecStore } from '../stores/execStore';
import { parsePNG } from '../media/png';
import { getOutputArtifact } from '../engine/scheduler';

beforeEach(async () => {
  await db.projects.clear();
  await db.assets.clear();
  await db.blobs.clear();
  await db.thumbs.clear();
  await db.runs.clear();
  await db.subgraphs.clear();
  resultCache.invalidateAll();
  useExecStore.setState({
    nodeStatus: {}, nodeRuns: {}, outputs: {}, runs: [], diagnostics: [],
    cacheStats: { hits: 0, misses: 0, evictions: 0 }, running: false, runId: null,
  });
});

describe('sample projects', () => {
  it('all samples validate cleanly', () => {
    for (const id of ['A', 'B', 'C'] as const) {
      const s = buildSample(id);
      const errors = validateGraph(s.graph).filter((i) => i.severity === 'error');
      expect(errors).toEqual([]);
    }
  });

  it('sample A exports a decodable PNG of expected size', async () => {
    const s = buildSampleA();
    const rec = await executeGraph({ projectId: 'pA', doc: s.graph, timeline: s.timeline });
    expect(rec.status).toBe('completed');
    const art = getOutputArtifact('export');
    expect(art).not.toBeNull();
    const info = parsePNG(art!.bytes);
    expect(info.valid).toBe(true);
    expect(info.width).toBe(400);
    expect(info.height).toBe(300);
  });

  it('sample B produces two dimensioned artifacts from shared intermediates', async () => {
    const s = buildSampleB();
    const rec = await executeGraph({ projectId: 'pB', doc: s.graph, timeline: s.timeline });
    expect(rec.status).toBe('completed');
    const a512 = getOutputArtifact('x512')!;
    const a256 = getOutputArtifact('x256')!;
    expect(parsePNG(a512.bytes).width).toBe(512);
    expect(parsePNG(a256.bytes).width).toBe(256);
    // Shared upstream computed once: grade ran once (second run would hit cache).
    expect(rec.nodeRuns['grade'].cacheHit).toBe(false);
  });

  it('sample C evaluates sequence + keyframes + timeline frame', async () => {
    const s = buildSampleC();
    const rec = await executeGraph({ projectId: 'pC', doc: s.graph, timeline: s.timeline });
    expect(rec.status).toBe('completed');
    expect(rec.nodeRuns['seq'].status).toBe('completed');
    expect(rec.nodeRuns['keys'].status).toBe('completed');
    expect(rec.nodeRuns['prev'].status).toBe('completed');
    const art = getOutputArtifact('xprev')!;
    const info = parsePNG(art.bytes);
    expect(info.valid).toBe(true);
    expect(info.width).toBe(320);
    expect(info.height).toBe(200);
  });
});
