// The town of twin-seat-year.test.ts and twin-seat-quiet.test.ts, run with seats beside their people or without, and its acts and
// events as the two are set side by side. (Split out of twin-seat-year.test.ts at the test pruning, 2026-10-24.)

import { expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../../src/run";

export const root = join(import.meta.dir, "../../..");
export const DAY = 86_400;
export const spec = { ...(Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any), shop_mix: false /* the single-goods town: this test holds a mechanism of it (docs/risks.md ME-19) */ };
export const SEATS = ["councillor-4", "land-registrar"];

/** Posts with work whose office is the same office with a seat in it (no clerk, no staff, no standing orders of its own). */
export const BUSY = ["shop-1-manager", "shop-2-manager", "shop-3-manager", "shop-4-manager", "shop-5-manager", "shop-6-manager", "factory-1-manager", "factory-2-manager", "editor",
  "councillor-1", "councillor-2", "councillor-3", "councillor-4", "councillor-5", "builder-foreman", "land-registrar", "electoral", "inspector", "child-protection"];

export async function town(name: string, seats: string[], o: { days?: number; deaths?: number; twin?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `oikos-${name}-`));
  try {
    const config = generate({ ...spec, ...(seats.length ? { model_seats: seats } : {}) });
    // Far more deaths than life (25% a year from 25), so that some of those seated die within the year.
    config.life.other_causes.by_age = [{ from: 0, bps: 0 }, { from: 25, bps: o.deaths ?? 2500 }];
    // (A mock seat that sits as its code twin does: said in its own configuration, as a world says what its seats are.)
    if (o.twin) for (const id of seats) config.participants.find((x: any) => x.id === config.positions.find((p: any) => p.id === id).holder).controller.params.mock.twin = true;
    const held = new Map<string, string>(config.positions.map((p: any) => [p.id, config.participants.find((q: any) => q.id === p.holder)?.person ?? p.holder]));
    const s = await runWorld({ config, runId: name, outDir: dir, until: (o.days ?? 365) * DAY, logDetail: "lean", recordObservations: "none" } as any);
    expect(s.participantErrors).toBe(0);
    return { lines: readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)), held };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Every act (when, by whom, doing what), in order, and every event of the world (but observations and the seats' own coming and going) in each moment, with the seats' names those of their people. */
export function stream(r: Awaited<ReturnType<typeof town>>, seats: string[]) {
  const names = new Map<string, string>(seats.map((id) => [`${id}-system`, `${r.held.get(id)!}-self`]));
  const plain = (x: string) => { let y = x.replace(/rec\.[0-9]+/g, "rec").replace(/act\.[0-9]+/g, "act"); for (const [a, b] of names) y = y.split(a).join(b); return y; };
  const acts = r.lines.filter((l) => l.kind === "command" && l.body.command === "act").map((l) => plain(`${l.t}|${l.body.participant}|${JSON.stringify(l.body.blocks)}`));
  // (A letter's recipients are listed in the order of their ids, which a seat's name changes: they are the same people.)
  const body = (b: any) => (b.event === "message_delivered" ? { ...b, to: b.to.map(plain).sort() } : b);
  const events = r.lines.filter((l) => l.kind === "event" && l.body.event !== "observation" && !(l.body.event === "participant_ended" && names.has(l.body.participant)))
    .map((l) => ({ t: l.t as number, s: plain(`${l.t}|${JSON.stringify({ ...body(l.body), cause: undefined })}`) })).sort((x, y) => x.t - y.t || (x.s < y.s ? -1 : 1)).map((x) => x.s);
  return { acts, events };
}
