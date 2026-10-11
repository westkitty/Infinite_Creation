import { useMemo, useState } from 'react';
import { nodeFamilies } from '../graph/registry';

export function NodeBrowser({ onAdd }: { onAdd?: (type: string) => void }) {
  const [q, setQ] = useState('');
  const fams = useMemo(() => nodeFamilies(), []);
  const query = q.trim().toLowerCase();
  return (
    <div>
      <input
        className="search" placeholder="Search nodes…" aria-label="Search nodes"
        value={q} onChange={(e) => setQ(e.target.value)}
      />
      {fams.map(({ family, defs }) => {
        const list = query ? defs.filter((d) => (d.label + ' ' + d.type + ' ' + d.description).toLowerCase().includes(query)) : defs;
        if (!list.length) return null;
        return (
          <div className="nodefam" key={family}>
            <h4>{family.replace('_', ' ')}</h4>
            {list.map((d) => (
              <button
                key={d.type}
                className={`nodeitem${d.unavailable ? ' unavailable' : ''}`}
                draggable={!d.unavailable}
                title={d.unavailable ? d.unavailableReason : d.description}
                onDragStart={(e) => e.dataTransfer.setData('application/ics-node', d.type)}
                onClick={() => !d.unavailable && onAdd?.(d.type)}
              >
                <span>{d.label}</span>
                <span className="fam">v{d.version}</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
