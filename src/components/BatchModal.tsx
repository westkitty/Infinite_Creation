import { useEffect, useMemo, useRef, useState } from 'react';
import { useFocusTrap } from '../lib/focusTrap';
import { useGraphStore } from '../stores/graphStore';
import { useAssetStore } from '../stores/assetStore';
import { useExecStore } from '../stores/execStore';
import { cancelRun, executeGraph, isRunning } from '../engine/scheduler';

interface BatchItem { assetId: string; name: string; status: 'pending' | 'running' | 'ok' | 'failed' | 'cancelled'; error?: string }

export function BatchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nodes = useGraphStore((s) => s.nodes);
  const assets = useAssetStore((s) => s.assets);
  const log = useExecStore((s) => s.log);
  const sources = useMemo(() => nodes.filter((n) => n.type === 'source.imageImport'), [nodes]);
  const images = useMemo(() => assets.filter((a) => a.kind === 'image' || a.kind === 'derived'), [assets]);
  const [sourceNodeId, setSourceNodeId] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, open);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!open || running) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, running, onClose]);

  if (!open) return null;
  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChecked(next);
  };
  const done = items.filter((i) => i.status === 'ok' || i.status === 'failed' || i.status === 'cancelled').length;

  const run = async () => {
    const st = useGraphStore.getState();
    if (!st.projectId || !sourceNodeId || checked.size === 0 || isRunning()) return;
    cancelRef.current = false;
    setRunning(true);
    const queue = images.filter((a) => checked.has(a.id));
    setItems(queue.map((a) => ({ assetId: a.id, name: a.name, status: 'pending' })));
    // Sequential execution (bounded concurrency = 1): each item runs the full
    // workflow with the source node repointed. Memory-safe for large batches.
    for (const a of queue) {
      if (cancelRef.current) break;
      setItems((prev) => prev.map((i) => (i.assetId === a.id ? { ...i, status: 'running' } : i)));
      const doc = st.getDoc();
      const target = doc.nodes.find((n) => n.id === sourceNodeId);
      if (!target) {
        setItems((prev) => prev.map((i) => (i.assetId === a.id ? { ...i, status: 'failed', error: 'source node vanished' } : i)));
        continue;
      }
      (target.data.params as Record<string, unknown>).assetId = a.id;
      try {
        const rec = await executeGraph({ projectId: st.projectId, doc, timeline: st.timeline });
        if (rec.status === 'completed') {
          setItems((prev) => prev.map((i) => (i.assetId === a.id ? { ...i, status: 'ok' } : i)));
          log(`Batch: ${a.name} → completed (${rec.runId})`);
        } else if (cancelRef.current) {
          setItems((prev) => prev.map((i) => (i.assetId === a.id ? { ...i, status: 'cancelled', error: rec.error ?? 'cancelled by user' } : i)));
          log(`Batch: ${a.name} → cancelled.`);
        } else {
          setItems((prev) => prev.map((i) => (i.assetId === a.id ? { ...i, status: 'failed', error: rec.error } : i)));
          log(`Batch: ${a.name} → ${rec.status}: ${rec.error}`);
        }
      } catch (e) {
        setItems((prev) => prev.map((i) => (i.assetId === a.id ? { ...i, status: 'failed', error: e instanceof Error ? e.message : String(e) } : i)));
      }
    }
    const cancelled = cancelRef.current;
    if (cancelled) {
      setItems((prev) => prev.map((i) => (
        i.status === 'running' || i.status === 'pending' ? { ...i, status: 'cancelled', error: 'cancelled by user' } : i
      )));
    }
    setRunning(false);
    log(cancelled
      ? 'Batch cancelled by user — completed items keep their artifacts.'
      : `Batch finished: ${queue.length} item(s) processed sequentially.`);
  };

  return (
    <div className="modal-back" onClick={() => { if (!running) onClose(); }}>
      <div className="modal" ref={trapRef} style={{ width: 'min(600px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">Batch processing <span className="spacer" /><button className="icon-btn" disabled={running} onClick={onClose}>✕</button></div>
        <div className="panel-body">
          <p style={{ fontSize: 12, color: 'var(--text-1)' }}>
            Run this workflow against multiple input images. The chosen Image Import node is repointed per item;
            export artifacts are saved to the library with provenance. Bounded concurrency: 1 (sequential, memory-safe).
          </p>
          {sources.length === 0 && <div className="issue">No Image Import node in this workflow — batch needs one to repoint.</div>}
          <div className="field">
            <label>Source node to repoint</label>
            <select value={sourceNodeId} autoFocus onChange={(e) => setSourceNodeId(e.target.value)}>
              <option value="">— select —</option>
              {sources.map((n) => <option key={n.id} value={n.id}>{n.data.label || n.id} ({n.id.slice(0, 12)})</option>)}
            </select>
          </div>
          <div className="field">
            <label>Input images ({checked.size} selected)
              <span style={{ marginLeft: 8, display: 'inline-flex', gap: 4 }}>
                <button className="btn ghost" style={{ padding: '1px 6px', fontSize: 11 }}
                  onClick={() => setChecked(new Set(images.map((a) => a.id)))}>Select all</button>
                <button className="btn ghost" style={{ padding: '1px 6px', fontSize: 11 }}
                  onClick={() => setChecked(new Set())}>Clear</button>
              </span>
            </label>
            <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 6, padding: 6 }}>
              {images.map((a) => (
                <label key={a.id} className="checkrow" style={{ marginBottom: 4 }}>
                  <input type="checkbox" checked={checked.has(a.id)} onChange={() => toggle(a.id)} /> {a.name}
                </label>
              ))}
              {images.length === 0 && <span style={{ color: 'var(--text-2)', fontSize: 12 }}>No images in the library.</span>}
            </div>
          </div>
          {items.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div className="progressbar"><div style={{ width: `${(done / items.length) * 100}%` }} /></div>
              <table className="kv" style={{ marginTop: 6 }}><tbody>
                {items.map((i) => (
                  <tr key={i.assetId}><td>{i.name}</td><td><span className="badge">{i.status}</span></td><td>{i.error ?? ''}</td></tr>
                ))}
              </tbody></table>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" disabled={running || !sourceNodeId || checked.size === 0 || sources.length === 0} onClick={() => void run()}>
              {running ? `Running… (${done}/${items.length})` : 'Run batch'}
            </button>
            {running && (
              <button className="btn danger" title="Stop after the current item (completed items keep their artifacts)"
                onClick={() => { cancelRef.current = true; cancelRun(); }}>
                Cancel batch
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
