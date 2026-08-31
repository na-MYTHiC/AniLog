import { CLUB_ORDER, clubFamily, clubRank, compareClubs } from '../clubs.js';
import { confidenceFor, round, type Finding, type Rule } from './types.js';
import type { ClubProfile } from '../stats/dispersion.js';
import type { Club } from '../schema.js';

/**
 * Bag gapping.
 *
 * Runs once across all clubs rather than per club, so it is invoked
 * separately from the per-club rules. Requires a real carry median per club,
 * which in practice means several shots each — a gapping verdict from two
 * swings per club is worse than no verdict, because the player may go and
 * change their set on the strength of it.
 */

const MIN_SHOTS_PER_CLUB = 4;
/** Adjacent full-swing clubs closer than this are effectively duplicates. */
const OVERLAP_YARDS = 6;
/** Wider than this and there is a distance the player simply cannot hit. */
const OVERSIZED_YARDS = 20;

/**
 * Are these two clubs actually next to each other in a real bag?
 *
 * A session where the player hit driver, 5-iron, 7-iron and wedge shows a
 * "61-yard gap" between driver and 5-iron — but they plainly own a 3-wood or
 * a hybrid, they just did not hit it today. Reporting that as a hole in the
 * bag is confidently wrong, and it is the exact failure mode this engine
 * exists to avoid. So an oversized-gap finding requires that no canonical
 * club sits between the two; overlaps and inversions stay valid either way,
 * because those are problems no unhit club can explain away.
 */
function areAdjacentInBag(longer: Club, shorter: Club): boolean {
  const a = clubRank(longer);
  const b = clubRank(shorter);
  if (a >= b) return false;
  for (let r = a + 1; r < b; r++) {
    const between = CLUB_ORDER[r];
    if (!between) continue;
    const fam = clubFamily(between);
    if (fam !== 'putter' && fam !== 'unknown') return false;
  }
  return true;
}

export function gappingFindings(profiles: ClubProfile[]): Finding[] {
  const eligible = profiles
    .filter((p) => {
      const fam = clubFamily(p.club);
      if (fam === 'putter' || fam === 'unknown') return false;
      return p.carry.n >= MIN_SHOTS_PER_CLUB && Number.isFinite(p.carry.median);
    })
    .sort((a, b) => compareClubs(a.club, b.club));

  if (eligible.length < 2) return [];

  const findings: Finding[] = [];

  for (let i = 0; i < eligible.length - 1; i++) {
    const longer = eligible[i];
    const shorter = eligible[i + 1];
    if (!longer || !shorter) continue;

    const gap = longer.carry.median - shorter.carry.median;
    const n = Math.min(longer.carry.n, shorter.carry.n);

    if (gap < 0) {
      findings.push({
        id: 'gap-inverted',
        club: longer.club,
        severity: 'major',
        confidence: confidenceFor(n),
        title: `Your ${shorter.club} carries further than your ${longer.club}`,
        detail:
          `${shorter.club} is carrying ${round(shorter.carry.median, 0)} yards against ` +
          `${round(longer.carry.median, 0)} for the ${longer.club} — the longer club is going shorter. ` +
          `That is normally a strike or a loft problem in the longer club rather than a set makeup ` +
          `problem, and it means one of these two clubs is doing no work in your bag.`,
        evidence: [
          { label: `${longer.club} carry`, value: round(longer.carry.median, 0), unit: 'yds' },
          { label: `${shorter.club} carry`, value: round(shorter.carry.median, 0), unit: 'yds' },
          { label: 'Shots (smaller sample)', value: n, unit: '' },
        ],
        drills: ['ladder-gapping', 'foot-spray-strike'],
      });
      continue;
    }

    if (gap < OVERLAP_YARDS) {
      findings.push({
        id: 'gap-overlap',
        club: longer.club,
        severity: 'minor',
        confidence: confidenceFor(n),
        title: `Your ${longer.club} and ${shorter.club} carry almost the same distance`,
        detail:
          `Only ${round(gap, 0)} yards separates them (${round(longer.carry.median, 0)} and ` +
          `${round(shorter.carry.median, 0)} yards). Two clubs covering one number means a gap ` +
          `somewhere else in the bag is doing double duty.`,
        evidence: [
          { label: 'Gap', value: round(gap, 0), unit: 'yds', reference: OVERLAP_YARDS },
          { label: `${longer.club} carry`, value: round(longer.carry.median, 0), unit: 'yds' },
          { label: `${shorter.club} carry`, value: round(shorter.carry.median, 0), unit: 'yds' },
        ],
        drills: ['ladder-gapping'],
      });
    } else if (gap > OVERSIZED_YARDS && areAdjacentInBag(longer.club, shorter.club)) {
      findings.push({
        id: 'gap-oversized',
        club: longer.club,
        severity: gap > OVERSIZED_YARDS * 1.5 ? 'major' : 'minor',
        confidence: confidenceFor(n),
        title: `There is a ${round(gap, 0)}-yard hole between your ${longer.club} and ${shorter.club}`,
        detail:
          `${longer.club} carries ${round(longer.carry.median, 0)} yards and ${shorter.club} carries ` +
          `${round(shorter.carry.median, 0)}. Any approach that lands in between forces you to ` +
          `manufacture a shot, which is where big misses come from.`,
        evidence: [
          { label: 'Gap', value: round(gap, 0), unit: 'yds', reference: OVERSIZED_YARDS },
          { label: `${longer.club} carry`, value: round(longer.carry.median, 0), unit: 'yds' },
          { label: `${shorter.club} carry`, value: round(shorter.carry.median, 0), unit: 'yds' },
        ],
        drills: ['ladder-gapping'],
      });
    }
  }

  return findings;
}

export const gappingRule: Rule = {
  id: 'gapping',
  minShots: 0,
  // Gapping is bag-wide; the engine calls `gappingFindings` once rather than
  // running this per club. Kept in the Rule shape so the registry is uniform.
  run(): Finding[] {
    return [];
  },
};
