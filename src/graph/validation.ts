import type { GraphDoc, GraphEdge, GraphNode } from '../types/graph';
import { typesCompatible } from '../types/graph';
import { getNodeDef } from './registry';

export interface ValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
  severity: 'error' | 'warning';
}

export interface ConnectionCheck {
  ok: boolean;
  reason?: string;
}

export function canConnect(
  doc: GraphDoc,
  sourceNode: GraphNode,
  sourceHandle: string,
  targetNode: GraphNode,
  targetHandle: string,
): ConnectionCheck {
  if (sourceNode.id === targetNode.id) return { ok: false, reason: 'Cannot connect a node to itself' };
  const sDef = getNodeDef(sourceNode.type);
  const tDef = getNodeDef(targetNode.type);
  if (!sDef) return { ok: false, reason: `Unknown source node type "${sourceNode.type}"` };
  if (!tDef) return { ok: false, reason: `Unknown target node type "${targetNode.type}"` };
  const sPort = sDef.outputs.find((p) => p.id === sourceHandle);
  const tPort = tDef.inputs.find((p) => p.id === targetHandle);
  if (!sPort) return { ok: false, reason: `Unknown source port "${sourceHandle}"` };
  if (!tPort) return { ok: false, reason: `Unknown target port "${targetHandle}"` };
  if (!typesCompatible(sPort.dataType, tPort.dataType)) {
    return {
      ok: false,
      reason: `Type mismatch: ${sPort.dataType} → ${tPort.dataType}. No implicit conversion is applied.`,
    };
  }
  if (!tPort.multiple) {
    const existing = doc.edges.find((e) => e.target === targetNode.id && e.targetHandle === targetHandle);
    if (existing) return { ok: false, reason: `Input "${tPort.label}" already connected (single cardinality)` };
  }
  // Cycle check: would source become reachable from target?
  const adj = new Map<string, string[]>();
  for (const e of doc.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  // prospective edge
  if (!adj.has(sourceNode.id)) adj.set(sourceNode.id, []);
  adj.get(sourceNode.id)!.push(targetNode.id);
  // DFS from target to see if we reach source
  const stack = [targetNode.id];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === sourceNode.id) return { ok: false, reason: 'Connection would create a cycle' };
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const n of adj.get(cur) ?? []) stack.push(n);
  }
  return { ok: true };
}

/** Detect cycles; returns one cycle path if present. */
export function findCycle(doc: GraphDoc): string[] | null {
  const adj = new Map<string, string[]>();
  for (const n of doc.nodes) adj.set(n.id, []);
  for (const e of doc.edges) adj.get(e.source)?.push(e.target);
  const color = new Map<string, number>(); // 0=unvisited 1=in-stack 2=done
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    color.set(id, 1);
    path.push(id);
    for (const next of adj.get(id) ?? []) {
      const c = color.get(next) ?? 0;
      if (c === 1) {
        const idx = path.indexOf(next);
        return [...path.slice(idx), next];
      }
      if (c === 0) {
        const r = visit(next);
        if (r) return r;
      }
    }
    path.pop();
    color.set(id, 2);
    return null;
  };
  for (const n of doc.nodes) {
    if ((color.get(n.id) ?? 0) === 0) {
      const r = visit(n.id);
      if (r) return r;
    }
  }
  return null;
}

/** Kahn's topological order of node ids. Throws if a cycle exists. */
export function topoOrder(doc: GraphDoc): string[] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of doc.nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of doc.edges) {
    if (!indeg.has(e.source) || !indeg.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);
  queue.sort();
  const out: string[] = [];
  while (queue.length) {
    const cur = queue.shift()!;
    out.push(cur);
    const nexts = [...(adj.get(cur) ?? [])].sort();
    for (const nx of nexts) {
      indeg.set(nx, (indeg.get(nx) ?? 1) - 1);
      if (indeg.get(nx) === 0) queue.push(nx);
    }
    queue.sort();
  }
  if (out.length !== doc.nodes.length) throw new Error('Graph contains a cycle');
  return out;
}

export function validateGraph(doc: GraphDoc, assetExists?: (id: string) => boolean): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set(doc.nodes.map((n) => n.id));

  for (const e of doc.edges) {
    if (!nodeIds.has(e.source))
      issues.push({ code: 'edge-dangling-source', message: `Edge ${e.id} references missing source ${e.source}`, edgeId: e.id, severity: 'error' });
    if (!nodeIds.has(e.target))
      issues.push({ code: 'edge-dangling-target', message: `Edge ${e.id} references missing target ${e.target}`, edgeId: e.id, severity: 'error' });
  }

  for (const n of doc.nodes) {
    const def = getNodeDef(n.type);
    if (!def) {
      issues.push({ code: 'node-unknown-type', message: `Node ${n.id} has unknown type "${n.type}"`, nodeId: n.id, severity: 'error' });
      continue;
    }
    if (def.unavailable) {
      issues.push({ code: 'node-unavailable', message: `Node "${def.label}" (${n.id}) is unavailable: ${def.unavailableReason ?? 'not supported'}`, nodeId: n.id, severity: 'error' });
    }
    for (const inp of def.inputs) {
      const connected = doc.edges.filter((e) => e.target === n.id && e.targetHandle === inp.id);
      if (inp.required && connected.length === 0) {
        // assetRef-backed sources may carry their value in params; still require explicit check per node impl
        issues.push({ code: 'input-missing', message: `Node "${def.label}" (${n.id}) missing required input "${inp.label}"`, nodeId: n.id, severity: 'error' });
      }
      if (!inp.multiple && connected.length > 1) {
        issues.push({ code: 'input-cardinality', message: `Node "${def.label}" (${n.id}) input "${inp.label}" allows a single connection`, nodeId: n.id, severity: 'error' });
      }
      for (const e of connected) {
        const src = doc.nodes.find((x) => x.id === e.source);
        if (!src) continue;
        const sDef = getNodeDef(src.type);
        const sPort = sDef?.outputs.find((p) => p.id === e.sourceHandle);
        if (sPort && !typesCompatible(sPort.dataType, inp.dataType)) {
          issues.push({ code: 'type-mismatch', message: `Edge ${e.id}: ${sPort.dataType} → ${inp.dataType} is incompatible`, edgeId: e.id, severity: 'error' });
        }
      }
    }
    // param validation: numbers finite, within min/max when declared
    for (const p of def.params) {
      const v = (n.data.params as Record<string, unknown>)[p.key];
      if (v === undefined || v === null) {
        if (p.required) issues.push({ code: 'param-missing', message: `Node "${def.label}" (${n.id}) missing parameter "${p.label}"`, nodeId: n.id, severity: 'error' });
        continue;
      }
      if ((p.type === 'number' || p.type === 'slider') && typeof v === 'number') {
        if (!Number.isFinite(v))
          issues.push({ code: 'param-nonfinite', message: `Node "${def.label}" (${n.id}) parameter "${p.label}" must be finite`, nodeId: n.id, severity: 'error' });
        if (p.min !== undefined && v < p.min)
          issues.push({ code: 'param-range', message: `Node "${def.label}" (${n.id}) parameter "${p.label}" below minimum ${p.min}`, nodeId: n.id, severity: 'error' });
        if (p.max !== undefined && v > p.max)
          issues.push({ code: 'param-range', message: `Node "${def.label}" (${n.id}) parameter "${p.label}" above maximum ${p.max}`, nodeId: n.id, severity: 'error' });
      }
      if (p.type === 'assetRef' && typeof v === 'string' && v !== '' && assetExists && !assetExists(v)) {
        issues.push({ code: 'asset-missing', message: `Node "${def.label}" (${n.id}) references missing asset ${v}`, nodeId: n.id, severity: 'error' });
      }
    }
  }

  const cycle = findCycle(doc);
  if (cycle) {
    issues.push({ code: 'cycle', message: `Graph contains a cycle: ${cycle.join(' → ')}`, severity: 'error' });
  }
  return issues;
}

export function upstreamNodeIds(doc: GraphDoc, nodeId: string): string[] {
  const incoming = new Map<string, string[]>();
  for (const e of doc.edges) {
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e.source);
  }
  const out: string[] = [];
  const seen = new Set<string>([nodeId]);
  const stack = [...(incoming.get(nodeId) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    for (const s of incoming.get(cur) ?? []) stack.push(s);
  }
  return out;
}

export function downstreamNodeIds(doc: GraphDoc, nodeId: string): string[] {
  const outgoing = new Map<string, string[]>();
  for (const e of doc.edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e.target);
  }
  const out: string[] = [];
  const seen = new Set<string>([nodeId]);
  const stack = [...(outgoing.get(nodeId) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    for (const s of outgoing.get(cur) ?? []) stack.push(s);
  }
  return out;
}

export function explainConnection(
  sourceType: string, sourceHandle: string, targetType: string, targetHandle: string,
): string {
  const sDef = getNodeDef(sourceType);
  const tDef = getNodeDef(targetType);
  if (!sDef || !tDef) return 'Unknown node type.';
  const s = sDef.outputs.find((p) => p.id === sourceHandle);
  const t = tDef.inputs.find((p) => p.id === targetHandle);
  if (!s || !t) return 'Unknown port.';
  if (typesCompatible(s.dataType, t.dataType)) return `Compatible: ${s.dataType} → ${t.dataType}.`;
  return `Incompatible: ${s.dataType} cannot feed ${t.dataType} ("${t.label}"). No implicit converters — insert an explicit conversion node.`;
}

export type { GraphEdge };
