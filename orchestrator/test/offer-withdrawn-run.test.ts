// An offer its maker has taken back cannot be signed (docs/behaviour/offers.md): end to end on a generated town and the
// real kernel. The maker offers, withdraws; the other person's signature is refused (and not recorded), and what the
// signer is told is in the world's words. The books' reading (participants/test/offer-withdrawal.test.ts) is the
// fallback for logs written before the kernel refused it.

import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { refusalText } from "../../participants/src/llm/words";
import { generate } from "@oikos/worlds/generator/generate";
import { Kernel, kernelBinary } from "../src/kernel";

const root = join(import.meta.dir, "../..");
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("a signature on an offer its maker has withdrawn is refused by the kernel, in the signer's words, and leaves no record", async () => {
  const d = join(root, "runs", "test-offer-withdrawn");
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  const config = generate({ ...spec, citizens: 40, nature: false });
  const k = new Kernel(kernelBinary());
  await k.request({ op: "start", config, run_id: "o", log_path: join(d, "o.jsonl") });
  const people = (config.participants as any[]).filter((x) => x.kind === "person");
  const [maker, taker] = [people[0], people[1]];
  const entity = (p: any) => p.person ?? p.entity ?? p.id.replace(/-self$/, "");
  const [me, you] = [entity(maker), entity(taker)];
  let now = 0;
  const act = async (participant: string, blocks: any[]) => {
    const begun = (await k.request({ op: "command", command: { command: "act", participant, blocks, provenance: { via: "direct" } } })).events as any[];
    const done = begun.find((e) => e.event === "action_started")?.done;
    const rest = done === undefined ? [] : ((await k.request({ op: "command", command: { command: "advance", to: (now = Math.max(now, done)) } })).events as any[]);
    return [...begun, ...rest];
  };
  // (Where the taker commits to be is a place: a building of the town; the kernel refuses one that is not, not_a_place.)
  const site = (config.world.structures as any[])[0].id;
  const terms = { template: "employment", parties: [me, you], commitments: [{ who: you, does: { outcome: { occupancy: { in: site } } } }] };
  const offered = await act(maker.id, [{ block: "propose_agreement", terms, ref: "o" }]);
  const agreement = offered.find((e) => e.event === "action_applied")?.created?.o ?? offered.find((e) => e.event === "recorded")?.record.id;
  expect(agreement).toBeDefined();
  await act(maker.id, [{ block: "sign_agreement", agreement, as: me }]);
  await act(maker.id, [{ block: "withdraw", record: agreement }]);

  const late = await act(taker.id, [{ block: "sign_agreement", agreement, as: you }]);
  const refused = late.find((e) => e.event === "action_refused");
  expect(refused?.code).toBe("offer_withdrawn");
  expect(late.some((e) => e.event === "recorded" && e.record.record === "signature")).toBe(false);
  expect(refusalText("offer_withdrawn")).toContain("taken back");
  expect(refusalText("offer_withdrawn")).not.toMatch(/kernel|record|rec\./i);
}, 120_000);
