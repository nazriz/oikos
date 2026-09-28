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
