// The counter (docs/behaviour/standing-work.md, "The counter: routine post answered by the staff"): what an office's own
// procedure says is routine is answered by its staff, under a standing work order for it; a seat is not brought back for
// it, and sees a count and a sample; what is addressed to the office-holder's own post, or rests on a paper of theirs,
// reaches them whatever its kind. Here: the three parts of the works office and of the registry; the seat's waking; the
// folder as the seat reads it; the generator's procedure.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../../worlds/generator/generate";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import type { Observation } from "../src/contracts";
import type { ContentBlock, LlmRequest } from "../src/llm/adapter";
import { createLlmParticipant, type LlmParticipantConfig } from "../src/llm/participant";
import { modules } from "../src/index";
import { renderObservation } from "../src/llm/render";
import { inCurrency } from "../src/money";
import { context, DAY, statement, wake } from "./stepping";
import { engine } from "./engine";

inCurrency({ code: "XYZ", minor_units: 2 });
const HOUR = 3_600;

// ---- the code offices, in their parts ----
const order = (id: string, at: number, task: string, x: { in_position?: string } = {}) =>
  statement(id, at, "work_order", { author: "works-system", in_position: x.in_position ?? "works", addressed_to: ["city"], visible_to: ["city"], data: { work: { task, at: "town-hall" }, every: DAY } });
const hold = (id: string, at: number, held: string[]) => statement(id, at, "hold", { addressed_to: ["city"], visible_to: ["city"], data: { holds: held } });
const complaint = (id: string, structure: string) => statement(id, 6 * DAY, "complaint", { author: "c0001-self", speaks_for: "c0001", addressed_to: ["city"], visible_to: ["city", "c0001"], data: { structure } });

const worksParams = { depot: "town-hall", workplace: "town-hall/workplace.1", landfill: "outside", wage: 300_000, period: 14 * DAY, round: "round", collect_labour: 60, collect_per_unit: 10_000, maintain_labour: 3600, maintain_per_unit: 100, depot_channel: "depot" };
const job = (id: string, worker: string) => [{ id, at: 0, author: "works-system", record: "agreement", visible_to: ["city", worker], terms: { template: "employment", parties: ["city", worker], commitments: [{ who: "city", does: { outcome: { money: { to: `acc-${worker}`, amount: "300000", for: "Pay." } } }, every: 14 * DAY }, { who: worker, does: { text: "Works.", outcome: { work: { at: "town-hall/workplace.1" } } } }] }, text: id },
  ...["city", worker].map((as) => ({ id: `sig-${id}-${as}`, at: 0, author: "x", record: "signature", agreement: id, as, visible_to: ["city", worker] }))];
const shown = (...extra: object[]) => ({
  all: { kind: "records", records: [...job("job-1", "c0001"), ...job("job-2", "c0002"), ...extra] },
  round: { kind: "records", records: ["house-1", "house-2"].map((s) => statement(`round-${s}`, 0, "service_address", { visible_to: ["city"], data: { structure: s } })) },
  depot: { kind: "sites", cells: [{ cell: "cell.1.1", x: 1, y: 1, structure: { structure: "town-hall", type: "civic", at: "cell.1.1", complete: true, spaces: [{ space: "town-hall/workplace.1", kind: "workplace", capacity: 20, count: 2, occupants: ["c0001", "c0002"] }] } }] },
});
const works = (part: string, counter: boolean) => engine("city.works").create(context(`works${part === "staff" ? "-staff" : ""}-system`, "city", { ...worksParams, part, ...(counter ? { counter: true } : {}) }, { position: part === "staff" ? "works-staff" : "works" }));
const MONDAY = 7 * DAY + 8 * 3600;
const reportOf = (w: ReturnType<typeof wake>) => w.of("statement", "staff_report")[0]?.args.text as string | undefined;
const answered = (w: ReturnType<typeof wake>) => /answered at the counter: ([^;.]+)/.exec(reportOf(w) ?? "")?.[1];

test("the works counter: the staff answer a complaint only while an answer order is in force, not without one, not on hold", () => {
  const go = (...extra: object[]) => wake(works("staff", true), MONDAY, shown(complaint("rec.9", "house-2"), ...extra), { entity: "city" });
  expect(answered(go())).toBeUndefined();
  expect(reportOf(go())).toContain("answer: not being done: no standing work order for answer is on file");
  expect(answered(go(order("rec.1", DAY, "answer")))).toBe("1 complaint");
  expect(answered(go(order("rec.1", DAY, "answer"), hold("rec.2", 2 * DAY, ["rec.1"])))).toBeUndefined();
});

test("the works seat does not answer the counter's post; the whole office does, as ever; and with no counter offered every part is as it was", () => {
  // (The home complained about is collected first by the part that read the complaint: here the crew's hours run to one home.)
  const round = (w: ReturnType<typeof wake>) => w.of("work").filter((c) => c.args.task === "collect" && !c.args.every).map((c) => c.args.on);
  expect(round(wake(works("", true), MONDAY, shown(complaint("rec.9", "house-2")), { entity: "city" }))).toContain("house-2");
  // The seat sets the answer order once, with its others.
  const m = works("seat", true);
  const first = wake(m, MONDAY, shown(), { entity: "city" });
  expect(first.of("work").map((c) => c.args.task)).toEqual(["collect", "maintain", "answer"]);
  expect(wake(m, MONDAY + DAY, shown(), { entity: "city" }).of("work")).toEqual([]);
  // Not offered: no answer order is set, no report line for it, and the staff answer a complaint with no order, as ever.
  expect(wake(works("seat", false), MONDAY, shown(), { entity: "city" }).of("work").map((c) => c.args.task)).toEqual(["collect", "maintain"]);
  const staff = wake(works("staff", false), MONDAY, shown(complaint("rec.9", "house-2"), order("rec.1", DAY, "collect")), { entity: "city" });
  expect(reportOf(staff)).not.toContain("answer");
  expect(reportOf(staff)).not.toContain("answered at the counter");
});

const registryOf = (part: string, counter: boolean) => engine("city.registry").create(context(`registry${part === "staff" ? "-staff" : ""}-system`, "city", { part, ...(counter ? { counter: true } : {}) }, { position: part === "staff" ? "registry-staff" : "registry" }));
const notification = (id: string, kind: string, data: object) => statement(id, 100, kind, { author: "c0002-self", speaks_for: "c0002", addressed_to: ["city"], visible_to: ["city"], data });
const posts = [notification("rec.5", "death_notification", { deceased: "c0001" }), notification("rec.6", "birth_notification", { child: "c0009", born_at: 90, mother: "c0002" })];
const regOrder = (id: string) => statement(id, DAY, "work_order", { author: "registry-system", in_position: "registry", addressed_to: ["city"], visible_to: ["city"], data: { work: { task: "answer", at: "registry" }, every: DAY } });
const entered = (w: ReturnType<typeof wake>) => [...w.of("statement", "death_registration"), ...w.of("statement", "birth_registration")].length;

test("the registry counter enters death and birth notifications by the staff under an order; the seat enters none; the whole office, as ever", () => {
  const T = 2 * DAY + 9 * HOUR;
  const go = (part: string, counter: boolean, ...extra: object[]) => wake(registryOf(part, counter), T, { all: { kind: "records", records: [...posts, ...extra] } }, { entity: "city" });
  expect(entered(go("", true))).toBe(2);
  expect(entered(go("seat", true))).toBe(0);
  expect(entered(go("staff", true))).toBe(0);
  expect(entered(go("staff", true, regOrder("rec.1")))).toBe(2);
  expect(entered(go("staff", true, regOrder("rec.1"), hold("rec.2", DAY, ["rec.1"])))).toBe(0);
  expect(answered(go("staff", true, regOrder("rec.1")))).toBe("1 birth notification, 1 death notification");
  // The seat sets the order once; where no counter is offered the registry has none to set, and its staff, as ever, enter at once.
  expect(go("seat", true).of("work").map((c) => c.args.task)).toEqual(["answer"]);
  expect(go("seat", false).of("work")).toEqual([]);
  expect(entered(go("staff", false))).toBe(2);
});

test("two offices of one organisation each have their own order for answer: the registry's does not replace the works office's", () => {
  const T = 2 * DAY + 9 * HOUR;
  // (Found in a run of the 1,000-person town: the registrar's later order for `answer` stood in place of the works office's.)
  const both = [order("rec.1", DAY, "answer"), regOrder("rec.2")];
  expect(answered(wake(works("staff", true), MONDAY, shown(complaint("rec.9", "house-2"), ...both), { entity: "city" }))).toBe("1 complaint");
  expect(reportOf(wake(works("staff", true), MONDAY, shown(complaint("rec.9", "house-2"), ...both), { entity: "city" }))).not.toContain("replaced");
  const onlyWorks = [order("rec.1", DAY, "answer")];
  expect(entered(wake(registryOf("staff", true), T, { all: { kind: "records", records: [...posts, ...onlyWorks] } }, { entity: "city" }))).toBe(0);
});

// ---- the seat ----
const ctx = { world: { currency: PROFILE.values.currency } } as any;
const use = (id: string, name: string, input: object): ContentBlock => ({ type: "tool_use", id, name, input });
const procedure = (extra: object = {}) => ({ id: "proc-works-routines", record: "statement", kind: "procedure", author: "genesis", speaks_for: "city", at: 0, visible_to: ["city"], text: "The routine work.", data: { routines: [{ task: "collect", at: "depot" }, { task: "answer", at: "depot", papers: [{ kind: "complaint", how: "a complaint of a collection missed puts the home first on the next round" }] }] }, ...extra });
const answerOrder = (id = "wo.1") => ({ id, record: "statement", kind: "work_order", author: "works-system", speaks_for: "city", at: 0, visible_to: ["city"], text: "Answer.", data: { work: { task: "answer", at: "depot" }, every: DAY } });
const holdOn = (id: string, held: string[]) => ({ id, record: "statement", kind: "hold", author: "works-system", speaks_for: "city", at: 0, visible_to: ["city"], text: "Hold.", data: { holds: held } });
const paper = (id: string, kind: string, at: number, more: object = {}) => ({ id, record: "statement", kind, author: "c0001-self", speaks_for: "c0001", at, text: `${kind} ${id}.`, visible_to: ["city"], addressed_to: ["city"], data: kind === "complaint" ? { structure: "house-1" } : {}, ...more });
const at = (t: number, tray: object[] = [], standing: object[] = []): Observation => ({ t, channels: { "works/in-tray": { kind: "records", records: tray }, standing: { kind: "records", records: standing } }, outcomes: [], inbox: [], drafts: [],
  positions: [{ position: "works", entity: "city", title: "Works manager" }] }) as unknown as Observation;
const seatCfg: Partial<LlmParticipantConfig> = { sessions: { start: 9 * HOUR, end: 17 * HOUR, days: 5 }, trays: { kinds: new Map([["works/in-tray", true as const]]), all: new Set() }, ownAuthors: ["works-staff-system"] };
function harness(extra: Partial<LlmParticipantConfig> = {}) {
  const calls: LlmRequest[] = [];
  const adapter = { provider: "mock", model: "mock", complete: async (req: LlmRequest) => { calls.push(JSON.parse(JSON.stringify(req))); return { content: [use(`d${calls.length}`, "done_for_now", { days: 7 })], usage: { input_tokens: 1, output_tokens: 1 } } as any; } };
  const io = { adapter, annotate: async () => {}, now: () => 0 } as any;
  const c = { participant: "works-system", entity: "city", title: "Works manager", framing: { disclosure: "simulation", reason: "test" }, standing: ["standing"], titles: new Map(), cadenceDays: 7, draftText: undefined, ...seatCfg, ...extra } as unknown as LlmParticipantConfig;
  return { p: createLlmParticipant(c, io), calls };
}
const shownText = (r: LlmRequest) => String(r.messages.at(-1)!.content);
const stand = [procedure(), answerOrder()];
const registryStand = [{ ...procedure({ id: "proc-registry-routines" }), data: { office: "registry", routines: [{ task: "answer", at: "registry", papers: [{ kind: "birth_notification", how: "entered in the register" }] }] } },
  { ...answerOrder("wo.2"), in_position: "registry" }];

test("a seat is not brought back for a complaint the counter answers; it is for one addressed to its post, or resting on a paper of its own, or of another kind", async () => {
  const { p, calls } = harness();
  await p.step(at(9 * HOUR, [], stand), ctx);
  expect(calls.length).toBe(1);
  // Complaints on the second day: the counter's. No sitting on the third.
  expect(await p.step(at(DAY + 14 * HOUR, [paper("rec.1", "complaint", DAY + 14 * HOUR), paper("rec.2", "complaint", DAY + 14 * HOUR)]), ctx)).toEqual({ type: "wait", until: 2 * DAY + 9 * HOUR });
  expect(await p.step(at(2 * DAY + 9 * HOUR), ctx)).toMatchObject({ type: "wait" });
  expect(calls.length).toBe(1);
  // One addressed to the seat's own post by name comes to it.
  await p.step(at(2 * DAY + 14 * HOUR, [paper("rec.3", "complaint", 2 * DAY + 14 * HOUR, { addressed_to: ["works"] })]), ctx);
  await p.step(at(3 * DAY + 9 * HOUR), ctx);
  expect(calls.length).toBe(2);
  expect(shownText(calls[1]!)).toContain("papers were filed with your office (1 complaint)");
  // So does another kind of paper, whatever the procedure lists of complaints.
  await p.step(at(3 * DAY + 14 * HOUR, [paper("rec.4", "request", 3 * DAY + 14 * HOUR)]), ctx);
  await p.step(at(4 * DAY + 9 * HOUR), ctx);
  expect(calls.length).toBe(3);
});

test("a complaint resting on a paper the seat made comes to it; a staff paper never does", async () => {
  const { p, calls } = harness();
  await p.step(at(9 * HOUR, [{ ...paper("seat.7", "notice", 0), author: "works-system", speaks_for: "city" }], stand), ctx);
  await p.step(at(DAY + 14 * HOUR, [paper("rec.1", "complaint", DAY + 14 * HOUR, { basis: "seat.7" })]), ctx);
  await p.step(at(2 * DAY + 9 * HOUR), ctx);
  expect(calls.length).toBe(2);
  const { p: q, calls: more } = harness();
  await q.step(at(9 * HOUR, [], stand), ctx);
  await q.step(at(DAY + 14 * HOUR, [paper("rec.1", "complaint", DAY + 14 * HOUR, { basis: "staff.7" })]), ctx);
  await q.step(at(2 * DAY + 9 * HOUR), ctx);
  expect(more.length).toBe(1);
});

test("a seat reads its own office's procedure and order, not another office's of the same organisation", async () => {
  // Only the registry has a counter: the works seat is brought back by a complaint.
  const { p, calls } = harness();
  await p.step(at(9 * HOUR, [], [procedure(), ...registryStand]), ctx);
  await p.step(at(DAY + 14 * HOUR, [paper("rec.1", "complaint", DAY + 14 * HOUR)]), ctx);
  await p.step(at(2 * DAY + 9 * HOUR), ctx);
  expect(calls.length).toBe(2);
  // Both have one: the works seat's complaints are the counter's.
  const { p: q, calls: more } = harness();
  await q.step(at(9 * HOUR, [], [{ ...procedure(), data: { office: "works", ...procedure().data } }, { ...answerOrder(), in_position: "works" }, ...registryStand]), ctx);
  await q.step(at(DAY + 14 * HOUR, [paper("rec.1", "complaint", DAY + 14 * HOUR)]), ctx);
  await q.step(at(2 * DAY + 9 * HOUR), ctx);
  expect(more.length).toBe(1);
});

test("without an order in force, or on hold, or without the kind in the procedure, a complaint brings the seat back as it always did", async () => {
  for (const standing of [[procedure()], [procedure(), answerOrder(), holdOn("h.1", ["wo.1"])], [procedure({ data: { routines: [{ task: "collect", at: "depot" }] } }), answerOrder()]]) {
    const { p, calls } = harness();
    await p.step(at(9 * HOUR, [], standing), ctx);
    await p.step(at(DAY + 14 * HOUR, [paper("rec.1", "complaint", DAY + 14 * HOUR)]), ctx);
    await p.step(at(2 * DAY + 9 * HOUR), ctx);
    expect(calls.length).toBe(2);
  }
});

test("a folder gives the counter's papers as a count and a sample, and lists what reaches the seat", () => {
  const complaints = Array.from({ length: 12 }, (_, i) => paper(`rec.${i + 1}`, "complaint", DAY + i));
  const reaches = paper("rec.90", "complaint", DAY + 50, { addressed_to: ["works"] });
  const other = paper("rec.91", "request", DAY + 60);
  const o = { t: 2 * DAY, channels: { "works/in-tray": { kind: "records", records: [...complaints, reaches, other] } }, outcomes: [], inbox: [], drafts: [], positions: [{ position: "works", entity: "city" }] } as unknown as Observation;
  const counters = (r: any) => r.kind === "complaint" && !(r.addressed_to ?? []).includes("works");
  const text = renderObservation(o, { counter: { counters } });
  expect(text).toContain("Answered at your counter under your standing order (12): 12 complaints. A sample:");
  expect(text).toContain("complaint rec.12.");
  expect(text).toContain("complaint rec.10.");
  expect(text).not.toContain("complaint rec.9.");
  expect(text).toContain("For you (2):");
  expect(text).toContain("complaint rec.90."); // (addressed to its post: listed)
  expect(text).toContain("request rec.91.");
  expect(text).toContain("## Works: In-tray (14 new)");
  // Without a counter: line by line as ever.
  expect(renderObservation(o)).not.toContain("Answered at your counter");
});

// ---- the generator ----
const root = join(import.meta.dir, "../..");
const spec = () => Bun.YAML.parse(readFileSync(join(root, "worlds/town-1000.yaml"), "utf8")) as any;
const procs = (c: any) => c.world.records.filter((r: any) => /^proc-.+-routines$/.test(r.id));

test("the generator: a living town offers the counter (procedure, data, staff post); `counter: false` or no `living` offers none", () => {
  const on = generate({ ...spec(), mayor: "llm", model_seats: "works,registry", living: {} }) as any;
  const works = on.world.records.find((r: any) => r.id === "proc-works-routines");
  expect(works.text).toContain("The office's counter staff answer, under a standing order for answer: complaint (");
  expect(works.text).toContain("Anything addressed to the office-holder by name, or resting on a paper of theirs, comes to them whatever its kind");
  expect(works.data.routines.find((r: any) => r.task === "answer").papers.map((p: any) => p.kind)).toEqual(["complaint"]);
  const reg = on.world.records.find((r: any) => r.id === "proc-registry-routines");
  expect(reg.data.routines[0].papers.map((p: any) => p.kind)).toEqual(["death_notification", "birth_notification"]);
  for (const living of [{ counter: false }, undefined]) {
    const off = generate({ ...spec(), mayor: "llm", model_seats: "works,registry", ...(living ? { living } : {}) }) as any;
    expect(procs(off).map((r: any) => r.id)).toEqual(["proc-works-routines"]);
    expect(procs(off)[0].text).not.toContain("counter staff");
    expect(procs(off)[0].data.routines.every((r: any) => !r.papers && r.task !== "answer")).toBe(true);
    expect(JSON.stringify(off)).not.toContain('"counter":true');
  }
  expect(JSON.stringify(on)).toContain('"counter":true');
});
