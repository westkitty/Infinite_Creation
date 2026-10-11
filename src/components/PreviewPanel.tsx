import { useGraphStore } from '../stores/graphStore';
import { useExecStore } from '../stores/execStore';

// Phase 1 placeholder — live media preview lands with the execution engine (Phase 2/3).
export function PreviewPanel() {
  const selected = useGraphStore((s) => s.selectedNodeIds);
  const outputs = useExecStore((s) => s.outputs);
  const nodeId = selected[0];
  const out = nodeId ? outputs[nodeId] : undefined;
  return (
    <div>
      <div className="preview-stage checker"><span style={{ color: 'var(--text-2)', fontSize: 12 }}>No preview yet — run the workflow to produce outputs.</span></div>
      {out && (
        <table className="kv" style={{ marginTop: 8 }}><tbody>
          <tr><td>Kind</td><td>{out.kind}</td></tr>
          <tr><td>Stale</td><td>{String(out.stale)}</td></tr>
        </tbody></table>
      )}
    </div>
  );
}
