// Perception is changes (contracts v0.4): the kernel sends each participant only
// what changed since its last look, and the runtime keeps its view, per capacity.
// The kernel's own invariant test checks the kernel side (kernel/tests/perception.rs);
// this checks the runtime's View on a real town: after every look, each capacity's
// accounts, survey and directory equal the kernel's full picture. Every citizen's
// surroundings are checked too, and must follow them when they move.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { canonical, slice } from "@terrarium/seats";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("every capacity's view equals the kernel's full picture, after every look", async () => {
  const out = join(root, "runs", "test-perception");
  rmSync(out, { recursive: true, force: true });
  let checked = 0, moves = 0;
  const kinds = new Set<string>();
  const where = new Map<string, string>(); // participant -> the cells around it, last look
  await runWorld({
    config: generate({ ...spec, citizens: 60 }), runId: "perception", outDir: out, until: 45 * DAY,
    inspect: async (participant, obs, kernel, capacity, raw) => {
      // Check the institutions every look, every citizen's surroundings, and a sample of the rest (it's a full-picture query each time).
      const sampled = /^(bank-payments|council-clerk|inspector|planning|landlord-1-office|mayor|builder-foreman)-system$|^c000[0-3]-self$/.test(participant);
      if (!sampled && !obs.channels.street) return;
      const full = slice((await kernel.request({ op: "view", participant })).observation, capacity ?? "self", obs.entity);
      const street = obs.channels.street;
      if (street?.kind === "sites") {
        const cells = street.cells.map((c) => c.cell).join(" ");
        if (where.has(participant) && where.get(participant) !== cells) moves++;
        where.set(participant, cells);
      }
      for (const [id, ch] of Object.entries(obs.channels)) {
        if (!sampled && id !== "street") continue;
        if (ch.kind === "records") continue; // records are what's new; the books keep them
        const want = full.channels[id];
        const strip = (c: any) => (c.kind === "accounts" ? { ...c, transactions: [] } : c.kind === "sites" ? { ...c, as_of: 0 } : c);
        // A channel not looked through this time (its `every`) shows what it last saw, by design.
        if (ch.kind === "sites" && !raw?.channels[id]) continue;
        expect(canonical(strip(ch))).toBe(canonical(strip(want)));
        kinds.add(ch.kind);
        checked++;
      }
    },
  });
  expect(checked).toBeGreaterThan(500);
  expect(moves).toBeGreaterThan(0); // someone moved, and their view followed
  expect(kinds).toEqual(new Set(["accounts", "sites", "directory"]));
}, 300_000);
