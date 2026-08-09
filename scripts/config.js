// AniLog — constants, OAuth config, and GraphQL fragments.
// Everything here is read-only configuration; no app state lives in this file.

// ============ THEMES ============
// Themes list — `color` is the accent used in dark / AMOLED modes. A few
// bright themes (Snow) need a darker swap for light mode so the accent
// doesn't disappear on a white surface — those specify `lightColor`.
const THEMES = [
  { id: 'iris',     name: 'Iris',     color: '#7c5cff' },
  { id: 'sakura',   name: 'Sakura',   color: '#ff6b9d' },
  { id: 'midnight', name: 'Midnight', color: '#4f46e5' },
  { id: 'forest',   name: 'Forest',   color: '#10b981' },
  { id: 'sunset',   name: 'Sunset',   color: '#f97316' },
  { id: 'ember',    name: 'Ember',    color: '#ef4444' },
  { id: 'solstice', name: 'Solstice', color: '#f59e0b' },
  { id: 'lavender', name: 'Lavender', color: '#a78bfa' },
  { id: 'ocean',    name: 'Ocean',    color: '#06b6d4' },
  { id: 'crimson',  name: 'Crimson',  color: '#e11d48' },
  { id: 'snow',     name: 'Snow',     color: '#eef2ff', lightColor: '#6b7280' },
];


// ============ ANILIST OAUTH ============
const ANILIST_CLIENT_ID = '42596';
// No redirect_uri param — AniList uses the redirect URL registered on the
// API client itself (https://na-mythic.github.io/AniLog/, see README).
const ANILIST_AUTH_URL = `https://anilist.co/api/v2/oauth/authorize?client_id=${ANILIST_CLIENT_ID}&response_type=token`;

const ANILIST = 'https://graphql.anilist.co';

// Web Push. Public half of the VAPID keypair — safe to ship, it's meant to be
// public. Generate a pair with `bash tools/gen-vapid.sh`, paste the public key
// here and add the private one as the VAPID_PRIVATE_KEY GitHub secret.
// Empty means push is simply unavailable and the UI says so.
//
// This line is the single source of truth: tools/send-push.js parses the key
// straight out of this file rather than taking it from a repo variable, so the
// two halves can't drift apart (a mismatch fails every send with a 403).
const VAPID_PUBLIC_KEY = 'BMGOxfc34-MFbwRPYpiyp8IJy-atWV67MB3ZnppJPj-4yQp2nJK4vkmItgopjrni7ZgKLaNpJgUj4-eQqbPo6xs';

// Edit pages for the two secrets the sender reads. Reinstalling the PWA
// destroys the push subscription, so PUSH_SUBSCRIPTION has to be re-pasted
// every time — linking straight at the field turns that from "navigate
// GitHub's settings on a phone" into paste-and-save.
const GITHUB_SECRETS = 'https://github.com/na-MYTHiC/AniLog/settings/secrets/actions';

const MEDIA_FRAGMENT = `
  id
  title { userPreferred english romaji }
  coverImage { large color }
  averageScore
  format
  episodes
  # Episode currently counting down. Aired = this minus one, which is the
  # only way to get a count for an ongoing show that hasn't announced a
  # total — those had no badge at all before.
  nextAiringEpisode { episode }
  season
  seasonYear
  # Which of the viewer's lists this is on, for the corner badge on cards.
  # Costs one small object per media and no extra request; AniList resolves
  # it against the token already on the call, and returns null when signed
  # out — so the badge simply doesn't render.
  mediaListEntry { status }
`;

// The detail query is split in two because the whole thing is ~29KB and only
// ~3KB of that is above the fold. Measured against Media(16498):
//   core            3.2KB   everything visible without scrolling
//   characters     16.0KB   55% of the payload — each entry carries a full
//                           voiceActors list with images
//   relations       5.1KB
//   recommendations 4.8KB
// Fetching core alone lets the page paint from a tenth of the bytes; the rest
// streams in behind it while the user is still reading the synopsis.
const MEDIA_DETAIL_CORE = `
  id
  title { userPreferred english romaji }
  coverImage { extraLarge large color }
  bannerImage
  description(asHtml: false)
  averageScore
  meanScore
  popularity
  favourites
  format
  status
  episodes
  duration
  season
  seasonYear
  genres
  type
  trailer { id site thumbnail }
  externalLinks { id url site icon color type language }
  mediaListEntry { id status score progress }
  studios(isMain: true) { nodes { id name } }
  nextAiringEpisode { airingAt episode timeUntilAiring }
  startDate { year month day }
  endDate { year month day }
`;

// Below-the-fold sections, fetched separately right after the core render.
const MEDIA_DETAIL_EXTRAS = `
  id
  characters(sort: ROLE, perPage: 12) {
    edges {
      role
      node {
        id
        name { userPreferred }
        image { large }
      }
      voiceActors {
        id
        name { userPreferred }
        image { large }
        languageV2
      }
    }
  }
  relations {
    edges {
      relationType
      node {
        id
        title { userPreferred english romaji }
        coverImage { large color }
        averageScore
        format
        episodes
        season
        seasonYear
        startDate { year month day }
        type
      }
    }
  }
  recommendations(sort: RATING_DESC, perPage: 12) {
    edges {
      node {
        mediaRecommendation {
          id
          title { userPreferred english romaji }
          coverImage { large color }
          averageScore
          format
          episodes
          season
          seasonYear
          type
        }
      }
    }
  }
`;

const SEASONS_ORDER = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];

const MEDIA_SORT_OPTIONS = [
  { value: 'POPULARITY_DESC', label: 'Popular' },
  { value: 'SCORE_DESC', label: 'Top Rated' },
  { value: 'TRENDING_DESC', label: 'Trending' },
  { value: 'START_DATE_DESC', label: 'Newest' },
];

const LIST_STATUS_OPTIONS = [
  { value: 'CURRENT',   label: 'Watching' },
  { value: 'PLANNING',  label: 'Planning' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'PAUSED',    label: 'Paused' },
  { value: 'DROPPED',   label: 'Dropped' },
  { value: 'REPEATING', label: 'Rewatching' },
  { value: 'ALL',       label: 'All' },
];
// AniList's MediaListSort enum values, plus one local sentinel.
// SCORE_DESC in MediaListSort means the VIEWER'S personal score, not the
// AniList community average — since users expect "Score" to reflect the
// AniList rating, we use a sentinel here and translate it in loadMyList /
// loadUserList (fetch by a real sort, then re-sort client-side by
// media.averageScore).
const LIST_SORT_OPTIONS = [
  { value: 'MEDIA_AVERAGE_SCORE_DESC', label: 'Score' },
  { value: 'MEDIA_TITLE_ROMAJI',       label: 'Title' },
  { value: 'PROGRESS_DESC',            label: 'Progress' },
  { value: 'UPDATED_TIME_DESC',        label: 'Last Updated' },
  { value: 'STARTED_ON_DESC',          label: 'Date Started' },
  { value: 'MEDIA_POPULARITY_DESC',    label: 'Popularity' },
  { value: 'ADDED_TIME_DESC',          label: 'Recently Added' },
];
