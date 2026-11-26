// The story view's own harness, kept for working on it apart from the app shell (docs/design/lens.md section 5):
//   bun lens/src/client/story/dev.ts build <log.jsonl | arm.oklog> [--key name] [--arm name] [--fork-day N] [--spec spec.json]
//       runs the seat fold over a log, as the ingest would, into <views>/story-dev/<key>/
//   bun lens/src/client/story/dev.ts serve [--port 4323] [--catalogue http://127.0.0.1:4322]
//       serves those bundles at /api/run/<key>/seat(/<file>) and a page with the story rail and the sitting reader.
// Read-only on runs: an .oklog is read through the kernel's export on a pipe, nothing is written beside it.
// <views> is $OIKOS_VIEWS, else ~/oikos-lens-cache (Lens's cache, outside runs/: src/server/paths.ts).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { Fold, FoldContext, LogLine } from "../../shared/fold";
import { seatFold } from "../../folds/seat";
import { dailyFold } from "../../folds/daily";

const DAY = 86_400;
export function viewsDir(): string {
  return process.env.OIKOS_VIEWS ?? join(homedir(), "oikos-lens-cache");
}
export const devDir = () => join(viewsDir(), "story-dev");

/** The kernel's binary: $OIKOS_KERNEL, else the release build of this checkout or the one above a worktree. */
function kernel(): string {
  if (process.env.OIKOS_KERNEL) return process.env.OIKOS_KERNEL;
  let d = resolve(import.meta.dir);
  while (d !== dirname(d)) { const k = join(d, "kernel", "target", "release", "oikos-kernel"); if (existsSync(k)) return k; d = dirname(d); }
  throw new Error("no oikos-kernel build found (set OIKOS_KERNEL)");
}

/** Every line of a log, in order. Lines the ingest never parses (the kernel's own observe round-trips) are skipped. */
export async function* rawLines(path: string): AsyncGenerator<string> {
  const stream = path.endsWith(".oklog") ? Bun.spawn([kernel(), "export", path], { stdout: "pipe", stderr: "ignore" }).stdout : Bun.file(path).stream();
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of stream as ReadableStream<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let start = 0, i: number;
    while ((i = buf.indexOf("\n", start)) >= 0) { const line = buf.slice(start, i); start = i + 1; if (line) yield line; }
    buf = buf.slice(start);
  }
  if (buf.trim()) yield buf;
}
const SKIP = ['"command":"observe"', '"event":"observation"', '"command":"advance_to_news"'];

/** Runs folds over a log as the ingest does: one pass, every line to every fold. */
export async function runFolds(path: string, folds: Fold[], ctx: FoldContext): Promise<{ lines: number; ms: number }> {
  const t0 = performance.now();
  let n = 0;
  for await (const raw of rawLines(path)) {
    n++;
    if (raw.length < 400 && SKIP.some((s) => raw.includes(s))) continue;
    const l = JSON.parse(raw) as LogLine;
    if (l.kind === "annotation" && l.body?.annotation === "debrief") continue;
    for (const f of folds) f.line(l, ctx);
  }
  return { lines: n, ms: performance.now() - t0 };
}

/** The story's folds (seat, daily) over one log, written as a bundle the dev server (and the client) reads. */
export async function buildSeat(path: string, opts: { key?: string; arm?: string; forkDay?: number; spec?: any } = {}): Promise<string> {
  const key = opts.key ?? basename(path).replace(/\.(jsonl|oklog)$/, "");
  const ctx: FoldContext & { forkAt?: number; spec?: any } = { runId: key, dir: dirname(path), ...(opts.arm ? { arm: opts.arm } : {}), ...(opts.forkDay !== undefined ? { forkAt: opts.forkDay * DAY } : {}), ...(opts.spec ? { spec: opts.spec } : {}) };
  const folds = [seatFold(), dailyFold()];
  const { lines, ms } = await runFolds(path, folds, ctx);
  const t1 = performance.now();
  const dir = join(devDir(), key);
  for (const fold of folds) {
    const out = await fold.finish(ctx);
    mkdirSync(join(dir, fold.name), { recursive: true });
    writeFileSync(join(dir, `${fold.name}.json`), JSON.stringify(out.json));
    for (const [f, bytes] of Object.entries(out.files ?? {})) writeFileSync(join(dir, fold.name, f), bytes);
  }
  console.log(`${key}: ${lines} lines in ${(ms / 1000).toFixed(1)}s, finish ${((performance.now() - t1) / 1000).toFixed(1)}s -> ${dir}`);
  return dir;
}

async function serve(port: number, catalogue?: string) {
  const page = (await import("./dev.html")).default;
  const dir = devDir();
  const server = Bun.serve({
    port, hostname: "127.0.0.1",
    routes: {
      "/": page,
      // (With --catalogue <url>, the run list is a running Lens server's, for the pages built on it: Findings.)
      "/api/runs": async () => catalogue ? new Response(await (await fetch(`${catalogue}/api/runs`)).text(), { headers: { "content-type": "application/json" } }) : Response.json(existsSync(dir) ? readdirSync(dir).filter((k) => existsSync(join(dir, k, "seat.json"))).map((key) => ({ key })) : []),
      "/api/run/:key/:fold": (req) => { const f = join(dir, basename(req.params.key), `${basename(req.params.fold)}.json`); return existsSync(f) ? new Response(Bun.file(f), { headers: { "content-type": "application/json" } }) : new Response("no such run", { status: 404 }); },
      "/api/run/:key/:fold/:file": (req) => { const f = join(dir, basename(req.params.key), basename(req.params.fold), basename(req.params.file)); return existsSync(f) ? new Response(Bun.file(f), { headers: { "content-type": req.params.file.startsWith("system-") ? "text/plain; charset=utf-8" : "application/json" } }) : new Response("no such file", { status: 404 }); },
    },
    development: true,
  });
  console.log(`story dev: http://127.0.0.1:${server.port}/`);
}

if (import.meta.main) {
  const [cmd, ...a] = process.argv.slice(2);
  const opt = (n: string) => { const i = a.indexOf(n); return i < 0 ? undefined : a[i + 1]; };
  if (cmd === "build" && a[0]) {
    const spec = opt("--spec") ? JSON.parse(readFileSync(opt("--spec")!, "utf8")) : undefined;
    const forkDay = opt("--fork-day") !== undefined ? Number(opt("--fork-day")) : typeof spec?.forkDay === "number" ? spec.forkDay : undefined;
    await buildSeat(a[0], { ...(opt("--key") ? { key: opt("--key")! } : {}), ...(opt("--arm") ? { arm: opt("--arm")! } : {}), ...(forkDay !== undefined ? { forkDay } : {}), ...(spec ? { spec } : {}) });
  } else if (cmd === "serve") await serve(Number(opt("--port") ?? 4323), opt("--catalogue"));
  else { console.error("dev.ts build <log> [--key k] [--arm a] [--fork-day N] [--spec spec.json] | serve [--port 4323]"); process.exit(2); }
}
