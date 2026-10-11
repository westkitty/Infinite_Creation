import { beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { db } from '../assets/db';
import { createProject, saveProject } from '../persistence/projectService';
import { defaultTimeline } from '../persistence/projectService';
import { buildSampleA } from '../samples/builders';
import { exportWorkflowJSON, importWorkflowJSON } from './workflowJson';
import { exportProjectArchive, readProjectArchive, storeImportedArchive } from './archive';
import { storeDerivedAsset } from '../assets/repository';

beforeEach(async () => {
  await db.projects.clear();
  await db.assets.clear();
  await db.blobs.clear();
  await db.thumbs.clear();
  await db.runs.clear();
  await db.subgraphs.clear();
});

describe('portability', () => {
  it('workflow JSON round-trips', () => {
    const s = buildSampleA();
    const text = exportWorkflowJSON('demo', s.graph, s.timeline);
    const back = importWorkflowJSON(text);
    expect(back.graph.nodes).toHaveLength(s.graph.nodes.length);
    expect(back.graph.edges).toHaveLength(s.graph.edges.length);
    expect(back.warnings).toEqual([]);
  });

  it('rejects non-workflow JSON', () => {
    expect(() => importWorkflowJSON('{"nope":1}')).toThrow(/Not an Infinite Creation workflow/);
    expect(() => importWorkflowJSON('not json')).toThrow(/Not valid JSON/);
  });

  it('archive export/import round-trips with binaries verified', async () => {
    const meta = await createProject('Archie');
    const s = buildSampleA();
    await saveProject(meta.id, 'Archie', s.graph, s.timeline);
    const bytes = new Uint8Array([10, 20, 30, 40, 50]);
    await storeDerivedAsset(meta.id, 'data.bin', 'application/octet-stream', bytes, { kind: 'derived' });
    const blob = await exportProjectArchive(meta.id);
    expect(blob.size).toBeGreaterThan(100);
    const data = await readProjectArchive(blob);
    expect(data.graph.nodes).toHaveLength(s.graph.nodes.length);
    expect(data.assets).toHaveLength(1);
    expect(data.binaries.size).toBe(1);
    expect(data.warnings).toEqual([]);
    const newId = await storeImportedArchive(data);
    expect(newId).not.toBe(meta.id);
    const imported = await db.projects.get(newId);
    expect(imported?.name).toContain('(imported)');
    const importedAssets = await db.assets.where('projectId').equals(newId).toArray();
    expect(importedAssets).toHaveLength(1);
  });

  it('rejects tampered archives (checksum mismatch)', async () => {
    const meta = await createProject('Tamper');
    const s = buildSampleA();
    await saveProject(meta.id, 'Tamper', s.graph, s.timeline);
    const blob = await exportProjectArchive(meta.id);
    const zip = await JSZip.loadAsync(blob);
    zip.file('graph.json', JSON.stringify({ hacked: true }));
    const evil = await zip.generateAsync({ type: 'blob' });
    await expect(readProjectArchive(evil)).rejects.toThrow(/Checksum mismatch/);
  });

  it('rejects archives with unsafe paths', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      kind: 'infinite-creation-archive', archiveSchema: 99, appVersion: 'x',
      graphSchemaVersion: 99, projectId: 'p', projectName: 'evil', exportedAt: 0, checksums: {},
    }));
    zip.file('../escape.txt', 'evil');
    const blob = await zip.generateAsync({ type: 'blob' });
    // Either the traversal guard or the (also invalid) future-schema gate must reject it.
    await expect(readProjectArchive(blob)).rejects.toThrow(/Unsafe archive path|newer than this app/);
  });

  it('rejects future schema versions', async () => {
    const meta = await createProject('Future');
    const s = buildSampleA();
    await saveProject(meta.id, 'Future', s.graph, s.timeline);
    const blob = await exportProjectArchive(meta.id);
    const zip = await JSZip.loadAsync(blob);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    manifest.archiveSchema = 9999;
    manifest.checksums = {};
    zip.file('manifest.json', JSON.stringify(manifest));
    // remove other files so checksum loop passes trivially
    for (const name of Object.keys(zip.files)) {
      if (name !== 'manifest.json') zip.remove(name);
    }
    const future = await zip.generateAsync({ type: 'blob' });
    await expect(readProjectArchive(future)).rejects.toThrow(/newer than this app/);
  });
});
