// Three offices held by mock seats, in one run (docs/decisions.md, 2026-10-09: directions, an office's own papers,
// standing work). No model is called: each seat's brain is the office's own code, saying what it does as a seat does.
//
//   bun scripts/office-seats-demo.ts --out DIR [--days 60] [--citizens 1000] [--seed 1] [--direct 17] [--lift 24] [--hold 40] [--resume 43]
//
// The town starts with its works crew still to be taken on.
//  (a) The mayor (the code mayor, with two acts of its own on given days) directs the works office not to recruit,
//      and later withdraws the direction.
//  (b) The works manager advertises for a crew on the office's own form, takes it on, and sets the crew's routine by
//      standing work orders, once; the crew, a post of its own, does the round. On given days the manager puts the
//      collection order on hold and lifts the hold: an exception.
//  (c) The registrar registers the deaths that are reported, on the register's own form.
// It prints what each seat did, sitting by sitting, and what came of it. DIR must not exist and must not be under runs/.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve as path } from "node:path";
import { calls as C, modules as builtin, type BehaviourModule } from "../participants/src/index";
import { generate } from "../worlds/generator/generate";
import { runWorld } from "../orchestrator/src/run";

const arg = (name: string, d?: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : d; };
const out = arg("out");
if (!out || existsSync(out) || /(^|\/)runs(\/|$)/.test(path(out))) throw new Error("--out DIR: a folder that does not exist yet, outside runs/");
const DAY = 86_400;
const days = Number(arg("days", "60")), direct = Number(arg("direct", "17")), lift = Number(arg("lift", "24")), hold = Number(arg("hold", "40")), resume = Number(arg("resume", "43"));

/** An office's own code, and on given days an act of its own: what it is told to do then, by what it has on file. */
type Own = { day: number; act: (mine: Map<string, string>) => C.Call | undefined };
const withActs = (inner: string): BehaviourModule => ({
  name: `demo.${inner.replace(/\./g, "_")}`, version: "0.0.1", doc: "scripts/office-seats-demo.ts", cadence: () => DAY,
  create(ctx) {
    const { acts, ...rest } = ctx.params as { acts: number };
    const office = builtin[inner]!.create({ ...ctx, params: rest });
    const todo = [...SCRIPTS[acts]!];
    const mine = new Map<string, string>(); // kind (and kind:task) -> the id of our latest standing paper of it
    return Object.assign(Object.create(office), {
      step(obs: any, x: any) {
        for (const ch of Object.values(obs.channels) as any[]) for (const r of ch.records ?? []) if (r.record === "statement" && r.author === obs.participant) {
          mine.set(r.kind, r.id);
          if (r.kind === "work_order") mine.set(`work_order:${r.data?.work?.task}`, r.id);
        }
        if (todo.length && obs.t >= todo[0]!.day * DAY) {
          const call = todo[0]!.act(mine);
          if (call) {
            todo.shift();
            return { type: "call" as const, call: C.program(call) };
          }
        }
        return office.step(obs, x);
      },
    });
  },
});
const SCRIPTS: Own[][] = [
  [{ day: direct, act: () => C.call("form", { form: "works_staffing", to: "works", recruit: "no" }) },
    { day: lift, act: (mine) => (mine.get("direction") ? C.call("statement", { withdraw: mine.get("direction")! }) : undefined) }],
  [{ day: hold, act: (mine) => (mine.get("work_order:collect") ? C.call("statement", { hold: mine.get("work_order:collect")!, text: C.text("No round for three days.") }) : undefined) },
    { day: resume, act: (mine) => (mine.get("hold") ? C.call("statement", { withdraw: mine.get("hold")! }) : undefined) }],
];

const spec = Bun.YAML.parse(readFileSync(join(import.meta.dir, "../worlds/town-1000.yaml"), "utf8")) as any;
const config = generate({ ...spec, citizens: Number(arg("citizens", "1000")), seed: Number(arg("seed", String(spec.seed))), mayor: "llm", model_seats: "works,registry", works_crew_at_start: 0 });
// (A seat sits each working day, as a model in one does; the generated mock sits weekly unless woken.)
for (const p of config.participants) if (["mayor-system", "works-system", "registry-system"].includes(p.id)) p.controller.params.cadence_days = 1;
const mods: { [name: string]: BehaviourModule } = {};
for (const [seat, n] of [["mayor-system", 0], ["works-system", 1]] as const) {
  const p = config.participants.find((x: any) => x.id === seat);
  const m = withActs(p.controller.params.mock.brain);
  mods[m.name] = m;
  p.controller.params.mock = { brain: m.name, params: { ...p.controller.params.mock.params, acts: n } };
}
const s = await runWorld({ config, runId: "office-seats", outDir: out, until: days * DAY, modules: mods });

const lines = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const day = (t: number) => Math.floor(t / DAY);
const events = lines.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
const records = events.filter((e) => e.event === "recorded").map((e) => e.record);
const commands = lines.filter((e) => e.kind === "command").map((e) => ({ t: e.t, ...e.body }));
const list = (xs: (number | string)[]) => (xs.length ? xs.join(", ") : "none");
const say = (...x: string[]) => console.log(x.join(""));

say(`Run: ${config.meta.description} ${days} days. Participant errors ${s.participantErrors}; ${s.commands} commands, ${s.refused} refused; final state ${s.stateHash.slice(0, 16)}.`);

// ---- the seats: sittings, requests and acts
say("\nWhat each seat did");
for (const seat of ["mayor-system", "works-system", "registry-system"]) {
  const asked = lines.filter((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.subject === seat && e.body.data?.purpose === "participant");
  const uses = asked.flatMap((e) => ((e.body.data.output ?? []) as any[]).filter((b) => b.type === "tool_use").map((b) => ({ t: e.body.data.t ?? e.t, name: b.name as string })));
  const byDay = new Map<number, { answers: number; dos: number; looks: number; writes: number }>();
  for (const e of asked) { const d = day(e.body.data.t ?? e.t); const x = byDay.get(d) ?? { answers: 0, dos: 0, looks: 0, writes: 0 }; x.answers++; byDay.set(d, x); }
  for (const u of uses) { const x = byDay.get(day(u.t))!; if (u.name === "do") x.dos++; if (u.name === "look") x.looks++; if (u.name === "write") x.writes++; }
  const acts = commands.filter((c) => c.participant === seat && (c.blocks ?? []).length);
  const perDay = [...byDay.values()];
  const busiest = [...byDay].sort((a, b) => b[1].dos + b[1].writes - (a[1].dos + a[1].writes))[0];
  const most = Math.max(0, ...asked.map((e) => ((e.body.data.output ?? []) as any[]).filter((b) => b.type === "tool_use" && ["do", "write", "confirm", "look"].includes(b.name)).length));
  say(`- ${seat.replace(/-system$/, "")}: ${byDay.size} sittings (days it was asked anything), ${asked.length} answers; ${uses.filter((u) => u.name === "do").length} things asked for, ${uses.filter((u) => u.name === "write").length} letters, ${uses.filter((u) => u.name === "look").length} looks; ${acts.length} acts carried out. ` +
    `Sittings with nothing asked for: ${perDay.filter((x) => x.dos + x.writes === 0).length}. Busiest sitting: day ${busiest?.[0]}, ${busiest ? busiest[1].dos + busiest[1].writes : 0} things asked for or written; most in any one answer: ${most}.`);
  const kinds = new Map<string, number>();
  for (const c of acts) for (const line of String(c.provenance?.call ?? "").split("\n")) {
    const fn = /^(?:[a-z0-9_]+ = )?([a-z]+)\(/.exec(line)?.[1];
    if (!fn) continue;
    const what = fn === "form" ? `form ${/form=([a-z_]+)/.exec(line)?.[1]}` : fn === "statement" ? `statement ${/kind=([a-z_]+)/.exec(line)?.[1] ?? (/withdraw=/.test(line) ? "(withdrawal)" : /hold=/.test(line) ? "(hold)" : "")}` : fn === "work" ? `work${/every=/.test(line) ? " (standing order)" : ""}` : fn;
    kinds.set(what, (kinds.get(what) ?? 0) + 1);
  }
  say(`  acts: ${[...kinds].sort().map(([k, n]) => `${k} x${n}`).join("; ") || "none"}`);
}

// ---- (a) the direction
const direction = records.find((r) => r.kind === "direction");
const lifted = direction && records.find((r) => r.record === "withdrawal" && r.withdraws === direction.id);
const adverts = records.filter((r) => r.kind === "job_posting" && r.speaks_for === "city" && r.data?.role === "works crew");
const budget = records.find((r) => r.kind === "budget" && r.speaks_for === "city");
const hires = records.filter((r) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0] === "city");
const between = (xs: any[], a: number, b: number) => xs.filter((x) => x.at >= a && x.at < b);
say("\n(a) The mayor directs the works office");
say(`- Budget adopted on day ${budget ? day(budget.at) : "never"}; its staff line pays for a crew the town does not have.`);
if (direction) {
  const to = lifted?.at ?? Infinity;
  const letter = commands.flatMap((c) => (c.blocks ?? []).filter((b: any) => b.block === "message" && b.re === direction.id).map((b: any) => ({ day: day(c.t), text: b.text })))[0];
  say(`- Direction ${direction.id} filed on day ${day(direction.at)} (in the post ${direction.in_position}, on ${direction.basis}): ${JSON.stringify(direction.data)}. Withdrawn on day ${lifted ? day(lifted.at) : "never"}.`);
  say(`- The works office's letter back (day ${letter?.day}): "${letter?.text}"`);
  say(`- Crew advertisements placed on days: before it ${list(between(adverts, 0, direction.at).map((a) => day(a.at)))}; while it stood ${list(between(adverts, direction.at, to).map((a) => day(a.at)))}; after ${list(between(adverts, to, Infinity).map((a) => day(a.at)))}.`);
  say(`- Crew taken on (offers made) on days: before ${list(between(hires, 0, direction.at).map((a) => day(a.at)))}; while it stood ${list(between(hires, direction.at, to).map((a) => day(a.at)))}; after ${list(between(hires, to, Infinity).map((a) => day(a.at)))}.`);
}

// ---- (b) the works manager and the crew
const orders = records.filter((r) => r.kind === "work_order");
const holds = records.filter((r) => r.kind === "hold" && r.speaks_for === "city");
const round = (config.world.records as any[]).filter((r) => r.kind === "service_address").length;
const collect = commands.filter((c) => c.participant === "works-staff-system").flatMap((c) => (c.blocks ?? []).filter((b: any) => b.block === "work" && b.task === "collect").map((b: any) => ({ t: c.t, on: b.on as string, units: b.units as number })));
say("\n(b) The works manager and the crew");
say(`- Standing work orders: ${orders.map((o) => `${o.id} on day ${day(o.at)}: "${o.text}"`).join("; ") || "none"}.`);
for (const h of holds) { const w = records.find((r) => r.record === "withdrawal" && r.withdraws === h.id); say(`- Hold ${h.id} on ${h.data.holds.join(", ")} from day ${day(h.at)} to day ${w ? day(w.at) : "the end"}: collections on the days it stood: ${collect.filter((c) => c.t > h.at && c.t < (w?.at ?? Infinity)).length}.`); }
say(`- The round has ${round} addresses. By week (addresses collected from, loads): ${Array.from({ length: Math.ceil(days / 7) }, (_, w) => { const x = collect.filter((c) => day(c.t) >= w * 7 && day(c.t) < (w + 1) * 7); return `week ${w + 1}: ${new Set(x.map((c) => c.on)).size}, ${x.reduce((n, c) => n + c.units, 0)}`; }).join("; ")}.`);
const complaints = records.filter((r) => r.kind === "complaint" && (r.addressed_to ?? []).includes("city"));
say(`- Complaints about waste to the town: ${complaints.length}${complaints.length ? ` (days ${list([...new Set(complaints.map((c) => day(c.at)))].slice(0, 30))})` : ""}.`);
say(`- The crew: ${hires.length} offers made; the works manager's own work orders by hand (one day's work asked for directly): ${commands.filter((c) => c.participant === "works-system").flatMap((c) => (c.blocks ?? []).filter((b: any) => b.block === "work")).length}.`);

// ---- (c) the registrar
const died = events.filter((e) => e.event === "person_died");
const notes = records.filter((r) => r.kind === "death_notification");
const entries = records.filter((r) => r.kind === "death_registration");
say("\n(c) The registrar");
say(`- Deaths: ${died.length} (days ${list(died.map((d) => day(d.t)))}); notified to the registrar: ${new Set(notes.map((n) => n.data.deceased)).size}; registered: ${entries.length}.`);
for (const r of entries) {
  const d = died.find((x) => x.person === r.data.deceased);
  const cmd = commands.find((c) => (c.blocks ?? []).some((b: any) => b.kind === "death_registration" && b.data?.deceased === r.data.deceased));
  say(`  - ${r.data.deceased}: died day ${d ? day(d.t) : "?"}, reported by ${r.data.reported_by}, registered day ${day(r.at)} as ${r.id}, sent to ${(r.addressed_to ?? []).join(", ")}; asked for as: ${String(cmd?.provenance?.call ?? "").split("\n").find((l) => l.includes("death_registration"))?.slice(0, 220)}`);
}
const unregistered = died.filter((d) => !entries.some((r) => r.data.deceased === d.person));
if (unregistered.length) say(`- Not registered by the end: ${unregistered.map((d) => `${d.person} (died day ${day(d.t)}${notes.some((n) => n.data.deceased === d.person) ? ", notified" : ", not yet reported to the registrar"})`).join("; ")}.`);
