// The town's government, as people following (or not) the town's charter and
// procedures. Documented in docs/behaviour/government.md, with sources.
//
// Nothing here is kernel mechanics. A law exists because a clerk published it
// after counting a ballot; money moves because the finance officer instructed
// the bank, and the bank checked its signatory list.

import * as C from "../calls";
import type { StatementRecord } from "../contracts";
import { channels } from "../contracts";
import { params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, cellsOf, DAY, Letters, lotOf, message, ownAccount, pay, publishedCount, record, say, type Step, usd, vote } from "./common";
import { stepper } from "./firms";

const YEAR = 365 * DAY;

/**
 * city.mayor_code: a rule-following mayor, for the all-code control condition
 * (a language model runs the office in AI experiments). Proposes a budget each year;
 * when the budget allows, applies for planning permission for a park and,
 * once granted, commissions the builder; approves the invoices it
 * commissioned (the payments procedure needs the mayor's written approval
 * over $50k); turns a petition into a proposal once its organiser's
 * published count shows enough people have signed, with probability `responsiveness_bps`. A rejected budget is
 * tabled again every 45 days until one is adopted.
 */
export const mayorCode: BehaviourModule = {
  name: "city.mayor_code",
  version: "0.4.0",
  doc: "docs/behaviour/government.md",
  cadence: () => 7 * DAY,
  create(ctx: ParticipantContext) {
    const p = params({ responsiveness_bps: 7000, petition_threshold_bps: 1500, population: 200, park_budget: 8_000_000, builder: "builder", park_type: "park" }, ctx.params);
    const book = new Book();
    let nextBudget = 0;
    let lastTabled = 0;
    let parkYear = -1;
    const handled = new Set<string>();
    // The office's own records: made in this position (whoever held it then), or by this participant as itself.
    const ours = (r: { author: string; in_position?: string }) => (ctx.position ? r.in_position === ctx.position : r.author === ctx.participant);
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const me = obs.entity;
        const t = obs.t;
        const steps: Step[] = [];
        // The annual budget; tabled again every 45 days until the council adopts one for the year.
        const thisYear = Math.floor(t / YEAR) + 1;
        const adopted = book.open("budget").some((b) => b.data?.year === thisYear);
        if (t >= nextBudget || (!adopted && t >= lastTabled + 45 * DAY)) {
          const newYear = t >= nextBudget;
          if (newYear) nextBudget = t + YEAR;
          lastTabled = t;
          steps.push(because(newYear ? "A new year: tabling the town's budget." : "No budget adopted for this year yet: tabling it again.", say("proposal", `Budget for year ${Math.floor(t / YEAR) + 1}: parks ${p.park_budget} cents.`, { to: [me],
            data: { enact: { kind: "budget", text: `The town's budget for year ${Math.floor(t / YEAR) + 1}.`, data: { year: Math.floor(t / YEAR) + 1, lines: { parks: p.park_budget } } }, tags: ["budget"] } })));
        }
        // A park a year, if the adopted budget has room and there's a city lot free:
        // apply for planning permission like anyone else, then commission the builder once granted.
        const budget = book.open("budget").sort((a, b) => b.at - a.at)[0];
        const year = Math.floor(t / YEAR);
        const types = new Map<string, any>(ctx.world.config.catalogue.structure_types.map((x: any) => [x.id, x]));
        const price = Math.floor(((types.get(p.park_type)?.materials_cost ?? 0) * 12) / 10);
        if (budget && budget.data?.year === year + 1 && parkYear !== year && price > 0 && price <= (budget.data?.lines?.parks ?? 0)) {
          const cells = channels.cells(obs);
          const free = new Set(cells.filter((c) => !c.structure).map((c) => c.cell));
          const lot = [...new Set(cells.filter((c) => free.has(c.cell)).map((c) => lotOf(book, c.cell)).filter((l): l is string => !!l))]
            .sort()
            .find((l) => ownerIsCity(book, l) && cellsOf(book, l).every((c) => free.has(c)));
          if (lot) {
            parkYear = year;
            // The planning office's published form, like anyone else.
            steps.push(because(`The adopted budget has ${usd(budget.data?.lines?.parks ?? 0)} for parks and ${lot} is free: applying for a permit for a park, as anyone would.`, C.call("form", { to: me, form: "permit_application", lot, structure_type: p.park_type })));
          }
        }
        for (const d of book.open("permit_decision")) {
          if (handled.has(d.id) || !(d.addressed_to ?? []).includes(me)) continue;
          const app = book.records.get(d.data?.application);
          if (app?.record !== "statement" || !ours(app)) continue;
          handled.add(d.id);
          if (d.data?.decision !== "granted") continue;
          const site = app.data?.lot;
          const from = ownAccount(obs)?.account;
          steps.push(because("The park's permit was granted: commissioning the builder.", ["park", C.call("structure", { type: p.park_type, on: site, by: p.builder, price: C.dollars(price), from, basis: d.id })]));
        }
        // Approve invoices for work we commissioned (the payments procedure requires it over $50k).
        for (const inv of book.open("invoice")) {
          if (handled.has(inv.id) || !(inv.addressed_to ?? []).includes(me)) continue;
          handled.add(inv.id);
          const ag = book.records.get(inv.basis ?? "");
          if (ag?.record === "agreement" && ours(ag)) {
            steps.push(because("An invoice for work we commissioned: approving it in writing, as the payments procedure requires.", say("approval", `Approved: pay invoice ${inv.id}.`, { to: [me], basis: inv.id, data: { invoice: inv.id } })));
          }
        }
        // Petitions with enough signatures become proposals (sometimes).
        for (const pet of book.open("petition")) {
          if (handled.has(pet.id)) continue;
          if (publishedCount(book, pet) * 10_000 < p.petition_threshold_bps * p.population) continue;
          handled.add(pet.id);
          if (ctx.rng(`respond-${pet.id}`).below(10_000) >= p.responsiveness_bps) continue;
          const d = pet.data?.demand ?? {};
          steps.push(because(`A petition passed ${p.petition_threshold_bps / 100}% of the town: putting its demand to the council (we respond to ${p.responsiveness_bps / 100}% of such petitions).`, say("proposal", `Proposal (from petition ${pet.id}): ${d.text}`, { to: [me], basis: pet.id,
            data: { enact: { kind: "law", text: d.text, ...(d.adico ? { adico: d.adico } : {}), ...(d.formal ? { formal: d.formal } : {}) }, tags: d.tags ?? [] } })));
        }
        return steps;
      },
    );
  },
};

function ownerIsCity(book: Book, lot: string): boolean {
  const titles = [...book.records.values()].filter((r) => r.record === "claim" && r.about?.kind === "ownership" && r.about?.object === lot);
  return titles.some((r) => r.record === "claim" && r.holder === "city");
}

/**
 * city.council_clerk: runs the council's votes, as the charter says. Puts each
 * proposal to a ballot of the councillors for `vote_days`, counts the votes
 * cast by councillors (checked against the directory), and publishes
 * the result, and, if passed, the law or budget itself, with the ballot as
 * its basis.
 */
export const councilClerk: BehaviourModule = {
  name: "city.council_clerk",
  version: "0.4.0",
  doc: "docs/behaviour/government.md",
  cadence: () => DAY,
  create(ctx: ParticipantContext) {
    const p = params({ vote_days: 14 }, ctx.params);
    const book = new Book();
    const balloted = new Set<string>();
    const closed = new Set<string>();
    const letters = new Letters();
    return stepper(
      (obs) => {
        book.absorb(obs);
        letters.take(obs);
      },
      (obs) => {
        const me = obs.entity;
        const t = obs.t;
        const steps: Step[] = [];
        // The council's members are its councillor positions: a vote counts when made in one (one per position; the latest).
        const councillors = new Set((channels.directory(obs)?.positions ?? []).filter((x) => x.role === "councillor" && x.entity === me).map((x) => x.position));
        for (const prop of book.open("proposal")) {
          if (balloted.has(prop.id) || !(prop.addressed_to ?? []).includes(me)) continue;
          balloted.add(prop.id);
          steps.push(because("A proposal addressed to the council: opening a ballot.", say("ballot", `Council ballot: ${prop.text}`, { basis: prop.id, data: { proposal: prop.id, options: ["yes", "no"], closes_at: t + p.vote_days * DAY, electorate: "council", tags: prop.data?.tags ?? formTags(prop) } })));
        }
        for (const ballot of book.open("ballot")) {
          if (closed.has(ballot.id) || ballot.speaks_for !== me || t < (ballot.data?.closes_at ?? Infinity)) continue;
          closed.add(ballot.id);
          const latest = new Map<string, string>();
          for (const r of book.records.values()) if (r.record === "vote" && r.ballot === ballot.id && r.in_position && councillors.has(r.in_position)) latest.set(r.in_position, r.choice);
          const yes = [...latest.values()].filter((c) => c === "yes").length;
          const no = [...latest.values()].filter((c) => c === "no").length;
          const passed = yes > no && yes * 2 > councillors.size;
          const step: Step = because(`The ballot closed: counting the councillors' latest votes (${passed ? "a majority for" : "no majority for"}).`, say("ballot_result", `${passed ? "Passed" : "Rejected"}: ${yes} for, ${no} against.`, { basis: ballot.id, data: { ballot: ballot.id, yes, no, passed } }));
          const prop = book.records.get(ballot.data?.proposal) as StatementRecord | undefined;
          const enact = prop?.data?.enact ?? fromForm(prop, t);
          if (passed && enact) step.push(say(enact.kind, enact.text, { basis: ballot.id, adico: enact.adico, formal: enact.formal?.condition, data: enact.data }));
          steps.push(step);
        }
        steps.push(...letters.answer(() => {
          const waiting = book.open("proposal").filter((x) => (x.addressed_to ?? []).includes(me) && !balloted.has(x.id));
          const open = book.open("ballot").filter((b) => b.speaks_for === me && !closed.has(b.id));
          const results = book.open("ballot_result").slice(-3);
          const year = Math.floor(t / YEAR) + 1;
          const budget = book.open("budget").find((b) => b.data?.year === year);
          return "Report from the council clerk: " +
            (open.length ? `ballots open: ${open.map((b) => `${b.id} on ${b.data?.proposal}, closing day ${Math.floor(b.data?.closes_at / DAY)}`).join("; ")}. ` : "no ballots are open. ") +
            (waiting.length ? `Proposals waiting for a ballot: ${waiting.map((x) => x.id).join(", ")}. ` : "") +
            (results.length ? `Recent results: ${results.map((r) => `${r.data?.ballot}: ${r.data?.passed ? "passed" : "rejected"} ${r.data?.yes}-${r.data?.no}`).join("; ")}. ` : "") +
            (budget ? `The council adopted a budget for year ${year} (${budget.id}). ` : `No budget is adopted for year ${year}. `) +
            "Anyone may put a proposal to the council on the council proposal form (form-council-proposal); I put it to a ballot of the councillors, open for 14 days.";
        }));
        return steps;
      },
    );
  },
};

/**
 * city.councillor: votes on council ballots by a spatial rule (Downs 1957;
 * Enelow & Hinich 1984): each councillor has an ideal point on a single
 * tenants-versus-development axis, and votes for a proposal when it lies
 * closer to that point than the status quo does, with some noise. Budgets
 * pass on a base propensity. params (the councillor's own traits): leaning (-100 = pro-development ...
 * +100 = pro-tenant), noise_bps, budget_yes_bps.
 */
export const councillor: BehaviourModule = {
  name: "city.councillor",
  version: "0.4.0",
  doc: "docs/behaviour/government.md",
  cadence: () => 3 * DAY,
  create(ctx: ParticipantContext) {
    const p = params({ leaning: 0, noise_bps: 1500, budget_yes_bps: 9000 }, ctx.params);
    const book = new Book();
    const voted = new Set<string>();
    const cast: string[] = []; // "ballot: yes|no", for its answer to letters
    const letters = new Letters();
    const place = (tags: string[]) => (tags.includes("tenant_protection") ? 60 : 0) - (tags.includes("development") ? 60 : 0);
    return stepper(
      (obs) => {
        book.absorb(obs);
        letters.take(obs);
      },
      (obs) => {
        const steps: Step[] = [];
        for (const b of book.open("ballot")) {
          if (voted.has(b.id) || b.data?.electorate !== "council" || obs.t >= (b.data?.closes_at ?? 0)) continue;
          voted.add(b.id);
          const tags: string[] = b.data?.tags ?? [];
          const r = ctx.rng(`vote-${b.id}`);
          let yes: boolean;
          if (tags.includes("budget")) yes = r.below(10_000) < p.budget_yes_bps;
          else {
            const x = place(tags);
            yes = Math.abs(p.leaning - x) < Math.abs(p.leaning - 0);
            if (r.below(10_000) < p.noise_bps) yes = !yes;
          }
          cast.push(`${b.id}: ${yes ? "yes" : "no"}`);
          steps.push(because(tags.includes("budget") ? "A budget: voting on our usual propensity to pass budgets." : `Voting by our leaning (${p.leaning}) against the proposal's place on the tenants-development axis (${place(tags)})${yes !== Math.abs(p.leaning - place(tags)) < Math.abs(p.leaning) ? ", this time the other way (noise)" : ""}.`, vote(b.id, yes ? "yes" : "no")));
        }
        // A letter gets the councillor's voting record; it doesn't change how they vote (docs/behaviour/government.md).
        steps.push(...letters.answer(() => `Report from a councillor: my votes on the council's ballots: ${cast.length ? cast.join(", ") : "none yet"}.`, "A letter to a councillor: answering with our voting record."));
        return steps;
      },
    );
  },
};

/**
 * city.finance_officer: pays the town's bills as the payments procedure says:
 * within the adopted budget, and over `approval_over` only with the mayor's
 * written approval. Pays by instructing the bank (it is the account's named
 * signatory). Answers letters with its report, including the budget's lines
 * (`budget_lines`: line → what it pays for). params: compliance_bps (how often it follows procedure).
 */
export const financeOfficer: BehaviourModule = {
  name: "city.finance_officer",
  version: "0.6.0",
  doc: "docs/behaviour/government.md",
  cadence: () => 3 * DAY,
  create(ctx: ParticipantContext) {
    const p = params({ approval_over: 5_000_000, compliance_bps: 10_000, mayor_position: "mayor", budget_lines: {} as Record<string, string> }, ctx.params);
    const book = new Book();
    const paid = new Set<string>();
    let spent = 0;
    let budgetYear = -1;
    const letters = new Letters();
    // The town account's money in and out, as the office sees it (for its reports).
    const flows: { t: number; amount: number; party: string }[] = [];
    return stepper(
      (obs) => {
        book.absorb(obs);
        letters.take(obs);
        const mine = ownAccount(obs)?.account;
        if (mine) for (const x of channels.transactions(obs)) {
          if (x.to === mine && x.from !== mine) flows.push({ t: x.t, amount: x.amount, party: x.from });
          if (x.from === mine && x.to !== mine) flows.push({ t: x.t, amount: -x.amount, party: x.to });
        }
      },
      (obs) => {
        const me = obs.entity;
        const acc = ownAccount(obs);
        const steps: Step[] = [];
        if (!acc) return steps;
        const budget = book.open("budget").sort((a, b) => b.at - a.at)[0];
        if (budget && budget.data?.year !== budgetYear) {
          budgetYear = budget.data?.year;
          spent = 0;
        }
        const limit = budget ? Object.values(budget.data?.lines ?? {}).reduce((s: number, v: any) => s + (v as number), 0) : 0;
        for (const inv of book.open("invoice").sort((a, b) => (a.id < b.id ? -1 : 1))) {
          if (paid.has(inv.id) || !(inv.addressed_to ?? []).includes(me)) continue;
          const owed = inv.data?.outcome?.money;
          const amount: number = owed?.amount ?? 0;
          // Approved in writing by the mayor: made in the mayor's position, whoever holds it.
          const approved = book.open("approval").some((a) => a.data?.invoice === inv.id && a.in_position === p.mayor_position);
          const withinProcedure = spent + amount <= limit && (amount <= p.approval_over || approved);
          const follows = ctx.rng(`procedure-${inv.id}`).below(10_000) < p.compliance_bps;
          if (!withinProcedure && follows) continue; // wait (approval may come), or never (over budget)
          if (acc.balance < amount) continue;
          paid.add(inv.id);
          spent += amount;
          steps.push(because(withinProcedure ? "Paying an invoice within the adopted budget (with the mayor's approval where needed)." : "Paying an invoice outside the procedure.", pay(owed.to, amount, { from: acc.account, for: `Paying invoice ${inv.id}.`, settles: inv.id })));
        }
        steps.push(...letters.answer(() => {
          const unpaid = book.open("invoice").filter((i) => (i.addressed_to ?? []).includes(me) && !paid.has(i.id));
          const lines = budget ? Object.entries(budget.data?.lines ?? {}).map(([k, v]) => `${k} ${usd(v as number)}`).join(", ") : "";
          // Money in and out over the last 30 days, and since records began (for a forecast, at the same rate).
          const since = (days: number) => flows.filter((f) => f.t > obs.t - days * DAY);
          const sum = (xs: typeof flows, sign: 1 | -1) => xs.filter((f) => Math.sign(f.amount) === sign).reduce((a, f) => a + Math.abs(f.amount), 0);
          const month = since(30);
          const byPayer = new Map<string, number>();
          for (const f of month) if (f.amount > 0) byPayer.set(f.party, (byPayer.get(f.party) ?? 0) + f.amount);
          const top = [...byPayer].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a, v]) => `${a} ${usd(v)}`).join(", ");
          const days = Math.max(1, Math.round(Math.min(obs.t, 365 * DAY) / DAY));
          const year = since(365);
          const history = flows.length
            ? `In the last 30 days the account received ${usd(sum(month, 1))}${top ? ` (largest: ${top})` : ""} and paid out ${usd(sum(month, -1))}. ` +
              `Over the last ${days} days it received ${usd(sum(year, 1))} and paid out ${usd(sum(year, -1))}: at that rate, about ${usd(Math.round((sum(year, 1) * 30) / days))} a month in and ${usd(Math.round((sum(year, -1) * 30) / days))} out. `
            : "No money has moved in or out of the account yet. ";
          return `Report from the finance office: the town's account ${acc.account} holds ${usd(acc.balance)}. ` + history +
            (budget ? `The adopted budget (${budget.id}, year ${budget.data?.year}): ${lines}; spent under it so far ${usd(spent)}. ` : "No budget has been adopted for this year. ") +
            // The budget brief: what each line pays for (world config). The amounts are the mayor's and the council's to set.
            (Object.keys(p.budget_lines).length ? `The budget's lines: ${Object.entries(p.budget_lines).map(([k, v]) => `${k}, for ${v}`).join("; ")} Setting the amounts is for the mayor and the council; a budget goes to the council on the council proposal form. ` : "") +
            (unpaid.length ? `Invoices awaiting payment: ${unpaid.map((i) => `${i.id} (${usd(i.data?.outcome?.money?.amount ?? 0)})`).join(", ")}.` : "No invoices are awaiting payment.");
        }));
        return steps;
      },
    );
  },
};

/**
 * city.tax_clerk: administers the tax law. For each tax report, records the
 * tax owed as a claim (the town's right, the reporter's duty) at the law's
 * rate; watches the town's account for payment; after `grace_days` unpaid,
 * records the law's penalty and sends a demand. It can only work from what's
 * reported: under-reporting is invisible to it (audits need records it
 * doesn't have; a later module).
 */
export const taxClerk: BehaviourModule = {
  name: "city.tax_clerk",
  version: "0.3.0",
  doc: "docs/behaviour/government.md",
  cadence: () => 7 * DAY,
  create(ctx: ParticipantContext) {
    const p = params({ grace_days: 45, law: "law-tax" }, ctx.params);
    const book = new Book();
    const assessed = new Map<string, { payer: string; account: string; amount: number; at: number; chased: boolean }>();
    const received = new Map<string, number>(); // paying account -> total received
    const letters = new Letters();
    return stepper(
      (obs) => {
        book.absorb(obs);
        letters.take(obs);
        const acc = ownAccount(obs);
        if (acc) for (const tx of channels.transactions(obs)) if (tx.to === acc.account) received.set(tx.from, (received.get(tx.from) ?? 0) + tx.amount);
      },
      (obs) => {
        const me = obs.entity;
        const t = obs.t;
        const steps: Step[] = [];
        const law = book.records.get(p.law);
        const rate: number = law?.record === "statement" ? law.data?.rate_bps ?? 1000 : 1000;
        const penalty: number = law?.record === "statement" ? law.data?.penalty_bps ?? 2000 : 2000;
        for (const rep of book.open("tax_report")) {
          if (assessed.has(rep.id) || !(rep.addressed_to ?? []).includes(me)) continue;
          const amount = Math.floor(((rep.data?.rent_received ?? 0) * rate) / 10_000);
          assessed.set(rep.id, { payer: rep.speaks_for!, account: rep.data?.account, amount, at: t, chased: false });
          if (amount > 0) steps.push(because(`A tax report: recording the tax owed at the law's rate (${rate / 100}%).`, record("right", me, { kind: "tax", amount, period_end: rep.data?.period_end }, { against: rep.speaks_for, basis: rep.id })));
        }
        // Chase: apply what's arrived from each account to its assessments, oldest
        // first; chase an assessment still unpaid after the grace period.
        const applied = new Map<string, number>(); // account -> assessed so far, in order
        for (const [id, a] of assessed) {
          const upTo = (applied.get(a.account) ?? 0) + a.amount;
          applied.set(a.account, upTo);
          if (a.chased || t - a.at < p.grace_days * DAY) continue;
          if ((received.get(a.account) ?? 0) >= upTo) continue;
          a.chased = true;
          const fine = Math.floor((a.amount * penalty) / 10_000);
          steps.push(because(`Tax still unpaid after ${p.grace_days} days: recording the law's penalty (${penalty / 100}%) and writing to the payer.`,
            record("right", me, { kind: "tax_penalty", amount: fine }, { against: a.payer, basis: id }),
            message([a.payer], `Tax of ${a.amount} cents on report ${id} is overdue; a penalty of ${fine} cents has been recorded.`, id),
          ));
        }
        steps.push(...letters.answer(() => {
          const total = [...assessed.values()].reduce((a, x) => a + x.amount, 0);
          const paidIn = [...new Set([...assessed.values()].map((x) => x.account))].reduce((a, acc) => a + (received.get(acc) ?? 0), 0);
          const chased = [...assessed.values()].filter((x) => x.chased).map((x) => x.payer);
          return `Report from the tax clerk: ${assessed.size} tax reports assessed, ${usd(total)} owed under the tax law (${rate / 100}% of rent), ${usd(paidIn)} received from those who owe it.` +
            (chased.length ? ` Overdue, with penalties recorded: ${[...new Set(chased)].join(", ")}.` : " Nothing is overdue.");
        }));
        return steps;
      },
    );
  },
};

/** What a proposal made on the council proposal form enacts if it passes: a law, or a budget (with its parks line). */
function fromForm(prop: StatementRecord | undefined, t: number): any {
  const d = prop?.data;
  if (!d?.proposal) return undefined;
  if (d.kind === "law") return { kind: "law", text: d.proposal };
  if (d.kind === "budget") return { kind: "budget", text: d.proposal, data: { year: Math.floor(t / YEAR) + 1, lines: { parks: Number.isInteger(d.parks) ? d.parks : 0 } } };
  return undefined;
}

/** How a form-made proposal is placed for the councillors (their votes weigh who it mainly bears on). */
function formTags(prop: StatementRecord): string[] {
  const d = prop.data ?? {};
  return d.kind === "budget" ? ["budget"] : d.affects === "tenants" ? ["tenant_protection"] : d.affects === "development" ? ["development"] : [];
}
