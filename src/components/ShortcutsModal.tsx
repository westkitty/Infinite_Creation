import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';

const GROUPS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: 'Global',
    rows: [
      ['Ctrl/⌘ K', 'Command palette (nodes + actions)'],
      ['Ctrl/⌘ S', 'Save project now'],
      ['?', 'This shortcut reference'],
      ['Esc', 'Close dialog / menu'],
    ],
  },
  {
    title: 'Canvas',
    rows: [
      ['Ctrl/⌘ Z', 'Undo'],
      ['Ctrl/⌘ Shift Z / Ctrl Y', 'Redo'],
      ['Ctrl/⌘ D', 'Duplicate selected nodes'],
      ['Ctrl/⌘ C / Ctrl/⌘ V', 'Copy / paste selection'],
      ['Delete / Backspace', 'Delete selected nodes and edges'],
      ['Shift + drag', 'Multi-select nodes'],
    ],
  },
  {
    title: 'Command palette',
    rows: [
      ['↑ / ↓', 'Move highlight'],
      ['Enter', 'Run highlighted item'],
      ['Esc', 'Close'],
    ],
  },
  {
    title: 'Timeline ruler (when focused)',
    rows: [
      ['← / →', 'Step one frame'],
      ['Shift + ← / →', 'Step one second'],
      ['Home / End', 'Go to start / end'],
    ],
  },
  {
    title: 'Preview stage (when focused)',
    rows: [
      ['+ / −', 'Zoom in / out'],
      ['Arrow keys', 'Pan'],
      ['0', 'Reset zoom and pan'],
    ],
  },
];

export function ShortcutsModal() {
  const open = useUIStore((s) => s.shortcutsOpen);
  const setOpen = useUIStore((s) => s.setShortcutsOpen);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  if (!open) return null;
  return (
    <div className="modal-back" onClick={() => setOpen(false)}>
      <div className="modal" style={{ width: 'min(560px, 94vw)' }} onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="panel-header">Keyboard shortcuts <span className="spacer" />
          <button className="icon-btn" autoFocus onClick={() => setOpen(false)} aria-label="Close shortcuts">✕</button>
        </div>
        <div className="panel-body">
          {GROUPS.map((g) => (
            <div key={g.title} style={{ marginBottom: 10 }}>
              <h4 style={{ margin: '0 0 4px', fontSize: 12 }}>{g.title}</h4>
              <table className="kv"><tbody>
                {g.rows.map(([keys, what]) => (
                  <tr key={keys + what}>
                    <td style={{ width: 200 }}><span className="kbd">{keys}</span></td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
