# Infinite Creation Studio — User Guide

Local-first visual production environment. Everything runs in your browser;
projects and asset binaries live in IndexedDB on your device. No account,
no telemetry, no network calls after the app loads.

## 1. First run (2 minutes)

1. `npm install`, `npm run dev`, open the printed URL.
2. Top bar ▸ **Samples** ▸ **A · Image production pipeline**.
3. Press **▶ Run**. The queue fills with per-node timings.
4. Click the **Export PNG** node, open the **Preview** tab (right), and press
   **Download PNG**. That file is real output of the executed graph.

## 2. Building a workflow

- **Add nodes**: drag from the left *Nodes* tab onto the canvas, or press
  `Ctrl K` and search. Every node shows its family, version, live status,
  and typed ports.
- **Connect**: drag from an output handle to a compatible input. Incompatible
  types and would-be cycles are rejected immediately with a written reason.
- **Edit**: click a node; the right *Parameters* panel shows its controls,
  presets (color nodes), parameter links, and upstream/downstream dependents.
- **Disable**: checkbox in the inspector. A disabled node with one image input
  forwards it unchanged; otherwise downstream turns `blocked` at run time.

Keyboard: `Delete` removes selection, `Ctrl D` duplicates, `Ctrl C/V`
copy/paste, `Ctrl Z / Ctrl Shift Z` undo/redo, `Ctrl K` command palette.

## 3. Assets

- **Import**: left *Assets* tab or the **ASSETS** workspace — file picker or
  drag & drop. Supported: PNG/JPEG/WebP/GIF/BMP/AVIF, MP3/WAV/OGG,
  MP4/WebM, GLB/GLTF. Content-hash deduplication is automatic.
- **Organize**: search, kind filter, favorites (★), sort, tags, approval
  states (`draft → review → approved …`), revision notes.
- **Health**: *Verify library* checks every record for its binary; missing
  binaries can be **relinked** without losing the asset's identity.
- **Storage**: usage meter + *Request persistence* (the browser may still
  evict under pressure — keep `.icsproj.zip` backups).

## 4. Running and inspecting

- **▶ Run** validates, expands subgraphs, and executes in dependency order.
  **■ Cancel** is cooperative; cancelled runs are reported as cancelled,
  never as success. **Retry failed** re-runs only the failed slice.
- **Preview tab**: the selected node's actual latest output with
  zoom/pan, before/after comparison (upstream vs. this node, synchronized
  zoom), dimensions, hashes, and measured execution time.
- **Stale** badges mean parameters changed since the result — re-run.
  Stale media is never presented as current.
- **Heatmap**: queue tab checkbox sorts nodes by measured duration.
- **Cache inspector** (Diagnostics tab): live entries, sizes, evictions.

## 5. Timeline (ANIMATE)

Bottom *Timeline* tab or the ANIMATE workspace canvas. Add image tracks,
attach library images as frames, set clip windows, add opacity/transform
tracks with linear/hold keyframes. Play, step frame-by-frame, scrub the
ruler. Frame evaluation is deterministic (pure function of time, no drift).
Export is a **PNG sequence** — no video container is claimed.

## 6. 3D (INSPECT ▸ 3D viewer)

Pick a GLB asset. Orbit/pan/zoom, reset, fit, grid, lighting presets,
backgrounds, model statistics, embedded-animation playback, and
**Snapshot to library** (also feeds the *Model Snapshot* node at run time
when the viewer is mounted).

## 7. Reuse

- **Presets**: one-click reversible parameter sets on color nodes.
- **Subgraphs**: select nodes ▸ canvas *Subgraphs* button ▸ save with a name.
  Insert copies anywhere, or point a *Reusable Subgraph* node at the saved
  ID (single-input/single-output definitions expand inline at run time).
- **Parameter links**: drive one numeric/color param from another node's
  compatible param (Inspector ▸ Parameter links).
- **Batch**: queue header *Batch…* runs the workflow against many images
  sequentially (bounded concurrency = 1), saving each artifact.

## 8. Exporting and backup

- **EXPORT workspace**: per-artifact downloads, workflow JSON export/import,
  full project archives (`.icsproj.zip` with manifest, binaries, provenance,
  SHA-256 checksums).
- Workflow JSON carries graph + links + timeline; asset *references* resolve
  against the importing project's library (missing assets error explicitly).
- Archives are checksummed, traversal-safe, schema-gated, and import as a
  **new** project — existing work is never overwritten.

## 9. Offline operation

After `npm run build`, serve `dist/` from any static server (or `vite
preview`). No runtime network use exists: no CDNs, fonts, analytics, or
provider calls. The 3D viewer and image workers are bundled locally.
