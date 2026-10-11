import { useCallback, useEffect, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { LeftPanel, RightPanel, BottomPanel } from './components/Panels';
import { GraphCanvas } from './components/GraphCanvas';
import { ProjectsModal } from './components/ProjectsModal';
import { CommandPalette } from './components/CommandPalette';
import { AssetLibrary } from './components/AssetLibrary';
import { StorageBar } from './components/StorageBar';
import { PreviewPanel } from './components/PreviewPanel';
import { ProvenancePanel } from './components/ProvenancePanel';
import { ModelViewer } from './three/ModelViewer';
import { captureViewerSnapshot } from './three/snapshotBridge';
import { ExportWorkspace } from './components/ExportWorkspace';
import { downloadText, exportWorkflowJSON, importWorkflowJSON, pickFile } from './export/workflowJson';
import { useGraphStore } from './stores/graphStore';
import { useUIStore } from './stores/uiStore';
import { useExecStore } from './stores/execStore';
import { createProject, listProjects, loadProject, saveProject } from './persistence/projectService';
import { cancelRun, executeGraph, isRunning } from './engine/scheduler';
import { defaultTimeline } from './persistence/projectService';
import { emptyGraph } from './graph/migration';

export default function App() {
  const [projectsOpen, setProjectsOpen] = useState(false);
  const setSaveStatus = useUIStore((s) => s.setSaveStatus);
  const log = useExecStore((s) => s.log);
  const running = useExecStore((s) => s.running);
  const dirty = useGraphStore((s) => s.dirty);
  const workspace = useUIStore((s) => s.workspace);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) void openProject(id);
    };
    window.addEventListener('ics-open-project', handler);
    return () => window.removeEventListener('ics-open-project', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Boot: open most recent project or create one.
  useEffect(() => {
    (async () => {
      const all = await listProjects();
      if (all.length > 0) {
        await openProject(all[0].id);
      } else {
        const p = await createProject('My First Production');
        await openProject(p.id);
      }
      log('Studio ready. Project storage: IndexedDB (local-first).');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openProject = useCallback(async (id: string) => {
    const loaded = await loadProject(id);
    if (!loaded) return;
    useGraphStore.getState().loadProject(loaded.meta.id, loaded.meta.name, loaded.graph ?? emptyGraph(), loaded.timeline ?? defaultTimeline());
    setSaveStatus('saved');
    setProjectsOpen(false);
  }, [setSaveStatus]);

  const doSave = useCallback(async () => {
    const st = useGraphStore.getState();
    if (!st.projectId) return;
    setSaveStatus('saving');
    try {
      await saveProject(st.projectId, st.projectName, st.getDoc(), st.timeline);
      st.markClean();
      setSaveStatus('saved');
    } catch (e) {
      setSaveStatus('error');
      log(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [setSaveStatus, log]);

  // Autosave (debounced 1.5s after changes).
  useEffect(() => {
    if (!dirty) return;
    setSaveStatus('dirty');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void doSave(); }, 1500);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [dirty, doSave, setSaveStatus]);

  const handleRun = useCallback(() => {
    const st = useGraphStore.getState();
    if (!st.projectId) { log('No project open.'); return; }
    if (isRunning()) { log('A run is already in progress.'); return; }
    if (st.nodes.length === 0) { log('Nothing to run: the workflow is empty.'); return; }
    void executeGraph({ projectId: st.projectId, doc: st.getDoc(), timeline: st.timeline, captureSnapshot: captureViewerSnapshot }).catch((e) => {
      log(`Run failed to start: ${e instanceof Error ? e.message : String(e)}`);
    });
  }, [log]);
  const handleCancel = useCallback(() => {
    if (!isRunning()) { log('No run in progress.'); return; }
    cancelRun();
    log('Cancellation requested…');
  }, [log]);
  const handleExportJSON = useCallback(() => {
    const st = useGraphStore.getState();
    downloadText(`${st.projectName.replace(/[^\w\- ]+/g, '_')}.workflow.json`, exportWorkflowJSON(st.projectName, st.getDoc(), st.timeline));
    log('Workflow JSON exported.');
  }, [log]);
  const handleImportJSON = useCallback(() => {
    void (async () => {
      const f = await pickFile('application/json,.json');
      if (!f) return;
      try {
        const { graph, timeline, warnings } = importWorkflowJSON(await f.text());
        const st = useGraphStore.getState();
        st.loadProject(st.projectId ?? 'p_import', st.projectName, graph, timeline ?? defaultTimeline());
        for (const w of warnings) log(`Import warning: ${w}`);
        log(`Workflow imported from ${f.name}.`);
      } catch (e) {
        log(`Workflow import failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, [log]);
  const handleSample = useCallback((_id: string) => { log('Sample projects arrive in Phase 8 (after the pipeline works).'); }, [log]);

  return (
    <div className="app">
      <TopBar
        onRun={handleRun} onCancel={handleCancel} onSave={() => void doSave()}
        onOpenProjects={() => setProjectsOpen(true)}
        onExportJSON={handleExportJSON} onImportJSON={handleImportJSON} onLoadSample={handleSample}
        running={running}
      />
      <div className="main">
        <LeftPanel />
        <div className="center">
          {workspace === 'CREATE' || workspace === 'ANIMATE' ? (
            <GraphCanvas />
          ) : workspace === 'ASSETS' ? (
            <div className="canvas-wrap" style={{ overflow: 'auto', padding: 12 }}>
              <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                <h2 style={{ margin: '0 0 8px' }}>Assets</h2>
                <StorageBar />
                <AssetLibrary />
              </div>
            </div>
          ) : workspace === 'INSPECT' ? (
            <InspectWorkspace />
          ) : workspace === 'EXPORT' ? (
            <div className="canvas-wrap" style={{ overflow: 'auto', padding: 12 }}>
              <ExportWorkspace />
            </div>
          ) : (
            <WorkspacePlaceholder />
          )}
          <BottomPanel />
        </div>
        <RightPanel />
      </div>
      <ProjectsModal open={projectsOpen} onClose={() => setProjectsOpen(false)} onOpen={(id) => void openProject(id)} currentId={useGraphStore((s) => s.projectId)} />
      <CommandPalette onRun={handleRun} onSave={() => void doSave()} onOpenProjects={() => setProjectsOpen(true)} />
    </div>
  );
}

function InspectWorkspace() {
  const [tab, setTab] = useState<'preview' | 'model' | 'lineage'>('preview');
  return (
    <div className="canvas-wrap" style={{ overflow: 'auto', padding: 12 }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <h2 style={{ margin: '0 0 8px' }}>Inspect</h2>
        <div className="tabs" style={{ padding: 0, marginBottom: 8 }}>
          <button className={`tab${tab === 'preview' ? ' active' : ''}`} onClick={() => setTab('preview')}>Node preview</button>
          <button className={`tab${tab === 'model' ? ' active' : ''}`} onClick={() => setTab('model')}>3D viewer</button>
          <button className={`tab${tab === 'lineage' ? ' active' : ''}`} onClick={() => setTab('lineage')}>Provenance</button>
        </div>
        {tab === 'preview' && <PreviewPanel />}
        {tab === 'model' && <ModelViewer />}
        {tab === 'lineage' && <ProvenancePanel />}
      </div>
    </div>
  );
}

function WorkspacePlaceholder() {
  const ws = useUIStore((s) => s.workspace);
  const setWs = useUIStore((s) => s.setWorkspace);
  const copy: Record<string, string> = {
    ASSETS: '',
    INSPECT: '',
    EXPORT: '',
  };
  return (
    <div className="canvas-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 520, textAlign: 'center', color: 'var(--text-1)' }}>
        <h2 style={{ marginBottom: 8 }}>{ws}</h2>
        <p>{copy[ws] ?? ''}</p>
        <button className="btn primary" onClick={() => setWs('CREATE')}>Back to CREATE</button>
      </div>
    </div>
  );
}
