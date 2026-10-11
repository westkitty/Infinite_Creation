# Validation report

Date: 2026-10-11. Branch: `arena/7035f563-infinite-creation`.
Environment: Node v22.22.3, npm 10.9.8, Linux sandbox (no browser runtime).

## Commands executed (all on the working branch)

| # | Command | Result |
|---|---|---|
| 1 | `npm install` | ok — 206+2 packages (incl. `fake-indexeddb` for tests) |
| 2 | `npm run typecheck` (`tsc --noEmit`, strict) | **pass, 0 errors** |
| 3 | `npx vitest run` | **10 files, 69/69 tests pass** (graph 8, ops 17, png 4, executors 9, scheduler 7, timeline 3, persistence 5, portability 6, subgraphs 6, samples 4) |
| 4 | `npm run build` (`tsc` + `vite build`) | **pass** — `dist/` emitted; three.js/OrbitControls/GLTFLoader/worker code-split into lazy chunks |
| 5 | `vite preview` + `curl /` | **200**, correct `index.html` |
| 6 | `git status` / `git log` | clean tree per phase; 8 phase commits pushed |

## What the tests prove (not screenshots)

- Invalid connections/cycles rejected; topo order correct; missing inputs detected.
- Crop/resize/rotate/flip/color/blur/sharpen/mask/composite produce expected
  dimensions and verified representative pixels; inputs never mutated.
- Minimal PNG encoder output parses with valid signature/CRC/dimensions.
- Sample A executes end to end: artifact bytes parse as a valid 400×300 PNG.
- Sample B shares intermediates (param change re-runs only the edited branch).
- Sample C evaluates sequence + keyframes + timeline frame (320×200 PNG).
- Cancellation never reports success; failures block downstream honestly.
- Save/load, binary round-trip, migration v1→v4, missing-binary detection,
  archive round-trip with checksum verification all pass; tampered/unsafe/
  future-schema archives are rejected; imports create new projects.
- Subgraph boundary analysis, save/insert, inline expansion, and
  multi-IO/nesting/missing-definition rejections pass.

## Adversarial failure check (§26) — bounded repair pass applied

Found and fixed: Blob-in-IndexedDB fragility (now `ArrayBuffer` storage);
jsdom-minimal-Blob archive path (binaries stay bytes end-to-end); PNG encode
without canvas (pure-TS fallback); worker fallback double-execution; stale
completion guards (run-id generation checks); object-URL lifecycle
(ref-count + revoke on project switch); exec-store growth on node delete;
drop-position math (now exact `screenToFlowPosition`); state-driven snapshot
button; dead preview code removed; accessible node roles/labels added.

## Not executed here (stated, not claimed)

- Real-browser E2E (import → run → download → reload → archive → GLB):
  no browser runtime in this sandbox. Recommended manual script is in
  `LIMITATIONS.md` §1. All browser-dependent code paths degrade with
  explicit errors where the capability is absent.

## Uplift passes (2026-10-11, same branch, same sandbox)

Pass 1 (`57a48fa`): run-history browser, lineage graph, live edge animation.
Pass 2 (this change): modal focus traps, store-driven canvas selection,
batch cancel, timeline `.zip` export, idle-gated 3D render loop.

| # | Command | Result |
|---|---|---|
| 1 | `npm run typecheck` | **pass, 0 errors** |
| 2 | `npx vitest run` | **14 files, 81/81 pass** (graph 8, ops 17, png 4, executors 9, scheduler 7, timeline 3, persistence 5, portability 6, subgraphs 6, samples 4, history 4, lineage 3, provenance-panel 1, focusTrap 4) |
| 3 | `npm run build` | **pass** — no new dependencies (jszip reuse for timeline zip) |
| 4 | `vite preview` + `curl /` | **200**, correct `index.html` |
| 5 | `git diff --check` + full diff review | clean; no debug/secrets/churn |
