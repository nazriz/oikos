// An office knows its own staff (participants/src/behaviour/roster.ts; live check 2 of 2026-10-09, finding 5). A works
// manager with no crew set two standing work orders and watched a month of complaints: nothing it was shown said it had
// nobody, and its own job advertisement form did not say what it was for. Here the mock holds a works office that starts
// with no crew: it is shown its posts and that nobody is in them, the standing work order's preview and result say
// nobody will carry it out, its forms each say what they do and that they are its own to fill in, and it takes on a
// crew through its own form, after which it is shown who is in post.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modules } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const text = (x: any): string => (typeof x === "string" ? x : (x ?? []).map((b: any) => b.content ?? b.text ?? "").join("\n"));

test("a works seat with no crew is told so, at its first sitting and when it changes; an order of nobody says so; it hires through its own form", async () => {
  const config = generate({ ...spec, opening_orders: false, model_seats: ["works"], works_crew_at_start: 0 });
  for (const p of config.participants) if (p.id === "works-system") p.controller.params.cadence_days = 1;
  const s = await runWorld({ config, runId: "staff", outDir: mkdtempSync(join(tmpdir(), "oikos-office-staff-")), until: 12 * DAY });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const sittings = log.filter((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.subject === "works-system" && e.body.data.purpose === "participant");
  const shown = sittings.map((e) => text(e.body.data.input));

  // Its first sitting: its posts, by what, and that nobody is in them; and how an office takes on staff.
  expect(shown[0]).toContain("## Works manager: Staff of your office");
  expect(shown[0]).toMatch(/Posts \(works crew\): \d+ \(the staff line of the budget for year 1 \(budget-year-1\), .+, pays for that many at .+ a year each\)\./);
  expect(shown[0]).toContain("In post: nobody.");
  expect(shown[0]).toMatch(/Vacant: [1-9]\d*\./);
  expect(shown[0]).toContain("There is nobody in post, so the work that is the staff's is done by nobody. The office takes on its own staff, beginning with an advertisement on its job advertisement form (form-works-job-advertisement).");

  // Its own forms, a line each: what the paper does, and that it is the office-holder's to fill in.
  const system: string = sittings.find((e) => e.body.data.system)!.body.data.system;
  const ad = system.split("\n").find((l) => l.startsWith("- [form-works-job-advertisement]"))!;
  expect(ad).toContain("Job advertisement. How the office takes on staff of its own: it puts the posts on the jobs board at the wage given");
  expect(ad).toContain("Filled in by the works manager, of the office's own accord (nobody's direction or leave is needed)");
  expect(system.split("\n").find((l) => l.startsWith("- [form-works-disposal-docket]"))).toContain("Goes with a load of waste taken to the landfill");

  // A standing work order with nobody to carry it out: the preview says so before it is confirmed, and its result after.
  const drafts = log.filter((e) => e.kind === "annotation" && e.body.annotation === "draft" && e.body.draft.blocks.some((b: any) => b.kind === "work_order"));
  expect(drafts.length).toBeGreaterThan(0);
  expect(drafts[0].body.draft.summary).toContain("There is nobody in the post whose work this is: your office has no works crew in post, so nothing is done under it until someone is taken on.");
  expect(shown.some((x) => x.includes("The standing work order you confirmed is on file, and there is nobody in the post whose work it is"))).toBe(true);

  // It advertises on its own form, takes on a crew, and is shown who is in post: once, when the list changed.
  const acts = log.filter((e) => e.kind === "command" && e.body.command === "act" && e.body.participant === "works-system").map((e) => String(e.body.provenance?.call ?? ""));
  expect(acts.some((c) => c.startsWith("form(form=job_advertisement"))).toBe(true);
  expect(acts.some((c) => c.includes("template=employment"))).toBe(true);
  const hired = shown.findIndex((x) => /In post \(\d+\): c\d+, since year 1, day \d+, under rec\.\d+/.test(x));
  expect(hired).toBeGreaterThan(0);
  expect(shown[hired]).not.toContain("There is nobody in post");
  const withList = shown.filter((x) => x.includes("Staff of your office")).length;
  expect(withList).toBeGreaterThanOrEqual(2);
  expect(withList).toBeLessThan(shown.length / 2); // (not at every sitting: only where it changed)
  // A later order, with a crew in post, says nothing of nobody.
  expect(log.some((e) => e.kind === "event" && JSON.stringify(e.body).includes('"waste"'))).toBe(true);
}, 300_000);

test("every office that employs staff says so in its module; the others have none to show", () => {
  const staffed = Object.values(modules).filter((m) => m.staffed).map((m) => m.name).sort();
  expect(staffed).toEqual(["city.environment", "city.works", "clinic.practice", "police.station", "school.principal"]);
  expect(modules["city.works"]!.staffed!({ wage: 300_000, period: 14 * DAY })).toEqual({ role: "works crew", own: "role_or_unnamed", posts: { budget_line: "staff", wage: 300_000, period: 14 * DAY } });
  expect(modules["clinic.practice"]!.staffed!({ doctors: 3 })).toEqual({ role: "doctor", own: "role_or_unnamed", posts: { establishment: 3 } });
  // Every form of an office that can be a seat here says what issuing it does.
  for (const name of ["city.works", "city.environment", "city.registry", "city.inspector", "city.planning_officer", "police.station", "tribunal.member", "tribunal.registrar", "clinic.practice", "school.principal"])
    for (const f of modules[name]!.issues ?? []) expect(`${name}/${f.form}: ${f.does ?? ""}`).toMatch(/: .{20,}/);
});
