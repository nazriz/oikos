// Founding and words, in a running town (docs/behaviour/founding.md; docs/design/ai-citizens.md 10k step 3).
// - With founding off, a living town is the town it was before founding, to the state hash.
// - With founding on and no composer, people found things and no model is called: what a thing is for is the plain
//   statement code writes; it keeps a record of its own with its founder's want; others join it.
// - With the composer on (the mock here, and a scripted translator), a piece is asked for, logged and capped; its
//   parts go through the translator and are carried out only as the founder's module says a draft may be; what the
//   translator gets wrong arrives as the composer's closed choice; the same seed gives the same town; a resumed run
//   is served its composing calls from the log; `oikos dataset` writes the lineage of every idea.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCompose, mockCompose, MockAdapter, mockPolicies, type LlmAdapter, type LlmRequest } from "@oikos/participants/llm";
import { Randomness, type ComposeBrief } from "@oikos/participants";
import { loadWorld } from "../src/batch";
import { exportDataset } from "../src/dataset";
import { recordChanges, Records } from "../src/records";
import { recordedCalls, Serving } from "../src/resume";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const NS = "urn:oikos:contracts:0.8";
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
for (const f of readdirSync(join(root, "contracts")).filter((f) => f.endsWith(".schema.json"))) ajv.addSchema(JSON.parse(readFileSync(join(root, "contracts", f), "utf8")));
const check = (ref: string, row: unknown) => {
  const v = ajv.getSchema(`${NS}:${ref}`)!;
  if (!v(row)) throw new Error(`${ref}: ${JSON.stringify(v.errors).slice(0, 800)} in ${JSON.stringify(row).slice(0, 600)}`);
};
const rows = (path: string) => readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const lean = (config: any) => ({ ...config, seed: 1, log: { ...config.log, detail: "lean" } });
const TOWN = join(root, "worlds/town.yaml");
// (Every occasion founds: the profile's fitted chance, scaled up to certainty. Even so the small town's first
// founding is on day 177: an occasion needs someone from beyond the household known to share the want. So these runs
// are long ones. A town that is compared runs at the scale of 10,000.)
const SURE = "living.founding.scale_bps=600000";
// (2026-10-12, homes by income: one other who shares the want is enough here, where the profile asks two. Until then
// this small town's occasions were mostly wants about homes its households could not pay for, shared by many; without
// that artefact nobody in it founds anything in 205 days at the profile's two, nor at one with frictions as sourced: so
// things also go wrong six times as often as sourced, as the other small-town tests have them. The study's own knob, docs/behaviour/
// founding.md; the first test, which holds the town with founding off and on to one state, does not use it.)
const ONE = "living.founding.shared_min=1";
const WRONGS = "living.friction_bps=60000";
const LIVING = "living.initiative_bps=10000";

// The state of worlds/town.yaml as a living town (initiative at 10,000, frictions as sourced), seed 1, after 60 days,
// as origin/main gave it before founding (commit 7d36367, living world step 2b; computed there on 2026-10-11). A
// change meant to move what a living town without founding does changes this value, and says so where it is made.
// Moved on purpose at the merge of the firm and landlord fixes, 2026-10-11 (it was 26cf8b5e..., step 2b's; docs/
// decisions.md, "Four faults on the firm and landlord side"): a living town without founding is no longer step 2b's,
// because firms and landlords are not behind any dial. The bank writes on each payment what it was for; shops and
// factories hold their staff through a dip; a tenant behind with the rent is given a notice to vacate under the
// town's published law; a business of one can be started; short pay's chance is over the jobs exposed. What this
// test guards is unchanged: founding off, or on with no shape to found, moves nothing.
// And again at the merge of the fixes after the second living pilot, the same day (13686d37... until then;
// docs/decisions.md, "What the second living pilot found"): rent and loan repayments are counted from each
// agreement's own day, each landlord takes arrears up on its own day of the week, the mayor's office has a clerk.
// And again on 2026-10-12, with the fixes after the third living pilot (87f8af1b... until then; docs/decisions.md,
// "What the third living pilot found" and "A draw is named for what it is about"): draws about a paper no longer
// turn on the paper's number on file; a notice to vacate does to a tenant what a notice on the lease did.
// And again on 2026-10-12, with homes dealt by income (0adec141... until then; docs/decisions.md, "Homes by income"):
// every town opens differently (payments in force, people with nothing coming in living with kin, owners by the
// head's age, tenancies by income).
// And again on 2026-10-12, with what the fifth living pilot found (c23648b8... until then; docs/decisions.md, "What the
// fifth living pilot found"): the law on possession says what the place's law has of a plan, the tribunal's answer
// form is published, tenants answer an application as often as tenants there do, a household with no dwelling asks
// to be taken in, a warrant's paper says how many were put out, and a month's world price is drawn for the month.
// And again on 2026-10-12, with returns on the law's days (with the last: docs/decisions.md, "Returns on the law's
// days"): every employer files its withholding returns on the days the law states.
// And again on 2026-10-12, with trade credit, inputs bought to what can be sold, no dividend while wages are owed, and a second loan
// (0082e01e... until then; docs/decisions.md, "Firms respond to a shock"): in a 60-day run the factories buy their inputs on the world
// market's terms and the shops their stock on the factories', paying after the goods are in, so the accounts and orders move from the first week.
// And again on 2026-10-12, with the leftovers of the firm-side work (fb6725b2... until then; docs/decisions.md, "The leftovers of
// the firm-side work"): a shop's month and first review are on a day of its own and begin from the trade it was staffed for, and the
// outside world's order book no longer returns a dividend or tax withheld paid into its account.
// Moved on 2026-10-12 by payments that carry a budget line (19c27253... until then; docs/decisions.md, "Opening caseloads of the other
// offices ... payments that carry a budget line"): the town's opening wage orders name the staff line, and the finance office has two
// parameters more. The same reason as living-dial.test.ts's step 1.
// Moved again on 2026-10-12 by draws named for the day or the matter, not the hour (63630936... until then; docs/decisions.md, "Draws and
// the moment"): the same reason as living-dial.test.ts's step 1 (4e4868c3... for the first version, which counted hours).
// Moved again on 2026-10-13 (21464c87... until then; docs/decisions.md, "Hours before heads"): the same reason as living-dial.test.ts's step 1.
// Moved again on 2026-10-15, foundations F1 (e5111b98... until then): the same reason as living-dial.test.ts's step 1.
// (Re-taken on 2026-10-15 at foundations F3; ff96bf60... until then. docs/decisions.md, "Foundations F3".)
// (Re-taken on 2026-10-15 at foundations F4: the same reason as living-dial.test.ts's step 1; 90b19b40... until then.)
// (Re-taken on 2026-10-16 at foundations F5: the town's offices are held by people, their staff hired, its systems delivered from templates that say what they do; fd6c525e... until then.)
const STEP_2B = "c36fb13611d9afb96a5c6948828931f1f5f6e2a16702a179b7fa70cf5c3cbdb5";

test("with founding off a living town is step 2b's town, to the state hash; turned on with no shape to found, nobody does anything they did not do before", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-founding-"));
  try {
    const plain = (await loadWorld(TOWN, [LIVING])).config;
    expect(plain.dials.founding).toBeUndefined();
    expect(plain.dials.composer).toBeUndefined();
    expect(JSON.stringify(plain)).not.toContain("group.founded");
    expect(JSON.stringify(plain)).not.toContain('"memberships"');
    const off = await runWorld({ config: lean(plain), runId: "off", outDir: out, until: 60 * DAY, recordObservations: "none" });
    expect(off.stateHash).toBe(STEP_2B);
    const on = (await loadWorld(TOWN, [LIVING, "living.founding=true", SURE])).config;
    expect(on.dials.founding).toEqual({ shapes: ["gathering", "fund", "cause", "business"], scale_bps: 600_000 });
    const none = await runWorld({ config: { ...lean(on), dials: { ...on.dials, founding: { shapes: [], scale_bps: 600_000 } } }, runId: "none", outDir: out, until: 60 * DAY, recordObservations: "none" });
    // (Its people are handed the founding figures and one more channel, which are part of the world's state: so the
    // hash is another town's, and what is the same is everything anybody did.)
    expect({ commands: none.commands, refused: none.refused, wakes: none.wakes }).toEqual({ commands: off.commands, refused: off.refused, wakes: off.wakes });
    const founding = await runWorld({ config: lean(on), runId: "on", outDir: out, until: 60 * DAY, recordObservations: "none" });
    expect(founding.stateHash).not.toBe(off.stateHash);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 1_200_000);

test("founding in code: with the composer off no model is called; a founded thing says what it is for in plain words, keeps its founder's want in a record of its own, and is joined", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-founding-"));
  try {
    const config = (await loadWorld(TOWN, [LIVING, "living.founding=true", SURE, ONE, WRONGS])).config;
    // The generator's part: the profile's sizes reach people, with the post a founder holds and the hall's hire.
    const citizen = config.templates.find((x: any) => x.controller?.params?.founding)?.controller.params.founding ?? config.participants.find((x: any) => x.controller?.params?.founding).controller.params.founding;
    expect(citizen.chance_bps).toBeGreaterThan(0);
    expect(citizen.template.role_module).toEqual({ code: "group.founded", params: {}, keeps_record: true });
    expect(citizen.hall.hire).toBeGreaterThan(0);
    expect(citizen.dues[0]).toBe(0);
    expect(config.knowing.published.some((x: any) => x.what === "membership")).toBe(true);
    // (Seed 2, 2026-10-12, draws named for the day or the matter: in seed 1 only one person shared the want that founds; seeds 2 and 5 have two or more, 3 and 4 do not.)
    // (Seed 6 from 2026-10-15, foundations F1: the world differs again; of seeds 1 to 8 only 6 has two or more who share the want that founds.)
    // (Seed 7 from 2026-10-13, hours before heads: the world differs, and seeds 2 and 5 now have one person who shares the want that founds. Which seed has two or more is a matter of draws, not of the rule.)
    // (Seed 1 from 2026-10-16, foundations F6: the world differs again; of seeds 1 to 16 only 1 and 3 have two who share the want that founds. Every other has one.)
    const s = await runWorld({ config: { ...config, seed: 1 }, runId: "code", outDir: out, until: 205 * DAY, recordObservations: "none" });
    expect(s.composer).toBeUndefined();
    const log = readFileSync(s.logPath, "utf8");
    // No model anywhere: not a usage entry, not a transcript.
    expect(log).not.toContain('"annotation":"usage"');
    expect(log).not.toContain('"annotation":"transcript"');
    const dir = join(out, "ds");
    const m: any = await exportDataset(s.logPath, dir);
    check("dataset#/$defs/Manifest", m);
    const founded = rows(join(dir, "founded.jsonl"));
    expect(founded.length).toBeGreaterThan(0);
    for (const f of founded) check("dataset#/$defs/Founded", f);
    const first = founded[0]!;
    expect(first.composer).toBe("none");
    expect(first.sharers).toBeGreaterThanOrEqual(2);
    // What a composing model would be shown is on record all the same: the founder's own record and no one else's.
    const brief = first.brief as ComposeBrief;
    expect(brief.founder).toBe(String(first.founder).replace(/-self$/, ""));
    expect(Object.keys(brief.record)).toContain("values");
    expect(brief.sharers.every((x) => Object.keys(x).sort().join() === "how,who")).toBe(true);
    // Its statement of purpose: code's words, an idea with an id, written by nobody's model.
    const ideas = rows(join(dir, "ideas.jsonl"));
    for (const i of ideas) check("dataset#/$defs/Idea", i);
    const idea = ideas.find((i) => i.idea === first.idea)!;
    expect(idea).toMatchObject({ kind: "purpose", of: first.org, written_by: "code", via: "call", text: brief.code.purpose });
    expect(ideas.filter((i) => i.written_by === "world").length).toBeGreaterThan(0);
    expect(m.ideas.written_by.composer).toBeUndefined();
    // It keeps a record of its own, whole by its chain, with its founder's want as what it is for.
    const built = new Records();
    for await (const c of recordChanges(s.logPath)) built.apply(c);
    const record = built.of.get(first.org)!;
    expect(record.faults).toEqual([]);
    check("entity-record#/$defs/OrganisationRecord", record.sections);
    expect(record.sections.purpose).toMatchObject({ idea: first.idea, founder: brief.founder, shape: first.shape, about: first.about, words: brief.code.purpose, arrived: { purpose: "code", gathers: "code", asks: "code" } });
    expect((record.sections.wants as any[])[0]).toMatchObject({ about: first.about });
    // Its papers: what it is for, a gathering at its founder's home, an offer of membership anyone may take up.
    const acts = log.split("\n").filter((l) => l.includes('"command":"act"') && l.includes(`"${first.org}"`)).map((l) => JSON.parse(l).body).flatMap((b: any) => b.blocks as any[]);
    const gathering = acts.find((b) => b.practice && b.speaks_for === first.org);
    expect(gathering.practice.at).toMatch(/\/dwelling\.\d+$/);
    expect(gathering.practice.roles).toEqual([{ role: "member", open: true }]);
    expect(acts.find((b) => b.kind === "membership" && b.speaks_for === first.org).offer).toMatchObject({ take_up: "join", by: first.org });
    // Its founder belongs to it, as anyone who joins does.
    const passages = rows(join(dir, "idea_passages.jsonl"));
    for (const p of passages) check("dataset#/$defs/IdeaPassage", p);
    expect(passages.some((p) => p.idea === first.idea && p.how === "joined" && p.to === first.founder)).toBe(true);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 1_200_000);

/** A translator that reads the four requests a founder's words make: it writes the name, the purpose and the gathering
 * as calls, and gets the offer of membership wrong (dues into someone else's account). */
function scriptedTranslator(seen: string[]): LlmAdapter {
  const q = (s: string) => JSON.stringify(s);
  return {
    provider: "mock", model: "mock",
    complete: async (req: LlmRequest) => {
      const text = String(req.messages[0]!.content).replace(/^Request: /, "").split("\n")[0]!;
      seen.push(text);
      let m: RegExpExecArray | null;
      const program = (m = /^Found a (\w+) called "(.*)", with me in its first post as (\w+)\.$/.exec(text)) ? `entity(kind=${m[1]}, name=${q(m[2]!)}, position=${q(m[3]!)})`
        : (m = /^Put out a public statement, of kind purpose, in these words: "(.*)"$/.exec(text)) ? `statement(kind=purpose, visible=public, text=${q(m[1]!)})`
        : (m = /^Put up a public notice of our gathering, a practice held at ([^\s,]+)(?:, on (\S+))?: "(.*)"$/.exec(text)) ? `statement(kind=notice, visible=public, text=${q(m[3]!)}${m[2] ? `, on=${m[2]}` : ""}, practice={"at":${q(m[1]!)},"every":${7 * DAY},"lasts":3600})`
        : (m = /^Offer membership publicly, for anyone to join: "(.*)"/.exec(text)) ? `statement(kind=notice, visible=public, text=${q(m[1]!)}, offer={"take_up":"join","terms":{"commitments":[{"who":"taker","does":{"outcome":{"money":{"to":"acc-city","amount":"999"}}},"every":${30 * DAY}}]}})`
        : "none(unclear)";
      const content = [{ type: "tool_use" as const, id: `t${seen.length}`, name: "call", input: { program } }];
      return { content, usage: { input_tokens: 1, output_tokens: 1 }, estimated: true };
    },
  };
}

test("words: a composed piece is asked for and logged; its parts go through the translator and are done only as the founder's module says a draft may be; the rest arrives as a closed choice; the same seed, the same town; a resumed run is served the piece", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-founding-"));
  try {
    const world = async () => ({ ...(await loadWorld(TOWN, [LIVING, "living.founding=true", SURE, ONE, WRONGS, "living.composer=true"])).config, seed: 1 });
    const config = await world();
    expect(config.dials.composer).toEqual({ pieces_per_month: 8, mix: [{ model: "claude-code/claude-sonnet-5-5", share_bps: 5_000 }, { model: "codex/gpt-6.1-sol", share_bps: 5_000 }], fallback: "claude-code/claude-sonnet-5-5", follow_up_bps: 2_500 });
    const asked: string[] = [];
    const a = await runWorld({ config, runId: "a", outDir: out, until: 205 * DAY, recordObservations: "none", translatorAdapter: scriptedTranslator(asked), adapter: new MockAdapter("mock", mockPolicies(new Map())) });
    expect(a.composer!.asked).toBeGreaterThan(0);
    expect(a.composer!.composed + a.composer!.declined).toBe(a.composer!.asked);
    const b = await runWorld({ config: await world(), runId: "b", outDir: out, until: 205 * DAY, recordObservations: "none", translatorAdapter: scriptedTranslator([]), adapter: new MockAdapter("mock", mockPolicies(new Map())) });
    expect(b.stateHash).toBe(a.stateHash);
    const dir = join(out, "ds");
    const m: any = await exportDataset(a.logPath, dir);
    check("dataset#/$defs/Manifest", m);
    const founded = rows(join(dir, "founded.jsonl")).find((f) => f.composer !== "none" && f.composer !== "declined")!;
    expect(config.dials.composer.mix.map((x: any) => x.model)).toContain(founded.composer);
    // The start of the log says who composes and that the mock played them here; its end, what was asked.
    const notes = readFileSync(a.logPath, "utf8").split("\n").filter((l) => l.includes('"annotation":"note"')).map((l) => JSON.parse(l).body);
    expect(notes.find((n: any) => n.data?.composer)?.data.composer).toMatchObject({ played_by: "mock", pieces_per_month: 8 });
    expect(notes.find((n: any) => n.data?.composer_pieces)?.data.composer_pieces).toEqual(a.composer);
    // The four parts, each through the translator: three done, the offer of membership not (its dues named another's account).
    const words = rows(join(dir, "words.jsonl")).filter((w) => w.idea === founded.idea);
    for (const w of words) check("dataset#/$defs/Words", w);
    expect(Object.fromEntries(words.map((w) => [w.what, w.result]))).toEqual({ name: "done", purpose: "done", gathers: "done", asks: "not_done" });
    expect(words.find((w) => w.what === "asks")!.why).toContain("account that is not ours");
    expect(words.find((w) => w.what === "name")!.plumbing_added).toBe(true);
    expect(asked.some((t) => t.startsWith('Found a group called "(mock) '))).toBe(true);
    // The name and the statement of purpose are the composer's words; the idea says who wrote it and how it arrived.
    expect(founded.name_by).toBe("translator");
    const idea = rows(join(dir, "ideas.jsonl")).find((i) => i.idea === founded.idea)!;
    expect(idea).toMatchObject({ written_by: "composer", model: founded.composer, via: "translator", for: (founded.brief as ComposeBrief).founder });
    expect(idea.text).toBe(`(mock) ${(founded.brief as ComposeBrief).code.purpose}`);
    expect(m.ideas.composer["dark pieces asked for"] ?? 0).toBe(a.composer!.dark);
    // The organisation: named by the composer; gathering as the translator's draft said (weekly, an hour), which is
    // among what was open; membership by the composer's closed choice, written by code.
    const log = readFileSync(a.logPath, "utf8");
    const acts = log.split("\n").filter((l) => l.includes('"command":"act"')).map((l) => JSON.parse(l).body);
    const made = acts.find((x: any) => x.blocks.some((k: any) => k.block === "create_entity" && k.name?.startsWith("(mock) ")));
    expect(made.provenance.via).toBe("translator");
    expect(made.blocks[0].first_position.role_module.code).toBe("group.founded");
    const blocks = acts.flatMap((x: any) => x.blocks as any[]).filter((k: any) => k.speaks_for === founded.org);
    expect(blocks.find((k) => k.practice).practice).toMatchObject({ every: 7 * DAY, lasts: 3_600 });
    const membership = blocks.find((k) => k.kind === "membership");
    expect(["choice", "code"]).toContain(membership.data.words);
    expect(membership.offer.terms.commitments.every((c: any) => c.does?.outcome?.money?.to !== "acc-city")).toBe(true);
    const built = new Records();
    for await (const c of recordChanges(a.logPath)) built.apply(c);
    expect((built.of.get(founded.org)!.sections.purpose as any).arrived).toMatchObject({ purpose: "translator", gathers: "translator" });
    check("entity-record#/$defs/OrganisationRecord", built.of.get(founded.org)!.sections);
    // A resumed run is served the piece from the log: the same request, no live call.
    const serving = new Serving(recordedCalls(a.logPath));
    const live: LlmAdapter = { provider: "mock", model: "mock", complete: async () => { throw new Error("a live call where the log has the answer"); } };
    const r = new Randomness(BigInt(config.seed));
    const again = createCompose({ annotate: async () => {}, now: () => 0, prices: { "mock/mock": { input: 0, output: 0 } } }, config.dials.composer, new Map(config.dials.composer.mix.map((x: any) => [x.model, serving.wrap(live)])), (purpose) => r.stream(["compose", purpose]));
    const piece = await again(founded.brief as ComposeBrief, founded.founder);
    expect(piece).toMatchObject({ declined: false, model: founded.composer, purpose: idea.text });
    expect(serving.served).toBeGreaterThan(0);
    expect(serving.diverged).toBeUndefined();
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 1_800_000);

test("the composer is never asked more often than its dial allows: at nothing a month no model is called, and every statement is the plain one", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-founding-"));
  try {
    const config = { ...(await loadWorld(TOWN, [LIVING, "living.founding=true", SURE, ONE, WRONGS, "living.composer.pieces_per_month=0"])).config, seed: 1 };
    expect(config.dials.composer.pieces_per_month).toBe(0);
    const s = await runWorld({ config: lean(config), runId: "capped", outDir: out, until: 205 * DAY, recordObservations: "none" });
    expect(s.composer).toMatchObject({ asked: 0, composed: 0 });
    expect(s.composer!.capped).toBeGreaterThan(0);
    const log = readFileSync(s.logPath, "utf8");
    expect(log).not.toContain('"purpose":"compose"');
    expect(log).toContain('"result":"capped"');
    expect(log).toContain('"written_by":"code"');
    // A mix that names a model never to compose is refused before the run begins.
    await expect(runWorld({ config: { ...lean(config), dials: { ...config.dials, composer: { pieces_per_month: 1, mix: [{ model: "codex/gpt-6-astra", share_bps: 10_000 }] } } }, runId: "never", outDir: out, until: DAY, recordObservations: "none" })).rejects.toThrow(/never a composing model/);
    void mockCompose;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 1_200_000);
