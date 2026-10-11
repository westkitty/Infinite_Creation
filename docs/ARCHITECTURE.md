# Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ React 18 + Vite + @xyflow/react (canvas) + Zustand (UI)      │
│ components/: TopBar, GraphCanvas, Panels, Inspector,         │
│   AssetLibrary, TimelineEditor, ModelViewer, PreviewPanel…   │
└──────────────┬───────────────────────────────┬───────────────┘
               │                               │
┌──────────────▼──────────────┐  ┌─────────────▼───────────────┐
│ graph/  schema + validation │  │ engine/  scheduler + cache  │
│  types/graph.ts (zod)       │  │  executors.ts (node impls)  │
│  registry.ts (42 node defs) │  │  scheduler.ts (topo, cancel)│
│  validation.ts (types, topo)│  │  cache.ts (deterministic)   │
└──────────────┬──────────────┘  └─────────────┬───────────────┘
               │                               │
┌──────────────▼──────────────┐  ┌─────────────▼───────────────┐
│ media/  Canvas2D + workers  │  │ assets/  Dexie (IndexedDB)  │
│  pixel.ts / ops.ts (pure)   │  │  repository.ts (binaries)   │
│  codec.ts (decode/encode)   │  │  recovery.ts (verify/relink)│
│  png.ts (fallback encoder)  │  │  db.ts (schema v1)          │
│  workers/image.worker.ts    │  └─────────────┬───────────────┘
└─────────────────────────────┘  ┌─────────────▼───────────────┐
                                 │ persistence / export /      │
                                 │ subgraphs / providers /     │
                                 │ timeline render / samples   │
                                 └─────────────────────────────┘
```

## Subsystem contracts

| Subsystem | Owns | Must never |
|---|---|---|
| Graph editor | layout, selection, DnD, history | run pixel logic |
| Schema/registry | types, ports, params, versions | touch the DOM |
| Scheduler | order, cache, cancel, retry, history | depend on node XY |
| Executors | per-node pure-ish implementations | touch React state directly (via `ExecContext`) |
| Media ops | RGBA transforms, copy-on-write | mutate inputs |
| Worker pool | bounded off-thread execution + fallback | lose cancellations |
| Repository | binaries, dedupe, thumbnails, URLs | hold the whole library in React state |
| Persistence | projects, runs, subgraphs (Dexie) | wipe the DB in migrations |
| Timeline | deterministic frame eval | drift (pure f(t)) |
| 3D viewer | GLB inspect + snapshot | leak GL contexts/geometries |
| Export | JSON + checksummed archives | execute imported content |
| Providers | future-adapter interfaces | affect offline execution |

## Key decisions

- **Intermediate representation**: plain `ImageValue` (`{width,height,Uint8ClampedArray}`,
  sRGB bytes, straight alpha). DOM-free so workers and tests share the code.
- **Working color policy**: sRGB 8-bit throughout; no silent conversions.
  Documented in `media/color.ts` and `LIMITATIONS.md`.
- **Cache identity**: `shortHash(nodeType, nodeVersion, effectiveParams,
  perPortInputHashes, engineVersion)`. LRU, 48 entries / 384 MB cap.
- **Decoded-pixel cache**: `loadImageAssetCached` (repository) shared by the
  scheduler and the timeline renderer, keyed `assetId:contentHash` so a
  relinked revision can never read stale pixels. LRU, 12 entries; returned
  images are shared read-only (resize/composite allocate new outputs).
- **Cancellation**: `AbortController` per run + run-id generation check so
  stale completions can never publish.
- **Disabled nodes**: forward a single image input, else downstream `blocked`.
- **Subgraphs**: saved definitions insert as ordinary nodes; inline
  `util.subgraph` placeholders expand pre-run (1-in/1-out, no nesting).
- **Links**: one-level, type-gated (numeric↔numeric, color↔color) overrides
  applied before cache-key computation.
- **Artifacts** persist with full provenance; intermediates live in the
  memory cache (+ on-demand *Snapshot to library*).
- **Binaries** stored as `ArrayBuffer` in IndexedDB (structured-clone safe);
  object URLs are reference-counted and revoked on project switch.
- **Archives**: `STORE`d zip + `manifest.json` checksums verified before
  anything is trusted; traversal/caps/schema gates; import creates a new id.
