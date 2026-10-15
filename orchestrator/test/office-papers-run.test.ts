// Offices held by a seat do their paperwork on their own forms, in a run (docs/behaviour/office-papers.md;
// docs/design/call-language-gaps.md B.6). A town with more deaths than life, whose works office has still to take its
// crew on, with the registrar, the works manager, a landlord and the lender each handed to the mock (the office's own
// code as its brain, saying each paper as a seat would: on the office's form for it). Every typed paper those offices
// issue that has a form goes through the form, the engine's resolver writes it, and the town acts on it as it does
// on the module's own: deaths are registered, the crew is advertised for and taken on, homes are listed and let.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modules } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { officesBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const SEATS = ["registry", "works", "landlord-1-office", "bank-lending"];

test("seats in the registry, the works office, a letting office and the lender issue their papers on their own forms, and the town goes on", async () => {
  const config = generate({ ...spec, works_crew_at_start: 0, model_seats: SEATS });
  config.life.other_causes.by_age = [{ from: 0, bps: 0 }, { from: 25, bps: 2500 }];
  for (const x of officesBy(config, "city.council_clerk")) Object.assign(x.params, { vote_days: 5 });
  // Each seat has its office's stationery on file, seen by its organisation alone; a code office has none.
  const forms = (config.world.records as any[]).filter((r) => r.kind === "form" && r.data?.writes);
  expect(forms.filter((f) => f.data.office === "registry").map((f) => f.data.form)).toEqual(["death_registration", "death_certificate", "birth_registration", "transmission_application"]);
  expect(forms.every((f) => SEATS.includes(f.data.office) && f.visible_to.length === 1)).toBe(true);
  const kinds = new Map(SEATS.map((id) => [`${id}-system`, new Set((modules[config.positions.find((p: any) => p.id === id).role_module.code]!.issues ?? []).map((x) => x.writes.kind))]));

  const s = await runWorld({ config, runId: "papers", outDir: mkdtempSync(join(tmpdir(), "oikos-office-papers-")), until: 50 * DAY });
  expect(s.participantErrors).toBe(0);
  const lines = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const events = lines.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const records = events.filter((e) => e.event === "recorded").map((e) => e.record);

  // What each seat said: every paper its office has a form for was said on the form, never as a plain statement.
  const onForm = new Map<string, number>(), plain: string[] = [];
  for (const e of lines) {
    if (e.kind !== "command" || !kinds.has(e.body.participant)) continue;
    for (const line of String(e.body.provenance?.call ?? "").split("\n")) {
      const form = /^(?:[a-z0-9_]+ = )?form\(.*?form=([a-z_]+)/.exec(line)?.[1];
      const kind = /^(?:[a-z0-9_]+ = )?statement\(.*?kind=([a-z_]+)/.exec(line)?.[1];
      if (form) onForm.set(form, (onForm.get(form) ?? 0) + 1);
      if (kind && kinds.get(e.body.participant)!.has(kind)) plain.push(`${e.body.participant}: ${kind}`);
    }
  }
  expect(plain).toEqual([]);

  // The registrar: each death that was reported is in the register, entered on the form, with the land applied for.
  const died = events.filter((e) => e.event === "person_died").map((e) => e.person as string);
  const entries = records.filter((r) => r.kind === "death_registration");
  expect(died.length).toBeGreaterThan(1);
  expect(entries.length).toBeGreaterThan(1);
  expect(onForm.get("death_registration")).toBe(entries.length);
  expect(onForm.get("transmission_application")).toBe(entries.length);
  for (const r of entries) {
    expect(r).toMatchObject({ author: "registry-system", in_position: "registry", speaks_for: "city" });
    expect(died).toContain(r.data.deceased);
    expect(r.basis).toMatch(/^rec\./);
    expect(r.addressed_to).toContain(r.data.reported_by);
  }
  // Those who died early enough for someone to have reported them are all registered.
  const reported = new Set(records.filter((r) => r.kind === "death_notification").map((r) => r.data.deceased));
  expect(entries.map((r) => r.data.deceased).sort()).toEqual([...reported].filter((p) => entries.some((r) => r.data.deceased === p)).sort());

  // The works manager: the crew advertised for on the form once the budget paid for one, and taken on.
  const adverts = records.filter((r) => r.kind === "job_posting" && r.speaks_for === "city" && r.data?.role === "works crew");
  expect(adverts.length).toBeGreaterThan(0);
  expect(onForm.get("job_advertisement")).toBeGreaterThanOrEqual(adverts.length);
  expect(adverts[0]).toMatchObject({ author: "works-system", data: { workplace: "town-hall", space: "town-hall/workplace.1" }, offer: { by: "city", take_up: "apply", terms: { template: "employment" } } });
  expect(records.filter((r) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0] === "city").length).toBeGreaterThan(0);

  // The landlord: whatever homes it listed (none, if all its homes stayed let), on the form.
  expect(onForm.get("rental_listing") ?? 0).toBe(records.filter((r) => r.kind === "rental_listing" && r.author === "landlord-1-office-system").length);
  // The lender: its decisions on the form.
  expect((onForm.get("loan_decision") ?? 0) + (onForm.get("funding_draw") ?? 0)).toBe(records.filter((r) => r.author === "bank-lending-system" && ["loan_decision", "funding_draw"].includes(r.kind)).length);
}, 900_000);
