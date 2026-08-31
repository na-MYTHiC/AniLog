/**
 * A minimal RFC 4180 CSV reader.
 *
 * Written out rather than pulled from npm on purpose: it is forty lines, it
 * removes a supply-chain dependency from the one module that touches
 * untrusted user files, and it lets us handle the delimiter sniffing that
 * TrackMan exports need. TPS writes semicolon-delimited files under European
 * locale settings and comma-delimited files everywhere else.
 */

/**
 * Choose the delimiter by looking across many lines, not just the first.
 *
 * The first line of a TPS export is often a preamble title with no delimiter
 * in it at all, and metric exports use semicolons as the delimiter *and*
 * commas as decimal separators — so a naive comma count wins on exactly the
 * files where it is most wrong. Scoring by how consistently a delimiter
 * produces the same field count across lines separates the two cleanly:
 * the real delimiter repeats exactly, decimal commas do not.
 */
export function sniffDelimiter(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .slice(0, 25);

  if (lines.length === 0) return ',';

  let best = ',';
  let bestScore = -1;

  for (const d of [',', ';', '\t']) {
    const counts: number[] = [];
    for (const line of lines) {
      let count = 0;
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === d && !inQuotes) count++;
      }
      if (count > 0) counts.push(count);
    }
    if (counts.length === 0) continue;

    // Modal non-zero count, and how many lines agree on it.
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    let modal = 0;
    let modalLines = 0;
    for (const [count, lineCount] of freq) {
      if (lineCount > modalLines || (lineCount === modalLines && count > modal)) {
        modal = count;
        modalLines = lineCount;
      }
    }

    // Agreement dominates; field count only breaks ties.
    const score = modalLines * 1000 + modal;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }

  return best;
}

/** Parse CSV text into a grid of trimmed string cells. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, ''); // strip BOM — TPS writes one
  const d = delimiter ?? sniffDelimiter(src);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === d) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n') {
      row.push(field.trim());
      field = '';
      rows.push(row);
      row = [];
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  // Drop trailing blank lines.
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last && last.every((c) => c === '')) rows.pop();
    else break;
  }

  return rows;
}
