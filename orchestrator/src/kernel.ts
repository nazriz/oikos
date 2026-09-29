// A client for the kernel's NDJSON protocol (kernel/src/protocol.rs). The
// kernel runs as a subprocess; one request line in, one response line out.

import { existsSync } from "node:fs";
import { join } from "node:path";

export function kernelBinary(): string {
  const env = process.env.TERRARIUM_KERNEL;
  if (env) return env;
  const root = join(import.meta.dir, "../..");
  for (const p of ["kernel/target/release/terrarium-kernel", "kernel/target/debug/terrarium-kernel"]) {
    if (existsSync(join(root, p))) return join(root, p);
  }
  throw new Error("kernel binary not found: run `bun run kernel` (cargo build --release) or set TERRARIUM_KERNEL");
}

/** The kernel refused a request (a protocol error: off-contract input, never logged). */
export class KernelError extends Error {}

/** The kernel process is gone (it crashed, or was killed): nothing more can happen in this run. Never mistaken for a
 * refused request (D59: a dead kernel used to read as "off-contract", and the run would go on against nothing). */
export class KernelDied extends Error {}

export class Kernel {
  private proc: Bun.Subprocess<"pipe", "pipe", "inherit">;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buf = "";
  private decoder = new TextDecoder();
  /** Called before each request is sent (the run's breadcrumbs, D59). */
  onRequest?: (req: any) => void;

  constructor(binary = kernelBinary()) {
    this.proc = Bun.spawn([binary, "serve"], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
    this.reader = this.proc.stdout.getReader();
  }

  private async line(): Promise<string> {
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl >= 0) {
        const l = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        return l;
      }
      const { value, done } = await this.reader.read();
      if (done) {
        const code = await Promise.race([this.proc.exited, Bun.sleep(1000).then(() => undefined)]);
        throw new KernelDied(`the kernel process ended${code === undefined ? "" : ` (exit ${code}${this.proc.signalCode ? `, ${this.proc.signalCode}` : ""})`} while a request was waiting for its reply`);
      }
      this.buf += this.decoder.decode(value, { stream: true });
    }
  }

  /** Send one request; resolves to the reply, or throws KernelError on {ok:false}. */
  async request(req: object): Promise<any> {
    this.onRequest?.(req);
    try {
      this.proc.stdin.write(JSON.stringify(req) + "\n");
      this.proc.stdin.flush();
    } catch (e) {
      throw new KernelDied(`the kernel process can't be written to: ${(e as Error).message}`);
    }
    const reply = JSON.parse(await this.line());
    if (!reply.ok) throw new KernelError(reply.error);
    return reply;
  }

  /**
   * Several requests at once: all written, then the replies read, in order (the kernel takes its requests strictly in
   * turn, so it's the same as sending them one by one, without waiting on each reply). Each reply, or null for a protocol
   * error, as tryRequest.
   */
  async tryRequestMany(reqs: object[]): Promise<(any | null)[]> {
    if (!reqs.length) return [];
    for (const r of reqs) this.onRequest?.(r);
    try {
      this.proc.stdin.write(reqs.map((r) => JSON.stringify(r)).join("\n") + "\n");
      this.proc.stdin.flush();
    } catch (e) {
      throw new KernelDied(`the kernel process can't be written to: ${(e as Error).message}`);
    }
    const out: (any | null)[] = [];
    for (let i = 0; i < reqs.length; i++) {
      const reply = JSON.parse(await this.line());
      out.push(reply.ok ? reply : null);
    }
    return out;
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

  /** End the kernel process at once (a run that failed). */
  kill(): void {
    this.proc.kill();
  }

  async close(): Promise<void> {
    this.proc.stdin.end();
    await this.proc.exited;
  }
}
