import { create } from 'zustand';
import type { ExecStatus, NodeRunRecord, RunRecord } from '../types/graph';

export interface NodeOutput {
  nodeId: string;
  kind: 'image' | 'artifact' | 'value' | 'none' | 'unsupported';
  assetId?: string;
  width?: number;
  height?: number;
  mime?: string;
  bytes?: number;
  hash?: string;
  stale: boolean;
  error?: string;
  updatedAt: number;
}

interface ExecState {
  runId: string | null;
  running: boolean;
  progress: { done: number; total: number };
  nodeStatus: Record<string, ExecStatus>;
  nodeRuns: Record<string, NodeRunRecord>;
  outputs: Record<string, NodeOutput>;
  runs: RunRecord[];
  history: RunRecord[];
  diagnostics: string[];
  cacheStats: { hits: number; misses: number; evictions: number };
  setRunning: (running: boolean, runId?: string | null) => void;
  setProgress: (done: number, total: number) => void;
  setNodeStatus: (nodeId: string, status: ExecStatus) => void;
  setNodeRun: (nodeId: string, run: NodeRunRecord) => void;
  setOutput: (nodeId: string, out: NodeOutput) => void;
  markStaleDownstream: (nodeIds: string[]) => void;
  addRun: (run: RunRecord) => void;
  setHistory: (runs: RunRecord[]) => void;
  log: (msg: string) => void;
  clearLogs: () => void;
  bumpCache: (kind: 'hits' | 'misses' | 'evictions') => void;
  resetRun: () => void;
  forgetNodes: (ids: string[]) => void;
}

export const useExecStore = create<ExecState>((set) => ({
  runId: null,
  running: false,
  progress: { done: 0, total: 0 },
  nodeStatus: {},
  nodeRuns: {},
  outputs: {},
  runs: [],
  history: [],
  diagnostics: [],
  cacheStats: { hits: 0, misses: 0, evictions: 0 },
  setRunning: (running, runId = null) => set({ running, runId }),
  setProgress: (done, total) => set({ progress: { done, total } }),
  setNodeStatus: (nodeId, status) => set((s) => ({ nodeStatus: { ...s.nodeStatus, [nodeId]: status } })),
  setNodeRun: (nodeId, run) => set((s) => ({ nodeRuns: { ...s.nodeRuns, [nodeId]: run } })),
  setOutput: (nodeId, out) => set((s) => ({ outputs: { ...s.outputs, [nodeId]: out } })),
  markStaleDownstream: (nodeIds) =>
    set((s) => {
      const outputs = { ...s.outputs };
      const nodeStatus = { ...s.nodeStatus };
      for (const id of nodeIds) {
        if (outputs[id]) outputs[id] = { ...outputs[id], stale: true };
        if (nodeStatus[id] === 'completed') nodeStatus[id] = 'stale';
      }
      return { outputs, nodeStatus };
    }),
  addRun: (run) => set((s) => ({ runs: [run, ...s.runs].slice(0, 20) })),
  setHistory: (history) => set({ history }),
  log: (msg) => set((s) => ({ diagnostics: [...s.diagnostics.slice(-499), `[${new Date().toISOString()}] ${msg}`] })),
  clearLogs: () => set({ diagnostics: [] }),
  bumpCache: (kind) => set((s) => ({ cacheStats: { ...s.cacheStats, [kind]: s.cacheStats[kind] + 1 } })),
  resetRun: () => set({ running: false, runId: null, progress: { done: 0, total: 0 } }),
  forgetNodes: (ids) =>
    set((s) => {
      const drop = new Set(ids);
      const pick = <T,>(obj: Record<string, T>): Record<string, T> =>
        Object.fromEntries(Object.entries(obj).filter(([k]) => !drop.has(k)));
      return {
        nodeStatus: pick(s.nodeStatus),
        nodeRuns: pick(s.nodeRuns),
        outputs: pick(s.outputs),
      };
    }),
}));
