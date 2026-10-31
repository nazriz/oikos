// The engine, driven from TypeScript through the native module (docs/design/rust-port.md 2.3): `RustWorld` starts,
// steps, forks and resumes a world (the experiment harness drives its seats round by round: experiment.ts), and
// `DetachedActor` runs one of the engine's kinds detached, as a mock seat's brain that sits as its code twin, the same
// code the engine runs for that post, so the twin is exact. A pilot's run goes through `runWorld` (run.ts), whose
// kernel is the same engine.

import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { nativeEngine } from "./kernel";

export interface SeatWake { key: string; participant: string; t: number; woke_for: string; since: number; observation: any }

export interface RustOptions {
  run_id?: string;
  /** The log's path: `.jsonl` the JSONL log, anything else the binary log (snapshots and forks). Absent: in memory. */
  log?: string;
  anchors?: string;
  threads?: number;
  until?: number;
  stand_in?: string;
  record_decisions?: boolean;
  /** Capture the citizens' decisions to this file, for training (docs/citizen-data.md); changes nothing in the run. */
  capture_citizens?: string;
  audit?: boolean;
  snapshot_every_days?: number;
  stream?: { cap?: number; kinds?: string[] };
  /** A fork's: its label, and its parent's log as its own names it (relative to itself). */
  label?: string;
  parent?: string;
  mock_seats?: boolean;
  /** Acts not carried out (a researcher's intervention: kernel/src/engine.rs `Withhold`; docs/experiments.md). */
  withhold?: { what: string; participant?: string; nth?: number; matter?: string; to?: string; has?: string }[];
  /** Acts carried out at a fork's moment in a participant's name (a researcher's intervention: kernel/src/engine.rs `AtFork`). */
  at_fork?: { participant: string; as?: string; call: string; why: string }[];
}

const need = () => {
  const n = nativeEngine();
  if (!n?.World) throw new Error("the Rust world needs the engine's native module: run `bun run kernel`");
  return n;
};

/** How many participants make a config large enough to go to the engine as a file (`RustWorld.start`). */
export const LARGE_CONFIG = 10_000;

/**
 * A config written as JSON text to `path` without making it one string: its members one at a time, and the elements
 * of its long lists (participants, positions, the world's entities and records) one at a time. The same text as
 * `JSON.stringify(config)` (key order and all), so the same config.
 */
export function writeConfigFile(config: object, path: string): void {
  const fd = openSync(path, "w");
  let buf = "";
  const put = (s: string) => {
    buf += s;
    if (buf.length >= 1 << 20) { writeSync(fd, buf); buf = ""; }
  };
  const value = (v: unknown, depth: number) => {
    if (Array.isArray(v) && v.length > 100) {
      put("[");
      v.forEach((x, i) => put((i ? "," : "") + (JSON.stringify(x) ?? "null")));
      put("]");
    } else if (depth < 2 && v !== null && typeof v === "object" && !Array.isArray(v) && typeof (v as any).toJSON !== "function") {
      put("{");
      let first = true;
      for (const [k, x] of Object.entries(v)) {
        if (x === undefined || typeof x === "function" || typeof x === "symbol") continue;
        put((first ? "" : ",") + JSON.stringify(k) + ":");
        first = false;
        value(x, depth + 1);
      }
      put("}");
    } else put(JSON.stringify(v) ?? "null");
  };
  try {
    value(config, 0);
    if (buf) writeSync(fd, buf);
  } finally {
    closeSync(fd);
  }
}

/** The engine's world, as the host holds it. */
export class RustWorld {
  private constructor(private w: any) {}
  static start(config: object, opts: RustOptions = {}, viaFile = ((config as any).participants?.length ?? 0) >= LARGE_CONFIG): RustWorld {
    // A large town's config is over a gigabyte of JSON (1.39 GB at 50,000 people), past what one string may hold at
    // 100,000: it goes to the engine as a file written member by member and participant by participant, which the
    // engine reads the same way (kernel config::load_from). The same text either way, so the same run.
    if (viaFile) {
      const file = join(mkdtempSync(join(tmpdir(), "oikos-config-")), "config.json");
      try {
        writeConfigFile(config, file);
        return new RustWorld(new (need().World)("", JSON.stringify({ ...opts, config_file: file })));
      } finally {
        rmSync(dirname(file), { recursive: true, force: true });
      }
    }
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
  /** What a seat's call would come to from what it has been shown (the engine's resolver; nothing changes, nothing logged). */
  resolve(participant: string, program: string, as?: string, names?: { [id: string]: string }): { blocks?: any[]; questions?: string[]; invalid?: string[] } {
    return JSON.parse(this.w.resolve(participant, program, as ?? null, names && Object.keys(names).length ? JSON.stringify(names) : null));
  }
  /** Whether these blocks would be carried out for the participant now (the kernel's dry run; nothing changes). */
  check(participant: string, as: string | undefined, blocks: object[]): { ok: boolean; refusal?: any } {
    return JSON.parse(this.w.check(participant, as ?? null, JSON.stringify(blocks)));
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
  /** Write what the log holds so far to its file (before a snapshot of this run is resumed in another process). */
  flush(): void {
    this.w.flush();
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
  constructor(readonly spec: { kind: string; participant: string; capacity: string; entity: string; system?: boolean; params?: object; seed?: number; config: object; saved?: object }) {
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
  /** When the engine's unit of this kind would first wake, and how often (seconds, before the tick rounds them). */
  schedule(): { firstWake: number; cadence: number } {
    const [firstWake, cadence] = this.a.schedule() as number[];
    return { firstWake: firstWake!, cadence: cadence! };
  }
}

/** The kernel's observation as it was sent (what is new since the last), kept on the picture the host's view made of it:
 * a brain run detached keeps its own view, as the engine's unit does, and is handed what the kernel sent, never the host's
 * picture (taken in again, a holding gone to nothing or an account closed would be kept: the picture leaves them out). */
export const RAW = Symbol("the kernel's observation");

/** Two of the kernel's observations of one participant, one after the other, as one: what a detached brain would have
 * been sent had nobody looked between them (a twin seat's brain shown an observation on a turn it took no step at).
 * Lists are the earlier's then the later's, as a view takes them in, one after the other; a channel's picture sent
 * whole in the later starts from it; readings as last delivered; the rest is the later's. */
export function joinRaw(a: any, b: any): any {
  const channels: { [id: string]: any } = { ...b.channels };
  for (const [id, x] of Object.entries<any>(a.channels ?? {})) {
    const y = b.channels?.[id];
    if (!y) { if (!x.search) channels[id] = x; continue; }
    if (x.kind !== y.kind || y.whole || y.search) continue;
    if (y.kind === "records") channels[id] = { ...y, records: [...x.records.filter((r: any) => !y.records.some((q: any) => q.id === r.id)), ...y.records], ...(x.whole ? { whole: true } : {}) };
    else if (y.kind === "accounts") channels[id] = { ...y, accounts: [...x.accounts, ...y.accounts], transactions: [...x.transactions, ...y.transactions] };
    else if (y.kind === "holdings") channels[id] = { ...y, holdings: [...x.holdings, ...y.holdings] };
    else if (y.kind === "sites") channels[id] = { ...y, cells: [...x.cells, ...y.cells], ...(x.whole ? { whole: true } : {}), ...(x.visited || y.visited ? { visited: true } : {}) };
    else if (y.kind === "directory") channels[id] = { ...y, entities: [...x.entities, ...y.entities], positions: [...x.positions, ...y.positions] };
  }
  const readings = a.readings || b.readings ? { readings: { ...(a.readings ?? {}), ...(b.readings ?? {}) } } : {};
  return { ...b, channels, outcomes: [...(a.outcomes ?? []), ...(b.outcomes ?? [])], inbox: [...(a.inbox ?? []), ...(b.inbox ?? [])], ...readings };
}

/** A shared rule by name (kernel/src/rules_api.rs): what the generator calls in Rust. */
export function rustRule<T = unknown>(name: string, args: object = {}): T {
  return JSON.parse(need().rules(name, JSON.stringify(args)));
}

/** Every Rust actor kind's manifest, by name. */
export function rustManifests(): { [name: string]: any } {
  return JSON.parse(need().manifests());
}

/** What a world's mock seats that sit as their code twins need to have a brain run detached: participant -> the spec of
 * its brain (a `DetachedActor`'s; `saved` added when one is taken up again). */
export function twinSpecs(cfg: any): Map<string, ConstructorParameters<typeof DetachedActor>[0]> {
  const specs = new Map<string, ConstructorParameters<typeof DetachedActor>[0]>();
  for (const p of cfg.participants ?? []) {
    const pp = p.controller?.params ?? {};
    if (p.controller?.type !== "llm" || !pp.mock?.twin || !pp.mock?.brain) continue;
    const held = (cfg.positions ?? []).filter((x: any) => x.holder === p.id);
    const office = held.length === 1 ? held[0] : undefined;
    // (A twin's brain is its person's own code unit for the post: it draws as that unit does.)
    const asPerson = office ? cfg.participants.find((x: any) => x.person && x.person === p.person && x.id !== p.id && !x.shares_body)?.id : undefined;
    specs.set(p.id, { kind: pp.mock.brain, participant: asPerson ?? p.id, capacity: office?.id ?? "self", entity: office?.entity ?? p.person ?? "", system: p.kind === "system", params: pp.mock.params ?? {}, config: cfg });
  }
  return specs;
}
