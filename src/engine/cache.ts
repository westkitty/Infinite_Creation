// Deterministic result cache with LRU eviction and byte accounting.
// Cache identity = node type + implementation version + stable params +
// per-port input hashes + processing settings. Anything else changing means
// a miss, which is always safe (recompute) — never a false hit.

import { stableStringify, shortHash } from '../lib/ids';
import { hashPixels } from '../media/pixel';
import type { ExecValue } from './executors';

export function hashValue(v: ExecValue): string {
  switch (v.kind) {
    case 'image': return hashPixels(v.image);
    case 'artifact': {
      let h = 0x811c9dc5;
      const d = v.bytes;
      const step = Math.max(1, Math.floor(d.length / 4096));
      for (let i = 0; i < d.length; i += step) { h ^= d[i]; h = Math.imul(h, 0x01000193); }
      return `ab_${(h >>> 0).toString(16).padStart(8, '0')}_${d.length}`;
    }
    case 'collection': return `col_${shortHash(v.items.map(hashValue).join('|'))}`;
    case 'sequence': return `seq_${shortHash(v.images.map(hashPixels).join('|') + v.fps + ':' + v.framesPerImage)}`;
    case 'number': return `n_${v.value}`;
    case 'text': return `t_${shortHash(v.value)}`;
    case 'color': return `c_${v.value}`;
    case 'boolean': return `b_${v.value}`;
    case 'transform': return `x_${shortHash(stableStringify(v.value))}`;
    case 'metadata': return `m_${shortHash(stableStringify(v.value))}`;
    case 'assetRef': return `a_${v.assetId}`;
  }
}

export function nodeCacheKey(args: {
  nodeType: string;
  nodeVersion: number;
  params: Record<string, unknown>;
  inputHashes: Record<string, string[]>;
}): string {
  return shortHash(stableStringify({
    t: args.nodeType, v: args.nodeVersion, p: args.params, i: args.inputHashes,
    engine: 1, // bump when executor semantics change globally
  }));
}

interface CacheEntry {
  key: string;
  nodeId: string;
  value: Record<string, ExecValue>;
  bytes: number;
  lastAccess: number;
  createdAt: number;
}

function estimateBytes(v: Record<string, ExecValue>): number {
  let n = 0;
  for (const val of Object.values(v)) {
    if (val.kind === 'image') n += val.image.data.byteLength;
    else if (val.kind === 'artifact') n += val.bytes.byteLength;
    else if (val.kind === 'sequence') n += val.images.reduce((a, i) => a + i.data.byteLength, 0);
    else if (val.kind === 'collection') n += 1024;
    else n += 256;
  }
  return n;
}

const MAX_ENTRIES = 48;
const MAX_BYTES = 384 * 1024 * 1024; // 384 MB of intermediate pixels

class ResultCache {
  private entries = new Map<string, CacheEntry>(); // key: `${nodeId}`
  private evictions = 0;

  get(nodeId: string, key: string): Record<string, ExecValue> | null {
    const e = this.entries.get(nodeId);
    if (!e || e.key !== key) return null;
    e.lastAccess = Date.now();
    return e.value;
  }

  peek(nodeId: string): CacheEntry | null {
    return this.entries.get(nodeId) ?? null;
  }

  set(nodeId: string, key: string, value: Record<string, ExecValue>): void {
    this.entries.set(nodeId, { key, nodeId, value, bytes: estimateBytes(value), lastAccess: Date.now(), createdAt: Date.now() });
    this.evictIfNeeded();
  }

  invalidate(nodeId: string): void {
    this.entries.delete(nodeId);
  }

  invalidateAll(): void {
    this.entries.clear();
  }

  stats(): { entries: number; bytes: number; evictions: number } {
    let bytes = 0;
    for (const e of this.entries.values()) bytes += e.bytes;
    return { entries: this.entries.size, bytes, evictions: this.evictions };
  }

  inspect(): Array<{ nodeId: string; key: string; bytes: number; ageMs: number }> {
    const now = Date.now();
    return [...this.entries.values()].map((e) => ({ nodeId: e.nodeId, key: e.key, bytes: e.bytes, ageMs: now - e.createdAt }));
  }

  private evictIfNeeded(): void {
    let bytes = 0;
    for (const e of this.entries.values()) bytes += e.bytes;
    if (this.entries.size <= MAX_ENTRIES && bytes <= MAX_BYTES) return;
    const sorted = [...this.entries.values()].sort((a, b) => a.lastAccess - b.lastAccess);
    for (const e of sorted) {
      if (this.entries.size <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
      this.entries.delete(e.nodeId);
      bytes -= e.bytes;
      this.evictions++;
    }
  }
}

export const resultCache = new ResultCache();
