import { describe, expect, it } from 'vitest';
import { clubFamily, compareClubs, isOffTheDeck, normaliseClub } from './clubs.js';

describe('normaliseClub', () => {
  it('maps the many spellings of the same club onto one bucket', () => {
    for (const label of ['7i', '7 Iron', 'Iron 7', 'i7', 'I 7', '7-iron', '7_IRON']) {
      expect(normaliseClub(label), label).toBe('7i');
    }
  });

  it('treats every driver spelling as the driver', () => {
    for (const label of ['Dr', 'Driver', 'driver', '1w', '1 Wood', 'W1', 'D']) {
      expect(normaliseClub(label), label).toBe('Dr');
    }
  });

  it('maps woods, hybrids and rescues', () => {
    expect(normaliseClub('3 Wood')).toBe('3w');
    expect(normaliseClub('5w')).toBe('5w');
    expect(normaliseClub('4 Hybrid')).toBe('4h');
    expect(normaliseClub('3 Rescue')).toBe('3h');
    expect(normaliseClub('hyb5')).toBe('5h');
  });

  it('maps loft-labelled wedges', () => {
    expect(normaliseClub('52')).toBe('GW');
    expect(normaliseClub('56°')).toBe('SW');
    expect(normaliseClub('60 deg')).toBe('LW');
    expect(normaliseClub('46')).toBe('PW');
  });

  it('returns unknown rather than guessing', () => {
    expect(normaliseClub('')).toBe('unknown');
    expect(normaliseClub(null)).toBe('unknown');
    expect(normaliseClub('chipper')).toBe('unknown');
    // 9 wood is not in the canonical set; better unknown than silently wrong.
    expect(normaliseClub('9 Wood')).toBe('unknown');
  });
});

describe('club ordering', () => {
  it('sorts long to short, which is the gapping sequence', () => {
    const sorted = ['PW', '7i', 'Dr', '5i', '3w'].sort((a, b) =>
      compareClubs(normaliseClub(a), normaliseClub(b)),
    );
    expect(sorted).toEqual(['Dr', '3w', '5i', '7i', 'PW']);
  });

  it('sorts unknown clubs to the end', () => {
    const sorted = ['unknown', 'Dr'].sort((a, b) => compareClubs(a as never, b as never));
    expect(sorted[0]).toBe('Dr');
  });
});

describe('club families', () => {
  it('classifies each family', () => {
    expect(clubFamily('Dr')).toBe('driver');
    expect(clubFamily('3w')).toBe('wood');
    expect(clubFamily('4h')).toBe('hybrid');
    expect(clubFamily('7i')).toBe('iron');
    expect(clubFamily('SW')).toBe('wedge');
    expect(clubFamily('Putt')).toBe('putter');
  });

  it('knows which clubs are played off the turf', () => {
    expect(isOffTheDeck('7i')).toBe(true);
    expect(isOffTheDeck('SW')).toBe(true);
    expect(isOffTheDeck('Dr')).toBe(false);
  });
});
