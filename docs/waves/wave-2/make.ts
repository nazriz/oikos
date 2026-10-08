#!/usr/bin/env bun
// Writes wave 2's queue files and its tables: `bun docs/waves/wave-2/make.ts [--out DIR] [--no-scenarios]`.
// Four queues (a shake-down and the rest, each for the Claude Code lane and the Codex lane) and matrix.md, into this
// folder or --out. --no-scenarios leaves every entry's scenario out (for a mock dry run on code that has no presets
// yet). Nothing here starts a pilot or calls a model: the files are read by scripts/pilot-queue.ts when the owner
// starts the wave. The reasoning is in plan.md; the figures the estimates rest on are named where they are used.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const outDir = argv.includes("--out") ? argv[argv.indexOf("--out") + 1]! : import.meta.dir;
const noScenarios = argv.includes("--no-scenarios");
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
/** The two translators: the prompt-driven one (a general model under the translator's prompt) and the trained one. */
const TRANSLATORS = { prompt: "codex/gpt-6-luna", trained: "decide/pod-small-d16-s1" } as const;
type TranslatorKey = keyof typeof TRANSLATORS;

interface Plan {
  n: number; tag: string; stage: "2a" | "2b" | "2c"; model: ModelKey; profile: string; seed: number; days: number;
  scenario?: string; seats: string[]; translator: TranslatorKey; test?: boolean; why: string;
}

// ---- the offices that can be seats now, how much of a seat's cost each is (1 = a busy office such as the mayor's), and
// what each has honest reason to ask for through `do` in sixty days (a central guess from pilots 12, 13 and 18 and from
// what the office's code module does; plan.md says how weak these are).
type Mix = { [kind: string]: number };
const OFFICE: { [id: string]: { weight: number; mix: Mix } } = {
  "mayor": { weight: 1, mix: { form: 4, statement: 2, structure: 1, agreement: 1 } },
  "finance": { weight: 1, mix: { money: 3, statement: 1 } },
  "planning": { weight: 0.35, mix: { statement: 1, claim: 1 } },
  "inspector": { weight: 0.35, mix: { claim: 0.5, statement: 0.5 } },
  "council-clerk": { weight: 0.8, mix: { statement: 6 } },
  "councillor": { weight: 0.3, mix: { vote: 3 } },
  "electoral": { weight: 0.4, mix: {} },
  "editor": { weight: 0.6, mix: { statement: 8 } },
  "registry": { weight: 0.5, mix: { statement: 2, claim: 1 } },
  "child-protection": { weight: 0.2, mix: { presence: 0.3 } },
  "tribunal-member": { weight: 0.4, mix: { statement: 3 } },
  "tribunal-registrar": { weight: 0.4, mix: { statement: 2 } },
  "landlord": { weight: 1, mix: { statement: 6, agreement: 4, occupancy: 1, money: 3, form: 1 } },
  "bank-lending": { weight: 1, mix: { statement: 3, agreement: 3, money: 1, claim: 1 } },
  "police-oic": { weight: 0.8, mix: { work: 2, statement: 2 } },
  "union-organiser": { weight: 0.8, mix: { statement: 3, agreement: 1 } },
  "shop": { weight: 1, mix: { goods: 8, work: 6, money: 3, statement: 3 } },
  "factory": { weight: 1, mix: { work: 6, goods: 5, statement: 2, money: 2 } },
  "works": { weight: 1, mix: { agreement: 3, occupancy: 2, work: 5, statement: 2 } },
  "environment": { weight: 0.6, mix: { work: 2, statement: 2, agreement: 1 } },
};
const officeOf = (seat: string) => seat.replace(/^landlord-\d+-office$/, "landlord").replace(/^councillor-\d+$/, "councillor").replace(/^shop-\d+-manager$/, "shop").replace(/^factory-\d+-manager$/, "factory");
/** What a scenario adds to an office's sixty days (only the three presets seen to bite). */
const SCENARIO_ADDS: { [scenario: string]: { [office: string]: Mix } } = {
  "election-due": { electoral: { statement: 4, position: 1 }, mayor: { statement: 2 }, editor: { statement: 2 }, "council-clerk": { statement: 1 } },
  "wet-year": { mayor: { structure: 1, money: 1, statement: 1 }, landlord: { structure: 1, money: 1, statement: 1 }, inspector: { statement: 1, claim: 0.5 }, planning: { statement: 1, claim: 1 } },
  "hot-summer": { registry: { statement: 2, claim: 1 }, mayor: { statement: 1 } },
};

// ---- what a seat costs and how long it takes, per weighted seat-day (measured where it says so; plan.md has the sums).
const RATE: { [m in ModelKey]: { usd: number; secondsPerCall: number; measured: string } } = {
  sonnet: { usd: 0.04, secondsPerCall: 12, measured: "pilots 11 and 12 (0.02 to 0.05 a seat-day)" },
  haiku: { usd: 0.13, secondsPerCall: 21, measured: "3.3 times the first model's cost a call (the replay, real-models.md); pilot 13's first ten days ran at 0.20" },
  fable: { usd: 0.2, secondsPerCall: 30, measured: "not measured: a guess, five times the first model's" },
  sol: { usd: 0, secondsPerCall: 18, measured: "pilot 18 (133 calls in 40 minutes); a flat subscription, recorded as nothing" },
  luna: { usd: 0, secondsPerCall: 15, measured: "not measured as a seat: a guess" },
};
const CALLS_PER_WEIGHTED_SEAT_DAY = 0.8; // (pilot 12: 103 seat calls in 180 seat-days of busy offices; pilot 18: 121 in 151.)
const LETTERS_PER_WEIGHTED_SEAT_DAY = 0.45; // (pilot 12: 43 letters in 180 seat-days; pilot 18's seats wrote four times as many.)

const P = (n: number, tag: string, stage: Plan["stage"], model: ModelKey, profile: string, days: number, seats: string[], translator: TranslatorKey, why: string, o: { scenario?: string; test?: boolean } = {}): Plan =>
  ({ n, tag, stage, model, profile, seed: (o.test ? 900 : 100) + n, days, seats, translator, why, ...o });

const C5 = ["councillor-1", "councillor-2", "councillor-3", "councillor-4", "councillor-5"];
const plans: Plan[] = [
  // ---- wave 2a, the shake-down: short, each one new in one or two ways.
  P(1, "council", "2a", "sonnet", "au-vic-2026", 45, ["mayor", "council-clerk", ...C5], "prompt", "A council of models: the first votes any seat has cast, and councillors who read their letters."),
  P(2, "housing", "2a", "haiku", "gb-eng-2026", 45, ["landlord-1-office", "landlord-2-office", "tribunal-member", "tribunal-registrar"], "trained", "Private and judicial seats in a second currency, with the trained translator: leases, notices, orders."),
  P(3, "election", "2a", "sonnet", "de-ni-2026", 75, ["mayor", "electoral", "editor", "council-clerk"], "prompt", "An election due on day 60, in a place that writes a decimal comma: notices, nominations, a count, an appointment.", { scenario: "election-due" }),
  P(21, "lending", "2a", "sol", "au-vic-2026", 45, ["bank-lending", "finance", "landlord-1-office"], "prompt", "The lender, the treasury and a landlord: loans, payments, leases."),
  P(22, "townhall", "2a", "luna", "jp-akita-2026", 45, ["mayor", "finance", "planning"], "trained", "The familiar three offices on a weaker model, in a currency with no smaller unit, with the trained translator."),
  P(23, "newplace", "2a", "sol", "mx-jal-2026", 45, ["mayor", "landlord-3-office", "registry"], "prompt", "A test-only pilot in the shake-down, to prove the mark carries: a profile no training pilot uses.", { test: true }),

  // ---- wave 2b, the body: the Claude Code lane.
  P(4, "townhall", "2b", "haiku", "jp-akita-2026", 60, ["mayor", "finance", "planning"], "prompt", "The familiar three on the smaller model, so writers and readers differ."),
  P(5, "landlords", "2b", "sonnet", "us-oh-2026", 90, ["landlord-1-office", "landlord-2-office", "landlord-3-office", "bank-lending"], "prompt", "Three letting offices and the lender: leases, occupancy, permits to build, loans."),
  P(6, "justice", "2b", "sonnet", "de-ni-2026", 90, ["tribunal-member", "tribunal-registrar", "registry", "child-protection", "inspector"], "trained", "Offices that decide and record, none held by a model before, with the trained translator."),
  P(7, "election", "2b", "haiku", "au-vic-2026", 90, ["electoral", "council-clerk", "councillor-1", "councillor-2", "councillor-3"], "prompt", "An election run by a model's electoral office with a code mayor standing: the count and the appointment.", { scenario: "election-due" }),
  P(8, "heat", "2b", "sonnet", "jp-akita-2026", 90, ["mayor", "registry", "editor", "child-protection"], "trained", "A hot summer: what the mayor, the registrar and the paper ask for when the bureau warns.", { scenario: "hot-summer" }),
  P(9, "trade", "2b", "sonnet", "au-vic-2026", 60, ["shop-1-manager", "factory-1-manager"], "prompt", "A probe: one shop and one factory of many, for goods and work, which nobody has asked for. Read with the gaps in plan.md."),
  P(10, "works", "2b", "sonnet", "gb-eng-2026", 60, ["mayor", "works", "environment"], "prompt", "A probe: pilot 12's works office could hire nobody under the trained translator; the same office under the prompt-driven one."),
  P(11, "heat", "2b", "haiku", "de-ni-2026", 90, ["mayor", "finance", "inspector"], "trained", "A hot summer on the smaller model with the trained translator.", { scenario: "hot-summer" }),
  P(12, "flood", "2b", "sonnet", "gb-eng-2026", 150, ["mayor", "planning", "finance", "landlord-1-office"], "prompt", "A wet year, long enough to hold the river's high month: permits, repairs, payments.", { scenario: "wet-year" }),
  // ---- wave 2b: the Codex lane.
  P(24, "election", "2b", "sol", "gb-eng-2026", 90, ["mayor", "electoral", "council-clerk", "councillor-1", "councillor-2"], "trained", "An election with a model mayor standing, with the trained translator.", { scenario: "election-due" }),
  P(25, "heat", "2b", "sol", "us-oh-2026", 90, ["mayor", "finance", "registry", "editor"], "prompt", "A hot summer in a fourth currency's town.", { scenario: "hot-summer" }),
  P(26, "council", "2b", "luna", "au-vic-2026", 60, ["council-clerk", ...C5], "prompt", "A council on the weaker model under a code mayor."),
  P(27, "flood", "2b", "sol", "de-ni-2026", 150, ["mayor", "planning", "inspector", "landlord-1-office"], "prompt", "A wet year where amounts are written with a comma.", { scenario: "wet-year" }),
  P(28, "housing", "2b", "luna", "gb-eng-2026", 60, ["landlord-1-office", "landlord-2-office", "tribunal-member"], "prompt", "Landlords and the tribunal on the weaker model."),
  P(29, "lending", "2b", "sol", "jp-akita-2026", 90, ["bank-lending", "landlord-1-office", "landlord-2-office", "tribunal-registrar"], "trained", "Loans and leases in whole units of money, with the trained translator."),
  P(30, "trade", "2b", "sol", "au-vic-2026", 60, ["shop-2-manager", "factory-2-manager"], "trained", "The trade probe again, on the other family and translator."),

  // ---- wave 2c: the long and the dear ones, and the tests; after 2b's reports are read.
  P(13, "flood-long", "2c", "sonnet", "au-vic-2026", 180, ["mayor", "finance", "planning", "inspector", "landlord-1-office", "landlord-2-office"], "trained", "The longest: half a year of a wet year with six seats and the trained translator.", { scenario: "wet-year" }),
  P(14, "largest", "2c", "fable", "au-vic-2026", 45, ["mayor", "finance", "landlord-1-office"], "prompt", "Test-only: a model no training pilot has in a seat.", { test: true }),
  P(15, "largest-election", "2c", "fable", "gb-eng-2026", 75, ["mayor", "electoral", "council-clerk", "councillor-1"], "trained", "Test-only: that model again, through an election, with the trained translator.", { test: true, scenario: "election-due" }),
  P(16, "newplace", "2c", "sonnet", "mx-jal-2026", 60, ["mayor", "landlord-1-office", "bank-lending", "registry"], "prompt", "Test-only: a profile no training pilot uses.", { test: true }),
  P(17, "newmoney", "2c", "haiku", "in-tn-2026", 60, ["mayor", "finance", "council-clerk"], "trained", "Test-only: a profile whose amounts are grouped in twos and said in lakh and crore, which the trained model has never read.", { test: true }),
  P(18, "newoffices", "2c", "sonnet", "au-vic-2026", 60, ["police-oic", "union-organiser", "council-clerk"], "prompt", "Test-only: two offices no training pilot has as a seat (the police and the union).", { test: true }),
  P(31, "newmoney", "2c", "luna", "in-tn-2026", 60, ["mayor", "finance", "planning"], "prompt", "Test-only: that profile's amounts from the other family's weaker model.", { test: true }),
  P(32, "newoffices", "2c", "sol", "us-oh-2026", 60, ["police-oic", "union-organiser", "mayor"], "trained", "Test-only: the held-out offices on the other family.", { test: true }),
];

// ---- checks on the plan itself (a held-out thing must be in no training pilot).
const TEST_ONLY = { profiles: ["mx-jal-2026", "in-tn-2026"], offices: ["police-oic", "union-organiser"], models: ["fable"] };
for (const p of plans) {
  for (const s of p.seats) if (!OFFICE[officeOf(s)]) throw new Error(`pilot ${p.n}: ${s} is not an office this wave seats`);
  if (new Set(p.seats).size !== p.seats.length) throw new Error(`pilot ${p.n}: a seat named twice`);
  if (!p.test && (TEST_ONLY.profiles.includes(p.profile) || TEST_ONLY.models.includes(p.model) || p.seats.some((s) => TEST_ONLY.offices.includes(s)))) throw new Error(`pilot ${p.n} trains on something held out`);
}
if (new Set(plans.map((p) => p.n)).size !== plans.length || new Set(plans.map((p) => p.seed)).size !== plans.length) throw new Error("a number or a seed is used twice");

// ---- estimates.
const weightOf = (p: Plan) => p.seats.reduce((a, s) => a + OFFICE[officeOf(s)]!.weight * (p.scenario === "election-due" && s === "electoral" ? 2.5 : 1), 0);
const usdOf = (p: Plan) => weightOf(p) * p.days * RATE[p.model].usd;
const callsOf = (p: Plan) => weightOf(p) * p.days * CALLS_PER_WEIGHTED_SEAT_DAY;
const minutesOf = (p: Plan) => (callsOf(p) * RATE[p.model].secondsPerCall + p.days * 0.5) / 60; // (and about half a second a simulated day for the town)
const kindsOf = (p: Plan): Mix => {
  const out: Mix = {};
  for (const s of p.seats) {
    const o = officeOf(s);
    for (const mix of [OFFICE[o]!.mix, (p.scenario && SCENARIO_ADDS[p.scenario]?.[o]) || {}]) for (const [k, v] of Object.entries(mix)) out[k] = (out[k] ?? 0) + (v * p.days) / 60;
  }
  return out;
};
const isClaude = (p: Plan) => MODELS[p.model].startsWith("claude-code/");
/** The spending limit a pilot is given: two and a half times its estimate, in fives, at least ten. */
const budgetOf = (p: Plan) => (isClaude(p) ? Math.max(10, Math.ceil((usdOf(p) * 2.5) / 5) * 5) : 25);

// ---- the queue entries.
const name = (p: Plan) => `w2-${String(p.n).padStart(2, "0")}-${p.tag}`;
const entry = (p: Plan) => {
  const others = p.seats.filter((s) => s !== "mayor");
  const scenario = noScenarios ? undefined : p.scenario;
  return {
    name: name(p), world: WORLD,
    sets: [`seed=${p.seed}`, `profile=${p.profile}`, ...(p.seats.includes("mayor") ? ["mayor=llm"] : []), ...(others.length ? [`model_seats=${others.join(",")}`] : [])],
    ...(scenario ? { args: ["--scenario", scenario] } : {}),
    model: MODELS[p.model], translator: TRANSLATORS[p.translator], until: p.days * DAY, budget: budgetOf(p),
    env: { OIKOS_CLAUDE_BIN: `${HOME}/.local/bin/claude`, OIKOS_TRANSLATOR_MODELS: `${HOME}/oikos/runs/translator-model` },
    ...(p.test ? { test: true } : {}),
    note: `Wave ${p.stage} (planned 2026-10-08), for the translator's data. Profile ${p.profile}, seed ${p.seed}, 1,000 people, ${p.days} days${p.scenario ? `, starting conditions ${p.scenario}${noScenarios ? " (left out of this copy)" : ""}` : ""}. Seats: ${p.seats.join(", ")}, all on ${MODELS[p.model]}. Translator: ${TRANSLATORS[p.translator]}${p.translator === "prompt" ? " (under the translator's prompt)" : " (the trained one)"}. Every draft is confirmed or declined by its seat.${p.test ? " TEST ONLY: kept out of training." : ""} ${p.why}`,
  };
};
const lanes: { [file: string]: Plan[] } = {
  "wave-2a-claude.json": plans.filter((p) => p.stage === "2a" && isClaude(p)),
  "wave-2a-codex.json": plans.filter((p) => p.stage === "2a" && !isClaude(p)),
  "wave-2b-claude.json": plans.filter((p) => p.stage === "2b" && isClaude(p)),
  "wave-2b-codex.json": plans.filter((p) => p.stage === "2b" && !isClaude(p)),
  "wave-2c-claude.json": plans.filter((p) => p.stage === "2c" && isClaude(p)),
  "wave-2c-codex.json": plans.filter((p) => p.stage === "2c" && !isClaude(p)),
};
mkdirSync(outDir, { recursive: true });
for (const [file, ps] of Object.entries(lanes)) writeFileSync(join(outDir, file), JSON.stringify(ps.map(entry), null, 1) + "\n");

// ---- the tables.
const f1 = (x: number) => x.toFixed(x < 10 ? 1 : 0);
const hours = (m: number) => (m < 90 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`);
const L: string[] = ["# Wave 2: the tables", "", "Written by `make.ts`; do not edit by hand. The reasoning is in `plan.md`.", ""];
L.push("## The matrix", "", "Every town is 1,000 people; every pilot's confirmation mode is `always` (the only one a generated town has).", "",
  "| pilot | stage | lane | profile | seed | days | scenario | seats (all on the pilot's model) | seat model | translator | test only |", "|---|---|---|---|---|---|---|---|---|---|---|");
for (const p of plans) L.push(`| ${name(p)} | ${p.stage} | ${isClaude(p) ? "Claude Code" : "Codex"} | ${p.profile} | ${p.seed} | ${p.days} | ${p.scenario ?? "none"} | ${p.seats.join(", ")} | ${MODELS[p.model]} | ${TRANSLATORS[p.translator]} | ${p.test ? "yes" : ""} |`);
L.push("", "## Expected usage and time", "", "Plan usage is in US dollars at published prices, as the run records it (a Codex call is recorded as nothing). Time is the pilot's own, without waits at a usage limit.", "",
  "| pilot | seats | weighted seat-days | seat calls | plan usage | spending limit | time |", "|---|---|---|---|---|---|---|");
for (const p of plans) L.push(`| ${name(p)} | ${p.seats.length} | ${Math.round(weightOf(p) * p.days)} | ${Math.round(callsOf(p))} | ${isClaude(p) ? f1(usdOf(p)) : "0 (Codex)"} | ${budgetOf(p)} | ${hours(minutesOf(p))} |`);
L.push("", "| stage and lane | pilots | seat calls | plan usage | sum of spending limits | time, one after another |", "|---|---|---|---|---|---|");
for (const stage of ["2a", "2b", "2c"] as const) for (const claude of [true, false]) {
  const ps = plans.filter((p) => p.stage === stage && isClaude(p) === claude);
  L.push(`| ${stage}, ${claude ? "Claude Code" : "Codex"} | ${ps.length} | ${Math.round(ps.reduce((a, p) => a + callsOf(p), 0))} | ${claude ? f1(ps.reduce((a, p) => a + usdOf(p), 0)) : "0 (Codex)"} | ${claude ? ps.reduce((a, p) => a + budgetOf(p), 0) : "n/a"} | ${hours(ps.reduce((a, p) => a + minutesOf(p), 0))} |`);
}
for (const claude of [true, false]) {
  const ps = plans.filter((p) => isClaude(p) === claude);
  L.push(`| all, ${claude ? "Claude Code" : "Codex"} | ${ps.length} | ${Math.round(ps.reduce((a, p) => a + callsOf(p), 0))} | ${claude ? f1(ps.reduce((a, p) => a + usdOf(p), 0)) : "0 (Codex)"} | ${claude ? ps.reduce((a, p) => a + budgetOf(p), 0) : "n/a"} | ${hours(ps.reduce((a, p) => a + minutesOf(p), 0))} |`);
}
L.push("", "By seat model: " + (Object.keys(MODELS) as ModelKey[]).map((m) => { const ps = plans.filter((p) => p.model === m); return `${MODELS[m]} ${ps.length} pilots, ${Math.round(ps.reduce((a, p) => a + callsOf(p), 0))} calls${RATE[m].usd ? `, ${f1(ps.reduce((a, p) => a + usdOf(p), 0))} of plan usage` : ""} (rate: ${RATE[m].measured})`; }).join("; ") + ".");

const TODAY: Mix = { message: 1173, statement: 291, form: 204, money: 32, structure: 11, claim: 9, agreement: 4, work: 1, goods: 0, account: 0, occupancy: 0, entity: 0, vote: 0, presence: 0, position: 0, take: 0 };
const sum = (ps: Plan[]) => { const out: Mix = {}; for (const p of ps) for (const [k, v] of Object.entries(kindsOf(p))) out[k] = (out[k] ?? 0) + v; return out; };
const train = sum(plans.filter((p) => !p.test)), test = sum(plans.filter((p) => p.test));
const letters = (ps: Plan[]) => Math.round(ps.reduce((a, p) => a + weightOf(p) * p.days * LETTERS_PER_WEIGHTED_SEAT_DAY, 0));
L.push("", "## Expected requests through `do`, by kind", "", "Central guesses (a seat's requests, drafted or not); the range that is honest is a third of each to three times it. Letters are written with `write`, which no translator reads: they are counted apart.", "",
  "| kind | today (real and in-situ) | wave 2, training pilots | wave 2, test-only pilots |", "|---|---|---|---|");
for (const k of Object.keys(TODAY)) L.push(`| ${k} | ${k === "message" ? "1,173" : TODAY[k]} | ${k === "message" ? `(letters: about ${letters(plans.filter((p) => !p.test))})` : Math.round(train[k] ?? 0)} | ${k === "message" ? `(letters: about ${letters(plans.filter((p) => p.test))})` : Math.round(test[k] ?? 0)} |`);
const tot = (m: Mix) => Math.round(Object.values(m).reduce((a, b) => a + b, 0));
L.push(`| all through \`do\` | | ${tot(train)} | ${tot(test)} |`);
const seatDays = (ps: Plan[]) => ps.reduce((a, p) => a + p.seats.length * p.days, 0);
L.push("", `Seat-days (the situations the pipeline's writers are put in, one in three by default): ${seatDays(plans.filter((p) => !p.test))} in training pilots, ${seatDays(plans.filter((p) => p.test))} in test-only pilots.`);
L.push("", "## Coverage", "");
const by = (key: (p: Plan) => string[]) => { const m = new Map<string, number>(); for (const p of plans) for (const k of key(p)) m.set(k, (m.get(k) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", "); };
L.push(`- Pilots by profile: ${by((p) => [p.profile])}.`, `- Pilots by seat model: ${by((p) => [MODELS[p.model]])}.`, `- Pilots by translator: ${by((p) => [TRANSLATORS[p.translator]])}.`, `- Pilots by scenario: ${by((p) => [p.scenario ?? "none"])}.`,
  `- Pilots an office is a seat in: ${by((p) => [...new Set(p.seats.map(officeOf))])}.`, `- Seats on a model that is not one of the two readers (the first Claude model and the first Codex model): ${plans.filter((p) => p.model !== "sonnet" && p.model !== "sol").length} of ${plans.length} pilots.`);
if (!noScenarios) writeFileSync(join(outDir, "matrix.md"), L.join("\n") + "\n");
console.log(Object.entries(lanes).map(([f, ps]) => `${f}: ${ps.length}`).join("; ") + (noScenarios ? " (scenarios left out)" : "; matrix.md"));
