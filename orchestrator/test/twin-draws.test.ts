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

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
// (Frictions at several times the sourced rate, so that a small town has requests enough in a short run.)
const living = { ...spec, citizens: 300, profile: "ke-nakuru-2026", living: { initiative_bps: 10_000, friction_bps: Number(process.env.TWIN_FRICTION ?? 80_000) } };

/** An office doing its job as its module does it, and filing besides, each time it has nothing else to do, an entry
 * on its organisation's own file: a paper of no effect on anyone, which takes a number in the world's file. */
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
        return { type: "call" as const, call: C.program(C.call("statement", { kind: "entry", visible: "own", text: C.text(`Nothing to enter at ${obs.t}.`) }), C.call("statement", { kind: "entry", visible: "own", text: C.text("Nor here.") })) };
      },
    });
  },
});

async function run(name: string, more: object, scribe?: string) {
  const dir = mkdtempSync(join(tmpdir(), `oikos-${name}-`));
  try {
    const config = generate({ ...living, ...more });
    let modules: { [k: string]: BehaviourModule } | undefined;
    if (scribe) {
      const part = config.participants.find((x: any) => x.id === config.positions.find((p: any) => p.id === scribe).holder);
      const wrapped = scribbling(part.controller.impl);
      part.controller = { ...part.controller, impl: wrapped.name };
      modules = { [wrapped.name]: wrapped };
    }
    const s = await runWorld({ config, runId: name, outDir: dir, until: Number(process.env.TWIN_DAYS ?? 75) * DAY, logDetail: "lean", recordObservations: "none", ...(modules ? { modules } : {}) } as any);
    expect(s.participantErrors).toBe(0);
    const records: any[] = [];
    for (const l of readFileSync(s.logPath, "utf8").split("\n")) if (l.includes('"event":"recorded"')) { const r = JSON.parse(l).body.record; if (r?.record === "statement") records.push(r); }
    return records;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Each request to put something right with the answer it got, named for who asked whom about what and which time
 * that was for the pair, at the hour it was asked: never by a record's number. */
function answers(records: any[], dealtWith: Set<string>) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const nth = new Map<string, number>();
  const out = new Map<string, string>();
  const reqKey = new Map<string, string>();
  for (const r of records) {
    if (r.kind !== "remedy_request" || !r.data?.matter) continue;
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

test("papers of no effect, filed by an office that deals with nobody, change no answer and no decision anywhere in the town", async () => {
  // The registry files two entries on the town's own file every day it has nothing else to do: several hundred
  // records the twin has none of, so that almost every later paper of the town has another number.
  const [twin, pilot] = await Promise.all([run("twin-draws-code", {}), run("twin-draws-scribe", {}, "registry")]);
  const extra = pilot.filter((r) => r.kind === "entry" && /^(Nothing to enter at|Nor here)/.test(r.text)).length;
  expect(extra).toBeGreaterThan(50);
  const idsOf = (rs: any[]) => rs.filter((r) => r.kind === "remedy_request").map((r) => r.id).join(",");
  expect(idsOf(pilot)).not.toBe(idsOf(twin));
  const a = answers(twin, new Set()), b = answers(pilot, new Set());
  console.log(`twin draws: ${extra} papers of no effect; ${a.size} requests and decisions in the twin, ${b.size} beside them`);
  expect(a.size).toBeGreaterThan(12);
  // The same requests, at the same hours, with the same answers: the whole of it, not a part.
  expect([...b.entries()].sort()).toEqual([...a.entries()].sort());
  // And the town beside them is the same town: every paper but the entries, in the same order, with the same words.
  const said = (rs: any[]) => rs.filter((r) => r.kind !== "entry").map((r) => `${r.at} ${r.kind} ${r.speaks_for} ${r.text.replace(/rec\.[0-9]+/g, "rec")}`);
  expect(said(pilot)).toEqual(said(twin));
}, 900_000);

test("with an office in a mock seat, the same requests still get the same answers from those the seat did not deal with", async () => {
  // (A seat is not its code twin: it sits in office hours and its acts land at other moments, so the two towns do
  // part, by what truly differs. What must not differ is the answer to a request that is the same in both.)
  const [twin, pilot] = await Promise.all([run("twin-draws-code-2", {}), run("twin-draws-seat", { mayor: "llm" })]);
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
