import { useEffect, useMemo, useState } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useGraphStore } from '../stores/graphStore';
import { NODE_DEFS } from '../graph/registry';

export function CommandPalette(props: { onRun: () => void; onSave: () => void; onOpenProjects: () => void }) {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const [q, setQ] = useState('');
  useEffect(() => { if (open) setQ(''); }, [open ]);
  const query = q.trim().toLowerCase();
  const nodes = useMemo(
    () => NODE_DEFS.filter((d) => !d.unavailable && (!query || (d.label + ' ' + d.type).toLowerCase().includes(query))).slice(0, 12),
    [query],
  );
  if (!open) return null;
  const close = () => setOpen(false);
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <input className="cmdk-input" autoFocus placeholder="Search nodes and actions…" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') close(); }} />
        <div className="cmdk-list">
          <button className="cmdk-item" onClick={() => { props.onRun(); close(); }}>▶ Run workflow</button>
          <button className="cmdk-item" onClick={() => { props.onSave(); close(); }}>💾 Save project</button>
          <button className="cmdk-item" onClick={() => { props.onOpenProjects(); close(); }}>📁 Open projects…</button>
          <button className="cmdk-item" onClick={() => { useGraphStore.getState().undo(); close(); }}>↩ Undo</button>
          <button className="cmdk-item" onClick={() => { useGraphStore.getState().redo(); close(); }}>↪ Redo</button>
          {nodes.map((d) => (
            <button key={d.type} className="cmdk-item"
              onClick={() => { useGraphStore.getState().addNode(d.type, { x: 200 + Math.random() * 160, y: 160 + Math.random() * 120 }); close(); }}>
              <span>+ {d.label}</span><span className="badge">{d.family}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
