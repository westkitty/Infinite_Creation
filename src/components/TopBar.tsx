import { useEffect, useRef, useState } from 'react';
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
  const fileRef = useRef<HTMLDivElement>(null);
  const samplesRef = useRef<HTMLDivElement>(null);

  // Menus dismiss on Escape or outside pointer-down; focus moves into the menu on open.
  useEffect(() => {
    if (!fileOpen && !samplesOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFileOpen(false); setSamplesOpen(false); }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (fileRef.current && !fileRef.current.contains(t) && samplesRef.current && !samplesRef.current.contains(t)) {
        setFileOpen(false); setSamplesOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [fileOpen, samplesOpen]);

  const saveTitle =
    saveStatus === 'saved' ? 'All changes saved' :
    saveStatus === 'error' ? 'Save failed — click to retry' :
    saveStatus;

  return (
    <header className="topbar">
      <div className="brand">INFINITE CREATION<small>STUDIO · OMNI</small></div>
      <nav className="workspace-tabs" aria-label="Workspaces">
        {WORKSPACES.map((w) => (
          <button key={w} className={`ws-tab${ws === w ? ' active' : ''}`} onClick={() => setWs(w)} aria-pressed={ws === w}>{w}</button>
        ))}
      </nav>
      <div className="spacer" />
      <button
        className={`save-dot ${saveStatus}${saveStatus === 'error' ? ' clickable' : ''}`}
        title={saveTitle} aria-label={`Save status: ${saveStatus}${saveStatus === 'error' ? '. Activate to retry.' : ''}`}
        aria-live="polite" disabled={saveStatus !== 'error'} onClick={props.onSave}
      >
        <span className="dot" aria-hidden="true" />{projectName} · {saveStatus}{saveStatus === 'error' ? ' — retry?' : ''}
      </button>
      <div style={{ position: 'relative' }} ref={fileRef}>
        <button className="btn" aria-haspopup="menu" aria-expanded={fileOpen} onClick={() => { setFileOpen(!fileOpen); setSamplesOpen(false); }}>File ▾</button>
        {fileOpen && (
          <div className="modal menu-pop" role="menu" aria-label="File menu">
            <button className="cmdk-item" role="menuitem" autoFocus onClick={() => { props.onOpenProjects(); setFileOpen(false); }}>Projects…</button>
            <button className="cmdk-item" role="menuitem" onClick={() => { props.onSave(); setFileOpen(false); }}>Save now <span className="kbd">Ctrl S</span></button>
            <button className="cmdk-item" role="menuitem" onClick={() => { props.onExportJSON(); setFileOpen(false); }}>Export workflow JSON</button>
            <button className="cmdk-item" role="menuitem" onClick={() => { props.onImportJSON(); setFileOpen(false); }}>Import workflow JSON…</button>
            <button className="cmdk-item" role="menuitem" onClick={() => { useUIStore.getState().setShortcutsOpen(true); setFileOpen(false); }}>Keyboard shortcuts <span className="kbd">?</span></button>
          </div>
        )}
      </div>
      <div style={{ position: 'relative' }} ref={samplesRef}>
        <button className="btn" aria-haspopup="menu" aria-expanded={samplesOpen} onClick={() => { setSamplesOpen(!samplesOpen); setFileOpen(false); }}>Samples ▾</button>
        {samplesOpen && (
          <div className="modal menu-pop wide" role="menu" aria-label="Samples menu">
            <button className="cmdk-item" role="menuitem" autoFocus onClick={() => { props.onLoadSample('A'); setSamplesOpen(false); }}>A · Image production pipeline</button>
            <button className="cmdk-item" role="menuitem" onClick={() => { props.onLoadSample('B'); setSamplesOpen(false); }}>B · Social asset factory</button>
            <button className="cmdk-item" role="menuitem" onClick={() => { props.onLoadSample('C'); setSamplesOpen(false); }}>C · Animated image sequence</button>
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
