import { GRAPH_SCHEMA_VERSION, type GraphDoc, type ParamLink } from '../types/graph';

/** Migrate any older graph document to the current schema. Never deletes user data. */
export function migrateGraph(doc: unknown): GraphDoc {
  const raw = (doc ?? {}) as Record<string, unknown>;
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  const nodes = Array.isArray(raw.nodes) ? (raw.nodes as GraphDoc['nodes']) : [];
  const edges = Array.isArray(raw.edges) ? (raw.edges as GraphDoc['edges']) : [];
  const links = Array.isArray(raw.links) ? (raw.links as ParamLink[]) : [];
  const viewport = (raw.viewport as GraphDoc['viewport']) ?? { x: 0, y: 0, zoom: 1 };

  const normalizedNodes = nodes.map((n) => ({
    id: String((n as Record<string, unknown>).id ?? ''),
    type: String((n as Record<string, unknown>).type ?? ''),
    position: (n as Record<string, unknown>).position as { x: number; y: number } ?? { x: 0, y: 0 },
    data: {
      label: ((n as Record<string, unknown>).data as Record<string, unknown> | undefined)?.label as string | undefined,
      params: (((n as Record<string, unknown>).data as Record<string, unknown> | undefined)?.params as Record<string, unknown>) ?? {},
      disabled: Boolean(((n as Record<string, unknown>).data as Record<string, unknown> | undefined)?.disabled ?? false),
      note: ((n as Record<string, unknown>).data as Record<string, unknown> | undefined)?.note as string | undefined,
    },
  }));

  const normalizedEdges = edges.map((e) => {
    const r = e as Record<string, unknown>;
    return {
      id: String(r.id ?? ''),
      source: String(r.source ?? ''),
      sourceHandle: String(r.sourceHandle ?? r.sourceHandleId ?? 'out'),
      target: String(r.target ?? ''),
      targetHandle: String(r.targetHandle ?? r.targetHandleId ?? 'in'),
    };
  });

  void version; // v1..v3 share node/edge shape; v4 adds param links (default []).
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes: normalizedNodes, edges: normalizedEdges, links, viewport };
}

export function emptyGraph(): GraphDoc {
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes: [], edges: [], links: [], viewport: { x: 0, y: 0, zoom: 1 } };
}
