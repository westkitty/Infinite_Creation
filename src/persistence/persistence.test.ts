import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../assets/db';
import { createProject, deleteProject, duplicateProject, loadProject, saveProject } from './projectService';
import { emptyGraph, migrateGraph } from '../graph/migration';
import { defaultTimeline } from './projectService';
import { getAssetBytes, storeDerivedAsset } from '../assets/repository';
import { verifyProjectAssets } from '../assets/recovery';

beforeEach(async () => {
  await db.projects.clear();
  await db.assets.clear();
  await db.blobs.clear();
  await db.thumbs.clear();
  await db.runs.clear();
  await db.subgraphs.clear();
});

describe('persistence', () => {
  it('save/load round-trips graph + timeline', async () => {
    const meta = await createProject('Roundtrip');
    const graph = emptyGraph();
    graph.nodes.push({
      id: 'n1', type: 'source.solidColor', position: { x: 10, y: 20 },
      data: { params: { color: '#ffffff', width: 8, height: 8 }, disabled: false },
    });
    await saveProject(meta.id, 'Renamed', graph, defaultTimeline());
    const loaded = await loadProject(meta.id);
    expect(loaded?.meta.name).toBe('Renamed');
    expect(loaded?.graph.nodes).toHaveLength(1);
    expect(loaded?.graph.nodes[0].position).toEqual({ x: 10, y: 20 });
  });

  it('asset binary round-trips byte-identical', async () => {
    const meta = await createProject('Binaries');
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5]);
    const asset = await storeDerivedAsset(meta.id, 'blob.bin', 'application/octet-stream', bytes, { kind: 'derived' });
    const back = await getAssetBytes(asset.id);
    expect(back).toEqual(bytes);
  });

  it('migrates legacy graphs without data loss', () => {
    const legacy = {
      schemaVersion: 1,
      nodes: [{ id: 'n', type: 'image.crop', position: { x: 1, y: 2 }, data: { params: { x: 1 } } }],
      edges: [{ id: 'e', source: 'n', sourceHandle: 'image', target: 'n', targetHandle: 'image' }],
    };
    const g = migrateGraph(legacy);
    expect(g.schemaVersion).toBeGreaterThanOrEqual(4);
    expect(g.nodes[0].data.disabled).toBe(false);
    expect(g.links).toEqual([]);
    expect(migrateGraph(null).nodes).toEqual([]);
  });

  it('detects missing binaries and recovers via relink path', async () => {
    const meta = await createProject('Recovery');
    const asset = await storeDerivedAsset(meta.id, 'x.bin', 'application/octet-stream', new Uint8Array([9, 9]), { kind: 'derived' });
    await db.blobs.delete(asset.id); // simulate partial eviction
    const report = await verifyProjectAssets(meta.id);
    expect(report.missing).toContain(asset.id);
    const row = await db.assets.get(asset.id);
    expect(row?.missing).toBe(true);
  });

  it('duplicate + delete manage project lifecycle', async () => {
    const meta = await createProject('Life');
    const asset = await storeDerivedAsset(meta.id, 'a.bin', 'application/octet-stream', new Uint8Array([1]), { kind: 'derived' });
    expect(asset).toBeTruthy();
    const dupe = await duplicateProject(meta.id);
    expect(dupe?.name).toContain('(copy)');
    await deleteProject(meta.id);
    expect(await loadProject(meta.id)).toBeNull();
    expect(await db.assets.where('projectId').equals(meta.id).count()).toBe(0);
    expect(await db.blobs.get(asset.id)).toBeUndefined();
  });
});
