/**
 * The drill library.
 *
 * Curated and static — no API, no subscription, no per-request cost. Every
 * drill is a well-known coaching staple rather than anything invented here,
 * and each is tied to the specific measured fault it addresses so the app
 * never prescribes a drill it cannot justify from the data.
 */

export interface Drill {
  id: string;
  name: string;
  /** What the player actually does. */
  how: string;
  /** Why this drill addresses the measured fault. */
  why: string;
  /** Roughly how long a useful dose is. */
  dose: string;
}

export const DRILLS: Record<string, Drill> = {
  'gate-path': {
    id: 'gate-path',
    name: 'Gate drill for club path',
    how: 'Place two alignment sticks or headcovers to form a gate angled along your intended path, one just outside the ball and one just inside and behind it. Swing through the gate without touching either.',
    why: 'Path is a motion problem, not an intention problem. A physical gate gives immediate feedback on every rep, which changes path far faster than trying to feel it.',
    dose: '15–20 slow swings, then 10 at full speed.',
  },
  'split-hands-face': {
    id: 'split-hands-face',
    name: 'Split-hand release',
    how: 'Grip with your hands two inches apart and make half swings, feeling the lead wrist flex and the trail wrist extend through impact.',
    why: 'Exaggerates the forearm rotation that squares the face, so a face left consistently open to the path starts arriving square.',
    dose: '20 half swings, then alternate 3 split-hand and 3 normal.',
  },
  'towel-behind-ball': {
    id: 'towel-behind-ball',
    name: 'Towel behind the ball',
    how: 'Lay a folded towel one clubhead-width behind the ball. Strike the ball without touching the towel.',
    why: 'Directly punishes a low point that is behind the ball. Contact moves forward within a few swings because the feedback is unmissable.',
    dose: '15 shots with a mid iron. Stop if you hit the towel three times in a row and shorten the swing.',
  },
  'tee-forward-low-point': {
    id: 'tee-forward-low-point',
    name: 'Two-tee low point ladder',
    how: 'Push a tee into the mat an inch ahead of the ball. Try to clip both ball and tee, ball first.',
    why: 'Trains a low point ahead of the ball, which is what produces compression and consistent iron distance.',
    dose: '20 shots, 8-iron.',
  },
  'foot-spray-strike': {
    id: 'foot-spray-strike',
    name: 'Face spray for strike location',
    how: 'Mist the clubface with foot spray or use impact tape. Hit five shots and photograph the pattern before wiping.',
    why: 'Turns strike location from a guess into a measurement. Heel and toe bias have completely different causes, and you cannot fix what you cannot see.',
    dose: '5 shots per check, three checks per session.',
  },
  'tee-height-aoa': {
    id: 'tee-height-aoa',
    name: 'Tee it up and hit up',
    how: 'Tee the driver so half the ball sits above the crown, play the ball off your lead heel, and feel your trail shoulder work under on the through swing.',
    why: 'A negative attack angle with driver adds spin and costs carry. Ball position and tee height change attack angle more reliably than any swing thought.',
    dose: '15 drivers, checking attack angle every five.',
  },
  'lead-arm-only': {
    id: 'lead-arm-only',
    name: 'Lead-arm-only swings',
    how: 'Choke down on a 9-iron and make half swings with your lead arm only, hitting soft shots.',
    why: 'Removes the trail-hand steering that flips the face. Builds the sense of the club releasing from the body rather than the hands.',
    dose: '10 swings, then 5 normal shots.',
  },
  'step-change-tempo': {
    id: 'step-change-tempo',
    name: 'Step-through tempo',
    how: 'Start with feet together, step into the shot with your lead foot as you transition, then hit.',
    why: 'Forces a sequenced transition. Wide dispersion with a stable face usually means timing, not mechanics.',
    dose: '12 shots with a 7-iron.',
  },
  'ladder-gapping': {
    id: 'ladder-gapping',
    name: 'Carry ladder',
    how: 'Hit three shots each with consecutive clubs, recording carry. Work out which two clubs overlap and which gap is oversized.',
    why: 'Gapping problems are equipment and technique problems in disguise. You cannot fix them without a clean carry number per club.',
    dose: 'One full pass through the bag, three shots per club.',
  },
  'spin-loft-control': {
    id: 'spin-loft-control',
    name: 'Delofted punch shots',
    how: 'Hit three-quarter punch shots with a 7-iron, hands ahead, finishing low and left.',
    why: 'Reduces dynamic loft and therefore spin loft, which lowers spin and raises smash factor when spin is excessive.',
    dose: '15 punch shots, then 5 normal to see the difference.',
  },
  'target-window': {
    id: 'target-window',
    name: 'Start-line window',
    how: 'Set two sticks eight feet ahead forming a window three feet wide. Every shot must start through the window.',
    why: 'Start line is nearly all face angle. A window makes face control measurable shot to shot instead of theoretical.',
    dose: '20 shots, scoring each one in or out.',
  },
  'random-practice-block': {
    id: 'random-practice-block',
    name: 'Randomised club rotation',
    how: 'Never hit the same club twice in a row. Call your shot shape and target before each swing.',
    why: 'Blocked practice inflates range performance and does not transfer to the course. Randomised practice transfers.',
    dose: 'The last 20 balls of every session.',
  },
};

export function drill(id: string): Drill | null {
  return DRILLS[id] ?? null;
}
