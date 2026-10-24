// The engine's own actor, in the place of a TypeScript one, for tests that step an actor on hand-built observations
// (participants/test/stepping.ts): `engine("firm.builder")` is a module whose `create(ctx)` is the Rust kind run detached
// (orchestrator/src/rust-world.ts, DetachedActor), stepped on the observation as the kernel would send it. What a test
// reads back (the calls of an act) is the same. Its draws are the engine's, not a TypeScript stream's: a case that
// leans on one draw is pinned to the engine's.

import { DetachedActor, RAW } from "../../orchestrator/src/rust-world";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { DECISIONS, OUTCOMES, RECORD, type Controller } from "../src/module";

/** The least world's config the engine's kinds read: a clock, a seed, a currency, nothing else in it. */
const bare = (ctx: any): object => ({ seed: 1, clock: { tick_seconds: ctx.world?.tickSeconds ?? 3600, run_seconds: ctx.world?.runEnd ?? 4000 * 86_400 }, world: { currencies: [ctx.world?.currency ?? PROFILE.values.currency], entities: [] },
  catalogue: { structure_types: [] }, log: {}, orchestration: {}, templates: [], participants: [], positions: [], ...(ctx.world?.dials ? { dials: ctx.world.dials } : {}) });

/** What a test leaves out of an observation that the kernel's carries (a building's footprint, a space's kind): given as the least. */
const ctx0: any = {};
function whole(obs: any): any {
  const channels = Object.fromEntries(Object.entries(obs.channels ?? {}).map(([k, c]: [string, any]) => [k, c?.kind === "sites" ? { as_of: obs.t ?? 0, ...c, cells: c.cells.map((cell: any) => ({ x: 0, y: 0, ...cell,
    structure: cell.structure ? { at: cell.cell, w: 1, h: 1, complete: true, ...cell.structure, spaces: (cell.structure.spaces ?? []).map((s: any) => ({ kind: "room", capacity: 1000, count: (s.occupants ?? []).length, ...s })) } : cell.structure })) } : c]));
  const money = ctx0.world?.currency?.code ?? PROFILE.values.currency.code;
  for (const c of Object.values<any>(channels)) if (c?.kind === "accounts") c.transactions = (c.transactions ?? []).map((x: any) => ({ currency: money, by: x.from, ...(x.for ? { memo: x.for } : {}), ...x, t: x.t ?? x.at }));
  // (A moment is whole seconds in the kernel's: a test's `91.1 * DAY` is the second nearest.)
  for (const c of Object.values<any>(channels)) if (c?.kind === "records") c.records = c.records.map((r: any) => (r.at !== undefined && !Number.isInteger(r.at) ? { ...r, at: Math.round(r.at) } : r));
  const readings = Object.fromEntries(Object.entries(obs.readings ?? {}).map(([id, r]: [string, any]) => [id, { reader: "terms-0.2.0", ...r }]));
  // (A letter a test hands in says who wrote it and what: its time and its addressee are the observation's.)
  const inbox = (obs.inbox ?? []).map((m: any) => ({ t: obs.t ?? 0, to: [obs.participant ?? "x"], ...m }));
  return { status: "active", drafts: [], positions: [], ...obs, inbox, outcomes: (obs.outcomes ?? []).map((o: any) => ({ ...o, status: o.status === "ok" ? "applied" : o.status })), channels, readings };
}

/** The purposes of the draws a step made, in order (`chance:` first for a draw about one thing), on the act it returned. */
export const DRAWS = Symbol("draws");

export interface EngineOptions {
  /** The world's config the kind reads (positions, participants...), or a function that gives it when the actor is made: none by default (a clock and a currency). */
  config?: object | (() => object);
  seed?: number;
}

export function engine(kind: string, o: EngineOptions = {}): { name: string; create: (ctx: any) => Controller } {
  return {
    name: kind,
    create: (ctx: any): Controller => {
      const actor = new DetachedActor({ kind, participant: ctx.participant, capacity: ctx.position ?? "self", entity: ctx.entity, system: ctx.kind === "system" || /-system$/.test(ctx.participant), params: ctx.params ?? {}, seed: o.seed ?? ctx.seed ?? 1, config: (typeof o.config === "function" ? o.config() : o.config) ?? bare(ctx) });
      let since = 0;
      const asked = new Set<string>();
      /** Which part of an observation the engine could not read, for a test's author. */
      const diagnose = (obs: any, e: Error): Error => {
        const readable = (x: any) => { try { actor.step({ ...x, outcomes: x.outcomes ?? [] }, "cadence", since); return true; } catch { return false; } };
        const found: string[] = [];
        if (!readable({ ...obs, channels: {}, readings: {}, outcomes: [], inbox: [] })) found.push("the observation itself");
        if (!readable({ ...obs, channels: {}, readings: {}, inbox: [] })) found.push("outcomes");
        if (!readable({ ...obs, channels: {}, readings: {}, outcomes: [] })) found.push("inbox");
        if (!readable({ ...obs, channels: {}, outcomes: [], inbox: [] })) found.push("readings");
        for (const [k, c] of Object.entries<any>(obs.channels ?? {})) {
          if (readable({ ...obs, channels: { [k]: c }, readings: {}, outcomes: [], inbox: [] })) continue;
          const items: any[] = c.records ?? c.accounts ?? c.cells ?? [];
            const badItem = items.find((r) => !readable({ ...obs, channels: { [k]: { ...c, ...(c.records ? { records: [r] } : c.accounts ? { accounts: [r], transactions: [] } : { cells: [r] }) } }, readings: {}, outcomes: [], inbox: [] }));
          found.push(`channel ${k}${badItem ? ` (${JSON.stringify(badItem).slice(0, 160)})` : ""}`);
        }
        return new Error(`${e.message}${found.length ? ` [${found.join("; ")}]` : ""}`);
      };
      return {
        step: (given: any) => {
          // (Handed the kernel's own observation by the host, as a mock seat's brain is, it is used as it is.)
          let obs = given[RAW] ? { ...given[RAW], entity: given.entity } : whole({ participant: ctx.participant, entity: ctx.entity, ...given });
          // (A post's channels are the kernel's `<position>/<channel>`: the view of that capacity takes its own prefix off.)
          if (ctx.position) obs = { ...obs, channels: Object.fromEntries(Object.entries<any>(obs.channels).map(([k, c]) => [k.includes("/") ? k : `${ctx.position}/${k}`, c])) };
          // (A reader the test hands in is the reading desk: asked, as the host asks it for the engine, about each paper addressed to this
          // person that is new to them, and its filing, or none, goes back as the answer, in the step that sees the paper.)
          let answers: object[] | undefined;
          if (typeof ctx.read === "function") {
            const papers = Object.values<any>(obs.channels ?? {}).flatMap((c) => (c?.kind === "records" ? c.records : [])).filter((x: any) => (x.addressed_to ?? []).includes(ctx.entity) || (x.addressed_to ?? []).includes(ctx.participant));
            answers = papers.filter((x: any) => !asked.has(x.id)).map((x: any) => { asked.add(x.id); return { kind: "reading", about: x.id, body: ctx.read(x.id, "addressee") ?? null }; });
          }
          let r: any;
          try { r = actor.step(obs, obs.woke_for ?? "cadence", since, answers); } catch (e) { throw diagnose(obs, e as Error); }
          since = obs.t;
          // (What the actor reports beside its act, as the host reads it from the action: its record, outcomes and decisions.)
          const a = r.action;
          if (r.record && Object.keys(r.record).length) a[RECORD] = r.record;
          if (r.outcomes?.length) a[OUTCOMES] = r.outcomes;
          if (r.decisions?.length) a[DECISIONS] = r.decisions;
          a[DRAWS] = r.draws ?? [];
          return a;
        },
        sent: (a: string) => actor.sent(a),
      } as Controller;
    },
  };
}
