// The painted ground, kept in this browser (IndexedDB) once painted: painting it takes ~200 ms on the main thread, and
// opening a run the browser has seen should not wait for it (docs/decisions.md, "Lens: smooth"). A blob per run and
// theme, decoded off the main thread by createImageBitmap. A browser without IndexedDB, or a private window, paints.
const DB = "lens-ground", STORE = "ground", VERSION = 1;

let opened: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  opened ??= new Promise((res) => {
    try {
      const r = indexedDB.open(DB, VERSION);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch {
      res(null);
    }
  });
  return opened;
}

/** The ground painted for `key` before, as a bitmap, or null. */
export async function cachedGround(key: string): Promise<ImageBitmap | null> {
  const d = await db();
  if (!d) return null;
  const blob = await new Promise<Blob | null>((res) => {
    try {
      const r = d.transaction(STORE, "readonly").objectStore(STORE).get(key);
      r.onsuccess = () => res(r.result instanceof Blob ? r.result : null);
      r.onerror = () => res(null);
    } catch {
      res(null);
    }
  });
  if (!blob) return null;
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/** Keep a freshly painted ground for next time (in the background; failures are ignored). */
export function keepGround(key: string, canvas: HTMLCanvasElement | OffscreenCanvas): void {
  const blob: Promise<Blob | null> = "convertToBlob" in canvas ? canvas.convertToBlob({ type: "image/png" }) : new Promise((res) => (canvas as HTMLCanvasElement).toBlob(res, "image/png"));
  void Promise.all([db(), blob]).then(([d, b]) => {
    if (!d || !b) return;
    try {
      d.transaction(STORE, "readwrite").objectStore(STORE).put(b, key);
    } catch {}
  }, () => {});
}
