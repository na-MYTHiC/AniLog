/**
 * @swinglab/core
 *
 * Pure TypeScript. No network, no filesystem, no platform APIs — so the same
 * engine runs in the desktop shell, the mobile PWA and the test suite without
 * modification, and costs nothing to run because it runs entirely on the
 * player's own device.
 */

export * from './schema.js';
export * from './clubs.js';
export * from './units.js';

export * from './ingest/types.js';
export { parseCsv, sniffDelimiter } from './ingest/csv.js';
export { trackmanCsvAdapter } from './ingest/trackman-csv.js';
export { ADAPTERS, adapterFor, ingest } from './ingest/registry.js';

export * from './stats/robust.js';
export * from './stats/outliers.js';
export * from './stats/dispersion.js';

export * from './benchmarks/tour.js';

export {
  diagnoseSession,
  diagnoseShots,
  buildPracticePlan,
  type SessionReport,
  type PracticeItem,
  type DiagnoseOptions,
} from './diagnose/index.js';
export type { Finding, Severity, Confidence, Evidence } from './diagnose/types.js';
export { DRILLS, drill, type Drill } from './diagnose/drills.js';
