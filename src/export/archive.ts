// Portable project archives (.zip): manifest + graph + timeline + asset metadata
// + required source binaries + provenance + checksums. Validated on import:
// traversal-safe paths, entry caps, schema gates, per-file checksums.

import JSZip from 'jszip';
import { z } from 'zod';
import {
  APP_VERSION, AssetRecordSchema, GRAPH_SCHEMA_VERSION, GraphDocSchema,
  TimelineDocSchema, type AssetRecord, type GraphDoc, type TimelineDoc,
} from '../types/graph';
import { migrateGraph } from '../graph/migration';
import { db } from '../assets/db';
import { sha256Hex, uid } from '../lib/ids';

export const ARCHIVE_SCHEMA = 1;
const MAX_ENTRIES = 2000;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024; // 1 GB uncompressed cap
const MAX_FILE_BYTES = 500 * 1024 * 1024;

const ManifestSchema = z.object({
  kind: z.literal('infinite-creation-archive'),
  archiveSchema: z.number().int(),
  appVersion: z.string(),
  graphSchemaVersion: z.number().int(),
  projectId: z.string(),
  projectName: z.string(),
  exportedAt: z.number(),
  checksums: z.record(z.string()),
});
export type ArchiveManifest = z.infer<typeof ManifestSchema>;

export interface ExportProgress {
  phase: string;
  done: number;
  total: number;
}

function assertSafePath(name: string): void {
  if (!name || name.includes('..') || name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:/.test(name)) {
    throw new Error(`Unsafe archive path rejected: "${name}"`);
  }
}

export async function exportProjectArchive(
  projectId: string,
  onProgress?: (p: ExportProgress) => void,
): Promise<Blob> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error('Project not found');
  const assets = await db.assets.where('projectId').equals(projectId).toArray();
  const zip = new JSZip();
  const checksums: Record<string, string> = {};

  const put = async (path: string, data: string | Uint8Array | Blob) => {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    checksums[path] = await sha256Hex(bytes);
    zip.file(path, bytes);
  };

  onProgress?.({ phase: 'graph', done: 0, total: assets.length + 4 });
  await put('graph.json', JSON.stringify(project.graph, null, 2));
  await put('timeline.json', JSON.stringify(project.timeline, null, 2));
  await put('meta.json', JSON.stringify({ name: project.name, description: project.description, approvals: project.approvals, notes: project.notes }, null, 2));

  const records: AssetRecord[] = [];
  let i = 0;
  for (const a of assets) {
    onProgress?.({ phase: `asset ${a.name}`, done: i++, total: assets.length + 4 });
    const blob = await db.blobs.get(a.id);
    const { projectId: _p, ...rec } = a;
    void _p;
    if (!blob) {
      records.push({ ...rec, missing: true });
      continue;
    }
    await put(`blobs/${a.id}.bin`, blob.data);
    records.push({ ...rec, missing: false });
  }
  await put('assets.json', JSON.stringify(records, null, 2));
  const provenance = records.filter((r) => r.provenance).map((r) => ({ id: r.id, name: r.name, provenance: r.provenance }));
  await put('provenance.json', JSON.stringify(provenance, null, 2));

  const manifest: ArchiveManifest = {
    kind: 'infinite-creation-archive',
    archiveSchema: ARCHIVE_SCHEMA,
    appVersion: APP_VERSION,
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    projectId: project.id,
    projectName: project.name,
    exportedAt: Date.now(),
    checksums,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  onProgress?.({ phase: 'compressing', done: assets.length + 4, total: assets.length + 4 });
  return zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => {
    onProgress?.({ phase: 'compressing', done: Math.round(meta.percent), total: 100 });
  });
}

export interface ImportedArchive {
  graph: GraphDoc;
  timeline: TimelineDoc;
  name: string;
  description?: string;
  assets: AssetRecord[];
  blobs: Map<string, Blob>;
  warnings: string[];
}

export async function readProjectArchive(
  file: Blob,
  onProgress?: (p: ExportProgress) => void,
): Promise<ImportedArchive> {
  if (file.size > MAX_TOTAL_BYTES) throw new Error('Archive exceeds the 1 GB import cap');
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files);
  if (names.length > MAX_ENTRIES) throw new Error(`Archive has ${names.length} entries (cap ${MAX_ENTRIES})`);
  for (const n of names) assertSafePath(n);

  const manifestRaw = zip.file('manifest.json');
  if (!manifestRaw) throw new Error('Archive has no manifest.json — not an Infinite Creation project');
  const manifest = ManifestSchema.safeParse(JSON.parse(await manifestRaw.async('string')));
  if (!manifest.success) throw new Error(`Bad manifest: ${manifest.error.issues[0]?.message}`);
  const m = manifest.data;
  if (m.archiveSchema > ARCHIVE_SCHEMA) throw new Error(`Archive schema v${m.archiveSchema} is newer than this app (v${ARCHIVE_SCHEMA})`);
  if (m.graphSchemaVersion > GRAPH_SCHEMA_VERSION) {
    throw new Error(`Project graph schema v${m.graphSchemaVersion} is newer than this app (v${GRAPH_SCHEMA_VERSION})`);
  }

  // Verify checksums before trusting anything.
  onProgress?.({ phase: 'verifying', done: 0, total: names.length });
  let vi = 0;
  for (const [path, want] of Object.entries(m.checksums)) {
    const entry = zip.file(path);
    if (!entry) throw new Error(`Archive manifest lists "${path}" but it is absent`);
    const bytes = new Uint8Array(await entry.async('uint8array'));
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`Archive entry "${path}" exceeds the per-file cap`);
    const got = await sha256Hex(bytes);
    if (got !== want) throw new Error(`Checksum mismatch for "${path}" — archive is corrupt or tampered`);
    onProgress?.({ phase: 'verifying', done: ++vi, total: names.length });
  }

  const warnings: string[] = [];
  const graphRaw = JSON.parse(await zip.file('graph.json')!.async('string'));
  const graph = migrateGraph(graphRaw);
  GraphDocSchema.parse(graph);
  const timelineRaw = zip.file('timeline.json') ? JSON.parse(await zip.file('timeline.json')!.async('string')) : null;
  let timeline: TimelineDoc = { schemaVersion: 1, fps: 30, duration: 4, timebase: '30fps', tracks: [], playhead: 0 };
  if (timelineRaw) {
    const t = TimelineDocSchema.safeParse(timelineRaw);
    if (t.success) timeline = t.data;
    else warnings.push('Timeline section failed validation — reset to defaults (graph kept)');
  }
  const meta = zip.file('meta.json') ? JSON.parse(await zip.file('meta.json')!.async('string')) as { name?: string; description?: string } : {};
  const assetsRaw = zip.file('assets.json') ? (JSON.parse(await zip.file('assets.json')!.async('string')) as unknown[]) : [];
  const assets: AssetRecord[] = [];
  for (const a of assetsRaw) {
    const parsed = AssetRecordSchema.safeParse(a);
    if (parsed.success) assets.push(parsed.data);
    else warnings.push('One asset record failed validation and was skipped (binaries for valid assets kept)');
  }
  const blobs = new Map<string, Blob>();
  for (const a of assets) {
    if (a.missing) {
      warnings.push(`Asset "${a.name}" was already missing at export time — relink it after import`);
      continue;
    }
    const entry = zip.file(`blobs/${a.id}.bin`);
    if (!entry) {
      warnings.push(`Binary for "${a.name}" absent from archive — marked missing`);
      a.missing = true;
      continue;
    }
    const bytes = await entry.async('uint8array');
    const hash = await sha256Hex(bytes);
    if (hash !== a.hash) {
      warnings.push(`Asset "${a.name}" failed its content-hash check — marked missing (record kept)`);
      a.missing = true;
      continue;
    }
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    blobs.set(a.id, new Blob([ab], { type: a.mime }));
  }
  return { graph, timeline, name: meta.name ?? m.projectName, description: meta.description, assets, blobs, warnings };
}

/** Store an imported archive as a brand-new project (collision-safe ids). */
export async function storeImportedArchive(data: ImportedArchive): Promise<string> {
  const now = Date.now();
  const newProjectId = uid('p');
  await db.transaction('rw', [db.projects, db.assets, db.blobs], async () => {
    await db.projects.put({
      id: newProjectId,
      name: `${data.name} (imported)`,
      createdAt: now,
      updatedAt: now,
      schemaVersion: GRAPH_SCHEMA_VERSION,
      graph: data.graph,
      timeline: data.timeline,
      approvals: {},
      notes: {},
    });
    for (const a of data.assets) {
      await db.assets.put({ ...a, projectId: newProjectId });
      const blob = data.blobs.get(a.id);
      if (blob) await db.blobs.put({ id: a.id, data: blob });
    }
  });
  return newProjectId;
}
