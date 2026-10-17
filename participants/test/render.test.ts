import { expect, test } from "bun:test";
import { money, outcomeWords, renderObservation, renderStanding, ruleWords, when } from "../src/llm/render";
import { canonical } from "../src/canon";
import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";

// The world these tests are in writes its money as the profile says (the platform has no money of its own).
inCurrency(PROFILE.values.currency);

test("money and time read as a person would read them", () => {
  expect(money(123456789)).toBe("$1,234,567.89");
  expect(money(-5)).toBe("-$0.05");
  expect(when(86_400 * 366)).toBe("year 2, day 2");
});

test("outcomes read as what someone will do", () => {
  expect(outcomeWords({ money: { to: "acc-landlord-1", amount: 85000, for: "rent" } }, 2592000)).toBe("pay $850.00 to acc-landlord-1 every 30 days (rent)");
  expect(outcomeWords({ occupancy: { who: "c1", in: "str.3/dwelling.2" } })).toBe("let c1 live or be in str.3/dwelling.2");
  // Whoever commits to be somewhere themselves comes there (a worker and their place of work), and is not "let" by themselves.
  expect(outcomeWords({ occupancy: { who: "c1", in: "town-hall/workplace.1" } }, undefined, "c1")).toBe("come to town-hall/workplace.1");
  expect(outcomeWords({ occupancy: { who: "c1", in: "str.3/dwelling.2" } }, undefined, "landlord-1")).toBe("let c1 live or be in str.3/dwelling.2");
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
  const text = renderObservation(obs({}, { outcomes: [{ action: "act.9", t: 0, status: "refused", refusal: { code: "insufficient_funds" } }], notices: [{ t: 0, text: "Please state the amount itself.", re: "draft.x.1" }, { t: 0, text: "Your letter to bank was not sent." }] }), { lastAction: "What you confirmed" });
  expect(text).toContain("What you confirmed couldn't be done: the account doesn't have enough money.");
  expect(text).toContain("\nPlease state the amount itself.\n");
  // (Something it is told that is not about a request stands as it is said.)
  expect(text).toContain("\nYour letter to bank was not sent.");
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
  const a = await participant.step(obs({}), { world: { config: {}, currency: PROFILE.values.currency } } as any);
  expect(a).toEqual({ type: "look", looks: [{ channel: "board", query: { standing: true, order: { field: "at", desc: true }, limit: 20 } }] });
});

test("a language-model participant can look things up in an on-request report: what to find, newest first", async () => {
  const { createLlmParticipant } = await import("../src/llm/participant");
  const { MockAdapter } = await import("../src/llm/adapter");
  const input = { report: "files", find: [{ field: "kind", value: "petition" }, { field: "data.employer", op: "=", value: "works" }], limit: 5 };
  const adapter = new MockAdapter("mock", { participant: () => [{ type: "tool_use", id: "1", name: "look", input }] });
  const participant = createLlmParticipant({ participant: "s", entity: "e", framing: { disclosure: "simulation", reason: "test" }, standing: [], titles: new Map([["files", "The town's files"]]), onRequest: ["files"], cadenceDays: 7, draftText: () => "" },
    { adapter, annotate: async () => {}, now: () => 0 });
  const a = await participant.step(obs({}), { world: { config: {}, currency: PROFILE.values.currency } } as any);
  // (Something to find that can't be read is said, not left out: llm-participant.test.ts.)
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
  // (Who's who is its own address book now: those it has looked up, each post set out, none merely counted. Until
  // 2026-10-08 it was shown every post in the town, and the ones without a public role were counted.)
  expect(text).toContain("Those you have looked up so far:");
  expect(text).toContain("Posts: Mayor (mayor), for city: held by Ada (ada-p); Town clerk (clerk), for city: vacant: nobody holds it;");
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
  const ctx = { world: { config: {}, currency: PROFILE.values.currency } } as any;
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

test("a law's rule is shown to whoever reads it, and that acts are checked against it; a law in words only shows neither", () => {
  const law = { adico: { attribute: "landlords", deontic: "must_not", aim: "raise a rent", condition: "with less than 90 days' notice", or_else: "the rise is invalid" },
    formal: { language: "cel", condition: "block.kind == 'rent_increase' && block.data.from - now < 7776000" } };
  expect(ruleWords(law)).toBe("Its rule, as recorded: landlords must not raise a rent, with less than 90 days' notice; or else: the rise is invalid. Offices and others check what they do against it.");
  expect(ruleWords({ adico: law.adico })).toBe("Its rule, as recorded: landlords must not raise a rent, with less than 90 days' notice; or else: the rise is invalid.");
  expect(ruleWords({ formal: law.formal })).toBe("Offices and others check what they do against a condition recorded with it.");
  expect(ruleWords({})).toBe("");
  // Word for word only where an act that would publish it is being confirmed (the preview).
  expect(ruleWords(law, { asWritten: true })).toContain("The condition acts are checked against, as written: block.kind == 'rent_increase' && block.data.from - now < 7776000.");
  // On file for a seat (its standing documents), and in a report that lists the law: never the platform's notation.
  const record = { id: "law-1", record: "statement", author: "clerk", at: 0, visible_to: "public", kind: "law", speaks_for: "city", text: "No rent rise without ninety days' notice.", ...law };
  const obs = { participant: "mayor-system", t: 0, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [], channels: { laws: { kind: "records", records: [record, { ...record, id: "law-2", text: "Be kind.", adico: undefined, formal: undefined }] } } } as any;
  const onFile = renderStanding(obs, new Set(["laws"]));
  expect(onFile).toContain('[law-1] law of city: "No rent rise without ninety days\' notice." Its rule, as recorded: landlords must not raise a rent');
  expect(onFile.split("\n")[1]).toBe('- [law-2] law of city: "Be kind."');
  const report = renderObservation(obs, { standing: new Set(), titles: new Map() });
  expect(report).toContain("Offices and others check what they do against it.");
  for (const shown of [onFile, report]) expect(shown).not.toContain("block.");
});

test("everything that comes back from an act is told: what it made, what a survey estimated, what an investigation found, and any part with no words of its own yet", async () => {
  const { outcomeLines } = await import("../src/llm/render");
  const api = JSON.parse(await Bun.file(new URL("../../contracts/participant-api.schema.json", import.meta.url)).text());
  const done = { action: "act.9", t: 0, status: "applied", created: { new_lease: "rec.12" },
    surveyed: { of: "river_trout", cells: { "cell.1.2": 14, "cell.1.3": 0 } },
    investigated: { from: "shop-1", at: "shop-1/store.1", kind: "goods", taken: true, taker: "c0042" },
    seen: [{ structure: "house-3", type: "house", at: "cell.2.2", w: 1, h: 1, complete: true, variables: { wear: { value: 12, per_day: 1, as_of_day: 0, min: 0, max: 100 } },
      spaces: [{ space: "house-3/dwelling.1", kind: "dwelling", capacity: 4, count: 2 }] }] };
  const refused = { action: "act.10", t: 0, status: "refused", refusal: { code: "insufficient_funds", block: 2, detail: "block 2: acc-city holds 100 cents" } };
  // (Between them they carry every part the participant API lets an outcome have: a part added there is added here.)
  expect(new Set([...Object.keys(done), ...Object.keys(refused)])).toEqual(new Set(Object.keys(api.$defs.Outcome.properties)));
  expect(new Set(Object.keys(refused.refusal))).toEqual(new Set(Object.keys(api.$defs.Outcome.properties.refusal.properties)));

  const text = renderObservation(obs({}, { outcomes: [done] }), { lastAction: "What you confirmed" });
  expect(text).toContain("Done: what you confirmed.");
  expect(text).toContain("It made: rec.12 (new lease).");
  expect(text).toContain("What the survey of river trout found, place by place (estimates): cell.1.2: 14; cell.1.3: 0. In all: 14.");
  expect(text).toContain("What the investigation into goods taken from shop-1 at shop-1/store.1 found: it was taken, by c0042.");
  // Work on a building: how the crew left it (how many are in it, never who, at someone else's building).
  expect(text).toContain("As those who did the work left it:");
  expect(text).toContain("house house-3, at cell.2.2: wear 12, rising 1 a day");
  expect(text).toContain("house-3/dwelling.1, a dwelling: 2 people (room for 4)");
  const no = renderObservation(obs({}, { outcomes: [refused] }), { lastAction: "What you confirmed" });
  expect(no).toContain("What you confirmed couldn't be done: the account doesn't have enough money (item 3).");
  // The act's own number and the engine's wording of why not are the platform's: never shown (principle 14).
  for (const shown of [text, no]) for (const machinery of ["act.9", "act.10", "acc-city holds", "block", "applied", "refus"]) expect(shown).not.toContain(machinery);

  // An investigation that found nothing taken, or not who; a survey of one place; another day's outcome is dated.
  const line = (o: object) => outcomeLines({ action: "a", t: 0, status: "applied", ...o } as any, "What you did", 0).join("\n");
  expect(line({ investigated: { from: "shop-1", at: "s", kind: "goods", taken: false, taker: null } })).toContain("found: nothing of the kind was found to have been taken there.");
  expect(line({ investigated: { from: "shop-1", at: "s", kind: "goods", taken: true, taker: null } })).toContain("found: it was taken, but who took it wasn't found.");
  expect(line({ surveyed: { of: "water", cells: { "cell.0.0": 1200 } } })).toContain("(estimates): cell.0.0: 1,200.");
  expect(outcomeLines({ action: "a", t: 0, status: "applied" }, "What you did", 3 * 86_400)[0]).toBe("Done (year 1, day 1): what you did.");
  // A part an outcome doesn't have today (in it, in a finding, or in why not) is told by its name, not dropped.
  expect(line({ weighed: { tonnes: 4, at: "weighbridge" } })).toContain("Weighed: tonnes: 4; at: weighbridge.");
  expect(line({ investigated: { from: "x", at: "y", kind: "goods", taken: true, taker: "c1", seen_by: "c2" } })).toContain("by c1. Seen by: c2.");
  expect(line({ surveyed: { of: "water", cells: {}, margin: 5 } })).toContain("Margin: 5.");
  expect(outcomeLines({ action: "a", t: 0, status: "refused", refusal: { code: "too_far", nearest: "cell.4.4" } } as any, "What you did", 0)[0]).toBe("What you did couldn't be done: they're too far away. Nearest: cell.4.4.");
});

const variable = (value: number, per_day: number, max = 100_000) => ({ value, as_of_day: 0, per_day, min: 0, max });
const house = (i: number, variables?: object, spaces = 1): any => ({ structure: `house-${i}`, type: "large_house", at: `cell.${i}.0`, w: 1, h: 1, complete: true, ...(variables ? { variables } : {}),
  spaces: Array.from({ length: spaces }, (_, n) => ({ space: `house-${i}/dwelling.${n + 1}`, kind: "dwelling", capacity: 4, count: n === 0 ? 2 : 0 })) });
const sites = (structures: any[], open: any[] = []) => ({ kind: "sites", as_of: 0, cells: [...structures.map((s, i) => ({ cell: s.at, x: i, y: 0, structure: s })), ...open] });

test("a building's state is told, whatever the world calls it: how much today and which way it's going", () => {
  // Seen on day 0, read on day 10: the value has moved on by its daily change, within its bounds.
  const text = renderObservation(obs({ near: sites([house(1, { rubbish_awaiting_collection: variable(500, 300), damp: variable(40, -10), "roof-wear": variable(99_990, 5), cracks: variable(7, 0) }), house(2)],
    [{ cell: "cell.9.9", x: 9, y: 9, terrain: "wetland", seen: ["grey_heron"] }]) }, { t: 10 * 86_400 }));
  expect(text).toContain("- large house house-1, at cell.1.0: cracks 7, steady; damp 0, as low as it goes; roof-wear 100,000, as high as it goes; rubbish awaiting collection 3,500, rising 300 a day");
  expect(text).toContain("- large house house-2, at cell.2.0\n");
  expect(text).toContain("(How far each runs: cracks from 0 to 100,000; damp from 0 to 100,000; roof-wear from 0 to 100,000; rubbish awaiting collection from 0 to 100,000.)");
  expect(text).toContain("Seen living there: grey heron (on 1 cell).");
  // Being demolished is said.
  expect(renderObservation(obs({ near: sites([{ ...house(3), coming_down: true }]) }))).toContain("house-3, at cell.3.0, being demolished");
});

test("a town too big to list building by building: for each measure, how many it's above zero or rising at, the worst few by name, and how to see the rest", () => {
  const town = sites([...Array.from({ length: 40 }, (_, i) => house(i, { waste: variable(i < 12 ? i * 1000 : 0, i < 30 ? 500 : 0) })), { ...house(99), type: "park", variables: { wear: variable(0, 137) }, spaces: [] }]);
  const plain = renderObservation(obs({ "mayor/town": town }), { titles: new Map([["mayor/town", "Survey of the town"]]) });
  expect(plain).toContain("Buildings: 40 large house, 1 park.");
  // (Day 0: eleven homes hold some; thirty are filling.)
  expect(plain).toContain("Waste: above zero at 11 of 40 buildings, rising at 30. Highest: large house house-11 11,000 (rising 500 a day); large house house-10 10,000 (rising 500 a day); large house house-9 9,000 (rising 500 a day); large house house-8 8,000 (rising 500 a day); large house house-7 7,000 (rising 500 a day); and 6 more above zero.");
  expect(plain).toContain("Wear: above zero at 0 of 1 buildings, rising at 1.");
  expect(plain).not.toContain("look at");
  // A seat that can look into the survey is told how to see the rest.
  const o = { titles: new Map([["mayor/town", "Survey of the town"]]), lookable: new Set(["mayor/town"]) };
  expect(renderObservation(obs({ "mayor/town": town }), o)).toContain('(To see any building, room or piece of ground in full, name it (or a kind of building); to see every building where one of these is above zero or rising, name the measure: look at "Survey of the town" (mayor/town).)');

  // Having looked, by measure: every building it's above zero or rising at, the highest first, each in full.
  const byMeasure = renderObservation(obs({ "mayor/town": town }), { ...o, looked: new Map([["mayor/town", { measure: "Waste", limit: 50 }]]) });
  expect(byMeasure).toContain("## Survey of the town: what you looked at\nWaste is above zero or rising at 30 buildings, the highest first:\n- large house house-11, at cell.11.0: waste 11,000, rising 500 a day\n  - house-11/dwelling.1, a dwelling: 2 people (room for 4)");
  expect(byMeasure.match(/^- large house/gm)!.length).toBe(30);
  expect(byMeasure).not.toContain("house-35"); // (nothing there, and none coming)
  // More than asked for at once: counted, never dropped without a word.
  expect(renderObservation(obs({ "mayor/town": town }), { ...o, looked: new Map([["mayor/town", { measure: "waste", limit: 20 }]]) })).toContain("(Entries 1 to 20 of 30. For the next: look again the same way with from_entry: 21; or name the ones you want.)");
  // By name: a building, a room in one, the ground one stands on, a kind of building, open ground; and what isn't there.
  const open = [{ cell: "cell.0.9", x: 0, y: 9, terrain: "wetland", seen: ["grey_heron"] }];
  const named = renderObservation(obs({ "mayor/town": sites(town.cells.map((c: any) => c.structure), open) }), { ...o, looked: new Map([["mayor/town", { named: ["house-3", "house-5/dwelling.1", "cell.7.0", "Park", "cell.0.9", "the moon"] }]]) });
  for (const id of ["house-3", "house-5", "house-7", "house-99"]) expect(named).toContain(` ${id}, at `);
  expect(named.match(/^- /gm)!.length).toBe(5);
  expect(named).toContain("- open ground cell.0.9, wetland; seen living there: grey heron");
  expect(named).toContain("Nothing is known here by this name: the moon.");
  expect(renderObservation(obs({ "mayor/town": town }), { ...o, looked: new Map([["mayor/town", { measure: "noise" }]]) })).toContain('Nothing is kept of the buildings here under "noise".');
});

test("a building with many rooms, looked at: every room, who's there and who has gone", () => {
  const flats = { ...house(1, undefined, 12), type: "apartments", built_by: "builder" };
  flats.spaces[3] = { ...flats.spaces[3]!, count: 1, occupants: ["ada-p"], left: [{ occupant: "c7", reason: "removed", at: 86_400 }] };
  const o = { lookable: new Set(["near"]) };
  const usual = renderObservation(obs({ near: sites([flats]) }, { entity: "ada-p" }), o);
  expect(usual).toContain("12 dwellings: 2 in use, 3 people; yours: house-1/dwelling.4");
  expect(usual).toContain('(To see every room of a building, name it: look at "Near" (near).)');
  const looked = renderObservation(obs({ near: sites([flats]) }, { entity: "ada-p" }), { ...o, looked: new Map([["near", { named: ["house-1"] }]]) });
  expect(looked).toContain("- apartments house-1, at cell.1.0, built by builder");
  expect(looked).toContain("  - house-1/dwelling.4, a dwelling: 1 person (room for 4): you; gone from it: c7 (was removed, year 1, day 2)");
  expect(looked.match(/^  - /gm)!.length).toBe(12);
});

test("where a list of papers is cut, the seat is told how to see the rest; what it looks up is whole, one by one, and nothing found is said", () => {
  const claims = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, record: "claim", author: "genesis", at: 0, visible_to: "public", position: "right", holder: "city", about: { kind: "ownership", object: `p${i}` } }));
  const long = { id: "m1", record: "statement", kind: "minutes", author: "clerk", at: 0, visible_to: "public", text: "x".repeat(1500), data: { note: "y".repeat(600) } };
  const o = { titles: new Map([["mine", "Filings"]]), lookable: new Set(["mine"]) };
  const hint = '(Not everything here is set out in full. To see the rest, say what to find, or go through it a part at a time (from_entry: 1, then as each answer says): look at "Filings" (mine).)';
  expect(renderObservation(obs({ mine: { kind: "records", records: claims } }), o)).toContain(`and 18 more\n${hint}`);
  expect(renderObservation(obs({ mine: { kind: "records", records: [long] } }), o)).toContain(`…)\n${hint}`);
  const many = Array.from({ length: 45 }, (_, i) => ({ ...long, id: `n${i}`, text: "Short.", data: undefined }));
  expect(renderObservation(obs({ mine: { kind: "records", records: many } }), o)).toContain("(5 earlier items not listed.)");
  expect(renderObservation(obs({ mine: { kind: "records", records: many } }), o)).toContain(hint);
  // Nothing cut: no hint. A report it can't look into: the count, as before, and no promise.
  expect(renderObservation(obs({ mine: { kind: "records", records: many.slice(0, 3) } }), o)).not.toContain("look at");
  expect(renderObservation(obs({ mine: { kind: "records", records: claims } }), { titles: o.titles })).not.toContain("look at");

  // What it looked up: a list, every claim by itself, a line to a paper (a paper's full text comes when that paper is
  // asked for by its id: participants/test/seat-papers.test.ts).
  const found = renderObservation(obs({ mine: { kind: "records", search: true, records: [...claims, long] } }), { ...o, looked: new Map([["mine", { limit: 50 }]]) });
  expect(found).toContain("## Filings: what you looked up (31 found)");
  expect(found).toContain("- 30 ownership claims, from the start: city has a right: p0 [t0], p1 [t1], p2 [t2], p3 [t3], p4 [t4], p5 [t5], and 24 more (to find one, say what it is about)");
  expect(found).toContain(`- [m1] minutes, year 1, day 1, from clerk: "${"x".repeat(160)}…"`);
  expect(found).not.toContain("x".repeat(161));
  expect(found).toContain('(To read one in full: look at this report (mine) with paper: its id.)');
  expect(found).not.toContain("There may be more");
  // The one paper, asked for by its id: whole.
  const one = renderObservation(obs({ mine: { kind: "records", search: true, records: [long] } }), { ...o, looked: new Map([["mine", { paper: "m1" }]]) });
  expect(one).toContain("## Filings: the paper m1\n- [m1] minutes from clerk");
  expect(one).toContain("x".repeat(1500));
  expect(one).toContain("y".repeat(600));
  expect(one).not.toContain("…");
  expect(renderObservation(obs({ mine: { kind: "records", search: true, records: claims.slice(0, 20) } }), { ...o, looked: new Map([["mine", { limit: 20 }]]) })).toContain("(There may be more: at most 20 were asked for. For the next: look again the same way with from_entry: 21.)");
  expect(renderObservation(obs({ mine: { kind: "records", search: true, records: [] } }), o)).toContain("## Filings: what you looked up (0 found)\nNothing found.");
  // A look that brought nothing new, or at a report that's no longer its own: said.
  expect(renderObservation(obs({ mine: { kind: "records", records: [] } }), { ...o, looked: new Map([["mine", {}]]) })).toContain("## Filings\nNothing new there since you last looked.");
  expect(renderObservation(obs({}), { ...o, looked: new Map([["mine", {}]]) })).toContain("## Filings\nNothing could be seen there.");
  // A question still out to the keeper is not an empty answer (bug hunt 2026-10-17, finding 7).
  const waiting = renderObservation({ ...obs({}), asking: ["office/mine"] } as any, { ...o, looked: new Map([["mine", {}]]) });
  expect(waiting).toContain("## Filings\nYour question is still with the one who keeps this.");
  expect(waiting).not.toContain("Nothing could be seen there.");
  // What was looked up whole doesn't leave the next report whole: a long text is cut again, with its mark.
  expect(renderObservation(obs({ mine: { kind: "records", records: [long] } }), o)).toContain("…");
});

test("who's who, looked into: people, organisations and posts by id or by part of a name; money in and out says what the rest came to", () => {
  const who = { kind: "directory", entities: [{ entity: "city", kind: "town", name: "Millbrook" }, { entity: "c0001", kind: "person", name: "Ada Lovelace", participant: "ada" }, { entity: "c0002", kind: "person", name: "Bo Diddley" }],
    positions: [{ position: "mayor", entity: "city", title: "Mayor", role: "mayor", holder: "ada" }, { position: "clerk", entity: "city", title: "Town clerk", role: "clerk" }] };
  const o = { lookable: new Set(["who"]) };
  // Nobody is shown who's who (docs/design/knowing.md): what a seat has of it is whom it has looked up, by name, and
  // how to look someone up. (Until 2026-10-08: "People: 2." of a directory it was shown whole.)
  expect(renderObservation(obs({ who }), o)).toContain('Those you have looked up so far:\nOrganisations: Millbrook (city).\nPosts: Mayor (mayor), for city: held by Ada Lovelace (c0001); Town clerk (clerk), for city: vacant: nobody holds it.\nPeople: Ada Lovelace (c0001); Bo Diddley (c0002).\n(To find out who someone is, name them (a person or an organisation by its id or full name; a post by its id, its title or what it is, such as mayor): look at "Who" (who).)');
  expect(renderObservation(obs({ who: { kind: "directory", entities: [], positions: [] } }), o)).toContain("You have looked nobody up yet.");
  const found = renderObservation(obs({ who }), { ...o, looked: new Map([["who", { named: ["lovelace", "clerk"] }]]) });
  expect(found).toContain("## Who: who you looked for\n- Ada Lovelace (c0001), a person\n- post: Mayor (mayor), for city: held by Ada Lovelace (c0001)\n- post: Town clerk (clerk), for city: vacant: nobody holds it");
  expect(found).not.toContain("Bo Diddley");
  expect(renderObservation(obs({ who }), { ...o, looked: new Map([["who", { named: ["zed"] }]]) })).toContain("No one and nothing found by that name.");

  const transactions = Array.from({ length: 11 }, (_, i) => ({ t: 0, from: `acc-c${i}`, to: "acc-city", amount: String((i + 1) * 100), currency: "USD", by: "bank" }));
  const text = renderObservation(obs({ books: { kind: "accounts", accounts: [{ account: "acc-city", holder: "city", custodian: "bank", currency: "USD", balance: "0" }], transactions } }));
  expect(text).toContain("Received $66.00 since you last looked: acc-c10 $11.00,");
  expect(text).toContain(", and 3 more ($6.00 between them).");
});

test("a body's own state, where it is and its family are told; an agreement says how it stands", () => {
  const text = renderObservation(obs({ mine: { kind: "records", records: [{ id: "lease-1", record: "agreement", author: "landlord", at: 0, visible_to: ["c1"], terms: { template: "lease", parties: ["landlord", "c1"], commitments: [{ who: "c1", does: { outcome: { money: { to: "acc-l", amount: 85000, for: "rent" } } }, every: 2592000 }] } }] } }, {
    t: 86_400 * 365 * 3, readings: { "lease-1": { of: "agreement", status: "in_force", ends_at: 86_400 * 365 * 4, obligations: [{ commitment: 0, next_due: 86_400 * 365 * 3 + 86_400, arrears: "170000" }], reader: "terms 1" } },
    body: { born_at: -86_400 * 365 * 30, present: true, alive: true, in: "house-1/dwelling.1", variables: { years_of_skill: 1200 }, parents: ["c8"], children: [{ person: "c9", born_at: 0, alive: true }],
      conditions: [{ id: "cnd.1", kind: "injury", severity: "severe", since: 0, until: 86_400 * 365 * 4, treated: true }] } }));
  expect(text).toContain("You are 33 years old. You are in house-1/dwelling.1.");
  expect(text).toContain("it should pass by year 5, day 1 (it has been treated).");
  expect(text).toContain("About you: years of skill 1,200.");
  expect(text).toContain("Your parents: c8.");
  expect(text).toContain("Your children: c9 (3 years old).");
  expect(text).toContain("(rent) (year 1, day 1). As it stands: in force; ends year 5, day 1; commitment 1 next due year 4, day 2, $1,700.00 owing");
  expect(text).not.toContain("terms 1");
});

test("why something couldn't be done is said from inside the world", async () => {
  const { refusalText } = await import("../src/llm/words");
  expect(refusalText("not_modelled")).toBe("that doesn't happen here");
  expect(refusalText("cap_exceeded")).toBe("the limit on that has been reached");
  const log = JSON.parse(await Bun.file(new URL("../../contracts/log.schema.json", import.meta.url)).text());
  for (const code of log.$defs.RefusalCode.enum as string[]) expect(refusalText(code)).not.toMatch(/\bworld\b|simulat|platform/i);
});

test("on file shows only what stands: not a law withdrawn, nor one an amended law replaces; and nothing once the last is withdrawn", async () => {
  const law = (id: string, at: number, text: string, x: object = {}) => ({ id, record: "statement", author: "clerk", at, visible_to: "public", kind: "law", speaks_for: "city", text, ...x });
  const withdrawal = (id: string, of: string, x: object = {}) => ({ id, record: "withdrawal", author: "clerk", at: 9, visible_to: "public", speaks_for: "city", withdraws: of, ...x });
  const file = (records: any[]) => renderStanding(obs({ laws: { kind: "records", records } }), new Set(["laws"])).split("\n").filter(Boolean).map((l) => /^- \[([\w.-]+)\]/.exec(l)![1]);
  const notice60 = law("law-1", 0, "Sixty days' notice.");
  const kind = law("law-2", 0, "Be kind.");
  expect(file([notice60, kind])).toEqual(["law-1", "law-2"]);
  // Repealed by the town: gone from the file.
  expect(file([notice60, kind, withdrawal("w1", "law-2")])).toEqual(["law-1"]);
  // Amended: the new law names the one it replaces, and stands in its place, with or without the withdrawal shown.
  const notice75 = law("law-3", 5, "Seventy-five days' notice.", { data: { replaces: "law-1" } });
  expect(file([notice60, kind, notice75])).toEqual(["law-2", "law-3"]);
  expect(file([notice60, kind, notice75, withdrawal("w2", "law-1")])).toEqual(["law-2", "law-3"]);
  // Amended twice: only the last stands.
  expect(file([notice60, notice75, law("law-4", 8, "Ninety days' notice.", { data: { replaces: "law-3" } })])).toEqual(["law-4"]);
  // Someone else's "law" naming the town's as replaced doesn't replace it; nor does a document of another kind; nor
  // does a withdrawal by someone who neither made the law nor speaks for the town take it down.
  expect(file([notice60, law("fake", 5, "No notice at all.", { speaks_for: "c9", author: "c9-self", data: { replaces: "law-1" } })])).toEqual(["law-1", "fake"]);
  expect(file([notice60, law("form-1", 5, "A form.", { kind: "form", data: { replaces: "law-1" } })])).toEqual(["law-1", "form-1"]);
  expect(file([notice60, withdrawal("w3", "law-1", { author: "c9-self", speaks_for: "c9" })])).toEqual(["law-1"]);

  // Through a seat: what its next call has on file follows the record. The amended law in place of the old; and once
  // the last standing law is withdrawn, nothing on file (not the last list it had).
  const { createLlmParticipant } = await import("../src/llm/participant");
  const systems: string[] = [];
  const adapter = { provider: "mock", model: "mock", complete: async (req: any) => {
    systems.push(req.system);
    return { content: [{ type: "tool_use", id: `end-${systems.length}`, name: "done_for_now", input: {} }], usage: { input_tokens: 1, output_tokens: 1 } };
  } };
  const seat = createLlmParticipant({ participant: "mayor-system", entity: "city", title: "Mayor", framing: { disclosure: "simulation", reason: "test" }, standing: ["laws"], titles: new Map(), cadenceDays: 7, draftText: () => "" } as any,
    { adapter, annotate: async () => {}, now: () => 0 } as any);
  const ctx = { world: { currency: PROFILE.values.currency } } as any;
  const at = (t: number, records: any[]) => obs({ laws: { kind: "records", records } }, { t, positions: [{ position: "mayor", entity: "city", title: "Mayor" }] });
  await seat.step(at(0, [notice60]), ctx);
  await seat.step(at(30 * 86_400, [notice60, notice75, withdrawal("w2", "law-1")]), ctx);
  await seat.step(at(60 * 86_400, [notice60, notice75, withdrawal("w2", "law-1"), withdrawal("w4", "law-3")]), ctx);
  expect(systems.length).toBe(3);
  expect(systems[0]).toContain("On file:");
  expect(systems[0]).toContain("[law-1]");
  expect(systems[1]).toContain("[law-3]");
  expect(systems[1]).not.toContain("[law-1]");
  expect(systems[2]).not.toContain("On file:");
  expect(systems[2]).not.toContain("Seventy-five days");
});
