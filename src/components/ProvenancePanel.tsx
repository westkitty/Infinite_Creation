import { useMemo } from 'react';
import { useAssetStore } from '../stores/assetStore';
import { useGraphStore } from '../stores/graphStore';

/** Lineage inspection: provenance record, producing run, siblings, children. */
export function ProvenancePanel() {
  const assets = useAssetStore((s) => s.assets);
  const selectedId = useAssetStore((s) => s.selectedAssetId);
  const nodes = useGraphStore((s) => s.nodes);

  const asset = assets.find((a) => a.id === selectedId) ?? null;

  const { children, siblings, producer } = useMemo(() => {
    if (!asset) return { children: [], siblings: [], producer: null } as {
      children: typeof assets; siblings: typeof assets;
      producer: { id: string; type: string } | null;
    };
    const kids = assets.filter((a) => a.provenance?.parentIds?.includes(asset.id));
    const sibs = asset.provenance?.nodeId
      ? assets.filter((a) => a.id !== asset.id && a.provenance?.nodeId === asset.provenance?.nodeId)
      : [];
    const prod = asset.provenance?.nodeId ? nodes.find((n) => n.id === asset.provenance?.nodeId) ?? null : null;
    return { children: kids, siblings: sibs, producer: prod ? { id: prod.id, type: prod.type } : null };
  }, [asset, assets, nodes]);

  if (!asset) {
    return <p style={{ color: 'var(--text-2)', fontSize: 12 }}>Select an asset (ASSETS workspace or left panel) to inspect its lineage.</p>;
  }
  const p = asset.provenance;
  return (
    <div>
      <h4 style={{ margin: '0 0 6px', fontSize: 12 }}>Lineage — {asset.name}</h4>
      {!p ? (
        <p style={{ fontSize: 12 }}>Original import — no transformations recorded. The binary is preserved exactly as imported.</p>
      ) : (
        <table className="kv"><tbody>
          <tr><td>Producing node</td><td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{p.nodeType} v{p.nodeVersion} ({(p.nodeId ?? '').slice(0, 14)})</td></tr>
          <tr><td>Execution</td><td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{p.runId ?? '—'}</td></tr>
          <tr><td>Output format</td><td>{p.outputFormat ?? '—'}</td></tr>
          <tr><td>Parents</td><td>{p.parentIds.length ? p.parentIds.join(', ') : '—'}</td></tr>
          <tr><td>Input hashes</td><td style={{ fontFamily: 'var(--mono)', fontSize: 10, wordBreak: 'break-all' }}>{p.inputHashes.join(' · ') || '—'}</td></tr>
          <tr><td>Parameters</td><td style={{ fontFamily: 'var(--mono)', fontSize: 10, wordBreak: 'break-all' }}>{JSON.stringify(p.params)}</td></tr>
        </tbody></table>
      )}
      {producer && <p style={{ fontSize: 12 }}>Producer still in graph: <span className="badge">{producer.type}</span></p>}
      {siblings.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <strong style={{ fontSize: 12 }}>Revisions from same node ({siblings.length})</strong>
          <ul style={{ fontSize: 12, paddingLeft: 18, margin: '4px 0' }}>
            {siblings.map((s) => <li key={s.id}>{s.name} — {s.approval} — {new Date(s.createdAt).toLocaleString()}</li>)}
          </ul>
          <p style={{ fontSize: 11, color: 'var(--text-2)' }}>Approved binaries are never modified; new runs create new assets (supersede via approval state).</p>
        </div>
      )}
      {children.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <strong style={{ fontSize: 12 }}>Derived children ({children.length})</strong>
          <ul style={{ fontSize: 12, paddingLeft: 18, margin: '4px 0' }}>
            {children.map((c) => <li key={c.id}>{c.name}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
