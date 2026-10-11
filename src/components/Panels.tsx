import { useState } from 'react';
import { useUIStore } from '../stores/uiStore';
import { NodeBrowser } from './NodeBrowser';
import { Inspector } from './Inspector';
import { useExecStore } from '../stores/execStore';
import { useGraphStore } from '../stores/graphStore';
import { AssetLibrary } from './AssetLibrary';
import { TimelineEditor } from './TimelineEditor';
import { PreviewPanel } from './PreviewPanel';
import { retryFailedNodes } from '../engine/scheduler';

export function LeftPanel() {
  const collapsed = useUIStore((s) => s.leftCollapsed);
  const toggle = useUIStore((s) => s.toggleLeft);
  const ws = useUIStore((s) => s.workspace);
  const [tab, setTab] = useState<'nodes' | 'assets'>(ws === 'ASSETS' ? 'assets' : 'nodes');
  if (collapsed) return <aside className="panel-left collapsed"><div className="panel-header"><button className="icon-btn" onClick={toggle} aria-label="Expand left panel">»</button></div></aside>;
  return (
    <aside className="panel-left">
      <div className="panel-header">Library <span className="spacer" /><button className="icon-btn" onClick={toggle} aria-label="Collapse left panel">«</button></div>
      <div className="tabs">
        <button className={`tab${tab === 'nodes' ? ' active' : ''}`} onClick={() => setTab('nodes')}>Nodes</button>
        <button className={`tab${tab === 'assets' ? ' active' : ''}`} onClick={() => setTab('assets')}>Assets</button>
      </div>
      <div className="panel-body">
        {tab === 'nodes'
          ? <NodeBrowser onAdd={(type) => useGraphStore.getState().addNode(type, { x: 120 + Math.random() * 200, y: 120 + Math.random() * 200 })} />
          : <AssetLibrary compact />}
      </div>
    </aside>
  );
}

export function RightPanel() {
  const collapsed = useUIStore((s) => s.rightCollapsed);
  const toggle = useUIStore((s) => s.toggleRight);
  const [tab, setTab] = useState<'inspector' | 'preview'>('inspector');
  if (collapsed) return <aside className="panel-right collapsed"><div className="panel-header"><button className="icon-btn" onClick={toggle} aria-label="Expand right panel">«</button></div></aside>;
  return (
    <aside className="panel-right">
      <div className="panel-header">Inspector <span className="spacer" /><button className="icon-btn" onClick={toggle} aria-label="Collapse right panel">»</button></div>
      <div className="tabs">
        <button className={`tab${tab === 'inspector' ? ' active' : ''}`} onClick={() => setTab('inspector')}>Parameters</button>
        <button className={`tab${tab === 'preview' ? ' active' : ''}`} onClick={() => setTab('preview')}>Preview</button>
      </div>
      <div className="panel-body">{tab === 'inspector' ? <Inspector /> : <PreviewPanel />}</div>
    </aside>
  );
}

export function BottomPanel() {
  const collapsed = useUIStore((s) => s.bottomCollapsed);
  const toggle = useUIStore((s) => s.toggleBottom);
  const ws = useUIStore((s) => s.workspace);
  const [tab, setTab] = useState<'queue' | 'timeline' | 'diagnostics'>(ws === 'ANIMATE' ? 'timeline' : 'queue');
  const progress = useExecStore((s) => s.progress);
  const running = useExecStore((s) => s.running);
  const nodeRuns = useExecStore((s) => s.nodeRuns);
  const diagnostics = useExecStore((s) => s.diagnostics);
  const cacheStats = useExecStore((s) => s.cacheStats);
  if (collapsed) return <div className="bottom collapsed"><div className="panel-header"><button className="icon-btn" onClick={toggle}>▲</button> Queue / Timeline / Diagnostics</div></div>;
  return (
    <div className="bottom">
      <div className="panel-header">
        <div className="tabs" style={{ padding: 0 }}>
          <button className={`tab${tab === 'queue' ? ' active' : ''}`} onClick={() => setTab('queue')}>Execution queue</button>
          <button className={`tab${tab === 'timeline' ? ' active' : ''}`} onClick={() => setTab('timeline')}>Timeline</button>
          <button className={`tab${tab === 'diagnostics' ? ' active' : ''}`} onClick={() => setTab('diagnostics')}>Diagnostics</button>
        </div>
        <span className="spacer" />
        {running && <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{progress.done}/{progress.total}</span>}
        <button className="icon-btn" onClick={toggle} aria-label="Collapse bottom panel">▼</button>
      </div>
      <div className="panel-body">
        {tab === 'queue' && (
          <div>
            {running && <div className="progressbar" style={{ marginBottom: 8 }}><div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>}
            <table className="kv"><thead><tr><th>Node</th><th>Status</th><th>Duration</th><th>Cache</th><th>Detail</th></tr></thead>
              <tbody>
                {Object.values(nodeRuns).length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text-2)' }}>No runs yet. Press Run to execute the workflow.</td></tr>}
                {Object.values(nodeRuns).map((r) => (
                  <tr key={r.nodeId}><td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{r.nodeId}</td>
                    <td><span className="badge">{r.status}</span></td>
                    <td>{r.durationMs !== undefined ? `${r.durationMs.toFixed(1)} ms` : '—'}</td>
                    <td>{r.cacheHit ? 'hit' : 'miss'}</td>
                    <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.error ?? r.outputHash ?? '—'}</td></tr>
                ))}
              </tbody></table>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
              <button className="btn" disabled={running || !Object.values(nodeRuns).some((r) => r.status === 'failed' || r.status === 'blocked')}
                onClick={() => {
                  const st = useGraphStore.getState();
                  if (st.projectId) void retryFailedNodes({ projectId: st.projectId, doc: st.getDoc(), timeline: st.timeline });
                }}>Retry failed</button>
              <span style={{ color: 'var(--text-2)', fontSize: 11 }}>Cache: {cacheStats.hits} hits · {cacheStats.misses} misses · {cacheStats.evictions} evictions</span>
            </div>
          </div>
        )}
        {tab === 'timeline' && <TimelineEditor />}
        {tab === 'diagnostics' && (
          <div>
            <div style={{ marginBottom: 6 }}><button className="btn" onClick={() => useExecStore.getState().clearLogs()}>Clear</button></div>
            <div className="log">{diagnostics.length === 0 ? 'No diagnostics yet.' : diagnostics.map((d, i) => <div key={i} className="logline">{d}</div>)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
