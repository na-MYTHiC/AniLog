import type { Club } from '../schema.js';
import type { ClubProfile } from '../stats/dispersion.js';

/**
 * A finding is a claim about the player's game, computed in code.
 *
 * The whole design rests on this: findings are produced by deterministic
 * rules over measured numbers, never by a language model. Ball flight is
 * physics with well-understood relationships — face-to-path governs
 * curvature, spin loft governs spin, low point governs strike — and code
 * applies those relationships correctly every time. A model asked to do the
 * same arithmetic will be fluent and occasionally wrong, which is the worst
 * possible combination in a coaching tool.
 *
 * An optional narration layer may later turn these findings into friendlier
 * prose. It receives findings as input and may not invent new ones.
 */
export interface Finding {
  /** Stable rule identifier, safe to use as a translation or drill key. */
  id: string;
  /** The club this concerns, or null for a bag-wide finding such as gapping. */
  club: Club | null;
  severity: Severity;
  confidence: Confidence;
  /** One-line statement of the pattern, in the player's language. */
  title: string;
  /** The evidence, spelled out with the actual numbers. */
  detail: string;
  /** Machine-readable numbers behind the claim, for charts and for tests. */
  evidence: Evidence[];
  /** Drill ids from the drill library, most relevant first. */
  drills: string[];
}

export type Severity = 'info' | 'minor' | 'major';
export type Confidence = 'low' | 'medium' | 'high';

export interface Evidence {
  label: string;
  value: number;
  unit: string;
  /** Reference value this was judged against, when there is one. */
  reference?: number;
}

/** Everything a rule is allowed to see. */
export interface RuleContext {
  profile: ClubProfile;
  /** All profiles in the session, for rules that need cross-club context. */
  allProfiles: ClubProfile[];
}

export interface Rule {
  id: string;
  /** Minimum representative shots before this rule may fire at all. */
  minShots: number;
  run(ctx: RuleContext): Finding[];
}

/**
 * Sample-size driven confidence.
 *
 * Nine shots at a 7-iron is a hint. Thirty is a pattern. The UI is expected
 * to show low-confidence findings differently — or hide them — rather than
 * presenting a three-shot trend as a diagnosis.
 */
export function confidenceFor(n: number): Confidence {
  if (n >= 15) return 'high';
  if (n >= 7) return 'medium';
  return 'low';
}

export function round(n: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Format a signed number with an explicit direction word.
 *
 * Rounds before taking the absolute value so the prose and the evidence rows
 * never disagree — rounding -3.85 to -3.8 for the evidence but 3.85 to 3.9
 * for the sentence makes a report look wrong even when the maths is right.
 */
export function signed(n: number, positive: string, negative: string, dp = 1): string {
  const r = round(n, dp);
  return `${Math.abs(r)}° ${r >= 0 ? positive : negative}`;
}
