// A business does not stop when its owner leaves town (bug hunt 2026-10-17, the coordinator's ruling): the owner keeps the firm and fills a
// vacant post of it, wherever they live. Here the holder of a letting office leaves the world; the office's post falls vacant and is filled again
// within a few weeks, by the firm's owner (whose own post is held abroad), and the office goes on to act.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls as C, modules as builtin, type BehaviourModule } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { onRust } from "./lib/doubles";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("the holder of a letting office leaves town: the owner fills the vacant post, and the office carries on", async () => {
  const config = generate({ ...spec, citizens: 150 }) as any;
  const post = config.positions.find((p: any) => /^landlord-\d+-office$/.test(p.id) && config.participants.find((q: any) => q.id === p.holder)?.kind === "person" && config.positions.some((o: any) => o.id === `${p.entity}-owners`));
  expect(post, "a letting office held by a person, with an owner's post").toBeDefined();
  const firm = post.entity as string;
  const owners = config.positions.find((p: any) => p.id === `${firm}-owners`);
  expect(owners.holds_abroad).toBe(true);
  const leaver = config.participants.find((q: any) => q.id === post.holder);
  const inner = leaver.controller.impl as string;
  const leaving: BehaviourModule = {
    ...builtin[inner]!,
    name: "test.leaving",
    create(ctx) {
      const m = builtin[inner]!.create(ctx);
      let gone = false;
      return Object.assign(Object.create(m), {
        step(obs: any, x: any) {
          if (!gone && obs.t >= 10 * DAY && ctx.participant === post.holder) { gone = true; return { type: "call" as const, call: C.program(C.call("presence", { leave: "yes" })) }; }
          return m.step(obs, x);
        },
      });
    },
  };
  // (On the Rust world the same-named kind wraps the real one and sends the same call on the tenth day: testkinds.rs.)
  leaver.controller = onRust
    ? { ...leaver.controller, impl: "test.leaving", params: { ...(leaver.controller.params ?? {}), inner, calls: [{ at: 10 * DAY, call: C.program(C.call("presence", { leave: "yes" })) }] } }
    : { ...leaver.controller, impl: "test.leaving" };
  const dir = mkdtempSync(join(tmpdir(), "oikos-owner-"));
  try {
    const s = await runWorld({ config, runId: "owner", outDir: dir, until: 90 * DAY, logDetail: "lean", recordObservations: "none", modules: onRust ? {} : { "test.leaving": leaving } } as any);
    const ev: any[] = readFileSync(s.logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const left = ev.find((e) => e.body?.event === "person_left" && `${e.body.person}-self` === post.holder);
    expect(left, "the holder left").toBeDefined();
    const vacated = ev.find((e) => e.body?.event === "appointed" && e.body.position === post.id && !e.body.holder && e.t >= left.t);
    expect(vacated, "the post fell vacant").toBeDefined();
    const filled = ev.find((e) => e.body?.event === "appointed" && e.body.position === post.id && e.body.holder && e.t > vacated.t);
    expect(filled, "and was filled again").toBeDefined();
    expect((filled.t - vacated.t) / DAY).toBeLessThan(45);
    // The owner's post stayed theirs.
    expect(ev.some((e) => e.body?.event === "appointed" && e.body.position === `${firm}-owners` && !e.body.holder)).toBe(false);
    // And the office goes on: its new holder acts for the firm.
    const after = ev.filter((e) => e.body?.event === "recorded" && e.t > filled.t && e.body.record?.in_position === post.id);
    expect(after.length).toBeGreaterThan(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 600_000);
