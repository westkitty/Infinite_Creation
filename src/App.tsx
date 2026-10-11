import { useCallback, useEffect, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { LeftPanel, RightPanel, BottomPanel } from './components/Panels';
import { GraphCanvas } from './components/GraphCanvas';
import { ProjectsModal } from './components/ProjectsModal';
import { CommandPalette } from './components/CommandPalette';
import { useGraphStore } from './stores/graphStore';
import { useUIStore } from './stores/uiStore';
import { useExecStore } from './stores/execStore';
import { createProject, listProjects, loadProject, saveProject } from './persistence/projectService';
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
    log('Phase 1: execution engine arrives in Phase 3. Graph editing + persistence are live.');
  }, [log]);
  const handleCancel = useCallback(() => { log('Nothing to cancel yet (Phase 3).'); }, [log]);
  const handleExportJSON = useCallback(() => { log('Workflow JSON export arrives in Phase 7.'); }, [log]);
  const handleImportJSON = useCallback(() => { log('Workflow JSON import arrives in Phase 7.'); }, [log]);
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

function WorkspacePlaceholder() {
  const ws = useUIStore((s) => s.workspace);
  const setWs = useUIStore((s) => s.setWorkspace);
  const copy: Record<string, string> = {
    ASSETS: 'The ASSETS workspace (full library, tagging, search) is implemented in Phase 4. The Assets tab in the left panel is its preview.',
    INSPECT: 'The INSPECT workspace (large preview + provenance) is implemented in Phase 5. Use the Preview tab on the right today.',
    EXPORT: 'The EXPORT workspace (artifacts + packaging) is implemented in Phases 2/7. Export nodes land with the media pipeline.',
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
