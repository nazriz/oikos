#!/usr/bin/env bun
// Writes wave 2's queue files and its tables: `bun docs/waves/wave-2/make.ts [--out DIR]`.
// Six queues (three stages, each for the Claude Code lane and the Codex lane) and matrix.md, into this folder or --out.
// Nothing here starts a pilot or calls a model: the files are read by scripts/pilot-queue.ts when the wave is started.
// The reasoning is in plan.md; the figures the estimates rest on are named where they are used.
// Second version (2026-10-09): what changed from the first, and why, is the CHANGES list below (it heads matrix.md).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const outDir = argv.includes("--out") ? argv[argv.indexOf("--out") + 1]! : import.meta.dir;
// (Where the run server keeps things: the queue runner passes `env` on to the run as written.)
const HOME = process.env.OIKOS_RUN_HOME ?? "/Users/clawd";
const DAY = 86_400;
const WORLD = "worlds/town-1000.yaml";

const MODELS = {
  sonnet: "claude-code/claude-sonnet-5-5",
  haiku: "claude-code/claude-haiku-5-5",
  fable: "claude-code/claude-fable-5-1",
  sol: "codex/gpt-6.1-sol",
  luna: "codex/gpt-6-luna",
} as const;
type ModelKey = keyof typeof MODELS;
/** The translators: two general models under the translator's prompt (0.9.0), and the trained one on disk, which was
 * taught none of the hold, the own-books entry, look_first, an office's own forms, directions or standing work. */
const TRANSLATORS = { sol: "codex/gpt-6.1-sol", luna: "codex/gpt-6-luna", trained: "decide/pod-small-d16-s1" } as const;
type TranslatorKey = keyof typeof TRANSLATORS;

interface Plan {
  n: number; tag: string; stage: "2a" | "2b" | "2c"; model: ModelKey; profile: string; seed: number; days: number;
  scenario?: string; seats: string[]; translator: TranslatorKey; test?: boolean; why: string;
  /** A probe: an office or a pace not tried with a model, short, with a stopping rule of its own (plan.md). */
  probe?: boolean;
  /** The town starts with its works crew still to be taken on (`works_crew_at_start=0`), so the works office recruits. */
  noCrew?: boolean;
}

// ---- the offices that can be seats now, how much of a seat's pace each is (1 = a busy office such as the mayor's), and
// what each has honest reason to ask for through `do` in sixty days at the pace of one sitting a working day (a central
// guess from what the office's code does as a mock seat: docs/behaviour/office-papers.md, and the office demonstration
// in docs/decisions.md, where a works manager asked for 18 things in 44 sittings, a registrar 4 and a mayor 6). A real
// seat asks for less or more of it by its model (REQUESTS_FACTOR below).
type Mix = { [kind: string]: number };
const OFFICE: { [id: string]: { weight: number; mix: Mix } } = {
  "mayor": { weight: 1, mix: { form: 4, statement: 1, structure: 0.5, agreement: 0.5 } },
  "finance": { weight: 1, mix: { money: 2, statement: 2 } },
  "planning": { weight: 0.35, mix: { form: 1, claim: 1 } },
  "inspector": { weight: 0.35, mix: { form: 0.5, claim: 0.5 } },
  "council-clerk": { weight: 0.8, mix: { form: 5, statement: 1 } },
  "councillor": { weight: 0.3, mix: { vote: 3 } },
  "editor": { weight: 0.6, mix: { form: 8 } },
  "registry": { weight: 0.5, mix: { form: 4 } },
  "land-registrar": { weight: 0.3, mix: { claim: 1, statement: 1 } },
  "child-protection": { weight: 0.2, mix: { presence: 0.3 } },
  "tribunal-member": { weight: 0.4, mix: { form: 3 } },
  "tribunal-registrar": { weight: 0.4, mix: { form: 1, statement: 1 } },
  "landlord": { weight: 1, mix: { form: 7, agreement: 4, occupancy: 1, money: 3 } },
  "bank-lending": { weight: 1, mix: { form: 4, agreement: 3, money: 1, claim: 1 } },
  "police-oic": { weight: 0.8, mix: { work: 2, form: 2 } },
  "union-organiser": { weight: 0.8, mix: { form: 3, agreement: 1 } },
  "shop": { weight: 1, mix: { goods: 8, work: 6, money: 3, form: 3 } },
  "factory": { weight: 1, mix: { work: 6, goods: 5, form: 2, money: 2 } },
  "works": { weight: 1, mix: { work: 2, form: 1, agreement: 1, statement: 1 } },
  "environment": { weight: 0.6, mix: { work: 2, form: 1, statement: 1, agreement: 1 } },
  "clinic-manager": { weight: 0.6, mix: { work: 1, form: 1, agreement: 1, statement: 1 } },
  "principal": { weight: 0.6, mix: { work: 2, form: 1, agreement: 1 } },
  "water-operations": { weight: 0.6, mix: { work: 2, statement: 1 } },
  "energy-operations": { weight: 0.6, mix: { work: 2, statement: 1, money: 1 } },
  "rates": { weight: 0.5, mix: { work: 1, statement: 1 } },
};
/** What a works office with its crew still to take on adds (the demonstration: six advertisements, eight offers). */
const NO_CREW_ADDS: Mix = { form: 5, agreement: 7, statement: 1 };
const officeOf = (seat: string) => seat.replace(/^landlord-\d+-office$/, "landlord").replace(/^councillor-\d+$/, "councillor").replace(/^shop-\d+-manager$/, "shop").replace(/^factory-\d+-manager$/, "factory");
/** What a scenario adds to an office's sixty days (the presets seen to reach an office: docs/scenarios.md). */
const SCENARIO_ADDS: { [scenario: string]: { [office: string]: Mix } } = {
  "election-due": { mayor: { form: 1, statement: 1 }, editor: { form: 2 }, "council-clerk": { position: 1 } },
  "wet-year": { mayor: { structure: 1, money: 1, statement: 1 }, landlord: { structure: 1, money: 1, form: 1 }, inspector: { form: 1, claim: 0.5 }, planning: { form: 1, claim: 1 } },
  "hot-summer": { registry: { form: 2 }, mayor: { statement: 1 } },
  "lean-council": { finance: { statement: 2, money: 1 }, mayor: { form: 2, statement: 1 } },
  "dear-rents": { landlord: { form: 1 }, mayor: { statement: 1 }, "bank-lending": { form: 1 }, "tribunal-member": { form: 1 } },
};
/** Offices the trained translator must not serve (their business is acts it was never taught). */
const NOT_FOR_TRAINED = ["works", "registry", "land-registrar", "clinic-manager", "principal", "water-operations", "energy-operations", "rates", "environment", "landlord", "bank-lending", "shop", "factory", "police-oic", "union-organiser", "council-clerk", "editor", "tribunal-member", "tribunal-registrar"];
/** Offices with no model in them, ever or yet (plan.md says why for each). */
const NEVER_A_SEAT = ["bank-payments", "builder-foreman", "fund-trustee", "electoral"];
/** A council clerk held by a model: the known open fault (a mock clerk counts no votes) makes these entries depend on its fix. */
const dependsOnClerk = (p: Plan) => p.seats.includes("council-clerk");

// ---- pace and cost, per weighted seat-day, from the live check of 2026-10-09 (runs/live-check-2026-10-09/README.md:
// four 12-day pilots of mayor, finance and planning, 28.2 weighted seat-days each).
const RATE: { [m in ModelKey]: { answers: number; usdPerAnswer: number; secondsPerCall: number; requests: number; letters: number; measured: string } } = {
  sonnet: { answers: 0.32, usdPerAnswer: 0.03, secondsPerCall: 13, requests: 0.4, letters: 0.05,
    measured: "the live check: 10 and 8 answers in 12 days; 0.026 an answer where no whole register came back; 131 s for 10 answers" },
  haiku: { answers: 0.53, usdPerAnswer: 0.08, secondsPerCall: 20, requests: 0.4, letters: 0.15,
    measured: "the live check: 15 answers in 12 days; a median of 0.085 an answer; 301 s for 15 answers" },
  fable: { answers: 0.35, usdPerAnswer: 0.2, secondsPerCall: 30, requests: 0.4, letters: 0.05,
    measured: "not measured in a seat: the first model's pace and about seven times its cost, a guess" },
  sol: { answers: 1.5, usdPerAnswer: 0, secondsPerCall: 24, requests: 1.8, letters: 2.9,
    measured: "the live check: 43 answers and 83 letters in 12 days; 51 calls in 20 min 41 s; a flat subscription, recorded as nothing" },
  luna: { answers: 1.0, usdPerAnswer: 0, secondsPerCall: 15, requests: 1, letters: 1,
    measured: "not measured in a seat: a guess between the two families" },
};
const MOCK_SECONDS_A_DAY = 1.5; // (the town itself: about a second and a half a simulated day at 1,000 people with seats)
const TRANSLATOR_CALLS_A_REQUEST = 1.3; // (a request asked back is asked again)

const P = (n: number, tag: string, stage: Plan["stage"], model: ModelKey, profile: string, days: number, seats: string[], translator: TranslatorKey, why: string, o: { scenario?: string; test?: boolean; probe?: boolean; noCrew?: boolean } = {}): Plan =>
  ({ n, tag, stage, model, profile, seed: (o.test ? 900 : 100) + n, days, seats, translator, why, ...o });

const C3 = ["councillor-1", "councillor-2", "councillor-3"];
const C5 = [...C3, "councillor-4", "councillor-5"];
// Numbers 1 to 18 and 21 to 32 are the first version's pilots (changed as CHANGES says); 41 to 47 (the Claude Code lane)
// and 33 to 38 (the Codex lane) are new. The order within a stage and lane is the order here.
const plans: Plan[] = [
  // ---- wave 2a, the shake-down: short, each one new in one or two ways. The Claude Code lane.
  P(10, "works", "2a", "sonnet", "gb-eng-2026", 45, ["works", "registry", "environment"], "sol", "The works office and the registry held by a model, under a code mayor: standing work orders set once, a crew advertised for and taken on, deaths entered on the register's form.", { probe: true, noCrew: true }),
  P(1, "council", "2a", "sonnet", "au-vic-2026", 45, ["mayor", "council-clerk", ...C5], "luna", "A council of models: the first votes any seat has cast, a clerk who puts ballots and declares results, and a mayor who may direct the code-run works office."),
  P(3, "election", "2a", "sonnet", "de-ni-2026", 75, ["mayor", "editor", "council-clerk"], "sol", "An election due on day 60, run by the code electoral commission, in a place that writes a decimal comma: a nomination, the paper's items, and a clerk who seats whoever is declared elected.", { scenario: "election-due" }),
  P(4, "townhall", "2a", "haiku", "us-oh-2026", 45, ["mayor", "finance", "planning"], "trained", "The familiar three offices on the smaller model with the trained translator: where it fails on what it was not taught."),
  // ---- wave 2a: the Codex lane.
  P(33, "works", "2a", "sol", "au-vic-2026", 30, ["mayor", "works", "registry"], "sol", "The works office and the registry on the other family, with a model mayor beside them: directions to an office a model holds.", { probe: true, noCrew: true }),
  P(22, "townhall", "2a", "luna", "jp-akita-2026", 30, ["mayor", "finance", "planning"], "trained", "The familiar three offices on a weaker model, in a currency with no smaller unit, with the trained translator."),
  P(23, "newplace", "2a", "sol", "mx-jal-2026", 30, ["mayor", "landlord-3-office", "registry"], "sol", "A test-only pilot in the shake-down, to prove the mark carries: a profile no training pilot uses.", { test: true }),

  // ---- wave 2b, the body: the Claude Code lane. Those that need the Codex window least are last.
  P(41, "works", "2b", "haiku", "jp-akita-2026", 90, ["mayor", "works", "registry"], "sol", "The works office and the registry on the smaller model, with a model mayor."),
  P(42, "townworks", "2b", "sonnet", "us-oh-2026", 90, ["mayor", "works", "finance"], "sol", "The mayor, the works manager and the treasury for a quarter, the crew still to be taken on: the budget's staff line, advertisements, offers, a round set going.", { noCrew: true }),
  P(45, "lean", "2b", "sonnet", "de-ni-2026", 90, ["mayor", "finance", "planning"], "sol", "A town with almost nothing in the bank and a code-run works office: holds on standing payments, and directions on whether to recruit.", { scenario: "lean-council" }),
  P(6, "justice", "2b", "sonnet", "de-ni-2026", 90, ["tribunal-member", "tribunal-registrar", "registry", "land-registrar", "child-protection", "inspector"], "sol", "Offices that decide and record: the tribunal, the two registers, child protection, the inspector."),
  P(8, "heat", "2b", "sonnet", "jp-akita-2026", 90, ["mayor", "registry", "editor", "child-protection"], "sol", "A hot summer: what the mayor, the registrar and the paper ask for when the bureau warns.", { scenario: "hot-summer" }),
  P(5, "landlords", "2b", "sonnet", "us-oh-2026", 90, ["landlord-1-office", "landlord-2-office", "landlord-3-office", "bank-lending"], "luna", "Three letting offices and the lender where rents are dear: listings, leases, increases, loans.", { scenario: "dear-rents" }),
  P(2, "housing", "2b", "haiku", "gb-eng-2026", 60, ["landlord-1-office", "landlord-2-office", "tribunal-member", "tribunal-registrar"], "luna", "Landlords and the tribunal on the smaller model where rents are dear: leases, notices, orders.", { scenario: "dear-rents" }),
  P(7, "election", "2b", "haiku", "au-vic-2026", 75, ["mayor", "council-clerk", ...C3], "luna", "An election with a model mayor standing and a model clerk to seat the winner, on the smaller model.", { scenario: "election-due" }),
  P(43, "care", "2b", "sonnet", "gb-eng-2026", 45, ["clinic-manager", "principal"], "sol", "A probe: the clinic and the school, each a routine set once for its staff and then managed by exception.", { probe: true }),
  P(44, "utilities", "2b", "sonnet", "au-vic-2026", 45, ["water-operations", "energy-operations", "rates"], "sol", "A probe: the two utilities and the rates office: supply, billing and the levy as standing orders.", { probe: true }),
  P(9, "trade", "2b", "sonnet", "au-vic-2026", 30, ["shop-1-manager", "factory-1-manager"], "sol", "A probe: one shop and one factory of many, for goods and work; serving and making are still by hand (plan.md, the gaps).", { probe: true }),
  P(12, "flood", "2b", "sonnet", "gb-eng-2026", 150, ["mayor", "planning", "finance", "landlord-1-office"], "luna", "A wet year, long enough to hold the river's high month: permits, repairs, payments.", { scenario: "wet-year" }),
  P(11, "heat", "2b", "haiku", "de-ni-2026", 90, ["mayor", "finance", "inspector"], "trained", "A hot summer on the smaller model with the trained translator.", { scenario: "hot-summer" }),
  // ---- wave 2b: the Codex lane. Works and the registry first, then the short ones; the dearest of the window last.
  P(34, "works", "2b", "sol", "de-ni-2026", 60, ["works", "registry", "land-registrar", "environment"], "sol", "The works office, both registers and the environment office under a code mayor."),
  P(35, "works", "2b", "luna", "gb-eng-2026", 60, ["mayor", "works", "registry"], "sol", "The works office and the registry on the weaker model of the other family."),
  P(24, "election", "2b", "sol", "gb-eng-2026", 75, ["mayor", "editor", "councillor-1", "councillor-2"], "sol", "An election with a model mayor standing, the commission and the clerk both run by code: it does not wait on the clerk's fault.", { scenario: "election-due" }),
  P(26, "council", "2b", "luna", "au-vic-2026", 45, ["mayor", ...C5], "trained", "A mayor and five councillors on the weaker model under a code clerk, with the trained translator: votes and proposals are what it was taught."),
  P(37, "lean", "2b", "luna", "gb-eng-2026", 60, ["mayor", "finance", "planning"], "luna", "A town with almost nothing in the bank, on the weaker model.", { scenario: "lean-council" }),
  P(36, "offices", "2b", "sol", "us-oh-2026", 45, ["rates", "water-operations", "principal"], "sol", "A probe: three offices with routines on the other family.", { probe: true }),
  P(30, "trade", "2b", "sol", "au-vic-2026", 30, ["shop-2-manager", "factory-2-manager"], "sol", "The trade probe on the other family.", { probe: true }),
  P(21, "lending", "2b", "sol", "au-vic-2026", 45, ["bank-lending", "finance", "landlord-1-office"], "luna", "The lender, the treasury and a landlord: loans, payments, leases."),
  P(25, "rents", "2b", "sol", "us-oh-2026", 60, ["mayor", "landlord-1-office", "registry", "editor"], "sol", "Dear rents in a fourth currency's town: the petition, the mayor, a landlord, the paper, the registrar.", { scenario: "dear-rents" }),
  P(28, "housing", "2b", "luna", "de-ni-2026", 60, ["landlord-1-office", "landlord-2-office", "tribunal-member"], "luna", "Landlords and the tribunal on the weaker model."),
  P(29, "lending", "2b", "sol", "jp-akita-2026", 60, ["bank-lending", "landlord-1-office", "landlord-2-office", "tribunal-registrar"], "luna", "Loans and leases in whole units of money."),

  // ---- wave 2c: the long one and the tests; after 2b's reports are read.
  P(13, "flood-long", "2c", "sonnet", "au-vic-2026", 180, ["mayor", "finance", "planning", "inspector", "landlord-1-office", "landlord-2-office"], "luna", "The longest: half a year of a wet year with six seats.", { scenario: "wet-year" }),
  P(14, "largest", "2c", "fable", "au-vic-2026", 45, ["mayor", "finance", "landlord-1-office"], "sol", "Test-only: a model no training pilot has in a seat.", { test: true }),
  P(46, "largest-works", "2c", "fable", "de-ni-2026", 45, ["mayor", "works", "registry"], "sol", "Test-only: that model in the works office and the registry.", { test: true }),
  P(15, "largest-election", "2c", "fable", "gb-eng-2026", 75, ["mayor", "editor", "councillor-1", "councillor-2"], "sol", "Test-only: that model again, through an election, under a code clerk.", { test: true, scenario: "election-due" }),
  P(16, "newplace", "2c", "sonnet", "mx-jal-2026", 60, ["mayor", "landlord-1-office", "bank-lending", "registry"], "sol", "Test-only: a profile no training pilot uses.", { test: true }),
  P(47, "newplace-works", "2c", "haiku", "mx-jal-2026", 60, ["works", "registry", "finance"], "sol", "Test-only: that profile's works office and registry on the smaller model.", { test: true }),
  P(18, "newoffices", "2c", "sonnet", "au-vic-2026", 60, ["police-oic", "union-organiser", "finance"], "sol", "Test-only: two offices no training pilot has as a seat (the police and the union).", { test: true }),
  P(17, "newmoney", "2c", "haiku", "in-tn-2026", 60, ["mayor", "finance", "planning"], "trained", "Test-only: a profile whose amounts are grouped in twos and said in lakh and crore, which the trained model has never read.", { test: true }),
  // ---- wave 2c: the Codex lane.
  P(38, "newmoney-works", "2c", "sol", "in-tn-2026", 60, ["mayor", "works", "registry"], "sol", "Test-only: that profile's works office and registry.", { test: true }),
  P(31, "newmoney", "2c", "luna", "in-tn-2026", 60, ["mayor", "finance", "planning"], "luna", "Test-only: that profile's amounts from the other family's weaker model.", { test: true }),
  P(32, "newoffices", "2c", "sol", "us-oh-2026", 60, ["police-oic", "union-organiser", "mayor"], "sol", "Test-only: the held-out offices on the other family.", { test: true }),
  P(27, "flood", "2c", "sol", "de-ni-2026", 150, ["mayor", "planning", "inspector", "landlord-1-office"], "luna", "A wet year where amounts are written with a comma. The longest draw on the Codex window: last, and the one to drop if the window is short.", { scenario: "wet-year" }),
];

/** What changed from the first version (2026-10-08), and why. Heads matrix.md; plan.md says more. */
const CHANGES: string[] = [
  "**Seat ids were read again from a generated town** (all nine profiles have the same offices). Every id the first version used still exists. New: `land-registrar` (the land registry is a body of its own; `registry` is still the town's register of births and deaths). `electoral` now belongs to the electoral commission, and **is no longer a seat in this wave**: a seat cannot write the roll, the ballot paper or the count (docs/behaviour/office-papers.md), so an election with a model there would not be held. The commission is run by code in all five election pilots; the appointment (`position`) is now the council clerk's act, so it comes from the pilots with a model clerk.",
  "**Works and the registry are seats in training pilots on four seat models each** (works: w2-10, w2-42 Sonnet; w2-41 Haiku; w2-33, w2-34 sol; w2-35 luna. Registry: those but w2-42, and w2-06, w2-08, w2-25), and in test pilots (works 3, the registry 5). Three works pilots start with the crew still to be taken on (`works_crew_at_start=0`), so the office advertises and hires; the others start with a crew and the office sets its round.",
  "**The other newly possible offices each appear once or twice, as short probes**: the clinic and the school (w2-43), both utilities and rates (w2-44), and rates, water and the school again on the other family (w2-36).",
  "**A model mayor beside a code-run works office in 22 pilots** (every mayor pilot without a works seat), so a direction has an office that follows it; in six more the works office is a model's too, which decides for itself what to do with one.",
  "**Scenarios:** `lean-council` (w2-45, w2-37) and `dear-rents` (w2-05, w2-02, w2-25) are new; `hot-summer` falls from three pilots to two (it bites faintly); `election-due` and `wet-year` as before. No entry names a preset that is inert.",
  "**Translators.** The trained one (`decide/pod-small-d16-s1`) falls from twelve pilots to five, none with an office whose business is forms of its own, standing work or the registers: three town halls (mayor, finance, planning or inspector) and the council of councillors under a code clerk. The prompt-driven arm is `codex/gpt-6.1-sol` in 26 pilots (every works and registry pilot, the probes, the elections but one, the lean council on Claude seats, every prompt-driven test pilot but one) and `codex/gpt-6-luna` in 12 (landlords, lenders, the tribunal, the floods, the council of votes, the weaker Codex model's own town halls).",
  "**The council clerk is a model in three pilots only, none longer than its purpose needs** (w2-01 45 days; w2-03 and w2-07 75, for polling day 60): a clerk held by the mock counts no votes, and a model's is untried. The other councils and elections have a code clerk.",
  "**Thirteen pilots added** (w2-33 to w2-38, w2-41 to w2-47), none dropped: 43, of which 11 test-only. The Claude Code lane grew most (25 pilots): its usage is not the constraint, the Codex window is.",
  "**Shorter where the Codex window pays for it, or a probe is a probe:** the Codex shake-down is three pilots of 30 days (a 12-day pilot of three gpt-6.1-sol seats took 20 minutes of calls in the live check); the trade probes 30 days (were 60); elections 75 (were 90); the Codex lane's lender and rents pilots 60; its 150-day flood is last of all (2c), the one to drop if the window is short.",
  "**Each pilot is a town of its own:** `seed=N` in an entry's `sets` is the description's seed, which the generator makes the town from (and the run's seed follows it); no two entries share one, and none is a seed used before (801 to 804 were the live check's).",
  "**Estimates are rebuilt on the live check of 2026-10-09** (answers a seat-day by model, cost an answer without the whole-register fault, seconds a call) and the office demonstration; the first version's were about three times too high in calls for Claude seats and half too low for gpt-6.1-sol.",
];

// ---- checks on the plan itself.
const TEST_ONLY = { profiles: ["mx-jal-2026", "in-tn-2026"], offices: ["police-oic", "union-organiser"], models: ["fable"] };
const PROFILES_OUT = ["ke-nakuru-2026", "br-mg-2026"];
const SCENARIOS_OFFERED = ["wet-year", "hot-summer", "election-due", "lean-council", "jobs-slump", "housing-shortage", "dear-rents"];
for (const p of plans) {
  for (const s of p.seats) {
    if (NEVER_A_SEAT.includes(s)) throw new Error(`pilot ${p.n}: ${s} is not a seat in this wave`);
    if (!OFFICE[officeOf(s)]) throw new Error(`pilot ${p.n}: ${s} is not an office this wave seats`);
    if (p.translator === "trained" && NOT_FOR_TRAINED.includes(officeOf(s))) throw new Error(`pilot ${p.n}: the trained translator must not serve ${s}`);
  }
  if (new Set(p.seats).size !== p.seats.length) throw new Error(`pilot ${p.n}: a seat named twice`);
  if (!p.test && (TEST_ONLY.profiles.includes(p.profile) || TEST_ONLY.models.includes(p.model) || p.seats.some((s) => TEST_ONLY.offices.includes(s)))) throw new Error(`pilot ${p.n} trains on something held out`);
  if (PROFILES_OUT.includes(p.profile)) throw new Error(`pilot ${p.n}: ${p.profile} is out of this wave`);
  if (p.scenario && !SCENARIOS_OFFERED.includes(p.scenario)) throw new Error(`pilot ${p.n}: ${p.scenario} is not a scenario that reaches an office`);
  if (p.profile === "in-tn-2026" && p.seats.some((s) => officeOf(s) === "landlord")) throw new Error(`pilot ${p.n}: no landlord seat in that profile (its rent share)`);
  if (p.noCrew && !p.seats.includes("works")) throw new Error(`pilot ${p.n}: a crew to take on, and nobody in the works office to do it`);
  if (dependsOnClerk(p) && p.days > 75) throw new Error(`pilot ${p.n}: a model clerk for more than 75 days`);
}
if (new Set(plans.map((p) => p.n)).size !== plans.length || new Set(plans.map((p) => p.seed)).size !== plans.length) throw new Error("a number or a seed is used twice");
const training = plans.filter((p) => !p.test);
for (const office of ["works", "registry"]) {
  const models = new Set(training.filter((p) => p.seats.includes(office)).map((p) => p.model));
  if (models.size < 2) throw new Error(`${office} is a seat on fewer than two models in training`);
}
for (const office of ["clinic-manager", "principal", "water-operations", "energy-operations", "rates"]) if (!training.some((p) => p.seats.includes(office))) throw new Error(`${office} is a seat nowhere`);
if (!training.some((p) => p.seats.includes("mayor") && !p.seats.includes("works"))) throw new Error("no model mayor beside a code-run works office");

// ---- estimates.
const isClaude = (p: Plan) => MODELS[p.model].startsWith("claude-code/");
const weightOf = (p: Plan) => p.seats.reduce((a, s) => a + OFFICE[officeOf(s)]!.weight, 0);
const answersOf = (p: Plan) => weightOf(p) * p.days * RATE[p.model].answers;
const usdOf = (p: Plan) => answersOf(p) * RATE[p.model].usdPerAnswer;
const lettersOf = (p: Plan) => weightOf(p) * p.days * RATE[p.model].letters;
const kindsOf = (p: Plan): Mix => {
  const out: Mix = {};
  for (const s of p.seats) {
    const o = officeOf(s);
    for (const mix of [OFFICE[o]!.mix, (p.scenario && SCENARIO_ADDS[p.scenario]?.[o]) || {}, o === "works" && p.noCrew ? NO_CREW_ADDS : {}])
      for (const [k, v] of Object.entries(mix)) out[k] = (out[k] ?? 0) + ((v * p.days) / 60) * RATE[p.model].requests;
  }
  return out;
};
const requestsOf = (p: Plan) => Object.values(kindsOf(p)).reduce((a, b) => a + b, 0);
/** Calls on the Codex subscription: the seats' if they are Codex models, and the translator's if it is one. */
const codexCallsOf = (p: Plan) => (isClaude(p) ? 0 : answersOf(p)) + (p.translator === "trained" ? 0 : requestsOf(p) * TRANSLATOR_CALLS_A_REQUEST);
const codexMinutesOf = (p: Plan) => ((isClaude(p) ? 0 : answersOf(p) * RATE[p.model].secondsPerCall) + (p.translator === "trained" ? 0 : requestsOf(p) * TRANSLATOR_CALLS_A_REQUEST * RATE[p.translator === "sol" ? "sol" : "luna"].secondsPerCall)) / 60;
const minutesOf = (p: Plan) => (answersOf(p) * RATE[p.model].secondsPerCall + (isClaude(p) ? codexMinutesOf(p) * 60 : requestsOf(p) * TRANSLATOR_CALLS_A_REQUEST * 10) + p.days * MOCK_SECONDS_A_DAY) / 60;
/** The spending limit a pilot is given: five times its estimate, in fives, at least ten (a whole register in one
 * answer cost 0.56 to 2.36 in the live check: ten is five to twenty such answers). */
const budgetOf = (p: Plan) => (isClaude(p) ? Math.max(10, Math.ceil((usdOf(p) * 5) / 5) * 5) : 25);

// ---- the queue entries.
const name = (p: Plan) => `w2-${String(p.n).padStart(2, "0")}-${p.tag}`;
const translatorSays = (p: Plan) => (p.translator === "trained" ? " (the trained one: it was taught no hold, entry on one's own file, look_first, office's own form, direction or standing work)" : " (under the translator's prompt)");
const entry = (p: Plan) => {
  const others = p.seats.filter((s) => s !== "mayor");
  return {
    name: name(p), world: WORLD,
    sets: [`seed=${p.seed}`, `profile=${p.profile}`, ...(p.seats.includes("mayor") ? ["mayor=llm"] : []), ...(others.length ? [`model_seats=${others.join(",")}`] : []), ...(p.noCrew ? ["works_crew_at_start=0"] : [])],
    ...(p.scenario ? { args: ["--scenario", p.scenario] } : {}),
    model: MODELS[p.model], translator: TRANSLATORS[p.translator], until: p.days * DAY, budget: budgetOf(p),
    env: { OIKOS_CLAUDE_BIN: `${HOME}/.local/bin/claude`, OIKOS_TRANSLATOR_MODELS: `${HOME}/oikos/runs/translator-model` },
    ...(p.test ? { test: true } : {}),
    note: `Wave ${p.stage} (plan of 2026-10-09), for the translator's data. Profile ${p.profile}; a town of its own, generated from seed ${p.seed}; 1,000 people; ${p.days} days${p.scenario ? `; starting conditions ${p.scenario}` : ""}${p.noCrew ? "; the works crew still to be taken on" : ""}. Seats: ${p.seats.join(", ")}, all on ${MODELS[p.model]}. Translator: ${TRANSLATORS[p.translator]}${translatorSays(p)}. Every draft is confirmed or declined by its seat.${p.test ? " TEST ONLY: kept out of training." : ""}${p.probe ? " A PROBE: stop it by its own rule (plan.md, the stopping rules)." : ""}${dependsOnClerk(p) ? " Depends on the council clerk counting votes (a known open fault)." : ""} ${p.why}`,
  };
};
const lanes: { [file: string]: Plan[] } = {};
for (const stage of ["2a", "2b", "2c"] as const) for (const claude of [true, false]) lanes[`wave-${stage}-${claude ? "claude" : "codex"}.json`] = plans.filter((p) => p.stage === stage && isClaude(p) === claude);
mkdirSync(outDir, { recursive: true });
for (const [file, ps] of Object.entries(lanes)) writeFileSync(join(outDir, file), JSON.stringify(ps.map(entry), null, 1) + "\n");

// ---- the tables.
const f1 = (x: number) => x.toFixed(x < 10 ? 1 : 0);
const hours = (m: number) => (m < 90 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`);
const total = (ps: Plan[], of: (p: Plan) => number) => ps.reduce((a, p) => a + of(p), 0);
const marks = (p: Plan) => [p.test ? "test only" : "", p.probe ? "probe" : "", p.noCrew ? "no crew at the start" : "", dependsOnClerk(p) ? "model clerk" : ""].filter(Boolean).join("; ");
const L: string[] = ["# Wave 2: the tables", "", "Written by `make.ts`; do not edit by hand. The reasoning is in `plan.md`.", ""];
L.push("## What changed from the first version (2026-10-08), and why", "", ...CHANGES.map((c) => `- ${c}`), "");
L.push("## The matrix", "", "Every town is 1,000 people and a town of its own (generated from its seed); every pilot's confirmation mode is `always` (the only one a generated town has). The order is the order in the queue files.", "",
  "| pilot | stage | lane | profile | seed | days | scenario | seats (all on the pilot's model) | seat model | translator | marks |", "|---|---|---|---|---|---|---|---|---|---|---|");
for (const p of plans) L.push(`| ${name(p)} | ${p.stage} | ${isClaude(p) ? "Claude Code" : "Codex"} | ${p.profile} | ${p.seed} | ${p.days} | ${p.scenario ?? "none"} | ${p.seats.join(", ")} | ${MODELS[p.model]} | ${TRANSLATORS[p.translator]} | ${marks(p)} |`);
L.push("", "## Expected usage and time", "", "Plan usage is in US dollars at published prices, as the run records it (a Codex call is recorded as nothing). Time is the pilot's own, without waits at a usage limit. Codex calls are what the pilot draws from the Codex subscription's window: its seats' answers if they are Codex models, and its translator's calls if that is one.", "",
  "| pilot | seats | weighted seat-days | seat answers | requests through `do` | letters | plan usage | spending limit | Codex calls | time |", "|---|---|---|---|---|---|---|---|---|---|");
for (const p of plans) L.push(`| ${name(p)} | ${p.seats.length} | ${Math.round(weightOf(p) * p.days)} | ${Math.round(answersOf(p))} | ${Math.round(requestsOf(p))} | ${Math.round(lettersOf(p))} | ${isClaude(p) ? f1(usdOf(p)) : "0 (Codex)"} | ${budgetOf(p)} | ${Math.round(codexCallsOf(p))} | ${hours(minutesOf(p))} |`);
const sumRow = (label: string, ps: Plan[], claude: boolean) => `| ${label} | ${ps.length} | ${Math.round(total(ps, answersOf))} | ${Math.round(total(ps, requestsOf))} | ${claude ? f1(total(ps, usdOf)) : "0 (Codex)"} | ${claude ? total(ps, budgetOf) : "n/a"} | ${Math.round(total(ps, codexCallsOf))} | ${hours(total(ps, codexMinutesOf))} | ${hours(total(ps, minutesOf))} |`;
L.push("", "| stage and lane | pilots | seat answers | requests through `do` | plan usage | sum of spending limits | Codex calls | Codex time | time, one after another |", "|---|---|---|---|---|---|---|---|---|");
for (const stage of ["2a", "2b", "2c"] as const) for (const claude of [true, false]) L.push(sumRow(`${stage}, ${claude ? "Claude Code" : "Codex"}`, plans.filter((p) => p.stage === stage && isClaude(p) === claude), claude));
for (const claude of [true, false]) L.push(sumRow(`all, ${claude ? "Claude Code" : "Codex"}`, plans.filter((p) => isClaude(p) === claude), claude));
L.push("", "By seat model: " + (Object.keys(MODELS) as ModelKey[]).map((m) => { const ps = plans.filter((p) => p.model === m); return `${MODELS[m]} ${ps.length} pilots, ${Math.round(total(ps, answersOf))} answers${RATE[m].usdPerAnswer ? `, ${f1(total(ps, usdOf))} of plan usage` : ""} (basis: ${RATE[m].measured})`; }).join("; ") + ".");

const TODAY: Mix = { message: 1173, statement: 291, form: 204, money: 32, structure: 11, claim: 9, agreement: 4, work: 1, goods: 0, account: 0, occupancy: 0, entity: 0, vote: 0, presence: 0, position: 0, take: 0 };
const sum = (ps: Plan[]) => { const out: Mix = {}; for (const p of ps) for (const [k, v] of Object.entries(kindsOf(p))) out[k] = (out[k] ?? 0) + v; return out; };
const train = sum(training), test = sum(plans.filter((p) => p.test));
L.push("", "## Expected requests through `do`, by kind", "", "Central guesses (a seat's requests, drafted or not); the range that is honest is a third of each to three times it. A form is a paper on a form: a council proposal, a direction to an office, or one of the office's own (an advertisement, a register entry, a decision). A standing work order counts under work; a hold and an entry on one's own file under statement. Letters are written with `write`, which no translator reads: they are counted apart.", "",
  "| kind | as of 2026-10-08 (real and in-situ) | wave 2, training pilots | wave 2, test-only pilots |", "|---|---|---|---|");
for (const k of Object.keys(TODAY)) L.push(`| ${k} | ${k === "message" ? "1,173" : TODAY[k]} | ${k === "message" ? `(letters: about ${Math.round(total(training, lettersOf))})` : Math.round(train[k] ?? 0)} | ${k === "message" ? `(letters: about ${Math.round(total(plans.filter((p) => p.test), lettersOf))})` : Math.round(test[k] ?? 0)} |`);
const tot = (m: Mix) => Math.round(Object.values(m).reduce((a, b) => a + b, 0));
L.push(`| all through \`do\` | | ${tot(train)} | ${tot(test)} |`);
const seatDays = (ps: Plan[]) => ps.reduce((a, p) => a + p.seats.length * p.days, 0);
L.push("", `Seat-days (the situations the pipeline's writers are put in, one in three by default): ${seatDays(training)} in training pilots, ${seatDays(plans.filter((p) => p.test))} in test-only pilots.`);
L.push("", "## Coverage", "");
const by = (key: (p: Plan) => string[], ps = plans) => { const m = new Map<string, number>(); for (const p of ps) for (const k of key(p)) m.set(k, (m.get(k) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", "); };
const seatedOn = (office: string) => `${office}: ${by((p) => [MODELS[p.model]], training.filter((p) => p.seats.includes(office)))}`;
L.push(`- Pilots by profile: ${by((p) => [p.profile])}.`, `- Pilots by seat model: ${by((p) => [MODELS[p.model]])}.`, `- Pilots by translator: ${by((p) => [TRANSLATORS[p.translator]])}.`, `- Pilots by scenario: ${by((p) => [p.scenario ?? "none"])}.`,
  `- Pilots an office is a seat in: ${by((p) => [...new Set(p.seats.map(officeOf))])}.`,
  `- Training pilots by seat model, for the offices asked for: ${["works", "registry", "clinic-manager", "principal", "water-operations", "energy-operations", "rates"].map(seatedOn).join("; ")}.`,
  `- A model mayor beside a code-run works office: ${plans.filter((p) => p.seats.includes("mayor") && !p.seats.includes("works")).map(name).join(", ")}.`,
  `- A model mayor beside a model works office: ${plans.filter((p) => p.seats.includes("mayor") && p.seats.includes("works")).map(name).join(", ")}.`,
  `- Entries that depend on a model council clerk counting votes: ${plans.filter(dependsOnClerk).map(name).join(", ")}.`,
  `- Probes: ${plans.filter((p) => p.probe).map(name).join(", ")}.`,
  `- Test-only: ${plans.filter((p) => p.test).map(name).join(", ")}.`,
  `- Claude Code pilots that need the Codex window (a Codex translator): ${plans.filter((p) => isClaude(p) && p.translator !== "trained").length} of ${plans.filter(isClaude).length}, about ${Math.round(total(plans.filter(isClaude), codexCallsOf))} Codex calls in all; the Codex lane's own: about ${Math.round(total(plans.filter((p) => !isClaude(p)), codexCallsOf))}.`,
  `- Seats on a model that is not one of the two readers (the first Claude model and the first Codex model): ${plans.filter((p) => p.model !== "sonnet" && p.model !== "sol").length} of ${plans.length} pilots.`);
writeFileSync(join(outDir, "matrix.md"), L.join("\n") + "\n");
console.log(Object.entries(lanes).map(([f, ps]) => `${f}: ${ps.length}`).join("; ") + "; matrix.md");
