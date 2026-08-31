/**
 * Robust summary statistics.
 *
 * Everything here uses medians and MAD rather than means and standard
 * deviations. A practice session is not a clean sample: it contains warm-up
 * swings, a shanked one, and the shot where the player was talking to
 * someone. One duff moves a mean carry by ten yards and moves a median by
 * almost nothing, and a coaching tool that reacts to the duff instead of the
 * pattern gives bad advice with total confidence.
 */

export interface Summary {
  n: number;
  median: number;
  /** Median absolute deviation, scaled to be comparable to a std. dev. */
  mad: number;
  min: number;
  max: number;
  p25: number;
  p75: number;
  /** Mean, kept for the few places a mean is genuinely the right answer. */
  mean: number;
}

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  if (s.length % 2 === 1) return s[mid] as number;
  return ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Linear-interpolated percentile; `p` in [0, 1]. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0] as number;
  const idx = p * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo] as number;
  const w = idx - lo;
  return (s[lo] as number) * (1 - w) + (s[hi] as number) * w;
}

/**
 * Median absolute deviation, scaled by 1.4826 so that for normally
 * distributed data it estimates the same quantity as the standard deviation.
 * That scaling is what lets us state thresholds in familiar units.
 */
export function mad(values: number[], centre?: number): number {
  if (values.length === 0) return Number.NaN;
  const c = centre ?? median(values);
  return 1.4826 * median(values.map((v) => Math.abs(v - c)));
}

export function mean(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function summarise(values: number[]): Summary {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) {
    return { n: 0, median: NaN, mad: NaN, min: NaN, max: NaN, p25: NaN, p75: NaN, mean: NaN };
  }
  const med = median(clean);
  return {
    n: clean.length,
    median: med,
    mad: mad(clean, med),
    min: Math.min(...clean),
    max: Math.max(...clean),
    p25: percentile(clean, 0.25),
    p75: percentile(clean, 0.75),
    mean: mean(clean),
  };
}

/** Pull the finite values of one numeric field out of a list of records. */
export function pluck<T>(rows: T[], get: (row: T) => number | null | undefined): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const v = get(row);
    if (v !== null && v !== undefined && Number.isFinite(v)) out.push(v);
  }
  return out;
}
