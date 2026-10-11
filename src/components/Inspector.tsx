import React, { useMemo } from 'react';
import { useGraphStore } from '../stores/graphStore';
import { useAssetStore } from '../stores/assetStore';
import { getNodeDef } from '../graph/registry';
import { downstreamNodeIds, upstreamNodeIds, validateGraph } from '../graph/validation';

export function Inspector() {
  const selected = useGraphStore((s) => s.selectedNodeIds);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const node = nodes.find((n) => n.id === selected[0]);
  const assets = useAssetStore((s) => s.assets);

  const issues = useMemo(() => {
    if (!node) return [];
    return validateGraph({ nodes, edges }).filter((i) => i.nodeId === node.id);
  }, [node, nodes, edges]);

  if (!node) {
    const all = validateGraph({ nodes, edges });
    const errors = all.filter((i) => i.severity === 'error');
    return (
      <div>
        <h3 style={{ margin: '4px 0 8px', fontSize: 13 }}>Project Health</h3>
        <p style={{ color: 'var(--text-2)', fontSize: 12 }}>Select a node to edit its parameters.</p>
        <table className="kv"><tbody>
          <tr><td>Nodes</td><td>{nodes.length}</td></tr>
          <tr><td>Edges</td><td>{edges.length}</td></tr>
          <tr><td>Errors</td><td>{errors.length}</td></tr>
          <tr><td>Warnings</td><td>{all.length - errors.length}</td></tr>
        </tbody></table>
        {all.slice(0, 20).map((i, k) => (
          i.nodeId ? (
            <button key={k} className={`issue clickable${i.severity === 'warning' ? ' warning' : ''}`}
              title="Select this node" onClick={() => useGraphStore.getState().setSelected([i.nodeId as string])}>{i.message}</button>
          ) : (
            <div key={k} className={`issue${i.severity === 'warning' ? ' warning' : ''}`}>{i.message}</div>
          )
        ))}
        {all.length === 0 && <p style={{ color: 'var(--text-2)' }}>No issues detected.</p>}
      </div>
    );
  }

  const def = getNodeDef(node.type);
  if (!def) return <div>Unknown node type {node.type}</div>;
  const st = useGraphStore.getState();

  return (
    <div>
      <h3 style={{ margin: '4px 0 2px', fontSize: 13 }}>{node.data.label || def.label}</h3>
      <p style={{ color: 'var(--text-2)', fontSize: 11, margin: '0 0 8px' }}>{def.type} · v{def.version} · {def.family}</p>
      <p style={{ fontSize: 12, color: 'var(--text-1)' }}>{def.description}</p>
      {def.unavailable && <div className="issue">{def.unavailableReason}</div>}
      {issues.map((i, k) => (
        <div key={k} className={`issue${i.severity === 'warning' ? ' warning' : ''}`}>{i.message}</div>
      ))}
      <div className="field">
        <label>Display label</label>
        <input type="text" value={node.data.label ?? ''} placeholder={def.label}
          onChange={(e) => st.updateNodeData(node.id, { label: e.target.value })} />
      </div>
      <div className="field checkrow">
        <input type="checkbox" id="node-disabled" checked={!!node.data.disabled}
          onChange={(e) => st.updateNodeData(node.id, { disabled: e.target.checked })} />
        <label htmlFor="node-disabled">Disable node (skip execution)</label>
      </div>
      <PresetRow nodeType={node.type} nodeId={node.id} />
      {def.params.map((p) => {
        const v = (node.data.params as Record<string, unknown>)[p.key] ?? p.default;
        return (
          <ParamField key={p.key} nodeId={node.id} paramKey={p.key} label={p.label}
            type={p.type} value={v} min={p.min} max={p.max} step={p.step}
            options={p.options} description={p.description} assets={assets} />
        );
      })}
      <div className="field">
        <label>Note</label>
        <textarea rows={2} value={node.data.note ?? ''} placeholder="Annotation for this node…"
          onChange={(e) => st.updateNodeData(node.id, { note: e.target.value })} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => st.duplicateNodes([node.id])}>Duplicate</button>
        <button className="btn danger" onClick={() => st.removeNodes([node.id])}>Delete</button>
      </div>
      <LinkSection nodeId={node.id} />
      <DependencySection nodeId={node.id} />
    </div>
  );
}

function LinkSection({ nodeId }: { nodeId: string }) {
  const nodes = useGraphStore((s) => s.nodes);
  const links = useGraphStore((s) => s.links);
  const node = nodes.find((n) => n.id === nodeId);
  const def = node ? getNodeDef(node.type) : undefined;
  const [srcNode, setSrcNode] = React.useState('');
  const [srcKey, setSrcKey] = React.useState('');
  const [tgtKey, setTgtKey] = React.useState('');
  if (!node || !def) return null;
  const linkable = def.params.filter((p) => p.type === 'number' || p.type === 'slider' || p.type === 'color');
  if (linkable.length === 0) return null;
  const incoming = links.filter((l) => l.targetNodeId === nodeId);
  const st = useGraphStore.getState();
  const srcDef = srcNode ? getNodeDef(nodes.find((n) => n.id === srcNode)?.type ?? '') : undefined;
  const srcKeys = srcDef?.params.filter((p) => p.type === 'number' || p.type === 'slider' || p.type === 'color') ?? [];
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
      <h4 style={{ margin: '0 0 6px', fontSize: 12 }}>Parameter links</h4>
      <p style={{ fontSize: 11, color: 'var(--text-2)' }}>One driver per target param; numeric↔numeric, color↔color; one level (cycle-free).</p>
      {incoming.map((l) => (
        <div key={l.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 4 }}>
          <span className="badge" title={l.sourceNodeId}>{l.sourceKey}</span>→<span className="badge">{l.targetKey}</span>
          <button className="icon-btn" title="Remove link" onClick={() => st.removeLink(l.id)}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
        <select value={srcNode} onChange={(e) => { setSrcNode(e.target.value); setSrcKey(''); }} aria-label="Driver node" style={linkSel}>
          <option value="">driver node…</option>
          {nodes.filter((n) => n.id !== nodeId).map((n) => <option key={n.id} value={n.id}>{n.data.label || n.type} ({n.id.slice(0, 8)})</option>)}
        </select>
        <select value={srcKey} onChange={(e) => setSrcKey(e.target.value)} aria-label="Driver param" style={linkSel}>
          <option value="">param…</option>
          {srcKeys.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <select value={tgtKey} onChange={(e) => setTgtKey(e.target.value)} aria-label="Target param" style={linkSel}>
          <option value="">drives…</option>
          {linkable.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <button className="btn" disabled={!srcNode || !srcKey || !tgtKey}
          onClick={() => { const id = st.addLink(srcNode, srcKey, nodeId, tgtKey); if (id) { setSrcKey(''); setTgtKey(''); } }}>
          Link</button>
      </div>
    </div>
  );
}

const linkSel: React.CSSProperties = { background: 'var(--bg-0)', border: '1px solid var(--line)', borderRadius: 6, padding: '5px 6px', fontSize: 11, maxWidth: 150 };

function DependencySection({ nodeId }: { nodeId: string }) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const up = upstreamNodeIds({ nodes, edges }, nodeId);
  const down = downstreamNodeIds({ nodes, edges }, nodeId);
  const label = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return n ? `${n.data.label || n.type}` : id;
  };
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
      <h4 style={{ margin: '0 0 6px', fontSize: 12 }}>Dependencies</h4>
      <p style={{ fontSize: 12, margin: '0 0 4px' }}><strong>Upstream ({up.length}):</strong> {up.length ? up.map((id) => (
        <button key={id} className="badge" style={{ cursor: 'pointer', background: 'transparent', marginRight: 4 }} onClick={() => useGraphStore.getState().setSelected([id])}>{label(id)}</button>
      )) : 'none'}</p>
      <p style={{ fontSize: 12, margin: 0 }}><strong>Downstream ({down.length}):</strong> {down.length ? down.map((id) => (
        <button key={id} className="badge" style={{ cursor: 'pointer', background: 'transparent', marginRight: 4 }} onClick={() => useGraphStore.getState().setSelected([id])}>{label(id)}</button>
      )) : 'none'}</p>
    </div>
  );
}

function ParamField(props: {
  nodeId: string; paramKey: string; label: string;
  type: string; value: unknown; min?: number; max?: number; step?: number;
  options?: string[]; description?: string; assets: Array<{ id: string; name: string; kind: string }>;
}) {
  const st = useGraphStore.getState();
  const set = (value: unknown) => st.updateNodeParams(props.nodeId, { [props.paramKey]: value });
  const { type, value } = props;
  return (
    <div className="field">
      <label>{props.label}</label>
      {type === 'boolean' && (
        <div className="checkrow"><input type="checkbox" checked={!!value} onChange={(e) => set(e.target.checked)} /><span>Enabled</span></div>
      )}
      {type === 'number' && (
        <input type="number" value={Number(value ?? 0)} min={props.min} max={props.max} step={props.step ?? 1}
          onChange={(e) => set(Number(e.target.value))} />
      )}
      {type === 'slider' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="range" value={Number(value ?? 0)} min={props.min ?? 0} max={props.max ?? 100} step={props.step ?? 1}
            onChange={(e) => set(Number(e.target.value))} aria-label={props.label} style={{ flex: 1 }} />
          <input type="number" value={Number(value ?? 0)} min={props.min ?? 0} max={props.max ?? 100} step={props.step ?? 1}
            onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) set(n); }}
            aria-label={`${props.label} value`} title="Type an exact value"
            style={{ width: 64, background: 'var(--bg-0)', border: '1px solid var(--line)', borderRadius: 4, padding: 3, fontSize: 11, fontFamily: 'var(--mono)' }} />
        </div>
      )}
      {type === 'color' && <input type="color" value={String(value ?? '#ffffff')} onChange={(e) => set(e.target.value)} />}
      {(type === 'string' || type === 'text') && (
        type === 'text'
          ? <textarea rows={3} value={String(value ?? '')} onChange={(e) => set(e.target.value)} />
          : <input type="text" value={String(value ?? '')} onChange={(e) => set(e.target.value)} />
      )}
      {type === 'select' && (
        <select value={String(value ?? '')} onChange={(e) => set(e.target.value)}>
          {(props.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      {type === 'assetRef' && (
        <>
          <select value={String(value ?? '')} onChange={(e) => set(e.target.value)}>
            <option value="">— select asset —</option>
            {props.assets.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.kind})</option>)}
          </select>
          {String(value ?? '') !== '' && !props.assets.some((a) => a.id === String(value)) && (
            <div className="issue warning" style={{ marginTop: 6, marginBottom: 0 }}>
              Referenced asset is not in this project's library — the node will fail until it is relinked or the asset is re-imported.
            </div>
          )}
        </>
      )}
      {props.description && <div className="hint">{props.description}</div>}
    </div>
  );
}

const PRESETS: Record<string, Array<{ name: string; params: Record<string, unknown> }>> = {
  'image.exposure': [
    { name: 'Brighten', params: { brightness: 15, exposure: 0.3 } },
    { name: 'Darken', params: { brightness: -15, exposure: -0.3 } },
    { name: 'Reset', params: { brightness: 0, exposure: 0 } },
  ],
  'image.contrast': [
    { name: 'Punchy', params: { contrast: 25 } },
    { name: 'Soft', params: { contrast: -20 } },
    { name: 'Reset', params: { contrast: 0 } },
  ],
  'image.saturation': [
    { name: 'Vivid', params: { saturation: 35 } },
    { name: 'Muted', params: { saturation: -35 } },
    { name: 'B&W', params: { saturation: -100 } },
    { name: 'Reset', params: { saturation: 0 } },
  ],
  'image.colorBalance': [
    { name: 'Warm', params: { red: 12, green: 4, blue: -10 } },
    { name: 'Cool', params: { red: -10, green: 0, blue: 14 } },
    { name: 'Reset', params: { red: 0, green: 0, blue: 0 } },
  ],
  'image.blur': [
    { name: 'Subtle', params: { radius: 2 } },
    { name: 'Dreamy', params: { radius: 10 } },
    { name: 'Reset', params: { radius: 0 } },
  ],
  'image.sharpen': [
    { name: 'Crisp', params: { amount: 60 } },
    { name: 'Reset', params: { amount: 0 } },
  ],
};

function PresetRow({ nodeType, nodeId }: { nodeType: string; nodeId: string }) {
  const presets = PRESETS[nodeType];
  if (!presets) return null;
  return (
    <div className="field">
      <label>Presets (reversible — parameters only)</label>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {presets.map((pr) => (
          <button key={pr.name} className="btn" onClick={() => useGraphStore.getState().updateNodeParams(nodeId, pr.params)}>
            {pr.name}
          </button>
        ))}
      </div>
    </div>
  );
}
