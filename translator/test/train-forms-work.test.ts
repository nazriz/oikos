// A direction on an office's own form, a paper of one's own office and a standing work order (contracts/calls.md,
// 2026-10-09), through the translator's instructions, the training-data pipeline and the seen cases.

import { expect, test } from "bun:test";
import { calls, forms as formReading } from "@oikos/participants";
import type { LlmAdapter, LlmRequest } from "@oikos/participants/llm";
import { CASES } from "../eval/cases";
import { fixture, passes } from "../eval/run";
import { decode, encode, vocabulary } from "../model/encode";
import { translatorContext, translatorSystem, TRANSLATOR_VERSION } from "../src/index";
import { Knowledge } from "../src/knowledge";
import { resolve } from "../src/resolver";
import {
  bringsAbout, builtRefusals, copies, DATA_VERSION, dateForms, FIELD_TYPES, formLine, formOf, formsIn, generate, goldFromCases, isLetter, knowing, literals, needed, optionalIn, ownForm, ownFormNotes, planOf, refusalBriefs, sampler,
  sayingFor, spansIn, surfaceVariant, writerNotes, type FormSpec, type Gold,
} from "../train/data";
import { CURRENCIES, declaredPapers, directions, papers, synthetic } from "../train/synthetic";

const SEED = 7;
const parsed = (program: string) => calls.parseProgram(program) as { lines: calls.Line[] };
const argsOf = (g: Gold) => parsed(g.program).lines[0]!.call.args as { [k: string]: any };
const acts = (g: Gold) => resolve(calls.parseProgram(g.program), g.forms?.length ? knowing(g.forms, g.currency!) : new Knowledge(g.currency!), () => undefined);

test("the versions, and the three rules in the translator's instructions", () => {
  expect(DATA_VERSION).toBe("0.12.0");
  expect(TRANSLATOR_VERSION).toBe("0.9.0");
  const s = translatorSystem();
  for (const rule of [
    "the direction is that form filled in, not a message.",
    "Work one's own staff are to do again and again as a standing routine",
    "work(task=..., at=..., every=\"<how often, as written>\")",
    "pausing it is statement(hold=<it>).",
    "unless a form listed below is that office's form for directing it in that: then it is that form filled in",
    "A paper of the person's own office for which a form is listed",
    "A field that takes several things is a list",
    "a date is copied as the request writes it",
    "->  work(task=mend, at=str.3, every=\"every week\")",
  ]) expect(s).toContain(rule);
  expect(s).toMatch(/- work\([^)]*\bevery\b[^)]*\buntil\b[^)]*\):/);
});

test("field types: a list and a date are types like any other, drawn, shown and found in a request", () => {
  expect(FIELD_TYPES).toContain("list");
  expect(FIELD_TYPES).toContain("date");
  const spec: FormSpec = { form: "hall_register", to: "pos.9", office: "paper", fields: { members: { type: "list", required: true }, starts: { type: "date" }, open: { type: "choice", options: ["yes", "no"] }, tier: { type: "choice", options: ["low", "high"] } } };
  expect(formLine(spec)).toBe("- hall_register, to=pos.9, id form-pos.9-hall-register: fields members (list, required), starts (date), open (one of yes | no), tier (one of low | high)");
  const program = 'form(form=hall_register, to=pos.9, members=["c0003","c0004"], starts="year 1, day 40", open=no, tier=high)';
  // What the request must carry: each item of the list, the date as written, a word chosen from a list. What it may
  // leave unsaid: the form's name, whose office it is (a paper's), a yes or no.
  expect(needed(calls.parseProgram(program), [spec]).map((n) => `${n.arg}=${n.value}${n.exact ? "!" : ""}`).sort()).toEqual(["members=c0003!", "members=c0004!", "starts=year 1, day 40!", "tier=high"]);
  expect(optionalIn(calls.parseProgram(program), [spec]).map((n) => `${n.arg}=${n.value}`).sort()).toEqual(["form=hall_register", "open=no", "to=pos.9"]);
  const request = "Enter c0003 and c0004 as members from year 1, day 40, in the high tier, and keep it closed to the public.";
  expect(copies(request, program, [spec])).toBe(true);
  expect(copies(request, program)).toBe(false); // (without the form, nothing says its name may go unsaid)
  expect(copies(request.replace("c0004", "another"), program, [spec])).toBe(false);
  expect(copies(request.replace("year 1, day 40", "day forty"), program, [spec])).toBe(false);
  const spans = spansIn(request, program, [spec]).map((x) => `${x.arg}=${x.value}: ${x.how}${x.at ? ` "${request.slice(...x.at)}"` : ""}`).sort();
  expect(spans).toEqual(['form=hall_register: implied', 'members=c0003: copy "c0003"', 'members=c0004: copy "c0004"', "open=no: implied", 'starts=year 1, day 40: copy "year 1, day 40"', 'tier=high: choice "high"', "to=pos.9: implied"]);
  // Said, each is where it is said.
  const named = "On the hall register of pos.9: members c0003 and c0004, starts year 1, day 40, tier high, open: no.";
  expect(spansIn(named, program, [spec]).filter((x) => x.how === "implied")).toEqual([]);
  // A form that is nobody's own is as it was: its name and its office are the request's to say.
  const plain = { ...spec, office: undefined } as FormSpec;
  expect(optionalIn(calls.parseProgram(program), [plain])).toEqual([]);
  expect(copies(request, program, [plain])).toBe(false);
  // A day of the first year is written with the year or without; a later year's one way.
  expect(dateForms("year 1, day 40")).toEqual(["day 40"]);
  expect(dateForms("day 40")).toEqual(["year 1, day 40"]);
  expect(dateForms("year 3, day 9")).toEqual([]);
  expect(dateForms("next Tuesday")).toEqual([]);
  const g: Gold = { program, shape: "", names: {}, source: "t", forms: [spec] };
  const written = new Set(Array.from({ length: 30 }, (_, i) => (argsOf(surfaceVariant(g, sampler(i))).starts as { text: string }).text));
  expect([...written].sort()).toEqual(["day 40", "year 1, day 40"]);
});

test("whose form it is: the office it is one office's own form of, first, as the translator is shown it", () => {
  const record = (data: object, more: object = {}) => ({ id: "form-x", record: "statement", kind: "form", author: "genesis", speaks_for: "city", ...more, data: { form: "works_staffing", submit_to: ["city"], fields: { recruit: { type: "choice", options: ["yes", "no"], required: true } }, ...data } });
  expect(formsIn({ records: [record({ office: "works", submit_as: "direction" }, { in_position: "mayor" })] })).toEqual([{ id: "form-x", form: "works_staffing", to: "works", office: "direction", fields: { recruit: { type: "choice", required: true, options: ["yes", "no"] } } }]);
  expect(formsIn({ records: [record({ office: "works", writes: { kind: "x", text: "x" } })] })[0]).toMatchObject({ to: "works", office: "paper" });
  // Without an office it is as it was: the post it was made in, else whom it speaks for, else its author.
  expect(formsIn({ records: [record({}, { in_position: "planning" })] })[0]).toEqual({ id: "form-x", form: "works_staffing", to: "planning", fields: { recruit: { type: "choice", required: true, options: ["yes", "no"] } } });
  expect(formsIn({ records: [record({})] })[0]!.to).toBe("city");
  // The seen cases' forms likewise, and what the generator builds for a round trip shows each as the translator would.
  const seen = goldFromCases(CASES);
  const staffing = seen.find((g) => g.source === "case direction-staffing")!;
  expect([staffing.program, staffing.tag, staffing.forms!.map((f) => `${f.form} to ${f.to} (${f.office})`)]).toEqual(["form(form=works_staffing, recruit=no, to=works)", "direction", ["works_staffing to works (direction)"]]);
  expect(seen.find((g) => g.source === "case paper-invoice-approval")).toMatchObject({ tag: "paper", forms: [{ form: "invoice_approval", to: "mayor", office: "paper" }] });
  expect(seen.find((g) => g.source === "case form-permit")).toMatchObject({ forms: [{ form: "permit_application", to: "planning" }] });
  expect(seen.find((g) => g.source === "case form-permit")!.tag).toBeUndefined();
  for (const set of [directions({ n: 10, seed: SEED })[0]!.forms!, papers({ n: 10, seed: SEED })[0]!.forms!]) {
    const context = translatorContext({ draftId: "d", participant: "someone", proposal: "x", knowledge: knowing(set, CURRENCIES[0]!) });
    expect(context.split("\n").slice(3).sort()).toEqual(set.map(formLine).sort());
  }
});

test("generated gold: directions to offices on their own forms, each one the resolver takes as a direction; and the same directions with no form listed, as letters", () => {
  const gold = directions({ n: 150, seed: SEED });
  expect(gold.length).toBe(150);
  expect(directions({ n: 150, seed: SEED }).map((g) => g.program)).toEqual(gold.map((g) => g.program));
  const types = new Set<string>(), offices = new Set<string>(), names = new Set<string>();
  let beside = 0, yesNo = 0;
  for (const g of gold) {
    const a = argsOf(g);
    const spec = ownForm(g.program, g.forms)!;
    expect([g.tag, g.shape.startsWith("form("), spec.office, spec.form, spec.to]).toEqual(["direction", true, "direction", a.form.id, a.to.id]);
    expect(formLine(spec)).toContain(`- ${spec.form}, to=${spec.to}, id `);
    // An office's id is an id (never an ordinary word), and its form is named for it.
    expect(spec.to).toMatch(/[0-9.-]/);
    offices.add(spec.to);
    names.add(spec.form);
    for (const k of Object.keys(a).filter((k) => !["form", "to"].includes(k))) types.add(spec.fields[k]!.type);
    for (const [k, f] of Object.entries(spec.fields)) if (f.required) expect(Object.keys(a)).toContain(k);
    if (g.forms!.length > 1) beside++;
    if (optionalIn(calls.parseProgram(g.program), g.forms).some((n) => n.arg !== "form")) yesNo++;
    // By this repository's resolver, for someone who knows the forms listed: a direction, to the office, citing the form.
    const r = acts(g);
    expect([g.program, r.ok]).toEqual([g.program, true]);
    if (r.ok) expect(r.blocks).toMatchObject([{ block: "publish", kind: "direction", addressed_to: [spec.to] }]);
    // The request need not name the form, and must name the office and every figure.
    expect(needed(calls.parseProgram(g.program), g.forms).map((n) => n.arg)).not.toContain("form");
    expect(needed(calls.parseProgram(g.program), g.forms).map((n) => n.arg)).toContain("to");
  }
  expect([...types].sort()).toEqual(["amount", "choice", "count", "duration"]);
  expect(offices.size).toBeGreaterThan(12);
  expect(names.size).toBeGreaterThan(20);
  expect(beside).toBeGreaterThan(30);
  expect(yesNo).toBeGreaterThan(30);

  // The other side: the same forms' directions for someone who knows of no form for them.
  const letters = directions({ n: 80, seed: SEED, unlisted: true });
  expect(letters.length).toBe(80);
  let shown = 0, described = 0;
  for (const g of letters) {
    expect([g.tag, isLetter(g.program)]).toEqual(["direction_unlisted", true]);
    const form = /\(([a-z_]+)\)$/.exec(g.source)![1]!;
    // Whatever forms are listed beside it, the form for this direction is not among them.
    expect((g.forms ?? []).map((f) => f.form)).not.toContain(form);
    if (g.forms?.length) shown++;
    if ("text" in argsOf(g).to) described++;
    expect(g.notes!.join(" ")).toContain("there is no form for it");
  }
  expect(shown).toBeGreaterThan(20);
  expect(letters.length - shown).toBeGreaterThan(15);
  expect(described).toBeGreaterThan(3);
  // They are made of the same sets of forms as the directions are.
  expect(letters.filter((g) => names.has(/\(([a-z_]+)\)$/.exec(g.source)![1]!)).length).toBeGreaterThan(40);
  // Asked for as seats direct an office: indirectly, always, with what the direction says given to the writer.
  const plan = planOf(letters.slice(0, 12), { writers: ["w"], perGold: 1, seed: SEED });
  for (const t of plan) {
    expect(t.kind === "request" && t.indirect).toBe(true);
    expect(t.brief).toContain("It directs an office to change something the office does of its own accord");
    expect(t.brief).toContain("What the office is directed to do");
    expect(t.brief).not.toContain("an ordinary administrative task");
  }
});

test("generated gold: papers of an office's own, on its stationery, with lists and dates that the resolver reads", () => {
  const gold = papers({ n: 240, seed: SEED });
  expect(gold.length).toBe(240);
  expect(papers({ n: 240, seed: SEED }).map((g) => g.program)).toEqual(gold.map((g) => g.program));
  const types = new Set<string>(), sizes = new Set<number>(), fields = new Set<number>();
  const declared = new Set(declaredPapers().map((p) => p.form));
  expect(declared.size).toBeGreaterThan(30);
  for (const k of ["death_registration", "job_advertisement", "council_ballot", "industrial_action"]) expect(declared).toContain(k);
  let lists = 0, dates = 0, real = 0, yearless = 0;
  for (const g of gold) {
    const a = argsOf(g);
    const spec = ownForm(g.program, g.forms)!;
    expect([g.tag, spec.office, spec.to]).toEqual(["paper", "paper", a.to.id]);
    // Every form shown is the same office's stationery.
    expect(new Set(g.forms!.map((f) => `${f.to} ${f.office}`))).toEqual(new Set([`${spec.to} paper`]));
    fields.add(Object.keys(spec.fields).length);
    if (declared.has(spec.form)) real++;
    else expect(Object.keys(spec.fields).length >= 2 && Object.keys(spec.fields).length <= 8).toBe(true);
    const r = acts(g);
    expect([g.program, r.ok]).toEqual([g.program, true]);
    if (r.ok) expect(r.blocks).toMatchObject([{ block: "publish", kind: spec.form }]);
    for (const [k, v] of Object.entries(a)) {
      const type = spec.fields[k]?.type;
      if (!type) continue;
      types.add(type);
      if (type === "list") {
        // One to four ids, each once: a list, or one of them bare.
        const items = "id" in v ? [v.id] : (v.json as string[]);
        expect("id" in v || (Array.isArray(v.json) && items.length >= 2)).toBe(true);
        expect([items.length >= 1 && items.length <= 4, new Set(items).size, items.every((x) => /[0-9.-]/.test(x))]).toEqual([true, items.length, true]);
        sizes.add(items.length);
        lists++;
      }
      if (type === "date") {
        expect(v.text).toMatch(/^(year [0-9]+, )?day [0-9]+$/);
        expect(formReading.parseDate(v.text)).toBeGreaterThanOrEqual(0);
        if (!v.text.startsWith("year")) yearless++;
        dates++;
      }
    }
    expect(literals(calls.parseProgram(g.program)).length).toBeLessThanOrEqual(14);
    // The form's name and whose office it is are the request's to say or not.
    expect(optionalIn(calls.parseProgram(g.program), g.forms).map((n) => n.arg)).toEqual(expect.arrayContaining(["form", "to"]));
  }
  expect([...types].sort()).toEqual([...FIELD_TYPES].sort());
  expect([...sizes].sort()).toEqual([1, 2, 3, 4]);
  expect(lists).toBeGreaterThan(40);
  expect(dates).toBeGreaterThan(40);
  expect(yearless).toBeGreaterThan(5);
  expect(real).toBeGreaterThan(24);
  expect(gold.length - real).toBeGreaterThan(real);
  expect(Math.max(...fields)).toBeGreaterThanOrEqual(7);
});

test("generated gold: standing work orders in their combinations, each a work order by the resolver; a day's work, a hold and a withdrawal beside them", () => {
  const work = synthetic({ only: ["work"], perFunction: 600, seed: SEED });
  const standing = work.filter((g) => g.tag === "standing_work");
  expect(standing.length).toBeGreaterThan(120);
  const combos = new Set<string>();
  const tasks = new Set<string>();
  let onList = 0, byList = 0;
  for (const g of standing) {
    const p = calls.parseProgram(g.program);
    const a = argsOf(g);
    expect(calls.contractErrors(p)).toEqual([]);
    expect(Object.keys(a).filter((k) => !["task", "at", "every", "on", "by", "units", "first", "until"].includes(k))).toEqual([]);
    expect(["task", "at", "every"].every((k) => k in a)).toBe(true);
    for (const k of ["every", "first", "until"]) if (k in a) expect(calls.parseDuration(a[k].text)).toBeGreaterThan(0);
    // Ids only, where it is done and to what: never a name that could be a real place's.
    expect(a.at.id).toMatch(/[0-9]/);
    if (a.on && "json" in a.on) onList++;
    if (a.by && "json" in a.by) byList++;
    combos.add(["on", "by", "units", "first", "until"].filter((k) => k in a).join("+"));
    tasks.add(a.task.id);
    const r = acts(g);
    expect([g.program, r.ok]).toEqual([g.program, true]);
    if (r.ok) expect(r.blocks).toMatchObject([{ block: "publish", kind: "work_order", data: { work: { task: a.task.id, at: a.at.id } } }]);
    // How it is put to a writer: as a routine, in one of several ways, with how often in the program's own words.
    expect(bringsAbout(g.program)[0]).toContain("a standing order is set for the speaker's own staff");
    const notes = writerNotes(g.program, sampler(1)).join("\n");
    expect(notes).toContain(`how often is said in exactly these words: "${a.every.text}"`);
    expect(notes).toContain("this is a routine for the speaker's own staff");
  }
  expect(combos.size).toBeGreaterThan(14);
  for (const k of ["", "on", "by", "units", "first", "until"]) expect([...combos].some((c) => c.split("+").includes(k) || c === k)).toBe(true);
  expect(tasks.size).toBeGreaterThan(20);
  expect(onList).toBeGreaterThan(5);
  expect(byList).toBeGreaterThan(5);
  const said = new Set(Array.from({ length: 60 }, (_, i) => sayingFor(parsed('work(task=mend, at=str.3, every="every week")').lines[0]!.call, sampler(i))));
  expect(said.size).toBeGreaterThan(4);
  expect([...said].some((s) => /from now on|until further notice|standing|routine/.test(s!))).toBe(true);
  // The contrast: work asked for once is as it was (so many units, no `every`), and is a day's work by the resolver.
  const once = work.filter((g) => !g.tag && !/survey|investigate/.test(g.shape));
  expect(once.length).toBeGreaterThan(120);
  for (const g of once) {
    expect(Object.keys(argsOf(g)).some((k) => ["every", "first", "until"].includes(k))).toBe(false);
    expect("units" in argsOf(g)).toBe(true);
    expect(bringsAbout(g.program)[0]).toContain("people do so many units of a kind of work");
  }
  const r = acts(once[0]!);
  expect(r.ok && (r.blocks[0] as any).block).toBe("work");
  // A standing order is held and withdrawn by its id, the writer told what the record is.
  const statements = synthetic({ only: ["statement"], perFunction: 900, seed: SEED });
  const held = statements.filter((g) => g.tag === "standing_work_hold"), ended = statements.filter((g) => g.tag === "standing_work_withdraw");
  expect(held.length).toBeGreaterThan(24);
  expect(ended.length).toBeGreaterThan(18);
  for (const g of held) {
    expect(Object.keys(argsOf(g)).filter((k) => k !== "basis")).toEqual(["hold"]);
    expect(g.notes!.join(" ")).toMatch(/standing work orders?/);
  }
  for (const g of ended) {
    expect(Object.keys(argsOf(g))).toEqual(["withdraw"]);
    expect(g.notes!.join(" ")).toContain("a standing work order");
  }
  const plan = planOf([held[0]!, ended[0]!], { writers: ["w"], perGold: 1, seed: SEED, styles: ["formal"] });
  expect(plan[0]!.brief).toContain("What is put on hold is");
  expect(plan[1]!.brief).toContain("the routine is ended for good, not paused");
  // Holds of other standing papers are still there, with nothing said of work.
  expect(statements.filter((g) => !g.tag && g.shape.startsWith("statement(") && "hold" in argsOf(g)).length).toBeGreaterThan(40);
});

test("the whole call language's gold has the new kinds in it, by the function each is of", () => {
  const all = synthetic({ perFunction: 300, seed: SEED });
  const count = (tag: string) => all.filter((g) => g.tag === tag).length;
  expect(all.filter((g) => g.shape.startsWith("form(")).length).toBe(300);
  expect([count("direction"), count("paper")]).toEqual([60, 60]);
  expect(count("direction_unlisted")).toBe(37);
  expect(all.filter((g) => g.shape.startsWith("message(")).length).toBe(300);
  expect(count("standing_work")).toBeGreaterThan(60);
  expect(count("standing_work_hold") + count("standing_work_withdraw")).toBeGreaterThan(6);
  // Asking for one function, or by tag, gives the same programs.
  expect(synthetic({ only: ["form"], perFunction: 300, seed: SEED }).map((g) => g.program)).toEqual(all.filter((g) => g.shape.startsWith("form(")).map((g) => g.program));
});

test("what a writer is told: a direction is worded as directing the office, a paper as the office's own work, and neither as a form handed in", () => {
  const d = directions({ n: 40, seed: SEED }), p = papers({ n: 40, seed: SEED });
  const plan = planOf([...d, ...p], { writers: ["w"], perGold: 2, seed: SEED, pairs: 1 });
  let unnamed = 0, named = 0, pairs = 0;
  for (const t of plan) {
    if (t.kind !== "request") continue;
    // A direction is never paired with a letter about it; a paper may go out with one (and is then said as a paper made out, not a form handed in). Never a total, never "submit the …".
    if (t.gold.tag === "direction") expect(t.pair).toBeUndefined();
    else if (t.pair) (pairs++, expect([t.pair, t.brief.includes("the paper of line 1 is made out"), t.brief.includes("the form of line 1 is handed in")]).toEqual(["form+message", true, false]));
    expect(t.riders.filter((r) => r.kind === "total" || r.kind === "what_next")).toEqual([]);
    expect(t.brief).not.toMatch(/said something like: "(submit|file|lodge|hand in|fill in|put in|send in|complete) /);
    if (t.gold.tag === "direction") {
      expect(t.brief).toContain("This is a direction to an office");
      expect(t.brief).toContain("The office is named by its id, as the one directed.");
    } else expect(t.brief).toContain("This is a paper of the speaker's own office");
    if (/Do not name the form|The form's name need not appear/.test(t.brief)) unnamed++;
    else named++;
    expect(t.brief).toContain("What each answer is:");
  }
  expect(unnamed).toBeGreaterThan(named);
  expect(named).toBeGreaterThan(10);
  expect(pairs).toBeGreaterThan(40);
  // A yes or no is to be said as what is or isn't to be; the form's own words for a field are passed on.
  const staffing = d.find((g) => /_staffing/.test(g.program))!;
  const notes = ownFormNotes(staffing, ownForm(staffing.program, staffing.forms)!, sampler(2)).join("\n");
  expect(notes).toMatch(/recruit is (yes|no) \(Whether the office recruits[^)]*\): say it as what is or is not to be/);
});

/** A writer that words a program as a seat would the new kinds: the form unnamed, a yes or no unsaid, a paper's office
 * unsaid; a letter asked for indirectly with its words marked. */
let arrangements = 0;
const writer: LlmAdapter = { provider: "stand-in", model: "w", complete: async (req: LlmRequest) => {
  const content = String((req.messages[0] as any).content);
  const program = content.slice("Call:\n".length, content.indexOf("\n\n"));
  const p = parsed(program.replace("⟦…⟧", "x"));
  const a = p.lines[0]!.call.args as { [k: string]: any };
  let text: string;
  if (program.includes("⟦…⟧")) text = `Direct ${"id" in a.to ? a.to.id : a.to.text} to ⟦keep to arrangement ${++arrangements} from now on⟧.`;
  else if (p.lines[0]!.call.fn === "form") {
    const paper = content.includes("This is a paper of the speaker's own office");
    const rest = literals(p).filter((x) => x !== a.form.id && !["yes", "no"].includes(x) && !(paper && x === a.to.id));
    text = paper ? `Make out the paper with these particulars: ${rest.join("; ")}.` : `Direct ${a.to.id} as follows: ${rest.filter((x) => x !== a.to.id).join("; ")}.`;
  } else text = `Please see to this: ${literals(p).join(", ")}.`;
  return { content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } };
} };

test("through the pipeline: each kind becomes examples with their spans, none is turned into a refusal for a form unknown, and each is steps a model can decide and copy", async () => {
  const gold = [...directions({ n: 30, seed: SEED }), ...papers({ n: 30, seed: SEED }), ...directions({ n: 20, seed: SEED, unlisted: true }), ...synthetic({ only: ["work"], perFunction: 120, seed: SEED }).filter((g) => g.tag === "standing_work").slice(0, 30)];
  const back = { model: "stand-in/back", translate: async (_q: string, _forms: string[], g?: Gold) => g?.program ?? "none(unclear)" };
  const r = await generate(gold, { writers: [writer], perGold: 1, styles: ["formal", "terse"], seed: SEED, back });
  const kept = r.examples.filter((e) => e.kind === "positive");
  const of = (f: (e: (typeof kept)[number]) => boolean) => kept.filter(f);
  const forms = of((e) => e.shape.startsWith("form("));
  const letters = of((e) => e.shape.startsWith("message("));
  const orders = of((e) => e.shape.startsWith("work("));
  expect([forms.length >= 50, letters.length >= 18, orders.length >= 25]).toEqual([true, true, true]);
  expect(r.manifest.version).toBe("0.12.0");
  expect(r.manifest.dropped.not_copied).toBeLessThan(8);
  for (const e of forms) {
    // The form is shown, its name is nowhere in the request, and the span says so.
    expect(e.forms.some((l) => l.startsWith(`- ${formOf(e.program)!.form}, to=${formOf(e.program)!.to},`))).toBe(true);
    expect(e.spans!.find((x) => x.arg === "form")).toMatchObject({ how: "implied" });
    expect(e.spans!.filter((x) => x.how !== "implied").every((x) => x.at !== undefined)).toBe(true);
  }
  // A direction names its office; a paper leaves its own unsaid.
  expect(forms.filter((e) => e.spans!.some((x) => x.arg === "to" && x.how === "copy")).length).toBeGreaterThan(8);
  expect(forms.filter((e) => e.spans!.some((x) => x.arg === "to" && x.how === "implied")).length).toBeGreaterThan(8);
  expect(forms.filter((e) => e.spans!.some((x) => ["yes", "no"].includes(x.value) && x.how === "implied")).length).toBeGreaterThan(5);
  // The letters: the words marked are the letter's, and some are shown other forms, none the one for their direction.
  for (const e of letters) expect([e.indirect, /text="keep to arrangement [0-9]+ from now on"/.test(e.program)]).toEqual([true, true]);
  expect(letters.some((e) => e.forms.length > 0) && letters.some((e) => e.forms.length === 0)).toBe(true);
  // No refusal says an unknown form was asked for: none of these requests names a form.
  expect(r.examples.filter((e) => e.program === "none(unknown_form)")).toEqual([]);
  expect(builtRefusals(kept, SEED, 0.05, { unknown_form: 40 }).filter((e) => e.program === "none(unknown_form)")).toEqual([]);
  // A request that does name its form is still built into one.
  const naming = forms.slice(0, 6).map((e) => ({ ...e, id: `${e.id}n`, spans: e.spans!.map((x) => (x.arg === "form" ? { ...x, how: "choice" as const, at: [0, 4] as [number, number] } : x)) }));
  expect(builtRefusals(naming, SEED, 0.05, { unknown_form: 6 }).filter((e) => e.program === "none(unknown_form)").length).toBe(6);
  // Steps and back, exactly; the closed set has what standing work needs.
  const all = [...forms, ...letters, ...orders];
  const encoded = all.map((e) => encode(e));
  all.forEach((e, i) => expect(decode(encoded[i]!.input, encoded[i]!.steps)).toBe(calls.programText(calls.parseProgram(e.program))));
  const v = vocabulary(encoded);
  for (const choice of ["fn:work", "arg:every", "arg:until", "arg:first", "fn:form", "arg:form", "[", "]"]) expect(v).toContain(choice);
});

test("refusals: a routine to be changed with nobody addressed and no form is still no act; the brief says so and directs no office", () => {
  const briefs = refusalBriefs(synthetic({ only: ["money"], perFunction: 40, seed: SEED }), 40, SEED).filter((b) => b.label === "no_such_act" && b.brief.includes("routine of their own office"));
  expect(briefs.length).toBeGreaterThanOrEqual(20);
  for (const b of briefs) {
    expect(b.brief).toContain("Nobody is addressed: no office, post or person is named as the one to be directed, told or asked");
    expect(b.brief).toContain("no form is spoken of");
    expect(b.brief).not.toMatch(/\b[Dd]irect (the|an) [a-z]+ office to\b/);
  }
});

test("the seen cases for the three kinds are right by their own scoring, and by the resolver for the test's mayor", () => {
  const seen = (id: string) => CASES.find((c) => c.id === id)!;
  const ids = ["standing-work-routine", "standing-work-roster", "standing-work-hold", "direction-staffing", "direction-collection", "paper-invoice-approval", "paper-nomination"];
  const k = fixture();
  const kinds: string[] = [];
  for (const id of ids) {
    for (const e of seen(id).expect) {
      expect([id, passes(seen(id), e)]).toEqual([id, true]);
      const r = resolve(calls.parseProgram(e), k, () => undefined, "mayor");
      expect([id, e, r.ok]).toEqual([id, e, true]);
      if (r.ok && e === seen(id).expect[0]) kinds.push((r.blocks[0] as any).kind);
    }
  }
  expect(kinds).toEqual(["work_order", "work_order", "hold", "direction", "direction", "approval", "nomination"]);
  // The same acts however spelled; and what the request did not ask for is not right.
  expect(passes(seen("standing-work-routine"), 'work(task=collect, at=str.7, every="7 days")')).toBe(true);
  expect(passes(seen("standing-work-routine"), 'work(task=collect, at=str.7, units="1")')).toBe(false);
  expect(passes(seen("standing-work-routine"), 'message(to=works, text="collect at str.7 every week")')).toBe(false);
  expect(passes(seen("standing-work-hold"), "statement(withdraw=rec.95)")).toBe(false);
  expect(passes(seen("direction-staffing"), "form(form=works_staffing, recruit=no)")).toBe(true);
  expect(passes(seen("direction-staffing"), 'message(to=works, text="stop recruiting until I say otherwise")')).toBe(false);
  expect(passes(seen("direction-staffing"), "none(no_such_act)")).toBe(false);
  expect(passes(seen("direction-collection"), 'form(form=works_collection, to=works, every="14 days")')).toBe(true);
  expect(passes(seen("paper-invoice-approval"), 'statement(kind=approval, text="Approved for payment: rec.640.", basis=rec.640)')).toBe(false);
  // A direction of another kind to the same office, for which no form is listed, is still a letter (the cases that were there).
  expect(seen("pilot-direct").expect[0]).toMatch(/^message\(to=works/);
  expect(seen("described-person-not-look-first").expect[0]).toMatch(/^message\(/);
  // The forms the test's mayor is shown: the works office's two, and two of its own office's.
  const shown = translatorContext({ draftId: "d", participant: "mayor-system", as: "mayor", proposal: "x", knowledge: k }).split("\n").slice(3);
  expect(shown.filter((l) => l.includes(", to=works,")).map((l) => l.slice(2, l.indexOf(","))).sort()).toEqual(["works_collection", "works_staffing"]);
  expect(shown.filter((l) => l.includes(", to=mayor,")).map((l) => l.slice(2, l.indexOf(","))).sort()).toEqual(["invoice_approval", "nomination"]);
  expect(shown.find((l) => l.startsWith("- nomination,"))).toContain("values (list)");
});
