// A small log written by hand in the kernel's shape, for the index and trace tests: two people, a tribunal whose member
// is a model seat, a bank's payment system. A person applies to the tribunal citing a law made before the run; the seat
// orders against them and money moves; the other person moves to work, sets up a standing payment that the bank's
// system carries out, after a recorded decision.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DAY = 86_400;

export function fixtureLines(): string[] {
  const header = {
    run_id: "fixture.seed1",
    config: {
      meta: { name: "Testville", description: "a fixture" }, seed: 1,
      catalogue: { structure_types: [
        { id: "house", category: "residential", footprint: { w: 1, h: 1 }, spaces: [{ kind: "dwelling", count: 1 }] },
        { id: "civic", category: "civic", footprint: { w: 1, h: 1 }, spaces: [{ kind: "workplace", count: 1 }] },
      ] },
      participants: [
        { id: "c1-self", kind: "person", controller: { type: "code", impl: "citizen.default" } },
        { id: "c2-self", kind: "person", controller: { type: "code", impl: "citizen.default" } },
        { id: "member-system", kind: "person", controller: { type: "llm", provider: "mock", model: "mock" } },
        { id: "bank-payments-system", kind: "system", controller: { type: "code", impl: "bank.payment_system" } },
      ],
      positions: [{ id: "member", entity: "tribunal", holder: "member-system", title: "Tribunal member" }, { id: "bank-payments", entity: "bank", holder: "bank-payments-system" }],
      world: {
        ground: { w: 10, h: 10, terrain: [{ x: 0, y: 0, w: 10, h: 10, label: "grassland" }] },
        currencies: [{ code: "XTS", symbol: "¤", minor_units: 2 }],
        entities: [
          { id: "c1", kind: "person", born_at: -30 * 365 * DAY, sex: "female" }, { id: "c2", kind: "person", born_at: -40 * 365 * DAY, sex: "male" },
          { id: "tribunal", kind: "tribunal", name: "The Tribunal" }, { id: "bank", kind: "bank", name: "The Bank" },
        ],
        structures: [{ id: "house-1", type: "house", at: "cell.1.1" }, { id: "house-2", type: "house", at: "cell.3.1" }, { id: "hall", type: "civic", at: "cell.5.5" }],
        accounts: [{ id: "acc-c1", holder: "c1", balance: "10000" }, { id: "acc-c2", holder: "c2", balance: "5000" }],
        occupancy: [{ occupant: "c1", space: "house-1/dwelling.1" }, { occupant: "c2", space: "house-2/dwelling.1" }],
        records: [
          { id: "law-1", kind: "law", record: "statement", author: "genesis", speaks_for: "tribunal", text: "Apply in writing.", visible_to: "public" },
          { id: "job-c2", record: "agreement", author: "genesis", terms: { template: "employment", parties: ["tribunal", "c2"], commitments: [{ who: "c2", does: { outcome: { occupancy: { in: "hall/workplace.1", who: "c2" } } } }] } },
          { id: "household-c1", kind: "household", record: "statement", author: "genesis", speaks_for: "c1", data: { members: [{ person: "c1" }] } },
          { id: "lot-01-01", kind: "lot", record: "statement", author: "genesis", data: { cells: ["cell.1.1"] } },
          { id: "title-lot-01-01", record: "claim", position: "right", holder: "c1", about: { kind: "ownership", object: "lot-01-01" } },
        ],
      },
    },
  };
  let seq = 0;
  const out: string[] = [];
  const line = (kind: string, t: number, body: any) => { const s = seq++; out.push(JSON.stringify({ body, hash: `h${s}`.padEnd(64, "0"), kind, prev: `p${s}`, seq: s, t })); return s; };
  line("header", 0, header);
  // c1 applies (an act), applied in the next advance, which records the application.
  const a1 = line("command", 0, { blocks: [{ block: "publish", kind: "tribunal_application", addressed_to: ["tribunal"], basis: "law-1", text: "Please hear me." }], command: "act", participant: "c1-self" });
  line("event", 0, { action: "act.1", cause: a1, done: 600, event: "action_started", participant: "c1-self", starts: 0 });
  line("command", 0, { command: "observe", participant: "c1-self" });
  const adv1 = line("command", 600, { command: "advance_to_news", until: 600 });
  line("event", 600, { action: "act.1", by: ["c1-self"], cause: adv1, event: "action_applied", participant: "c1-self" });
  line("event", 600, { cause: adv1, event: "recorded", record: { addressed_to: ["tribunal"], author: "c1-self", basis: "law-1", id: "rec.1", kind: "tribunal_application", record: "statement", speaks_for: "c1", text: "Please hear me." } });
  // day 1: c2 goes to work.
  const mv = line("command", DAY + 3600, { blocks: [{ block: "occupy", space: "hall/workplace.1" }], command: "act", participant: "c2-self" });
  line("event", DAY + 3600, { by: "c2-self", cause: mv, event: "vacated", occupant: "c2", reason: "left", space: "house-2/dwelling.1" });
  line("event", DAY + 3600, { by: "c2-self", cause: mv, event: "occupied", occupant: "c2", space: "hall/workplace.1" });
  // the seat orders, through the translator; money moves under the same act.
  const a2 = line("command", DAY + 7200, { as: "member", blocks: [{ addressed_to: ["c1"], basis: "rec.1", block: "publish", data: { granted: false, reason: "no particulars" }, kind: "tribunal_order", text: "Dismissed." }, { amount: "500", block: "transfer", from: "acc-c1", to: "acc-c2" }], command: "act", participant: "member-system", provenance: { draft: "draft.member-system.1", via: "translator" } });
  line("event", DAY + 7200, { action: "act.2", as: "member", cause: a2, done: 60, event: "action_started", participant: "member-system", starts: DAY + 7200 });
  const adv2 = line("command", DAY + 7260, { command: "advance_to_news" });
  line("event", DAY + 7260, { action: "act.2", as: "member", by: ["member-system"], cause: adv2, event: "action_applied", participant: "member-system" });
  line("event", DAY + 7260, { cause: adv2, event: "recorded", record: { addressed_to: ["c1"], author: "member-system", basis: "rec.1", data: { granted: false, reason: "no particulars" }, id: "rec.2", in_position: "member", kind: "tribunal_order", record: "statement", speaks_for: "tribunal", text: "Dismissed." } });
  line("event", DAY + 7260, { amount: "500", by: "member-system", cause: adv2, currency: "XTS", event: "transfer", from: "acc-c1", reason: "payment", to: "acc-c2" });
  // c2 decides, then sets up a standing payment; the bank's system pays it.
  line("annotation", DAY + 9000, { annotation: "decision", data: { choice: "pay", domain: "money", options: [{ key: "pay", score: 7000 }, { key: "keep", score: 3000 }] }, subject: "c2-self" });
  const a3 = line("command", DAY + 9000, { blocks: [{ addressed_to: ["bank"], block: "publish", data: { every: DAY }, kind: "request", text: "Pay c1 3.00 a day." }], command: "act", participant: "c2-self" });
  line("event", DAY + 9000, { action: "act.3", cause: a3, done: 300, event: "action_started", participant: "c2-self", starts: DAY + 9000 });
  const adv3 = line("command", DAY + 9300, { command: "advance_to_news" });
  line("event", DAY + 9300, { action: "act.3", by: ["c2-self"], cause: adv3, event: "action_applied", participant: "c2-self" });
  line("event", DAY + 9300, { cause: adv3, event: "recorded", record: { addressed_to: ["bank"], author: "c2-self", id: "rec.3", kind: "request", record: "statement", speaks_for: "c2", text: "Pay c1 3.00 a day." } });
  const a4 = line("command", DAY + 20000, { as: "bank-payments", blocks: [{ amount: "300", block: "transfer", from: "acc-c2", per_instruction: "rec.3", to: "acc-c1" }], command: "act", participant: "bank-payments-system" });
  line("event", DAY + 20000, { action: "act.4", cause: a4, done: 1, event: "action_started", participant: "bank-payments-system", starts: DAY + 20000 });
  const adv4 = line("command", DAY + 20001, { command: "advance_to_news" });
  line("event", DAY + 20001, { action: "act.4", by: ["bank-payments-system"], cause: adv4, event: "action_applied", participant: "bank-payments-system" });
  line("event", DAY + 20001, { amount: "300", by: "bank-payments-system", cause: adv4, currency: "XTS", event: "transfer", from: "acc-c2", per_instruction: "rec.3", reason: "payment", to: "acc-c1" });
  // c1's own record changes; a debrief that must never be read.
  line("command", DAY + 30000, { command: "entity_record", participant: "c1-self", set: { agency: { now: 4100, own: 4100 } } });
  line("annotation", DAY + 30001, { annotation: "debrief", data: { steps: [{ answer: "SECRET-DEBRIEF" }] }, subject: "member-system" });
  // day 2: c2 home again; the run ends.
  const mv2 = line("command", 2 * DAY + 1000, { blocks: [{ block: "occupy", space: "house-2/dwelling.1" }], command: "act", participant: "c2-self" });
  line("event", 2 * DAY + 1000, { by: "c2-self", cause: mv2, event: "vacated", occupant: "c2", reason: "left", space: "hall/workplace.1" });
  line("event", 2 * DAY + 1000, { by: "c2-self", cause: mv2, event: "occupied", occupant: "c2", space: "house-2/dwelling.1" });
  line("end", 3 * DAY, { reason: "completed" });
  return out;
}

/** Writes the fixture as a run folder (`<dir>/fixture.seed1.jsonl`) and returns the log's path. */
export function writeFixtureRun(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "fixture.seed1.jsonl");
  writeFileSync(log, fixtureLines().join("\n") + "\n");
  return log;
}
