import { describe, expect, it } from 'vitest';
import { parseNumber, parseUnitToken, toMillimetres, toMph, toYards } from './units.js';

describe('parseUnitToken', () => {
  it('reads the unit out of a TrackMan header', () => {
    expect(parseUnitToken('Carry [yds]')).toBe('yds');
    expect(parseUnitToken('Ball Speed [kph]')).toBe('kph');
    expect(parseUnitToken('Attack Angle [deg]')).toBe('deg');
    expect(parseUnitToken('Height (m)')).toBe('m');
  });

  it('returns null when the header declares no unit', () => {
    expect(parseUnitToken('Smash Factor')).toBeNull();
  });
});

describe('conversions', () => {
  it('converts to canonical units', () => {
    expect(toYards(100, 'm')).toBeCloseTo(109.36, 1);
    expect(toMph(100, 'kph')).toBeCloseTo(62.14, 1);
    expect(toMillimetres(1, 'in')).toBeCloseTo(25.4, 3);
  });
});

describe('parseNumber', () => {
  it('reads plain numbers', () => {
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('-3.2')).toBe(-3.2);
  });

  it('reads European decimal commas', () => {
    expect(parseNumber('132,0')).toBe(132);
    expect(parseNumber('1.308')).toBe(1.308);
    expect(parseNumber('-3,4')).toBe(-3.4);
  });

  it('reads thousands separators', () => {
    expect(parseNumber('6,900')).toBe(6900);
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('1,234.5')).toBe(1234.5);
  });

  it('treats unmeasured values as absent rather than zero', () => {
    // Zero would be a real measurement; these are not.
    for (const empty of ['', '-', '--', 'N/A', 'n/a', null, undefined]) {
      expect(parseNumber(empty), String(empty)).toBeNull();
    }
  });

  it('handles a unicode minus sign', () => {
    expect(parseNumber('−3.5')).toBe(-3.5);
  });
});
