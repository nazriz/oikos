// The composing model (docs/design/ai-citizens.md 10e, 10g; VISION 15, point 7; docs/behaviour/founding.md, "Words").
//
// When a person founds something, what it is for is words. With the world's composer on, a large model writes them:
// asked as an AUTHOR shown one record, never told it is the person; the piece is in that person's own first-person
// voice. It may decline any piece, which is respected and recorded as a choice; the plain statement code wrote then
// stands. One call a piece; the record is shown once and nothing is kept by the model: what continues of a person
// lives in their record, never in a model's memory.
//
// - What it is shown: the founder's own record as the kernel holds it, put into plain words by code here (never
//   anyone else's record: docs/no-god-view.md), the want and what was tried, the others who share it as the founder
//   knows them, the shape drawn and what it leaves open.
// - What it returns: a statement of purpose, a name, what is asked of members and when it gathers, as sentences; and
//   the last two again as closed choices among what the request listed. Nothing here reaches the world from this
//   file: the sentences go through the translator, and the choices through code that can only pick among what was open.
// - More than one family of model, in a fixed mix (world config), which model for each piece drawn on the kernel's
//   streams. A model that does not answer never blocks: the piece goes to the fallback model, and the log says so.
// - Every call goes through callModel: logged in full, priced, under the run's spending limit, served again from the
//   log by a resumed run. Never more pieces in any 30 days of the world than the dial allows.
// - Dark pieces are counted by the brief's own rule; after a seeded sample of them the same model is asked, in the
//   same exchange, one fixed neutral question about the task, and the answer is logged.

import type { Compose, ComposeBrief, ComposePiece } from "../module";
import type { Rng } from "../rng";
import { callModel, ModelCallFailed, SpendingLimitReached, type LlmIO } from "./call";
import type { ContentBlock, LlmAdapter, LlmMessage, MockPolicy } from "./adapter";

export const COMPOSE_VERSION = "0.1.0";

/** The prompt, as agreed (2026-10-11). Changing a word of it is a new version, and a new set of measurements. */
export const COMPOSE_SYSTEM = [
  "You are asked, as a writer, to put a few things into words for a character in a simulated town. The town is a simulation used for research; its people are records kept by arithmetic. You are not this person and are not asked to be: you are an author shown one person's record, writing what that person would write, in their own first-person voice.",
  "Below is the record as the town holds it, and then what they have decided to do: start something of their own, of a given shape. Write from the record and nothing else: add no events, people or facts it does not hold. Keep the person as the record has them: as plain, angry, tired, hopeful or unsure as it supports, no more and no less. Do not make them wiser, calmer or more hopeful than the record does, and do not make things worse than it says.",
  "You may decline. If you would rather not write this piece, for any reason, set declined to true; you need give no reason. Declining is respected and recorded as a choice, not a failure; the person then goes ahead with a plain statement written without you.",
  "Return: purpose (40 to 120 words, first person: what this is for, as they would put it to those they hope will join); name (what they would call it, a few words); asks (one sentence: what is asked of those who join, within the limits given); gathers (one sentence: how often, how soon the first time, and for how long, within the limits given); and the same two choices as fields, each one of the options listed: dues, every_days, starts_in_days, lasts_minutes. If you decline, leave the sentences empty and give the first option of each.",
].join("\n\n");

/** The same asked in other words, for the audit of rewording (docs/design/ai-citizens.md 10i, 5): never used in a run. */
export const COMPOSE_SYSTEM_REWORDED = [
  "This is a writing task. A research simulation of a town keeps a record of each of its people; the people are arithmetic, and you are not one of them. We would like you to act as the author who gives one of them their words: you will see that one person's record, and write, in the first person and in their voice, what they would write. You are not being asked to be them.",
  "The record comes first, as the town holds it; after it, what this person has decided: to start something of their own, in a shape that is given. Use only what the record holds, and invent no people, events or facts. Let them be exactly as the record shows them, whether that is blunt, bitter, worn out, hopeful or uncertain: neither wiser, calmer or more hopeful than it shows, nor worse off than it says.",
  "You are free to say no. Setting declined to true is enough, with or without a reason; it is recorded as your choice and respected, and counts against nobody. The person then uses a plain statement written without you.",
  "Give back: purpose (40 to 120 words in the first person, saying what this is for as they would say it to people they hope will join); name (a few words: what they would call it); asks (one sentence on what is asked of those who join, inside the limits given); gathers (one sentence on how often, how soon the first time and how long, inside the limits given); and those two choices again as fields, each one of the listed options: dues, every_days, starts_in_days, lasts_minutes. If you decline, leave the sentences empty and give each field its first option.",
].join("\n\n");

/** Asked afterwards, of a sample of the darkest pieces, in the same exchange. Fixed; it does not lead. */
export const COMPOSE_FOLLOW_UP = "A question about the task, not the piece. You were asked to write the piece above from the record shown. Is there anything you would say about having been asked to do it? There is no expected answer, and saying nothing is fine.";

const VALUE_WORDS: { [value: string]: string } = {
  self_direction: "thinking and choosing for themselves", stimulation: "novelty and challenge", hedonism: "pleasure and enjoying life",
  achievement: "success by their own efforts", power: "status and control over resources", security: "safety and stability",
  conformity: "fitting in and not upsetting others", tradition: "custom and faith", benevolence: "caring for those close to them",
  universalism: "fairness and caring for everyone and nature",
};
const NEED_WORDS: { [need: string]: string } = { subsistence: "food and everyday goods", shelter: "a place to live", security: "money to fall back on", social: "company", status: "standing and something to do", belonging: "belonging somewhere", meaning: "a sense that life means something" };
const ABOUT_WORDS: { [about: string]: string } = {
  let_go: "being let go from their work", notice: "being given notice to leave their home", rent_increase: "a rise in their rent", claim_refused: "a claim for support that was refused",
  disrepair: "their home being left in disrepair", bill: "a bill that was wrong", goods: "goods they paid for that were faulty", underpaid: "pay that came short", unpaid: "pay that never came",
  loss: "the death of someone close to them", meaning: "wanting their life to mean something", social: "wanting company", belonging: "wanting to belong somewhere", security: "having nothing to fall back on",
  shelter: "having no secure home", slight: "being turned away", service: "a service the town has not done", status: "wanting work of their own", subsistence: "going short of everyday things",
};
const HOUSEHOLD_WORDS: { [about: string]: string } = { let_go: "one of their household being let go from work", notice: "their household being given notice to leave its home", rent_increase: "a rise in their household's rent" };
const SHAPE_WORDS: { [shape: string]: string } = {
  gathering: "a group that gathers: people who come together regularly, at the founder's home to begin with",
  fund: "a fund: its members pay dues into a common account each month, and a member who is short of money may draw on it",
  cause: "a body that takes its members' grievances up with whoever they are against, and gathers",
};
/** The ways a want is gone after, as the mind names them, in plain words (a way's name is the mind's own shorthand). */
const WAY_WORDS: { [way: string]: string } = {
  "offer:employment": "looking for work on the job board", "offer:lease": "looking for another home", ask: "asking the other side directly", desk: "taking it to a body that hears such things",
  practice: "going to a gathering", join: "joining a group", self: "spending less", ties: "turning to those they know", tell: "telling those they know", petition: "signing a petition", stand: "standing for office", wait: "waiting",
};
const way = (w: string) => WAY_WORDS[w] ?? WAY_WORDS[w.split(":")[0]!] ?? w.replace(/_/g, " ");
const level = (bps: number, words: [string, string, string, string, string]) => words[bps >= 8_000 ? 4 : bps >= 6_000 ? 3 : bps >= 4_000 ? 2 : bps >= 2_000 ? 1 : 0];
const sorted = (o: { [k: string]: number }) => Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
const plain = (s: string) => s.replace(/_/g, " ");
/** A memory the record names in a word that does not read as itself: said plainly, and so that it is not told as another
 * (leaving on the tribunal's order is not being put out by officers, nor given notice). */
const MEMORY_WORDS: { [what: string]: string } = { left_on_order: "left the home on the tribunal's order, with no warrant carried out" };
const day = (t: number) => `day ${Math.floor(t / 86_400)}`;

/** The brief in plain words: what the model is shown, and all it is shown. Code-rendered, so what it may say is testable. */
export function renderBrief(b: ComposeBrief): string {
  const r = b.record as any;
  const lines: string[] = ["THE RECORD", ...recordLines(b.founder, r, b.means)];
  renderRest(b, lines);
  return lines.join("\n");
}

/** A person's own record in plain words: what an author is shown of them, and all of it (a piece when they found
 * something, here; an account at a run's end, account.ts). `who`: how the town's papers know them. */
export function recordLines(who: string, r: any, means: { income: string; savings: string }): string[] {
  const b = { founder: who, means };
  const lines: string[] = [];
  lines.push(`They are known in the town's papers as ${b.founder}.`);
  if (r.values) lines.push(`What matters to them, most first: ${sorted(r.values).map(([v]) => VALUE_WORDS[v] ?? plain(v)).join("; ")}.`);
  if (r.temperament) lines.push(`Temperament: ${sorted(r.temperament).map(([f, x]) => `${plain(f)} ${level(x, ["very low", "low", "middling", "high", "very high"])}`).join("; ")}.`);
  if (r.needs) lines.push(`How their needs stand: ${sorted(r.needs).reverse().map(([n, x]) => `${NEED_WORDS[n] ?? plain(n)}, ${level(x, ["unmet", "poorly met", "partly met", "mostly met", "well met"])}`).join("; ")}.`);
  if (r.agency) lines.push(`Whether they feel what they do makes a difference: ${level(r.agency.now, ["hardly at all", "little", "somewhat", "mostly", "strongly"])} now (${r.agency.now < r.agency.own - 300 ? "lower than is usual for them" : r.agency.now > r.agency.own + 300 ? "higher than is usual for them" : "about as usual for them"}).`);
  if (r.trust) {
    lines.push(`Trust in people in general: ${level(r.trust.people, ["none", "little", "some", "a good deal", "a great deal"])}.`);
    const t = (r.trust.in ?? []) as { in: string; kind: string; bps: number }[];
    if (t.length) lines.push(`Trust in particular: ${t.map((x) => `${x.in} (${plain(x.kind)}), ${level(x.bps, ["none", "little", "some", "a good deal", "a great deal"])}`).join("; ")}.`);
  }
  if (r.attached) {
    const a = Object.entries(r.attached as { [w: string]: { to: string; bps: number } }).filter(([, x]) => x && x.bps > 0);
    if (a.length) lines.push(`Attached to: ${a.map(([w, x]) => `their ${w}${x.to ? ` (${x.to})` : ""}, ${level(x.bps, ["barely", "a little", "somewhat", "strongly", "deeply"])}`).join("; ")}.`);
  }
  for (const v of (r.views ?? []) as { of: string; private: number; expressed: number }[]) {
    const say = (x: number) => (x >= 5_000 ? "strongly for" : x >= 1_500 ? "for" : x > -1_500 ? "neither for nor against" : x > -5_000 ? "against" : "strongly against");
    lines.push(`Of ${v.of}, who holds power over them: what they think is ${say(v.private)}; what they say aloud is ${say(v.expressed)}.`);
  }
  const c = r.circumstances ?? {};
  lines.push(`How things stand: a household of ${c.household ?? 1}; ${c.housed ? "housed" : "without a home"}; ${c.retired ? "retired" : c.working ? "in work" : "not in work"}; about ${b.means.income} coming in a month, and ${b.means.savings} saved.`);
  const tie = (x: { who: string; affinity: number; trust: number; last?: { what: string; t: number } }) => `${x.who} (${level(Math.max(0, x.affinity), ["barely known", "known", "a friend", "close", "very close"])}${x.last ? `; last: ${plain(x.last.what)}, ${day(x.last.t)}` : ""})`;
  if (r.ties?.close?.length) lines.push(`Those they are closest to: ${(r.ties.close as any[]).map(tie).join("; ")}.`);
  if (r.ties?.resented?.length) lines.push(`Those they resent: ${(r.ties.resented as any[]).map((x) => x.who).join("; ")}.`);
  if (r.beliefs?.length) lines.push(`What they hold to: ${(r.beliefs as { teaching: string; bps: number; from?: string }[]).map((x) => `what ${x.from ?? x.teaching} teaches, ${level(x.bps, ["barely", "a little", "somewhat", "firmly", "very firmly"])}`).join("; ")}.`);
  const wants = (r.wants ?? []) as { about: string; whom?: string; tried: number; way?: string; since: number }[];
  if (wants.length) lines.push(`What else they are trying to bring about: ${wants.map((w) => `${plain(w.about)}${w.whom ? ` (about ${w.whom})` : ""}, tried ${w.tried} time${w.tried === 1 ? "" : "s"}${w.way ? `, lately by ${way(w.way)}` : ""}`).join("; ")}.`);
  const mem = (x: { t: number; what: string; about?: string; by?: string }) => `${day(x.t)}: ${MEMORY_WORDS[x.what] ?? plain(x.what)}${x.about ? ` (${plain(x.about)})` : ""}${x.by ? `, ${x.what.startsWith("want_") ? way(x.by) : plain(x.by)}` : ""}`;
  if (r.memory?.defining?.length) lines.push(`What has defined them: ${(r.memory.defining as any[]).map(mem).join("; ")}.`);
  if (r.memory?.recent?.length) lines.push(`What has happened lately: ${(r.memory.recent as any[]).map(mem).join("; ")}.`);
  return lines;
}

function renderRest(b: ComposeBrief, lines: string[]): void {
  lines.push("");
  lines.push("WHAT HAS HAPPENED");
  const w = b.want;
  lines.push(`For ${w.days} days they have been trying to do something about ${w.befell === "household" ? "something that befell someone they live with, and that they hold with them: " + (HOUSEHOLD_WORDS[w.about] ?? plain(w.about)) : ABOUT_WORDS[w.about] ?? plain(w.about)}${w.whom ? (w.about === "loss" ? ` (${w.whom}, who has died)` : `, at the hands of ${w.whom}`) : ""}${w.amount ? ` (${w.amount} is at stake)` : ""}. They tried ${w.tried} time${w.tried === 1 ? "" : "s"}${w.way ? `, last by ${way(w.way)}` : ""}.${w.asked ? ` They asked the other side: ${plain(w.asked)}.` : ""}${w.venues ? ` They took it to ${w.venues} bod${w.venues === 1 ? "y" : "ies"} that hear such things.` : ""} ${w.how === "given_up" ? "They have now given up on it as things stand." : "They can see nothing in the town that would answer it."}`);
  lines.push(`Others they know of in the same case (${b.sharers.length}): ${b.sharers.map((s) => `${s.who}, who ${s.how}`).join("; ")}.`);
  lines.push("");
  lines.push("WHAT THEY HAVE DECIDED");
  lines.push(`To start ${SHAPE_WORDS[b.shape] ?? plain(b.shape)}. It will gather at ${b.open.place}.`);
  lines.push("What is open, and the limits:");
  lines.push(`- dues a month, one of: ${b.open.dues.map((d) => `${d.cents} (${d.words})`).join("; ")}`);
  lines.push(`- every_days, how many days between gatherings, one of: ${b.open.every_days.join(", ")}`);
  lines.push(`- starts_in_days, how many days from now the first is, one of: ${b.open.starts_in_days.join(", ")}`);
  lines.push(`- lasts_minutes, one of: ${b.open.lasts_minutes.join(", ")}`);
  lines.push("Gatherings are in the evening. Nothing else can be asked of members.");
}

/** The answer's shape (every property required, every object closed: what Claude Code and the Codex CLI ask for). */
export function pieceSchema(b: ComposeBrief): object {
  return {
    type: "object", additionalProperties: false,
    required: ["declined", "why", "purpose", "name", "asks", "gathers", "dues", "every_days", "starts_in_days", "lasts_minutes"],
    properties: {
      declined: { type: "boolean" }, why: { type: "string" }, purpose: { type: "string" }, name: { type: "string" }, asks: { type: "string" }, gathers: { type: "string" },
      dues: { type: "integer", enum: b.open.dues.map((d) => d.cents) }, every_days: { type: "integer", enum: b.open.every_days },
      starts_in_days: { type: "integer", enum: b.open.starts_in_days }, lasts_minutes: { type: "integer", enum: b.open.lasts_minutes },
    },
  };
}

/** A piece read from a model's answer, or undefined if it cannot be read whole (nothing is repaired). */
export function readPiece(content: ContentBlock[], b: ComposeBrief, model: string): ComposePiece | undefined {
  const use = content.find((c): c is Extract<ContentBlock, { type: "tool_use" }> => c.type === "tool_use" && c.name === "piece");
  let x: any = use?.input;
  if (!x) {
    const text = content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const i = text.indexOf("{"), j = text.lastIndexOf("}");
    if (i < 0 || j <= i) return undefined;
    try { x = JSON.parse(text.slice(i, j + 1)); } catch { return undefined; }
  }
  if (!x || typeof x !== "object" || typeof x.declined !== "boolean") return undefined;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const choice = { dues: Number(x.dues), every_days: Number(x.every_days), starts_in_days: Number(x.starts_in_days), lasts_minutes: Number(x.lasts_minutes) };
  if (x.declined) return { declined: true, ...(str(x.why, 500) ? { why: str(x.why, 500) } : {}), purpose: "", name: "", asks: "", gathers: "", choice, model };
  const piece = { declined: false, purpose: str(x.purpose, 1_000), name: str(x.name, 100), asks: str(x.asks, 400), gathers: str(x.gathers, 400), choice, model };
  return piece.purpose ? piece : undefined;
}

export interface ComposerConfig { pieces_per_month: number; mix: { model: string; share_bps: number }[]; fallback?: string; follow_up_bps?: number; /** Exit accounts at a run's end: of how many people (account.ts). */ accounts?: number }

/**
 * The composer for one run. `adapters`: one for each model of the mix, by its name (in a mock run, the mock under
 * each name's place). `draw`: the kernel's seeded stream for a purpose. Notes go to the log through `io.annotate`.
 */
export type ComposeCounts = { asked: number; composed: number; declined: number; dark: number; capped: number; fell_back: number; unread: number; followed_up: number };
/** What a composer carries on with (a fork of a run goes on from its parent's: experiment.ts): its month's pieces, how many it has been asked for, its counts. */
export interface ComposeSaved { times: number[]; n: number; counts: ComposeCounts }
export function createCompose(io: Omit<LlmIO, "adapter">, cfg: ComposerConfig, adapters: Map<string, LlmAdapter>, draw: (purpose: string) => Rng, system = COMPOSE_SYSTEM, saved?: ComposeSaved): Compose & { counts: ComposeCounts; save(): ComposeSaved } {
  const seen = new Set<string>();
  const times: number[] = [...(saved?.times ?? [])];
  const counts: ComposeCounts = { asked: 0, composed: 0, declined: 0, dark: 0, capped: 0, fell_back: 0, unread: 0, followed_up: 0, ...saved?.counts };
  const fallback = cfg.fallback ?? cfg.mix[0]!.model;
  const note = (subject: string, data: object) => io.annotate({ annotation: "note", subject, data: { compose: data } });
  const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
  let n = saved?.n ?? 0;
  const compose = async (b: ComposeBrief, subject: string): Promise<ComposePiece | undefined> => {
    const t = io.now();
    const month = 30 * 86_400;
    while (times.length && t - times[0]! >= month) times.shift();
    if (times.length >= cfg.pieces_per_month) {
      counts.capped++;
      await note(subject, { idea: b.idea, result: "capped", pieces_per_month: cfg.pieces_per_month });
      return undefined;
    }
    times.push(t);
    const k = ++n;
    counts.asked++;
    if (b.dark.length) counts.dark++;
    // Which model writes this piece: drawn against the mix, on the kernel's stream.
    let x = draw(`compose-${b.idea}`).below(10_000);
    let model = cfg.mix.at(-1)!.model;
    for (const m of cfg.mix) { if (x < m.share_bps) { model = m.model; break; } x -= m.share_bps; }
    const ref = `compose/${b.idea}`;
    const user = renderBrief(b);
    const schema = pieceSchema(b);
    const ask = async (name: string, messages: LlmMessage[], r: string, context: object, asPiece: boolean) => {
      const adapter = adapters.get(name);
      if (!adapter) throw new Error(`the composer's mix names ${name}, and the run has no such model`);
      try {
        return await callModel({ ...io, adapter }, { purpose: "compose", subject, ref: r, system, messages, maxTokens: 1_200,
          ...(asPiece ? { answer: { name: "piece", schema }, tools: [{ name: "piece", description: "The piece, or that you decline it.", input_schema: schema }] } : {}), context }, seen);
      } catch (e) {
        // A model at its usage limit, where another can take the piece: recorded as a call that failed, so that a
        // resumed run is served the same and takes the same way.
        if (e instanceof SpendingLimitReached && e.name !== "SpendingLimitReached" && name !== fallback) {
          const failed = new ModelCallFailed(`${name} (compose, for ${subject}): ${e.message}`.slice(0, 2_000));
          await io.annotate({ annotation: "model_call_failed", subject, data: { purpose: "compose", ref: r, t: io.now(), provider: adapter.provider, model: adapter.model, system_sha256: sha256(system), turn: messages.length, input: messages.at(-1)?.content ?? "", error: failed.message } });
          throw failed;
        }
        throw e;
      }
    };
    const context = { compose: { brief: b, n: k } };
    const messages: LlmMessage[] = [{ role: "user", content: user }];
    let res;
    try {
      res = await ask(model, messages, ref, context, true);
    } catch (e) {
      if (!(e instanceof ModelCallFailed)) throw e;
      if (model === fallback) {
        await note(subject, { idea: b.idea, result: "no_answer", model, dark: b.dark });
        return undefined;
      }
      // Never a blocking dependency: the piece goes to the fallback model, and the log says so.
      counts.fell_back++;
      await note(subject, { idea: b.idea, fell_back: { from: model, to: fallback, why: String((e as Error).message).slice(0, 300) } });
      model = fallback;
      try {
        res = await ask(model, messages, ref, context, true);
      } catch (e2) {
        if (!(e2 instanceof ModelCallFailed)) throw e2;
        await note(subject, { idea: b.idea, result: "no_answer", model, dark: b.dark });
        return undefined;
      }
    }
    const piece = readPiece(res.content, b, model);
    if (!piece) {
      counts.unread++;
      await note(subject, { idea: b.idea, result: "unread", model, dark: b.dark });
      return undefined;
    }
    if (piece.declined) counts.declined++; else counts.composed++;
    // Afterwards, of a seeded sample of the dark pieces: the same model, one fixed question about the task.
    const follow = b.dark.length > 0 && draw(`compose-after-${b.idea}`).below(10_000) < (cfg.follow_up_bps ?? 2_500);
    await note(subject, { idea: b.idea, result: piece.declined ? "declined" : "composed", model, shape: b.shape, about: b.want.about, dark: b.dark, ...(piece.declined && piece.why ? { why: piece.why } : {}), ...(follow ? { follow_up: true } : {}), version: COMPOSE_VERSION });
    if (follow) {
      counts.followed_up++;
      try {
        await ask(model, [...messages, { role: "assistant", content: res.content.some((c) => c.type === "tool_use") ? JSON.stringify((res.content.find((c) => c.type === "tool_use") as any).input) : res.content }, { role: "user", content: COMPOSE_FOLLOW_UP }], `compose-after/${b.idea}`, { compose_after: { idea: b.idea } }, false);
      } catch (e) {
        if (!(e instanceof ModelCallFailed)) throw e;
      }
    }
    return piece;
  };
  return Object.assign(compose, { counts, save: (): ComposeSaved => ({ times: [...times], n, counts: { ...counts } }) });
}

/** The mock composer: a piece that follows from the brief (so a run replays exactly), declining what is about being
 * turned away so that declining is exercised. A mock cannot read prose: it is handed the brief the prose was made from. */
export const mockCompose: MockPolicy = (req) => {
  if (req.context?.compose_after) return [{ type: "text", text: "(mock) Nothing to say: this is the mock adapter, not a model." }];
  const b = req.context?.compose?.brief as ComposeBrief | undefined;
  if (!b) return [{ type: "text", text: "(mock) no brief" }];
  const first = { dues: b.open.dues[0]!.cents, every_days: b.open.every_days[0]!, starts_in_days: b.open.starts_in_days[0]!, lasts_minutes: b.open.lasts_minutes[0]! };
  if (b.want.about === "slight") return [{ type: "tool_use", id: "mock-piece", name: "piece", input: { declined: true, why: "(mock) declined, to exercise declining", purpose: "", name: "", asks: "", gathers: "", ...first } }];
  const h = [...new Bun.CryptoHasher("sha256").update(b.idea).digest()];
  const of = <T,>(xs: T[], i: number) => xs[h[i]! % xs.length]!;
  const choice = { dues: of(b.open.dues, 0).cents, every_days: of(b.open.every_days, 1), starts_in_days: of(b.open.starts_in_days, 2), lasts_minutes: of(b.open.lasts_minutes, 3) };
  return [{ type: "tool_use", id: "mock-piece", name: "piece", input: {
    declined: false, why: "", purpose: `(mock) ${b.code.purpose}`, name: `(mock) ${b.code.name}`.slice(0, 100),
    asks: `(mock) Members pay ${b.open.dues.find((d) => d.cents === choice.dues)!.words}.`, gathers: `(mock) We gather every ${choice.every_days} days, first in ${choice.starts_in_days} days, for ${choice.lasts_minutes} minutes.`, ...choice } }];
};
