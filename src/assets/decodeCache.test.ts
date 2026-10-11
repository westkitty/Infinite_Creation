import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import type { AssetRow } from './db';
import { createImage, type ImageValue } from '../media/pixel';

const decodeCalls: Blob[] = [];
vi.mock('../media/codec', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../media/codec')>();
  return {
    ...orig,
    decodeImageBlob: vi.fn(async (blob: Blob): Promise<ImageValue> => {
      decodeCalls.push(blob);
      // Distinct pixels per decode so hits vs misses are observable.
      return createImage(2, 2, [decodeCalls.length % 256, 0, 0, 255]);
    }),
  };
});

const { clearDecodedPixels, loadImageAssetCached } = await import('./repository');

function seed(id: string, hash: string): AssetRow {
  return {
    id, name: id, kind: 'image', mime: 'image/png', size: 4, hash,
    createdAt: 1, tags: [], favorite: false, approval: 'draft', missing: false,
    projectId: 'p1',
  };
}

async function seedAsset(id: string, hash: string): Promise<void> {
  await db.assets.put(seed(id, hash));
  await db.blobs.put({ id, data: new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer });
}

beforeEach(async () => {
  await db.assets.clear();
  await db.blobs.clear();
  clearDecodedPixels();
  decodeCalls.length = 0;
});

describe('loadImageAssetCached', () => {
  it('decodes once and serves the same pixels on repeat loads', async () => {
    await seedAsset('a', 'h1');
    const first = await loadImageAssetCached('a');
    const second = await loadImageAssetCached('a');
    expect(decodeCalls.length).toBe(1);
    expect(second).toBe(first); // shared read-only contract
  });

  it('re-decodes after the content hash changes (relink cannot serve stale pixels)', async () => {
    await seedAsset('a', 'h1');
    const before = await loadImageAssetCached('a');
    await db.assets.update('a', { hash: 'h2' }); // what relinkAsset does
    const after = await loadImageAssetCached('a');
    expect(decodeCalls.length).toBe(2);
    expect(after).not.toBe(before);
    expect(after.data[0]).not.toBe(before.data[0]);
  });

  it('evicts the least-recently-used entry past the cap', async () => {
    for (let i = 0; i < 13; i++) await seedAsset(`img${i}`, `hash${i}`);
    for (let i = 0; i < 13; i++) await loadImageAssetCached(`img${i}`);
    expect(decodeCalls.length).toBe(13);
    // img0 was evicted (cap 12); img12 is still cached.
    await loadImageAssetCached('img12');
    expect(decodeCalls.length).toBe(13);
    await loadImageAssetCached('img0');
    expect(decodeCalls.length).toBe(14);
  });

  it('throws a clear error when the binary is missing', async () => {
    await db.assets.put(seed('ghost', 'h9'));
    await expect(loadImageAssetCached('ghost')).rejects.toThrow('no stored binary');
  });
});
