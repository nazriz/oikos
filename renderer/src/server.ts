// The explorer's server: Bun.serve on 127.0.0.1 only, under a path prefix ("/explore" behind a proxy, or ""). It serves
// the client (bundled once at start, three.js included: nothing comes from the network at runtime) and an API over view
// indexes. Runs are only read: an index is built beside the runs (paths.ts), never inside one, and nothing here talks to
// a kernel, an orchestrator or a participant.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildView } from "../../pilot-view/src/build";
import { buildIndex, DAY, MOVE_INTS } from "./indexer";
import { buildingPanel, orgPanel, personPanel, seatActPanel, townPulse } from "./panels";
import { assertOutside, indexDirOf, indexIsCurrent, logOfRun, type RunEntry } from "./paths";
import { Store } from "./store";
import { trace, eventRow } from "./trace";
import { describeRuns, DEBRIEF_HOOK, measureSeries, toCsv, toParquet, type Series, type Table } from "./workbench";

/** `api`: the base URL of the Rust data layer (`oikos-explore serve`, kernel/crates/explore). When it is set (here, or by the
 * environment's OIKOS_EXPLORE_API) every `/api/*` request is answered by it, byte for byte, and the TS index is not built;
 * otherwise the TS index below answers (the default until the cut-over, docs/explorer.md). */
export interface ServeOptions { port: number; prefix: string; runs: RunEntry[]; log?: (s: string) => void; single?: string; api?: string; engine?: Engine }

/** Which client the page is: the Three.js explorer (the default until the Bevy one has caught up), or the Bevy explorer
 * (explorer/: a WebAssembly scene and its HTML interface; docs/explorer.md "The Bevy explorer"). */
export type Engine = "three" | "bevy";
const BEVY = join(import.meta.dir, "..", "..", "explorer");

interface Open { entry: RunEntry; dir?: string; store?: Store; pilot?: any; state: "none" | "indexing" | "ready" | "failed"; message?: string; started?: number }

/** The pilot viewer's data for a pilot, without debriefs (the explorer reads none) and with the twin when there is one. */
export async function pilotDataOf(runDir: string, log?: (s: string) => void) {
  const data = await buildView(runDir, { debriefs: false, log });
  for (const s of data.seats ?? []) { delete s.debrief; delete s.debriefNote; }
  if (data.overview) data.overview.alerts = (data.overview.alerts ?? []).filter((a: string) => !/debrief/i.test(a));
  return data;
}

/** Opens (and if needed builds) a run's index. */
export async function openIndex(entry: RunEntry, o: { log?: (s: string) => void; rebuild?: boolean } = {}): Promise<{ dir: string; store: Store }> {
  const log = logOfRun(entry.dir);
  const dir = await indexDirOf(entry.dir, log);
  assertOutside(entry.dir, dir);
  if (o.rebuild || !indexIsCurrent(dir, log)) {
    o.log?.(`indexing ${entry.name} into ${dir}`);
    await buildIndex(log, dir, { log: o.log, pilotData: entry.pilot || existsSync(join(entry.dir, "batch.json")) ? () => pilotDataOf(entry.dir, o.log) : undefined });
  }
  return { dir, store: new Store(dir) };
}

export async function bundleClient(engine: Engine = "three"): Promise<{ js: string; css: string }> {
  const dir = engine === "bevy" ? join(BEVY, "web") : join(import.meta.dir, "client");
  const r = await Bun.build({ entrypoints: [join(dir, "main.ts")], target: "browser", minify: true, define: { "process.env.NODE_ENV": '"production"' } });
  if (!r.success) throw new Error(r.logs.map(String).join("\n"));
  const js = await r.outputs.find((x) => x.kind === "entry-point")!.text();
  const css = readFileSync(join(dir, "style.css"), "utf8");
  return { js, css };
}

/** The Bevy scene's built files (explorer/pkg/<webgl2|webgpu>/, made by `bun explorer/build.ts`), if built. */
export function bevyBuilt(): string[] {
  return ["webgl2", "webgpu"].filter((f) => existsSync(join(BEVY, "pkg", f, "oikos_explorer_bg.wasm")));
}

export function pageHtml(prefix: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Oikos explorer</title><meta name="color-scheme" content="dark"><link rel="stylesheet" href="${prefix}/app.css">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0b1020"/><path d="M16 5 27 11v10L16 27 5 21V11z" fill="none" stroke="#ff5fa2" stroke-width="2.4"/><circle cx="16" cy="16" r="3.2" fill="#ffd27a"/></svg>')}">
</head><body><div id="app"></div><script>window.OIKOS_BASE=${JSON.stringify(prefix)}</script><script type="module" src="${prefix}/app.js"></script></body></html>`;
}

export async function serve(o: ServeOptions) {
  const say = o.log ?? (() => {});
  const engine: Engine = o.engine ?? "three";
  const client = await bundleClient(engine);
  if (engine === "bevy" && !bevyBuilt().length) throw new Error("the Bevy explorer is not built: run `bun explorer/build.ts`");
  const runs = new Map<string, Open>(o.runs.map((r) => [r.key, { entry: r, state: "none" }]));
  const prefix = o.prefix.replace(/\/+$/, "");
  const gz = (req: Request, body: string | Uint8Array, type: string, cache = "no-cache") => {
    const enc = req.headers.get("accept-encoding") ?? "";
    const raw = typeof body === "string" ? new TextEncoder().encode(body) : body;
    if (raw.byteLength > 1024 && enc.includes("gzip")) return new Response(Bun.gzipSync(raw as Uint8Array<ArrayBuffer>, { level: 4 }), { headers: { "content-type": type, "content-encoding": "gzip", "cache-control": cache } });
    return new Response(raw as Uint8Array<ArrayBuffer>, { headers: { "content-type": type, "cache-control": cache } });
  };
  const json = (req: Request, x: unknown) => gz(req, JSON.stringify(x), "application/json");
  const start = (r: Open) => {
    if (r.state === "indexing" || r.state === "ready") return;
    r.state = "indexing"; r.started = Date.now(); r.message = "reading the log";
    openIndex(r.entry, { log: (m) => { r.message = m; say(`${r.entry.name}: ${m}`); } })
      .then(({ dir, store }) => { r.dir = dir; r.store = store; r.pilot = store.file("pilot.json") ? JSON.parse(store.file("pilot.json")!.toString("utf8")) : undefined; r.state = "ready"; })
      .catch((e) => { r.state = "failed"; r.message = (e as Error).message; say(`${r.entry.name}: ${(e as Error).stack}`); });
  };
  const binCache = new Map<string, Uint8Array>();
  const rustApi = (o.api ?? process.env.OIKOS_EXPLORE_API ?? "").replace(/\/+$/, "");
  if (rustApi && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(rustApi)) throw new Error(`the Rust data layer is only reached on this machine (127.0.0.1), not at ${rustApi}`);

  // ---- the researcher workbench (renderer/src/workbench.ts): runs grouped, measures over time, exports
  const infos = describeRuns(o.runs);
  const series = new Map<string, Promise<Series>>();
  const seriesOf = (k: string) => {
    const info = infos.find((x) => x.key === k);
    if (!info) throw new Error(`no such run: ${k}`);
    if (!series.has(k)) {
      const spec = info.group ? (() => { try { return JSON.parse(readFileSync(join(info.group!.dir, "spec.json"), "utf8")); } catch { return undefined; } })() : undefined;
      const p = measureSeries(info.log, { institutions: spec?.institutions, from: spec?.forkDay ? spec.forkDay * DAY : undefined });
      p.catch(() => series.delete(k));
      series.set(k, p);
    }
    return series.get(k)!;
  };
  const tableOf = async (u: URL): Promise<Table> => {
    const what = u.searchParams.get("what"), run = u.searchParams.get("run") ?? "";
    if (what === "measures") {
      const keys = (u.searchParams.get("runs") ?? run).split(",").filter(Boolean);
      const names = (u.searchParams.get("measures") ?? "").split(",").filter(Boolean);
      const cols = names.length ? names : (await seriesOf(keys[0]!)).defs.map((d) => d.name);
      const rows: unknown[][] = [];
      for (const k of keys) { const s = await seriesOf(k); for (let d = 0; d <= s.days; d++) rows.push([k, d, ...cols.map((c) => s.series[c]?.[d] ?? null)]); }
      return { columns: ["run", "day", ...cols], rows };
    }
    if (!rustApi) throw new Error("the workbench's tables need the Rust data layer (oikos explore --rust, or --engine bevy)");
    const q = new URLSearchParams(u.searchParams); q.delete("what"); q.delete("run"); q.delete("format");
    if (what === "events") {
      q.set("limit", q.get("limit") ?? "100000");
      const b = await (await fetch(`${rustApi}/api/r/${encodeURIComponent(run)}/events?${q}`)).json();
      return { columns: ["ord", "t", "day", "kind", "who", "cls", "outcome", "text"], rows: b.rows.map((r: any) => [r.ord, r.t, r.day, r.kind, r.who ?? null, r.cls, r.outcome ?? null, r.text]) };
    }
    if (what === "cohort") {
      const b = await (await fetch(`${rustApi}/api/r/${encodeURIComponent(run)}/cohort?${q}`)).json();
      const rows: unknown[][] = [];
      for (const [g, x] of [["cohort", b.cohort], ["comparison", b.comparison]] as const) for (let d = 0; d <= b.days; d++) rows.push([g, d, x.agency_mean_bps[d], x.money_mean_minor[d], x.at_home_share[d], x.hard_per_100[d]]);
      return { columns: ["group", "day", "agency_mean_bps", "money_mean_minor", "at_home_share", "hard_per_100"], rows };
    }
    throw new Error(`no such table: ${what}`);
  };
  async function workbench(req: Request, u: URL, what: string): Promise<Response> {
    try {
      if (what === "runs") return json(req, { runs: infos.map((i) => ({ key: i.key, name: i.name, group: i.group ?? null })), debriefs: DEBRIEF_HOOK });
      if (what === "measures") {
        const keys = (u.searchParams.get("runs") ?? "").split(",").filter(Boolean);
        const out: Record<string, Series> = {};
        for (const k of keys) out[k] = await seriesOf(k);
        return json(req, out);
      }
      if (what === "export") {
        const t = await tableOf(u);
        const name = `${(u.searchParams.get("run") ?? u.searchParams.get("runs") ?? "runs").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 60)}.${u.searchParams.get("what")}`;
        if (u.searchParams.get("format") === "parquet") return new Response(toParquet(t) as Uint8Array<ArrayBuffer>, { headers: { "content-type": "application/vnd.apache.parquet", "content-disposition": `attachment; filename="${name}.parquet"` } });
        return new Response(toCsv(t), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"` } });
      }
    } catch (e) { return new Response(`error: ${(e as Error).message}`, { status: 500 }); }
    return new Response("not found", { status: 404 });
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: o.port,
    idleTimeout: 120,
    async fetch(req) {
      const url = new URL(req.url);
      let path = url.pathname;
      if (prefix && !path.startsWith(prefix)) return new Response("not here", { status: 404 });
      path = path.slice(prefix.length) || "/";
      if (req.method !== "GET" && req.method !== "HEAD") return new Response("read only", { status: 405 });
      if (path === "/" || path === "/index.html") return new Response(pageHtml(prefix), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
      if (path === "/app.js") return gz(req, client.js, "text/javascript; charset=utf-8");
      if (path === "/app.css") return gz(req, client.css, "text/css; charset=utf-8");
      if (engine === "bevy" && path.startsWith("/bevy/")) {
        // (the scene's WebAssembly and its wasm-bindgen glue: two names in each of two folders, nothing else)
        const m = /^\/bevy\/(webgl2|webgpu)\/(oikos_explorer\.js|oikos_explorer_bg\.wasm)$/.exec(path);
        const file = m && join(BEVY, "pkg", m[1]!, m[2]!);
        if (!file || !existsSync(file)) return new Response("not built", { status: 404 });
        return gz(req, readFileSync(file), file.endsWith(".wasm") ? "application/wasm" : "text/javascript; charset=utf-8");
      }
      if (path.startsWith("/wb/")) return workbench(req, url, path.slice(4));
      if (rustApi && path.startsWith("/api/")) {
        // The Rust service answers every route of this file's /api, with the same shapes; it is only asked, never told.
        try {
          const r = await fetch(`${rustApi}${path}${url.search}`);
          return new Response(await r.arrayBuffer(), { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/octet-stream", "cache-control": "no-cache" } });
        } catch (e) { return new Response(`the Rust data layer did not answer: ${(e as Error).message}`, { status: 502 }); }
      }
      if (path === "/api/runs") return json(req, { single: o.single ?? null, runs: [...runs.values()].map((r) => ({ key: r.entry.key, name: r.entry.name, note: r.entry.note, pilot: r.entry.pilot, mtime: r.entry.mtime, state: r.state })) });
      const m = /^\/api\/r\/([^/]+)\/(.*)$/.exec(path);
      if (!m) return new Response("not found", { status: 404 });
      const r = runs.get(decodeURIComponent(m[1]!));
      if (!r) return new Response("no such run", { status: 404 });
      const what = m[2]!;
      if (what === "status") { if (url.searchParams.has("open")) start(r); return json(req, { state: r.state, message: r.message, seconds: r.started ? Math.round((Date.now() - r.started) / 1000) : 0 }); }
      if (r.state !== "ready" || !r.store) { start(r); return json(req, { state: r.state, message: r.message }); }
      const s = r.store;
      const t = Number(url.searchParams.get("t") ?? s.meta.lastT);
      try {
        if (what === "world") {
          const p = r.pilot;
          return json(req, {
            meta: { runId: s.meta.runId, days: s.meta.days, lastT: s.meta.lastT, end: s.meta.end, persons: s.meta.persons, holders: s.meta.holders.length, spaces: s.meta.spaces.map((x) => [x.struct, x.kind, x.n]), extraStructures: s.meta.extraStructures, seats: s.meta.seats, kept: s.meta.kept, lines: s.meta.lines, movesDay: s.meta.movesDay, pulses: s.meta.pulses, indexSeconds: s.meta.seconds },
            world: { ...s.world, lots: undefined, accounts: undefined, participants: s.world.participants.filter((x) => x.cls !== "person"), lotCells: s.world.lots.map((l) => l.cells) },
            persons: s.meta.holders.slice(0, s.meta.persons),
            pilot: p ? { overview: p.overview, seats: (p.seats ?? []).map((x: any) => ({ id: x.id, title: x.title, model: x.model, framing: x.framing, calls: x.calls, sittings: Array.isArray(x.sittings) ? x.sittings.length : x.sittings, cost: x.cost, acts: x.acts, requests: x.requests, confirmed: x.confirmed, declined: x.declined })), twin: p.twin ? { run: p.twin.run, seats: p.twin.seats.map((x: any) => ({ seat: x.seat, seatActs: x.seatActs, twinActs: x.twinActs, matched: x.matched, same: x.same, differ: x.differ, seatOnly: x.seatOnly, twinOnly: x.twinOnly })) } : null, town: p.town ? { series: p.town.series, twinSeries: p.town.twinSeries } : null } : null,
            seatActs: s.seatActs.map((a) => ({ ord: a.ord, t: a.t, endT: a.endT, participant: a.participant, as: a.as, kinds: a.kinds, text: a.text, status: a.status, from: a.from, targets: a.targets, via: a.via })),
            townPulse: townPulse(s),
          });
        }
        if (what.startsWith("bin/")) {
          const name = what.slice(4);
          if (name === "moves") {
            const from = Math.max(0, Number(url.searchParams.get("from") ?? 0)), to = Math.min(s.meta.days + 1, Number(url.searchParams.get("to") ?? s.meta.days + 1));
            const a = (s.meta.movesDay[from] ?? s.meta.moves) * MOVE_INTS, b = (s.meta.movesDay[to] ?? s.meta.moves) * MOVE_INTS;
            return gz(req, new Uint8Array(s.moves.buffer, s.moves.byteOffset + a * 4, (b - a) * 4), "application/octet-stream");
          }
          if (!["where", "pulses", "money", "agency"].includes(name)) return new Response("no such track", { status: 404 });
          const key = `${r.entry.key}/${name}`;
          let buf = binCache.get(key);
          if (!buf) { buf = new Uint8Array(s.file(`${name}.bin`)!); binCache.set(key, buf); }
          return gz(req, buf, "application/octet-stream");
        }
        let mm: RegExpExecArray | null;
        if ((mm = /^person\/(.+)$/.exec(what))) return json(req, personPanel(s, decodeURIComponent(mm[1]!), t) ?? { missing: true });
        if ((mm = /^org\/(.+)$/.exec(what))) return json(req, orgPanel(s, decodeURIComponent(mm[1]!), t) ?? { missing: true });
        if ((mm = /^building\/(\d+)$/.exec(what))) return json(req, buildingPanel(s, Number(mm[1]), t) ?? { missing: true });
        if ((mm = /^act\/(\d+)$/.exec(what))) return json(req, seatActPanel(s, r.pilot, Number(mm[1])) ?? { missing: true });
        if ((mm = /^trace\/(\d+)$/.exec(what))) return json(req, { row: eventRow(s, Number(mm[1]), url.searchParams.get("about") ?? undefined), links: trace(s, Number(mm[1]), url.searchParams.get("about") ?? undefined) });
        if ((mm = /^line\/(\d+)$/.exec(what))) return gz(req, s.text(Number(mm[1])), "application/json");
        if ((mm = /^seat\/(.+)$/.exec(what))) {
          const seat = r.pilot?.seats?.find((x: any) => x.id === decodeURIComponent(mm![1]!));
          return json(req, seat ? { id: seat.id, title: seat.title, model: seat.model, framing: seat.framing, calls: seat.calls, cost: seat.cost, acts: seat.acts, requests: seat.requests, confirmed: seat.confirmed, declined: seat.declined, notebook: seat.notebook, sittings: (seat.sittings ?? []).map((x: any) => ({ day: x.day, stamp: x.stamp, t: x.t, calls: x.calls, cost: x.cost, requests: (x.requests ?? []).length, direct: (x.direct ?? []).length, say: (x.turns ?? []).map((tu: any) => tu.say).filter(Boolean).join("\n\n").slice(0, 1200) })) } : { missing: true });
        }
      } catch (e) { say(`${what}: ${(e as Error).stack}`); return new Response(`error: ${(e as Error).message}`, { status: 500 }); }
      return new Response("not found", { status: 404 });
    },
  });
  if (!rustApi) for (const r of runs.values()) if (o.single === r.entry.key) start(r);
  return { server, url: `http://127.0.0.1:${server.port}${prefix}/`, runs };
}

export { DAY };
