import { useMemo } from 'react';
import { useAssetStore } from '../stores/assetStore';
import { useGraphStore } from '../stores/graphStore';
import { buildLineage, type LineageModel } from '../assets/lineage';

/** Lineage inspection: provenance record, producing run, siblings, children. */
export function ProvenancePanel() {
  const assets = useAssetStore((s) => s.assets);
  const selectedId = useAssetStore((s) => s.selectedAssetId);
  const nodes = useGraphStore((s) => s.nodes);

  const asset = assets.find((a) => a.id === selectedId) ?? null;

  const model: LineageModel | null = useMemo(
    () => (asset ? buildLineage(asset, assets) : null),
    [asset, assets],
  );
  const { siblings, producer } = useMemo(() => {
    if (!asset) return { siblings: [], producer: null } as {
      siblings: typeof assets;
      producer: { id: string; type: string } | null;
    };
    const sibs = asset.provenance?.nodeId
      ? assets.filter((a) => a.id !== asset.id && a.provenance?.nodeId === asset.provenance?.nodeId)
      : [];
    const prod = asset.provenance?.nodeId ? nodes.find((n) => n.id === asset.provenance?.nodeId) ?? null : null;
    return { siblings: sibs, producer: prod ? { id: prod.id, type: prod.type } : null };
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
      {model && (model.ancestorLevels.length > 0 || model.children.length > 0) && <LineageGraph model={model} />}
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
    </div>
  );
}

const COL_W = 168;
const ROW_H = 40;
const NODE_W = 148;
const NODE_H = 30;

const APPROVAL_EDGE: Record<string, string> = {
  approved: '#3fb950',
  rejected: '#f85149',
  review: '#d29922',
  superseded: '#8b909b',
  draft: 'transparent',
};

function shortName(name: string): string {
  return name.length > 22 ? `${name.slice(0, 21)}…` : name;
}

export const MAX_CHILD_COL = 60;

export function LineageGraph({ model }: { model: LineageModel }) {
  const shownChildren = useMemo(() => model.children.slice(0, MAX_CHILD_COL), [model]);
  const hiddenChildren = model.children.length - shownChildren.length;
  const columns = useMemo(() => {
    const cols = [...model.ancestorLevels, [model.self]];
    if (shownChildren.length > 0) cols.push(shownChildren);
    return cols;
  }, [model, shownChildren]);
  const pos = useMemo(() => {
    const m = new Map<string, { col: number; row: number }>();
    columns.forEach((col, c) => col.forEach((a, r) => { if (!m.has(a.id)) m.set(a.id, { col: c, row: r }); }));
    return m;
  }, [columns]);
  const edges = useMemo(() => {
    const list: Array<{ x1: number; y1: number; x2: number; y2: number; key: string }> = [];
    columns.forEach((col, c) => {
      if (c === 0) return;
      col.forEach((a, r) => {
        for (const pid of a.provenance?.parentIds ?? []) {
          const p = pos.get(pid);
          if (!p || p.col >= c) continue;
          list.push({
            x1: 10 + p.col * COL_W + NODE_W, y1: 8 + p.row * ROW_H + NODE_H / 2,
            x2: 10 + c * COL_W, y2: 8 + r * ROW_H + NODE_H / 2,
            key: `${pid}->${a.id}`,
          });
        }
      });
    });
    return list;
  }, [columns, pos]);
  const width = columns.length * COL_W + 20;
  const height = Math.max(1, ...columns.map((c) => c.length)) * ROW_H + 16;
  const shown = model.ancestorLevels.reduce((n, g) => n + g.length, 0);
  const select = (id: string) => useAssetStore.getState().setSelectedAsset(id);
  return (
    <div style={{ marginTop: 8 }}>
      <strong style={{ fontSize: 12 }}>Lineage graph — click any asset to inspect it</strong>
      <div className="lineage-scroll" style={{ marginTop: 4 }}>
        <svg width={width} height={height} role="img"
          aria-label={`Lineage graph: ${shown} ancestors shown in ${model.ancestorLevels.length} generations, ${model.children.length} derived children`}>
          {edges.map((e) => (
            <line key={e.key} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} style={{ stroke: 'var(--line)', strokeWidth: 1.5 }} />
          ))}
          {columns.map((col, c) => col.map((a, r) => {
            const x = 10 + c * COL_W;
            const y = 8 + r * ROW_H;
            const isSelf = a.id === model.self.id;
            return (
              <g key={`${c}-${a.id}`} className={isSelf ? undefined : 'lineage-node'}
                onClick={isSelf ? undefined : () => select(a.id)}
                tabIndex={isSelf ? undefined : 0} role={isSelf ? undefined : 'button'}
                aria-label={isSelf ? undefined : `Inspect ${a.name}`}
                onKeyDown={isSelf ? undefined : (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(a.id); }
                }}>
                <title>{`${a.name}\n${a.kind} · ${a.approval}`}</title>
                <rect className="body" x={x} y={y} width={NODE_W} height={NODE_H} rx={6}
                  style={{
                    fill: isSelf ? 'var(--accent-soft)' : 'var(--bg-2)',
                    stroke: isSelf ? 'var(--accent)' : 'var(--line)', strokeWidth: isSelf ? 2 : 1,
                  }} />
                <rect x={x} y={y} width={4} height={NODE_H} rx={2} fill={APPROVAL_EDGE[a.approval] ?? 'transparent'} />
                <text x={x + 10} y={y + 19} fontSize={11} style={{ fill: 'var(--text-0)' }}>
                  {shortName(a.name)}
                </text>
              </g>
            );
          }))}
        </svg>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-2)', margin: '4px 0 0' }}>
        {shown} ancestor{shown === 1 ? '' : 's'} in {model.ancestorLevels.length} generation{model.ancestorLevels.length === 1 ? '' : 's'}
        {model.hiddenAncestors > 0 && ` · +${model.hiddenAncestors} earlier hidden by the depth cap`}
        {model.missingAncestors > 0 && ` · ${model.missingAncestors} referenced ancestor${model.missingAncestors === 1 ? '' : 's'} deleted`}
        {model.children.length > 0 && ` · ${model.children.length} derived ${model.children.length === 1 ? 'child' : 'children'}${hiddenChildren > 0 ? ` (${hiddenChildren} more not drawn)` : ''}`} · oldest → newest, left → right.
      </p>
    </div>
  );
}
