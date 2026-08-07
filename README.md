# AniLog

Personal anime tracker built on the [AniList](https://anilist.co) GraphQL API.
Vanilla HTML / CSS / JS — no build step, no framework. Deploys as a static site
on GitHub Pages.

## Project Layout

```
AniLog/
├── index.html         # Thin shell — markup + <link>/<script> references
├── sw.js              # Service worker — app-shell cache + update handling
├── manifest.json      # PWA manifest (name, icons, display mode)
├── icon.svg           # Source icon; icon-*.png are generated from it
├── styles/
│   ├── base.css       # Design tokens (colors, density vars), themes, reset
│   └── app.css        # Components, layouts, modals, overlays
├── scripts/
│   ├── config.js      # Constants — themes, OAuth, GraphQL fragments, sort options
│   ├── state.js       # State object + persistence + OAuth hash bootstrap
│   ├── api.js         # AniList GraphQL client + signIn / signOut / fetchViewer
│   ├── render.js      # Helpers (escapeHtml, pickTitle, ...) + render functions
│   └── app.js         # All UI — tabs, overlays, modals, detail page, swipe, boot
└── tools/
    └── gen-icons.ps1  # Regenerates every icon-*.png natively at each size
```

Scripts share a single global scope (classic `<script>` tags, no modules).
Load order in `index.html` is significant — `config` → `state` → `api` →
`render` → `app`.

## Auth

OAuth Implicit Grant via AniList:
- Client ID `42596` registered with redirect URL
  `https://na-mythic.github.io/AniLog/`
- Token stored in `localStorage` under `anilog-prefs`
- `state.accessToken` is the auth header source for all authenticated calls

## Push notifications

The in-app poll in `app.js` only fires while a tab is open. Real push needs
something to POST to the push endpoint on a schedule — a device can't schedule
its own. That sender is `.github/workflows/anilog-push.yml`, which is free:
GitHub doesn't bill Actions minutes on public repositories.

Setup, once:

1. `bash tools/gen-vapid.sh` — generates a VAPID keypair locally with OpenSSL
   (Git Bash has it; no Node needed). The private key never leaves the machine.
2. Paste the **public** key into `VAPID_PUBLIC_KEY` in `scripts/config.js`,
   and add it as a repo **variable** of the same name so the workflow can read
   it. It isn't secret — it ships in the client either way.
3. Add repo **secrets**: `VAPID_PRIVATE_KEY`, and `ANILIST_TOKEN` (the sender
   reads your notifications, so it needs your token).
4. Open the app → Profile → **Enable push notifications**, then copy the
   subscription blob it shows into a `PUSH_SUBSCRIPTION` secret. To cover more
   than one device, store a JSON array of blobs.
5. Add a repo variable `PUSH_ENABLED` = `true`. The workflow no-ops until then,
   so the Actions tab isn't full of failures mid-setup.

Notes:

- **iOS only allows Web Push for a Home Screen PWA**, never a Safari tab. The
  Profile screen detects this and says so rather than offering a button that
  can't work.
- Subscriptions expire when the app is deleted or push is reset. The sender
  logs that clearly; you re-enable in the app and update the secret. It can't
  self-heal — the subscription lives in a secret the workflow can't rewrite.
- `tools/push-state.json` tracks the last notification id sent, so nothing goes
  out twice. The workflow commits it when it changes.

## Hosting

GitHub Pages, served from the `main` branch root.

Bump **both** `VERSION` in `sw.js` and the version string in `index.html`'s
footer on every deploy — the service worker keys its cache off `VERSION`, so
without a bump clients keep serving the old build. With a bump, a single
refresh is enough: the registration in `index.html` reloads once when the new
worker takes over.
