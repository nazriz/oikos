// What the town's institutions say and do after the second live check's fixes (docs/decisions.md, 2026-10-09, the
// entries from "The bank's statement"), shown with mock seats. No model is called: each seat's brain is the office's
// own code, saying what it does as a seat does, with a few acts of its own on given days (a letter, a late vote).
//
//   bun scripts/institutions-demo.ts --out DIR --set a|b [--seed 1] [--days 60] [--citizens 1000]
//
// Set a: the mock in the mayor's, finance and planning seats. The finance seat writes to the bank on days 9 and 23
//   (its statements); the mayor votes on the opening ballot on day 2 (closed: the clerk says so), puts a proposal to
//   the council on day 3 (a result that names its votes), tries to withdraw a wage instruction on day 6 (the bank
//   refuses: not a signatory) and writes to the code-run works office on day 5. The environment office is code: its
//   new starter's payroll notice reaches the finance seat.
// Set b: the mock in the works, registry and environment seats. The works seat writes to the code-run mayor on day 5
//   for a staffing direction (the acknowledgement); the environment seat's new starter is noticed to code finance.
// DIR must not exist and must not be under runs/.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve as path } from "node:path";
import { calls as C, modules as builtin, type BehaviourModule } from "../participants/src/index";
import { generate } from "../worlds/generator/generate";
import { runWorld } from "../orchestrator/src/run";

const arg = (name: string, d?: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : d; };
const out = arg("out"), set = arg("set", "a");
if (!out || existsSync(out) || /(^|\/)runs(\/|$)/.test(path(out))) throw new Error("--out DIR: a folder that does not exist yet, outside runs/");
const DAY = 86_400;
const days = Number(arg("days", "60"));

type Own = { day: number; act: (known: { wageOrder?: string }) => any };
const say = (text: string, to: string[]) => ({ type: "message" as const, to, text });
const call = (c: C.Call) => ({ type: "call" as const, call: C.program(c) });
const SCRIPTS: { [seat: string]: Own[] } = set === "a" ? {
  "mayor-system": [
    { day: 2, act: () => call(C.call("vote", { ballot: "budget-year-1-ballot", choice: "yes" })) },
    { day: 3, act: () => call(C.call("form", { form: "council_proposal", proposal: C.text("That the council thanks the works crew for its year's work."), kind: "other", affects: "neither" })) },
    { day: 5, act: () => say("Please tell me how many crew the works office has, and recruit two more.", ["works"]) },
    { day: 6, act: (k) => (k.wageOrder ? call(C.call("statement", { withdraw: k.wageOrder })) : undefined) },
  ],
  "finance-system": [
    { day: 9, act: () => say("Please send a statement of the town's account: what has been paid in and out.", ["bank"]) },
    { day: 23, act: () => say("Please send a statement of the town's account since the last.", ["bank"]) },
  ],
} : {
  "works-system": [
    { day: 5, act: () => say("The works office asks for a staffing direction: may it recruit to its budget line?", ["mayor"]) },
    { day: 12, act: () => say("The works office asks again for a staffing direction.", ["mayor"]) },
  ],
};

const withActs = (inner: string, seat: string): BehaviourModule => ({
  name: `demo.${seat.replace(/-system$/, "")}`, version: "0.0.1", doc: "scripts/institutions-demo.ts", cadence: () => DAY,
  create(ctx) {
    const office = builtin[inner]!.create(ctx);
    const todo = [...(SCRIPTS[seat] ?? [])];
    const known: { wageOrder?: string } = {};
    return Object.assign(Object.create(office), {
      step(obs: any, x: any) {
        for (const ch of Object.values(obs.channels) as any[]) for (const r of ch.records ?? []) if (r.record === "statement" && r.kind === "request" && r.speaks_for === "city" && /-wages$/.test(r.id)) known.wageOrder ??= r.id;
        if (todo.length && obs.t >= todo[0]!.day * DAY) {
          const act = todo[0]!.act(known);
          if (act) {
            todo.shift();
            return act;
          }
        }
        return office.step(obs, x);
      },
    });
  },
});

const spec = Bun.YAML.parse(readFileSync(join(import.meta.dir, "../worlds/town-1000.yaml"), "utf8")) as any;
const seats = set === "a" ? ["mayor", "finance", "planning"] : ["works", "registry", "environment"];
const config = generate({ ...spec, citizens: Number(arg("citizens", "1000")), seed: Number(arg("seed", String(spec.seed))), ...(seats.includes("mayor") ? { mayor: "llm" } : {}), model_seats: seats.filter((s) => s !== "mayor").join(",") });
const mods: { [name: string]: BehaviourModule } = {};
for (const seat of seats.map((s) => `${s}-system`)) {
  const p = config.participants.find((x: any) => x.id === seat);
  p.controller.params.cadence_days = 1; // (a seat sits each working day, as a model in one does)
  if (!SCRIPTS[seat]) continue;
  const m = withActs(p.controller.params.mock.brain, seat);
  mods[m.name] = m;
  p.controller.params.mock = { ...p.controller.params.mock, brain: m.name };
}
const s = await runWorld({ config, runId: `institutions-${set}`, outDir: out, until: days * DAY, modules: mods });

const lines = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const day = (t: number) => Math.floor(t / DAY) + 1;
const events = lines.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
const records = events.filter((e) => e.event === "recorded").map((e) => e.record);
const commands = lines.filter((e) => e.kind === "command").map((e) => ({ t: e.t, ...e.body }));
const letters = commands.flatMap((c) => (c.blocks ?? []).filter((b: any) => b.block === "message").map((b: any) => ({ t: c.t, from: c.participant as string, to: b.to as string[], text: b.text as string, re: b.re as string | undefined })));
const print = (...x: string[]) => console.log(x.join(""));
const cut = (text: string, n = 1500) => (text.length > n ? `${text.slice(0, n)} [... ${text.length - n} more characters]` : text);

print(`Set ${set}, seats ${seats.join(", ")} (mock). ${config.meta.description} ${days} days. Participant errors ${s.participantErrors}; ${s.commands} commands, ${s.refused} refused; final state ${s.stateHash.slice(0, 16)}.`);

if (set === "a") {
  print("\n1. The bank's statements, as the finance seat is sent them");
  for (const l of letters.filter((x) => x.from === "bank-payments-system" && x.text.startsWith("Report from bank: Statement of acc-city") && x.to.some((t) => /finance/.test(t)))) print(`- day ${day(l.t)}: "${cut(l.text)}"`);
  print("\n3. A vote on the closed opening ballot, and a result that names its votes");
  const opening = config.world.records.find((r: any) => r.id === "budget-year-1-ballot"), openingResult = config.world.records.find((r: any) => r.id === "budget-year-1-result");
  print(`- The opening ballot: "${cut(opening.text, 160)}"; content closed: ${opening.data.closed}, result: ${opening.data.result}.`);
  print(`- Its result: "${openingResult.text}"`);
  for (const v of records.filter((r) => r.record === "vote" && r.ballot === "budget-year-1-ballot")) print(`- A vote on it on day ${day(v.at)}, cast in the post ${v.in_position} by ${v.author}: "${v.choice}".`);
  for (const l of letters.filter((x) => x.from === "council-clerk-system" && x.text.includes("is not counted"))) print(`- The clerk, day ${day(l.t)}, to ${l.to.join(", ")}: "${l.text}"`);
  for (const r of records.filter((x) => x.kind === "ballot_result" && x.speaks_for === "city")) print(`- A result declared on day ${day(r.at)} (${r.id}): "${r.text}"`);
  print("\n3b. The mayor, who is not a signatory, withdraws a wage instruction");
  for (const w of records.filter((r) => r.record === "withdrawal" && r.in_position === "mayor")) {
    print(`- Withdrawal ${w.id} of ${w.withdraws} on day ${day(w.at)}, in the post ${w.in_position}.`);
    for (const l of letters.filter((x) => x.from === "bank-payments-system" && x.re === w.id)) print(`- The bank, day ${day(l.t)}: "${l.text}"`);
    const paid = events.filter((e) => e.event === "transfer" && e.per_instruction === w.withdraws && e.t > w.at);
    print(`- Payments under ${w.withdraws} after the withdrawal: ${paid.length} (days ${paid.map((e) => day(e.t)).join(", ") || "none"}).`);
  }
}

print(`\n${set === "a" ? "2" : "1"}. A new starter: the payroll notice and the first pay`);
for (const n of records.filter((r) => r.kind === "payroll_notice")) {
  print(`- day ${day(n.at)}, filed in the post ${n.in_position} (${n.id}): "${n.text}"`);
  if (n.data?.notice !== "starter") continue;
  const order = records.find((r) => r.kind === "request" && r.speaks_for === "city" && r.basis === n.data.agreement);
  const pays = order ? events.filter((e) => e.event === "transfer" && e.per_instruction === order.id) : [];
  print(`  ${order ? `wage instruction ${order.id} given on day ${day(order.at)} in the post ${order.in_position}, first due day ${day(order.at + (order.data.first ?? order.data.every))}; paid on days ${pays.map((e) => day(e.t)).join(", ") || "none within the run"}` : "no wage instruction was set up"}.`);
}

print(`\n${set === "a" ? "4" : "2"}. A letter to a code-run office, and what came back`);
for (const l of letters.filter((x) => (set === "a" ? x.from === "mayor-system" && x.to.includes("works") : x.from === "works-system" && x.to.includes("mayor")))) {
  print(`- day ${day(l.t)}, ${l.from.replace(/-system$/, "")} to ${l.to.join(", ")}: "${l.text}"`);
  const back = letters.filter((x) => x.t >= l.t && x.t < l.t + 3 * DAY && x.from === (set === "a" ? "works-system" : "mayor-system") && x.to.includes(l.from));
  // (A standing report is long: its beginning, and its end, where the office says what the report is and what it acts on.)
  for (const b of back.slice(0, 1)) print(`  answered day ${day(b.t)}: "${b.text.length > 1300 ? `${b.text.slice(0, 260)} [... ${b.text.length - 1160} characters of the report ...] ${b.text.slice(-900)}` : b.text}"`);
  if (!back.length) print("  no answer within three days.");
}
