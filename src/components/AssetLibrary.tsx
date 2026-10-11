import { useAssetStore } from '../stores/assetStore';

// Phase 1 placeholder — full implementation lands in Phase 4 (asset management).
export function AssetLibrary({ compact = false }: { compact?: boolean }) {
  const assets = useAssetStore((s) => s.assets);
  void compact;
  if (assets.length === 0) {
    return <p style={{ color: 'var(--text-2)', fontSize: 12 }}>No assets yet. Asset import arrives in Phase 2/4 — the library, thumbnails, search and tagging are scaffolded behind this panel.</p>;
  }
  return (
    <div className="asset-grid">
      {assets.map((a) => (
        <div key={a.id} className="asset-card"><div className="meta"><div className="name">{a.name}</div><div className="sub">{a.kind} · {a.mime}</div></div></div>
      ))}
    </div>
  );
}
