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

## Tests

```
npm install playwright      # once
bash tests/run.sh
```

Each suite boots the real app from a local static server and points it at a
fake AniList in `tests/anilist-fake.js` that answers the way the real one
does — `MediaListCollection` split into one list per status, server-side
state that a write actually changes, and failure modes (500, 429, timeout,
malformed JSON, a lying `navigator.onLine`) on demand.

Every one of these exists because something shipped broken:

| suite | guards against |
| --- | --- |
| `regress` | boot, every tab at two densities, grid columns staying equal, a lying `navigator.onLine`, the dead-API state |
| `test-mylist` | My List across every status filter and sort |
| `test-mylist-fresh` | an added show appearing without navigating; a failed list saying so instead of "empty" |
| `test-realflow` | the actual tap-through: detail → Add to list → pick status → Save |
| `test-ratelimit` | a write followed by a rate-limited refetch — must not claim the list is empty |
| `test-poisoned` | upgrading with a stale or corrupt persisted cache |
| `test-addtolist` | the list badge updating everywhere the moment a show is added |
| `test-stampede` | a write not marking the whole cache due for refresh |
| `test-failstates` | no view ever reporting "no results" when the request actually failed |
| `test-newviews` | the weekly schedule, search filters and Profile statistics — including that filter values travel as GraphQL variables, and that a bar with a width actually paints one |
| `test-mobile` | the mobile contract: no horizontal overflow and no touch target under 36px at four phone widths, no text field under 16px, `[hidden]` beating every component's display rule, and no inline styles in the markup |

The recurring bug in this app has been treating a failed request as empty
data. If you add a loader, make it return `null` on failure and render
something the user can retry — never an empty state.

Assert on **computed style**, not on the `hidden` attribute. `hidden` only
sets `display: none` through the UA stylesheet, so any author rule that
declares its own `display` beats it — a test that checked `el.hidden` passed
while four controls were still painted on screen. (`base.css` now carries
`[hidden] { display: none !important }`, but the testing lesson stands.)

## The mobile contract

The app is a phone app, and the things that make it feel like one are easy to
undo by accident, so `test-mobile` holds them:

- **Touch targets.** `--tap` (44px) is the floor for a standalone control.
  `--tap-sm` (36px) is the documented exception for chips and pills that sit
  several to a row, where 44 would force a wrap at 360px and cost more than it
  buys. A segmented-control button is 40px inside its own 44px track.
- **Text fields are 16px or larger.** Safari on iOS zooms the page in when you
  focus anything smaller, and leaves you zoomed. Four fields were under it.
- **`height: 100dvh`, not `100%`.** In a browser tab (as opposed to the
  installed PWA) `100%` resolves against the viewport with the URL bar
  collapsed, so the bottom nav sat below the fold while the bar was showing.
- **`overscroll-behavior: none`** on the document, so over-scrolling a list
  doesn't rubber-band the page or fire pull-to-refresh.
- **`touch-action: manipulation`** on everything tappable, which drops
  double-tap-to-zoom and the tap delay browsers hold while waiting for it,
  plus `user-select: none` so a firm press doesn't select the label.
- **Corners come from the `--radius-*` scale.** A chip in a wrapping or
  scrolling row is a pill; a chip in a fixed grid is a rounded rect.
- **No inline `style` attributes in `index.html`.** Spacing that lives in the
  markup can't follow the density tokens.

## The three list-aware views

Three screens are projections of the same AniList data:

- **Weekly schedule** (Seasonal → Schedule) — a rolling seven days built from
  each show's `nextAiringEpisode`, so every weekly show lands in exactly one
  bucket. The *My List* scope is one `WATCHING_QUERY`; *All airing* is one
  query for the 100 most popular releasing shows. Because `nextAiringEpisode`
  is always in the future, Today holds what is **still to come** today — the
  header says so.
- **Search filters** — one sheet, built from the option lists in `config.js`.
  Every value goes out as a GraphQL variable; nothing is interpolated into
  query text.
- **Profile statistics** — loaded when the tab opens, never at boot, since the
  boot-time `Viewer` call is what everything else waits behind.

A schedule row and a My List row are the same component
(`renderListEntryRow`); `opts.bare` is what a row for a show you don't track
uses, dropping the progress bar, the "behind" count and the swipe targets,
because none of them mean anything without a list entry.

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
