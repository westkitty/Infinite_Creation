import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../assets/db';

vi.mock('../persistence/projectService', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../persistence/projectService')>();
  return { ...orig, saveProject: vi.fn() };
});

const { saveProject } = await import('../persistence/projectService');
const { loadSampleProject } = await import('./loader');

beforeEach(async () => {
  await db.projects.clear();
  vi.mocked(saveProject).mockReset();
});

describe('loadSampleProject', () => {
  it('removes the created project when the save fails (no orphan row)', async () => {
    vi.mocked(saveProject).mockRejectedValueOnce(new Error('simulated quota failure'));
    await expect(loadSampleProject('A')).rejects.toThrow('simulated quota failure');
    expect(await db.projects.toArray()).toHaveLength(0);
  });

  it('keeps the project on the happy path', async () => {
    vi.mocked(saveProject).mockResolvedValueOnce(undefined);
    const out = await loadSampleProject('B');
    expect(out.projectId).toMatch(/^p/);
    const row = await db.projects.get(out.projectId);
    expect(row?.name).toMatch(/^Sample /);
  });
});
