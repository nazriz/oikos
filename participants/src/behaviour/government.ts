// The town's government, as people following (or not) the town's charter and
// procedures. Documented in docs/behaviour/government.md, with sources.
//
// Nothing here is kernel mechanics. A law exists because a clerk published it
// after counting a ballot; money moves because the finance officer instructed
// the bank, and the bank checked its signatory list.

import { cents } from "../money";
import * as C from "../calls";
import type { SiteStructure, StatementRecord } from "../contracts";
import { channels } from "../contracts";
import { need, params, type Belief, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, cellsOf, DAY, jobTerms, Letters, lotOf, message, MONTH, ownAccount, pay, publishedCount, publishedPrice, record, say, type Step, usd, variableToday, vote, outOfTime, team } from "./common";
import { Staffing, stepper } from "./firms";
import { incomeTaxLaw, withholding } from "./tax";
import { ownerOf } from "./institutions";

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
  version: "0.6.0",
  doc: "docs/behaviour/government.md",
  cadence: () => 7 * DAY,
  create(ctx: ParticipantContext) {
    const p = params({ responsiveness_bps: 7000, petition_threshold_bps: 1500, population: 200, park_budget: 8_000_000, builder: "", park_type: "park",
      // The rest of the budget's lines (docs/behaviour/services.md): the town's staff, and its services' running costs.
      staff_budget: 0, services_budget: 0, environment_budget: 0 }, ctx.params);
    need(p, ["builder"], "city.mayor_code");
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
          const lines = { parks: p.park_budget, ...(p.staff_budget ? { staff: p.staff_budget } : {}), ...(p.services_budget ? { services: p.services_budget } : {}), ...(p.environment_budget ? { environment: p.environment_budget } : {}) };
          steps.push(because(newYear ? "A new year: tabling the town's budget." : "No budget adopted for this year yet: tabling it again.", say("proposal", `Budget for year ${Math.floor(t / YEAR) + 1}: ${Object.entries(lines).map(([k, v]) => `${k} ${v} cents`).join(", ")}.`, { to: [me],
            data: { enact: { kind: "budget", text: `The town's budget for year ${Math.floor(t / YEAR) + 1}.`, data: { year: Math.floor(t / YEAR) + 1, lines } }, tags: ["budget"] } })));
        }
        // A park a year, if the adopted budget has room and there's a city lot free:
        // apply for planning permission like anyone else, then commission the builder once granted.
        const budget = book.open("budget").sort((a, b) => b.at - a.at)[0];
        const year = Math.floor(t / YEAR);
        // The builder's published price for a park (none published: nothing to plan with).
        const price = publishedPrice(book, p.builder, p.park_type) ?? 0;
        if (budget && budget.data?.year === year + 1 && parkYear !== year && price > 0 && price <= (budget.data?.lines?.parks ?? 0)) {
          const cells = channels.cells(obs);
          const free = new Set(cells.filter((c) => !c.structure).map((c) => c.cell));
          const lot = [...new Set(cells.filter((c) => free.has(c.cell)).map((c) => lotOf(book, c.cell)).filter((l): l is string => !!l))]
            .sort()
            .find((l) => ownerOf(book, l) === me && cellsOf(book, l).every((c) => free.has(c)));
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


/**
 * city.council_clerk: runs the council's votes, as the charter says. Puts each
 * proposal to a ballot of the councillors for `vote_days`, counts the votes
 * cast by councillors (checked against the directory), and publishes
 * the result, and, if passed, the law or budget itself, with the ballot as
 * its basis.
 */
export const councilClerk: BehaviourModule = {
  name: "city.council_clerk",
  version: "0.5.1",
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
        letters.take(obs, book);
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
          for (const r of book.ofType("vote")) if (r.ballot === ballot.id && r.in_position && councillors.has(r.in_position)) latest.set(r.in_position, r.choice);
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
  version: "0.5.1",
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
        letters.take(obs, book);
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
  version: "0.8.1",
  doc: "docs/behaviour/government.md",
  cadence: () => 3 * DAY,
  create(ctx: ParticipantContext) {
    const p = params({ approval_over: 5_000_000, compliance_bps: 10_000, mayor_position: "mayor", budget_lines: {} as Record<string, string>, period: 14 * DAY, notice_days: 14 }, ctx.params);
    const book = new Book();
    const paid = new Set<string>();
    let spent = 0;
    let budgetYear = -1;
    // The town's payroll (docs/behaviour/services.md): wages for those the town employs (its works office hires them),
    // net of the income tax withheld, which is paid over monthly. They count against the adopted budget.
    const payroll = new Staffing(ctx, ctx.entity, { period: p.period, notice_days: p.notice_days, role: "staff", does: { hire: false, pay: true } });
    let wagesAtYear = 0;
    const letters = new Letters();
    // The town account's money in and out, as the office sees it (for its reports).
    const flows: { t: number; amount: number; party: string }[] = [];
    return Object.assign(stepper(
      (obs) => {
        book.absorb(obs);
        payroll.absorb(obs);
        letters.take(obs, book);
        const mine = ownAccount(obs)?.account;
        if (mine) for (const x of channels.transactions(obs)) {
          if (x.to === mine && x.from !== mine) flows.push({ t: x.t, amount: cents(x.amount), party: x.from });
          if (x.from === mine && x.to !== mine) flows.push({ t: x.t, amount: -cents(x.amount), party: x.to });
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
          wagesAtYear = payroll.wagesPaid;
        }
        steps.push(...payroll.routine(obs, book, acc.account, { target: 0, wage: 0, canPost: false }));
        const wages = () => payroll.wagesPaid - wagesAtYear;
        const limit = budget ? Object.values(budget.data?.lines ?? {}).reduce((s: number, v: any) => s + (v as number), 0) : 0;
        for (const inv of book.open("invoice").sort((a, b) => (a.id < b.id ? -1 : 1))) {
          if (paid.has(inv.id) || !(inv.addressed_to ?? []).includes(me)) continue;
          const owed = inv.data?.outcome?.money;
          const amount = cents(owed?.amount);
          // Approved in writing by the mayor: made in the mayor's position, whoever holds it.
          const approved = book.open("approval").some((a) => a.data?.invoice === inv.id && a.in_position === p.mayor_position);
          const withinProcedure = spent + wages() + amount <= limit && (amount <= p.approval_over || approved);
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
          // The town's payroll, itemised: who's paid, how often, gross and what reaches them after the tax withheld, into
          // which account, under which agreement (a mayor otherwise sees only recurring payments it can't place: pilots 8, 9).
          const law = incomeTaxLaw(book);
          const staff = payroll.staff(book, obs.t);
          const payrollText = staff.length
            ? `The town's payroll (${staff.length}, recurring payments from ${acc.account}): ${staff.map((a) => {
                const period = jobTerms(a, a.terms.parties[1]).period;
                const gross = payroll.wageOf(a);
                const net = gross - withholding(law, gross, period);
                return `${a.terms.parties[1]}, every ${Math.round(period / DAY)} days, ${usd(gross)} gross, ${usd(net)} paid to ${payroll.payee(book, a) ?? "their account"} after tax withheld (agreement ${a.id})`;
              }).join("; ")}. `
            : "The town employs nobody at present. ";
          return `Report from the finance office: the town's account ${acc.account} holds ${usd(acc.balance)}. ` + history + payrollText +
            (budget ? `The adopted budget (${budget.id}, year ${budget.data?.year}): ${lines}; spent under it so far ${usd(spent + wages())} (${usd(wages())} of it the town's wages). ` : "No budget has been adopted for this year. ") +
            // The budget brief: what each line pays for (world config). The amounts are the mayor's and the council's to set.
            (Object.keys(p.budget_lines).length ? `The budget's lines: ${Object.entries(p.budget_lines).map(([k, v]) => `${k}, for ${v}`).join("; ")} Setting the amounts is for the mayor and the council; a budget goes to the council on the council proposal form. ` : "") +
            // What building costs, as builders have published it.
            book.open("price_list").filter((l) => l.data?.prices).map((l) => `${l.speaks_for ?? l.author}'s published prices (${l.id}): ${Object.entries(l.data?.prices ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k} ${usd(v as number)}`).join(", ")}. `).join("") +
            (unpaid.length ? `Invoices awaiting payment: ${unpaid.map((i) => `${i.id} (${usd(i.data?.outcome?.money?.amount ?? 0)})`).join(", ")}.` : "No invoices are awaiting payment.");
        }));
        return steps;
      },
    ), { beliefs: (): Belief[] => payroll.beliefs(book) });
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
  version: "0.4.1",
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
        letters.take(obs, book);
        const acc = ownAccount(obs);
        if (acc) for (const tx of channels.transactions(obs)) if (tx.to === acc.account) received.set(tx.from, (received.get(tx.from) ?? 0) + cents(tx.amount));
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

/**
 * city.rates_officer: administers the rating law (docs/behaviour/public-finance.md). From the latest valuation of each
 * property, it reckons a year's rates at the law's rate in the dollar, and every instalment period sends each owner a
 * notice for their share, recording it as the town's claim against them (payable into the town's account, by the due
 * date). What's still unpaid after the due date draws the law's penalty interest, monthly, recorded as a claim too,
 * with a letter. A payment settles a claim when it names it.
 */
export const ratesOfficer: BehaviourModule = {
  name: "city.rates_officer",
  version: "0.1.1",
  doc: "docs/behaviour/public-finance.md",
  cadence: () => DAY,
  create(ctx: ParticipantContext) {
    const p = params({ law: "law-rates", first_day: 30 }, ctx.params);
    const book = new Book();
    const letters = new Letters();
    const settled = new Set<string>(); // claims a payment into our account has named
    const lastInterest = new Map<string, number>(); // overdue claim -> when interest was last charged
    let next = p.first_day * DAY;
    let levied = 0;
    let received = 0;
    return stepper(
      (obs) => {
        book.absorb(obs);
        letters.take(obs, book);
        const acc = ownAccount(obs);
        if (acc) for (const tx of channels.transactions(obs)) if (tx.to === acc.account && tx.settles) {
          settled.add(tx.settles);
          received += cents(tx.amount);
        }
      },
      (obs) => {
        const me = obs.entity;
        const t = obs.t;
        const acc = ownAccount(obs);
        const steps: Step[] = [];
        const law = book.records.get(p.law);
        const terms = law?.record === "statement" ? law.data ?? {} : {};
        const ratePpm: number = terms.rate_ppm ?? 0;
        const instalments: number = terms.instalments ?? 4;
        const dueDays: number = terms.due_days ?? 30;
        const interestBps: number = terms.penalty_interest_bps ?? 0;
        if (!acc || !law) return steps;
        // Notices: each owner's share of a year's rates on what they own, as last valued.
        if (t >= next && ratePpm > 0) {
          next = t + Math.floor(365 / instalments) * DAY;
          const latest = new Map<string, StatementRecord>(); // lot -> its latest valuation
          for (const v of book.open("valuation").sort((a, b) => a.at - b.at)) latest.set(v.data?.lot, v);
          const byOwner = new Map<string, { lots: string[]; amount: number }>();
          for (const v of latest.values()) {
            const o = byOwner.get(v.data.owner) ?? { lots: [], amount: 0 };
            o.lots.push(v.data.lot);
            o.amount += Math.floor((Number(v.data.value) * ratePpm) / 1_000_000 / instalments);
            byOwner.set(v.data.owner, o);
          }
          const lines: C.Call[] = [];
          for (const [owner, o] of [...byOwner].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
            if (o.amount <= 0) continue;
            levied += o.amount;
            const due = t + dueDays * DAY;
            lines.push(say("rates_notice", `Rates notice: ${usd(o.amount)} on ${o.lots.join(", ")}, due in ${dueDays} days, into ${acc.account}.`, { to: [owner], visible: [me, owner], basis: law.id, data: { amount: o.amount, lots: o.lots, due, account: acc.account } }),
              record("right", me, { kind: "rates", amount: o.amount, account: acc.account, due, lots: o.lots }, { against: owner, basis: law.id }));
          }
          for (let i = 0; i < lines.length; i += 30) steps.push(because(`The rates instalment: a ${instalments === 1 ? "year" : `${instalments}th of a year`}'s rates at the law's ${ratePpm / 10_000}% of each property's value.`, ...lines.slice(i, i + 30)));
        }
        // Overdue: penalty interest, monthly, on what's still unpaid after its due date.
        if (interestBps > 0) for (const c of book.ofType("claim").filter((r) => r.record === "claim" && r.position === "right" && r.holder === me && r.about?.kind === "rates") as any[]) {
          if (settled.has(c.id) || t < c.about.due) continue;
          if (t - (lastInterest.get(c.id) ?? c.about.due) < 30 * DAY) continue;
          lastInterest.set(c.id, t);
          const interest = Math.floor((cents(c.about.amount) * interestBps) / 10_000 / 12);
          if (interest > 0) steps.push(because(`Rates overdue a month or more: recording a month's penalty interest (${interestBps / 100}% a year) and writing to the owner.`,
            record("right", me, { kind: "rates_interest", amount: interest, account: acc.account }, { against: c.counterparty, basis: c.id }),
            message([c.counterparty], `Rates of ${usd(cents(c.about.amount))} are overdue; interest of ${usd(interest)} has been added.`, c.id)));
        }
        steps.push(...letters.answer(() => {
          const overdue = [...new Set((book.ofType("claim").filter((r) => r.record === "claim" && r.position === "right" && r.holder === me && r.about?.kind === "rates" && !settled.has(r.id) && t >= (r as any).about.due) as any[]).map((c) => c.counterparty))];
          return `Report from the rates officer: rates at ${ratePpm / 10_000}% of value a year, in ${instalments} instalments; ${usd(levied)} levied so far, ${usd(received)} received.` +
            (overdue.length ? ` Overdue: ${overdue.join(", ")}.` : " Nothing is overdue.");
        }));
        return steps;
      },
    );
  },
};

/**
 * city.works: the town's works office (docs/behaviour/services.md). It hires a works crew to what the adopted budget's
 * staff line pays for (the finance officer runs their payroll), and each working day sets the crew at the depot to
 * the town's services, within their hours: collecting waste from the homes due a collection (a round every
 * `collect_every_days`, and any home complained about first), then maintaining the town's most worn assets. Weekly,
 * it takes what's been collected to the landfill, with a docket. The crew works from the depot on the homes and
 * parks (no travel, D25). What the tasks take (their labour, what a unit changes) is the office's own knowledge of
 * the work, from the world's catalogue.
 */
export const works: BehaviourModule = {
  name: "city.works",
  version: "0.1.2",
  doc: "docs/behaviour/services.md",
  cadence: () => DAY,
  firstWake: (ctx) => 7 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    const p = params({
      depot: "", workplace: "", // its depot, and the space the crew works in there (the world must say)
      role: "works crew", wage: 0, period: 14 * DAY, notice_days: 14,
      industry: "", // what the work is (its postings say)
      working_day: 8 * 3600, work_days: 5,
      waste: "waste", collect_task: "collect", collect_labour: 0, collect_per_unit: 0, collect_every_days: 7, // per unit: seconds of work, and waste taken
      wear: "wear", maintain_task: "maintain", maintain_labour: 0, maintain_per_unit: 0, maintain_over: 0, // wear worth a crew's time above this
      staff_line: "staff", landfill: "", kind: "waste", dispose_every_days: 7,
      depot_channel: "depot", // the channel that shows the depot, with who's there by name
    }, ctx.params);
    need(p, ["depot", "workplace", "landfill"], "city.works");
    const me = ctx.entity;
    const book = new Book();
    const letters = new Letters();
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, workplace: p.workplace, role: p.role, ...(p.industry ? { industry: p.industry } : {}), does: { hire: true, pay: false }, own: "role_or_unnamed" });
    const seen = new Map<string, SiteStructure | undefined>(); // cell -> what we last saw there (perception is changes)
    let depotView: SiteStructure | undefined; // the depot, as its own channel shows it (who's there, by name)
    let atDepot = 0; // what's been collected and is held at the depot (holdings are seen as they change)
    const collectedAt = new Map<string, number>(); // home (a building) -> when we last collected from it
    const complained = new Set<string>(); // homes complained about, not yet collected
    const handled = new Set<string>();
    const used = new Map<string, number>(); // crew member -> seconds worked today
    let usedDay = -1;
    let nextDispose = p.dispose_every_days * DAY;
    let month = -1;
    let collectedKg = 0;
    const annual = Math.floor((p.wage * 365 * DAY) / p.period);
    return Object.assign(stepper(
      (obs) => {
        book.absorb(obs);
        staffing.absorb(obs);
        letters.take(obs, book);
        for (const c of channels.cells(obs)) seen.set(c.cell, c.structure);
        for (const h of channels.holdings(obs)) if (h.at === p.depot && h.kind === p.kind) atDepot = Number(h.quantity);
        const depot = obs.channels[p.depot_channel];
        if (depot?.kind === "sites") for (const c of depot.cells) if (c.structure?.structure === p.depot) depotView = c.structure;
      },
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        const year = Math.floor(t / YEAR) + 1;
        const budget = book.open("budget").filter((b) => b.data?.year === year).sort((a, b) => b.at - a.at)[0];
        const line = budget ? cents(budget.data?.lines?.[p.staff_line] ?? 0) : 0;
        const buildings = [...new Map([...seen.values()].filter((st): st is SiteStructure => !!st).map((st) => [st.structure, st])).values()];
        const room = depotView?.spaces.find((sp) => sp.space === p.workplace);
        // The crew the staff line pays for (none adopted yet: the crew we have), within the depot's room.
        const workers = staffing.workers(book, t);
        const target = budget ? Math.min(room?.capacity ?? Infinity, annual > 0 ? Math.floor(line / annual) : 0) : workers.length;
        const m = Math.floor(t / MONTH);
        if (m !== month) {
          month = m;
          if (workers.length > target) steps.push(...staffing.letGo(book, t, `The adopted budget's ${p.staff_line} line (${usd(line)}) pays for a crew of ${target}, and we have ${workers.length}: letting one go.`, "Redundancy: the budget doesn't pay for the position."));
        }
        steps.push(...staffing.routine(obs, book, "", { target, wage: p.wage, canPost: !!budget && target > workers.length,
          why: `The adopted budget's ${p.staff_line} line (${usd(line)}) pays for a crew of ${target}; we have ${workers.length}: posting a job.` }));

        // Complaints about a home's waste: that home first, on the next round.
        for (const c of book.open("complaint")) {
          if (handled.has(c.id) || !(c.addressed_to ?? []).includes(me)) continue;
          handled.add(c.id);
          if (typeof c.data?.structure === "string") complained.add(c.data.structure);
        }

        // ---- weekly: what's been collected, to the landfill ----
        if (t >= nextDispose) {
          nextDispose = t + p.dispose_every_days * DAY;
          const q = atDepot;
          if (q > 0) {
            const st = because(`Taking the week's ${p.kind} (${q}) to the landfill, with a docket.`,
              C.call("goods", { kind: p.kind, quantity: C.text(String(q)), to: p.landfill, at: p.landfill, from_at: p.depot }),
              say("disposal_docket", `Delivered: ${q} of ${p.kind}.`, { to: [p.landfill], visible: [me, p.landfill], data: { kind: p.kind, quantity: q } }));
            st.then = (out) => { if (out.status === "applied") atDepot = Math.max(0, atDepot - q); };
            steps.push(st);
          }
        }

        // ---- the day's work, on working days, by the crew at the depot ----
        const day = Math.floor(t / DAY);
        if (day !== usedDay) {
          usedDay = day;
          used.clear();
        }
        const mine = new Set(workers);
        // (Those here with the most time between them, the work shared evenly: someone who's done a day's work elsewhere
        // today joins tomorrow.)
        const present = team([...new Set(room?.occupants ?? [])].filter((w) => mine.has(w)).sort(), (w) => p.working_day - (used.get(w) ?? 0)).who;
        if (day % 7 < p.work_days && present.length) {
          const left = () => Math.min(...present.map((w) => p.working_day - (used.get(w) ?? 0))) * present.length;
          const spend = (seconds: number) => { for (const w of present) used.set(w, (used.get(w) ?? 0) + Math.ceil(seconds / present.length)); };
          const job = (task: string, units: number, on: string) => C.call("work", { task, units: C.text(String(units)), at: p.depot, by: C.json(present), on });
          // Collection: homes complained about, then those longest since a collection, as far as the crew's hours go
          // (a round's work in steps of up to 30 homes).
          const round: { on: string; call: C.Call; before?: number; full: boolean; fit: number; of: number }[] = [];
          if (p.collect_labour > 0 && p.collect_per_unit > 0) {
            const due = buildings.filter((b) => b.variables?.[p.waste] && (complained.has(b.structure) || t - (collectedAt.get(b.structure) ?? -Infinity) >= p.collect_every_days * DAY - DAY / 2))
              .sort((a, b) => Number(complained.has(b.structure)) - Number(complained.has(a.structure)) || (collectedAt.get(a.structure) ?? -1) - (collectedAt.get(b.structure) ?? -1) || (a.structure < b.structure ? -1 : 1));
            for (const b of due) {
              const units = Math.floor((variableToday(b.variables![p.waste], t) ?? 0) / p.collect_per_unit);
              if (units === 0) {
                collectedAt.set(b.structure, t);
                complained.delete(b.structure);
                continue;
              }
              const fit = Math.min(units, Math.floor(left() / p.collect_labour));
              if (fit <= 0) break;
              const before = collectedAt.get(b.structure);
              spend(fit * p.collect_labour);
              if (fit === units) {
                collectedAt.set(b.structure, t);
                complained.delete(b.structure);
              }
              collectedKg += fit;
              round.push({ on: b.structure, call: job(p.collect_task, fit, b.structure), before, full: fit === units, fit, of: units });
            }
          }
          for (let i = 0; i < round.length; i += 30) {
            const part = round.slice(i, i + 30);
            const short = part.filter((x) => !x.full);
            const st = because(`The collection round: ${part.map((x) => x.on).join(", ")}${short.length ? ` (${short.map((x) => `${x.on}: ${x.fit} of ${x.of} loads, the crew's hours used up`).join("; ")})` : ""}.`, ...part.map((x) => x.call));
            st.then = (out) => {
              if (out.status === "applied") return;
              for (const x of part) if (x.before === undefined) collectedAt.delete(x.on); else collectedAt.set(x.on, x.before);
              // Someone's day is fuller than our count of it (work elsewhere today): the world's count, from now on.
              const short = outOfTime(out);
              if (short?.who) used.set(short.who, p.working_day - short.left);
              else if (short) for (const w of present) used.set(w, p.working_day);
            };
            steps.push(st);
          }
          // Maintenance: the most worn of the town's assets, with the hours left.
          if (p.maintain_labour > 0 && p.maintain_per_unit > 0) {
            const worn = buildings.map((b) => ({ b, wear: variableToday(b.variables?.[p.wear], t) ?? 0 })).filter((x) => x.b.variables?.[p.wear] && x.wear > p.maintain_over)
              .sort((a, b) => b.wear - a.wear || (a.b.structure < b.b.structure ? -1 : 1));
            const upkeep: C.Call[] = [];
            const names: string[] = [];
            for (const x of worn) {
              const units = Math.min(Math.ceil((x.wear - p.maintain_over) / p.maintain_per_unit), Math.floor(left() / p.maintain_labour));
              if (units <= 0) break;
              spend(units * p.maintain_labour);
              upkeep.push(job(p.maintain_task, units, x.b.structure));
              names.push(x.b.structure);
            }
            if (upkeep.length) steps.push(because(`Upkeep of the most worn of the town's assets: ${names.join(", ")}.`, ...upkeep.slice(0, 30)));
          }
        }

        steps.push(...letters.answer(() => {
          const homes = buildings.filter((b) => b.variables?.[p.waste]);
          const overdue = homes.filter((b) => t - (collectedAt.get(b.structure) ?? -Infinity) >= (p.collect_every_days + 7) * DAY).map((b) => b.structure);
          const assets = buildings.filter((b) => b.variables?.[p.wear]).map((b) => `${b.structure} ${Math.round(((variableToday(b.variables![p.wear], t) ?? 0) * 100) / Math.max(1, b.variables![p.wear]!.max))}% worn`);
          return `Report from the works office: a crew of ${workers.length} (the adopted budget's ${p.staff_line} line, ${usd(line)}, pays for ${target} at ${usd(annual)} a year each). ` +
            `Waste is collected from every home every ${p.collect_every_days} days as the crew's hours allow; ${collectedKg} loads collected so far. ` +
            (overdue.length ? `Homes a week or more overdue: ${overdue.join(", ")}. ` : "No home is overdue. ") +
            (assets.length ? `The town's assets: ${assets.join(", ")}.` : "");
        }));
        return steps;
      },
    ), { beliefs: (): Belief[] => staffing.beliefs(book) });
  },
};

/** What a proposal made on the council proposal form enacts if it passes: a law, or a budget (with its lines: parks,
 * and staff and services where the form gives them). */
function fromForm(prop: StatementRecord | undefined, t: number): any {
  const d = prop?.data;
  if (!d?.proposal) return undefined;
  if (d.kind === "law") return { kind: "law", text: d.proposal };
  if (d.kind === "budget") {
    const line = (x: unknown) => (x === undefined ? 0 : cents(x as string));
    return { kind: "budget", text: d.proposal, data: { year: Math.floor(t / YEAR) + 1, lines: { parks: line(d.parks), ...(d.staff !== undefined ? { staff: line(d.staff) } : {}), ...(d.services !== undefined ? { services: line(d.services) } : {}) } } };
  }
  return undefined;
}

/** How a form-made proposal is placed for the councillors (their votes weigh who it mainly bears on). */
function formTags(prop: StatementRecord): string[] {
  const d = prop.data ?? {};
  return d.kind === "budget" ? ["budget"] : d.affects === "tenants" ? ["tenant_protection"] : d.affects === "development" ? ["development"] : [];
}
