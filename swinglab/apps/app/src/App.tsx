import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  diagnoseSession,
  ingest,
  type Finding,
  type Handedness,
  type IngestWarning,
  type SessionReport,
  type ShotSession,
} from '@swinglab/core';
import { loadAll, remove, save, type StoredSession } from './storage.js';
import { isDesktop, watchExportFolder } from './desktop.js';

export default function App() {
  const [handedness, setHandedness] = useState<Handedness>('right');
  const [stored, setStored] = useState<StoredSession[]>(() => loadAll());
  const [activeId, setActiveId] = useState<string | null>(() => loadAll()[0]?.session.id ?? null);
  const [warnings, setWarnings] = useState<IngestWarning[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [watching, setWatching] = useState(false);

  // The watcher callback outlives the render that created it, so read
  // handedness through a ref rather than capturing a stale value.
  const handednessRef = useRef(handedness);
  handednessRef.current = handedness;
  const stopWatchRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopWatchRef.current?.(), []);

  const active = useMemo(
    () => stored.find((s) => s.session.id === activeId)?.session ?? null,
    [stored, activeId],
  );

  const report = useMemo<SessionReport | null>(
    () => (active ? diagnoseSession(cloneSession(active)) : null),
    [active],
  );

  /**
   * The single ingest path. Dropped files, the file picker and the desktop
   * folder watcher all funnel through here so they cannot drift apart.
   */
  const ingestRaw = useCallback(
    (inputs: { name: string; text: string }[]) => {
      setError(null);
      const collected: IngestWarning[] = [];
      let lastId: string | null = null;
      let next = loadAll();

      for (const input of inputs) {
        const result = ingest(input, { handedness: handednessRef.current });
        collected.push(...result.warnings);
        if (result.session) {
          next = save(result.session);
          lastId = result.session.id;
        }
      }

      setStored(next);
      setWarnings(collected);
      if (lastId) setActiveId(lastId);
      else if (collected.length > 0) setError('No shots could be read from that file.');
    },
    [],
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const inputs = await Promise.all(
        Array.from(files).map(async (f) => ({ name: f.name, text: await f.text() })),
      );
      ingestRaw(inputs);
    },
    [ingestRaw],
  );

  const startWatching = useCallback(async () => {
    const stop = await watchExportFolder((files) => ingestRaw(files));
    if (stop) {
      stopWatchRef.current = stop;
      setWatching(true);
    }
  }, [ingestRaw]);

  return (
    <div className="app">
      <header className="header">
        <h1>
          Swing<span>Lab</span>
        </h1>
        <label className="handed">
          Plays
          <select
            value={handedness}
            onChange={(e) => setHandedness(e.target.value as Handedness)}
          >
            <option value="right">Right-handed</option>
            <option value="left">Left-handed</option>
          </select>
        </label>
      </header>

      <DropZone
        dragging={dragging}
        setDragging={setDragging}
        onFiles={handleFiles}
        hasData={stored.length > 0}
      />

      {isDesktop() && (
        <button className="watch" onClick={startWatching} disabled={watching}>
          {watching
            ? 'Watching your export folder — new sessions appear automatically'
            : 'Watch my TPS export folder'}
        </button>
      )}

      {error && <p className="error">{error}</p>}
      {warnings.length > 0 && <Warnings warnings={warnings} />}

      {stored.length > 1 && (
        <nav className="sessions">
          {stored.map((s) => (
            <button
              key={s.session.id}
              className={s.session.id === activeId ? 'chip chip-on' : 'chip'}
              onClick={() => setActiveId(s.session.id)}
            >
              {formatSessionLabel(s)}
            </button>
          ))}
        </nav>
      )}

      {report && active && (
        <Report
          report={report}
          onDelete={() => {
            const next = remove(active.id);
            setStored(next);
            setActiveId(next[0]?.session.id ?? null);
          }}
        />
      )}

      {!report && <Empty />}
    </div>
  );
}

function DropZone({
  dragging,
  setDragging,
  onFiles,
  hasData,
}: {
  dragging: boolean;
  setDragging: (v: boolean) => void;
  onFiles: (files: FileList | File[]) => void;
  hasData: boolean;
}) {
  return (
    <label
      className={dragging ? 'drop drop-active' : 'drop'}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
      }}
    >
      <input
        type="file"
        accept=".csv,.tsv,.txt"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <strong>{hasData ? 'Import another session' : 'Drop a TrackMan export here'}</strong>
      <span>
        In TPS: Table View → File Options → export as TrackMan CSV. Your data never leaves this
        device.
      </span>
    </label>
  );
}

function Warnings({ warnings }: { warnings: IngestWarning[] }) {
  // Collapse the repetitive ones — an export with thirty unrecognised columns
  // should not produce thirty lines of nagging.
  const grouped = new Map<string, number>();
  for (const w of warnings) grouped.set(w.message, (grouped.get(w.message) ?? 0) + 1);

  return (
    <details className="warnings">
      <summary>{warnings.length} note{warnings.length === 1 ? '' : 's'} from the import</summary>
      <ul>
        {[...grouped.entries()].map(([message, count]) => (
          <li key={message}>
            {message}
            {count > 1 && <em> ×{count}</em>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Report({ report, onDelete }: { report: SessionReport; onDelete: () => void }) {
  return (
    <main>
      <section className="summary">
        <Stat label="Shots" value={String(report.shotCount)} />
        <Stat label="Clubs" value={String(report.clubsSeen.length)} />
        <Stat label="Findings" value={String(report.findings.length)} />
        <button className="ghost" onClick={onDelete}>
          Delete session
        </button>
      </section>

      <h2>What to work on</h2>
      {report.findings.length === 0 ? (
        <p className="muted">
          Nothing stood out in this session. That is a real result — either it was a clean day, or
          there were not enough shots per club to draw a conclusion from.
        </p>
      ) : (
        <ol className="findings">
          {report.findings.map((f) => (
            <FindingCard key={`${f.id}-${f.club}`} finding={f} />
          ))}
        </ol>
      )}

      {report.practicePlan.length > 0 && (
        <>
          <h2>Your next practice session</h2>
          <ol className="plan">
            {report.practicePlan.map((item) => (
              <li key={item.drill.id}>
                <h3>{item.drill.name}</h3>
                <p>{item.drill.how}</p>
                <p className="muted">{item.drill.why}</p>
                <p className="dose">{item.drill.dose}</p>
              </li>
            ))}
          </ol>
        </>
      )}

      <h2>By club</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Club</th>
              <th>Shots</th>
              <th>Carry</th>
              <th>Spread</th>
              <th>Club spd</th>
              <th>Smash</th>
              <th>Path</th>
              <th>Face/path</th>
              <th>Spin</th>
            </tr>
          </thead>
          <tbody>
            {report.profiles.map((p) => (
              <tr key={p.club}>
                <td className="club">{p.club}</td>
                <td>{p.shotCount}</td>
                <td>{num(p.carry.median, 0)}</td>
                <td>{p.carry.n > 2 ? `±${num(p.carry.mad, 0)}` : '—'}</td>
                <td>{num(p.clubSpeed.median, 1)}</td>
                <td>{num(p.smashFactor.median, 2)}</td>
                <td>{num(p.clubPath.median, 1)}</td>
                <td>{num(p.faceToPath.median, 1)}</td>
                <td>{num(p.spinRate.median, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <li className={`finding sev-${finding.severity}`}>
      <div className="finding-head">
        <h3>{finding.title}</h3>
        <span className={`badge conf-${finding.confidence}`}>
          {finding.confidence === 'low' ? 'early signal' : `${finding.confidence} confidence`}
        </span>
      </div>
      <p>{finding.detail}</p>
      <ul className="evidence">
        {finding.evidence.map((e) => (
          <li key={e.label}>
            <span>{e.label}</span>
            <strong>
              {e.value}
              {e.unit}
            </strong>
            {e.reference !== undefined && <em>vs {e.reference}{e.unit}</em>}
          </li>
        ))}
      </ul>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Empty() {
  return (
    <main className="empty">
      <h2>No sessions yet</h2>
      <p>
        Import a TrackMan CSV to get a read on your session. Everything is computed on this device
        from your own numbers — there is no account and nothing is uploaded.
      </p>
    </main>
  );
}

/**
 * Diagnosis attaches outlier flags to the shots it is given, so hand it a copy
 * rather than the stored objects — otherwise flags accumulate across renders
 * and a shot can end up flagged from a previous pass.
 */
function cloneSession(session: ShotSession): ShotSession {
  return { ...session, shots: session.shots.map((s) => ({ ...s, flags: [] })) };
}

function num(v: number, dp: number): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(dp);
}

function formatSessionLabel(s: StoredSession): string {
  const d = s.session.startedAt ?? new Date(s.importedAt);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${s.session.shots.length}`;
}
