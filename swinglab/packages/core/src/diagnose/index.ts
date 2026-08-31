import type { Club, Shot, ShotSession } from '../schema.js';
import { markImplausible, markMishits } from '../stats/outliers.js';
import { buildClubProfiles, type ClubProfile } from '../stats/dispersion.js';
import { DRILLS, type Drill } from './drills.js';
import { gappingFindings } from './rules-gapping.js';
import { carryConsistencyRule, spinWindowRule } from './rules-spin.js';
import {
  attackAngleRule,
  impactLocationRule,
  lowPointRule,
  mishitRateRule,
  smashRule,
} from './rules-strike.js';
import { faceConsistencyRule, faceToPathRule, pathRule } from './rules-dplane.js';
import type { Finding, Rule, Severity } from './types.js';

export * from './types.js';
export * from './drills.js';

const PER_CLUB_RULES: Rule[] = [
  // Order here is not the output order — see `priority` below.
  smashRule,
  attackAngleRule,
  lowPointRule,
  impactLocationRule,
  mishitRateRule,
  faceToPathRule,
  pathRule,
  faceConsistencyRule,
  spinWindowRule,
  carryConsistencyRule,
];

/**
 * The coaching hierarchy, encoded.
 *
 * Strike comes before direction, and direction before spin, because that is
 * the order in which fixing something actually helps: face and path numbers
 * measured off a scattered strike are not trustworthy, and spin follows from
 * both. Presenting findings in severity order alone would routinely tell a
 * player to work on their spin rate while they are still hitting it off the
 * toe, which is how a data tool gives confidently unhelpful advice.
 */
const CATEGORY_WEIGHT: Record<string, number> = {
  'high-mishit-rate': 0,
  'strike-scattered': 1,
  'low-point-behind-ball': 1,
  'low-point-inconsistent': 2,
  'strike-toe-biased': 2,
  'strike-heel-biased': 2,
  'low-smash-factor': 3,
  'driver-negative-aoa': 3,
  'iron-positive-aoa': 3,
  'face-inconsistent': 4,
  'face-open-to-path': 5,
  'face-closed-to-path': 5,
  'path-out-to-in': 6,
  'path-in-to-out': 6,
  'carry-inconsistent': 7,
  'spin-too-high': 8,
  'spin-too-low': 8,
  'gap-inverted': 9,
  'gap-overlap': 10,
  'gap-oversized': 10,
};

const SEVERITY_RANK: Record<Severity, number> = { major: 0, minor: 1, info: 2 };
const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 } as const;

function priority(f: Finding): number {
  const category = CATEGORY_WEIGHT[f.id] ?? 50;
  return category * 100 + SEVERITY_RANK[f.severity] * 10 + CONFIDENCE_RANK[f.confidence];
}

export interface SessionReport {
  sessionId: string;
  shotCount: number;
  usableShotCount: number;
  clubsSeen: Club[];
  profiles: ClubProfile[];
  /** Ordered most worth working on first. */
  findings: Finding[];
  /** Deduplicated drills for the findings above, in the same priority order. */
  practicePlan: PracticeItem[];
}

export interface PracticeItem {
  drill: Drill;
  /** Which findings this drill addresses, by finding id. */
  addresses: string[];
  /** Position in the session; 1 is first. */
  order: number;
}

export interface DiagnoseOptions {
  /**
   * Hide findings the sample is too small to support. On by default —
   * a confident-sounding diagnosis from four shots is the fastest way to
   * lose a user's trust permanently.
   */
  hideLowConfidence?: boolean;
  /** Cap the plan so a session has a realistic amount of work in it. */
  maxDrills?: number;
}

/**
 * Run the full pipeline over one session.
 *
 * Mutates `session.shots` to attach outlier flags, then derives everything
 * else from the flagged shots.
 */
export function diagnoseSession(
  session: ShotSession,
  opts: DiagnoseOptions = {},
): SessionReport {
  const { hideLowConfidence = true, maxDrills = 4 } = opts;

  markImplausible(session.shots);
  markMishits(session.shots);

  const profiles = buildClubProfiles(session.shots);
  const findings: Finding[] = [];

  for (const profile of profiles) {
    for (const rule of PER_CLUB_RULES) {
      if (profile.representativeCount < rule.minShots && profile.shotCount < rule.minShots) continue;
      findings.push(...rule.run({ profile, allProfiles: profiles }));
    }
  }

  findings.push(...gappingFindings(profiles));

  const visible = hideLowConfidence
    ? findings.filter((f) => f.confidence !== 'low' || f.severity === 'major')
    : findings;

  visible.sort((a, b) => priority(a) - priority(b));

  return {
    sessionId: session.id,
    shotCount: session.shots.length,
    usableShotCount: session.shots.filter((s) => !s.flags.includes('implausible')).length,
    clubsSeen: profiles.map((p) => p.club),
    profiles,
    findings: visible,
    practicePlan: buildPracticePlan(visible, maxDrills),
  };
}

/**
 * Turn findings into a practice session.
 *
 * A drill earns its place by the highest-priority finding that calls for it,
 * and each drill appears once no matter how many findings recommend it — a
 * plan that says "face spray drill" four times is a worse plan, not a more
 * emphatic one.
 */
export function buildPracticePlan(orderedFindings: Finding[], maxDrills: number): PracticeItem[] {
  const chosen = new Map<string, string[]>();

  for (const finding of orderedFindings) {
    for (const drillId of finding.drills) {
      if (!DRILLS[drillId]) continue;
      const existing = chosen.get(drillId);
      if (existing) existing.push(finding.id);
      else if (chosen.size < maxDrills) chosen.set(drillId, [finding.id]);
    }
  }

  return [...chosen.entries()].map(([drillId, addresses], i) => ({
    drill: DRILLS[drillId] as Drill,
    addresses,
    order: i + 1,
  }));
}

/** Convenience: diagnose a bare list of shots without a session wrapper. */
export function diagnoseShots(shots: Shot[], opts?: DiagnoseOptions): SessionReport {
  return diagnoseSession(
    {
      id: 'ad-hoc',
      source: shots[0]?.source ?? 'manual',
      sourceRef: 'ad-hoc',
      handedness: 'right',
      startedAt: shots[0]?.time ?? null,
      shots,
    },
    opts,
  );
}
