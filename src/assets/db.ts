import Dexie, { type Table } from 'dexie';
import type { AssetRecord, GraphDoc, ProjectMeta, RunRecord, TimelineDoc } from '../types/graph';

export interface ProjectRow {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
  description?: string;
  graph: GraphDoc;
  timeline: TimelineDoc;
  approvals: Record<string, string>;
  notes: Record<string, string>;
}

export interface AssetRow extends AssetRecord {
  projectId: string;
}

export interface BlobRow {
  /** Same id as the asset. Binary payload stored separately for lazy loading. */
  id: string;
  data: ArrayBuffer;
}

export interface ThumbRow {
  id: string;
  data: ArrayBuffer;
}

export interface RunRow extends RunRecord {
  id: string;
  projectId: string;
}

export interface SubgraphRow {
  id: string;
  name: string;
  description?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  graph: GraphDoc;
  publicInputs: Array<{ nodeId: string; portId: string; name: string }>;
  publicOutputs: Array<{ nodeId: string; portId: string; name: string }>;
}

export interface KVRow {
  key: string;
  value: unknown;
}

class StudioDB extends Dexie {
  projects!: Table<ProjectRow, string>;
  assets!: Table<AssetRow, string>;
  blobs!: Table<BlobRow, string>;
  thumbs!: Table<ThumbRow, string>;
  runs!: Table<RunRow, string>;
  subgraphs!: Table<SubgraphRow, string>;
  kv!: Table<KVRow, string>;

  constructor() {
    super('infinite-creation-studio');
    this.version(1).stores({
      projects: 'id, updatedAt',
      assets: 'id, projectId, kind, createdAt',
      blobs: 'id',
      thumbs: 'id',
      runs: 'id, projectId, startedAt',
      subgraphs: 'id, updatedAt',
      kv: 'key',
    });
  }
}

export const db = new StudioDB();

export async function storageUsage(): Promise<{ used?: number; quota?: number }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = globalThis as any;
    if (nav?.navigator?.storage?.estimate) {
      const est = await nav.navigator.storage.estimate();
      return { used: est.usage, quota: est.quota };
    }
  } catch {
    /* unsupported */
  }
  return {};
}

export async function requestPersistence(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = globalThis as any;
    if (nav?.navigator?.storage?.persist) return await nav.navigator.storage.persist();
  } catch {
    /* unsupported */
  }
  return false;
}

export function projectRowToMeta(row: ProjectRow): ProjectMeta {
  return { id: row.id, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt, schemaVersion: row.schemaVersion, description: row.description };
}
