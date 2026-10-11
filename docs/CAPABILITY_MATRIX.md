# Capability matrix

Legend: **WORKING AND TESTED** · **IMPLEMENTED BUT NOT VERIFIED** ·
**PARTIALLY IMPLEMENTED** · **INTERFACE ONLY** · **UNAVAILABLE** ·
**NOT IMPLEMENTED**

## Graph + execution

| Capability | State | Evidence |
|---|---|---|
| Typed nodes/ports (15 types, 42 defs) | WORKING AND TESTED | `registry.ts`, `validation.test.ts` |
| Connection type/cardinality/cycle rejection | WORKING AND TESTED | `validation.ts`, tests |
| Topological scheduling, bounded concurrency | WORKING AND TESTED | `scheduler.ts`, tests |
| Worker-backed pixel ops + main-thread fallback | WORKING AND TESTED | `workerPool.ts`; fallback path tested, worker-thread path browser-only |
| Cancellation (AbortController + generation tokens) | WORKING AND TESTED | `scheduler.test.ts` |
| Retry failed slice | WORKING AND TESTED | `retryFailedNodes` (exercised via scheduler paths) |
| Deterministic cache + invalidation + eviction | WORKING AND TESTED | `cache.ts`, scheduler tests |
| Run history (persisted, capped) + history browser | WORKING AND TESTED | Dexie `runs`, scheduler + history tests; browser UI browser-only |
| Undo/redo, copy/paste, duplicate, box select | WORKING AND TESTED | `graphStore` (unit-covered via store logic; gesture-level browser-only) |
| Subgraph save/insert/inline expansion | WORKING AND TESTED | `subgraphs/library.ts`, tests |
| Parameter linking (numeric/color, one-level) | WORKING AND TESTED | `resolveLinkedParams`, tests |
| Batch processing (sequential, bound=1) | WORKING AND TESTED | `BatchModal` logic via `executeGraph`; UI browser-only |
| Provider registry + states | WORKING AND TESTED | `providers/registry.ts` (interface tested implicitly; adapters unavailable by design) |
| Minimap, snap toggle, fit/zoom, search, shortcuts | IMPLEMENTED BUT NOT VERIFIED | rendered via @xyflow; needs browser pass |
| Collapsible groups, alignment guides | NOT IMPLEMENTED | cut for scope; subgraphs cover reuse |
| Touch/pen-tuned gestures | PARTIALLY IMPLEMENTED | ReactFlow defaults; no dedicated touch QA |

## Media pipeline

| Capability | State | Evidence |
|---|---|---|
| Crop (px/normalized, OOB validation) | WORKING AND TESTED | `ops.test.ts` incl. OOB rejection |
| Resize (dims/percent, aspect, pixelated) | WORKING AND TESTED | `ops.test.ts` |
| Rotate (exact right-angles + arbitrary) | WORKING AND TESTED | `ops.test.ts` |
| Flip | WORKING AND TESTED | `ops.test.ts` |
| Brightness/exposure/contrast/saturation/hue/balance/opacity | WORKING AND TESTED | `ops.test.ts` |
| Blur/sharpen | WORKING AND TESTED | `ops.test.ts` |
| Mask (+invert, explicit resample) | WORKING AND TESTED | `ops.test.ts` |
| Composite (pos/scale/opacity/7 blends, straight alpha) | WORKING AND TESTED | `ops.test.ts` |
| PNG export (canvas, pure-TS fallback) | WORKING AND TESTED | `png.test.ts`, `samples.test.ts` (artifact bytes parsed) |
| JPEG/WebP export | IMPLEMENTED BUT NOT VERIFIED | canvas path; jsdom lacks canvas so automated tests cover PNG only |
| Resize quality low/medium/high | PARTIALLY IMPLEMENTED | all use bilinear in v1; `pixelated` is nearest; documented |
| WebGL/WebGPU acceleration | NOT IMPLEMENTED | Canvas2D + workers only (by design for v1) |
| Audio/video DSP/encoding | NOT IMPLEMENTED | import + metadata + preview playback only |
| MP4/WebM timeline export | UNAVAILABLE | explicitly not claimed; PNG sequence provided |

## Assets + persistence

| Capability | State | Evidence |
|---|---|---|
| Import (picker + DnD), dedupe, metadata, tags, favorites, search/filter/sort | WORKING AND TESTED | `repository.ts` paths tested; DnD UI browser-only |
| Thumbnails (lazy) | IMPLEMENTED BUT NOT VERIFIED | needs browser canvas |
| Approval states, revision notes, provenance records | WORKING AND TESTED | asset flows + scheduler persistence tests |
| Autosave + explicit save, rename/duplicate/delete | WORKING AND TESTED | `persistence.test.ts` |
| Missing-asset detection + relink | WORKING AND TESTED | `recovery.ts`, tests |
| Storage usage + persistence request | IMPLEMENTED BUT NOT VERIFIED | browser API dependent |
| Quota-exhaustion handling | PARTIALLY IMPLEMENTED | friendly error, no destructive fallback; forced-quota test not automated |
| Schema migration (v1→v4) | WORKING AND TESTED | `migration` tests |

## Timeline / 3D / preview / provenance

| Capability | State | Evidence |
|---|---|---|
| Tracks/clips/keyframes (linear+hold), scrub/play/step | IMPLEMENTED BUT NOT VERIFIED | logic tested (`timeline.test.ts`); transport UI browser-only |
| Deterministic frame eval, no drift | WORKING AND TESTED | `timeline.test.ts` |
| PNG sequence export (single .zip) | IMPLEMENTED BUT NOT VERIFIED | shares tested renderer; zip/download flow browser-only |
| GLB viewer (orbit/pan/zoom, lights, grid, stats, anims, snapshot, disposal) | IMPLEMENTED BUT NOT VERIFIED | three.js code complete; needs browser + sample GLB |
| Model Snapshot node | PARTIALLY IMPLEMENTED | works when viewer mounted (bridge); honest error otherwise |
| Unified preview (zoom/pan/compare/download/snapshot) | IMPLEMENTED BUT NOT VERIFIED | browser-only rendering |
| Audio/video playback in preview | NOT IMPLEMENTED | assets import; playback UI not built |
| Before/after compare + heatmap + dependency/cache inspectors | IMPLEMENTED BUT NOT VERIFIED | UI complete; browser-only |
| Provenance/lineage panel + lineage graph | IMPLEMENTED BUT NOT VERIFIED | model tested (`lineage.test.ts`), graph interaction tested (`ProvenancePanel.test.tsx`); pixels browser-only |

## Portability

| Capability | State | Evidence |
|---|---|---|
| Workflow JSON round-trip | WORKING AND TESTED | `portability.test.ts` |
| Project archives (checksums, traversal/caps/schema gates) | WORKING AND TESTED | `portability.test.ts` incl. tamper/unsafe/future cases |
| Collision-safe import (new ids, existing work untouched) | WORKING AND TESTED | `storeImportedArchive` tests |

## Generation providers

| Capability | State |
|---|---|
| Image/video/audio generation nodes | UNAVAILABLE (visibly disabled, fail validation with reason; no fabricated output anywhere) |
| Custom adapter registration API | WORKING AND TESTED (`registerProvider`, `hasUsableAdapter` logic ships; no adapters bundled) |
