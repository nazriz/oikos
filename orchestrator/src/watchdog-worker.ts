// The watchdog's thread (watchdog.ts): it watches the run's breadcrumb counter and, if it stops moving for too long,
// writes a diagnosis next to the log and ends the process. It runs beside the main thread, so it still runs when the
// main thread is stuck in a synchronous loop.

import { writeFileSync } from "node:fs";

declare var self: Worker;

self.onmessage = (e: MessageEvent) => {
  const { sab, stallMs, diagnosisPath, runId } = e.data as { sab: SharedArrayBuffer; stallMs: number; diagnosisPath: string; runId: string };
  const counter = new Int32Array(sab, 0, 2);
  let last = Atomics.load(counter, 0);
  let since = Date.now();
  setInterval(() => {
    const now = Atomics.load(counter, 0);
    if (now !== last) {
      last = now;
      since = Date.now();
      return;
    }
    if (Date.now() - since < stallMs) return;
    const len = Atomics.load(counter, 1);
    let doing: unknown = "(nothing recorded)";
    try {
      doing = JSON.parse(new TextDecoder().decode(new Uint8Array(sab, 8, len).slice()));
    } catch {
      // a breadcrumb half-written as time ran out: say so
      doing = "(unreadable)";
    }
    const diagnosis = { run_id: runId, reason: "stalled", stalled_for_ms: Date.now() - since, doing, at: new Date().toISOString(),
      what_next: "Fix the cause, then resume the run: `terrarium resume <log>` re-runs it with every model response served from this log." };
    try {
      writeFileSync(diagnosisPath, JSON.stringify(diagnosis, null, 2));
    } catch {
      // nowhere to write it: stderr still has it
    }
    console.error(`${runId}: stalled for ${Math.round(diagnosis.stalled_for_ms / 1000)} s while ${JSON.stringify(doing)}; diagnosis in ${diagnosisPath}`);
    process.kill(process.pid, "SIGKILL");
  }, Math.max(50, Math.min(1000, Math.floor(stallMs / 10))));
};
