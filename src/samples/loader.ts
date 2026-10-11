import { createProject, saveProject } from '../persistence/projectService';
import { buildSample } from './builders';

export async function loadSampleProject(id: 'A' | 'B' | 'C'): Promise<{ projectId: string; name: string; description: string }> {
  const sample = buildSample(id);
  const meta = await createProject(`Sample ${sample.name}`);
  await saveProject(meta.id, meta.name, sample.graph, sample.timeline);
  return { projectId: meta.id, name: sample.name, description: sample.description };
}
