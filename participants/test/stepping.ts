// For tests that step a behaviour module on hand-built observations and read its acts back: what each act called, as
// plain values (not text to be picked apart), and a module's own statements turned into the records the world would have
// made of them, to show it again at its next wake.

import { parseProgram, type Call, type Value } from "../src/calls";
import type { Observation } from "../src/contracts";
import { Randomness } from "../src/rng";

export const DAY = 86_400;
export const MONTH = 30 * DAY;

export interface Said { fn: string; bind?: string; args: { [k: string]: any }; why: string; t: number }

const plain = (v: Value): any => ("id" in v ? v.id : "text" in v ? v.text : "json" in v ? v.json : "var" in v ? `$${v.var}` : { fn: v.call.fn, args: argsOf(v.call) });
const argsOf = (c: Call) => Object.fromEntries(Object.entries(c.args).map(([k, v]) => [k, plain(v)]));

/** The calls of an action (a `call` action's program), each with its arguments as plain values. */
export function callsOf(action: { type: string; call?: string; reasoning?: string }, t = 0): Said[] {
  if (action.type !== "call") return [];
  const p = parseProgram(action.call!);
  return "lines" in p ? p.lines.map((l) => ({ fn: l.call.fn, ...(l.bind ? { bind: l.bind } : {}), args: argsOf(l.call), why: action.reasoning ?? "", t })) : [];
}

/** A participant's context: its randomness from a seed, keyed by participant and purpose as the kernel's streams are. */
export const context = (participant: string, entity: string, params: object, o: { position?: string; seed?: bigint; currency?: object } = {}): any => ({
  participant, entity, position: o.position, params,
  rng: (purpose: string) => new Randomness(o.seed ?? 1n).stream([participant, purpose]),
  world: { tickSeconds: 3600, runEnd: 4000 * DAY, currency: o.currency },
});

/**
 * A code office stepped through one wake at `t` on what it's shown (`channels`, `inbox`): every act it makes until it
 * waits. Each act is answered as applied, with an id for every name it bound (`<prefix>.<n>`); with `as`, each statement
 * it publishes becomes a record (made in that position, for that entity), returned in `made` for the test to show it
 * again, as the world would.
 */
export function wake(m: { step: (o: Observation, ctx: any) => any }, t: number, channels: { [id: string]: any }, o: { entity: string; inbox?: any[]; as?: { participant: string; position?: string }; ids?: { n: number }; woke_for?: string; more?: object } = { entity: "city" }) {
  const said: Said[] = [];
  const made: any[] = [];
  const ids = o.ids ?? { n: 0 };
  let obs = { t, entity: o.entity, participant: o.as?.participant ?? "x", channels, inbox: o.inbox ?? [], outcomes: [], woke_for: o.woke_for ?? "cadence", ...(o.more ?? {}) } as unknown as Observation;
  for (let i = 0; i < 2000; i++) {
    const a: any = m.step(obs, undefined as any);
    if (a.type === "wait") break;
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
    obs = { ...obs, woke_for: "done", outcomes: [{ action: `act.${i}`, t, status: "applied", ...(Object.keys(created).length ? { created } : {}) }], inbox: [],
      channels: Object.fromEntries(Object.entries(obs.channels).map(([k, c]: [string, any]) => [k, c.kind === "records" ? { ...c, records: [] } : c.kind === "accounts" ? { ...c, transactions: [] } : c])) } as unknown as Observation;
  }
  return { said, made, of: (fn: string, kind?: string) => said.filter((c) => c.fn === fn && (kind === undefined || c.args.kind === kind)) };
}

/** A statement record, as a world's genesis or another participant would have made it. */
export const statement = (id: string, at: number, kind: string, x: object = {}) => ({ id, at, record: "statement", author: "genesis", speaks_for: "city", visible_to: "public", kind, text: id, ...x });
