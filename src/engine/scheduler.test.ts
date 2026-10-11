import { beforeEach, describe, expect, it } from 'vitest';
import { cancelRun, executeGraph, resolveLinkedParams } from './scheduler';
import { resultCache } from './cache';
import { buildSampleA, buildSampleB } from '../samples/builders';
import { db } from '../assets/db';
import { useExecStore } from '../stores/execStore';
import type { GraphDoc } from '../types/graph';

async function resetDb() {
  await db.projects.clear();
  await db.assets.clear();
  await db.blobs.clear();
  await db.thumbs.clear();
  await db.runs.clear();
  await db.subgraphs.clear();
}

beforeEach(async () => {
  await resetDb();
  resultCache.invalidateAll();
  useExecStore.setState({
    nodeStatus: {}, nodeRuns: {}, outputs: {}, runs: [], diagnostics: [],
    cacheStats: { hits: 0, misses: 0, evictions: 0 }, running: false, runId: null,
  });
});

describe('scheduler', () => {
  it('executes sample A end to end with dependency order', async () => {
    const sample = buildSampleA();
    const rec = await executeGraph({ projectId: 'p1', doc: sample.graph, timeline: sample.timeline });
    expect(rec.status).toBe('completed');
    const statuses = Object.fromEntries(Object.values(rec.nodeRuns).map((r) => [r.nodeId, r.status]));
    expect(statuses).toMatchObject({
      src_base: 'completed', crop: 'completed', grade: 'completed',
      src_badge: 'completed', comp: 'completed', export: 'completed',
    });
    // Export artifact persisted with provenance.
    const assets = await db.assets.where('projectId').equals('p1').toArray();
    expect(assets.length).toBe(1);
    expect(assets[0].name).toBe('sample_a.png');
    expect(assets[0].provenance?.nodeType).toBe('image.export');
  });

  it('reuses caches on identical re-run (incremental)', async () => {
    const sample = buildSampleA();
    await executeGraph({ projectId: 'p1', doc: sample.graph, timeline: sample.timeline });
    const before = useExecStore.getState().cacheStats;
    expect(before.misses).toBeGreaterThan(0);
    const rec = await executeGraph({ projectId: 'p1', doc: sample.graph, timeline: sample.timeline });
    expect(rec.status).toBe('completed');
    const after = useExecStore.getState().cacheStats;
    expect(after.hits).toBeGreaterThan(before.hits);
    expect(Object.values(rec.nodeRuns).every((r) => r.cacheHit)).toBe(true);
  });

  it('param change invalidates only downstream (shared branch stays cached)', async () => {
    const sample = buildSampleB();
    await executeGraph({ projectId: 'p1', doc: sample.graph, timeline: sample.timeline });
    // Change only the 512 branch.
    const doc2: GraphDoc = JSON.parse(JSON.stringify(sample.graph));
    const r512 = doc2.nodes.find((n) => n.id === 'r512')!;
    (r512.data.params as Record<string, unknown>).width = 400;
    (r512.data.params as Record<string, unknown>).height = 400;
    const rec = await executeGraph({ projectId: 'p1', doc: doc2, timeline: sample.timeline });
    expect(rec.status).toBe('completed');
    const runs = Object.fromEntries(Object.values(rec.nodeRuns).map((r) => [r.nodeId, r]));
    expect(runs['src'].cacheHit).toBe(true);
    expect(runs['grade'].cacheHit).toBe(true);
    expect(runs['r512'].cacheHit).toBe(false);
    expect(runs['x512'].cacheHit).toBe(false);
    expect(runs['r256'].cacheHit).toBe(true);
    expect(runs['x256'].cacheHit).toBe(true);
  });

  it('failed nodes propagate errors and block downstream', async () => {
    const sample = buildSampleA();
    const doc: GraphDoc = JSON.parse(JSON.stringify(sample.graph));
    const crop = doc.nodes.find((n) => n.id === 'crop')!;
    (crop.data.params as Record<string, unknown>).width = 700; // passes param range, exceeds 640px source at runtime
    const rec = await executeGraph({ projectId: 'p1', doc, timeline: sample.timeline });
    expect(rec.status).toBe('failed');
    expect(rec.nodeRuns['crop'].status).toBe('failed');
    expect(rec.nodeRuns['comp'].status).toBe('blocked');
    expect(rec.nodeRuns['export'].status).toBe('blocked');
  });

  it('cancellation prevents successful completion', async () => {
    const sample = buildSampleA();
    // Cancel on next tick: run must not report completed.
    const p = executeGraph({ projectId: 'p1', doc: sample.graph, timeline: sample.timeline });
    const { cancelRun } = await import('./scheduler');
    cancelRun();
    const rec = await p;
    expect(rec.status).toBe('cancelled');
    expect(Object.values(rec.nodeRuns).some((r) => r.status === 'cancelled' || r.status === 'queued')).toBe(true);
  });

  it('rejects invalid graphs before executing anything', async () => {
    const sample = buildSampleA();
    const doc: GraphDoc = JSON.parse(JSON.stringify(sample.graph));
    doc.edges = []; // every downstream node loses required inputs
    const rec = await executeGraph({ projectId: 'p1', doc, timeline: sample.timeline });
    expect(rec.status).toBe('failed');
    expect(rec.error).toMatch(/validation error/);
  });

  it('resolveLinkedParams applies compatible drivers only', () => {
    const sample = buildSampleA();
    const doc: GraphDoc = {
      ...sample.graph,
      links: [
        { id: 'l1', sourceNodeId: 'grade', sourceKey: 'red', targetNodeId: 'crop', targetKey: 'width' },
        { id: 'l2', sourceNodeId: 'src_base', sourceKey: 'color', targetNodeId: 'src_badge', targetKey: 'color' },
      ],
    };
    const crop = doc.nodes.find((n) => n.id === 'crop')!;
    const { params, applied } = resolveLinkedParams(doc, crop);
    expect(applied.map((a) => a.id)).toEqual(['l1']);
    expect(params['width']).toBe(15); // grade.red drives crop.width
    const badge = doc.nodes.find((n) => n.id === 'src_badge')!;
    const r2 = resolveLinkedParams(doc, badge);
    expect(r2.params['color']).toBe('#2e7fc1');
  });
});
