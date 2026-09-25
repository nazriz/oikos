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

export class KernelError extends Error {}

export class Kernel {
  private proc: Bun.Subprocess<"pipe", "pipe", "inherit">;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buf = "";
  private decoder = new TextDecoder();

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
      if (done) throw new KernelError("kernel exited");
      this.buf += this.decoder.decode(value, { stream: true });
    }
  }

  /** Send one request; resolves to the reply, or throws KernelError on {ok:false}. */
  async request(req: object): Promise<any> {
    this.proc.stdin.write(JSON.stringify(req) + "\n");
    this.proc.stdin.flush();
    const reply = JSON.parse(await this.line());
    if (!reply.ok) throw new KernelError(reply.error);
    return reply;
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

  async close(): Promise<void> {
    this.proc.stdin.end();
    await this.proc.exited;
  }
}
