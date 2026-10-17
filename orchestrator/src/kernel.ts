// A client for the kernel's protocol (kernel/src/protocol.rs): one request in, one reply out. The engine runs
// in-process through its native module (kernel/crates/napi; docs/design/rebuild.md section 5.1) when it's built, or as
// a subprocess speaking the same requests over stdio (OIKOS_ENGINE=stdio, or no native module).

import { existsSync } from "node:fs";
import { join } from "node:path";

export function kernelBinary(): string {
  const env = process.env.OIKOS_KERNEL;
  if (env) return env;
  const root = join(import.meta.dir, "../..");
  for (const p of ["kernel/target/release/oikos-kernel", "kernel/target/debug/oikos-kernel"]) {
    if (existsSync(join(root, p))) return join(root, p);
  }
  throw new Error("kernel binary not found: run `bun run kernel` (cargo build --release) or set OIKOS_KERNEL");
}

/** The engine's native module (kernel/crates/napi), if built: `bun run kernel` builds it with the binary. */
export function engineModule(): string | undefined {
  const env = process.env.OIKOS_ENGINE_MODULE;
  if (env) return env;
  const root = join(import.meta.dir, "../..");
  for (const dir of ["kernel/target/release", "kernel/target/debug"]) for (const f of ["liboikos_napi.dylib", "liboikos_napi.so", "oikos_napi.dll"]) {
    if (existsSync(join(root, dir, f))) return join(root, dir, f);
  }
  return undefined;
}

interface NativeSession { request(line: string): string; close(): void }
let native: { KernelSession: { new (): NativeSession; source(): string } } | undefined;
/** Loads the native module, refusing one built from other sources than the kernel binary found beside it (kernel/build.rs's
 * fingerprint): building only the binary (`cargo test`, say) leaves a stale module that would write logs the binary
 * can't replay, and a quiet divergence costs more than a loud stop. */
function loadNative(path: string) {
  native ??= (globalThis as { __oikosNative?: typeof native }).__oikosNative;
  if (!native) {
    const m = { exports: {} as any };
    process.dlopen(m, path);
    const bin = process.env.OIKOS_ENGINE_MODULE ? undefined : join(path, "..", "oikos-kernel");
    if (bin && existsSync(bin)) {
      const theirs = /source (\w+)/.exec(Bun.spawnSync([bin, "version"]).stdout.toString())?.[1];
      const ours = m.exports.KernelSession.source?.();
      if (theirs !== ours)
        throw new Error(`the engine's native module (source ${ours ?? "unknown"}) and the kernel binary beside it (source ${theirs ?? "unknown"}) were built from different sources: run \`bun run kernel\` (or OIKOS_ENGINE=stdio)`);
    }
    native = m.exports;
    // (Shared with the generator's loader, worlds/generator/rules.ts: a native module is loaded once a process.)
    (globalThis as { __oikosNative?: unknown }).__oikosNative ??= native;
  }
  return native!;
}

/** The engine's native module, loaded (and checked against the binary beside it), for the Rust world's host
 * (orchestrator/src/rust-world.ts): its `World`, `Detached`, `rules` and `manifests`. Undefined where it isn't built. */
export function nativeEngine(): any | undefined {
  const mod = engineModule();
  return mod ? loadNative(mod) : undefined;
}

/** The kernel refused a request (a protocol error: off-contract input, never logged). */
export class KernelError extends Error {}

/** The kernel process is gone (it crashed, or was killed): nothing more can happen in this run. Never mistaken for a
 * refused request (D59: a dead kernel used to read as "off-contract", and the run would go on against nothing). */
export class KernelDied extends Error {}

/** The kernel couldn't write its log (a full or unwritable disk, say): the world may have moved on without its record,
 * so the run ends here. Never mistaken for a refused request: a skipped command would be a silent hole in the run. */
export class KernelLogFailed extends Error {}

/** A reply read: itself, or (for a log that couldn't be written) the end of the run. */
function parseReply(line: string): any {
  const reply = JSON.parse(line);
  if (!reply.ok && reply.fatal) throw new KernelLogFailed(`the kernel couldn't write the run's log (${reply.error}): the run can't go on. Check the disk the log is on (space, permissions), then resume the run.`);
  return reply;
}

/** A value and everything in it, never to be changed again. */
function frozen<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    for (const x of Object.values(v)) frozen(x);
    Object.freeze(v);
  }
  return v;
}

/** What a request is, for the profile: its op, and for a command which one. */
const opOf = (req: any): string => (req.op === "command" ? req.command?.command ?? "command" : req.op ?? "?");

export class Kernel {
  private proc?: Bun.Subprocess<"pipe", "pipe", "inherit">;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private session?: NativeSession;
  private dead?: string; // an in-process session ended by kill(): why
  private buf = "";
  /** The stdio transport's queue: the exchange before this one (its requests written, its replies read). */
  private turn: Promise<unknown> = Promise.resolve();
  private decoder = new TextDecoder();
  /** Every record the engine has handed over, by id. A record never changes once made, and one record is shown to many
   * (a register of lots, to everyone who reads it): the engine hands each over whole once and by its id from then on
   * (`record_refs`, kernel/src/protocol.rs), so it's read once, and everyone it's shown to has the same one (which is
   * why it's frozen: what one reader did to it, every other would see). */
  private records = new Map<string, object>();
  /** Called before each request is sent (the run's breadcrumbs, D59). */
  onRequest?: (req: any) => void;
  /** How the engine runs: in this process, or as a subprocess. */
  readonly transport: "inprocess" | "stdio";
  /** Where the time went, by request (profiling only; never logged): writing the request, the engine's own work, and
   * reading its reply, in milliseconds. (Over stdio the three can't be told apart: all of it is under `engine`.) */
  readonly profile: { [op: string]: { n: number; encode: number; engine: number; decode: number } } = {};

  constructor(binary?: string) {
    const mod = binary === undefined && process.env.OIKOS_ENGINE !== "stdio" ? engineModule() : undefined;
    if (mod) {
      this.transport = "inprocess";
      this.session = new (loadNative(mod).KernelSession)();
    } else {
      this.transport = "stdio";
      this.proc = Bun.spawn([binary ?? kernelBinary(), "serve"], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
      this.reader = this.proc.stdout.getReader();
    }
  }

  /** A request as it's sent: a run is started asking for records by reference. */
  private sent(req: object): object {
    return (req as { op?: unknown }).op === "start" ? { ...req, record_refs: true } : req;
  }

  /** A reply as its reader gets it: in an observation's records channels, each record handed over before (its id, a
   * string) is the record itself again. */
  private whole(reply: any): any {
    const channels = reply?.observation?.channels;
    if (!channels) return reply;
    // (Those handed over whole are kept first: the same record may come whole in one channel and by its id in another.)
    const lists: (string | { id: string })[][] = [];
    for (const path in channels) {
      const records = channels[path].records;
      if (!records?.length) continue;
      lists.push(records);
      for (const r of records) if (typeof r !== "string") this.records.set(r.id, frozen(r));
    }
    for (const records of lists) for (let i = 0; i < records.length; i++) {
      const r = records[i]!;
      if (typeof r !== "string") continue;
      const had = this.records.get(r);
      if (!had) throw new KernelDied(`the engine referred to a record it never handed over (${r})`);
      records[i] = had as { id: string };
    }
    return reply;
  }

  /** One request in-process: the same line in, the same line out. */
  private local(req: object): any {
    if (this.dead) throw new KernelDied(this.dead);
    const t0 = performance.now();
    const line = JSON.stringify(this.sent(req));
    const t1 = performance.now();
    const raw = this.session!.request(line);
    const t2 = performance.now();
    const reply = this.whole(parseReply(raw));
    const p = (this.profile[opOf(req)] ??= { n: 0, encode: 0, engine: 0, decode: 0 });
    p.n++;
    p.encode += t1 - t0;
    p.engine += t2 - t1;
    p.decode += performance.now() - t2;
    return reply;
  }

  /** Over stdio, one exchange at a time, in the order asked: a reply is matched to its request only by its place in
   * the stream, so a request written while another's reply is awaited would take that reply (or wait for ever). */
  private exchange(reqs: object[]): Promise<any[]> {
    const ops = reqs.map(opOf);
    const lines = reqs.map((r) => JSON.stringify(this.sent(r)));
    const mine = this.turn.then(async () => {
      try {
        this.proc!.stdin.write(lines.join("\n") + "\n");
        this.proc!.stdin.flush();
      } catch (e) {
        throw new KernelDied(`the kernel process can't be written to: ${(e as Error).message}`);
      }
      // Every reply is read before any is judged: a fatal one mustn't leave the others in the stream.
      const t0 = performance.now();
      const raw: string[] = [];
      for (let i = 0; i < lines.length; i++) raw.push(await this.line());
      const dt = (performance.now() - t0) / lines.length;
      for (const op of ops) {
        const p = (this.profile[op] ??= { n: 0, encode: 0, engine: 0, decode: 0 });
        p.n++;
        p.engine += dt;
      }
      return raw.map((line) => this.whole(parseReply(line)));
    });
    this.turn = mine.catch(() => {});
    return mine;
  }

  private async line(): Promise<string> {
    const proc = this.proc!, reader = this.reader!;
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl >= 0) {
        const l = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        return l;
      }
      const { value, done } = await reader.read();
      if (done) {
        const code = await Promise.race([proc.exited, Bun.sleep(1000).then(() => undefined)]);
        throw new KernelDied(`the kernel process ended${code === undefined ? "" : ` (exit ${code}${proc.signalCode ? `, ${proc.signalCode}` : ""})`} while a request was waiting for its reply`);
      }
      this.buf += this.decoder.decode(value, { stream: true });
    }
  }

  /** Why the last request that `tryRequestMany` gave null for was not taken (the kernel's words: for the log, never for a participant). */
  lastError = "";

  /** Send one request; resolves to the reply, or throws KernelError on {ok:false}. */
  async request(req: object): Promise<any> {
    this.onRequest?.(req);
    if (this.session) {
      const reply = this.local(req);
      if (!reply.ok) throw new KernelError(reply.error);
      return reply;
    }
    const [reply] = await this.exchange([req]);
    if (!reply.ok) throw new KernelError(reply.error);
    return reply;
  }

  /**
   * Several requests at once: all written, then the replies read, in order (the kernel takes its requests strictly in
   * turn, so it's the same as sending them one by one, without waiting on each reply). Each reply, or null for a protocol
   * error, as tryRequest; a log the kernel couldn't write is neither (KernelLogFailed: the run ends).
   */
  async tryRequestMany(reqs: object[]): Promise<(any | null)[]> {
    if (!reqs.length) return [];
    for (const r of reqs) this.onRequest?.(r);
    const taken = (reply: any) => {
      if (!reply.ok) this.lastError = String(reply.error ?? "");
      return reply.ok ? reply : null;
    };
    if (this.session) return reqs.map((r) => taken(this.local(r)));
    return (await this.exchange(reqs)).map(taken);
  }

  /** Like request, but returns null instead of throwing on a protocol error. */
  async tryRequest(req: object): Promise<any | null> {
    try {
      return await this.request(req);
    } catch (e) {
      if (e instanceof KernelError) return null;
      throw e;
    }
  }

  /** End the kernel at once (a run that failed): a subprocess is killed; an in-process session is ended, and every
   * request after it fails as a dead kernel's would. */
  kill(): void {
    if (this.session) {
      this.dead = "the kernel was ended while the run was going on";
      this.session.close();
    } else this.proc!.kill();
  }

  async close(): Promise<void> {
    if (this.session) {
      this.session.close();
      return;
    }
    this.proc!.stdin.end();
    await this.proc!.exited;
  }
}
