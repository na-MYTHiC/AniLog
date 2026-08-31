# SwingLab desktop shell

Wraps the same web app in a native window and adds the one thing a browser
cannot do: **watch a folder**.

## Why this exists

TrackMan has no public API for simulator shot data — the Cloud GraphQL API,
the Range REST API and the TM4 WebSocket protocol are all partner-gated
behind a commercial agreement, and driving the consumer portal with a script
is prohibited by TrackMan's own software terms. What is fully available is
the player's own data via **TPS → Table View → export as TrackMan CSV**.

So the desktop shell closes the gap: point it at the folder TPS exports into,
and a session appears in the app seconds after you export it. That turns
"manual import" into one click at the end of a session, which is as close to
automatic as anyone can legitimately get today.

If TrackMan ever grants API access, it becomes one more entry in
`packages/core/src/ingest/registry.ts` and nothing else changes.

## Status

**The Rust in `src-tauri/` has not been compiled in this environment** — it
needs the platform webview development packages (`webkit2gtk` on Linux) that
are not installed here. Treat it as a reviewed scaffold, not a verified
build. Everything in `packages/core` and `apps/app` *is* built and tested.

## Running it

```bash
pnpm install
pnpm --filter @swinglab/app build     # the shell loads apps/app/dist
pnpm --filter @swinglab/desktop dev
```

Free to build and run locally. Distributing a signed binary is where the
platform vendors start charging; unsigned local builds are not.
