// JSON workflow export/import: graph + links + timeline + metadata. No binaries
// (assets stay in the library); importing into a project with missing assets
// yields explicit missing-asset errors at validation/run time.

import { GraphDocSchema, GRAPH_SCHEMA_VERSION, TimelineDocSchema, type GraphDoc, type TimelineDoc } from '../types/graph';
import { migrateGraph } from '../graph/migration';
import { getNodeDef } from '../graph/registry';
import { APP_VERSION } from '../types/graph';
import { z } from 'zod';

const WorkflowFileSchema = z.object({
  kind: z.literal('infinite-creation-workflow'),
  appVersion: z.string(),
  exportedAt: z.number(),
  projectName: z.string().optional(),
  graph: z.unknown(),
  timeline: z.unknown().optional(),
});
export type WorkflowFile = z.infer<typeof WorkflowFileSchema>;

export function exportWorkflowJSON(projectName: string, graph: GraphDoc, timeline: TimelineDoc): string {
  const file: WorkflowFile = {
    kind: 'infinite-creation-workflow',
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    projectName,
    graph,
    timeline,
  };
  return JSON.stringify(file, null, 2);
}

export interface ImportedWorkflow {
  graph: GraphDoc;
  timeline: TimelineDoc | null;
  projectName?: string;
  warnings: string[];
}

export function importWorkflowJSON(text: string): ImportedWorkflow {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not valid JSON');
  }
  const parsed = WorkflowFileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Not an Infinite Creation workflow: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`);
  const file = parsed.data;
  const graph = migrateGraph(file.graph);
  if (graph.schemaVersion > GRAPH_SCHEMA_VERSION) {
    throw new Error(`Workflow schema v${graph.schemaVersion} is newer than this app (v${GRAPH_SCHEMA_VERSION}) — update the app to open it`);
  }
  const warnings: string[] = [];
  for (const n of graph.nodes) {
    if (!getNodeDef(n.type)) warnings.push(`Unknown node type "${n.type}" (node ${n.id}) — it will fail validation until removed`);
  }
  let timeline: TimelineDoc | null = null;
  if (file.timeline) {
    const t = TimelineDocSchema.safeParse(file.timeline);
    if (t.success) timeline = t.data;
    else warnings.push('Timeline section failed validation and was dropped (graph kept)');
  }
  return { graph, timeline, projectName: file.projectName, warnings };
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
