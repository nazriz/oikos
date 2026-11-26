// /api/moments: every indexed fork's lever moments, for the Moments gallery (lens/src/client/story/Moments.tsx), so the
// page reads one answer rather than every run's seat.json. Each bundle is read once and its moments kept in memory by
// the bundle's path (a changed log makes a new bundle under a new path, so a path seen before is still current).
// Read-only: it reads bundles Lens made, never a run's folder.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { SeatJson } from "../folds/seat";
import { momentsOf, type MomentsResponse } from "../client/story/moments-data";
import type { Lens } from "./service";

const cache = new Map<string, MomentsResponse["runs"][number] | null>();

function readSeat(dir: string): SeatJson | null {
  const f = join(dir, "seat.json");
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  if (existsSync(`${f}.gz`)) return JSON.parse(gunzipSync(readFileSync(`${f}.gz`)).toString("utf8"));
  return null;
}

export async function momentsResponse(lens: Lens, req: Request): Promise<Response> {
  const c = await lens.list();
  const forks = c.runs.filter((r) => r.kind === "fork" && r.experiment && !r.experiment.isCode);
  const runs: MomentsResponse["runs"] = [];
  let indexed = 0;
  for (const e of forks) {
    if (!lens.manifest(e)) continue;
    indexed++;
    const dir = lens.bundlePath(e);
    if (!cache.has(dir)) {
      try {
        const seat = readSeat(dir);
        cache.set(dir, seat ? { key: e.key, group: e.group, id: `${seat.run_id}|${seat.arm}`, moments: momentsOf(e.key, seat, true) } : null);
      } catch { cache.set(dir, null); }
    }
    const x = cache.get(dir);
    if (x && x.moments.length) runs.push(x);
  }
  const body: MomentsResponse = { runs, indexed, forks: forks.length };
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", vary: "accept-encoding" };
  const text = JSON.stringify(body);
  if ((req.headers.get("accept-encoding") ?? "").includes("gzip")) return new Response(Bun.gzipSync(Buffer.from(text)), { headers: { ...headers, "content-encoding": "gzip" } });
  return new Response(text, { headers });
}
