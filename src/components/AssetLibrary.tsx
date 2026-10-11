import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssetStore } from '../stores/assetStore';
import { useGraphStore } from '../stores/graphStore';
import { useExecStore } from '../stores/execStore';
import { deleteAsset, importFile, listAssets, thumbUrlFor, updateAsset } from '../assets/repository';
import { findAssetReferences, relinkAsset, verifyProjectAssets } from '../assets/recovery';
import { formatBytes } from '../lib/ids';
import type { AssetRecord } from '../types/graph';

export function VerifyButton() {
  const projectId = useGraphStore((s) => s.projectId);
  const log = useExecStore((s) => s.log);
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn" disabled={!projectId || busy} title="Check every asset record for its stored binary"
      onClick={() => {
        if (!projectId) return;
        setBusy(true);
        verifyProjectAssets(projectId)
          .then((r) => log(`Library verified: ${r.healthy}/${r.checked} healthy${r.missing.length ? `, ${r.missing.length} missing: ${r.missing.join(', ')}` : ''}`))
          .catch((e) => log(`Verification failed: ${e instanceof Error ? e.message : String(e)}`))
          .finally(() => setBusy(false));
      }}>
      {busy ? 'Verifying…' : 'Verify library'}
    </button>
  );
}

export function AssetLibrary({ compact = false }: { compact?: boolean }) {
  const projectId = useGraphStore((s) => s.projectId);
  const assets = useAssetStore((s) => s.assets);
  const search = useAssetStore((s) => s.search);
  const kindFilter = useAssetStore((s) => s.kindFilter);
  const favOnly = useAssetStore((s) => s.showFavoritesOnly);
  const sortKey = useAssetStore((s) => s.sortKey);
  const selectedId = useAssetStore((s) => s.selectedAssetId);
  const st = useAssetStore.getState();
  const log = useExecStore((s) => s.log);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!projectId) return;
    listAssets(projectId).then((a) => useAssetStore.getState().setAssets(a)).catch((e) => log(`Asset load failed: ${String(e)}`));
  }, [projectId, log]);

  const doImport = async (files: FileList | File[]) => {
    if (!projectId || busy) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        try {
          const r = await importFile(projectId, f);
          st.upsert(r.asset);
          log(r.deduplicated ? `Import deduplicated (already in library): ${f.name}` : `Imported ${f.name} (${formatBytes(f.size)})`);
          if (r.warning) log(`Import warning for ${f.name}: ${r.warning}`);
        } catch (e) {
          log(`Import failed for ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = assets.filter((a) => (kindFilter === 'all' || a.kind === kindFilter) && (!favOnly || a.favorite));
    if (q) list = list.filter((a) => (a.name + ' ' + a.mime + ' ' + a.tags.join(' ')).toLowerCase().includes(q));
    const sorted = [...list];
    if (sortKey === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortKey === 'size') sorted.sort((a, b) => b.size - a.size);
    else sorted.sort((a, b) => b.createdAt - a.createdAt);
    return sorted;
  }, [assets, search, kindFilter, favOnly, sortKey]);

  const selected = assets.find((a) => a.id === selectedId) ?? null;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) void doImport(e.dataTransfer.files); }}
      style={{ border: dragOver ? '1px dashed var(--info)' : '1px dashed transparent', borderRadius: 8, minHeight: 120 }}
    >
      <input ref={fileRef} type="file" multiple hidden
        accept="image/*,audio/*,video/*,.glb,.gltf"
        onChange={(e) => { if (e.target.files?.length) void doImport(e.target.files); e.target.value = ''; }} />
      {!compact && <div style={{ marginBottom: 8 }}><VerifyButton /></div>}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button className="btn primary" disabled={busy || !projectId} onClick={() => fileRef.current?.click()}>
          {busy ? 'Importing…' : '+ Import'}
        </button>
        {!compact && (
          <span style={{ color: 'var(--text-2)', fontSize: 11, alignSelf: 'center' }}>or drag &amp; drop files here</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <input className="search" style={{ flex: 1, minWidth: 120 }} placeholder="Search assets…" aria-label="Search assets"
          value={search} onChange={(e) => st.setSearch(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <select value={kindFilter} onChange={(e) => st.setKindFilter(e.target.value)} aria-label="Filter by kind"
          style={{ background: 'var(--bg-0)', border: '1px solid var(--line)', borderRadius: 6, padding: '5px 6px', fontSize: 12 }}>
          <option value="all">All kinds</option>
          <option value="image">Images</option>
          <option value="audio">Audio</option>
          <option value="video">Video</option>
          <option value="model3d">3D models</option>
          <option value="derived">Derived</option>
          <option value="artifact">Artifacts</option>
        </select>
        <select value={sortKey} onChange={(e) => st.setSortKey(e.target.value as 'createdAt' | 'name' | 'size')} aria-label="Sort assets"
          style={{ background: 'var(--bg-0)', border: '1px solid var(--line)', borderRadius: 6, padding: '5px 6px', fontSize: 12 }}>
          <option value="createdAt">Newest</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
        </select>
        <button className={`btn${favOnly ? ' primary' : ''}`} onClick={() => st.setFavoritesOnly(!favOnly)}
          title="Show favorites only" aria-pressed={favOnly} aria-label="Show favorites only">★</button>
        {(search.trim() !== '' || kindFilter !== 'all' || favOnly) && (
          <button className="btn ghost" title="Clear search and filters"
            onClick={() => { st.setSearch(''); st.setKindFilter('all'); st.setFavoritesOnly(false); }}>
            ✕ Clear
          </button>
        )}
        <span style={{ color: 'var(--text-2)', fontSize: 11, alignSelf: 'center', marginLeft: 'auto' }} aria-live="polite">
          {filtered.length} of {assets.length} asset{assets.length === 1 ? '' : 's'}
        </span>
      </div>
      {filtered.length === 0 && (
        <p style={{ color: 'var(--text-2)', fontSize: 12 }}>
          {assets.length === 0 ? 'No assets yet — import an image to start the production slice.' : 'No assets match the current filters.'}
        </p>
      )}
      <div className="asset-grid">
        {filtered.map((a) => (
          <AssetCard key={a.id} asset={a} selected={a.id === selectedId} onSelect={() => st.setSelectedAsset(a.id === selectedId ? null : a.id)} />
        ))}
      </div>
      {selected && <AssetDetails asset={selected} />}
    </div>
  );
}

function AssetCard({ asset, selected, onSelect }: { asset: AssetRecord; selected: boolean; onSelect: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        thumbUrlFor(asset.id).then((u) => { if (alive) setUrl(u); }).catch(() => {});
        io.disconnect();
      }
    });
    io.observe(el);
    return () => { alive = false; io.disconnect(); };
  }, [asset.id]);
  return (
    <div ref={ref} className={`asset-card${selected ? ' selected' : ''}`} onClick={onSelect} role="button" tabIndex={0}
      aria-label={`Asset ${asset.name}`} aria-pressed={selected}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
      }}>
      {url && asset.kind !== 'audio' ? <img src={url} alt="" loading="lazy" /> : (
        <div className="thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)', fontSize: 20 }}>
          {asset.kind === 'audio' ? '♪' : asset.kind === 'video' ? '▶' : asset.kind === 'model3d' ? '⬢' : '🖼'}
        </div>
      )}
      <div className="meta">
        <div className="name" title={asset.name}>{asset.name}</div>
        <div className="sub">{formatBytes(asset.size)}{asset.width ? ` · ${asset.width}×${asset.height}` : ''}</div>
        <div className="badges">
          <span className="badge">{asset.kind}</span>
          {asset.favorite && <span className="badge">★</span>}
          {asset.missing && <span className="badge err">missing</span>}
          {asset.approval !== 'draft' && <span className="badge info">{asset.approval}</span>}
        </div>
      </div>
    </div>
  );
}

export function AssetDetails({ asset }: { asset: AssetRecord }) {
  const st = useAssetStore.getState();
  const log = useExecStore((s) => s.log);
  const [tagInput, setTagInput] = useState('');
  const nodes = useGraphStore((s) => s.nodes);
  const refs = findAssetReferences({ nodes }, asset.id);
  const relinkRef = useRef<HTMLInputElement>(null);
  // Revision note: edited via a local draft and committed to IndexedDB on a
  // 500ms debounce, so every keystroke does not round-trip storage + store.
  const [noteDraft, setNoteDraft] = useState(asset.note ?? '');
  const noteTimer = useRef<number | null>(null);
  const noteDraftRef = useRef(asset.note ?? '');
  const noteIdRef = useRef(asset.id);
  const commitNote = (id: string, note: string) => {
    // Spread the store's fresh row (not this render's prop) so a debounced
    // commit cannot clobber concurrent edits such as tag add/remove.
    const current = useAssetStore.getState().assets.find((row) => row.id === id) ?? asset;
    void updateAsset(id, { note }).then(() => {
      useAssetStore.getState().upsert({ ...current, note });
    });
  };
  const queueNote = (id: string, value: string) => {
    noteDraftRef.current = value;
    if (noteTimer.current !== null) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => {
      noteTimer.current = null;
      commitNote(id, value);
    }, 500);
  };
  useEffect(() => {
    // Selection changed: flush any edit pending for the previous asset first.
    if (noteTimer.current !== null && noteIdRef.current !== asset.id) {
      window.clearTimeout(noteTimer.current);
      noteTimer.current = null;
      commitNote(noteIdRef.current, noteDraftRef.current);
    }
    noteIdRef.current = asset.id;
    noteDraftRef.current = asset.note ?? '';
    setNoteDraft(asset.note ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id]);
  useEffect(() => () => {
    // Unmount with a pending edit: commit it instead of dropping it.
    if (noteTimer.current !== null) {
      window.clearTimeout(noteTimer.current);
      noteTimer.current = null;
      commitNote(noteIdRef.current, noteDraftRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
      <input ref={relinkRef} type="file" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) {
          relinkAsset(asset.id, f, f.name)
            .then(() => log(`Relinked ${asset.name} → ${f.name}`))
            .catch((err) => log(`Relink failed: ${err instanceof Error ? err.message : String(err)}`));
        }
        e.target.value = '';
      }} />
      <h4 style={{ margin: '0 0 6px', fontSize: 12 }}>{asset.name}</h4>
      {asset.missing && (
        <div className="issue">
          Binary missing from storage. Workflows referencing this asset will fail until it is relinked.
          <div style={{ marginTop: 6 }}><button className="btn primary" onClick={() => relinkRef.current?.click()}>Relink file…</button></div>
        </div>
      )}
      <table className="kv"><tbody>
        <tr><td>Kind</td><td>{asset.kind} · {asset.mime}</td></tr>
        <tr><td>Size</td><td>{formatBytes(asset.size)}</td></tr>
        {asset.width !== undefined && <tr><td>Dimensions</td><td>{asset.width} × {asset.height}</td></tr>}
        {asset.duration !== undefined && <tr><td>Duration</td><td>{asset.duration.toFixed(2)} s</td></tr>}
        <tr><td>Imported</td><td>{new Date(asset.createdAt).toLocaleString()}</td></tr>
        <tr><td>Hash</td><td style={{ fontFamily: 'var(--mono)', fontSize: 10, wordBreak: 'break-all' }}>{asset.hash}</td></tr>
        {asset.provenance?.nodeType && (
          <tr><td>Provenance</td><td>{asset.provenance.nodeType} v{asset.provenance.nodeVersion} · run {(asset.provenance.runId ?? '—').slice(0, 12)}</td></tr>
        )}
        <tr><td>Referenced by</td><td>{refs.length === 0 ? 'no nodes' : refs.map((r) => `${r.nodeType} (${r.nodeId.slice(0, 10)})`).join(', ')}</td></tr>
      </tbody></table>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => { void updateAsset(asset.id, { favorite: !asset.favorite }).then(() => st.upsert({ ...asset, favorite: !asset.favorite })); }}>
          {asset.favorite ? 'Unfavorite' : 'Favorite'}
        </button>
        <select value={asset.approval} aria-label="Approval state"
          onChange={(e) => { const approval = e.target.value as AssetRecord['approval']; void updateAsset(asset.id, { approval }).then(() => st.upsert({ ...asset, approval })); }}
          style={{ background: 'var(--bg-0)', border: '1px solid var(--line)', borderRadius: 6, padding: '5px 6px', fontSize: 12 }}>
          {['draft', 'review', 'approved', 'rejected', 'superseded'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn danger" onClick={() => {
          if (confirm(`Delete asset "${asset.name}"? Workflows referencing it will report a missing asset.`)) {
            void deleteAsset(asset.id).then(() => { st.remove(asset.id); st.setSelectedAsset(null); log(`Deleted asset ${asset.name}`); });
          }
        }}>Delete</button>
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Revision note</label>
        <textarea rows={2} value={noteDraft} placeholder="Note for this revision…"
          onChange={(e) => { const note = e.target.value; setNoteDraft(note); queueNote(asset.id, note); }} />
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
          {asset.tags.map((t) => (
            <button key={t} className="badge" style={{ cursor: 'pointer', background: 'transparent' }} title="Remove tag"
              onClick={() => { const tags = asset.tags.filter((x) => x !== t); void updateAsset(asset.id, { tags }).then(() => st.upsert({ ...asset, tags })); }}>
              {t} ✕
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="search" placeholder="Add tag…" aria-label="New tag" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tagInput.trim()) {
                const tags = [...new Set([...asset.tags, tagInput.trim().toLowerCase()])];
                void updateAsset(asset.id, { tags }).then(() => st.upsert({ ...asset, tags }));
                setTagInput('');
              }
            }} />
          <button className="btn" disabled={!tagInput.trim()} title="Add tag"
            onClick={() => {
              const tags = [...new Set([...asset.tags, tagInput.trim().toLowerCase()])];
              void updateAsset(asset.id, { tags }).then(() => st.upsert({ ...asset, tags }));
              setTagInput('');
            }}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
