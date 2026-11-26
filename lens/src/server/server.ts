// Lens's server: the client (built at start and served compressed, ./client.ts) and the API
// (src/shared/api.ts). Bound to 127.0.0.1; reached from elsewhere through `tailscale serve` (docs/design/lens.md).
import { loadGrades } from "./grades";
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
    routes: {
      "/": (req) => client.page(req),
      "/fonts/:file": (req) => client.font(req.params.file) ?? notFound("font"),
      "/api/runs": async (req) => {
        // (A thousand runs' entries are a megabyte; gzipped, a tenth of it: it matters on a phone.)
        const body = JSON.stringify(await lens.list(new URL(req.url).searchParams.has("fresh")));
        const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", vary: "accept-encoding" };
        if ((req.headers.get("accept-encoding") ?? "").includes("gzip")) return new Response(Bun.gzipSync(Buffer.from(body)), { headers: { ...headers, "content-encoding": "gzip" } });
        return new Response(body, { headers });
      },
      "/api/moments": (req) => momentsResponse(lens, req),
      "/api/run/:key": async (req) => {
        const e = await lens.catalogue.find(req.params.key);
        if (!e) return notFound("run");
        const m = lens.manifest(e);
        const grade = loadGrades(lens.paths.runs).get(e.key);
        return json({ ...e, ...(m ? { indexed: true, summary: m.summary, ...(m.reading ? { reading: m.reading } : {}), errors: m.errors } : {}), ...(grade ? { grade } : {}) });
      },
      "/api/run/:key/status": async (req) => {
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
