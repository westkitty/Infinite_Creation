import { useEffect, useRef, useState } from 'react';
import { BatchModal } from './BatchModal';
import { listProviders } from '../providers/registry';
import { cacheInspector } from '../engine/scheduler';
import { resultCache } from '../engine/cache';
import { formatBytes } from '../lib/ids';
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
  useEffect(() => { if (ws === 'ASSETS') setTab('assets'); }, [ws]);
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
  useEffect(() => { if (ws === 'ANIMATE') setTab('timeline'); }, [ws]);
  const progress = useExecStore((s) => s.progress);
  const running = useExecStore((s) => s.running);
  const nodeRuns = useExecStore((s) => s.nodeRuns);
  const diagnostics = useExecStore((s) => s.diagnostics);
  const cacheStats = useExecStore((s) => s.cacheStats);
  const [batchOpen, setBatchOpen] = useState(false);
  const [heatmap, setHeatmap] = useState(false);
  const [cacheTick, setCacheTick] = useState(0);
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
        <button className="btn" onClick={() => setBatchOpen(true)} title="Run this workflow against multiple images">Batch…</button>
        <button className="icon-btn" onClick={toggle} aria-label="Collapse bottom panel">▼</button>
      </div>
      <div className="panel-body">
        {tab === 'queue' && (
          <div>
            {running && <div className="progressbar" style={{ marginBottom: 8 }}><div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>}
            <div style={{ marginBottom: 6 }}>
              <label style={{ fontSize: 11 }}><input type="checkbox" checked={heatmap} onChange={(e) => setHeatmap(e.target.checked)} /> execution heatmap (sort by measured duration)</label>
            </div>
            <table className="kv"><thead><tr><th>Node</th><th>Status</th><th>Duration</th><th>Cache</th><th>Detail</th></tr></thead>
              <tbody>
                {Object.values(nodeRuns).length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text-2)' }}>No runs yet. Press Run to execute the workflow.</td></tr>}
                {(heatmap
                  ? [...Object.values(nodeRuns)].sort((a, b) => (b.durationMs ?? -1) - (a.durationMs ?? -1))
                  : Object.values(nodeRuns)
                ).map((r) => {
                  const max = Math.max(1, ...Object.values(nodeRuns).map((x) => x.durationMs ?? 0));
                  const intensity = heatmap && r.durationMs !== undefined ? Math.min(0.5, (r.durationMs / max) * 0.5) : 0;
                  return (
                    <tr key={r.nodeId} style={intensity ? { background: `rgba(200,16,46,${intensity})` } : undefined}>
                      <td><button className="node-link" title="Select this node on the canvas"
                        onClick={() => useGraphStore.getState().setSelected([r.nodeId])}>{r.nodeId}</button></td>
                      <td><span className="badge">{r.status}</span></td>
                      <td>{r.durationMs !== undefined ? `${r.durationMs.toFixed(1)} ms` : '—'}</td>
                      <td>{r.cacheHit ? 'hit' : 'miss'}</td>
                      <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.error ?? r.outputHash ?? '—'}</td>
                    </tr>
                  );
                })}
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
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <DiagnosticsLog lines={diagnostics} />
            </div>
            <div style={{ width: 340, flex: 'none' }}>
              <h4 style={{ margin: '0 0 4px', fontSize: 12 }}>Provider adapters</h4>
              {listProviders().map((pr) => (
                <div key={pr.providerId} style={{ fontSize: 11, marginBottom: 4 }}>
                  <span className="badge">{pr.state}</span> <strong>{pr.providerId}</strong>
                  <span style={{ color: 'var(--text-2)' }}> · {pr.note}</span>
                </div>
              ))}
              <p style={{ fontSize: 11, color: 'var(--text-2)' }}>Offline image processing never depends on providers. Custom adapters register via <span style={{ fontFamily: 'var(--mono)' }}>registerProvider()</span>.</p>
              <h4 style={{ margin: '8px 0 4px', fontSize: 12 }}>Cache inspector</h4>
              <CacheInspector tick={cacheTick} onRefresh={() => setCacheTick((t) => t + 1)} />
            </div>
          </div>
        )}
        <BatchModal open={batchOpen} onClose={() => setBatchOpen(false)} />
      </div>
    </div>
  );
}

function DiagnosticsLog({ lines }: { lines: string[] }) {
  const [follow, setFollow] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length, follow]);
  return (
    <div>
      <div style={{ marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn" onClick={() => useExecStore.getState().clearLogs()}>Clear</button>
        <label style={{ fontSize: 11, color: 'var(--text-2)' }}>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow new lines
        </label>
      </div>
      <div className="log log-scroll" ref={ref} role="log" aria-live={follow ? 'polite' : 'off'}>
        {lines.length === 0 ? 'No diagnostics yet.' : lines.map((d, i) => <div key={i} className="logline">{d}</div>)}
      </div>
    </div>
  );
}

function CacheInspector({ tick, onRefresh }: { tick: number; onRefresh: () => void }) {
  void tick;
  const entries = cacheInspector();
  const stats = resultCache.stats();
  return (
    <div style={{ fontSize: 11 }}>
      <div style={{ marginBottom: 4, color: 'var(--text-1)' }}>
        {stats.entries} entries · {formatBytes(stats.bytes)} · {stats.evictions} evictions{' '}
        <button className="btn" onClick={onRefresh}>Refresh</button>{' '}
        <button className="btn" onClick={() => { resultCache.invalidateAll(); onRefresh(); }}>Clear</button>
      </div>
      <div style={{ maxHeight: 150, overflow: 'auto' }}>
        {entries.length === 0 && <span style={{ color: 'var(--text-2)' }}>Cache empty.</span>}
        {entries.map((e) => (
          <div key={e.nodeId} style={{ fontFamily: 'var(--mono)', fontSize: 10, marginBottom: 2 }}>
            {e.nodeId.slice(0, 14)} · key {e.key} · {formatBytes(e.bytes)} · age {(e.ageMs / 1000).toFixed(0)}s
          </div>
        ))}
      </div>
    </div>
  );
}
