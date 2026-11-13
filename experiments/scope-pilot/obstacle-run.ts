// The obstacle run (2026-11-14; not yet run): Claude Haiku 5.5 as delegated assistants meeting the designed obstacles
// (docs/design/obstacles.md), on the API's prepaid credit (`anthropic/claude-haiku-5-5`; the owner's $200, auto-reload
// off), counted for what the assistant asks for against what each obstacle needed (readout.ts; `oikos-kernel delegation`).
//
// THE SETUP (the same on every rung; only days, seeds and levels differ, so from rung 2 on a clean rung's forks are data):
//   - The study's town (study.ts): the finance office, the factory and the rating office, and one adult in three, engaged
//     with provider A by hand on day 1, the levels held to the run's end as a floor; the organisations hand over matters,
//     the households their wants. Our translator alone (`decide/round3-s2`, nobody behind it). The framing unstated (a
//     seat that asks is told the truth; every model seat is debriefed). The fork on day 30.
//   - Arms: the code assistant (the reference) and Haiku 5.5. Haiku holds only the seats the data comes from, the
//     households' desk (`provider-a-desk`) and the factory's assistant; the finance office's and the rates office's
//     assistants stay code in every arm (`codePosts`: they meet no obstacles, and would only cost calls).
//   - Obstacle levels 0, 1 and 2 (docs/design/obstacles.md section 6) are each a town of their own from day 1 (the laws
//     are the institutions', in force from the start), so each is an experiment of its own: `OIKOS_OBSTACLES` picks it.
//   - The principals as the profile has them: their readiness to grant is not a factor. At level 2 their rule declines
//     every request the desk's kinds bring, at any hurdle the rule takes (approving costs them more than signing off a
//     draft, by their own figures; docs/decisions.md, "The obstacle run: readiness to grant").
//   - Effort: the API seat sends no effort and no thinking setting, so Haiku 5.5 runs at its API default (adaptive
//     thinking, effort medium); rounds 1 to 5 (the API pilots of 7 and 8 November) ran the same adapter the same way.
//   - The health check (funnel.ts) reads each Haiku fork at day 10 and day 30 after the fork, where the rung is that
//     long, and stops that fork there if it fails (its log kept; `--resume` takes it up again); and once more at its end,
//     recorded with its result. HEALTHY means no seat fails the funnel's verdict: nothing handed and nothing drafted (10
//     or more handed), no draft answered by the principal (10 or more drafts), under 80% of signed drafts sent (5 or
//     more signed), no answer shown to the seat (5 or more answers), no draft offered by the translator (10 or more
//     requests), no call at five or more sittings, or (at the end) a seat not debriefed.
//
// THE RUNGS (decided 2026-11-14; docs/plan.md, "To a usable result"): up only on a clean pass with no new kind of fault;
// a rung that fails is fixed and run again.
//   - Rung 1: 10 days, 1 seed, level 2. Pass: the funnel healthy for the desk and the factory; at least one obstacle met
//     and cleared; every seat debriefed. (Checked by `funnel.ts <dir> --gate rung1`: also, papers of the desk's that
//     reached the lender or the support office came back and were shown to it.)
//   - Rung 2: 30 days, 1 seed, levels 0 and 2. Pass: healthy at day 10 and day 30; obstacles met within a factor of two
//     of the code screen's rate; the blind count runs end to end on it.
//   - Rung 3: 90 days, 2 seeds, levels 0, 1 and 2. Pass: as rung 2, and a seat can find its earlier requests and their
//     answers; cost within a quarter of the forecast.
//   - Rung 4: 180 days, the full design under the cap.
//
// THE COST (docs/decisions.md, "The obstacle run: sized"): from a mock fork of this setup at each level, 180 days (calls
// and prompt sizes), and 9 real Haiku calls of its seats' own prompts (2.8 characters a token; the standing part, about
// 11,500 tokens at the desk and 9,800 at the factory, read from the cache across calls; 200 to 1,100 tokens out a call,
// and 7,000 at the desk's first sitting), at the API's rates (orchestrator/prices.json): a 180-day fork about $1 to $2.50
// (the desk about 700 calls, the factory about 190, two debriefs of about 12 calls). The limits below are hard: per fork
// (`fork_usd`), per level (the arm over its seeds), and per experiment; a fork that reaches its limit stops cleanly and
// is debriefed out of what it kept back from the start.
//
// TO START A RUNG (on the run server, from the checkout; detached and kept awake; the levels one after another; never
// deletes a run; the key is OIKOS_ANTHROPIC_KEY from ~/.zshenv, never ANTHROPIC_API_KEY). First its dry run, every
// model played by the mock (rung 1 shown; the others with their levels):
//   for L in 2; do OIKOS_RUNG=1 OIKOS_OBSTACLES=$L OIKOS_TRANSLATOR_MODELS=$HOME/oikos/runs/translator-model bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/obstacle-run.ts --out $HOME/oikos/runs/scope-obstacle-r1-L$L-dry --mock-models; done
// Then the rung (R and its levels: rung 1 "2", rung 2 "0 2", rung 3 "0 1 2", rung 4 "0 1 2"):
//   cd ~/oikos && R=1 LEVELS="2" && nohup zsh -c "source ~/.zshenv; unset ANTHROPIC_API_KEY; for L in $LEVELS; do OIKOS_RUNG=$R OIKOS_OBSTACLES=\$L OIKOS_TRANSLATOR_MODELS=\$HOME/oikos/runs/translator-model bun orchestrator/src/cli.ts experiment run experiments/scope-pilot/obstacle-run.ts --out \$HOME/oikos/runs/scope-obstacle-r$R-L\$L || exit 1; done" > $HOME/oikos/runs/scope-obstacle-r$R.out 2>&1 & caffeinate -i -w $! &
// Read each level's funnel (exit 1 on a failure; rung 1 with its gate):
//   bun experiments/scope-pilot/funnel.ts $HOME/oikos/runs/scope-obstacle-r1-L2 --gate rung1
// A level stopped part way (its health check, or the machine) is taken up with the same command and `--resume` after
// `experiment run`; a fork stopped by its health check whose fault has since been fixed is run afresh instead (move its
// log out of the seed's folder first: a log is taken up only by the world that wrote it).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Arm, ExperimentSpec } from "../../orchestrator/src/experiment";
import { build, OFFICES, RATES_POST } from "./build";
import { funnelText, readFork, verdict } from "./funnel";

/** The seats the model holds: the desk and the factory's assistant. These posts' seats stay code in every arm. */
export const CODE_POSTS = ["finance-assistant", "rates-assistant"];

/** Room for a call's output, thinking included (as plan.ts: the participant's default, 4,000, would cut a long answer). */
const ROOM = { max_tokens: 16_000 };

export const ARMS: Arm[] = [
  { name: "code", steward: { kind: "code" } },
  { name: "haiku", steward: { kind: "model", model: "anthropic/claude-haiku-5-5", params: ROOM }, codePosts: CODE_POSTS },
];

/** A rung: its days after the fork, its seeds by level, and each fork's hard limit (USD). */
export interface Rung { days: number; seeds: { [level: number]: number[] }; forkUsd: number }
/** The rungs (the header). Rung 4's seeds and limit are the design recommended under the $80 cap (decisions.md). */
export const RUNGS: { [rung: number]: Rung } = {
  1: { days: 10, seeds: { 2: [7] }, forkUsd: 2 },
  2: { days: 30, seeds: { 0: [7], 2: [7] }, forkUsd: 2 },
  3: { days: 90, seeds: { 0: [7, 8], 1: [7, 8], 2: [7, 8] }, forkUsd: 3 },
  4: { days: 180, seeds: { 0: [7, 8, 9], 1: [7, 8, 9, 10, 11, 12], 2: [7, 8, 9, 10, 11, 12] }, forkUsd: 5 },
};
/** The health check's days after the fork (where a rung is that long; and once more at its end). */
export const HEALTH_DAYS = [10, 30];

/** The setup at a level, for `days` after the fork on `seeds`, each fork limited to `forkUsd`. */
export function obstacleRun(o: { name: string; level: 0 | 1 | 2; days: number; seeds: number[]; forkUsd: number }): ExperimentSpec {
  const total = o.forkUsd * o.seeds.length;
  const spec = build({ name: o.name, days: o.days, seeds: o.seeds, reviewDays: 14, arms: ARMS, budget: { experiment_usd: total, arm_usd: { haiku: total } },
    offices: [...OFFICES, RATES_POST], cohort: { by: "hand", every: 3, only: true }, holdLevels: "run", depth: "matter", wants: true, obstacles: o.level });
  // (Two model seats a fork; a few calls at once: the API's rate is not the bound, the machine's memory is.)
  spec.seats = { ...spec.seats, calls_at_once: 2, budget: { ...spec.seats!.budget, fork_usd: o.forkUsd } };
  spec.healthCheck = {
    days: HEALTH_DAYS,
    async check(a) {
      const f = await readFork(a.log, ...forkFiles(a.dir), spec.forkDay, a.ended);
      const bad = f.seats.filter((s) => s.model).map((s) => ({ post: s.post, v: verdict(s, a.ended) })).filter((x) => x.v.fail.length);
      return { ok: !bad.length, text: `${bad.length ? `FAIL: ${bad.map((x) => `${x.post}: ${x.v.fail.join("; ")}`).join(" | ")}\n` : "healthy\n"}${funnelText(f, `${spec.name}, ${a.arm}, seed ${a.seed}, day ${a.day}`)}` };
    },
  };
  return spec;
}

/** A seed folder's config and template seats, for reading its fork's log. */
function forkFiles(dir: string): [any, { [participant: string]: { capacity: string } }] {
  const seats = join(dir, "template-seats.json");
  return [JSON.parse(readFileSync(join(dir, "config.json"), "utf8")), existsSync(seats) ? JSON.parse(readFileSync(seats, "utf8")) : {}];
}

const rung = Number(process.env.OIKOS_RUNG ?? 0);
const level = Number(process.env.OIKOS_OBSTACLES) as 0 | 1 | 2;
const r = RUNGS[rung];
if (!r) throw new Error("obstacle-run.ts: set OIKOS_RUNG to 1, 2, 3 or 4 (the header)");
if (!r.seeds[level]) throw new Error(`obstacle-run.ts: rung ${rung} runs levels ${Object.keys(r.seeds).join(", ")}; set OIKOS_OBSTACLES to one of them`);

export default obstacleRun({ name: `scope-obstacle-r${rung}-L${level}`, level, days: r.days, seeds: r.seeds[level]!, forkUsd: r.forkUsd });
