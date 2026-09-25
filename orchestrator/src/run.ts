// Running a world: the kernel as a subprocess, seats scheduled on the world
// clock (PettingZoo AEC: the next seat is whichever's wake time or news comes
// first; ties by seat id), code seats driven by behaviour modules.
//
// Wakes: a seat sleeps until the time it asked for (wait.until), or its
// module's cadence, or until it has NEWS: a message delivered to it, or a
// record naming or addressed to its entity. News wakes it at the current time.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { modules as builtin, Randomness, type BehaviourModule, type Controller, type Observation, type SeatAction, type SeatContext } from "@terrarium/seats";
import { Kernel } from "./kernel";

export const ORCHESTRATOR_VERSION = "0.1.0";

export interface RunOptions {
  config: any;
  runId: string;
  outDir: string;
  /** Stop early (simulated seconds); default: the world's run length. */
  until?: number;
  modules?: { [name: string]: BehaviourModule & { source?: string } };
  kernel?: Kernel;
  log?: (msg: string) => void;
}

export interface RunSummary {
  runId: string;
  logPath: string;
  anchorsPath: string;
  stateHash: string;
  commands: number;
  refused: number;
  wakes: number;
  t: number;
}

interface SeatSlot {
  id: string;
  entity: string;
  module: BehaviourModule;
  controller: Controller;
  ctx: SeatContext;
  nextWake: number;
  resigned: boolean;
  wakesThisTick: number;
  wakeTick: number;
}

const ceilTo = (t: number, tick: number) => Math.ceil(t / tick) * tick;

/** A stand-in for LLM seats until M2: it only waits (and says so in the log). */
const mockLlm: BehaviourModule = {
  name: "mock.llm",
  version: "0.1.0",
  doc: "docs/design/stage2-plan.md",
  cadence: () => 30 * 86_400,
  create: () => ({ step: () => ({ type: "wait" }) }),
};

export async function runWorld(o: RunOptions): Promise<RunSummary> {
  const log = o.log ?? (() => {});
  const mods = { ...builtin, ...(o.modules ?? {}) };
  const cfg = o.config;
  const tick: number = cfg.clock.tick_seconds;
  const runEnd = ceilTo(cfg.clock.run_seconds, tick);
  const until = Math.min(o.until ?? runEnd, runEnd);
  const randomness = new Randomness(BigInt(cfg.seed));
  mkdirSync(o.outDir, { recursive: true });
  const logPath = join(o.outDir, `${o.runId}.jsonl`);
  const anchorsPath = join(o.outDir, `${o.runId}.anchors.jsonl`);
  const k = o.kernel ?? new Kernel();
  let commands = 0, refused = 0, wakes = 0;

  await k.request({ op: "start", config: cfg, run_id: o.runId, log_path: logPath, anchors_path: anchorsPath });
  let t = 0;

  // Seats and their controllers.
  const seats: SeatSlot[] = [];
  const used: { [name: string]: { version: string; sha256?: string } } = {};
  const seatsOf = new Map<string, string[]>();
  for (const s of [...cfg.seats].sort((a: any, b: any) => (a.id < b.id ? -1 : 1))) {
    const c = s.controller;
    const module = c.type === "code" ? mods[c.impl] : c.type === "llm" ? mockLlm : undefined;
    if (!module) throw new Error(`seat ${s.id}: no behaviour module "${c.impl}" (controller type ${c.type})`);
    const src = (module as any).source as string | undefined;
    used[module.name] = { version: module.version, ...(src ? { sha256: new Bun.CryptoHasher("sha256").update(await Bun.file(src).text()).digest("hex") } : {}) };
    const ctx: SeatContext = {
      seat: s.id,
      entity: s.entity,
      rng: (purpose) => randomness.stream(["seat", s.id, String(t), purpose]),
      world: { tickSeconds: tick, runEnd, config: cfg },
      params: (c.params ?? {}) as any,
    };
    const slot: SeatSlot = { id: s.id, entity: s.entity, module, controller: module.create(ctx), ctx, nextWake: ceilTo(module.firstWake?.(ctx) ?? 0, tick), resigned: false, wakesThisTick: 0, wakeTick: -1 };
    seats.push(slot);
    seatsOf.set(s.entity, [...(seatsOf.get(s.entity) ?? []), s.id]);
  }
  const byId = new Map(seats.map((s) => [s.id, s]));

  // What code ran this world is part of the record (D30).
  await k.request({ op: "annotate", annotation: { annotation: "orchestrator", subject: "orchestrator", data: {
    version: ORCHESTRATOR_VERSION, modules: used, thinking_time: cfg.orchestration.thinking_time, max_actions_per_wake: cfg.orchestration.max_actions_per_wake,
  } } });

  const wakeNow = (seatId: string) => {
    const s = byId.get(seatId);
    if (s && !s.resigned && s.nextWake > t) s.nextWake = t;
  };
  const noteNews = (events: any[]) => {
    for (const e of events) {
      if (e.event === "message_delivered") for (const s of e.to) wakeNow(s);
      if (e.event === "recorded") {
        const r = e.record;
        const named = new Set<string>([...(r.addressed_to ?? []), r.holder, r.counterparty, r.as, r.to, ...(r.terms?.parties ?? [])].filter(Boolean));
        for (const ent of named) for (const s of seatsOf.get(ent) ?? []) if (s !== e.seat) wakeNow(s);
      }
    }
  };
  const command = async (cmd: object) => {
    const r = await k.tryRequest({ op: "command", command: cmd });
    if (r === null) return null;
    commands++;
    for (const e of r.events) if (e.event === "action_refused") refused++;
    noteNews(r.events);
    return r;
  };

  const maxActions: number = cfg.orchestration.max_actions_per_wake;
  for (;;) {
    const live = seats.filter((s) => !s.resigned);
    if (live.length === 0) break;
    const next = live.reduce((a, b) => (b.nextWake < a.nextWake ? b : a));
    if (next.nextWake > until) break;
    if (next.nextWake > t) {
      await command({ command: "advance", to: next.nextWake });
      t = next.nextWake;
    }
    // Guard against two code seats waking each other forever within one tick.
    if (next.wakeTick === t && next.wakesThisTick >= 3) {
      next.nextWake = t + tick;
      continue;
    }
    next.wakesThisTick = next.wakeTick === t ? next.wakesThisTick + 1 : 1;
    next.wakeTick = t;
    wakes++;
    next.nextWake = t + ceilTo(next.module.cadence(next.ctx), tick); // default if it waits without a time
    for (let n = 0; n < maxActions; n++) {
      const obs: Observation = (await command({ command: "observe", seat: next.id })).observation;
      const action: SeatAction = next.controller.step(obs, next.ctx);
      if (action.type === "wait") {
        if (action.until !== undefined) next.nextWake = Math.max(t + tick, ceilTo(action.until, tick));
        break;
      }
      if (action.type === "resign") {
        await command({ command: "resign", seat: next.id, statement: action.statement });
        next.resigned = true;
        break;
      }
      if (action.type === "act" || action.type === "message") {
        const blocks = action.type === "act" ? action.blocks : [{ block: "message", to: action.to, text: action.text, ...(action.re ? { re: action.re } : {}) }];
        const r = await command({ command: "act", seat: next.id, blocks, provenance: { via: "direct" }, ...(action.type === "act" && action.reasoning ? { reasoning: action.reasoning } : {}) });
        if (r === null) {
          // Off-contract: never logged by the kernel, so record the attempt ourselves.
          await k.request({ op: "annotate", annotation: { annotation: "note", subject: next.id, data: { rejected_action: JSON.stringify(action).slice(0, 4000) } } });
        }
        continue;
      }
      // propose / sign need the translator (M2).
      await k.request({ op: "annotate", annotation: { annotation: "note", subject: next.id, data: { unsupported_action: action.type } } });
      break;
    }
  }
  if (until > t) {
    await command({ command: "advance", to: until });
    t = until;
  }
  const end = await k.request({ op: "finish", reason: until === runEnd ? "completed" : "aborted", ...(until === runEnd ? {} : { detail: `stopped at ${until}` }) });
  if (!o.kernel) await k.close();
  log(`${o.runId}: ${commands} commands, ${refused} refused, ${wakes} wakes, t=${t}`);
  return { runId: o.runId, logPath, anchorsPath, stateHash: end.state_hash, commands, refused, wakes, t };
}
