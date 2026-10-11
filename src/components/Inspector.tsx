import { useMemo } from 'react';
import { useGraphStore } from '../stores/graphStore';
import { useAssetStore } from '../stores/assetStore';
import { getNodeDef } from '../graph/registry';
import { validateGraph } from '../graph/validation';

export function Inspector() {
  const selected = useGraphStore((s) => s.selectedNodeIds);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const node = nodes.find((n) => n.id === selected[0]);
  const assets = useAssetStore((s) => s.assets);

  const issues = useMemo(() => {
    if (!node) return [];
    return validateGraph({ schemaVersion: 3, nodes, edges }).filter((i) => i.nodeId === node.id);
  }, [node, nodes, edges]);

  if (!node) {
    const all = validateGraph({ schemaVersion: 3, nodes, edges });
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
          <div key={k} className={`issue${i.severity === 'warning' ? ' warning' : ''}`}>{i.message}</div>
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
            onChange={(e) => set(Number(e.target.value))} aria-label={props.label} />
          <span style={{ minWidth: 44, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11 }}>{String(value)}</span>
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
        <select value={String(value ?? '')} onChange={(e) => set(e.target.value)}>
          <option value="">— select asset —</option>
          {props.assets.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.kind})</option>)}
        </select>
      )}
      {props.description && <div className="hint">{props.description}</div>}
    </div>
  );
}
