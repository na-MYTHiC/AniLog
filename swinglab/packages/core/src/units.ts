/**
 * Unit handling for ingest.
 *
 * TrackMan exports in either imperial or metric depending on the TPS setting
 * the facility happens to use, and the unit travels in the column header —
 * "Carry [yds]" vs "Carry [m]". Guessing from magnitude is how you end up
 * telling someone their 6-iron carries 155 metres, so we parse the declared
 * unit and refuse to convert when it is absent and ambiguous.
 */

export type LinearUnit = 'yds' | 'm' | 'ft' | 'in' | 'cm' | 'mm';
export type SpeedUnit = 'mph' | 'kph' | 'ms';

const LINEAR_TO_YARDS: Record<LinearUnit, number> = {
  yds: 1,
  m: 1.0936132983,
  ft: 1 / 3,
  in: 1 / 36,
  cm: 0.010936133,
  mm: 0.0010936133,
};

const LINEAR_TO_MM: Record<LinearUnit, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
  ft: 304.8,
  m: 1000,
  yds: 914.4,
};

const SPEED_TO_MPH: Record<SpeedUnit, number> = {
  mph: 1,
  kph: 0.6213711922,
  ms: 2.2369362921,
};

/** Recognise a unit token out of a column header such as "Ball Speed [kph]". */
export function parseUnitToken(header: string): string | null {
  const bracket = /\[([^\]]+)\]/.exec(header);
  if (bracket?.[1]) return normaliseUnitToken(bracket[1]);
  const paren = /\(([^)]+)\)/.exec(header);
  if (paren?.[1]) return normaliseUnitToken(paren[1]);
  return null;
}

export function normaliseUnitToken(raw: string): string {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '');
  switch (t) {
    case 'yd':
    case 'yds':
    case 'yard':
    case 'yards':
      return 'yds';
    case 'm':
    case 'meter':
    case 'meters':
    case 'metre':
    case 'metres':
      return 'm';
    case 'ft':
    case 'feet':
    case 'foot':
      return 'ft';
    case 'in':
    case 'inch':
    case 'inches':
    case '"':
      return 'in';
    case 'cm':
      return 'cm';
    case 'mm':
      return 'mm';
    case 'mph':
      return 'mph';
    case 'kph':
    case 'km/h':
    case 'kmh':
      return 'kph';
    case 'm/s':
    case 'ms':
      return 'ms';
    case 'deg':
    case 'degree':
    case 'degrees':
    case '°':
      return 'deg';
    case 'rpm':
      return 'rpm';
    case 's':
    case 'sec':
    case 'secs':
    case 'seconds':
      return 's';
    default:
      return t;
  }
}

export function isLinearUnit(u: string | null): u is LinearUnit {
  return u !== null && u in LINEAR_TO_YARDS;
}

export function isSpeedUnit(u: string | null): u is SpeedUnit {
  return u !== null && u in SPEED_TO_MPH;
}

export function toYards(value: number, unit: LinearUnit): number {
  return value * LINEAR_TO_YARDS[unit];
}

export function toMillimetres(value: number, unit: LinearUnit): number {
  return value * LINEAR_TO_MM[unit];
}

export function toMph(value: number, unit: SpeedUnit): number {
  return value * SPEED_TO_MPH[unit];
}

/**
 * Parse a numeric cell. TrackMan writes bare numbers, but exports that have
 * been round-tripped through a spreadsheet in a European locale arrive with
 * comma decimal separators and thousands separators, and unmeasured values
 * come through as "-", "" or "N/A".
 */
export function parseNumber(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  let s = raw.trim();
  if (s === '' || s === '-' || s === '--') return null;
  if (/^(n\/?a|nan|null|undefined)$/i.test(s)) return null;

  s = s.replace(/[−‒–—]/g, '-'); // unicode minus and dashes
  s = s.replace(/[^\d.,+\-eE]/g, '');

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // Whichever separator comes last is the decimal point.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    // A lone comma is a decimal separator unless it groups three digits.
    s = /,\d{3}(\D|$)/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
