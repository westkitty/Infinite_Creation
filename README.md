# Infinite Creation Studio — Omni Edition

A real offline visual production environment: typed node workflows, genuine
Canvas 2D + worker image processing, persistent assets, deterministic
execution with caching/cancellation, timeline animation, GLB inspection,
provenance, subgraphs, batch runs, and checksummed portable archives.

## Run it

```bash
npm install
npm run dev      # develop
npm run build    # typecheck + production build -> dist/
npm test         # 69 automated tests (vitest)
```

Serve `dist/` from any static server for offline use — no runtime network,
accounts, telemetry, or AI services. See `docs/USER_GUIDE.md`.

## Docs

- `docs/USER_GUIDE.md` — end-user workflows
- `docs/ARCHITECTURE.md` — subsystem contracts and key decisions
- `docs/CAPABILITY_MATRIX.md` — working / partial / unavailable (no collapsing)
- `docs/LIMITATIONS.md` — honest unsupported-features list
- `docs/VALIDATION_REPORT.md` — executed commands and results

## First milestone check (definition of done)

Load **Sample A**, press **Run**, open the export node's preview, download
the PNG — then reload the app and confirm the project survived. Automated
proof: `npm test` (`samples.test.ts` executes A/B/C headlessly and parses
the emitted PNG bytes).
