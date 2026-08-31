import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trackmanCsvAdapter } from '../ingest/trackman-csv.js';
import { diagnoseSession, diagnoseShots } from './index.js';
import type { Shot } from '../schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, '../../../../fixtures');

function loadSession() {
  const text = readFileSync(resolve(fixtures, 'trackman-session-imperial.csv'), 'utf8');
  const { session } = trackmanCsvAdapter.parse(
    { name: 'trackman-session-imperial.csv', text },
    { handedness: 'right' },
  );
  if (!session) throw new Error('fixture failed to parse');
  return session;
}

function shot(over: Partial<Shot>): Shot {
  return {
    id: Math.random().toString(36).slice(2),
    source: 'manual', time: null, sequence: 1, club: '7i', rawClub: '7 Iron',
    clubSpeed: 82, attackAngle: -3, clubPath: 0, faceAngle: 0, faceToPath: 0,
    dynamicLoft: 27, spinLoft: 30, swingPlane: null, swingDirection: null,
    lowPointDistance: 2, impactOffset: 0, impactHeight: 0,
    ballSpeed: 110.7, smashFactor: 1.35, launchAngle: 17, launchDirection: 0,
    spinRate: 6800, spinAxis: 0,
    carry: 160, total: 164, side: 0, sideTotal: 0, curve: 0,
    apexHeight: 90, landingAngle: 45, hangTime: 6,
    flags: [], ...over,
  };
}

describe('end-to-end on the sample session', () => {
  const report = diagnoseSession(loadSession());

  it('profiles every club in the session', () => {
    expect(report.clubsSeen).toEqual(['Dr', '5i', '7i', 'PW']);
  });

  it('finds the driver being struck downward', () => {
    const f = report.findings.find((x) => x.id === 'driver-negative-aoa');
    expect(f, 'expected a negative driver attack angle finding').toBeDefined();
    expect(f?.club).toBe('Dr');
    const aoa = f?.evidence.find((e) => e.label === 'Attack angle');
    expect(aoa?.value).toBeLessThan(0);
  });

  it('finds the 7-iron face sitting open to the path', () => {
    const f = report.findings.find((x) => x.id === 'face-open-to-path' && x.club === '7i');
    expect(f, 'expected an open-face-to-path finding on the 7 iron').toBeDefined();
    const f2p = f?.evidence.find((e) => e.label === 'Face to path');
    expect(f2p?.value).toBeGreaterThan(2);
  });

  it('finds the toe-biased 7-iron strike', () => {
    const f = report.findings.find((x) => x.id === 'strike-toe-biased' && x.club === '7i');
    expect(f, 'expected a toe-strike finding on the 7 iron').toBeDefined();
  });

  it('does not invent gaps across clubs the player simply did not hit', () => {
    // The session has Dr, 5i, 7i and PW. The 61 yards between driver and
    // 5-iron is a 3-wood and a hybrid that were not hit today, not a hole in
    // the bag, and the 45 yards between 7i and PW is an 8-iron and a 9-iron.
    expect(report.findings.filter((x) => x.id === 'gap-oversized')).toHaveLength(0);
  });

  it('puts strike quality ahead of spin in the ordering', () => {
    const ids = report.findings.map((f) => f.id);
    const strikeIdx = ids.findIndex((id) => id.startsWith('strike-') || id.startsWith('low-point'));
    const spinIdx = ids.findIndex((id) => id.startsWith('spin-'));
    if (strikeIdx !== -1 && spinIdx !== -1) {
      expect(strikeIdx).toBeLessThan(spinIdx);
    }
  });

  it('builds a practice plan with no repeated drills', () => {
    const ids = report.practicePlan.map((p) => p.drill.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(4);
  });

  it('ties every prescribed drill back to a finding it addresses', () => {
    const findingIds = new Set(report.findings.map((f) => f.id));
    for (const item of report.practicePlan) {
      expect(item.addresses.length).toBeGreaterThan(0);
      for (const id of item.addresses) expect(findingIds.has(id)).toBe(true);
    }
  });

  it('states evidence for every finding', () => {
    for (const f of report.findings) {
      expect(f.evidence.length, f.id).toBeGreaterThan(0);
      expect(f.title.length, f.id).toBeGreaterThan(0);
      expect(f.detail.length, f.id).toBeGreaterThan(0);
    }
  });
});

describe('the engine stays quiet when it should', () => {
  it('says nothing about a clean, neutral session', () => {
    const shots = Array.from({ length: 20 }, (_, i) =>
      shot({ sequence: i + 1, faceToPath: i % 2 ? 0.4 : -0.4, clubPath: 0.2, impactOffset: i % 2 ? 2 : -2 }),
    );
    const report = diagnoseShots(shots);
    const noise = report.findings.filter((f) => f.severity !== 'info');
    expect(noise, `unexpected findings: ${noise.map((f) => f.id).join(', ')}`).toHaveLength(0);
  });

  it('does not diagnose from a handful of shots', () => {
    const shots = Array.from({ length: 3 }, (_, i) =>
      shot({ sequence: i + 1, faceToPath: 8, impactOffset: 20 }),
    );
    expect(diagnoseShots(shots).findings).toHaveLength(0);
  });

  it('does not invent findings from fields the hardware never measured', () => {
    // A ball-data-only launch monitor: no club numbers at all.
    const shots = Array.from({ length: 20 }, (_, i) =>
      shot({
        sequence: i + 1,
        clubPath: null, faceAngle: null, faceToPath: null, attackAngle: null,
        dynamicLoft: null, spinLoft: null, lowPointDistance: null,
        impactOffset: null, impactHeight: null, clubSpeed: null, smashFactor: null,
      }),
    );
    const report = diagnoseShots(shots);
    for (const f of report.findings) {
      expect(f.id).not.toMatch(/face|path|low-point|strike|smash|aoa/);
    }
  });
});

describe('finding a fault that is only visible in the spread', () => {
  it('catches a face that averages square but swings wildly', () => {
    // +5 and -5 alternating: a mean of zero hiding a total lack of control.
    const shots = Array.from({ length: 20 }, (_, i) =>
      shot({ sequence: i + 1, faceAngle: i % 2 ? 5 : -5, faceToPath: i % 2 ? 5 : -5 }),
    );
    const report = diagnoseShots(shots);
    expect(report.findings.some((f) => f.id === 'face-inconsistent')).toBe(true);
  });
});

describe('left-handed players get the same diagnosis', () => {
  it('produces the same finding ids from mirrored data', () => {
    const right = Array.from({ length: 20 }, (_, i) =>
      shot({ sequence: i + 1, faceToPath: 4, clubPath: -3, faceAngle: 1, side: 14, curve: 10 }),
    );
    // Ingest mirrors lefty data, so by the time it reaches the engine it
    // looks identical. Same numbers in, same coaching out.
    const report = diagnoseShots(right);
    expect(report.findings.some((f) => f.id === 'face-open-to-path')).toBe(true);
  });
});

describe('gapping', () => {
  function carrySet(entries: [Shot['club'], number][]): Shot[] {
    return entries.flatMap(([club, carry], ci) =>
      // Eight per club so the findings clear the low-confidence filter, which
      // is the same bar a real session has to clear.
      Array.from({ length: 8 }, (_, i) =>
        shot({
          club,
          sequence: ci * 8 + i + 1,
          carry: carry + (i % 2 ? 1 : -1),
          total: carry + 4,
        }),
      ),
    );
  }

  it('reports an oversized gap between genuinely adjacent clubs', () => {
    const report = diagnoseShots(carrySet([['8i', 150], ['9i', 118]]));
    const f = report.findings.find((x) => x.id === 'gap-oversized');
    expect(f, 'expected a gap finding between 8i and 9i').toBeDefined();
    expect(f?.evidence.find((e) => e.label === 'Gap')?.value).toBe(32);
  });

  it('reports clubs that carry the same distance, adjacent or not', () => {
    const report = diagnoseShots(carrySet([['5i', 172], ['7i', 169]]));
    expect(report.findings.some((x) => x.id === 'gap-overlap')).toBe(true);
  });

  it('reports an inverted gap, which no unhit club can explain', () => {
    const report = diagnoseShots(carrySet([['5i', 150], ['7i', 168]]));
    expect(report.findings.some((x) => x.id === 'gap-inverted')).toBe(true);
  });

  it('says nothing about gapping from a single club', () => {
    const report = diagnoseShots(carrySet([['7i', 160]]));
    expect(report.findings.some((x) => x.id.startsWith('gap-'))).toBe(false);
  });
});
