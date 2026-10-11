import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssetStore } from '../stores/assetStore';
import { useGraphStore } from '../stores/graphStore';
import { useExecStore } from '../stores/execStore';
import { getAssetBlob, storeDerivedAsset } from '../assets/repository';
import { registerSnapshotProvider } from './snapshotBridge';
import type { ImageValue } from '../media/pixel';

import type * as T from 'three';
import { formatBytes } from '../lib/ids';

type Lighting = 'studio' | 'soft' | 'harsh' | 'none';
type Background = 'dark' | 'light' | 'checker' | 'transparent';

export interface ModelStats {
  meshes: number;
  vertices: number;
  triangles: number;
  materials: number;
  textures: number;
  animations: string[];
}

export function ModelViewer() {
  const assets = useAssetStore((s) => s.assets);
  const models = useMemo(() => assets.filter((a) => a.kind === 'model3d'), [assets]);
  const projectId = useGraphStore((s) => s.projectId);
  const log = useExecStore((s) => s.log);
  const [assetId, setAssetId] = useState<string>('');
  const [background, setBackground] = useState<Background>('dark');
  const [lighting, setLighting] = useState<Lighting>('studio');
  const [grid, setGrid] = useState(true);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [animations, setAnimations] = useState<string[]>([]);
  const [clip, setClip] = useState<string>('');
  const [animPlaying, setAnimPlaying] = useState(false);
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ViewerApi | null>(null);

  useEffect(() => {
    if (!assetId && models.length > 0) setAssetId(models[0].id);
  }, [models, assetId]);

  // Mount / reload three.js viewer when the asset or display settings change.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !assetId) return;
    let disposed = false;
    setLoading(true);
    setError(null);
    setStats(null);
    mountThreeViewer(mount, assetId, { background, lighting, grid }).then((api) => {
      if (disposed) { api.dispose(); return; }
      apiRef.current = api;
      setStats(api.stats);
      setAnimations(api.stats.animations);
      setClip(api.stats.animations[0] ?? '');
      setLoading(false);
      registerSnapshotProvider(async () => api.capture());
    }).catch((e) => {
      if (!disposed) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
        log(`3D load failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    return () => {
      disposed = true;
      registerSnapshotProvider(null);
      apiRef.current?.dispose();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  // Apply display settings live without reloading the model.
  useEffect(() => {
    apiRef.current?.applySettings({ background, lighting, grid });
  }, [background, lighting, grid]);

  useEffect(() => {
    apiRef.current?.playClip(animPlaying ? clip : null);
  }, [clip, animPlaying]);

  const snapshot = async () => {
    if (!apiRef.current || !projectId) return;
    try {
      const img = await apiRef.current.capture();
      if (!img) throw new Error('Viewer produced no pixels');
      const { encodeImage } = await import('../media/codec');
      const bytes = await encodeImage(img, 'png');
      const asset = await storeDerivedAsset(projectId, `model_snapshot_${Date.now()}.png`, 'image/png', bytes, {
        kind: 'derived', width: img.width, height: img.height,
        provenance: { parentIds: [assetId], inputHashes: [], params: { background, lighting }, outputFormat: 'image/png' },
      });
      useAssetStore.getState().upsert(asset);
      log(`3D snapshot saved: ${asset.name}`);
    } catch (e) {
      log(`Snapshot failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} aria-label="3D model asset"
          style={{ background: 'var(--bg-0)', border: '1px solid var(--line)', borderRadius: 6, padding: '5px 6px', fontSize: 12, maxWidth: 240 }}>
          <option value="">— select GLB —</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.name} ({formatBytes(m.size)})</option>)}
        </select>
        <select value={background} onChange={(e) => setBackground(e.target.value as Background)} aria-label="Background" style={sel}>
          <option value="dark">dark</option><option value="light">light</option>
          <option value="checker">checker</option><option value="transparent">transparent</option>
        </select>
        <select value={lighting} onChange={(e) => setLighting(e.target.value as Lighting)} aria-label="Lighting" style={sel}>
          <option value="studio">studio</option><option value="soft">soft</option>
          <option value="harsh">harsh</option><option value="none">none</option>
        </select>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> grid</label>
        <button className="btn" onClick={() => apiRef.current?.resetCamera()}>Reset camera</button>
        <button className="btn" onClick={() => apiRef.current?.fit()}>Fit model</button>
        <button className="btn primary" disabled={!stats || !projectId} onClick={() => void snapshot()}>Snapshot to library</button>
      </div>
      {animations.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
          <select value={clip} onChange={(e) => setClip(e.target.value)} aria-label="Animation clip" style={sel}>
            {animations.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className="btn" onClick={() => setAnimPlaying(!animPlaying)}>{animPlaying ? '⏸ Pause anim' : '▶ Play anim'}</button>
        </div>
      )}
      <div ref={mountRef} className="preview-stage" style={{ minHeight: 360, padding: 0 }} />
      {loading && <p style={{ color: 'var(--text-2)', fontSize: 12 }}>Loading model…</p>}
      {error && <div className="issue">{error}</div>}
      {stats && (
        <table className="kv" style={{ marginTop: 8 }}><tbody>
          <tr><td>Meshes</td><td>{stats.meshes}</td></tr>
          <tr><td>Vertices</td><td>{stats.vertices.toLocaleString()}</td></tr>
          <tr><td>Triangles</td><td>{stats.triangles.toLocaleString()}</td></tr>
          <tr><td>Materials / textures</td><td>{stats.materials} / {stats.textures}</td></tr>
          <tr><td>Animations</td><td>{stats.animations.length ? stats.animations.join(', ') : 'none embedded'}</td></tr>
        </tbody></table>
      )}
      <p style={{ fontSize: 11, color: 'var(--text-2)' }}>
        Drag to orbit · right-drag to pan · wheel to zoom. Self-contained GLB files work fully offline; .gltf files with external (non-embedded) buffer URIs will fail to load with an explicit error.
      </p>
    </div>
  );
}

const sel: React.CSSProperties = { background: 'var(--bg-0)', border: '1px solid var(--line)', borderRadius: 6, padding: '5px 6px', fontSize: 12 };

interface ViewerApi {
  stats: ModelStats;
  dispose: () => void;
  resetCamera: () => void;
  fit: () => void;
  applySettings: (s: { background: Background; lighting: Lighting; grid: boolean }) => void;
  playClip: (name: string | null) => void;
  capture: () => Promise<ImageValue | null>;
}

async function mountThreeViewer(
  mount: HTMLElement, assetId: string, settings: { background: Background; lighting: Lighting; grid: boolean },
): Promise<ViewerApi> {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

  const blob = await getAssetBlob(assetId);
  if (!blob) throw new Error(`Model asset ${assetId} has no stored binary`);
  if (blob.size > 200 * 1024 * 1024) throw new Error(`Model is ${formatBytes(blob.size)} — over the 200 MB viewer limit`);

  const width = mount.clientWidth || 640;
  const height = 380;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 10000);
  camera.position.set(2.5, 2, 3.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  // Render-gate flag: declared before applySettings (which sets it on call).
  let dirty = true;

  let gridHelper: T.GridHelper | null = null;
  const lightRig = new THREE.Group();
  scene.add(lightRig);

  const applySettings = (s: { background: Background; lighting: Lighting; grid: boolean }) => {
    if (s.background === 'dark') scene.background = new THREE.Color(0x14161a);
    else if (s.background === 'light') scene.background = new THREE.Color(0xe8e9eb);
    else scene.background = null;
    mount.classList.toggle('checker', s.background === 'checker');
    while (lightRig.children.length) lightRig.remove(lightRig.children[0]);
    if (s.lighting !== 'none') {
      const key = new THREE.DirectionalLight(0xffffff, s.lighting === 'harsh' ? 3 : s.lighting === 'soft' ? 1.2 : 2);
      key.position.set(3, 5, 4);
      lightRig.add(key);
      lightRig.add(new THREE.AmbientLight(0xffffff, s.lighting === 'soft' ? 1.2 : 0.6));
      if (s.lighting === 'studio') {
        const rim = new THREE.DirectionalLight(0x88aaff, 1);
        rim.position.set(-4, 2, -3);
        lightRig.add(rim);
      }
    }
    if (gridHelper) { scene.remove(gridHelper); gridHelper.geometry.dispose(); gridHelper = null; }
    if (s.grid) {
      gridHelper = new THREE.GridHelper(10, 20, 0x555a63, 0x33363f);
      scene.add(gridHelper);
    }
    dirty = true;
  };
  applySettings(settings);

  // Load model.
  const url = URL.createObjectURL(blob);
  let gltf: { scene: T.Group; animations: T.AnimationClip[] };
  try {
    gltf = await new GLTFLoader().loadAsync(url);
  } catch (e) {
    URL.revokeObjectURL(url);
    throw new Error(`GLB parse failed: ${e instanceof Error ? e.message : String(e)} (unsupported extensions or corrupt file?)`);
  } finally {
    URL.revokeObjectURL(url);
  }
  scene.add(gltf.scene);

  // Stats.
  let meshes = 0, vertices = 0, triangles = 0;
  const materials = new Set<string>();
  const textures = new Set<string>();
  gltf.scene.traverse((o: T.Object3D) => {
    const mesh = o as T.Mesh;
    if (mesh.isMesh) {
      meshes++;
      const geo = mesh.geometry as T.BufferGeometry;
      vertices += geo.attributes.position?.count ?? 0;
      triangles += (geo.index ? geo.index.count : (geo.attributes.position?.count ?? 0)) / 3;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mat = m as T.MeshStandardMaterial;
        if (mat?.uuid) materials.add(mat.uuid);
        for (const v of Object.values(mat ?? {})) {
          const tex = v as T.Texture;
          if (tex?.isTexture) textures.add(tex.uuid);
        }
      }
    }
  });

  const fit = () => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dist = Math.max(0.1, (size / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.position.copy(center).add(new THREE.Vector3(dist * 0.6, dist * 0.45, dist * 0.8));
    controls.target.copy(center);
    controls.update();
    dirty = true;
  };
  const homePos = camera.position.clone();
  const homeTarget = controls.target.clone();
  fit();

  // Animation.
  const mixer = new THREE.AnimationMixer(gltf.scene);
  let activeAction: { stop: () => void } | null = null;
  const playClip = (name: string | null) => {
    activeAction?.stop();
    activeAction = null;
    if (!name) return;
    const foundClip = gltf.animations.find((a) => a.name === name);
    if (!foundClip) return;
    const action = mixer.clipAction(foundClip);
    action.play();
    activeAction = action;
  };

  // Render loop (owned by this mount; always torn down in dispose).
  const clock = new THREE.Clock();
  let raf = 0;
  let contextLost = false;
  const onContextLost = (e: Event) => {
    e.preventDefault();
    contextLost = true;
    cancelAnimationFrame(raf);
  };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  // Idle-gated loop: RAF ticks stay cheap, but mixer + GPU work happen only
  // while the camera moves, a clip plays, or a dirty flag demands a frame.
  // A static model therefore costs ~zero GPU instead of 60 renders/second.
  const loop = () => {
    if (contextLost) return;
    raf = requestAnimationFrame(loop);
    const dt = clock.getDelta();
    const playing = activeAction !== null;
    if (playing) mixer.update(dt);
    const moved = controls.update();
    if (moved || playing || dirty) {
      dirty = false;
      renderer.render(scene, camera);
    }
  };
  loop();

  const onResize = () => {
    const w = mount.clientWidth || width;
    renderer.setSize(w, height);
    camera.aspect = w / height;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  window.addEventListener('resize', onResize);

  const capture = async (): Promise<ImageValue | null> => {
    renderer.render(scene, camera);
    const src = renderer.domElement;
    const canvas = document.createElement('canvas');
    canvas.width = src.width; canvas.height = src.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0);
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { kind: 'image', width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(id.data) };
  };

  const dispose = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
    activeAction?.stop();
    mixer.stopAllAction();
    gltf.scene.traverse((o: T.Object3D) => {
      const mesh = o as T.Mesh;
      if (mesh.isMesh) {
        (mesh.geometry as T.BufferGeometry)?.dispose?.();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const mat = m as T.MeshStandardMaterial;
          for (const v of Object.values(mat ?? {})) {
            const tex = v as T.Texture;
            if (tex?.isTexture) tex.dispose();
          }
          mat?.dispose?.();
        }
      }
    });
    controls.dispose();
    renderer.dispose();
    if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    registerSnapshotProvider(null);
  };

  return {
    stats: {
      meshes, vertices, triangles: Math.round(triangles),
      materials: materials.size, textures: textures.size,
      animations: gltf.animations.map((a) => a.name || 'clip'),
    },
    dispose,
    resetCamera: () => { camera.position.copy(homePos); controls.target.copy(homeTarget); controls.update(); dirty = true; },
    fit,
    applySettings,
    playClip,
    capture,
  };
}
