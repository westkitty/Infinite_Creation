import { createProject, deleteProject, saveProject } from '../persistence/projectService';
import { buildSample } from './builders';

export async function loadSampleProject(id: 'A' | 'B' | 'C'): Promise<{ projectId: string; name: string; description: string }> {
  const sample = buildSample(id);
  const meta = await createProject(`Sample ${sample.name}`);
  try {
    await saveProject(meta.id, meta.name, sample.graph, sample.timeline);
  } catch (e) {
    // Don't leave a junk empty project behind when the save fails.
    try {
      await deleteProject(meta.id);
    } catch { /* cleanup is best-effort; the original error matters */ }
    throw e;
  }
  return { projectId: meta.id, name: sample.name, description: sample.description };
}
