// A pilot and its twin are the same town until something truly differs (docs/design/ai-citizens.md 10i; docs/reliability.md,
// "Draws and the order papers were filed in"). A record made in a run is numbered in the order every record of the
// town was made, so a seat that files one paper more moves the number of every later paper. Until 2026-10-12 a draw
// about a paper was keyed on that number: in the third living pilot a code landlord nobody had dealt with refused a
// repair that its twin granted, and twelve tenants unrepaired could not be told from chance. Here one town is run
// twice from one seed, the second time with the mayor's office in a mock seat (its brain is the mayor's own code, and
// its clerk files the office's books: papers of the town's own, of no effect on anyone). Every answer an organisation
// gave to a person's request to put something right, and every venue's decision, must be the same for the same
// request in both runs.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls as C, modules as builtin, type BehaviourModule } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { onRust } from "./lib/doubles";
import { officeAt, systemAt } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
// (Frictions at several times the sourced rate, so that a small town has requests enough in a short run.)
const living = { ...spec, citizens: 300, profile: "ke-nakuru-2026", living: { initiative_bps: 10_000, friction_bps: Number(process.env.TWIN_FRICTION ?? 100_000) } };
// (2026-10-12, homes by income: until then most of this town's requests and decisions were about rent nobody in the
// home could pay, the opening-day artefact. Without them 75 days at eight times the rate gave 6; the dial's most and
// 120 days give 11, and the least expected below is 8 where it was 12.)

/** An office doing its job as its module does it, and filing besides, each time it has nothing else to do, an entry
 * on its organisation's own file: a paper of no effect on anyone, which takes a number in the world's file. */
const SCRIBBLE = (t: string | number) => C.program(C.call("statement", { kind: "entry", visible: "own", text: C.text(`Nothing to enter at ${t}.`) }), C.call("statement", { kind: "entry", visible: "own", text: C.text("Nor here.") }));
const scribbling = (inner: string): BehaviourModule => ({
  ...builtin[inner]!,
  name: `test.scribbling.${inner.replace(/\./g, "_")}`,
  create(ctx) {
    const office = builtin[inner]!.create(ctx);
    let last = -1;
    return Object.assign(Object.create(office), {
      step(obs: any, x: any) {
        const a = office.step(obs, x) as any;
        if (a?.type !== "wait" || obs.t - last < DAY / 2) return a;
        last = obs.t;
        return { type: "call" as const, call: SCRIBBLE(obs.t) };
      },
    });
  },
});

/** The same, for a post a model's seat holds: the seat is a system's, as it was until foundations F5 (it keeps its own lanes, and takes no
 * person's time). */
function seatAsSystem(config: any, post: string) {
  const seat = config.participants.find((p: any) => p.id === `${post}-system`);
  const post0 = config.positions.find((p: any) => p.id === post);
  const blocks = "transfer move_goods take work open_account close_account construct demolish occupy vacate arrive leave birth harm create_position appoint deploy retire create_entity record_claim transfer_claim release_claim propose_agreement sign_agreement give_notice publish withdraw vote message".split(" ");
  if (!config.templates.some((t: any) => t.id === "office-system")) config.templates.push({ id: "office-system", kind: "system", supplier: "outside", does: blocks.map((block) => ({ block })), controller: { type: "code", impl: "test" }, framing: { disclosure: "unstated", reason: "test" } });
  delete seat.person; delete seat.shares_body; delete seat.channels;
  Object.assign(seat, { kind: "system", owner: post0.entity, template: "office-system", supplier: "outside" });
}

async function town(name: string, more: object, scribe?: string, days = Number(process.env.TWIN_DAYS ?? 120), system?: string) {
  const dir = mkdtempSync(join(tmpdir(), `oikos-${name}-`));
  try {
    const config = generate({ ...living, ...more });
    if (system?.startsWith("seat:")) {
      seatAsSystem(config, system.slice(5));
      // (And its staff post, which the seat's town has and the twin's has not: a system's too.)
      if (config.positions.some((p: any) => p.id === `${system.slice(5)}-staff`)) systemAt(config, `${system.slice(5)}-staff`);
    }
    else if (system) systemAt(config, system);
    let modules: { [k: string]: BehaviourModule } | undefined;
    if (scribe) {
      const part = officeAt(config, scribe);
      // (On the Rust world the same double wraps the office's own kind: kernel/crates/actors/src/testkinds.rs, `scribble`.)
      if (onRust) part.run("test.scribbling", { ...part.params, inner: part.impl, scribble: { every: DAY / 2, call: SCRIBBLE("{t}") } });
      else {
        const wrapped = scribbling(part.impl);
        part.run(wrapped.name);
        modules = { [wrapped.name]: wrapped };
      }
    }
    const draws = new Map<string, number>();
    const s = await runWorld({ config, runId: name, outDir: dir, until: days * DAY, logDetail: "lean", recordObservations: "none", drawTrace: (k: readonly string[]) => { const x = k.join("|"); draws.set(x, (draws.get(x) ?? 0) + 1); }, ...(modules ? { modules } : {}) } as any);
    expect(s.participantErrors).toBe(0);
    const records: any[] = [], decisions: string[] = [], acts: string[] = [];
    // (Each named for who, what and the day, and which time that was for them that day: never by the hour.)
    const nth = new Map<string, number>();
    const once = (base: string) => { const n = (nth.get(base) ?? 0) + 1; nth.set(base, n); return `${base}#${n}`; };
    // (An invoice quoted in a claim carries the second it was issued at: the paper is the same, issued in another hour.)
    const plain = (x: string) => x.replace(/rec\.[0-9]+/g, "rec").replace(/"at":[0-9]+/g, '"at":0');
    for (const l of readFileSync(s.logPath, "utf8").split("\n")) {
      if (l.includes('"event":"recorded"')) { const r = JSON.parse(l).body.record; if (r?.record === "statement") records.push(r); }
      else if (l.includes('"annotation":"decision"')) { const d = JSON.parse(l); decisions.push(once(`${d.body.subject}|${d.body.data.domain}|${Math.floor(d.t / DAY)}|${plain(String(d.body.data.choice))}`)); }
      else if (l.includes('"command":"act"')) { const d = JSON.parse(l); acts.push(once(`${d.body.participant}|${Math.floor(d.t / DAY)}|${plain(String(d.body.provenance?.call ?? JSON.stringify(d.body.blocks)))}`)); }
    }
    return { records, decisions, acts, draws, holders: Object.fromEntries(config.positions.map((p: any) => [p.id, p.holder])) as { [post: string]: string } };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
async function run(name: string, more: object, scribe?: string, system?: string) { return (await town(name, more, scribe, undefined, system)).records; }

/** Each request to put something right with the answer it got, named for who asked whom about what and which time
 * that was for the pair, at the hour it was asked: never by a record's number. */
function answers(records: any[], dealtWith: Set<string>) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const nth = new Map<string, number>();
  const out = new Map<string, string>();
  const reqKey = new Map<string, string>();
  for (const r of records) {
    if (r.kind !== "review_request" || !r.data?.matter) continue;
    const to = String((r.addressed_to ?? [])[0]);
    if (dealtWith.has(to) || dealtWith.has(r.speaks_for)) continue;
    const base = `${r.speaks_for}>${to}:${r.data.matter}:${r.data.structure ?? ""}`;
    nth.set(base, (nth.get(base) ?? 0) + 1);
    reqKey.set(r.id, `${base}#${nth.get(base)}@${Math.floor(r.at / 3_600)}`);
    out.set(reqKey.get(r.id)!, "no answer");
  }
  for (const r of records) if (r.kind === "remedy_answer" && reqKey.has(String(r.data?.request))) out.set(reqKey.get(String(r.data.request))!, r.data.granted ? "granted" : "refused");
  // A venue's decisions, the same way: who applied against whom about what, and what was found.
  const dn = new Map<string, number>();
  for (const r of records) {
    if ((r.kind !== "venue_decision" && r.kind !== "tribunal_order") || typeof r.data?.matter !== "string") continue;
    const a = byId.get(String(r.data.application));
    if (!a || dealtWith.has(String(r.data.against)) || dealtWith.has(String(r.data.applicant))) continue;
    const base = `decision:${r.speaks_for}:${r.data.applicant}>${r.data.against}:${r.data.matter}`;
    dn.set(base, (dn.get(base) ?? 0) + 1);
    out.set(`${base}#${dn.get(base)}@${Math.floor(a.at / 3_600)}`, String(r.data.finding));
  }
  return out;
}

for (const post of ["registry", "ombudsman-officer"]) test(`papers of no effect, filed by the ${post}, held by a system, change no answer and no decision anywhere in the town`, async () => {
  // (Restored to the registry, review of foundations finding 10. The office is a system's, as the registry was until foundations F5, so the
  // papers take no person's time: nothing moves. With a person in the post the same papers move the days of the offices that person holds:
  // the next test, traced.)
  // The office files two entries on the town's own file every day it has nothing else to do: several hundred
  // records the twin has none of, so that almost every later paper of the town has another number.
  const [twin, pilot] = await Promise.all([run("twin-draws-code", {}, undefined, post), run("twin-draws-scribe", {}, post, post)]);
  const extra = pilot.filter((r) => r.kind === "entry" && /^(Nothing to enter at|Nor here)/.test(r.text)).length;
  expect(extra).toBeGreaterThan(50);
  const idsOf = (rs: any[]) => rs.filter((r) => r.kind === "review_request").map((r) => r.id).join(",");
  expect(idsOf(pilot)).not.toBe(idsOf(twin));
  const a = answers(twin, new Set()), b = answers(pilot, new Set());
  console.log(`twin draws: ${extra} papers of no effect; ${a.size} requests and decisions in the twin, ${b.size} beside them`);
  expect(a.size).toBeGreaterThan(8);
  // The same requests, at the same hours, with the same answers: the whole of it, not a part.
  expect([...b.entries()].sort()).toEqual([...a.entries()].sort());
  // And the town beside them is the same town: every paper but the entries, in the same order, with the same words.
  const said = (rs: any[]) => rs.filter((r) => r.kind !== "entry").map((r) => `${r.at} ${r.kind} ${r.speaks_for} ${r.text.replace(/rec\.[0-9]+/g, "rec")}`);
  expect(said(pilot)).toEqual(said(twin));
}, 900_000);

test("papers of no effect, filed by the registry's holder, a person of the town, cost that person's time and nothing else: what moves starts with the offices the person holds", async () => {
  // (Traced, review of foundations finding 10. The registry's holder is a citizen who also holds planning, inspection, finance, works and
  // the environment office. Each day the two entries take that person's time (one account for a person, foundations F1), so the
  // papers of those offices that day come later, by no more than the entries' time; what depends on them moves with them. It is not the
  // papers' numbers: the same registry held by a system moves nothing (the test before). Seen in the town of 120 days: the first paper to
  // move is the city's permit decision at 92400, 300 s late, from the entries begun at 86400.)
  const [twin, pilot] = await Promise.all([town("twin-draws-person-code", {}), town("twin-draws-person-scribe", {}, "registry")]);
  const holder = twin.holders.registry!;
  expect(holder).toMatch(/^c\d+-self$/);
  expect(Object.values(twin.holders).filter((h) => h === holder).length).toBeGreaterThan(2);
  const key = (rs: any[]) => { const n = new Map<string, number>(); return rs.filter((r) => r.kind !== "entry").map((r) => { const k = `${r.kind}|${r.speaks_for}|${r.text.replace(/rec\.[0-9]+/g, "rec")}`; n.set(k, (n.get(k) ?? 0) + 1); return [`${k}#${n.get(k)}`, r.at] as [string, number]; }); };
  const A = new Map(key(twin.records)), B = new Map(key(pilot.records));
  const entries = pilot.records.filter((r) => r.kind === "entry" && /^(Nothing to enter at|Nor here)/.test(r.text)).sort((x, y) => x.at - y.at);
  expect(entries.length).toBeGreaterThan(50);
  const begun = Number(/at (\d+)\./.exec(entries[0].text)![1]);
  const takes = entries[0].at - begun;
  const moved = [...A].filter(([k, t]) => B.has(k) && B.get(k) !== t).sort((x, y) => x[1] - y[1]);
  console.log(`twin draws, a person at the registry: ${moved.length} of ${A.size} papers moved; the first at ${moved[0]?.[1]} by ${B.get(moved[0]![0])! - moved[0]![1]}s; the entries take ${takes}s from ${begun}`);
  expect(moved.length).toBeGreaterThan(0);
  // Nothing moves before the first entries were begun; the first paper to move is an office of the holder's, late by no more than the entries took.
  expect(moved[0]![1]).toBeGreaterThanOrEqual(begun);
  const shift = B.get(moved[0]![0])! - moved[0]![1];
  expect(shift).toBeGreaterThan(0);
  expect(shift).toBeLessThanOrEqual(takes);
  expect(moved[0]![0].split("|")[1]).toBe("city");
  // How far the difference spreads is measured, not bounded (the owner's ruling, 2026-10-19; docs/risks.md MT-17;
  // docs/decisions.md, "The cut-over"): what follows from a holder's time spent is the town's sensitivity, a property
  // of the world (first-look hiring, a refusal remembered from when it is read, the last of a shop's stock), not a
  // fault. Until then the words were bounded at 2% and the timing at 10%, figures calibrated on the TS world, which
  // damped it. The strict twin tests (the same decisions, the same world: twin-seat-year, the cases above) stay exact.
  const words = [...A.keys()].filter((k) => !B.has(k)).length;
  console.log(`MT-17's measure, a person at the registry: ${words} of ${A.size} papers in other words (${(100 * words / A.size).toFixed(1)}%), ${moved.length} at another second (${(100 * moved.length / A.size).toFixed(1)}%), ${B.size - A.size} more papers with the entries`);
}, 900_000);

test("with an office in a mock seat, the same requests still get the same answers from those the seat did not deal with", async () => {
  // (A seat is not its code twin: it sits in office hours and its acts land at other moments, so the two towns do
  // part, by what truly differs. What must not differ is the answer to a request that is the same in both.)
  // (450 citizens, where the other tests here have 300, 2026-10-18: the seat parts from its twin on the first day (the mayor files its permit application
  // on day 14 where the code does on day 1), so the requests the two towns share are those that nothing the seat did reached, and a town of 300 gave 7
  // of 12 and 16 in the two branches before their merge, and 5 of 20 after it, by the draws alone. The floor below is the same; the sample it is
  // taken from is larger: 16 of 27 in common at 450, all answered alike.)
  const [twin, pilot] = await Promise.all([run("twin-draws-code-2", { citizens: 450 }), run("twin-draws-seat", { mayor: "llm", citizens: 450 })]);
  const books = pilot.filter((r) => r.kind === "office_books");
  expect(books.length).toBeGreaterThan(0);
  expect(twin.some((r) => r.kind === "office_books")).toBe(false);
  // (The town's own offices answer for the seat's side: left out.)
  const dealt = new Set(["city"]);
  const a = answers(twin, dealt), b = answers(pilot, dealt);
  const common = [...a.keys()].filter((k) => b.has(k));
  console.log(`twin draws: ${a.size} requests and decisions in the twin, ${b.size} with the seat, ${common.length} the same request in both; ${books.length} papers of the seat's clerk`);
  if (process.env.TWIN_DEBUG) console.log([...a.keys()].filter((k) => !b.has(k)).sort().join("\n"), "\n--\n", [...b.keys()].filter((k) => !a.has(k)).sort().join("\n"));
  expect(common.length).toBeGreaterThan(5);
  const differ = common.filter((k) => a.get(k) !== b.get(k));
  expect(differ.map((k) => `${k}: ${a.get(k)} in the twin, ${b.get(k)} with the seat`)).toEqual([]);
}, 900_000);

test("the world's prices are the world's: a town and its twin with an office in a mock seat see the same prices month by month over a year", async () => {
  // (2026-10-12. A month's world price was drawn on the outside market's own stream, which is keyed on the hour it
  // wakes in: anything that moved its first look of a month gave the town another year of prices. Twelve runs of one
  // town before and after an unrelated change had input prices 16% and 21% up in the "same" run, and whether its
  // factories failed turned on it. A price is now named for the good and the month, from the seed.)
  const prev = process.env.TWIN_DAYS;
  process.env.TWIN_DAYS = "365";
  try {
    const [twin, pilot] = await Promise.all([run("twin-prices-code", { living: undefined }), run("twin-prices-seat", { living: undefined, mayor: "llm" })]);
    const prices = (rs: any[]) => rs.filter((r) => r.kind === "price_list" && /at world prices/.test(String(r.text))).map((r) => `${Math.floor(r.at / (30 * DAY))} ${String(r.text).replace(/rec\.[0-9]+/g, "rec")}`);
    const a = prices(twin), b = prices(pilot);
    console.log(`twin prices: ${a.length} lists of world prices in the twin's year, ${b.length} beside it; ${new Set(a.map((x) => x.replace(/^\d+ /, ""))).size} distinct`);
    expect(new Set(a.map((x) => x.replace(/^\d+ /, ""))).size).toBeGreaterThan(6); // (prices did move)
    expect(pilot.some((r) => r.kind === "office_books")).toBe(true); // (and the towns did differ: a seat sat)
    expect(b).toEqual(a);
  } finally { if (prev === undefined) delete process.env.TWIN_DAYS; else process.env.TWIN_DAYS = prev; }
}, 1_800_000);

/** What two towns drew alike: the keys of a stream (who, in what capacity, the day, what for, which time that was
 * that day) in both, with how many times each. A draw is told apart by what it is for, so a key in one town and in
 * the other fell the same way. `by` says whose a key is. */
function alike(a: Map<string, number>, b: Map<string, number>, mine: (pid: string) => boolean) {
  let same = 0, all = 0;
  const apart: string[] = [];
  for (const [k, n] of a) {
    if (!mine(k.split("|")[1]!)) continue;
    all += n;
    const m = Math.min(n, b.get(k) ?? 0);
    same += m;
    if (m < n) apart.push(k);
  }
  return { same, all, apart };
}
const share = (x: { same: number; all: number }) => `${x.same} of ${x.all} (${((100 * x.same) / Math.max(1, x.all)).toFixed(1)}%)`;
/** A decision or act by a participant: who it was is the first part of its name. */
function matched(a: string[], b: string[], mine: (pid: string) => boolean) {
  const there = new Set(b);
  const ours = a.filter((x) => mine(x.split("|")[0]!));
  return { same: ours.filter((x) => there.has(x)).length, all: ours.length, apart: ours.filter((x) => !there.has(x)) };
}

test("a year with one office in a mock seat that sits at other hours and files papers of no effect: everyone else decides, answers, prices and draws the same on the same days", async () => {
  // (2026-10-12, draws and the moment. A seat acts at other hours than its code twin and files papers the twin does not,
  // so a stream named for the hour someone woke, or for a paper's number, fell differently for all the town. Now a draw
  // is named for the one who draws, the calendar day, what it is for and which time that was for them that day.)
  // (The ombudsman's office is run by a system in both towns, and its seat is a system's, as every office was until foundations F5: a person's
  // time spent on a seat is a true difference between a town and its twin, and what it moves is seen in the other tests of this file.)
  // The ombudsman's office deals with nobody in this town: its seat sits in office hours, reads its staff's reports and
  // files its own. Every draw but the seat's own, every decision, every act, every answer and every price must be the same.
  const [twin, seat, mayor] = await Promise.all([town("moments-code", {}, undefined, 365, "ombudsman-officer"), town("moments-seat", { model_seats: "ombudsman-officer" }, undefined, 365, "seat:ombudsman-officer"), town("moments-mayor", { mayor: "llm" }, undefined, 365)]);
  const office = (pid: string) => pid.startsWith("ombudsman-officer");
  const papers = seat.records.filter((r) => r.kind === "staff_report").length;
  expect(papers).toBeGreaterThan(8);
  expect(twin.records.some((r) => r.kind === "staff_report")).toBe(false);
  const draws = alike(twin.draws, seat.draws, (pid) => !office(pid));
  const decided = matched(twin.decisions, seat.decisions, (pid) => !office(pid));
  // (An act addressed to the ombudsman is dealt with by the seat: a complaint it was sent and when its answer came is the seat's.)
  const acted = matched(twin.acts.filter((x) => !x.includes("ombudsman")), seat.acts.filter((x) => !x.includes("ombudsman")), (pid) => !office(pid));
  console.log(`twin moments, a seat that deals with nobody (${papers} papers of its own): draws ${share(draws)}; decisions ${share(decided)}; acts ${share(acted)}`);
  expect(draws.apart).toEqual([]);
  expect(decided.apart).toEqual([]);
  // (Foundations F7: act for act. Until then 6 acts of 122,000 differed by seconds from day 203: someone asleep when their body gave news (an injury in the
  // small hours) was met at the first cohort the engine had after it, and in a quiet stretch that was the ombudsman's own unit's, which in the town with the
  // seat sits at other hours than in the twin. The engine's advance now stops at the moment of body news (`advance_to_news`, kernel/src/schedule.rs), so the
  // news reaches the person when it happens, whoever wakes next.)
  expect(acted.apart).toEqual([]);
  expect(decided.all).toBeGreaterThan(5_000);
  expect([...answers(seat.records, new Set()).entries()].sort()).toEqual([...answers(twin.records, new Set()).entries()].sort());
  const prices = (rs: any[]) => rs.filter((r) => r.kind === "price_list" && /at world prices/.test(String(r.text))).map((r) => `${Math.floor(r.at / (30 * DAY))} ${String(r.text).replace(/rec\.[0-9]+/g, "rec")}`);
  expect(prices(seat.records)).toEqual(prices(twin.records));
  // And the mayor's seat, which does deal with the town (its orders reach planning, finance and the builders, and what
  // they do on other days is another town from there): it is not the same town, but what the seat did not reach is still
  // drawn alike. Reported; held at a floor that the draws named for the hour could not reach.
  const mDraws = alike(twin.draws, mayor.draws, (pid) => !pid.startsWith("mayor"));
  const mDecided = matched(twin.decisions, mayor.decisions, (pid) => !pid.startsWith("mayor"));
  console.log(`twin moments, the mayor's seat: draws ${share(mDraws)}; decisions ${share(mDecided)}`);
  // (A year of this town with draws named for the hour: 34% of draws and 35% of decisions alike; now 79% and 45%.)
  // (Not on the Rust world: the draw trace is the TS loop's, so there are no draws to set side by side; the rule is held by
  // actors/src/draws.rs's own tests, as for the draw-trace test below.)
  if (!onRust) expect(mDraws.same / mDraws.all).toBeGreaterThan(0.65);
  // (0.37 where it was 0.4, foundations F5: 39.9% now, 43.5% before. The mayor's seat is a person's time spent, so what the town does on other days
  // moves a little more; the floor stays above the 35% the hour-named draws gave.)
  expect(mDecided.same / mDecided.all).toBeGreaterThan(0.37);
}, 1_800_000);

test("no module names a draw for a moment", () => {
  // A purpose with the time in it (`shop-${t}`) is a draw that falls differently in two towns that woke at other hours.
  const dir = join(root, "participants/src/behaviour");
  const found: string[] = [];
  for (const f of new Bun.Glob("*.ts").scanSync(dir)) {
    readFileSync(join(dir, f), "utf8").split("\n").forEach((l, i) => { if (/\brng\(`[^`]*\$\{(t|obs\.t|now|at)\}/.test(l)) found.push(`${f}:${i + 1}`); });
  }
  expect(found).toEqual([]);
});

// Bug hunt 2026-10-17, finding 14: a draw about a lease (or any paper) is never keyed on the paper's number in the world's
// file, whether it is drawn on the participant's stream or on the run's stream for one thing (`ctx.chance`).
// (TS world only: the draw trace (`drawTrace`) is the TS loop's. On the Rust world the keys are `actors/src/draws.rs`'s, and its
// own unit tests hold the same rule: a record's number is never in a key, `paper#n` is.)
// (The TS world's draw names, read from its run streams: deleted with the TS actors at the cut-over, 2026-10-19. The engine's draws are
// keyed on stable identities by construction and held so by kernel/tests/determinism_lint.rs.)

