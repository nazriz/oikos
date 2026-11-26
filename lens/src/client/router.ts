// Hash routes (docs/design/lens.md section 1): #/ the library, #/run/<key>?t=…&sel=…, #/compare/<a>/<b> (later).
import { useSyncExternalStore } from "react";
import type { Selection } from "./state";

export type Route =
  | { page: "library"; q: URLSearchParams }
  | { page: "run"; key: string; q: URLSearchParams }
  | { page: "compare"; a: string; b: string; q: URLSearchParams }
  | { page: "moments"; q: URLSearchParams };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, "") || "/";
  const [path, query = ""] = h.split("?") as [string, string?];
  const q = new URLSearchParams(query);
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "run" && parts[1]) return { page: "run", key: parts[1], q };
  if (parts[0] === "moments") return { page: "moments", q };
  if (parts[0] === "compare" && parts[1] && parts[2]) return { page: "compare", a: parts[1], b: parts[2], q };
  return { page: "library", q };
}

const subscribe = (f: () => void) => {
  window.addEventListener("hashchange", f);
  return () => window.removeEventListener("hashchange", f);
};
export const useHash = () => useSyncExternalStore(subscribe, () => window.location.hash);
export const useRoute = (): Route => parseHash(useHash());

export const runHref = (key: string, q?: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q ?? {})) if (v !== undefined) p.set(k, String(v));
  const s = p.toString();
  return `#/run/${encodeURIComponent(key)}${s ? `?${s}` : ""}`;
};

/** Rewrite the hash's query without a history entry or a hashchange-triggered reload of the page. */
export function replaceQuery(set: Record<string, string | undefined>) {
  const r = parseHash(window.location.hash);
  for (const [k, v] of Object.entries(set)) v === undefined ? r.q.delete(k) : r.q.set(k, v);
  const base = window.location.hash.replace(/^#/, "").split("?")[0] || "/";
  const s = r.q.toString();
  const next = `#${base}${s ? `?${s}` : ""}`;
  if (next !== window.location.hash) history.replaceState(null, "", next);
}

/** A selection as a short URL token and back: person:c0018, sitting:12, act:19169. */
export const selToken = (s: Selection): string | undefined => {
  if (!s) return undefined;
  if (s.kind === "sitting" || s.kind === "lever") return `${s.kind}:${s.index}`;
  if (s.kind === "act") return `act:${s.seq}`;
  return `${s.kind}:${s.id}`;
};
export const parseSel = (x: string | null): Selection => {
  if (!x) return null;
  const i = x.indexOf(":");
  const kind = x.slice(0, i), v = x.slice(i + 1);
  if (kind === "sitting" || kind === "lever") return { kind, index: Number(v) };
  if (kind === "act") return { kind, seq: Number(v) };
  if (kind === "person" || kind === "structure" || kind === "entity") return { kind, id: v };
  return null;
};
