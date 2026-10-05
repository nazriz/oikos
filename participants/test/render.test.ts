import { expect, test } from "bun:test";
import { money, outcomeWords, renderObservation, when } from "../src/llm/render";
import { canonical } from "../src/canon";

test("money and time read as a person would read them", () => {
  expect(money(123456789)).toBe("$1,234,567.89");
  expect(money(-5)).toBe("-$0.05");
  expect(when(86_400 * 366)).toBe("year 2, day 2");
});

test("outcomes read as what someone will do", () => {
  expect(outcomeWords({ money: { to: "acc-landlord-1", amount: 85000, for: "rent" } }, 2592000)).toBe("pay $850.00 to acc-landlord-1 every 30 days (rent)");
  expect(outcomeWords({ occupancy: { who: "c1", in: "str.3/dwelling.2" } })).toBe("let c1 live or be in str.3/dwelling.2");
});

const obs = (channels: any, extra: any = {}) => ({ participant: "mayor", t: 0, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [], channels, ...extra }) as any;

test("reports use the world's words: titles, totals, tallies; never the machinery", () => {
  const claims = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, record: "claim", author: "genesis", at: 0, visible_to: "public", position: "right", holder: "city", about: { kind: "ownership", object: `p${i}` } }));
  const votes = ["yes", "no", "yes"].map((choice, i) => ({ id: `v${i}`, record: "vote", author: `councillor-${i}`, at: 5, visible_to: ["city"], ballot: "rec.7", choice }));
  const text = renderObservation(obs({ mine: { kind: "records", records: [...claims, ...votes] } }), { titles: new Map([["mine", "Filings concerning the town"]]) });
  expect(text).toContain("## Filings concerning the town (2 new)");
  expect(text).toContain("30 ownership claims: city has a right: p0, p1");
  expect(text).toContain("and 18 more");
  expect(text).toContain("3 votes on rec.7: no 1, yes 2");
  for (const machinery of ["block", "record", "channel", "insufficient_funds", "kernel", "translator"]) expect(text.toLowerCase()).not.toContain(machinery);
});

test("outcomes and notices are told in plain words", () => {
  const text = renderObservation(obs({}, { outcomes: [{ action: "act.9", t: 0, status: "refused", refusal: { code: "insufficient_funds" } }], notices: [{ t: 0, text: "Please state the amount itself." }] }), { lastAction: "What you confirmed" });
  expect(text).toContain("What you confirmed couldn't be done: the account doesn't have enough money.");
  expect(text).toContain("A note on your request: Please state the amount itself.");
  expect(text).not.toContain("act.9");
});

test("canonical JSON sorts keys by UTF-16 code units and escapes like the kernel", () => {
  expect(canonical({ b: 1, a: [true, null, "x\n\u0001é"], "é": 0, Z: {} })).toBe('{"Z":{},"a":[true,null,"x\\n\\u0001é"],"b":1,"é":0}');
  expect(() => canonical({ x: 1.5 })).toThrow();
});

test("a language-model participant with on-request reports can look at them, in its own words", async () => {
  const { createLlmParticipant } = await import("../src/llm/participant");
  const { MockAdapter } = await import("../src/llm/adapter");
  const adapter = new MockAdapter("mock", { participant: () => [{ type: "tool_use", id: "1", name: "look", input: { report: "board", current_only: true } }] });
  const participant = createLlmParticipant({ participant: "s", entity: "e", framing: { disclosure: "simulation", reason: "test" }, standing: [], titles: new Map([["board", "Noticeboard"]]), onRequest: ["board"], cadenceDays: 7, draftText: () => "" },
    { adapter, annotate: async () => {}, now: () => 0 });
  const a = await participant.step(obs({}), { world: { config: {} } } as any);
  expect(a).toEqual({ type: "look", looks: [{ channel: "board", query: { standing: true, limit: 20 } }] });
});

test("a language-model participant can look things up in an on-request report: what to find, newest first", async () => {
  const { createLlmParticipant } = await import("../src/llm/participant");
  const { MockAdapter } = await import("../src/llm/adapter");
  const input = { report: "files", find: [{ field: "kind", value: "petition" }, { field: "data.employer", op: "=", value: "works" }, { field: "id; drop table", value: "x" }], limit: 5 };
  const adapter = new MockAdapter("mock", { participant: () => [{ type: "tool_use", id: "1", name: "look", input }] });
  const participant = createLlmParticipant({ participant: "s", entity: "e", framing: { disclosure: "simulation", reason: "test" }, standing: [], titles: new Map([["files", "The town's files"]]), onRequest: ["files"], cadenceDays: 7, draftText: () => "" },
    { adapter, annotate: async () => {}, now: () => 0 });
  const a = await participant.step(obs({}), { world: { config: {} } } as any);
  // (A field the participant API doesn't know is left out, not passed on.)
  expect(a).toEqual({ type: "look", looks: [{ channel: "files", query: { where: [{ field: "kind", op: "=", value: "petition" }, { field: "data.employer", op: "=", value: "works" }], order: { field: "at", desc: true }, limit: 5 } }] });
});

test("a body, posts, buildings with their spaces, and the directory's posts read in the world's words", () => {
  const dw = (i: number, count: number, occupants?: string[]) => ({ space: `apts-1/dwelling.${i}`, kind: "dwelling", capacity: 6, attrs: { bedrooms: 2 }, count, ...(occupants ? { occupants } : {}) });
  const apts = { structure: "apts-1", type: "apartments", at: "cell.0.0", w: 1, h: 1, complete: true, spaces: [dw(0, 3, ["ada-p", "c2", "c3"]), dw(1, 0)] };
  const text = renderObservation(obs({
    near: { kind: "sites", as_of: 0, cells: [{ cell: "cell.0.0", x: 0, y: 0, structure: apts }, { cell: "cell.1.0", x: 1, y: 0 }, { cell: "cell.2.0", x: 2, y: 0, terrain: "water" }] },
    "mayor/who": { kind: "directory", entities: [{ entity: "city", kind: "town", name: "Millbrook" }, { entity: "ada-p", kind: "person", name: "Ada", participant: "ada" }], positions: [{ position: "mayor", entity: "city", title: "Mayor", role: "mayor", holder: "ada" }, { position: "clerk", entity: "city", title: "Town clerk", role: "clerk" }, { position: "till", entity: "city", title: "Cashier", holder: "till-system", held_by: "Till" }] },
  }, {
    entity: "ada-p", t: 86_400 * 365 * 3,
    body: { born_at: -86_400 * 365 * 30, present: true, alive: true, conditions: [{ id: "cnd.1", kind: "illness", severity: "mild", since: 0, until: 86_400 * 365 * 4 }] },
    positions: [{ position: "mayor", entity: "city", title: "Mayor" }],
  }));
  expect(text).toContain("You are 33 years old.");
  expect(text).toContain("You have a mild illness");
  expect(text).toContain("You hold a post: Mayor (mayor), for city.");
  expect(text).toContain("- apartments apts-1, at cell.0.0");
  expect(text).toContain("apts-1/dwelling.0, a dwelling (bedrooms: 2): 3 people (room for 6): you, c2, c3");
  expect(text).toContain("Open ground: 2 cells (cell.1.0; cell.2.0, water).");
  expect(text).toContain("## Mayor: Who");
  expect(text).toContain("Posts: Mayor (mayor), for city: Ada (ada-p); Town clerk (clerk), for city: vacant; and 1 other post in organisations' own offices.");
  expect(text).not.toContain("till-system");
});

test("every refusal the kernel can give has world words", async () => {
  const { refusalText } = await import("../src/llm/words");
  const log = JSON.parse(await Bun.file(new URL("../../contracts/log.schema.json", import.meta.url)).text());
  for (const code of log.$defs.RefusalCode.enum as string[]) expect(refusalText(code)).not.toBe("it isn't possible");
});

test("done for now alongside an action: the action, then no call until the next wake, whose report carries what came of it", async () => {
  const { createLlmParticipant } = await import("../src/llm/participant");
  const { MockAdapter } = await import("../src/llm/adapter");
  const seen: any[] = [];
  const adapter = new MockAdapter("mock", { participant: (req) => {
    seen.push(req.messages);
    return seen.length === 1
      ? [{ type: "tool_use", id: "1", name: "write", input: { to: ["clerk"], text: "The figures, please." } }, { type: "tool_use", id: "2", name: "done_for_now", input: { days: 3 } }]
      : [{ type: "tool_use", id: "3", name: "done_for_now", input: {} }];
  } });
  const participant = createLlmParticipant({ participant: "s", entity: "e", framing: { disclosure: "simulation", reason: "test" }, standing: [], titles: new Map([["board", "Noticeboard"]]), cadenceDays: 7, draftText: () => "" },
    { adapter, annotate: async () => {}, now: () => 0 });
  const ctx = { world: { config: {} } } as any;
  const first = await participant.step(obs({}), ctx);
  expect(first.type).toBe("message"); // the letter
  // The step after it: no model call, asleep for the 3 days asked.
  const second = await participant.step(obs({ board: { kind: "records", records: [{ id: "r1", record: "statement", kind: "notice", text: "Figures: $1,000.", author: "clerk", at: 1, visible_to: "public" }] } }, { t: 100 }), ctx);
  expect(second).toEqual({ type: "wait", until: 100 + 3 * 86_400 });
  expect(seen.length).toBe(1);
  // The next wake: one call, and its report carries what the skipped step showed.
  await participant.step(obs({}, { t: 3 * 86_400 + 100 }), ctx);
  expect(seen.length).toBe(2);
  expect(JSON.stringify(seen[1])).toContain("Since you last looked");
  expect(JSON.stringify(seen[1])).toContain("Figures: $1,000.");
});

test("a form is shown whole, on file and in a report, however many fields it has (other details are still cut short)", async () => {
  const { renderStanding } = await import("../src/llm/render");
  const fields = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`line_${i}`, { type: "amount", description: `For a budget: line ${i} of the thirty.` }]));
  const form = { id: "form-budget", record: "statement", author: "genesis", at: 0, visible_to: "public", speaks_for: "city", kind: "form", text: "A budget.", data: { form: "budget", submit_as: "proposal", submit_to: ["city"], fields } };
  const long = { ...form, id: "minutes-1", kind: "minutes" };
  const o = obs({ forms: { kind: "records", records: [form, long] } });
  const whole = JSON.stringify(form.data);
  expect(whole.length).toBeGreaterThan(1500);
  const onFile = renderStanding(o, new Set(["forms"])).split("\n");
  expect(onFile[0]).toContain(whole);
  expect(onFile[1]).not.toContain("line_29"); // (not a form: its details are cut short, with a mark)
  expect(onFile[1]).toContain("…");
  expect(renderObservation(o).split("\n").find((l) => l.includes("[form-budget]"))).toContain(whole);
  // The generated town's forms: every field is in what its mayor has on file.
  const { generate } = await import("../../worlds/generator/generate");
  const { readFileSync } = await import("node:fs");
  const c = generate({ ...(Bun.YAML.parse(readFileSync(`${import.meta.dir}/../../worlds/town.yaml`, "utf8")) as any), citizens: 80 });
  const forms = c.world.records.filter((r: any) => r.kind === "form");
  expect(forms.length).toBeGreaterThan(0);
  const filed = renderStanding(obs({ forms: { kind: "records", records: forms } }), new Set(["forms"]));
  for (const f of forms) for (const name of Object.keys(f.data.fields)) expect(filed).toContain(`"${name}":`);
});
