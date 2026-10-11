import { useState } from 'react';
import { useGraphStore } from '../stores/graphStore';
import { useAssetStore } from '../stores/assetStore';
import { useExecStore } from '../stores/execStore';
import { downloadText, exportWorkflowJSON, importWorkflowJSON, pickFile } from '../export/workflowJson';
import { exportProjectArchive, readProjectArchive, storeImportedArchive, type ExportProgress } from '../export/archive';
import { defaultTimeline } from '../persistence/projectService';
import { objectUrlFor } from '../assets/repository';
import { formatBytes } from '../lib/ids';

export function ExportWorkspace() {
  const projectId = useGraphStore((s) => s.projectId);
  const projectName = useGraphStore((s) => s.projectName);
  const assets = useAssetStore((s) => s.assets);
  const log = useExecStore((s) => s.log);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [busy, setBusy] = useState(false);

  const artifacts = assets.filter((a) => a.kind === 'artifact');

  const doExportJSON = () => {
    const st = useGraphStore.getState();
    downloadText(`${safeName(projectName)}.workflow.json`, exportWorkflowJSON(st.projectName, st.getDoc(), st.timeline));
    log('Workflow JSON exported (graph + links + timeline; binaries stay in the library).');
  };

  const doImportJSON = async () => {
    const f = await pickFile('application/json,.json');
    if (!f) return;
    try {
      const text = await f.text();
      const { graph, timeline, warnings } = importWorkflowJSON(text);
      const st = useGraphStore.getState();
      st.loadProject(st.projectId ?? 'p_import', st.projectName, graph, timeline ?? defaultTimeline());
      for (const w of warnings) log(`Import warning: ${w}`);
      log(`Workflow imported from ${f.name} (${graph.nodes.length} nodes, ${graph.edges.length} edges). Asset references resolve against this project's library.`);
    } catch (e) {
      log(`Workflow import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const doExportArchive = async () => {
    if (!projectId || busy) return;
    setBusy(true);
    try {
      const blob = await exportProjectArchive(projectId, setProgress);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName(projectName)}.icsproj.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      log(`Project archive exported (${formatBytes(blob.size)}): manifest + graph + timeline + ${assets.length} asset records + binaries + checksums.`);
    } catch (e) {
      log(`Archive export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const doImportArchive = async (onOpen: (id: string) => void) => {
    const f = await pickFile('.zip');
    if (!f || busy) return;
    setBusy(true);
    try {
      const data = await readProjectArchive(f, setProgress);
      const newId = await storeImportedArchive(data);
      for (const w of data.warnings) log(`Archive warning: ${w}`);
      log(`Archive imported as a new project ("${data.name}", ${data.assets.length} assets, ${data.blobs.size} binaries verified).`);
      onOpen(newId);
    } catch (e) {
      log(`Archive import failed (existing projects untouched): ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 8px' }}>Export</h2>
      {progress && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12 }}>{progress.phase} — {progress.done}/{progress.total}</div>
          <div className="progressbar"><div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button className="btn primary" onClick={doExportJSON}>Export workflow JSON</button>
        <button className="btn" onClick={() => void doImportJSON()}>Import workflow JSON…</button>
        <button className="btn primary" disabled={!projectId || busy} onClick={() => void doExportArchive()}>
          {busy ? 'Working…' : 'Export project archive (.zip)'}
        </button>
        <ArchiveImportButton onPick={(open) => void doImportArchive(open)} />
      </div>
      <h3 style={{ fontSize: 13 }}>Export artifacts ({artifacts.length})</h3>
      <p style={{ fontSize: 12, color: 'var(--text-2)' }}>
        Produced by Image Export nodes during runs. Video containers (MP4/WebM) are <strong>not</strong> offered —
        timeline output is a PNG sequence (ANIMATE ▸ Timeline ▸ Export frames).
      </p>
      {artifacts.length === 0 && <p style={{ color: 'var(--text-2)', fontSize: 12 }}>No artifacts yet — add an Image Export node and run the workflow.</p>}
      <table className="kv"><tbody>
        {artifacts.map((a) => (
          <tr key={a.id}>
            <td>{a.name}</td>
            <td>{a.mime}</td>
            <td>{formatBytes(a.size)}{a.width ? ` · ${a.width}×${a.height}` : ''}</td>
            <td><button className="btn" onClick={() => void downloadAsset(a.id, a.name)}>Download</button></td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

function ArchiveImportButton({ onPick }: { onPick: (open: (id: string) => void) => void }) {
  // Needs access to App's openProject — resolved via a tiny event to avoid prop drilling.
  return <button className="btn" onClick={() => onPick((id) => window.dispatchEvent(new CustomEvent('ics-open-project', { detail: id })))}>Import project archive…</button>;
}

async function downloadAsset(assetId: string, name: string): Promise<void> {
  const log = useExecStore.getState().log;
  try {
    const url = await objectUrlFor(assetId);
    if (!url) throw new Error('Binary missing from storage');
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    log(`Downloaded ${name}`);
  } catch (e) {
    log(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function safeName(name: string): string {
  return name.trim().replace(/[^\w\- ]+/g, '_').slice(0, 60) || 'project';
}
