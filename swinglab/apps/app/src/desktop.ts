/**
 * Optional desktop bridge.
 *
 * The web app is the product; the desktop shell only adds folder watching.
 * So this module talks to Tauri through the injected `window.__TAURI__`
 * global rather than importing `@tauri-apps/api`. That keeps the browser
 * build free of a dependency it would never use, and means the exact same
 * bundle runs as a PWA, on GitHub Pages, and inside the desktop window.
 *
 * Every function here is a no-op outside the desktop shell.
 */

export interface DiscoveredFile {
  name: string;
  path: string;
  text: string;
}

interface TauriGlobal {
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  event: {
    listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void>;
  };
  dialog?: { open(opts: { directory: boolean; multiple: boolean }): Promise<string | null> };
}

function tauri(): TauriGlobal | null {
  const g = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  return g ?? null;
}

export function isDesktop(): boolean {
  return tauri() !== null;
}

/**
 * Ask the user for a folder, backfill everything already in it, then watch
 * it for new exports. Returns an unsubscribe function, or null if we are not
 * running in the desktop shell or the user cancelled.
 */
export async function watchExportFolder(
  onFiles: (files: DiscoveredFile[]) => void,
): Promise<(() => void) | null> {
  const t = tauri();
  if (!t?.dialog) return null;

  const folder = await t.dialog.open({ directory: true, multiple: false });
  if (!folder) return null;

  // Backfill first so pointing at a folder of past exports builds history,
  // rather than only catching sessions from this moment on.
  const existing = await t.core.invoke<DiscoveredFile[]>('scan_folder', { folder });
  if (existing.length > 0) onFiles(existing);

  const unlisten = await t.event.listen<DiscoveredFile>('swinglab://file-discovered', (e) => {
    onFiles([e.payload]);
  });

  await t.core.invoke('watch_folder', { folder });

  return () => {
    void unlisten();
    void t.core.invoke('stop_watching');
  };
}
