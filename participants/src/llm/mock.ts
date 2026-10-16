// Mock model policies, for building and testing everything around language
// models without calling one (D34; docs/design/translator-and-resolver.md).
//
// A mock participant has a code "brain": any behaviour module (by default the
// one the all-code control uses for that role, e.g. city.mayor_code), run in
// one of its capacities. Code modules act through calls; the mock participant
// says each call it wants as its request, the mock translator hands back that
// same call, and the mock participant confirms a
// draft only if its call is exactly what it asked for. So the whole loop runs
// (rendering, requests, translation, the resolver, the preview, the kernel's
// dry run, law warnings, confirmation, provenance, usage, transcripts,
// debriefs) and only language understanding is faked. A mock can't read
// prose, so it reads the request's structured context instead.

import { amountText, call, json, parseProgram, programText, secs, text, type Value } from "../calls";
import { slice, type LookRequest, type ParticipantAction } from "../contracts";
import { claimFieldsFor, fieldsFor, writeClaim, type FormData, type Paper } from "../forms";
import type { Controller, ParticipantContext } from "../module";
import { formatMoney, inCurrency, type Currency } from "../money";
import type { ContentBlock, LlmRequest, MockPolicy } from "./adapter";
import { mockCompose } from "./compose";
import { mockAccount } from "./account";
import { mockDebrief } from "./debrief";

export const MOCK_VERSION = "0.6.1"; // 0.6.1: a claim its brain records beside a paper is said on the form that records both, where the office has one; 0.6.0: back at its desk as often as its brain's own module looks in (it sat weekly whatever the office); a look the brain asks for while reading what it missed between sittings is made at the sitting (it was dropped, and the brain never asked again); 0.5.0: a paper the brain issues is asked for on the office's own form for it, where it has one; 0.4.0: a brain's looks are made through the seat's own look (asking a register, looking someone up, sending someone to a place)

export interface MockBrain {
  controller: Controller;
  ctx: ParticipantContext;
  /** The capacity the brain runs in ("self", or a position), and the entity it acts for there. */
  capacity: string;
  /** Chance (basis points) of declining a faithful draft anyway, to exercise declining. */
  rejectBps?: number;
  /** How often the brain's own module looks in (seconds): the mock is back at its desk as often, so that an office
   * held by the mock does its work on the days the same office run by code does (a clerk that sits weekly puts a
   * proposal to the vote a week late and counts it a week after it closed). Absent: the seat's own rhythm. */
  cadence?: number;
  /** Opt out at the first wake at or after this time (seconds), to exercise opting out. */
  optOutAt?: number;
  /** Sits as its code twin does: it says when it is back to the second, as the module asked (a code unit's own wait), not in days. */
  twin?: boolean;
  /** (A twin's) it has asked for a paper and not yet confirmed it. */
  busy?: boolean;
  /** Days it says it is back after, whatever its brain would: a seat that chooses to come back in a week, as real ones have. */
  backDays?: number;
}

const PREFIX = "(mock) ";

/**
 * A code brain's look, said as the seat's own look tool would take it (docs/design/knowing.md, section 9): a search
 * as what to find, a look-up of who's who as a name, a visit as the places to send someone. What the seat's tool has
 * no words for is left out (a search by time: the brain reads what comes back anyway).
 */
function lookAsTool(l: LookRequest, capacity: string): object {
  const report = capacity === "self" ? l.channel : `${capacity}/${l.channel}`;
  if (l.visit) return { report, named: l.visit.places };
  if (l.who) {
    const w = l.who as { entity?: string; participant?: string; position?: string; name?: string; role?: string };
    return { report, named: [w.role ?? w.name ?? w.position ?? w.participant ?? w.entity ?? ""] };
  }
  const find = (l.query?.where ?? []).filter((c) => c.field !== "at").map((c) => ({ field: c.field, op: c.op, value: c.value }));
  return { report, ...(find.length ? { find } : {}), ...(l.query?.limit ? { limit: l.query.limit } : {}), ...(l.query?.standing ? { current_only: true } : {}) };
}

/** A call's value as plain data. */
const plain = (v: Value | undefined): unknown => (v === undefined ? undefined : "id" in v ? v.id : "text" in v ? v.text : "json" in v ? v.json : undefined);

/**
 * A paper a code brain issues, said as a seat would say it: on the office's own form for it, where the office has one
 * that writes exactly that paper (docs/behaviour/office-papers.md). The brain makes a typed statement; a person in
 * the office fills in the form. A line is turned only if the form, filled in with what is worked out here, writes
 * the statement back to the letter (`fieldsFor` checks by writing it); anything else is said as the brain said it.
 */
export function onOwnForms(program: string, stationery: FormData[], o: { self: string; now: number; currency: Currency }): { program: string; turned: number; kept: string[] } {
  const p = parseProgram(program);
  if ("none" in p) return { program, turned: 0, kept: [] };
  let turned = 0;
  const kept: string[] = [];
  /** Lines the form says with its paper: a claim it records beside it (the permission a decision grants). */
  const folded = new Set<number>();
  const all = p.lines;
  const mapped = p.lines.map((l) => {
    const a = l.call.args;
    if (l.call.fn !== "statement" || !a.kind || a.withdraw || a.hold) return l;
    const kind = String(plain(a.kind) ?? "");
    const extra = Object.keys(a).filter((k) => !["kind", "text", "to", "data", "offer", "assertion", "visible", "basis", "for"].includes(k));
    const forms = stationery.filter((f) => f.writes?.kind === kind);
    if (!forms.length) return l;
    const visible = a.visible === undefined ? undefined : "id" in a.visible && a.visible.id === "public" ? "public" as const : plain(a.visible);
    const to = a.to === undefined ? undefined : "json" in a.to ? a.to.json : [plain(a.to)];
    const basis = a.basis === undefined ? undefined : plain(a.basis);
    const self = a.for ? String(plain(a.for)) : o.self;
    const ok = !extra.length && typeof plain(a.text) === "string" && (visible === undefined || visible === "public" || Array.isArray(visible)) && (basis === undefined || typeof basis === "string") && (to === undefined || Array.isArray(to));
    if (ok) {
      const paper: Paper = { kind, text: plain(a.text) as string, ...(to !== undefined ? { addressed_to: to as string[] } : {}), ...(a.data ? { data: plain(a.data) } : {}), ...(visible !== undefined ? { visible_to: visible as "public" | string[] } : {}),
        ...(basis !== undefined ? { basis: basis as string } : {}), ...(a.offer ? { offer: plain(a.offer) } : {}), ...(a.assertion ? { assertion: plain(a.assertion) } : {}) };
      for (const f of forms) {
        const got = fieldsFor(f, paper, { self, now: o.now, money: (x) => formatMoney(x, o.currency) });
        if (!got) continue;
        // A form that records a claim beside its paper (contracts: FormWrites `claim`): the brain says the claim in a
        // line of its own; a person fills in the form once, with what the claim is of. The brain's claim line is the
        // form's own if the form, given those fields, writes exactly it; with no such line the paper is not one this
        // form writes alone (it would ask what is permitted), and is said as the brain said it.
        let withClaim: number | undefined;
        if (f.writes?.claim) {
          let due: boolean;
          try { due = writeClaim(f, got.fields, { self, now: o.now }) !== undefined; } catch { due = true; }
          if (due) {
            for (let i = 0; i < all.length && withClaim === undefined; i++) {
              const c = all[i]!.call;
              if (c.fn !== "claim" || all[i]!.bind !== undefined || folded.has(i) || c.args.release || c.args.transfer || c.args.against || c.args.visible || (c.args.for ? String(plain(c.args.for)) : o.self) !== self) continue;
              const basis = c.args.basis === undefined ? undefined : plain(c.args.basis);
              if (typeof plain(c.args.holder) !== "string" || (basis !== undefined && typeof basis !== "string")) continue;
              const more = claimFieldsFor(f, { position: String(plain(c.args.position)) as any, holder: plain(c.args.holder) as string, about: plain(c.args.about), ...(basis !== undefined ? { basis: basis as string } : {}) }, got.fields, { self, now: o.now });
              if (more) { got.fields = more; withClaim = i; }
            }
            if (withClaim === undefined) continue;
          }
        }
        const args: { [k: string]: any } = { form: f.form, ...(f.office ? { to: f.office } : {}), ...(a.for ? { for: self } : {}) };
        let exact = true;
        for (const [name, v] of Object.entries(got.fields)) {
          const type = f.fields[name]!.type;
          if (type === "amount") { if (Number.isSafeInteger(Number(v))) args[name] = amountText(Number(v)); else exact = false; }
          else if (type === "duration") args[name] = secs(v as number);
          else if (type === "date" || type === "count") args[name] = text(String(v));
          else if (type === "list") args[name] = json(v);
          else if (type === "text") args[name] = text(v as string);
          else args[name] = v as string;
        }
        if (got.text !== undefined) args.text = text(got.text);
        if (!exact) continue;
        turned++;
        if (withClaim !== undefined) folded.add(withClaim);
        return { ...l, call: call("form", args) };
      }
    }
    kept.push(kind);
    return l;
  });
  const lines = mapped.filter((_, i) => !folded.has(i));
  return { program: turned ? programText({ lines }) : program, turned, kept };
}

export function mockPolicies(brains: Map<string, MockBrain>): { participant: MockPolicy; translator: MockPolicy; debrief: MockPolicy; consult: MockPolicy; notebook: MockPolicy; compose: MockPolicy; account: MockPolicy } {
  const queues = new Map<string, (ParticipantAction & { type: "call" | "message" })[]>();
  /** Looks each seat's brain has asked for and that have not been made yet: those it asked for while reading what it
   * missed between sittings (nothing could be looked up then), and any beyond what one answer takes. */
  const owed = new Map<string, LookRequest[]>();
  /** Each seat's own stationery, as it has been shown it: the forms that write a paper of its office's. */
  const stationery = new Map<string, Map<string, FormData>>();
  const see = (id: string, capacity: string, obs: { channels: { [k: string]: any } }) => {
    const mine = stationery.get(id) ?? new Map<string, FormData>();
    stationery.set(id, mine);
    for (const ch of Object.values(obs.channels)) for (const r of ch.kind === "records" ? ch.records : []) {
      if (r.record === "statement" && r.kind === "form" && r.data?.writes && r.data.office === capacity) mine.set(r.id, r.data as FormData);
      if (r.record === "withdrawal") mine.delete(r.withdraws);
    }
  };
  let n = 0;
  const tool = (name: string, input: object): ContentBlock => ({ type: "tool_use", id: `mock-${++n}`, name, input });

  const participant: MockPolicy = async (req: LlmRequest) => {
    // A code participant consulting the sparse mind (consult.ts): judgements that follow from the kind of person and
    // the option, so a run replays exactly; three, a point apart.
    if (req.context?.consult) {
      const { kind, keys } = req.context.consult as { kind: string; keys: string[] };
      const h = (s: string) => [...new Bun.CryptoHasher("sha256").update(s).digest()].slice(0, 4).reduce((a, b) => a * 256 + b, 0);
      const judgements = [-1, 0, 1].map((d) => Object.fromEntries(keys.map((k) => [k, Math.max(0, Math.min(10, (h(`${kind}/${k}`) % 11) + d))])));
      return [{ type: "text" as const, text: JSON.stringify({ judgements, why: "(mock) judged from the kind of person and the option." }) }];
    }
    const { observation: obs, participant: id } = req.context;
    const brain = brains.get(id);
    if (!brain) return [tool("done_for_now", {})];
    if (brain.optOutAt !== undefined && obs.t >= brain.optOutAt) return [tool("opt_out", { statement: "(mock) Stopping, as this test scenario scripts." })];
    // The brain sees every observation (its capacity's slice), as it would running the participant itself; what it wants done queues up.
    const q = queues.get(id) ?? [];
    queues.set(id, q);
    // What it was shown while away from its desk (office hours), first: the brain reads every observation, in order.
    for (const m of (req.context.missed ?? []) as typeof obs[]) {
      see(id, brain.capacity, m);
      inCurrency(brain.ctx.world.currency);
      const x = (await brain.controller.step(slice(m, brain.capacity, brain.ctx.entity), brain.ctx)) as ParticipantAction;
      if (x.type === "call" || x.type === "message") q.push(x);
      // (A look it asks for while reading what it missed is made now, at the sitting: the brain asks for each thing
      // once and waits for the answer, so a look dropped here was never made at all.)
      if (x.type === "look") owed.set(id, [...(owed.get(id) ?? []), ...x.looks]);
    }
    see(id, brain.capacity, obs);
    inCurrency(brain.ctx.world.currency);
    // (A seat that sits as its code twin does takes a step of its brain where the code unit does: at each wake, and after a look it made. Not on the
    // turns between its asking for a paper and confirming it: those are the seat's plumbing, and the code unit has no step there, being busy with its act.)
    const midAct = !!brain.twin && brain.busy === true && !!obs.drafts[0];
    const a = midAct ? ({ type: "wait" } as ParticipantAction) : ((await brain.controller.step(slice(obs, brain.capacity, brain.ctx.entity), brain.ctx)) as ParticipantAction);
    if (a.type === "call" || a.type === "message") q.push(a);
    if (a.type === "opt_out") return [tool("opt_out", { statement: a.statement })];
    // What the brain wants to find out before it goes on: looked for through the seat's own look, as a model would
    // (the answer is in the next report, which the brain reads like any other).
    const wanted = [...(owed.get(id) ?? []), ...(a.type === "look" ? a.looks : [])].filter((l, i, all) => all.findIndex((x) => JSON.stringify(x) === JSON.stringify(l)) === i);
    owed.delete(id);
    // (A seat that sits as its code twin does looks as its code unit does: all it asks for in one look.)
    if (wanted.length && brain.twin) return [tool("look", { raw: wanted.map((l) => (brain.capacity === "self" || l.channel.includes("/") ? l : { ...l, channel: `${brain.capacity}/${l.channel}` })) })];
    if (wanted.length) {
      // (Several look-ups of who's who through one report are one look that names them all, as the seat's tool takes them.)
      const tools: { [k: string]: any }[] = [];
      const made: LookRequest[] = [];
      for (const l of wanted) {
        const t = lookAsTool(l, brain.capacity) as { [k: string]: any };
        const same = l.who ? tools.find((x) => x.who && x.report === t.report) : undefined;
        // (One answer takes eight uses: what is over is made at the next turn, not dropped.)
        if (!same && tools.length >= 8) continue;
        made.push(l);
        if (same) same.named.push(...t.named);
        else tools.push({ ...t, ...(l.who ? { who: true } : {}) });
      }
      const left = wanted.filter((l) => !made.includes(l));
      if (left.length) owed.set(id, left);
      return tools.map(({ who: _who, ...input }) => tool("look", input));
    }
    const draft = obs.drafts[0];
    if (draft) {
      const asked = draft.proposal.startsWith(PREFIX) ? programText(parseProgram(draft.proposal.slice(PREFIX.length))) : undefined;
      const faithful = asked !== undefined && asked === draft.call;
      const accept = faithful && brain.ctx.rng(`mock-sign-${draft.id}`).below(10_000) >= (brain.rejectBps ?? 0);
      brain.busy = false;
      return [tool("confirm", { ref: draft.id, decision: accept ? "confirm" : "decline", note: faithful ? (accept ? "As I asked." : "(mock) Declined to exercise the path.") : "That isn't what I asked for." })];
    }
    const next = q.shift();
    const as = brain.capacity === "self" ? {} : { as: brain.capacity };
    if (next?.type === "message") return [tool("write", { to: next.to, text: next.text, ...as, ...(next.re ? { about: next.re } : {}) })];
    if (next) {
      // A paper of the office's own is asked for on the office's form for it, as whoever holds the office would.
      inCurrency(brain.ctx.world.currency);
      const said = onOwnForms(next.call, [...(stationery.get(id)?.values() ?? [])].sort((x, y) => (x.form < y.form ? -1 : 1)), { self: brain.ctx.entity, now: obs.t, currency: brain.ctx.world.currency });
      brain.busy = true;
      return [tool("notebook", { text: `Last request on day ${Math.floor(obs.t / 86_400)}.` }), tool("do", { what: PREFIX + said.program, ...as })];
    }
    // Done for now: back when the brain itself would next look in (the time it gave, or its module's own rhythm).
    if (brain.twin) return [tool("done_for_now", a.type === "wait" && a.until !== undefined && a.until > obs.t ? { at: a.until } : {})];
    const until = brain.backDays ? brain.backDays * 86_400 : a.type === "wait" && a.until !== undefined && a.until > obs.t ? a.until - obs.t : brain.cadence;
    return [tool("done_for_now", until ? { days: Math.max(1, Math.ceil(until / 86_400)) } : {})];
  };

  // The mock translator hands back the call a mock participant said, and can't translate anything else.
  const translator: MockPolicy = (req: LlmRequest) => {
    const text: string = req.context.proposal;
    if (!text.startsWith(PREFIX)) return [tool("call", { program: "none(unclear)" })];
    return [tool("call", { program: text.slice(PREFIX.length) })];
  };

  const debrief: MockPolicy = mockDebrief;

  // Folding a notebook's older notes: a fixed form, the number of notes and the first words of each, within the limit asked.
  const notebook: MockPolicy = (req: LlmRequest) => {
    const lines: string[] = String(req.context?.older ?? "").split("\n").filter((l) => l.trim());
    const limit: number = req.context?.limit ?? 300;
    let out = `(${lines.length} earlier notes)`;
    for (const l of lines) { const next = `${out} ${l.slice(0, 40)};`; if (next.length > limit) break; out = next; }
    return [{ type: "text", text: out.slice(0, limit) }];
  };

  // (A consultation of the sparse mind: its own purpose since contracts 0.7.)
  return { participant, translator, debrief, notebook, consult: participant, compose: mockCompose, account: mockAccount };
}
