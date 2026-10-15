// Payments carry their budget line (docs/behaviour/government.md, "Payments carry their budget line"): a payment from a
// body with an adopted budget names the line it is drawn on (the town's wages on the staff line from the start, an
// invoice by what the brief says pays for it), the transaction both sides' statements show carries it, and the finance
// office's books show room left by line, with what names no line as unallocated. Nothing is refused for lacking one.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const town = { ...spec, seed: 2, citizens: 300, profile: "au-vic-2026", opening_caseload: true, opening_caseload_scale_bps: 1_000_000 };

test("the town's payments name their lines, the books show room by line, and a payment with no line is shown, not refused", async () => {
  const config = generate({ ...town, mayor: "llm", model_seats: ["finance"] }) as any;
  for (const p of config.participants) if (p.controller?.type === "llm") p.controller.params.mock = { ...p.controller.params.mock, back_days: 3 };
  const out = mkdtempSync(join(tmpdir(), "oikos-lines-"));
  const events: any[] = [], recs: any[] = [], refused: any[] = [];
  try {
    const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "lean" } }, runId: "lines", outDir: out, until: 60 * DAY, recordObservations: "none" });
    expect(s.participantErrors).toBe(0);
    for (const l of readFileSync(s.logPath, "utf8").split("\n")) {
      if (l.includes('"event":"transfer"')) { const e = JSON.parse(l); events.push({ t: e.t, ...e.body }); }
      else if (l.includes('"event":"recorded"')) { const r = JSON.parse(l).body.record; if (r?.record === "statement") recs.push(r); }
      else if (l.includes('"event":"refused"')) refused.push(JSON.parse(l));
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
  const fromTown = events.filter((e) => e.from === "acc-city");
  // The town's wages (its works crew, on the staff line from the start) carry it.
  const wages = fromTown.filter((e) => e.memo === "wages");
  expect(wages.length).toBeGreaterThan(5);
  for (const w of wages) expect(["staff", "administration"], `wage ${w.to}`).toContain(w.line); // (the works crew are on the staff line; the town's administrative officers, since foundations F5, on their own)
  // The landfill's invoice is on the services line, paid by finance with its line.
  const landfill = fromTown.filter((e) => e.settles && String(e.settles).startsWith("invoice-landfill"));
  expect(landfill.length).toBeGreaterThan(0);
  for (const p of landfill) expect(p.line).toBe("services");
  // A payment that names no line is made all the same (tax paid over names none): nothing is refused for lacking one.
  expect(fromTown.some((e) => !e.line)).toBe(true);
  expect(refused.filter((r) => /line/i.test(JSON.stringify(r)))).toEqual([]);
  // The office's books show room by line, from those lines, and what is unallocated.
  const books = recs.filter((r) => r.kind === "office_books" && r.data.office === "finance").sort((a, b) => a.at - b.at);
  const budget = (books.at(-1)!.data.open as any[]).find((o) => o.what === "The budget for the year, against what has been paid")!.says as string;
  expect(budget).toMatch(/By line: .*services \$[\d,.]+ drawn of \$[\d,.]+, \$[\d,.]+ left/);
  expect(budget).toMatch(/staff \$[\d,.]+ drawn of \$[\d,.]+, \$[\d,.]+ left/);
  expect(budget).not.toContain("No payment is marked with a line");
}, 300_000);
