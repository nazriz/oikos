// For tests that step a behaviour module on hand-built observations and read its acts back: what each act called, as
// plain values (not text to be picked apart), and a module's own statements turned into the records the world would have
// made of them, to show it again at its next wake.

import { parseAmount, parseDuration, parseProgram, type Call, type Value } from "../src/calls";
import { currencyNow } from "../src/money";
import type { Observation } from "../src/contracts";
import { Randomness } from "../src/rng";

export const DAY = 86_400;
export const MONTH = 30 * DAY;

export interface Said { fn: string; bind?: string; args: { [k: string]: any }; why: string; t: number;
  /** The id the world gave what the call made (where the test's world gives one). */
  id?: string }

const plain = (v: Value): any => ("id" in v ? v.id : "text" in v ? v.text : "json" in v ? v.json : "var" in v ? `$${v.var}` : { fn: v.call.fn, args: argsOf(v.call) });
const argsOf = (c: Call) => Object.fromEntries(Object.entries(c.args).map(([k, v]) => [k, plain(v)]));

/** The calls of an action (a `call` action's program), each with its arguments as plain values. */
export function callsOf(action: { type: string; call?: string; reasoning?: string }, t = 0): Said[] {
  if (action.type !== "call") return [];
  const p = parseProgram(action.call!);
  return "lines" in p ? p.lines.map((l) => ({ fn: l.call.fn, ...(l.bind ? { bind: l.bind } : {}), args: argsOf(l.call), why: action.reasoning ?? "", t })) : [];
}

/** A participant's context: its randomness from a seed, keyed by participant and purpose as the kernel's streams are. */
export const context = (participant: string, entity: string, params: object, o: { position?: string; seed?: bigint; currency?: object; dials?: object } = {}): any => ({
  participant, entity, position: o.position, params, seed: Number(o.seed ?? 1n),
  rng: (purpose: string) => new Randomness(o.seed ?? 1n).stream([participant, purpose]),
  chance: (purpose: string) => new Randomness(o.seed ?? 1n).stream(["chance", purpose]),
  world: { tickSeconds: 3600, runEnd: 4000 * DAY, currency: o.currency, ...(o.dials ? { dials: o.dials } : {}) },
});

/**
 * A code office stepped through one wake at `t` on what it's shown (`channels`, `inbox`): every act it makes until it
 * waits. Each act is answered as applied, with an id for every name it bound (`<prefix>.<n>`); with `as`, each statement
 * it publishes becomes a record (made in that position, for that entity), returned in `made` for the test to show it
 * again, as the world would.
 */
export function wake(m: { step: (o: Observation, ctx: any) => any }, t: number, channels: { [id: string]: any }, o: { entity: string; inbox?: any[]; as?: { participant: string; position?: string }; ids?: { n: number }; woke_for?: string; more?: object; /** An act the world refuses (as `not_present`), where the test says so. */ refuse?: (c: Said) => boolean } = { entity: "city" }) {
  const said: Said[] = [];
  const made: any[] = [];
  const looks: any[] = [];
  const ids = o.ids ?? { n: 0 };
  let obs = { t, entity: o.entity, participant: o.as?.participant ?? "x", channels, inbox: o.inbox ?? [], outcomes: [], woke_for: o.woke_for ?? "cadence", ...(o.more ?? {}) } as unknown as Observation;
  for (let i = 0; i < 2000; i++) {
    const a: any = m.step(obs, undefined as any);
    if (a.type === "wait") break;
    if (a.type === "look") looks.push(...a.looks);
    const calls = callsOf(a, t);
    said.push(...calls);
    const created: { [name: string]: string } = {};
    for (const c of calls) {
      const id = `made.${++ids.n}`;
      if (c.bind) created[c.bind] = id;
      if (c.fn === "statement" && c.args.kind && o.as) made.push({ id, at: t, record: "statement", author: o.as.participant, ...(o.as.position ? { in_position: o.as.position } : {}), speaks_for: c.args.for ?? o.entity,
        visible_to: c.args.visible === "public" ? "public" : c.args.visible ?? [o.entity], kind: c.args.kind, text: c.args.text, ...(c.args.data !== undefined ? { data: c.args.data } : {}), ...(c.args.to ? { addressed_to: c.args.to } : {}), ...(c.args.basis ? { basis: c.args.basis } : {}) });
    }
    // (What it has been shown, it has seen: only the outcome of its act is new at its next step.)
    obs = { ...obs, woke_for: "done", outcomes: [o.refuse && calls.some(o.refuse) ? { action: `act.${i}`, t, status: "refused", refusal: { code: "not_present", detail: "not there" } } : { action: `act.${i}`, t, status: "applied", ...(Object.keys(created).length ? { created } : {}) }], inbox: [],
      channels: Object.fromEntries(Object.entries(obs.channels).map(([k, c]: [string, any]) => [k, c.kind === "records" ? { ...c, records: [] } : c.kind === "accounts" ? { ...c, transactions: [] } : c])) } as unknown as Observation;
  }
  return { said, made, looks, of: (fn: string, kind?: string) => said.filter((c) => c.fn === fn && (kind === undefined || c.args.kind === kind)) };
}

/** A statement record, as a world's genesis or another participant would have made it. */
export const statement = (id: string, at: number, kind: string, x: object = {}) => ({ id, at, record: "statement", author: "genesis", speaks_for: "city", visible_to: "public", kind, text: id, ...x });

// ------------------------------------------------------------------ a townsperson (citizen.default)

const YEAR = 365 * DAY;
/** An agreement between two parties, with both signatures: a lease (the landlord lets `space`; the tenant pays `rent` a
 * month into the landlord's account) or a job (the employer pays `wage` every `period`). */
export const signed = (a: any, at = a.at) => [a, ...a.terms.parties.map((as: string) => ({ id: `sig-${a.id}-${as}`, at, author: `${as}-x`, record: "signature", agreement: a.id, as, visible_to: a.terms.parties }))];
export const lease = (id: string, at: number, landlord: string, tenant: string, space: string, rent: number, x: object = {}) => ({ id, at, author: `${landlord}-office-system`, record: "agreement", visible_to: [landlord, tenant], ...x,
  terms: { template: "lease", parties: [landlord, tenant], commitments: [
    { who: landlord, does: { outcome: { occupancy: { who: tenant, in: space } } } },
    { who: tenant, does: { outcome: { money: { from: `acc-${tenant}`, to: `acc-${landlord}`, amount: String(rent), for: "rent" } } }, every: MONTH }] } });
export const employment = (id: string, at: number, employer: string, worker: string, wage: number, period = 14 * DAY) => ({ id, at, author: `${employer}-manager-system`, record: "agreement", visible_to: [employer, worker],
  terms: { template: "employment", parties: [employer, worker], commitments: [{ who: employer, does: { outcome: { money: { from: `acc-${employer}`, to: `acc-${worker}`, amount: String(wage), for: "wages" } } }, every: period }] } });
/** A standing order as the bank has it: a payment request, every so often, first due `first` after it was made. */
export const standingOrder = (id: string, at: number, who: string, to: string, amount: number, x: { basis?: string; first?: number; every?: number; for?: string } = {}) => ({ id, at, record: "statement", kind: "request", author: `${who}-self`, speaks_for: who, addressed_to: ["bank"], visible_to: [who, "bank"],
  text: "Payment request.", ...(x.basis ? { basis: x.basis } : {}), data: { outcome: { money: { from: `acc-${who}`, to, amount: String(amount), ...(x.for ? { for: x.for } : {}) } }, every: x.every ?? MONTH, ...(x.first !== undefined ? { first: x.first } : {}) } });

export interface Woken { records?: any[]; inbox?: any[]; balance?: number; transactions?: any[]; petitions?: any[]; homes?: any[]; jobs?: any[]; readings?: { [id: string]: object }; street?: any[]; in?: string; woke_for?: string;
  /** The world's answer to an act, if it isn't simply done: a refusal's code. */
  refuse?: (calls: Said[]) => string | undefined;
  /** What a look finds through channels shown only on request, other than the boards (a register): the test's world
   * is told each look the person makes, and answers with the records found, by channel. */
  looked?: (looks: { channel: string; query?: any }[]) => { [channel: string]: any[] } | void }

/**
 * A townsperson run by `citizen.default`, woken on hand-built observations. Each wake: what's new to them (records,
 * letters), their bank balance, what a look at the boards finds (petitions, homes, jobs), who is where around them
 * (`street`: the buildings they see) and where their body is (`in`). Returns everything they called in the wake. Their
 * own standing orders and statements come back to them as records, as the world would show them; agreements read as
 * `readings` says (kept between wakes).
 */
export function person(citizen: { create: (ctx: any) => any }, params: object = {}, o: { me?: string; seed?: bigint; age?: number; sex?: "female" | "male"; currency?: object; dials?: object } = {}) {
  const me = o.me ?? "c1";
  const participant = `${me}-self`;
  const m = citizen.create(context(participant, me, params, { seed: o.seed, currency: o.currency, ...(o.dials ? { dials: o.dials } : {}) }));
  const readings: { [id: string]: object } = {};
  const ids = { n: 0 };
  let balance = 0;
  let own: any[] = [];
  const born_at = -(o.age ?? 35) * YEAR;
  return {
    me, participant,
    async wake(t: number, w: Woken = {}): Promise<Said[]> {
      Object.assign(readings, w.readings ?? {});
      if (w.balance !== undefined) balance = w.balance;
      const said: Said[] = [];
      const board = (records: any[] | undefined) => ({ kind: "records", search: true, records: records ?? [] });
      const channels = (records: any[], looked: boolean, transactions: any[] = []): any => ({
        mine: { kind: "records", records },
        money: { kind: "accounts", accounts: [{ account: `acc-${me}`, holder: me, custodian: "bank", currency: "AUD", balance: String(balance) }], transactions },
        ...(w.street ? { street: { kind: "sites", as_of: t, cells: w.street } } : {}),
        ...(looked ? { petitions: board(w.petitions), homes: board(w.homes), jobs: board(w.jobs) } : {}),
      });
      const body: { [k: string]: any; in?: string } = { born_at, sex: o.sex ?? "male", present: true, alive: true, children: [], parents: [], conditions: [], variables: {}, ...(w.in ? { in: w.in } : {}) };
      let obs: any = { t, entity: me, participant, woke_for: w.woke_for ?? "cadence", outcomes: [], inbox: w.inbox ?? [], readings: { ...readings }, body: { ...body }, channels: channels([...own, ...(w.records ?? [])], false, w.transactions ?? []) };
      own = [];
      for (let i = 0; i < 200; i++) {
        const a: any = await m.step(obs, undefined);
        if (a.type === "wait") break;
        if (a.type === "look") {
          const found = w.looked?.(a.looks) ?? {};
          obs = { ...obs, outcomes: [], inbox: [], channels: { ...channels([], true), ...Object.fromEntries(Object.entries(found).map(([ch, records]) => [ch, { kind: "records", search: true, records }])) } };
          continue;
        }
        const calls = callsOf(a, t);
        said.push(...calls);
        const refusal = w.refuse?.(calls);
        const created: { [name: string]: string } = {};
        const made: any[] = [];
        if (!refusal) for (const c of calls) {
          const id = `made.${++ids.n}`;
          c.id = id;
          if (c.bind) created[c.bind] = id;
          if (c.fn === "money" && c.args.every) made.push(standingOrder(id, t, me, c.args.to, Number(parseAmount(c.args.amount, currencyNow())), { basis: c.args.basis, every: parseDuration(c.args.every), ...(c.args.first !== undefined ? { first: parseDuration(c.args.first) } : {}), for: c.args.for }));
          if (c.fn === "statement" && c.args.kind) made.push({ id, at: t, record: "statement", author: participant, speaks_for: me, visible_to: c.args.visible ?? "public", kind: c.args.kind, text: c.args.text, ...(c.args.data !== undefined ? { data: c.args.data } : {}), ...(c.args.to ? { addressed_to: c.args.to } : {}), ...(c.args.basis ? { basis: c.args.basis } : {}) });
          // (Where their body is, as they move it: into a space, or out of the building they're in.)
          if (c.fn === "occupancy" && (c.args.who ?? me) === me) body.in = c.args.leave ? (body.in?.startsWith(c.args.in) ? undefined : body.in) : c.args.in;
        }
        obs = { ...obs, body: { ...body }, woke_for: "done", inbox: [], outcomes: [{ action: `act.${ids.n}.${i}`, t, status: refusal ? "refused" : "applied", ...(refusal ? { refusal: { code: refusal } } : {}), ...(Object.keys(created).length ? { created } : {}) }], channels: channels(made, false) };
      }
      return said;
    },
  };
}
