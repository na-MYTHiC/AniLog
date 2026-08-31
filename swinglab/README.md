# SwingLab

An AI golf coach built around TrackMan simulator data. Import a session, get a
ranked list of what is actually wrong and a practice plan that addresses it.

Runs entirely on your own device. No account, no server, no subscription, no
API bills — see [Why it is free](#why-it-is-free).

## Status

| Piece | State |
| --- | --- |
| `packages/core` — schema, ingest, diagnosis engine | **Built and tested**, 63 tests passing |
| `apps/app` — React PWA (browser, mobile, installable) | **Built and verified** in a headless browser |
| `apps/desktop` — Tauri shell + folder watcher | **Scaffolded, not compiled** — needs platform webview dev packages |

---

## Getting your data out of TrackMan

This was the first question worth answering, because it determines what the
product can be. The findings, so the next person does not have to redo them:

| Path | Automatable? | Reality |
| --- | --- | --- |
| **Partner APIs** — Cloud GraphQL (`api.golf.trackman.com/graphql`), Range REST API, TM4 device WebSocket, Booking & Payments webhooks | Fully | Real and documented, but behind a commercial agreement. The Range API targets range *operators*, not simulator bays. Worth applying for; not worth depending on. |
| **TPS export** — Table View → File Options → *TrackMan CSV* / *TrackMan Stroke File* | Near-automatic | Works today, needs nobody's permission, and it is the player's own data. 40+ columns. **This is what SwingLab is built on.** |
| **TrackMan Golf app / mytrackman.com** — every sim and range shot auto-syncs, with videos and course scorecards | No | The data is all there, but TrackMan's software terms prohibit "page-scrape, robot, spider or other automatic devices" against it. Scripted login is both a terms violation and permanently fragile. |
| **Screenshots / PDF session reports** | Vision extraction | The fallback for rented bays and other people's facilities. Planned, not built. |

**The design consequence:** the desktop shell watches your TPS export folder,
so exporting once at the end of a session is the entire workflow. That is as
close to automatic as anyone can legitimately get today. If TrackMan ever
grants API access it becomes one more entry in
`packages/core/src/ingest/registry.ts`, and nothing else in the codebase
changes.

## Why it is free

Every design decision that could have introduced a cost was routed around:

- **No LLM API.** Diagnosis is a deterministic rule engine over measured
  numbers, and the drills are a curated static library. This is not a
  compromise — see [Why the maths is not done by a model](#why-the-maths-is-not-done-by-a-model).
- **No backend and no database.** Sessions live in `localStorage` on the
  device. Nothing is uploaded, so there is nothing to host.
- **No app store.** Mobile is a PWA — installable from the browser, no
  developer-program fee. The desktop shell builds and runs locally for free;
  only *distributing signed binaries* costs money, and that is optional.
- **No paid tooling.** TypeScript, Vite, React, Vitest, Tauri — all free.

The one genuine cost, if you ever want it, is App Store distribution
(Apple $99/yr, Google $25 once). Nothing in the current design requires it.

## Why the maths is not done by a model

Ball flight is physics with well-understood relationships: face-to-path
governs curvature, spin loft governs spin, low point governs strike quality.
Code applies those correctly every time. A language model asked to do the same
arithmetic is fluent and occasionally wrong — the worst possible combination
in a tool someone uses to change their swing.

So every finding in `packages/core/src/diagnose/` is produced by a rule with
explicit thresholds and stated evidence. If a narration layer is added later
(a local Ollama model, or your own free API key), it will receive findings as
input and will not be permitted to invent new ones.

The same principle drives three behaviours worth knowing about:

- **It stays quiet when the data cannot support a claim.** Fewer than seven
  shots with a club is flagged low-confidence and minor findings are hidden.
- **It does not diagnose fields the hardware never measured.** TrackMan iO
  Home reports ball data plus a few club numbers; TM4 reports everything.
  Rules skip themselves rather than inventing inputs.
- **It will not invent gaps across clubs you did not hit.** A session of
  driver, 5-iron, 7-iron and wedge does not have a "61-yard hole" in the bag —
  it has an unhit 3-wood. Only genuinely adjacent clubs produce a gapping
  finding.

## Architecture

```
ingest adapters      TrackMan CSV │ stroke file │ (screenshot) │ (partner API)
        ↓
canonical shot schema        packages/core/src/schema.ts
        ↓
outlier + robust stats       medians and MAD, never means
        ↓
deterministic rule engine    packages/core/src/diagnose/
        ↓
findings + practice plan
        ↓
apps/app (PWA)  ·  apps/desktop (Tauri shell + folder watcher)
```

`packages/core` is pure TypeScript with no network, filesystem or platform
APIs, so the identical engine runs in the browser, in the desktop window and
in the test suite.

### Layout

```
packages/core/src/
├── schema.ts              Canonical Shot / ShotSession + units + sign conventions
├── units.ts               Unit parsing and conversion (metric exports, European decimals)
├── clubs.ts               Club label normalisation and bag ordering
├── ingest/                One adapter per launch monitor + a registry
├── stats/                 Robust summaries, mishit detection, per-club profiles
├── benchmarks/            Tour reference tables and sane windows
└── diagnose/              The rules, the drill library, and the orchestrator

apps/app/                  React PWA — drop a CSV, read the report
apps/desktop/              Tauri shell — watches the TPS export folder
fixtures/                  Sample TrackMan exports (imperial and metric)
```

## Development

```bash
pnpm install
pnpm test          # 63 tests in packages/core
pnpm typecheck
pnpm build         # core, then the web app
pnpm dev           # web app at http://localhost:5173
```

Drop `fixtures/trackman-session-imperial.csv` on the running app to see a
full report without owning a TrackMan.

## Roadmap

Ordered by value, not by ease:

1. **Longitudinal trends** — the same findings across sessions, so the app can
   say "your low point moved 2 inches back over three weeks". The single
   biggest thing the current version lacks.
2. **Screenshot ingest** — vision extraction from a photo of the TPS screen,
   for rented bays.
3. **Strokes gained for simulator rounds** — needs lie and distance per shot,
   which the shot CSV does not carry. Requires course-round parsing or a
   lightweight round-entry mode.
4. **More launch monitors** — Foresight, Uneekor, SkyTrak, Garmin. One adapter
   each, no other changes.
5. **Optional narration** — local Ollama or a user-supplied free API key,
   strictly on top of computed findings.
6. **Video** — phone capture plus on-device pose estimation, correlated
   against the numbers.

## Prior art

SimSights Golf, SHOTMETRICS AI and ShotIQ all do CSV-to-AI-analysis already,
and several vendors demoed in-simulator AI coaching at the 2026 PGA Show. The
differentiation here has to be depth on TrackMan specifically, honesty about
what the data can and cannot support, and the longitudinal coaching
relationship — not the fact that it parses a CSV.
