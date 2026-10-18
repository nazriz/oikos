// Word of mouth (D44) on a generated town: citizens who start hunting ask the
// people they live and work with, and those people name buildings where they
// can see room. It's all messages between participants; nothing is passed along by
// the platform. The check that matters: nobody tells more than they could
// know, so every building named is one the teller could see around them.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ASKING, View } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("people ask the people they know, and are told only what those people could see", async () => {
  const out = join(root, "runs", "test-word-of-mouth");
  rmSync(out, { recursive: true, force: true });
  // What each citizen could see around them, at each look.
  const seen = new Map<string, { t: number; structures: Set<string>; people: Set<string>; carryingOn: boolean }[]>();
  const config = generate({ ...spec, citizens: 120 });
  // (People who hold no post of the town's: a person of the town who holds several decides over several wakes of their own and acts later, and what they
  // could see "when they decided" is not one look. Foundations F5 made the town's staff such people.)
  const postHolders = new Set(config.positions.map((p: any) => p.holder));
  // (What each could see is rebuilt from the log, where the run records these citizens' observations in full, through the
  // same View a participant keeps: the Rust world's engine decides for them itself, so a test cannot be handed their
  // observations as they are made.)
  const s = await runWorld({
    config, runId: "word-of-mouth", outDir: out, until: 240 * DAY,
    recordObservations: config.participants.filter((p: any) => p.kind === "person").map((p: any) => p.id),
  });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const views = new Map<string, View>();
  for (const e of log) {
    if (e.kind !== "annotation" || e.body.annotation !== "observation" || e.body.data.as) continue; // (a citizen's own sight, not a post's)
    const participant: string = e.body.subject, raw = e.body.data.observation;
    const view = views.get(participant) ?? views.set(participant, new View()).get(participant)!;
    const obs = view.apply({ ...raw, channels: Object.fromEntries(raw.channels.map((c: any) => [c.path, c])) });
    const street = obs.channels.street;
    if (street?.kind !== "sites") continue;
    const buildings = street.cells.flatMap((c) => (c.structure ? [c.structure] : []));
    const people = new Set<string>(buildings.flatMap((x) => x.spaces.flatMap((sp) => sp.occupants ?? [])));
    seen.set(participant, [...(seen.get(participant) ?? []), { t: e.body.data.t, structures: new Set(buildings.map((x) => x.structure)), people, carryingOn: raw.woke_for === "done" }]);
  }
  const said = log.filter((e) => e.kind === "command" && e.body.command === "act" && /^c\d+-self$/.test(e.body.participant))
    .flatMap((e) => e.body.blocks.filter((b: any) => b.block === "message").map((b: any) => ({ t: e.t, participant: e.body.participant, ...b })));
  const asks = said.filter((m) => m.text === ASKING.home || m.text === ASKING.work);
  const tips = said.filter((m) => m.re && !postHolders.has(m.participant));
  expect(asks.length).toBeGreaterThan(5);
  expect(tips.length).toBeGreaterThan(5);

  // What a participant could see when it decided: every look of the wake it decided in (its plan is made when the wake
  // begins, and carried on as its acts are done: acts take time), and the one before.
  const couldSee = (participant: string, t: number) => {
    const looks = (seen.get(participant) ?? []).filter((x) => x.t <= t);
    let from = looks.length - 1;
    while (from > 0 && looks[from]!.carryingOn) from--;
    while (from > 0 && looks[from - 1]!.t === looks[from]!.t) from--;
    return new Set(looks.slice(Math.max(0, from - 1)).flatMap((x) => [...x.structures]));
  };
  // Those asked are people the asker has shared a home or workplace with.
  const everSeen = (participant: string, t: number) => new Set((seen.get(participant) ?? []).filter((x) => x.t <= t).flatMap((x) => [...x.people]));
  for (const a of asks) {
    const known = everSeen(a.participant, a.t);
    for (const who of a.to) expect(known.has(who)).toBe(true);
  }
  // Every building named is one the teller could see around it then.
  for (const tip of tips) expect(couldSee(tip.participant, tip.t).has(tip.re)).toBe(true);
  // And someone followed a tip up: searched the building they were told about.
  const told = new Map(tips.flatMap((m) => m.to.map((to: string) => [to, m.re] as const)));
  const followed = log.filter((e) => e.kind === "command" && e.body.command === "look" && e.body.looks.some((l: any) => l.query?.where?.some((w: any) => ["data.structure", "data.workplace"].includes(w.field) && w.value === (told.get(e.body.participant) ?? told.get(e.body.participant.replace(/-self$/, ""))))));
  expect(followed.length).toBeGreaterThan(0);
}, 300_000);
