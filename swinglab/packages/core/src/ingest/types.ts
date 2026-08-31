import type { Handedness, ShotSession, SourceKind } from '../schema.js';

/**
 * Every data source implements this and nothing more.
 *
 * Adding Foresight, Uneekor, SkyTrak or the TrackMan partner API later means
 * writing one of these — no change to the schema, the stats, the diagnosis
 * engine or the UI. That is the entire reason the interface is this small.
 */
export interface IngestAdapter {
  readonly id: SourceKind;
  readonly label: string;
  /** Cheap sniff so the UI can auto-route a dropped file. */
  canParse(input: RawInput): boolean;
  parse(input: RawInput, opts: IngestOptions): IngestResult;
}

export interface RawInput {
  /** Filename, used for provenance and format sniffing. */
  name: string;
  text: string;
}

export interface IngestOptions {
  /** Left-handed data is mirrored so every sign convention holds for everyone. */
  handedness: Handedness;
  /** Injectable for deterministic tests. */
  now?: () => Date;
}

export interface IngestResult {
  session: ShotSession | null;
  /** Non-fatal problems worth surfacing: unknown clubs, dropped rows, missing units. */
  warnings: IngestWarning[];
}

export interface IngestWarning {
  code:
    | 'unknown-club'
    | 'unparsed-row'
    | 'missing-unit'
    | 'no-shots'
    | 'unrecognised-column'
    | 'ambiguous-date';
  message: string;
  /** 1-based row number in the source file, when the warning is row-specific. */
  row?: number;
}
