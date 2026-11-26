// Fetching from Lens's server (src/shared/api.ts), for every view. A fold's JSON is fetched once per run and kept.
import { useEffect, useState } from "react";
import type { Catalogue, IndexStatus, Meta, RunEntry } from "../shared/api";
import { useLens } from "./state";

const enc = encodeURIComponent;
const cache = new Map<string, Promise<unknown>>();

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      const j = await r.json();
      msg = j.error ?? msg;
    } catch {}
    throw new Error(msg);
  }
  return (await r.json()) as T;
}

export const fetchCatalogue = (fresh = false) => getJson<Catalogue>(`/api/runs${fresh ? "?fresh=1" : ""}`);
export const fetchRun = (key: string) => getJson<RunEntry & { errors?: { [fold: string]: string } }>(`/api/run/${enc(key)}`);

/** A fold's JSON for a run (kept after the first fetch). */
export function fetchFold<T = unknown>(key: string, fold: string): Promise<T> {
  const url = `/api/run/${enc(key)}/${enc(fold)}`;
  let p = cache.get(url);
  if (!p) {
    p = getJson<T>(url);
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p as Promise<T>;
}

/** One of a fold's binary files (FoldResult.files), as bytes. */
export async function foldFile(key: string, fold: string, file: string): Promise<ArrayBuffer> {
  const r = await fetch(`/api/run/${enc(key)}/${enc(fold)}/${enc(file)}`);
  if (!r.ok) throw new Error(`${fold}/${file}: ${r.status}`);
  return r.arrayBuffer();
}

export type Loaded<T> = { data?: T; error?: string; loading: boolean };

/** A fold of the open run (or of `key`): { data, error, loading }. */
export function useFold<T = unknown>(fold: string, key?: string | null): Loaded<T> {
  const open = useLens((s) => s.run);
  const run = key ?? open;
  const [state, setState] = useState<Loaded<T>>({ loading: true });
  useEffect(() => {
    if (!run) return;
    let live = true;
    setState({ loading: true });
    fetchFold<T>(run, fold).then(
      (data) => live && setState({ data, loading: false }),
      (e) => live && setState({ error: String(e.message ?? e), loading: false }),
    );
    return () => {
      live = false;
    };
  }, [run, fold]);
  return state;
}

export const useMeta = (key?: string | null) => useFold<Meta>("meta", key);

/** Follows a run's indexing (server-sent events) until its bundle is ready. */
export function useIndexStatus(key: string | null): IndexStatus | undefined {
  const [s, setS] = useState<IndexStatus>();
  useEffect(() => {
    if (!key) return;
    setS(undefined);
    const es = new EventSource(`/api/run/${enc(key)}/status`);
    es.onmessage = (m) => {
      const x = JSON.parse(m.data) as IndexStatus;
      setS(x);
      if (x.state === "ready" || x.state === "failed") es.close();
    };
    es.onerror = () => {
      // (The server closes the stream once ready; a drop before then is retried by the browser.)
    };
    return () => es.close();
  }, [key]);
  return s;
}
