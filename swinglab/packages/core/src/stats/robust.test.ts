import { describe, expect, it } from 'vitest';
import { mad, mean, median, percentile, summarise } from './robust.js';

describe('median and MAD resist outliers', () => {
  const clean = [150, 152, 149, 151, 150, 153, 148];
  const withDuff = [...clean, 60]; // one chunked shot

  it('barely moves the median', () => {
    expect(Math.abs(median(withDuff) - median(clean))).toBeLessThan(1.5);
  });

  it('moves the mean a lot — which is why we do not use it', () => {
    expect(Math.abs(mean(withDuff) - mean(clean))).toBeGreaterThan(10);
  });

  it('scales MAD to be comparable with a standard deviation', () => {
    // Evenly spread ±2 about a median of 10: the median absolute deviation
    // is 2, scaled by 1.4826.
    expect(mad([6, 8, 10, 12, 14])).toBeCloseTo(2 * 1.4826, 4);
  });

  it('reports zero spread when most values sit exactly on the median', () => {
    // A real property of MAD, not a bug: with [8,10,10,10,12] the absolute
    // deviations are [2,0,0,0,2] and their median is 0. Any rule that divides
    // by MAD or compares against it must therefore tolerate zero — which is
    // why the mishit detector applies a floor before using it as a scale.
    expect(mad([8, 10, 10, 10, 12])).toBe(0);
    expect(mad([10, 10, 10, 10])).toBe(0);
  });
});

describe('percentile', () => {
  it('interpolates between samples', () => {
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([0, 10, 20, 30], 0.25)).toBeCloseTo(7.5, 5);
  });

  it('handles a single sample', () => {
    expect(percentile([42], 0.9)).toBe(42);
  });
});

describe('summarise', () => {
  it('reports n as the count of finite values only', () => {
    const s = summarise([1, 2, Number.NaN, 3]);
    expect(s.n).toBe(3);
    expect(s.median).toBe(2);
  });

  it('returns NaN rather than 0 for an empty sample', () => {
    // 0 would read as a real measurement downstream.
    const s = summarise([]);
    expect(s.n).toBe(0);
    expect(Number.isNaN(s.median)).toBe(true);
  });
});
