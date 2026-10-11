// Asset health verification and recovery. Blobs can go missing if the user
// clears site data partially or a transaction was interrupted; records survive
// independently so we can detect and repair (relink) them.

import { db } from './db';
import { sha256Hex } from '../lib/ids';
import { probeImage } from '../media/codec';
import { useAssetStore } from '../stores/assetStore';

export interface VerifyReport {
  checked: number;
  healthy: number;
  missing: string[];
}

/** Check every asset record in the project for its binary; flag gaps. */
export async function verifyProjectAssets(projectId: string): Promise<VerifyReport> {
  const assets = await db.assets.where('projectId').equals(projectId).toArray();
  const missing: string[] = [];
  for (const a of assets) {
    const blob = await db.blobs.get(a.id);
    const isMissing = !blob;
    if (isMissing) missing.push(a.id);
    if (!!a.missing !== isMissing) {
      await db.assets.update(a.id, { missing: isMissing });
      const { projectId: _p, ...rec } = { ...a, missing: isMissing };
      void _p;
      useAssetStore.getState().upsert(rec);
    }
  }
  return { checked: assets.length, healthy: assets.length - missing.length, missing };
}

/** Replace the binary of a missing (or outdated) asset, keeping its stable ID. */
export async function relinkAsset(assetId: string, file: File | Blob, filename?: string): Promise<void> {
  const row = await db.assets.get(assetId);
  if (!row) throw new Error(`Asset record ${assetId} not found`);
  if (file.size <= 0) throw new Error('Replacement file is empty');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256Hex(bytes);
  const patch: { size: number; hash: string; missing: boolean; mime: string; name: string; width?: number; height?: number } = {
    size: file.size, hash, missing: false,
    mime: file.type || row.mime,
    name: filename ?? row.name,
  };
  if (row.kind === 'image') {
    try {
      const dims = await probeImage(file);
      patch.width = dims.width;
      patch.height = dims.height;
    } catch {
      throw new Error('Replacement file could not be decoded as an image');
    }
  }
  await db.transaction('rw', [db.assets, db.blobs], async () => {
    await db.blobs.put({ id: assetId, data: file });
    await db.assets.update(assetId, patch);
  });
  const updated = await db.assets.get(assetId);
  if (updated) {
    const { projectId: _p, ...rec } = updated;
    void _p;
    useAssetStore.getState().upsert(rec);
  }
}

/** Find node ids (in a graph doc) referencing the given asset id. */
export function findAssetReferences(
  doc: { nodes: Array<{ id: string; type: string; data: { params?: Record<string, unknown> } }> },
  assetId: string,
): Array<{ nodeId: string; nodeType: string }> {
  return doc.nodes
    .filter((n) => Object.values(n.data.params ?? {}).includes(assetId))
    .map((n) => ({ nodeId: n.id, nodeType: n.type }));
}
