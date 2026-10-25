// The towns and readings shared by the twin-draws tests (orchestrator/test/twin-draws*.test.ts): one town run twice from one
// seed, once with an office that files papers of no effect or sits in a mock seat; and what two towns answered and drew alike.
// (Split out of twin-draws.test.ts at the test pruning, 2026-10-24, so that its towns run in three files side by side.)

import { expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls as C, modules as builtin, type BehaviourModule } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../../src/run";
import { onRust } from "./doubles";
import { officeAt, systemAt } from "./offices";

export const root = join(import.meta.dir, "../../..");
export const DAY = 86_400;
export const spec = { ...(Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any), shop_mix: false /* the single-goods town: this test holds a mechanism of it (docs/risks.md ME-19) */ };
// (Frictions at several times the sourced rate, so that a small town has requests enough in a short run.)
export const living = { ...spec, citizens: 300, profile: "ke-nakuru-2026", living: { initiative_bps: 10_000, friction_bps: Number(process.env.TWIN_FRICTION ?? 100_000) } };
// (2026-10-12, homes by income: until then most of this town's requests and decisions were about rent nobody in the
// home could pay, the opening-day artefact. Without them 75 days at eight times the rate gave 6; the dial's most and
// 120 days give 11, and the least expected below is 8 where it was 12.)

/** An office doing its job as its module does it, and filing besides, each time it has nothing else to do, an entry
 * on its organisation's own file: a paper of no effect on anyone, which takes a number in the world's file. */
export const SCRIBBLE = (t: string | number) => C.program(C.call("statement", { kind: "entry", visible: "own", text: C.text(`Nothing to enter at ${t}.`) }), C.call("statement", { kind: "entry", visible: "own", text: C.text("Nor here.") }));
export const scribbling = (inner: string): BehaviourModule => ({
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
export function seatAsSystem(config: any, post: string) {
  const seat = config.participants.find((p: any) => p.id === `${post}-system`);
  const post0 = config.positions.find((p: any) => p.id === post);
  const blocks = "transfer move_goods take work open_account close_account construct demolish occupy vacate arrive leave birth harm create_position appoint deploy retire create_entity record_claim transfer_claim release_claim propose_agreement sign_agreement give_notice publish withdraw vote message".split(" ");
  if (!config.templates.some((t: any) => t.id === "office-system")) config.templates.push({ id: "office-system", kind: "system", supplier: "outside", does: blocks.map((block) => ({ block })), controller: { type: "code", impl: "test" }, framing: { disclosure: "unstated", reason: "test" } });
  delete seat.person; delete seat.shares_body; delete seat.channels;
  Object.assign(seat, { kind: "system", owner: post0.entity, template: "office-system", supplier: "outside" });
}

export async function town(name: string, more: object, scribe?: string, days = Number(process.env.TWIN_DAYS ?? 120), system?: string) {
  const dir = mkdtempSync(join(tmpdir(), `oikos-${name}-`));
  try {
    const config = generate({ ...living, ...more });
    if (system?.startsWith("seat:")) {
      seatAsSystem(config, system.slice(5));
      // (And its staff post, which the seat's town has and the twin's has not: a system's too.)
      if (config.positions.some((p: any) => p.id === `${system.slice(5)}-staff`)) systemAt(config, `${system.slice(5)}-staff`);
    }
    else if (system?.startsWith("code:")) {
      // The twin of that town: the same posts (the town is generated with the same seat, so the office has the same staff post), the seat's participant the same system,
      // and who holds the post the only difference: the office's own code holds it, and its staff.
      const post = system.slice(5);
      const seat = config.participants.find((p: any) => p.id === `${post}-system`);
      const mock = seat.controller.params.mock;
      seatAsSystem(config, post);
      seat.controller = { type: "code", impl: mock.brain, params: mock.params ?? {} };
      if (config.positions.some((p: any) => p.id === `${post}-staff`)) systemAt(config, `${post}-staff`);
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
export async function run(name: string, more: object, scribe?: string, system?: string) { return (await town(name, more, scribe, undefined, system)).records; }

/** Each request to put something right with the answer it got, named for who asked whom about what and which time
 * that was for the pair, at the hour it was asked: never by a record's number. */
export function answers(records: any[], dealtWith: Set<string>) {
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

/** What two towns drew alike: the keys of a stream (who, in what capacity, the day, what for, which time that was
 * that day) in both, with how many times each. A draw is told apart by what it is for, so a key in one town and in
 * the other fell the same way. `by` says whose a key is. */
export function alike(a: Map<string, number>, b: Map<string, number>, mine: (pid: string) => boolean) {
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
export const share = (x: { same: number; all: number }) => `${x.same} of ${x.all} (${((100 * x.same) / Math.max(1, x.all)).toFixed(1)}%)`;
/** A decision or act by a participant: who it was is the first part of its name. */
export function matched(a: string[], b: string[], mine: (pid: string) => boolean) {
  const there = new Set(b);
  const ours = a.filter((x) => mine(x.split("|")[0]!));
  return { same: ours.filter((x) => there.has(x)).length, all: ours.length, apart: ours.filter((x) => !there.has(x)) };
}
