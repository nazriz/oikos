// The town's government, as people following (or not) the town's charter and
// procedures. Documented in docs/behaviour/government.md, with sources.
//
// Nothing here is kernel mechanics. A law exists because a clerk published it
// after counting a ballot; money moves because the finance officer instructed
// the bank, and the bank checked its signatory list.

import { cents, moneyNow } from "../money";
import * as C from "../calls";
import { dateWords } from "../forms";
import type { SiteStructure, StatementRecord } from "../contracts";
import { basesOf, channels, cites } from "../contracts";
import { need, params, type Belief, type BehaviourModule, type ParticipantContext } from "../module";
import { billSettled, nextLook, because, Book, cellsOf, DAY, draftLaw, figureGiven, figureWords, heldValue, jobTerms, Letters, lotOf, message, MONTH, ownAccount, pay, publishedCount, publishedPrice, record, say, type LawFigure, type LawSchedule, type Step, usd, variableToday, vote, withdraw, outOfTime, team, lookUp, goSee, visited, VISIT_MAX, Directions, StandingWork, CounterWork, approvalOf } from "./common";
import { Staffing, staffingForm, staffingUnder, stepper } from "./firms";
import { incomeTaxLaw, withholding } from "./tax";
import { ownLand } from "./institutions";
import * as P from "./papers";

const YEAR = 365 * DAY;

/** A budget's year in days, as its papers say it: "day 0 to day 364". (Year 1 begins with the town's records.) */
export const yearInDays = (year: number): string => `day ${(year - 1) * 365} to day ${year * 365 - 1}`;

/** The lines of the budget the mayor's office tables, from what it is given for each (a line it is given nothing for
 * is left out, but for parks, which every budget of the town's has). The generator writes the budget a town opens
 * with by the same rule, so the first year's budget is one this office would have tabled. */
export function tabledLines(p: { park_budget: number; road_budget?: number; staff_budget?: number; administration_budget?: number; services_budget?: number; environment_budget?: number }): Record<string, number> {
  return { parks: p.park_budget, ...(p.road_budget ? { roads: p.road_budget } : {}), ...(p.staff_budget ? { staff: p.staff_budget } : {}), ...(p.administration_budget ? { administration: p.administration_budget } : {}), ...(p.services_budget ? { services: p.services_budget } : {}), ...(p.environment_budget ? { environment: p.environment_budget } : {}) };
}

/** A budget's lines in words, as the town writes its money, and their sum. */
export function linesInWords(lines: Record<string, number>, written: (amount: number) => string): string {
  return `${Object.entries(lines).map(([k, v]) => `${k} ${written(v)}`).join(", ")}; ${written(Object.values(lines).reduce((a, v) => a + v, 0))} in all`;
}

/** The town's budget for a year, of those adopted (the latest, if the council adopted more than one for it). */
/** Who voted which way on a ballot of the council, as its result records it: a council's votes are public record. */
export function votedWords(yes: string[], no: string[], none: string[]): string {
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
  return `Voting for: ${list(yes)}; against: ${list(no)}${none.length ? `; not voting: ${list(none)}` : ""}.`;
}

function budgetFor(book: Book, year: number): StatementRecord | undefined {
  return book.open("budget").filter((b) => b.data?.year === year).sort((a, b) => b.at - a.at)[0];
}

/**
 * city.mayor_code: a rule-following mayor, for the all-code control condition
 * (a language model runs the office in AI experiments). Proposes a budget each year;
 * when the budget allows, applies for planning permission for a park and,
 * once granted, commissions the builder; approves the invoices it
 * commissioned (the payments procedure needs the mayor's written approval
 * over a set amount); turns a petition into a proposal once its organiser's
 * published count shows enough people have signed, with probability `responsiveness_bps`. A rejected budget is
 * tabled again every 45 days until one is adopted.
 */
export const mayorCode: BehaviourModule = {
  name: "city.mayor_code",
  answers: {"office": "the mayor's office", "acts": "What it acts on: a petition once its organiser's published count reaches the town's threshold; an invoice for work this office commissioned, which it approves in writing; and each year's budget, which it puts to the council. It gives no direction by letter.", "forms": [{"about": ["direction", "direct ", "staff", "recruit", "hire", "hiring", "crew", "vacanc", "posts"], "say": "If your letter asks for a direction: this office has given none on the matter, and an office needs none to act within its own powers and its budget line."}]},
  issues: P.MAYOR,
  issuesWith: (p) => ({ electoral: p.electoral }),
  version: "0.12.1", // 0.12.1: its answer to a petition carries what is answered, in the paper's words and data, as the form now does; 0.12.0: tables the next year's budget before the year begins (budget_lead_days), and each paper says its lines as the town writes its money; builds by the budget of the year it is in
  doc: "docs/behaviour/government.md",
  cadence: () => 7 * DAY,
  create(ctx: ParticipantContext) {
    const p = params({ responsiveness_bps: 7000, petition_threshold_bps: 1500, population: 200, park_budget: 8_000_000, builder: "", park_type: "park",
      // The rest of the budget's lines (docs/behaviour/services.md): the town's staff, and its services' running costs.
      staff_budget: 0, administration_budget: 0, services_budget: 0, environment_budget: 0,
      // Roads (docs/behaviour/daily-round.md): a year's budget for them, and how far (cells) a building may stand from one
      // before we build toward it, a road a time.
      road_budget: 0, road_type: "road", road_within: 3,
      // How many days before a year begins the office tables that year's budget, so the council can adopt it before the
      // year starts (0: at the year's start, when the year has none).
      budget_lead_days: 0,
      stands_again: true, // false: it doesn't stand at the next election (retiring)
      // Who runs the election for this office: where a nomination is lodged (none: with the town itself).
      electoral: "",
      // Going to look (docs/design/knowing.md, section 8): the channel the office sends someone to a lot through before
      // it relies on what the town's papers say of it (none: the papers are taken as they are), and how many days a
      // sight of a lot is good for.
      visits: "", sight_days: 30,
    }, ctx.params);
    need(p, ["builder"], "city.mayor_code");
    const book = new Book();
    let tabledYear = 0; // the year we last tabled a budget for
    let lastTabled = 0;
    let parkYear = -1;
    const roadsAsked: { at: number; id: string }[] = []; // our applications for roads (the office's record)
    let roadWait = 0;
    // Ground we have sent someone to see: when, and whether anything stood there. And what is to be seen before the
    // next plan relies on it.
    const wentAt = new Map<string, number>();
    const stoodFree = new Map<string, boolean>();
    let toSee: string[] = [];
    const notAsPapered = new Set<string>(); // lots our papers showed free, and going there showed otherwise
    /** A lot of ours as we may rely on it: true (seen free lately), false (seen built on), or undefined (to be gone to:
     * its ground is queued to be seen). Without a way to go and look, the papers are taken as they are. */
    const seenFree = (cells: string[], t: number): boolean | undefined => {
      if (!p.visits) return true;
      const stale = cells.filter((c) => (wentAt.get(c) ?? -Infinity) < t - p.sight_days * DAY);
      if (stale.length) {
        if (!toSee.length) toSee = stale.slice(0, VISIT_MAX);
        return undefined;
      }
      return cells.every((c) => stoodFree.get(c));
    };
    const xy = (cell: string) => { const [, x, y] = cell.split("."); return { x: Number(x), y: Number(y) }; };
    const handled = new Set<string>();
    // The office's own records: made in this position (whoever held it then), or by this participant as itself.
    const ours = (r: { author: string; in_position?: string }) => (ctx.position ? r.in_position === ctx.position : r.author === ctx.participant);
    // What the office has already acted on (the bases of its records), and the last year it applied for a park: read
    // from the record, not kept in memory, so whoever takes office carries on where the office left off.
    const acted = new Set<string>();
    return stepper(
      (obs) => {
        if (p.visits) for (const c of visited(obs, p.visits)) {
          wentAt.set(c.cell, obs.t);
          stoodFree.set(c.cell, !c.structure);
        }
        for (const r of book.absorb(obs)) {
          if (!ours(r)) continue;
          for (const b of basesOf(r)) acted.add(b);
          if (r.record === "statement" && r.kind === "permit_application" && r.data?.structure_type === p.park_type) parkYear = Math.max(parkYear, Math.floor(r.at / YEAR));
          if (r.record === "statement" && r.kind === "permit_application" && r.data?.structure_type === p.road_type) roadsAsked.push({ at: r.at, id: r.id });
        }
      },
      (obs) => {
        const me = obs.entity;
        const t = obs.t;
        const steps: Step[] = [];
        // An election for our office: standing again (once each notice, while nominations are open), on what we've done.
        for (const n of book.open("election_notice")) {
          if (handled.has(n.id) || !p.stands_again || !ctx.position || n.data?.office !== ctx.position || t >= (n.data?.nominations_close_at ?? Infinity)) continue;
          handled.add(n.id);
          const platform = "Standing again: keeping the town's services running, its parks built and its budget balanced.";
          steps.push(because("An election for this office: nominating, as the incumbent.",
            say("nomination", `Nomination for ${ctx.position}: the incumbent. ${platform}`, { to: [p.electoral || me], visible: "public", data: { office: ctx.position, name: "the incumbent mayor", incumbent: true, values: ["security", "benevolence"] }, assertion: { that: platform } })));
        }
        // The annual budget. A year's budget is adopted before the year begins: the office tables the next year's
        // `budget_lead_days` before this year ends. A year that has none adopted (the council rejected it, or the office
        // has just been taken up) has its budget tabled at once. Either is tabled again every 45 days until the council
        // adopts one.
        const thisYear = Math.floor(t / YEAR) + 1;
        const forYear = !budgetFor(book, thisYear) ? thisYear
          : p.budget_lead_days > 0 && thisYear * YEAR - t <= p.budget_lead_days * DAY && !budgetFor(book, thisYear + 1) ? thisYear + 1 : 0;
        if (forYear && (tabledYear !== forYear || t >= lastTabled + 45 * DAY)) {
          const first = tabledYear !== forYear;
          tabledYear = forYear;
          lastTabled = t;
          const lines = tabledLines(p);
          const words = `The town's budget for year ${forYear} (${yearInDays(forYear)}): ${linesInWords(lines, usd)}.`;
          steps.push(because(!first ? `No budget adopted for year ${forYear} yet: tabling it again.` : forYear > thisYear ? `Year ${forYear} begins in ${Math.ceil((thisYear * YEAR - t) / DAY)} days: tabling its budget, for the council to adopt before then.` : "This year has no adopted budget: tabling one.",
            say("proposal", words, { to: [me], data: { enact: { kind: "budget", text: words, data: { year: forYear, lines } }, tags: ["budget"] } })));
        }
        // A park a year, if the year's adopted budget has room and there's a city lot free:
        // apply for planning permission like anyone else, then commission the builder once granted.
        const year = Math.floor(t / YEAR);
        const budget = budgetFor(book, year + 1);
        // The builder's published price for a park (none published: nothing to plan with).
        const price = publishedPrice(book, p.builder, p.park_type) ?? 0;
        if (budget && budget.data?.year === year + 1 && parkYear !== year && price > 0 && price <= (budget.data?.lines?.parks ?? 0)) {
          // A lot of the town's own with nothing on it, by the town's asset register (the first by its number); gone to
          // before we apply, since the register is paper.
          const lot = ownLand(book, me).find((x) => x.structures.length === 0 && x.cells.length > 0 && !notAsPapered.has(x.lot));
          const free = lot ? seenFree(lot.cells, t) : undefined;
          if (lot && free === false) notAsPapered.add(lot.lot);
          if (lot && free) {
            parkYear = year;
            // The planning office's published form, like anyone else.
            steps.push(because(`The adopted budget has ${usd(budget.data?.lines?.parks ?? 0)} for parks and ${lot.lot} is free (our asset register says so, and we have been to see): applying for a permit for a park, as anyone would.`, C.call("form", { to: me, form: "permit_application", lot: lot.lot, structure_type: p.park_type })));
          }
        }
        // Roads: a building we know of further than `road_within` cells from any of the town's roads, and room in the
        // year's roads budget: a road on the town's free lot beside the network that comes nearest it (one at a time,
        // permit first, as anyone). The buildings we know of are the town's own and those we have had notice of being
        // built; the roads are the town's assets; where each is, its address says.
        const roadPrice = p.road_budget ? publishedPrice(book, p.builder, p.road_type) ?? 0 : 0;
        const roadsThisYear = roadsAsked.filter((r) => Math.floor(r.at / YEAR) === year).length;
        const pending = roadsAsked.some((r) => !book.open("permit_decision").some((d) => d.data?.application === r.id) && t - r.at < 30 * DAY);
        if (budget && budget.data?.year === year + 1 && roadPrice > 0 && !pending && t >= roadWait && (roadsThisYear + 1) * roadPrice <= (budget.data?.lines?.roads ?? 0)) {
          const land = ownLand(book, me);
          const roads = land.filter((x) => x.structures.some((st) => st.type === p.road_type)).flatMap((x) => x.cells.map(xy));
          const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
          const known = new Map<string, { x: number; y: number }>();
          for (const x of land) for (const st of x.structures) if (st.type !== p.road_type && x.cells[0]) known.set(st.structure, xy(x.cells[0]));
          for (const n of book.open("building_notice")) if (typeof n.data?.structure === "string" && typeof n.data?.at === "string" && n.data?.structure_type !== p.road_type) known.set(n.data.structure, xy(n.data.at));
          for (const n of book.open("building_notice")) if (typeof n.data?.removes === "string") known.delete(n.data.removes);
          const far = roads.length ? [...known].filter(([, c]) => Math.min(...roads.map((r) => dist(r, c))) > p.road_within).sort(([a], [b]) => (a < b ? -1 : 1))[0] : undefined;
          if (far) {
            const nextTo = (c: { x: number; y: number }) => roads.some((r) => dist(r, c) === 1);
            const site = land.filter((x) => x.structures.length === 0 && x.cells.length === 1 && !notAsPapered.has(x.lot) && nextTo(xy(x.cells[0]!))).map((x) => ({ lot: x.lot, cell: x.cells[0]!, c: xy(x.cells[0]!) }))
              .sort((a, b) => dist(a.c, far[1]) - dist(b.c, far[1]) || (a.lot < b.lot ? -1 : 1))[0];
            if (site && dist(site.c, far[1]) < Math.min(...roads.map((r) => dist(r, far[1])))) {
              const free = seenFree([site.cell], t);
              if (free === false) notAsPapered.add(site.lot);
              if (free) {
                roadWait = t + 7 * DAY; // (until our application is on the record)
                steps.push(because(`${far[0]} is ${Math.min(...roads.map((r) => dist(r, far[1])))} cells from the nearest road (we build toward anything further than ${p.road_within}), and the roads budget has room: applying for a permit for a road on ${site.lot}, toward it.`,
                  C.call("form", { to: me, form: "permit_application", lot: site.lot, structure_type: p.road_type })));
              }
            }
          }
        }
        for (const d of book.open("permit_decision")) {
          if (handled.has(d.id) || acted.has(d.id) || !(d.addressed_to ?? []).includes(me)) continue;
          const app = book.records.get(d.data?.application);
          if (app?.record !== "statement" || !ours(app)) continue;
          handled.add(d.id);
          if (d.data?.decision !== "granted") continue;
          const site = app.data?.lot;
          const from = ownAccount(obs)?.account;
          const type = app.data?.structure_type === p.road_type ? p.road_type : p.park_type;
          const cost = type === p.road_type ? roadPrice : price;
          if (!cost) continue;
          steps.push(because(`The ${type}'s permit was granted: commissioning the builder.`, [type, C.call("structure", { type, on: site, by: p.builder, price: C.amountText(cost), from, basis: d.id })]));
        }
        // Approve invoices for work we commissioned (the payments procedure requires it over a set amount).
        for (const inv of book.open("invoice")) {
          if (handled.has(inv.id) || acted.has(inv.id) || !(inv.addressed_to ?? []).includes(me)) continue;
          handled.add(inv.id);
          const ag = basesOf(inv).map((b) => book.records.get(b)).find((x) => x?.record === "agreement" && ours(x));
          if (ag) {
            steps.push(because("An invoice for work we commissioned: approving it in writing, as the payments procedure requires.", say("approval", `Approved: pay invoice ${inv.id}.`, { to: [me], basis: inv.id, data: { invoice: inv.id } })));
          }
        }
        // Petitions with enough signatures become proposals (sometimes).
        for (const pet of book.open("petition")) {
          if (handled.has(pet.id) || acted.has(pet.id)) continue;
          if (publishedCount(book, pet) * 10_000 < p.petition_threshold_bps * p.population) continue;
          handled.add(pet.id);
          if (ctx.rng(`respond-${pet.id}`).below(10_000) >= p.responsiveness_bps) continue;
          const d = pet.data?.demand ?? {};
          // What it asks that a law's amendment form can express (the demand names the law's schedule and the figures
          // it wants): answered on that form, where acts can then be checked against it. What no form covers isn't put,
          // and the petition's organiser is told.
          const form = d.amend?.schedule ? book.open("form").find((f) => f.speaks_for === me && f.data?.amends === d.amend.schedule) : undefined;
          const asked = Object.entries((d.amend?.figures ?? {}) as { [k: string]: number }).filter(([k, v]) => form?.data?.fields?.[k] && Number.isSafeInteger(v));
          if (form && asked.length) {
            const law = book.open("law").filter((l) => l.speaks_for === me && l.data?.schedule === d.amend.schedule).sort((a, b) => a.at - b.at).at(-1);
            // (The paper is the petition's answer in full, as its form writes it: "Answer to petition X: ..." and the words again as data.answer.)
            const answer = (words: string) => say("petition_response", `Answer to petition ${pet.id}: ${words}`, { to: pet.speaks_for ? [pet.speaks_for] : undefined, visible: "public", basis: pet.id, data: { petition: pet.id, answer: words } });
            if (law && asked.every(([k, v]) => law.data?.figures?.[k]?.value === v)) {
              steps.push(because("A petition asking for what the law in force already says: answering so.", answer(`the law in force (${law.id}) already says what it asks.`)));
              continue;
            }
            // (The form's fields take a duration as such, and a count in the field's own unit.)
            const fields = Object.fromEntries(asked.map(([k, v]) => [k, form.data.fields[k].type === "duration" ? C.secs(v) : C.text(String(v / (form.data.fields[k].per_unit ?? 1)))]));
            const affects = (d.tags ?? []).includes("tenant_protection") ? "tenants" : (d.tags ?? []).includes("development") ? "development" : "neither";
            steps.push(because(`A petition passed ${p.petition_threshold_bps / 100}% of the town: putting what it asks that the ${String(form.data.form).replace(/_/g, " ")} form covers (${asked.map(([k]) => k).join(", ")}) to the council on that form (we respond to ${p.responsiveness_bps / 100}% of such petitions).`,
              C.call("form", { to: me, form: form.data.form, ...fields, affects }),
              answer(`what it asks that the law in force covers (${asked.map(([k]) => k.replace(/_/g, " ")).join(", ")}) has been put to the council as an amendment of that law. The rest of what it asks hasn't been put.`)));
            continue;
          }
          steps.push(because(`A petition passed ${p.petition_threshold_bps / 100}% of the town: putting its demand to the council (we respond to ${p.responsiveness_bps / 100}% of such petitions).`, say("proposal", `Proposal (from petition ${pet.id}): ${d.text}`, { to: [me], basis: pet.id,
            data: { enact: { kind: "law", text: d.text, ...(d.adico ? { adico: d.adico } : {}), ...(d.formal ? { formal: d.formal } : {}) }, tags: d.tags ?? [] } })));
        }
        return steps;
      },
      undefined,
      // Ground the plan needs seen before it relies on it: someone is sent (it takes the office's time), and the plan
      // is made again when they are back.
      () => {
        if (!p.visits || !toSee.length) return [];
        const go = toSee;
        toSee = [];
        return [goSee(p.visits, go)];
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
 *
 * It is also the council's drafter. A law made from figures has a schedule (a record of the town's: how the law's
 * words, its breakdown and its rule are written from its figures) and a form for amending it, whose fields are the
 * figures. A proposal on such a form that passes is written into law by the schedule, with the figures given and the
 * rest as they stood; the clerk publishes it in place of the law in force, which it withdraws. So an amended law is
 * read by everyone exactly as the law it replaces was. A law proposed in free words stands as its words, and the
 * result says so. The clerk knows no particular law: schedules and forms are the world's content.
 */
export const councilClerk: BehaviourModule = {
  name: "city.council_clerk",
  answers: {"office": "the council clerk's office", "acts": "What it acts on: a proposal put to the council on the council proposal form (council_proposal) or on a law's amendment form, which it puts to a ballot of the councillors; and the votes cast in a councillor's post while a ballot is open.", "forms": [{"about": ["propos", "motion", "amend", "resolution", "put to the council", "put to council"], "say": "What you want the council to decide goes on the council proposal form (council_proposal); a change to a figure in a law in force goes on that law's amendment form."}], "report": true},
  issues: P.COUNCIL_CLERK,
  routines: [{ task: "enact", at: "office", every: 1, what: "When the council has passed a proposal made on a law's amendment form and the clerk has declared the result, the office's drafters write the amended law out by the law's own schedule, with the figures the proposal gives and the rest as they stand, publish it in place of the law in force, and withdraw that one. Declaring a result does not by itself change a law: this does. A law proposed in free words, or a budget, is not theirs: the clerk publishes that." }],
  version: "0.11.1", // 0.11.1: its drafters, with no standing order for enact, say what waits to be written into law; 0.11.0: where a seat holds the office, its drafters are a staff post that writes a passed amendment into the law under the standing order for enact, and the office-holder declares the result without it; 0.10.0: a result names who voted for and against; a vote on a closed ballot, or by someone who is no councillor, is not counted and its caster is told; 0.9.1: amends a law of optional figures (one added, one taken away by nought, a law made from one figure); 0.9.0: a proposal already balloted and a ballot already declared, by the office's own papers, are not put or counted again; a budget is for the year its proposal names
  doc: "docs/behaviour/government.md",
  cadence: () => DAY,
  create(ctx: ParticipantContext) {
    const p = params({ vote_days: 14,
      who: "", // its channel onto who's who, where it looks up its council's members ("": it knows them as it is shown them)
      members_role: "councillor", members_every_days: 30,
      // The body that runs elections to the town's offices, where it is not the town's own: the clerk seats whoever
      // it declares elected (none: whoever runs the election seats the winner).
      electoral: "",
      // Which part of the office this is (docs/behaviour/standing-work.md): "" the whole office, as code runs one;
      // "seat" the clerk alone, who runs the ballots and declares the results; "staff" the office's drafters, who
      // write a passed amendment into the law it amends, under the standing order for enact.
      part: "" as "" | "seat" | "staff", office: "" }, ctx.params);
    const book = new Book();
    const routines = new StandingWork(ctx.entity, p.part);
    const enactedFor = new Set<string>();
    let reportDay = -1;
    const seated = new Set<string>();
    const balloted = new Set<string>();
    const closed = new Set<string>();
    const letters = new Letters(councilClerk.answers);
    let membersAsked = -Infinity;
    let votesRead = 0; // how many of the votes it has been shown it has looked at (for those that do not count)
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
        // (As the clerk last looked them up: its own council's list of members, below.)
        const councillors = new Set((channels.directory(obs)?.positions ?? []).filter((x) => x.role === "councillor" && x.entity === me).map((x) => x.position));
        // The office's drafters (the staff part): each amendment the council has passed and the clerk has declared is
        // written into the law, once, while the standing order for it is in force; and they report how it stands.
        if (p.part === "staff") {
          const working = routines.does(book, "enact", t, { every: DAY });
          let waiting = 0;
          for (const r of book.open("ballot_result")) {
            if (r.speaks_for !== me || r.data?.passed !== true || typeof r.data?.ballot !== "string" || enactedFor.has(r.data.ballot)) continue;
            const ballot = book.records.get(r.data.ballot) as StatementRecord | undefined;
            const am = amendment(book, me, ballot ? (book.records.get(ballot.data?.proposal) as StatementRecord | undefined) : undefined);
            if (!ballot || !am) continue;
            // (Written into law already, by the office's own record: a law that rests on the ballot.)
            if (book.all("law").some((l) => l.speaks_for === me && cites(l, ballot.id))) { enactedFor.add(ballot.id); continue; }
            if (!working) { waiting++; continue; }
            enactedFor.add(ballot.id);
            const made = enactAmendment(am, ballot.id);
            if (made.calls.length) {
              routines.did("enact", t, { units: 1 });
              steps.push(because(`The council passed an amendment on ${ballot.id} and its result is declared (${r.id}): writing it into the law by the law's schedule.`, ...made.calls));
            } else routines.heldUp("enact", `the amendment passed on ${ballot.id} could not be written into law:${made.note}`);
          }
          if (working) routines.note("enact", waiting ? undefined : "no amendment the council has passed is waiting to be written into law");
          // (With no order for it: what is waiting, for the report that says the work is not being done.)
          else routines.note("enact", waiting ? `${waiting} amendment${waiting === 1 ? "" : "s"} the council has passed and the clerk has declared ${waiting === 1 ? "waits" : "wait"} to be written into law` : undefined);
          if (reportDay !== Math.floor(t / DAY)) {
            reportDay = Math.floor(t / DAY);
            steps.push(...routines.report(book, t, { office: (ctx.position ?? "").replace(/-staff$/, ""), from: "the clerk's drafters", tasks: { enact: ["amendments written into law"] } }));
          }
          return steps;
        }
        steps.push(...routines.set(book, [{ task: "enact", at: p.office || ctx.position || "office", every: DAY, why: "Setting the drafters' work: an amendment the council has passed is written into the law it amends, as a standing work order." }]));
        // An election declared by the electoral body: whoever it declares elected takes the office (the town's own act:
        // an office of the town is filled by the town).
        if (p.electoral) for (const r of book.open("ballot_result")) {
          if (seated.has(r.id) || r.speaks_for !== p.electoral || typeof r.data?.office !== "string" || typeof r.data?.winner !== "string") continue;
          seated.add(r.id);
          steps.push(because(`The electoral body has declared ${r.data.winner} elected to ${r.data.office}: seating them.`, C.call("position", { appoint: r.data.office, to: r.data.winner })));
        }
        for (const prop of book.open("proposal")) {
          if (balloted.has(prop.id) || !(prop.addressed_to ?? []).includes(me)) continue;
          balloted.add(prop.id);
          // (Already put to the council, by the office's own record: whoever keeps this office carries on from its
          // papers, and a proposal balloted before is not balloted again.)
          if (book.open("ballot").some((b) => b.speaks_for === me && b.data?.proposal === prop.id)) continue;
          // A proposal on a law's amendment form: put to the council as what it would change (and not at all, if nothing).
          const am = amendment(book, me, prop);
          if (am && !Object.keys(am.given).length) {
            steps.push(because("A proposal on an amendment form that names no figure to change: not put to a ballot, and saying so.",
              message([prop.author], `Your proposal ${prop.id} to amend ${am.s.title} names no figure to change, so it hasn't been put to a ballot. The figures that can be changed: ${Object.entries(am.s.figures).map(([k, f]) => `${k} (${f.label ?? k}${am.law ? `, now ${figureWords(f, am.law.data?.figures?.[k]?.value)}` : ""})`).join("; ")}.`, prop.id)));
            continue;
          }
          steps.push(because("A proposal addressed to the council: opening a ballot.", say("ballot", `Council ballot: ${am ? `to amend ${am.s.title}${am.law ? ` (${am.law.id})` : ""}: ${changes(am)}.` : prop.text}`, { basis: prop.id, data: { proposal: prop.id, options: ["yes", "no"], closes_at: t + p.vote_days * DAY, electorate: "council", tags: prop.data?.tags ?? formTags(prop) } })));
        }
        for (const ballot of book.open("ballot")) {
          // (Our council's ballots only: an election's ballot speaks for the town too, and is the electoral office's.)
          if (closed.has(ballot.id) || ballot.speaks_for !== me || ballot.data?.electorate !== "council" || (ballot.data?.closed !== true && t < (ballot.data?.closes_at ?? Infinity))) continue;
          closed.add(ballot.id);
          // (Counted and declared already, by the office's own record: its result stands.)
          if (book.open("ballot_result").some((r) => r.speaks_for === me && r.data?.ballot === ballot.id)) continue;
          const latest = new Map<string, string>();
          // (Votes made while the ballot was open: one made at or after its closing time isn't counted, however late we
          // come to count. Until 0.6.1 it was, if it reached us before we did.)
          for (const r of book.ofType("vote")) if (r.ballot === ballot.id && r.in_position && councillors.has(r.in_position) && r.at < ballot.data.closes_at) latest.set(r.in_position, r.choice);
          const votedFor = [...latest].filter(([, c]) => c === "yes").map(([who]) => who).sort(), votedAgainst = [...latest].filter(([, c]) => c === "no").map(([who]) => who).sort();
          const yes = votedFor.length, no = votedAgainst.length;
          // (A council's votes are public record: the result names who voted which way, and who did not vote.)
          const voted = votedWords(votedFor, votedAgainst, [...councillors].filter((c) => !votedFor.includes(c) && !votedAgainst.includes(c)).sort());
          const passed = yes > no && yes * 2 > councillors.size;
          const prop = book.records.get(ballot.data?.proposal) as StatementRecord | undefined;
          const am = amendment(book, me, prop);
          const enact = am ? undefined : prop?.data?.enact ?? fromForm(prop, t);
          const enacted: C.Call[] = [];
          let note = ""; // what the result says became of it, in the town's terms
          if (passed && am && p.part === "seat") {
            // (The office-holder declares; its drafters write the law, under the standing order for enact.)
            note = ` ${am.s.title[0]!.toUpperCase()}${am.s.title.slice(1)} is to be amended: ${changes(am)}. The office's drafters write the amended law out and publish it in place of the law in force.`;
          } else if (passed && am) {
            const made = enactAmendment(am, ballot.id);
            enacted.push(...made.calls);
            note = made.note;
          } else if (passed && enact) {
            enacted.push(say(enact.kind, enact.text, { basis: ballot.id, adico: enact.adico, formal: enact.formal?.condition, data: enact.data }));
            // A law in free words: say plainly what kind of law the council has passed, and where figures are changed.
            if (enact.kind === "law" && !enact.formal?.condition) note = ` ${WORDS_ONLY}${amendable(book, me)}`;
          }
          steps.push(because(`The ballot closed: counting the councillors' latest votes (${passed ? "a majority for" : "no majority for"}).`,
            say("ballot_result", `${passed ? "Passed" : "Rejected"}: ${yes} for, ${no} against.${note} ${voted}`, { basis: ballot.id, data: { ballot: ballot.id, yes, no, passed, voted_for: votedFor, voted_against: votedAgainst } }), ...enacted));
        }
        // Votes that do not count, each answered once (the clerk keeps the ballot, and says what it has done with a
        // vote): one cast on a ballot that is closed (its closing time has passed, or its result is declared), and
        // one cast by someone who is not in a councillor's post. Nothing stops such a vote being written; it is the
        // clerk who does not count it. (Not until it knows its council's members.)
        const votes = book.ofType("vote");
        if (councillors.size) {
          for (const v of votes.slice(votesRead)) {
            if (v.author === "genesis" || v.author === ctx.participant) continue;
            const b = book.records.get(v.ballot);
            if (b?.record !== "statement" || b.kind !== "ballot" || b.speaks_for !== me || b.data?.electorate !== "council") continue;
            const result = book.open("ballot_result").find((r) => r.speaks_for === me && r.data?.ballot === b.id);
            const late = b.data?.closed === true || v.at >= (b.data?.closes_at ?? Infinity) || (!!result && result.at <= v.at);
            const member = !!v.in_position && councillors.has(v.in_position);
            if (!late && member) continue;
            const declared = result ? ` Its result is declared (${result.id}: ${result.data?.passed ? "passed" : "rejected"}, ${result.data?.yes} for, ${result.data?.no} against).` : "";
            steps.push(because(late ? `A vote on ${b.id}, which is closed: not counted, and saying so.` : `A vote on ${b.id} by someone who is not a councillor: not counted, and saying so.`,
              message([v.author], late
                ? `From the council clerk: your vote on ${b.id} is not counted. ${b.data?.closed === true ? "That ballot was held and closed before the year began." : `That ballot closed on ${dateWords(b.data?.closes_at)}.`}${declared} A vote counts only when it is cast in a councillor's post while the ballot is open.`
                : `From the council clerk: your vote on ${b.id} is not counted. The council's ballots are voted on by its councillors, each in their own post.`, v.id)));
          }
          votesRead = votes.length;
        }
        steps.push(...letters.answer(() => {
          const waiting = book.open("proposal").filter((x) => (x.addressed_to ?? []).includes(me) && !balloted.has(x.id));
          const open = book.open("ballot").filter((b) => b.speaks_for === me && b.data?.electorate === "council" && !closed.has(b.id));
          const results = book.open("ballot_result").slice(-3);
          const year = Math.floor(t / YEAR) + 1;
          const budget = budgetFor(book, year), next = budgetFor(book, year + 1);
          return "Report from the council clerk: " +
            (open.length ? `ballots open: ${open.map((b) => `${b.id} on ${b.data?.proposal}, closing ${dateWords(b.data?.closes_at)}`).join("; ")}. ` : "no ballots are open. ") +
            (waiting.length ? `Proposals waiting for a ballot: ${waiting.map((x) => x.id).join(", ")}. ` : "") +
            (results.length ? `Recent results (each ballot is closed): ${results.map((r) => `${r.data?.ballot}: ${r.data?.passed ? "passed" : "rejected"} ${r.data?.yes}-${r.data?.no}${Array.isArray(r.data?.voted_for) ? ` (for: ${r.data.voted_for.join(", ") || "none"}; against: ${(r.data?.voted_against ?? []).join(", ") || "none"})` : ""}`).join("; ")}. ` : "") +
            (budget ? `The council adopted a budget for year ${year} (${budget.id}). ` : `No budget is adopted for year ${year}. `) +
            `Year ${year} is ${yearInDays(year)}; ${next ? `the council has adopted a budget for year ${year + 1} (${next.id}). ` : `no budget is adopted yet for year ${year + 1}, which the council adopts before it begins. `}` +
            `Anyone may put a proposal to the council on the council proposal form (form-council-proposal); I put it to a ballot of the councillors, open for ${p.vote_days} days. A vote counts when it is cast in a councillor's post while the ballot is open; the result names who voted which way. ` +
            `A law proposed on that form stands as its words: no rule is set down with it for acts to be checked against.${amendable(book, me, true)}`;
        }));
        return steps;
      },
      undefined,
      // Its council's members: the holders of the town's councillor posts, looked up (nobody is shown who's who), at
      // its first wake and again every so often, as a council's own list of members is kept up.
      (obs) => {
        if (!p.who || obs.t - membersAsked < p.members_every_days * DAY) return [];
        membersAsked = obs.t;
        return [lookUp.holders(p.who, obs.entity!, p.members_role)];
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
  answers: {"office": "a councillor", "acts": "A councillor acts by voting on the council's open ballots, and a letter does not change a vote. What you want the council to decide goes to the council clerk on the council proposal form (council_proposal).", "report": true},
  version: "0.6.0", // 0.6.0: moves a motion of their own where given one (`motion`: none by default), on the council proposal form; 0.5.2: leaves alone a ballot that says it is closed
  doc: "docs/behaviour/government.md",
  cadence: () => 3 * DAY,
  create(ctx: ParticipantContext) {
    const p = params({ leaning: 0, noise_bps: 1500, budget_yes_bps: 9000,
      // A motion this councillor moves of their own, where a town's description gives them one (none: they only
      // vote): what is proposed, its kind (law, budget, other), whom it bears on (tenants, development, neither), and
      // the day they move it. Content of a town or a scenario; nothing here holds one.
      motion: undefined as undefined | { proposal: string; kind?: string; affects?: string; on_day?: number } }, ctx.params);
    const book = new Book();
    let moved = false;
    const voted = new Set<string>();
    const cast: string[] = []; // "ballot: yes|no", for its answer to letters
    const letters = new Letters(councillor.answers);
    const place = (tags: string[]) => (tags.includes("tenant_protection") ? 60 : 0) - (tags.includes("development") ? 60 : 0);
    return stepper(
      (obs) => {
        book.absorb(obs);
        letters.take(obs, book);
      },
      (obs) => {
        const steps: Step[] = [];
        // Their own motion, once: on the council proposal form, as the standing orders say a councillor puts one
        // (only a councillor who has the form on file can: the proposal is the form filled in).
        if (p.motion && !moved && obs.t >= (p.motion.on_day ?? 0) * DAY && obs.entity) {
          const form = book.open("form").find((f) => f.speaks_for === obs.entity && f.data?.form === "council_proposal");
          if (form) {
            moved = true;
            steps.push(because("A motion of our own: putting it to the council on the council proposal form.",
              C.call("form", { to: obs.entity, form: "council_proposal", proposal: C.text(p.motion.proposal), kind: p.motion.kind ?? "other", ...(p.motion.affects ? { affects: p.motion.affects } : {}) })));
          }
        }
        for (const b of book.open("ballot")) {
          if (voted.has(b.id) || b.data?.electorate !== "council" || b.data?.closed === true || obs.t >= (b.data?.closes_at ?? 0)) continue;
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
  issues: P.FINANCE,
  answers: {"office": "the finance office", "acts": "What it acts on: an invoice addressed to the town, paid within the adopted budget (over the payments procedure's figure, once the mayor's written approval is on file); a payroll notice from an office that has taken someone on or is losing someone; and the tax withheld from wages, paid over each month. It does not start, stop or change a payment on a letter.", "forms": [{"about": ["approv"], "say": "An approval of an invoice is the mayor's to give, in writing, naming the invoice."}], "report": true},
  version: "0.10.1", // 0.10.1: returns of tax withheld are filed on the days the law states (docs/behaviour/firms.md, "Returns on the law's days"); 0.10.0: 0.10.0: sets a new starter's wage up on the hiring office's payroll notice, from the first pay day it gives (with none after payroll_wait_days, from the agreement on file); asks the mayor, once, for the written approval an invoice over the procedure's figure needs. 0.9.0: pays within the adopted budget of the year it is in; while the year has none, under the budget last adopted at a twelfth a month (the charter's interim rule); spending is reckoned by the year
  doc: "docs/behaviour/government.md",
  cadence: () => 3 * DAY,
  create(ctx: ParticipantContext) {
    const p = params({ compliance_bps: 10_000, budget_lines: {} as Record<string, string>, period: 14 * DAY, notice_days: 14,
      procedure: "", // the record its approval rule comes from (who approves a payment over what sum: its `data.approval`); withdrawn, or none, and no approval is asked
      payroll_wait_days: 3, // how long it waits for the hiring office's notice of a new starter before setting the wage up from the agreement on file
      // The line of the adopted budget an invoice is drawn on, where the office's brief says which line pays for what
      // (docs/behaviour/government.md, "Payments carry their budget line"): by the kind of building the invoice is for, and by
      // the position that issued it. An invoice the brief does not place is paid with no line, and is shown as unallocated.
      lines_by_structure: {} as Record<string, string>, lines_by_position: {} as Record<string, string>,
    }, ctx.params);
    const book = new Book();
    const paid = new Set<string>();
    let spent = 0;
    let budgetYear = -1;
    // The town's payroll (docs/behaviour/services.md): wages for those the town employs (its works office hires them),
    // net of the income tax withheld, which is paid over monthly. They count against the adopted budget.
    const payroll = new Staffing(ctx, ctx.entity, { period: p.period, notice_days: p.notice_days, role: "staff", does: { hire: false, pay: true }, notice_wait: p.payroll_wait_days * DAY, wakes: 3 * DAY });
    const approvalAsked = new Set<string>(); // invoices it has asked the mayor to approve
    let wagesAtYear = 0;
    const letters = new Letters(financeOfficer.answers);
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
        // The year's adopted budget. While the year has none, the charter's interim rule: the office goes on paying under
        // the budget last adopted, at no more each month than a twelfth of it (so wages and standing charges go on, and
        // little else fits). Spending is reckoned by the year, so what is paid in the interim counts against the year's
        // budget once the council adopts it.
        const year = Math.floor(obs.t / YEAR) + 1;
        const adopted = budgetFor(book, year);
        const last = adopted ?? book.open("budget").filter((b) => typeof b.data?.year === "number" && b.data.year < year).sort((a, b) => b.data.year - a.data.year || b.at - a.at)[0];
        const budget = adopted ?? last;
        if (year !== budgetYear) {
          budgetYear = year;
          spent = 0;
          wagesAtYear = payroll.wagesPaid;
        }
        steps.push(...payroll.routine(obs, book, acc.account, { target: 0, wage: 0, canPost: false }));
        const wages = () => payroll.wagesPaid - wagesAtYear;
        const total = budget ? Object.values(budget.data?.lines ?? {}).reduce((s: number, v: any) => s + (v as number), 0) : 0;
        const months = Math.min(12, Math.floor(((obs.t - (year - 1) * YEAR) * 12) / YEAR) + 1); // months of the year begun
        const limit = adopted ? total : Math.floor((total * months) / 12);
        // (The line the office's brief puts an invoice on: by the kind of building it is for, or by who issued it.)
        const lineOf = (inv: StatementRecord): string | undefined => {
          const byKind = typeof inv.data?.type === "string" ? p.lines_by_structure[inv.data.type] : undefined;
          return byKind ?? (inv.in_position ? p.lines_by_position[inv.in_position] : undefined);
        };
        for (const inv of book.open("invoice").sort((a, b) => (a.id < b.id ? -1 : 1))) {
          if (paid.has(inv.id) || !(inv.addressed_to ?? []).includes(me)) continue;
          const owed = inv.data?.outcome?.money;
          const amount = cents(owed?.amount);
          // Approved in writing by the post the payments procedure names, whoever holds it. (The approval rule is the procedure's,
          // foundations F8: its post and its sum are in the record, not in this module; once it is withdrawn, with nothing in its
          // place, or where it states none, no approval is asked. Paying within the adopted budget is the charter's, and stays.)
          const rule = approvalOf(book, p.procedure);
          const approved = !!rule && book.open("approval").some((a) => a.data?.invoice === inv.id && a.in_position === rule.by);
          const withinProcedure = spent + wages() + amount <= limit && (!rule || amount <= rule.over || approved);
          const follows = ctx.rng(`procedure-${inv.id}`).below(10_000) < p.compliance_bps;
          if (!withinProcedure && follows) {
            // Within the budget and over the procedure's figure, with no approval on file: the mayor is asked for one,
            // once (nobody else tells the mayor that a payment is waiting on it).
            if (rule && amount > rule.over && !approved && spent + wages() + amount <= limit && !approvalAsked.has(inv.id)) {
              approvalAsked.add(inv.id);
              steps.push(because(`Invoice ${inv.id} is over the payments procedure's figure and has no written approval on file: asking the mayor for one.`,
                message([rule!.by], `From the finance office: your written approval is needed for invoice ${inv.id} (${usd(amount)}, payable to ${owed.to}): it is within the budget and over ${usd(rule!.over)}, and the payments procedure asks for the mayor's approval of such a payment. It will be paid once an approval of it is on the town's file.`, inv.id)));
            }
            continue; // wait (approval may come), or never (over budget)
          }
          if (acc.balance < amount) continue;
          paid.add(inv.id);
          spent += amount;
          steps.push(because(!withinProcedure ? "Paying an invoice outside the procedure." : adopted ? "Paying an invoice within the adopted budget (with the mayor's approval where needed)." : `Year ${year} has no adopted budget yet: paying an invoice within a twelfth a month of the budget last adopted, as the charter allows (with the mayor's approval where needed).`,
            pay(owed.to, amount, { from: acc.account, for: `Paying invoice ${inv.id}.`, settles: inv.id, ...(lineOf(inv) ? { line: lineOf(inv)! } : {}) })));
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
          const twelveMonths = since(365);
          const history = flows.length
            ? `In the last 30 days the account received ${usd(sum(month, 1))}${top ? ` (largest: ${top})` : ""} and paid out ${usd(sum(month, -1))}. ` +
              `Over the last ${days} days it received ${usd(sum(twelveMonths, 1))} and paid out ${usd(sum(twelveMonths, -1))}: at that rate, about ${usd(Math.round((sum(twelveMonths, 1) * 30) / days))} a month in and ${usd(Math.round((sum(twelveMonths, -1) * 30) / days))} out. `
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
            (adopted ? `The adopted budget (${adopted.id}, year ${year}, ${yearInDays(year)}): ${lines}; spent under it so far ${usd(spent + wages())} (${usd(wages())} of it the town's wages). `
              : last ? `No budget is adopted for year ${year} (${yearInDays(year)}) yet. Until the council adopts one we pay what the town is already bound to pay under the budget last adopted (${last.id}, year ${last.data?.year}: ${lines}), at no more each month than a twelfth of it, as the charter allows: ${usd(limit)} so far this year, of which ${usd(spent + wages())} is spent (${usd(wages())} of it the town's wages). `
              : `No budget has been adopted for year ${year}, and none before it. `) +
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
  version: "0.4.2",
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
        // The law in force (itself, or what has replaced it). Withdrawn with nothing in its place: no tax is assessed,
        // and no new penalty recorded.
        const law = book.current(p.law);
        const repealed = book.repealed(p.law);
        const rate: number = law?.record === "statement" ? law.data?.rate_bps ?? 1000 : 1000;
        const penalty: number = law?.record === "statement" ? law.data?.penalty_bps ?? 2000 : 2000;
        for (const rep of book.open("tax_report")) {
          if (repealed) break;
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
          if (repealed || a.chased || t - a.at < p.grace_days * DAY) continue;
          if ((received.get(a.account) ?? 0) >= upTo) continue;
          a.chased = true;
          const fine = Math.floor((a.amount * penalty) / 10_000);
          steps.push(because(`Tax still unpaid after ${p.grace_days} days: recording the law's penalty (${penalty / 100}%) and writing to the payer.`,
            record("right", me, { kind: "tax_penalty", amount: fine }, { against: a.payer, basis: id }),
            message([a.payer], `Tax of ${moneyNow(a.amount)} on report ${id} is overdue; a penalty of ${moneyNow(fine)} has been recorded.`, id),
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
 * property, it reckons a year's rates at the law's rate on its value, and every instalment period sends each owner a
 * notice for their share, recording it as the town's claim against them (payable into the town's account, by the due
 * date). What's still unpaid after the due date draws the law's penalty interest, monthly, recorded as a claim too,
 * with a letter. A payment settles a claim when it names it.
 */
export const ratesOfficer: BehaviourModule = {
  name: "city.rates_officer",
  answers: {"office": "the rates office", "acts": "What it acts on: the valuer's valuations, on which it levies under the rating law; a payment that names the rates it pays; and a direction on its recovery form (rates_recovery) from those the town's rule on directions names.", "report": true},
  routines: [{ task: "levy", at: "office", follows: ["law", "law-rates"], what: "At each instalment the rating law sets, the rates clerks send every owner on the rate book a notice of their share and record it as owed to the town; each month they add the law's penalty interest to what is overdue and write to the owner. When the notices go out is the law's: the first once the valuer has valued the town's properties and not before the office's first levy day, then one for each instalment the law sets, evenly through the year (two instalments a year are 182 days apart, four are 91). The order says only that they are to be sent." }],
  keeps: [
    { what: "valuation", why: "The rating authority keeps the rate book: the valuer sends it the valuation of every rateable lot, which is what it levies on." },
  ],
  takes: [{ form: "rates_recovery", title: "Recovery direction to the rates officer",
    fields: { interest: { type: "choice", options: ["yes", "no"], required: true, description: "Whether rates left unpaid after their due date are charged the law's penalty interest: yes, as the office does of its own accord; no, none is added." } },
    follows: "While a direction with interest no stands, the rates officer adds no penalty interest to overdue rates and writes to nobody about them. The rates themselves are still levied and still owed, and interest already recorded stays on record." }],
  version: "0.4.3", // 0.4.3: when the last notices went out, and the interest charged on each claim, are read from the office's own file, so a new holder carries on (bug hunt 2026-10-17); 0.4.2: a direction on its recovery form reaches its staff's post; 0.4.1: a payment that names the rates notice pays the claim recorded with it; 0.4.0: its clerks report to the rates officer the notices sent under the standing order and when the next go out; 0.3.0: takes a written direction on penalty interest (docs/behaviour/directions.md)
  doc: "docs/behaviour/public-finance.md",
  cadence: () => DAY,
  create(ctx: ParticipantContext) {
    const p = params({ law: "law-rates", first_day: 30,
      // Whose written directions it follows (docs/behaviour/directions.md): the town's own rule, a record the world
      // names (none: it follows nobody's); and how often it follows one it is given.
      directed_under: "", direction_compliance_bps: 10_000,
      // Which part of the office this is (docs/behaviour/standing-work.md): "" the whole office, as code runs one;
      // "seat" the rates officer alone, who sets the standing work order; "staff" the rates clerks, who follow it.
      part: "" as "" | "seat" | "staff",
      office: "", // where its clerks work, as a standing order names it (none given: the office itself)
    }, ctx.params);
    const book = new Book();
    const letters = new Letters(ratesOfficer.answers);
    const directions = new Directions(ctx, { under: p.directed_under, compliance_bps: p.direction_compliance_bps, office_words: "the rates office" });
    const routines = new StandingWork(ctx.entity, p.part);
    const settled = new Set<string>(); // claims a payment into our account has named
    // A payment that names the notice pays what the notice asks: the claim recorded with it (same owner, same sum, same
    // due day). Whoever is sent a rates notice pays "the rates notice"; until 2026-10-11 only a payment naming the
    // claim counted, and two landlord seats who paid on the notice were charged interest and paid again (wave 2c's
    // review, fault 4).
    const paid = (book: Book, c: any): boolean => billSettled(book, c, settled);
    const lastInterest = new Map<string, number>(); // overdue claim -> when interest was last charged
    // The office's own file (what it has put on record in this position, whoever held it then): when the last notices went
    // out and when interest was last charged on each claim are read from it, not kept only in a holder's memory.
    const ours = (r: { author: string; in_position?: string }) => (ctx.position ? r.in_position === ctx.position : r.author === ctx.participant);
    let next = p.first_day * DAY;
    let reportDay = -1;
    const dated = (x: number) => `year ${Math.floor(x / (365 * DAY)) + 1}, day ${Math.floor((x % (365 * DAY)) / DAY) + 1}`;
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
        // The law in force (itself, or what has replaced it); withdrawn with nothing in its place, nothing is levied.
        const law = book.current(p.law);
        const terms = law?.record === "statement" ? law.data ?? {} : {};
        const ratePpm: number = terms.rate_ppm ?? 0;
        const instalments: number = terms.instalments ?? 4;
        const dueDays: number = terms.due_days ?? 30;
        const interestBps: number = terms.penalty_interest_bps ?? 0;
        if (!acc) return steps;
        const everyInstalment = Math.floor(365 / instalments) * DAY;
        const lastNotices = Math.max(-Infinity, ...book.open("rates_notice").filter(ours).map((n) => n.at));
        if (lastNotices > -Infinity) next = Math.max(next, lastNotices + everyInstalment);
        for (const r of book.ofType("claim") as any[]) if (r.record === "claim" && r.position === "right" && r.holder === me && r.about?.kind === "rates_interest" && ours(r)) for (const b of basesOf(r)) lastInterest.set(b, Math.max(lastInterest.get(b) ?? -Infinity, r.at));
        steps.push(...routines.set(book, [{ task: "levy", at: p.office || ctx.position || "office", every: everyInstalment, why: "Setting the rates clerks' work: the notices sent at each instalment and interest added to what is overdue, as a standing work order." }]));
        const levying = routines.does(book, "levy", t, { every: DAY });
        // Notices: each owner's share of a year's rates on what they own, as last valued. (Not before there are valuations:
        // until 2026-10-02 the first instalment went out on the first morning, before the valuer had valued anything,
        // levied nothing, and the next waited a quarter.)
        if (levying && law && t >= next && ratePpm > 0 && book.open("valuation").length) {
          next = t + everyInstalment;
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
          routines.did("levy", t, { units: lines.length / 2 });
          for (let i = 0; i < lines.length; i += 30) steps.push(because(`The rates instalment: a ${instalments === 1 ? "year" : `${instalments}th of a year`}'s rates at the law's ${ratePpm / 10_000}% of each property's value.`, ...lines.slice(i, i + 30)));
        }
        // The clerks' report to the rates officer, once a day (docs/behaviour/standing-work.md, "The staff's report").
        if (levying) routines.note("levy", !law || ratePpm <= 0 ? "the rating law on file sets no rate, so no notice is sent" : !book.open("valuation").length ? "no property has been valued yet: the first notices go out once the valuer has valued" : `the next notices go out on ${dated(next)}, as the rating law's instalments fall`);
        if (p.part === "staff" && reportDay !== Math.floor(t / DAY)) {
          reportDay = Math.floor(t / DAY);
          steps.push(...routines.report(book, t, { office: (ctx.position ?? "").replace(/-staff$/, ""), from: "the rates clerks", tasks: { levy: ["instalments", "notices"] } }));
        }
        // Overdue: penalty interest, monthly, on what's still unpaid after its due date (unless a recovery direction
        // that stands, from whoever the town says may direct us, says to add none).
        const recovery = directions.standing(book, "rates_recovery");
        if (p.part !== "staff") steps.push(...directions.letters(book, (d) => (d.data?.interest === "no" ? "No penalty interest is added to overdue rates while it stands; the rates are still owed." : "Overdue rates are charged the law's penalty interest.")));
        if (levying && interestBps > 0 && recovery?.data?.interest !== "no") for (const c of book.ofType("claim").filter((r) => r.record === "claim" && r.position === "right" && r.holder === me && r.about?.kind === "rates") as any[]) {
          if (paid(book, c) || t < c.about.due) continue;
          if (t - (lastInterest.get(c.id) ?? c.about.due) < 30 * DAY) continue;
          lastInterest.set(c.id, t);
          const interest = Math.floor((cents(c.about.amount) * interestBps) / 10_000 / 12);
          if (interest > 0) steps.push(because(`Rates overdue a month or more: recording a month's penalty interest (${interestBps / 100}% a year) and writing to the owner.`,
            record("right", me, { kind: "rates_interest", amount: interest, account: acc.account }, { against: c.counterparty, basis: c.id }),
            message([c.counterparty], `Rates of ${usd(cents(c.about.amount))} are overdue; interest of ${usd(interest)} has been added.`, c.id)));
        }
        steps.push(...letters.answer(() => {
          const overdue = [...new Set((book.ofType("claim").filter((r) => r.record === "claim" && r.position === "right" && r.holder === me && r.about?.kind === "rates" && !paid(book, r) && t >= (r as any).about.due) as any[]).map((c) => c.counterparty))];
          const valued = new Set(book.open("valuation").map((v) => v.data?.lot)).size;
          const when = !valued ? " No property has been valued yet (the valuer values every property once a year): the first notices go out once it has."
            : t >= next ? " The next instalment's notices go out today." : ` The next instalment's notices go out on day ${Math.floor(next / DAY) + 1}.`;
          if (!law) return `Report from the rates officer: ${book.repealed(p.law) ? "the rating law has been withdrawn, so no rates are levied" : "there is no rating law that we know of, so no rates are levied"}; ${usd(levied)} levied so far, ${usd(received)} received.`;
          return `Report from the rates officer: rates at ${ratePpm / 10_000}% of value a year, in ${instalments} instalments, each due ${dueDays} days after its notice; ${valued} properties valued; ${usd(levied)} levied so far, ${usd(received)} received.` +
            when + (overdue.length ? ` Overdue: ${overdue.join(", ")}.` : " Nothing is overdue.");
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
  answers: {"office": "the works office", "acts": "What it acts on: the adopted budget's staff line, which sets its crew; a complaint of a collection missed; and a direction on one of its own forms from those the town's rule on directions names.", "forms": [{"about": ["staff", "recruit", "hire", "hiring", "crew", "vacanc", "posts"], "say": "On staffing it follows a direction on its staffing form (works_staffing) from those the town's rule on directions names, and no letter."}, {"about": ["collect", "round", "waste", "bin", "rubbish"], "say": "On how often it collects it follows a direction on its collection form (works_collection) from those the town's rule on directions names; a collection missed is reported as a complaint."}], "report": true},
  routines: [
    { task: "collect", at: "depot", every: ["collect_every_days", 7], what: "The crew at the depot collects waste from each address on the round as often as the order says, homes complained about first, as far as its hours go, and takes what it has collected to the landfill each week with a docket." },
    { task: "maintain", at: "depot", every: 1, what: "With the hours the round leaves, the crew keeps up the most worn of the town's own assets, and someone is sent to inspect an asset nobody has seen." },
    { task: "answer", at: "depot", every: 1, what: "The office's counter staff sort the day's post that is routine under this procedure and answer it, each working day, so that the works manager is not brought back for it.",
      papers: [{ kind: "complaint", how: "a complaint of a collection missed puts the home first on the next round of collection" }] },
  ],
  issues: [P.JOB_ADVERTISEMENT, ...P.PAYROLL, ...P.WORKS],
  issuesWith: (p) => ({ ...P.staffingOwn({ role: p.role ?? "works crew", industry: p.industry, workplace: p.workplace, notice_days: p.notice_days ?? 14 }), landfill: p.landfill, payroll_office: p.payroll_office || undefined, budget_line: p.staff_line ?? "staff" }),
  staffed: (p) => ({ role: p.role ?? "works crew", own: "role_or_unnamed", posts: { budget_line: p.staff_line ?? "staff", wage: p.wage ?? 0, period: p.period ?? 14 * DAY } }),
  keeps: [{ what: "service_address", why: "The round is the works office's own: it makes an entry for each address its crew collects from, and adds to it as homes are built." }],
  takes: [
    staffingForm("works_staffing", "the works office", "works crew"),
    { form: "works_collection", title: "Collection direction to the works office",
      fields: { every: { type: "duration", required: true, description: "How often each address on the round is to be collected from (a week, a fortnight)." } },
      follows: "While it stands, the crew collects from each address on the round once in that time, as its hours allow, homes complained about first. With no direction, the office keeps to its own round." },
  ],
  version: "0.6.2", // 0.6.2: returns of tax withheld are filed on the days the law states (docs/behaviour/firms.md, "Returns on the law's days"); 0.6.1: 0.6.1: a direction on its forms reaches its staff's post, and one on how often binds the round whatever the standing order's rhythm; its notice of a new starter names the budget line the post is on; told not to recruit, it says what that does of an offer already made; 0.6.0: its staff report to the office what they did under each standing order, or why not, and who of them worked (docs/behaviour/standing-work.md, "The staff's report"); 0.5.0: sends the office that pays the town's staff a payroll notice of each new starter and each leaver (docs/behaviour/firms.md, "Payroll notices"); 0.4.0: takes written directions on its staffing and on how often it collects (docs/behaviour/directions.md); 0.3.0: collects from its own round of addresses and keeps up the town's own assets, each seen by the crew that works on it or by going to inspect; no longer shown the town
  doc: "docs/behaviour/services.md",
  cadence: () => DAY,
  firstWake: (ctx) => 7 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    const p = params({
      depot: "", workplace: "", // its depot, and the space the crew works in there (the world must say)
      role: "works crew", wage: 0, period: 14 * DAY, notice_days: 14,
      industry: "", // what the work is (its postings say)
      working_day: 8 * 3600, work_days: 5, look_at: 0, look_days: 5, // when its staff are in (a time of day on working days: the world's; 0, whenever it wakes)
      waste: "waste", collect_task: "collect", collect_labour: 0, collect_per_unit: 0, collect_every_days: 7, // per unit: seconds of work, and waste taken
      wear: "wear", maintain_task: "maintain", maintain_labour: 0, maintain_per_unit: 0, maintain_over: 0, // wear worth a crew's time above this
      staff_line: "staff", landfill: "", kind: "waste", dispose_every_days: 7,
      payroll_office: "", // the office of the town that pays its staff, which is sent notice of starters and leavers (the world says; none: no notice is sent)
      depot_channel: "depot", // the channel that shows the depot, with who's there by name
      // Who knows what (docs/behaviour/services.md, "Who knows what"): the office's round, the addresses it collects
      // from (a register it keeps itself; none: it collects from nowhere), and the channel it sends someone through
      // to inspect an asset of the town's it has not seen (none: an asset is seen only by the crew that works on it).
      round: "", inspections: "",
      // Whose written directions it follows (docs/behaviour/directions.md): the town's own rule, a record the world
      // names (none: it follows nobody's); and how often it follows one it is given.
      directed_under: "", direction_compliance_bps: 10_000,
      // Which part of the office this is (docs/behaviour/standing-work.md): "" the whole office, as code runs one;
      // "seat" the works manager alone, who sets the standing work orders; "staff" the crew, who follow them.
      part: "" as "" | "seat" | "staff",
      // Whether the town gives the office a counter (its `answer` routine): then its staff answer the complaints, only
      // while a standing order for it is in force. Not given: whoever runs the office answers them, as ever.
      counter: false,
    }, ctx.params);
    need(p, ["depot", "workplace", "landfill"], "city.works");
    const me = ctx.entity;
    const book = new Book();
    const letters = new Letters(works.answers);
    const directions = new Directions(ctx, { under: p.directed_under, compliance_bps: p.direction_compliance_bps, office_words: "the works office" });
    const routines = new StandingWork(me, p.part, ctx.position ? new Set([ctx.position.replace(/-staff$/, "")]) : undefined);
    const staffOnly = p.part === "staff";
    const counter = new CounterWork(routines, !!p.counter);
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, workplace: p.workplace, role: p.role, ...(p.industry ? { industry: p.industry } : {}), does: { hire: true, pay: false }, own: "role_or_unnamed", ...(p.payroll_office ? { payroll: p.payroll_office, line: p.staff_line } : {}) });
    // Each building as we last saw it: as the crew that worked on it left it, or as whoever we sent to inspect it found it.
    const known = new Map<string, SiteStructure>();
    const addresses = new Set<string>(); // the round: the addresses we collect from (buildings)
    const notHomes = new Set<string>(); // called at, and nothing there to collect from: off the round
    // What a round learns of each address: what the crew left there and when, and how fast it has been filling (what
    // they found, over the days since they were last there). A bin is seen when it is emptied, not between.
    const leftThere = new Map<string, { value: number; at: number }>();
    const fills = new Map<string, number>(); // per day
    const inspecting = new Set<string>(); // assets someone has been sent to inspect
    let depotView: SiteStructure | undefined; // the depot, as its own channel shows it (who's there, by name)
    let atDepot = 0; // what's been collected and is held at the depot (holdings are seen as they change)
    const collectedAt = new Map<string, number>(); // home (a building) -> when we last collected from it
    const knownSince = new Map<string, number>(); // home -> when we first saw it (one never collected is due from then)
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
        if (!staffOnly) letters.take(obs, book);
        // The round: our own register of addresses, and homes we have had notice of since (told of the work as it began).
        const reg = p.round ? obs.channels[p.round] : undefined;
        if (reg?.kind === "records") for (const r of reg.records) if (r.record === "statement" && r.kind === "service_address" && typeof r.data?.structure === "string") addresses.add(r.data.structure);
        // What the crew left where it worked, and what an inspection found.
        for (const o of obs.outcomes) for (const st of o.seen ?? []) known.set(st.structure, st);
        if (p.inspections) for (const c of visited(obs, p.inspections)) if (c.structure) known.set(c.structure.structure, c.structure);
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
        // The town's own buildings (its asset register and the notices since), and new buildings anywhere it has had
        // notice of: one that is not the town's joins the round, and leaves it if the crew finds nothing to collect.
        const land = ownLand(book, me);
        const assets = land.flatMap((x) => x.structures.map((st) => st.structure));
        const own = new Set(assets);
        for (const n of book.open("building_notice")) {
          if (typeof n.data?.structure === "string" && !own.has(n.data.structure) && !notHomes.has(n.data.structure)) addresses.add(n.data.structure);
          if (typeof n.data?.removes === "string") { addresses.delete(n.data.removes); known.delete(n.data.removes); }
        }
        for (const s of addresses) if (!knownSince.has(s)) knownSince.set(s, t);
        const room = depotView?.spaces.find((sp) => sp.space === p.workplace);
        // The crew the staff line pays for (none adopted yet: the crew we have), within the depot's room.
        const workers = staffing.workers(book, t);
        const target = budget ? Math.min(room?.capacity ?? Infinity, annual > 0 ? Math.floor(line / annual) : 0) : workers.length;
        const m = Math.floor(t / MONTH);
        if (m !== month) {
          month = m;
          if (workers.length > target && !staffOnly) steps.push(...staffing.letGo(book, t, `The adopted budget's ${p.staff_line} line (${usd(line)}) pays for a crew of ${target}, and we have ${workers.length}: letting one go.`, "Redundancy: the budget doesn't pay for the position."));
        }
        // A staffing direction that stands (from whoever the town says may direct us): whether to recruit, and the most
        // posts to fill. It stands nobody down: the budget's crew is still what we keep.
        const staffingDir = directions.standing(book, "works_staffing");
        const directed = staffingUnder(staffingDir);
        const hireTo = Math.min(target, directed.posts ?? Infinity);
        // (Taking on and standing down are the office-holder's: its staff, where they are a post of their own, do neither.)
        if (!staffOnly) steps.push(...staffing.routine(obs, book, "", { target: hireTo, wage: p.wage, canPost: !!budget && hireTo > workers.length, recruit: directed.recruit,
          ...(staffingDir ? { stopped: `Direction ${staffingDir.id} says not to recruit: taking our advertisements down.` } : {}),
          why: `The adopted budget's ${p.staff_line} line (${usd(line)}) pays for a crew of ${target}${hireTo < target ? ` (and direction ${staffingDir!.id} says to fill ${hireTo})` : ""}; we have ${workers.length}: posting a job.` }));
        // How often each address is collected from: as directed, while a direction on it stands; else our own round.
        const collectionDir = directions.standing(book, "works_collection");
        const collectEvery = Number.isSafeInteger(collectionDir?.data?.every) && collectionDir!.data!.every >= DAY ? (collectionDir!.data!.every as number) : p.collect_every_days * DAY;
        // The routine work, and by what it is done: the whole office by its own practice; its staff by the standing
        // work order in force for each task, and not at all with none; the office-holder alone sets the orders, once.
        // (A direction on how often binds the staff's round while it stands, whatever rhythm their standing order
        // gives: until 2026-10-11 the order's own days were kept and the direction changed nothing for them.)
        const collectingBy = routines.does(book, p.collect_task, t, { every: collectEvery });
        const collecting = collectingBy && collectionDir ? { ...collectingBy, every: collectEvery } : collectingBy;
        const maintaining = routines.does(book, p.maintain_task, t, { every: DAY });
        steps.push(...routines.set(book, [
          ...(p.collect_labour > 0 ? [{ task: p.collect_task, at: p.depot, every: p.collect_every_days * DAY, why: `Setting the crew's round: collection from every address on it every ${p.collect_every_days} days, as a standing work order.` }] : []),
          ...(p.maintain_labour > 0 ? [{ task: p.maintain_task, at: p.depot, every: DAY, why: "Setting the crew's upkeep of the town's assets, each working day with the hours the round leaves, as a standing work order." }] : []),
          ...counter.order(p.depot),
        ]));
        if (!staffOnly) steps.push(...directions.letters(book, (d, form) => form === "works_staffing"
          ? (staffingUnder(d).recruit ? `The office recruits up to ${Math.min(target, staffingUnder(d).posts ?? Infinity)} crew.` : staffing.notRecruiting(book, t))
          : `The crew collects from each address every ${Math.round(Number(d.data?.every) / DAY)} days, as its hours allow.`));

        // Complaints about a home's waste: that home first, on the next round.
        // (At the counter, where the town gives the office one: its staff, under a standing order for it.)
        if (counter.works(book, t)) {
          for (const c of book.open("complaint")) {
            if (handled.has(c.id) || !(c.addressed_to ?? []).includes(me)) continue;
            handled.add(c.id);
            if (typeof c.data?.structure === "string") complained.add(c.data.structure);
            counter.answered("complaint");
          }
          counter.flush(t);
        }

        // ---- weekly: what's been collected, to the landfill ----
        if (routines.part !== "seat" && t >= nextDispose) {
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
        const here = [...new Set(room?.occupants ?? [])].filter((w) => mine.has(w)).sort();
        const present = team(here, (w) => p.working_day - (used.get(w) ?? 0)).who;
        // (The crew takes stock of the day when its work is set out: at the day's look, where the world has working
        // hours; whenever, where the crew is at the depot all day.)
        const tod = t - day * DAY;
        // Those in post since before today (someone taken on today is expected tomorrow): with none of them here,
        // whatever is ordered is done by nobody, and the crew's report says so.
        const before = staffOnly ? staffing.staff(book, t).filter((a: any) => (book.signedAt(a.id) ?? 0) < day * DAY).length : 0;
        const settingOut = staffOnly && day % 7 < p.work_days && (!p.look_at || (tod >= p.look_at && tod < p.look_at + 3600)) && (here.length > 0 || before > 0);
        if (settingOut && !here.length) for (const task of [p.collect_task, p.maintain_task]) if (routines.order(book, task, t))
          routines.heldUp(task, `none of the ${before} in post was at the depot (${p.workplace}) when the day's work was set out`);
        if (day % 7 < p.work_days && present.length && routines.part !== "seat") {
          const left = () => Math.min(...present.map((w) => p.working_day - (used.get(w) ?? 0))) * present.length;
          const spend = (seconds: number) => { for (const w of present) used.set(w, (used.get(w) ?? 0) + Math.ceil(seconds / present.length)); };
          const job = (task: string, units: number, on: string) => C.call("work", { task, units: C.text(String(units)), at: p.depot, by: C.json(present), on });
          // Collection: homes complained about, then those longest since a collection, as far as the crew's hours go
          // (a round's work in steps of up to 30 homes).
          const round: { on: string; call: C.Call; before?: number; full: boolean; fit: number; of: number }[] = [];
          if (p.collect_labour > 0 && p.collect_per_unit > 0 && collecting) {
            // (An order that names addresses is for those; one that names none is for the round.)
            const named = collecting.order?.on;
            const due = [...addresses].sort().filter((structure) => !named || named.includes(structure)).map((structure) => ({ structure, st: known.get(structure) }))
              .filter((b) => complained.has(b.structure) || t - (collectedAt.get(b.structure) ?? -Infinity) >= collecting.every - DAY / 2)
              .sort((a, b) => Number(complained.has(b.structure)) - Number(complained.has(a.structure)) || (collectedAt.get(a.structure) ?? -1) - (collectedAt.get(b.structure) ?? -1) || (a.structure < b.structure ? -1 : 1));
            for (const b of due) {
              // An address the crew has been to and found nothing kept of waste at: not a home; off the round.
              if (b.st && !b.st.variables?.[p.waste]) {
                addresses.delete(b.structure);
                notHomes.add(b.structure);
                continue;
              }
              // (Every bin emptied, however little is in it, as a round does: until 2026-10-02 what was under a load was
              // left, so small households' bins never emptied and they complained while the round counted them done.)
              // An address never called at: a first load, and the crew sees what is there; the rest when they are back.
              const first = !b.st;
              const was = leftThere.get(b.structure);
              const expected = (was?.value ?? 0) + ((fills.get(b.structure) ?? 0) * Math.max(0, t - (was?.at ?? t))) / DAY;
              // (At least a load's call at every address due: the crew goes, and sees.)
              const units = first ? 1 : Math.max(1, Math.ceil(expected / p.collect_per_unit));
              if (units === 0) {
                collectedAt.set(b.structure, t);
                complained.delete(b.structure);
                continue;
              }
              const fit = Math.min(units, Math.floor(left() / p.collect_labour));
              if (fit <= 0) break;
              const before = collectedAt.get(b.structure);
              spend(fit * p.collect_labour);
              if (fit === units && !first) {
                collectedAt.set(b.structure, t);
                complained.delete(b.structure);
              }
              collectedKg += fit;
              routines.did(p.collect_task, t, { units: fit, by: present });
              round.push({ on: b.structure, call: job(p.collect_task, fit, b.structure), before, full: fit === units, fit, of: units });
            }
            // (For the crew's report: what the day's hours left undone.)
            const undone = due.filter((b) => addresses.has(b.structure) && !round.some((x) => x.on === b.structure && x.full)).length;
            routines.note(p.collect_task, !addresses.size ? "the office's round has no addresses on it" : undone ? `${undone} address${undone > 1 ? "es" : ""} due were left when the crew's hours ran out` : undefined);
          }
          for (let i = 0; i < round.length; i += 30) {
            const part = round.slice(i, i + 30);
            const short = part.filter((x) => !x.full);
            const st = because(`The collection round: ${part.map((x) => x.on).join(", ")}${short.length ? ` (${short.map((x) => `${x.on}: ${x.fit} of ${x.of} loads, the crew's hours used up`).join("; ")})` : ""}.`, ...part.map((x) => x.call));
            st.then = (out) => {
              if (out.status === "applied") {
                // What the crew found at each address: what they left, and so what had gathered since they were last there.
                for (const x of part) {
                  const v = out.seen?.find((b) => b.structure === x.on)?.variables?.[p.waste];
                  if (!v) continue;
                  const after = variableToday(v, t) ?? v.value;
                  const was = leftThere.get(x.on);
                  const days = Math.max(1, (t - (was?.at ?? knownSince.get(x.on) ?? t)) / DAY);
                  // (A bin left empty held no more than the loads sent for, and how much less nobody weighed: taken as
                  // a load less, or half of the one, so that the next call is for less, and a call that falls short is
                  // measured by what it leaves.)
                  const found = after > 0 ? after + x.fit * p.collect_per_unit : x.fit > 1 ? (x.fit - 1) * p.collect_per_unit : Math.floor(p.collect_per_unit / 2);
                  fills.set(x.on, Math.max(0, (found - (was?.value ?? 0)) / days));
                  leftThere.set(x.on, { value: after, at: t });
                }
                return;
              }
              for (const x of part) if (x.before === undefined) collectedAt.delete(x.on); else collectedAt.set(x.on, x.before);
              for (const x of part) routines.undid(p.collect_task, { units: x.fit });
              // Someone's day is fuller than our count of it (work elsewhere today): the world's count, from now on.
              const short = outOfTime(out);
              if (short?.who) used.set(short.who, p.working_day - short.left);
              else if (short) for (const w of present) used.set(w, p.working_day);
            };
            steps.push(st);
          }
          // Maintenance: the most worn of the town's assets, with the hours left.
          if (p.maintain_labour > 0 && p.maintain_per_unit > 0 && maintaining) {
            const worn = assets.map((a) => known.get(a)).filter((b): b is SiteStructure => !!b).map((b) => ({ b, wear: variableToday(b.variables?.[p.wear], t) ?? 0 })).filter((x) => x.b.variables?.[p.wear] && x.wear > p.maintain_over)
              .sort((a, b) => b.wear - a.wear || (a.b.structure < b.b.structure ? -1 : 1));
            const upkeep: C.Call[] = [];
            const names: string[] = [];
            for (const x of worn) {
              const units = Math.min(Math.ceil((x.wear - p.maintain_over) / p.maintain_per_unit), Math.floor(left() / p.maintain_labour));
              if (units <= 0) break;
              spend(units * p.maintain_labour);
              upkeep.push(job(p.maintain_task, units, x.b.structure));
              names.push(x.b.structure);
              if (upkeep.length <= 30) routines.did(p.maintain_task, t, { units, by: present });
            }
            // (For the crew's report: none worn enough is nothing due; worn ones left are hours run out.)
            routines.note(p.maintain_task, worn.length > names.length ? `${worn.length - names.length} worn asset${worn.length - names.length > 1 ? "s" : ""} were left when the crew's hours ran out` : undefined);
            if (upkeep.length) steps.push(because(`Upkeep of the most worn of the town's assets: ${names.join(", ")}.`, ...upkeep.slice(0, 30)));
          }
        }

        // The crew's report to the works manager, once the day's work is set out: what was done under each standing
        // order, or why not, and who of the crew was at work (docs/behaviour/standing-work.md, "The staff's report").
        if (settingOut) {
          const noPlace = staffing.staff(book, t).filter((a: any) => !jobTerms(a, a.terms.parties[1], book).workplace).map((a: any) => String(a.terms.parties[1]));
          const reportSteps = routines.report(book, t, { office: (ctx.position ?? "").replace(/-staff$/, ""), from: `the ${p.role}`, inPost: workers, noPlace,
            tasks: { [p.collect_task]: ["calls at addresses", "loads"], [p.maintain_task]: ["upkeep jobs", "units of upkeep"], ...counter.tasks } });
          counter.reported(reportSteps);
          steps.push(...reportSteps);
        }
        // (The office-holder, with the crew a post of its own, reports what is its to know: the crew, the budget, the
        // directions it follows and the standing orders it has set. The round is the crew's.)
        if (routines.part === "seat") steps.push(...letters.answer(() => `Report from the works office: a crew of ${workers.length} (the adopted budget's ${p.staff_line} line, ${usd(line)}, pays for ${target} at ${usd(annual)} a year each, ${usd(p.wage)} every ${Math.round(p.period / DAY)} days). Standing work orders the crew follows: ${routines.words(book, t)}.`));
        else if (!staffOnly) steps.push(...letters.answer(() => {
          // (A home never collected from is overdue a week after it was first due, not from the beginning of time: pilot 7
          // found every home "a week or more overdue" on the first morning, and the mayor kept asking why.)
          const overdue = [...addresses].sort().filter((s) => t - (collectedAt.get(s) ?? knownSince.get(s) ?? t) >= collectEvery + 7 * DAY);
          const standing = [staffingDir, collectionDir].filter((d): d is StatementRecord => !!d);
          const state = assets.map((a) => known.get(a)).filter((b): b is SiteStructure => !!b?.variables?.[p.wear]).map((b) => `${b.structure} ${Math.round(((variableToday(b.variables![p.wear], t) ?? 0) * 100) / Math.max(1, b.variables![p.wear]!.max))}% worn`);
          const unseen = assets.filter((a) => !known.has(a)).length;
          return `Report from the works office: a crew of ${workers.length} (the adopted budget's ${p.staff_line} line, ${usd(line)}, pays for ${target} at ${usd(annual)} a year each). ` +
            (standing.length ? `Directions we are following: ${standing.map((d) => `${d.id} (${d === staffingDir ? (directed.recruit ? `recruit up to ${hireTo}` : "do not recruit") : `collect every ${Math.round(collectEvery / DAY)} days`})`).join(", ")}. ` : "") +
            `Waste is collected from every home every ${Math.round(collectEvery / DAY)} days as the crew's hours allow; ${collectedKg} loads collected so far. ` +
            (overdue.length ? `Homes a week or more overdue: ${overdue.join(", ")}. ` : "No home is overdue. ") +
            `The round has ${addresses.size} addresses. ` +
            (state.length ? `The town's assets, as last seen: ${state.slice(0, 60).join(", ")}${state.length > 60 ? `, and ${state.length - 60} more` : ""}.` : "") +
            (unseen ? ` ${unseen} of the town's assets have not been inspected yet.` : "");
        }));
        return steps;
      },
      p.look_at ? (obs) => nextLook(obs.t, p.look_at, p.look_days) : undefined,
      // An asset of the town's we have never seen (at the start, every one; later, what the town has had built):
      // someone is sent to inspect it, a visit's worth at a time, once each.
      () => {
        if (!p.inspections || routines.part === "seat" || (staffOnly && !routines.order(book, p.maintain_task, book.now))) return [];
        const go = ownLand(book, me).flatMap((x) => x.structures.map((st) => st.structure)).filter((a) => !known.has(a) && !inspecting.has(a)).slice(0, VISIT_MAX);
        for (const a of go) inspecting.add(a);
        return go.length ? [goSee(p.inspections, go)] : [];
      },
    ), { beliefs: (): Belief[] => staffing.beliefs(book) });
  },
};

/** What a result says of a law passed in free words. */
const WORDS_ONLY = "The law is recorded as worded. No rule was set down with it for acts to be checked against.";

/** A proposal made on a law's amendment form: the schedule the law is written by, the law in force (if there is one),
 * and the figures the proposal gives, as held. */
type Amendment = { schedule: StatementRecord; s: LawSchedule; law?: StatementRecord; given: { [figure: string]: number } };

/** The town's law in force that a schedule wrote (the latest, if somehow several). */
function lawBySchedule(book: Book, me: string, schedule: string): StatementRecord | undefined {
  return book.open("law").filter((l) => l.speaks_for === me && l.data?.schedule === schedule).sort((a, b) => a.at - b.at).at(-1);
}

/** The town's schedules still standing, each with its amendment form (if one stands) and the law in force it wrote. */
function schedules(book: Book, me: string): { schedule: StatementRecord; s: LawSchedule; form?: StatementRecord; law?: StatementRecord }[] {
  return book.open("law_schedule").filter((x) => x.speaks_for === me && x.data?.figures && typeof x.data?.text === "string").sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((schedule) => ({ schedule, s: schedule.data as LawSchedule, form: book.open("form").find((f) => f.speaks_for === me && f.data?.amends === schedule.id), law: lawBySchedule(book, me, schedule.id) }));
}

/** Is this proposal made on one of the town's amendment forms? (A form made proposal's basis is its form.) */
function amendment(book: Book, me: string, prop: StatementRecord | undefined): Amendment | undefined {
  const form = basesOf(prop).map((b) => book.records.get(b)).find((x) => x?.record === "statement" && x.kind === "form");
  if (!prop || form?.record !== "statement" || form.kind !== "form" || form.speaks_for !== me || typeof form.data?.amends !== "string") return undefined;
  const found = schedules(book, me).find((x) => x.schedule.id === form.data.amends);
  if (!found) return undefined;
  const given: { [figure: string]: number } = {};
  for (const [k, f] of Object.entries(found.s.figures)) if (Number.isSafeInteger(prop.data?.[k]) && prop.data[k] >= 0) given[k] = heldValue(f, prop.data[k]);
  return { schedule: found.schedule, s: found.s, law: found.law, given };
}

/**
 * A passed amendment written into law: the amended law, by the schedule the law was made with (the figures given,
 * the rest as they stand in the law in force now: it may have been amended since the proposal was made), published in
 * place of the law in force, which is withdrawn; and what the result says became of it. No calls where it cannot be
 * written (a figure the law must have is missing; a schedule that can't be written from).
 */
function enactAmendment(am: Amendment, ballot: string): { calls: C.Call[]; note: string } {
  const values: { [k: string]: number } = { ...Object.fromEntries(Object.entries(am.law?.data?.figures ?? {}).map(([k, f]: [string, any]) => [k, f?.value])), ...am.given };
  // (What the law can't be written without: a figure it must have; or, where it may do without each, any at all.)
  const needed = Object.entries(am.s.figures).filter(([k, f]) => !f.optional && !figureGiven(f, values[k])).map(([k]) => k);
  const missing = needed.length ? needed : Object.entries(am.s.figures).some(([k, f]) => figureGiven(f, values[k])) ? [] : Object.keys(am.s.figures);
  // (A schedule that can't be written from, a fault in the world's content: nothing is enacted, and the result says so.)
  const law = missing.length ? undefined : (() => { try { return draftLaw(am.schedule.id, am.s, values); } catch { return undefined; } })();
  if (missing.length) return { calls: [], note: ` Nothing is enacted: ${am.s.title} is no longer in force, and the proposal doesn't give ${missing.map((k) => am.s.figures[k]!.label ?? k).join(" or ")}.` };
  if (!law) return { calls: [], note: ` Nothing is enacted: ${am.s.title} couldn't be written out from its figures.` };
  const calls: C.Call[] = [say("law", `${law.text} (${am.law ? `As amended by the council on ballot ${ballot}; this replaces ${am.law.id}.` : `Made by the council on ballot ${ballot}.`})`,
    { basis: ballot, visible: "public", adico: law.adico, formal: law.formal?.condition, data: { ...law.data, ...(am.law ? { replaces: am.law.id } : {}) } })];
  if (am.law) calls.push(withdraw(am.law.id, `Amended by the council on ballot ${ballot}.`));
  return { calls, note: ` ${am.s.title[0]!.toUpperCase()}${am.s.title.slice(1)} is amended: ${changes(am, "was")}.${am.law ? ` The amended law takes the place of ${am.law.id}.` : ""}` +
    (law.formal ? " It is written as the law it replaces was, so acts are checked against it in the same way." : ` ${WORDS_ONLY}`) };
}

/** What an amendment changes, in words: "notice of an increase 90 days (now 60 days)" (once made: "was 60 days"). */
function changes(am: Amendment, before: "now" | "was" = "now"): string {
  return Object.entries(am.given).map(([k, v]) => {
    const f: LawFigure = am.s.figures[k]!;
    const now = am.law?.data?.figures?.[k]?.value;
    // (An optional figure given as nought is the requirement taken away; one the law in force doesn't have is "none".)
    const words = (x: number | undefined) => (figureGiven(f, x) ? figureWords(f, x) : "none");
    return `${f.label ?? k} ${words(v)}${am.law ? ` (${words(now) === words(v) ? "unchanged" : `${before} ${words(now)}`})` : ""}`;
  }).join("; ");
}

/** Where figures are changed: the laws in force made from figures, each with its amendment form (and, in a report, its figures). */
function amendable(book: Book, me: string, withFigures = false): string {
  const list = schedules(book, me).filter((x) => x.form);
  if (!list.length) return "";
  return ` Laws made from figures are amended on their own forms: ${list.map((x) => `${x.s.title}${x.law ? ` (${x.law.id})` : " (none in force)"} on ${x.form!.data.form}` +
    (withFigures && x.law ? ` (${Object.entries(x.s.figures).map(([k, f]) => `${k}: ${f.label ?? k}, now ${figureWords(f, x.law!.data?.figures?.[k]?.value)}`).join("; ")})` : "")).join("; ")}.`;
}

/** What a proposal made on the council proposal form enacts if it passes: a law, or a budget (with its lines: parks,
 * and every other amount the form gives). */
function fromForm(prop: StatementRecord | undefined, t: number): any {
  const d = prop?.data;
  if (!d?.proposal) return undefined;
  if (d.kind === "law") return { kind: "law", text: d.proposal };
  if (d.kind === "budget") {
    const line = (x: unknown) => (x === undefined ? 0 : cents(x as string));
    // Every amount on the form is a line (whatever lines the town's form has; pilot 7 found the form had only three of
    // the five, and the mayor, rightly, wouldn't table a budget that dropped two).
    const lines: Record<string, number> = { parks: line(d.parks) };
    for (const [k, v] of Object.entries(d)) if (!["proposal", "kind", "affects", "form", "year"].includes(k) && (typeof v === "string" || typeof v === "number")) {
      try { lines[k] = line(v); } catch { /* not an amount */ }
    }
    // The year it is for: the one the form names, if that is this year or one to come (a budget is adopted before its
    // year begins); with none named, or a year already past, the year in which the council adopts it.
    const now = Math.floor(t / YEAR) + 1;
    return { kind: "budget", text: d.proposal, data: { year: Number.isSafeInteger(d.year) && d.year >= now ? d.year : now, lines } };
  }
  return undefined;
}

/** How a form-made proposal is placed for the councillors (their votes weigh who it mainly bears on). */
function formTags(prop: StatementRecord): string[] {
  const d = prop.data ?? {};
  return d.kind === "budget" ? ["budget"] : d.affects === "tenants" ? ["tenant_protection"] : d.affects === "development" ? ["development"] : [];
}
