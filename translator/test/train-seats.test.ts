// The training data in the seats' voice (translator/train/data.ts; eval/pilot-style.md is the style source): long
// requests of one act, letters asked for indirectly with the words asked of them marked by the writer, and refusals
// as long and as qualified as the rest.
import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import type { LlmAdapter } from "@oikos/participants/llm";
import {
  CLOSE, DEAL, OPEN, SEATS, STYLES, amountNotes, builtRefusals, formLine, inOnly, onlyInsideAnother, pairOf, spansIn, fromWritten, generate, indirectNotes, isLetter, literals, marked, mentions, piledBriefs, planOf, refusalBriefs, refusalRequestBrief, refusalWriterSystem, requestBrief, sampler, shapeOf, split, strayIds, styleBrief,
  withText, writerSystem, type Gold, type PlanItem, type RefusalBrief, type WrittenRequest,
} from "../train/data";
import { translatorSystem } from "../src/index";
import { amountForms } from "../train/synthetic";

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
/** The ids a brief gives its writer to name (each set off by quotation marks, with what it is), after the words that say so. */
const idsAfter = (brief: string, words: RegExp): string[] => { const at = brief.search(words); return at < 0 ? [] : [...brief.slice(at, brief.indexOf("The quotation marks here only set", at)).matchAll(/"([^"\s]+)" \(/g)].map((m) => m[1]!); };
/** Other things an act leaves alone; what a direction concerns; what a request to read, pause or visit covers. */
const others = (brief: string) => idsAfter(brief, /name exactly these other things by id/);
const within = (brief: string) => idsAfter(brief, /names exactly these by id, as what the task concerns/);
const covered = (brief: string) => idsAfter(brief, /names? these (other things )?by id/);
/** (In the early voice an id stands in square brackets.) */
const left = (brief: string) => (others(brief).length ? ` Leave ${others(brief).map((id) => (brief.includes("instruction for the record") ? `the other one [${id}]` : id)).join(" and ")} as they stand.` : "");
/**
 * What a stand-in writer says to a brief, whoever it is and however the brief reached it. A situation: its own line
 * (whatever it names is in it), at length in the `late` voice. A letter asked indirectly: a direction with the words
 * asked of them marked. Any other call: its literals in a sentence; in the `late` voice, with sentences after it.
 */
const say = (brief: string): string => {
  const mark = Bun.hash(brief).toString(36);
  const late = brief.includes("careful, defensive instruction");
  if (!brief.startsWith("Call:\n")) return `Request ${mark}, about this: ${brief.split("\n")[1]}${covered(brief).length ? ` It covers ${covered(brief).join(", ")}.` : ""}${late ? QUALIFIED : ""}`;
  const open = `${opening(brief) ? `${opening(brief)}, ` : ""}${cited(brief) ? `${cited(brief)}, ` : ""}`;
  // (Two acts: the first as any act is said, its further sentences after it, and the direction last, its words marked.)
  if (programIn(brief).includes(`${OPEN}…${CLOSE}`) && !brief.includes("Asked indirectly")) {
    const cites = /^message\(.*re=(rec\.[0-9]+)/m.exec(programIn(brief))?.[1];
    return `${open}carry this out (${mark}): ${literals(calls.parseProgram(programIn(brief))).filter((l) => l !== `${OPEN}…${CLOSE}`).join(", ")}.${late ? QUALIFIED : ""}${left(brief)}${closing(brief)} Direct them${cites ? `, regarding ${cites},` : ""} to ${OPEN}put it on the list for the next meeting (${mark})${CLOSE}.`;
  }
  if (brief.includes("Asked indirectly")) {
    const to = literals(calls.parseProgram(programIn(brief))).filter((l) => l !== `${OPEN}…${CLOSE}`);
    return `${open}direct ${to.join(" and ")} to ${OPEN}inspect the drains at ${within(brief).join(" and ") || "the depot"} (${mark}) and report when it is complete${CLOSE}.${late ? " This is a direction only." : ""}${closing(brief)}`;
  }
  return `${open}carry this out (${mark}): ${literals(calls.parseProgram(programIn(brief))).join(", ")}.${late ? QUALIFIED : ""}${left(brief)}${closing(brief)}`;
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
  const opened = early.filter((b) => b.riders.some((r) => r.kind === "capacity"));
  expect(opened.length).toBeGreaterThan(60);
  expect(opened.length).toBeLessThan(140);
  for (const b of opened) {
    expect(b.riders.filter((r) => r.kind !== "mention")).toEqual([{ kind: "capacity", text: expect.stringMatching(/^As ([a-z ]+|[A-Z][A-Za-z ]+ of [A-Za-z ]+|[a-z ]+ \[[a-z-]+\])$/) }]);
    expect(b.instruction).toContain(`Open with exactly these words: "${b.riders[0]!.text},"`);
  }
  for (const way of [/^As [a-z ]+$/, / of /, /\]$/]) expect(opened.some((b) => way.test(b.riders[0]!.text))).toBe(true);
  // Late: an imperative, bare ids, the act first, then two to five sentences by kind, worded by the writer (no rider
  // is given word for word), which ask for nothing and name nothing the call doesn't have.
  expect(STYLES.late).toContain("Ids are written bare");
  expect(STYLES.late).toContain("They ask for nothing more");
  expect(STYLES.late).toContain("name no amount or person the call doesn't have, and no other id but the ones given below to be named");
  const late = Array.from({ length: 200 }, () => styleBrief("late", ACTS[0]!, rand));
  const counts = late.map((b) => [...b.instruction.slice(b.instruction.indexOf("After the act")).matchAll(/\((\d)\) /g)].length);
  expect(new Set(counts)).toEqual(new Set([2, 3, 4, 5]));
  for (const b of late) expect([b.style, b.riders.every((r) => r.kind === "mention")]).toEqual(["late", true]); // (no sentence is given word for word: only ids to name)
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
    expect(e.riders!.filter((r) => r.kind !== "mention")).toEqual([{ kind: "do_not", text: "Do not reverse, cancel or replace anything already done.", at: expect.any(Array), adds: "nothing" }]);
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
  // Anything in the shape of an id, not only a record's: an account, a person, a place, an instruction.
  expect(strayIds("Vote yes on ballot rec.3. Leave acc-c0004, c0042, str.7, lot-12-03, house-165 and job-c0011-wages as they are.", vote)).toEqual(["acc-c0004", "c0042", "str.7", "lot-12-03", "house-165", "job-c0011-wages"]);
  // The ids a request was given to name are its to name, wherever and however often; any other is still one too many.
  expect(strayIds("Vote yes on ballot rec.3. Keep rec.2679 and acc-c0004 unchanged; rec.2679 stays as it is, and so does acc-c0008.", vote, { riders: [{ kind: "mention", text: "rec.2679" }, { kind: "mention", text: "acc-c0004" }] })).toEqual(["acc-c0008"]);
  // Not what a rider was given to say, not what the program copies whole, not a form named by its record's id.
  expect(strayIds("As mayor [mayor], vote yes on ballot [rec.3] under law-rates.", vote, { riders: [{ kind: "capacity", text: "As mayor [mayor]" }, { kind: "citation", text: "under law-rates" }] })).toEqual([]);
  expect(strayIds("Tell the clerk [pos.7]: See rec.88 and [lot-01-02] before Friday.", 'message(to=pos.7, text="See rec.88 and [lot-01-02] before Friday.")')).toEqual([]);
  const spec = { form: "permit_application", to: "pos.9", id: "form-permit", fields: { lot: { type: "lot", required: true } } };
  expect(strayIds("Submit the permit application [form-permit] to the planning office [pos.9] for lot [lot-00-00].", "form(form=permit_application, to=pos.9, lot=lot-00-00)", { forms: [spec] })).toEqual([]);
  expect(strayIds("Submit the permit application [form-other] to the planning office [pos.9] for lot [lot-00-00].", "form(form=permit_application, to=pos.9, lot=lot-00-00)", { forms: [spec] })).toEqual(["form-other"]);
  // In the pipeline: the seats' voices are held to it (their further sentences are the writer's own); the reason is counted.
  const stray = (brief: string) => `${opening(brief) ? `${opening(brief)}, ` : ""}vote yes on ballot rec.3. Keep replacement ballot rec.2679 unchanged.${left(brief)} (${Bun.hash(brief).toString(36)})`;
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
    expect(text).toEqual({ arg: "text", value: expect.stringMatching(/^inspect the drains at .+ \([a-z0-9]+\) and report when it is complete$/), how: "copy", at: expect.any(Array) });
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

test("a part can be weighted toward what seats ask: requests for some functions only, refusals of some labels only, most letters indirect", async () => {
  const gold = [...LETTERS, ...ACTS];
  // Only the letters are written for; the refusal briefs are still made from every program (a payment with its
  // amount taken out needs the payments).
  const letters = planOf(gold, { writers: ["w"], perGold: 2, only: ["message"], indirect: 0.9, refusalFloor: 2, seed: 8 });
  const requests = letters.filter((t): t is Extract<PlanItem, { kind: "request" }> => t.kind === "request");
  expect(requests.length).toBe(LETTERS.length * 2);
  expect(requests.every((t) => isLetter(t.gold.program))).toBe(true);
  expect(requests.filter((t) => t.indirect).length).toBeGreaterThanOrEqual(LETTERS.length * 2 - 3);
  expect(letters.some((t) => t.kind === "refusal" && t.refusal.label === "needs_calculation" && t.brief.includes("acc-city"))).toBe(true);
  expect(planOf(gold, { writers: ["w"], perGold: 2, only: ["message", "vote"], seed: 8 }).length).toBe((LETTERS.length + 1) * 2);
  // No function at all: refusal briefs alone.
  const none = planOf(gold, { writers: ["w"], perGold: 2, only: ["none"], refusalFloor: 2, seed: 8 });
  expect(none.length).toBeGreaterThan(0);
  expect(none.every((t) => t.kind === "refusal")).toBe(true);
  // Some labels only: so many of each as asked, in every round, and no others (the piled kind is too_much).
  const o = { perGold: 1, only: ["none"], refusalLabels: ["not_an_act", "no_such_act"], refusalFloor: 5, piled: [[ACTS[0]!, ACTS[1]!]], seed: 8 };
  const looks = planOf(gold, { ...o, writers: ["w"] });
  const count = (items: PlanItem[], round: number) => { const out: { [l: string]: number } = {}; for (const t of items) if (t.kind === "refusal" && t.round === round) out[t.refusal.label] = (out[t.refusal.label] ?? 0) + 1; return out; };
  for (const round of [0, 1, 2]) expect(count(looks, round)).toEqual({ not_an_act: 5, no_such_act: 5 });
  // Each label in the seats' voices and in others, and for each writer of two (dealt label by label in turn, one
  // label would have had every seat's voice and one writer every request to read).
  const many = planOf(gold, { ...o, refusalFloor: 40, writers: ["a", "b"] }).filter((t): t is Extract<PlanItem, { kind: "refusal" }> => t.kind === "refusal" && t.round === 0);
  for (const label of o.refusalLabels) {
    const of = many.filter((t) => t.refusal.label === label);
    for (const [what, n] of [["late", of.filter((t) => t.style === "late").length], ["early", of.filter((t) => t.style === "early").length], ["older", of.filter((t) => !SEATS.includes(t.style)).length], ["a", of.filter((t) => t.writer === "a").length], ["b", of.filter((t) => t.writer === "b").length]] as const) expect([label, what, n >= 5]).toEqual([label, what, true]);
  }
  expect(planOf(gold, { ...o, refusalFloor: 40, writers: ["a", "b"] })).toEqual(planOf(gold, { ...o, refusalFloor: 40, writers: ["a", "b"] }));
  expect(planOf(gold, { ...o, refusalLabels: ["too_much"], writers: ["w"] }).filter((t) => t.kind === "refusal" && t.round === 0).length).toBe(1);
  // Carried out: nothing of another label is written, built or held to the floor; by file as by model.
  const run = await generate(gold, { ...o, writers: [model("a")] });
  expect(run.manifest.by_shape).toEqual({ "none(no_such_act)": 5, "none(not_an_act)": 5 });
  expect(run.manifest.short_of_floor).toEqual({});
  const files = await fromWritten(JSON.parse(JSON.stringify(planOf(gold, { ...o, writers: ["stand-in/a"] }))), [{ writer: "stand-in/a", requests: written(planOf(gold, { ...o, writers: ["stand-in/a"] })) }], o);
  expect(files.examples).toEqual(run.examples);
  // With programs written for and some labels asked: the refusals that are built keep to the labels too.
  const mixed = await generate(gold, { perGold: 2, styles: ["terse", "formal"], refusalLabels: ["too_much"], refusalFloor: 3, seed: 8, writers: [model("a")] });
  expect(Object.keys(mixed.manifest.by_shape).filter((x) => x.startsWith("none("))).toEqual(["none(too_much)"]);
  expect(mixed.manifest.by_shape["none(too_much)"]).toBeGreaterThanOrEqual(3);
  const all = await generate(gold, { perGold: 2, styles: ["terse", "formal"], refusalFloor: 3, seed: 8, writers: [model("a")] });
  expect(Object.keys(all.manifest.by_shape).filter((x) => x.startsWith("none(")).length).toBeGreaterThan(4);
});

test("the late voice is asked for at a seat's length: every particular in the act, full sentences after it, 300 to 700 characters; the manifest counts lengths by style", async () => {
  expect(STYLES.late).toContain("with every particular the call has said as a seat says them: what, for whom, from what, on what terms");
  expect(STYLES.late).toContain("each a full sentence of its own, twelve to thirty words, never a tag of five");
  expect(STYLES.late).toContain("The whole request comes to 300 to 700 characters, or up to 1,000 where it has many ids to name");
  expect(STYLES.late).toContain("never from adding anything");
  // Each kind of sentence is shown at the length meant (the first part's were five words: so were the examples).
  const rand = sampler(11);
  const shown = new Set<string>();
  for (let i = 0; i < 80; i++) for (const indirect of [false, true]) {
    const b = styleBrief("late", indirect ? LETTERS[0]! : ACTS[0]!, rand, { indirect }).instruction;
    expect(b).toContain("the sentences in brackets show the kind and the length, not the words to use");
    for (const m of b.slice(b.indexOf("After the act")).split(/ In those further sentences, name| What they are asked to do names/)[0]!.matchAll(/"([^"]+)"/g)) if (m[1] !== "Do not") shown.add(m[1]!);
    // A direction's own words: two or three clauses, 20 to 45 words, inside the marks.
    expect(b.includes("two or three clauses in one sentence of 20 to 45 words (what to do, by when or in what order, what to report back when it is done), all of it between the marks")).toBe(indirect);
  }
  expect(shown.size).toBeGreaterThanOrEqual(9);
  for (const x of shown) expect([x, x.split(" ").length >= 11 && x.length >= 60]).toEqual([x, true]);
  // The refusals' late voice says the same of its own sentences.
  expect(refusalRequestBrief({ label: "unclear", brief: "The speaker wants something done.", mustCopy: [], source: "t" }, "late")).toContain("Each further sentence is a full one, twelve to thirty words, and the whole request comes to 300 to 700 characters.");
  // How long the requests came out, by style: where to see whether the writers made them long.
  const r = await generate(ACTS, { writers: [model("a")], styles: ["late", "terse"], perGold: 2, seed: 4 });
  expect(r.manifest.request_length.late).toEqual({ requests: ACTS.length, median: expect.any(Number), p90: expect.any(Number) });
  expect(r.manifest.request_length.late!.median).toBeGreaterThan(350);
  expect(r.manifest.request_length.terse!.p90).toBeLessThan(120);
  expect(r.manifest.request_length.late!.p90).toBeGreaterThanOrEqual(r.manifest.request_length.late!.median);
});

test("in the seats' voices a request to read asks for particulars, one to pause says what is kept for resuming, one to visit what is looked for", () => {
  const gold = [g('money(to=acc-landlord-1, amount="$850", from=acc-city, every="monthly", for="rent")'), ...ACTS];
  const briefs = refusalBriefs(gold, 6, 4);
  const of = (label: string, has: string) => briefs.find((b) => b.label === label && b.brief.includes(has))!;
  const look = of("not_an_act", "to bring nothing about"), pause = of("no_such_act", "already stands"), visit = of("no_such_act", "in person"), routine = of("no_such_act", "a routine of their own");
  for (const style of SEATS) {
    // To read or inspect: the stretch of time (the world's own days, no calendar date) and what each entry is to show.
    const read = refusalRequestBrief(look, style);
    expect(read).toContain("what each entry is to show, three or four things by name");
    expect(read).toContain("in days of the year and never a calendar date");
    expect(read).toContain("never a second request");
    // To pause: what is kept, so that it can be taken up again, and that it is not to be ended for good.
    expect(refusalRequestBrief(pause, style)).toContain("what is to be kept so that it can be resumed, each thing by name in plain words");
    expect(refusalRequestBrief(pause, style)).toContain("a permanent cancellation is not wanted");
    expect(refusalRequestBrief(visit, style)).toContain("what the speaker will look for there and what is to be noted of it");
    expect(refusalRequestBrief(routine, style)).toContain("what stays in place while it does");
    // (Said with the situation, before the style.)
    expect(read.indexOf("In this voice")).toBeLessThan(read.indexOf("\n\nStyle: "));
  }
  // The other styles' briefs are as they were: a short request stays short.
  for (const b of [look, pause, visit, routine]) for (const style of ["terse", "chatty", "formal"]) expect(refusalRequestBrief(b, style)).not.toContain("In this voice");
  // The other labels have nothing of the kind to add.
  for (const b of briefs.filter((x) => ["unclear", "not_yours", "needs_calculation"].includes(x.label))) expect(b.seats).toBeUndefined();
  // Many routines, so a part of nothing but these doesn't say eight things over and over.
  const routines = new Set(refusalBriefs([], 300, 2).filter((b) => b.label === "no_such_act").map((b) => /from now on: (.+?)\. It is something/.exec(b.brief)![1]));
  expect(routines.size).toBeGreaterThanOrEqual(20);
  // Nothing of any place: no town's name and no figure of money in what the generator says.
  for (const b of [look, pause, visit, routine]) expect(b.seats!).not.toMatch(/[$£€]|[A-Z][a-z]+(brook|ville|town|ford)\b/);
});

test("one act that names many things: in the seats' voices a request is given other ids to name, each recorded as a rider that adds nothing; any other id is still dropped", async () => {
  // Invented ids, in the shapes worlds' ids have: different, none the call's own or part of one, often of one kind.
  const rand = sampler(3);
  for (let i = 0; i < 200; i++) {
    const n = 1 + (i % 10);
    const ms = mentions(rand, n, ["acc-c0003", "c0003", "rec.3"]);
    expect(ms.length).toBe(n);
    expect(new Set(ms.map((m) => m.id)).size).toBe(n);
    for (const m of ms) {
      expect(["acc-c0003", "c0003", "rec.3"].some((a) => a.includes(m.id) || m.id.includes(a))).toBe(false);
      expect([m.id, strayIds(`Leave ${m.id} alone.`, "vote(ballot=rec.9, choice=yes)")]).toEqual([m.id, [m.id]]); // (its shape is one the check knows)
    }
  }
  expect(new Set(Array.from({ length: 300 }, () => mentions(rand, 1)[0]!.what)).size).toBe(7);
  expect(mentions(rand, 5, [], ["a place"]).every((m) => m.what === "a place")).toBe(true);
  // The plan: every request in a seat's voice (but a letter asked indirectly) has one to four, the early voice one
  // or two; the brief names them, and they are riders; the other styles have none.
  const plan = planOf(ACTS, { writers: ["w"], perGold: 4, seed: 12 }).filter((t): t is Extract<PlanItem, { kind: "request" }> => t.kind === "request");
  const counts: { [style: string]: Set<number> } = { early: new Set(), late: new Set() };
  for (const t of plan) {
    const named = t.riders.filter((r) => r.kind === "mention").map((r) => r.text);
    if (!SEATS.includes(t.style)) { expect(named).toEqual([]); continue; }
    counts[t.style]!.add(named.length);
    expect(others(t.brief)).toEqual(named);
    expect(t.brief).toContain("as things the act leaves alone, does not touch or is not about (never as anything to be done)");
    expect(t.brief).toContain(t.style === "late" ? "write each bare" : "write each in square brackets");
    const own = literals(calls.parseProgram(t.gold.program));
    for (const id of named) expect(own.some((x) => x.includes(id) || id.includes(x))).toBe(false);
  }
  expect(counts).toEqual({ early: new Set([1, 2]), late: new Set([1, 2, 3, 4]) });
  // Written: each id where it stands, every time it stands, adding nothing; the program's own values are found
  // elsewhere; a "Do not …" that names one is still recorded as that.
  const wording = (brief: string) => {
    const ids = others(brief);
    return `${opening(brief) ? `${opening(brief)}, ` : ""}carry this out (${Bun.hash(brief).toString(36)}): ${literals(calls.parseProgram(programIn(brief))).join(", ")}.${ids.length ? ` Do not alter ${ids[0]} or anything recorded under it. Keep ${ids.join(", ")} unchanged.` : ""}`;
  };
  const o = { styles: ["late", "early", "terse"], perGold: 3, seed: 12 };
  const r = await generate(ACTS, { ...o, writers: [model("a", wording)] });
  expect(r.rejects).toEqual([]);
  const items = planOf(ACTS, { ...o, writers: ["w"] }).filter((t): t is Extract<PlanItem, { kind: "request" }> => t.kind === "request");
  for (const e of r.examples.filter((x) => x.kind === "positive")) {
    const t = items.find((x) => x.gold.program === e.program && x.style === e.style)!;
    const given = t.riders.filter((x) => x.kind === "mention").map((x) => x.text);
    const recorded = (e.riders ?? []).filter((x) => x.kind === "mention");
    if (e.style === "terse") { expect(recorded).toEqual([]); continue; }
    expect(recorded.length).toBe(given.length + 1); // (the first is named twice)
    expect(new Set(recorded.map((x) => x.text))).toEqual(new Set(given));
    for (const x of recorded) expect([x.adds, e.request.slice(...x.at)]).toEqual(["nothing", x.text]);
    expect(e.riders!.filter((x) => x.kind === "do_not").map((x) => x.text)).toEqual([`Do not alter ${given[0]} or anything recorded under it.`]);
    // No value of the program is pointed at inside something only mentioned, and the program is the act's alone.
    for (const sp of e.spans!) if (sp.at) for (const x of recorded) expect(sp.at[1] <= x.at[0] || sp.at[0] >= x.at[1]).toBe(true);
    expect(ACTS.map((a) => a.program)).toContain(e.program);
  }
  expect(r.manifest.riders.mention).toBeGreaterThan(ACTS.length * 3);
  // Left out, an id it was given: not what was asked. Another id of its own: dropped as before.
  const without = await generate(ACTS, { ...o, writers: [model("a", (b) => wording(b).replace(/ Keep .* unchanged\.$/, "").replace(/ Do not alter .*$/, ""))] });
  expect(without.examples.filter((e) => e.kind === "positive").map((e) => e.style)).toEqual(ACTS.map(() => "terse"));
  expect(without.manifest.dropped.not_copied).toBe(ACTS.length * 2);
  const more = await generate(ACTS, { ...o, writers: [model("a", (b) => `${wording(b)} Leave acc-c9999 as it is.`)] });
  expect(more.manifest.dropped.stray_id).toBe(ACTS.length * 2);
  expect(more.examples.filter((e) => e.kind === "positive").every((e) => e.style === "terse")).toBe(true);
});

test("a letter asked for indirectly in a seat's voice names ids inside its marked words; a request to read, pause or visit names three to ten", async () => {
  const plan = planOf(LETTERS, { writers: ["w"], perGold: 8, indirect: 1, seed: 5 }).filter((t): t is Extract<PlanItem, { kind: "request" }> => t.kind === "request");
  for (const t of plan) {
    expect(t.indirect).toBe(true);
    if (!SEATS.includes(t.style)) { expect(t.inside).toBeUndefined(); continue; }
    // Two or three in the late voice, one or two in the early: what the task concerns, between the marks; and no
    // other thing to name outside them.
    expect([t.style, t.inside!.length >= (t.style === "late" ? 2 : 1) && t.inside!.length <= (t.style === "late" ? 3 : 2)]).toEqual([t.style, true]);
    expect(within(t.brief)).toEqual(t.inside!);
    expect(t.brief).toContain("as what the task concerns, all of them between the marks");
    expect(t.brief).toContain("between the marks there are none");
    expect(t.riders.filter((r) => r.kind === "mention")).toEqual([]);
  }
  // (A sum of money is offered now and then, where the program's world says how its money is written.)
  const cur = { code: "FLN", minor_units: 2, symbol: "ƒ" };
  const sums = planOf(LETTERS.map((l) => ({ ...l, currency: cur })), { writers: ["w"], perGold: 8, indirect: 1, styles: ["late"], seed: 5 }).map((t) => /names this sum where it fits \(a limit, an estimate\): "(ƒ[0-9,]+(\.[0-9]+)?)"/.exec(t.brief)?.[1]);
  expect(sums.some((x) => x) && sums.some((x) => !x)).toBe(true);
  // Written so: the ids are part of the letter's text, which is copied whole; left outside the marks, the request
  // is not what was asked.
  const r = await generate(LETTERS, { writers: [model("a")], perGold: 8, indirect: 1, seed: 5 });
  expect(r.rejects).toEqual([]);
  for (const t of plan.filter((x) => x.inside)) {
    const e = r.examples.find((x) => x.gold === (t.gold.family ?? t.gold.program) && x.style === t.style && t.inside!.every((id) => x.program.includes(id)))!;
    expect(e.indirect).toBe(true);
    const text = e.spans!.find((x) => x.arg === "text")!;
    for (const id of t.inside!) expect(text.value).toContain(id);
    expect((e.riders ?? []).filter((x) => x.kind === "mention")).toEqual([]);
  }
  const outside = await generate(LETTERS, { writers: [model("a", (b) => (within(b).length ? say(b).replace(` at ${within(b).join(" and ")}`, "").replace(/\.$/, `, with ${within(b).join(" and ")} in mind.`) : say(b)))], perGold: 8, indirect: 1, seed: 5 });
  expect(outside.manifest.dropped.not_copied).toBe(plan.filter((t) => t.inside).length);

  // Refusals: three to ten ids for a request to read, three to six to pause, three to five to visit; none for a
  // routine. In a seat's voice the brief gives them and the request must carry them; in another style neither.
  const gold = [g('money(to=acc-landlord-1, amount="$850", from=acc-city, every="monthly", for="rent")'), ...ACTS];
  const briefs = refusalBriefs(gold, 200, 4);
  const sizes = (f: (b: RefusalBrief) => boolean) => new Set(briefs.filter(f).map((b) => b.mention?.length ?? 0));
  expect(sizes((b) => b.label === "not_an_act")).toEqual(new Set([3, 4, 5, 6, 7, 8, 9, 10]));
  expect(sizes((b) => b.brief.includes("already stands"))).toEqual(new Set([3, 4, 5, 6]));
  expect(sizes((b) => b.brief.includes("in person"))).toEqual(new Set([3, 4, 5]));
  expect(sizes((b) => b.brief.includes("a routine of their own"))).toEqual(new Set([0]));
  expect(sizes((b) => ["unclear", "not_yours", "needs_calculation"].includes(b.label))).toEqual(new Set([0]));
  for (const b of briefs.filter((x) => x.mention)) {
    for (const id of b.mention!) expect(b.mustCopy.some((x) => x.includes(id) || id.includes(x))).toBe(false);
    for (const style of SEATS) expect(covered(refusalRequestBrief(b, style))).toEqual(b.mention!);
    expect(covered(refusalRequestBrief(b, "terse"))).toEqual([]);
  }
  expect(refusalBriefs(gold, 200, 4)).toEqual(briefs);
  // (Several acts piled into one message, in a seat's voice: each act a sentence of its own, and other things named too.)
  const piles = piledBriefs([[ACTS[0]!, ACTS[1]!], [ACTS[2]!, ACTS[3]!, ACTS[4]!]], 4);
  for (const b of piles) {
    expect(b.mention!.length >= 1 && b.mention!.length <= 3).toBe(true);
    expect(refusalRequestBrief(b, "late")).toContain("each act is a sentence of its own with its own particulars");
    expect(covered(refusalRequestBrief(b, "late"))).toEqual(b.mention!);
    expect(refusalRequestBrief(b, "chatty")).not.toContain("In this voice");
  }
  const o = { perGold: 1, only: ["none"], refusalLabels: ["not_an_act", "no_such_act"], refusalFloor: 30, seed: 4 };
  const items = planOf(gold, { ...o, writers: ["w"] }).filter((t): t is Extract<PlanItem, { kind: "refusal" }> => t.kind === "refusal" && t.round === 0);
  const [seat, plain] = [items.find((t) => t.style === "late" && t.refusal.label === "not_an_act")!, items.find((t) => t.style === "terse" && t.refusal.label === "not_an_act")!];
  expect(covered(seat.brief).length).toBeGreaterThanOrEqual(3);
  for (const id of covered(seat.brief)) expect(seat.refusal.mustCopy).toContain(id);
  expect(plain.refusal.mustCopy.length).toBeLessThanOrEqual(1);
  const kept = await generate(gold, { ...o, writers: [model("a")] });
  expect(kept.rejects).toEqual([]);
  const dense = kept.examples.filter((e) => e.style === "late" && e.program === "none(not_an_act)");
  expect(dense.length).toBeGreaterThan(3);
  for (const e of dense) expect(strayIds(e.request, "vote(ballot=rec.0, choice=yes)").length).toBeGreaterThanOrEqual(3); // (as full of ids as a real one)
  const sparse = await generate(gold, { ...o, writers: [model("a", (b) => say(b).replace(/ It covers [^.]*(\.[^ ][^.]*)*\./, ""))] });
  expect(sparse.rejects.length).toBeGreaterThan(10);
  expect(sparse.rejects.every((x) => x.why === "not_copied" && SEATS.includes(x.style))).toBe(true);
});

test("what is built as too much is still several acts, each its own, whatever else its parts mention", async () => {
  const o = { styles: ["early", "terse", "formal"], perGold: 3, refusalLabels: ["too_much"], refusalFloor: 8, seed: 9 };
  const r = await generate(ACTS, { ...o, writers: [model("a")] });
  const byId = new Map(r.examples.map((e) => [e.id, e]));
  const built = r.examples.filter((e) => e.program === "none(too_much)" && e.built_from);
  expect(built.length).toBeGreaterThanOrEqual(8);
  for (const e of built) {
    // Two acts or more, each a positive of its own with another program than the rest, each said whole in the message.
    const parts = e.built_from!.map((id) => byId.get(id)!);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.every((p) => p.kind === "positive" && p.style !== "late")).toBe(true);
    expect(new Set(parts.map((p) => p.gold ?? p.program)).size).toBe(parts.length);
    for (const p of parts) for (const sp of p.spans!) if (sp.how === "copy") expect(e.request).toContain(sp.value);
  }
  // Some of them have a part that mentions other things by id, as one act alone does: so neither the number of ids
  // nor the length says which is which, only the acts.
  const mentioning = built.filter((e) => e.built_from!.some((id) => (byId.get(id)!.riders ?? []).some((x) => x.kind === "mention")));
  expect(mentioning.length).toBeGreaterThan(0);
  const single = r.examples.filter((e) => e.kind === "positive" && (e.riders ?? []).some((x) => x.kind === "mention"));
  expect(single.length).toBeGreaterThan(5);
  // (The related kind takes such a part as readily as the pasted kind: a mention is no closing "Do not …".)
  expect(built.some((e) => e.source === "built: related requests run together" && e.built_from!.slice(1).some((id) => (byId.get(id)!.riders ?? []).some((x) => x.kind === "mention")))).toBe(true);
});

test("a form of several amounts: each said against its label, the long text copied whole though it says some of them again; the field's span is the one against the label", async () => {
  const gold = amountForms({ forms: 30, seed: 3 });
  expect(amountForms({ forms: 30, seed: 3 })).toEqual(gold);
  expect(gold.length).toBe(120);
  expect(new Set(gold.map((x) => x.source)).size).toBe(30);
  let partly = 0, again = 0, total = 0, other = 0;
  for (const x of gold) {
    expect(x.tag).toBe("amount_form");
    expect(inOnly(x, ["amount_form"]) && inOnly(x, ["form"]) && !inOnly(x, ["money"])).toBe(true);
    const c = (calls.parseProgram(x.program) as { lines: calls.Line[] }).lines[0]!.call;
    const spec = x.forms!.find((f) => f.form === (c.args.form as { id: string }).id)!;
    const of = (type: string) => Object.keys(spec.fields).filter((k) => spec.fields[k]!.type === type);
    // Three to seven amounts, one or two choices, one long text; nothing else. Field names are ordinary words.
    expect(of("amount").length >= 3 && of("amount").length <= 7).toBe(true);
    expect(of("choice").length >= 1 && of("choice").length <= 2).toBe(true);
    expect(of("text").length).toBe(1);
    expect(Object.keys(spec.fields).length).toBe(of("amount").length + of("choice").length + 1);
    for (const k of Object.keys(spec.fields)) expect(k).toMatch(/^[a-z]+(_[a-z]+)*$/);
    // Filled: two amounts or more, each a different one, each money as its world writes it; sometimes not all.
    const filled = of("amount").filter((k) => k in c.args).map((k) => (c.args[k] as { text: string }).text);
    expect(filled.length).toBeGreaterThanOrEqual(2);
    expect(new Set(filled).size).toBe(filled.length);
    for (const a of filled) expect(() => calls.parseAmount(a, x.currency!)).not.toThrow();
    if (filled.length < of("amount").length) partly++;
    for (const k of of("amount")) if (spec.fields[k]!.required && filled.length === of("amount").length) expect(k in c.args).toBe(true);
    const text = of("text").map((k) => c.args[k]).filter(Boolean).map((v) => (v as { text: string }).text)[0];
    if (text === undefined) continue;
    expect(text.length).toBeLessThan(420);
    expect(text).not.toContain('"');
    if (filled.some((a) => text.includes(a))) again++;
    if (text.includes(" in all.")) total++;
    if (text.includes("Last time")) other++;
    // The writer is told: one of the seats' ways, shown with the call's own values; the text whole; what is left empty.
    const notes = amountNotes(x, sampler(x.program.length));
    expect(notes[0]).toContain("each said against the form's own label for it");
    expect(filled.filter((a) => notes[0]!.includes(a)).length).toBe(2);
    expect(notes.some((n) => n.includes("is long: give it whole, word for word, after its label"))).toBe(true);
    expect(notes.some((n) => n.includes("say nothing of them"))).toBe(filled.length < of("amount").length);
    expect(notes.some((n) => n.includes("An amount that stands only in those words fills nothing."))).toBe(filled.some((a) => text.includes(a)));
  }
  expect(partly).toBeGreaterThan(20);
  expect(again).toBeGreaterThan(35);
  expect(again).toBeLessThan(85);
  expect(total).toBeGreaterThan(8);
  expect(other).toBeGreaterThan(3);
  expect(new Set(gold.map((x) => /could be put under another's: (the label, then|the label and the amount|one list|in a sentence)/.exec(amountNotes(x, sampler(x.program.length * 7))[0]!)![1])).size).toBe(4);
  expect(amountNotes(ACTS[0]!, sampler(1))).toEqual([]);

  // Where a value stands: said against its label and again inside the text, the field's is the one against the label,
  // and nothing is left ambiguous; the text's span is the whole of it.
  const x = gold.find((y) => { const m = /"([^"]*It (sets|allows)[^"]*)"/.exec(y.program); return m && y.program.split(m[1]!).length === 2; })!;
  const c = (calls.parseProgram(x.program) as { lines: calls.Line[] }).lines[0]!.call;
  const spec = x.forms!.find((f) => f.form === (c.args.form as { id: string }).id)!;
  const said = (k: string) => { const v = c.args[k]!; return "text" in v ? v.text : (v as { id: string }).id; };
  const [textKey] = Object.keys(c.args).filter((k) => spec.fields[k]?.type === "text");
  const lines = Object.keys(c.args).filter((k) => spec.fields[k]?.type === "amount");
  const others = Object.keys(c.args).filter((k) => !["form", "to", textKey].includes(k) && !lines.includes(k));
  const label = (k: string) => k.replace(/_/g, " ");
  const head = `Submit the ${label(said("form"))} to ${said("to")}: ${others.map((k) => `${label(k)} ${said(k)}; `).join("")}`;
  const tail = ` ${label(textKey!)}: ${said(textKey!)}`;
  for (const request of [`${head}${lines.map((k) => `${label(k)} ${said(k)}`).join("; ")}.${tail}`, `Submit the ${label(said("form"))} to ${said("to")}.${tail} ${others.map((k) => `${label(k)} ${said(k)}; `).join("")}${lines.map((k) => `${said(k)} under ${label(k)}`).join(", ")}.`]) {
    const spans = spansIn(request, x.program, x.forms);
    const at = spans.find((sp) => sp.arg === textKey)!.at!;
    expect(request.slice(...at)).toBe(said(textKey!));
    let repeated = 0;
    for (const k of lines) {
      const sp = spans.find((y) => y.arg === k)!;
      expect([k, sp.how, sp.ambiguous, request.slice(...sp.at!)]).toEqual([k, "copy", undefined, said(k)]);
      expect(sp.at![1] <= at[0] || sp.at![0] >= at[1]).toBe(true); // outside the text
      expect(request.slice(0, sp.at![0]).endsWith(`${label(k)} `) || request.slice(sp.at![1]).startsWith(` under ${label(k)}`)).toBe(true); // against its own label
      if (said(textKey!).includes(said(k))) repeated++;
    }
    expect(repeated).toBeGreaterThan(0);
    expect(onlyInsideAnother(request, x.program, x.forms)).toBe(false);
  }
  // An amount said only inside the text is under no label: the request is not the call's, and is dropped.
  const inText = lines.find((k) => said(textKey!).includes(said(k)))!;
  const lacking = `${head}${lines.filter((k) => k !== inText).map((k) => `${label(k)} ${said(k)}`).join("; ")}.${tail}`;
  expect(onlyInsideAnother(lacking, x.program, x.forms)).toBe(true);
  const plan = planOf([x], { writers: ["w"], perGold: 1, styles: ["formal"], seed: 2 });
  expect(plan[0]!.brief).toContain("each said against the form's own label for it");
  expect(plan[0]!.brief).toContain(formLine(spec));
  const dropped = await fromWritten(plan, [{ writer: "w", requests: [{ id: plan[0]!.id, request: lacking }] }]);
  expect(dropped.rejects.map((r) => r.why)).toEqual(["not_copied"]);
  const kept = await fromWritten(plan, [{ writer: "w", requests: [{ id: plan[0]!.id, request: `${head}${lines.map((k) => `${label(k)} ${said(k)}`).join("; ")}.${tail}` }] }]);
  expect(kept.examples.map((e) => [e.program, e.spans!.filter((sp) => sp.ambiguous).length])).toEqual([[x.program, 0]]);
  // The whole of them through the pipeline, in every style: by file as by model, and no span left ambiguous by a repeat.
  const o = { perGold: 2, seed: 6 };
  const run = await generate(gold.slice(0, 40), { ...o, writers: [model("a")] });
  expect(run.rejects).toEqual([]);
  const items = planOf(gold.slice(0, 40), { ...o, writers: ["stand-in/a"] });
  expect((await fromWritten(JSON.parse(JSON.stringify(items)), [{ writer: "stand-in/a", requests: written(items) }], o)).examples).toEqual(run.examples);
  expect(run.examples.filter((e) => e.kind === "positive").length).toBe(80);
  for (const e of run.examples.filter((y) => y.kind === "positive")) for (const sp of e.spans!) expect([sp.arg, sp.ambiguous]).toEqual([sp.arg, undefined]);
});

test("two acts that are one request: an act and a direction to someone about it, or the same thing done twice; two lines, never too much", async () => {
  // Where the line is (the translator's own rules): these are on the side of one request.
  expect(translatorSystem()).toContain("doing something together with writing to someone about that same thing (hand in a proposal and ask the clerk to put it to a ballot");
  expect(translatorSystem()).toContain("as is the same kind of thing done several times");
  const form = g("form(form=permit_application, to=pos.9, lot=lot-00-00)", { forms: [{ form: "permit_application", to: "pos.9", fields: { lot: { type: "lot", required: true } } }] });
  const withdrawal = g('statement(withdraw=rec.44, text="It was issued in error.")');
  const rand = sampler(5);
  expect(pairOf(ACTS[0]!, rand)).toBeUndefined(); // a payment has no second act of these kinds
  expect(pairOf(g('statement(kind=notice, text="Closed.")'), rand)).toBeUndefined();
  const kinds = new Set<string>(), tos = new Set<string>();
  let cited = 0;
  for (let i = 0; i < 300; i++) {
    const base = i % 2 ? form : withdrawal;
    const made = pairOf(base, rand)!;
    kinds.add(made.pair);
    const p = calls.parseProgram(made.gold.program) as { lines: calls.Line[] };
    // The act as it was, then one more line; no line made of the other; the same family as the act alone.
    expect(p.lines.length).toBe(2);
    expect(calls.programText({ lines: [p.lines[0]!] })).toBe(calls.programText(calls.parseProgram(base.program)));
    expect(made.gold.family).toBe(base.program);
    expect(calls.contractErrors(p)).toEqual([]);
    const second = p.lines[1]!.call;
    if (made.pair === "withdraw+withdraw") {
      expect([second.fn, Object.keys(second.args), made.letter]).toEqual(["statement", ["withdraw"], undefined]);
      expect((second.args.withdraw as { id: string }).id).not.toBe("rec.44");
    } else {
      expect(made.pair).toBe(i % 2 ? "form+message" : "withdraw+message");
      expect(second.fn).toBe("message");
      expect(isLetter(made.letter!) || "re" in second.args).toBe(true);
      tos.add("id" in second.args.to! ? (/^pos\./.test(second.args.to.id) ? "office" : "other") : "words");
      // It says what it is about only for a withdrawal, and then it is the thing withdrawn.
      if ("re" in second.args) { cited++; expect([made.pair, (second.args.re as { id: string }).id]).toEqual(["withdraw+message", "rec.44"]); }
    }
  }
  expect(kinds).toEqual(new Set(["form+message", "withdraw+message", "withdraw+withdraw"]));
  expect(tos).toEqual(new Set(["office", "other", "words"]));
  expect(cited).toBeGreaterThan(5);

  // Planned: a share of the programs that can carry a second act; for those alone, if asked. Nothing else changes.
  const gold = [form, withdrawal, g("statement(withdraw=rec.45)"), g("statement(withdraw=rec.46)"), ...ACTS];
  expect(planOf(gold, { writers: ["w"], perGold: 2, seed: 3 }).some((t) => t.kind === "request" && t.pair)).toBe(false);
  const o = { perGold: 6, pairs: 1, pairsOnly: true, seed: 3 };
  const plan = planOf(gold, { ...o, writers: ["stand-in/a"] }).filter((t): t is Extract<PlanItem, { kind: "request" }> => t.kind === "request");
  expect(plan.length).toBe(6 * 5); // (rec.44 is withdrawn by one of ACTS too)
  expect(plan.every((t) => t.pair && t.gold.program.split("\n").length === 2)).toBe(true);
  const half = planOf(gold, { writers: ["w"], perGold: 6, pairs: 0.5, seed: 3 }).filter((t) => t.kind === "request");
  expect(half.length).toBe(gold.length * 6);
  expect(half.filter((t) => t.kind === "request" && t.pair).length).toBeGreaterThan(8);
  expect(half.filter((t) => t.kind === "request" && t.pair).length).toBeLessThan(22);
  for (const t of plan) {
    expect(t.brief.startsWith(`Call:\n${withText(t.gold.program, "⟦…⟧")}\n\n`)).toBe(true);
    if (t.pair === "withdraw+withdraw") { expect([t.indirect, t.brief.includes("The same thing done twice in one request")]).toEqual([undefined, true]); continue; }
    expect(t.indirect).toBe(true);
    expect(t.brief).toContain("Two things in one request, as office-holders ask them");
    expect(t.brief).toContain("the direction is the last sentence of the request");
    expect(t.brief).toContain("the direction is part of what is asked");
    expect(t.brief).toMatch(/The direction, said something like: "(direct|ask|tell|instruct|have|get) .+ ⟦…⟧"\./);
    expect(t.brief.includes("name that id again where they are directed, outside the marks")).toBe(/^message\(.*re=/m.test(t.gold.program));
    // (Its further sentences are an act's: about the act, with other things named, where the voice has them.)
    if (t.style === "late") expect(t.brief).toMatch(/After the act, write (two|three|four|five) sentences[^]*name exactly these other things by id, as things the act leaves alone/);
    expect(t.inside).toBeUndefined();
  }

  // Written: a positive of two lines, the letter's text the words that were marked; by file as by model.
  const all = { ...o, pairsOnly: false, refusalFloor: 4 };
  const run = await generate(gold, { ...all, writers: [model("a")] });
  const items = planOf(gold, { ...all, writers: ["stand-in/a"] });
  const files = await fromWritten(JSON.parse(JSON.stringify(items)), [{ writer: "stand-in/a", requests: written(items) }], all);
  expect(files.examples).toEqual(run.examples);
  expect(run.rejects).toEqual([]);
  const pairs = run.examples.filter((e) => e.pair);
  expect(pairs.length).toBe(30);
  expect(run.manifest.pairs).toEqual({ "form+message": 6, "withdraw+message": expect.any(Number), "withdraw+withdraw": expect.any(Number) });
  for (const e of pairs) {
    const p = calls.parseProgram(e.program) as { lines: calls.Line[] };
    expect([e.kind, p.lines.length, e.program.startsWith("none(")]).toEqual(["positive", 2, false]);
    expect([form.program, withdrawal.program, "statement(withdraw=rec.45)", "statement(withdraw=rec.46)", "statement(withdraw=rec.44)"]).toContain(e.gold!); // kept, in a split, with the act alone
    expect(e.request).not.toMatch(/[⟦⟧]/);
    for (const sp of e.spans!) expect(typeof sp.line).toBe("number");
    if (e.pair === "withdraw+withdraw") {
      expect(e.spans!.filter((sp) => sp.arg === "withdraw").map((sp) => sp.line)).toEqual([0, 1]);
      continue;
    }
    // The direction's words: the second line's text, where they were marked; who it goes to is the second line's too.
    const text = e.spans!.find((sp) => sp.arg === "text" && sp.line === 1)!;
    expect([text.how, e.request.slice(...text.at!)]).toEqual(["copy", text.value]);
    expect(text.value).toMatch(/^put it on the list for the next meeting \([a-z0-9]+\)$/);
    expect(calls.callText(p.lines[1]!.call)).toContain(`text="${text.value}"`);
    expect(e.spans!.some((sp) => sp.arg === "to" && sp.line === 1)).toBe(true);
    // (A withdrawal's own words stay its own: the first line's text is not the direction's.)
    const first = e.spans!.find((sp) => sp.arg === "text" && sp.line === 0);
    if (first) expect(first.value).toBe("It was issued in error.");
  }
  // Nothing built as too much has such a request for a part, in the whole or on either side of a split.
  const ids = new Set(pairs.map((e) => e.id));
  const built = (es: typeof run.examples) => es.filter((e) => e.program === "none(too_much)" && e.built_from);
  expect(built(run.examples).length).toBeGreaterThan(0);
  for (const e of built(run.examples)) expect(e.built_from!.some((id) => ids.has(id))).toBe(false);
  const again = builtRefusals(run.examples.filter((e) => e.kind === "positive"), 3, 0.05, { too_much: 12 });
  expect(again.filter((e) => e.program === "none(too_much)").length).toBeGreaterThan(5);
  for (const e of again) if (e.built_from) expect(e.built_from.some((id) => ids.has(id))).toBe(false);
  // A direction left unmarked is no request for the pair: dropped with its reason, as a letter's is.
  const unmarked = await generate(gold, { ...o, writers: [model("a", (b) => say(b).replace(/[⟦⟧]/g, ""))] });
  expect(unmarked.manifest.dropped.marks).toBe(plan.filter((t) => t.indirect).length);
  expect(unmarked.examples.filter((e) => e.pair).every((e) => e.pair === "withdraw+withdraw")).toBe(true);
});
