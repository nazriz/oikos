// Payments (wave 2b, 2026-10-09): the request a keeper's payment carries out is a record or nothing; a payment that
// cites an agreement is set against what the agreement has paid; and an amount that has to be worked out is never
// asked for twice. This repository's resolver on the table both resolvers are held to (contracts/test/payments.json;
// the engine's reads the same file in kernel/crates/resolver/src/resolve.rs).

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calls, canonical } from "@oikos/participants";
import { MockAdapter } from "@oikos/participants/llm";
import TABLE from "../../contracts/test/payments.json";
import { createTranslator, LABEL_TEXT, NOT_PUT } from "../src/index";
import { Knowledge } from "../src/knowledge";
import { Preview } from "../src/preview";
import { PER_REQUEST_IS_THE_KEEPERS, resolve } from "../src/resolver";

interface Case { name: string; seat: "finance" | "teller"; as: string; program: string; blocks?: unknown[]; asks?: string[] }
const CASES = TABLE.cases as Case[];
const seat = (which: "finance" | "teller", cur: any = TABLE.currency) => { const k = new Knowledge(cur); k.absorb(TABLE.seats[which] as any); return k; };

test("every case of the shared table: the acts, or the questions back", () => {
  for (const s of Object.values(TABLE.seats)) expect(JSON.stringify(s)).toBe(canonical(s));
  expect(CASES.length).toBeGreaterThanOrEqual(9);
  for (const c of CASES) {
    const r = resolve(calls.parseProgram(c.program), seat(c.seat), () => undefined, c.as);
    expect({ name: c.name, ...(r.ok ? { blocks: r.blocks } : { asks: r.questions }) } as any).toEqual({ name: c.name, ...(c.blocks ? { blocks: c.blocks } : { asks: c.asks }) });
  }
});

test("every act in the table is one the contract accepts", () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  const schemas = ["blocks", "common", "records", "world-config", "participant-api", "log", "calls", "outcomes", "dataset", "module"].map((f) => JSON.parse(readFileSync(join(import.meta.dir, `../../contracts/${f}.schema.json`), "utf8")));
  for (const s of schemas) ajv.addSchema(s);
  const valid = ajv.getSchema(`${schemas[0].$id}#/$defs/Block`)!;
  for (const c of CASES) for (const b of c.blocks ?? []) expect({ name: c.name, errors: valid(b) ? null : valid.errors }).toEqual({ name: c.name, errors: null });
});

test("what stood in per_request in the wave's four payments is refused, each of them, and a request to the keeper never carries one", () => {
  const k = seat("finance");
  const asks = (program: string) => { const r = resolve(calls.parseProgram(program), k, () => undefined, "finance"); return r.ok ? r.blocks : r.questions; };
  for (const written of ['"report"', '"worker-by-worker report"', '"the bank"', '{"c0003":2,"c0004":1,"c0005":2}'])
    expect(asks(`money(amount="XYZ 280.00", basis=rec.9, for="8 pays withheld", from=acc-city, per_request=${written}, to=acc-c0003)`)).toEqual(["per_request should name a record by its id."]);
  expect(asks('money(amount="XYZ 1080.81", from=acc-city, per_request=job-c0009-wages, to=acc-c0003)')).toEqual([PER_REQUEST_IS_THE_KEEPERS]);
});

// --- the preview: a payment against the agreement it cites

const agreement = (id: string, o: { amount?: string; every?: number; to?: string; template?: string } = {}) => ({ id, record: "agreement", author: "finance-system", at: 0, visible_to: ["city", "c0003"],
  terms: { template: o.template ?? "employment", parties: ["city", "c0003"], commitments: [{ who: "city", does: { outcome: { money: { ...(o.to ? { to: o.to } : {}), amount: o.amount ?? "194446", for: "wages" } } }, every: o.every ?? 1_209_600 }, { who: "c0003", does: { outcome: { occupancy: { who: "c0003", in: "town-hall/workplace.1" } } } }] } });
const EURO = { code: "EUR", symbol: "€", minor_units: 2, decimal_mark: ",", group_mark: ".", symbol_after: true, symbol_spaced: true };
function knowing(records: object[], cur: any = EURO): Knowledge {
  const k = seat("finance", cur);
  k.absorb({ ...(TABLE.seats.finance as any), channels: { mine: { kind: "records", records } } });
  return k;
}
const preview = (k: Knowledge, program: string) => {
  const r = resolve(calls.parseProgram(program), k, () => undefined, "finance");
  if (!r.ok) throw new Error(r.questions.join(" "));
  return new Preview(k, k.actingFor("finance"), () => undefined, "finance").of(r.blocks);
};

test("a standing wage that is the whole agreed pay says so, and that nothing is withheld from it", () => {
  // (The wave's draft: "gross pay 1.944,46 less what the law says to withhold" drafted at 1.944,46 and confirmed.)
  const k = knowing([agreement("rec.1225")]);
  const p = preview(k, 'money(amount="1.944,46 €", basis=["rec.1225","law-income-tax"], every="every 14 days", first="year 1, day 40", for="wage", from=acc-city, to=acc-c0003)');
  expect(p).toContain("pay 1.944,46 € from your account (acc-city) to acc-c0003 every 14 days");
  expect(p).toEndWith(" This is the whole of the pay agreed in rec.1225 (1.944,46 € every 14 days), with nothing withheld from it.");
});

test("a standing wage below the agreed pay says by how much; above it, by how much more", () => {
  const k = knowing([agreement("rec.1225")]);
  expect(preview(k, 'money(amount="1.080,81 €", basis=["law-income-tax","rec.1225"], every="every 14 days", for="wages", from=acc-city, to=acc-c0003)'))
    .toEndWith(" This is 863,65 € less than the pay agreed in rec.1225 (1.944,46 € every 14 days).");
  expect(preview(k, 'money(amount="2.000,00 €", basis=rec.1225, every="14 days", from=acc-city, to=acc-c0003)'))
    .toEndWith(" This is 55,54 € more than the pay agreed in rec.1225 (1.944,46 € every 14 days).");
});

test("paid at another rhythm, both are said and no difference; paid once, it is one period's pay", () => {
  const k = knowing([agreement("rec.1225")]);
  expect(preview(k, 'money(amount="1.944,46 €", basis=rec.1225, every="30 days", from=acc-city, to=acc-c0003)'))
    .toEndWith(" The pay agreed in rec.1225 is 1.944,46 € every 14 days; this pays 1.944,46 € every 30 days.");
  expect(preview(k, 'money(amount="1.944,46 €", basis=rec.1225, from=acc-city, to=acc-c0003)'))
    .toEndWith(" This is the whole of one period's pay agreed in rec.1225 (1.944,46 € every 14 days), with nothing withheld from it.");
});

test("nothing is said where the seat has not seen the agreement, cites none, or pays someone the agreement does not", () => {
  const plain = (p: string) => { expect(p).toContain("Your request will read:"); expect(p).not.toMatch(/agreed in/); };
  // Not seen: the seat was shown no such paper.
  plain(preview(knowing([]), 'money(amount="1.944,46 €", basis=rec.1225, every="14 days", from=acc-city, to=acc-c0003)'));
  // Seen and not cited.
  plain(preview(knowing([agreement("rec.1225")]), 'money(amount="1.944,46 €", every="14 days", from=acc-city, to=acc-c0003)'));
  // Paid into another account than the one the agreement names.
  plain(preview(knowing([agreement("rec.1225", { to: "acc-c0003" })]), 'money(amount="1.944,46 €", basis=rec.1225, every="14 days", from=acc-city, to=acc-c0099)'));
  // Withdrawn since.
  plain(preview(knowing([agreement("rec.1225"), { id: "rec.1300", record: "withdrawal", author: "finance-system", at: 5, withdraws: "rec.1225", visible_to: ["city"] }]), 'money(amount="1.944,46 €", basis=rec.1225, every="14 days", from=acc-city, to=acc-c0003)'));
});

test("an agreement that is not employment is a sum agreed, with no word of withholding", () => {
  const k = knowing([agreement("rec.70", { template: "lease", amount: "85000", every: 2_592_000 })]);
  expect(preview(k, 'money(amount="850,00 €", basis=rec.70, every="monthly", from=acc-city, to=acc-c0003)')).toEndWith(" This is the whole of the sum agreed in rec.70 (850,00 € every 30 days).");
});

// --- the translator's exchange

const scripted = (programs: string[], asked: any[] = []) => {
  let i = 0;
  return { adapter: new MockAdapter("mock", { translator: (req: any) => { asked.push(req.messages); return [{ type: "tool_use", id: `c${i}`, name: "call", input: { program: programs[i++] } }]; } }), annotate: async () => {}, now: () => 0 };
};
const ok = async () => ({ ok: true });
const WAGE = "Set up a wage payment from acc-city to acc-c0003 every 14 days, citing employment agreement rec.1225: gross pay 1.944,46 € less what law-income-tax says to withhold.";

test("an amount that has to be worked out is said to the seat at once: the translator is not asked again and has no second answer to guess with", async () => {
  const asked: any[] = [];
  // (What the wave's translator answered: the refusal, and then, asked again, the figure the wage was to be worked out from.)
  const io = scripted(["none(needs_calculation)", 'money(amount="1.944,46 €", basis=["rec.1225","law-income-tax"], every="every 14 days", for="wage", from=acc-city, to=acc-c0003)'], asked);
  const r = await createTranslator(io, ok, () => undefined).translate({ draftId: "d1", participant: "finance-system", as: "finance", proposal: WAGE, knowledge: knowing([agreement("rec.1225")]) });
  expect(r).toEqual({ ok: false, notices: [LABEL_TEXT.needs_calculation], call: "none(needs_calculation)" });
  expect(asked).toHaveLength(1);
});

test("so is something that has to be found out first; a request that is only unclear is still tried once more", async () => {
  const asked: any[] = [];
  const first = await createTranslator(scripted(["none(look_first)", "statement(withdraw=job-c0004)"], asked), ok, () => undefined).translate({ draftId: "d1", participant: "finance-system", as: "finance", proposal: "Withdraw the standing wage payment to acc-c0004 that rests on job-c0004.", knowledge: seat("finance") });
  expect(first).toEqual({ ok: false, notices: [LABEL_TEXT.look_first], call: "none(look_first)" });
  expect(asked).toHaveLength(1);
  asked.length = 0;
  const again = await createTranslator(scripted(["none(unclear)", 'money(amount="XYZ 10", from=acc-city, to=acc-c0003)'], asked), ok, () => undefined).translate({ draftId: "d2", participant: "finance-system", as: "finance", proposal: "Pay acc-c0003 XYZ 10 from acc-city.", knowledge: seat("finance") });
  expect(again.ok).toBe(true);
  expect(asked).toHaveLength(2);
});

test("a call that fills per_request with words is the call's fault: tried again, and the seat reads nothing of it", async () => {
  const asked: any[] = [];
  const io = scripted(['money(amount="XYZ 280.00", from=acc-city, per_request="report", to=acc-c0003)', 'money(amount="XYZ 280.00", from=acc-city, to=acc-c0003)'], asked);
  const r = await createTranslator(io, ok, () => undefined).translate({ draftId: "d1", participant: "finance-system", as: "finance", proposal: "Pay over 280.00 from acc-city to acc-c0003, with report.", knowledge: seat("finance") });
  expect(r.ok).toBe(true);
  expect((r as any).retries).toEqual([{ call: 'money(amount="XYZ 280.00", from=acc-city, per_request="report", to=acc-c0003)', reason: "per_request should name a record by its id." }]);
  // Both attempts wrong: the seat is told nothing was done and to say it again, with nothing of the call.
  const twice = await createTranslator(scripted(['money(amount="XYZ 280.00", from=acc-city, per_request=rec.44, to=acc-c0003)', 'money(amount="XYZ 280.00", from=acc-city, per_request="the bank", to=acc-c0003)']), ok, () => undefined)
    .translate({ draftId: "d2", participant: "finance-system", as: "finance", proposal: "Pay over 280.00 from acc-city to acc-c0003, with report.", knowledge: seat("finance") });
  expect(twice).toMatchObject({ ok: false, notices: [NOT_PUT] });
});
