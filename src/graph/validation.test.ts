import { describe, expect, it } from 'vitest';
import type { GraphDoc, GraphNode } from '../types/graph';
import { canConnect, findCycle, topoOrder, validateGraph, explainConnection } from './validation';
import { defaultParams, getNodeDef } from './registry';

function node(id: string, type: string, x = 0, y = 0, params: Record<string, unknown> = {}): GraphNode {
  const def = getNodeDef(type)!;
  return { id, type, position: { x, y }, data: { params: { ...defaultParams(def), ...params }, disabled: false } };
}

function doc(nodes: GraphNode[], edges: GraphDoc['edges']): GraphDoc {
  return { schemaVersion: 4, nodes, edges, links: [] };
}

describe('graph validation', () => {
  it('accepts a valid image connection', () => {
    const a = node('a', 'source.solidColor');
    const b = node('b', 'image.crop');
    const d = doc([a, b], []);
    expect(canConnect(d, a, 'image', b, 'image')).toEqual({ ok: true });
  });

  it('rejects incompatible types with an explanation', () => {
    const a = node('a', 'source.prompt');
    const b = node('b', 'image.crop');
    const d = doc([a, b], []);
    const r = canConnect(d, a, 'text', b, 'image');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Type mismatch/);
    expect(explainConnection('source.prompt', 'text', 'image.crop', 'image')).toMatch(/Incompatible/);
  });

  it('rejects single-cardinality double connections', () => {
    const a = node('a', 'source.solidColor');
    const c = node('c', 'source.solidColor');
    const b = node('b', 'image.crop');
    const d = doc([a, b, c], [{ id: 'e1', source: 'a', sourceHandle: 'image', target: 'b', targetHandle: 'image' }]);
    const r = canConnect(d, c, 'image', b, 'image');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/single cardinality/);
  });

  it('rejects cycles deterministically', () => {
    const a = node('a', 'image.blur');
    const b = node('b', 'image.sharpen');
    // blur -> sharpen exists; sharpen -> blur would cycle
    const d = doc([a, b], [{ id: 'e1', source: 'a', sourceHandle: 'image', target: 'b', targetHandle: 'image' }]);
    expect(canConnect(d, b, 'image', a, 'image').ok).toBe(false);
    const cyclic = doc([a, b], [
      { id: 'e1', source: 'a', sourceHandle: 'image', target: 'b', targetHandle: 'image' },
      { id: 'e2', source: 'b', sourceHandle: 'image', target: 'a', targetHandle: 'image' },
    ]);
    expect(findCycle(cyclic)).not.toBeNull();
    expect(() => topoOrder(cyclic)).toThrow(/cycle/);
  });

  it('detects missing required inputs', () => {
    const b = node('b', 'image.composite');
    const issues = validateGraph(doc([b], []));
    expect(issues.some((i) => i.code === 'input-missing')).toBe(true);
  });

  it('topologically orders a diamond graph', () => {
    const src = node('src', 'source.solidColor');
    const b1 = node('b1', 'image.blur');
    const b2 = node('b2', 'image.blur');
    const m = node('m', 'util.merge');
    const d = doc([src, b1, b2, m], [
      { id: 'e1', source: 'src', sourceHandle: 'image', target: 'b1', targetHandle: 'image' },
      { id: 'e2', source: 'src', sourceHandle: 'image', target: 'b2', targetHandle: 'image' },
      { id: 'e3', source: 'b1', sourceHandle: 'image', target: 'm', targetHandle: 'images' },
      { id: 'e4', source: 'b2', sourceHandle: 'image', target: 'm', targetHandle: 'images' },
    ]);
    const order = topoOrder(d);
    expect(order[0]).toBe('src');
    expect(order[order.length - 1]).toBe('m');
    expect(validateGraph(d).filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('flags unavailable provider nodes', () => {
    const p = node('p', 'provider.imageGen');
    const issues = validateGraph(doc([p], []));
    expect(issues.some((i) => i.code === 'node-unavailable')).toBe(true);
  });

  it('flags non-finite and out-of-range params', () => {
    const b = node('b', 'image.blur', 0, 0, { radius: NaN });
    expect(validateGraph(doc([b], [])).some((i) => i.code === 'param-nonfinite')).toBe(true);
    const b2 = node('b2', 'image.blur', 0, 0, { radius: 999 });
    expect(validateGraph(doc([b2], [])).some((i) => i.code === 'param-range')).toBe(true);
  });
});
