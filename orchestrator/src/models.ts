// Real models, by name: "anthropic/<model>", "openai/<model>", or a local
// open-weight model behind an OpenAI-compatible server ("ollama/<model>", or
// "local/<model>" with --base-url). Keys come from the environment
// (OIKOS_ANTHROPIC_KEY, OPENAI_API_KEY) and are never logged. The Anthropic key is
// OIKOS_ANTHROPIC_KEY and never ANTHROPIC_API_KEY: with that one set, Claude Code
// itself would bill the key instead of the owner's plan (docs/real-models.md). Prices come from
// prices.json; a local model costs nothing to call (its compute is yours).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DecideAdapter } from "../../translator/model/adapter";
import { AnthropicAdapter, ClaudeCodeAdapter, CodexCliAdapter, OpenAICompatibleAdapter, type Budget, type LlmAdapter, type Price } from "@oikos/participants/llm";

/** Providers whose calls cost nothing per call: local models (your compute), and the Codex CLI on a ChatGPT subscription (flat rate; its usage limits apply). */
export const LOCAL_PROVIDERS = ["ollama", "local", "codex", "decide"];

export function priceTable(): Record<string, Price> {
  const t = JSON.parse(readFileSync(join(import.meta.dir, "../prices.json"), "utf8"));
  return t.models;
}

export interface ModelChoice {
  adapter: LlmAdapter;
  prices: Record<string, Price>;
  budget?: Budget;
}

/** An adapter for "provider/model", with its price and the run's spending limit (in dollars; required for a model that costs money). */
export function chooseModel(name: string, o: { budgetUsd?: number; baseUrl?: string; env?: Record<string, string | undefined>; /** One attempt's time limit for a model called through a command-line tool (theirs if absent: three minutes). */ timeoutMs?: number; /** The model answers first, with another translator behind it (translator/src/arrangement.ts). */ first?: boolean } = {}): ModelChoice {
  const env = o.env ?? process.env;
  const [provider, ...rest] = name.split("/");
  const model = rest.join("/");
  if (!provider || !model) throw new Error(`--model: expected provider/model, got "${name}"`);
  if (model === "default") throw new Error(`name the model (${provider}/<model>), so the log records which one ran`);
  const prices = priceTable();
  const local = LOCAL_PROVIDERS.includes(provider);
  if (local) prices[name] = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  // Claude Code on a Claude plan draws on the plan's monthly credit, at the model's published API price:
  // it is priced as that model (and needs a spending limit like any other), whatever effort is named with it.
  if (provider === "claude-code" && prices[`anthropic/${model.split("@")[0]}`]) prices[name] = prices[`anthropic/${model.split("@")[0]}`]!;
  if (!prices[name]) throw new Error(`no published price for ${name} in orchestrator/prices.json: add it (with its source) before using this model`);
  if (!local && o.budgetUsd === undefined) throw new Error(`a spending limit is required for ${name}: add --budget <dollars per run>`);
  const budget = o.budgetUsd !== undefined ? { limitMicroUsd: Math.round(o.budgetUsd * 1e6), spentMicroUsd: 0 } : undefined;
  const need = (key: string) => {
    const v = env[key];
    if (!v) throw new Error(`${name} needs ${key} in the environment`);
    return v;
  };
  const adapter =
    provider === "anthropic" ? new AnthropicAdapter(model, { apiKey: need("OIKOS_ANTHROPIC_KEY"), ...(o.baseUrl ? { baseUrl: o.baseUrl } : {}) })
    : provider === "openai" ? new OpenAICompatibleAdapter("openai", model, { apiKey: need("OPENAI_API_KEY"), ...(o.baseUrl ? { baseUrl: o.baseUrl } : {}) })
    : provider === "codex" ? new CodexCliAdapter(model, undefined, o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) // ("model@effort": the effort is part of the model's name, so the log records it)
    : provider === "claude-code" ? new ClaudeCodeAdapter(model, undefined, o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) // ("model@effort", as for codex)
    : provider === "decide" ? new DecideAdapter(model, { ...(env.OIKOS_DECIDE_THRESHOLD ? { threshold: Number(env.OIKOS_DECIDE_THRESHOLD) } : {}), ...(env.OIKOS_DECIDE_UNCHECKED ? { unchecked: true } : {}), ...(o.first ? { first: true } : {}) }) // our own trained model (translator/model)
    : provider === "ollama" ? new OpenAICompatibleAdapter("ollama", model, { baseUrl: o.baseUrl ?? "http://localhost:11434/v1" })
    : provider === "local" ? new OpenAICompatibleAdapter("local", model, { baseUrl: o.baseUrl ?? (() => { throw new Error("local/<model> needs --base-url (an OpenAI-compatible server)"); })() })
    : (() => { throw new Error(`unknown provider "${provider}": anthropic, openai, codex, claude-code, ollama or local`); })();
  return { adapter, prices, ...(budget ? { budget } : {}) };
}
