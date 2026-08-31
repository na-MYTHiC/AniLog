import type { ShotSession } from '@swinglab/core';

/**
 * Local-only session history.
 *
 * Everything stays on the device. There is no account, no server and no
 * bill — which is a deliberate product decision, not just a cost one: a
 * player's practice data never leaves their own machine.
 *
 * localStorage is the right size for v1 (a 50-shot session is roughly 20 KB,
 * so the ~5 MB budget holds a couple of hundred sessions). Move to IndexedDB
 * when history outgrows that; `loadAll`/`save` are the only two functions
 * that would need to change.
 */

const KEY = 'swinglab.sessions.v1';

interface StoredSession {
  session: ShotSession;
  importedAt: string;
}

function reviveDates(raw: StoredSession): StoredSession {
  return {
    ...raw,
    session: {
      ...raw.session,
      startedAt: raw.session.startedAt ? new Date(raw.session.startedAt) : null,
      shots: raw.session.shots.map((s) => ({ ...s, time: s.time ? new Date(s.time) : null })),
    },
  };
}

export function loadAll(): StoredSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredSession[];
    return parsed.map(reviveDates);
  } catch {
    // A corrupt store must not brick the app; start fresh rather than crash.
    return [];
  }
}

/** Save a session, replacing any earlier import of the same file. */
export function save(session: ShotSession): StoredSession[] {
  const existing = loadAll().filter((s) => s.session.id !== session.id);
  const next = [{ session, importedAt: new Date().toISOString() }, ...existing];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded — drop the oldest and retry once.
    const trimmed = next.slice(0, Math.max(1, next.length - 5));
    localStorage.setItem(KEY, JSON.stringify(trimmed));
    return trimmed;
  }
  return next;
}

export function remove(sessionId: string): StoredSession[] {
  const next = loadAll().filter((s) => s.session.id !== sessionId);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export type { StoredSession };
