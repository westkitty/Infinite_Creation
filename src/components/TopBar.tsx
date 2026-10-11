import { useState } from 'react';
import { useUIStore, type Workspace } from '../stores/uiStore';
import { useGraphStore } from '../stores/graphStore';

const WORKSPACES: Workspace[] = ['CREATE', 'ASSETS', 'ANIMATE', 'INSPECT', 'EXPORT'];

export function TopBar(props: {
  onRun: () => void;
  onCancel: () => void;
  onSave: () => void;
  onOpenProjects: () => void;
  onExportJSON: () => void;
  onImportJSON: () => void;
  onLoadSample: (id: string) => void;
  running: boolean;
}) {
  const ws = useUIStore((s) => s.workspace);
  const setWs = useUIStore((s) => s.setWorkspace);
  const saveStatus = useUIStore((s) => s.saveStatus);
  const projectName = useGraphStore((s) => s.projectName);
  const [fileOpen, setFileOpen] = useState(false);
  const [samplesOpen, setSamplesOpen] = useState(false);

  return (
    <header className="topbar">
      <div className="brand">INFINITE CREATION<small>STUDIO · OMNI</small></div>
      <nav className="workspace-tabs" aria-label="Workspaces">
        {WORKSPACES.map((w) => (
          <button key={w} className={`ws-tab${ws === w ? ' active' : ''}`} onClick={() => setWs(w)} aria-pressed={ws === w}>{w}</button>
        ))}
      </nav>
      <div className="spacer" />
      <span className={`save-dot ${saveStatus}`} title={saveStatus === 'saved' ? 'All changes saved' : saveStatus}>
        <span className="dot" />{projectName} · {saveStatus}
      </span>
      <div style={{ position: 'relative' }}>
        <button className="btn" onClick={() => { setFileOpen(!fileOpen); setSamplesOpen(false); }}>File ▾</button>
        {fileOpen && (
          <div className="modal" style={{ position: 'absolute', right: 0, top: 34, width: 220, zIndex: 30, padding: 6 }}>
            <button className="cmdk-item" onClick={() => { props.onOpenProjects(); setFileOpen(false); }}>Projects…</button>
            <button className="cmdk-item" onClick={() => { props.onSave(); setFileOpen(false); }}>Save now</button>
            <button className="cmdk-item" onClick={() => { props.onExportJSON(); setFileOpen(false); }}>Export workflow JSON</button>
            <button className="cmdk-item" onClick={() => { props.onImportJSON(); setFileOpen(false); }}>Import workflow JSON…</button>
          </div>
        )}
      </div>
      <div style={{ position: 'relative' }}>
        <button className="btn" onClick={() => { setSamplesOpen(!samplesOpen); setFileOpen(false); }}>Samples ▾</button>
        {samplesOpen && (
          <div className="modal" style={{ position: 'absolute', right: 0, top: 34, width: 260, zIndex: 30, padding: 6 }}>
            <button className="cmdk-item" onClick={() => { props.onLoadSample('A'); setSamplesOpen(false); }}>A · Image production pipeline</button>
            <button className="cmdk-item" onClick={() => { props.onLoadSample('B'); setSamplesOpen(false); }}>B · Social asset factory</button>
            <button className="cmdk-item" onClick={() => { props.onLoadSample('C'); setSamplesOpen(false); }}>C · Animated image sequence</button>
          </div>
        )}
      </div>
      <button className="btn ghost" title="Command palette (Ctrl K)" onClick={() => useUIStore.getState().setCommandPaletteOpen(true)}>⌘K</button>
      {!props.running
        ? <button className="btn primary" onClick={props.onRun} title="Validate and execute the workflow">▶ Run</button>
        : <button className="btn danger" onClick={props.onCancel} title="Cancel execution">■ Cancel</button>}
    </header>
  );
}
