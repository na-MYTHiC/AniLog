/**
 * The canonical shot schema.
 *
 * Every ingest adapter — TrackMan CSV today, the TrackMan partner API or a
 * Foresight/Uneekor/SkyTrak export later — converts into exactly this shape.
 * Nothing downstream of ingest is allowed to know which launch monitor the
 * data came from. That rule is what keeps the analysis engine portable.
 *
 * CANONICAL UNITS. Adapters must convert; the engine never guesses.
 *
 *   speeds            mph
 *   angles            degrees
 *   spin rate         rpm
 *   flight distances  yards   (carry, total, side, sideTotal, curve)
 *   apex height       feet
 *   low point         inches
 *   impact position   mm      (offset, height — signed, see below)
 *   time              seconds
 *
 * Apex and low point deliberately break the "one linear unit" rule because
 * feet and inches are the units golfers and coaches actually speak in for
 * those two numbers. Apex in yards and low point in yards both read as
 * nonsense on a report, and a unit nobody sanity-checks is a unit that hides
 * bugs.
 *
 * SIGN CONVENTIONS (right-handed golfer, looking down the target line).
 * A left-handed golfer's data is mirrored at ingest so that every sign below
 * means the same thing for every player; see `handedness` on ShotSession.
 *
 *   clubPath          + = in-to-out (rightward),  - = out-to-in
 *   faceAngle         + = open (right of target), - = closed
 *   faceToPath        + = face open to path  -> fade/slice shape
 *                     - = face closed to path -> draw/hook shape
 *   launchDirection   + = starts right of target
 *   spinAxis          + = tilted right -> ball curves right
 *   side / curve      + = right of target
 *   attackAngle       + = hitting up on the ball, - = hitting down
 *   swingDirection    + = rightward (in-to-out plane)
 *   impactOffset      + = toward the toe, - = toward the heel
 *   impactHeight      + = above centre face, - = below
 *   lowPointDistance  + = low point is AFTER the ball (ball-first, correct
 *                         for irons off the deck), - = before the ball (fat)
 */

/** A launch monitor field that the hardware tier may simply not measure. */
export type Maybe<T> = T | null;

/** Which product produced the row, for provenance and quirk handling. */
export type SourceKind =
  | 'trackman-csv'
  | 'trackman-stroke-file'
  | 'trackman-api'
  | 'screenshot'
  | 'manual';

export type Handedness = 'right' | 'left';

/**
 * One shot, fully normalised.
 *
 * Only `id`, `source` and `club` are guaranteed. Everything else is nullable
 * on purpose: TrackMan iO Home reports ball data plus a handful of club
 * numbers, while TM4 and iO Home Complete report the full club set. The
 * diagnosis engine checks for the inputs each rule needs and skips rules it
 * cannot support rather than inventing values.
 */
export interface Shot {
  id: string;
  source: SourceKind;
  /** Wall-clock time of the strike, if the export carried one. */
  time: Maybe<Date>;
  /** Shot ordinal within its session, 1-based, in export order. */
  sequence: number;
  club: Club;
  /** Verbatim club label from the export, before normalisation. */
  rawClub: string;

  // --- Club delivery ---------------------------------------------------
  clubSpeed: Maybe<number>;
  attackAngle: Maybe<number>;
  clubPath: Maybe<number>;
  faceAngle: Maybe<number>;
  faceToPath: Maybe<number>;
  dynamicLoft: Maybe<number>;
  spinLoft: Maybe<number>;
  swingPlane: Maybe<number>;
  swingDirection: Maybe<number>;
  lowPointDistance: Maybe<number>;
  impactOffset: Maybe<number>;
  impactHeight: Maybe<number>;

  // --- Ball launch -----------------------------------------------------
  ballSpeed: Maybe<number>;
  smashFactor: Maybe<number>;
  launchAngle: Maybe<number>;
  launchDirection: Maybe<number>;
  spinRate: Maybe<number>;
  spinAxis: Maybe<number>;

  // --- Flight and result ----------------------------------------------
  carry: Maybe<number>;
  total: Maybe<number>;
  side: Maybe<number>;
  sideTotal: Maybe<number>;
  curve: Maybe<number>;
  apexHeight: Maybe<number>;
  landingAngle: Maybe<number>;
  hangTime: Maybe<number>;

  /**
   * Set by the outlier pass, not by ingest. A shot flagged here is excluded
   * from the medians that drive diagnosis, but is still counted when we
   * report how often a miss happens — a duffed shot is bad data for
   * "what is your typical face angle" and vital data for "how often do you
   * chunk it".
   */
  flags: ShotFlag[];
}

export type ShotFlag =
  | 'mishit'
  | 'incomplete-club-data'
  | 'incomplete-ball-data'
  | 'implausible';

/**
 * A contiguous block of shots. One TPS export is normally one session, but
 * a session may also be stitched from several exports on the same day.
 */
export interface ShotSession {
  id: string;
  source: SourceKind;
  /** Original filename or API activity id, for de-duplication on re-import. */
  sourceRef: string;
  handedness: Handedness;
  startedAt: Maybe<Date>;
  shots: Shot[];
}

/** Normalised club identity. `unknown` is preserved rather than dropped. */
export type Club =
  | 'Dr' | '2w' | '3w' | '4w' | '5w' | '7w'
  | '2h' | '3h' | '4h' | '5h' | '6h'
  | '1i' | '2i' | '3i' | '4i' | '5i' | '6i' | '7i' | '8i' | '9i'
  | 'PW' | 'GW' | 'SW' | 'LW'
  | 'Putt'
  | 'unknown';

export type ClubFamily = 'driver' | 'wood' | 'hybrid' | 'iron' | 'wedge' | 'putter' | 'unknown';
