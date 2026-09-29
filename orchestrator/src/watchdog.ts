// Reliability (D59): a run that stops making progress is stopped, with a diagnosis, rather than hanging silently.
//
// The run leaves a breadcrumb at every point where it could hang (a kernel request, a participant's decision, a model
// call): what it's doing and for whom. A watchdog thread watches the breadcrumbs; if none is left for `stallMs`, it
// writes <run>.failure.json beside the log (what the run was doing when it stalled) and ends the process. It's a
// thread, so it works even when the run is stuck in a synchronous loop (a behaviour module that never returns).
//
// A stall is a timing failure: it can't be recovered in place without results depending on how fast the machine was.
// So the run stops cleanly, and is resumed once the cause is fixed (resume.ts). Failures that are deterministic (a
// module that throws) are recovered in place (run.ts).

const SIZE = 4096;

export class Watchdog {
  private sab = new SharedArrayBuffer(8 + SIZE);
  private counter = new Int32Array(this.sab, 0, 2);
  private text = new Uint8Array(this.sab, 8, SIZE);
  private worker: Worker;
  private encoder = new TextEncoder();
  /** The last breadcrumb, for the run's own error reports. */
  last: object = {};

  constructor(o: { stallMs: number; diagnosisPath: string; runId: string }) {
    this.worker = new Worker(new URL("./watchdog-worker.ts", import.meta.url).href);
    this.worker.postMessage({ sab: this.sab, stallMs: o.stallMs, diagnosisPath: o.diagnosisPath, runId: o.runId });
    (this.worker as unknown as { unref?: () => void }).unref?.(); // never what keeps the process alive
  }

  /** Leave a breadcrumb: what the run is doing now. */
  mark(doing: object): void {
    this.last = doing;
    const { written } = this.encoder.encodeInto(JSON.stringify(doing), this.text); // (straight into the shared buffer)
    Atomics.store(this.counter, 1, written);
    Atomics.add(this.counter, 0, 1);
  }

  stop(): void {
    this.worker.terminate();
  }
}

/** How long a run may go without progress before it's stopped: TERRARIUM_STALL_SECONDS, or 5 minutes (longer than any
 * one model call is allowed: those time out and retry on their own). */
export function stallMs(): number {
  const s = Number(process.env.TERRARIUM_STALL_SECONDS);
  return Number.isFinite(s) && s > 0 ? s * 1000 : 300_000;
}
