#!/usr/bin/env bun
// The 3D town alone, for working on it beside the full Lens server:
//   bun lens/src/client/world/dev.ts [bundle dir] [--port 4331]
// Serves dev.html (the WorldView with a small clock bar) and the bundle's fold files at the API paths the real server
// uses (/api/run/<key>/<fold>, /api/run/<key>/<fold>/<file>). Any <key> reads the one bundle. Query string:
// ?day=121&hour=17.5 (the moment), &play=1, &speed=600, &view=x,y,z,dist,tilt,turn, &sel=person:c0001, &mode=walk.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import page from "./dev.html";

const args = process.argv.slice(2);
const portAt = args.indexOf("--port");
const port = portAt >= 0 ? +args[portAt + 1]! : 4331;
const dir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port") ?? join(homedir(), "oikos/runs/views/lens-dev/world-bundle");
if (!existsSync(join(dir, "town.json"))) { console.log(`no bundle at ${dir}`); process.exit(2); }
const file = (p: string, type: string) => existsSync(p) ? new Response(Bun.file(p), { headers: { "content-type": type, "cache-control": "no-cache" } }) : new Response("not found", { status: 404 });
const server = Bun.serve({
  port, hostname: "127.0.0.1", development: process.env.DEV === "1",
  routes: {
    "/": page,
    "/api/run/:key/:fold": (req) => file(join(dir, `${req.params.fold}.json`), "application/json"),
    "/api/run/:key/:fold/:file": (req) => file(join(dir, `${req.params.fold}.${req.params.file}.bin`), "application/octet-stream"),
  },
});
console.log(`world dev: ${server.url} (bundle ${dir})`);
