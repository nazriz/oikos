// Real models, by name: "anthropic/<model>", "openai/<model>", or a local
// open-weight model behind an OpenAI-compatible server ("ollama/<model>", or
// "local/<model>" with --base-url). Keys come from the environment
// (ANTHROPIC_API_KEY, OPENAI_API_KEY) and are never logged. Prices come from
// prices.json; a local model costs nothing to call (its compute is yours).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AnthropicAdapter, OpenAICompatibleAdapter, type Budget, type LlmAdapter, type Price } from "@terrarium/participants/llm";

export const LOCAL_PROVIDERS = ["ollama", "local"];

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
export function chooseModel(name: string, o: { budgetUsd?: number; baseUrl?: string; env?: Record<string, string | undefined> } = {}): ModelChoice {
  const env = o.env ?? process.env;
  const [provider, ...rest] = name.split("/");
  const model = rest.join("/");
  if (!provider || !model) throw new Error(`--model: expected provider/model, got "${name}"`);
  const prices = priceTable();
  const local = LOCAL_PROVIDERS.includes(provider);
  if (local) prices[name] = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  if (!prices[name]) throw new Error(`no published price for ${name} in orchestrator/prices.json: add it (with its source) before using this model`);
  if (!local && o.budgetUsd === undefined) throw new Error(`a spending limit is required for ${name}: add --budget <dollars per run>`);
  const budget = o.budgetUsd !== undefined ? { limitMicroUsd: Math.round(o.budgetUsd * 1e6), spentMicroUsd: 0 } : undefined;
  const need = (key: string) => {
    const v = env[key];
    if (!v) throw new Error(`${name} needs ${key} in the environment`);
    return v;
  };
  const adapter =
    provider === "anthropic" ? new AnthropicAdapter(model, { apiKey: need("ANTHROPIC_API_KEY"), ...(o.baseUrl ? { baseUrl: o.baseUrl } : {}) })
    : provider === "openai" ? new OpenAICompatibleAdapter("openai", model, { apiKey: need("OPENAI_API_KEY"), ...(o.baseUrl ? { baseUrl: o.baseUrl } : {}) })
    : provider === "ollama" ? new OpenAICompatibleAdapter("ollama", model, { baseUrl: o.baseUrl ?? "http://localhost:11434/v1" })
    : provider === "local" ? new OpenAICompatibleAdapter("local", model, { baseUrl: o.baseUrl ?? (() => { throw new Error("local/<model> needs --base-url (an OpenAI-compatible server)"); })() })
    : (() => { throw new Error(`unknown provider "${provider}": anthropic, openai, ollama or local`); })();
  return { adapter, prices, ...(budget ? { budget } : {}) };
}
