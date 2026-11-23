// The requests of a seat that may direct the town's offices which went to such an office other than as a direction, for
// whoever reads a run (docs/decisions.md, "An order to an office is not a letter"). Two kinds, one line each:
//   `asked_back`: read as an order that fills none of the office's forms. Nothing was sent: an attempt, not an act.
//   `letter`: a letter to that office. It may be an order the rule could not recognise, or an ordinary letter: a reader
//   decides from its words. Either way the office was given no direction by it.
// Read-only on the runs. No model is called.
//
//   bun translator/eval/orders-as-letters.ts <run folder, .oklog or extract .json.gz>...
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { calls } from "@oikos/participants";
import type { Knowledge } from "../src/knowledge";
import { letterToDirected, ORDER_NOT_SENT } from "../src/rules";
import { expand, readArm, withKnowledge, type ArmLog, type CompactArm, type LoggedRequest } from "./requests";

export interface OrderAttempt { kind: "asked_back" | "letter"; office?: string; decision?: string }

/** What a request was, if it is either kind above. */
export function orderAttempt(r: LoggedRequest, k: Knowledge): OrderAttempt | undefined {
  if (r.failure?.startsWith(ORDER_NOT_SENT)) return { kind: "asked_back", office: /An order to (\S+) is given/.exec(r.failure)?.[1] };
  if (!r.call) return undefined;
  try {
    const office = letterToDirected(calls.parseProgram(r.call), k);
    return office ? { kind: "letter", office, ...(r.decision ? { decision: r.decision } : {}) } : undefined;
  } catch { return undefined; }
}

function logsIn(path: string): string[] {
  if (path.endsWith(".oklog")) return [path];
  const seeds = readdirSync(path).filter((d) => d.startsWith("seed-")).map((d) => join(path, d));
  return (seeds.length ? seeds : [path]).flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".oklog") && f !== "base.oklog" && f !== "code.oklog").map((f) => join(d, f)));
}

if (import.meta.main) {
  const paths = process.argv.slice(2);
  if (!paths.length || !paths.every(existsSync)) { console.error("usage: bun translator/eval/orders-as-letters.ts <run folder, .oklog or extract .json.gz>..."); process.exit(2); }
  const scratch = mkdtempSync(join(tmpdir(), "oikos-orders-"));
  const counts = { asked_back: 0, letter: 0, requests: 0 };
  try {
    for (const path of paths) {
      const arms: ArmLog[] = path.endsWith(".json.gz") ? (JSON.parse(gunzipSync(readFileSync(path)).toString()) as CompactArm[]).map(expand)
        : await Promise.all(logsIn(statSync(path).isDirectory() ? path : path).map((l) => readArm(l, basename(path), mkdtempSync(join(scratch, "a-")))));
      for (const a of arms) for (const [r, k] of withKnowledge(a)) {
        counts.requests++;
        const x = orderAttempt(r, k);
        if (!x) continue;
        counts[x.kind]++;
        console.log(JSON.stringify({ run: a.run, arm: a.arm, seat: r.seat, ref: r.ref, ...x, request: r.request }));
      }
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  console.error(`${counts.requests} requests: ${counts.asked_back} orders asked back (nothing sent), ${counts.letter} letters to an office the seat directs (read each).`);
}
