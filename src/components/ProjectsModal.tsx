import { useEffect, useState } from 'react';
import type { ProjectMeta } from '../types/graph';
import { createProject, deleteProject, duplicateProject, listProjects, renameProject } from '../persistence/projectService';

export function ProjectsModal(props: { open: boolean; onClose: () => void; onOpen: (id: string) => void; currentId: string | null }) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [name, setName] = useState('');
  const refresh = () => listProjects().then(setProjects);
  useEffect(() => { if (props.open) { refresh(); setName(''); } }, [props.open]);
  if (!props.open) return null;
  return (
    <div className="modal-back" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">Projects <span className="spacer" /><button className="icon-btn" onClick={props.onClose}>✕</button></div>
        <div className="panel-body">
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <input className="search" placeholder="New project name…" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn primary" onClick={async () => { const p = await createProject(name || 'Untitled Project'); await refresh(); props.onOpen(p.id); }}>Create</button>
          </div>
          <table className="kv"><thead><tr><th>Name</th><th>Updated</th><th>Actions</th></tr></thead><tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>{p.name}{p.id === props.currentId ? ' ●' : ''}</td>
                <td>{new Date(p.updatedAt).toLocaleString()}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button className="btn" onClick={() => props.onOpen(p.id)}>Open</button>
                    <button className="btn" onClick={async () => { const n = prompt('Rename project', p.name); if (n) { await renameProject(p.id, n); refresh(); } }}>Rename</button>
                    <button className="btn" onClick={async () => { await duplicateProject(p.id); refresh(); }}>Duplicate</button>
                    <button className="btn danger" onClick={async () => { if (confirm(`Delete "${p.name}"? This removes its assets and runs.`)) { await deleteProject(p.id); refresh(); } }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody></table>
          {projects.length === 0 && <p style={{ color: 'var(--text-2)' }}>No projects yet.</p>}
        </div>
      </div>
    </div>
  );
}
