import { trackmanCsvAdapter } from './trackman-csv.js';
import type { IngestAdapter, IngestOptions, IngestResult, RawInput } from './types.js';

/**
 * The adapter registry.
 *
 * Adding a launch monitor means appending to this list. Nothing downstream
 * changes, which is the point: if TrackMan grants API access it becomes one
 * more entry here, and if they never do, Foresight and Uneekor users are
 * still one adapter away.
 */
export const ADAPTERS: IngestAdapter[] = [trackmanCsvAdapter];

export function adapterFor(input: RawInput): IngestAdapter | null {
  return ADAPTERS.find((a) => a.canParse(input)) ?? null;
}

/** Parse a dropped file with whichever adapter recognises it. */
export function ingest(input: RawInput, opts: IngestOptions): IngestResult {
  const adapter = adapterFor(input);
  if (!adapter) {
    return {
      session: null,
      warnings: [
        {
          code: 'no-shots',
          message:
            `"${input.name}" was not recognised as a supported launch-monitor export. ` +
            `Supported today: ${ADAPTERS.map((a) => a.label).join(', ')}.`,
        },
      ],
    };
  }
  return adapter.parse(input, opts);
}
