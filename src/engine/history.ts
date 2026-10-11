import { db } from '../assets/db';
import type { RunRecord } from '../types/graph';

/** Maximum runs retained per project (mirrors the scheduler's prune cap). */
export const HISTORY_LIMIT = 20;

/**
 * Load persisted run history for a project, newest first.
 * Strips the Dexie row id; every record keeps its projectId for exact scoping.
 */
export async function loadRunHistory(projectId: string): Promise<RunRecord[]> {
  const rows = await db.runs.where('projectId').equals(projectId).sortBy('startedAt');
  return rows.slice(-HISTORY_LIMIT).reverse().map(({ id: _id, ...rest }) => rest);
}

/**
 * Merge in-session runs with persisted history for one project.
 * Session records win on runId conflict (identical content, fresher objects).
 * Result is newest-first and capped; other projects' runs are excluded.
 */
export function mergeHistories(session: RunRecord[], persisted: RunRecord[], projectId: string): RunRecord[] {
  const byId = new Map<string, RunRecord>();
  for (const r of persisted) {
    if (r.projectId === projectId) byId.set(r.runId, r);
  }
  for (const r of session) {
    if (r.projectId === projectId) byId.set(r.runId, r);
  }
  return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, HISTORY_LIMIT);
}
