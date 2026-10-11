// Execution scheduler: validates, topologically orders, and runs the graph with
// bounded concurrency, deterministic caching, cooperative cancellation, error
// propagation, retry, and run history. Single-flight: only one run at a time.

import type { GraphDoc, GraphNode, NodeRunRecord, ParamLink, RunRecord, TimelineDoc } from '../types/graph';
import { getNodeDef } from '../graph/registry';
import { topoOrder, validateGraph, downstreamNodeIds } from '../graph/validation';
import { EXECUTORS, describeValue, type ExecContext, type ExecValue } from './executors';
import { hashValue, nodeCacheKey, resultCache } from './cache';
import { hashPixels, type ImageValue } from '../media/pixel';
import { db } from '../assets/db';
import { loadImageAssetCached, storeDerivedAsset } from '../assets/repository';
import { uid, stableStringify, shortHash } from '../lib/ids';
import { expandSubgraphNodes } from '../subgraphs/library';
import { useExecStore, type NodeOutput } from '../stores/execStore';

const MAX_NODE_CONCURRENCY = 3;

// Latest decoded pixels per node (module-level; too heavy for zustand).
const outputImages = new Map<string, { image: ImageValue; at: number }>();
const outputArtifacts = new Map<string, { bytes: Uint8Array; mime: string; filename: string; width?: number; height?: number; assetId?: string }>();

export function getOutputImage(nodeId: string): ImageValue | null {
  return outputImages.get(nodeId)?.image ?? null;
}
export function getOutputArtifact(nodeId: string): { bytes: Uint8Array; mime: string; filename: string; width?: number; height?: number; assetId?: string } | null {
  return outputArtifacts.get(nodeId) ?? null;
}
export function clearOutputs(nodeIds?: string[]): void {
  if (!nodeIds) { outputImages.clear(); outputArtifacts.clear(); return; }
  for (const id of nodeIds) { outputImages.delete(id); outputArtifacts.delete(id); }
}

let currentRun: { runId: string; controller: AbortController } | null = null;
export function isRunning(): boolean { return currentRun !== null; }
export function cancelRun(): void { currentRun?.controller.abort(); }

export interface RunOptions {
  projectId: string;
  doc: GraphDoc;
  timeline: TimelineDoc;
  /** Restrict run to these nodes + their upstream deps. Default: all nodes. */
  onlyNodeIds?: string[];
  captureSnapshot?: () => Promise<ImageValue | null>;
}

export async function executeGraph(opts: RunOptions): Promise<RunRecord> {
  const exec = useExecStore.getState();
  if (currentRun) throw new Error('A run is already in progress — cancel it first');
  const runId = uid('run');
  const controller = new AbortController();
  currentRun = { runId, controller };
  const { signal } = controller;
  const t0 = Date.now();

  exec.setRunning(true, runId);
  // ---- subgraph expansion (inline, same engine) ----
  const expanded = await expandSubgraphNodes(opts.doc);
  const doc: GraphDoc = expanded.doc;
  const expansionErrors = expanded.errors;

  exec.setProgress(0, doc.nodes.length);
  exec.log(`Run ${runId} started (${doc.nodes.length} nodes${expanded.doc !== opts.doc ? ' — subgraph placeholders expanded' : ''})`);

  const nodeRuns: Record<string, NodeRunRecord> = {};
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const setStatus = (id: string, s: NodeRunRecord['status']) => {
    exec.setNodeStatus(id, s);
    nodeRuns[id] = { ...(nodeRuns[id] ?? { nodeId: id, status: s }), nodeId: id, status: s };
    exec.setNodeRun(id, nodeRuns[id]);
  };

  const finish = async (status: RunRecord['status'], error?: string): Promise<RunRecord> => {
    const record: RunRecord = { runId, projectId: opts.projectId, startedAt: t0, finishedAt: Date.now(), status, nodeRuns, error };
    exec.addRun(record);
    exec.setRunning(false, null);
    if (currentRun?.runId === runId) currentRun = null;
    try {
      await db.runs.put({ ...record, id: runId });
      const old = await db.runs.where('projectId').equals(opts.projectId).sortBy('startedAt');
      if (old.length > 20) await db.runs.bulkDelete(old.slice(0, old.length - 20).map((r) => r.id));
    } catch { /* history is best-effort */ }
    exec.log(`Run ${runId} ${status} in ${Date.now() - t0} ms${error ? `: ${error}` : ''}`);
    return record;
  };

  if (expansionErrors.size > 0) {
    for (const n of doc.nodes) setStatus(n.id, 'blocked');
    for (const [id, msg] of expansionErrors) {
      if (byId.has(id)) {
        setStatus(id, 'failed');
        nodeRuns[id].error = msg;
        exec.setNodeRun(id, nodeRuns[id]);
        publishOutput(byId.get(id)!, null, runId, false, msg);
      }
    }
    const first = [...expansionErrors.values()][0];
    return finish('failed', `Subgraph expansion failed: ${first}`);
  }

  // ---- validation ----
  const issues = validateGraph(doc);
  const errors = issues.filter((i) => i.severity === 'error');
  // Missing-asset detection uses live store state.
  if (errors.length > 0) {
    for (const n of doc.nodes) setStatus(n.id, 'blocked');
    return finish('failed', `${errors.length} validation error(s): ${errors[0].message}`);
  }
  let order: string[];
  try {
    order = topoOrder(doc);
  } catch {
    return finish('failed', 'Graph contains a cycle');
  }
  let target = new Set(order);
  if (opts.onlyNodeIds?.length) {
    const keep = new Set<string>();
    const incoming = new Map<string, string[]>();
    for (const e of doc.edges) {
      if (!incoming.has(e.target)) incoming.set(e.target, []);
      incoming.get(e.target)!.push(e.source);
    }
    const stack = [...opts.onlyNodeIds];
    while (stack.length) {
      const cur = stack.pop()!;
      if (keep.has(cur)) continue;
      keep.add(cur);
      for (const s of incoming.get(cur) ?? []) stack.push(s);
    }
    target = keep;
  }
  order = order.filter((id) => target.has(id));

  for (const id of order) setStatus(id, 'queued');

  const ctx: ExecContext = {
    projectId: opts.projectId,
    runId,
    signal,
    loadImageAsset: (assetId) => loadImageAssetCached(assetId, signal),
    getAssetMeta: async (assetId) => {
      const row = await db.assets.get(assetId);
      return row ? { kind: row.kind, mime: row.mime, name: row.name, width: row.width, height: row.height } : null;
    },
    getTimeline: () => opts.timeline,
    captureSnapshot: opts.captureSnapshot,
  };

  // Upstream outputs available to each node (fresh or cached).
  const values = new Map<string, Record<string, ExecValue>>();
  // Preload cache hits' values for nodes outside target? No — only target runs.

  const edgesByTarget = new Map<string, typeof doc.edges>();
  for (const e of doc.edges) {
    if (!edgesByTarget.has(e.target)) edgesByTarget.set(e.target, []);
    edgesByTarget.get(e.target)!.push(e);
  }

  let done = 0;
  let failed = false;
  let cancelRequested = false;

  const runNode = async (node: GraphNode): Promise<void> => {
    if (signal.aborted) { setStatus(node.id, 'cancelled'); return; }
    if (failed) { setStatus(node.id, 'blocked'); return; }
    const def = getNodeDef(node.type);
    if (!def) { setStatus(node.id, 'failed'); nodeRuns[node.id].error = `Unknown node type ${node.type}`; failed = true; return; }
    if (def.unavailable) { setStatus(node.id, 'failed'); nodeRuns[node.id].error = def.unavailableReason ?? 'unavailable'; failed = true; return; }

    // Gather inputs (port -> values in edge order).
    const inputs: Record<string, ExecValue[]> = {};
    const inputHashes: Record<string, string[]> = {};
    for (const e of edgesByTarget.get(node.id) ?? []) {
      const srcVals = values.get(e.source);
      if (!srcVals || !srcVals[e.sourceHandle]) {
        setStatus(node.id, 'blocked');
        nodeRuns[node.id].error = `Upstream ${e.source} produced no "${e.sourceHandle}"`;
        return;
      }
      (inputs[e.targetHandle] ??= []).push(srcVals[e.sourceHandle]);
    }
    for (const [port, vals] of Object.entries(inputs)) inputHashes[port] = vals.map(hashValue);

    // Disabled nodes: forward first image input when unambiguous, else block.
    if (node.data.disabled) {
      const fwd = Object.values(inputs).flat().find((v) => v.kind === 'image');
      if (fwd && def.outputs.length === 1) {
        values.set(node.id, { [def.outputs[0].id]: fwd });
        setStatus(node.id, 'completed');
        nodeRuns[node.id].cacheHit = false;
        nodeRuns[node.id].outputHash = hashValue(fwd);
        publishOutput(node, values.get(node.id)!, runId, false);
        return;
      }
      setStatus(node.id, 'blocked');
      nodeRuns[node.id].error = 'Node disabled (no single image input to forward)';
      return;
    }

    const { params: effectiveParams, applied: appliedLinks } = resolveLinkedParams(doc, node);
    if (appliedLinks.length) exec.log(`Node ${node.id}: ${appliedLinks.length} linked param(s) applied`);
    const key = nodeCacheKey({ nodeType: node.type, nodeVersion: def.version, params: effectiveParams, inputHashes });
    const hit = resultCache.get(node.id, key);
    if (hit) {
      values.set(node.id, hit);
      setStatus(node.id, 'completed');
      nodeRuns[node.id].cacheHit = true;
      nodeRuns[node.id].outputHash = shortHash(stableStringify(Object.values(hit).map(hashValue)));
      exec.bumpCache('hits');
      publishOutput(node, hit, runId, false);
      return;
    }
    exec.bumpCache('misses');

    setStatus(node.id, 'running');
    const start = performance.now();
    try {
      const executor = EXECUTORS[node.type];
      if (!executor) throw new Error(`No executor for node type "${node.type}"`);
      const out = await executor(ctx, inputs, effectiveParams);
      if (signal.aborted || currentRun?.runId !== runId) {
        setStatus(node.id, 'cancelled'); // stale completion — never publish
        return;
      }
      const dur = performance.now() - start;
      resultCache.set(node.id, key, out);
      values.set(node.id, out);
      setStatus(node.id, 'completed');
      nodeRuns[node.id].durationMs = dur;
      nodeRuns[node.id].cacheHit = false;
      nodeRuns[node.id].startedAt = t0;
      nodeRuns[node.id].finishedAt = Date.now();
      const hashes = Object.values(out).map(hashValue);
      nodeRuns[node.id].outputHash = shortHash(stableStringify(hashes));
      exec.setNodeRun(node.id, nodeRuns[node.id]);
      await persistOutputs(ctx, { ...node, data: { ...node.data, params: effectiveParams } }, def.version, out, inputHashes);
      publishOutput(node, out, runId, false);
    } catch (e) {
      const aborted = signal.aborted || (e instanceof DOMException && e.name === 'AbortError');
      if (aborted) {
        setStatus(node.id, 'cancelled');
        cancelRequested = true;
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(node.id, 'failed');
      nodeRuns[node.id].error = msg;
      nodeRuns[node.id].durationMs = performance.now() - start;
      exec.setNodeRun(node.id, nodeRuns[node.id]);
      exec.log(`Node ${node.id} (${node.type}) failed: ${msg}`);
      failed = true;
      publishOutput(node, null, runId, false, msg);
    }
  };

  // Level-by-level execution with bounded concurrency.
  const depth = new Map<string, number>();
  for (const id of order) {
    let d = 0;
    for (const e of doc.edges) if (e.target === id) d = Math.max(d, (depth.get(e.source) ?? 0) + 1);
    depth.set(id, d);
  }
  const levels = new Map<number, GraphNode[]>();
  for (const id of order) {
    const n = byId.get(id)!;
    const d = depth.get(id) ?? 0;
    if (!levels.has(d)) levels.set(d, []);
    levels.get(d)!.push(n);
  }
  const sortedLevels = [...levels.entries()].sort((a, b) => a[0] - b[0]);

  try {
    for (const [, nodes] of sortedLevels) {
      if (signal.aborted) { cancelRequested = true; break; }
      // bounded concurrency within a level
      for (let k = 0; k < nodes.length; k += MAX_NODE_CONCURRENCY) {
        if (signal.aborted) { cancelRequested = true; break; }
        const batch = nodes.slice(k, k + MAX_NODE_CONCURRENCY);
        await Promise.all(batch.map((n) => runNode(n)));
        done += batch.length;
        exec.setProgress(Math.min(done, order.length), order.length);
        if (failed) break;
      }
      if (failed) break;
    }
  } catch (e) {
    return finish('failed', e instanceof Error ? e.message : String(e));
  }

  if (signal.aborted || cancelRequested) {
    for (const id of order) {
      const s = nodeRuns[id]?.status;
      if (s === 'queued' || s === 'running') setStatus(id, 'cancelled');
    }
    return finish('cancelled', 'Cancelled by user');
  }
  if (failed) {
    for (const id of order) {
      if (nodeRuns[id]?.status === 'queued') setStatus(id, 'blocked');
    }
    const firstErr = Object.values(nodeRuns).find((r) => r.status === 'failed')?.error ?? 'Node failure';
    return finish('failed', firstErr);
  }
  return finish('completed');
}

function publishOutput(node: GraphNode, out: Record<string, ExecValue> | null, runId: string, stale: boolean, error?: string): void {
  if (currentRun?.runId !== runId) return; // reject obsolete completions
  const exec = useExecStore.getState();
  if (!out) {
    exec.setOutput(node.id, { nodeId: node.id, kind: 'none', stale: false, error, updatedAt: Date.now() });
    return;
  }
  const first = Object.values(out)[0];
  if (!first) {
    exec.setOutput(node.id, { nodeId: node.id, kind: 'none', stale, updatedAt: Date.now() });
    return;
  }
  if (first.kind === 'image') {
    outputImages.set(node.id, { image: first.image, at: Date.now() });
    exec.setOutput(node.id, {
      nodeId: node.id, kind: 'image', width: first.image.width, height: first.image.height,
      hash: hashPixels(first.image), stale, updatedAt: Date.now(),
    } satisfies NodeOutput);
  } else if (first.kind === 'artifact') {
    outputArtifacts.set(node.id, { bytes: first.bytes, mime: first.mime, filename: first.filename, width: first.width, height: first.height });
    exec.setOutput(node.id, {
      nodeId: node.id, kind: 'artifact', width: first.width, height: first.height, mime: first.mime,
      bytes: first.bytes.length, stale, updatedAt: Date.now(),
    } satisfies NodeOutput);
  } else {
    exec.setOutput(node.id, { nodeId: node.id, kind: 'value', stale, updatedAt: Date.now() });
  }
  void describeValue;
}

async function persistOutputs(
  ctx: ExecContext, node: GraphNode, nodeVersion: number,
  out: Record<string, ExecValue>, inputHashes: Record<string, string[]>,
): Promise<void> {
  // Export artifacts are durable: stored as assets with full provenance.
  for (const [port, v] of Object.entries(out)) {
    if (v.kind !== 'artifact') continue;
    try {
      const asset = await storeDerivedAsset(ctx.projectId, v.filename, v.mime, v.bytes, {
        kind: 'artifact', width: v.width, height: v.height,
        provenance: {
          parentIds: [], nodeId: node.id, nodeType: node.type, nodeVersion,
          inputHashes: Object.values(inputHashes).flat(),
          params: (node.data.params as Record<string, unknown>) ?? {},
          runId: ctx.runId, outputFormat: v.mime,
        },
      });
      const art = outputArtifacts.get(node.id);
      if (art) art.assetId = asset.id;
      // Notify library (dynamic import avoids store cycle at module load).
      const { useAssetStore } = await import('../stores/assetStore');
      useAssetStore.getState().upsert(asset);
    } catch (e) {
      const { useExecStore } = await import('../stores/execStore');
      useExecStore.getState().log(`Artifact persistence failed for ${node.id}/${port}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** Resolve one-level parameter links: target params are overridden by the
 *  source node's own raw param values (type-checked). One level keeps the
 *  semantics predictable and cycle-free. */
export function resolveLinkedParams(
  doc: Pick<GraphDoc, 'nodes' | 'links'>,
  node: GraphNode,
): { params: Record<string, unknown>; applied: ParamLink[] } {
  const params: Record<string, unknown> = { ...((node.data.params as Record<string, unknown>) ?? {}) };
  const applied: ParamLink[] = [];
  const links = (doc as GraphDoc).links ?? [];
  const def = getNodeDef(node.type);
  for (const link of links) {
    if (link.targetNodeId !== node.id) continue;
    const targetDef = def?.params.find((p) => p.key === link.targetKey);
    if (!targetDef || (targetDef.type !== 'number' && targetDef.type !== 'slider' && targetDef.type !== 'color')) continue;
    const src = doc.nodes.find((n) => n.id === link.sourceNodeId);
    if (!src) continue;
    const srcDef = getNodeDef(src.type);
    const srcParamDef = srcDef?.params.find((p) => p.key === link.sourceKey);
    if (!srcParamDef) continue;
    const srcIsNum = srcParamDef.type === 'number' || srcParamDef.type === 'slider';
    const tgtIsNum = targetDef.type === 'number' || targetDef.type === 'slider';
    if (srcIsNum !== tgtIsNum) continue; // incompatible kinds never drive each other
    const raw = (src.data.params as Record<string, unknown>)[link.sourceKey] ?? srcParamDef.default;
    if (tgtIsNum && typeof raw !== 'number') continue;
    if (!tgtIsNum && typeof raw !== 'string') continue;
    params[link.targetKey] = raw;
    applied.push(link);
  }
  return { params, applied };
}

/** Retry failed/blocked nodes (and only those plus downstream) in a fresh run. */
export async function retryFailedNodes(opts: RunOptions): Promise<RunRecord | null> {
  const exec = useExecStore.getState();
  const failedIds = Object.values(exec.nodeRuns).filter((r) => r.status === 'failed' || r.status === 'blocked').map((r) => r.nodeId);
  if (failedIds.length === 0) return null;
  // Invalidate failed nodes so they recompute.
  for (const id of failedIds) resultCache.invalidate(id);
  return executeGraph(opts);
}

/** Invalidate cache for a node and everything downstream of it. */
export function invalidateNodeAndDownstream(doc: GraphDoc, nodeId: string): string[] {
  const affected = [nodeId, ...downstreamNodeIds(doc, nodeId)];
  for (const id of affected) resultCache.invalidate(id);
  useExecStore.getState().markStaleDownstream(affected);
  return affected;
}

export function cacheInspector(): Array<{ nodeId: string; key: string; bytes: number; ageMs: number }> {
  return resultCache.inspect();
}
