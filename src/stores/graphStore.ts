import { create } from 'zustand';
import { GRAPH_SCHEMA_VERSION, type GraphDoc, type GraphEdge, type GraphNode, type ParamLink, type TimelineDoc, type Viewport } from '../types/graph';
import { emptyGraph } from '../graph/migration';
import { defaultParams, getNodeDef } from '../graph/registry';
import { canConnect, downstreamNodeIds } from '../graph/validation';
import { uid } from '../lib/ids';
import { useExecStore } from './execStore';
import { resultCache } from '../engine/cache';

/** Mark a node and all downstream nodes stale (params/structure changed). */
function touch(doc: { nodes: GraphNode[]; edges: GraphEdge[] }, nodeId: string): void {
  try {
    const affected = [nodeId, ...downstreamNodeIds({ nodes: doc.nodes, edges: doc.edges }, nodeId)];
    for (const id of affected) resultCache.invalidate(id);
    useExecStore.getState().markStaleDownstream(affected);
  } catch {
    /* staleness is best-effort UI state */
  }
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  links: ParamLink[];
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

interface GraphState {
  projectId: string | null;
  projectName: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  links: ParamLink[];
  viewport: Viewport;
  selectedNodeIds: string[];
  timeline: TimelineDoc;
  dirty: boolean;
  past: GraphSnapshot[];
  future: GraphSnapshot[];
  lastConnectError: string | null;

  loadProject: (projectId: string, name: string, graph: GraphDoc, timeline: TimelineDoc) => void;
  setViewport: (v: Viewport) => void;
  addNode: (type: string, position: { x: number; y: number }, params?: Record<string, unknown>) => GraphNode | null;
  updateNodeParams: (id: string, params: Record<string, unknown>) => void;
  updateNodeData: (id: string, data: Partial<GraphNode['data']>) => void;
  moveNodes: (moves: Array<{ id: string; x: number; y: number }>) => void;
  removeNodes: (ids: string[]) => void;
  duplicateNodes: (ids: string[]) => void;
  addEdge: (source: string, sourceHandle: string, target: string, targetHandle: string) => string | null;
  removeEdges: (ids: string[]) => void;
  setSelected: (ids: string[]) => void;
  setTimeline: (t: TimelineDoc) => void;
  addLink: (sourceNodeId: string, sourceKey: string, targetNodeId: string, targetKey: string) => string | null;
  removeLink: (id: string) => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
  markClean: () => void;
  getDoc: () => GraphDoc;
  clearConnectError: () => void;
}

const HISTORY_LIMIT = 100;
const COALESCE_WINDOW_MS = 800;

// Coalescing: rapid successive micro-edits to the same target (typing a
// label, dragging a slider) share one undo entry instead of flooding the
// stack with a deep clone per keystroke. Structural edits always push.
let lastPush = { at: 0, key: '' };

function resetCoalescing(): void {
  lastPush = { at: 0, key: '' };
}

function pushHistory(s: GraphState, coalesceKey?: string): Partial<GraphState> {
  const now = Date.now();
  if (coalesceKey && coalesceKey === lastPush.key && now - lastPush.at < COALESCE_WINDOW_MS) {
    return { future: [] }; // merge into the pending entry; redo still dies
  }
  lastPush = { at: now, key: coalesceKey ?? '' };
  const past = [...s.past, { nodes: clone(s.nodes), edges: clone(s.edges), links: clone(s.links) }];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, future: [] };
}

export const useGraphStore = create<GraphState>((set, get) => ({
  projectId: null,
  projectName: 'Untitled',
  nodes: [],
  edges: [],
  links: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  selectedNodeIds: [],
  timeline: { schemaVersion: 1, fps: 30, duration: 4, timebase: '30fps', tracks: [], playhead: 0 },
  dirty: false,
  past: [],
  future: [],
  lastConnectError: null,

  loadProject: (projectId, name, graph, timeline) => {
    resetCoalescing();
    set({
      projectId, projectName: name,
      nodes: clone(graph.nodes), edges: clone(graph.edges), links: clone(graph.links ?? []),
      viewport: graph.viewport ?? { x: 0, y: 0, zoom: 1 },
      timeline: clone(timeline),
      selectedNodeIds: [], dirty: false, past: [], future: [], lastConnectError: null,
    });
  },

  setViewport: (viewport) => set({ viewport, dirty: true }),

  addNode: (type, position, params) => {
    const def = getNodeDef(type);
    if (!def) return null;
    const node: GraphNode = {
      id: uid('n'),
      type,
      position: { x: Math.round(position.x), y: Math.round(position.y) },
      data: { params: { ...defaultParams(def), ...(params ?? {}) }, disabled: false },
    };
    set((s) => ({ ...pushHistory(s), nodes: [...s.nodes, node], dirty: true }));
    return node;
  },

  updateNodeParams: (id, params) =>
    set((s) => {
      touch(s, id);
      return {
        ...pushHistory(s, `params:${id}`),
        nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, params: { ...n.data.params, ...params } } } : n)),
        dirty: true,
      };
    }),

  updateNodeData: (id, data) =>
    set((s) => {
      touch(s, id);
      return {
        ...pushHistory(s, `data:${id}`),
        nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)),
        dirty: true,
      };
    }),

  moveNodes: (moves) => {
    const map = new Map(moves.map((m) => [m.id, m]));
    set((s) => ({
      nodes: s.nodes.map((n) => {
        const m = map.get(n.id);
        return m ? { ...n, position: { x: m.x, y: m.y } } : n;
      }),
      dirty: true,
    }));
  },

  removeNodes: (ids) => {
    const setIds = new Set(ids);
    for (const id of ids) resultCache.invalidate(id);
    useExecStore.getState().forgetNodes(ids);
    set((s) => ({
      ...pushHistory(s),
      nodes: s.nodes.filter((n) => !setIds.has(n.id)),
      edges: s.edges.filter((e) => !setIds.has(e.source) && !setIds.has(e.target)),
      links: s.links.filter((l) => !setIds.has(l.sourceNodeId) && !setIds.has(l.targetNodeId)),
      selectedNodeIds: s.selectedNodeIds.filter((id) => !setIds.has(id)),
      dirty: true,
    }));
  },

  duplicateNodes: (ids) => {
    const s = get();
    const setIds = new Set(ids);
    const idMap = new Map<string, string>();
    for (const id of ids) idMap.set(id, uid('n'));
    const newNodes = s.nodes
      .filter((n) => setIds.has(n.id))
      .map((n) => ({ ...clone(n), id: idMap.get(n.id)!, position: { x: n.position.x + 48, y: n.position.y + 48 } }));
    const newEdges = s.edges
      .filter((e) => setIds.has(e.source) && setIds.has(e.target))
      .map((e) => ({ ...clone(e), id: uid('e'), source: idMap.get(e.source)!, target: idMap.get(e.target)! }));
    set((st) => ({ ...pushHistory(st), nodes: [...st.nodes, ...newNodes], edges: [...st.edges, ...newEdges], dirty: true }));
  },

  addEdge: (source, sourceHandle, target, targetHandle) => {
    const s = get();
    const src = s.nodes.find((n) => n.id === source);
    const tgt = s.nodes.find((n) => n.id === target);
    if (!src || !tgt) return null;
    const check = canConnect({ nodes: s.nodes, edges: s.edges }, src, sourceHandle, tgt, targetHandle);
    if (!check.ok) {
      set({ lastConnectError: check.reason ?? 'Rejected' });
      return null;
    }
    const edge: GraphEdge = { id: uid('e'), source, sourceHandle, target, targetHandle };
    set((st) => {
      touch({ nodes: st.nodes, edges: [...st.edges, edge] }, target);
      return { ...pushHistory(st), edges: [...st.edges, edge], dirty: true, lastConnectError: null };
    });
    return edge.id;
  },

  removeEdges: (ids) => {
    const setIds = new Set(ids);
    set((s) => {
      for (const e of s.edges) if (setIds.has(e.id)) touch(s, e.target);
      return { ...pushHistory(s), edges: s.edges.filter((e) => !setIds.has(e.id)), dirty: true };
    });
  },

  setSelected: (selectedNodeIds) => set({ selectedNodeIds }),
  setTimeline: (timeline) => set({ timeline, dirty: true }),

  undo: () => {
    resetCoalescing();
    set((s) => {
      if (s.past.length === 0) return {};
      const prev = s.past[s.past.length - 1];
      const future = [...s.future, { nodes: clone(s.nodes), edges: clone(s.edges), links: clone(s.links) }];
      return { nodes: clone(prev.nodes), edges: clone(prev.edges), links: clone(prev.links ?? []), past: s.past.slice(0, -1), future, dirty: true };
    });
  },

  redo: () => {
    resetCoalescing();
    set((s) => {
      if (s.future.length === 0) return {};
      const next = s.future[s.future.length - 1];
      const past = [...s.past, { nodes: clone(s.nodes), edges: clone(s.edges), links: clone(s.links) }];
      return { nodes: clone(next.nodes), edges: clone(next.edges), future: s.future.slice(0, -1), past, dirty: true };
    });
  },

  clearHistory: () => {
    resetCoalescing();
    set({ past: [], future: [] });
  },
  markClean: () => set({ dirty: false }),
  clearConnectError: () => set({ lastConnectError: null }),
  addLink: (sourceNodeId, sourceKey, targetNodeId, targetKey) => {
    const s = get();
    if (sourceNodeId === targetNodeId && sourceKey === targetKey) return null;
    const dupe = s.links.find((l) => l.sourceNodeId === sourceNodeId && l.sourceKey === sourceKey && l.targetNodeId === targetNodeId && l.targetKey === targetKey);
    if (dupe) return dupe.id;
    // One driver per target param.
    const conflict = s.links.find((l) => l.targetNodeId === targetNodeId && l.targetKey === targetKey);
    if (conflict) return null;
    const link: ParamLink = { id: uid('lk'), sourceNodeId, sourceKey, targetNodeId, targetKey };
    set((st) => ({ ...pushHistory(st), links: [...st.links, link], dirty: true }));
    touch({ nodes: s.nodes, edges: s.edges }, targetNodeId);
    return link.id;
  },

  removeLink: (id) =>
    set((s) => {
      const link = s.links.find((l) => l.id === id);
      if (link) touch(s, link.targetNodeId);
      return { ...pushHistory(s), links: s.links.filter((l) => l.id !== id), dirty: true };
    }),

  getDoc: () => {
    const s = get();
    void emptyGraph;
    return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes: clone(s.nodes), edges: clone(s.edges), links: clone(s.links), viewport: { ...s.viewport } };
  },
}));
