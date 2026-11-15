// The regression check over every real request we hold (translator/eval/replay.ts --regress; translator/src/rules.ts,
// its order of precedence): every request a model seat confirmed as drawn, in the real runs extracted, must still be
// drawn and shown the same by the rules now, or be explained in docs/decisions.md (regress-explained.json). Three rules
// keyed on one run's phrasing broke twelve of the next run's requests (2026-11-15); this is what would have caught it.
//
// It reads the compact extract on the run server ($OIKOS_RUNS/regress/requests.json.gz, written by
// `bun translator/eval/replay.ts --regress <runs...> --extract <file>`), not the logs, and never the held-out pilot
// cases' runs. Run logs and what is made of them stay out of git, so where the extract is not (a hosted runner), it
// says so and checks nothing: the gate runs on the run server, where it is.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { changesBetween, expand, explainedKeys, keyOf, regressions, type CompactArm } from "../eval/requests";

const extract = process.env.OIKOS_REGRESS_EXTRACT ?? join(process.env.OIKOS_RUNS ?? join(homedir(), "oikos/runs"), "regress", "requests.json.gz");

test.skipIf(!existsSync(extract))("every real request a seat confirmed as drawn is drawn and shown the same, or explained", async () => {
  const arms = (JSON.parse(gunzipSync(readFileSync(extract)).toString()) as CompactArm[]).map(expand);
  const explained = await explainedKeys(join(import.meta.dir, "regress-explained.json"));
  let confirmed = 0;
  const open: string[] = [];
  for (const a of arms) {
    const r = regressions(a);
    confirmed += r.confirmed;
    for (const d of r.differences) if (!explained.has(keyOf(d))) open.push(`${d.run} ${d.arm} ${d.ref} (by ${d.rules.join(", ") || "no rule"}): ${changesBetween(d.logged, d.now)}`);
  }
  expect(confirmed).toBeGreaterThan(600);
  expect(open).toEqual([]);
});

if (!existsSync(extract)) console.log(`(regress.test.ts: no extract at ${extract}: the regression check over real requests did not run.)`);
