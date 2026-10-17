// The Rust world's host (OIKOS_WORLD=rust; docs/design/rust-port.md 2.3, lane F): the engine runs the world and every
// built-in actor in Rust (kernel/src/host.rs, through the native module); this side runs the seats and the run's
// paperwork. `runWorld` hands a run here when OIKOS_WORLD is "rust".
//
// What the host does:
// - starts the engine on the world's config, its log written where the TS world's would be (`<runId>.jsonl`, with its
//   anchors), so every tool that reads a run's log reads this one;
// - takes each round's awake seats (with what each was shown: the contract's Observation) and answers them all at
//   once (a model's seats think side by side; across forks too: `RustWorld.fork`), then lets the engine carry the
//   round out;
// - records each seat's model usage and cost in the log (`annotate`), as the TS host does;
// - answers code actors' questions to models (`questions`/`answer`) where it has the model for them.
//
// Seats: a mock seat that sits as its code twin (`mock.twin` with a `mock.brain`) is decided by the brain's own Rust
// kind run detached (`Detached`), the same code the engine runs for that post, so the twin is exact. Any other seat is
// decided by `seats` (a hook taking the wake and giving a participant-API action); without one, it waits, and the log
// says once that it was not hosted. (Wiring the model seats' controllers, the translator's drafts and the debriefs
// into this host is the integration step's: docs/port-guide.md section 8.)

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { nativeEngine } from "./kernel";
import type { RunOptions, RunSummary } from "./run";

export interface SeatWake { key: string; participant: string; t: number; woke_for: string; since: number; observation: any }
/** What a seat does at a wake: a participant-API action (wait, look, call, act with its provenance, message, opt_out). */
export type SeatHost = (wake: SeatWake, world: RustWorld) => Promise<object> | object;

export interface RustOptions {
  run_id?: string;
  /** The log's path: `.jsonl` the JSONL log, anything else the binary log (snapshots and forks). Absent: in memory. */
  log?: string;
  anchors?: string;
  threads?: number;
  until?: number;
  stand_in?: string;
  record_decisions?: boolean;
  audit?: boolean;
  snapshot_every_days?: number;
  stream?: { cap?: number; kinds?: string[] };
  /** A fork's: its label, and its parent's log as its own names it (relative to itself). */
  label?: string;
  parent?: string;
  mock_seats?: boolean;
}

const need = () => {
  const n = nativeEngine();
  if (!n?.World) throw new Error("the Rust world needs the engine's native module: run `bun run kernel`");
  return n;
};

/** The engine's world, as the host holds it. */
export class RustWorld {
  private constructor(private w: any) {}
  static start(config: object, opts: RustOptions = {}): RustWorld {
    return new RustWorld(new (need().World)(JSON.stringify(config), JSON.stringify(opts)));
  }
  /** A run taken up again from a snapshot's bytes. */
  static resume(snapshot: Uint8Array, opts: RustOptions = {}): RustWorld {
    return new RustWorld(need().World.resume(Buffer.from(snapshot), JSON.stringify(opts)));
  }
  /** A fork of this run now: apart from it from here on. */
  fork(opts: RustOptions = {}): RustWorld {
    return new RustWorld(this.w.fork(JSON.stringify(opts)));
  }
  next(): { due: "seats"; t: number; seats: SeatWake[] } | { due: "end"; t: number } {
    return JSON.parse(this.w.next());
  }
  nextBy(by: number): { due: "seats"; t: number; seats: SeatWake[] } | { due: "end" | "paused"; t: number } {
    return JSON.parse(this.w.nextBy(by));
  }
  submit(key: string, action: object): void {
    this.w.submit(key, JSON.stringify(action));
  }
  annotate(annotation: object): void {
    this.w.annotate(JSON.stringify(annotation));
  }
  questions(): { key: string; kind: string; about: string; body: unknown }[] {
    return JSON.parse(this.w.questions());
  }
  answer(key: string, answers: { kind: string; about: string; body: unknown }[]): void {
    this.w.answer(key, JSON.stringify(answers));
  }
  snapshot(): Uint8Array {
    return this.w.snapshot();
  }
  snapshotToLog(): void {
    this.w.snapshotToLog();
  }
  /** The live stream: log entries since last taken, and how many were missed. */
  events(max = 100_000): { entries: any[]; missed: number } {
    return JSON.parse(this.w.events(max));
  }
  t(): number {
    return this.w.t();
  }
  stateHash(): string {
    return this.w.stateHash();
  }
  finish(): { state_hash: string; t: number; steps: number; log?: string } {
    return JSON.parse(this.w.finish());
  }
  /** The log, where it was kept in memory (after `finish`). */
  logBytes(): Uint8Array | null {
    return this.w.logBytes() ?? null;
  }
}

/** One Rust actor kind run on observations it is handed (a twin's brain). */
export class DetachedActor {
  private a: any;
  /** `saved`: one as `save` left it (a fork's twin goes on as its parent's would). */
  constructor(private spec: { kind: string; participant: string; capacity: string; entity: string; system?: boolean; params?: object; seed?: number; config: object; saved?: object }) {
    this.a = new (need().Detached)(JSON.stringify(spec));
  }
  /** Its memory, view and draws. */
  save(): object {
    return JSON.parse(this.a.save());
  }
  /** Another, apart from this one from now on, that goes on as this one would. */
  fork(): DetachedActor {
    return new DetachedActor({ ...this.spec, saved: this.save() });
  }
  step(observation: object, wokeFor: string, since: number, answers?: object[]): { action: any; decisions: any[]; outcomes: any[]; record: any; questions: any[] } {
    return JSON.parse(this.a.step(JSON.stringify(observation), wokeFor, since, answers ? JSON.stringify(answers) : null));
  }
  sent(action: string): void {
    this.a.sent(action);
  }
}

/** A shared rule by name (kernel/src/rules_api.rs): what the generator calls in Rust. */
export function rustRule<T = unknown>(name: string, args: object = {}): T {
  return JSON.parse(need().rules(name, JSON.stringify(args)));
}

/** Every Rust actor kind's manifest, by name. */
export function rustManifests(): { [name: string]: any } {
  return JSON.parse(need().manifests());
}

/** The twin brains of a world's mock seats: participant -> its brain, run detached. */
function twinBrains(cfg: any): Map<string, DetachedActor> {
  const brains = new Map<string, DetachedActor>();
  for (const p of cfg.participants ?? []) {
    const pp = p.controller?.params ?? {};
    if (p.controller?.type !== "llm" || !pp.mock?.twin || !pp.mock?.brain) continue;
    const held = (cfg.positions ?? []).filter((x: any) => x.holder === p.id);
    const office = held.length === 1 ? held[0] : undefined;
    // (A twin's brain is its person's own code unit for the post: it draws as that unit does.)
    const asPerson = office ? cfg.participants.find((x: any) => x.person && x.person === p.person && x.id !== p.id && !x.shares_body)?.id : undefined;
    brains.set(p.id, new DetachedActor({ kind: pp.mock.brain, participant: asPerson ?? p.id, capacity: office?.id ?? "self", entity: office?.entity ?? p.person ?? "", system: p.kind === "system", params: pp.mock.params ?? {}, config: cfg }));
  }
  return brains;
}

/** A run of a world on the Rust engine, to its end (or `until`): the same summary the TS host gives, where it has it. */
export async function runRustWorld(o: RunOptions & { seats?: SeatHost; threads?: number }): Promise<RunSummary> {
  const logPath = join(o.outDir, `${o.runId}.jsonl`);
  const anchorsPath = join(o.outDir, `${o.runId}.anchors.jsonl`);
  const t0 = performance.now();
  const world = RustWorld.start(o.config, {
    run_id: o.runId, log: logPath, anchors: anchorsPath, ...(o.until !== undefined ? { until: o.until } : {}), ...(o.threads ? { threads: o.threads } : {}),
    ...(o.audit ? { audit: true } : {}), ...(o.recordDecisions === "none" ? { record_decisions: false } : {}), mock_seats: !o.adapter,
  });
  const brains = o.adapter ? new Map<string, DetachedActor>() : twinBrains(o.config);
  const unhosted = new Set<string>();
  let wakes = 0, seatMs = 0;
  const wakesBy: { [why: string]: number } = {};
  for (;;) {
    if (o.stop?.requested) break;
    const due = world.next();
    if (due.due === "end") break;
    const s0 = performance.now();
    // Every seat of the round at once: none waits on another's model.
    const actions = await Promise.all(due.seats.map(async (s) => {
      wakes++;
      wakesBy[s.woke_for] = (wakesBy[s.woke_for] ?? 0) + 1;
      const brain = brains.get(s.participant);
      if (brain) return brain.step(s.observation, s.woke_for, s.since).action;
      if (o.seats) return await o.seats(s, world);
      if (!unhosted.has(s.participant)) {
        unhosted.add(s.participant);
        world.annotate({ annotation: "note", subject: s.participant, data: { seat_not_hosted: "this seat waits: the Rust world's host has no controller for it yet (docs/port-guide.md section 8)" } });
      }
      return { type: "wait" };
    }));
    seatMs += performance.now() - s0;
    due.seats.forEach((s, i) => world.submit(s.key, actions[i]!));
  }
  const end = world.finish();
  const ms = performance.now() - t0;
  // (Counted from the log as written: what the TS host counts as it goes.)
  let commands = 0, refused = 0;
  const refusedBy: { [code: string]: number } = {};
  if (existsSync(logPath) && statSync(logPath).size < 2_000_000_000) {
    for (const line of readFileSync(logPath, "utf8").split("\n")) {
      if (line.includes('"kind":"command"')) commands++;
      else if (line.includes('"event":"action_refused"')) {
        refused++;
        const code = /"code":"([a-z_]+)"/.exec(line)?.[1] ?? "?";
        refusedBy[code] = (refusedBy[code] ?? 0) + 1;
      }
    }
  }
  const completed = o.until === undefined || o.until >= (o.config.clock?.run_seconds ?? 0);
  return {
    runId: o.runId, end: { reason: completed ? "completed" : "aborted", ...(completed ? {} : { detail: `stopped at ${o.until}` }) }, logPath, anchorsPath, stateHash: end.state_hash,
    commands, refused, wakes, wakesBy, t: end.t, kernelMs: Math.round(ms - seatMs), moduleMs: 0, platformMs: Math.round(seatMs),
    health: { backlog: {}, repeats: {}, refused: refusedBy }, profile: { modules: {}, kernel: {} }, participantErrors: 0,
  };
}
