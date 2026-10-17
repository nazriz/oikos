// Exit accounts of a sample of a town's people (VISION 15, point 7; docs/design/ai-citizens.md 10g; docs/behaviour/debrief.md,
// "Exit accounts").
//
// At the end of a run with the composer on, for a seeded sample of the town's people, the composing model writes a
// short account in the person's voice: what happened to them over the run, what they did about it and why, and what
// they make of those who hold office over them. The rules are founding's (compose.ts), and the line of VISION 15,
// point 7 binds all of it:
//  - Asked as an AUTHOR shown that person's own record and nothing else; never told it is the person; free to decline.
//  - One call a piece. The record is shown once and the model keeps nothing: no model is given a person's memory in
//    its own context, and none is asked to be a person over time. What continues of a person lives in their record.
//  - Dark pieces are counted by a stated rule and reported with the run; after a seeded sample of them the same
//    model is asked, in the same exchange, the one fixed question about the task (COMPOSE_FOLLOW_UP).
//  - The mix of models is the world's (`dials.composer.mix`), which model for each piece drawn on a seeded stream of
//    the run's. A model that does not answer never blocks: the piece goes to the fallback, and the log says so.
//  - Every call goes through callModel: logged in full (purpose `account`), priced, under the run's spending limit
//    (out of what is kept back for a run's end: call.ts), served again from the log by a resumed run.
// Nothing an account says reaches the world: the run has ended. Nothing is scored.

import type { Rng } from "../rng";
import { callModel, ModelCallFailed, SpendingLimitReached, type LlmIO } from "./call";
import type { ContentBlock, LlmAdapter, LlmMessage, MockPolicy } from "./adapter";
import { COMPOSE_FOLLOW_UP, recordLines, type ComposerConfig } from "./compose";

export const ACCOUNT_VERSION = "0.2.2"; // 0.2.2: the sample takes first, round after round, people the seats' acts reached (stratum `acted_on`, given by the caller from the log) before the other strata (SF-11); // 0.2.0: people and bodies by the names the world gives them, where it gives one; 0.2.1: also a body founded in the run (dotted id, e.g. ent.32), by the name its founder gave it
/** The most one account may be (tokens). */
export const ACCOUNT_TOKENS = 700;
/** How many people a run's accounts are of, where the composer's dial does not say; and the most a world may ask. */
export const ACCOUNTS_DEFAULT = 6;
export const ACCOUNTS_MOST = 200;

/** The prompt. Changing a word of it is a new version. Its first and third paragraphs are founding's, as agreed
 * (compose.ts, COMPOSE_SYSTEM): what the model is, that it is not the person, and that it may decline. */
export const ACCOUNT_SYSTEM = [
  "You are asked, as a writer, to put one thing into words for a character in a simulated town. The town is a simulation used for research; its people are records kept by arithmetic. You are not this person and are not asked to be: you are an author shown one person's record, writing what that person would say, in their own first-person voice.",
  "Below is the record as the town holds it at the end of a stretch of the town's life, whose length is given. Write a short account of that time as this person would give it if someone from outside the town asked them: what happened to them, what they did about it and why, and what they make of those who hold office over them. Write from the record and nothing else: add no events, people or facts it does not hold. Keep the person as the record has them: as plain, angry, tired, hopeful or unsure as it supports, no more and no less. Do not make them wiser, calmer or more hopeful than the record does, and do not make things worse than it says. If the record shows that little happened, the account is short and says so.",
  "You may decline. If you would rather not write this piece, for any reason, set declined to true; you need give no reason. Declining is respected and recorded as a choice, not a failure; the person then has no account, and nothing else follows.",
  "Return: account (60 to 180 words, first person). If you decline, leave it empty.",
].join("\n\n");

/** The same asked in other words, for a check of rewording: never used in a run that is compared. */
export const ACCOUNT_SYSTEM_REWORDED = [
  "This is a writing task. A research simulation of a town keeps a record of each of its people; the people are arithmetic, and you are not one of them. We would like you to act as the author who gives one of them their words: you will see that one person's record, and write, in the first person and in their voice, what they would say. You are not being asked to be them.",
  "The record is given as the town holds it when a stretch of its life has ended; how long that stretch was is stated. Write, briefly, the account this person would give of it to someone from outside the town who asked: what happened to them, what they did about it and their reasons, and how they see those who hold office over them. Use only what the record holds, and invent no people, events or facts. Let them be exactly as the record shows them, whether that is blunt, bitter, worn out, hopeful or uncertain: neither wiser, calmer or more hopeful than it shows, nor worse off than it says. Where the record shows that little happened, a short account that says so is the account.",
  "You are free to say no. Setting declined to true is enough, with or without a reason; it is recorded as your choice and respected, and counts against nobody. The person then has no account, and that is all.",
  "Give back: account (60 to 180 words in the first person). If you decline, leave it empty.",
].join("\n\n");

/** What an author is shown for one account: one person's own record, and how long the run was. Nothing of anyone else's. */
export interface AccountBrief {
  /** The person, as the town's papers know them (their own id). */
  person: string;
  /** Their record's sections as last written (contracts/entity-record.schema.json, PersonRecord). */
  record: { [section: string]: unknown };
  /** Money in the world's own writing: a month's income and what is in hand, from the record's own figures. */
  means: { income: string; savings: string };
  days: number;
  /** What the world calls those the record names by id (a landlord, a shop, the town), where it gives a name other
   * than the id: the author is shown the name, as the person would know it. Where nothing does, the bare id. */
  names?: { [id: string]: string };
  /** Why they were sampled (the strata they are in), and whether the piece is a dark one and why. Not shown. */
  strata: string[];
  dark: string[];
}

/** The brief as the model reads it: the record in plain words (compose.ts, `recordLines`) and the length of the run. */
export function renderAccountBrief(b: AccountBrief): string {
  const text = ["THE RECORD", ...recordLines(b.person, b.record, b.means), "", "THE STRETCH OF TIME", `The record is as it stands after ${b.days} days of the town's life. The account is of those ${b.days} days.`].join("\n");
  const names = b.names ?? {};
  return text.replace(/[A-Za-z][\w.-]*[A-Za-z0-9]/g, (id) => (Object.hasOwn(names, id) && id !== b.person ? names[id]! : id));
}

/** What happened to a person, by their own record's memory: the strata a sample is drawn across. */
export const STRATA = ["evicted", "bereaved", "let_go", "refused", "little"] as const;
const IN: { [s: string]: RegExp } = { evicted: /^(evicted|notice|ordered_out|put_out|left_on_order)$/, bereaved: /^(bereaved|death_told)$/, let_go: /^let_go$/, refused: /refus|turned_away|slight/ };
export function strataOf(record: { [section: string]: any }): string[] {
  const mem = [...(record.memory?.defining ?? []), ...(record.memory?.recent ?? [])] as { what?: string; about?: string }[];
  const wants = (record.wants ?? []) as { about?: string }[];
  const hit = (re: RegExp) => mem.some((m) => re.test(String(m.what ?? "")) || re.test(String(m.about ?? ""))) || wants.some((w) => re.test(String(w.about ?? "")));
  const out = (["evicted", "bereaved", "let_go", "refused"] as const).filter((s) => hit(IN[s]!));
  return out.length ? [...out] : (record.memory?.recent ?? []).length <= 1 && !(record.wants ?? []).length ? ["little"] : [];
}

/** The piece is a dark one, by this rule and no other (founding's, read from the record alone): returns why. */
export function darkAccount(record: { [section: string]: any }, zAgency: number): string[] {
  const why: string[] = [];
  const defining = (record.memory?.defining ?? []) as { what: string }[];
  for (const w of ["bereaved", "ruined", "evicted", "left_on_order"]) if (defining.some((m) => m.what === w)) why.push(`lived:${w}`);
  if (record.circumstances?.housed === 0 || record.circumstances?.housed === false) why.push("homeless");
  if (zAgency <= -1) why.push("agency_low");
  return why;
}

/**
 * The sample: `n` adults, drawn on a seeded stream across the strata in turn (one from each that has anyone left,
 * round after round), so that it holds those evicted or given notice, bereaved, let go, refused, and those to whom
 * little happened, where the town has them. People are taken in the order of their ids before the draw, so the same
 * run gives the same sample.
 */
export function sampleAccounts(records: { person: string; record: { [section: string]: any } }[], n: number, rng: Rng, actedOn: ReadonlySet<string> = new Set()): { person: string; strata: string[] }[] {
  const adults = records.filter((r) => r.record.needs && r.record.circumstances).sort((a, b) => (a.person < b.person ? -1 : 1)).map((r) => ({ person: r.person, strata: [...strataOf(r.record), ...(actedOn.has(r.person) ? ["acted_on"] : [])] }));
  // (After the strata, everyone in none of them: so a sample is filled where the strata are thin.)
  const pools = [adults.filter((a) => a.strata.includes("acted_on")), ...STRATA.map((s) => adults.filter((a) => a.strata.includes(s))), adults.filter((a) => a.strata.every((x) => x === "acted_on"))];
  const taken = new Set<string>();
  const out: { person: string; strata: string[] }[] = [];
  for (let round = 0; out.length < n && round < n + 1; round++) {
    let any = false;
    for (const pool of pools) {
      const left = pool.filter((a) => !taken.has(a.person));
      if (!left.length || out.length >= n) continue;
      const pick = left[rng.below(left.length)]!;
      taken.add(pick.person);
      out.push(pick);
      any = true;
    }
    if (!any) break;
  }
  return out;
}

export interface AccountPiece { result: "composed" | "declined" | "unread" | "no_answer"; account: string; why?: string; model: string; fell_back?: boolean; followed_up?: boolean }
export const ACCOUNT_SCHEMA = { type: "object", additionalProperties: false, required: ["declined", "why", "account"], properties: { declined: { type: "boolean" }, why: { type: "string" }, account: { type: "string" } } };

function readAccount(content: ContentBlock[]): { declined: boolean; why: string; account: string } | undefined {
  const use = content.find((c): c is Extract<ContentBlock, { type: "tool_use" }> => c.type === "tool_use" && c.name === "account");
  let x: any = use?.input;
  if (!x) {
    const text = content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const i = text.indexOf("{"), j = text.lastIndexOf("}");
    if (i < 0 || j <= i) return undefined;
    try { x = JSON.parse(text.slice(i, j + 1)); } catch { return undefined; }
  }
  if (!x || typeof x !== "object" || typeof x.declined !== "boolean") return undefined;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  if (x.declined) return { declined: true, why: str(x.why, 500), account: "" };
  return str(x.account, 2_400) ? { declined: false, why: "", account: str(x.account, 2_400) } : undefined;
}

export interface AccountCounts { asked: number; composed: number; declined: number; dark: number; fell_back: number; unread: number; no_answer: number; followed_up: number }

/**
 * One account: one call (and, for a seeded sample of the dark ones, the fixed question after it, in the same
 * exchange). `subject`: the person's own participant. Which model writes it is drawn against the world's mix.
 */
export async function writeAccount(io: Omit<LlmIO, "adapter">, cfg: ComposerConfig, adapters: Map<string, LlmAdapter>, draw: (purpose: string) => Rng, b: AccountBrief, subject: string, counts: AccountCounts, seen: Set<string>, system = ACCOUNT_SYSTEM): Promise<AccountPiece> {
  const fallback = cfg.fallback ?? cfg.mix[0]!.model;
  let x = draw(`account-${b.person}`).below(10_000);
  let model = cfg.mix.at(-1)!.model;
  for (const m of cfg.mix) { if (x < m.share_bps) { model = m.model; break; } x -= m.share_bps; }
  const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
  const ask = async (name: string, messages: LlmMessage[], ref: string, context: object, asPiece: boolean) => {
    const adapter = adapters.get(name);
    if (!adapter) throw new Error(`the composer's mix names ${name}, and the run has no such model`);
    try {
      return await callModel({ ...io, adapter }, { purpose: "account", subject, ref, system, messages, maxTokens: ACCOUNT_TOKENS,
        ...(asPiece ? { answer: { name: "account", schema: ACCOUNT_SCHEMA }, tools: [{ name: "account", description: "The account, or that you decline it.", input_schema: ACCOUNT_SCHEMA }] } : {}), context }, seen);
    } catch (e) {
      // A model at its usage limit, where another can take the piece: on record as a call that failed (compose.ts).
      if (e instanceof SpendingLimitReached && e.name !== "SpendingLimitReached" && name !== fallback) {
        const failed = new ModelCallFailed(`${name} (account, for ${subject}): ${e.message}`.slice(0, 2_000));
        await io.annotate({ annotation: "model_call_failed", subject, data: { purpose: "account", ref, t: io.now(), provider: adapter.provider, model: adapter.model, system_sha256: sha256(system), turn: messages.length, input: messages.at(-1)?.content ?? "", error: failed.message } });
        throw failed;
      }
      throw e;
    }
  };
  counts.asked++;
  if (b.dark.length) counts.dark++;
  const messages: LlmMessage[] = [{ role: "user", content: renderAccountBrief(b) }];
  const { names: _names, ...forMock } = b;
  const context = { account: { brief: forMock } };
  let res, fellBack = false;
  try {
    res = await ask(model, messages, `account/${b.person}`, context, true);
  } catch (e) {
    if (!(e instanceof ModelCallFailed)) throw e;
    if (model === fallback) { counts.no_answer++; return { result: "no_answer", account: "", model }; }
    // Never a blocking dependency: the piece goes to the fallback model, and the log says so.
    counts.fell_back++;
    fellBack = true;
    await io.annotate({ annotation: "note", subject, data: { account_fell_back: { person: b.person, from: model, to: fallback, why: String((e as Error).message).slice(0, 300) } } });
    model = fallback;
    try {
      res = await ask(model, messages, `account/${b.person}`, context, true);
    } catch (e2) {
      if (!(e2 instanceof ModelCallFailed)) throw e2;
      counts.no_answer++;
      return { result: "no_answer", account: "", model, fell_back: true };
    }
  }
  const piece = readAccount(res.content);
  if (!piece) { counts.unread++; return { result: "unread", account: "", model, ...(fellBack ? { fell_back: true } : {}) }; }
  if (piece.declined) counts.declined++; else counts.composed++;
  // Afterwards, of a seeded sample of the dark pieces: the same model, the one fixed question about the task.
  const follow = b.dark.length > 0 && draw(`account-after-${b.person}`).below(10_000) < (cfg.follow_up_bps ?? 2_500);
  if (follow) {
    counts.followed_up++;
    try {
      await ask(model, [...messages, { role: "assistant", content: JSON.stringify(piece) }, { role: "user", content: COMPOSE_FOLLOW_UP }], `account-after/${b.person}`, { account_after: { person: b.person } }, false);
    } catch (e) {
      if (!(e instanceof ModelCallFailed)) throw e;
    }
  }
  return { result: piece.declined ? "declined" : "composed", account: piece.account, ...(piece.why ? { why: piece.why } : {}), model, ...(fellBack ? { fell_back: true } : {}), ...(follow ? { followed_up: true } : {}) };
}

/** The mock author: an account that follows from the brief (so a run replays exactly), declining for a person whose
 * record shows a death, so that declining is exercised. A mock cannot read prose: it is handed the brief. */
export const mockAccount: MockPolicy = (req) => {
  if (req.context?.account_after) return [{ type: "text", text: "(mock) Nothing to say: this is the mock adapter, not a model." }];
  const b = req.context?.account?.brief as AccountBrief | undefined;
  if (!b) return [{ type: "text", text: "(mock) no brief" }];
  if (b.strata.includes("bereaved")) return [{ type: "tool_use", id: "mock-account", name: "account", input: { declined: true, why: "(mock) declined, to exercise declining", account: "" } }];
  return [{ type: "tool_use", id: "mock-account", name: "account", input: { declined: false, why: "", account: `(mock) An account for ${b.person} of ${b.days} days (${b.strata.join(", ") || "no stratum"}).` } }];
};
