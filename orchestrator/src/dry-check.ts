// What a dry run on the mock showed, and what it could not yet show (docs/real-models.md, "A dry run on the mock").
//
// A dry run is shorter than the pilot it stands for, so some things a pilot will do cannot appear in it yet: a
// possession application needs the law's days of arrears and of notice first, whatever the seat does. This reads a mock
// run's log and says, for each thing it looks for, one of three things, and never a pass on what it did not see:
//   - shown: it appeared, on this day (or this many times);
//   - not shown: it should have appeared by now and did not (a fault to look into before any spend);
//   - could not yet be seen: the run was too short for it, with the reason and, where the world's own figures give one,
//     the earliest day it could appear (the published law's days; a landlord's patience is its own, so it is a reason
//     and not a day).
// Nothing here is a place's figure: the days come from the run's own config (the law record `law-possession`, the
// seats' positions and role modules, the published forms) and from the log.

import { logLines } from "./logs";

const DAY = 86_400;

export type Outcome = "shown" | "not shown" | "could not yet be seen";
export interface Finding { what: string; outcome: Outcome; /** First day it appeared (shown). */ day?: number; count?: number; /** Earliest day it could appear, from the world's figures (could not yet be seen). */ earliestDay?: number; detail: string }

export interface SeatFacts {
  seat: string;
  /** The post it holds (its id), and the role module's code, which says what sort of office it is. */
  position: string; module: string;
  /** The published forms its office issues (statement records of kind form, written for this office). */
  forms: number;
  /** When its clerk first filed books, and when first with something open on them. Days (fractions kept). */
  booksDay?: number; booksOpenDay?: number;
  /** The tribunal's registry staff: the first and the number of applications listed (hearing notices). */
  listedDay?: number; listed: number;
}
export interface DryFacts {
  /** Days the run covered, and whether that was the whole of the pilot's length. */
  daysRun: number; fullRun: boolean;
  seats: SeatFacts[];
  /** The published possession law's own figures, where the run has one. */
  law?: { arrears_days?: number; notice_days?: number };
  /** Founding on (a scale above nothing) and whether a composer is configured; bodies founded in the run; composer asks. */
  founding: boolean; composer: boolean;
  founded: { count: number; firstDay?: number };
  composed: { count: number; firstDay?: number };
}
export interface DryOptions { /** The day an office's clerk should have filed books by, where its books do not wait on a matter. Default 10. */ booksBy?: number; /** Seats whose books wait on a matter (nothing to file until one stands open), besides tribunal and landlord seats. */ booksWhenOpen?: string[] }

const d1 = (n: number) => Math.round(n * 10) / 10;
const kindOf = (s: SeatFacts) => (/^tribunal\./.test(s.module) ? "hears" : /landlord/.test(s.module) ? "lets" : "office");

/** The day a possession application could first be heard of, from the law's own days: rent owed for the law's days of
 * arrears, then notice of at least its days. Absent either figure: none (and then no day is claimed). */
export function earliestApplicationDay(law: DryFacts["law"]): number | undefined {
  if (!law || !Number.isFinite(law.arrears_days) || !Number.isFinite(law.notice_days)) return undefined;
  return law.arrears_days! + law.notice_days!;
}

export function judgeDry(f: DryFacts, o: DryOptions = {}): Finding[] {
  const out: Finding[] = [];
  const N = d1(f.daysRun);
  const booksBy = o.booksBy ?? 10;
  const tooShort = (what: string, reason: string, earliestDay?: number): Finding => ({ what, outcome: "could not yet be seen", earliestDay, detail: `could not yet be seen in ${N} days: ${reason}${earliestDay !== undefined ? `; earliest day about ${Math.round(earliestDay)}` : ""}` });
  const absent = (what: string, reason: string, earliestDay?: number): Finding => f.fullRun ? { what, outcome: "not shown", detail: `not shown in the whole ${N} days: ${reason}` } : tooShort(what, reason, earliestDay);
  for (const s of f.seats) {
    const kind = kindOf(s), who = `${s.seat} (${s.position})`;
    out.push(s.forms > 0 ? { what: `forms shown to ${who}`, outcome: "shown", count: s.forms, detail: `shown: ${s.forms} form${s.forms === 1 ? "" : "s"}` } : { what: `forms shown to ${who}`, outcome: "not shown", count: 0, detail: "not shown: no published form is written for its office" });
    const books = `${who}: its clerk filed books`;
    const waits = kind !== "office" || (o.booksWhenOpen ?? []).includes(s.seat) || (o.booksWhenOpen ?? []).includes(s.position);
    if (kind === "lets") {
      // A tenant in arrears on the landlord's books: rent has to fall due and go unpaid first, and the world gives no day for that.
      out.push(s.booksOpenDay !== undefined ? { what: `${who}: a tenant in arrears on its books`, outcome: "shown", day: d1(s.booksOpenDay), detail: `shown: first on day ${d1(s.booksOpenDay)}` } : absent(`${who}: a tenant in arrears on its books`, "rent has first to fall due and go unpaid, and nothing in the world's figures says on which day"));
      if (s.booksDay !== undefined) out.push({ what: books, outcome: "shown", day: d1(s.booksDay), detail: `shown: first on day ${d1(s.booksDay)}` });
      continue;
    }
    if (kind === "hears") {
      const earliest = earliestApplicationDay(f.law);
      out.push(s.listedDay !== undefined ? { what: `${who}: registry staff listed an application`, outcome: "shown", day: d1(s.listedDay), count: s.listed, detail: `shown: first on day ${d1(s.listedDay)}, ${s.listed} listed` }
        : earliest !== undefined && f.daysRun < earliest ? tooShort(`${who}: registry staff listed an application`, `an application waits on the law's ${f.law!.arrears_days} days of arrears and ${f.law!.notice_days} days of notice, and then on a landlord's own patience`, earliest)
        : f.fullRun ? { what: `${who}: registry staff listed an application`, outcome: "not shown", detail: `not shown in the whole ${N} days${earliest !== undefined ? ` (the law's days alone allow it from about day ${Math.round(earliest)})` : ""}` }
        : tooShort(`${who}: registry staff listed an application`, earliest !== undefined ? `the law's days (about day ${Math.round(earliest)}) have passed, but a landlord's patience is its own: run on to see it` : "the run's config has no possession law record to compute a day from; a landlord's patience is its own", earliest));
      out.push(s.booksDay !== undefined ? { what: books, outcome: "shown", day: d1(s.booksDay), detail: `shown: first on day ${d1(s.booksDay)}` } : absent(books, "the clerk files books only when a case stands listed, and none had been", earliest));
      continue;
    }
    out.push(s.booksDay !== undefined ? { what: books, outcome: "shown", day: d1(s.booksDay), detail: `shown: first on day ${d1(s.booksDay)}` }
      : waits ? absent(books, "its books wait on a matter standing open, and the world gives no earliest day")
      : f.daysRun >= booksBy ? { what: books, outcome: "not shown", detail: `not shown by day ${booksBy} (in ${N} days)` }
      : tooShort(books, `its books are due by day ${booksBy}`, booksBy));
  }
  if (f.founding) {
    out.push(f.founded.count ? { what: "a body founded", outcome: "shown", day: d1(f.founded.firstDay!), count: f.founded.count, detail: `shown: ${f.founded.count}, first on day ${d1(f.founded.firstDay!)}` } : absent("a body founded", "founding comes by chance at the run's scale, and no earliest day can be given"));
    if (f.composer) out.push(f.composed.count ? { what: "the composer asked", outcome: "shown", day: d1(f.composed.firstDay!), count: f.composed.count, detail: `shown: ${f.composed.count} ask${f.composed.count === 1 ? "" : "s"}, first on day ${d1(f.composed.firstDay!)}` }
      : f.founded.count ? { what: "the composer asked", outcome: "not shown", detail: `not shown: ${f.founded.count} founded and the composer was never asked` }
      : absent("the composer asked", "it is asked when a body is founded, and none was"));
  }
  return out;
}

/** The report as lines: one each, and a last line saying how many of each. */
export function formatDry(findings: Finding[]): string[] {
  const n = (o: Outcome) => findings.filter((x) => x.outcome === o).length;
  return [...findings.map((x) => `  [${x.outcome}] ${x.what}: ${x.detail}`), `  dry-run conditions: ${n("shown")} shown, ${n("not shown")} not shown${n("not shown") ? " (FAULT)" : ""}, ${n("could not yet be seen")} could not yet be seen`];
}

/** Read a mock run's log for what the check needs. `fullRun`: the run went the whole of the pilot's length. */
export async function readDryFacts(log: string, fullRun: boolean): Promise<DryFacts> {
  let config: any, seatIds: string[] = [], lastT = 0;
  const books = new Map<string, number>(), booksOpen = new Map<string, number>(), listed = new Map<string, { first: number; n: number }>();
  const founded = { count: 0, firstDay: undefined as number | undefined }, composed = { count: 0, firstDay: undefined as number | undefined };
  const seenRecord = new Set<string>();
  for await (const line of logLines(log)) {
    if (!line) continue;
    const tm = /"t":(\d+)\}$/.exec(line);
    if (tm) lastT = Math.max(lastT, Number(tm[1]));
    if (config === undefined) {
      try { config = JSON.parse(line).body?.config ?? null; } catch { config = null; }
      if (config) continue;
    }
    const interesting = line.includes('"office_books"') || line.includes('"hearing_notice"') || line.includes('"entity_created"') || line.includes('"purpose":"compose"') || line.includes('"annotation":"orchestrator"');
    if (!interesting) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    const b = e.body ?? {}, day = (e.t ?? 0) / DAY;
    if (b.annotation === "orchestrator" && b.data?.llm?.participants && !seatIds.length) seatIds = Object.keys(b.data.llm.participants);
    else if (e.kind === "event" && b.event === "recorded" && b.record && !seenRecord.has(b.record.id)) {
      const r = b.record;
      seenRecord.add(r.id);
      if (r.kind === "office_books" && !books.has(r.author)) books.set(r.author, day);
      if (r.kind === "office_books" && Array.isArray(r.data?.open) && r.data.open.length && !booksOpen.has(r.author)) booksOpen.set(r.author, day);
      if (r.kind === "hearing_notice") { const l = listed.get(r.author) ?? { first: day, n: 0 }; l.n++; listed.set(r.author, l); }
    } else if (e.kind === "event" && b.event === "entity_created" && /^ent\./.test(String(b.entity))) { founded.count++; founded.firstDay ??= day; }
    else if (b.annotation === "usage" && b.purpose === "compose") { composed.count++; composed.firstDay ??= day; }
  }
  const positions: any[] = config?.positions ?? [];
  const records: any[] = config?.world?.records ?? [];
  const law = records.find((r) => r?.id === "law-possession")?.data;
  const seats: SeatFacts[] = seatIds.flatMap((seat) => positions.filter((p) => p.holder === seat).map((p): SeatFacts => {
    const clerk = `${p.id}-staff-system`;
    return { seat, position: p.id, module: String(p.role_module?.code ?? ""), forms: records.filter((r) => r?.kind === "form" && r.data?.writes && r.data.office === p.id).length,
      booksDay: books.get(clerk), booksOpenDay: booksOpen.get(clerk), listedDay: listed.get(clerk)?.first, listed: listed.get(clerk)?.n ?? 0 };
  }));
  const scale = Number(config?.dials?.founding?.scale_bps ?? 0);
  return { daysRun: lastT / DAY, fullRun, seats, law: law ? { arrears_days: law.arrears_days, notice_days: law.notice_days } : undefined, founding: scale > 0, composer: !!config?.dials?.composer, founded, composed };
}
