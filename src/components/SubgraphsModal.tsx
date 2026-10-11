import { useEffect, useState } from 'react';
import { useGraphStore } from '../stores/graphStore';
import { useExecStore } from '../stores/execStore';
import { analyzeSelection, deleteSubgraph, instantiateSubgraph, listSubgraphs, saveSubgraph } from '../subgraphs/library';
import type { SubgraphRow } from '../assets/db';

export function SubgraphsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const selected = useGraphStore((s) => s.selectedNodeIds);
  const log = useExecStore((s) => s.log);
  const [defs, setDefs] = useState<SubgraphRow[]>([]);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const refresh = () => listSubgraphs().then(setDefs).catch((e) => log(`Subgraph list failed: ${String(e)}`));
  useEffect(() => { if (open) { refresh(); setName(''); setDesc(''); } }, [open ]);

  if (!open) return null;
  const st = useGraphStore.getState();
  const analysis = analyzeSelection({ nodes: st.nodes, edges: st.edges }, selected);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ width: 'min(640px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">Reusable subgraphs <span className="spacer" /><button className="icon-btn" onClick={onClose}>✕</button></div>
        <div className="panel-body">
          <h4 style={{ margin: '0 0 6px' }}>Save current selection ({selected.length} nodes)</h4>
          {analysis.problems.length > 0 && <div className="issue">{analysis.problems[0]}</div>}
          {analysis.problems.length === 0 && (
            <div>
              <p style={{ fontSize: 12, color: 'var(--text-1)' }}>
                Public inputs: {analysis.publicInputs.map((p) => p.name).join(', ') || '—'}<br />
                Public outputs: {analysis.publicOutputs.map((p) => p.name).join(', ') || '—'}
              </p>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                <input className="search" style={{ flex: 1, minWidth: 160 }} placeholder="Name, e.g. Portrait crop + correction"
                  value={name} onChange={(e) => setName(e.target.value)} />
                <input className="search" style={{ flex: 1, minWidth: 160 }} placeholder="Description (optional)"
                  value={desc} onChange={(e) => setDesc(e.target.value)} />
                <button className="btn primary" disabled={!name.trim()} onClick={() => {
                  saveSubgraph(name, desc || undefined, { nodes: st.nodes, edges: st.edges }, analysis)
                    .then((row) => { log(`Saved subgraph "${row.name}" (v${row.version})`); setName(''); setDesc(''); refresh(); })
                    .catch((e) => log(`Save failed: ${e instanceof Error ? e.message : String(e)}`));
                }}>Save</button>
              </div>
            </div>
          )}
          <h4 style={{ margin: '8px 0 6px' }}>Library ({defs.length})</h4>
          {defs.length === 0 && <p style={{ color: 'var(--text-2)', fontSize: 12 }}>No saved subgraphs yet.</p>}
          {defs.map((d) => (
            <div key={d.id} style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 8, padding: 8, marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <strong style={{ fontSize: 13 }}>{d.name}</strong>
                <span className="badge">v{d.version}</span>
                <span className="badge">{d.graph.nodes.length} nodes</span>
                <span className="badge">{d.publicInputs.length} in / {d.publicOutputs.length} out</span>
                <span style={{ flex: 1 }} />
                <button className="btn" title="Insert as ordinary nodes (executes through the same engine)"
                  onClick={() => {
                    const { nodes, edges } = instantiateSubgraph(d, { x: 200, y: 200 });
                    // Insert via store primitives to preserve history/validation.
                    const g = useGraphStore.getState();
                    const past = { nodes: JSON.parse(JSON.stringify(g.nodes)), edges: JSON.parse(JSON.stringify(g.edges)), links: JSON.parse(JSON.stringify(g.links)) };
                    useGraphStore.setState({
                      past: [...g.past, past], future: [],
                      nodes: [...g.nodes, ...nodes], edges: [...g.edges, ...edges], dirty: true,
                    });
                    log(`Inserted "${d.name}" as ${nodes.length} nodes.`);
                    onClose();
                  }}>Insert copy</button>
                <button className="btn" title="Copy the definition ID for a Reusable Subgraph node"
                  onClick={() => { void navigator.clipboard?.writeText(d.id).then(() => log(`Copied subgraph ID ${d.id}`)).catch(() => log(`Subgraph ID: ${d.id}`)); }}>
                  Copy ID</button>
                <button className="btn danger" onClick={() => {
                  if (confirm(`Delete subgraph "${d.name}"? Workflows that already inserted copies are unaffected.`)) {
                    void deleteSubgraph(d.id).then(refresh);
                  }
                }}>Delete</button>
              </div>
              {d.description && <p style={{ fontSize: 12, color: 'var(--text-1)', margin: '4px 0 0' }}>{d.description}</p>}
              <p style={{ fontSize: 11, color: 'var(--text-2)', margin: '4px 0 0', fontFamily: 'var(--mono)' }}>ID: {d.id}</p>
            </div>
          ))}
          <p style={{ fontSize: 11, color: 'var(--text-2)' }}>
            Inserted copies are ordinary nodes and execute through the same engine. A <em>Reusable Subgraph</em> node
            references a definition ID and is expanded inline at run time (single-input/single-output definitions only; no nesting).
          </p>
        </div>
      </div>
    </div>
  );
}
