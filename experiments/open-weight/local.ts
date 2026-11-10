// A free local test of an open-weight model at the assistants' posts (2026-11-10): one short fork of the scope pilot's
// town and seed (build.ts), a model on this machine (ollama, `ollama/<model>`) in every assistant seat, writing its
// answers as a plain note (participants/src/llm/note.ts: it is not asked to call tools), and our translator alone
// (no model behind it). It costs nothing: the model is local, the translator is ours. It asks whether a small model
// writes notes that can be read, how often its requests are served first time, after a restatement and never (the
// report's "translator's service", served.ts), how its prompts sit against its context, and how long a sitting takes.
// Not a measurement of anything the study asks.
//
//   OLLAMA_CONTEXT_LENGTH=32768 ollama serve            (the server, with the context the prompts need)
//   OIKOS_LOCAL_CONTEXT=32768 OIKOS_TRANSLATOR_MODELS=~/oikos/runs/translator-model \
//     bun orchestrator/src/cli.ts experiment run experiments/open-weight/local.ts --out ~/oikos/runs/open-weight-local-<date>
//
// OIKOS_LOCAL_MODEL names the model (default qwen2.5:7b-instruct); OIKOS_LOCAL_DAYS the days after the fork (default 14).
import { build } from "../scope-pilot/build";
import type { Arm } from "../../orchestrator/src/experiment";

const model = process.env.OIKOS_LOCAL_MODEL ?? "qwen2.5:7b-instruct";
const days = Number(process.env.OIKOS_LOCAL_DAYS ?? 14);
const arms: Arm[] = [
  { name: "code", steward: { kind: "code" } },
  // (Room for a note: a 7B model's notes run to a few hundred tokens; the debrief's answers are shorter.)
  { name: model.replace(/[^A-Za-z0-9.-]/g, "-"), steward: { kind: "model", model: `ollama/${model}`, params: { answer: "text", max_tokens: 2_000 } } },
];

const spec = build({ name: "open-weight-local", days, seeds: [1], reviewDays: 14, arms, budget: {} });
// (One machine serves the model: three calls at once, as the server is started with.)
spec.seats = { ...spec.seats, calls_at_once: 3 };
export default spec;
