// Culture, measured from a log alone (docs/behaviour/culture.md, "Measures"; design 14h). Nothing in a run computes any of
// this and the platform judges nothing by it: no conduct is the good one, no figure a target. It reads record changes (a
// person's `norms`, `heard`, `ties`, `trust`), the messages people send (verdicts, tales of a third person's conduct, a
// parent's answer, talk of the town), the world's own events (warrants carried out, stoppages) and, where the log
// records them (a full log, not a lean one), the decisions that carry a norm. It returns numbers; it reads no model.
//
//   norm shares over time        mean and spread across people of what is done, approved, thought and said, by conduct and by group
//   verdicts voiced              the share of people who say something other than the middle step; verdicts sent, by how they judged
//   talk about conduct           tales of a third person's act, a parent's answers, talk of the town: counts
//   standing lost and gained     verdicts received, by recipient and judgement (wrong lost standing, right gained it); ties cooled
//   said against thought         |own - says| and the people privately on one side of the middle who take the street to be on the other
//   events remembered            who holds a public event, how they came by it (saw, read, told), through how many hands, and the
//                                trust that moved in those it was about (holders against others)
//   tipping events               within a group, the rate at which a conduct is done moving from under a third to over two thirds
//                                (or back) inside 90 days, with what preceded it (the group's own earlier rate and its approval)

import { logLines } from "./logs";
import { recordChanges } from "./records";
import { culture, townmemory } from "@oikos/participants";

const { CONDUCTS, normsRows, PERSONS_CONDUCTS, SAYINGS, WORDS } = culture;
const { EVENT_CONDUCT, EVENT_KINDS, trustDirection } = townmemory;

const DAY = 86_400;
const NUMBERS = ["does", "approves", "own", "says"] as const;
/** What a decision's choice is, when the person does the conduct (the four conducts whose decisions carry a norm). */
export const DID_CHOICE: { [conduct: string]: string } = { join_union: "join", strike: "yes", complain: "write", take_from_employer: "take" };
/** A tipping event: under a third to over two thirds (or the reverse) within this many days (design 14h, fixed before any run). */
export const TIPPING = { low_bps: 3_333, high_bps: 6_667, within_days: 90, window_days: 30, min_decisions: 8 };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const r1 = (x: number) => Math.round(x * 10) / 10;

export interface MeasureOptions {
  /** Days at which to take the picture; default every 30 days to the end of the log. */
  days?: number[];
  /** Groupings of people besides "all": a name, and who is in which group (entity -> label). Origin comes from the log's config when it has any. */
  groups?: { [grouping: string]: Map<string, string> };
  /** Public event kinds (by name) whose holders are a group of their own ("holds_<kind>" against "holds_not_<kind>"): near an event, against far. */
  nearEvents?: string[];
  /** The conducts to report (default all of a person's). */
  conducts?: string[];
}

export interface NormShare { day: number; grouping: string; group: string; conduct: string; people: number; does: number; approves: number; own: number; says: number; does_sd: number; approves_sd: number; own_sd: number; says_sd: number; voiced_pct: number; gap_own_says: number; pluralistic_pct: number; gap_own_approves: number }
export interface Tipping { grouping: string; group: string; conduct: string; direction: "up" | "down"; from_day: number; to_day: number; rate_before_bps: number; rate_after_bps: number; approves_before: number | null; approves_after: number | null }

/** Origin groups from the log's own config header: person -> group, where the world has any. */
export function originsOfConfig(config: any): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of config?.participants ?? []) if (p.kind === "person" && p.controller?.params?.origin) m.set(p.person ?? p.id?.replace(/-self$/, ""), p.controller.params.origin);
  return m;
}

const entityOf = (participant: string) => participant.replace(/-self$/, "");

/** A decision that carries a norm, for the tipping measure. */
export type Dec = { t: number; who: string; conduct: string; did: boolean; approves: number };

/** Tipping events (design 14h; fixed before any run): within a group, the rate at which a conduct is done, over rolling windows of `window_days`, moving from under a third to over two thirds (or back) inside `within_days`, with the group's approval before and after. A pure function of the decisions, so it can be held on a fixture. */
export function tippingEvents(decisions: Dec[], groupings: { [name: string]: Map<string, string> }): Tipping[] {
  const tipping: Tipping[] = [];
  for (const [name, groupOf] of Object.entries({ all: undefined as Map<string, string> | undefined, ...groupings })) {
    const bucket = new Map<string, Dec[]>();
    for (const d of decisions) { const g = groupOf ? groupOf.get(d.who) : "all"; if (g === undefined) continue; const k = `${g}\u0000${d.conduct}`; (bucket.get(k) ?? bucket.set(k, []).get(k)!).push(d); }
    for (const [k, ds] of bucket) {
      const [g, c] = k.split("\u0000") as [string, string];
      const windows = new Map<number, Dec[]>();
      for (const d of ds) { const w = Math.floor(d.t / DAY / TIPPING.window_days); (windows.get(w) ?? windows.set(w, []).get(w)!).push(d); }
      const series = [...windows].sort((a, b) => a[0] - b[0]).filter(([, x]) => x.length >= TIPPING.min_decisions).map(([w, x]) => ({ day: w * TIPPING.window_days, rate: Math.round((10_000 * x.filter((d) => d.did).length) / x.length), approves: mean(x.map((d) => d.approves)) }));
      for (let i = 0; i < series.length; i++) for (let j = i + 1; j < series.length && series[j]!.day - series[i]!.day <= TIPPING.within_days; j++) {
        const a = series[i]!, b = series[j]!;
        if (a.rate < TIPPING.low_bps && b.rate > TIPPING.high_bps) tipping.push({ grouping: name, group: g, conduct: c, direction: "up", from_day: a.day, to_day: b.day, rate_before_bps: a.rate, rate_after_bps: b.rate, approves_before: r1(a.approves), approves_after: r1(b.approves) });
        else if (a.rate > TIPPING.high_bps && b.rate < TIPPING.low_bps) tipping.push({ grouping: name, group: g, conduct: c, direction: "down", from_day: a.day, to_day: b.day, rate_before_bps: a.rate, rate_after_bps: b.rate, approves_before: r1(a.approves), approves_after: r1(b.approves) });
      }
    }
  }
  return tipping;
}

export async function cultureMeasures(log: string, o: MeasureOptions = {}): Promise<any | undefined> {
  // The header: the world's config, with the dial and the people's origins.
  let config: any;
  for await (const line of logLines(log)) { if (line.includes('"config"')) { config = JSON.parse(line).body?.config; break; } }
  if (!config?.dials?.culture) return undefined;
  const origin = originsOfConfig(config);
  const groupings: { [name: string]: Map<string, string> } = { ...(origin.size ? { origin } : {}), ...(o.groups ?? {}) };
  const conducts = (o.conducts ?? [...PERSONS_CONDUCTS]) as string[];
  const checks = o.days ?? [];
  const wantChecks = checks.length ? checks : undefined;
  let next = 0, last = 0;

  const norms = new Map<string, { [c: string]: number[] }>();
  const heard = new Map<string, any[]>();
  const ties = new Map<string, { resented: number; close: number }>();
  const trustFirst = new Map<string, Map<string, number>>(), trustNow = new Map<string, Map<string, number>>();
  const shares: NormShare[] = [], memory: any[] = [], tieSeries: any[] = [], trustMoved: any[] = [];
  const kindNames = Object.values(EVENT_KINDS) as string[];
  const near = (o.nearEvents ?? []).filter((k) => kindNames.includes(k));

  const snap = (day: number) => {
    // The groupings of this day: the fixed ones, and one for each near event (holds it / does not), made from what people hold now.
    const all: { [name: string]: Map<string, string> } = { ...groupings };
    for (const k of near) {
      const m = new Map<string, string>(), idx = kindNames.indexOf(k);
      for (const who of norms.keys()) m.set(who, (heard.get(who) ?? []).some((s) => s[0] === idx) ? `holds_${k}` : `holds_not_${k}`);
      all[`near_${k}`] = m;
    }
    for (const [name, groupOf] of [["all", undefined] as const, ...Object.entries(all)]) {
      const rows: { [g: string]: { [c: string]: number[][] } } = {};
      for (const [who, ns] of norms) {
        const g = groupOf ? groupOf.get(who) : "all";
        if (g === undefined) continue;
        for (const c of conducts) if (ns[c]) ((rows[g] ??= {})[c] ??= []).push(ns[c]!);
      }
      for (const [g, byC] of Object.entries(rows)) for (const [c, rs] of Object.entries(byC)) {
        const col = (i: number) => rs.map((r) => r[i]!);
        shares.push({
          day, grouping: name, group: g, conduct: c, people: rs.length,
          does: r1(mean(col(0))), approves: r1(mean(col(1))), own: r1(mean(col(2))), says: r1(mean(col(3))),
          does_sd: r1(sd(col(0))), approves_sd: r1(sd(col(1))), own_sd: r1(sd(col(2))), says_sd: r1(sd(col(3))),
          // Voiced: said something other than "neither right nor wrong" (the middle step, 40 to 60).
          voiced_pct: r1((100 * rs.filter((r) => r[3]! < 40 || r[3]! >= 60).length) / rs.length),
          gap_own_says: r1(mean(rs.map((r) => Math.abs(r[2]! - r[3]!)))),
          // Pluralistic ignorance: privately on one side of the middle by more than 5 points and taking the street to be on the other by more than 5.
          pluralistic_pct: r1((100 * rs.filter((r) => (r[2]! > 55 && r[1]! < 45) || (r[2]! < 45 && r[1]! > 55)).length) / rs.length),
          gap_own_approves: r1(mean(rs.map((r) => r[2]! - r[1]!))),
        });
      }
    }
    const slots = [...heard.values()].flat(), byKind: { [k: string]: number } = {}, byHow: { [k: string]: number } = {}, byHops: { [k: string]: number } = {};
    for (const s of slots) { const k = EVENT_KINDS[s[0]] ?? String(s[0]); byKind[k] = (byKind[k] ?? 0) + 1; const h = ["saw", "read", "told"][s[4]]!; byHow[h] = (byHow[h] ?? 0) + 1; byHops[s[5]] = (byHops[s[5]] ?? 0) + 1; }
    memory.push({ day, people: norms.size, holding: [...heard.values()].filter((h) => h.length).length, slots: slots.length, by_kind: byKind, by_how: byHow, by_hands: byHops });
    const rs = [...ties.values()];
    tieSeries.push({ day, people: ties.size, resented_per_person: r1(mean(rs.map((t) => t.resented))), close_per_person: r1(mean(rs.map((t) => t.close))) });
    // Trust moved in those an event was about: the change since the first trust seen, for those who hold such an event, against those who hold none about that party.
    trustMoved.push({ day, parties: trustMovement(heard, norms, trustFirst, trustNow) });
  };
  const lastDay = (end: number) => (wantChecks ?? Array.from({ length: Math.floor(end / (30 * DAY)) }, (_, i) => (i + 1) * 30));
  // ---- pass 1: the records
  const changes: { t: number; entity: string; set: any }[] = [];
  for await (const c of recordChanges(log)) { last = Math.max(last, c.t); changes.push({ t: c.t, entity: c.entity, set: c.set }); }
  const days = lastDay(last);
  for (const c of changes) {
    while (next < days.length && c.t >= days[next]! * DAY) snap(days[next++]!);
    if (c.set.norms) {
      const rows = normsRows(c.set.norms), by: { [k: string]: number[] } = {};
      for (const r of rows) by[r.conduct] = r.numbers;
      norms.set(c.entity, by);
    }
    if (c.set.heard) heard.set(c.entity, c.set.heard);
    if (c.set.ties) ties.set(c.entity, { resented: (c.set.ties.resented ?? []).length, close: (c.set.ties.close ?? []).length });
    if (c.set.trust?.in) {
      const now = new Map<string, number>(c.set.trust.in.map((x: any) => [x.in, x.bps]));
      trustNow.set(c.entity, now);
      if (!trustFirst.has(c.entity)) trustFirst.set(c.entity, new Map(now));
      else for (const [k, v] of now) if (!trustFirst.get(c.entity)!.has(k)) trustFirst.get(c.entity)!.set(k, v);
    }
  }
  while (next < days.length) snap(days[next++]!);

  // ---- pass 2: what was said, what the world did, and what was decided
  const verdicts = { total: 0, by_judgement: {} as { [s: string]: number }, by_conduct: {} as { [c: string]: number } };
  const received = new Map<string, { lost: number; gained: number }>();
  const talk = { about: 0, town_talk: 0, household_answers: 0 };
  const world = { warrants_executed: 0, stoppages: 0 };
  const verdictByDay = new Map<number, number>();
  const decisions: Dec[] = [];
  const judgements = SAYINGS.map(([s]) => s);
  for await (const line of logLines(log)) {
    if (line.includes('"kind":"warrant_executed"') && line.includes('"block":"publish"')) world.warrants_executed++;
    else if (line.includes('"kind":"stop_work"') && line.includes('"block":"publish"')) world.stoppages++;
    if (line.includes('"command":"act"') && line.includes('I say ')) {
      const e = JSON.parse(line);
      for (const b of e.body?.blocks ?? []) {
        if (b.block !== "message" || typeof b.text !== "string") continue;
        const text: string = b.text;
        const v = /Of your (not )?([^:]+): I say it is ([a-z ]+)\./.exec(text);
        if (v && judgements.includes(v[3] as any)) {
          verdicts.total++;
          verdicts.by_judgement[v[3]!] = (verdicts.by_judgement[v[3]!] ?? 0) + 1;
          const conduct = PERSONS_CONDUCTS.find((c) => v[2] === WORDS[c]?.thing) ?? v[2]!;
          verdicts.by_conduct[conduct] = (verdicts.by_conduct[conduct] ?? 0) + 1;
          const day = Math.floor(e.t / DAY / 30) * 30;
          verdictByDay.set(day, (verdictByDay.get(day) ?? 0) + 1);
          for (const to of b.to ?? []) {
            const r = received.get(entityOf(to)) ?? { lost: 0, gained: 0 };
            if (v[3] === "wrong" || v[3] === "plainly wrong") r.lost++; else if (v[3] === "right" || v[3] === "plainly right") r.gained++;
            received.set(entityOf(to), r);
          }
        }
        if (/About [^\s:]+: .*Of that, I say it is/.test(text)) talk.about++;
        if (text.includes("Talk of the town:")) talk.town_talk++;
        if (text.includes("As I see it, of ")) talk.household_answers++;
      }
    } else if (line.includes('"annotation":"decision"') && line.includes('"norm":{')) {
      const e = JSON.parse(line), d = e.body?.data;
      if (!d?.norm?.conduct || DID_CHOICE[d.norm.conduct] === undefined) continue;
      decisions.push({ t: e.t ?? d.t, who: entityOf(e.body.subject), conduct: d.norm.conduct, did: d.choice === DID_CHOICE[d.norm.conduct], approves: d.norm.approves });
    }
  }
  const recv = [...received.values()];
  const standing = { people_told_wrong_of_an_act: recv.filter((r) => r.lost > 0).length, people_told_right_of_an_act: recv.filter((r) => r.gained > 0).length, verdicts_lost: recv.reduce((a, r) => a + r.lost, 0), verdicts_gained: recv.reduce((a, r) => a + r.gained, 0), ties_cooled_per_person_at_end: tieSeries.at(-1)?.resented_per_person ?? 0 };

  const tipping = tippingEvents(decisions, groupings);
  const done = new Map<string, { did: number; of: number }>();
  for (const d of decisions) { const x = done.get(d.conduct) ?? done.set(d.conduct, { did: 0, of: 0 }).get(d.conduct)!; x.of++; if (d.did) x.did++; }

  return {
    days, groupings: Object.keys(groupings), conducts,
    norm_shares: shares,
    verdicts: { ...verdicts, by_month: Object.fromEntries([...verdictByDay].sort((a, b) => a[0] - b[0])) },
    talk, standing, memory, trust_moved: trustMoved, ties: tieSeries,
    done: Object.fromEntries([...done].map(([c, x]) => [c, { decisions: x.of, rate_pct: r1((100 * x.did) / x.of) }])),
    decisions_recorded: decisions.length,
    tipping: { definition: `rate done within a group moving from under ${TIPPING.low_bps / 100}% to over ${TIPPING.high_bps / 100}% (or back) inside ${TIPPING.within_days} days, in ${TIPPING.window_days}-day windows of at least ${TIPPING.min_decisions} decisions; only for the conducts whose decisions carry a norm`, events: tipping, ...(decisions.length ? {} : { note: "this log records no decisions (a lean log, or --record-decisions none): tipping events cannot be read" }) },
    world,
  };
}

/**
 * Trust moved in those an event was about, for those who hold such an event against those who hold none about that party (each side at least three for the holders).
 * The signed mean (`holders_moved_bps`) cancels by construction, since each person's bearing takes the sign of their OWN view of the conduct and views are spread round
 * the middle. So there is a second reading, added 2026-10-14 (culture-5; docs/behaviour/culture.md, "Events join the picture"): each person's movement taken in the direction
 * the event gives for them (`trustDirection`: toward the party for one whose own view makes it so, away for the other), the share who moved that way, and the mean of
 * movement in that direction (`*_toward_bps`), for holders against others. A person with no view of the conduct, or a party none of whose events shows a conduct, has no
 * direction and is left out of it. Nothing about the event is judged: the direction is the person's.
 */
export function trustMovement(heard: Map<string, any[]>, norms: Map<string, { [c: string]: number[] }>, trustFirst: Map<string, Map<string, number>>, trustNow: Map<string, Map<string, number>>) {
  const held = new Map<string, Set<string>>();
  for (const [who, sl] of heard) for (const s of sl) { if (!held.has(s[1])) held.set(s[1], new Set()); held.get(s[1])!.add(who); }
  const kindOfParty = new Map<string, (typeof EVENT_KINDS)[number]>();
  for (const sl of heard.values()) for (const s of sl) { const k = EVENT_KINDS[s[0]]; if (k && !kindOfParty.has(s[1])) kindOfParty.set(s[1], k); }
  const row: { [party: string]: { holders: number[]; others: number[]; hDir: number[]; oDir: number[] } } = {};
  for (const [who, now] of trustNow) for (const [party, bps] of now) {
    const first = trustFirst.get(who)?.get(party);
    if (first === undefined || !held.has(party)) continue;
    const r = (row[party] ??= { holders: [], others: [], hDir: [], oDir: [] }), holds = held.get(party)!.has(who);
    r[holds ? "holders" : "others"].push(bps - first);
    const kind = kindOfParty.get(party), conduct = kind ? (EVENT_CONDUCT as { [k: string]: string })[kind] : undefined;
    const own = conduct ? norms.get(who)?.[conduct]?.[2] : undefined;
    const dir = kind && own !== undefined ? trustDirection(kind, own * 100) : 0;
    if (dir !== 0) r[holds ? "hDir" : "oDir"].push(dir * (bps - first));
  }
  const share = (xs: number[]) => (xs.length ? r1((100 * xs.filter((x) => x > 0).length) / xs.length) : null);
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v.holders.length >= 3).map(([p, v]) => [p, {
    holders: v.holders.length, holders_moved_bps: Math.round(mean(v.holders)), others: v.others.length, others_moved_bps: Math.round(mean(v.others)),
    holders_with_a_view: v.hDir.length, holders_toward_bps: v.hDir.length ? Math.round(mean(v.hDir)) : null, holders_toward_share: share(v.hDir),
    others_with_a_view: v.oDir.length, others_toward_bps: v.oDir.length ? Math.round(mean(v.oDir)) : null, others_toward_share: share(v.oDir),
  }]));
}

/** The measure in a few lines, for the pilot report's text. */
export function renderCultureMeasures(m: any): string[] {
  const L: string[] = [];
  L.push(`-- culture (read from the log; the platform judges nothing by it): ${m.norm_shares.filter((s: any) => s.grouping === "all").length ? "norm shares at the last picture:" : "no pictures"}`);
  const lastDay = m.days.at(-1);
  for (const s of m.norm_shares.filter((x: any) => x.grouping === "all" && x.day === lastDay)) L.push(`   ${s.conduct}: does ${s.does}, approves ${s.approves}, own ${s.own}, says ${s.says} (spread across people ${s.does_sd}/${s.approves_sd}/${s.own_sd}/${s.says_sd}); voiced ${s.voiced_pct}%; pluralistic ignorance ${s.pluralistic_pct}%`);
  L.push(`   verdicts ${m.verdicts.total}; talk about conduct ${m.talk.about}, households ${m.talk.household_answers}, town ${m.talk.town_talk}; standing: ${m.standing.verdicts_lost} lost, ${m.standing.verdicts_gained} gained; ties cooled per person ${m.standing.ties_cooled_per_person_at_end}`);
  const mem = m.memory.at(-1);
  if (mem) L.push(`   events remembered: ${mem.holding} of ${mem.people} hold some (${mem.slots} in all); came by ${Object.entries(mem.by_how).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  L.push(`   tipping events: ${m.tipping.events.length}${m.tipping.note ? ` (${m.tipping.note})` : ""}`);
  return L;
}

export { CONDUCTS };
