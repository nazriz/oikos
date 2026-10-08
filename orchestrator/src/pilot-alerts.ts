// Alerts during a wave of pilots, kept boring: a line in <runs>/pilot-queues/<wave>.alerts.log (local time with its offset,
// append-only), a macOS notification where there is one (skipped quietly elsewhere, or with OIKOS_NO_NOTIFY), and
// OIKOS_ALERT_CMD if set: a shell command given the line on its standard input, for whatever is wired up later.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import { localStamp } from "./pilot-state";

export const alertsPath = (runs: string, wave: string) => join(runs, "pilot-queues", `${wave}.alerts.log`);

/** Say something that Naz should hear about. Never throws: an alert that can't be delivered must not stop a queue. */
export function alert(runs: string, wave: string, message: string): string {
  const line = `${localStamp()} ${message}`;
  try {
    mkdirSync(join(runs, "pilot-queues"), { recursive: true });
    appendFileSync(alertsPath(runs, wave), line + "\n");
  } catch { /* (the log is out of reach: the other ways still try) */ }
  if (platform() === "darwin" && !process.env.OIKOS_NO_NOTIFY) {
    try {
      const esc = (x: string) => x.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      Bun.spawnSync(["osascript", "-e", `display notification "${esc(message.slice(0, 200))}" with title "Oikos pilots: ${esc(wave)}"`], { stdout: "ignore", stderr: "ignore" });
    } catch { /* (no osascript) */ }
  }
  const hook = process.env.OIKOS_ALERT_CMD;
  if (hook) {
    try {
      Bun.spawnSync(["sh", "-c", hook], { stdin: Buffer.from(line + "\n"), stdout: "ignore", stderr: "ignore" });
    } catch { /* (the hook is the operator's; it failing is not the queue's) */ }
  }
  return line;
}

/** The last alerts of a wave, oldest first. */
export function lastAlerts(runs: string, wave: string, n = 5): string[] {
  const p = alertsPath(runs, wave);
  return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).slice(-n) : [];
}
