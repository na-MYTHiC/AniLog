# AniLog

Personal anime tracker built on the [AniList](https://anilist.co) GraphQL API.
Vanilla HTML / CSS / JS — no build step, no framework. Deploys as a static site
on GitHub Pages.

## Project Layout

```
AniLog/
├── index.html              # Thin shell — markup + <link>/<script> references
├── sw.js                   # Service worker — app-shell cache, push, updates
├── manifest.json           # PWA manifest (name, icons, display mode)
├── styles/
│   ├── base.css            # Design tokens (colour, density), themes, reset
│   └── app.css             # Components, layouts, modals, overlays
├── scripts/
│   ├── config.js           # Constants — themes, OAuth, GraphQL fragments, sorts
│   ├── state.js            # State object + persistence + OAuth hash bootstrap
│   ├── api.js              # AniList GraphQL client + signIn / signOut / viewer
│   ├── render.js           # Helpers (escapeHtml, pickTitle, …) + renderers
│   └── app.js              # All UI — tabs, overlays, detail page, swipe, boot
├── assets/
│   └── icons/              # icon.svg (source) + the icon-*.png generated from it
├── tools/
│   ├── gen-icons.ps1       # Regenerates every icon-*.png natively at each size
│   ├── gen-vapid.sh        # Prints a fresh VAPID keypair for push setup
│   ├── send-push.js        # The scheduled sender (run by the workflow below)
│   └── push-state.json     # Last notification id sent; written back by CI
└── .github/workflows/
    └── anilog-push.yml     # Cron that runs send-push.js every 15 minutes
```

### Why three files sit at the root

Not untidiness — each is pinned there:

- **`index.html`** is what GitHub Pages serves as the site root.
- **`sw.js`** must be at the root because a service worker can only control
  URLs at or below its own path. Moved to `assets/sw.js` it would control
  `/assets/` and nothing else, killing offline caching and push. Overriding
  that needs a `Service-Worker-Allowed` header, which Pages cannot send.
- **`manifest.json`** resolves `start_url` and `scope` relative to itself, so
  it stays next to the page it describes.

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

The public VAPID key lives in `scripts/config.js` and is already committed —
it's meant to ship in the client. Setup is three repo **secrets**, added at
Settings → Secrets and variables → Actions:

| Secret | Where it comes from |
| --- | --- |
| `VAPID_PRIVATE_KEY` | `bash tools/gen-vapid.sh` — prints both halves. Must pair with the public key in `config.js`; regenerating means replacing both and re-enrolling every device. |
| `ANILIST_TOKEN` | App → Profile → **Show AniList token for setup** → Copy token. The sender reads *your* notifications, so it needs it. |
| `PUSH_SUBSCRIPTION` | App → Profile → **Enable push notifications** → Copy. One blob per device; for several devices store a JSON array of them. |

Order doesn't matter. Until all three exist the workflow exits 0 with a line
saying which are missing, so no run goes red mid-setup.

### Testing it

Actions → **Send AniLog push notifications** → **Run workflow**. Two ways to
run it:

- **Left unticked** — a normal run. Sends anything new from the last 6 hours,
  same as the cron. Usually logs "Nothing new to send", which is a pass but
  an unsatisfying one.
- **`resend_today` ticked** — replays everything from the last 24 hours,
  ignoring what's already been sent, capped at 20 so a busy day can't bury
  the phone. If AniList has nothing at all in that window it sends one
  synthetic "AniLog test" notification instead, so the run always tells you
  something definite.

A test run never advances `push-state.json`, so it can't cause the next real
run to skip anything. Replayed notifications also get a unique tag suffix —
Android collapses same-tag notifications, so without it a resend of something
already delivered would silently do nothing visible.

Two of the three are copyable from the phone itself, which is the point: push
gets set up on the device that receives it, and a phone has no devtools
console to read `localStorage` with.

Notes:

- **Android / Chrome** accepts push in an ordinary browser tab — installing to
  the Home Screen makes it more reliable but isn't required. On Android 13+,
  Chrome itself also needs notification permission at the OS level, or the
  in-app grant silently goes nowhere.
- Scheduled workflows are best-effort: GitHub delays them under load, so
  `*/15` means "roughly every 15 minutes", occasionally worse. It also
  disables the schedule after 60 days without repo activity.
- **iOS only allows Web Push for a Home Screen PWA**, never a Safari tab. The
  Profile screen detects that case specifically (by user agent) and explains it
  rather than offering a button that can't work; Android never hits that path.
- Subscriptions expire when the app is deleted or push is reset. The sender
  logs that clearly; you re-enable in the app and update the secret. It can't
  self-heal — the subscription lives in a secret the workflow can't rewrite.
  The **Copy & open GitHub secret** button in the setup-codes panel goes
  straight to that field, which is the whole re-pairing: tap, paste, save.
- **Updating doesn't need a reinstall.** The registration in `index.html`
  uses `updateViaCache: 'none'` and calls `reg.update()` on every foreground,
  and the worker uses `skipWaiting()` + `clients.claim()`, so backgrounding
  and reopening picks up a new build on its own. Reinstalling is strictly
  worse: it wipes `localStorage` (sign-in) and kills the push subscription,
  forcing the secret to be re-pasted for no gain.
- `tools/push-state.json` tracks the last notification id sent, so nothing goes
  out twice. The workflow commits it when it changes.

## Hosting

GitHub Pages, served from the `main` branch root.

Bump **both** `VERSION` in `sw.js` and the version string in `index.html`'s
footer on every deploy — the service worker keys its cache off `VERSION`, so
without a bump clients keep serving the old build.

How a client picks the new build up: `sw.js` calls `skipWaiting()` on install,
so the new worker always takes over, and the page decides what to do about it
in the `controllerchange` handler. Within 8 seconds of page load it reloads
silently (the app was just opened — nothing to preserve); after that it raises
the update banner and lets the user choose, rather than yanking the page away
mid-scroll.

Do **not** move that decision into the worker by dropping `skipWaiting()`.
v4.49 tried it, and it stranded every client running older code: the new
worker sat in `waiting` with nothing able to release it, and the app reported
an update it could never apply. Whatever gates the update has to live on the
page, where new code can always override old.
