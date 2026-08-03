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

## Hosting

GitHub Pages, served from the `main` branch root.

Bump **both** `VERSION` in `sw.js` and the version string in `index.html`'s
footer on every deploy — the service worker keys its cache off `VERSION`, so
without a bump clients keep serving the old build. With a bump, a single
refresh is enough: the registration in `index.html` reloads once when the new
worker takes over.
