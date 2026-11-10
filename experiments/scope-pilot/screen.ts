// The code-only screen (docs/research/paper-plan.md 7.1; docs/design/handing-over.md H6): how much work a spec's town
// gives each assistant seat, before any model is run. It runs the spec's code arms only (the code assistant in every
// seat: no model is called), from the spec's own fork for its own length, and reads each fork's log: per assistant seat
// and per month after the fork, the clients it serves, the matters handed to it by kind, its steps per matter (its own
// acts), its sittings with and without anything new, and the events that already occur which would be obstacles under
// paper plan 3.1 (a refusal of its act; a paper of its returned; silence past a due day its own paper names). It also
// says who was offered the households' service and who took it up. It decides nothing and pins nothing: what it reads
// is reported.
//
//   bun experiments/scope-pilot/screen.ts <spec.ts> [--out <dir>] [--keep]
//
// The runs go to `--out` (default: a folder in the system's temporary directory, never the runs folder: a screen is not
// a study's run); its table to `screen.txt` and `screen.json` there. Rounds, seeds, fork and length are the spec's.
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { loadSpec, runExperiment } from "../../orchestrator/src/experiment";
import { kernelBinary } from "../../orchestrator/src/kernel";

const DAY = 86_400;
const MONTH = 30 * DAY;
/** The papers from a principal that an assistant acts on: what is new to it at a sitting. */
const INCOMING = new Set(["referral", "sign_off", "declined", "go_ahead", "remit", "brief"]);
/** An assistant's own papers about its matters (beside the principal's papers it sends). */
const OWN = new Set(["draft", "approval_request", "report", "advice", "scope_request", "handover"]);

type Row = { clients: number; matters: { [kind: string]: number }; kept: { [kind: string]: number }; steps: number; sittings: number; with_new: number; refused: number; returned: number; overdue: number; answered_back: number };
const row = (): Row => ({ clients: 0, matters: {}, kept: {}, steps: 0, sittings: 0, with_new: 0, refused: 0, returned: 0, overdue: 0, answered_back: 0 });

export interface Screen {
  spec: string; seed: number; arm: string; fork_day: number; days: number;
  /** The households offered the service (those with a rule for it), and those who took it up, with the figures their
   * rule weighed when they did (its `engage` decisions). */
  households: { offered: number; took_up: number; by_hand: number; engaged: { who: string; day: number; saving: string; fee: string; committed: boolean }[] };
  /** Per seat (its post), per month after the fork. */
  seats: { [post: string]: Row[] };
}

/** One fork's log, read. */
export async function screenLog(log: string, config: any, o: { forkDay: number; days: number; spec: string; seed: number; arm: string }): Promise<Screen> {
  const months = Math.ceil(o.days / 30);
  const from = o.forkDay * DAY;
  const month = (t: number) => Math.floor((t - from) / MONTH);
  const seats: { [post: string]: Row[] } = {};
  const seat = (post: string) => (seats[post] ??= Array.from({ length: months }, row));
  // (The assistants' kinds of system, from the spec's post: `template:a,b`; their posts, from the config.)
  const providers = new Set<string>((config.participants ?? []).filter((p: any) => p.kind === "system" && /-desk-system$/.test(p.id)).map((p: any) => String(p.owner)));
  const principalPost = new Map<string, string>();
  const kindsOf = new Map<string, Set<string>>(); // a principal's post (or a person) -> the kinds it may hand over
  for (const pos of config.positions ?? []) {
    const d = pos.role_module?.params?.delegation;
    if (d?.post) { principalPost.set(pos.id, d.post); kindsOf.set(pos.id, new Set(Object.keys(d.kinds ?? {}))); seat(d.post); }
  }
  for (const pr of providers) seat(`${pr}-desk`);
  const offered = (config.participants ?? []).filter((p: any) => p.kind === "person" && p.controller?.params?.delegation);
  const byHand = offered.filter((p: any) => p.controller.params.delegation.commit).length;
  for (const p of offered) kindsOf.set(p.id, new Set(Object.keys(p.controller.params.delegation.kinds ?? {})));
  const desk = [...providers][0];

  const dir = mkdtempSync(join(tmpdir(), "oikos-screen-"));
  const out = join(dir, "log.jsonl");
  const x = Bun.spawnSync([kernelBinary(), "export", log, "--out", out], { stdout: "pipe", stderr: "pipe" });
  if (x.exitCode !== 0) throw new Error(`export of ${log}: ${x.stderr.toString().slice(0, 300)}`);

  const postOf = new Map<string, string>(); // a seat's system -> its post (from its acts)
  const seatRecord = new Map<string, string>(); // a record an assistant wrote -> its post
  const incomingAt = new Map<string, number[]>(); // post -> times new papers reached it
  const observed = new Map<string, number[]>(); // system -> its sittings
  const engaged: Screen["households"]["engaged"] = [];
  const deliveries = new Map<string, { person: string; provider: string; at: number; ended?: number }>(); // order -> a desk's client
  const isSeat = (post: string | undefined) => !!post && post in seats;
  const toSeat = (r: any): string | undefined => {
    // (An organisation's papers to its assistant are its own, in its principal's post; a person's go to the provider.)
    const p = principalPost.get(r.in_position ?? "");
    if (p) return p;
    const prov = (r.addressed_to ?? []).find((a: string) => providers.has(a));
    return prov && r.speaks_for && !providers.has(r.speaks_for) ? `${prov}-desk` : undefined;
  };
  const rl = createInterface({ input: createReadStream(out), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length > 200_000 && !line.includes('"recorded"')) continue;
    const e = JSON.parse(line);
    const t: number = e.t ?? 0;
    const b = e.body ?? {};
    if (e.kind === "command") {
      // (A step is one act of the seat's, in its post, however many papers it makes: fifteen rates notices are one.)
      if (b.command === "act" && isSeat(b.as) && t >= from && month(t) < months) seat(b.as)[month(t)]!.steps++;
      // (What a principal did itself of the kinds it may hand over: the work a seat would have, were it all handed.)
      const who = b.as ?? b.participant;
      const own = kindsOf.get(who);
      const to = b.as ? principalPost.get(b.as) : desk && `${desk}-desk`;
      if (b.command === "act" && own && to && t >= from && month(t) < months && !(b.blocks ?? []).some((x: any) => x.kind === "referral")) {
        const m = seat(to)[month(t)]!;
        for (const k of new Set<string>((b.blocks ?? []).map((x: any) => x.kind).filter((k: string) => own.has(k)))) m.kept[k] = (m.kept[k] ?? 0) + 1;
      }
      if (b.command === "observe" && t >= from) { const v = observed.get(b.participant) ?? observed.set(b.participant, []).get(b.participant)!; if (v.at(-1) !== t) v.push(t); }
      continue;
    }
    if (e.kind === "annotation") {
      const d = b.data ?? {};
      if (d.domain === "delegation" && d.choice === "engage" && offered.some((p: any) => p.id === b.subject)) {
        engaged.push({ who: b.subject, day: Math.round(t / DAY), saving: String(d.saving ?? ""), fee: String(d.fee ?? ""), committed: !!d.committed });
      }
      continue;
    }
    if (b.event === "action_refused") {
      const post = postOf.get(b.participant);
      if (post && t >= from && month(t) < months) seat(post)[month(t)]!.refused++;
      continue;
    }
    if (b.event !== "recorded") continue;
    const r = b.record ?? {};
    if (r.kind === "service_delivery" && providers.has(r.speaks_for) && r.data?.order) {
      const person = (r.addressed_to ?? [])[0];
      if (person && offered.some((p: any) => p.person === person)) deliveries.set(r.data.order, { person, provider: r.speaks_for, at: t });
    }
    if (r.kind === "service_ended" && r.data?.order && deliveries.has(r.data.order)) deliveries.get(r.data.order)!.ended = t;
    // (What an assistant wrote: in its post, by its system.)
    if (isSeat(r.in_position)) {
      postOf.set(r.author, r.in_position);
      seatRecord.set(r.id, r.in_position);
      continue;
    }
    const target = toSeat(r);
    if (target && INCOMING.has(r.kind)) {
      (incomingAt.get(target) ?? incomingAt.set(target, []).get(target)!).push(t);
      if (t >= from && month(t) < months) {
        const m = seat(target)[month(t)]!;
        if (r.kind === "referral") { const k = `${r.data?.kind ?? "?"}${r.data?.wants === "advice" ? " (advice)" : ""}`; m.matters[k] = (m.matters[k] ?? 0) + 1; }
        if (r.kind === "declined") m.returned++;
      }
      continue;
    }
    // (Someone else's paper that answers one an assistant sent: a counterparty's answer, kept apart.)
    const bases = Array.isArray(r.basis) ? r.basis : r.basis ? [r.basis] : [];
    const answered = bases.map((x: string) => seatRecord.get(x)).find(Boolean);
    if (answered && t >= from && month(t) < months && !OWN.has(r.kind)) seat(answered)[month(t)]!.answered_back++;
  }
  rmSync(dir, { recursive: true, force: true });
  // Sittings: a seat's wakes after the fork, and those at which something new from its principals had come in since the last.
  for (const [sys, post] of postOf) {
    const times = observed.get(sys) ?? [];
    const inc = (incomingAt.get(post) ?? []).sort((a, b) => a - b);
    let prev = from, i = 0;
    while (i < inc.length && inc[i]! <= prev) i++;
    for (const t of times) {
      if (month(t) >= months) break;
      const m = seat(post)[month(t)]!;
      m.sittings++;
      let fresh = false;
      while (i < inc.length && inc[i]! <= t) { fresh = true; i++; }
      if (fresh) m.with_new++;
      prev = t;
    }
  }
  // Clients: an organisation's seat serves its own organisation; a desk, the persons with a service of it in force.
  for (const [post, rows] of Object.entries(seats)) rows.forEach((m, k) => {
    const end = from + (k + 1) * MONTH;
    if (post.endsWith("-desk")) m.clients = [...deliveries.entries()].filter(([, d]) => d.at < end && (d.ended === undefined || d.ended >= from + k * MONTH) && post === `${d.provider}-desk`).length;
    else m.clients = m.sittings || m.steps || Object.keys(m.matters).length ? 1 : 0;
  });
  return { spec: o.spec, seed: o.seed, arm: o.arm, fork_day: o.forkDay, days: o.days,
    households: { offered: offered.length, took_up: new Set(engaged.filter((x) => !x.committed).map((x) => x.who)).size, by_hand: byHand, engaged }, seats };
}

export function screenText(s: Screen): string {
  const lines = [`${s.spec}, seed ${s.seed}, arm ${s.arm}: ${s.days} days after the fork on day ${s.fork_day}`,
    `households offered the service: ${s.households.offered} (engaged by hand: ${s.households.by_hand}); took it up by their own rule: ${s.households.took_up}`];
  for (const e of s.households.engaged.filter((x) => !x.committed).slice(0, 20)) lines.push(`  ${e.who} engaged on day ${e.day}: saving ${e.saving} a month against a fee of ${e.fee} (cents, its rule's figures)`);
  lines.push("", "seat | month | clients | matters (by kind) | kept: done by the principal itself, of kinds it may hand over | steps a matter | sittings (with something new) | refused | returned | silent past due | answered back");
  // (Only the seats that sat or were handed anything: every principal has an assistant post, mostly vacant.)
  const live = Object.entries(s.seats).filter(([post, rows]) => rows.some((m) => m.sittings || m.steps || Object.keys(m.matters).length || (post.endsWith("-desk") && Object.keys(m.kept).length)));
  for (const [post, rows] of live.sort()) rows.forEach((m, k) => {
    const n = Object.values(m.matters).reduce((a, b) => a + b, 0);
    const kinds = Object.entries(m.matters).sort((a, b) => b[1] - a[1]).map(([kk, v]) => `${kk} ${v}`).join(", ");
    const kept = Object.entries(m.kept).sort((a, b) => b[1] - a[1]).map(([kk, v]) => `${kk} ${v}`).join(", ");
    lines.push(`${post} | ${k + 1} | ${m.clients} | ${n}${kinds ? ` (${kinds})` : ""} | ${Object.values(m.kept).reduce((a, b) => a + b, 0)}${kept ? ` (${kept})` : ""} | ${n ? (m.steps / n).toFixed(1) : "-"} | ${m.sittings} (${m.with_new}) | ${m.refused} | ${m.returned} | ${m.overdue} | ${m.answered_back}`);
  });
  lines.push("", "(Silent past due is counted only where a seat's own paper names a due day: no paper of the code assistant does. Answered back: another party's paper citing one the seat sent, kept apart; not an obstacle by itself.)");
  return lines.join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("usage: bun experiments/scope-pilot/screen.ts <spec.ts> [--out <dir>]");
  const at = args.indexOf("--out");
  const { spec } = await loadSpec(file);
  const arms = spec.arms.filter((a) => a.steward.kind === "code");
  if (!arms.length) throw new Error(`${file}: the spec has no code arm to screen with`);
  const outDir = resolve(at >= 0 ? args[at + 1]! : mkdtempSync(join(tmpdir(), `${spec.name}-screen-`)));
  if (/\/runs(\/|$)/.test(outDir)) throw new Error(`${outDir}: a screen is not a study's run; write it outside the runs folder`);
  const screened = { ...spec, arms, seats: { ...(spec.seats ?? {}), budget: undefined } } as typeof spec;
  if (!existsSync(join(outDir, "results.json"))) await runExperiment(screened, { out: outDir, parallel: 0, log: (x) => console.error(x) });
  const all: Screen[] = [];
  for (const seed of spec.seeds) for (const a of arms) {
    const dirSeed = join(outDir, `seed-${seed}`);
    const config = JSON.parse(readFileSync(join(dirSeed, "config.json"), "utf8"));
    all.push(await screenLog(join(dirSeed, `${a.name}.oklog`), config, { forkDay: spec.forkDay, days: spec.untilDay - spec.forkDay, spec: spec.name, seed, arm: a.name }));
  }
  const text = all.map(screenText).join("\n\n");
  writeFileSync(join(outDir, "screen.json"), JSON.stringify(all, null, 1));
  writeFileSync(join(outDir, "screen.txt"), text + "\n");
  console.log(text);
  console.log(`\n(written to ${join(outDir, "screen.txt")})`);
}
