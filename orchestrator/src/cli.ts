#!/usr/bin/env bun
// oikos: run worlds, measure them, and report what they cost.
//
//   oikos run <world.json|yaml> [--seeds N] [--towns T] [--parallel P] [--out DIR] [--until SECONDS]
//                 [--set path=value]... [--translator-model provider/model] [--no-measure]
//                 [--model provider/model --budget DOLLARS_PER_RUN [--base-url URL]]
//     --seeds N runs ONE town N times: the town is generated once, from the spec's `seed`, and only the runs' seeds
//     differ (what happens, never who lives there). --towns T generates T different towns, from the spec's seed and
//     the T - 1 after it, and runs each --seeds times (1 if not given): `--towns 3` is three towns run once each,
//     `--towns 3 --seeds 2` six runs. Their runs are named <world>.town<S>.seed<N>. For a generated world only.
//     --model runs every language-model participant and the translator on a real model: anthropic/…, openai/…
//     (keys from ANTHROPIC_API_KEY / OPENAI_API_KEY), or a local open-weight model: ollama/… or local/… --base-url.
//     A model that costs money needs --budget: the run stops, and says why, rather than spend more. --batch-budget caps
//     the whole batch: each run gets the per-run limit or what's left, whichever is less.
//     --translator-first decide/NAME puts our own trained translator first, with the translator (the run's model, or
//     --translator-model's, or the mock) behind it: it takes what the first fails (--translator-arrangement then, the
//     default), or answers everything while the first's answers are only recorded (beside). docs/real-models.md.
//     With --model, --translator-model runs the translator on its own model (e.g. a smaller one); without, it only
//     prices the cost projection.
//   oikos run ... [--scenario NAME[+NAME...]]: the starting conditions a generated world is put under (docs/scenarios.md;
//     worlds/scenarios/): the same as --set scenario=NAME, and the runs go to runs/<world>.<NAME> unless --out says.
//   oikos scenarios [--all]: the scenarios there are, and what each shifts; those marked inert are named last with what
//     is missing (--all: each in full).
//   oikos run ... [--overwrite]: runs are never overwritten: a run into a folder that already holds its log refuses to
//     start (choose another --out, or resume it). --overwrite replaces it, for tests' own folders; never the default,
//     and never a log that holds a real model's answers.
//   oikos resume <log.jsonl | log.jsonl.zst | DIR>: go on with a run that stopped (a folder: its one run that did).
//   oikos measure <DIR> [QUERY...] [--sql "select ..."] [--list]
//   oikos diff <BASELINE> <CHANGE> [QUERY...]: every measure of two batches compared (beyond the noise between runs:
//     flagged). Its first line says what each side is: how many runs, of how many towns.
//   oikos health <DIR> [--profile NAME]: the batch's measures against its profile's calibration targets (and over how
//     many runs of how many towns)
//   oikos cost <DIR> [--translator-model provider/model]
//   oikos run ... [--no-compress]: logs are compressed once measured (<run>.jsonl.zst, about a seventh the size,
//     checked to read back whole before the plain log goes); --no-compress keeps them plain.
//   oikos run ... [--keep log|measures]: what's kept of each run once measured. measures: the measurement tables,
//     the summary and a recipe that regenerates the log exactly, not the log (only for code-only runs at a commit).
//   oikos run ... [--consult]: the sparse mind (docs/design/ai-citizens.md 4): code citizens may ask the run's model
//     (the mock, or --model) how much their options would matter, remembered by kind of person. Off by default.
//   oikos run ... --consult [--consult-avoid <audit report.json>]: leave out what an audit found unstable.
//   oikos consult-audit <world> [--model provider/model --budget DOLLARS] [--kinds 8] [--fidelity 2] [--threshold 2]
//                 [--seed 1] [--out FILE]
//     The sparse mind's robustness audit: its questions reworded, options reversed, bins shifted, and remembered answers
//     against fresh ones, on the world's own questions and people. The mock by default. Every call is kept beside it.
//   oikos run ... [--log lean|full]: how much the log keeps (full, the default; lean for quick test runs: no
//     observation hashes, no written reasoning from code participants; replay still checks the state).
//   oikos run ... [--record-decisions full|none]: code citizens' decisions as their minds made them (what each had
//     before it, how it decided, what it chose: docs/design/ai-citizens.md 7), and what each then came to know of how
//     its choices turned out (served, paid or not, who came: facts and the mind's own figures, no judgement), training
//     data for citizen models. full is the default (about a tenth of a log); none leaves both out; never in a lean
//     log. A resumed run records as it began.
//   oikos run ... --composer: call the world's composing models for real (the mix in its `dials.composer`; a spending
//     limit is needed). Without it, a world with a composer has the mock play it. docs/behaviour/founding.md.
//   oikos compose-audit <founded.jsonl> [--models a,b --judges a,b --budget DOLLARS] [--per-matter 2] [--most 12]
//                 [--repeats 4] [--follow-ups 3] [--out DIR]
//     The composing model's audits, on the situations a run's foundings recorded (a dataset's founded.jsonl): tone by
//     word counts and by the rubric as each judge reads it, beside real texts; how often it declines; scrambled
//     records; the prompt reworded. The mock by default. Every call is kept, and served again from the same folder.
//   oikos everyday-harvest <DIR> [--held-profiles a,b] [--dev 24] [--held 36] [--out DIR]
//     The everyday model's recorded situations (docs/design/ai-citizens.md 11): the decisions about a secure home in
//     the datasets under DIR (a folder a profile), with a development and a held-back sample. No model is called.
//   oikos everyday-gate <sample.jsonl> --pool <pool.jsonl> [--models a,b] [--design plain|bearing|shift] [--edits N] [--jobs N]
//                 [--skip repeat,reversed,reworded,scrambled] [--budget DOLLARS] [--out DIR]
//     The teachers' gate: scrambled records, one-thing edits, option order, rewording, the town's totals, agreement.
//     The mock by default. Every call is kept, and served again from the same folder.
//   oikos dataset <DIR|log.jsonl> [--out DIR] [--actions]
//     (and, for a run with the culture dial on, culture.json beside it: norm shares, verdicts, talk, standing, events remembered, tipping)
//     Run datasets: each log's data as training examples, in <run>.dataset/ (docs/design/run-datasets.md): the manifest,
//     system prompts, translations, model participants' decisions; code participants' acts with --actions; code
//     citizens' decisions, each with its outcomes under it, and the outcomes as a list of their own; and
//     observations, as the run recorded them (language-model participants' by default; --record-observations
//     models|code|all|none|<ids>).
//   oikos corpus <DIR|log.jsonl> [--out FILE]
//     The translator corpus: every translation in the logs (proposal, the translator's exchange, call, resolution, dry
//     run, the participant's decision, what the kernel did), one JSON line each, for training the translator later.
//   oikos translator-eval --model provider/model [--budget DOLLARS] [--base-url URL] [--out FILE] [--real | --only-real] [--jobs N]
//         [--set FILE [--set FILE ...]] [--only-sets]
//     The translator's test set (translator/eval/cases.ts, and the held-out cases where this machine has them) on a real
//     model: seen and held-out pass rates, and cost. --real adds the pilots' real requests (translator/eval/
//     pilot-cases.ts) as a third group, N at a time (default 4); --only-real runs those alone. --set FILE adds a file
//     of labelled requests as a group of its own (a test set the training pipeline made, <out>/tests/*.jsonl: a line
//     each, {id, request, forms, program, …}): right, no draft and wrong draft against its labels, and the same by
//     pilot, seat model, profile, origin and function where its lines say them (translator/eval/set-run.ts);
//     --only-sets runs the files alone. The model is a trained one (decide/<run>) or any other.
//   oikos translator-data <LOG|DIR>... --model provider/model [--model ...] [--back-model provider/model ...] --out DIR
//         [--per-shape N] [--per-gold N] [--refusals N] [--limit N] [--seed N]
//     Training data for the local translation model: requests written by the models given for the calls code
//     participants made in those logs, each checked (training.ts).
//   oikos translator-data <LOG|DIR>... --briefs [--writers NAME,NAME,...] [--no-spares] --out DIR
//         [--shard I/N] [--per-shape N] [--per-gold N] [--refusals N] [--refusal-floor N] [--floor N] [--generated N]
//         [--ceiling N] [--validation SHARE] [--limit N] [--seed N]
//         [--only FN,FN,...] [--indirect SHARE] [--refusal-labels L,L,...]
//         [--amount-forms N] [--pairs SHARE [--pairs-only]] [--broad] [--world-forms N] [--styles S,S]   (these options on a run with models too)
//         [--bank-payments N] [--finance-payments N] [--askers ASKER=SHARE,...] [--money CODE=TIMES,...]
//         [--line-payments N] [--report-payments N] [--split-payments N] [--hours-terms N] [--practice-notices N] [--offer-notices N]
//     No model: the plan of what is to be written (DIR/plan.json), what each writer is asked, item by item
//     (DIR/briefs.jsonl: {id, kind, brief}; with --writers, DIR/briefs-NAME.jsonl each, the items dealt in turn), and
//     the writers' instructions (DIR/writer-instructions.txt), for writers who work on files. --shard I/N: part I of
//     N of the gold set, counted from 1. --no-spares leaves out the refusals asked for ahead of need (used only where
//     a label comes out short of its floor).
//     Weighting a part toward what seats really ask: --only writes requests for the programs of those functions
//     alone (--only none: for none, refusal briefs only; --generated and --limit then count those functions'
//     programs; a kind of program by name counts as its function does: hold, entry, standing_work,
//     standing_work_hold, standing_work_withdraw, direction, paper, direction_unlisted); --indirect is the share of plain letters asked for as "Direct them to …" (a half if absent);
//     --refusal-labels plans, builds and holds to the floor those labels only. All three are in plan.json and the
//     manifest. --amount-forms N adds N invented forms of several amounts to the gold set, each filled in four
//     ways (--only amount_form: requests for those alone). --pairs SHARE asks for that share of the forms filled in
//     and of the withdrawals with a second act in the same request (a direction to someone about it, or a second
//     withdrawal: one request of two lines, never too_much); --pairs-only writes requests for those alone.
//     --broad: a wide part (the registers rambling, flat and slips dealt beside the styles; who is asking said in
//     every brief; look_first for any act on a record named by description, no_such_act for attending).
//     --world-forms-only A,B and --world-forms-more A=N,B=N: only those papers (the others still shown beside), some in more ways.
//     --world-forms N adds every paper the worlds' own offices issue, each filled in N ways, every field of it in
//     the first two (--only world_form: requests for those alone).
//     --bank-payments N adds N payments a keeper of accounts makes carrying out a request to pay (per_request; asked
//     by someone at a bank's counter; --only per_request: those alone); --finance-payments N adds N of a finance
//     office's kinds (a net wage with the gross and what was withheld said, what was withheld remitted, a payment
//     resting on several records, a standing payment with its first day; --only finance_payment: those alone).
//     The kinds the call language gained later (prompt 0.9.5; synthetic.ts `lateKinds`): --line-payments N (payments
//     drawn on a line of the budget; --only line_payment), --report-payments N (payments with a report naming several
//     amounts; report_amounts), --split-payments N (one sum paid to several accounts, each stated; split_payment; the
//     needs_calculation refusals that state no share are made from these), --hours-terms N (offers of employment with
//     and without hours; hours_term), --practice-notices N (a public notice of something held again and again;
//     practice_notice) and --offer-notices N (a public offer anyone may take up; offer_notice).
//     --askers banker=0.4: with --broad, that share of the requests (of those not in an office-holder's style) is
//     asked by that asker. --money CODE=3,...: those currencies are drawn that many times as often as the others.
//   oikos translator-data-write <DIR> --requests FILE --writer NAME [--requests FILE --writer NAME ...]
//     The requests such writers handed in ({id, request}, a line each), checked as a model's are and made into DIR's
//     examples.jsonl, rejects.jsonl, blind.jsonl and manifest.json, for translator-data-check.
//   oikos translator-data-check <DIR> --answers FILE [--reader NAME]
//   oikos translator-data-check <DIR> --blind [--seed N]
//     Blind checking of a data folder (translator/train/blind.ts). --blind writes its requests as DIR/blind.jsonl, in a
//     shuffled order, for a reader who is to see nothing else. --answers takes that reader's answers ({id, program}, a
//     line each), compares them with the gold programs by meaning, and writes DIR/checked.jsonl (the examples agreed
//     on, marked verified by the reader), DIR/disagreed.jsonl (both programs) and the counts per function in the manifest.
//   oikos in-situ <LOG|DIR>... --out DIR [--writers NAME,NAME,...] [--max-chars N] [--every N] [--seed N]
//     Translator training requests written in situ (in-situ.ts): from model seats' runs, every time a seat was asked
//     what to do as a situation (its prompt as sent, what it was shown), in DIR/situations.jsonl, each marked if a real
//     test case was asked in it; the seats' real requests that are no test case, for readers (real-unlabelled.jsonl,
//     real-blind.jsonl); and what writers are given: writer-instructions.txt and chunks/<writer>-NN.jsonl ({id, system,
//     shown} a line, at most --max-chars characters a chunk, 120,000 if not given; one seat's day in --every, 3 if not
//     given, a different one for each writer). Logs are only read. No model is called.
//   oikos in-situ-requests <DIR> --requests FILE --writer NAME [--requests FILE --writer NAME ...] [--out FILE] [--seed N]
//     What such writers handed back ({id, requests: [...]}, a line for each situation), as requests for readers:
//     DIR/written-unlabelled.jsonl ({id, request, forms, from}), and its blind file beside it.
//   oikos in-situ-blind <FILE> [--seed N] [--out FILE]
//     A file of such requests as a blind reader is given them ({id, request, forms}, shuffled).
//   oikos in-situ-label <FILE> --answers FILE --reader NAME --answers FILE --reader NAME --out DIR
//     Two readers' answers ({id, program}) to a file of such requests, made into DIR's examples.jsonl (a request both
//     read as the same program, which the request carries whole), rejects.jsonl (the rest, each with why) and manifest.json.
//   oikos translator-data-batch <config.json> <PART>... [--write-only]
//     Generated parts (folders made by translator-data --briefs --writers …) written and blind-checked through the
//     adapters, a batch at a call (broad.ts): each writer's briefs to its model, the mechanical checks, each request
//     read blind by a model that did not write it, the gold programs compared by meaning, the leak check. The config:
//     {out, writers: {name: provider/model}, readers: {writer's provider/model: reader, "*": reader}, budget, …}.
//     Resumable: the same command goes on where it stopped. A folder with a v2-plan.json is the banked part.
//   oikos translator-data-collect <OUT> <PART>... [--share S] [--floor N]
//     Every part's checked examples as one set, each with its groups (writer, register, asker, currency, writing,
//     source), cut by gold program into train.jsonl and parity-test.jsonl (never trained on); the cells of each
//     group by function, and which are under the floor.
//   oikos translator-choices-data <PILOT_DIR>... --out DIR [--citizens N] [--replies N] [--writers NAME,…]
//     The plan of citizens' turns (a code citizen's decision told in plain words; the label is what it chose) and
//     of plain replies to real draft previews (translator/train/choices.ts). No model is called.
//   oikos translator-v2-data [PILOT_DIR...] --out DIR [--from-pilots N] [--generated N] [--turns N --acts FILE...] [--writers NAME,…] [--seed N]
//     The plan of the cases banked for a later translator (translator/train/v2.ts, docs/design/translator-v2.md):
//     plain-text turns whose right reading is a look, a letter, a note, being done or a yes or no, from what real
//     seats did (never a test-only pilot's) and generated. No model is called.
//   oikos translator-pipeline <config.json>
//     The translator's training pipeline in one unattended command (pipeline.ts, docs/translator-pipeline.md): pilots'
//     situations, writers, two readers, the labelled examples, test sets, the join, the export and (if the config says
//     so) training on a rented GPU. Resumable: the same command goes on where it stopped.
//   oikos replay <log.jsonl> [--anchors <anchors.jsonl>]      (the kernel's own replay)
//   oikos story <log.jsonl> [participant]                     (what a language-model participant did, day by day)
//
// A DIR is a batch folder (its measure/ is used) or a folder of logs (exported to DIR/measure first).

import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { exportLogs, queries, query, runQuery, table } from "@oikos/measure";
import { afterResume, loadWorld, resumeCommand, runBatch, runName, runOne, type StopSignal } from "./batch";
import { MockAdapter, mockPolicies, PRICES } from "@oikos/participants/llm";
import { costReport } from "./cost";
import { currentLogs } from "./logs";
import { kernelBinary } from "./kernel";
import { chooseModel } from "./models";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string, dflt?: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : dflt;
};
const flags = (name: string) => rest.flatMap((x, i) => (x === `--${name}` && rest[i + 1] !== undefined ? [rest[i + 1]!] : []));
const has = (name: string) => rest.includes(`--${name}`);
/** The run's `--set`s; `--scenario NAME` is one of them (the world's description names its starting conditions). */
const sets = () => [...flags("set"), ...(flag("scenario") ? [`scenario=${flag("scenario")}`] : [])];
/** Where a batch under named starting conditions goes, unless told: a folder of its own beside the plain world's. */
const scenarioOut = (world: string) => (flag("scenario") ? join("runs", `${world.split("/").at(-1)!.replace(/\.(json|ya?ml)$/, "")}.${flag("scenario")!.replace(/[^A-Za-z0-9+-]+/g, "+")}`) : undefined);
/** Positional arguments: everything that isn't a flag or a flag's value. */
const positional = () => rest.filter((x, i) => !x.startsWith("--") && !(i > 0 && rest[i - 1]!.startsWith("--") && !["--no-measure", "--list", "--compress", "--no-compress", "--actions", "--consult", "--overwrite", "--force", "--real", "--only-real", "--blind", "--briefs", "--no-spares", "--no-write", "--broad", "--write-only"].includes(rest[i - 1]!)));

/** The measurement folder for a DIR: its measure/, exported from its logs if there isn't one yet. */
async function measureDir(dir: string): Promise<string> {
  if (existsSync(join(dir, "runs")) && existsSync(join(dir, "participants"))) return dir; // already a measurement folder
  const m = join(dir, "measure");
  if (!existsSync(m)) {
    const logs = currentLogs(dir); // (each run once: not what a resumed run left behind)
    if (!logs.length) throw new Error(`${dir}: no measurement tables and no logs`);
    await exportLogs(logs, m);
  }
  return m;
}

/**
 * Asked to stop (a TERM signal, as `scripts/mini stop` sends): a run stops before its next moment, its log closed, to be
 * resumed; a batch passes it on, starts no more seeds, and reports. If the run can't get there in time (a model call
 * still out after OIKOS_STOP_GRACE_SECONDS, 120 by default), the process ends as it is: its log resumes all the same.
 */
function stopOnSignal(): StopSignal {
  const stop: StopSignal = {};
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
    // (Asked twice from the keyboard: at once, as it is. A second TERM is the batch passing on what `mini stop` also sent.)
    if (stop.requested && signal === "SIGINT") process.exit(130);
    if (stop.requested) return;
    stop.requested = `a ${signal.slice(3)} signal`;
    console.error(`asked to stop (${signal}): stopping before the next moment, and closing the log`);
    stop.onRequest?.();
    const grace = Number(process.env.OIKOS_STOP_GRACE_SECONDS);
    if (cmd !== "run") setTimeout(() => process.exit(143), (Number.isFinite(grace) && grace > 0 ? grace : 120) * 1000).unref();
  });
  return stop;
}

const usage = "usage: oikos run <world> [--seeds N (runs of one town)] [--towns T (different towns, each run --seeds times)] [--parallel P] [--out DIR] [--until S] [--set k=v] [--scenario NAME[+NAME]] [--modules FILE] [--translator-model m] [--translator-first decide/NAME [--translator-arrangement then|beside]] [--no-measure] [--overwrite] [--model provider/model --budget USD [--base-url URL]] | resume <log.jsonl[.zst]|DIR> [--until S] [--model ... as for run] | measure <DIR> [QUERY...] [--sql SQL] [--list] | diff <BASELINE> <CHANGE> [QUERY...] | health <DIR> [--profile NAME] | cost <DIR> [--translator-model m] | translator-eval --model provider/model [--budget USD] [--out FILE] [--real | --only-real] [--jobs N] | scenarios [--all] | pilot-report <DIR>... [--no-write] | pilot-view <DIR> [--out file.html] [--twin DIR | --no-twin] | explore <DIR> [--port N] [--prefix /explore] | explore --all [--runs DIR] | explore index <DIR> | debriefs <DIR|log>... [--json] | replay <log.jsonl> | story <log.jsonl> [participant] | record <log.jsonl[.zst]> <entity|participant> [--at S]";

try {
  if (cmd === "run" && positional()[0]) {
    const r = await runBatch({
      world: positional()[0]!, seeds: Number(flag("seeds", "1")), ...(flag("towns") !== undefined ? { towns: Number(flag("towns")) } : {}), out: flag("out") ?? scenarioOut(positional()[0]!), parallel: flag("parallel") ? Number(flag("parallel")) : undefined,
      until: flag("until") ? Number(flag("until")) : undefined, sets: sets(), translatorModel: flag("translator-model"), translatorFirst: flag("translator-first"), translatorArrangement: flag("translator-arrangement"), measure: !has("no-measure"), log: console.log,
      model: flag("model"), budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url"), modules: flag("modules"),
      recordObservations: flag("record-observations"), recordDecisions: flag("record-decisions"), logDetail: flag("log"), compress: !has("no-compress"), keep: flag("keep") as "log" | "measures" | undefined,
      batchBudgetUsd: flag("batch-budget") ? Number(flag("batch-budget")) : undefined, consult: has("consult"), composer: has("composer"), consultAvoid: flag("consult-avoid"), debriefWording: flag("debrief-wording"),
      overwrite: has("overwrite"), stop: stopOnSignal(),
    });
    if (r.measureDir) {
      console.log(`\n${table(await runQuery(r.measureDir, "overview"))}`);
      console.log(`\n${r.costText}`);
      console.log(`\nMeasure with: oikos measure ${r.out} --list`);
    }
    if (r.stopped.length) {
      console.log(`\n${r.stopped.length} run${r.stopped.length === 1 ? "" : "s"} STOPPED before the end and can be resumed (logs kept plain, measured as far as they got):`);
      for (const x of r.stopped) console.log(`  ${runName(x)}, at day ${Math.floor(x.t / 86_400)}: ${x.why}\n    ${x.resume}`);
    }
    if (r.problems.length) {
      console.log(`\nAfter the runs, something failed (the runs and batch.json are there):`);
      for (const x of r.problems) console.log(`  ${x}`);
      process.exitCode = 1;
    }
    if (r.failed.length) {
      console.log(`\n${r.failed.length} run${r.failed.length === 1 ? "" : "s"} didn't finish (diagnosis beside each log, <run>.failure.json):`);
      for (const f of r.failed) console.log(`  ${runName(f)}: ${f.reason}`);
      process.exitCode = 1;
    }
  } else if (cmd === "scenarios") {
    // The starting conditions a generated world can be put under (docs/scenarios.md): each, and what it shifts.
    // Those marked inert (their conditions hold, and nothing of them reaches an office until the platform changes) are
    // named last with what is missing; --all lists them in full with the rest.
    const { loadScenario, scenarioIds } = await import("@oikos/worlds/generator/scenario");
    const every = scenarioIds().map(loadScenario);
    for (const s of every.filter((x) => has("all") || x.status !== "inert")) {
      console.log(`${s.id}${s.status === "inert" ? " [inert]" : ""}: ${s.about}`);
      if (s.status === "inert") console.log(`    inert: ${s.inert_because!.trim().replace(/\s+/g, " ")}`);
      for (const c of s.changes ?? []) console.log(`    ${c.in}.${c.path}${c.where ? ` (rows with ${c.where.field}${c.where.at_least !== undefined ? ` from ${c.where.at_least}` : ""}${c.where.at_most !== undefined ? ` to ${c.where.at_most}` : ""}: ${c.of})` : ""}: ${c.set !== undefined ? `set to ${c.set}` : c.times_bps !== undefined ? `times ${c.times_bps / 10_000}` : c.shortfall_times_bps !== undefined ? `its shortfall times ${c.shortfall_times_bps / 10_000}` : `with ${JSON.stringify(c.add)}`}`);
      if (s.season) console.log(`    the run starts in: ${s.season.starts_in}`);
      if (s.weather) console.log(`    the weather: the climate's year at percentile ${s.weather.percentile} of ${s.weather.draws}, by ${s.weather.rank_by} over ${s.weather.over_days} days`);
    }
    const inert = every.filter((x) => x.status === "inert");
    if (inert.length && !has("all")) {
      console.log(`\nInert (can be named; nothing of them reaches an office until the platform changes; --all for each in full):`);
      for (const s of inert) console.log(`  ${s.id}: ${s.inert_because!.trim().replace(/\s+/g, " ")}`);
    }
  } else if (cmd === "run-one" && positional()[0]) {
    await runOne({ world: positional()[0]!, seed: Number(flag("seed")), ...(flag("town") !== undefined ? { town: Number(flag("town")) } : {}), out: flag("out", "runs")!, until: flag("until") ? Number(flag("until")) : undefined, sets: sets(),
      model: flag("model"), translatorModel: flag("translator-model"), translatorFirst: flag("translator-first"), translatorArrangement: flag("translator-arrangement"), budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url"), modules: flag("modules"),
      recordObservations: flag("record-observations"), recordDecisions: flag("record-decisions"), logDetail: flag("log"), consult: has("consult"), composer: has("composer"), consultAvoid: flag("consult-avoid"), debriefWording: flag("debrief-wording"), overwrite: has("overwrite"), stop: stopOnSignal() });
  } else if (cmd === "resume" && positional()[0]) {
    // A run that stopped (a stall, a crash, cut short): run again from its own config, serving its recorded model calls.
    const o = { until: flag("until") ? Number(flag("until")) : undefined, modules: flag("modules"),
      model: flag("model"), translatorModel: flag("translator-model"), translatorFirst: flag("translator-first"), translatorArrangement: flag("translator-arrangement"), budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url") };
    const r = await runOne({ resume: positional()[0]!, ...o, stop: stopOnSignal() });
    // What a batch does after its runs, done again for this folder: its cost report is the whole run's, and a run that
    // got to its end has its log compressed (--no-measure and --no-compress leave either out).
    const done = await afterResume(r, { translatorModel: o.translatorModel, measure: !has("no-measure"), compress: !has("no-compress"), log: console.log });
    console.log(`${r.runId}: resumed to ${(r.t / (365 * 86_400)).toFixed(2)} years; the stopped run's files are kept as ${r.runId}.stopped-<n>.*; ${done.logPath}`);
    if (done.costText) console.log(`\n${done.costText}`);
    if (r.stopped) console.log(`${r.runId}: STOPPED again at day ${Math.floor(r.t / 86_400)}, not finished: ${r.stopped.why}\n  resume it with: ${resumeCommand(r.logPath, o)}`);
  } else if (cmd === "measure" && positional()[0]) {
    const dir = await measureDir(positional()[0]!);
    if (has("list")) for (const q of queries()) console.log(`${q.name.padEnd(22)} ${q.description}`);
    else if (flag("sql")) console.log(table(await query(dir, flag("sql")!)));
    else {
      const names = positional().slice(1);
      for (const name of names.length ? names : ["overview"]) console.log(`## ${name}\n${table(await runQuery(dir, name))}\n`);
    }
  } else if (cmd === "pilot-report" && positional()[0]) {
    // A pilot folder's report from its log alone (pilot-report.ts), printed and written as <DIR>/pilot-report.json.
    const { pilotReport, renderReport } = await import("./pilot-report");
    for (const dir of positional()) console.log(renderReport(await pilotReport(dir, !has("no-write"))) + "\n");
  } else if (cmd === "pilot-view" && positional()[0]) {
    // A finished pilot as one self-contained HTML page (pilot-view/, docs/pilot-view.md). The run is only read.
    const { runPilotView } = await import("../../pilot-view/src/cli");
    console.log(await runPilotView(process.argv.slice(3)));
  } else if (cmd === "explore" && (positional()[0] || process.argv.includes("--all"))) {
    // The pilot explorer (renderer/, docs/explorer.md): a run's town, people, institutions and seats' acts, served on
    // 127.0.0.1 from an index built beside the runs. The run is only read; nothing is fed back.
    const { runExplore } = await import("../../renderer/src/cli");
    await runExplore(process.argv.slice(3));
  } else if (cmd === "debriefs" && positional()[0]) {
    // Debriefs across runs (VISION 15, point 7; debriefs.ts): by setting and framing, how often seats reported distress
    // or being pushed against their values, with their words, for review before a scenario is run again. It lists; it
    // does not score. What a seat kept back is counted and never shown. --json: the same as data.
    const { debriefsReport, logsOfRuns } = await import("./debriefs");
    const r = await debriefsReport(logsOfRuns(positional()));
    console.log(has("json") ? JSON.stringify(r.groups, null, 2) : r.text);
  } else if (cmd === "health" && positional()[0]) {
    // The health report (docs/design/rebuild.md 8.4): the batch's measures against its profile's targets.
    const { drawn, health, healthText } = await import("@oikos/measure");
    const { loadProfile } = await import("@oikos/worlds/generator/profile");
    const batch = join(positional()[0]!, "batch.json");
    const profile = flag("profile") ?? (existsSync(batch) ? JSON.parse(readFileSync(batch, "utf8")).spec?.profile : undefined);
    if (!profile) throw new Error("which profile's targets? (--profile NAME; a batch made from a generated world knows its own)");
    const dir = await measureDir(positional()[0]!);
    console.log(healthText(await health(dir, (loadProfile(profile) as any).targets ?? []), await drawn(dir)));
  } else if (cmd === "diff" && positional()[1]) {
    // Before and after (docs/design/rebuild.md 8.4): every measure of two batches of the same world, compared.
    const { diff, diffText, drawn } = await import("@oikos/measure");
    const [a, b] = [await measureDir(positional()[0]!), await measureDir(positional()[1]!)];
    console.log(diffText(await diff(a, b, positional().slice(2).length ? positional().slice(2) : undefined), [await drawn(a), await drawn(b)]));
  } else if (cmd === "consult-audit" && positional()[0]) {
    // The sparse mind's robustness audit (docs/design/ai-citizens.md 4), on the world's own questions and people.
    const { consultAudit, auditText } = await import("./audit");
    const { config } = await loadWorld(positional()[0]!, sets());
    const m = flag("model") ? chooseModel(flag("model")!, { budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url") }) : undefined;
    const adapter = m?.adapter ?? new MockAdapter("mock", mockPolicies(new Map()));
    const { report, annotations } = await consultAudit({ config, adapter, prices: { ...PRICES, ...(m?.prices ?? {}) }, ...(m?.budget ? { budget: m.budget } : {}),
      kinds: flag("kinds") ? Number(flag("kinds")) : undefined, fidelity: flag("fidelity") ? Number(flag("fidelity")) : undefined,
      threshold: flag("threshold") ? Number(flag("threshold")) : undefined, seed: flag("seed") ? Number(flag("seed")) : undefined });
    console.log(auditText(report));
    const out = flag("out") ?? join("runs", `consult-audit-${adapter.provider}-${adapter.model.replace(/[^A-Za-z0-9.-]/g, "_")}.json`);
    await Bun.write(out, JSON.stringify(report, null, 2));
    // Every call, as a run would log it (model answers are data: kept beside the report).
    await Bun.write(out.replace(/\.json$/, ".calls.jsonl"), annotations.map((a) => JSON.stringify(a)).join("\n") + "\n");
    console.log(`\nReport: ${out}`);
  } else if (cmd === "compose-audit" && positional()[0]) {
    // The composing model's audits (docs/behaviour/founding.md): tone, declining, scrambled records, rewording, on the
    // situations a run's foundings recorded. The mock unless models are named; every call kept beside the report.
    const { composeAudit, auditText, situations } = await import("./compose-audit");
    const { mockCompose } = await import("@oikos/participants/llm");
    const { readFileSync } = await import("node:fs");
    const rows = readFileSync(positional()[0]!, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    const briefs = situations(rows, flag("per-matter") ? Number(flag("per-matter")) : 2, flag("most") ? Number(flag("most")) : 12);
    const budgetUsd = flag("budget") ? Number(flag("budget")) : undefined;
    const named = (list: string | undefined) => (list ? list.split(",").map((x) => x.trim()).filter((x) => x) : []);
    for (const m of [...named(flag("models")), ...named(flag("judges"))]) if (/astra|fable/i.test(m)) throw new Error(`${m} is never a composing model or its judge`);
    let budget: { limitMicroUsd: number; spentMicroUsd: number } | undefined;
    const prices: Record<string, any> = { ...PRICES };
    const adapterOf = (name: string) => { const c = chooseModel(name, { budgetUsd, timeoutMs: 150_000 }); Object.assign(prices, c.prices); budget ??= c.budget; return c.adapter; };
    const mock = () => new MockAdapter("mock", { compose: (req) => (req.context?.judge === "rubric" ? [{ type: "text", text: '{"anger": 1, "despair": 1, "hope_at_close": 2, "polish": 2, "conciliation": 2}' }] : req.context?.judge === "which" ? [{ type: "text", text: `{"record": "${req.context.truth}"}` }] : mockCompose(req)) });
    const composers = new Map(named(flag("models")).length ? named(flag("models")).map((m) => [m, adapterOf(m)] as const) : [["mock", mock()] as const]);
    const judges = new Map(named(flag("judges")).length ? named(flag("judges")).map((m) => [m, adapterOf(m)] as const) : named(flag("models")).length ? [] : [["mock", mock()] as const]);
    const outDir = flag("out") ?? join("runs", "compose-audit");
    const report = await composeAudit({ briefs, composers, judges, prices, ...(budget ? { budget } : {}), outDir, ...(flag("repeats") ? { repeats: Number(flag("repeats")) } : {}), ...(flag("follow-ups") ? { followUps: Number(flag("follow-ups")) } : {}), log: console.log });
    console.log(auditText(report));
    console.log(`\nReport: ${join(outDir, "report.json")}; every call: ${join(outDir, "calls.jsonl")}`);
  } else if (cmd === "everyday-harvest" && positional()[0]) {
    // The everyday model's recorded situations (docs/design/ai-citizens.md 11): every decision about a want of the
    // first slice in the datasets under a folder (one folder a profile), split into a development and a held-back
    // sample. No model is called.
    const { harvest, split, stageOf, zAgency, optionsOf } = await import("./everyday");
    const all = harvest(positional()[0]!);
    const held = (flag("held-profiles") ?? "").split(",").filter((x) => x);
    const s = split(all, { heldProfiles: held, dev: Number(flag("dev", "24")), held: Number(flag("held", "36")), seed: Number(flag("seed", "4")) });
    const outDir = flag("out") ?? positional()[0]!;
    const { mkdirSync } = await import("node:fs");
    mkdirSync(outDir, { recursive: true });
    const lines = (xs: object[]) => xs.map((x) => JSON.stringify(x)).join("\n") + (xs.length ? "\n" : "");
    await Bun.write(join(outDir, "situations.dev-pool.jsonl"), lines(s.pool.dev));
    await Bun.write(join(outDir, "situations.held-pool.jsonl"), lines(s.pool.held));
    await Bun.write(join(outDir, "sample.dev.jsonl"), lines(s.dev));
    await Bun.write(join(outDir, "sample.held.jsonl"), lines(s.held));
    const count = (xs: typeof all, f: (h: (typeof all)[number]) => string) => { const m: { [k: string]: number } = {}; for (const h of xs) m[f(h)] = (m[f(h)] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1))); };
    const spread = (xs: typeof all) => ({ n: xs.length, people: new Set(xs.map((h) => `${h.profile}/${h.run}/${h.participant}`)).size, by_profile: count(xs, (h) => h.profile), by_matter: count(xs, (h) => h.situation.want.about), by_stage: count(xs, (h) => stageOf(h.situation)),
      by_agency: count(xs, (h) => (zAgency(h.situation) < -0.5 ? "low" : zAgency(h.situation) > 0.5 ? "high" : "middle")), by_code_choice: count(xs, (h) => h.choice ?? "none"), by_options: count(xs, (h) => String(optionsOf(h.situation).length)) });
    const manifest = { harvest: "oikos-everyday-harvest", from: positional()[0], held_profiles: held, all: spread(all), dev_pool: spread(s.pool.dev), held_pool: spread(s.pool.held), dev_sample: spread(s.dev), held_sample: spread(s.held) };
    await Bun.write(join(outDir, "harvest.json"), JSON.stringify(manifest, null, 2) + "\n");
    console.log(JSON.stringify(manifest, null, 2));
  } else if (cmd === "everyday-gate" && positional()[0]) {
    // The teachers' gate (docs/design/ai-citizens.md 11): oikos everyday-gate <sample.jsonl> --pool <pool.jsonl>
    //   --models a,b --design plain|bearing|shift [--edits N] [--jobs N] [--skip repeat,reworded] [--budget DOLLARS] --out DIR
    // The mock (which reads the person, by construction) unless models are named. Every call is kept beside the report.
    const { gate, gateText } = await import("./everyday-gate");
    const { mockTeacher } = await import("./everyday-mock");
    const { readFileSync } = await import("node:fs");
    const read = (f: string) => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    const named = (flag("models") ?? "").split(",").map((x) => x.trim()).filter((x) => x);
    for (const m of named) if (/astra|fable/i.test(m)) throw new Error(`${m} is never a teacher`);
    const budgetUsd = flag("budget") ? Number(flag("budget")) : undefined;
    let budget: { limitMicroUsd: number; spentMicroUsd: number } | undefined;
    const prices: Record<string, any> = { ...PRICES };
    const adapterOf = (name: string) => { const c = chooseModel(name, { budgetUsd, timeoutMs: 180_000 }); Object.assign(prices, c.prices); budget ??= c.budget; return c.adapter; };
    const teachers = new Map(named.length ? named.map((m) => [m, adapterOf(m)] as const) : [["mock", mockTeacher("reads")] as const]);
    const outDir = flag("out") ?? join("runs", "everyday-gate");
    const report = await gate({ sample: read(positional()[0]!), pool: read(flag("pool") ?? positional()[0]!), teachers, design: (flag("design") ?? "shift") as "plain" | "bearing" | "shift", prices, ...(budget ? { budget } : {}), outDir,
      edits: Number(flag("edits", "12")), jobs: Number(flag("jobs", "3")), skip: (flag("skip") ?? "").split(",").filter((x) => x), log: console.log });
    console.log(gateText(report));
    console.log(`\nReport: ${join(outDir, "report.json")}; every call: ${join(outDir, "calls.jsonl")}`);
  } else if (cmd === "translator-eval" && flag("model")) {
    // The held-out cases are outside the repository (translator/eval/held-out.ts): with them, their results go out by
    // id, outcome and shape only, and the full report is written beside them, never into `--out`.
    const { evaluate, evaluateReal, evaluateSet, heldOutPath, loadHeldOut, loadSet, publicReport, realReportText, reportText, setReportText } = await import("@oikos/translator/eval");
    const m = chooseModel(flag("model")!, { budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url") });
    const with_ = { prices: m.prices, ...(m.budget ? { budget: m.budget } : {}) };
    let report: object = {};
    if (!has("only-real") && !has("only-sets")) {
      const heldOut = loadHeldOut();
      const r = await evaluate(m.adapter, { ...with_, ...(heldOut ? { heldOut } : {}) });
      console.log(reportText(r));
      report = publicReport(r);
      if (heldOut) await Bun.write(join(heldOutPath(), "..", "results", `${r.model.replace(/[^a-z0-9.-]+/gi, "-")}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(r, null, 2));
    }
    if ((has("real") || has("only-real")) && !has("only-sets")) {
      // The pilots' real requests: seen cases, so their report is kept whole.
      const real = await evaluateReal(m.adapter, { ...with_, jobs: Number(flag("jobs", "4")), log: (line) => console.error(line) });
      console.log(realReportText(real));
      report = { ...report, real_requests: real };
    }
    // Files of labelled requests (a pipeline's test sets): made on this machine from pilots' logs, so reported whole.
    const sets: { [file: string]: object } = {};
    for (const file of flags("set")) {
      const set = await evaluateSet(m.adapter, loadSet(file), { ...with_, file, name: file.split("/").at(-1)!.replace(/\.jsonl$/, ""), jobs: Number(flag("jobs", "4")), log: (line) => console.error(line) });
      console.log(setReportText(set));
      sets[file] = set;
    }
    if (flags("set").length) report = { ...report, sets };
    if (flag("out")) await Bun.write(flag("out")!, JSON.stringify(report, null, 2));
    // (A trained model's own process is let go, so the command ends when it has answered.)
    (m.adapter as { close?: () => void }).close?.();
  } else if (cmd === "translator-data" && positional()[0] && (flags("model").length || has("briefs")) && flag("out")) {
    // Training data for the local translation model, from runs' logs (training.ts); or (--briefs) what its writers
    // are to be asked, for writers who work on files.
    const { trainingData } = await import("./training");
    const pick = (name: string) => chooseModel(name, { budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url") });
    const num = (name: string) => (flag(name) ? Number(flag(name)) : undefined);
    const list = (name: string) => flag(name)!.split(",").map((x) => x.trim()).filter(Boolean);
    const weights = (name: string) => Object.fromEntries(list(name).map((x) => { const [k, v] = x.split("="); return [k!, Number(v)]; }));
    // (A part is given as people count them, from 1: `--shard 13/24` is the thirteenth of 24.)
    const part = flag("shard") ? /^(\d+)\/(\d+)$/.exec(flag("shard")!) : undefined;
    if (flag("shard") && !part) throw new Error(`--shard: expected I/N (part I of N, from 1), got ${flag("shard")}`);
    const r = await trainingData({
      sources: positional(), out: flag("out")!,
      ...(has("briefs") ? { briefsOnly: true, noSpares: has("no-spares"), briefsFor: (flag("writers") ?? "").split(",").map((x) => x.trim()).filter(Boolean) } : { writers: flags("model").map(pick), backs: flags("back-model").map(pick) }),
      ...(part ? { shard: { index: Number(part[1]) - 1, of: Number(part[2]) } } : {}),
      perShape: num("per-shape"), perGold: num("per-gold"), refusalsPerLabel: num("refusals"), refusalFloor: num("refusal-floor"), floor: num("floor"), generated: num("generated"), ceiling: num("ceiling"), validation: num("validation"),
      limit: num("limit"), seed: num("seed"), log: console.log,
      ...(flag("indirect") !== undefined ? { indirect: Number(flag("indirect")) } : {}), ...(flag("only") ? { only: list("only") } : {}), ...(flag("refusal-labels") ? { refusalLabels: list("refusal-labels") } : {}),
      amountForms: num("amount-forms"), pairs: num("pairs"), pairsOnly: has("pairs-only"), broad: has("broad"), worldForms: num("world-forms"), ...(flag("world-forms-only") ? { worldFormsOnly: list("world-forms-only") } : {}), ...(flag("world-forms-more") ? { worldFormsMore: weights("world-forms-more") } : {}), ...(flag("styles") ? { styles: list("styles") } : {}),
      bankPayments: num("bank-payments"), financePayments: num("finance-payments"), late: Object.fromEntries(([["line", "line-payments"], ["report", "report-payments"], ["split", "split-payments"], ["hours", "hours-terms"], ["practice", "practice-notices"], ["offer", "offer-notices"]] as const).filter(([, f]) => flag(f)).map(([k, f]) => [k, num(f)!])), ...(flag("askers") ? { askers: weights("askers") } : {}), ...(flag("money") ? { money: weights("money") } : {}),
    });
    if (has("briefs")) console.log(`${r.briefs} briefs written to ${r.out} (plan.json, briefs.jsonl${flag("writers") ? ", a briefs file for each writer" : ""}, writer-instructions.txt)`);
    else console.log(`${r.examples} examples written to ${r.out} (examples.jsonl, manifest.json)${r.stopped ? `; writing stopped early: ${r.stopped}` : ""}`);
  } else if (cmd === "translator-data-write" && positional()[0] && flags("requests").length) {
    // The requests writers handed in for a folder's plan, made into its data (training.ts).
    const { writtenData } = await import("./training");
    const files = flags("requests"), names = flags("writer");
    if (names.length !== files.length) throw new Error(`a --writer NAME for each --requests FILE: ${files.length} files, ${names.length} names`);
    const r = await writtenData(positional()[0]!, files.map((file, i) => ({ file, writer: names[i]! })));
    console.log(`${r.examples} examples written to ${r.out} (examples.jsonl, rejects.jsonl, blind.jsonl, manifest.json): ${r.rejects} requests rejected, ${r.no_request} planned items had no request${r.duplicate_ids ? `, ${r.duplicate_ids} ids were written twice (the first kept)` : ""}${r.unknown_ids ? `, ${r.unknown_ids} requests were for nothing planned` : ""}`);
  } else if (cmd === "translator-data-check" && positional()[0] && (flag("answers") || has("blind"))) {
    // A blind reader's answers against a data folder's gold programs; or (--blind) the requests for such a reader.
    const { checkBlind, writeBlind } = await import("./training");
    const dir = positional()[0]!;
    if (has("blind")) {
      const w = writeBlind(dir, flag("seed") ? Number(flag("seed")) : 1);
      console.log(`${w.requests} requests written to ${w.out}, in a shuffled order`);
    }
    if (flag("answers")) {
      const r = checkBlind(dir, flag("answers")!, flag("reader") ?? "blind reader");
      console.log(`${r.reader}: agreed on ${r.agreed} of ${r.examples}, disagreed on ${r.disagreed}, left ${r.unanswered} unanswered${r.unknown_ids ? `; ${r.unknown_ids} answers were for no example here` : ""} (checked.jsonl, disagreed.jsonl, manifest.json)`);
      for (const [fn, n] of Object.entries(r.by_function)) if (n.disagreed || n.unanswered) console.log(`  ${fn}: ${n.agreed} agreed, ${n.disagreed} disagreed${n.unanswered ? `, ${n.unanswered} unanswered` : ""}`);
    }
  } else if (cmd === "in-situ" && positional()[0] && flag("out")) {
    // Situations for writers who answer as a seat, from model seats' logs; and the seats' real requests, for readers.
    const { inSitu } = await import("./in-situ");
    const num = (name: string) => (flag(name) ? Number(flag(name)) : undefined);
    const r = await inSitu({ sources: positional(), out: flag("out")!, writers: (flag("writers") ?? "").split(",").map((x) => x.trim()).filter(Boolean), maxChars: num("max-chars"), every: num("every"), seed: num("seed"), log: console.log });
    const t = r.totals;
    console.log(`${t.situations} situations written to ${flag("out")} (situations.jsonl): ${t.test} marked test, ${t.partial} with a sitting that isn't whole, ${t.usable} usable${t.no_forms ? `; ${t.no_forms} with no forms recovered` : ""}${t.no_system ? `; ${t.no_system} calls left out, their system prompt not in the log` : ""}`);
    for (const [run, seats] of Object.entries(r.situations)) for (const [seat, n] of Object.entries(seats)) console.log(`  ${run} ${seat}: ${n.situations} situations on ${n.seat_days} days, ${n.test} marked test, ${n.usable} usable; ${n.asked} requests made`);
    for (const [what, c] of Object.entries(r.characters)) console.log(`  ${what}: ${c.min} to ${c.max} characters, median ${c.median}, ninth decile ${c.p90}`);
    const q = r.real_requests;
    console.log(`${q.kept} real requests for readers (real-unlabelled.jsonl, real-blind.jsonl) of ${q.asked} made: ${q.test} are test cases, ${q.same_as_test} more in a test case's exact words, ${q.starts_as_test} beginning as one does, ${q.said_before} said before, ${q.no_forms} with no forms recovered`);
    for (const [writer, c] of Object.entries(r.chunks)) console.log(`${writer}: ${c.situations} situations in ${c.chunks} chunks (chunks/), ${c.sizes.length ? `${Math.min(...c.sizes)} to ${Math.max(...c.sizes)} characters a chunk` : "none"}; ${c.where_the_seat_asked} are turns where the seat asked for something`);
    if (r.too_large_for_a_chunk) console.log(`${r.too_large_for_a_chunk} situations are larger than a chunk (${r.max_chars} characters) and are given to no one`);
  } else if (cmd === "in-situ-requests" && positional()[0] && flags("requests").length) {
    const { takeInFiles } = await import("./in-situ");
    const files = flags("requests"), names = flags("writer");
    if (names.length !== files.length) throw new Error(`a --writer NAME for each --requests FILE: ${files.length} files, ${names.length} names`);
    const r = await takeInFiles(positional()[0]!, files.map((file, i) => ({ file, writer: names[i]! })), { out: flag("out"), seed: flag("seed") ? Number(flag("seed")) : undefined });
    console.log(`${r.kept} requests written to ${r.out} (blind: ${r.blind}) from ${r.answers} situations answered, ${r.none} of them with no request: of ${r.written} requests, ${r.said_before} said before, ${r.same_as_test} in a test case's exact words, ${r.starts_as_test} beginning as one does, ${r.empty} empty, ${r.no_forms} for a situation with no forms recovered, ${r.unknown_situation} for no situation here, ${r.test_situation} for a situation marked test`);
  } else if (cmd === "in-situ-blind" && positional()[0]) {
    const { blindFile } = await import("./in-situ");
    const w = blindFile(positional()[0]!, { seed: flag("seed") ? Number(flag("seed")) : undefined, out: flag("out") });
    console.log(`${w.requests} requests written to ${w.out}, in a shuffled order`);
  } else if (cmd === "in-situ-label" && positional()[0] && flags("answers").length && flag("out")) {
    const { label } = await import("./in-situ");
    const files = flags("answers"), names = flags("reader");
    if (names.length !== files.length) throw new Error(`a --reader NAME for each --answers FILE: ${files.length} files, ${names.length} names`);
    const m = label(positional()[0]!, files.map((file, i) => ({ file, reader: names[i]! })), flag("out")!);
    console.log(`${m.examples} examples of ${m.requests} requests written to ${flag("out")} (examples.jsonl, rejects.jsonl, manifest.json); dropped: ${Object.entries(m.by_reason).filter(([, n]) => n).map(([why, n]) => `${why} ${n}`).join(", ") || "none"}`);
    console.log(`  by function: ${Object.entries(m.by_function).map(([fn, n]) => `${fn} ${n}`).join(", ")}`);
  } else if (cmd === "translator-data-batch" && positional()[1]) {
    // Generated parts written and blind-checked through the adapters, and the banked part (broad.ts).
    const { runBroad } = await import("./broad");
    const r = await runBroad(JSON.parse(readFileSync(positional()[0]!, "utf8")), positional().slice(1), {}, has("write-only") ? { only: "write" } : {});
    for (const p of r.parts) console.log(`${p.part}: ${p.briefs} briefs, ${p.examples} passed the mechanical checks, ${p.agreed} of ${p.read} read alike by the blind reader, ${p.leaked} taken out by the leak check, ${p.kept} kept`);
    for (const [m, u] of Object.entries(r.usage)) console.log(`  ${m}: ${u.calls} calls, ${u.input_tokens + u.cache_read_tokens} tokens in, ${u.output_tokens} out, ${(u.cost_microusd / 1e6).toFixed(2)} USD as reckoned`);
    console.log(r.status);
    if (r.status !== "complete") process.exit(3);
  } else if (cmd === "translator-choices-data" && flag("out") && positional()[0]) {
    // The plan of citizens' turns and of plain replies to previews (translator/train/choices.ts): no model is called.
    const { choiceCases } = await import("./broad");
    const num = (name: string) => (flag(name) ? Number(flag(name)) : undefined);
    const p = await choiceCases({ out: flag("out")!, pilots: positional(), ...(num("citizens") !== undefined ? { citizens: num("citizens")! } : {}), ...(num("replies") !== undefined ? { replies: num("replies")! } : {}), writers: (flag("writers") ?? "writer").split(",").map((x) => x.trim()).filter(Boolean), ...(num("seed") !== undefined ? { seed: num("seed")! } : {}) });
    console.log(`${p.items.length} cases planned in ${flag("out")} (choices-plan.json): ${Object.entries(p.by_kind).map(([k, n]) => `${k} ${n}`).join(", ")}`);
    console.log(`  read: ${JSON.stringify(p.counts)}`);
  } else if (cmd === "translator-data-collect" && positional()[1]) {
    // Every part's checked examples as one set with its groups, cut into what may train and a parity test (broad.ts).
    const { collect } = await import("./broad");
    const num = (name: string) => (flag(name) ? Number(flag(name)) : undefined);
    const r = collect(positional()[0]!, positional().slice(1), { ...(num("share") !== undefined ? { share: num("share")! } : {}), ...(num("floor") !== undefined ? { floor: num("floor")! } : {}), ...(num("seed") !== undefined ? { seed: num("seed")! } : {}) });
    console.log(`${r.examples} examples: ${r.train} may train, ${r.parity} are the parity test (never trained on); the leak check names ${r.leak_check.cases_named} held-out cases`);
    for (const [d, c] of Object.entries(r.cells)) console.log(`  ${d} × function: smallest cell ${c.min}; ${Object.keys(c.under).length} cells under the floor`);
  } else if (cmd === "translator-v2-data" && flag("out")) {
    // The plan of the cases banked for a later translator (translator/train/v2.ts): no model is called.
    const { v2Cases } = await import("./broad");
    const num = (name: string) => (flag(name) ? Number(flag(name)) : undefined);
    const p = await v2Cases({ out: flag("out")!, pilots: positional(), ...(num("from-pilots") !== undefined ? { fromPilots: num("from-pilots")! } : {}), ...(num("generated") !== undefined ? { generated: num("generated")! } : {}), ...(num("max-carried") !== undefined ? { maxCarried: num("max-carried")! } : {}), ...(num("turns") !== undefined ? { turns: num("turns")!, acts: flags("acts") } : {}), writers: (flag("writers") ?? "writer").split(",").map((x) => x.trim()).filter(Boolean), ...(num("seed") !== undefined ? { seed: num("seed")! } : {}) });
    console.log(`${p.items.length} cases planned in ${flag("out")} (v2-plan.json): ${Object.entries(p.by_kind).map(([k, n]) => `${k} ${n}`).join(", ")}`);
    console.log(`  from pilots: ${JSON.stringify(p.counts)}`);
  } else if (cmd === "translator-pipeline" && positional()[0]) {
    const { loadConfig, plainReport, runPipeline } = await import("./pipeline");
    const m = await runPipeline(loadConfig(positional()[0]!));
    console.log(plainReport(m));
    if (m.status !== "complete") process.exit(3);
  } else if (cmd === "record" && positional()[1]) {
    // One entity's own record, rebuilt from a log and checked against the kernel's chained hashes
    // (docs/design/ai-citizens.md 10d): oikos record <log.jsonl[.zst]> <entity|participant> [--at SECONDS]
    const { rebuild } = await import("./records");
    const at = flag("at");
    const r = await rebuild(positional()[0]!, positional()[1]!, at !== undefined ? Number(at) : undefined);
    if (!r) {
      console.error(`no record of ${positional()[1]} in ${positional()[0]}`);
      process.exit(1);
    }
    console.log(JSON.stringify({ entity: r.entity, participant: r.participant, changes: r.n, at: r.at, chain: r.chain, bytes: r.bytes, largest_bytes: r.largest, sections: r.sections }, null, 2));
    if (r.faults.length) {
      console.error(`NOT VERIFIED: ${r.faults.length} fault${r.faults.length > 1 ? "s" : ""}\n  ${r.faults.slice(0, 20).join("\n  ")}`);
      process.exit(2);
    }
    console.error(`verified: ${r.n} change${r.n > 1 ? "s" : ""}, each link of the chain and each digest as the kernel logged it`);
  } else if (cmd === "dataset" && positional()[0]) {
    // Run datasets: every run's data as training examples (docs/design/run-datasets.md).
    const { logsIn } = await import("./corpus");
    const { exportDataset } = await import("./dataset");
    const src = positional()[0]!;
    for (const log of logsIn(src)) {
      const out = join(flag("out") ?? join(log, ".."), `${log.split("/").at(-1)!.replace(/\.jsonl(\.zst)?$/, "")}.dataset`);
      const m = await exportDataset(log, out, { actions: has("actions") });
      // (Where the run had culture on: what a town held in common, read from the log, beside the dataset: docs/behaviour/culture.md, "Measures".)
      const { cultureMeasures } = await import("./culture-measures");
      const cm = await cultureMeasures(log);
      if (cm) { await Bun.write(join(out, "culture.json"), `${JSON.stringify(cm, null, 1)}\n`); console.log(`${m.run}: culture.json (${cm.norm_shares.length} norm rows, ${cm.tipping.events.length} tipping events)`); }
      console.log(`${m.run}: ${Object.entries(m.files).map(([f, x]: [string, any]) => `${f} ${x.rows}${x.synthetic ? ` (${x.synthetic} synthetic)` : ""}`).join(", ")} -> ${out}`);
    }
  } else if (cmd === "corpus" && positional()[0]) {
    // The translator corpus: every translation in the logs, as training examples (docs/measurement.md).
    const { corpusOf, logsIn } = await import("./corpus");
    const src = positional()[0]!;
    const out = flag("out") ?? (statSync(src).isDirectory() ? join(src, "translator-corpus.jsonl") : src.replace(/\.jsonl$/, ".translator-corpus.jsonl"));
    const rows = (await Promise.all(logsIn(src).map(corpusOf))).flat();
    await Bun.write(out, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
    const real = rows.filter((r) => !r.synthetic).length;
    console.log(`${rows.length} translations (${real} from real models, ${rows.length - real} synthetic) into ${out}: ${rows.filter((r) => r.result === "drafted").length} drafted, ${rows.filter((r) => r.result === "failed").length} failed; ${rows.filter((r) => r.executed?.applied).length} carried out and applied.`);
  } else if (cmd === "cost" && positional()[0]) {
    console.log((await costReport(await measureDir(positional()[0]!), { translatorModel: flag("translator-model") })).text);
  } else if (cmd === "story" && positional()[0]) {
    const { story } = await import("./story");
    console.log(await story(positional()[0]!, positional()[1]));
  } else if (cmd === "replay" && rest[0]) {
    // A compressed log is replayed from a plain copy (the kernel reads plain logs).
    let log = rest[0];
    if (log.endsWith(".zst")) {
      const { readLog } = await import("./logs");
      log = join(process.env.TMPDIR ?? "/tmp", `oikos-replay-${process.pid}.jsonl`);
      await Bun.write(log, readLog(rest[0]));
    }
    const p = Bun.spawnSync([kernelBinary(), "replay", log, ...rest.slice(1)], { stdout: "inherit", stderr: "inherit" });
    if (log !== rest[0]) rmSync(log, { force: true });
    process.exit(p.exitCode ?? 1);
  } else {
    console.error(usage);
    process.exit(2);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
