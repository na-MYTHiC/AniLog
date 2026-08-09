// Polls AniList for new notifications and delivers them as Web Push.
// Run on a schedule by .github/workflows/anilog-push.yml.
//
// Why this exists: the Push API requires *something* to POST to the push
// endpoint — a phone can't schedule its own push. This is that something, and
// on a public repo it costs nothing.
//
// Env (all three are repo secrets — nothing else to configure):
//   ANILIST_TOKEN      AniList access token — reads YOUR notifications
//   VAPID_PRIVATE_KEY  private half of the VAPID keypair
//   PUSH_SUBSCRIPTION  one subscription JSON, or a JSON array of them
//
// The public half is not an input: it's read out of scripts/config.js, which
// already has to carry it for the client. Keeping one copy means the pair can
// never half-update.

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const STATE_PATH = path.join(__dirname, 'push-state.json');
const CONFIG_PATH = path.join(__dirname, '..', 'scripts', 'config.js');
const ANILIST = 'https://graphql.anilist.co';
// Nothing older than this is ever sent — otherwise the first run after a long
// outage would dump a backlog of stale alerts onto the lock screen.
const MAX_AGE_SECONDS = 6 * 60 * 60;

// ---- Test mode ----
// Set by the workflow's "resend_today" dispatch input. Widens the window to a
// day, ignores the already-sent marker, and — crucially — does NOT advance
// that marker, so a test can't make the next real run skip anything.
const RESEND_TODAY = process.env.RESEND_TODAY === 'true';
const TEST_AGE_SECONDS = 24 * 60 * 60;
// A quiet day shouldn't leave the test ambiguous, so a resend with nothing to
// resend sends this instead. Proves the whole chain end to end.
const TEST_MAX_SEND = 20;

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (e) {
    return { lastId: 0 };
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

// Pulled out of the client config by regex rather than by requiring the file:
// config.js is a classic script that assigns bare globals, so `require` would
// throw. One line, one source of truth.
function readPublicKey() {
  const src = fs.readFileSync(CONFIG_PATH, 'utf8');
  const match = src.match(/const\s+VAPID_PUBLIC_KEY\s*=\s*'([^']*)'/);
  return match ? match[1] : '';
}

// 404/410 mean the subscription is dead (app deleted, push reset). Nothing to
// do automatically — it lives in a secret this can't edit — so say so clearly
// enough to act on.
function reportSendError(err) {
  if (err.statusCode === 404 || err.statusCode === 410) {
    console.error('A subscription has expired — re-enable push in the app and update PUSH_SUBSCRIPTION.');
  } else {
    console.error(`Send failed (${err.statusCode || 'unknown'}): ${err.message}`);
  }
}

function parseSubscriptions(raw) {
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

// Thrown when AniList is the problem rather than this setup. Distinguished so
// main() can exit quietly instead of failing the workflow — see the bottom of
// the file.
class UpstreamError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchNotifications(token, perPage) {
  // resetNotificationCount:false — reading here must not clear the badge the
  // user sees in the app.
  const query = `
    query {
      Page(page: 1, perPage: ${perPage}) {
        notifications(resetNotificationCount: false) {
          __typename
          ... on AiringNotification {
            id createdAt episode
            media { id title { userPreferred english romaji } coverImage { large } }
          }
          ... on FollowingNotification       { id createdAt context user { id name avatar { large } } }
          ... on ActivityLikeNotification    { id createdAt context activityId user { id name avatar { large } } }
          ... on ActivityReplyNotification   { id createdAt context activityId user { id name avatar { large } } }
          ... on ActivityMentionNotification { id createdAt context activityId user { id name avatar { large } } }
        }
      }
    }`;

  // Retry transient failures. Without this a single bad minute at AniList
  // killed the whole run: one request, no timeout, and the job sat on an open
  // socket for 60s before the gateway returned 504. The 20s timeout leaves
  // room for all three attempts inside one job.
  const ATTEMPTS = 3;
  let lastFailure = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(ANILIST, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      // Timeout, DNS, connection reset — all upstream, all worth retrying.
      lastFailure = new UpstreamError(`AniList unreachable: ${e.message}`);
      if (attempt < ATTEMPTS) { await sleep(attempt * 3000); continue; }
      throw lastFailure;
    }

    if (!res.ok) {
      // Always read the body before deciding. It has to be drained anyway —
      // an unread response keeps its socket in undici's pool with the event
      // loop pinned open, so the process hangs at the end instead of exiting.
      // Reading it as text costs nothing extra and is the difference between
      // "AniList responded 400" and knowing why.
      const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 300);
      const where = `AniList responded ${res.status}${detail ? ` — ${detail}` : ''}`;

      // 401/403 mean the token is dead: retrying can only produce the same
      // answer, so fail immediately and loudly.
      if (res.status === 401 || res.status === 403) throw new Error(where);

      // Everything else gets retried, including 400. A 400 is supposed to mean
      // a malformed query, but this query is a constant — and run #76 got one
      // and failed while the identical request succeeded on the runs either
      // side of it. Whatever AniList means by that, it isn't "your query is
      // wrong", and one attempt shouldn't decide.
      lastFailure = res.status === 429 || res.status >= 500
        ? new UpstreamError(where)   // recovers on its own; a green run
        : new Error(where);          // if it survives every retry, it's ours
      if (attempt < ATTEMPTS) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
        await sleep(retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : attempt * 3000);
        continue;
      }
      throw lastFailure;
    }
    const json = await res.json();
    if (json.errors) throw new Error(`AniList: ${json.errors[0]?.message || 'query failed'}`);
    return json.data?.Page?.notifications || [];
  }

  throw lastFailure || new UpstreamError('AniList unreachable');
}

// Where tapping the notification should land. The app has exactly two
// destinations — a media page and a user profile — and no single-activity
// view, so an activity notification opens the person who caused it. That's
// what tapping the same row inside the app does (handleNotifTap in app.js);
// push should not behave differently.
//
// Encoded into the URL as well as the data payload because a cold start has
// no page to message: the service worker can only call openWindow(url), so a
// target that lives solely in postMessage is lost whenever the app is closed
// — which is most of the time, and the whole point of push.
function targetUrl(p) {
  if (p.mediaId) return `./?media=${p.mediaId}`;
  // Ahead of the user: a like or reply is about the post, not the person.
  if (p.activityId) return `./?activity=${p.activityId}`;
  if (p.userId) return `./?user=${p.userId}&name=${encodeURIComponent(p.userName || '')}`;
  return './';
}

function toPayload(n) {
  const title = n.media?.title?.english || n.media?.title?.userPreferred || n.media?.title?.romaji;
  const u = n.user;
  const fromUser = (body, tag) => ({
    title: 'AniLog',
    body,
    tag,
    icon: u?.avatar?.large,
    activityId: n.activityId || null,
    userId: u?.id || null,
    userName: u?.name || null,
  });

  switch (n.__typename) {
    case 'AiringNotification':
      return {
        title: 'New episode',
        body: `Episode ${n.episode} of ${title} just aired.`,
        icon: n.media?.coverImage?.large,
        tag: `airing-${n.id}`,
        mediaId: n.media?.id || null,
      };
    case 'FollowingNotification':
      return fromUser(`${u?.name} started following you.`, `follow-${n.id}`);
    case 'ActivityLikeNotification':
      return fromUser(`${u?.name} liked your activity.`, `like-${n.id}`);
    case 'ActivityReplyNotification':
      return fromUser(`${u?.name} replied to your activity.`, `reply-${n.id}`);
    case 'ActivityMentionNotification':
      return fromUser(`${u?.name} mentioned you.`, `mention-${n.id}`);
    default:
      return null;
  }
}

async function main() {
  const { ANILIST_TOKEN, VAPID_PRIVATE_KEY, PUSH_SUBSCRIPTION } = process.env;
  const VAPID_PUBLIC_KEY = readPublicKey();

  const missing = Object.entries({ ANILIST_TOKEN, VAPID_PRIVATE_KEY, PUSH_SUBSCRIPTION })
    .filter(([, v]) => !v)
    .map(([k]) => k);

  // Not configured yet is a normal state, not a failure — exiting 0 keeps the
  // Actions tab green while the secrets are still being filled in, instead of
  // mailing a failure notice every 15 minutes.
  if (missing.length) {
    console.log(`Push not configured yet — missing secret(s): ${missing.join(', ')}.`);
    console.log('See the setup notes in README.md. Nothing to do; exiting cleanly.');
    return;
  }
  if (!VAPID_PUBLIC_KEY) {
    console.log('No VAPID_PUBLIC_KEY in scripts/config.js — nothing to send with. Exiting cleanly.');
    return;
  }

  webpush.setVapidDetails('https://na-mythic.github.io/AniLog/', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const state = readState();
  const subs = parseSubscriptions(PUSH_SUBSCRIPTION);

  if (RESEND_TODAY) console.log('TEST MODE: resending the last 24h, ignoring the sent marker.');

  const notifications = await fetchNotifications(ANILIST_TOKEN, RESEND_TODAY ? 50 : 15);
  if (!notifications.length) console.log('AniList returned no notifications at all.');

  const cutoff = Math.floor(Date.now() / 1000) - (RESEND_TODAY ? TEST_AGE_SECONDS : MAX_AGE_SECONDS);
  let fresh = notifications
    .filter((n) => n && (RESEND_TODAY || n.id > state.lastId) && (n.createdAt || 0) >= cutoff)
    .sort((a, b) => a.id - b.id);   // oldest first, so lastId ends up correct

  // Advance the marker to the newest id we SAW, not just the ones we sent —
  // otherwise anything skipped by the age cutoff gets re-examined forever.
  const newestSeen = Math.max(...notifications.map((n) => n.id || 0), state.lastId);

  if (RESEND_TODAY && fresh.length > TEST_MAX_SEND) {
    console.log(`${fresh.length} in the last 24h — sending the newest ${TEST_MAX_SEND} so the phone isn't buried.`);
    fresh = fresh.slice(-TEST_MAX_SEND);
  }

  // A quiet day would otherwise end the test with "nothing to send", which
  // proves nothing. Send a synthetic one so the result is never ambiguous.
  if (RESEND_TODAY && !fresh.length) {
    console.log('Nothing on AniList in the last 24h — sending a synthetic test notification instead.');
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const payload = {
      title: 'AniLog test',
      body: `Push is working. Sent ${stamp} UTC.`,
      tag: `test-${Date.now()}`,
      url: './',
    };
    let ok = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
        ok += 1;
      } catch (err) {
        reportSendError(err);
      }
    }
    console.log(`Test notification sent to ${ok}/${subs.length} subscription(s).`);
    return;   // never touches the marker
  }

  if (!fresh.length) {
    console.log('Nothing new to send.');
    if (newestSeen !== state.lastId) writeState({ lastId: newestSeen });
    return;
  }

  let sent = 0;

  for (const n of fresh) {
    const payload = toPayload(n);
    if (!payload) continue;
    payload.url = targetUrl(payload);
    // Android collapses same-tag notifications. On a resend the tags match
    // ones already delivered, so without this the test would look like
    // nothing arrived.
    if (RESEND_TODAY) payload.tag = `${payload.tag}-retest-${Date.now()}`;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
        sent += 1;
      } catch (err) {
        reportSendError(err);
      }
    }
  }

  console.log(`Sent ${sent} notification(s) across ${subs.length} subscription(s).`);
  // A test must not move the marker, or it would suppress the real send of
  // anything it just replayed.
  if (RESEND_TODAY) {
    console.log('Test mode — leaving the sent marker untouched.');
    return;
  }
  writeState({ lastId: newestSeen });
}

main().catch((err) => {
  console.error(err.message);
  // AniList being down is not a broken setup, and this runs on a schedule —
  // the marker hasn't moved, so the next run picks up whatever was missed.
  // Failing the job here just emails "all jobs have failed" for a hiccup
  // nobody needs to act on. A red run should mean something is genuinely
  // wrong: expired token, bad VAPID key, malformed subscription.
  if (err instanceof UpstreamError) {
    console.error('Transient upstream failure — skipping this run, the next one will catch up.');
    // Exit explicitly rather than returning. Falling off the end waits for the
    // event loop to drain, and a half-finished HTTP client can keep it alive
    // indefinitely — a hung job is worse than the failed one this replaces.
    process.exit(0);
  }
  process.exit(1);
});
