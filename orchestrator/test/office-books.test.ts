// A seated office is shown what its code twin acts on (docs/behaviour/office-books.md; the second living pilot, fault 2:
// a landlord's code twin wrote to four tenants in arrears and the seat was shown nothing). Here the mock holds offices
// of a small living town, with each office's own code as its brain: so the brain acts on what the code works out, and
// the test checks that the clerk's paper had put the same thing in front of the seat, in its folder, no later; that
// the folder's line carries what changed and not the list; that letters to an office reach the seat as post; that
// the support office's staff do the routine and the office-holder is shown counts and a sample; that a town opens
// with its routines' standing orders in force; and that what happened all at once no longer does.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const text = (x: any): string => (typeof x === "string" ? x : (x ?? []).map((b: any) => (typeof b.content === "string" ? b.content : b.text ?? JSON.stringify(b.content ?? ""))).join("\n"));
const living = { ...spec, profile: "ke-nakuru-2026", living: { initiative_bps: 10_000, friction_bps: 10_000 } };

/** Three tenants who have lost what they lived on: no job, out of the labour force, nothing put by. (With homes dealt
 * by income, 2026-10-12, a small town has no tenancy behind with its rent in its first hundred days unless something
 * happens to someone: until then the arrears this file watched were households placed in homes they could not pay for.) */
function withoutMeans(config: any) {
  const leases = config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "lease" && !/with their household/.test(r.terms.text));
  // (Three whose rent days fall on different days of the week: the seat sits weekly, so two on one weekday are one day's letters. Taken in
  // order until 2026-10-16, when the order of a town's leases moved with foundations F5 and the first three shared a day.)
  const rentDay = (l: any) => Math.floor(((config.world.records.find((r: any) => r.kind === "request" && r.basis === l.id)?.data?.first ?? 0) / DAY) % 7);
  const picked: any[] = [];
  for (const l of leases) if (picked.length < 3 && !picked.some((x) => rentDay(x) === rentDay(l))) picked.push(l);
  for (const l of picked) {
    const tenant = l.terms.parties[1] as string;
    const job = config.world.records.find((r: any) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[1] === tenant);
    if (job) config.world.records = config.world.records.filter((r: any) => r.id !== job.id && r.agreement !== job.id && r.basis !== job.id);
    config.world.records = config.world.records.filter((r: any) => !(r.data?.brought_forward && (r.speaks_for === tenant || (r.addressed_to ?? []).includes(tenant))));
    config.world.accounts.find((a: any) => a.id === `acc-${tenant}`).balance = "0";
    const who = config.participants.find((p: any) => p.person === tenant);
    who.controller = { ...who.controller, params: { ...who.controller.params, in_labour_force: false } };
  }
}

async function run(seats: string[], days: number, name: string, prepare?: (config: any) => void) {
  const config = generate({ ...living, model_seats: seats });
  prepare?.(config);
  const s = await runWorld({ config, runId: name, outDir: mkdtempSync(join(tmpdir(), `oikos-${name}-`)), until: days * DAY });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const statements: any[] = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record).filter((r) => r?.record === "statement");
  const shown = (seat: string) => log.filter((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.subject === `${seat}-system` && e.body.data.purpose === "participant").map((e) => ({ t: e.t as number, input: text(e.body.data.input) }));
  return { config, log, statements, shown };
}

test("a landlord's seat is shown who is behind with the rent before its code twin writes to them; arrears do not all appear on one day", async () => {
  const config0 = generate(living);
  const landlords: string[] = config0.positions.filter((p: any) => p.role_module?.code === "firm.landlord").map((p: any) => p.id);
  expect(landlords.length).toBeGreaterThan(2);
  const { config, statements, shown } = await run(landlords, 100, "office-books-landlords", withoutMeans);
  // Every seated landlord's office has a clerk, and a folder for the books whose name says what the clerk does.
  for (const id of landlords) {
    expect(config.positions.some((p: any) => p.id === `${id}-staff` && p.role_module?.code === "office.clerk")).toBe(true);
    expect(config.positions.find((p: any) => p.id === id).channels.some((c: any) => c.id === "staff-reports" && /as its clerk keeps them/.test(c.title))).toBe(true);
  }
  const books = statements.filter((r) => r.kind === "office_books");
  expect(books.length).toBeGreaterThan(0);
  // (The clerk's paper is the organisation's own, seen by it alone.)
  for (const b of books) expect(b.visible_to).toEqual([b.speaks_for]);
  // What the code twin acts on: each letter asking a tenant for rent owed. The clerk had put that lease in the books, as
  // rent in arrears, no later; and the seat's folder had shown it.
  const asked = statements.filter((r) => r.kind === "remedy_request" && r.data?.matter === "arrears");
  expect(asked.length).toBeGreaterThan(0);
  for (const a of asked) {
    const lease = String(a.data.about);
    const office = landlords.find((id) => config.positions.find((p: any) => p.id === id)!.entity === a.speaks_for)!;
    const before = books.filter((b) => b.speaks_for === a.speaks_for && b.at <= a.at && (b.data.open as any[]).some((x) => x.what === "Rent in arrears" && x.about === lease));
    expect(before.length).toBeGreaterThan(0);
    expect(shown(office).some((s) => s.t <= a.at && s.input.includes("Rent in arrears") && s.input.includes(lease))).toBe(true);
  }
  // The folder's line says what changed; the list is in the paper, read by its id.
  const lines = landlords.flatMap((id) => shown(id).flatMap((s) => s.input.split("\n").filter((l) => l.includes("] office books from"))));
  expect(lines.length).toBeGreaterThan(0);
  for (const l of lines) {
    expect(l).not.toContain('"says"');
    expect(l).toContain("the list: in this paper");
    expect(l.length).toBeLessThan(1_500);
  }
  expect(lines.some((l) => l.includes("; new: ") || l.includes("no longer open: "))).toBe(true);
  // (That what people write to a landlord reaches its seat as post is held on papers made by hand: a small town's
  // tenants write none in a hundred days. participants/test/seat-papers-back.test.ts.)
  // Rent days differ by tenancy, and the landlord counts from each: the letters about arrears are not one day's.
  const days = new Set(asked.map((a) => Math.floor(a.at / DAY)));
  // (Three letters on two days in this town's hundred days: not one day's, and no day has more than half.)
  expect(days.size).toBeGreaterThan(1);
  const most = Math.max(...[...days].map((d) => asked.filter((a) => Math.floor(a.at / DAY) === d).length));
  expect(most).toBeLessThanOrEqual(Math.ceil(asked.length / 2));
}, 600_000);

test("the support office's staff decide and pay what the law's conditions settle; the office-holder is shown counts and a sample, and pays nothing by hand", async () => {
  const { config, log, statements, shown } = await run(["outside-support"], 45, "office-books-support");
  // The town opens with the standing order in force, on the office's own file.
  const order = config.world.records.find((r: any) => r.id === "order-outside-support-pay-claims");
  expect(order?.kind).toBe("work_order");
  expect(order.in_position).toBe("outside-support");
  // The staff granted claims and paid them; the office-holder made no payment.
  const decisions = statements.filter((r) => r.kind === "benefit_decision");
  expect(decisions.filter((d) => d.data?.granted === true && d.author === "outside-support-staff-system").length).toBeGreaterThan(0);
  const acts = (who: string) => log.filter((e) => e.kind === "command" && e.body.command === "act" && e.body.participant === who).map((e) => String(e.body.provenance?.call ?? ""));
  expect(acts("outside-support-staff-system").some((c) => c.startsWith("money("))).toBe(true);
  expect(acts("outside-support-system").some((c) => c.startsWith("money("))).toBe(false);
  // What the office-holder is shown: the claims as a count and a sample, and the staff's report of what was done.
  const seen = shown("outside-support").map((s) => s.input);
  expect(seen.some((x) => /Answered at your counter under your standing order \(\d+\): \d+ benefit claims?\. A sample:/.test(x))).toBe(true);
  expect(seen.some((x) => /pay_claims \(order-outside-support-pay-claims, every 1 day\): carried out: .*claims? granted and \d+ put before the office-holder/.test(x))).toBe(true);
  // Nothing says a routine has no order.
  expect(statements.filter((r) => r.kind === "staff_report" && (r.data?.orders ?? []).some((o: any) => o.state === "no_order")).length).toBe(0);
}, 600_000);

test("an office's books are its own: another office of the same organisation is not shown them, and no clerk's paper brings a seat back early", async () => {
  const config = generate({ ...living, mayor: "llm", model_seats: ["finance", "planning", "works"] });
  const s = await runWorld({ config, runId: "office-books-town-hall", outDir: mkdtempSync(join(tmpdir(), "oikos-office-books-town-hall-")), until: 30 * DAY });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const books: any[] = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record).filter((r) => r?.kind === "office_books");
  const seats = ["mayor", "finance", "planning", "works"];
  const shown = (seat: string) => log.filter((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.subject === `${seat}-system` && e.body.data.purpose === "participant").map((e) => text(e.body.data.input)).join("\n");
  const offices = new Set(books.map((b) => b.data.office));
  expect(offices.has("mayor") || offices.has("finance")).toBe(true);
  for (const seat of seats) {
    const all = shown(seat);
    for (const b of books) {
      if (b.data.office === seat) continue;
      expect(all.includes(`[${b.id}]`)).toBe(false);
    }
    // Its own are there; and none of them is what brought it back.
    const mine = books.filter((b) => b.data.office === seat);
    if (mine.length) expect(mine.some((b) => all.includes(`[${b.id}]`))).toBe(true);
    expect(all).not.toMatch(/papers were filed with your office \([^)]*office books/);
  }
  // The town's rule on petitions is published, where the mayor's office reads it.
  expect(config.world.records.find((r: any) => r.id === "proc-petitions")?.visible_to).toBe("public");
}, 600_000);
