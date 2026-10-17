// Invariants: what must hold in every run, read from the run's log alone (docs/testing.md, "The invariants").
//
// Each is a property of the world, not of how it is computed: money is conserved and in whole units, every living
// person is somewhere and in a household, nobody acts or works after they have died or gone, nobody works without
// spending their own time, the bank pays what it was told to and no more, nobody is shown what they may not know, a
// dead person's posts fall vacant, and no queue grows without end. They read only the log (the contract,
// contracts/log.schema.json), so they judge any implementation that writes one: the TypeScript actors today, and the
// Rust port of them.
//
// A finding is a violation, named with where it was (the entry's `seq`) and enough to look it up. The checker never
// decides what a town should do; it says what no town may do.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export interface Violation { invariant: string; seq: number; t: number; what: string }

export interface InvariantReport {
  violations: Violation[];
  /** How much each invariant had to look at (an invariant that saw nothing proves nothing: the test asks for some). */
  seen: { [what: string]: number };
}

const DAY = 86_400;
/** A whole amount of money on the wire: a decimal integer string, no sign (a transfer's amount is always positive). */
const WHOLE = /^(0|[1-9][0-9]*)$/;
const SIGNED_WHOLE = /^(0|-?[1-9][0-9]*)$/;

/** Fields of a record's data that hold an amount of money (by name): each must be a whole number of the smallest unit. */
const MONEY_KEY = /^(amount|amounts|balance|price|prices|wage|wages|rent|gross|net|withheld|fee|fees|due|paid|owed|arrears|principal|payment|charge|total|sum|cost|cents|salary|pay)$/;

interface Instruction { id: string; at: number; from: string; to: string; amount: string; every?: number; firstAt: number; bulk?: { to: string; amount: string }[]; basis?: string }

/** Stream a log's entries (plain JSONL) in order. */
/** Ids in the order they were made: by their number where they share a prefix (rec.9 before rec.10). */
export function idOrder(a: string, b: string): number {
  const x = /^(.*?)(\d+)$/.exec(a), y = /^(.*?)(\d+)$/.exec(b);
  if (x && y && x[1] === y[1]) return Number(x[2]) - Number(y[2]);
  return a < b ? -1 : a > b ? 1 : 0;
}

export async function* entries(path: string): AsyncGenerator<any> {
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) if (line) yield JSON.parse(line);
}

/** Check one run's log. `opts.pay_lag_days`: how long after a payee dies or leaves a standing payment into their
 * account may still be made (the payer has to hear of it: docs/behaviour/deaths.md); `opts.queue_days`: how long a
 * question to a keeper, or an act, may wait undone at the end of the run. */
export async function checkLog(path: string, opts: { pay_lag_days?: number; queue_days?: number } = {}): Promise<InvariantReport> {
  const payLag = (opts.pay_lag_days ?? 45) * DAY;
  const queueDays = (opts.queue_days ?? 60) * DAY;
  const out: Violation[] = [];
  const seen: { [k: string]: number } = {};
  const saw = (k: string, n = 1) => { seen[k] = (seen[k] ?? 0) + n; };
  const flag = (invariant: string, e: any, what: string) => { if (out.length < 2000) out.push({ invariant, seq: e.seq, t: e.t, what }); };

  // ---- State, as the log tells it.
  const balance = new Map<string, bigint>();
  const accountHolder = new Map<string, string>();
  const accountCustodian = new Map<string, string>();
  const accountCurrency = new Map<string, string>();
  const closed = new Set<string>();
  /** Each account's balance after each change, by seq: what an observation should have shown. */
  const history = new Map<string, { seq: number; bal: bigint }[]>();
  const boundaries = new Set<string>();
  let total = 0n, startTotal = 0n;

  const persons = new Set<string>();
  const personOf = new Map<string, string>(); // participant -> person
  const died = new Map<string, number>(); // person -> t
  const left = new Map<string, number>(); // person -> t
  const ended = new Map<string, number>(); // participant -> t
  const where = new Map<string, Set<string>>(); // person -> spaces their body is in
  const positionEntity = new Map<string, string>();
  const holderOf = new Map<string, string | null>(); // position -> participant
  const records = new Map<string, any>(); // id -> record
  const withdrawn = new Map<string, number>(); // record id -> t
  const instructions = new Map<string, Instruction>();
  const paidUnder = new Map<string, { t: number; to: string }[]>();
  const started = new Map<string, { t: number; starts: number; done: number; participant: string }>();
  const busy = new Map<string, { starts: number; done: number; action: string }[]>(); // person participant -> spans worked
  const asks = new Map<string, number>(); // participant|channel -> started (FIFO count)
  const askOpen: { key: string; t: number }[] = [];
  const isPersonParticipant = (p: string) => personOf.has(p);
  const gone = (person: string, t: number) => (died.has(person) && died.get(person)! < t) || (left.has(person) && left.get(person)! < t);
  const goneAt = (person: string) => Math.min(died.get(person) ?? Infinity, left.get(person) ?? Infinity);
  const entityOfActing = (participant: string, position?: string) => (position ? positionEntity.get(position) : personOf.get(participant));

  const setBal = (acc: string, b: bigint, seq: number) => {
    balance.set(acc, b);
    let h = history.get(acc);
    if (!h) history.set(acc, (h = []));
    h.push({ seq, bal: b });
  };
  const balAt = (acc: string, seq: number): bigint | undefined => {
    const h = history.get(acc);
    if (!h) return undefined;
    let lo = 0, hi = h.length - 1, ans: bigint | undefined;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (h[m]!.seq <= seq) { ans = h[m]!.bal; lo = m + 1; } else hi = m - 1; }
    return ans;
  };

  /** Money fields in a record's data must be whole: walk it. */
  const wholeMoney = (e: any, v: any, path: string, depth = 0) => {
    if (depth > 6 || v === null || v === undefined) return;
    if (Array.isArray(v)) { v.forEach((x, i) => wholeMoney(e, x, `${path}[${i}]`, depth + 1)); return; }
    if (typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (MONEY_KEY.test(k)) {
        if (typeof x === "number") { saw("money fields"); if (!Number.isInteger(x)) flag("integer_cents", e, `${path}.${k} = ${x} is not a whole amount`); }
        else if (typeof x === "string" && /^-?[0-9.]+$/.test(x)) { saw("money fields"); if (!SIGNED_WHOLE.test(x)) flag("integer_cents", e, `${path}.${k} = "${x}" is not a whole amount`); }
      }
      if (typeof x === "object") wholeMoney(e, x, `${path}.${k}`, depth + 1);
    }
  };

  const noteRecord = (r: any, e: any) => {
    records.set(r.id, r);
    if (r.record === "withdrawal" && r.withdraws) withdrawn.set(r.withdraws, e.t);
    wholeMoney(e, r.data, `${r.id}.data`);
    // A notice to vacate gives at least the days the law it cites gives, counted from the day after it is on record.
    if (r.kind === "notice_to_vacate" && Number.isSafeInteger(r.data?.by)) {
      const law = typeof r.data.law === "string" ? records.get(r.data.law) : undefined;
      const days = law?.data?.notice_days;
      if (Number.isSafeInteger(days)) {
        saw("notices to vacate");
        if (r.data.by < (Math.floor(r.at / DAY) + 1 + days) * DAY) flag("notice_as_the_law_says", e, `${r.id} gives until day ${Math.floor(r.data.by / DAY)}, recorded on day ${Math.floor(r.at / DAY)}; ${law.id} gives ${days} full days`);
      }
    }
    const m = r.data?.outcome?.money;
    if (r.kind === "request" && m && typeof m.from === "string") {
      const every = Number.isSafeInteger(r.data.every) && r.data.every > 0 ? r.data.every as number : undefined;
      const firstAt = Number.isSafeInteger(r.data.first_at) ? Math.max(r.data.first_at, r.at - (r.at % DAY)) : r.at + (Number.isSafeInteger(r.data.first) ? r.data.first : 0);
      const bulk = Array.isArray(r.data.payments) ? r.data.payments.map((b: any) => ({ to: String(b.to), amount: String(b.amount) })) : undefined;
      instructions.set(r.id, { id: r.id, at: r.at, from: m.from, to: m.to, amount: String(m.amount), every, firstAt, bulk, ...(typeof r.basis === "string" ? { basis: r.basis } : {}) });
      // Under an employment agreement that commits its payer to pay this account so often: never more often. (Not
      // never more: an employer may pay more than its agreement says; an unmutated ke-nakuru-2026 town has a factory's
      // new wage orders 2% above the agreements they cite, not yet traced.)
      const a = typeof r.basis === "string" ? records.get(r.basis) : undefined;
      // (Employment only: a lease's rent may be raised by notice under the tenancy law, which the terms do not carry.)
      const c = a?.record === "agreement" && a.terms?.template === "employment" ? (a.terms?.commitments ?? []).find((x: any) => x?.does?.outcome?.money?.to === m.to && x?.every) : undefined;
      if (c && every && !Array.isArray(r.data.payments)) {
        saw("payments under agreements");
        if (every < c.every) flag("pays_as_agreed", e, `${r.id} pays every ${every / DAY} days under ${a.id}, which commits every ${c.every / DAY}`);
      }
    }
  };

  let currency0 = "";
  /** The blocks of each act command (by its seq), and of each act begun: what it does, physically or on paper. */
  const commandBlocks = new Map<number, string[]>();
  /** The least time each act command takes its actor by the world's table of work (orchestration.act_time), where
   * nobody else is named to share it: what the kernel must charge. */
  const commandSeconds = new Map<number, { person: number; system: number }>();
  let actTime: { person?: Record<string, number>; system?: Record<string, number>; default?: number | null } = {};
  const programSeconds = (blocks: any[], table: Record<string, number> | undefined) => Math.max(1, blocks.reduce((a, b) => {
    const name = String(b.block ?? "");
    const makes = name === "publish" ? `publish/${b.kind}` : name === "create_entity" ? `create_entity/${b.kind}` : name === "work" ? `work/${b.task}` : undefined;
    return a + ((makes !== undefined ? table?.[makes] : undefined) ?? table?.[name] ?? actTime.default ?? 1);
  }, 0));
  const actBlocks = new Map<string, string[]>();
  /** Blocks that need a body where the work is: someone who has left town cannot do them (a letter, a payment or a
   * notice they still can, from wherever they are now). */
  const PHYSICAL = new Set(["work", "occupy", "vacate", "move_goods", "take", "construct", "demolish", "harm", "birth"]);
  let header: any;
  let lastT = 0;
  let endEntry: any;
  /** Entries a day, by kind of entry, per person in town: what grows without end shows as a day far above the run's usual. */
  const perDay = new Map<number, number>();
  for await (const e of entries(path)) {
    lastT = Math.max(lastT, e.t ?? 0);
    if (e.kind === "command" || e.kind === "event") { const d = Math.floor((e.t ?? 0) / DAY); perDay.set(d, (perDay.get(d) ?? 0) + 1); }
    if (e.kind === "header") {
      header = e;
      const w = e.body.config.world;
      currency0 = w.currencies?.[0]?.code ?? "";
      actTime = e.body.config.orchestration?.act_time ?? {};
      for (const en of w.entities ?? []) {
        if (en.kind === "person") persons.add(en.id);
        if (en.kind === "boundary") boundaries.add(en.id);
      }
      for (const a of w.accounts ?? []) {
        if (!SIGNED_WHOLE.test(String(a.balance))) flag("integer_cents", e, `account ${a.id} opens with ${a.balance}`);
        accountHolder.set(a.id, a.holder); accountCustodian.set(a.id, a.custodian); accountCurrency.set(a.id, a.currency ?? currency0);
        setBal(a.id, BigInt(a.balance), 0);
        total += BigInt(a.balance);
      }
      startTotal = total;
      for (const p of e.body.config.participants ?? []) if (p.person) personOf.set(p.id, p.person);
      for (const p of e.body.config.positions ?? []) { positionEntity.set(p.id, p.entity); holderOf.set(p.id, p.holder ?? null); }
      for (const r of w.records ?? []) noteRecord(r, e);
      for (const o of w.occupancy ?? []) { let s = where.get(o.occupant); if (!s) where.set(o.occupant, (s = new Set())); s.add(o.space); }
      continue;
    }
    if (e.kind === "end") { endEntry = e; continue; }
    if (e.kind === "annotation") {
      if (e.body.annotation === "observation") checkObservation(e);
      continue;
    }
    if (e.kind === "command") {
      if (e.body.command === "act" && Array.isArray(e.body.blocks)) {
        commandBlocks.set(e.seq, e.body.blocks.map((x: any) => String(x.block ?? x.type ?? "")));
        const by: string[] = Array.isArray(e.body.by) ? e.body.by : [];
        const me = e.body.participant, person = personOf.get(me);
        if (by.every((w) => w === me || w === person)) commandSeconds.set(e.seq, { person: programSeconds(e.body.blocks, actTime.person), system: programSeconds(e.body.blocks, actTime.system) });
      }
      continue;
    }
    if (e.kind !== "event") continue;
    const b = e.body;
    switch (b.event) {
      case "account_opened": {
        accountHolder.set(b.account, b.holder); accountCustodian.set(b.account, b.custodian); accountCurrency.set(b.account, b.currency ?? currency0);
        if (!history.has(b.account)) setBal(b.account, 0n, e.seq);
        break;
      }
      case "account_closed": {
        saw("accounts closed");
        if ((balance.get(b.account) ?? 0n) !== 0n) flag("money_conserved", e, `account ${b.account} closed holding ${balance.get(b.account)}`);
        closed.add(b.account);
        break;
      }
      case "transfer": {
        saw("transfers");
        const amt = String(b.amount);
        if (!WHOLE.test(amt) || amt === "0") { flag("integer_cents", e, `transfer of "${amt}"`); break; }
        const a = BigInt(amt);
        for (const acc of [b.from, b.to]) if (!history.has(acc)) flag("money_conserved", e, `transfer names account ${acc}, never opened`);
        for (const acc of [b.from, b.to]) if (closed.has(acc)) flag("money_conserved", e, `transfer names closed account ${acc}`);
        if (accountCurrency.get(b.from) !== accountCurrency.get(b.to)) flag("money_conserved", e, `transfer between currencies ${b.from} -> ${b.to}`);
        const fb = (balance.get(b.from) ?? 0n) - a;
        if (fb < 0n && !boundaries.has(accountHolder.get(b.from) ?? "")) flag("money_conserved", e, `${b.from} overdrawn to ${fb} paying ${a} to ${b.to}`);
        if (b.from !== b.to) { setBal(b.from, fb, e.seq); setBal(b.to, (balance.get(b.to) ?? 0n) + a, e.seq); }
        // Paid under an instruction: exactly what it says, to whom it says, no more often than it says.
        if (typeof b.per_instruction === "string") {
          const ins = instructions.get(b.per_instruction);
          if (ins) {
            saw("payments under instructions");
            const lines = ins.bulk ?? [{ to: ins.to, amount: ins.amount }];
            if (b.from !== ins.from) flag("pays_as_instructed", e, `paid from ${b.from} under ${ins.id}, which says from ${ins.from}`);
            if (!lines.some((l) => l.to === b.to && l.amount === amt)) flag("pays_as_instructed", e, `paid ${amt} to ${b.to} under ${ins.id}, which says ${lines.map((l) => `${l.amount} to ${l.to}`).join("; ")}`);
            let p = paidUnder.get(ins.id);
            if (!p) paidUnder.set(ins.id, (p = []));
            p.push({ t: e.t, to: b.to });
            if (ins.every) {
              const dues = e.t < ins.firstAt ? 0 : Math.floor((e.t - ins.firstAt) / ins.every) + 1;
              if (p.length > dues) flag("pays_as_instructed", e, `payment ${p.length} under ${ins.id} by day ${Math.floor(e.t / DAY)}, when only ${dues} had fallen due (every ${ins.every / DAY} days from day ${Math.floor(ins.firstAt / DAY)})`);
              // (A withdrawn standing order stops: a due date a day or more after it was withdrawn is never paid.)
              const w = withdrawn.get(ins.id);
              if (w !== undefined && e.t > w + DAY) flag("pays_as_instructed", e, `paid under ${ins.id} on day ${Math.floor(e.t / DAY)}, withdrawn on day ${Math.floor(w / DAY)}`);
            } else if (p.filter((x) => x.to === b.to).length > lines.filter((l) => l.to === b.to).length) flag("pays_as_instructed", e, `${ins.id}, a payment once, paid ${p.length} times`);
          }
        }
        // Into a person who has died, under a standing order: only while the payer cannot yet have heard. Into someone who
        // has left town, a wage only while their employer cannot yet have heard and their notice runs (a month more: a
        // worker who leaves gives notice, and is paid to its end, monthly in some places); a pension or a refund may
        // follow them anywhere.
        const payee = accountHolder.get(b.to);
        const standingOrder = typeof b.per_instruction === "string" && (instructions.get(b.per_instruction)?.every || /-wages$/.test(b.per_instruction));
        if (payee && persons.has(payee) && standingOrder) {
          // (The bank tells the payer at the next payment, and the payer stops it at its next round: two periods of a
          // standing order, or the lag, whichever is longer.)
          const lag = Math.max(payLag, 2 * (instructions.get(b.per_instruction)?.every ?? 0) + 7 * DAY);
          // (A payer with nobody left to act for it, its only post-holder the one who died, cannot stop it: that is a
          // missing law, docs/behaviour/staffing.md, counted and not failed.)
          const payer = accountHolder.get(b.from);
          const actsFor = payer ? [...positionEntity].some(([pos, ent]) => ent === payer && holderOf.get(pos) && !ended.has(holderOf.get(pos)!)) : true;
          if (died.has(payee) && died.get(payee)! + lag < e.t && !actsFor) saw("dead paid by a payer nobody acts for");
          else if (died.has(payee) && died.get(payee)! + lag < e.t) flag("dead_not_paid", e, `${amt} paid to ${payee} (${b.to}) under ${b.per_instruction}, ${Math.floor((e.t - died.get(payee)!) / DAY)} days after they died`);
          else if (left.has(payee) && left.get(payee)! + lag + 30 * DAY < e.t && /wage/i.test(`${b.memo ?? ""} ${b.per_instruction}`)) flag("dead_not_paid", e, `wages of ${amt} paid to ${payee} (${b.to}) under ${b.per_instruction}, ${Math.floor((e.t - left.get(payee)!) / DAY)} days after they left town`);
        }
        break;
      }
      case "person_created": persons.add(b.person); if (b.participant) personOf.set(b.participant, b.person); break;
      case "participant_created": if (b.person) personOf.set(b.participant, b.person); break;
      case "person_died": {
        saw("deaths");
        if (died.has(b.person)) flag("dead_stay_dead", e, `${b.person} died twice`);
        died.set(b.person, e.t);
        break;
      }
      case "person_left": saw("departures"); left.set(b.person, e.t); break;
      case "person_arrived": left.delete(b.person); break;
      case "participant_ended": {
        ended.set(b.participant, e.t);
        for (const [pos, h] of holderOf) if (h === b.participant) flag("posts_fall_vacant", e, `${b.participant} ended still holding ${pos}`);
        break;
      }
      case "position_created": positionEntity.set(b.position, b.entity); holderOf.set(b.position, null); break;
      case "appointed": {
        holderOf.set(b.position, b.holder ?? null);
        if (b.holder) {
          saw("appointments");
          const person = personOf.get(b.holder);
          if (ended.has(b.holder) || (person && gone(person, e.t + 1))) flag("posts_fall_vacant", e, `${b.position} given to ${b.holder}, who has died or gone`);
        }
        break;
      }
      case "occupied": {
        saw("occupancies");
        const person = b.occupant;
        if (persons.has(person) && (died.has(person) || left.has(person))) flag("one_place", e, `${person} occupies ${b.space} after they ${died.has(person) ? "died" : "left"}`);
        let s = where.get(person);
        if (!s) where.set(person, (s = new Set()));
        if (persons.has(person) && s.size > 0 && !s.has(b.space)) flag("one_place", e, `${person} occupies ${b.space} while still in ${[...s].join(", ")}`);
        s.add(b.space);
        break;
      }
      case "vacated": {
        const s = where.get(b.occupant);
        if (!s?.has(b.space)) flag("one_place", e, `${b.occupant} vacates ${b.space}, where they were not`);
        s?.delete(b.space);
        break;
      }
      case "recorded": noteRecord(b.record, e); break;
      case "action_started": {
        saw("acts");
        started.set(b.action, { t: e.t, starts: b.starts, done: b.done, participant: b.participant });
        const blocks = commandBlocks.get(b.cause) ?? [];
        commandBlocks.delete(b.cause);
        actBlocks.set(b.action, blocks);
        const person = personOf.get(b.participant);
        if (ended.has(b.participant) || (person && died.has(person) && died.get(person)! < e.t)) flag("no_act_by_dead", e, `${b.participant} starts ${b.action} as ${b.as ?? "self"} after ${person && died.has(person) ? "dying" : "being ended"}`);
        if (!(b.done > b.starts) || b.starts < e.t) flag("work_takes_time", e, `${b.action} starts at ${b.starts} and is done at ${b.done} (logged at ${e.t})`);
        const least = commandSeconds.get(b.cause);
        commandSeconds.delete(b.cause);
        if (least) {
          saw("acts timed by the table");
          const need = personOf.has(b.participant) ? least.person : least.system;
          if (b.done - b.starts < need) flag("work_takes_time", e, `${b.action} (${blocks.join(", ")}) by ${b.participant} takes ${b.done - b.starts} s; the world's table of work says at least ${need}`);
        }
        break;
      }
      case "action_applied": {
        const s = started.get(b.action);
        if (!s) { flag("work_takes_time", e, `${b.action} applied, never started`); break; }
        started.delete(b.action);
        if (e.t < s.done) flag("work_takes_time", e, `${b.action} applied at ${e.t}, before it is done (${s.done})`);
        const by: string[] = Array.isArray(b.by) ? b.by : [];
        const blocks = actBlocks.get(b.action) ?? [];
        actBlocks.delete(b.action);
        const physical = blocks.some((x) => PHYSICAL.has(x));
        if (!by.length) flag("work_takes_time", e, `${b.action} applied with no performer`);
        for (const p of by) {
          const person = personOf.get(p) ?? (persons.has(p) ? p : undefined);
          if (ended.has(p) && ended.get(p)! < s.starts) flag("no_act_by_dead", e, `${b.action} performed by ${p}, ended before it began`);
          if (person && died.has(person) && died.get(person)! < s.starts) flag("no_act_by_dead", e, `${b.action} performed by ${p} (${person}), who had died`);
          else if (person && physical && left.has(person) && left.get(person)! < s.starts) flag("no_act_by_absent", e, `${b.action} (${blocks.join(", ")}) performed by ${p} (${person}), who had left town`);
          // A person has one timeline: two acts of theirs never take the same seconds. (An act with one performer
          // takes its whole span of them; one shared among several takes a share of each, placed where each is free.)
          if (person && by.length === 1 && (p === s.participant || personOf.get(s.participant) === person)) {
            saw("person acts");
            let spans = busy.get(person);
            if (!spans) busy.set(person, (spans = []));
            // (Spans come in order of finishing; only the recent ones can overlap a new one.)
            for (let i = spans.length - 1; i >= 0 && i >= spans.length - 50; i--) {
              const o = spans[i]!;
              if (o.starts < s.done && s.starts < o.done) { flag("one_timeline", e, `${person} does ${b.action} (${s.starts}-${s.done}) and ${o.action} (${o.starts}-${o.done}) at once`); break; }
            }
            spans.push({ starts: s.starts, done: s.done, action: b.action });
            if (spans.length > 200) spans.splice(0, 100);
          }
        }
        break;
      }
      case "action_refused": started.delete(b.action); saw("refusals"); break;
      case "ask_started": askOpen.push({ key: `${b.participant}|${b.channel}`, t: e.t }); asks.set(`${b.participant}|${b.channel}`, (asks.get(`${b.participant}|${b.channel}`) ?? 0) + 1); saw("asks"); break;
      case "ask_answered": {
        const k = `${b.participant}|${b.channel}`;
        const i = askOpen.findIndex((x) => x.key === k);
        if (i < 0) flag("queues_drain", e, `${k} answered, never asked`); else askOpen.splice(i, 1);
        break;
      }
    }
  }

  // ---- What a seat was shown (recorded observations): nothing it may not know, and its balances as the ledger has them.
  function checkObservation(e: any) {
    const o = e.body.data?.observation;
    if (!o?.channels) return;
    saw("observations");
    const me: string = o.entity;
    const participant: string = o.participant;
    for (const c of o.channels) {
      if (c.kind === "records" && Array.isArray(c.records)) {
        for (const r of c.records) {
          if (typeof r !== "object" || !r) continue;
          saw("records shown");
          const vis = r.visible_to;
          const authorEntity = r.author === "genesis" ? undefined : entityOfActing(r.author, r.in_position);
          const ok = vis === "public" || (Array.isArray(vis) && vis.includes(me)) || authorEntity === me;
          if (!ok) flag("no_god_view", e, `${participant} (as ${me}) shown ${r.id} (${r.kind ?? r.record}) on ${c.path}, visible to ${JSON.stringify(vis)}`);
        }
      }
      if (c.kind === "accounts" && Array.isArray(c.accounts)) {
        for (const a of c.accounts) {
          saw("balances shown");
          if (!SIGNED_WHOLE.test(String(a.balance))) flag("integer_cents", e, `${participant} shown ${a.account} holding "${a.balance}"`);
          if (a.holder !== me && a.custodian !== me) flag("no_god_view", e, `${participant} (as ${me}) shown account ${a.account} of ${a.holder}, kept by ${a.custodian}`);
          const want = balAt(a.account, e.seq);
          if (want !== undefined && SIGNED_WHOLE.test(String(a.balance)) && BigInt(a.balance) !== want) flag("money_conserved", e, `${participant} shown ${a.account} holding ${a.balance}; the transfers say ${want}`);
        }
        for (const x of c.transactions ?? []) {
          if (accountHolder.get(x.from) !== me && accountHolder.get(x.to) !== me && accountCustodian.get(x.from) !== me && accountCustodian.get(x.to) !== me)
            flag("no_god_view", e, `${participant} (as ${me}) shown a transfer ${x.from} -> ${x.to}, neither theirs`);
        }
      }
    }
    const mine = new Set<string>([participant, me, personOf.get(participant) ?? "", ...(o.positions ?? []).flatMap((p: any) => [p.position, p.entity])]);
    for (const m of o.inbox ?? []) if (Array.isArray(m.to) && !m.to.some((x: string) => mine.has(x))) flag("no_god_view", e, `${participant} shown a message to ${JSON.stringify(m.to)}`);
  }

  // ---- At the end.
  const endE = endEntry ?? { seq: -1, t: lastT };
  if (total !== startTotal) flag("money_conserved", endE, `money at the end ${total}, at the start ${startTotal}`);
  let sum = 0n;
  for (const v of balance.values()) sum += v;
  if (sum !== startTotal) flag("money_conserved", endE, `balances add to ${sum}, the town started with ${startTotal}`);

  // Every living person who is here is somewhere (one space), and in one household: the newest household record that
  // names them is theirs (docs/behaviour/households.md: a new record supersedes the old), and everyone it names who is
  // alive and here has that same record for theirs, and nobody it names has been dead for long.
  const newer = (a: any, b: any) => a.at > b.at || (a.at === b.at && idOrder(a.id, b.id) > 0);
  const current = new Map<string, any>();
  for (const r of records.values()) if (r.kind === "household" && !withdrawn.has(r.id)) for (const m of r.data?.members ?? []) {
    const c = current.get(m.person);
    if (!c || newer(r, c)) current.set(m.person, r);
  }
  for (const p of persons) {
    const here = !died.has(p) && !left.has(p);
    const spaces = where.get(p)?.size ?? 0;
    const h = current.get(p);
    if (here) {
      saw("living persons at the end");
      // (Someone in no space is counted, not failed: a newcomer who finds no home, or someone put out of theirs, is in no
      // space at all in this world, a gap: docs/testing.md "The gaps". Nobody is in two.)
      if (spaces === 0) saw("living persons in no space at the end");
      else if (spaces !== 1) flag("one_place", endE, `${p}, alive and here, is in ${spaces} spaces at the end`);
      if (!h) { flag("one_household", endE, `${p}, alive and here, is in no household`); continue; }
      for (const m of h.data.members ?? []) {
        const q = m.person;
        if (died.has(q) && lastT - died.get(q)! > queueDays) flag("one_household", endE, `${p}'s household ${h.id} still names ${q}, dead since day ${Math.floor(died.get(q)! / DAY)}`);
        else if (!died.has(q) && !left.has(q) && persons.has(q) && current.get(q)?.id !== h.id) flag("one_household", endE, `${p}'s household is ${h.id}, which names ${q}, whose household is ${current.get(q)?.id}`);
      }
    } else if (spaces) flag("one_place", endE, `${p}, who ${died.has(p) ? "died" : "left"}, is still in ${[...where.get(p)!].join(", ")}`);
  }
  for (const [pos, h] of holderOf) if (h && ended.has(h)) flag("posts_fall_vacant", endE, `${pos} still held by ${h}, ended`);

  // No queue grows without end: no act still under way, and no question to a keeper unanswered, long after it began.
  for (const [a, s] of started) if (lastT - s.done > queueDays) flag("queues_drain", endE, `${a} by ${s.participant} was to be done on day ${Math.floor(s.done / DAY)}, never applied or refused`);
  const stale = askOpen.filter((x) => lastT - x.t > queueDays);
  if (stale.length) flag("queues_drain", endE, `${stale.length} questions to keepers unanswered for over ${queueDays / DAY} days (first: ${stale[0]!.key}, day ${Math.floor(stale[0]!.t / DAY)})`);
  // A payment asked of the bank once, by someone who holds the money for it, is made (or refused) within a month: the
  // bank's queue of instructions drains. (A refusal is a letter the log does not tie to the request, so this is a bound, not a rule
  // for each one.)
  let unpaid = 0;
  for (const ins of instructions.values()) {
    if (ins.every || ins.bulk || withdrawn.has(ins.id) || lastT - ins.at < 30 * DAY) continue;
    const payer = accountHolder.get(ins.from);
    if (!payer || (persons.has(payer) && (died.has(payer) || left.has(payer)))) continue;
    if (!(records.get(ins.id)?.addressed_to ?? []).some((x: string) => accountCustodian.get(ins.from) === x)) continue;
    saw("one-off payments asked");
    if (!paidUnder.has(ins.id) && (balance.get(ins.from) ?? 0n) >= BigInt(ins.amount)) unpaid++;
  }
  seen["one-off payments unpaid with the money there"] = unpaid;
  // (Some are left by a payer short of money when it was asked, or an instruction the bank could not read; a bank that
  // stops working through its queue leaves most. Measured on unmutated towns: under 1%.)
  if (unpaid * 20 > (seen["one-off payments asked"] ?? 0)) flag("queues_drain", endE, `${unpaid} of ${seen["one-off payments asked"]} payments asked of the bank once, a month or more ago, never made though the money is there`);
  // No day's log is far busier than the run's usual days: something waking, retrying or filing over and over shows here.
  // (Weeks, against the median week: a town's busiest weeks, the first and those with a payday for everyone, are under
  // three times the median in unmutated towns.)
  const weeks = new Map<number, number>();
  for (const [d, n] of perDay) weeks.set(Math.floor(d / 7), (weeks.get(Math.floor(d / 7)) ?? 0) + n);
  const counts = [...weeks.entries()].filter(([w]) => w > 0).map(([, n]) => n).sort((a, b) => a - b);
  if (counts.length >= 4) {
    const median = counts[counts.length >> 1]!;
    const most = counts.at(-1)!;
    seen["busiest week as percent of median"] = Math.round((most * 100) / median);
    if (most > 3 * median) flag("bounded", endE, `a week of ${most} commands and events, against a median week of ${median}`);
  }
  if (!header) flag("log", endE, "no header");
  if (!endEntry) flag("log", endE, "no end entry: the run did not finish");
  return { violations: out, seen };
}
