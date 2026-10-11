import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, Panel, ReactFlowProvider, useReactFlow,
  useNodesState, useEdgesState, type Node, type Edge, type Connection, type NodeChange, type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraphStore } from '../stores/graphStore';
import { useUIStore } from '../stores/uiStore';
import { getNodeDef } from '../graph/registry';
import { explainConnection } from '../graph/validation';
import { StudioNode } from './StudioNode';
import { SubgraphsModal } from './SubgraphsModal';

const nodeTypes = { studio: StudioNode };

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner />
    </ReactFlowProvider>
  );
}

function GraphCanvasInner() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const viewport = useGraphStore((s) => s.viewport);
  const snap = useUIStore((s) => s.snapToGrid);
  const lastConnectError = useGraphStore((s) => s.lastConnectError);

  const rfNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'studio',
        position: n.position,
        data: { nodeId: n.id, nodeType: n.type, label: n.data.label, disabled: n.data.disabled, note: n.data.note },
      })),
    [nodes],
  );
  const rfEdges: Edge[] = useMemo(
    () => edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle })),
    [edges],
  );

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(rfNodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(rfEdges);

  useEffect(() => setFlowNodes(rfNodes), [rfNodes, setFlowNodes]);
  useEffect(() => setFlowEdges(rfEdges), [rfEdges, setFlowEdges]);

  const store = useGraphStore;
  const dragTimer = useRef<number | null>(null);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      const st = store.getState();
      for (const c of changes) {
        if (c.type === 'position' && c.position && c.dragging === false) {
          st.moveNodes([{ id: c.id, x: Math.round(c.position.x), y: Math.round(c.position.y) }]);
        }
        if (c.type === 'remove') st.removeNodes([c.id]);
        if (c.type === 'select') {
          const ids = new Set(st.selectedNodeIds);
          if (c.selected) ids.add(c.id);
          else ids.delete(c.id);
          st.setSelected([...ids]);
        }
      }
      // live drag: throttle-commit positions
      const dragging = changes.find((c) => c.type === 'position' && (c as { dragging?: boolean }).dragging);
      if (dragging && dragTimer.current === null) {
        dragTimer.current = window.setTimeout(() => {
          dragTimer.current = null;
          const moved = (store.getState().nodes ?? []).map((n) => {
            const f = flowNodesRef.current.find((x) => x.id === n.id);
            return f?.position && (f.position.x !== n.position.x || f.position.y !== n.position.y)
              ? { id: n.id, x: Math.round(f.position.x), y: Math.round(f.position.y) } : null;
          }).filter(Boolean) as Array<{ id: string; x: number; y: number }>;
          if (moved.length) store.getState().moveNodes(moved);
        }, 400);
      }
    },
    [onNodesChange],
  );
  const flowNodesRef = useRef(flowNodes);
  flowNodesRef.current = flowNodes;

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes);
      for (const c of changes) if (c.type === 'remove') store.getState().removeEdges([c.id]);
    },
    [onEdgesChange],
  );

  const onConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.sourceHandle || !conn.target || !conn.targetHandle) return;
    store.getState().addEdge(conn.source, conn.sourceHandle, conn.target, conn.targetHandle);
  }, []);

  const isValidConnection = useCallback((conn: Connection | Edge) => {
    const st = store.getState();
    const src = st.nodes.find((n) => n.id === conn.source);
    const tgt = st.nodes.find((n) => n.id === conn.target);
    if (!src || !tgt || !conn.sourceHandle || !conn.targetHandle) return false;
    const sDef = getNodeDef(src.type);
    const tDef = getNodeDef(tgt.type);
    if (!sDef || !tDef) return false;
    const s = sDef.outputs.find((p) => p.id === conn.sourceHandle);
    const t = tDef.inputs.find((p) => p.id === conn.targetHandle);
    if (!s || !t) return false;
    if (src.id === tgt.id) return false;
    // type pre-check (full cycle check happens in addEdge)
    const { typesCompatible } = requireTypesCompatible();
    return typesCompatible(s.dataType, t.dataType);
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const st = store.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); st.undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); st.redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); if (st.selectedNodeIds.length) st.duplicateNodes(st.selectedNodeIds); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (st.selectedNodeIds.length) st.removeNodes(st.selectedNodeIds); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { copySelection(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClipboard(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); useUIStore.getState().setCommandPaletteOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { screenToFlowPosition } = useReactFlow();
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/ics-node');
    if (!type) return;
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    store.getState().addNode(type, { x: Math.round(pos.x - 90), y: Math.round(pos.y - 30) });
  }, [screenToFlowPosition]);

  return (
    <div className="canvas-wrap" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        defaultViewport={viewport}
        onMoveEnd={(_, v) => store.getState().setViewport({ x: v.x, y: v.y, zoom: v.zoom })}
        snapToGrid={snap}
        snapGrid={[16, 16]}
        minZoom={0.1}
        maxZoom={2.5}
        panOnScroll
        selectionOnDrag
        panOnDrag={[1, 2]}
        multiSelectionKeyCode="Shift"
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background gap={16} />
        <MiniMap pannable zoomable />
        <Controls />
        <Panel position="top-left">
          <div className="canvas-toolbar" style={{ position: 'static' }}>
            <button className="btn ghost" title="Add node — search every node (Ctrl K)" aria-label="Add node" onClick={() => useUIStore.getState().setCommandPaletteOpen(true)}>+ Node</button>
            <button className="btn ghost" title={`Snap to grid: ${snap ? 'on' : 'off'}`} onClick={() => useUIStore.getState().toggleSnap()}>Snap {snap ? 'On' : 'Off'}</button>
            <SubgraphButton />
          </div>
        </Panel>
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="empty-hint">
          <div>
            <p><strong>Empty workflow.</strong></p>
            <p>Drag nodes from the left panel, or press <span className="kbd">Ctrl K</span> for the command palette.</p>
            <p>Load a sample project from File menu to see a working pipeline.</p>
          </div>
        </div>
      )}
      {lastConnectError && <div className="connect-error" role="alert">{lastConnectError}</div>}
    </div>
  );
}

function requireTypesCompatible() {
  // local indirection avoids a top-level import cycle in fast-refresh; real impl:
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return { typesCompatible: (a: string, b: string) => a === b || (a === 'ImageAsset' && b === 'ImageMask') || (a === 'ImageMask' && b === 'ImageAsset') };
}

let clipboard: { nodes: unknown[]; edges: unknown[] } | null = null;
export function copySelection() {
  const st = useGraphStore.getState();
  const ids = new Set(st.selectedNodeIds);
  clipboard = {
    nodes: JSON.parse(JSON.stringify(st.nodes.filter((n) => ids.has(n.id)))),
    edges: JSON.parse(JSON.stringify(st.edges.filter((e) => ids.has(e.source) && ids.has(e.target)))),
  };
}
export function pasteClipboard() {
  if (!clipboard) return;
  const st = useGraphStore.getState();
  const nodes = clipboard.nodes as Array<{ id: string; type: string; position: { x: number; y: number }; data: { params: Record<string, unknown> } }>;
  const edges = clipboard.edges as Array<{ sourceHandle: string; targetHandle: string; source: string; target: string }>;
  const idMap = new Map<string, string>();
  for (const n of nodes) {
    const created = st.addNode(n.type, { x: n.position.x + 48, y: n.position.y + 48 }, n.data.params);
    if (created) idMap.set(n.id, created.id);
  }
  for (const e of edges) {
    const s = idMap.get(e.source);
    const t = idMap.get(e.target);
    if (s && t) st.addEdge(s, e.sourceHandle, t, e.targetHandle);
  }
}

export function connectionHint(sourceType: string, sourceHandle: string, targetType: string, targetHandle: string): string {
  return explainConnection(sourceType, sourceHandle, targetType, targetHandle);
}

function SubgraphButton() {
  const [open, setOpen] = React.useState(false);
  const count = useGraphStore((s) => s.selectedNodeIds.length);
  return (
    <>
      <button className="btn ghost" title="Save selection as a reusable subgraph / browse library" onClick={() => setOpen(true)}>
        Subgraphs{count > 0 ? ` (${count})` : ''}
      </button>
      <SubgraphsModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
