import type { Club } from '../schema.js';

/**
 * Tour benchmark reference values.
 *
 * PROVENANCE — read before trusting these numbers.
 *
 * These are TrackMan's widely republished PGA and LPGA Tour averages. They
 * are a *reference frame*, not a target: telling a 15-handicap that their
 * 7-iron spins 1,500 rpm less than a tour player is context, not a fault.
 * TrackMan has revised the published table (notably in 2024), so before this
 * ships to anyone the values below should be re-checked against TrackMan's
 * current published averages and `revisedAt` bumped.
 *
 * Every rule that consumes these treats them as soft context. No finding is
 * ever raised purely because a player differs from a tour average — see
 * `diagnose/` for the windows that actually drive findings.
 */

export const TOUR_TABLE_REVISED_AT = '2026-08-31';
export const TOUR_TABLE_SOURCE =
  'TrackMan published PGA/LPGA Tour averages; verify against trackman.com before release.';

export interface TourRow {
  clubSpeed: number;
  ballSpeed: number;
  smashFactor: number;
  launchAngle: number;
  spinRate: number;
  carry: number;
}

export type TourSet = 'pga' | 'lpga';

const PGA: Partial<Record<Club, TourRow>> = {
  Dr: { clubSpeed: 113, ballSpeed: 167, smashFactor: 1.48, launchAngle: 10.9, spinRate: 2686, carry: 275 },
  '3w': { clubSpeed: 107, ballSpeed: 158, smashFactor: 1.48, launchAngle: 9.2, spinRate: 3655, carry: 243 },
  '5w': { clubSpeed: 103, ballSpeed: 152, smashFactor: 1.47, launchAngle: 9.4, spinRate: 4350, carry: 230 },
  '3h': { clubSpeed: 100, ballSpeed: 146, smashFactor: 1.46, launchAngle: 10.2, spinRate: 4437, carry: 225 },
  '3i': { clubSpeed: 98, ballSpeed: 142, smashFactor: 1.45, launchAngle: 10.4, spinRate: 4630, carry: 212 },
  '4i': { clubSpeed: 96, ballSpeed: 137, smashFactor: 1.43, launchAngle: 11.0, spinRate: 4836, carry: 203 },
  '5i': { clubSpeed: 94, ballSpeed: 135, smashFactor: 1.41, launchAngle: 12.1, spinRate: 5361, carry: 194 },
  '6i': { clubSpeed: 92, ballSpeed: 131, smashFactor: 1.38, launchAngle: 14.1, spinRate: 6231, carry: 183 },
  '7i': { clubSpeed: 90, ballSpeed: 127, smashFactor: 1.33, launchAngle: 16.3, spinRate: 7097, carry: 172 },
  '8i': { clubSpeed: 87, ballSpeed: 120, smashFactor: 1.32, launchAngle: 18.1, spinRate: 7998, carry: 160 },
  '9i': { clubSpeed: 85, ballSpeed: 115, smashFactor: 1.28, launchAngle: 20.4, spinRate: 8647, carry: 148 },
  PW: { clubSpeed: 83, ballSpeed: 109, smashFactor: 1.23, launchAngle: 24.2, spinRate: 9304, carry: 136 },
};

const LPGA: Partial<Record<Club, TourRow>> = {
  Dr: { clubSpeed: 94, ballSpeed: 140, smashFactor: 1.48, launchAngle: 13.2, spinRate: 2611, carry: 218 },
  '3w': { clubSpeed: 90, ballSpeed: 132, smashFactor: 1.47, launchAngle: 11.2, spinRate: 2704, carry: 195 },
  '5w': { clubSpeed: 88, ballSpeed: 128, smashFactor: 1.47, launchAngle: 12.1, spinRate: 4501, carry: 185 },
  '7w': { clubSpeed: 85, ballSpeed: 123, smashFactor: 1.45, launchAngle: 12.7, spinRate: 4693, carry: 174 },
  '4i': { clubSpeed: 80, ballSpeed: 116, smashFactor: 1.45, launchAngle: 14.3, spinRate: 4801, carry: 169 },
  '5i': { clubSpeed: 79, ballSpeed: 114, smashFactor: 1.44, launchAngle: 14.8, spinRate: 5081, carry: 161 },
  '6i': { clubSpeed: 78, ballSpeed: 112, smashFactor: 1.43, launchAngle: 17.1, spinRate: 5943, carry: 152 },
  '7i': { clubSpeed: 76, ballSpeed: 107, smashFactor: 1.41, launchAngle: 19.0, spinRate: 6699, carry: 141 },
  '8i': { clubSpeed: 74, ballSpeed: 103, smashFactor: 1.39, launchAngle: 20.8, spinRate: 7494, carry: 130 },
  '9i': { clubSpeed: 72, ballSpeed: 100, smashFactor: 1.38, launchAngle: 23.9, spinRate: 8078, carry: 119 },
  PW: { clubSpeed: 70, ballSpeed: 93, smashFactor: 1.33, launchAngle: 25.6, spinRate: 8403, carry: 107 },
};

export function tourRow(club: Club, set: TourSet): TourRow | null {
  return (set === 'pga' ? PGA : LPGA)[club] ?? null;
}

/**
 * Realistic smash-factor ceilings by club.
 *
 * These are what a *well-struck* shot achieves, not a tour average, and they
 * are the reference the strike-quality rule uses. Smash falls with loft
 * because more loft means more spin loft means less energy transferred
 * forward — a 1.25 smash with a pitching wedge is a good strike, and flagging
 * it against the driver's 1.50 would be nonsense.
 */
export const SMASH_CEILING: Partial<Record<Club, number>> = {
  Dr: 1.50, '2w': 1.49, '3w': 1.48, '4w': 1.48, '5w': 1.47, '7w': 1.46,
  '2h': 1.46, '3h': 1.46, '4h': 1.45, '5h': 1.45, '6h': 1.44,
  '1i': 1.46, '2i': 1.45, '3i': 1.45, '4i': 1.43, '5i': 1.41,
  '6i': 1.38, '7i': 1.35, '8i': 1.32, '9i': 1.28,
  PW: 1.24, GW: 1.20, SW: 1.16, LW: 1.12,
};

/**
 * Spin windows that indicate a real problem, in rpm.
 *
 * Wide on purpose. These are "this is costing you distance or control"
 * boundaries, not optimisation targets — optimal spin depends on club speed,
 * launch angle and ball, and a fitting is the right tool for that. Only
 * clubs where a spin problem is both common and clearly diagnosable from
 * shot data alone appear here.
 */
export const SPIN_WINDOW: Partial<Record<Club, [number, number]>> = {
  Dr: [1800, 3400],
  '3w': [2600, 4600],
  '5w': [3200, 5300],
  '5i': [3800, 6600],
  '6i': [4500, 7400],
  '7i': [5200, 8300],
  '8i': [6000, 9200],
  '9i': [6800, 10000],
  PW: [7500, 11000],
};
