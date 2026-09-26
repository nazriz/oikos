// Perception is changes (contracts v0.3): the kernel sends each seat only what
// changed since its last look, and the seat runtime keeps the seat's view. The
// kernel's own invariant test checks the kernel side (kernel/tests/perception.rs);
// this checks the runtime's View on a real town: after every look, each seat's
// accounts, survey and directory equal the kernel's full picture.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { canonical } from "@terrarium/seats";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("every seat's view equals the kernel's full picture, after every look", async () => {
  const out = join(root, "runs", "test-perception");
  rmSync(out, { recursive: true, force: true });
  let checked = 0;
  const kinds = new Set<string>();
  await runWorld({
    config: generate({ ...spec, citizens: 60 }), runId: "perception", outDir: out, until: 45 * DAY,
    inspect: async (seat, obs, kernel) => {
      // Check the institutions every look, and a sample of the rest (it's a full-picture query each time).
      if (!/^(bank-payments|council-clerk|inspector|planning|landlord-1-office|mayor|c000[0-3]-seat)$/.test(seat)) return;
      const full = (await kernel.request({ op: "view", seat })).observation;
      for (const [id, ch] of Object.entries(obs.channels)) {
        if (ch.kind === "records") continue; // records are what's new; the books keep them
        const want = full.channels[id];
        const strip = (c: any) => (c.kind === "accounts" ? { ...c, transactions: [] } : c.kind === "sites" ? { ...c, as_of: 0 } : c);
        // A channel not looked through this time (its `every`) shows what the seat last saw, by design.
        if (ch.kind === "sites" && (ch as any).as_of !== obs.t) continue;
        expect(canonical(strip(ch))).toBe(canonical(strip(want)));
        kinds.add(ch.kind);
        checked++;
      }
    },
  });
  expect(checked).toBeGreaterThan(500);
  expect(kinds).toEqual(new Set(["accounts", "sites", "directory"]));
}, 300_000);
