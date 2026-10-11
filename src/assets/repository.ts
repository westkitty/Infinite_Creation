// Asset repository: binary storage in IndexedDB (Dexie), content-hash dedupe,
// metadata extraction, lazy thumbnails, and safe object-URL lifecycle.

import { db } from './db';
import type { AssetKind, AssetRecord } from '../types/graph';
import { sha256Hex, uid } from '../lib/ids';
import { makeThumbnail, probeImage } from '../media/codec';

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif']);
const AUDIO_MIMES = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/webm', 'audio/flac']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']);

export function kindForMime(mime: string, filename: string): AssetKind | null {
  if (IMAGE_MIMES.has(mime)) return 'image';
  if (AUDIO_MIMES.has(mime) || mime.startsWith('audio/')) return 'audio';
  if (VIDEO_MIMES.has(mime) || mime.startsWith('video/')) return 'video';
  const lower = filename.toLowerCase();
  if (mime === 'model/gltf-binary' || lower.endsWith('.glb')) return 'model3d';
  if (mime === 'model/gltf+json' || lower.endsWith('.gltf')) return 'model3d';
  return null;
}

export function looksLikeImageSignature(bytes: Uint8Array, mime: string): boolean {
  // File-signature sniffing for common raster formats (best-effort honesty check).
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  const jpg = [0xff, 0xd8, 0xff];
  if (mime === 'image/png') return png.every((b, i) => bytes[i] === b);
  if (mime === 'image/jpeg') return jpg.every((b, i) => bytes[i] === b);
  if (mime === 'image/webp') {
    return bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return true; // unknown/ gif / bmp / avif: defer to browser decoder
}

export interface ImportResult {
  asset: AssetRecord;
  deduplicated: boolean;
  warning?: string;
}

export async function importFile(projectId: string, file: File | Blob, filename?: string): Promise<ImportResult> {
  const name = filename ?? (file instanceof File ? file.name : `import_${Date.now()}`);
  const mime = file.type || guessMime(name);
  const kind = kindForMime(mime, name);
  if (!kind) throw new Error(`Unsupported file type "${mime || 'unknown'}" for "${name}". Supported: PNG/JPEG/WebP/GIF/BMP/AVIF images, MP3/WAV/OGG audio, MP4/WebM video, GLB/GLTF models.`);
  if (file.size <= 0) throw new Error(`"${name}" is empty (0 bytes)`);
  if (file.size > 500 * 1024 * 1024) throw new Error(`"${name}" exceeds the 500 MB import limit`);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256Hex(bytes);

  // Deduplicate within the project by content hash.
  const existing = await db.assets.where('[id]').equals(hash).toArray().catch(() => []);
  void existing;
  const sameProject = await db.assets.where('projectId').equals(projectId).toArray();
  const dupe = sameProject.find((a) => a.hash === hash && a.mime === mime);
  if (dupe) {
    const { projectId: _p, ...rec } = dupe;
    void _p;
    return { asset: rec, deduplicated: true };
  }

  let warning: string | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let duration: number | undefined;

  if (kind === 'image') {
    if (!looksLikeImageSignature(bytes.subarray(0, 16), mime)) {
      warning = `MIME type ${mime} does not match file signature; the browser decoder will make the final call.`;
    }
    try {
      const dims = await probeImage(file);
      width = dims.width; height = dims.height;
    } catch {
      throw new Error(`"${name}" could not be decoded as an image (unsupported or corrupt data)`);
    }
  } else if (kind === 'audio' || kind === 'video') {
    duration = await probeDuration(file, kind).catch(() => undefined);
    if (kind === 'video') {
      const dims = await probeVideoFrame(file).catch(() => undefined);
      if (dims) { width = dims.width; height = dims.height; }
    }
  } else if (kind === 'model3d') {
    const ok = validateGltfMagic(bytes, name);
    if (!ok) throw new Error(`"${name}" is not a valid GLB/GLTF file (bad magic header)`);
  }

  const id = uid('a');
  const record: AssetRecord = {
    id, name, kind, mime, size: file.size, hash, width, height, duration,
    createdAt: Date.now(), tags: [], favorite: false, approval: 'draft', missing: false,
  };
  try {
    await db.transaction('rw', [db.assets, db.blobs, db.thumbs], async () => {
      await db.assets.put({ ...record, projectId });
      await db.blobs.put({ id, data: file });
      if (kind === 'image') {
        const thumb = await makeThumbnail(file).catch(() => null);
        if (thumb) await db.thumbs.put({ id, data: thumb.blob });
      }
    });
  } catch (e) {
    throw new Error(`Storage failed for "${name}": ${quotaMessage(e)}`);
  }
  return { asset: record, deduplicated: false, warning };
}

function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.glb')) return 'model/gltf-binary';
  if (lower.endsWith('.gltf')) return 'model/gltf+json';
  return '';
}

function quotaMessage(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'QuotaExceededError') return 'browser storage quota exceeded — free space or delete unused assets (existing projects were not touched)';
  return e instanceof Error ? e.message : String(e);
}

function validateGltfMagic(bytes: Uint8Array, name: string): boolean {
  if (name.toLowerCase().endsWith('.glb')) {
    return bytes.length > 12 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46; // 'glTF'
  }
  // .gltf JSON: must parse and carry asset.version
  try {
    const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 1 << 20)));
    const json = JSON.parse(text) as { asset?: { version?: string } };
    return typeof json?.asset?.version === 'string';
  } catch {
    return false;
  }
}

function probeDuration(file: Blob, kind: 'audio' | 'video'): Promise<number | undefined> {
  return new Promise((resolve) => {
    try {
      const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
      el.preload = 'metadata';
      const url = URL.createObjectURL(file);
      const done = (v?: number) => { URL.revokeObjectURL(url); resolve(v); };
      el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : undefined);
      el.onerror = () => done(undefined);
      el.src = url;
      setTimeout(() => done(undefined), 8000);
    } catch {
      resolve(undefined);
    }
  });
}

function probeVideoFrame(file: Blob): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    try {
      const el = document.createElement('video');
      el.preload = 'metadata';
      el.muted = true;
      const url = URL.createObjectURL(file);
      const done = (v?: { width: number; height: number }) => { URL.revokeObjectURL(url); resolve(v); };
      el.onloadedmetadata = () => {
        if (el.videoWidth > 0) done({ width: el.videoWidth, height: el.videoHeight });
        else done(undefined);
      };
      el.onerror = () => done(undefined);
      el.src = url;
      setTimeout(() => done(undefined), 8000);
    } catch {
      resolve(undefined);
    }
  });
}

export async function listAssets(projectId: string): Promise<AssetRecord[]> {
  const rows = await db.assets.where('projectId').equals(projectId).sortBy('createdAt');
  return rows.map(({ projectId: _p, ...rec }) => {
    void _p;
    return rec;
  });
}

export async function getAssetBlob(assetId: string): Promise<Blob | null> {
  const row = await db.blobs.get(assetId);
  return row?.data ?? null;
}

export async function getAssetBytes(assetId: string): Promise<Uint8Array | null> {
  const blob = await getAssetBlob(assetId);
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

export async function storeDerivedAsset(
  projectId: string,
  name: string,
  mime: string,
  bytes: Uint8Array,
  meta: Partial<AssetRecord> & { width?: number; height?: number },
): Promise<AssetRecord> {
  const hash = await sha256Hex(bytes);
  const id = uid('a');
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: mime });
  const record: AssetRecord = {
    id, name, kind: meta.kind ?? 'derived', mime, size: bytes.length, hash,
    width: meta.width, height: meta.height,
    createdAt: Date.now(), tags: meta.tags ?? [], favorite: false,
    approval: 'draft', missing: false, provenance: meta.provenance,
  };
  await db.transaction('rw', [db.assets, db.blobs, db.thumbs], async () => {
    await db.assets.put({ ...record, projectId });
    await db.blobs.put({ id, data: blob });
    if ((meta.kind ?? 'derived') === 'derived' || mime.startsWith('image/')) {
      const thumb = await makeThumbnail(blob).catch(() => null);
      if (thumb) await db.thumbs.put({ id, data: thumb.blob });
    }
  });
  return record;
}

export async function updateAsset(id: string, patch: Partial<AssetRecord>): Promise<void> {
  await db.assets.update(id, patch);
}

export async function deleteAsset(id: string): Promise<void> {
  await db.transaction('rw', [db.assets, db.blobs, db.thumbs], async () => {
    await db.assets.delete(id);
    await db.blobs.delete(id);
    await db.thumbs.delete(id);
  });
  revokeUrl(id);
  revokeUrl(`thumb:${id}`);
}

// --- Object URL cache with explicit lifecycle ---

const urlCache = new Map<string, string>();
const urlRefs = new Map<string, number>();

export async function objectUrlFor(assetId: string): Promise<string | null> {
  const cached = urlCache.get(assetId);
  if (cached) {
    urlRefs.set(assetId, (urlRefs.get(assetId) ?? 0) + 1);
    return cached;
  }
  const blob = await getAssetBlob(assetId);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(assetId, url);
  urlRefs.set(assetId, 1);
  return url;
}

export async function thumbUrlFor(assetId: string): Promise<string | null> {
  const key = `thumb:${assetId}`;
  const cached = urlCache.get(key);
  if (cached) return cached;
  const row = await db.thumbs.get(assetId);
  const blob = row?.data ?? (await getAssetBlob(assetId));
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

export function releaseUrl(assetId: string): void {
  const refs = (urlRefs.get(assetId) ?? 1) - 1;
  if (refs <= 0) {
    const url = urlCache.get(assetId);
    if (url) URL.revokeObjectURL(url);
    urlCache.delete(assetId);
    urlRefs.delete(assetId);
  } else {
    urlRefs.set(assetId, refs);
  }
}

function revokeUrl(assetId: string): void {
  const url = urlCache.get(assetId);
  if (url) URL.revokeObjectURL(url);
  urlCache.delete(assetId);
  urlRefs.delete(assetId);
}

export function revokeAllUrls(): void {
  for (const url of urlCache.values()) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
  urlCache.clear();
  urlRefs.clear();
}
