import type { Club, ClubFamily } from './schema.js';

/**
 * Club label normalisation.
 *
 * TrackMan lets the player name clubs fairly freely, and different facilities
 * and firmware versions write them differently: "7 Iron", "7i", "Iron 7",
 * "I7", "Pitching Wedge", "PW", "50°". Gapping analysis is worthless if
 * "7i" and "7 Iron" land in different buckets, so this runs on every row.
 */

/** Ordered longest-to-shortest. This ordering *is* the gapping sequence. */
export const CLUB_ORDER: Club[] = [
  'Dr', '2w', '3w', '4w', '5w', '7w',
  '2h', '3h', '4h', '5h', '6h',
  '1i', '2i', '3i', '4i', '5i', '6i', '7i', '8i', '9i',
  'PW', 'GW', 'SW', 'LW',
  'Putt',
];

const CLUB_RANK = new Map<Club, number>(CLUB_ORDER.map((c, i) => [c, i]));

/** Sort key for a club; `unknown` sorts to the end. */
export function clubRank(club: Club): number {
  return CLUB_RANK.get(club) ?? Number.MAX_SAFE_INTEGER;
}

export function compareClubs(a: Club, b: Club): number {
  return clubRank(a) - clubRank(b);
}

const EXACT: Record<string, Club> = {
  dr: 'Dr', driver: 'Dr', d: 'Dr', '1w': 'Dr', w1: 'Dr', '1wood': 'Dr',
  pw: 'PW', pitchingwedge: 'PW', pitch: 'PW',
  gw: 'GW', aw: 'GW', gapwedge: 'GW', approachwedge: 'GW', ut: 'GW',
  sw: 'SW', sandwedge: 'SW',
  lw: 'LW', lobwedge: 'LW',
  putt: 'Putt', putter: 'Putt', p: 'Putt',
};

/**
 * Loft-to-wedge mapping for facilities that label wedges by loft.
 * Deliberately coarse — 46-49 is a pitching wedge, 50-53 a gap wedge, and so
 * on. A player with a 52/56/60 set gets GW/SW/LW, which is what they call them.
 */
function wedgeFromLoft(loft: number): Club | null {
  if (loft >= 44 && loft <= 49) return 'PW';
  if (loft >= 50 && loft <= 53) return 'GW';
  if (loft >= 54 && loft <= 57) return 'SW';
  if (loft >= 58 && loft <= 64) return 'LW';
  return null;
}

/**
 * Map a raw club label onto the canonical set.
 * Returns 'unknown' rather than throwing — an unrecognised club still has
 * usable shot data, it just cannot take part in gapping.
 */
export function normaliseClub(raw: string | null | undefined): Club {
  if (!raw) return 'unknown';

  const cleaned = raw.trim().toLowerCase();
  if (cleaned === '') return 'unknown';

  const key = cleaned.replace(/[\s._\-#]/g, '');
  const exact = EXACT[key];
  if (exact) return exact;

  // Loft-labelled wedges: "52", "56°", "60 deg"
  const loftOnly = /^(\d{2})(?:°|deg|degrees)?$/.exec(key);
  if (loftOnly?.[1]) {
    const byLoft = wedgeFromLoft(Number(loftOnly[1]));
    if (byLoft) return byLoft;
  }

  // Number + family in either order: "7i", "i7", "7iron", "iron7", "3wood"
  const numFirst = /^(\d{1,2})(i|iron|w|wood|h|hy|hyb|hybrid|r|rescue)$/.exec(key);
  const famFirst = /^(i|iron|w|wood|h|hy|hyb|hybrid|r|rescue)(\d{1,2})$/.exec(key);
  const m = numFirst
    ? { num: numFirst[1], fam: numFirst[2] }
    : famFirst
      ? { num: famFirst[2], fam: famFirst[1] }
      : null;

  if (m?.num && m.fam) {
    const n = Number(m.num);
    const fam = m.fam;
    if (fam.startsWith('i')) {
      if (n >= 1 && n <= 9) return `${n}i` as Club;
    } else if (fam.startsWith('w')) {
      if (n === 1) return 'Dr';
      if ([2, 3, 4, 5, 7].includes(n)) return `${n}w` as Club;
    } else {
      // hybrid / rescue
      if (n >= 2 && n <= 6) return `${n}h` as Club;
    }
  }

  return 'unknown';
}

export function clubFamily(club: Club): ClubFamily {
  if (club === 'Dr') return 'driver';
  if (club === 'Putt') return 'putter';
  if (club === 'unknown') return 'unknown';
  if (club.endsWith('w')) return 'wood';
  if (club.endsWith('h')) return 'hybrid';
  if (club.endsWith('i')) return 'iron';
  return 'wedge';
}

/**
 * Whether the club is normally struck off the turf. Drives the low-point and
 * attack-angle rules, which invert between driver (hit up, off a tee) and
 * everything else (hit down, ball first).
 */
export function isOffTheDeck(club: Club): boolean {
  const fam = clubFamily(club);
  return fam === 'iron' || fam === 'wedge' || fam === 'hybrid';
}
