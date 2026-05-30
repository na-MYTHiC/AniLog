# AniLog

Personal anime tracker built on the [AniList](https://anilist.co) GraphQL API.
Vanilla HTML / CSS / JS — no build step, no framework. Deploys as a static site
on GitHub Pages.

## Project Layout

```
AniLog/
├── index.html         # Thin shell — markup + <link>/<script> references
├── styles/
│   ├── base.css       # Design tokens (colors, density vars), themes, reset
│   └── app.css        # Components, layouts, modals, overlays
└── scripts/
    ├── config.js      # Constants — themes, OAuth, GraphQL fragments, sort options
    ├── state.js       # State object + persistence + OAuth hash bootstrap
    ├── api.js         # AniList GraphQL client + signIn / signOut / fetchViewer
    ├── render.js      # Helpers (escapeHtml, pickTitle, ...) + render functions
    └── app.js         # All UI — tabs, overlays, modals, detail page, swipe, boot
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

GitHub Pages, served from the `main` branch root. Hard-refresh after deploy
to bypass the browser cache.
