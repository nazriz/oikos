// The training data in the seats' voice (translator/train/data.ts; eval/pilot-style.md is the style source): long
// requests of one act, letters asked for indirectly with the words asked of them marked by the writer, and refusals
// as long and as qualified as the rest.
import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import type { LlmAdapter } from "@oikos/participants/llm";
import {
  CLOSE, DEAL, OPEN, SEATS, STYLES, fromWritten, generate, indirectNotes, isLetter, literals, marked, planOf, refusalBriefs, refusalRequestBrief, refusalWriterSystem, requestBrief, sampler, shapeOf, split, strayIds, styleBrief,
  withText, writerSystem, type Gold, type PlanItem, type RefusalBrief, type WrittenRequest,
} from "../train/data";

const g = (program: string, extra: Partial<Gold> = {}): Gold => ({ program, shape: shapeOf(calls.parseProgram(program)), names: {}, source: "t", origin: "synthetic", ...extra });
/** Twelve acts of twelve kinds, several about the same person (so related ones can be run together). */
const ACTS = [
  'money(to=acc-c0003, amount="$500", from=acc-city, for="wages")', "occupancy(who=c0003, in=apts-3/dwelling.2)", "position(appoint=pos.4, to=c0003)", 'work(task=make, units="3", at=str.7, by=c0003)',
  'goods(kind=bricks, quantity="40", to=c0003, at=str.9)', "account(holder=c0003)", "vote(ballot=rec.3, choice=yes)", 'entity(kind=trust, name="River Land Trust")', "structure(type=park, on=lot-12-03)",
  "statement(withdraw=rec.44)", "claim(release=rec.9)", "system(retire=par.5)",
].map((p) => g(p));
const LETTERS = [
  'message(to=pos.7, text="Please send me the minutes by Friday.")', 'message(to=ent.177, text="The depot opens on Monday.")', 'message(to=["c0042","ent.9"], text="Work on the hall starts tomorrow.")',
  'message(to="the works manager", text="Please bring the keys by noon.")', 'message(to=harrow-works, text="We have not received the invoice.")', 'message(to=c0007, text="Thank you for the estimate.")',
].map((p) => g(p));

/** What follows the act in a stand-in's `late` request: sentences that qualify it and ask for nothing more. */
const QUALIFIED = " Preserve the existing arrangements and their history as they stand. Do not reverse, cancel or replace anything already done. This authorises no further step of any kind. If it cannot be done as asked, report that limitation rather than substituting something else. Show the exact change for confirmation before it is carried out.";
const programIn = (brief: string) => brief.slice("Call:\n".length, brief.indexOf("\n\nWhat it brings about"));
/** The words a style says to open with, to include and to end with, if it gives any. */
const opening = (brief: string) => /Open with exactly these words: "([^"]+)"/.exec(brief)?.[1];
const cited = (brief: string) => /Include exactly these words[^:]*: "([^"]+)"/.exec(brief)?.[1];
const closing = (brief: string) => [.../End with exactly [^:]+: (.+)$/.exec(brief)?.[1]?.matchAll(/"([^"]+)"/g) ?? []].map((m) => ` ${m[1]}`).join("");
/**
 * What a stand-in writer says to a brief, whoever it is and however the brief reached it. A situation: its own line
 * (whatever it names is in it), at length in the `late` voice. A letter asked indirectly: a direction with the words
 * asked of them marked. Any other call: its literals in a sentence; in the `late` voice, with sentences after it.
 */
const say = (brief: string): string => {
  const mark = Bun.hash(brief).toString(36);
  const late = brief.includes("careful, defensive instruction");
  if (!brief.startsWith("Call:\n")) return `Request ${mark}, about this: ${brief.split("\n")[1]}${late ? QUALIFIED : ""}`;
  const open = `${opening(brief) ? `${opening(brief)}, ` : ""}${cited(brief) ? `${cited(brief)}, ` : ""}`;
  if (brief.includes("Asked indirectly")) {
    const to = literals(calls.parseProgram(programIn(brief))).filter((l) => l !== `${OPEN}…${CLOSE}`);
    return `${open}direct ${to.join(" and ")} to ${OPEN}inspect the drains at the depot (${mark}) and report when it is complete${CLOSE}.${late ? " This is a direction only." : ""}${closing(brief)}`;
  }
  return `${open}carry this out (${mark}): ${literals(calls.parseProgram(programIn(brief))).join(", ")}.${late ? QUALIFIED : ""}${closing(brief)}`;
};
const model = (name: string, how: (brief: string) => string = say): LlmAdapter => ({ provider: "stand-in", model: name, complete: async (req) => ({ content: [{ type: "text", text: how(String((req.messages[0] as any).content)) }], usage: { input_tokens: 1, output_tokens: 1 } }) });
const written = (items: PlanItem[], how: (t: PlanItem) => string = (t) => say(t.brief)): WrittenRequest[] => items.map((t) => ({ id: t.id, request: how(t) }));

test("the seats' two voices are half of what is dealt, beside every older style; the late one is told which sentences follow its act", () => {
  for (const s of SEATS) expect(Object.keys(STYLES)).toContain(s);
  // Every other request in a seat's voice, late more often than early; no older style is lost.
  expect(DEAL.filter((s) => SEATS.includes(s)).length).toBe(DEAL.length / 2);
  expect(DEAL.every((s, i) => SEATS.includes(s) === (i % 2 === 1))).toBe(true);
  expect(new Set(DEAL)).toEqual(new Set(Object.keys(STYLES)));
  expect(DEAL.filter((s) => s === "late").length).toBeGreaterThan(DEAL.filter((s) => s === "early").length);
  const plan = planOf(ACTS, { writers: ["w"], perGold: 2, seed: 2 });
  expect(plan.filter((t) => SEATS.includes(t.style)).length).toBe(ACTS.length);
  // (A program asked for twice is asked for in a seat's voice and in another.)
  for (const a of ACTS) expect(plan.filter((t) => t.kind === "request" && t.gold.program === a.program).map((t) => SEATS.includes(t.style)).sort()).toEqual([false, true]);
  // Early: descriptions with ids in brackets, about 300 characters; a capacity to open with half the time, one of
  // the three ways the first pilots' mayor wrote his, and a rider like any capacity.
  expect(STYLES.early).toContain("the works manager [works]");
  expect(STYLES.early).toContain("about 300 characters");
  const rand = sampler(7);
  const early = Array.from({ length: 200 }, () => styleBrief("early", ACTS[0]!, rand));
  const opened = early.filter((b) => b.riders.length);
  expect(opened.length).toBeGreaterThan(60);
  expect(opened.length).toBeLessThan(140);
  for (const b of opened) {
    expect(b.riders).toEqual([{ kind: "capacity", text: expect.stringMatching(/^As ([a-z ]+|[A-Z][A-Za-z ]+ of [A-Za-z ]+|[a-z ]+ \[[a-z-]+\])$/) }]);
    expect(b.instruction).toContain(`Open with exactly these words: "${b.riders[0]!.text},"`);
  }
  for (const way of [/^As [a-z ]+$/, / of /, /\]$/]) expect(opened.some((b) => way.test(b.riders[0]!.text))).toBe(true);
  // Late: an imperative, bare ids, the act first, then two to five sentences by kind, worded by the writer (no rider
  // is given word for word), which ask for nothing and name nothing the call doesn't have.
  expect(STYLES.late).toContain("Ids are written bare");
  expect(STYLES.late).toContain("They ask for nothing more");
  expect(STYLES.late).toContain("name no id, amount, record or person the call doesn't have");
  const late = Array.from({ length: 200 }, () => styleBrief("late", ACTS[0]!, rand));
  const counts = late.map((b) => [...b.instruction.slice(b.instruction.indexOf("After the act")).matchAll(/\((\d)\) /g)].length);
  expect(new Set(counts)).toEqual(new Set([2, 3, 4, 5]));
  for (const b of late) expect(b).toMatchObject({ style: "late", riders: [] });
  for (const kind of ["what must stay as it is", "what it must not do", "what it does not amount to", "what to do if it cannot be done as asked", "what is to be shown before it is carried out"]) expect(late.some((b) => b.instruction.includes(kind))).toBe(true);
  // The writers are told that a style may ask for more than three sentences, and that what it adds asks for nothing.
  expect(writerSystem()).toContain("one to three sentences of plain language, unless the style asks for more");
  expect(writerSystem()).toContain("they qualify it and ask for nothing: no second act");
  expect(refusalWriterSystem()).toContain("unless the style asks for more");
});

test("a long request of one act in the late voice is a positive with its program, and never a part of too_much", async () => {
  const o = { styles: ["late", "terse"], perGold: 2, refusalFloor: 3, seed: 4 };
  const asked: (string | undefined)[] = [];
  const r = await generate(ACTS, { ...o, writers: [model("a")], back: { model: "stand-in/back", translate: async (request, _forms, gold) => (asked.push(request), gold?.program ?? /about this: .*?\b(needs|no amount)/.exec(request)?.[0] ?? undefined) } });
  const late = r.examples.filter((e) => e.style === "late" && e.kind === "positive");
  expect(late.length).toBe(ACTS.length);
  expect(r.manifest.by_style).toMatchObject({ late: expect.any(Number), terse: expect.any(Number) });
  for (const e of late) {
    // As long as a real one (pilot-style.md: a median of 400 characters, three sentences and more), and one act: the
    // program it was written for, translated back as that.
    expect(e.request.length).toBeGreaterThan(350);
    expect(e.request.split(/(?<=\.) (?=[A-Z])/).length).toBeGreaterThanOrEqual(6);
    expect(ACTS.map((a) => a.program)).toContain(e.program);
    expect([e.kind, e.shape.startsWith("none(")]).toEqual(["positive", false]);
    expect(e.verified_by).toBe("stand-in/back");
    // Every value is found, in the act and not in what follows it; the closing "Do not …" is recorded as adding nothing.
    const act = e.request.indexOf(" Preserve");
    for (const s of e.spans!) if (s.how !== "implied") expect([s.arg, s.at![1] <= act, s.ambiguous]).toEqual([s.arg, true, undefined]);
    expect(e.riders).toEqual([{ kind: "do_not", text: "Do not reverse, cancel or replace anything already done.", at: expect.any(Array), adds: "nothing" }]);
  }
  // The refusals built by running requests together are made of the other requests only: related ones, and long
  // pasted ones. No late request is a part of any, so length alone never makes one.
  const built = r.examples.filter((e) => e.program === "none(too_much)" && e.built_from);
  expect(built.length).toBeGreaterThanOrEqual(3);
  const lateIds = new Set(late.map((e) => e.id));
  for (const e of built) {
    expect(e.built_from!.some((id) => lateIds.has(id))).toBe(false);
    expect(e.request).not.toContain("Preserve the existing arrangements");
  }
  expect(r.examples.filter((e) => e.program === "none(too_much)").some((e) => late.some((l) => e.request.includes(l.request)))).toBe(false);
  // Split again, the same holds on each side (the built refusals are built anew from each side's own).
  const parts = split(r.examples, { validation: 0.3, seed: 4 });
  for (const e of [...parts.train, ...parts.validation]) if (e.program === "none(too_much)" && e.built_from) expect(e.request).not.toContain("Preserve the existing arrangements");
  expect([...parts.train, ...parts.validation].filter((e) => e.style === "late" && e.kind === "positive").length).toBe(ACTS.length);
});

test("a request in a seat's voice that names an id its program doesn't have is dropped, with its reason", async () => {
  const vote = "vote(ballot=rec.3, choice=yes)";
  // What stands in brackets by itself, and anything written as a record's or a law's id.
  expect(strayIds("Vote yes on ballot rec.3. Keep ballot rec.2679 unchanged.", vote)).toEqual(["rec.2679"]);
  expect(strayIds("Vote yes on council ballot [rec.3] from the town account [acc-city], under law-charter.", vote)).toEqual(["acc-city", "law-charter"]);
  expect(strayIds("Vote yes on council ballot [rec.3]. Preserve the ballot and its history.", vote)).toEqual([]);
  expect(strayIds("Vote yes on ballot rec.3, rec.30 and rec.3.", vote)).toEqual(["rec.30"]);
  // Not what a rider was given to say, not what the program copies whole, not a form named by its record's id.
  expect(strayIds("As mayor [mayor], vote yes on ballot [rec.3] under law-rates.", vote, { riders: [{ kind: "capacity", text: "As mayor [mayor]" }, { kind: "citation", text: "under law-rates" }] })).toEqual([]);
  expect(strayIds("Tell the clerk [pos.7]: See rec.88 and [lot-01-02] before Friday.", 'message(to=pos.7, text="See rec.88 and [lot-01-02] before Friday.")')).toEqual([]);
  const spec = { form: "permit_application", to: "pos.9", id: "form-permit", fields: { lot: { type: "lot", required: true } } };
  expect(strayIds("Submit the permit application [form-permit] to the planning office [pos.9] for lot [lot-00-00].", "form(form=permit_application, to=pos.9, lot=lot-00-00)", { forms: [spec] })).toEqual([]);
  expect(strayIds("Submit the permit application [form-other] to the planning office [pos.9] for lot [lot-00-00].", "form(form=permit_application, to=pos.9, lot=lot-00-00)", { forms: [spec] })).toEqual(["form-other"]);
  // In the pipeline: the seats' voices are held to it (their further sentences are the writer's own); the reason is counted.
  const stray = (brief: string) => `${opening(brief) ? `${opening(brief)}, ` : ""}vote yes on ballot rec.3. Keep replacement ballot rec.2679 unchanged. (${Bun.hash(brief).toString(36)})`;
  const r = await generate([g(vote)], { writers: [model("a", stray)], perGold: 3, styles: ["late", "early", "formal"], seed: 2 });
  expect(r.rejects.map((x) => [x.style, x.why])).toEqual([["late", "stray_id"], ["early", "stray_id"]]);
  expect(r.manifest.dropped.stray_id).toBe(2);
  expect(r.examples.map((e) => e.style)).toEqual(["formal"]);
});

test("the words a writer marks: the marks come off and the words between them are found; marks that can't be used say why", () => {
  expect([OPEN, CLOSE]).toEqual(["⟦", "⟧"]);
  const good = marked("Direct the works manager [pos.7] to ⟦arrange collection of the waste at house-165 today and report when it is complete⟧. Do not send it to any other office.");
  expect(good).toEqual({
    request: "Direct the works manager [pos.7] to arrange collection of the waste at house-165 today and report when it is complete. Do not send it to any other office.",
    words: "arrange collection of the waste at house-165 today and report when it is complete", at: [36, 117],
  });
  if ("request" in good) expect(good.request.slice(...good.at)).toBe(good.words);
  // A space inside the marks and the full stop before the closing one are no part of the words.
  const loose = marked("Have pos.7 ⟦ mend the fence. ⟧");
  expect(loose).toMatchObject({ request: "Have pos.7  mend the fence. ", words: "mend the fence" });
  if ("request" in loose) expect(loose.request.slice(...loose.at)).toBe("mend the fence");
  expect(marked("Ask pos.7 to ⟦confirm the valuer's figures⟧?")).toMatchObject({ words: "confirm the valuer's figures" }); // (an apostrophe is no quotation mark)
  // None; one without the other, or the closing one first; nothing between them; more than one pair; a quotation mark inside.
  expect(marked("Direct pos.7 to mend the fence.")).toEqual({ marks: "missing" });
  expect(marked("Direct pos.7 to ⟦mend the fence.")).toEqual({ marks: "unbalanced" });
  expect(marked("Direct pos.7 to mend the fence⟧.")).toEqual({ marks: "unbalanced" });
  expect(marked("Direct pos.7 to ⟧mend the fence⟦.")).toEqual({ marks: "unbalanced" });
  expect(marked("Direct pos.7 to ⟦⟦mend the fence⟧.")).toEqual({ marks: "unbalanced" });
  expect(marked("Direct pos.7 to ⟦⟧.")).toEqual({ marks: "empty" });
  expect(marked("Direct pos.7 to ⟦ … ⟧.")).toEqual({ marks: "empty" });
  expect(marked("Direct pos.7 to ⟦mend the fence⟧ and ⟦report back⟧.")).toEqual({ marks: "several" });
  expect(marked('Direct pos.7 to ⟦put up a sign saying "closed"⟧.')).toEqual({ marks: "quoted" });
  expect(marked("Direct pos.7 to ⟦put up a sign saying “closed”⟧.")).toEqual({ marks: "quoted" });
});

test("a letter asked for indirectly: about half of the letters, the writer told to invent and mark what is asked; the same examples by file and by model", async () => {
  expect(LETTERS.every((l) => isLetter(l.program))).toBe(true);
  for (const p of ['message(to=pos.7, text="Start.", re=rec.9)', "vote(ballot=rec.3, choice=yes)", 'v1 = statement(kind=notice, text="Closed.")\nmessage(to=pos.7, text="Read it.", re=v1)']) expect(isLetter(p)).toBe(false);
  expect(withText(LETTERS[0]!.program, "mend the fence")).toBe('message(text="mend the fence", to=pos.7)'); // (as the call language writes a program out)
  const gold = [...LETTERS, ...ACTS];
  const o = { perGold: 6, indirect: 0.5, refusalFloor: 3, seed: 6 };
  const plan: PlanItem[] = JSON.parse(JSON.stringify(planOf(gold, { ...o, writers: ["stand-in/a", "stand-in/b"] })));
  const requests = plan.filter((t): t is Extract<PlanItem, { kind: "request" }> => t.kind === "request");
  const indirect = requests.filter((t) => t.indirect);
  // Only letters, and about half of them; with no share asked for, none (what a caller gets who doesn't ask).
  expect(indirect.every((t) => isLetter(t.gold.program))).toBe(true);
  expect(indirect.length).toBeGreaterThan(LETTERS.length * 6 * 0.3);
  expect(indirect.length).toBeLessThan(LETTERS.length * 6 * 0.7);
  expect(planOf(gold, { perGold: 6, seed: 6, writers: ["w"] }).some((t) => t.kind === "request" && t.indirect)).toBe(false);
  expect(planOf(gold, { ...o, writers: ["stand-in/a", "stand-in/b"] })).toEqual(plan);
  for (const t of indirect) {
    // The call is shown with its text left open: the gold program's own words are not the writer's to see or use.
    const text = literals(calls.parseProgram(t.gold.program)).find((l) => t.gold.program.includes(`text="${l}"`))!;
    expect(t.brief.startsWith(`Call:\n${withText(t.gold.program, "⟦…⟧")}\n\n`)).toBe(true);
    expect(t.brief).not.toContain(text);
    expect(t.brief).toContain("Asked indirectly: this request quotes no letter.");
    expect(t.brief).toContain("put ⟦ straight before the first word of what they are to do and ⟧ straight after its last word");
    expect(t.brief).toMatch(/The act, said something like: "(direct|ask|tell|instruct|have|get) .+ ⟦…⟧"\./);
    expect(t.notes).toEqual([expect.stringContaining("⟦…⟧")]);
  }
  // Each of the six ways of directing someone is given to some writer.
  const ways = new Set(Array.from({ length: 200 }, (_, i) => /"(\w+) /.exec(indirectNotes(LETTERS[0]!.program, sampler(i))[0]!)![1]));
  expect(ways).toEqual(new Set(["direct", "ask", "tell", "instruct", "have", "get"]));
  expect(requestBrief(LETTERS[0]!, "formal")).not.toContain("Asked indirectly");
  // The writers are told when the marks apply: only where the brief says so.
  expect(writerSystem()).toContain("Only where the brief says the request is asked indirectly");
  expect(writerSystem()).toContain("in any other request, never write them");
  // A late one's further sentences speak of the direction, so none reads as more words for whoever it goes to.
  const lateOnes = indirect.filter((t) => t.style === "late");
  expect(lateOnes.length).toBeGreaterThan(0);
  for (const t of lateOnes) expect(t.brief).toMatch(/that the direction is all that is wanted|that it goes to nobody else|what it does not amount to \("This direction/);

  // By model and by file, for the same texts: the same examples and the same rejects.
  const of = (name: string) => plan.filter((t) => t.writer === name);
  const seen: (string | undefined)[] = [];
  const run = await generate(gold, { ...o, writers: [model("a"), model("b")] });
  const files = await fromWritten(plan, [{ writer: "stand-in/a", requests: written(of("stand-in/a")) }, { writer: "stand-in/b", requests: written(of("stand-in/b")) }], o);
  expect(files.examples).toEqual(run.examples);
  expect(files.rejects).toEqual(run.rejects);
  expect(files.rejects).toEqual([]);
  const made =files.examples.filter((e) => e.indirect);
  expect(made.length).toBe(indirect.length);
  expect(files.manifest.indirect).toBe(indirect.length);
  expect(run.manifest.indirect).toBe(indirect.length);
  for (const e of made) {
    // The marks are gone; the marked words are the program's text, in place of the gold program's, and its span is
    // where they were marked, copied; the gold program it was planned from is what a split keeps it with.
    expect(e.request).not.toMatch(/[⟦⟧]/);
    const text = e.spans!.find((s) => s.arg === "text")!;
    expect(text).toEqual({ arg: "text", value: expect.stringMatching(/^inspect the drains at the depot \([a-z0-9]+\) and report when it is complete$/), how: "copy", at: expect.any(Array) });
    expect(e.request.slice(...text.at!)).toBe(text.value);
    expect(e.program).toBe(withText(e.gold!, text.value));
    expect(e.program).not.toBe(e.gold);
    expect(LETTERS.map((l) => l.program)).toContain(e.gold!);
    expect([e.kind, e.shape]).toEqual(["positive", "message(text,to)"]);
    // (Who it goes to is still found, outside the marked words.)
    for (const s of e.spans!.filter((x) => x.arg === "to")) expect(s.at![1]).toBeLessThanOrEqual(text.at![0]);
  }
  // The other half of the letters quote their words, as before: the gold program's own text.
  const direct = files.examples.filter((e) => e.kind === "positive" && e.shape === "message(text,to)" && !e.indirect);
  expect(direct.length).toBe(LETTERS.length * 6 - indirect.length);
  for (const e of direct) expect(e.program).toBe(e.gold!);
  // The model that translates a request back is shown it without the marks, and is held to the program with the
  // marked words: one that answers with the gold program's own text is no agreement.
  const backed = await generate(gold, { ...o, writers: [model("a"), model("b")], back: { model: "stand-in/back", translate: async (request, _forms, gd) => (seen.push(request), gd?.program) } });
  expect(seen.some((q) => /[⟦⟧]/.test(q ?? ""))).toBe(false);
  expect(backed.examples.filter((e) => e.indirect).length).toBe(indirect.length);
  const stale = await generate(LETTERS, { perGold: 6, indirect: 1, seed: 6, writers: [model("a")], back: { model: "stand-in/back", translate: async (request) => LETTERS.find((l) => literals(calls.parseProgram(l.program)).filter((x) => !x.includes(" ")).every((x) => request.includes(x)))?.program } });
  expect(stale.examples.filter((e) => e.kind === "positive")).toEqual([]);
  expect(stale.manifest.dropped.round_trip).toBe(LETTERS.length * 6);

  // Marks that can't be used, by file: each rejected with why, the request as it was handed in; and marks where none
  // were asked for.
  const [none, half, two, quoted, empty] = indirect as [PlanItem, PlanItem, PlanItem, PlanItem, PlanItem];
  const plain = requests.find((t) => !t.indirect && t.style === "terse")!;
  const bad = new Map<string, [string, string]>([
    [none.id, ["Direct them to mend the fence.", "missing"]], [half.id, ["Direct them to ⟦mend the fence.", "unbalanced"]], [two.id, ["Direct them to ⟦mend the fence⟧ and ⟦report back⟧.", "several"]],
    [quoted.id, ['Direct them to ⟦put up a sign saying "closed"⟧.', "quoted"]], [empty.id, ["Direct them to ⟦…⟧.", "empty"]], [plain.id, [`${say(plain.brief)} ⟦And more⟧.`, "unasked"]],
  ]);
  const how = (t: PlanItem) => bad.get(t.id)?.[0] ?? say(t.brief);
  const r = await fromWritten(plan, [{ writer: "claude", requests: written(plan, how) }], o);
  for (const [request, marks] of bad.values()) expect(r.rejects).toContainEqual(expect.objectContaining({ request, why: "marks", marks, written_by: "claude" }));
  expect(r.manifest.dropped.marks).toBe(6);
  expect(r.manifest.indirect).toBe(indirect.length - 5);
  expect(r.examples.some((e) => /[⟦⟧]/.test(e.request))).toBe(false);
  // The same by model: a writer that never marks loses every letter asked for indirectly, and nothing else.
  const unmarking = await generate(gold, { ...o, writers: [model("a", (b) => say(b).replace(/[⟦⟧]/g, ""))] });
  expect(unmarking.manifest.dropped.marks).toBe(indirect.length);
  expect(unmarking.rejects.filter((x) => x.why === "marks").every((x) => x.marks === "missing")).toBe(true);
  expect(unmarking.examples.filter((e) => e.kind === "positive").length).toBe(files.examples.filter((e) => e.kind === "positive").length - indirect.length);
});

test("refusals come in the seats' voices too, long and qualified; what is another's to decide is never worded as having or getting them to", async () => {
  // The refusal briefs are dealt the styles in the same turn as the requests: half in the seats' voices.
  const plan = planOf(ACTS, { writers: ["w"], perGold: 1, refusalFloor: 6, piled: [[ACTS[0]!, ACTS[1]!]], seed: 3 });
  const refusals = plan.filter((t): t is Extract<PlanItem, { kind: "refusal" }> => t.kind === "refusal" && t.round === 0);
  const seats = refusals.filter((t) => SEATS.includes(t.style));
  expect(seats.length).toBeGreaterThan(refusals.length * 0.4);
  for (const label of ["not_an_act", "no_such_act", "unclear", "not_yours", "needs_calculation"]) expect([label, refusals.some((t) => t.refusal.label === label && t.style === "late")]).toEqual([label, true]);
  // Worded for a situation: "what is wanted" where a program's style says "the act", with nothing about a call.
  const b: RefusalBrief = { label: "not_an_act", brief: "The speaker wants to see what is recorded about rec.412.", mustCopy: ["rec.412"], source: "test" };
  const late = refusalRequestBrief(b, "late");
  expect(late).toContain("The first sentence says what is wanted, all of it. Then two to five further sentences qualify it");
  expect(late).toContain("name no id, amount, record or person the situation doesn't give");
  expect(late).not.toContain("the call");
  const early = refusalRequestBrief(b, "early");
  expect(early).toContain("It opens \"As <the office the speaker holds>, …\"");
  expect(early).not.toContain("the call");
  expect(refusalRequestBrief(b, "terse")).toContain(STYLES.terse!);
  for (const t of seats) expect(t.brief).not.toContain(STYLES[t.style]!);

  // Someone else's decision: making, ensuring, seeing to it, making sure. "Have them" and "get them to" are letters
  // to them by the translator's rules, so no brief suggests either and every brief rules both out.
  const briefs = refusalBriefs(ACTS, 300, 3).filter((x) => x.label === "not_yours").map((x) => x.brief);
  expect(briefs.length).toBe(300);
  const suggested = new Set(briefs.map((x) => /put something like "([^"]+)"/.exec(x)![1]!));
  expect(suggested.size).toBeGreaterThanOrEqual(8);
  for (const s of suggested) {
    expect(s).not.toMatch(/^(get|have) them\b/i);
    expect(s).toMatch(/make|ensure|see to it|fix it so|settled|bring it about|must be/);
  }
  for (const x of briefs) {
    expect(x).toContain('Never "have them …" or "get them to …"');
    expect(x).toContain("making them, ensuring, seeing to it or making sure that they do it");
    expect(x).toContain("never asking, telling, directing or instructing them: each of those is a letter to them");
  }

  // Written long, a refusal is kept as that: its label, whatever its length.
  const r = await generate(ACTS, { writers: [model("a")], perGold: 1, refusalFloor: 6, seed: 3 });
  const long = r.examples.filter((e) => e.kind === "refusal" && e.style === "late" && !e.built_from);
  expect(long.length).toBeGreaterThan(5);
  for (const e of long) {
    expect(e.request.length).toBeGreaterThan(350);
    expect(e.program).toMatch(/^none\((not_an_act|no_such_act|unclear|not_yours|needs_calculation)\)$/);
  }
  expect(new Set(long.map((e) => e.program)).size).toBeGreaterThanOrEqual(4);
});
