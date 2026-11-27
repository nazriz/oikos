// Every run's name, the one place it is made: "Claude Sonnet 5.5, setup 7, keep its programme" and, where the same model
// ran the same town under the same instructions more than once, ", run 2" (by when the run was made). Unique across
// the catalogue, so two runs never share a name in a trail, a list or a switcher. The rule-based mayor is "Rule-based
// mayor (no AI), setup 7, …"; a log outside the study keeps its own file name.
import type { RunEntry } from "../shared/api";
import { modelName } from "./words";

/** The instructions in a few words, for a name. */
const SHORT: Record<string, string> = {
  none: "no extra goal",
  mandate: "no extra goal",
  strong: "keep its programme",
  strong_corrigible: "keep its programme, leave it reversible",
  redteam: "stay mayor by any means",
  levercheck: "checker test",
};
const instructions = (e: RunEntry) => {
  const x = e.experiment!;
  const g = SHORT[x.goal] ?? x.goal.replace(/[_-]+/g, " ");
  return x.election === false ? `${g}, no election in the run` : g;
};

/** The run's name without its number: model (or the rule-based mayor), town, instructions. */
function baseName(e: RunEntry): string {
  const x = e.experiment;
  if (!x) return e.title.split("/").at(-1) ?? e.key;
  // ("Setup 7": every run is the same town, started from a different random seed; the rule-based mayor has no
  // instructions of its own, only the AI runs it is the comparison for.)
  if (x.isCode) return `Rule-based mayor (no AI), setup ${x.seed}, compared with “${instructions(e)}”`;
  return `${modelName(x.model)}, setup ${x.seed}, ${instructions(e)}`;
}

let names = new Map<string, string>();
let from: RunEntry[] | null = null;

/** Names for a whole catalogue: the base name, and ", run N" where several runs share it (oldest first). */
export function nameRuns(runs: RunEntry[]): Map<string, string> {
  if (runs === from) return names;
  const groups = new Map<string, RunEntry[]>();
  for (const e of runs) {
    const b = baseName(e);
    groups.set(b, [...(groups.get(b) ?? []), e]);
  }
  const out = new Map<string, string>();
  for (const [b, g] of groups) {
    if (g.length < 2) {
      out.set(g[0]!.key, b);
      continue;
    }
    g.sort((a, c) => a.mtimeMs - c.mtimeMs || a.key.localeCompare(c.key));
    g.forEach((e, i) => out.set(e.key, `${b}, run ${i + 1}`));
  }
  names = out;
  from = runs;
  return out;
}

/** A run's name by its key, once the catalogue is named; `fallback` (its base words) until then. */
export function runNameOf(key: string, fallback: string): string {
  return names.get(key) ?? fallback;
}

/** The run's name for the trail, where the title above already says the model and its instructions: "Setup 7, run 3"
 * (the setup, as lens-words names it, and the run's number where its full name has one). The full name is the crumb's hover. */
export function runShortName(e: RunEntry | undefined): string {
  if (!e?.experiment) return runName(e);
  const n = runName(e).match(/, (run \d+)$/)?.[1];
  return `Setup ${e.experiment.seed}${n ? `, ${n}` : ""}`;
}

/** The run's name without its instructions, for a narrow row ("DeepSeek V4.1 Flash, setup 9, run 1"): the model, the
 * setup and the run's number, which its full name has; the full name is the row's hover. */
export function runNameShort(key: string, model: string, seed: number): string {
  const full = names.get(key);
  const n = full?.match(/, (run \d+)$/)?.[1];
  return `${model}, setup ${seed}${n ? `, ${n}` : ""}`;
}

/** A run's name: from the catalogue once it is named (nameRuns), else its base name. */
export function runName(e: RunEntry | undefined): string {
  if (!e) return "";
  return names.get(e.key) ?? baseName(e);
}
