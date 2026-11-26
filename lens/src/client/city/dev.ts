#!/usr/bin/env bun
// The city alone, for working on the map before (and beside) the full Lens server:
//   bun lens/src/client/city/dev.ts [bundle dir] [--port 4329]
// Serves dev.html (the CityView with a small clock bar) and the bundle files the folds wrote
// (bundle.ts: town.json, people.json, people.<col>.bin) at the API paths the real server uses:
// /api/run/<key>/town, /api/run/<key>/people, /api/run/<key>/people/<col>. Any <key> reads the one bundle.
// Query string: ?day=121&hour=21.5 (the moment), &play=1, &zoom=2&tilt=55&turn=-30, &sel=structure:town-hall.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import page from "./dev.html";

const args = process.argv.slice(2);
const portAt = args.indexOf("--port");
const port = portAt >= 0 ? +args[portAt + 1]! : 4329;
const dir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port") ?? join(homedir(), "oikos/runs/views/lens-dev/bundle");
if (!existsSync(join(dir, "town.json"))) { console.log(`no bundle at ${dir} (make one: bun lens/src/client/city/bundle.ts <log.jsonl> ${dir})`); process.exit(2); }

const file = (p: string, type: string) => existsSync(p) ? new Response(Bun.file(p), { headers: { "content-type": type, "cache-control": "no-cache" } }) : new Response("not found", { status: 404 });

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  development: process.env.DEV === "1",
  routes: {
    "/": page,
    "/api/run/:key/:fold": (req) => file(join(dir, `${req.params.fold}.json`), "application/json"),
    "/api/run/:key/:fold/:file": (req) => file(join(dir, `${req.params.fold}.${req.params.file}.bin`), "application/octet-stream"),
  },
});
console.log(`city dev: ${server.url} (bundle ${dir})`);
