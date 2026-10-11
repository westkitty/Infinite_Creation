import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../assets/db';
import type { RunRecord } from '../types/graph';
import { HISTORY_LIMIT, loadRunHistory, mergeHistories } from './history';

function rec(runId: string, projectId: string, startedAt: number, status: RunRecord['status'] = 'completed'): RunRecord {
  return { runId, projectId, startedAt, finishedAt: startedAt + 10, status, nodeRuns: {} };
}

beforeEach(async () => {
  await db.runs.clear();
});

describe('loadRunHistory', () => {
  it('returns newest-first, scoped to the project', async () => {
    await db.runs.bulkPut([
      { ...rec('r1', 'p1', 100), id: 'r1' },
      { ...rec('r2', 'p1', 300), id: 'r2' },
      { ...rec('rx', 'p2', 200), id: 'rx' },
      { ...rec('r3', 'p1', 200), id: 'r3' },
    ]);
    const h = await loadRunHistory('p1');
    expect(h.map((r) => r.runId)).toEqual(['r2', 'r3', 'r1']);
    expect(h.every((r) => r.projectId === 'p1')).toBe(true);
  });

  it('caps at HISTORY_LIMIT keeping the newest', async () => {
    const rows = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => ({ ...rec(`r${i}`, 'p1', i), id: `r${i}` }));
    await db.runs.bulkPut(rows);
    const h = await loadRunHistory('p1');
    expect(h).toHaveLength(HISTORY_LIMIT);
    expect(h[0].runId).toBe(`r${HISTORY_LIMIT + 4}`);
  });
});

describe('mergeHistories', () => {
  it('dedups by runId with session winning, excludes other projects, sorts newest-first', () => {
    const persisted = [rec('r1', 'p1', 100), rec('r2', 'p1', 200)];
    const session = [
      { ...rec('r2', 'p1', 200), status: 'failed' as const },
      rec('r3', 'p1', 300),
      rec('zz', 'p2', 400),
    ];
    const m = mergeHistories(session, persisted, 'p1');
    expect(m.map((r) => r.runId)).toEqual(['r3', 'r2', 'r1']);
    expect(m.find((r) => r.runId === 'r2')?.status).toBe('failed');
  });

  it('caps merged output at HISTORY_LIMIT', () => {
    const persisted = Array.from({ length: 15 }, (_, i) => rec(`p${i}`, 'p1', i));
    const session = Array.from({ length: 15 }, (_, i) => rec(`s${i}`, 'p1', 100 + i));
    expect(mergeHistories(session, persisted, 'p1')).toHaveLength(HISTORY_LIMIT);
  });
});
