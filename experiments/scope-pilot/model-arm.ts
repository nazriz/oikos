// The model arm of a run taken from the environment (`OIKOS_MODEL`, 2026-11-16): which model holds the seats, the arm's
// short name, the params its route needs and whether it bills. Used by stakes-run.ts; the default is today's arm exactly
// (`anthropic/claude-haiku-5-5`, the arm "haiku", the experiment's name unchanged).
//   - ollama/<model>, local/<model>: a model on this machine, writing plain notes (params `answer: "text"`, 2,000 tokens
//     of room, as first-pilot.ts's local arm); free, so no dollar limit bites: what bounds it is the seat's sittings (one
//     a working day a seat), 24 calls a sitting at most (seat-host.ts TURNS_PER_WAKE) and 900 s a call (models.ts).
//   - openai-compat/<host>/<model>: a hosted open-weight API, a paid key, so seated with `allow_paid_api` (choosing it
//     here is the owner's go-ahead) and under the run's dollar limits at its price entry's figures; the entry's `answer`
//     says how it is asked (text unless it says otherwise), and its room is 8,000 tokens (docs/real-models.md, a
//     32,768-token window beside the pilot's longest prompts). An entry missing or marked to_confirm is refused.
//   - codex/<model>: the owner's ChatGPT subscription, flat rate (nothing reckoned a call); room as Haiku's. Not on equal
//     terms (the Codex CLI puts its own instructions under ours).
//   - anthropic/<model>, claude-code/<model>: room as Haiku's, priced at the API's rates.
// gpt-6-astra is never seated (nor the largest Claude model or Fable: the harness refuses those too).
import type { Arm } from "../../orchestrator/src/experiment";
import { priceTable } from "../../orchestrator/src/models";

export const DEFAULT_MODEL = "anthropic/claude-haiku-5-5";
/** Room for a call's output, thinking included (the API's and the subscriptions' seats). */
const ROOM = { max_tokens: 16_000 };
/** A local model's room for a note (first-pilot.ts); a hosted one's within a 32,768-token window. */
const LOCAL_ROOM = 2_000;
const HOSTED_ROOM = 8_000;

/** The arm's short, file-safe name: "haiku" for the default; else the model's last part, lower case, anything but
 * letters, digits, dots and dashes made a dash ("ollama/qwen2.5:14b-instruct" -> "qwen2.5-14b-instruct"). */
export function armNameOf(model: string): string {
  if (model === DEFAULT_MODEL) return "haiku";
  return model.split("/").at(-1)!.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** The model arm for `model`, its seats the given posts' complement; `paid` when the key bills (allow_paid_api). */
export function modelArm(model: string, codePosts: string[], prices: Record<string, any> = priceTable()): { arm: Arm; paid: boolean } {
  if (/astra/i.test(model)) throw new Error(`OIKOS_MODEL: ${model}: gpt-6-astra is never seated`);
  const [provider, ...rest] = model.split("/");
  if (!provider || !rest.length || !rest.join("/")) throw new Error(`OIKOS_MODEL: expected provider/model, got "${model}"`);
  const name = armNameOf(model);
  if (!name || name === "code") throw new Error(`OIKOS_MODEL: ${model} gives no arm name of its own`);
  let params: Record<string, unknown> = ROOM;
  let paid = false;
  if (provider === "ollama" || provider === "local") params = { answer: "text", max_tokens: LOCAL_ROOM };
  else if (provider === "openai-compat") {
    const p = prices[model];
    if (!p) throw new Error(`OIKOS_MODEL: no price entry for ${model} in orchestrator/prices.json (input, output, answer, context_tokens, source, retrieved): add it from the host's own page first`);
    if (p.to_confirm) throw new Error(`OIKOS_MODEL: the price of ${model} is marked to_confirm: check it against ${p.source ?? "the host's page"} first`);
    params = { answer: p.answer ?? "text", max_tokens: HOSTED_ROOM };
    paid = true;
  } else if (provider === "openai") paid = true;
  return { arm: { name, steward: { kind: "model", model, params }, codePosts }, paid };
}

/** The experiment's name with the model's arm in it, so runs of different models never share a folder (the default
 * model's name unchanged). */
export const withModel = (name: string, model: string) => (model === DEFAULT_MODEL ? name : `${name}-${armNameOf(model)}`);
