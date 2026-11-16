// Whether any seat was shown the other stake level's words (2026-11-17): for every model fork of an experiment folder,
// every text its seats were shown (each call's system prompt and what it was sent, the debrief's questions included) is
// read for the phrases of the stake level its town does not have (build.ts `wrongStakeWords`). The town's level is its
// support law's own (`date_of_effect`, `decision` where it says none). Exit 1 where any is found.
//
//   bun experiments/scope-pilot/stake-words.ts <experiment folder> ...
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logLines } from "../../orchestrator/src/logs";
import { wrongStakeWords } from "./build";

/** The stake level a town's support law states. */
export function stakeOf(config: any): "first_claim" | "decision" {
  const law = (config.world?.records ?? []).find((r: any) => r.kind === "law" && Array.isArray(r.data?.payments));
  return law?.data?.date_of_effect === "first_claim" ? "first_claim" : "decision";
}

/** Each wrong phrase found in a fork's log: where, and what. */
export function scanLines(lines: Iterable<string>, stake: "first_claim" | "decision"): { at: number; subject: string; found: string[] }[] {
  const out: { at: number; subject: string; found: string[] }[] = [];
  for (const l of lines) {
    if (!l.includes('"transcript"') && !l.includes('"debrief"')) continue;
    let e: any;
    try { e = JSON.parse(l); } catch { continue; }
    const b = e.body ?? {};
    if (b.annotation !== "transcript" && b.annotation !== "debrief") continue;
    const text = JSON.stringify([b.data?.system ?? "", b.data?.input ?? "", b.annotation === "debrief" ? (b.data?.steps ?? []).map((s: any) => s.question) : []]);
    const found = wrongStakeWords(text, stake);
    if (found.length) out.push({ at: e.t ?? 0, subject: String(b.subject ?? ""), found });
  }
  return out;
}

if (import.meta.main) {
  let bad = 0;
  for (const dir of process.argv.slice(2)) {
    for (const sd of readdirSync(dir).filter((d) => d.startsWith("seed-"))) {
      const config = JSON.parse(readFileSync(join(dir, sd, "config.json"), "utf8"));
      const stake = stakeOf(config);
      for (const f of readdirSync(join(dir, sd)).filter((x) => x.endsWith(".oklog") && x !== "base.oklog")) {
        const lines: string[] = [];
        for await (const l of logLines(join(dir, sd, f))) if (l.includes('"transcript"') || l.includes('"annotation":"debrief"')) lines.push(l);
        const found = scanLines(lines, stake);
        console.log(`${dir} ${sd} ${f} (${stake}): ${lines.length} texts read; ${found.length ? `${found.length} with the other level's words, e.g. ${JSON.stringify(found[0])}` : "none with the other level's words"}`);
        bad += found.length;
      }
    }
  }
  process.exit(bad ? 1 : 0);
}
