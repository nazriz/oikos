// A body founded during a run is named, in the exit account's record, by the name its founder gave it: the run's
// config holds only the bodies it began with (orchestrator/src/run-end.ts, `founded`).
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readForEnd } from "../src/run-end";
import { renderAccountBrief, type AccountBrief } from "@oikos/participants/llm";

test("a founded body reaches the account's prompt by its given name, not its id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "founded-names-"));
  try {
    const log = join(dir, "r.jsonl");
    const ev = (seq: number, body: any) => JSON.stringify({ seq, t: seq, kind: "event", body });
    writeFileSync(log, [
      ev(1, { event: "entity_created", entity: "ent.32", kind: "group", name: "Grievances Taken Up" }),
      ev(2, { event: "entity_created", entity: "ent.33", kind: "group", name: "ent.33" }),
    ].join("\n") + "\n");
    const { founded } = await readForEnd(log, [], undefined, true);
    expect(founded.get("ent.32")).toBe("Grievances Taken Up");
    expect(founded.has("ent.33")).toBe(false); // (no name beyond its id: nothing to say)
    const record = { memory: { defining: [], recent: [{ what: "refused", about: "ent.32", at: 0 }] }, wants: [{ about: "ent.32" }] };
    const b: AccountBrief = { person: "c0007", record, means: { income: "$1", savings: "$1" }, days: 120, names: Object.fromEntries(founded), strata: [], dark: [] };
    const text = renderAccountBrief(b);
    expect(text).toContain("Grievances Taken Up");
    expect(text).not.toContain("ent.32");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
