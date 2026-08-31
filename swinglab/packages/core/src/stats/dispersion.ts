import type { Club, Shot } from '../schema.js';
import { compareClubs } from '../clubs.js';
import { pluck, summarise, type Summary } from './robust.js';
import { representative, usable } from './outliers.js';

/**
 * Per-club aggregates — the input to every diagnosis rule and every chart.
 *
 * Computed once per session (or per rolling window) so that rules do not each
 * re-derive the same medians from raw shots.
 */
export interface ClubProfile {
  club: Club;
  /** Shots after implausible rows are dropped, mishits included. */
  shotCount: number;
  /** Shots the medians below are computed from. */
  representativeCount: number;
  mishitCount: number;
  mishitRate: number;

  clubSpeed: Summary;
  attackAngle: Summary;
  clubPath: Summary;
  faceAngle: Summary;
  faceToPath: Summary;
  dynamicLoft: Summary;
  spinLoft: Summary;
  lowPointDistance: Summary;
  impactOffset: Summary;
  impactHeight: Summary;

  ballSpeed: Summary;
  smashFactor: Summary;
  launchAngle: Summary;
  launchDirection: Summary;
  spinRate: Summary;
  spinAxis: Summary;

  carry: Summary;
  total: Summary;
  side: Summary;
  curve: Summary;
  apexHeight: Summary;
  landingAngle: Summary;

  /** Two-sigma dispersion ellipse in yards, from carry and side. */
  dispersion: DispersionEllipse | null;
}

export interface DispersionEllipse {
  /** Median carry, yards. */
  centreCarry: number;
  /** Median side offset, yards; + is right. */
  centreSide: number;
  /** Depth of the pattern (long/short), yards, ~95% of shots. */
  depth: number;
  /** Width of the pattern (left/right), yards, ~95% of shots. */
  width: number;
}

export function buildClubProfile(club: Club, shots: Shot[]): ClubProfile {
  const all = usable(shots);
  const rep = representative(shots);
  const mishits = all.length - rep.length;

  const s = (get: (shot: Shot) => number | null) => summarise(pluck(rep, get));

  const carry = s((x) => x.carry);
  const side = s((x) => x.side);

  return {
    club,
    shotCount: all.length,
    representativeCount: rep.length,
    mishitCount: mishits,
    mishitRate: all.length === 0 ? 0 : mishits / all.length,

    clubSpeed: s((x) => x.clubSpeed),
    attackAngle: s((x) => x.attackAngle),
    clubPath: s((x) => x.clubPath),
    faceAngle: s((x) => x.faceAngle),
    faceToPath: s((x) => x.faceToPath),
    dynamicLoft: s((x) => x.dynamicLoft),
    spinLoft: s((x) => x.spinLoft),
    lowPointDistance: s((x) => x.lowPointDistance),
    impactOffset: s((x) => x.impactOffset),
    impactHeight: s((x) => x.impactHeight),

    ballSpeed: s((x) => x.ballSpeed),
    smashFactor: s((x) => x.smashFactor),
    launchAngle: s((x) => x.launchAngle),
    launchDirection: s((x) => x.launchDirection),
    spinRate: s((x) => x.spinRate),
    spinAxis: s((x) => x.spinAxis),

    carry,
    total: s((x) => x.total),
    side,
    curve: s((x) => x.curve),
    apexHeight: s((x) => x.apexHeight),
    landingAngle: s((x) => x.landingAngle),

    dispersion: buildEllipse(carry, side),
  };
}

function buildEllipse(carry: Summary, side: Summary): DispersionEllipse | null {
  if (carry.n < 3 || side.n < 3) return null;
  if (!Number.isFinite(carry.median) || !Number.isFinite(side.median)) return null;
  return {
    centreCarry: carry.median,
    centreSide: side.median,
    depth: 4 * carry.mad,
    width: 4 * side.mad,
  };
}

/** Build one profile per club present, in long-to-short order. */
export function buildClubProfiles(shots: Shot[]): ClubProfile[] {
  const byClub = new Map<Club, Shot[]>();
  for (const shot of shots) {
    const list = byClub.get(shot.club) ?? [];
    list.push(shot);
    byClub.set(shot.club, list);
  }
  return [...byClub.entries()]
    .map(([club, group]) => buildClubProfile(club, group))
    .sort((a, b) => compareClubs(a.club, b.club));
}
