// The preview leaves nothing out: change any field of any kind of act, and what the participant reads before
// confirming changes too. (The 2026-10-05 audit: a statement's `adico` and `formal`, the parts that give a law its
// force, were never shown; nor a payment's invoice, a vote's capacity, a new post's channels.)

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "../eval/run";
import { Preview } from "../src/index";

const schema = JSON.parse(readFileSync(join(import.meta.dir, "../../contracts/blocks.schema.json"), "utf8"));
/** Every kind of act in the contract, with the fields it can carry. */
const KINDS = new Map<string, string[]>(Object.values(schema.$defs as Record<string, any>).filter((d) => d.properties?.block?.const).map((d) => [d.properties.block.const, Object.keys(d.properties).filter((k) => k !== "block")]));

const commitments = [
  { who: "city", does: { outcome: { money: { from: "acc-city", to: "acc-builder", amount: "50000", for: "the works", settles: "rec.9" } } }, every: 2_592_000 },
  { who: "builder", does: { outcome: { goods: { kind: "gravel", quantity: "40", to: "city", at: "str.7", from: "str.8" } } }, every: 604_800 },
  { who: "city", does: { outcome: { occupancy: { who: "c0042", in: "apts-3/dwelling.2" } } } },
  { who: "c0042", does: { outcome: { occupancy: { who: "c0042", in: "apts-3/dwelling.2", leave: true } } } },
  { who: "builder", does: { outcome: { structure: { type: "park", on: "lot-00" } } } },
  { who: "builder", does: { outcome: { structure: { remove: "str.4" } } } },
  { who: "bank", does: { outcome: { account: { holder: "city" } } } },
  { who: "bank", does: { outcome: { account: { close: "acc-old" } } } },
  { who: "c0042", does: { outcome: { work: { task: "build", at: "str.2", hours: 8, units: 7200 } } }, every: 86_400 },
  { who: "c0042", does: { outcome: { attend: { practice: "rec.50", role: "member" } } } },
  { who: "greenco", does: { text: "keep the grass cut" }, every: 1_209_600 },
];

/** One act of each kind, with every field it can carry (several where an act reads differently by what it holds). */
const SAMPLES: any[] = [
  { block: "transfer", from: "acc-city", to: "acc-builder", amount: "50000", settles: "rec.88", per_instruction: "rec.89", memo: "the works", line: "parks" },
  { block: "open_account", holder: "c0042", currency: "local", ref: "a" },
  { block: "close_account", account: "acc-old" },
  { block: "construct", at: "cell.3.4", structure_type: "park", materials_at: "str.2", ref: "s" },
  { block: "demolish", structure: "str.9" },
  { block: "occupy", space: "apts-3/dwelling.2", who: "c0042" },
  { block: "vacate", occupant: "c0042", from: "apts-3/dwelling.2" },
  { block: "create_entity", kind: "trust", name: "River Land Trust", speaks_for: "greenco", visible_to: ["city", "bank"], ref: "t",
    first_position: { title: "Trustee", role: "trustee", channels: [{ id: "books", kind: "accounts" }], role_module: { module: "x.y", params: { a: 1 } }, ref: "p" } },
  { block: "record_claim", position: "liberty", holder: "c0042", counterparty: "builder", about: { action: "build", object: "lot-00" }, basis: "rec.3", speaks_for: "greenco", visible_to: "public", ref: "c" },
  { block: "transfer_claim", claim: "rec.4", to: "builder", basis: "rec.3", speaks_for: "greenco", visible_to: ["city"], ref: "c" },
  { block: "release_claim", claim: "rec.4", basis: "rec.3", speaks_for: "greenco", visible_to: ["city"], ref: "c" },
  { block: "propose_agreement", basis: "rec.412", speaks_for: "greenco", visible_to: ["city", "builder"], ref: "g",
    terms: { template: "lease", parties: ["city", "builder", "c0042"], commitments, term: 31_536_000, then: "periodic", termination: [{ party: "city", notice: 5_184_000 }, { party: "builder", notice: 2_592_000 }], text: "As written here.", attrs: { bedrooms: 2 } } },
  { block: "sign_agreement", agreement: "rec.501", as: "greenco", ref: "x" },
  { block: "give_notice", agreement: "rec.600", as: "greenco", text: "We end it here.", ref: "n" },
  // A law: its words, its rule (the Institutional Grammar breakdown) and the condition acts are checked against.
  { block: "publish", kind: "law", text: "No rent rise without ninety days' notice.", data: { topic: "tenancy", figures: { days: 90 } },
    adico: { attribute: "landlords", deontic: "must_not", aim: "raise a rent", condition: "with less than 90 days' notice", or_else: "the rise is invalid" },
    formal: { language: "cel", condition: "block.kind == 'rent_increase' && block.data.from - now < 7776000" },
    basis: "rec.7", addressed_to: ["builder", "greenco"], place: "cell.1.1", speaks_for: "greenco", visible_to: "public", ref: "l",
    offer: { by: "city", to: { anyone: true }, take_up: "apply", terms: { commitments: [{ who: "city", does: { text: "consider it" } }] } },
    practice: { at: "str.5", every: 604_800, first: 86_400, lasts: 3600, roles: [{ role: "member" }] },
    registry: { entity: "greenco", event: "registered" }, assertion: { that: "the river is rising", about: ["lot-00"] } },
  // Asking someone else to bring something about.
  { block: "publish", kind: "request", text: "Please pay $500.00 from acc-city to acc-builder.", data: { outcome: { money: { from: "acc-city", to: "acc-builder", amount: "50000", for: "the works", settles: "rec.88" } }, every: 2_592_000, first: 86_400, per_request: "rec.5" },
    basis: "rec.7", addressed_to: ["bank", "greenco"], speaks_for: "greenco", visible_to: ["city", "bank"], ref: "r" },
  { block: "withdraw", record: "rec.19", text: "Out of date.", basis: "rec.7", speaks_for: "greenco", visible_to: ["city"], ref: "w" },
  { block: "vote", ballot: "rec.31", choice: "no", speaks_for: "greenco", visible_to: ["city"] },
  { block: "message", to: ["builder", "greenco"], text: "Tuesday at ten.", re: "rec.77" },
  { block: "arrive", name: "Ana Silva", born_at: -978_307_200, template: "newcomer", carrying: "240000", ref: "n", sex: "female", variables: { schooling: 12 } },
  { block: "arrive", person: "c0042" },
  { block: "leave", person: "c0042", to: "outside" },
  { block: "birth", name: "Sam", template: "newborn", with: "c0042" },
  { block: "harm", person: "c0042" },
  { block: "create_position", title: "Clerk", role: "clerk", channels: [{ id: "books", kind: "accounts" }], role_module: { module: "x.y", params: { a: 1 } }, ref: "p" },
  { block: "appoint", position: "planning", participant: "c0042-self" },
  { block: "deploy", template: "assistant", to: "greenco", title: "Front desk", ref: "d" },
  { block: "retire", participant: "works-system" },
  { block: "move_goods", kind: "gravel", quantity: "40", from_at: "str.7", to: "builder", to_at: "str.8" },
  { block: "work", task: "build", units: 7200, at: "str.2", performers: ["c0042", "builder"], on: "str.5", survey: { of: "glider", cells: ["cell.1.1", "cell.1.2"] }, investigate: { from: "greenco", at: "str.7", kind: "gravel" } },
  { block: "take", kind: "gravel", quantity: "40", from: "greenco", at: "str.7" },
];

/** Every leaf of a value, as a path. */
function leaves(v: any, path: (string | number)[] = []): (string | number)[][] {
  if (v === null || typeof v !== "object") return [path];
  return Object.entries(v).flatMap(([k, x]) => leaves(x, [...path, Array.isArray(v) ? Number(k) : k]));
}
/** The act with one leaf changed. */
function changed(b: any, path: (string | number)[]): any {
  const out = structuredClone(b);
  let at = out;
  for (const k of path.slice(0, -1)) at = at[k];
  const last = path.at(-1)!;
  const v = at[last];
  // (An amount or a quantity is a whole number written out: another digit keeps it one.)
  at[last] = typeof v === "number" ? v + 1 : typeof v === "boolean" ? !v : /^-?\d+$/.test(v) ? `${v}1` : `${v}x`;
  return out;
}

test("every kind of act in the contract has a sample here, carrying every field it can", () => {
  for (const [kind, fields] of KINDS) {
    const samples = SAMPLES.filter((s) => s.block === kind);
    expect(samples.length, `no sample for ${kind}`).toBeGreaterThan(0);
    const carried = new Set(samples.flatMap((s) => Object.keys(s)));
    expect(fields.filter((f) => !carried.has(f)), `${kind}: fields no sample carries`).toEqual([]);
  }
  expect(SAMPLES.filter((s) => !KINDS.has(s.block)).map((s) => s.block)).toEqual([]);
});

test("changing any field of any act changes its preview", () => {
  const k = fixture();
  const preview = new Preview(k, k.actingFor("mayor"));
  const hidden: string[] = [];
  for (const b of SAMPLES) {
    const before = preview.of([b]);
    expect(before).not.toContain("undefined");
    for (const path of leaves(b)) {
      // (The kind of act is the sentence itself; `ref` is a name within the act, for its own later lines.)
      if (path[0] === "block" || path.at(-1) === "ref") continue;
      if (preview.of([changed(b, path)]) === before) hidden.push(`${b.block}${b.kind ? `(${b.kind})` : ""}: ${path.join(".")}`);
    }
  }
  expect(hidden).toEqual([]);
});

test("a law's rule and the condition it's checked by are shown; an offer signed for someone else isn't folded away", () => {
  const k = fixture();
  const preview = new Preview(k, k.actingFor("mayor"));
  const law = preview.of([SAMPLES.find((s) => s.kind === "law")]);
  expect(law).toContain("Its rule, as recorded: landlords must not raise a rent, with less than 90 days' notice; or else: the rise is invalid.");
  expect(law).toContain("The condition acts are checked against, as written: block.kind == 'rent_increase' && block.data.from - now < 7776000.");
  // A law in words only says nothing of a rule: what isn't there isn't shown.
  expect(preview.of([{ block: "publish", kind: "law", text: "Be kind." } as any])).toBe('This does one thing: a law.\n1. You will publish a law: "Be kind.".\n   - Words only: no rule is recorded with it for acts to be checked against.');
  const offer = { block: "propose_agreement", ref: "g", terms: { parties: ["city", "builder"], commitments: [{ who: "builder", does: { text: "mow" } }] } } as any;
  expect(preview.of([offer, { block: "sign_agreement", agreement: "$g", as: "city" } as any])).toContain("and sign it on your side");
  expect(preview.of([offer, { block: "sign_agreement", agreement: "$g", as: "builder" } as any])).toContain("2. You will sign agreement $g for Millbrook Builders (builder).");
});
