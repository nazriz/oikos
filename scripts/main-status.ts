#!/usr/bin/env bun
// What CI last said about main, for the merge script: `bun scripts/main-status.ts record <sha> <status>` (the CI job's
// last step writes it, on this machine), `bun scripts/main-status.ts show`. The marker is a file (~/.oikos/main-ci.json,
// OIKOS_CI_STATUS to move it). Cancelled runs (a newer push replaced them) are not recorded: they say nothing.
// The merge script refuses to merge while the latest recorded result is a failure on a commit that is in main
// (`blocker`), until a later run passes or `--fix-main` is given (the merge that repairs main).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface MainStatus { sha: string; status: "success" | "failure"; at: string }
export const statusPath = () => process.env.OIKOS_CI_STATUS ?? join(homedir(), ".oikos", "main-ci.json");

export function readStatus(path = statusPath()): MainStatus | undefined {
  try { const s = JSON.parse(readFileSync(path, "utf8")); return s?.sha && (s.status === "success" || s.status === "failure") ? s : undefined; } catch { return undefined; }
}
/** Records a result; "cancelled" and "skipped" are ignored (returns false). */
export function record(sha: string, status: string, path = statusPath(), at = new Date().toISOString()): boolean {
  if (status !== "success" && status !== "failure") return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ sha, status, at } satisfies MainStatus));
  return true;
}
/** Why a merge must not go ahead (undefined: it may). `inMain(sha)` says whether the failed commit is in origin/main. */
export function blocker(s: MainStatus | undefined, inMain: (sha: string) => boolean): string | undefined {
  if (!s || s.status !== "failure" || !inMain(s.sha)) return undefined;
  return `CI failed on main at ${s.sha.slice(0, 8)} (${s.at}) and no later run has passed. Fix main first; the merge that repairs it takes --fix-main. (bun scripts/main-status.ts show)`;
}
/** The same from `gh run list` JSON (newest first), when gh works: the latest finished, non-cancelled run. */
export function fromRuns(runs: { conclusion: string; headSha: string }[]): MainStatus | undefined {
  const r = runs.find((x) => x.conclusion === "success" || x.conclusion === "failure");
  return r ? { sha: r.headSha, status: r.conclusion as "success" | "failure", at: "gh" } : undefined;
}

if (import.meta.main) {
  const [cmd, sha, status] = process.argv.slice(2);
  if (cmd === "record" && sha && status) console.log(record(sha, status) ? `recorded ${status} for ${sha.slice(0, 8)}` : `ignored (${status})`);
  else if (cmd === "show") console.log(existsSync(statusPath()) ? JSON.stringify(readStatus() ?? "unreadable") : "no result recorded yet");
  else { console.error("usage: bun scripts/main-status.ts record <sha> <status> | show"); process.exit(2); }
}
