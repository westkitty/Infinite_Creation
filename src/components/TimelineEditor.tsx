import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../stores/graphStore';
import { useAssetStore } from '../stores/assetStore';
import { useExecStore } from '../stores/execStore';
import type { TimelineTrack } from '../types/graph';
import { renderTimelineFrame } from '../engine/executors';
import { getAssetBlob } from '../assets/repository';
import { decodeImageBlob } from '../media/codec';
import { uid } from '../lib/ids';

const quantize = (t: number, fps: number) => Math.round(t * fps) / fps;

export function TimelineEditor() {
  const timeline = useGraphStore((s) => s.timeline);
  const st = useGraphStore.getState();
  const assets = useAssetStore((s) => s.assets);
  const imageAssets = useMemo(() => assets.filter((a) => a.kind === 'image' || a.kind === 'derived'), [assets]);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(120); // px per second
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const playRef = useRef<{ raf: number; t0: number; start: number } | null>(null);
  const renderToken = useRef(0);

  const fps = Math.max(1, timeline.fps);
  const frame = Math.floor(timeline.playhead * fps);
  const totalFrames = Math.max(1, Math.round(timeline.duration * fps));

  const setTl = useCallback((patch: Partial<typeof timeline>) => {
    st.setTimeline({ ...useGraphStore.getState().timeline, ...patch });
  }, [st]);

  // Playback loop on the fps grid (no drift: playhead is a pure function of wall time).
  useEffect(() => {
    if (!playing) return;
    const startPerf = performance.now();
    const startHead = useGraphStore.getState().timeline.playhead;
    const tick = () => {
      const tl = useGraphStore.getState().timeline;
      const elapsed = (performance.now() - startPerf) / 1000;
      let t = startHead + elapsed;
      if (t >= tl.duration) t = t % tl.duration;
      const q = quantize(t, Math.max(1, tl.fps));
      if (q !== tl.playhead) st.setTimeline({ ...tl, playhead: q });
      playRef.current = { raf: requestAnimationFrame(tick), t0: startPerf, start: startHead };
    };
    playRef.current = { raf: requestAnimationFrame(tick), t0: startPerf, start: startHead };
    return () => { if (playRef.current) cancelAnimationFrame(playRef.current.raf); };
  }, [playing, st]);

  // Frame preview at quantized playhead.
  useEffect(() => {
    const token = ++renderToken.current;
    const tl = timeline;
    if (tl.tracks.length === 0) { setPreviewUrl(null); return; }
    setRendering(true);
    const ctrl = new AbortController();
    renderTimelineFrame(
      {
        loadImageAsset: async (id) => {
          const blob = await getAssetBlob(id);
          if (!blob) throw new Error(`Asset ${id} missing`);
          return decodeImageBlob(blob);
        },
        signal: ctrl.signal,
      },
      tl, tl.playhead, 320, 200,
    ).then((img) => {
      if (renderToken.current !== token) return;
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
      setPreviewUrl(canvas.toDataURL('image/png'));
    }).catch(() => {
      if (renderToken.current === token) setPreviewUrl(null);
    }).finally(() => {
      if (renderToken.current === token) setRendering(false);
    });
    return () => ctrl.abort();
  }, [timeline]);

  const addTrack = (kind: TimelineTrack['kind']) => {
    const track: TimelineTrack = {
      id: uid('tr'), name: `${kind} ${timeline.tracks.length + 1}`, kind,
      assetIds: [], clipStart: 0, clipDuration: timeline.duration, keyframes: [], muted: false,
    };
    setTl({ tracks: [...timeline.tracks, track] });
  };

  const patchTrack = (id: string, patch: Partial<TimelineTrack>) => {
    setTl({ tracks: timeline.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  };

  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? '⏸ Pause' : '▶ Play'}
          </button>
          <button className="btn" title="Go to start (Home)" aria-label="Go to start" onClick={() => { setPlaying(false); setTl({ playhead: 0 }); }}>⏮</button>
          <button className="btn" title="Step back one frame (Left arrow)" aria-label="Step back one frame" onClick={() => { setPlaying(false); setTl({ playhead: quantize(Math.max(0, timeline.playhead - 1 / fps), fps) }); }}>◀</button>
          <button className="btn" title="Step forward one frame (Right arrow)" aria-label="Step forward one frame" onClick={() => { setPlaying(false); setTl({ playhead: quantize(Math.min(timeline.duration, timeline.playhead + 1 / fps), fps) }); }}>▶</button>
          <button className="btn" title="Go to end (End)" aria-label="Go to end" onClick={() => { setPlaying(false); setTl({ playhead: timeline.duration }); }}>⏭</button>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
            t={timeline.playhead.toFixed(3)}s · frame {Math.min(frame, totalFrames - 1) + 1}/{totalFrames} · {fps}fps
          </span>
          <span className="spacer" style={{ flex: 1 }} />
          <label style={{ fontSize: 11 }}>FPS <input type="number" min={1} max={120} value={timeline.fps}
            onChange={(e) => setTl({ fps: Math.min(120, Math.max(1, Number(e.target.value) || 30)) })}
            style={{ width: 56, background: 'var(--bg-0)', border: '1px solid var(--line)', borderRadius: 4, padding: 3 }} /></label>
          <label style={{ fontSize: 11 }}>Duration <input type="number" min={0.5} max={120} step={0.5} value={timeline.duration}
            onChange={(e) => setTl({ duration: Math.min(120, Math.max(0.5, Number(e.target.value) || 4)) })}
            style={{ width: 56, background: 'var(--bg-0)', border: '1px solid var(--line)', borderRadius: 4, padding: 3 }} />s</label>
          <label style={{ fontSize: 11 }}>Zoom <input type="range" min={40} max={400} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ width: 80 }} /></label>
        </div>
        <Ruler playhead={timeline.playhead} duration={timeline.duration} zoom={zoom} fps={fps}
          onScrub={(t) => { setPlaying(false); setTl({ playhead: quantize(Math.min(timeline.duration, Math.max(0, t)), fps) }); }} />
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <button className="btn" onClick={() => addTrack('image')}>+ Image track</button>
          <button className="btn" onClick={() => addTrack('opacity')}>+ Opacity track</button>
          <button className="btn" onClick={() => addTrack('transform')}>+ Transform track</button>
        </div>
        {timeline.tracks.length === 0 && (
          <p style={{ color: 'var(--text-2)', fontSize: 12 }}>No tracks. Add an image track, attach library images, then scrub or play. Timebase: {timeline.timebase}.</p>
        )}
        {timeline.tracks.map((t) => (
          <TrackRow key={t.id} track={t} imageAssets={imageAssets} zoom={zoom} duration={timeline.duration}
            onPatch={(p) => patchTrack(t.id, p)} onDelete={() => setTl({ tracks: timeline.tracks.filter((x) => x.id !== t.id) })} />
        ))}
      </div>
      <div style={{ width: 340, flex: 'none' }}>
        <div className="preview-stage checker" style={{ minHeight: 200 }}>
          {previewUrl ? <img src={previewUrl} alt={`Timeline frame at ${timeline.playhead}s`} style={{ maxWidth: '100%' }} />
            : <span style={{ color: 'var(--text-2)', fontSize: 12 }}>{rendering ? 'Rendering…' : 'No frame to preview'}</span>}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-2)' }}>
          Deterministic frame evaluation at the playhead. Semantics: image tracks composite bottom-to-top; an opacity/transform track affects the nearest image track below it.
        </p>
        <SequenceExport />
      </div>
    </div>
  );
}

function Ruler({ playhead, duration, zoom, fps, onScrub }: { playhead: number; duration: number; zoom: number; fps: number; onScrub: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const grid = Math.max(1, fps);
  const scrub = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    onScrub((clientX - rect.left) / zoom);
  };
  const step = (dt: number) => onScrub(Math.min(duration, Math.max(0, playhead + dt)));
  const ticks = [];
  for (let s = 0; s <= Math.ceil(duration); s++) ticks.push(s);
  return (
    <div ref={ref} className="timeline-ruler" style={{ width: Math.max(200, duration * zoom) }}
      tabIndex={0} role="slider" aria-label="Timeline playhead"
      aria-valuemin={0} aria-valuemax={Number(duration.toFixed(2))} aria-valuenow={Number(playhead.toFixed(3))}
      aria-valuetext={`${playhead.toFixed(3)} seconds of ${duration.toFixed(1)}`}
      onKeyDown={(e) => {
        const frame = 1 / grid;
        if (e.key === 'ArrowLeft') step(e.shiftKey ? -1 : -frame);
        else if (e.key === 'ArrowRight') step(e.shiftKey ? 1 : frame);
        else if (e.key === 'Home') onScrub(0);
        else if (e.key === 'End') onScrub(duration);
        else return;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        scrub(e.clientX);
        const move = (ev: PointerEvent) => scrub(ev.clientX);
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}>
      {ticks.map((s) => (
        <span key={s} style={{ position: 'absolute', left: s * zoom, top: 2, fontSize: 9, color: 'var(--text-2)', borderLeft: '1px solid var(--line)', paddingLeft: 2 }}>{s}s</span>
      ))}
      <div className="playhead" style={{ left: playhead * zoom }} />
    </div>
  );
}

function TrackRow({ track, imageAssets, zoom, duration, onPatch, onDelete }: {
  track: TimelineTrack;
  imageAssets: Array<{ id: string; name: string }>;
  zoom: number; duration: number;
  onPatch: (p: Partial<TimelineTrack>) => void;
  onDelete: () => void;
}) {
  const [kfTime, setKfTime] = useState('0');
  const [kfValue, setKfValue] = useState('100');
  const [kfInterp, setKfInterp] = useState<'linear' | 'hold'>('linear');
  return (
    <div className="timeline-track">
      <div className="thead">
        <strong>{track.name}</strong>
        <span className="badge">{track.kind}</span>
        <div style={{ position: 'relative', height: 14, background: 'var(--bg-0)', borderRadius: 4, width: Math.max(120, duration * zoom * 0.5), overflow: 'hidden' }} title="Clip range">
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(track.clipStart / duration) * 100}%`, width: `${Math.min(100, (track.clipDuration / duration) * 100)}%`, background: 'var(--accent-soft)', borderLeft: '2px solid var(--accent)', borderRight: '2px solid var(--accent)' }} />
        </div>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 11 }}><input type="checkbox" checked={track.muted} onChange={(e) => onPatch({ muted: e.target.checked })} /> mute</label>
        <button className="btn danger" onClick={onDelete}>Delete</button>
      </div>
      <div style={{ padding: '0 8px 8px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 11 }}>Start <input type="number" min={0} step={0.1} value={track.clipStart} onChange={(e) => onPatch({ clipStart: Math.max(0, Number(e.target.value) || 0) })} style={numStyle} /></label>
        <label style={{ fontSize: 11 }}>Duration <input type="number" min={0.1} step={0.1} value={track.clipDuration} onChange={(e) => onPatch({ clipDuration: Math.max(0.1, Number(e.target.value) || 1) })} style={numStyle} /></label>
        {track.kind === 'image' && (
          <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {track.assetIds.map((id, idx) => (
              <span key={`${id}-${idx}`} className="badge" title={id}>
                {(imageAssets.find((a) => a.id === id)?.name ?? id.slice(0, 8)) + (idx > 0 ? ` #${idx + 1}` : '')}
                <button className="icon-btn" title="Remove frame" onClick={() => onPatch({ assetIds: track.assetIds.filter((_, k) => k !== idx) })}>✕</button>
              </span>
            ))}
            <select defaultValue="" aria-label="Add frame image" onChange={(e) => {
              if (e.target.value) onPatch({ assetIds: [...track.assetIds, e.target.value] });
              e.target.value = '';
            }} style={numStyle}>
              <option value="">+ add frame…</option>
              {imageAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </span>
        )}
        {track.kind !== 'image' && (
          <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', fontSize: 11 }}>
            {track.keyframes.map((k) => (
              <span key={k.id} className="badge" title={`${k.interpolation}`}>
                t={k.time} v={String(k.value)}
                <button className="icon-btn" title="Delete key" onClick={() => onPatch({ keyframes: track.keyframes.filter((x) => x.id !== k.id) })}>✕</button>
              </span>
            ))}
            <input placeholder="t" value={kfTime} onChange={(e) => setKfTime(e.target.value)} style={{ ...numStyle, width: 52 }} aria-label="Keyframe time" />
            <input placeholder="v" value={kfValue} onChange={(e) => setKfValue(e.target.value)} style={{ ...numStyle, width: 60 }} aria-label="Keyframe value" />
            <select value={kfInterp} onChange={(e) => setKfInterp(e.target.value as 'linear' | 'hold')} style={numStyle} aria-label="Interpolation">
              <option value="linear">linear</option>
              <option value="hold">hold</option>
            </select>
            <button className="btn" onClick={() => {
              const t = Number(kfTime), v = Number(kfValue);
              if (!Number.isFinite(t) || !Number.isFinite(v) || t < 0) return;
              onPatch({ keyframes: [...track.keyframes, { id: uid('kf'), time: t, value: v, interpolation: kfInterp }] });
            }}>+ key</button>
          </span>
        )}
      </div>
    </div>
  );
}

const numStyle: React.CSSProperties = { width: 64, background: 'var(--bg-0)', border: '1px solid var(--line)', borderRadius: 4, padding: 3, fontSize: 12 };

function SequenceExport() {
  const log = useExecStore((s) => s.log);
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className="btn" disabled={busy} title="Render every frame on the fps grid and download as PNGs (one at a time)"
        onClick={() => void exportSequence(log, setBusy)}>
        {busy ? 'Rendering…' : 'Export frames (PNG)'}
      </button>
      <span style={{ fontSize: 11, color: 'var(--text-2)' }}>No MP4/WebM encoder is claimed — PNG sequence only.</span>
    </div>
  );
}

async function exportSequence(log: (m: string) => void, setBusy: (b: boolean) => void): Promise<void> {
  setBusy(true);
  try {
    const st = useGraphStore.getState();
    const tl = st.timeline;
    const fps = Math.max(1, tl.fps);
    const frames = Math.max(1, Math.round(tl.duration * fps));
    if (frames > 300) throw new Error(`Refusing to export ${frames} frames in-browser (cap 300) — shorten the timeline`);
    const ctrl = new AbortController();
    for (let f = 0; f < frames; f++) {
      const t = f / fps;
      const img = await renderTimelineFrame(
        {
          loadImageAsset: async (id) => {
            const blob = await getAssetBlob(id);
            if (!blob) throw new Error(`Asset ${id} missing`);
            return decodeImageBlob(blob);
          },
          signal: ctrl.signal,
        },
        tl, t, 640, 400,
      );
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('PNG encoding failed');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `frame_${String(f).padStart(4, '0')}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    log(`Exported ${frames} PNG frames.`);
  } catch (e) {
    log(`Sequence export failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    setBusy(false);
  }
}
