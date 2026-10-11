import type { AssetRecord } from '../types/graph';

/** Generations of ancestors shown, oldest generation first. */
export interface LineageModel {
  /** Ancestor generations, oldest first; immediately followed by `self`. */
  ancestorLevels: AssetRecord[][];
  /** Ancestors hidden by the depth cap (all deeper than the oldest shown). */
  hiddenAncestors: number;
  /** Referenced ancestor ids no longer present in the library (deleted). */
  missingAncestors: number;
  self: AssetRecord;
  /** Direct children (assets listing `self` as a parent). */
  children: AssetRecord[];
}

export const LINEAGE_MAX_DEPTH = 4;

/**
 * Build the visual lineage model for one asset: ancestor generations
 * (cycle-safe, depth-capped with an honest hidden count) plus children.
 */
export function buildLineage(self: AssetRecord, all: AssetRecord[], maxDepth = LINEAGE_MAX_DEPTH): LineageModel {
  const byId = new Map(all.map((a) => [a.id, a]));
  const visited = new Set<string>([self.id]);
  // Walk upward generation by generation; youngest generation first.
  const youngestFirst: AssetRecord[][] = [];
  let missing = 0;
  let frontier: AssetRecord[] = [self];
  for (;;) {
    const next: AssetRecord[] = [];
    for (const a of frontier) {
      for (const pid of a.provenance?.parentIds ?? []) {
        if (visited.has(pid)) continue;
        visited.add(pid);
        const p = byId.get(pid);
        if (p) next.push(p);
        else missing++;
      }
    }
    if (next.length === 0) break;
    youngestFirst.push(next);
    frontier = next;
  }
  const total = youngestFirst.reduce((n, g) => n + g.length, 0);
  const shown = youngestFirst.slice(0, maxDepth);
  const shownCount = shown.reduce((n, g) => n + g.length, 0);
  const children = all.filter((a) => a.id !== self.id && (a.provenance?.parentIds?.includes(self.id) ?? false));
  return {
    ancestorLevels: shown.slice().reverse(),
    hiddenAncestors: total - shownCount,
    missingAncestors: missing,
    self,
    children,
  };
}
