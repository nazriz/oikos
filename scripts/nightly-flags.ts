// The nightly flags (law 12, step L3: docs/flags.md): a code-only year of three profiles' towns, each measured and flagged
// as any batch is, its flags printed for whoever reads the night's log. Printed, never failing: a flag is a finding for the
// risk register, not a test (ci.yml runs this with continue-on-error, on the schedule only). No model is called.
// `bun scripts/nightly-flags.ts [--citizens N] [--days D] [profile...]`.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name: string, d: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1]! : d; };
const citizens = flag("citizens", "300"), days = Number(flag("days", "365"));
const profiles = args.length ? args : ["au-vic-2026", "gb-eng-2026", "us-oh-2026"];
const repo = join(import.meta.dir, "..");
let failed = 0;
for (const profile of profiles) {
  const out = mkdtempSync(join(tmpdir(), `oikos-flags-${profile}-`));
  try {
    const r = Bun.spawnSync([process.execPath, join(repo, "orchestrator/src/cli.ts"), "run", join(repo, "worlds/town.yaml"), "--set", `citizens=${citizens}`, "--set", `profile=${profile}`, "--until", String(days * 86_400), "--out", out, "--overwrite"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    console.log(`\n== ${profile}: a code-only town of ${citizens}, ${days} days`);
    if (r.exitCode !== 0) { failed++; console.log(`the run failed (${r.exitCode}):\n${r.stderr.toString().slice(-2000)}`); continue; }
    console.log(readFileSync(join(out, "flags.txt"), "utf8"));
  } finally { rmSync(out, { recursive: true, force: true }); }
}
process.exit(failed ? 1 : 0);
