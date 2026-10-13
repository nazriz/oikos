#!/usr/bin/env bun
// The proof run of culture (design 14, step 9): reads the small per-run files scripts/culture-proof.ts wrote, and sets shocked against unshocked
// (paired by seed) per town size and profile, by the criteria written before any run (runs/culture-proof/STATUS).
//   bun scripts/culture-proof-sum.ts <dir with <size>-<profile>-<shock|calm>-<on|off>/m-seed<N>.json> <size> <profile> [on|off]
import { existsSync, readdirSync } from "node:fs";
const [dir, size, profile, mode = "on"] = process.argv.slice(2);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs: number[]) => { if (xs.length < 2) return NaN; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };
const f = (x: number, d = 1) => (Number.isNaN(x) ? "n/a" : x.toFixed(d));
const load = (sh: string) => {
  const d = `${dir}/${size}-${profile}-${sh}-${mode}`; const out = new Map<number, any>();
  if (!existsSync(d)) return out;
  for (const n of readdirSync(d)) { const m = /^m-seed(\d+)\.json$/.exec(n); if (m) out.set(Number(m[1]), JSON.parse(require("node:fs").readFileSync(`${d}/${n}`, "utf8"))); }
  return out;
};
const S = load("shock"), C = load("calm");
const seeds = [...S.keys()].filter((s) => C.has(s)).sort();
console.log(`## ${size} ${profile} dial ${mode}: seeds ${seeds.join(",")}`);
// pair: value in shocked, in calm, difference; mean difference, sd of paired differences, "beyond" if |mean| > 2 sd
const pair = (g: (r: any) => number | undefined) => {
  const a: number[] = [], b: number[] = [], d: number[] = [];
  for (const s of seeds) { const x = g(S.get(s)), y = g(C.get(s)); if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) continue; a.push(x); b.push(y); d.push(x - y); }
  const m = mean(d), s2 = sd(d);
  return { n: d.length, shocked: mean(a), calm: mean(b), diff: m, sd: s2, beyond2sd: Math.abs(m) > 2 * s2 };
};
const line = (name: string, p: ReturnType<typeof pair>, dp = 1) => console.log(`${name.padEnd(46)} shocked ${f(p.shocked, dp)}  calm ${f(p.calm, dp)}  diff ${f(p.diff, dp)} (sd of paired ${f(p.sd, dp)}, n ${p.n})${p.beyond2sd ? "  *beyond 2 sd*" : ""}`);
// bite
console.log("-- what the shock produced in the world (per run)");
for (const k of ["action_ballot", "ballot_result", "stop_work", "warrant_executed"]) line(k, pair((r) => r.counts[k]));
line("bite events (ballots + results + stoppages)", pair((r) => r.counts.action_ballot + r.counts.ballot_result + r.counts.stop_work));
if (mode === "off") process.exit(0);
const share = (r: any, day: number, grouping: string, group: string, conduct: string, key: string) => r.m.norm_shares.find((x: any) => x.day === day && x.grouping === grouping && x.group === group && x.conduct === conduct)?.[key] as number | undefined;
console.log("-- R1 picture: does / approves / says (mean over people) and spread of approves; paired, shocked minus calm; day 7 is the start");
for (const c of ["strike", "join_union", "take_from_employer", "complain", "take_in", "stay_past_notice"]) for (const key of ["does", "approves", "says", "approves_sd"]) {
  for (const day of [90, 210, 364]) line(`${c} ${key} day ${day}`, pair((r) => share(r, day, "all", "all", c, key)));
}
console.log("-- speed and lasting: paired difference of strike/join_union `does` and `says` by day (peak and day 364)");
for (const c of ["strike", "join_union", "take_from_employer"]) for (const key of ["does", "says"]) {
  const days = [30, 60, 90, 150, 210, 270, 330, 364]; const ds = days.map((d) => pair((r) => share(r, d, "all", "all", c, key)).diff);
  console.log(`${c} ${key}: ${days.map((d, i) => `d${d} ${f(ds[i]!, 2)}`).join("  ")}`);
}
console.log("-- R2 near against far: holders of a remembered strike against non-holders, difference of means (holds minus not), shocked arm and calm arm, then the difference of those");
for (const c of ["strike", "join_union", "take_from_employer", "complain"]) for (const key of ["does", "approves", "says", "own"]) {
  const g = (r: any) => { const a = share(r, 364, "near_strike", "holds_strike", c, key), b = share(r, 364, "near_strike", "holds_not_strike", c, key); return a === undefined || b === undefined ? undefined : a - b; };
  const sv = seeds.map((s) => g(S.get(s))).filter((x): x is number => x !== undefined), cv = seeds.map((s) => g(C.get(s))).filter((x): x is number => x !== undefined);
  const hs = seeds.map((s) => S.get(s).m.norm_shares.find((x: any) => x.day === 364 && x.grouping === "near_strike" && x.group === "holds_strike" && x.conduct === c)?.people ?? 0);
  console.log(`${c} ${key}: holders-minus-others shocked ${f(mean(sv))} (sd ${f(sd(sv))}, n ${sv.length}) calm ${f(mean(cv))} (n ${cv.length}); holders per run ${f(mean(hs), 0)}`);
}
console.log("-- R3 talk (per run, the year)");
line("verdicts", pair((r) => r.m.verdicts.total), 0);
line("tales of third persons' acts", pair((r) => r.m.talk.about), 0);
line("talk of the town", pair((r) => r.m.talk.town_talk), 0);
line("household answers", pair((r) => r.m.talk.household_answers), 0);
line("people told wrong of an act", pair((r) => r.m.standing.people_told_wrong_of_an_act), 0);
line("people told right of an act", pair((r) => r.m.standing.people_told_right_of_an_act), 0);
line("ties cooled per person at end", pair((r) => r.m.standing.ties_cooled_per_person_at_end), 2);
for (const c of ["strike", "join_union", "take_from_employer", "complain", "take_in"]) line(`share voicing a verdict, ${c}, day 364 (%)`, pair((r) => share(r, 364, "all", "all", c, "voiced_pct")));
console.log("-- said against thought and pluralistic ignorance");
for (const c of ["strike", "join_union", "take_from_employer", "complain"]) for (const key of ["gap_own_says", "pluralistic_pct", "gap_own_approves"]) for (const day of [7, 364]) line(`${c} ${key} day ${day}`, pair((r) => share(r, day, "all", "all", c, key)));
console.log("-- memory (last picture, per run)");
line("people holding any event (%)", pair((r) => (100 * r.m.memory.at(-1).holding) / r.m.memory.at(-1).people));
for (const k of ["strike", "put_out", "law", "vote", "ruling", "founded"]) line(`holdings of ${k}`, pair((r) => r.m.memory.at(-1).by_kind[k] ?? 0), 0);
for (const k of ["saw", "read", "told"]) line(`came by: ${k}`, pair((r) => r.m.memory.at(-1).by_how[k] ?? 0), 0);
for (const h of ["0", "1", "2", "3"]) line(`through ${h} hands`, pair((r) => r.m.memory.at(-1).by_hands[h] ?? 0), 0);
console.log("-- R4 trust moved, holders minus others, in bps, last picture, by party the event is about");
const parties = new Set<string>(); for (const r of [...S.values(), ...C.values()]) for (const p of Object.keys(r.m.trust_moved.at(-1)?.parties ?? {})) parties.add(p);
for (const p of parties) {
  const g = (r: any) => { const x = r.m.trust_moved.at(-1)?.parties?.[p]; return x ? x.holders_moved_bps - x.others_moved_bps : undefined; };
  const sv = seeds.map((s) => g(S.get(s))).filter((x): x is number => x !== undefined), cv = seeds.map((s) => g(C.get(s))).filter((x): x is number => x !== undefined);
  console.log(`${p.padEnd(30)} shocked ${f(mean(sv), 0)} (sd ${f(sd(sv), 0)}, n ${sv.length})  calm ${f(mean(cv), 0)} (sd ${f(sd(cv), 0)}, n ${cv.length})`);
}
console.log("-- tipping events (per run)");
line("tipping events", pair((r) => r.m.tipping.events.length), 1);
line("decisions recorded", pair((r) => r.m.decisions_recorded), 0);
for (const c of ["join_union", "strike", "complain", "take_from_employer"]) line(`rate done ${c} (%)`, pair((r) => r.m.done?.[c]?.rate_pct));
