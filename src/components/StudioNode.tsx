import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getNodeDef } from '../graph/registry';
import { useExecStore } from '../stores/execStore';

export interface StudioNodeData extends Record<string, unknown> {
  nodeId: string;
  nodeType: string;
  label?: string;
  disabled?: boolean;
  note?: string;
}

function StudioNodeInner({ data, selected }: NodeProps) {
  const d = data as unknown as StudioNodeData;
  const def = getNodeDef(d.nodeType);
  const status = useExecStore((s) => s.nodeStatus[d.nodeId] ?? 'idle');
  const out = useExecStore((s) => s.outputs[d.nodeId]);
  if (!def) return <div className="studio-node"><div className="head"><span className="title">Unknown: {d.nodeType}</span></div></div>;
  const title = d.label || def.label;
  const stale = !!out?.stale && status !== 'failed';
  const failed = status === 'failed' || status === 'blocked';
  return (
    <div
      className={`studio-node${selected ? ' selected' : ''}${d.disabled ? ' disabled' : ''}${def.unavailable ? ' unavailable' : ''}${stale ? ' stale' : ''}${failed ? ' failed' : ''}`}
      role="group"
      aria-label={`${title} (${def.family}), status ${status}${stale ? ', output stale' : ''}`}
      title={def.description}
    >
      <div className="head">
        <span className={`status ${status}`} title={`Status: ${status}${out?.stale ? ' (stale)' : ''}`} aria-label={`Status ${status}`} />
        <span className="title" title={def.description}>{title}</span>
        <span className="famtag">{def.family}</span>
      </div>
      <div className="ports">
        <div>
          {def.inputs.map((p, i) => (
            <div className="pin in" key={p.id}>
              <Handle type="target" position={Position.Left} id={p.id} style={{ top: 24 + i * 22 }} title={`${p.label} : ${p.dataType}${p.required ? ' (required)' : ''}`} />
              {p.label}
            </div>
          ))}
        </div>
        <div>
          {def.outputs.map((p, i) => (
            <div className="pin out" key={p.id}>
              {p.label}
              <Handle type="source" position={Position.Right} id={p.id} style={{ top: 24 + i * 22 }} title={`${p.label} : ${p.dataType}`} />
            </div>
          ))}
        </div>
      </div>
      <div className="foot" title={def.description}>
        {def.unavailable ? 'UNAVAILABLE' : d.disabled ? 'disabled' : failed ? `${status} — see queue` : stale ? 'stale — run again' : def.description.slice(0, 48)}
      </div>
    </div>
  );
}

export const StudioNode = memo(StudioNodeInner);
