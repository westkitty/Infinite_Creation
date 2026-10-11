# Known limitations and unsupported features

Honest list of what v1 does not do, with workarounds where they exist.

1. **No automated browser E2E in this environment.** Unit/integration suites
   (69 tests) run in Node+jsdom. Canvas/three.js/worker-thread paths are
   implemented but were not executed by automation here (no browser runtime
   in the sandbox). Manual browser pass recommended: load each sample, run,
   download, reload, archive round-trip, GLB load.
2. **JPEG/WebP encoding needs a real browser canvas** (jsdom-tested PNG path
   uses the bundled pure-TS encoder as fallback).
3. **Resize quality `low/medium/high` are all bilinear** in v1; only
   `pixelated` (nearest) differs. No visual-consequence bug, but the options
   over-promise — kept for forward compatibility.
4. **No video/audio processing or containers.** Timeline output is a PNG
   sequence; multi-file download may need a browser allow-list confirmation.
5. **No GPU acceleration.** CPU pixel ops in workers; very large images
   (>50 MP) will be slow and may hit the 384 MB intermediate cache cap
   (eviction is safe: recompute on demand).
6. **Intermediates are memory-resident.** Only export artifacts persist
   automatically; use *Snapshot to library* for anything else. Re-running
   after reload is deterministic.
7. **Disabled nodes are still validated.** A disabled node with missing
   inputs fails the run at validation; remove or reconnect it to skip a
   broken branch.
8. **Subgraph inline nodes are 1-in/1-out**; richer definitions insert as
   copies. No nesting, no recursion (rejected with explicit errors).
9. **Parameter links are one level**, numeric↔numeric / color↔color only.
10. **Batch runs sequentially** (bound = 1) by design for memory safety.
11. **`.gltf` with external URIs fails to load** (use self-contained `.glb`).
12. **Browser storage is not guaranteed.** IndexedDB can be evicted; the app
    requests persistence but keeps `.icsproj.zip` as the durable backup.
13. **Collapsible groups / alignment guides / minimap-in-modal polish:**
    not implemented. Subgraphs cover the reuse need.
14. **Multi-output preview shows the first output** (fine for Branch, whose
    outputs are identical).
15. **Large-project canvas virtualization:** not implemented; graphs beyond
    a few hundred nodes are untested for interaction smoothness.
