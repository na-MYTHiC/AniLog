import type { Handedness, Maybe, Shot, ShotSession } from '../schema.js';
import { normaliseClub } from '../clubs.js';
import {
  isLinearUnit,
  isSpeedUnit,
  parseNumber,
  parseUnitToken,
  toMillimetres,
  toMph,
  toYards,
} from '../units.js';
import { parseCsv } from './csv.js';
import type { IngestAdapter, IngestOptions, IngestResult, IngestWarning, RawInput } from './types.js';

/** How a column's raw number becomes a canonical number. */
type Quantity =
  | 'speed'      // -> mph
  | 'angle'      // -> degrees (unit-free passthrough)
  | 'spin'       // -> rpm
  | 'distance'   // -> yards
  | 'apex'       // -> feet
  | 'lowpoint'   // -> inches
  | 'impact'     // -> mm
  | 'time'       // -> seconds
  | 'ratio'      // -> dimensionless
  | 'text';

interface FieldSpec {
  field: keyof Shot | 'club' | 'date' | 'time';
  quantity: Quantity;
  /** True if a positive value means "right" and must flip for a lefty. */
  mirrored?: boolean;
}

/**
 * Header aliases.
 *
 * Keys are headers reduced to lowercase alphanumerics, so "Face to Path
 * [deg]", "face_to_path" and "FaceToPath" all collapse to "facetopath".
 * TrackMan has shipped several header spellings across TPS versions and
 * across the CSV / stroke-file formats; every spelling seen in the wild
 * belongs here rather than in a per-file special case.
 */
const FIELD_MAP: Record<string, FieldSpec> = {
  // identity
  club: { field: 'club', quantity: 'text' },
  clubname: { field: 'club', quantity: 'text' },
  clubtype: { field: 'club', quantity: 'text' },
  date: { field: 'date', quantity: 'text' },
  time: { field: 'time', quantity: 'text' },
  datetime: { field: 'date', quantity: 'text' },

  // club delivery
  clubspeed: { field: 'clubSpeed', quantity: 'speed' },
  attackangle: { field: 'attackAngle', quantity: 'angle' },
  aoa: { field: 'attackAngle', quantity: 'angle' },
  clubpath: { field: 'clubPath', quantity: 'angle', mirrored: true },
  faceangle: { field: 'faceAngle', quantity: 'angle', mirrored: true },
  facetopath: { field: 'faceToPath', quantity: 'angle', mirrored: true },
  dynamicloft: { field: 'dynamicLoft', quantity: 'angle' },
  dynloft: { field: 'dynamicLoft', quantity: 'angle' },
  spinloft: { field: 'spinLoft', quantity: 'angle' },
  swingplane: { field: 'swingPlane', quantity: 'angle' },
  swingdirection: { field: 'swingDirection', quantity: 'angle', mirrored: true },
  lowpoint: { field: 'lowPointDistance', quantity: 'lowpoint' },
  lowpointdistance: { field: 'lowPointDistance', quantity: 'lowpoint' },
  impactoffset: { field: 'impactOffset', quantity: 'impact', mirrored: true },
  impactheight: { field: 'impactHeight', quantity: 'impact' },

  // ball launch
  ballspeed: { field: 'ballSpeed', quantity: 'speed' },
  smashfactor: { field: 'smashFactor', quantity: 'ratio' },
  smash: { field: 'smashFactor', quantity: 'ratio' },
  launchangle: { field: 'launchAngle', quantity: 'angle' },
  launchdirection: { field: 'launchDirection', quantity: 'angle', mirrored: true },
  spinrate: { field: 'spinRate', quantity: 'spin' },
  spinaxis: { field: 'spinAxis', quantity: 'angle', mirrored: true },

  // flight and result
  carry: { field: 'carry', quantity: 'distance' },
  carrydistance: { field: 'carry', quantity: 'distance' },
  total: { field: 'total', quantity: 'distance' },
  totaldistance: { field: 'total', quantity: 'distance' },
  side: { field: 'side', quantity: 'distance', mirrored: true },
  carryside: { field: 'side', quantity: 'distance', mirrored: true },
  sidetotal: { field: 'sideTotal', quantity: 'distance', mirrored: true },
  totalside: { field: 'sideTotal', quantity: 'distance', mirrored: true },
  curve: { field: 'curve', quantity: 'distance', mirrored: true },
  curvedistance: { field: 'curve', quantity: 'distance', mirrored: true },
  height: { field: 'apexHeight', quantity: 'apex' },
  apexheight: { field: 'apexHeight', quantity: 'apex' },
  maxheight: { field: 'apexHeight', quantity: 'apex' },
  landingangle: { field: 'landingAngle', quantity: 'angle' },
  hangtime: { field: 'hangTime', quantity: 'time' },
};

function headerKey(h: string): string {
  return h
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

interface Column {
  index: number;
  header: string;
  spec: FieldSpec;
  unit: string | null;
}

/**
 * Find the header row.
 *
 * TPS exports often carry one or more preamble lines — player name, facility,
 * a date — before the real header. We scan for the first row that maps at
 * least three known columns rather than assuming row 0, because assuming
 * row 0 silently produces an empty session on every facility export.
 */
function findHeaderRow(rows: string[][]): number {
  let bestRow = -1;
  let bestScore = 2; // require > 2 recognised columns
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const row = rows[i];
    if (!row) continue;
    let score = 0;
    for (const cell of row) if (FIELD_MAP[headerKey(cell)]) score++;
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }
  return bestRow;
}

function convert(
  value: number,
  quantity: Quantity,
  unit: string | null,
): number | null {
  switch (quantity) {
    case 'speed':
      if (isSpeedUnit(unit)) return toMph(value, unit);
      return unit === null ? value : null; // declared but unrecognised -> refuse
    case 'distance':
      if (isLinearUnit(unit)) return toYards(value, unit);
      return unit === null ? value : null;
    case 'apex':
      if (isLinearUnit(unit)) return toYards(value, unit) * 3; // yards -> feet
      return unit === null ? value : null;
    case 'lowpoint':
      if (isLinearUnit(unit)) return toMillimetres(value, unit) / 25.4; // -> inches
      return unit === null ? value : null;
    case 'impact':
      if (isLinearUnit(unit)) return toMillimetres(value, unit);
      return unit === null ? value : null;
    case 'angle':
    case 'spin':
    case 'time':
    case 'ratio':
      return value;
    case 'text':
      return null;
  }
}

/**
 * Parse a TrackMan date/time pair.
 *
 * Deliberately conservative: an unambiguous ISO-ish date is used, and an
 * ambiguous DD/MM vs MM/DD date is reported as a warning and left null rather
 * than guessed. A session dated five months wrong corrupts every trend chart
 * downstream, so no date is better than a wrong one.
 */
function parseTimestamp(
  dateStr: string | undefined,
  timeStr: string | undefined,
  warn: (w: IngestWarning) => void,
  row: number,
): Maybe<Date> {
  const d = (dateStr ?? '').trim();
  const t = (timeStr ?? '').trim();
  if (d === '' && t === '') return null;

  const combined = d !== '' && t !== '' ? `${d} ${t}` : d !== '' ? d : t;

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(combined);
  if (iso) {
    const parsed = new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      Number(iso[4] ?? 0),
      Number(iso[5] ?? 0),
      Number(iso[6] ?? 0),
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
    combined,
  );
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    if (a > 12 || b > 12) {
      // One of them must be the day, so the order is determined.
      const day = a > 12 ? a : b;
      const month = a > 12 ? b : a;
      const yearRaw = Number(slash[3]);
      const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
      const parsed = new Date(
        year, month - 1, day,
        Number(slash[4] ?? 0), Number(slash[5] ?? 0), Number(slash[6] ?? 0),
      );
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    warn({
      code: 'ambiguous-date',
      message: `Date "${combined}" could be day/month or month/day; timestamp left unset.`,
      row,
    });
    return null;
  }

  return null;
}

export const trackmanCsvAdapter: IngestAdapter = {
  id: 'trackman-csv',
  label: 'TrackMan CSV / Stroke File',

  canParse(input: RawInput): boolean {
    if (!/\.(csv|tsv|txt)$/i.test(input.name)) return false;
    const head = input.text.slice(0, 8192);
    const rows = parseCsv(head);
    return findHeaderRow(rows) !== -1;
  },

  parse(input: RawInput, opts: IngestOptions): IngestResult {
    const warnings: IngestWarning[] = [];
    const warn = (w: IngestWarning) => warnings.push(w);

    const rows = parseCsv(input.text);
    const headerRow = findHeaderRow(rows);
    if (headerRow === -1) {
      warn({ code: 'no-shots', message: 'No TrackMan header row found in this file.' });
      return { session: null, warnings };
    }

    const headers = rows[headerRow] ?? [];
    const columns: Column[] = [];
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i] ?? '';
      if (header === '') continue;
      const spec = FIELD_MAP[headerKey(header)];
      if (!spec) {
        warn({ code: 'unrecognised-column', message: `Ignoring column "${header}".` });
        continue;
      }
      columns.push({ index: i, header, spec, unit: parseUnitToken(header) });
    }

    const mirror = opts.handedness === 'left' ? -1 : 1;
    const shots: Shot[] = [];
    const unknownClubLabels = new Set<string>();

    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((c) => c === '')) continue;

      let rawClub = '';
      let dateStr: string | undefined;
      let timeStr: string | undefined;
      const numeric: Partial<Record<keyof Shot, number>> = {};
      let sawAnyNumber = false;

      for (const col of columns) {
        const cell = row[col.index];
        if (col.spec.quantity === 'text') {
          if (col.spec.field === 'club') rawClub = (cell ?? '').trim();
          else if (col.spec.field === 'date') dateStr = cell;
          else if (col.spec.field === 'time') timeStr = cell;
          continue;
        }

        const raw = parseNumber(cell);
        if (raw === null) continue;

        const converted = convert(raw, col.spec.quantity, col.unit);
        if (converted === null) {
          warn({
            code: 'missing-unit',
            message: `Column "${col.header}" declares an unrecognised unit; values dropped.`,
          });
          continue;
        }

        sawAnyNumber = true;
        const signed = col.spec.mirrored ? converted * mirror : converted;
        numeric[col.spec.field as keyof Shot] = signed;
      }

      if (!sawAnyNumber) {
        warn({ code: 'unparsed-row', message: 'Row contained no readable numbers.', row: r + 1 });
        continue;
      }

      const club = normaliseClub(rawClub);
      if (club === 'unknown' && rawClub !== '') unknownClubLabels.add(rawClub);

      shots.push(
        buildShot({
          sequence: shots.length + 1,
          club,
          rawClub,
          time: parseTimestamp(dateStr, timeStr, warn, r + 1),
          numeric,
          sourceRef: input.name,
        }),
      );
    }

    for (const label of unknownClubLabels) {
      warn({
        code: 'unknown-club',
        message: `Club label "${label}" was not recognised; those shots are kept but excluded from gapping.`,
      });
    }

    if (shots.length === 0) {
      warn({ code: 'no-shots', message: 'File parsed, but contained no shot rows.' });
      return { session: null, warnings };
    }

    const firstTime = shots.find((s) => s.time !== null)?.time ?? null;
    const session: ShotSession = {
      id: `tm-${hashString(input.name + shots.length + (firstTime?.toISOString() ?? ''))}`,
      source: 'trackman-csv',
      sourceRef: input.name,
      handedness: opts.handedness,
      startedAt: firstTime,
      shots,
    };

    return { session, warnings };
  },
};

function buildShot(args: {
  sequence: number;
  club: Shot['club'];
  rawClub: string;
  time: Maybe<Date>;
  numeric: Partial<Record<keyof Shot, number>>;
  sourceRef: string;
}): Shot {
  const n = args.numeric;
  const get = (k: keyof Shot): Maybe<number> => (n[k] === undefined ? null : (n[k] as number));

  const shot: Shot = {
    id: `${hashString(args.sourceRef)}-${args.sequence}`,
    source: 'trackman-csv',
    time: args.time,
    sequence: args.sequence,
    club: args.club,
    rawClub: args.rawClub,

    clubSpeed: get('clubSpeed'),
    attackAngle: get('attackAngle'),
    clubPath: get('clubPath'),
    faceAngle: get('faceAngle'),
    faceToPath: get('faceToPath'),
    dynamicLoft: get('dynamicLoft'),
    spinLoft: get('spinLoft'),
    swingPlane: get('swingPlane'),
    swingDirection: get('swingDirection'),
    lowPointDistance: get('lowPointDistance'),
    impactOffset: get('impactOffset'),
    impactHeight: get('impactHeight'),

    ballSpeed: get('ballSpeed'),
    smashFactor: get('smashFactor'),
    launchAngle: get('launchAngle'),
    launchDirection: get('launchDirection'),
    spinRate: get('spinRate'),
    spinAxis: get('spinAxis'),

    carry: get('carry'),
    total: get('total'),
    side: get('side'),
    sideTotal: get('sideTotal'),
    curve: get('curve'),
    apexHeight: get('apexHeight'),
    landingAngle: get('landingAngle'),
    hangTime: get('hangTime'),

    flags: [],
  };

  // Derive the two values that are cheap and safe to reconstruct. TrackMan
  // omits them on some export presets, and both are exact identities rather
  // than estimates, so filling them in costs nothing in fidelity.
  if (shot.faceToPath === null && shot.faceAngle !== null && shot.clubPath !== null) {
    shot.faceToPath = round(shot.faceAngle - shot.clubPath, 2);
  }
  if (shot.spinLoft === null && shot.dynamicLoft !== null && shot.attackAngle !== null) {
    shot.spinLoft = round(shot.dynamicLoft - shot.attackAngle, 2);
  }
  if (
    shot.smashFactor === null &&
    shot.ballSpeed !== null &&
    shot.clubSpeed !== null &&
    shot.clubSpeed > 0
  ) {
    shot.smashFactor = round(shot.ballSpeed / shot.clubSpeed, 3);
  }

  return shot;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Small non-cryptographic hash (FNV-1a) for stable local ids. */
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
