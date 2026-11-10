// Real models, by name: "anthropic/<model>", "openai/<model>", "openai-compat/<host>/<model>" (a hosted
// OpenAI-compatible API: Fireworks, Together, OpenRouter, Featherless; its key from OIKOS_<HOST>_KEY), or a local
// open-weight model behind an OpenAI-compatible server ("ollama/<model>", or
// "local/<model>" with --base-url). Keys come from the environment
// (OIKOS_ANTHROPIC_KEY, OPENAI_API_KEY) and are never logged. The Anthropic key is
// OIKOS_ANTHROPIC_KEY and never ANTHROPIC_API_KEY: with that one set, Claude Code
// itself would bill the key instead of the owner's plan (docs/real-models.md). Prices come from
// prices.json; a local model costs nothing to call (its compute is yours).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgreeAdapter, DecideAdapter } from "../../translator/model/adapter";
import { AnthropicAdapter, ClaudeCodeAdapter, CodexCliAdapter, COMPAT_HOSTS, OpenAICompatHostedAdapter, OpenAICompatibleAdapter, type Budget, type LlmAdapter, type Price } from "@oikos/participants/llm";

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
export function chooseModel(name: string, o: { budgetUsd?: number; baseUrl?: string; env?: Record<string, string | undefined>; /** One attempt's time limit for a model called through a command-line tool (theirs if absent: three minutes). */ timeoutMs?: number; /** The model answers first, with another translator behind it (translator/src/arrangement.ts). */ first?: boolean; /** Our own translator with nobody behind it (arrangement.ts, `createAlone`). */ alone?: boolean; /** How a local model is asked to answer: through the API's tools (the default) or as a plain note (`text`: participants/src/llm/note.ts). */ answer?: "tools" | "text"; /** For tests: a price table in place of prices.json. */ prices?: Record<string, Price> } = {}): ModelChoice {
  const env = o.env ?? process.env;
  const [provider, ...rest] = name.split("/");
  const model = rest.join("/");
  if (!provider || !model) throw new Error(`--model: expected provider/model, got "${name}"`);
  if (model === "default") throw new Error(`name the model (${provider}/<model>), so the log records which one ran`);
  const prices = o.prices ?? priceTable();
  const local = LOCAL_PROVIDERS.includes(provider);
  if (local) prices[name] = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  // Claude Code on a Claude plan draws on the plan's monthly credit, at the model's published API price:
  // it is priced as that model (and needs a spending limit like any other), whatever effort is named with it.
  if (provider === "claude-code" && prices[`anthropic/${model.split("@")[0]}`]) prices[name] = prices[`anthropic/${model.split("@")[0]}`]!;
  if (!prices[name]) throw new Error(`no published price for ${name} in orchestrator/prices.json: add it (with its source) before using this model`);
  // (A price written down but not yet checked against the provider's page is never used to run: no call is priced from a guess.)
  if ((prices[name] as any).to_confirm) throw new Error(`the price of ${name} in orchestrator/prices.json is marked to_confirm: check it against ${(prices[name] as any).source ?? "the provider's price page"}, then set its figures and date and take the mark out`);
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
    : provider === "decide" ? new (model.includes("+") ? AgreeAdapter : DecideAdapter)(model, { ...(env.OIKOS_DECIDE_THRESHOLD ? { threshold: Number(env.OIKOS_DECIDE_THRESHOLD) } : {}), ...(env.OIKOS_DECIDE_UNCHECKED ? { unchecked: true } : {}), ...(o.first ? { first: true } : {}), ...(o.alone ? { alone: true } : {}) }) // our own trained model (translator/model)
    : provider === "openai-compat" ? (() => {
      // openai-compat/<host>/<model>: a hosted OpenAI-compatible API (Fireworks, Together, OpenRouter), its key from the
      // host's own variable, its base URL from --base-url, OIKOS_<HOST>_BASE_URL or the host's default.
      const [host, ...m] = model.split("/");
      const h = COMPAT_HOSTS[host!];
      if (!h || !m.length) throw new Error(`openai-compat/<host>/<model>: the host is one of ${Object.keys(COMPAT_HOSTS).join(", ")}, got "${model}"`);
      return new OpenAICompatHostedAdapter(host!, m.join("/"), { apiKey: need(h.keyEnv), baseUrl: o.baseUrl ?? env[`OIKOS_${host!.toUpperCase()}_BASE_URL`] ?? h.baseUrl, answer: (prices[name] as any).answer ?? "text", ...(typeof (prices[name] as any).context_tokens === "number" ? { contextTokens: (prices[name] as any).context_tokens } : {}) });
    })()
    // (A local model in text mode answers in a plain note, as a model with no tool calling must: OpenAICompatHostedAdapter's
    // `text`, under the provider's own name, with no key. Its context window from OIKOS_LOCAL_CONTEXT, where set.)
    : (provider === "ollama" || provider === "local") && o.answer === "text" ? new OpenAICompatHostedAdapter(provider, model, { provider, apiKey: "", answer: "text", baseUrl: o.baseUrl ?? (provider === "ollama" ? env.OIKOS_OLLAMA_BASE_URL ?? "http://localhost:11434/v1" : (() => { throw new Error("local/<model> needs --base-url (an OpenAI-compatible server)"); })()), ...(env.OIKOS_LOCAL_CONTEXT ? { contextTokens: Number(env.OIKOS_LOCAL_CONTEXT) } : {}), timeoutMs: 900_000 })
    : provider === "ollama" ? new OpenAICompatibleAdapter("ollama", model, { baseUrl: o.baseUrl ?? "http://localhost:11434/v1" })
    : provider === "local" ? new OpenAICompatibleAdapter("local", model, { baseUrl: o.baseUrl ?? (() => { throw new Error("local/<model> needs --base-url (an OpenAI-compatible server)"); })() })
    : (() => { throw new Error(`unknown provider "${provider}": anthropic, openai, openai-compat, codex, claude-code, ollama or local`); })();
  return { adapter, prices, ...(budget ? { budget } : {}) };
}
