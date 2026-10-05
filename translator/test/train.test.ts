import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import type { LlmAdapter, LlmRequest } from "@oikos/participants/llm";
import { askable, builtRefusals, copies, generate, goldFromLog, literals, sameProgram, shapeOf, type Example } from "../train/data";

const act = (call: string) => JSON.stringify({ kind: "command", body: { command: "act", provenance: { via: "call", call } } });
const header = JSON.stringify({ kind: "header", body: { config: { world: { entities: [{ id: "builder", name: "Millbrook Builders" }, { id: "city", name: "Millbrook" }] }, positions: [{ id: "works", title: "Works Manager" }] } } });
const LOG = [
  header,
  act('money(to=builder, amount="$500", from=acc-city, for="the kerb")'),
  act('money(to=builder, amount="$750", from=acc-city, for="the drain")'),
  act('money(to=builder, amount="$500", from=acc-city, for="the kerb")'), // the same program again
  act('message(to=["builder","works"], text="Start on Monday.")'),
  act('statement(kind=delivery_note, text="Delivered 3.", data={"delivered":3,"order":"rec.9"})'), // data code writes for code
  act('money(to=acc-shop-1, amount="$20", from=acc-c0001, per_request=rec.5)'), // a keeper carrying out an instruction
  act('t = entity(kind=trust, name="River Land Trust")\nstatement(kind=charter, for=t, text="It holds land.")'),
  JSON.stringify({ kind: "command", body: { command: "act", provenance: { via: "blocks" } } }),
];

/** A writer that says the call back as a sentence holding every literal (or, told to, loses one). */
const writer = (model: string, how: (program: string, style: string) => string | undefined): LlmAdapter => ({
  provider: "stand-in", model,
  complete: async (req: LlmRequest) => {
    const content = String((req.messages[0] as any).content);
    const program = content.slice("Call:\n".length, content.indexOf("\n\n"));
    const style = content.slice(content.lastIndexOf("Style: ") + 7);
    const text = how(program, style);
    return { content: text ? [{ type: "text", text }] : [], usage: { input_tokens: 10, output_tokens: 5 } };
  },
});
const saying = (program: string, style: string) => `(${style.slice(0, 6)}) Please see to this: ${literals(calls.parseProgram(program)).join(", ")}.`;

test("gold programs: the calls code wrote, askable ones only, each different program once, with the names of what they mention", async () => {
  const gold = await goldFromLog(LOG, { perShape: 8 });
  // (Each in the call language's own canonical form: its arguments in one order, whatever order they were written in.)
  expect(gold.map((g) => g.program)).toEqual([
    'message(text="Start on Monday.", to=["builder","works"])',
    'money(amount="$500", for="the kerb", from=acc-city, to=builder)',
    'money(amount="$750", for="the drain", from=acc-city, to=builder)',
    't = entity(kind=trust, name="River Land Trust")\nstatement(for=t, kind=charter, text="It holds land.")',
  ]);
  expect(gold[0]!.names).toEqual({ builder: "Millbrook Builders", works: "Works Manager" });
  expect(gold[1]!.shape).toBe("money(amount,for,from,to)");
  // At most so many of a shape, the same ones for the same seed.
  const one = await goldFromLog(LOG, { perShape: 1, seed: 7 });
  expect(one.filter((g) => g.shape === "money(amount,for,from,to)").length).toBe(1);
  expect(await goldFromLog(LOG, { perShape: 1, seed: 7 })).toEqual(one);
});

test("a program's shape, its literals, and what's askable", () => {
  const p = calls.parseProgram('t = entity(kind=trust, name="River Land Trust")\nstatement(kind=charter, for=t, text="It holds land.")');
  expect(shapeOf(p)).toBe("v=entity(kind,name) ; statement(for,kind,text)");
  expect(literals(p)).toEqual(["trust", "River Land Trust", "charter", "It holds land."]); // not `t`: a name within the program
  expect(literals(calls.parseProgram('agreement(with=c0042, term="12 months", they_do=money(to=acc-city, amount="$850", every="monthly"))'))).toEqual(["c0042", "12 months", "acc-city", "$850", "monthly"]);
  expect(askable(calls.parseProgram('statement(kind=note, text="x", data={"a":1})'))).toBe(false);
  expect(askable(calls.parseProgram("vote(ballot=rec.3, choice=yes)"))).toBe(true);
  expect(sameProgram('vote(ballot=rec.3, choice="yes")', "vote(choice=yes, ballot=rec.3)")).toBe(true);
});

test("a request is kept only if it carries every literal exactly, and only if it translates back to its program", async () => {
  expect(copies("Pay builder $500 from acc-city for the kerb.", 'money(to=builder, amount="$500", from=acc-city, for="the kerb")')).toBe(true);
  expect(copies("Pay the builder five hundred dollars from acc-city for the kerb.", 'money(to=builder, amount="$500", from=acc-city, for="the kerb")')).toBe(false);
  const gold = await goldFromLog(LOG);
  // The second writer reformats amounts: its money requests are dropped, mechanically.
  const sloppy = (program: string, style: string) => saying(program, style).replace("$500", "500 dollars").replace("$750", "750 dollars");
  // The model translating back gets the drain payment wrong.
  const byRequest = new Map<string, string>();
  const first = writer("a", (program, style) => {
    const r = saying(program, style);
    byRequest.set(r, program);
    return r;
  });
  const r = await generate(gold, {
    writers: [first, writer("b", sloppy)], perGold: 2, styles: ["terse", "formal"],
    back: { model: "stand-in/back", translate: async (request) => (request.includes("the drain") ? "none(unclear)" : byRequest.get(request)) },
  });
  // Four programs, two requests each: writer b loses both payments' amounts; the drain payment from writer a fails the round trip.
  expect(r.manifest.dropped).toEqual({ not_copied: 2, round_trip: 3, duplicate: 0 });
  expect(r.examples.filter((e) => e.kind === "positive").map((e) => [e.shape, e.written_by, e.verified_by])).toEqual([
    ["message(text,to)", "stand-in/a", "stand-in/back"],
    ["money(amount,for,from,to)", "stand-in/a", "stand-in/back"],
    ["v=entity(kind,name) ; statement(for,kind,text)", "stand-in/a", "stand-in/back"],
  ]);
  expect(r.manifest.usage["stand-in/a"]).toEqual({ input_tokens: 40, output_tokens: 20 });
  expect(r.manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect((await generate(gold, { writers: [first], perGold: 1 })).examples.every((e) => e.verified_by === undefined)).toBe(true);
});

test("refusals that can be built are: several requests run together, and a form nobody was shown", () => {
  const positives: Example[] = Array.from({ length: 40 }, (_, i) => ({
    id: `e${i}`, request: `Request number ${i} about thing ${i}.`, forms: i % 10 === 0 ? ["- permit_application, to=planning: fields lot (lot, required)"] : [],
    program: i % 10 === 0 ? `form(to=planning, form=permit_application, lot=lot-${i})` : `vote(ballot=rec.${i}, choice=yes)`, kind: "positive", shape: i % 10 === 0 ? "form(form,lot,to)" : `shape-${i % 7}`, source: "test",
  }));
  const built = builtRefusals(positives, 3, 0.1);
  const many = built.filter((e) => e.program === "none(too_much)");
  expect(many.length).toBeGreaterThan(0);
  for (const e of many) expect(e.request.split(/ Also: | And then: /).length).toBeGreaterThanOrEqual(4);
  const forms = built.filter((e) => e.program === "none(unknown_form)");
  for (const e of forms) expect(e.forms).toEqual([]);
  expect(builtRefusals(positives, 3, 0.1)).toEqual(built); // the same seed, the same refusals
});

test("training data that shares wording with a held-out case is refused", async () => {
  const gold = await goldFromLog(LOG);
  const heldOut = [{ id: "x-1", request: `Would you ${saying(gold[1]!.program, "plain").slice(8)}`, expect: ["none(unclear)"] }];
  await expect(generate(gold, { writers: [writer("a", saying)], perGold: 1, styles: ["plain"], heldOut })).rejects.toThrow("shares wording with 1 held-out case(s) (x-1)");
});
