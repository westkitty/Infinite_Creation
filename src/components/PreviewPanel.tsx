import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../stores/graphStore';
import { useExecStore } from '../stores/execStore';
import { useAssetStore } from '../stores/assetStore';
import { getOutputArtifact, getOutputImage } from '../engine/scheduler';
import { encodeImage, type ExportFormat } from '../media/codec';
import { storeDerivedAsset } from '../assets/repository';
import { formatBytes } from '../lib/ids';

export function PreviewPanel() {
  const selected = useGraphStore((s) => s.selectedNodeIds);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const outputs = useExecStore((s) => s.outputs);
  const nodeStatus = useExecStore((s) => s.nodeStatus);
  const nodeRuns = useExecStore((s) => s.nodeRuns);
  const projectId = useGraphStore((s) => s.projectId);
  const nodeId = selected[0] ?? null;
  const node = nodes.find((n) => n.id === nodeId) ?? null;
  const out = nodeId ? outputs[nodeId] : undefined;
  const status = nodeId ? (nodeStatus[nodeId] ?? 'idle') : 'idle';
  const run = nodeId ? nodeRuns[nodeId] : undefined;

  const [version, setVersion] = useState(0);
  useEffect(() => { setVersion((v) => v + 1); }, [out?.updatedAt]);

  const { url, kind } = useMemo(() => {
    if (!nodeId) return { url: null as string | null, kind: 'none' };
    // Re-read pixels on version bump.
    void version;
    const img = getOutputImage(nodeId);
    if (img) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
          return { url: canvas.toDataURL('image/png'), kind: 'image' };
        }
      } catch { /* fall through */ }
    }
    const art = getOutputArtifact(nodeId);
    if (art) {
      const ab = new ArrayBuffer(art.bytes.byteLength);
      new Uint8Array(ab).set(art.bytes);
      const blob = new Blob([ab], { type: art.mime });
      return { url: URL.createObjectURL(blob), kind: 'artifact' };
    }
    return { url: null as string | null, kind: 'none' };
  }, [nodeId, version]);

  // Revoke artifact object URLs when replaced.
  const prevUrl = useRef<{ url: string; kind: string } | null>(null);
  useEffect(() => {
    const prev = prevUrl.current;
    if (prev && prev.kind === 'artifact' && prev.url !== url) URL.revokeObjectURL(prev.url);
    if (url) prevUrl.current = { url, kind };
  }, [url, kind]);
  useEffect(() => () => {
    if (prevUrl.current?.kind === 'artifact') URL.revokeObjectURL(prevUrl.current.url);
  }, []);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [split, setSplit] = useState(50);
  const compareMode = useExecStore((s) => s.outputs) && useCompareToggle();
  void compareMode;

  // Before image: first upstream image output.
  const beforeUrl = useMemo(() => {
    if (!nodeId) return null;
    void version;
    const incoming = edges.filter((e) => e.target === nodeId);
    for (const e of incoming) {
      const img = getOutputImage(e.source);
      if (img) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width; canvas.height = img.height;
          canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
          return canvas.toDataURL('image/png');
        } catch { /* ignore */ }
      }
    }
    return null;
  }, [nodeId, edges, version]);

  if (!node) {
    return (
      <div>
        <div className="preview-stage checker"><span style={{ color: 'var(--text-2)', fontSize: 12 }}>Select a node to preview its output.</span></div>
      </div>
    );
  }

  const stateLabel =
    status === 'running' ? 'Pending execution…' :
    status === 'queued' ? 'Queued…' :
    status === 'failed' ? `Failed: ${run?.error ?? 'unknown error'}` :
    status === 'cancelled' ? 'Cancelled — output (if any) is from before cancellation.' :
    status === 'blocked' ? 'Blocked — fix upstream errors, then run.' :
    !out ? 'No output yet — press Run.' :
    out.stale ? 'Stale — parameters changed since this result. Run again.' :
    'Current result';

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <strong style={{ fontSize: 12 }}>{node.data.label || node.type}</strong>
        <span className="badge">{status}{out?.stale ? ' · stale' : ''}</span>
      </div>
      <p style={{ fontSize: 11, color: out?.stale || status === 'failed' ? 'var(--warn)' : 'var(--text-2)', margin: '0 0 6px' }}>{stateLabel}</p>
      <ZoomStage url={url} beforeUrl={beforeUrl} zoom={zoom} setZoom={setZoom} pan={pan} setPan={setPan} split={split} setSplit={setSplit} dimmed={!!out?.stale} />
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn" onClick={() => setZoom((z) => Math.min(8, +(z * 1.25).toFixed(2)))}>+</button>
        <span style={{ fontSize: 11, minWidth: 48, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button className="btn" onClick={() => setZoom((z) => Math.max(0.1, +(z / 1.25).toFixed(2)))}>−</button>
        <button className="btn" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Reset</button>
        {beforeUrl && url && (
          <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
            Split <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} style={{ width: 90 }} />
          </label>
        )}
      </div>
      {out && (
        <table className="kv" style={{ marginTop: 8 }}><tbody>
          <tr><td>Kind</td><td>{out.kind}{out.mime ? ` · ${out.mime}` : ''}</td></tr>
          {out.width !== undefined && <tr><td>Dimensions</td><td>{out.width} × {out.height}</td></tr>}
          {out.bytes !== undefined && <tr><td>Size</td><td>{formatBytes(out.bytes)}</td></tr>}
          {out.hash && <tr><td>Hash</td><td style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>{out.hash}</td></tr>}
          {run?.durationMs !== undefined && <tr><td>Exec time</td><td>{run.durationMs.toFixed(1)} ms{run.cacheHit ? ' (cache hit)' : ''}</td></tr>}
        </tbody></table>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={!nodeId || (!getOutputImage(nodeId) && !getOutputArtifact(nodeId))} onClick={() => nodeId && void downloadNode(nodeId, 'png')}>Download PNG</button>
        <button className="btn" disabled={!nodeId || (!getOutputImage(nodeId) && !getOutputArtifact(nodeId))} onClick={() => nodeId && void downloadNode(nodeId, 'jpeg')}>JPEG</button>
        <button className="btn" disabled={!nodeId || !getOutputImage(nodeId) || !projectId} onClick={() => nodeId && projectId && void snapshotToLibrary(nodeId, projectId)}>Snapshot to library</button>
      </div>
    </div>
  );
}

function useCompareToggle(): boolean {
  return false;
}

function ZoomStage(props: {
  url: string | null; beforeUrl: string | null;
  zoom: number; setZoom: (z: number | ((z: number) => number)) => void;
  pan: { x: number; y: number }; setPan: (p: { x: number; y: number }) => void;
  split: number; setSplit: (n: number) => void; dimmed: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const { url, beforeUrl } = props;
  if (!url) {
    return <div className="preview-stage checker"><span style={{ color: 'var(--text-2)', fontSize: 12 }}>No image to display.</span></div>;
  }
  const showSplit = !!beforeUrl;
  return (
    <div
      ref={ref} className="preview-stage checker"
      style={{ cursor: 'grab', opacity: props.dimmed ? 0.65 : 1 }}
      onWheel={(e) => { props.setZoom((z) => Math.min(8, Math.max(0.1, +(z * (e.deltaY < 0 ? 1.1 : 0.9)).toFixed(2)))); }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, px: props.pan.x, py: props.pan.y };
      }}
      onPointerMove={(e) => {
        if (drag.current) props.setPan({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) });
      }}
      onPointerUp={() => { drag.current = null; }}
    >
      {showSplit ? (
        <div style={{ display: 'flex', gap: 4, width: '100%', transform: `translate(${props.pan.x}px, ${props.pan.y}px) scale(${props.zoom})` }}>
          <figure style={{ margin: 0, flex: `0 0 ${props.split}%`, minWidth: 0 }}>
            <img src={url} alt="After" draggable={false} style={{ display: 'block', width: '100%' }} />
            <figcaption style={{ fontSize: 10, color: 'var(--text-2)', textAlign: 'center' }}>after (this node)</figcaption>
          </figure>
          <figure style={{ margin: 0, flex: 1, minWidth: 0 }}>
            <img src={beforeUrl} alt="Before" draggable={false} style={{ display: 'block', width: '100%' }} />
            <figcaption style={{ fontSize: 10, color: 'var(--text-2)', textAlign: 'center' }}>before (upstream)</figcaption>
          </figure>
        </div>
      ) : (
        <img src={url} alt="Node output" draggable={false}
          style={{ transform: `translate(${props.pan.x}px, ${props.pan.y}px) scale(${props.zoom})`, maxWidth: '100%' }} />
      )}
    </div>
  );
}

async function downloadNode(nodeId: string, format: ExportFormat): Promise<void> {
  const log = useExecStore.getState().log;
  try {
    const art = getOutputArtifact(nodeId);
    let bytes: Uint8Array;
    let filename: string;
    let mime: string;
    if (art && (format === 'png' ? art.mime === 'image/png' : format === 'jpeg' ? art.mime === 'image/jpeg' : art.mime === 'image/webp')) {
      bytes = art.bytes; filename = art.filename; mime = art.mime;
    } else {
      const img = getOutputImage(nodeId);
      if (!img) throw new Error('No image output to download');
      bytes = await encodeImage(img, format, 0.92);
      mime = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
      filename = `node_${nodeId}.${format}`;
    }
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const url = URL.createObjectURL(new Blob([ab], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    log(`Downloaded ${filename} (${formatBytes(bytes.length)})`);
  } catch (e) {
    log(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function snapshotToLibrary(nodeId: string, projectId: string): Promise<void> {
  const log = useExecStore.getState().log;
  try {
    const img = getOutputImage(nodeId);
    if (!img) throw new Error('No image output to snapshot');
    const bytes = await encodeImage(img, 'png');
    const asset = await storeDerivedAsset(projectId, `snapshot_${nodeId}.png`, 'image/png', bytes, {
      kind: 'derived', width: img.width, height: img.height,
    });
    useAssetStore.getState().upsert(asset);
    log(`Snapshot saved to library: ${asset.name}`);
  } catch (e) {
    log(`Snapshot failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
