#!/usr/bin/env bun
// Writes wave 2's queue files and its tables: `bun docs/waves/wave-2/make.ts [--out DIR] [--retrained decide/NAME [--retrained-for PILOT,...]]`.
// --retrained names a retrained translator: it then serves the pilot marked `trained` and every pilot marked `trained-ok`
// (or, with --retrained-for, those of them named), and the tables say so. Without it, as the files in this folder are.
// Ten queues and matrix.md, into this folder or --out: for each of three stages, two lanes of pilots whose seats are
// Claude models (`claude-1`: the light ones; `claude-2`: the dear ones) and one optional lane of pilots whose seats are
// Codex models (`codex`), and one file of pilots held back (`wave-2-held-clerk.json`).
// Nothing here starts a pilot or calls a model: the files are read by scripts/pilot-queue.ts when the wave is started.
// The reasoning is in plan.md; the figures the estimates rest on are named where they are used.
// Third version (2026-10-09, later): what changed from the second, and why, is the CHANGES list below (it heads matrix.md).
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  // (The same model asked to reason less: the effort is part of the model's name, so every log records it.)
  haikuLow: "claude-code/claude-haiku-5-5@low",
  fable: "claude-code/claude-fable-5-1",
  sol: "codex/gpt-6.1-sol",
  luna: "codex/gpt-6-luna",
} as const;
type ModelKey = keyof typeof MODELS;
/** The translator of a pilot is a late, cheap choice, so each pilot says which it may have:
 *  - `sonnet`: the general model under the translator's prompt (0.9.0), and no other: where a request not getting through
 *    loses the pilot's point (probes, elections, a crew to take on), where one thing is being measured, and every test pilot;
 *  - `trained-ok`: our own trained translator if the retrained one's scores on the pilot's kinds of act are good enough when
 *    the stage is started (--retrained), else the general model, which is what the files have until then;
 *  - `trained`: our own trained translator, because its failures there are the data wanted.
 * The general model is behind the Claude sign-in (the owner, 2026-10-09: it alone, with no chain of fallbacks; no pilot's
 * translation waits on the Codex window). The trained one on disk was taught none of the hold, the own-books entry,
 * look_first, an office's own forms, directions or standing work; a retrain that is taught them was begun the same day. */
type TranslatorKey = "sonnet" | "trained-ok" | "trained";
const GENERAL = "claude-code/claude-sonnet-5-5";
const TRAINED_ON_DISK = "decide/pod-small-d16-s1";
const RETRAINED = argv.includes("--retrained") ? argv[argv.indexOf("--retrained") + 1]! : undefined;
const RETRAINED_FOR = argv.includes("--retrained-for") ? argv[argv.indexOf("--retrained-for") + 1]!.split(",") : undefined;
/** The lanes: a queue file each a stage. Seats on the first and the largest Claude model are light on the plan (a seat
 * comes back weekly; about three hundredths an answer); seats on the smaller Claude model are dear (three quarters of
 * its output is thinking) and run in a lane of their own, so that one such pilot runs at a time; seats on a Codex model
 * are the optional lane, which runs when the Codex window is open and is parked when it is not. */
type Lane = "claude-1" | "claude-2" | "codex";
const laneOf = (m: ModelKey): Lane => (m === "haiku" || m === "haikuLow" ? "claude-2" : m === "sol" || m === "luna" ? "codex" : "claude-1");

interface Plan {
  n: number; tag: string; stage: "2a" | "2b" | "2c"; model: ModelKey; profile: string; seed: number; days: number;
  scenario?: string; seats: string[]; translator: TranslatorKey; test?: boolean; why: string;
  /** A probe: an office or a pace not tried with a model, short, with a stopping rule of its own (plan.md). */
  probe?: boolean;
  /** The town starts with its works crew still to be taken on (`works_crew_at_start=0`), so the works office recruits. */
  noCrew?: boolean;
  /** Held back, in a queue file of its own that belongs to no stage, until the fault named is settled. */
  held?: "clerk";
}

// ---- the offices that can be seats now, how much of a seat's pace each is (1 = a busy office such as the mayor's), and
// what each has honest reason to ask for through `do` in sixty days at the pace of one sitting a working day (a central
// guess from what the office's code does as a mock seat: docs/behaviour/office-papers.md, and the office demonstration
// in docs/decisions.md, where a works manager asked for 18 things in 44 sittings, a registrar 4 and a mayor 6). A real
// seat asks for less or more of it by its model (`requests` in RATE below).
type Mix = { [kind: string]: number };
const OFFICE: { [id: string]: { weight: number; mix: Mix } } = {
  "mayor": { weight: 1, mix: { form: 4, statement: 1, structure: 0.5, agreement: 0.5 } },
  "finance": { weight: 1, mix: { money: 2, statement: 2 } },
  "planning": { weight: 0.35, mix: { form: 1, claim: 1 } },
  "inspector": { weight: 0.35, mix: { form: 0.5, claim: 0.5 } },
  "council-clerk": { weight: 0.8, mix: { form: 5, statement: 1 } },
  "councillor": { weight: 0.3, mix: { vote: 3 } },
  "editor": { weight: 0.6, mix: { form: 8 } },
  // (The registry's papers follow deaths, counted for each pilot below: DEATHS_IN_180.)
  "registry": { weight: 0.5, mix: {} },
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
  "hot-summer": { mayor: { statement: 1 } },
  "lean-council": { finance: { statement: 2, money: 1 }, mayor: { form: 2, statement: 1 } },
  "housing-shortage": { landlord: { form: 1, agreement: 1 }, "tribunal-member": { form: 0.5 } },
  "jobs-slump": { "bank-lending": { form: 1, claim: 0.5 }, landlord: { form: 1 }, finance: { statement: 0.5 } },
  "energy-price-shock": { "energy-operations": { statement: 1, money: 0.5 }, rates: { statement: 0.5 } },
  "dear-rents": { landlord: { form: 1 }, mayor: { statement: 1 }, "bank-lending": { form: 1 }, "tribunal-member": { form: 1 } },
};
/** Deaths registered in 180 days in a code-run town of 1,000 people, by profile (one town each, seed 7, on f6ac4ee,
 * 2026-10-09: read from each log's death registrations; the first thirty days held one death in one town of the seven
 * and none in the others, and no town had a birth, the first being due about day 275). A registry seat has a paper to
 * write for each: this is what its pilot's length is set by. One town each: the count's own noise is large. */
const DEATHS_IN_180: { [profile: string]: number | undefined } = { "au-vic-2026": 3, "gb-eng-2026": 8, "de-ni-2026": 6, "jp-akita-2026": 4, "us-oh-2026": 10, "mx-jal-2026": 2, "in-tn-2026": 8 };
const deathsOf = (p: Plan) => ((DEATHS_IN_180[p.profile] ?? 0) * p.days) / 180;
/** The fewest deaths a pilot with a registry seat is sized to expect (fewer, and the seat sits idle, as it did for thirty
 * days in the second live check). */
const REGISTRY_NEEDS_DEATHS = 2;
/** The only office the trained translator on disk serves in this wave (votes are what it was taught; any town hall meets holds
 * and withdrawals, of which it refused every one in the second live check: 31 of 44 requests). */
const FOR_TRAINED = ["councillor"];
/** Offices with no model in them, ever or yet (plan.md says why for each). */
const NEVER_A_SEAT = ["bank-payments", "builder-foreman", "fund-trustee", "electoral"];
/** A council clerk held by a model: the known open fault (a mock clerk counts no votes) makes these entries depend on its fix. */
const dependsOnClerk = (p: Plan) => p.seats.includes("council-clerk");

// ---- pace and cost, per weighted seat-day, from the two live checks of 2026-10-09 (runs/live-check-2026-10-09 and
// runs/live-check-2-2026-10-09: nine pilots of three or four seats, 12 and 30 days) and, for the translator, from
// runs/translator-eval-claude-2026-10-09 and runs/claude-translator-check-2026-10-09.
const RATE: { [m in ModelKey]: { answers: number; usdPerAnswer: number; secondsPerCall: number; requests: number; letters: number; measured: string } } = {
  sonnet: { answers: 0.42, usdPerAnswer: 0.03, secondsPerCall: 10, requests: 0.4, letters: 0.03,
    measured: "29 and 28 answers in two 30-day pilots of 70 and 63 weighted seat-days (a seat came back each week: five sittings in thirty days); 0.021 and 0.035 an answer; 9 requests in four pilots where the offices' sixty-day business comes to 24" },
  haiku: { answers: 1.5, usdPerAnswer: 0.17, secondsPerCall: 15, requests: 0.5, letters: 1.2,
    measured: "88 and 126 answers in two 30-day pilots (18.54 and 15.51 recorded; three quarters of its output was thinking); 0.21 and 0.12 an answer; 44 requests in one pilot, 38 of them provoked by a fault since fixed, counted as 6, and 2 in the other" },
  haikuLow: { answers: 1.5, usdPerAnswer: 0.08, secondsPerCall: 10, requests: 0.5, letters: 1.2,
    measured: "not measured in a seat: the smaller model's pace at about half its cost, a guess (three quarters of its output at default effort was thinking; as a reader at low effort it used about three quarters of the tokens and agreed with the settled labels on 26 of 34 where at default effort it agreed on 34). w2-54 is the measurement" },
  fable: { answers: 0.42, usdPerAnswer: 0.2, secondsPerCall: 25, requests: 0.4, letters: 0.03,
    measured: "not measured in a seat: the first model's pace and about seven times its cost, a guess (as a translator it cost 0.03 a request)" },
  sol: { answers: 1.3, usdPerAnswer: 0, secondsPerCall: 24, requests: 1.1, letters: 2.0,
    measured: "43 answers in 12 days and 73 in 25 (83 and 92 letters); 5 requests in 12 days and 3 in 25, where the offices' business comes to 2.4 and 5; a flat subscription, recorded as nothing" },
  luna: { answers: 1.0, usdPerAnswer: 0, secondsPerCall: 15, requests: 0.7, letters: 1,
    measured: "not measured in a seat: a guess between the two families" },
};
const MOCK_SECONDS_A_DAY = 1.5; // (the town itself: about a second and a half a simulated day at 1,000 people with seats)
const TRANSLATOR_CALLS_A_REQUEST = 1.3; // (a request asked back is asked again)
const TRANSLATOR_USD_A_CALL = 0.012; // (the prompt-driven translator: 0.007 a call over 264 calls of the test sets; 0.012 for the one call in a pilot)
const TRANSLATOR_SECONDS_A_CALL = 8;

const P = (n: number, tag: string, stage: Plan["stage"], model: ModelKey, profile: string, days: number, seats: string[], translator: TranslatorKey, why: string, o: { scenario?: string; test?: boolean; probe?: boolean; noCrew?: boolean; held?: "clerk" } = {}): Plan =>
  ({ n, tag, stage, model, profile, seed: (o.test ? 900 : 100) + n, days, seats, translator, why, ...o });

const C3 = ["councillor-1", "councillor-2", "councillor-3"];
const C5 = [...C3, "councillor-4", "councillor-5"];
// Numbers are the pilots' own from the earlier versions (1 to 18, 21 to 38, 41 to 47); 48 to 54 are new. The order
// within a stage and lane is the order here.
const plans: Plan[] = [
  // ---- wave 2a, the shake-down. Lane claude-1 (seats on the first Claude model).
  P(10, "works", "2a", "sonnet", "gb-eng-2026", 180, ["works", "registry", "environment"], "sonnet", "The works office and the registry held by a model, under a code mayor: standing work orders set once, a crew advertised for and taken on, deaths entered on the register's form. Half a year, because that is what gives a registrar a handful of deaths.", { probe: true, noCrew: true }),
  P(44, "utilities", "2a", "sonnet", "au-vic-2026", 45, ["water-operations", "energy-operations", "rates"], "sonnet", "A probe: the two utilities and the rates office: supply, billing and the levy as standing orders.", { probe: true, scenario: "energy-price-shock" }),
  P(9, "trade", "2a", "sonnet", "au-vic-2026", 30, ["shop-1-manager", "factory-1-manager"], "sonnet", "A probe: one shop and one factory of many, for goods and work; serving and making are still by hand (plan.md, the gaps).", { probe: true }),
  P(14, "largest", "2a", "fable", "au-vic-2026", 45, ["mayor", "finance", "landlord-1-office"], "trained-ok", "The largest model in the familiar offices with a landlord beside them: the measure of what it costs and how it works a seat, before its two longer pilots."),
  // ---- wave 2a: lane claude-2 (seats on the smaller Claude model).
  P(54, "effort", "2a", "haikuLow", "us-oh-2026", 30, ["mayor", "finance", "planning"], "sonnet", "The measurement of the smaller model at lower effort, first in its lane: whether its answers are read whole, what a call costs, and what it asks for, beside w2-04 (the same offices and profile at default effort). The rest of the lane is set by what it shows."),
  P(4, "townhall", "2a", "haiku", "us-oh-2026", 45, ["mayor", "finance", "planning"], "sonnet", "The familiar three offices on the smaller model, in a third currency: the measure of what such a pilot costs once the bank's report is right."),
  P(26, "council", "2a", "haiku", "au-vic-2026", 45, C5, "trained", "Five councillors on the smaller model under a code mayor and a code clerk, with the trained translator: votes are what it was taught, and its failures on anything else are the data wanted."),
  // ---- wave 2a: the optional lane (Codex seats; a Claude translator).
  P(33, "works", "2a", "sol", "au-vic-2026", 30, ["mayor", "works", "finance"], "sonnet", "The works office on the other family, with a model mayor and the treasury beside it: directions to an office a model holds.", { probe: true, noCrew: true }),
  P(22, "townhall", "2a", "luna", "jp-akita-2026", 30, ["mayor", "finance", "planning"], "sonnet", "Test-only (a model no training pilot has in a seat): the familiar three offices on the other family's weaker model, in a currency with no smaller unit.", { test: true }),
  P(23, "newplace", "2a", "sol", "mx-jal-2026", 30, ["mayor", "landlord-3-office", "finance"], "sonnet", "A test-only pilot in the shake-down, to prove the mark carries: a profile no training pilot uses.", { test: true }),

  // ---- wave 2b, the body: lane claude-1.
  P(42, "townworks", "2b", "sonnet", "us-oh-2026", 90, ["mayor", "works", "finance"], "sonnet", "The mayor, the works manager and the treasury for a quarter, the crew still to be taken on: the budget's staff line, advertisements, offers, a round set going.", { noCrew: true }),
  P(45, "lean", "2b", "sonnet", "de-ni-2026", 90, ["mayor", "finance", "planning"], "trained-ok", "A town with almost nothing in the bank and a code-run works office: holds on standing payments, and directions on whether to recruit.", { scenario: "lean-council" }),
  P(48, "election", "2b", "sonnet", "us-oh-2026", 75, ["mayor", "editor", "councillor-1", "councillor-2"], "sonnet", "An election with a model mayor standing, the commission and the clerk both run by code (it does not wait on the clerk's fault): the nomination by day 30, the poll and the count on day 60, the winner seated the day after.", { scenario: "election-due" }),
  P(6, "justice", "2b", "sonnet", "de-ni-2026", 180, ["tribunal-member", "tribunal-registrar", "registry", "land-registrar", "child-protection", "inspector"], "trained-ok", "Offices that decide and record: the tribunal, the two registers, child protection, the inspector. Half a year, for the registers' sake."),
  P(8, "heat", "2b", "sonnet", "jp-akita-2026", 180, ["mayor", "registry", "editor", "child-protection"], "trained-ok", "A hot summer in the oldest town: what the mayor, the registrar and the paper ask for when the bureau warns.", { scenario: "hot-summer" }),
  P(5, "landlords", "2b", "sonnet", "us-oh-2026", 120, ["landlord-1-office", "landlord-2-office", "landlord-3-office", "bank-lending"], "trained-ok", "Three letting offices and the lender where rents are dear: listings, leases, increases, loans.", { scenario: "dear-rents" }),
  P(28, "housing", "2b", "sonnet", "de-ni-2026", 120, ["landlord-1-office", "landlord-2-office", "tribunal-member", "tribunal-registrar"], "trained-ok", "Landlords and the tribunal where amounts are written with a comma: leases, notices, orders.", { scenario: "housing-shortage" }),
  P(21, "lending", "2b", "sonnet", "jp-akita-2026", 120, ["bank-lending", "finance", "landlord-1-office", "landlord-2-office"], "trained-ok", "The lender, the treasury and two landlords in whole units of money: loans, payments, leases.", { scenario: "jobs-slump" }),
  P(43, "care", "2b", "sonnet", "gb-eng-2026", 45, ["clinic-manager", "principal"], "sonnet", "A probe: the clinic and the school, each a routine set once for its staff and then managed by exception.", { probe: true }),
  P(11, "heat", "2b", "sonnet", "de-ni-2026", 90, ["mayor", "finance", "inspector"], "trained-ok", "A hot summer where amounts are written with a comma.", { scenario: "hot-summer" }),
  P(12, "flood", "2b", "sonnet", "gb-eng-2026", 150, ["mayor", "planning", "finance", "landlord-1-office"], "trained-ok", "A wet year, long enough to hold the river's high month: permits, repairs, payments.", { scenario: "wet-year" }),
  P(27, "flood", "2b", "sonnet", "de-ni-2026", 150, ["mayor", "planning", "inspector", "landlord-1-office"], "trained-ok", "A wet year where amounts are written with a comma.", { scenario: "wet-year" }),
  P(46, "largest-works", "2b", "fable", "de-ni-2026", 90, ["mayor", "works", "registry"], "trained-ok", "The largest model as mayor, works manager and registrar."),
  P(15, "largest-election", "2b", "fable", "gb-eng-2026", 75, ["mayor", "editor", "councillor-1", "councillor-2"], "sonnet", "The largest model through an election, under a code clerk.", { scenario: "election-due" }),
  // (Two profiles known not to be faithful to their place, used as they are: plan.md, "Towns that are not their place".)
  P(50, "evictions", "2b", "sonnet", "ke-nakuru-2026", 120, ["landlord-1-office", "landlord-2-office", "tribunal-member", "tribunal-registrar"], "trained-ok", "Landlords and the tribunal in a town whose rents are most of its tenants' income (a profile fault, used as it is): arrears, notices, orders."),
  P(51, "townhall", "2b", "sonnet", "ke-nakuru-2026", 90, ["mayor", "finance", "planning"], "trained-ok", "The town hall of that town: a sixth currency, and a council that hears of the arrears."),
  P(52, "river", "2b", "sonnet", "br-mg-2026", 120, ["mayor", "planning", "inspector", "landlord-1-office"], "trained-ok", "A town that floods without a wet year (its river figure is wrong, and used as it is): permits, repairs, payments in a seventh currency."),
  P(53, "townhall", "2b", "sonnet", "br-mg-2026", 90, ["mayor", "finance", "editor"], "trained-ok", "The town hall and the paper of that town."),
  // ---- wave 2b: lane claude-2.
  P(41, "works", "2b", "haiku", "us-oh-2026", 75, ["mayor", "works", "registry"], "trained-ok", "The works office and the registry on the smaller model, with a model mayor, in the town with the most deaths to register."),
  P(2, "housing", "2b", "haiku", "gb-eng-2026", 45, ["landlord-1-office", "landlord-2-office", "tribunal-member", "tribunal-registrar"], "trained-ok", "Landlords and the tribunal on the smaller model where rents are dear: leases, notices, orders.", { scenario: "dear-rents" }),
  P(36, "offices", "2b", "haiku", "us-oh-2026", 30, ["rates", "water-operations", "principal"], "sonnet", "A probe: three offices with routines on the smaller model.", { probe: true }),
  P(30, "trade", "2b", "haiku", "au-vic-2026", 30, ["shop-2-manager", "factory-2-manager"], "sonnet", "The trade probe on the smaller model.", { probe: true }),
  // ---- wave 2b: the optional lane. Works first, then by worth; each is parked the moment the window closes.
  P(34, "works", "2b", "sol", "us-oh-2026", 45, ["works", "registry", "land-registrar", "environment"], "trained-ok", "The works office, both registers and the environment office on the other family, under a code mayor."),
  P(24, "election", "2b", "sol", "gb-eng-2026", 75, ["mayor", "editor", "councillor-1", "councillor-2"], "sonnet", "An election with a model mayor standing on the other family, the commission and the clerk both run by code.", { scenario: "election-due" }),
  P(25, "rents", "2b", "sol", "us-oh-2026", 45, ["mayor", "landlord-1-office", "registry", "editor"], "trained-ok", "Dear rents on the other family: the petition, the mayor, a landlord, the paper, the registrar.", { scenario: "dear-rents" }),
  P(35, "works", "2b", "luna", "gb-eng-2026", 45, ["mayor", "works", "finance"], "sonnet", "Test-only (that model): the works office.", { test: true }),
  P(29, "lending", "2b", "sol", "jp-akita-2026", 45, ["bank-lending", "landlord-1-office", "landlord-2-office", "tribunal-registrar"], "trained-ok", "Loans and leases in whole units of money, on the other family."),
  P(37, "lean", "2b", "luna", "gb-eng-2026", 45, ["mayor", "finance", "planning"], "sonnet", "Test-only (that model): a town with almost nothing in the bank.", { test: true, scenario: "lean-council" }),

  // ---- wave 2c: the long one and the tests; after 2b's reports are read. Lane claude-1.
  P(13, "flood-long", "2c", "sonnet", "au-vic-2026", 180, ["mayor", "finance", "planning", "inspector", "landlord-1-office", "landlord-2-office"], "trained-ok", "The longest: half a year of a wet year with six seats.", { scenario: "wet-year" }),
  P(16, "newplace", "2c", "sonnet", "mx-jal-2026", 90, ["mayor", "landlord-1-office", "bank-lending", "finance"], "sonnet", "Test-only: a profile no training pilot uses.", { test: true }),
  P(49, "newmoney-registers", "2c", "sonnet", "in-tn-2026", 180, ["registry", "land-registrar", "finance"], "sonnet", "Test-only: the registers and the treasury in a profile whose amounts are grouped in twos and said in lakh and crore; half a year, for the registers' sake.", { test: true }),
  P(18, "newoffices", "2c", "sonnet", "au-vic-2026", 90, ["police-oic", "union-organiser", "finance"], "sonnet", "Test-only: two offices no training pilot has as a seat (the police and the union).", { test: true }),
  // ---- wave 2c: lane claude-2.
  P(47, "newplace-works", "2c", "haiku", "mx-jal-2026", 45, ["works", "environment", "finance"], "sonnet", "Test-only: that profile's works office on the smaller model.", { test: true }),
  P(17, "newmoney", "2c", "haiku", "in-tn-2026", 45, ["mayor", "finance", "planning"], "sonnet", "Test-only: the town hall of the profile whose amounts are grouped in twos, on the smaller model.", { test: true }),
  // ---- wave 2c: the optional lane.
  P(38, "newmoney-works", "2c", "sol", "in-tn-2026", 45, ["mayor", "works", "finance"], "sonnet", "Test-only: that profile's works office on the other family.", { test: true }),
  P(32, "newoffices", "2c", "sol", "us-oh-2026", 45, ["police-oic", "union-organiser", "mayor"], "sonnet", "Test-only: the held-out offices on the other family.", { test: true }),
  P(31, "newmoney", "2c", "luna", "in-tn-2026", 45, ["mayor", "finance", "planning"], "sonnet", "Test-only: that profile's amounts from the other family's weaker model.", { test: true }),

  // ---- held back until the council clerk's fault is settled (a clerk that is a seat counted no votes as the mock; a
  // model's is untried): a file of their own, in no stage. None longer than its purpose needs.
  P(1, "council", "2b", "sonnet", "au-vic-2026", 45, ["mayor", "council-clerk", ...C5], "sonnet", "A council of models: a clerk who puts ballots and declares results, councillors who vote, and a mayor who may direct the code-run works office. The first of the three: the test of a clerk that is a seat.", { held: "clerk" }),
  P(3, "election", "2b", "sonnet", "de-ni-2026", 75, ["mayor", "editor", "council-clerk"], "sonnet", "An election due on day 60, run by the code electoral commission, in a place that writes a decimal comma: a nomination, the paper's items, and a clerk who seats whoever is declared elected.", { scenario: "election-due", held: "clerk" }),
  P(7, "election", "2b", "haiku", "au-vic-2026", 75, ["mayor", "council-clerk", ...C3], "sonnet", "An election with a model mayor standing and a model clerk to seat the winner, on the smaller model.", { scenario: "election-due", held: "clerk" }),
];

/** What changed from the second version (2026-10-09, morning), and why. Heads matrix.md; plan.md says more. */
const CHANGES: string[] = [
  "**No pilot's translation waits on the Codex window.** The general translator is `claude-code/claude-sonnet-5-5` alone, with no chain of fallbacks (the owner, 2026-10-09; measured that morning under prompt 0.9.0: plan.md, \"Translators\"). The second version had a Codex model as translator in 38 of 43 pilots, and on the night of 2026-10-09 a pilot on Claude seats sat at day 0 for an hour for want of four translator calls.",
  "**Each pilot's translator is a late, cheap choice**, marked in the matrix: `sonnet` (the general model and no other: probes, elections, a crew to take on, measurements, every test pilot), `trained-ok` (our own retrained translator if its scores on the pilot's kinds of act are good enough when the stage starts, else the general model: 21 pilots), `trained` (our own, because its failures there are the data wanted: w2-26, five councillors). `make.ts --retrained decide/NAME [--retrained-for PILOT,...]` writes the files with it; until then every `trained-ok` pilot has the general model. The trained translator on disk serves the one `trained` pilot: in the second live check it refused 31 of a town hall's 44 requests, every one a hold or a withdrawal.",
  "**Codex models are seats only, in a lane of their own that blocks nothing** (`wave-2?-codex.json`: 12 pilots, none longer than 75 days, each with the general translator). The queue parks a pilot the moment its sign-in is at a limit and goes on (scripts/pilot-queue.ts, 2026-10-09). Six pilots that were on Codex seats are on Claude seats now (the second flood, the housing and lending pilots, the two probes, the council of councillors), so that their coverage does not depend on the window.",
  "**The largest Claude model sits in training seats** (the owner: it belongs in seats, and is not a translator): w2-14 in the shake-down, to measure it, then w2-46 and w2-15. **The held-out seat model is now gpt-6-luna** (four pilots, all test-only, all in the optional lane): the only models left to hold out are behind the Codex sign-in. If that lane never runs, the test has no unseen seat model, and plan.md says what is then done.",
  "**Two lanes of Claude seats, by what they cost.** `claude-1`: seats on the first and the largest Claude model (a 30-day pilot on the first recorded 0.62 and 0.99). `claude-2`: seats on the smaller one (18.54 and 15.51 for the same thirty days), one pilot at a time, shorter, with spending limits that fit; its first pilot (w2-54) measures that model at lower effort.",
  "**A registry seat's pilot is as long as it takes to have deaths to register.** In the second live check a registrar had none in thirty days. In code-run towns of each profile (one town each, 180 days) 2 to 10 deaths were registered, one of them in a first month, and no birth (the first is due about day 275). Registry seats are in pilots of 180 days on the cheap seats (w2-10, w2-06, w2-08; the test w2-49), 75 to 90 where the model is dear or the profile has the most deaths (w2-41, w2-46), and are taken out of pilots too short to give them anything (w2-33, w2-23, w2-35, w2-38, w2-47, w2-16).",
  "**Longer where a seat on the first Claude model costs almost nothing and comes back weekly:** landlords, housing and lending 120 days (were 60 to 90), the registers 180, the test pilots of that model 90.",
  "**Kenya and Brazil are in, as they are** (the owner, 2026-10-09: a profile does not have to be faithful to be used, and a town in trouble is data too): two pilots each, on the cheap seats, in training (a sixth and a seventh currency). The table below marks every town known not to be its place, and why.",
  "**Three more scenarios that reach an office**, one pilot each: `housing-shortage` (w2-28, landlords and the tribunal), `jobs-slump` (w2-21, the lender, the treasury, landlords), `energy-price-shock` (w2-44, the utilities probe). Eight presets in all, none in more than three pilots.",
  "**The three pilots with a model council clerk are held back in a file of their own** (`wave-2-held-clerk.json`), in no stage, until the clerk's fault is settled. An election that does not wait on it is added on Claude seats (w2-48, a code clerk), so the wave has an election whatever happens to the clerk or the window.",
  "**Every election pilot runs 75 days:** notice on day 1, nominations close on day 30, the poll, the count and the declaration on day 60, the winner seated by the clerk the day after, and two weeks of the new term.",
  "**Works pilots that start with no crew (w2-10, w2-42, w2-33) depend on a fix** that tells a seat its office has no staff: in the second live check such a seat never learned it, hired nobody, and the town had 301 complaints.",
  "**Estimates are rebuilt on the second live check's thirty-day pilots:** a seat on the first Claude model sits weekly (0.42 answers a weighted seat-day, 3 or 4 requests a pilot-month); the smaller one is busy and dear (1.5 answers, 0.17 an answer); gpt-6.1-sol asked for 3 things in 25 days, not the five in twelve the second version was built on. They predate a change coming on main (a paper filed with an office brings its seat back the next working day), after which seats will sit more often.",
  "**50 pilots** (were 43): 35 on Claude seats in the three stages, 3 held, 12 optional on Codex seats; 12 test-only.",
];

// ---- checks on the plan itself.
/** Held out of training entirely. The model is the other family's weaker one: with the largest Claude model wanted in
 * training seats (the owner, 2026-10-09), the only models left to hold out are behind the Codex sign-in, so the test's
 * unseen seat model depends on that window (plan.md says what is done if it never opens). */
const TEST_ONLY = { profiles: ["mx-jal-2026", "in-tn-2026"], offices: ["police-oic", "union-organiser"], models: ["luna"] };
/** Towns known not to be faithful to their place, and why (the owner, 2026-10-09: a profile does not have to be faithful
 * to be used; such a town is spread over a few pilots, and nothing in a pilot there says anything of the place). */
const NOT_FAITHFUL: { [profile: string]: string } = {
  "ke-nakuru-2026": "its rent share is wrong for its dwelling mix (rent at about 85% of income): landlords and the tribunal see arrears and evictions that are the profile's doing",
  "br-mg-2026": "it floods on a river-flow figure whose fix is not on main: the flood is the profile's, not a wet year's",
  "in-tn-2026": "rent is 40% of income (no landlord seat there); a means-tested pension is paid to everyone",
  "jp-akita-2026": "far from its census by age (its children-at-home figures are placeholders); its budget expects grants seven times its spending; households' saving reads negative",
  "de-ni-2026": "households' saving reads negative; its ballot figure for industrial action is union practice, not law",
};
/** How many pilots a town that is not its place may be in, in the stages' Claude lanes (so that no one distortion
 * sets the theme of the wave's requests). */
const MOST_PILOTS_UNFAITHFUL = { "ke-nakuru-2026": 3, "br-mg-2026": 3 } as { [profile: string]: number };
const SCENARIOS_OFFERED = ["wet-year", "hot-summer", "election-due", "lean-council", "jobs-slump", "housing-shortage", "dear-rents", "energy-price-shock"];
for (const p of plans) {
  for (const s of p.seats) {
    if (NEVER_A_SEAT.includes(s)) throw new Error(`pilot ${p.n}: ${s} is not a seat in this wave`);
    if (!OFFICE[officeOf(s)]) throw new Error(`pilot ${p.n}: ${s} is not an office this wave seats`);
    if (p.translator === "trained" && !FOR_TRAINED.includes(officeOf(s))) throw new Error(`pilot ${p.n}: the trained translator on disk must not serve ${s}`);
  }
  // No pilot's translation is behind the Codex sign-in: a Codex stall can stall only a pilot's own seats.
  if (translatorOf(p).startsWith("codex/")) throw new Error(`pilot ${p.n}: its translator is behind the Codex sign-in`);
  // A test pilot, a probe, an election and a crew to take on are read by the general model, whatever is retrained.
  if ((p.test || p.probe || p.noCrew || p.scenario === "election-due") && p.translator !== "sonnet") throw new Error(`pilot ${p.n}: its translator must be the general model`);
  if (new Set(p.seats).size !== p.seats.length) throw new Error(`pilot ${p.n}: a seat named twice`);
  if (!p.test && (TEST_ONLY.profiles.includes(p.profile) || TEST_ONLY.models.includes(p.model) || p.seats.some((s) => TEST_ONLY.offices.includes(s)))) throw new Error(`pilot ${p.n} trains on something held out`);
  if (p.scenario && !SCENARIOS_OFFERED.includes(p.scenario)) throw new Error(`pilot ${p.n}: ${p.scenario} is not a scenario that reaches an office`);
  if (p.profile === "in-tn-2026" && p.seats.some((s) => officeOf(s) === "landlord")) throw new Error(`pilot ${p.n}: no landlord seat in that profile (its rent share)`);
  if (p.noCrew && !p.seats.includes("works")) throw new Error(`pilot ${p.n}: a crew to take on, and nobody in the works office to do it`);
  if (dependsOnClerk(p) !== (p.held === "clerk")) throw new Error(`pilot ${p.n}: a model clerk and not held back, or held back with none`);
  if (dependsOnClerk(p) && p.days > 75) throw new Error(`pilot ${p.n}: a model clerk for more than 75 days`);
  if (p.scenario === "election-due" && p.days < 75) throw new Error(`pilot ${p.n}: an election pilot that ends before the winner has sat a fortnight (polling day 60)`);
  if (p.seats.includes("registry") && deathsOf(p) < REGISTRY_NEEDS_DEATHS) throw new Error(`pilot ${p.n}: a registry seat with about ${deathsOf(p).toFixed(1)} deaths to register in ${p.days} days in ${p.profile}`);
  if (laneOf(p.model) === "codex" && p.days > 75) throw new Error(`pilot ${p.n}: a pilot on Codex seats longer than 75 days`);
}
for (const [profile, most] of Object.entries(MOST_PILOTS_UNFAITHFUL)) { const n = plans.filter((p) => p.profile === profile).length; if (n < 1 || n > most) throw new Error(`${profile} is in ${n} pilots: one to ${most} is the plan`); }
if (new Set(plans.map((p) => p.n)).size !== plans.length || new Set(plans.map((p) => p.seed)).size !== plans.length) throw new Error("a number or a seed is used twice");
const training = plans.filter((p) => !p.test);
/** The pilots that need nothing but the Claude sign-in and are held for nothing: what the wave is whatever the Codex window does. */
const assured = (p: Plan) => laneOf(p.model) !== "codex" && !p.held;
for (const office of ["works", "registry"]) {
  const models = new Set(training.filter((p) => assured(p) && p.seats.includes(office)).map((p) => p.model));
  if (models.size < 2) throw new Error(`${office} is a seat on fewer than two models in the training pilots that need no Codex`);
}
for (const office of ["clinic-manager", "principal", "water-operations", "energy-operations", "rates"]) if (!training.some((p) => assured(p) && p.seats.includes(office))) throw new Error(`${office} is a seat in no pilot that needs no Codex`);
if (!training.some((p) => assured(p) && p.seats.includes("mayor") && !p.seats.includes("works"))) throw new Error("no model mayor beside a code-run works office");
// What is held out is tested in pilots that need no Codex: both profiles, both offices (the held-out seat model cannot be).
for (const [what, has] of [["a profile", (p: Plan) => TEST_ONLY.profiles.includes(p.profile)], ["an office", (p: Plan) => p.seats.some((s) => TEST_ONLY.offices.includes(s))]] as const)
  if (!plans.some((p) => p.test && assured(p) && has(p))) throw new Error(`nothing tests ${what} held out without the Codex window`);

// ---- estimates.
const isClaude = (p: Plan) => MODELS[p.model].startsWith("claude-code/");
const weightOf = (p: Plan) => p.seats.reduce((a, s) => a + OFFICE[officeOf(s)]!.weight, 0);
const answersOf = (p: Plan) => weightOf(p) * p.days * RATE[p.model].answers;
const lettersOf = (p: Plan) => weightOf(p) * p.days * RATE[p.model].letters;
const kindsOf = (p: Plan): Mix => {
  const out: Mix = {};
  for (const s of p.seats) {
    const o = officeOf(s);
    for (const mix of [OFFICE[o]!.mix, (p.scenario && SCENARIO_ADDS[p.scenario]?.[o]) || {}])
      for (const [k, v] of Object.entries(mix)) out[k] = (out[k] ?? 0) + ((v * p.days) / 60) * RATE[p.model].requests;
    // (Taking on a crew is done once, however long the pilot.)
    if (o === "works" && p.noCrew) for (const [k, v] of Object.entries(NO_CREW_ADDS)) out[k] = (out[k] ?? 0) + v * RATE[p.model].requests;
    // (A registrar's papers: a registration for each death, and a certificate or a transmission for some.)
    if (o === "registry") out.form = (out.form ?? 0) + deathsOf(p) * 1.5 * Math.min(1, RATE[p.model].requests * 2);
  }
  return out;
};
const requestsOf = (p: Plan) => Object.values(kindsOf(p)).reduce((a, b) => a + b, 0);
const translatorCallsOf = (p: Plan) => (translatorOf(p) === GENERAL ? requestsOf(p) * TRANSLATOR_CALLS_A_REQUEST : 0);
/** Plan usage, as the run records it: the seats' answers where they are Claude models, and the translator's calls. */
const usdOf = (p: Plan) => answersOf(p) * RATE[p.model].usdPerAnswer + translatorCallsOf(p) * TRANSLATOR_USD_A_CALL;
/** Calls on the Codex subscription: the seats' answers, in the optional lane only. */
const codexCallsOf = (p: Plan) => (isClaude(p) ? 0 : answersOf(p));
const codexMinutesOf = (p: Plan) => (codexCallsOf(p) * RATE[p.model].secondsPerCall) / 60;
const minutesOf = (p: Plan) => (answersOf(p) * RATE[p.model].secondsPerCall + translatorCallsOf(p) * TRANSLATOR_SECONDS_A_CALL + p.days * MOCK_SECONDS_A_DAY) / 60;
/** The spending limit a pilot is given. Seats on the first and the largest Claude model: five times the estimate, in
 * fives, at least ten (a tripwire for a fault that makes single answers dear, more than a budget). Seats on the smaller
 * one: twice the estimate, in fives, at least fifteen (its estimate is the measured rate of a busy month; a per-seat
 * effort setting is being added, which should bring it under). Codex seats: ten, for the translator's calls alone. */
const five = (x: number) => Math.ceil(x / 5) * 5;
const budgetOf = (p: Plan) => (!isClaude(p) ? 10 : laneOf(p.model) === "claude-2" ? Math.max(15, five(usdOf(p) * 2)) : Math.max(10, five(usdOf(p) * 5)));

// ---- the queue entries.
const name = (p: Plan) => `w2-${String(p.n).padStart(2, "0")}-${p.tag}`;
const translatorSays = (p: Plan) => (translatorOf(p) === TRAINED_ON_DISK ? " (the trained one: it was taught no hold, entry on one's own file, look_first, office's own form, direction or standing work)" : translatorOf(p) === GENERAL ? " (under the translator's prompt)" : " (our own, retrained)") + (p.translator === "trained-ok" ? "; this pilot may have our own retrained translator instead, if its scores allow when the stage starts" : "");
const entry = (p: Plan) => {
  const others = p.seats.filter((s) => s !== "mayor");
  return {
    name: name(p), world: WORLD,
    sets: [`seed=${p.seed}`, `profile=${p.profile}`, ...(p.seats.includes("mayor") ? ["mayor=llm"] : []), ...(others.length ? [`model_seats=${others.join(",")}`] : []), ...(p.noCrew ? ["works_crew_at_start=0"] : [])],
    ...(p.scenario ? { args: ["--scenario", p.scenario] } : {}),
    model: MODELS[p.model], translator: translatorOf(p), translator_choice: p.translator, until: p.days * DAY, budget: budgetOf(p),
    env: { OIKOS_CLAUDE_BIN: `${HOME}/.local/bin/claude`, OIKOS_TRANSLATOR_MODELS: `${HOME}/oikos/runs/translator-model` },
    ...(p.test ? { test: true } : {}),
    note: `Wave ${p.stage} (plan of 2026-10-09, third version), for the translator's data. Profile ${p.profile}; a town of its own, generated from seed ${p.seed}; 1,000 people; ${p.days} days${p.scenario ? `; starting conditions ${p.scenario}` : ""}${p.noCrew ? "; the works crew still to be taken on" : ""}. Seats: ${p.seats.join(", ")}, all on ${MODELS[p.model]}. Translator: ${translatorOf(p)}${translatorSays(p)}. Every draft is confirmed or declined by its seat.${p.test ? " TEST ONLY: kept out of training." : ""}${p.probe ? " A PROBE: stop it by its own rule (plan.md, the stopping rules)." : ""}${p.noCrew ? " Depends on a seat being shown that its office has no staff (a fault being fixed)." : ""}${p.held ? " HELD BACK until the council clerk's fault is settled: it depends on a clerk that is a seat counting votes." : ""}${laneOf(p.model) === "codex" ? " OPTIONAL: its seats need the Codex window; it is parked when that closes, and nothing waits for it." : ""} ${p.why}`,
  };
};
const HELD_FILE = "wave-2-held-clerk.json";
/** The translator an entry is written with today (see TranslatorKey). */
function translatorOf(p: Plan): string {
  if (p.translator === "trained") return RETRAINED ?? TRAINED_ON_DISK;
  if (p.translator === "trained-ok" && RETRAINED && (!RETRAINED_FOR || RETRAINED_FOR.includes(name(p)))) return RETRAINED;
  return GENERAL;
}
const fileOf = (p: Plan) => (p.held ? HELD_FILE : `wave-${p.stage}-${laneOf(p.model)}.json`);
const lanes: { [file: string]: Plan[] } = {};
for (const stage of ["2a", "2b", "2c"] as const) for (const lane of ["claude-1", "claude-2", "codex"] as const) lanes[`wave-${stage}-${lane}.json`] = [];
lanes[HELD_FILE] = [];
for (const p of plans) lanes[fileOf(p)]!.push(p);
mkdirSync(outDir, { recursive: true });
for (const [file, ps] of Object.entries(lanes)) writeFileSync(join(outDir, file), JSON.stringify(ps.map(entry), null, 1) + "\n");
// (The second version's files, where they are still about: the lanes have other names now.)
for (const stage of ["2a", "2b", "2c"]) { const old = join(outDir, `wave-${stage}-claude.json`); if (existsSync(old)) rmSync(old); }

// ---- the tables.
const f1 = (x: number) => x.toFixed(x < 10 ? 1 : 0);
const hours = (m: number) => (m < 90 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`);
const total = (ps: Plan[], of: (p: Plan) => number) => ps.reduce((a, p) => a + of(p), 0);
const laneName = (p: Plan) => (p.held ? "held" : laneOf(p.model));
const marks = (p: Plan) => [p.test ? "test only" : "", p.probe ? "probe" : "", p.noCrew ? "no crew at the start (depends on a fix)" : "", p.held ? "held: model clerk" : "", laneOf(p.model) === "codex" ? "optional" : ""].filter(Boolean).join("; ");
const L: string[] = ["# Wave 2: the tables", "", "Written by `make.ts`; do not edit by hand. The reasoning is in `plan.md`.", ""];
L.push("## What changed from the second version (2026-10-09, morning), and why", "", ...CHANGES.map((c) => `- ${c}`), "");
L.push("## The matrix", "", "Every town is 1,000 people and a town of its own (generated from its seed); every pilot's confirmation mode is `always` (the only one a generated town has). The order is the order in the queue files. Lanes: `claude-1` and `claude-2` need the Claude sign-in alone; `codex` is the optional lane (Codex seats, a Claude translator); `held` is `wave-2-held-clerk.json`, in no stage.", "",
  "| pilot | stage | lane | profile | seed | days | scenario | seats (all on the pilot's model) | seat model | translator may be | translator in the file | marks |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const p of plans) L.push(`| ${name(p)} | ${p.held ? "none" : p.stage} | ${laneName(p)} | ${p.profile} | ${p.seed} | ${p.days} | ${p.scenario ?? "none"} | ${p.seats.join(", ")} | ${MODELS[p.model]} | ${p.translator} | ${translatorOf(p)} | ${marks(p)} |`);
L.push("", "## Towns that are not their place", "", "Used as they are: a town in trouble gives requests too. **Nothing in a pilot in one of these towns says anything about the country or the region its profile is named for.** Every profile also carries placeholder figures (docs/profiles.md).", "", "| profile | pilots | known not to be faithful in |", "|---|---|---|");
for (const [profile, why] of Object.entries(NOT_FAITHFUL)) L.push(`| ${profile} | ${plans.filter((p) => p.profile === profile).map(name).join(", ")} | ${why} |`);
L.push("", "## Expected usage and time", "", "Plan usage is in US dollars at published prices, as the run records it: the seats' answers where they are Claude models, and the translator's calls (a Codex call is recorded as nothing). Time is the pilot's own, without waits at a usage limit. Codex calls are the seats' answers of the optional lane. Deaths are what a registry seat can expect to have to register (one code-run town of each profile; noisy).", "",
  "| pilot | seats | weighted seat-days | seat answers | requests through `do` | letters | plan usage | spending limit | Codex calls | deaths to register | time |", "|---|---|---|---|---|---|---|---|---|---|---|");
for (const p of plans) L.push(`| ${name(p)} | ${p.seats.length} | ${Math.round(weightOf(p) * p.days)} | ${Math.round(answersOf(p))} | ${Math.round(requestsOf(p))} | ${Math.round(lettersOf(p))} | ${f1(usdOf(p))} | ${budgetOf(p)} | ${Math.round(codexCallsOf(p))} | ${p.seats.includes("registry") ? f1(deathsOf(p)) : ""} | ${hours(minutesOf(p))} |`);
const sumRow = (label: string, ps: Plan[]) => `| ${label} | ${ps.length} | ${Math.round(total(ps, answersOf))} | ${Math.round(total(ps, requestsOf))} | ${Math.round(total(ps.filter((p) => !p.test), requestsOf))} | ${f1(total(ps, usdOf))} | ${total(ps, budgetOf)} | ${Math.round(total(ps, codexCallsOf))} | ${hours(total(ps, codexMinutesOf))} | ${hours(total(ps, minutesOf))} |`;
L.push("", "| stage and lane | pilots | seat answers | requests through `do` | of them in training pilots | plan usage | sum of spending limits | Codex calls | Codex time | time, one after another |", "|---|---|---|---|---|---|---|---|---|---|");
for (const stage of ["2a", "2b", "2c"] as const) for (const lane of ["claude-1", "claude-2", "codex"] as const) L.push(sumRow(`${stage}, ${lane}`, lanes[`wave-${stage}-${lane}.json`]!));
L.push(sumRow("held (model clerk)", lanes[HELD_FILE]!));
const sure = plans.filter(assured), optional = plans.filter((p) => laneOf(p.model) === "codex"), heldBack = plans.filter((p) => p.held);
L.push(sumRow("**Codex unavailable throughout: the Claude lanes**", sure), sumRow("**the optional lane (Codex seats)**", optional), sumRow("**Codex available: both, without the held pilots**", [...sure, ...optional]), sumRow("everything, the held pilots too", plans));
L.push("", "By seat model: " + (Object.keys(MODELS) as ModelKey[]).map((m) => { const ps = plans.filter((p) => p.model === m); return `${MODELS[m]} ${ps.length} pilots, ${Math.round(total(ps, answersOf))} answers, ${Math.round(total(ps, requestsOf))} requests${RATE[m].usdPerAnswer ? `, ${f1(total(ps, usdOf))} of plan usage` : ""} (basis: ${RATE[m].measured})`; }).join("; ") + ".");

const TODAY: Mix = { message: 1173, statement: 291, form: 204, money: 32, structure: 11, claim: 9, agreement: 4, work: 1, goods: 0, account: 0, occupancy: 0, entity: 0, vote: 0, presence: 0, position: 0, take: 0 };
const sum = (ps: Plan[]) => { const out: Mix = {}; for (const p of ps) for (const [k, v] of Object.entries(kindsOf(p))) out[k] = (out[k] ?? 0) + v; return out; };
const cols: [string, Plan[]][] = [["training, Claude lanes", sure.filter((p) => !p.test)], ["training, optional lane", optional.filter((p) => !p.test)], ["training, held", heldBack.filter((p) => !p.test)], ["test-only, Claude lanes", sure.filter((p) => p.test)], ["test-only, optional lane", optional.filter((p) => p.test)]];
const sums = cols.map(([, ps]) => sum(ps));
L.push("", "## Expected requests through `do`, by kind", "", "Central guesses (a seat's requests, drafted or not); the range that is honest is a third of each to three times it. A form is a paper on a form: a council proposal, a direction to an office, or one of the office's own (an advertisement, a register entry, a decision). A standing work order counts under work; a hold and an entry on one's own file under statement. Letters are written with `write`, which no translator reads: they are counted apart.", "",
  `| kind | as of 2026-10-08 (real and in-situ) | ${cols.map(([c]) => c).join(" | ")} |`, `|---|---|${cols.map(() => "---").join("|")}|`);
for (const k of Object.keys(TODAY)) L.push(`| ${k} | ${k === "message" ? "1,173" : TODAY[k]} | ${cols.map(([, ps], i) => (k === "message" ? `(letters: about ${Math.round(total(ps, lettersOf))})` : Math.round(sums[i]![k] ?? 0))).join(" | ")} |`);
const tot = (m: Mix) => Math.round(Object.values(m).reduce((a, b) => a + b, 0));
L.push(`| all through \`do\` | | ${sums.map(tot).join(" | ")} |`);
const seatDays = (ps: Plan[]) => ps.reduce((a, p) => a + p.seats.length * p.days, 0);
L.push("", `Seat-days (the situations the pipeline's writers are put in, one in three by default): ${cols.map(([c, ps]) => `${seatDays(ps)} ${c}`).join("; ")}.`);
L.push("", "## Coverage", "");
const by = (key: (p: Plan) => string[], ps = plans) => { const m = new Map<string, number>(); for (const p of ps) for (const k of key(p)) m.set(k, (m.get(k) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", "); };
const seatedOn = (office: string) => `${office}: ${by((p) => [MODELS[p.model]], training.filter((p) => p.seats.includes(office)))}`;
L.push(`- Pilots by lane: ${by((p) => [laneName(p)])}.`, `- Pilots by profile: ${by((p) => [p.profile])}; without the optional lane: ${by((p) => [p.profile], plans.filter((p) => laneOf(p.model) !== "codex"))}.`, `- Pilots by seat model: ${by((p) => [MODELS[p.model]])}.`, `- Pilots by translator: ${by((p) => [translatorOf(p)])}.`, `- Pilots by scenario: ${by((p) => [p.scenario ?? "none"])}.`,
  `- Pilots an office is a seat in: ${by((p) => [...new Set(p.seats.map(officeOf))])}.`,
  `- The same, in the pilots that need no Codex and are not held: ${by((p) => [...new Set(p.seats.map(officeOf))], sure)}.`,
  `- Training pilots by seat model, for the offices asked for: ${["works", "registry", "clinic-manager", "principal", "water-operations", "energy-operations", "rates"].map(seatedOn).join("; ")}.`,
  `- A model mayor beside a code-run works office: ${plans.filter((p) => p.seats.includes("mayor") && !p.seats.includes("works")).map(name).join(", ")}.`,
  `- A model mayor beside a model works office: ${plans.filter((p) => p.seats.includes("mayor") && p.seats.includes("works")).map(name).join(", ")}.`,
  `- Elections (75 days: nominations close day 30, poll and count day 60, the winner seated day 61): ${plans.filter((p) => p.scenario === "election-due").map((p) => `${name(p)} (${laneName(p)})`).join(", ")}.`,
  `- Registry seats, with the deaths each can expect: ${plans.filter((p) => p.seats.includes("registry")).map((p) => `${name(p)} ${f1(deathsOf(p))} in ${p.days} days`).join(", ")}.`,
  `- Held back for the council clerk's fault: ${plans.filter(dependsOnClerk).map(name).join(", ")}.`,
  `- Depend on a seat being shown its office has no staff: ${plans.filter((p) => p.noCrew).map(name).join(", ")}.`,
  `- Probes: ${plans.filter((p) => p.probe).map(name).join(", ")}.`,
  `- Test-only: ${plans.filter((p) => p.test).map((p) => `${name(p)} (${laneName(p)})`).join(", ")}.`,
  `- Pilots whose translator is behind the Codex sign-in: none. Pilots whose seats are: ${optional.length}, all in the optional lane, about ${Math.round(total(optional, codexCallsOf))} Codex calls in all.`,
  `- Pilots whose seats are the same model as the translator (the first Claude model reading its own requests): ${plans.filter((p) => p.model === "sonnet" && translatorOf(p) === GENERAL).length} of ${plans.length}.`,
  `- Translator may be: \`trained\` (our own, for its failures): ${plans.filter((p) => p.translator === "trained").map(name).join(", ")}; \`trained-ok\` (our own retrained one if its scores allow, else the general model): ${plans.filter((p) => p.translator === "trained-ok").map(name).join(", ")}; \`sonnet\` (the general model and no other): the other ${plans.filter((p) => p.translator === "sonnet").length}.`);
writeFileSync(join(outDir, "matrix.md"), L.join("\n") + "\n");
console.log(Object.entries(lanes).map(([f, ps]) => `${f}: ${ps.length}`).join("; ") + "; matrix.md");
