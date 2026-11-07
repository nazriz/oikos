// Flags for a clearly broken world (law 12: docs/design/foundations-2.md section 6; docs/flags.md). A light aid outside
// the world: it reads a run's measurement tables (as every measure does) and names states no world should be in,
// whatever its place, each with the run, the moment and what the state rests on (`rests_on`: the modules whose acts
// made it, the law or form or office it is about). Never a target and never a gate: nothing in the world reads a flag
// (orchestrator/test/flags-only-flag.test.ts), a flag is a finding for the risk register, worded "a likely missing
// law", and no figure is tuned to quiet one. No place's figure is compared with anything here.
//
// The thresholds are the run's own, stated once below with their reasons; they are conventions, not any place's figures.

import type { DuckDBConnection } from "@duckdb/node-api";
import { open } from "./index";

export type FlagKind = "stampede" | "freeze" | "physics" | "dead_law";

export interface Flag {
  kind: FlagKind;
  run_id: string;
  /** The moment: the start of the month it happened in, or the first time it was seen; absent for the run as a whole. */
  t?: number;
  what: string;
  /** What the state rests on: the modules whose acts made it, and the law, form, office or account it is about. */
  rests_on: string[];
}

const DAY = 86_400;
/** A month, the window a stampede is judged in: thirty days, the shortest span every monthly routine shows in. */
export const MONTH = 30 * DAY;
/** A stampede: at least half of those who could do a thing did it in one month (half: a majority acting at once, which
 * no ordinary life choice is). */
export const STAMPEDE_SHARE = 0.5;
/** And at least this many could: a share of a handful says nothing. */
export const STAMPEDE_LEAST = 10;
/** Freezes and dead laws are judged only on a run of a year or more: the shortest span in which a year's routines (a
 * lease renewed, a return filed, a hire) all come round. */
export const YEAR = 360 * DAY;
/** Unbounded growth is judged on a run of six months or more, month by month: it grew in at least four months of five,
 * its last third grew at least as fast as its first, and it ended at least twice where it began (a trend that does not
 * level, on the run's own course). */
export const GROWTH_LEAST_MONTHS = 6;
export const GROWTH_RISING_SHARE = 0.8;
export const GROWTH_FACTOR = 2;

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : Number(v ?? 0));
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined).map(String) : []);
async function rows(c: DuckDBConnection, sql: string): Promise<Row[]> {
  return (await c.runAndReadAll(sql)).getRowObjectsJS() as Row[];
}

/** Which tables a connection has (a run with no transfers has no transfers table). */
async function has(c: DuckDBConnection): Promise<Set<string>> {
  return new Set((await rows(c, "select table_name from information_schema.tables")).map((r) => String(r.table_name)));
}

/** The modules that act for each participant: its controller, and the role modules of the posts it held. */
const MODULES = `
  pm as (
    select p.run_id, p.participant, p.person, coalesce(p.impl, p.controller) as module from participants p
    union all
    select a.run_id, a.holder, null, ps.role_module from appointments a join positions ps on ps.run_id = a.run_id and ps.position = a.position where ps.role_module is not null and a.holder is not null)`;

/** Every flag of every run in the tables of `c` (or of the measurement folder `dir`). */
export async function flagsOf(c: DuckDBConnection): Promise<Flag[]> {
  const t = await has(c);
  const out: Flag[] = [];
  const need = (...names: string[]) => names.every((n) => t.has(n));

  // ---- a stampede: half of those who could, at once ----------------------------------------------------------------
  if (need("runs", "entities", "life")) {
    // (Who is in the town at a month's start: a person created by then whose last coming or going before it was not
    // leaving or dying.)
    const present = `
      months as (select r.run_id, m * ${MONTH} as m0 from runs r, range(0, greatest(1, (r.end_t // ${MONTH})::BIGINT)) g(m)),
      moves as (select run_id, person, t, event from life where event in ('person_left', 'person_died', 'person_arrived')),
      here as (
        select mo.run_id, mo.m0, count(*) as n from months mo join entities e on e.run_id = mo.run_id and e.kind = 'person' and e.created_t <= mo.m0
        where coalesce((select last(v.event order by v.t) from moves v where v.run_id = mo.run_id and v.person = e.entity and v.t < mo.m0), 'person_arrived') = 'person_arrived'
        group by all)`;
    const leaving = await rows(c, `with ${present}, ${MODULES.trim()},
      gone as (select l.run_id, (l.t // ${MONTH}) * ${MONTH} as m0, l.person from life l where l.event = 'person_left' and l.t > 0)
      select g.run_id, g.m0, count(distinct g.person) as did, h.n, list(distinct pm.module) as modules
      from gone g join here h on h.run_id = g.run_id and h.m0 = g.m0 left join pm on pm.run_id = g.run_id and pm.person = g.person
      group by g.run_id, g.m0, h.n having h.n >= ${STAMPEDE_LEAST} and count(distinct g.person) >= ${STAMPEDE_SHARE} * h.n order by g.run_id, g.m0`);
    for (const r of leaving) out.push({ kind: "stampede", run_id: String(r.run_id), t: num(r.m0), what: `${num(r.did)} of the ${num(r.n)} people in the town left it in one month`, rests_on: list(r.modules).sort() });
    if (need("records", "participants", "appointments", "positions")) {
      // (Signing a new agreement of one kind: everyone taking a new job, a new lease, joining one body, in a month.)
      const signing = await rows(c, `with ${present}, ${MODULES.trim()},
        signed as (
          select s.run_id, (s.t // ${MONTH}) * ${MONTH} as m0, a.template, s.speaks_for as person
          from records s join records a on a.run_id = s.run_id and a.id = json_extract_string(s.body, '$.agreement') and a.record = 'agreement'
          join entities e on e.run_id = s.run_id and e.entity = s.speaks_for and e.kind = 'person'
          where s.record = 'signature' and s.t > 0 and a.template is not null)
        select g.run_id, g.m0, g.template, count(distinct g.person) as did, h.n, list(distinct pm.module) as modules
        from signed g join here h on h.run_id = g.run_id and h.m0 = g.m0 left join pm on pm.run_id = g.run_id and pm.person = g.person
        group by g.run_id, g.m0, g.template, h.n having h.n >= ${STAMPEDE_LEAST} and count(distinct g.person) >= ${STAMPEDE_SHARE} * h.n order by g.run_id, g.m0, g.template`);
      for (const r of signing) out.push({ kind: "stampede", run_id: String(r.run_id), t: num(r.m0), what: `${num(r.did)} of the ${num(r.n)} people in the town signed a new ${r.template} agreement in one month`, rests_on: [`agreement template ${r.template}`, ...list(r.modules).sort()] });
    }
  }

  // ---- a freeze: a thing the world offers that nobody does in a year ------------------------------------------------
  if (need("runs", "records")) {
    // (Each kind of agreement the town opened with: in a run of a year or more, made again at least once.)
    const frozen = await rows(c, `
      select r.run_id, g.template, count(*) as opened from runs r join records g on g.run_id = r.run_id and g.t = 0 and g.record = 'agreement' and g.template is not null
      where r.end_t >= ${YEAR} and not exists (select 1 from records n where n.run_id = r.run_id and n.t > 0 and n.record = 'agreement' and n.template = g.template)
      group by all order by r.run_id, g.template`);
    for (const r of frozen) out.push({ kind: "freeze", run_id: String(r.run_id), what: `nobody made a new ${r.template} agreement in the run (the town opened with ${num(r.opened)})`, rests_on: [`agreement template ${r.template}`] });
  }

  // ---- a dead law: a law nobody's paper cites, a form nobody fills in, an office nobody acts in, in a year -------------
  if (need("runs", "records")) {
    const laws = await rows(c, `
      select r.run_id, l.id, l.speaks_for, l.basis from runs r join records l on l.run_id = r.run_id and l.t = 0 and l.record = 'statement' and l.kind = 'law'
      where r.end_t >= ${YEAR} and not exists (select 1 from records x where x.run_id = r.run_id and x.t > 0 and list_contains(x.bases, l.id))
      order by r.run_id, l.id`);
    for (const r of laws) out.push({ kind: "dead_law", run_id: String(r.run_id), what: `law ${r.id} is cited by no paper written in the run`, rests_on: [`law ${r.id}`, ...(r.speaks_for ? [`made by ${r.speaks_for}`] : []), ...(r.basis ? [`under ${r.basis}`] : [])] });
    const forms = await rows(c, `
      select r.run_id, f.id, json_extract_string(f.body, '$.data.submit_as') as kind, json_extract(f.body, '$.data.submit_to') as submit_to
      from runs r join records f on f.run_id = r.run_id and f.t = 0 and f.record = 'statement' and f.kind = 'form'
      where r.end_t >= ${YEAR} and json_extract_string(f.body, '$.data.submit_as') is not null
        and not exists (select 1 from records x where x.run_id = r.run_id and x.t > 0 and x.kind = json_extract_string(f.body, '$.data.submit_as'))
      order by r.run_id, f.id`);
    for (const r of forms) out.push({ kind: "dead_law", run_id: String(r.run_id), what: `form ${r.id} was never filled in (no ${r.kind} in the run)`, rests_on: [`form ${r.id}`, ...list(typeof r.submit_to === "string" ? JSON.parse(r.submit_to) : r.submit_to).map((x) => `sent to ${x}`)] });
  }
  if (need("runs", "positions", "acts")) {
    const idle = await rows(c, `
      select r.run_id, p.position, p.entity, p.role_module from runs r join positions p on p.run_id = r.run_id and p.created_t = 0
      where r.end_t >= ${YEAR} and not exists (select 1 from acts a where a.run_id = r.run_id and a."as" = p.position and a.applied)
      order by r.run_id, p.position`);
    for (const r of idle) out.push({ kind: "dead_law", run_id: String(r.run_id), what: `the office ${r.position} (of ${r.entity}) did nothing in the run`, rests_on: [`office ${r.position}`, ...(r.role_module ? [String(r.role_module)] : [])] });
  }

  // ---- a stock that breaks physics: money below nought outside an edge; a balance that grows without levelling --------
  // (Measurement tables exported before 0.7.0 have no opening balances: their money is not judged.)
  const opening = (await rows(c, "select 1 from information_schema.columns where table_name = 'accounts' and column_name = 'opening_balance'")).length > 0;
  if (need("runs", "accounts", "entities", "transfers") && opening) {
    const flows = `
      edge as (select run_id, entity from entities where kind = 'boundary'),
      acc as (select a.run_id, a.account, a.holder, coalesce(a.opening_balance, 0) as opening, e.kind from accounts a left join entities e on e.run_id = a.run_id and e.entity = a.holder
        where not exists (select 1 from edge x where x.run_id = a.run_id and x.entity = a.holder)),
      moves as (
        select run_id, seq, t, "to" as account, amount as d from transfers
        union all select run_id, seq, t, "from", -amount from transfers),
      running as (select m.run_id, m.account, m.seq, m.t, acc.opening + sum(m.d) over (partition by m.run_id, m.account order by m.seq rows unbounded preceding) as balance
        from moves m join acc on acc.run_id = m.run_id and acc.account = m.account)`;
    const below = await rows(c, `with ${flows}
      select run_id, account, min(t) as t, min(balance) as least from running where balance < 0 group by all order by run_id, account`);
    for (const r of below) out.push({ kind: "physics", run_id: String(r.run_id), t: num(r.t), what: `account ${r.account} went below nought (to ${String(r.least)}), and it is no edge's`, rests_on: ["law 8: money is held, moved only by a transfer", `account ${r.account}`] });
    // (Month by month, each organisation's balance at the month's end, and the town's money outside the edges.)
    const series = await rows(c, `with ${flows},
      months as (select r.run_id, m, (m + 1) * ${MONTH} as m1 from runs r, range(0, (r.end_t // ${MONTH})::BIGINT) g(m) where r.end_t >= ${GROWTH_LEAST_MONTHS} * ${MONTH}),
      orgs as (select * from acc where kind is not null and kind not in ('person')),
      at_end as (
        select mo.run_id, o.account, mo.m, coalesce((select last(x.balance order by x.seq) from running x where x.run_id = mo.run_id and x.account = o.account and x.t < mo.m1), o.opening) as balance
        from months mo join orgs o on o.run_id = mo.run_id)
      select run_id, account, list(balance::DOUBLE order by m) as v from at_end group by all
      union all
      select mo.run_id, '(the town''s money outside the edges)', list(coalesce((select sum(z.b) from (select coalesce((select last(x.balance order by x.seq) from running x where x.run_id = mo.run_id and x.account = a.account and x.t < mo.m1), a.opening) as b from acc a where a.run_id = mo.run_id) z), 0)::DOUBLE order by mo.m)
      from months mo group by mo.run_id`);
    for (const r of series) {
      const v = list(r.v).map(Number);
      if (grows(v)) out.push({ kind: "physics", run_id: String(r.run_id), what: `${r.account} grew month after month without levelling, from ${v[0]} to ${v.at(-1)}`, rests_on: ["law 8: money is held, moved only by a transfer", String(r.account).startsWith("(") ? "every account outside the edges" : `account ${r.account}`] });
    }
  }
  return out.sort((a, b) => (a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0) || (a.t ?? -1) - (b.t ?? -1) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.what < b.what ? -1 : 1));
}

/** A trend that does not level, on the run's own course (the conventions above). */
export function grows(v: number[]): boolean {
  if (v.length < GROWTH_LEAST_MONTHS) return false;
  const rose = v.slice(1).filter((x, i) => x > v[i]!).length;
  const third = Math.max(1, Math.floor(v.length / 3));
  const first = v[third]! - v[0]!, last = v.at(-1)! - v.at(-1 - third)!;
  return rose >= GROWTH_RISING_SHARE * (v.length - 1) && first > 0 && last >= first && v.at(-1)! >= GROWTH_FACTOR * Math.max(v[0]!, 1);
}

export async function flags(dir: string): Promise<Flag[]> {
  return flagsOf(await open(dir));
}

const KIND_WORDS: Record<FlagKind, string> = {
  stampede: "a stampede (half of those who could, at once)",
  freeze: "a freeze (a thing the world offers that nobody did)",
  physics: "a stock that breaks physics",
  dead_law: "a dead law (a law, form or office nobody used)",
};

/** The flags in words: each a likely missing law, never a failure; with what it rests on. */
export function flagsText(fs: Flag[]): string {
  if (!fs.length) return "Flags (law 12, a light aid; docs/flags.md): none.";
  const lines = [`Flags (law 12, a light aid, never a target; docs/flags.md): ${fs.length}. Each is a likely missing law, for the risk register.`];
  for (const k of Object.keys(KIND_WORDS) as FlagKind[]) {
    const of = fs.filter((f) => f.kind === k);
    if (!of.length) continue;
    lines.push("", `${KIND_WORDS[k]}: ${of.length}`);
    for (const f of of) lines.push(`  ${f.run_id}${f.t !== undefined ? ` day ${Math.floor(f.t / DAY)}` : ""}: ${f.what}  [rests on: ${f.rests_on.join("; ") || "(nothing named)"}]`);
  }
  return lines.join("\n");
}
