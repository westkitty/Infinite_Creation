import { describe, expect, it } from 'vitest';
import { AssetRecordSchema, type AssetRecord } from '../types/graph';
import { buildLineage } from './lineage';

function asset(id: string, parentIds: string[] = []): AssetRecord {
  return AssetRecordSchema.parse({
    id, name: `${id}.png`, kind: 'derived', mime: 'image/png',
    size: 10, hash: `h-${id}`, createdAt: 1,
    provenance: { parentIds, inputHashes: [], params: {} },
  });
}

describe('buildLineage', () => {
  it('orders ancestor generations oldest-first', () => {
    const all = [asset('a'), asset('b', ['a']), asset('c', ['b'])];
    const m = buildLineage(all[2], all);
    expect(m.ancestorLevels.map((g) => g.map((a) => a.id))).toEqual([['a'], ['b']]);
    expect(m.hiddenAncestors).toBe(0);
    expect(m.missingAncestors).toBe(0);
    expect(m.children).toEqual([]);
  });

  it('collects diamonds, children, and missing parents', () => {
    const all = [asset('a'), asset('b', ['a']), asset('c', ['a']), asset('d', ['b', 'c', 'gone']), asset('e', ['d'])];
    const m = buildLineage(all[3], all);
    expect(m.ancestorLevels.map((g) => g.map((a) => a.id))).toEqual([['a'], ['b', 'c']]);
    expect(m.missingAncestors).toBe(1);
    expect(m.children.map((a) => a.id)).toEqual(['e']);
  });

  it('caps depth with an honest hidden count and survives cycles', () => {
    // g0 <- g1 <- g2 <- g3 <- g4 <- self, plus a g4 -> g2 back-edge cycle.
    const mk = (id: string, parents: string[]) => asset(id, parents);
    const all = [mk('g0', []), mk('g1', ['g0']), mk('g2', ['g1']), mk('g3', ['g2']), mk('g4', ['g3', 'g2']), mk('self', ['g4'])];
    const m = buildLineage(all[5], all, 2);
    // youngest-first generations: [g4], [g3, g2], [g1], [g0]; show 2 youngest, oldest-first.
    expect(m.ancestorLevels.map((g) => g.map((a) => a.id))).toEqual([['g3', 'g2'], ['g4']]);
    expect(m.hiddenAncestors).toBe(2); // g1, g0
    const deep = buildLineage(all[5], all, 10);
    expect(deep.hiddenAncestors).toBe(0);
    expect(deep.ancestorLevels.flat().map((a) => a.id).sort()).toEqual(['g0', 'g1', 'g2', 'g3', 'g4']);
  });
});
