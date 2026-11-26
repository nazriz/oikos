// A run's bundle: what its folds made of its log, in <views>/<key>.<stamp>/ (the stamp is the log's size and mtime, so a
// log that changes gets a new bundle). Made once, in one pass (src/server/ingest.ts), reused while the log is unchanged
// and every fold is at the version that made it. Written to a scratch folder and moved into place whole, so a reader
// never sees half a bundle. Nothing here writes outside the views folder.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ForkReading, Meta, RunEntry } from "../shared/api";
import { ensureDir, removeOwn } from "./paths";
import { foldVersions, ingest, type IngestProgress } from "./ingest";
import type { ReadingInput } from "./reading";
import type { FoldContext } from "../shared/fold";

export interface Manifest {
  key: string;
  log: string;
  bytes: number;
  mtimeMs: number;
  folds: { [name: string]: number };
  lines: number;
  seconds: number;
  madeAt: string;
  errors: { [fold: string]: string };
  /** For the library's cards, without opening meta.json. */
  summary: RunEntry["summary"];
  reading?: ForkReading;
}

export const stampOf = (bytes: number, mtimeMs: number) => createHash("sha1").update(`${bytes}:${Math.round(mtimeMs)}`).digest("hex").slice(0, 10);
export const bundleDir = (views: string, key: string, bytes: number, mtimeMs: number) => join(views, "bundles", `${key}.${stampOf(bytes, mtimeMs)}`);

const sameFolds = (a: { [n: string]: number }, b: { [n: string]: number }) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

let versions: { [n: string]: number } | undefined;
const currentVersions = () => (versions ??= foldVersions());

/** The bundle's manifest if it is there and current. */
export function readyManifest(dir: string): Manifest | undefined {
  const f = join(dir, "manifest.json");
  if (!existsSync(f)) return undefined;
  try {
    const m: Manifest = JSON.parse(readFileSync(f, "utf8"));
    return sameFolds(m.folds, currentVersions()) ? m : undefined;
  } catch {
    return undefined;
  }
}

/** A bundle's manifest whatever folds made it (an older bundle served while the current one is made). */
export function anyManifest(dir: string): Manifest | undefined {
  const f = join(dir, "manifest.json");
  if (!existsSync(f)) return undefined;
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return undefined;
  }
}

/** The bundle folders there are, by run key (the folder's name less its stamp), listed at most every few seconds: a
 * thousand runs asking which bundles they have must not each list the folder. */
let listed: { views: string; at: number; byKey: Map<string, string[]> } | undefined;
function bundleFolders(views: string): Map<string, string[]> {
  if (listed && listed.views === views && Date.now() - listed.at < 5_000) return listed.byKey;
  const byKey = new Map<string, string[]>();
  const parent = join(views, "bundles");
  try {
    for (const f of readdirSync(parent)) {
      const dot = f.lastIndexOf(".");
      if (dot < 0 || !/^[0-9a-f]{10}$/.test(f.slice(dot + 1))) continue;
      const k = f.slice(0, dot);
      let a = byKey.get(k);
      if (!a) byKey.set(k, (a = []));
      a.push(join(parent, f));
    }
  } catch {}
  listed = { views, at: Date.now(), byKey };
  return byKey;
}

/** Forget the folder listing (after a bundle is made or removed in this process). */
export function relistBundles(): void {
  listed = undefined;
}

/** The bundle to serve for a log: its own when current, else the newest made of it before (of an earlier, shorter log,
 * or by earlier folds, as after a fold's version goes up), served while its own is made. */
export function servedBundle(views: string, key: string, bytes: number, mtimeMs: number): { dir: string; m: Manifest; stale: boolean } | undefined {
  const own = bundleDir(views, key, bytes, mtimeMs);
  const m = readyManifest(own);
  if (m) return { dir: own, m, stale: false };
  let v: { dir: string; m: Manifest; stale: true } | undefined;
  for (const dir of bundleFolders(views).get(key) ?? []) {
    const sm = anyManifest(dir);
    if (sm && sm.bytes <= bytes && (!v || sm.madeAt > v.m.madeAt)) v = { dir, m: sm, stale: true };
  }
  return v;
}

export interface MakeBundle {
  views: string;
  entry: RunEntry;
  /** Absolute path of the log. */
  path: string;
  ctx: FoldContext;
  reading?: ReadingInput;
  onProgress?: (p: IngestProgress) => void;
}

export async function makeBundle(o: MakeBundle): Promise<Manifest> {
  const dir = bundleDir(o.views, o.entry.key, o.entry.bytes, o.entry.mtimeMs);
  const scratch = `${dir}.partial-${process.pid}-${Date.now()}`;
  // (A making that was stopped, to let a viewer's run go first, leaves its scratch folder: gone once its process is.)
  const parentDir = join(o.views, "bundles");
  const base = `${dir.slice(parentDir.length + 1)}.partial-`;
  for (const f of existsSync(parentDir) ? readdirSync(parentDir) : []) {
    if (!f.startsWith(base)) continue;
    const pid = Number(f.slice(base.length).split("-")[0]);
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {}
    if (!alive) removeOwn(o.views, join(parentDir, f));
  }
  ensureDir(scratch);
  try {
    const r = await ingest(o.path, { ctx: o.ctx, ...(o.reading ? { reading: o.reading } : {}), ...(o.onProgress ? { onProgress: o.onProgress } : {}) });
    const folds: { [n: string]: number } = {};
    for (const out of r.outputs) {
      folds[out.name] = out.version;
      const text = JSON.stringify(out.json);
      writeFileSync(join(scratch, `${out.name}.json`), text);
      writeFileSync(join(scratch, `${out.name}.json.gz`), Bun.gzipSync(Buffer.from(text)));
      for (const [file, bytes] of Object.entries(out.files ?? {})) {
        writeFileSync(join(scratch, `${out.name}.${file}.bin`), bytes);
        if (bytes.length > 4096) writeFileSync(join(scratch, `${out.name}.${file}.bin.gz`), Bun.gzipSync(bytes as Uint8Array<ArrayBuffer>));
      }
    }
    // (A fold that failed is recorded at its version, so the bundle is not made again until it changes; its error is
    // in the manifest and the API answers its name with the error.)
    for (const [name, v] of Object.entries(currentVersions())) if (!(name in folds)) folds[name] = v;
    const meta = r.outputs.find((x) => x.name === "meta")?.json as Meta | undefined;
    const seat = meta?.seats.find((s) => s.post === (meta.post?.id ?? s.post)) ?? meta?.seats[0];
    const m: Manifest = {
      key: o.entry.key,
      log: o.entry.log,
      bytes: o.entry.bytes,
      mtimeMs: o.entry.mtimeMs,
      folds,
      lines: r.lines,
      seconds: Math.round(r.seconds * 10) / 10,
      madeAt: new Date().toISOString(),
      errors: r.errors,
      summary: meta
        ? {
            days: meta.span.days,
            people: meta.people.initial,
            ...(meta.place ? { place: meta.place } : {}),
            ...(seat?.model ? { model: seat.model } : {}),
            usd: meta.cost.all.microusd / 1e6,
            ...(meta.end?.reason ? { end: meta.end.reason } : {}),
          }
        : undefined,
      ...(r.reading ? { reading: r.reading } : {}),
    };
    writeFileSync(join(scratch, "manifest.json"), JSON.stringify(m, null, 1));
    removeOwn(o.views, dir);
    renameSync(scratch, dir);
    relistBundles();
    // (Bundles of this run made from an older log, or by older folds, go: they are Lens's own files.)
    const parent = join(o.views, "bundles");
    for (const f of readdirSync(parent)) {
      const rest = f.startsWith(`${o.entry.key}.`) ? f.slice(o.entry.key.length + 1) : "";
      if (/^[0-9a-f]{10}$/.test(rest) && join(parent, f) !== dir) removeOwn(o.views, join(parent, f));
    }
    return m;
  } catch (e) {
    removeOwn(o.views, scratch);
    throw e;
  }
}
