// Lens's server: the client (built at start and served compressed, ./client.ts) and the API
// (src/shared/api.ts). Bound to 127.0.0.1; reached from elsewhere through `tailscale serve` (docs/design/lens.md).
import { dataRuns } from "./data";
import { loadGrades } from "./grades";
import { packetText, runDebriefs, runFiles, runGrades, servableFile } from "./run-data";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { clientRoutes } from "./client";
import type { IndexStatus } from "../shared/api";
import { lensPaths, type LensPaths } from "./paths";
import { Lens } from "./service";
import { momentsResponse } from "./moments";

export interface ServeOptions {
  runs?: string;
  views?: string;
  port?: number;
  hostname?: string;
  /** Development: the client unminified and built again on each load of the page. */
  development?: boolean;
  /** Read the study's readings in the background (default true). */
  background?: boolean;
}

const json = (x: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(x), { ...init, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init.headers ?? {}) } });
const notFound = (what: string) => json({ error: `${what} not found` }, { status: 404 });

/** A bundle file, gzipped when there is a gzipped copy and the client takes it. */
function fileResponse(req: Request, path: string, type: string): Response {
  const gz = `${path}.gz`;
  const takesGzip = (req.headers.get("accept-encoding") ?? "").includes("gzip");
  // (A bundle never changes under its name: a changed log makes a new bundle. The client may keep it.)
  const headers: Record<string, string> = { "content-type": type, "cache-control": "private, max-age=3600" };
  if (takesGzip && existsSync(gz)) return new Response(Bun.file(gz), { headers: { ...headers, "content-encoding": "gzip", vary: "accept-encoding", "content-disposition": "inline" } });
  if (!existsSync(path)) return notFound("file");
  return new Response(Bun.file(path), { headers });
}

export function startServer(o: ServeOptions = {}) {
  const paths: LensPaths = lensPaths(o);
  const lens = new Lens(paths, { background: o.background !== false });
  const NAME = /^[a-z0-9_-]+$/i;
  const client = clientRoutes(o.development ?? false);

  const server = Bun.serve({
    hostname: o.hostname ?? "127.0.0.1",
    port: o.port ?? 4322,
    development: o.development ?? false,
    idleTimeout: 0,
    // (One server a port. With the port shared, a second Lens left running split the requests with the first at
    // random: pages from one asked the other for files it did not have, and both made bundles. A run page then sat on
    // "Drawing the town" for 50 s. A second start now fails with EADDRINUSE.)
    reusePort: false,
    routes: {
      "/": (req) => (lens.noteViewer(), client.page(req)),
      "/fonts/:file": (req) => client.font(req.params.file) ?? notFound("font"),
      "/api/runs": async (req) => {
        lens.noteViewer();
        // (A thousand runs' entries are a megabyte; gzipped, a tenth of it: it matters on a phone.)
        const body = JSON.stringify(await lens.list(new URL(req.url).searchParams.has("fresh")));
        const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", vary: "accept-encoding" };
        if ((req.headers.get("accept-encoding") ?? "").includes("gzip")) return new Response(Bun.gzipSync(Buffer.from(body)), { headers: { ...headers, "content-encoding": "gzip" } });
        return new Response(body, { headers });
      },
      "/api/moments": (req) => (lens.noteViewer(), momentsResponse(lens, req)),
      // (The Data page's run table: the study's raw fields, from the files as they are; src/server/data.ts.)
      "/api/data/runs": (req) => {
        lens.noteViewer();
        const body = JSON.stringify(dataRuns(lens.paths.runs, lens.paths.views));
        const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", vary: "accept-encoding" };
        if ((req.headers.get("accept-encoding") ?? "").includes("gzip")) return new Response(Bun.gzipSync(Buffer.from(body)), { headers: { ...headers, "content-encoding": "gzip" } });
        return new Response(body, { headers });
      },
      "/api/run/:key": async (req) => {
        lens.noteViewer();
        const e = await lens.catalogue.find(req.params.key);
        if (!e) return notFound("run");
        const m = lens.manifest(e);
        const g0 = loadGrades(lens.paths.runs).get(e.key);
        const grade = g0 ? lens.placed(e, g0) : undefined;
        return json({ ...e, ...(m ? { indexed: true, summary: m.summary, ...(m.reading ? { reading: m.reading } : {}), errors: m.errors } : {}), ...(grade ? { grade } : {}) });
      },
      // The Data page's raw view of one run (src/server/run-data.ts): read-only, the files as written.
      "/api/data/run/:key/grades": async (req) => {
        const e = await lens.catalogue.find(req.params.key);
        if (!e) return notFound("run");
        return json({ sets: runGrades(lens.paths.runs, e.key) });
      },
      "/api/data/run/:key/packet": async (req) => {
        const q = new URL(req.url).searchParams;
        const t = packetText(lens.paths.runs, q.get("set") ?? "", q.get("packet") ?? "");
        return t === undefined ? notFound("packet") : new Response(t, { headers: { "content-type": "text/plain; charset=utf-8" } });
      },
      "/api/data/run/:key/files": async (req) => {
        const e = await lens.catalogue.find(req.params.key);
        if (!e) return notFound("run");
        return json({ files: runFiles(lens.paths.runs, e) });
      },
      "/api/data/run/:key/debriefs": async (req) => {
        const e = await lens.catalogue.find(req.params.key);
        if (!e) return notFound("run");
        try {
          return json({ rows: await runDebriefs(lens.paths.runs, e) });
        } catch (err) {
          return json({ error: String((err as Error)?.message ?? err) }, { status: 500 });
        }
      },
      "/api/data/run/:key/file": async (req) => {
        const e = await lens.catalogue.find(req.params.key);
        if (!e) return notFound("run");
        const abs = servableFile(lens.paths.runs, e, new URL(req.url).searchParams.get("path") ?? "");
        if (!abs) return notFound("file");
        return new Response(Bun.file(abs), { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${abs.split("/").pop()}"` } });
      },
      "/api/run/:key/status": async (req) => {
        lens.noteViewer();
        const e = await lens.catalogue.find(req.params.key);
        if (!e) return notFound("run");
        let unsubscribe = () => {};
        let ping: ReturnType<typeof setInterval> | undefined;
        const stream = new ReadableStream({
          start(c) {
            const enc = new TextEncoder();
            let closed = false;
            const close = () => {
              if (closed) return;
              closed = true;
              clearInterval(ping);
              unsubscribe();
              try {
                c.close();
              } catch {}
            };
            const send = (s: IndexStatus) => {
              if (closed) return;
              c.enqueue(enc.encode(`data: ${JSON.stringify(s)}\n\n`));
              if (s.state === "ready" || s.state === "failed") close();
            };
            ping = setInterval(() => !closed && c.enqueue(enc.encode(": ping\n\n")), 15_000);
            unsubscribe = lens.open(e, send);
            req.signal.addEventListener("abort", close);
          },
          cancel() {
            clearInterval(ping);
            unsubscribe();
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
      },
      "/api/run/:key/:fold": async (req) => {
        lens.noteViewer();
        const e = await lens.catalogue.find(req.params.key);
        if (!e) return notFound("run");
        const m = lens.manifest(e);
        if (!m) return json({ error: "not indexed yet: open /status" }, { status: 409 });
        const fold = req.params.fold;
        if (!NAME.test(fold)) return notFound("fold");
        if (m.errors[fold]) return json({ error: `the ${fold} fold failed`, detail: m.errors[fold] }, { status: 500 });
        return fileResponse(req, join(lens.bundlePath(e), `${fold}.json`), "application/json; charset=utf-8");
      },
      "/api/run/:key/:fold/:file": async (req) => {
        lens.noteViewer();
        const e = await lens.catalogue.find(req.params.key);
        if (!e) return notFound("run");
        if (!lens.manifest(e)) return json({ error: "not indexed yet" }, { status: 409 });
        const { fold, file } = req.params;
        if (!NAME.test(fold) || !/^[a-z0-9_.-]+$/i.test(file) || file.includes("..")) return notFound("file");
        return fileResponse(req, join(lens.bundlePath(e), `${fold}.${file}.bin`), "application/octet-stream");
      },
      "/api/*": () => notFound("route"),
    },
    async fetch(req) {
      return (await client.asset(req)) ?? new Response("Not found", { status: 404 });
    },
  });
  // (At start: the catalogue, the background reading, and the showcase runs made ahead.)
  if (o.background !== false) void lens.list().catch(() => {});
  return { server, lens, paths, url: `http://${server.hostname}:${server.port}/` };
}
