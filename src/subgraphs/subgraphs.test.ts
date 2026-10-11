import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../assets/db';
import { buildSampleA } from '../samples/builders';
import { analyzeSelection, expandSubgraphNodes, instantiateSubgraph, saveSubgraph } from './library';

beforeEach(async () => {
  await db.projects.clear();
  await db.assets.clear();
  await db.blobs.clear();
  await db.thumbs.clear();
  await db.runs.clear();
  await db.subgraphs.clear();
});

describe('subgraphs', () => {
  it('analyzes boundary ports of a selection', () => {
    const s = buildSampleA();
    const a = analyzeSelection(s.graph, ['crop', 'grade']);
    expect(a.problems).toEqual([]);
    expect(a.publicInputs.map((p) => p.portId)).toEqual(['image']);
    expect(a.publicInputs[0].nodeId).toBe('crop');
    expect(a.publicOutputs.map((p) => p.portId)).toEqual(['image']);
    expect(a.publicOutputs[0].nodeId).toBe('grade');
  });

  it('rejects unavailable nodes in a selection', () => {
    const s = buildSampleA();
    const doc = { ...s.graph, nodes: [...s.graph.nodes, { id: 'gen', type: 'provider.imageGen', position: { x: 0, y: 0 }, data: { params: {}, disabled: false } }] };
    const a = analyzeSelection(doc, ['gen']);
    expect(a.problems.length).toBeGreaterThan(0);
  });

  it('saves and instantiates with fresh ids', async () => {
    const s = buildSampleA();
    const a = analyzeSelection(s.graph, ['crop', 'grade']);
    const row = await saveSubgraph('Crop+grade', undefined, s.graph, a);
    expect(row.version).toBe(1);
    expect(row.publicInputs).toHaveLength(1);
    const inst = instantiateSubgraph(row, { x: 50, y: 60 });
    expect(inst.nodes).toHaveLength(2);
    expect(inst.nodes.map((n) => n.id)).not.toContain('crop');
    expect(inst.edges).toHaveLength(1);
  });

  it('expands single-in/single-out placeholders inline', async () => {
    const s = buildSampleA();
    const a = analyzeSelection(s.graph, ['crop', 'grade']);
    const row = await saveSubgraph('Crop+grade', undefined, s.graph, a);
    // Replace crop+grade with a placeholder wired identically.
    const doc = JSON.parse(JSON.stringify(s.graph));
    doc.nodes = doc.nodes.filter((n: { id: string }) => n.id !== 'crop' && n.id !== 'grade');
    doc.nodes.push({ id: 'ph', type: 'util.subgraph', position: { x: 400, y: 120 }, data: { params: { subgraphId: row.id }, disabled: false } });
    doc.edges = doc.edges.filter((e: { source: string; target: string }) => e.source !== 'crop' && e.target !== 'crop' && e.source !== 'grade' && e.target !== 'grade');
    doc.edges.push(
      { id: 'e_in', source: 'src_base', sourceHandle: 'image', target: 'ph', targetHandle: 'image' },
      { id: 'e_out', source: 'ph', sourceHandle: 'image', target: 'comp', targetHandle: 'background' },
    );
    const { doc: out, errors } = await expandSubgraphNodes(doc);
    expect(errors.size).toBe(0);
    expect(out.nodes.some((n: { id: string }) => n.id === 'ph')).toBe(false);
    expect(out.nodes).toHaveLength(s.graph.nodes.length); // 2 added, 2 removed (crop/grade out, 2 fresh in)
  });

  it('refuses multi-output definitions for inline nodes', async () => {
    const s = buildSampleA();
    const a = analyzeSelection(s.graph, ['src_base', 'src_badge']); // 0 in, 2 out
    const row = await saveSubgraph('Two sources', undefined, s.graph, a);
    const doc = JSON.parse(JSON.stringify(s.graph));
    doc.nodes.push({ id: 'ph', type: 'util.subgraph', position: { x: 0, y: 0 }, data: { params: { subgraphId: row.id }, disabled: false } });
    const { errors } = await expandSubgraphNodes(doc);
    expect(errors.get('ph')).toMatch(/exactly 1 input and 1 output/);
  });

  it('errors on missing definitions', async () => {
    const s = buildSampleA();
    const doc = JSON.parse(JSON.stringify(s.graph));
    doc.nodes.push({ id: 'ph', type: 'util.subgraph', position: { x: 0, y: 0 }, data: { params: { subgraphId: 'sg_nope' }, disabled: false } });
    const { errors } = await expandSubgraphNodes(doc);
    expect(errors.get('ph')).toMatch(/not found/);
  });
});
