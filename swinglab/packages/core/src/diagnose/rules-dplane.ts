import { clubFamily } from '../clubs.js';
import { confidenceFor, round, signed, type Finding, type Rule } from './types.js';

/**
 * D-plane rules: where the ball starts and which way it curves.
 *
 * The two relationships used here are the best-established in the game:
 *   - Start direction is dominated by face angle at impact.
 *   - Curvature is driven by face angle *relative to path* (face-to-path).
 * Both are measured directly by TrackMan, so these rules read the numbers
 * rather than modelling anything.
 */

/** Below this, a face-to-path number is shot-shaping, not a fault. */
const FACE_TO_PATH_MINOR = 2.0;
const FACE_TO_PATH_MAJOR = 4.0;

/** Path is only worth flagging on its own when it is genuinely extreme. */
const PATH_MINOR = 3.0;
const PATH_MAJOR = 6.0;

export const faceToPathRule: Rule = {
  id: 'face-to-path',
  minShots: 5,
  run({ profile }): Finding[] {
    const f = profile.faceToPath;
    if (f.n < 5 || !Number.isFinite(f.median)) return [];

    const m = f.median;
    const abs = Math.abs(m);
    if (abs < FACE_TO_PATH_MINOR) return [];

    const open = m > 0;
    const shape = open ? 'fade or slice' : 'draw or hook';
    const severity = abs >= FACE_TO_PATH_MAJOR ? 'major' : 'minor';

    return [
      {
        id: open ? 'face-open-to-path' : 'face-closed-to-path',
        club: profile.club,
        severity,
        confidence: confidenceFor(f.n),
        title: `Face is consistently ${open ? 'open' : 'closed'} to your path with the ${profile.club}`,
        detail:
          `Your face sits ${signed(m, 'open to the path', 'closed to the path')} on a typical swing ` +
          `(median of ${f.n} shots). That relationship is what curves the ball, so this club is ` +
          `producing a ${shape} whether or not you are trying to. ` +
          `Face angle averages ${signed(profile.faceAngle.median, 'open', 'closed')} and path ` +
          `${signed(profile.clubPath.median, 'in-to-out', 'out-to-in')}.`,
        evidence: [
          { label: 'Face to path', value: round(m, 1), unit: '°', reference: 0 },
          { label: 'Face angle', value: round(profile.faceAngle.median, 1), unit: '°' },
          { label: 'Club path', value: round(profile.clubPath.median, 1), unit: '°' },
          { label: 'Shots', value: f.n, unit: '' },
        ],
        drills: open ? ['split-hands-face', 'lead-arm-only', 'target-window'] : ['target-window', 'gate-path'],
      },
    ];
  },
};

export const pathRule: Rule = {
  id: 'club-path',
  minShots: 5,
  run({ profile }): Finding[] {
    const p = profile.clubPath;
    if (p.n < 5 || !Number.isFinite(p.median)) return [];

    const m = p.median;
    const abs = Math.abs(m);
    if (abs < PATH_MINOR) return [];

    const inToOut = m > 0;
    return [
      {
        id: inToOut ? 'path-in-to-out' : 'path-out-to-in',
        club: profile.club,
        severity: abs >= PATH_MAJOR ? 'major' : 'minor',
        confidence: confidenceFor(p.n),
        title: `Your ${profile.club} path runs ${inToOut ? 'in-to-out' : 'out-to-in'}`,
        detail:
          `Median club path is ${signed(m, 'in-to-out', 'out-to-in')} across ${p.n} shots. ` +
          `On its own a path this far from neutral limits which shot shapes are available to you, ` +
          `and it forces the face to compensate to hit a straight ball.`,
        evidence: [
          { label: 'Club path', value: round(m, 1), unit: '°', reference: 0 },
          { label: 'Shot-to-shot spread', value: round(p.mad, 1), unit: '°' },
          { label: 'Shots', value: p.n, unit: '' },
        ],
        drills: ['gate-path', 'step-change-tempo'],
      },
    ];
  },
};

/**
 * Face control: how repeatable the face is, independent of where it points.
 *
 * A player whose face varies by four degrees shot to shot cannot control a
 * start line no matter how good their average is, and averaging hides it
 * completely — +4 and -4 average to zero.
 */
export const faceConsistencyRule: Rule = {
  id: 'face-consistency',
  minShots: 8,
  run({ profile }): Finding[] {
    const f = profile.faceAngle;
    if (f.n < 8 || !Number.isFinite(f.mad)) return [];

    const family = clubFamily(profile.club);
    // Longer clubs magnify face error downrange, so the bar is tighter.
    const threshold = family === 'driver' || family === 'wood' ? 2.0 : 2.5;
    if (f.mad < threshold) return [];

    return [
      {
        id: 'face-inconsistent',
        club: profile.club,
        severity: f.mad >= threshold * 1.6 ? 'major' : 'minor',
        confidence: confidenceFor(f.n),
        title: `Face angle varies a lot shot to shot with the ${profile.club}`,
        detail:
          `Face angle swings about ±${round(f.mad, 1)}° around its median across ${f.n} shots, ` +
          `ranging from ${signed(f.min, 'open', 'closed')} to ${signed(f.max, 'open', 'closed')}. ` +
          `Start line is mostly face angle, so this is the number behind an unpredictable start ` +
          `direction — and it is invisible in an average, because open and closed misses cancel out.`,
        evidence: [
          { label: 'Face angle spread', value: round(f.mad, 1), unit: '°', reference: threshold },
          { label: 'Most open', value: round(f.max, 1), unit: '°' },
          { label: 'Most closed', value: round(f.min, 1), unit: '°' },
          { label: 'Shots', value: f.n, unit: '' },
        ],
        drills: ['target-window', 'lead-arm-only', 'step-change-tempo'],
      },
    ];
  },
};
