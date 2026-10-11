import { db, type ProjectRow } from '../assets/db';
import type { GraphDoc, ProjectMeta, TimelineDoc } from '../types/graph';
import { GRAPH_SCHEMA_VERSION } from '../types/graph';
import { emptyGraph, migrateGraph } from '../graph/migration';
import { uid } from '../lib/ids';

export function defaultTimeline(): TimelineDoc {
  return { schemaVersion: 1, fps: 30, duration: 4, timebase: '30fps', tracks: [], playhead: 0 };
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const rows = await db.projects.orderBy('updatedAt').reverse().toArray();
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt, schemaVersion: r.schemaVersion, description: r.description }));
}

export async function createProject(name = 'Untitled Project'): Promise<ProjectMeta> {
  const now = Date.now();
  const row: ProjectRow = {
    id: uid('p'), name, createdAt: now, updatedAt: now,
    schemaVersion: GRAPH_SCHEMA_VERSION,
    graph: emptyGraph(), timeline: defaultTimeline(), approvals: {}, notes: {},
  };
  await db.projects.put(row);
  return { id: row.id, name, createdAt: now, updatedAt: now, schemaVersion: row.schemaVersion };
}

export async function loadProject(id: string): Promise<{ meta: ProjectMeta; graph: GraphDoc; timeline: TimelineDoc } | null> {
  const row = await db.projects.get(id);
  if (!row) return null;
  let graph: GraphDoc;
  try {
    graph = migrateGraph(row.graph);
  } catch {
    graph = emptyGraph();
  }
  const timeline = (row.timeline as TimelineDoc) ?? defaultTimeline();
  return {
    meta: { id: row.id, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt, schemaVersion: row.schemaVersion, description: row.description },
    graph, timeline,
  };
}

export async function saveProject(
  id: string, name: string, graph: GraphDoc, timeline: TimelineDoc,
  approvals: Record<string, string> = {}, notes: Record<string, string> = {},
): Promise<void> {
  const existing = await db.projects.get(id);
  const now = Date.now();
  if (!existing) {
    await db.projects.put({ id, name, createdAt: now, updatedAt: now, schemaVersion: GRAPH_SCHEMA_VERSION, graph, timeline, approvals, notes });
    return;
  }
  await db.projects.update(id, { name, updatedAt: now, schemaVersion: GRAPH_SCHEMA_VERSION, graph, timeline, approvals, notes });
}

export async function renameProject(id: string, name: string): Promise<void> {
  await db.projects.update(id, { name, updatedAt: Date.now() });
}

export async function duplicateProject(id: string): Promise<ProjectMeta | null> {
  const row = await db.projects.get(id);
  if (!row) return null;
  const now = Date.now();
  const copy: ProjectRow = {
    ...JSON.parse(JSON.stringify(row)) as ProjectRow,
    id: uid('p'), name: `${row.name} (copy)`, createdAt: now, updatedAt: now,
  };
  await db.projects.put(copy);
  return { id: copy.id, name: copy.name, createdAt: now, updatedAt: now, schemaVersion: copy.schemaVersion };
}

export async function deleteProject(id: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.assets, db.blobs, db.thumbs, db.runs], async () => {
    await db.projects.delete(id);
    const assets = await db.assets.where('projectId').equals(id).toArray();
    for (const a of assets) {
      await db.blobs.delete(a.id);
      await db.thumbs.delete(a.id);
    }
    await db.assets.where('projectId').equals(id).delete();
    await db.runs.where('projectId').equals(id).delete();
  });
}
