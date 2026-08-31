import { clubFamily, isOffTheDeck } from '../clubs.js';
import { SMASH_CEILING } from '../benchmarks/tour.js';
import { confidenceFor, round, type Finding, type Rule } from './types.js';

/**
 * Strike-quality rules: attack angle, low point, face contact, smash factor.
 *
 * These matter more than anything else for the average player. Path and face
 * decide where a well-struck ball goes; strike decides whether the ball was
 * well struck at all, and it is the single largest source of distance loss
 * and distance inconsistency below scratch.
 */

export const smashRule: Rule = {
  id: 'smash-factor',
  minShots: 5,
  run({ profile }): Finding[] {
    const s = profile.smashFactor;
    const ceiling = SMASH_CEILING[profile.club];
    if (s.n < 5 || !Number.isFinite(s.median) || ceiling === undefined) return [];

    const shortfall = ceiling - s.median;
    // 0.04 is roughly the point where a golfer would notice the distance loss.
    if (shortfall < 0.04) return [];

    const pct = round((shortfall / ceiling) * 100, 1);
    return [
      {
        id: 'low-smash-factor',
        club: profile.club,
        severity: shortfall >= 0.09 ? 'major' : 'minor',
        confidence: confidenceFor(s.n),
        title: `You are losing ball speed at impact with the ${profile.club}`,
        detail:
          `Median smash factor is ${round(s.median, 2)} against about ${round(ceiling, 2)} for a ` +
          `well-struck ${profile.club} — roughly ${pct}% of your potential ball speed left behind. ` +
          `Smash factor is almost entirely a strike-location and spin-loft story, not a swing-speed one, ` +
          `so this is distance available without swinging harder.`,
        evidence: [
          { label: 'Smash factor', value: round(s.median, 2), unit: '', reference: ceiling },
          { label: 'Club speed', value: round(profile.clubSpeed.median, 1), unit: 'mph' },
          { label: 'Ball speed', value: round(profile.ballSpeed.median, 1), unit: 'mph' },
          { label: 'Shots', value: s.n, unit: '' },
        ],
        drills: ['foot-spray-strike', 'towel-behind-ball', 'spin-loft-control'],
      },
    ];
  },
};

/**
 * Attack angle. The correct sign flips between driver and everything else,
 * which is why this is one rule with two branches rather than two thresholds.
 */
export const attackAngleRule: Rule = {
  id: 'attack-angle',
  minShots: 5,
  run({ profile }): Finding[] {
    const a = profile.attackAngle;
    if (a.n < 5 || !Number.isFinite(a.median)) return [];
    const m = a.median;

    if (profile.club === 'Dr') {
      if (m >= 0) return [];
      return [
        {
          id: 'driver-negative-aoa',
          club: 'Dr',
          severity: m <= -3 ? 'major' : 'minor',
          confidence: confidenceFor(a.n),
          title: 'You are hitting down on your driver',
          detail:
            `Median attack angle is ${round(m, 1)}° — descending. Off a tee, a downward strike adds ` +
            `spin and lowers launch, which is the classic high-spin, low-carry driver. Moving to a ` +
            `positive attack angle is usually worth more carry than any swing-speed work, and it is ` +
            `mostly a setup change.`,
          evidence: [
            { label: 'Attack angle', value: round(m, 1), unit: '°', reference: 0 },
            { label: 'Launch angle', value: round(profile.launchAngle.median, 1), unit: '°' },
            { label: 'Spin rate', value: round(profile.spinRate.median, 0), unit: 'rpm' },
            { label: 'Shots', value: a.n, unit: '' },
          ],
          drills: ['tee-height-aoa'],
        },
      ];
    }

    if (isOffTheDeck(profile.club) && m > 0) {
      return [
        {
          id: 'iron-positive-aoa',
          club: profile.club,
          severity: m >= 2 ? 'major' : 'minor',
          confidence: confidenceFor(a.n),
          title: `You are hitting up on your ${profile.club}`,
          detail:
            `Median attack angle is +${round(m, 1)}° with a club played off the turf. That means the ` +
            `club is bottoming out before the ball, which produces thin and fat shots from the same ` +
            `swing and makes distance control impossible. Irons want a descending strike, ball first.`,
          evidence: [
            { label: 'Attack angle', value: round(m, 1), unit: '°', reference: -3 },
            { label: 'Low point', value: round(profile.lowPointDistance.median, 1), unit: 'in' },
            { label: 'Shots', value: a.n, unit: '' },
          ],
          drills: ['towel-behind-ball', 'tee-forward-low-point'],
        },
      ];
    }

    return [];
  },
};

/**
 * Low point relative to the ball. Only meaningful for clubs played off the
 * turf, and only when the launch monitor actually reported it.
 */
export const lowPointRule: Rule = {
  id: 'low-point',
  minShots: 5,
  run({ profile }): Finding[] {
    const lp = profile.lowPointDistance;
    if (lp.n < 5 || !Number.isFinite(lp.median)) return [];
    if (!isOffTheDeck(profile.club)) return [];

    const findings: Finding[] = [];

    // Positive low point = after the ball = correct. Negative = behind = fat.
    if (lp.median < 0) {
      findings.push({
        id: 'low-point-behind-ball',
        club: profile.club,
        severity: lp.median <= -1.5 ? 'major' : 'minor',
        confidence: confidenceFor(lp.n),
        title: `Your low point is behind the ball with the ${profile.club}`,
        detail:
          `The club is reaching its lowest point ${round(Math.abs(lp.median), 1)} inches before the ball ` +
          `on a typical swing. Every shot is effectively a small fat shot, which costs both distance ` +
          `and consistency. Low point ahead of the ball is what "compression" actually means.`,
        evidence: [
          { label: 'Low point', value: round(lp.median, 1), unit: 'in', reference: 2 },
          { label: 'Attack angle', value: round(profile.attackAngle.median, 1), unit: '°' },
          { label: 'Shots', value: lp.n, unit: '' },
        ],
        drills: ['towel-behind-ball', 'tee-forward-low-point'],
      });
    } else if (lp.mad >= 2.0) {
      findings.push({
        id: 'low-point-inconsistent',
        club: profile.club,
        severity: lp.mad >= 3.0 ? 'major' : 'minor',
        confidence: confidenceFor(lp.n),
        title: `Your low point moves around with the ${profile.club}`,
        detail:
          `Low point varies by about ±${round(lp.mad, 1)} inches shot to shot even though its average ` +
          `position is fine. That variation is what turns into the occasional thin and the occasional ` +
          `fat from what feels like the same swing.`,
        evidence: [
          { label: 'Low point spread', value: round(lp.mad, 1), unit: 'in', reference: 2 },
          { label: 'Low point', value: round(lp.median, 1), unit: 'in' },
          { label: 'Shots', value: lp.n, unit: '' },
        ],
        drills: ['tee-forward-low-point', 'step-change-tempo'],
      });
    }

    return findings;
  },
};

/**
 * Strike location across the face. Heel and toe bias have different causes
 * and different fixes, so the direction is reported rather than just the
 * magnitude.
 */
export const impactLocationRule: Rule = {
  id: 'impact-location',
  minShots: 6,
  run({ profile }): Finding[] {
    const off = profile.impactOffset;
    if (off.n < 6 || !Number.isFinite(off.median)) return [];

    const findings: Finding[] = [];
    const biasMm = off.median;

    // 6 mm from centre is a consistent bias rather than noise.
    if (Math.abs(biasMm) >= 6) {
      const toe = biasMm > 0;
      findings.push({
        id: toe ? 'strike-toe-biased' : 'strike-heel-biased',
        club: profile.club,
        severity: Math.abs(biasMm) >= 12 ? 'major' : 'minor',
        confidence: confidenceFor(off.n),
        title: `You are striking the ${toe ? 'toe' : 'heel'} with the ${profile.club}`,
        detail:
          `Typical contact is ${round(Math.abs(biasMm), 1)} mm toward the ${toe ? 'toe' : 'heel'} of centre. ` +
          `Off-centre contact costs ball speed through gear effect and shifts the spin axis, so it ` +
          `changes both your distance and your curve — which is why it can look like a face problem.`,
        evidence: [
          { label: 'Impact offset', value: round(biasMm, 1), unit: 'mm', reference: 0 },
          { label: 'Smash factor', value: round(profile.smashFactor.median, 2), unit: '' },
          { label: 'Shots', value: off.n, unit: '' },
        ],
        drills: ['foot-spray-strike', 'gate-path'],
      });
    }

    if (off.mad >= 9) {
      findings.push({
        id: 'strike-scattered',
        club: profile.club,
        severity: off.mad >= 14 ? 'major' : 'minor',
        confidence: confidenceFor(off.n),
        title: `Your strike location is scattered with the ${profile.club}`,
        detail:
          `Contact moves about ±${round(off.mad, 1)} mm across the face shot to shot. Scattered contact ` +
          `is the most common cause of inconsistent distance, and it is worth fixing before any work ` +
          `on path or face — those numbers are unreliable when the strike is not repeatable.`,
        evidence: [
          { label: 'Strike spread', value: round(off.mad, 1), unit: 'mm', reference: 9 },
          { label: 'Shots', value: off.n, unit: '' },
        ],
        drills: ['foot-spray-strike', 'step-change-tempo'],
      });
    }

    return findings;
  },
};

/** How often the player mishits badly enough to lose the shot. */
export const mishitRateRule: Rule = {
  id: 'mishit-rate',
  minShots: 10,
  run({ profile }): Finding[] {
    if (profile.shotCount < 10) return [];
    if (clubFamily(profile.club) === 'putter') return [];
    if (profile.mishitRate < 0.15) return [];

    return [
      {
        id: 'high-mishit-rate',
        club: profile.club,
        severity: profile.mishitRate >= 0.25 ? 'major' : 'minor',
        confidence: confidenceFor(profile.shotCount),
        title: `About ${Math.round(profile.mishitRate * 100)}% of your ${profile.club} shots are badly struck`,
        detail:
          `${profile.mishitCount} of ${profile.shotCount} shots fell well short of your own typical strike. ` +
          `On the course that is roughly one shot in ${Math.max(2, Math.round(1 / profile.mishitRate))} ` +
          `costing you a full result — usually a bigger scoring problem than anything in your averages.`,
        evidence: [
          { label: 'Mishit rate', value: round(profile.mishitRate * 100, 0), unit: '%' },
          { label: 'Mishits', value: profile.mishitCount, unit: '' },
          { label: 'Shots', value: profile.shotCount, unit: '' },
        ],
        drills: ['foot-spray-strike', 'random-practice-block'],
      },
    ];
  },
};
