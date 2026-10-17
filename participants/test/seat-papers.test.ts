// What a look into an office's own papers answers with, and how much a seat is ever shown (the live check of
// 2026-10-09, finding 1: a look into "Payroll" brought back the town's asset register, 230,000 characters, every time,
// and one seat's next prompt was 602,000 characters, which its model would not take). A look into papers answers with
// a list; a paper's full text comes when that paper is asked for by its id; a very long paper is read a part at a time;
// one look and one whole prompt have a ceiling; and a prompt a model would not take is never sent again unchanged.

import { expect, test } from "bun:test";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import type { Observation } from "../src/contracts";
import type { ContentBlock, LlmRequest } from "../src/llm/adapter";
import { inCurrency } from "../src/money";
import { createLlmParticipant, fitPrompt, kindWhere, LOOK_LEFT_OUT, PROMPT_MAX, PROMPT_MIN, tools, type LlmParticipantConfig } from "../src/llm/participant";
import { LOOK_CHARS_MAX, PAPER_MAX, renderObservation } from "../src/llm/render";

const DAY = 86_400;
const HOUR = 3_600;
inCurrency(PROFILE.values.currency as any);
const ctx = { world: { currency: PROFILE.values.currency } } as any;

// The town's own papers, as the first finance seats had them: the asset register (a lot to an entry), the habitat map,
// six employment agreements with their signatures and wage orders, a form, the charter.
const register = { id: "asset-register", record: "statement", kind: "asset_register", author: "genesis", at: 0, speaks_for: "city", visible_to: ["city"], text: "The town's asset register: the land the town holds, and what stands on each lot.",
  data: { assets: Array.from({ length: 984 }, (_, i) => ({ cells: [`cell.${i % 40}.${Math.floor(i / 40)}`], lot: `lot-${String(i % 40).padStart(2, "0")}-${String(Math.floor(i / 40)).padStart(2, "0")}`, ...(i % 7 === 0 ? { structure: `road-${i}`, type: "road" } : {}) })) } };
const habitat = { id: "habitat-map", record: "statement", kind: "habitat_map", author: "genesis", at: 0, speaks_for: "city", visible_to: ["city"], text: "The environment office's habitat map: the district's cover, area by area.",
  data: { areas: Array.from({ length: 160 }, (_, i) => ({ cover: i % 3 ? "grassland" : "wetland", h: 16, w: 16, x: 16 * (i % 10), y: 16 * Math.floor(i / 10) })) } };
const job = (who: string) => ({ id: `job-${who}`, record: "agreement", author: "genesis", at: 0, visible_to: ["city", who],
  terms: { template: "employment", parties: ["city", who], commitments: [{ who: "city", every: 14 * DAY, does: { outcome: { money: { amount: "165769", for: "wages", to: `acc-${who}` } } } }, { who, does: { outcome: { occupancy: { in: "town-hall/workplace.1", who } } } }], termination: [{ party: "city", notice: 14 * DAY }] } });
const sig = (who: string) => ({ id: `job-${who}-sig-city`, record: "signature", author: "genesis", at: 0, agreement: `job-${who}`, as: "city", speaks_for: "city", visible_to: ["city", who] });
const wages = (who: string) => ({ id: `job-${who}-wages`, record: "statement", kind: "request", author: "genesis", at: 0, speaks_for: "city", addressed_to: ["bank"], basis: `job-${who}`, visible_to: ["city", "bank"], text: `Please pay ${who}'s wages every 14 days.`,
  data: { every: 14 * DAY, outcome: { money: { amount: "128997", for: "wages", from: "acc-city", to: `acc-${who}` } } } });
const build = { id: "rec.900", record: "agreement", author: "mayor-system", speaks_for: "city", at: 3 * DAY, visible_to: ["city", "builder"], terms: { template: "construction", parties: ["city", "builder"], commitments: [{ who: "builder", does: { outcome: { structure: { type: "park", on: "lot-03-04" } } } }] } };
const charter = { id: "law-charter", record: "statement", kind: "charter", author: "genesis", at: 0, speaks_for: "city", visible_to: "public", text: "The town is governed by an elected mayor and council." };
const staff = ["c0003", "c0006", "c0007", "c0010", "c0011", "c0012"];
const papers: any[] = [charter, register, habitat, ...staff.flatMap((w) => [job(w), sig(w), wages(w)]), build];

const seat: Partial<LlmParticipantConfig> = { participant: "finance-system", title: "Finance officer",
  titles: new Map([["finance/files", "The office's files"]]), onRequest: ["finance/files"],
  kinds: new Map([["finance/payroll", "records"], ["finance/files", "records"], ["finance/treasury", "accounts"]]),
  ways: new Map([["finance/payroll", { way: "mine" }], ["finance/files", { way: "mine" }]]) };
const base = (t: number): Observation => ({ t, channels: {}, outcomes: [], inbox: [], drafts: [], positions: [{ position: "finance", entity: "city", title: "Finance officer" }] }) as unknown as Observation;
const found = (t: number, report: string, records: object[], search = true): Observation => ({ ...base(t), channels: { [report]: { kind: "records", records, ...(search ? { search: true } : {}) } } }) as unknown as Observation;

function harness(answers: (ContentBlock[] | "fail" | "too long")[], extra: Partial<LlmParticipantConfig> = {}) {
  const calls: LlmRequest[] = [];
  const notes: any[] = [];
  let n = 0;
  const adapter = { provider: "mock", model: "mock", complete: async (req: LlmRequest) => {
    calls.push(JSON.parse(JSON.stringify(req)));
    const a = answers[n++];
    if (a === "fail") throw new Error("no answer within 180 s");
    if (a === "too long") throw new Error("claude -p failed after 1 attempt (exit 1: Prompt is too long)");
    return { content: a ?? [{ type: "tool_use", id: `end-${n}`, name: "done_for_now", input: {} }], usage: { input_tokens: 1, output_tokens: 1 } } as any;
  } };
  const io = { adapter, annotate: async (a: any) => void (a.annotation === "note" && notes.push(a.data)), now: () => 0 } as any;
  const c: LlmParticipantConfig = { participant: "finance-system", entity: "city", title: "Finance officer", framing: { disclosure: "simulation", reason: "test" }, standing: [], titles: new Map(), cadenceDays: 7, draftText: () => "", ...seat, ...extra };
  return { p: createLlmParticipant(c, io), calls, notes };
}
const use = (id: string, name: string, input: object): ContentBlock => ({ type: "tool_use", id, name, input });
const resultsOf = (r: LlmRequest) => Object.fromEntries((r.messages.at(-1)!.content as any[]).filter((b) => b.type === "tool_result").map((b) => [b.tool_use_id, b.content as string]));
/** Everything a call sent, in characters: the system prompt and every message. */
const sizeOf = (r: LlmRequest) => r.system.length + r.messages.reduce((a, m) => a + (typeof m.content === "string" ? m.content.length : (m.content as any[]).reduce((b, c) => b + String(c.content ?? c.text ?? JSON.stringify(c.input ?? "")).length, 0)), 0);

test("a look into an office's own papers answers with a list, a line to a paper, never the papers whole", async () => {
  const { p, calls } = harness([[use("a", "look", { report: "finance/payroll", limit: 50 })]]);
  // (Papers it is shown as they come, with nothing to find: the latest of them, asked for newest first.)
  expect(await p.step(base(9 * HOUR), ctx)).toEqual({ type: "look", looks: [{ channel: "finance/payroll", query: { order: { field: "at", desc: true }, limit: 50 } }] });
  await p.step(found(9 * HOUR, "finance/payroll", papers), ctx);
  const shown = resultsOf(calls[1]!).a!;
  // The whole of what the papers come to is some sixty thousand characters here (a quarter of a million in the town); the list is a few thousand.
  expect(JSON.stringify(papers).length).toBeGreaterThan(50_000);
  expect(shown.length).toBeLessThan(5_000);
  expect(shown).toContain("## Finance officer: Payroll: what you looked up (22 found)");
  // Each line: the paper's id, what it is, its date, from whom, a line of what it says.
  expect(shown).toContain(`- [asset-register] asset register, from the start, from city: "The town's asset register: the land the town holds, and what stands on each lot."`);
  expect(shown).toContain("- [job-c0003] employment agreement, from the start: between city and c0003: city will pay $1,657.69 to acc-c0003 every 14 days (wages)");
  expect(shown).toContain("- [job-c0003-wages] request, from the start, from city: asks bank to pay $1,289.97 from acc-city to acc-c0003 every 14 days (wages)");
  expect(shown).toContain("- [rec.900] construction agreement, year 1, day 4, from city: between city and builder: builder will build a park on lot-03-04");
  // None of the register's entries, none of the map's areas; and how to read one paper in full.
  expect(shown).not.toContain("lot-05-00");
  expect(shown).not.toContain("wetland");
  expect(shown).toContain('(To read one in full: look at this report (finance/payroll) with paper: its id.)');
});

test("a paper is read in full when it is asked for by its id; a register or a map a part at a time, never whole", async () => {
  const { p, calls } = harness([[use("a", "look", { report: "finance/files", paper: "job-c0003" }), use("b", "look", { report: "finance/files", paper: "asset-register" }),
    use("c", "look", { report: "finance/files", paper: "asset-register", from_entry: 900 }), use("d", "look", { report: "finance/files", paper: "asset-register", words: "lot-05-03" }),
    use("e", "look", { report: "finance/files", named: ["law-charter"] }), use("f", "look", { report: "finance/files", find: [{ field: "id", value: "rec.1" }] })]]);
  // By its id, however it is named: in `paper`, as the one thing named, or as the one thing to find.
  const byId = (id: string) => ({ type: "look", looks: [{ channel: "finance/files", query: { where: [{ field: "id", op: "=", value: id }], limit: 1 } }] });
  expect(await p.step(base(9 * HOUR), ctx)).toEqual(byId("job-c0003"));
  expect(await p.step(found(9 * HOUR, "finance/files", [job("c0003")]), ctx)).toEqual(byId("asset-register"));
  await p.step(found(9 * HOUR, "finance/files", [register]), ctx);
  await p.step(found(9 * HOUR, "finance/files", [register]), ctx);
  expect(await p.step(found(9 * HOUR, "finance/files", [register]), ctx)).toEqual(byId("law-charter"));
  expect(await p.step(found(9 * HOUR, "finance/files", [charter]), ctx)).toEqual(byId("rec.1"));
  await p.step(found(9 * HOUR, "finance/files", []), ctx);
  const r = resultsOf(calls[1]!);
  // A short paper: every word of it, its notice terms too.
  expect(r.a).toContain("## The office's files: the paper job-c0003\n- [job-c0003] employment agreement between city and c0003: city will pay $1,657.69 to acc-c0003 every 14 days (wages); c0003 will come to town-hall/workplace.1");
  // The register: what it is, how many entries, the first of them, how many more and how to ask for them.
  expect(JSON.stringify(register).length).toBeGreaterThan(40_000);
  expect(r.b!.length).toBeLessThan(PAPER_MAX + 1_000);
  expect(r.b).toContain(`- [asset-register] asset register from city: "The town's asset register: the land the town holds, and what stands on each lot."`);
  expect(r.b).toContain("  Assets: 984 entries.\n  1. cells: cell.0.0; lot: lot-00-00; structure: road-0; type: road");
  expect(r.b).toMatch(/\(\d+ shown, to entry (\d+); \d+ more\. For the next: look at this paper again with from_entry: \d+; or give words, for only the entries that include them \(a lot's id, say\)\.\)/);
  expect(r.b).not.toContain("  984. ");
  // From an entry on; and only the entries with some words.
  expect(r.c).toContain("  900. ");
  expect(r.c).toContain("  984. ");
  expect(r.c).not.toContain("  899. ");
  expect(r.d).toContain('  Assets: 984 entries, 1 of them with "lot-05-03".\n  126. cells: cell.5.3; lot: lot-05-03');
  expect(r.e).toContain('- [law-charter] charter from city: "The town is governed by an elected mayor and council."');
  expect(r.f).toContain("## The office's files: the paper rec.1\nThere is no paper with that id there.");
});

test("a kind is said in plain words; a kind that finds nothing is answered with the kinds the folder holds", async () => {
  // An agreement for something is asked for as an agreement, and told from the list; a claim to something by what it is to.
  expect(kindWhere("employment agreement")).toEqual({ where: [{ field: "record", op: "=", value: "agreement" }], here: true });
  expect(kindWhere("Ownership claims")).toEqual({ where: [{ field: "record", op: "=", value: "claim" }, { field: "about.kind", op: "=", value: "ownership" }], here: false });
  expect(kindWhere("signatures")).toEqual({ where: [{ field: "record", op: "=", value: "signature" }], here: false });
  expect(kindWhere("asset register")).toEqual({ where: [{ field: "kind", op: "=", value: "asset_register" }], here: false });
  const { p, calls } = harness([[use("a", "look", { report: "finance/payroll", find: [{ field: "kind", value: "employment agreement" }] }), use("b", "look", { report: "finance/payroll", find: [{ field: "kind", value: "employment" }] }),
    use("c", "look", { report: "finance/payroll", find: [{ field: "kind", value: "payslip" }] })]]);
  expect(await p.step(base(9 * HOUR), ctx)).toEqual({ type: "look", looks: [{ channel: "finance/payroll", query: { where: [{ field: "record", op: "=", value: "agreement" }], order: { field: "at", desc: true }, limit: 200 } }] });
  // "employment" by itself is nobody's kind, word for word: asked as given first.
  expect(await p.step(found(9 * HOUR, "finance/payroll", [build, ...staff.map(job)]), ctx)).toEqual({ type: "look", looks: [{ channel: "finance/payroll", query: { where: [{ field: "kind", op: "=", value: "employment" }], order: { field: "at", desc: true }, limit: 20 } }] });
  // Nothing found: the folder's latest papers are looked through for kinds like it, with no turn taken.
  const through = { type: "look", looks: [{ channel: "finance/payroll", query: { order: { field: "at", desc: true }, limit: 200 } }] };
  expect(await p.step(found(9 * HOUR, "finance/payroll", []), ctx)).toEqual(through);
  await p.step(found(9 * HOUR, "finance/payroll", papers), ctx);
  expect(await p.step(found(9 * HOUR, "finance/payroll", []), ctx)).toEqual(through);
  await p.step(found(9 * HOUR, "finance/payroll", papers), ctx);
  expect(calls.length).toBe(2);
  const r = resultsOf(calls[1]!);
  // The six employment agreements, and not the agreement to build.
  expect(r.a).toContain("what you looked up (6 found)");
  expect(r.a).not.toContain("rec.900");
  expect(r.b).toContain('No paper there is of the kind "employment", word for word. These are of kinds like it:\n- [job-c0003] employment agreement,');
  expect(r.b).toContain("what you looked up (6 found)");
  expect(r.b).not.toContain("(0 found)");
  expect(r.c).toContain('## Finance officer: Payroll: what you looked up (0 found)\nNothing found.\n(No paper there is of the kind "payslip". The kinds of paper there: asset register (1), charter (1), construction agreement (1), employment agreement (6), habitat map (1), request (6), signature (6).)');
});

test("a folder named for payroll holds payroll papers: as they come, and looked into", async () => {
  const folders = new Map([["finance/payroll", ["employment agreement"]]]);
  const text = renderObservation(found(0, "finance/payroll", papers, false), { folders });
  expect(text).toContain("## Finance officer: Payroll (6 new)");
  expect(text).toContain("[job-c0012] employment agreement between city and c0012");
  for (const other of ["asset-register", "habitat-map", "law-charter", "rec.900", "-wages", "-sig-"]) expect(text).not.toContain(other);
  const { p, calls } = harness([[use("a", "look", { report: "finance/payroll" }), use("b", "look", { report: "finance/payroll", paper: "asset-register" })]], { folders });
  expect(await p.step(base(9 * HOUR), ctx)).toEqual({ type: "look", looks: [{ channel: "finance/payroll", query: { where: [{ field: "record", op: "=", value: "agreement" }], order: { field: "at", desc: true }, limit: 200 } }] });
  await p.step(found(9 * HOUR, "finance/payroll", [build, ...staff.map(job)]), ctx);
  await p.step(found(9 * HOUR, "finance/payroll", [register]), ctx);
  const r = resultsOf(calls[1]!);
  expect(r.a).toContain("what you looked up (6 found)");
  expect(r.a).not.toContain("rec.900");
  // The register is the town's, and in the office's files: it is not a payroll paper.
  expect(r.b).toContain("the paper asset-register\nThere is no paper with that id there.");
});

test("a payroll folder shows the standing payments that pay its agreements, as they come: a finance office is shown what the bank already pays", async () => {
  // (Wave 2c: three finance seats were shown their agreements and not the standing wage instructions the town opens
  // with; they paid by hand on top of them, or made the same standing payment twice.)
  const folders = new Map([["finance/payroll", ["employment agreement", "standing payment"]]]);
  const once = { id: "rec.901", record: "statement", author: "finance-system", at: 0, visible_to: ["city", "bank"], speaks_for: "city", kind: "request", addressed_to: ["bank"], text: "Please pay XYZ 10.00 from acc-city to acc-outside.", data: { outcome: { money: { from: "acc-city", to: "acc-outside", amount: "1000" } } } };
  const text = renderObservation(found(0, "finance/payroll", [...papers, once], false), { folders });
  expect(text).toContain("[job-c0012] employment agreement between city and c0012");
  expect(text).toContain("[job-c0012-wages]");
  // A payment asked for once, a signature and the town's other papers are still not payroll papers.
  for (const other of ["asset-register", "habitat-map", "law-charter", "rec.900", "rec.901", "-sig-"]) expect(text).not.toContain(other);
  // Looked into, the folder is still searched for its agreements (a standing payment is no kind a search can be asked).
  const { p } = harness([[use("a", "look", { report: "finance/payroll" })]], { folders });
  expect(await p.step(base(9 * HOUR), ctx)).toEqual({ type: "look", looks: [{ channel: "finance/payroll", query: { where: [{ field: "record", op: "=", value: "agreement" }], order: { field: "at", desc: true }, limit: 200 } }] });
});

test("a folder read only when chosen, looked into with nothing to find, shows what has come since the last look: a list, the newest first", async () => {
  const { p, calls } = harness([[use("a", "look", { report: "finance/files", limit: 5 })]]);
  expect(await p.step(base(9 * HOUR), ctx)).toEqual({ type: "look", looks: [{ channel: "finance/files" }] });
  await p.step(found(9 * HOUR, "finance/files", papers, false), ctx);
  const shown = resultsOf(calls[1]!).a!;
  expect(shown).toContain("## The office's files: new since you last looked (22)\n- [rec.900] construction agreement, year 1, day 4, from city");
  expect(shown).toContain("(17 earlier ones not listed: say what to find (a kind, who from, since when, what about), or, for the next, look again with from_entry: 6.)");
  expect(shown.length).toBeLessThan(2_000);
});

test("what one look adds has a ceiling, said where it cuts and noted", async () => {
  // Fifty papers, each with a long line: a list still fits. A report of places has no such bound of its own: cut.
  const { p, calls, notes } = harness([[use("a", "look", { report: "finance/town", named: ["house"], limit: 50 })]], { kinds: new Map([["finance/town", "sites"]]), ways: new Map([["finance/town", { way: "here" }]]) });
  await p.step(base(9 * HOUR), ctx);
  const cells = Array.from({ length: 50 }, (_, i) => ({ cell: `cell.${i}.0`, x: i, y: 0, structure: { structure: `house-${i}`, type: "house", at: `cell.${i}.0`, w: 1, h: 1, complete: true,
    spaces: Array.from({ length: 12 }, (_, k) => ({ space: `house-${i}/dwelling.${k}`, kind: "dwelling", count: 2, capacity: 4, occupants: ["someone-with-a-long-name", "another-with-a-long-name"] })) } }));
  await p.step({ ...base(9 * HOUR), channels: { "finance/town": { kind: "sites", as_of: 0, cells } } } as any, ctx);
  const shown = resultsOf(calls[1]!).a!;
  expect(shown.length).toBeLessThan(LOOK_CHARS_MAX + 400);
  expect(shown).toMatch(/\(Cut short here: one look shows at most 12,000 characters, and this came to [\d,]+\. Say more closely what you want to see, or ask for less at once\.\)$/);
  expect(notes.find((n) => n.look_cut)).toMatchObject({ look_cut: { report: "finance/town", limit: LOOK_CHARS_MAX } });
  // The seat is told the ceiling where its tool is described.
  expect(tools({ ...seat, participant: "x", entity: "city", framing: { disclosure: "simulation", reason: "" }, standing: [], titles: new Map(), cadenceDays: 7, draftText: () => "" } as any).find((t) => t.name === "look")!.description).toContain("One look shows at most 12,000 characters.");
});

test("a whole prompt has a ceiling: the oldest of what was looked up is left out first, with a line where it stood, and it is noted", async () => {
  // Thirty looks in a sitting, eight a turn, each bringing nearly the most one look shows: more than a prompt may be.
  const turns = [0, 1, 2, 3].map((t) => Array.from({ length: 8 }, (_, k) => use(`l${t}-${k}`, "look", { report: "finance/files", paper: `p${t}-${k}` })));
  const { p, calls, notes } = harness(turns, { promptMax: 60_000 });
  const big = (id: string) => ({ id, record: "statement", kind: "minutes", author: "clerk", at: 0, visible_to: "public", text: `${id}: ${"word ".repeat(1_100)}` });
  await p.step(base(9 * HOUR), ctx);
  for (let t = 0; t < 4; t++) for (let k = 0; k < 8; k++) await p.step(found(9 * HOUR, "finance/files", [big(`p${t}-${k}`)]), ctx);
  expect(calls.length).toBe(5);
  for (const c of calls) expect(sizeOf(c)).toBeLessThanOrEqual(60_000);
  // The last call: the latest looks whole, the earliest left out, each with the line; nothing else touched.
  const last = calls[4]!;
  expect(resultsOf(last)["l3-7"]).toContain("p3-7: word word");
  const first = Object.fromEntries((last.messages[2]!.content as any[]).map((b) => [b.tool_use_id, b.content]));
  expect(first["l0-0"]).toBe(LOOK_LEFT_OUT);
  expect(LOOK_LEFT_OUT).toContain("Look again for what you need.");
  expect(last.messages[0]!.content).toContain("Your notebook: (empty)");
  const trimmed = notes.filter((n) => n.prompt_trimmed);
  expect(trimmed.length).toBeGreaterThan(0);
  expect(trimmed.at(-1).prompt_trimmed).toMatchObject({ limit: 60_000, cut: false });
  expect(trimmed.at(-1).prompt_trimmed.characters_before).toBeGreaterThan(60_000);
  expect(trimmed.at(-1).prompt_trimmed.characters).toBeLessThanOrEqual(60_000);
  // The ceiling as it stands for every seat, and what fitting does to a prompt already within it: nothing.
  expect(PROMPT_MAX).toBe(150_000);
  const small = [{ role: "user" as const, content: "Your notebook: (empty)" }];
  expect(fitPrompt("system", small, PROMPT_MAX, new Set())).toEqual({ system: "system", messages: small, characters: 28 });
  // Words alone, more than fits (what came in between sittings, with what was looked up for the opening): the parts
  // looked up go first, then the rest; the opening lines and the letters stay; and it is never over.
  const opening = `Your notebook: mine\n\nIt is year 1, day 2.\n\n## Letters\n- From clerk: "Please read."\n\n## Looked up for you, as at every sitting: files\n${"x".repeat(30_000)}\n\n## The office's files: what you looked up (20 found)\n${"y".repeat(30_000)}\n\n## Treasury\n- acc-city: 1`;
  const fit = fitPrompt("system", [{ role: "user", content: opening }], 20_000, new Set());
  expect(fit.characters).toBeLessThanOrEqual(20_000);
  expect(fit.left).toMatchObject({ looks: 0, parts: 2, cut: false });
  expect(fit.messages[0]!.content).toBe(`Your notebook: mine\n\nIt is year 1, day 2.\n\n## Letters\n- From clerk: "Please read."\n\n(Left out here, so that this is not more than can be read at once: 2 parts of what you had looked up. Look again for what you need.)\n\n## Treasury\n- acc-city: 1`);
  // One part longer than everything allowed: cut, and said.
  const one = fitPrompt("system", [{ role: "user", content: `Your notebook: mine\n\n${"z".repeat(50_000)}` }], PROMPT_MIN, new Set());
  expect(one.characters).toBeLessThanOrEqual(PROMPT_MIN);
  expect(one.left!.cut).toBe(true);
  expect(one.messages[0]!.content).toContain("(Cut short here: there was more than can be read at once. Look again for what you need.)");
});

test("a report set to come at every sitting obeys the same ceilings", async () => {
  const many = Array.from({ length: 6 }, (_, k) => use(`l${k}`, "look", { report: "finance/files", paper: `p${k}`, each_sitting: true }));
  const { p, calls } = harness([many, [use("d", "done_for_now", { days: 1 })], [use("d2", "done_for_now", { days: 1 })]], { promptMax: 30_000, sessions: { start: 9 * HOUR, end: 17 * HOUR, days: 7 } });
  // Each of the six is a paper far longer than a look shows.
  const huge = (id: string) => ({ id, record: "statement", kind: "minutes", author: "clerk", at: 0, visible_to: "public", text: `${id}: ${"word ".repeat(40_000)}` });
  await p.step(base(9 * HOUR), ctx);
  for (let k = 0; k < 6; k++) await p.step(found(9 * HOUR, "finance/files", [huge(`p${k}`)]), ctx);
  // The next sitting opens on all six looked up again, and is still within what a prompt may be.
  for (let k = 0; k < 7; k++) await p.step(k === 0 ? base(DAY + 9 * HOUR) : found(DAY + 9 * HOUR, "finance/files", [huge(`p${k - 1}`)]), ctx);
  expect(calls.length).toBe(3);
  const opening = calls[2]!;
  expect(opening.messages.length).toBe(1);
  expect(sizeOf(opening)).toBeLessThanOrEqual(30_000);
  // (Six papers at the most one paper shows are more than this seat's prompt may be: the first looked up are left out, and it is said.)
  expect(opening.messages[0]!.content as string).toContain("parts of what you had looked up. Look again for what you need.)");
  expect(opening.messages[0]!.content as string).toContain("## The office's files: the paper p5");
  // (One paper never comes to more than a look shows, however long it is.)
  expect(resultsOf(calls[1]!).l5!.length).toBeLessThan(PAPER_MAX + 600);
  expect(resultsOf(calls[1]!).l5).toContain("(Cut short at 6,000 of its 200,");
});

test("a prompt its model would not take is noted, told to the seat, and never sent again unchanged", async () => {
  const sessions = { start: 9 * HOUR, end: 17 * HOUR, days: 7 };
  const { p, calls, notes } = harness(["too long", [use("d", "done_for_now", { days: 1 })]], { sessions });
  const letters = (t: number) => ({ ...base(t), inbox: [{ from: "clerk", t, text: "A long letter. ".repeat(2_000) }], channels: { "finance/bills": { kind: "records", records: Array.from({ length: 30 }, (_, i) => ({ id: `rec.${i}`, record: "statement", kind: "invoice", author: "works", at: t, visible_to: ["city"], text: "An invoice. ".repeat(60) })) } } }) as unknown as Observation;
  await expect(p.step(letters(9 * HOUR), ctx)).rejects.toThrow("Prompt is too long");
  const sent = sizeOf(calls[0]!);
  const limit = Math.floor(sent / 2);
  expect(notes.find((n) => n.prompt_too_long)).toMatchObject({ prompt_too_long: { characters: sent, limit_was: PROMPT_MAX, limit_now: limit } });
  // The next sitting: what was kept for it is set out again, within half of what was refused; and it is told why.
  await p.step(base(DAY + 9 * HOUR), ctx);
  expect(calls.length).toBe(2);
  expect(sizeOf(calls[1]!)).toBeLessThanOrEqual(limit);
  expect(JSON.stringify(calls[1]!.messages)).not.toBe(JSON.stringify(calls[0]!.messages));
  const shown = calls[1]!.messages[0]!.content as string;
  expect(shown).toContain("When you were last to sit, more was set out for you than could be read at once, so that sitting was not held. Less is set out now: the oldest of what you had looked up is left out, and says so where it stood. Look again for what you need, a little at a time.");
  expect(notes.some((n) => n.prompt_trimmed)).toBe(true);
  // (Again and again: the ceiling comes down each time, to a floor a notebook and a day's letters fit in.)
  const again = harness(Array.from({ length: 6 }, () => "too long" as const), { sessions });
  for (let d = 0; d < 6; d++) await expect(again.p.step(letters(d * DAY + 9 * HOUR), ctx)).rejects.toThrow();
  const sizes = again.calls.map(sizeOf);
  for (let k = 1; k < sizes.length; k++) expect(sizes[k]! < sizes[k - 1]! || sizes[k]! <= PROMPT_MIN).toBe(true);
  expect(again.notes.filter((n) => n.prompt_too_long).at(-1).prompt_too_long.limit_now).toBe(PROMPT_MIN);
});

test("risk SF-2: a long standing part (a lender's book) goes before the seat's own look-ups", () => {
  const opening = `Your notebook: mine\n\n## Letters\n- From clerk: "Hi."\n\n## The book of loans\n${"L".repeat(60_000)}\n\n## Treasury\n- acc-city: 1`;
  const messages = [{ role: "user" as const, content: opening }, { role: "assistant" as const, content: [{ type: "tool_use" as const, id: "k1", name: "look", input: {} }] }, { role: "user" as const, content: [{ type: "tool_result" as const, tool_use_id: "k1", content: "mine ".repeat(2_000) }] }] as any;
  const fit = fitPrompt("system", messages, 40_000, new Set(["k1"]));
  expect(fit.characters).toBeLessThanOrEqual(40_000);
  expect(fit.left).toMatchObject({ looks: 0, parts: 1, cut: false });
  expect(fit.messages[2]!.content[0].content).toBe("mine ".repeat(2_000));
  expect(fit.messages[0]!.content).toContain("## Treasury");
  expect(fit.messages[0]!.content).not.toContain("LLLL");
});
