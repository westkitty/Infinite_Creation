import { useEffect, useMemo, useRef, useState } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useFocusTrap } from '../lib/focusTrap';
import { useGraphStore } from '../stores/graphStore';
import { NODE_DEFS } from '../graph/registry';

interface Entry {
  key: string;
  label: React.ReactNode;
  run: () => void;
}

export function CommandPalette(props: { onRun: () => void; onSave: () => void; onOpenProjects: () => void }) {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, open);
  useEffect(() => { if (open) { setQ(''); setActive(0); } }, [open]);
  useEffect(() => { setActive(0); }, [q]);

  const query = q.trim().toLowerCase();
  const actions: Entry[] = useMemo(() => {
    const all: Entry[] = [
      { key: 'run', label: '▶ Run workflow', run: props.onRun },
      { key: 'save', label: '💾 Save project', run: props.onSave },
      { key: 'projects', label: '📁 Open projects…', run: props.onOpenProjects },
      { key: 'undo', label: '↩ Undo', run: () => useGraphStore.getState().undo() },
      { key: 'redo', label: '↪ Redo', run: () => useGraphStore.getState().redo() },
      { key: 'shortcuts', label: '⌨ Keyboard shortcuts', run: () => useUIStore.getState().setShortcutsOpen(true) },
    ];
    if (!query) return all;
    return all.filter((a) => String((a.label as string) ?? '').toLowerCase().includes(query));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const matches = useMemo(
    () => NODE_DEFS.filter((d) => !d.unavailable && (!query || (d.label + ' ' + d.type).toLowerCase().includes(query))),
    [query],
  );
  const nodeEntries: Entry[] = useMemo(
    () => matches.slice(0, 12).map((d) => ({
      key: d.type,
      label: (<><span>+ {d.label}</span><span className="badge">{d.family}</span></>),
      run: () => useGraphStore.getState().addNode(d.type, { x: 200 + Math.random() * 160, y: 160 + Math.random() * 120 }),
    })),
    [matches],
  );
  const flat = useMemo(() => [...actions, ...nodeEntries], [actions, nodeEntries]);

  // Keep the highlighted item visible while arrowing.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  const close = () => setOpen(false);
  const fire = (e: Entry) => { e.run(); close(); };
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal" ref={trapRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Command palette">
        <input className="cmdk-input" autoFocus placeholder="Search nodes and actions… (↑↓ + Enter)" value={q}
          onChange={(e) => setQ(e.target.value)}
          role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={`cmdk-${active}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (flat.length ? (a + 1) % flat.length : 0)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0)); }
            else if (e.key === 'Enter') { const e2 = flat[active]; if (e2) fire(e2); }
          }} />
        <div className="cmdk-list" id="cmdk-list" ref={listRef} role="listbox" aria-label="Results">
          {flat.length === 0 && (
            <p style={{ color: 'var(--text-2)', fontSize: 12, padding: '8px 10px' }}>
              No matches for “{q.trim()}”. Try a node name (“blur”), a family (“image”), or an action (“run”).
            </p>
          )}
          {actions.length > 0 && <div className="cmdk-section">Actions ({actions.length})</div>}
          {actions.map((a, i) => (
            <Item key={a.key} idx={i} active={active} setActive={setActive} onFire={() => fire(a)}>{a.label}</Item>
          ))}
          {nodeEntries.length > 0 && <div className="cmdk-section">Nodes — showing {nodeEntries.length} of {matches.length}</div>}
          {nodeEntries.map((n, k) => (
            <Item key={n.key} idx={actions.length + k} active={active} setActive={setActive} onFire={() => fire(n)}>{n.label}</Item>
          ))}
        </div>
        <div className="cmdk-foot"><span className="kbd">↑↓</span> navigate · <span className="kbd">Enter</span> run · <span className="kbd">Esc</span> close</div>
      </div>
    </div>
  );
}

function Item(props: { idx: number; active: number; setActive: (n: number) => void; onFire: () => void; children: React.ReactNode }) {
  const hot = props.idx === props.active;
  return (
    <button id={`cmdk-${props.idx}`} data-idx={props.idx} role="option" aria-selected={hot}
      className={`cmdk-item${hot ? ' active' : ''}`}
      onMouseEnter={() => props.setActive(props.idx)}
      onClick={props.onFire}>
      {props.children}
    </button>
  );
}
