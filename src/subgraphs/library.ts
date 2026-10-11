// Reusable subgraphs: save a working selection as a named definition, insert it
// as ordinary nodes (same engine), or reference single-input/single-output
// definitions from a util.subgraph node (expanded inline by the scheduler).

import { db, type SubgraphRow } from '../assets/db';
import type { GraphDoc } from '../types/graph';
import { getNodeDef } from '../graph/registry';
import { uid } from '../lib/ids';

export interface BoundaryPort {
  nodeId: string;
  portId: string;
  name: string;
}

export interface SaveAnalysis {
  nodeIds: string[];
  internalEdges: GraphDoc['edges'];
  publicInputs: BoundaryPort[];
  publicOutputs: BoundaryPort[];
  problems: string[];
}

export function analyzeSelection(doc: Pick<GraphDoc, 'nodes' | 'edges'>, selectedIds: string[]): SaveAnalysis {
  const sel = new Set(selectedIds);
  const nodes = doc.nodes.filter((n) => sel.has(n.id));
  const internalEdges = doc.edges.filter((e) => sel.has(e.source) && sel.has(e.target));
  const problems: string[] = [];
  if (nodes.length === 0) problems.push('Select at least one node.');
  for (const n of nodes) {
    const def = getNodeDef(n.type);
    if (!def) problems.push(`Unknown node type "${n.type}".`);
    if (n.type === 'util.subgraph') problems.push('Nested subgraph nodes are not allowed (no recursion).');
    if (def?.unavailable) problems.push(`"${def.label}" is unavailable and cannot be saved into a reusable definition.`);
  }
  const fedByInternal = new Set(internalEdges.map((e) => `${e.target}:${e.targetHandle}`));
  const fedAtAll = new Set(doc.edges.map((e) => `${e.target}:${e.targetHandle}`));
  const sourcedInternal = new Set(internalEdges.map((e) => `${e.source}:${e.sourceHandle}`));

  const publicInputs: BoundaryPort[] = [];
  const publicOutputs: BoundaryPort[] = [];
  for (const n of nodes) {
    const def = getNodeDef(n.type);
    if (!def) continue;
    const label = n.data.label || def.label;
    for (const inp of def.inputs) {
      if (!fedByInternal.has(`${n.id}:${inp.id}`)) {
        publicInputs.push({ nodeId: n.id, portId: inp.id, name: `${label}.${inp.label}` });
      }
      void fedAtAll;
    }
    for (const out of def.outputs) {
      if (!sourcedInternal.has(`${n.id}:${out.id}`)) {
        publicOutputs.push({ nodeId: n.id, portId: out.id, name: `${label}.${out.label}` });
      }
    }
  }
  return { nodeIds: nodes.map((n) => n.id), internalEdges, publicInputs, publicOutputs, problems };
}

export async function saveSubgraph(
  name: string, description: string | undefined,
  doc: Pick<GraphDoc, 'nodes' | 'edges'>, analysis: SaveAnalysis,
): Promise<SubgraphRow> {
  if (analysis.problems.length) throw new Error(analysis.problems[0]);
  const now = Date.now();
  // Normalize positions relative to selection bbox so inserts land tidily.
  const nodes = doc.nodes.filter((n) => analysis.nodeIds.includes(n.id));
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const row: SubgraphRow = {
    id: uid('sg'),
    name: name.trim() || 'Untitled subgraph',
    description,
    version: 1,
    createdAt: now,
    updatedAt: now,
    graph: {
      schemaVersion: 4,
      nodes: JSON.parse(JSON.stringify(nodes.map((n) => ({ ...n, position: { x: n.position.x - minX, y: n.position.y - minY } })))),
      edges: JSON.parse(JSON.stringify(analysis.internalEdges)),
      links: [],
    },
    publicInputs: analysis.publicInputs,
    publicOutputs: analysis.publicOutputs,
  };
  await db.subgraphs.put(row);
  return row;
}

export async function listSubgraphs(): Promise<SubgraphRow[]> {
  return db.subgraphs.orderBy('updatedAt').reverse().toArray();
}

export async function getSubgraph(id: string): Promise<SubgraphRow | undefined> {
  return db.subgraphs.get(id);
}

export async function deleteSubgraph(id: string): Promise<void> {
  await db.subgraphs.delete(id);
}

/** Clone a definition's nodes/edges with fresh ids at an offset position. */
export function instantiateSubgraph(
  def: SubgraphRow, at: { x: number; y: number },
): { nodes: GraphDoc['nodes']; edges: GraphDoc['edges'] } {
  const idMap = new Map<string, string>();
  for (const n of def.graph.nodes) idMap.set(n.id, uid('n'));
  const nodes = def.graph.nodes.map((n) => ({
    ...JSON.parse(JSON.stringify(n)) as GraphDoc['nodes'][number],
    id: idMap.get(n.id)!,
    position: { x: Math.round(at.x + n.position.x), y: Math.round(at.y + n.position.y) },
  }));
  const edges = def.graph.edges.map((e) => ({
    ...JSON.parse(JSON.stringify(e)) as GraphDoc['edges'][number],
    id: uid('e'),
    source: idMap.get(e.source)!,
    target: idMap.get(e.target)!,
  }));
  return { nodes, edges };
}

/**
 * Expand util.subgraph placeholder nodes inline. Only single-input /
 * single-output definitions are eligible; anything else (or a missing
 * definition, or nesting) yields a per-node error instead of silent magic.
 */
export async function expandSubgraphNodes(
  doc: GraphDoc,
): Promise<{ doc: GraphDoc; errors: Map<string, string> }> {
  const errors = new Map<string, string>();
  const placeholders = doc.nodes.filter((n) => n.type === 'util.subgraph');
  if (placeholders.length === 0) return { doc, errors };
  let nodes = [...doc.nodes];
  let edges = [...doc.edges];
  for (const ph of placeholders) {
    const sgId = String((ph.data.params as Record<string, unknown>)?.subgraphId ?? '');
    if (!sgId) {
      errors.set(ph.id, 'No subgraph definition selected (set Subgraph ID)');
      continue;
    }
    const def = await getSubgraph(sgId).catch(() => undefined);
    if (!def) {
      errors.set(ph.id, `Subgraph definition ${sgId} not found in the local library`);
      continue;
    }
    if (def.graph.nodes.some((n) => n.type === 'util.subgraph')) {
      errors.set(ph.id, `Definition "${def.name}" contains a nested subgraph (recursion forbidden)`);
      continue;
    }
    if (def.publicInputs.length !== 1 || def.publicOutputs.length !== 1) {
      errors.set(
        ph.id,
        `Definition "${def.name}" has ${def.publicInputs.length} inputs / ${def.publicOutputs.length} outputs — inline nodes require exactly 1 input and 1 output (insert it as a copy instead)`,
      );
      continue;
    }
    const { nodes: fresh, edges: freshEdges } = instantiateSubgraph(def, ph.position);
    // map old def ids -> fresh node ids via position-independent order
    const idMap = new Map<string, string>();
    def.graph.nodes.forEach((n, k) => idMap.set(n.id, fresh[k].id));
    const inNode = idMap.get(def.publicInputs[0].nodeId)!;
    const inPort = def.publicInputs[0].portId;
    const outNode = idMap.get(def.publicOutputs[0].nodeId)!;
    const outPort = def.publicOutputs[0].portId;

    // Rewire external edges.
    const newEdges: GraphDoc['edges'] = [];
    for (const e of edges) {
      if (e.target === ph.id) {
        newEdges.push({ ...e, id: uid('e'), target: inNode, targetHandle: inPort });
      } else if (e.source === ph.id) {
        newEdges.push({ ...e, id: uid('e'), source: outNode, sourceHandle: outPort });
      } else {
        newEdges.push(e);
      }
    }
    edges = [...newEdges, ...freshEdges];
    nodes = [...nodes.filter((n) => n.id !== ph.id), ...fresh];
  }
  return { doc: { ...doc, nodes, edges }, errors };
}
