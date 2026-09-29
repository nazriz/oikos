// citizen.default: a townsperson's everyday economic life. Documented in
// docs/behaviour/citizen.md, with sources.
//
// Housing (after the Bank of England housing model, Baptista et al. 2016):
// renters budget a third of income for rent, take the best home they can
// afford from the listings they see, and don't leave a tenancy early.
// Work: the unemployed apply for the best-paid posting. Spending (after the
// same model's consumption rule): essentials, plus a fraction of savings
// above a desired buffer. Shopping (after Lengnick 2013): goods bought every
// fortnight from a favourite shop, switching to a cheaper one now and then and
// away from one that couldn't serve; used up week by week until the next trip. Exit (Hirschman 1970): after long enough without a
// home, or without work and money, they leave town and take their money.
// Word of mouth (D44; Granovetter 1974, Ioannides & Loury 2004): people who
// start hunting ask the people they live and work with, now and before; those
// who can see room where they live, or at their own work, say where.
//
// Households (docs/behaviour/households.md): people live in households, as
// the census counts them. The leaseholder hunts for the bedrooms the
// household needs by the occupancy standard (CNOS), within a third of the
// household's income, applies, signs and brings the children; the other
// adults move when told, and pay their share of the rent to the leaseholder.
// Children do nothing on their own until they're 18.
//
// Everything is done the way a person does it: applying, signing, moving in,
// asking the bank to pay. Nothing happens to them automatically.

import { cents } from "../money";
import type { Eligibility, LookRequest, Observation, ParticipantAction, SiteStructure, StatementRecord } from "../contracts";
import { channels } from "../contracts";
import { DECISIONS, params, wait, type BehaviourModule, type ConsultAnswer, type DecisionRecord, type ParticipantContext } from "../module";
import type { Rng } from "../rng";
import * as C from "../calls";
import { because, Book, callAction, commitmentOf, DAY, usd, jobTerms, record, leaseTerms, message, MONTH, moveIn, moveOut, notice, ownAccount, pay, petitionSignatures, publishedCount, say, sign, structureOf, variableToday, vote, withdraw, type Step, ownBanked } from "./common";
import { ADULT_YEARS, ageAt, bedroomsNeeded, hear, householdOf, SAYING, type Heard, type HouseholdData, type Member } from "./household";
import { Deliveries, goodsPrices, order } from "./trade";
import { incomeTaxLaw, withholding } from "./tax";
import { Borrowing } from "./credit";
import { factsOf, Feelings, Mind, MIND_DEFAULTS, Pursuit, satisfaction, Ties, type Circumstances, type MindParams, type NeedLevels, type PopulationValues, type Value } from "./mind";

/** How belief changes (docs/behaviour/citizen.md "Belief"; placeholders): a month's fading; how much of the way to
 * certainty a gathering takes it (with 20 or more others there), and being told; how strongly it's held to say so; and
 * how much it adds to the worth of the gatherings of those who teach it. */
/** Goals (docs/behaviour/citizen.md "Goals"; placeholders): how long a need goes unmet before it becomes a goal, how long
 * each method is given, how long after giving up before trying again; the needs' levels that count as unmet; what
 * spending less saves, and how much cheaper a cheaper home is (of the old rent). */
const GOALS = { unmet_days: 60, method_days: 90, rest_days: 180, security_bps: 3_000, social_bps: 4_000, spend_less_saving_bps: 2_000, cheaper_bps: 9_000 };

const BELIEF = { fade_bps: 150, display_bps: 500, told_bps: 300, tell_at_bps: 6_000, meaning: 0.2 };

/** How far a person's values sway the cited rates (a fraction of the rate per standard deviation of the value):
 * placeholders, unsourced, chosen small so the town's rates stay as calibrated (docs/behaviour/citizen.md). */
const SWAY = { consult: 1, union_belief: 0.5, union_peers: 0.5, union_join: 0.3, turnout: 0.15, strike_vote: 0.08, patience_tradition: 0.2, patience_security: 0.1, enterprise_openness: 0.4, enterprise_achievement: 0.3 };

/** What a code citizen says when it asks around, and recognises when asked (a code citizen only understands its own phrasing). */
export const ASKING = { home: "I'm looking for somewhere to live. Do you know of anywhere?", work: "I'm looking for work. Do you know of anything going?" } as const;
type Want = keyof typeof ASKING;

/** Catching up with someone we know: the question, and a code citizen's answer (where they shop and how it serves them,
 * whom they work for and whether they're paid, whether they're in the union). Understood only in this phrasing. */
export const CATCHING_UP = {
  ask: "How are things with you?",
  shop: (shop: string, served: number) => `I shop at ${shop}; ${served >= 9_000 ? "it has what I need" : served >= 6_000 ? "it mostly has what I need" : "it often runs short"}.`,
  work: (employer: string, paid: boolean) => `I work for ${employer}; ${paid ? "they pay on time" : "they've stopped paying me"}.`,
  union: (member: boolean) => (member ? "I'm in the union." : "I'm not in the union."),
  goes: (host: string) => `I go to ${host}'s gatherings.`,
  holds: (host: string) => `I hold to what ${host} teaches.`,
  nothing: "Much the same.",
};
export interface News { shop?: string; served?: number; employer?: string; paid?: boolean; member?: boolean; goesTo?: string[]; holdsTo?: string[] }
/** What someone's answer tells us, if it's in our phrasing (how well a shop serves: the middle of what the words say). */
export function heardNews(text: string): News | undefined {
  const n: News = {};
  let m: RegExpExecArray | null;
  if ((m = /I shop at ([^\s;]+); (it has what I need|it mostly has what I need|it often runs short)\./.exec(text))) {
    n.shop = m[1]!;
    n.served = m[2] === "it has what I need" ? 9_500 : m[2] === "it mostly has what I need" ? 7_500 : 3_500;
  }
  if ((m = /I work for ([^\s;]+); (they pay on time|they've stopped paying me)\./.exec(text))) {
    n.employer = m[1]!;
    n.paid = m[2] === "they pay on time";
  }
  if ((m = /I'm (not )?in the union\./.exec(text))) n.member = !m[1];
  const goes = [...text.matchAll(/I go to ([^\s;']+)'s gatherings\./g)].map((x) => x[1]!);
  if (goes.length) n.goesTo = goes;
  const holds = [...text.matchAll(/I hold to what ([^\s;']+) teaches\./g)].map((x) => x[1]!);
  if (holds.length) n.holdsTo = holds;
  return Object.keys(n).length ? n : undefined;
}

/** A home is a unit (a space) in a building. */
interface Home {
  agreement: string; space: string; structure: string; landlord: string; rent: number; order?: string; endsAt: number; movedIn: boolean;
  /** Rent orders replaced by a new rent's, to stop once their last payment is made (when). */
  retiring?: { order: string; at: number }[];
}
interface Job { agreement: string; employer: string; wage: number; period: number; workplace?: string; endsAt: number; since: number; paidAt?: number; claimed?: boolean }

export const citizen: BehaviourModule = {
  name: "citizen.default",
  version: "0.18.0",
  doc: "docs/behaviour/citizen.md",
  cadence: () => 7 * DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(7) * DAY,
  create(ctx: ParticipantContext) {
    const p = params(
    {
      year: 365 * DAY, // the calendar: how long a year is, for ages
      births: false, // whether this world has births (its life physics), so whether having a child is possible
      gestation: 266 * DAY, // how long a pregnancy lasts (the world's birth physics: the standard 38 weeks from conception)
      rent_share_bps: 3300, // BoE: renters bid 33% of income
      savings_rent_months: 6, // without income, rent only if savings cover this many months
      // Place-specific figures are placeholders here: a world sets them from its profile (docs/profiles.md).
      essentials: 40_000, // cents per month: what's spent however little comes in
      // Spending out of income (docs/behaviour/citizen.md): what isn't saved, less housing, plus a little out of wealth.
      saving_bps: 500, // the household saving ratio
      wealth_effect_bps_per_year: 300, // consumption a year per dollar of wealth
      income_window_days: 90, // income is what came in over this, a month's worth
      buffer_months: 3,
      // Retiring, and claiming support (docs/behaviour/citizen.md). None unless the world says: no retirement age, no payer.
      retirement_age: null as number | null,
      support_from: null as string | null, // who pays support (an entity: in a town, usually the outside world)
      support_kinds: { retired: "pension", unemployed: "unemployment" } as { retired?: string; unemployed?: string }, // what to claim, when
      in_labour_force: true, // false: not looking for work (studying, caring...), and not claiming support for being out of it
      // A child born here: whether they'll look for work as an adult, at the world's participation (the template for
      // those who won't; "": every child takes `child_template`).
      child_template: "child",
      child_template_outside_lf: "",
      participation_bps: 10_000,
      // Looking for a better-paid job while employed (docs/behaviour/citizen.md): a month's chance, Lengnick (2013)'s pi.
      // (Looking for a better job while employed is the mind's: docs/design/ai-citizens.md 3b.)
      // Starting a business (docs/behaviour/entry.md): the kinds of venture this world has (a template each: its capital
      // beyond the premises, the founder's position's channels and rules, with "{structure}", "{cell}", "{listing}",
      // "{founder}" and "{capital}" filled in), and the monthly chance a person able to, seeing premises for sale, does.
      ventures: [] as { kind: string; name: string; capital: number; channels: unknown[]; role_module: { code: string; params: { [k: string]: unknown } } }[],
      found_bps: 0,
      // Shopping (Lengnick 2013, Table 1): how often, and how many shops a trip may try. Which shop is the mind's
      // (docs/design/ai-citizens.md 3b, 3c): it replaces Lengnick's price and quantity switching rules.
      shop_every_days: 14,
      beta: 5, // shops tried in one trip, at most
      // The mind (docs/design/ai-citizens.md 3): the world's figures for drawing people's values, and its thresholds.
      values: { values: {} } as PopulationValues,
      essentials_units: 10, // goods a household uses in a fortnight, for how well subsistence is met (placeholder)
      mind: {} as Partial<MindParams>,
      sway: SWAY, // how far a person's values sway the cited rates (above)
      // Belief (docs/design/ai-citizens.md 5; docs/behaviour/citizen.md "Belief"): what we hold at the start (teaching ->
      // basis points: the world's), and how it changes. Placeholders: a month's fading; how much of the way to certainty
      // a gathering takes it (with 20 or more others there), and being told; how strongly it's held to say so; and how
      // much it adds to the worth of the gatherings of those who teach it.
      beliefs: {} as { [teaching: string]: number },
      belief: BELIEF,
      goals: GOALS,
      goods: "goods",
      leave_after_homeless_days: 90,
      leave_after_jobless_days: 180,
      // Voice (docs/behaviour/citizen.md): petitions, after Granovetter (1978).
      petition_start_bps: 300, // chance per wake that an aggrieved renter starts a petition, if none is open
      petition_willing_bps: 4400, // share of people who sign petitions at all (AES 2016: 44% had signed a written petition in the last five years)
      petition_days: 180, // how long an organiser keeps a petition open
      threshold_mean_bps: 2500, // personal thresholds (share of the population already signed) are
      threshold_sd_bps: 1000, //   roughly normal with this mean and spread (Granovetter 1978)
      population: 200,
      rent_burden_grievance_bps: 4000,
      aggrieved_bps: 2000, // anger with the landlord at which a tenant is aggrieved (placeholder: the anger at a notice to go lasts about 95 days)
      search_limit: 20, // how many listings or postings a search shows, best first
      // Word of mouth (docs/behaviour/citizen.md, D44).
      ask_home_bps: 3700, // chance a new home hunt starts by asking around (37% of renters ask friends or family: Apartments.com/NAA 2026)
      ask_work_bps: 6900, // chance a new job hunt starts by asking around (69% of young job seekers used friends and relatives over a year: Holzer 1987)
      ask_again_days: 60, // still hunting after this long: a new hunt, asked about again (placeholder)
      max_contacts: 15, // people remembered from homes and workplaces shared, most recent first (placeholder; Dunbar's ~15 "sympathy group")
      pass_on_bps: 10_000, // chance a contact who can see a lead passes it on (placeholder)
      // Catching up (docs/behaviour/citizen.md): how often we ask someone we know how things are (placeholder), and for
      // how long what they told us counts as what they do now (placeholder).
      catch_up_days: 14,
      news_days: 90,
      // Households (docs/behaviour/households.md).
      accept_fewer_bedrooms_after_days: 60, // still hunting after this long: accept one bedroom fewer than the standard asks, and so on (placeholder)
      // Fertility (docs/behaviour/households.md): births per 10,000 women a year by age (the world's profile); a month's chance is a twelfth.
      fertility_per_10000: [] as { from: number; rate: number }[],
      // Complaining about a service (docs/behaviour/services.md): whom to (none: nobody), about which of our home's
      // variables (waste building up), once it's this many days' worth, with this chance each week (placeholder).
      complain_to: null as string | null,
      complain_about: "waste",
      complain_after_days: 14,
      complain_bps: 3000,
      // A union (docs/behaviour/unions.md): which (none: none to join), the chance of joining on starting a job, by the
      // industry the job's posting said (the world's profile; "other" for the rest), and in a protected
      // action ballot, the chance of voting and of voting yes (placeholders). ("other": for the rest.)
      union: null as string | null,
      union_join_bps: {} as { [kind: string]: number },
      ballot_turnout_bps: 7000,
      strike_vote_yes_bps: 8500,
    },
    ctx.params,
  );
    p.sway = { ...SWAY, ...(ctx.params.sway ?? {}) }; // a world may set some and keep the rest
    p.belief = { ...BELIEF, ...(ctx.params.belief ?? {}) };
    p.goals = { ...GOALS, ...(ctx.params.goals ?? {}) };
    const me = ctx.entity;
    const childTemplate = () => (p.child_template_outside_lf && ctx.rng("child-participation").below(10_000) >= p.participation_bps ? p.child_template_outside_lf : p.child_template);
    const book = new Book();
    let home: Home | null = null;
    let job: Job | null = null;
    let homeSite: SiteStructure | undefined; // our home's building, as we last saw it
    let striking: { employer: string; out: boolean; left?: string } | null = null; // on strike (protected action), from our job; the workplace we left
    let backTo: { employer: string; space: string } | null = null; // the stoppage is over: back into the workplace we left
    let joinAsked = ""; // the job we've asked to join the union for
    const industryOf = new Map<string, string>(); // employer -> the industry its posting said
    let complainedOf: string | null = null; // the home we've complained about, until it's seen to
    // Moving to a better-paid job: the offer we've taken, to sign once our notice at the old one is worked out.
    let switching: { offer: string; wage: number } | null = null;
    let searchingWork = false; // this month's look for a better-paid job while employed
    let nextJobSearch = ctx.rng("job-search-day").below(30) * DAY;
    const applied = new Set<string>();
    // Attention: the market is looked at only when hunting, as a search (what's on offer now).
    let lookedAt = -1;
    const found: { homes: StatementRecord[]; jobs: StatementRecord[]; petitions: StatementRecord[] } = { homes: [], jobs: [], petitions: [] };
    let homelessSince: number | null = null;
    let joblessSince: number | null = null;
    let nextSpend = ctx.rng("spend-day").below(30) * DAY;
    // Shopping: the shop we go to, this trip's shortfalls still to find elsewhere, and when we next shop.
    let favourite: string | undefined;
    // The mind: a person drawn once from the world's figures, and what it learns (docs/design/ai-citizens.md 3).
    // (A shop not yet tried is expected to serve most of what's asked: one that serves nothing then counts against it.)
    const mind = new Mind(ctx.rng("person"), p.values, { ...MIND_DEFAULTS, ...p.mind, ewa: { ...MIND_DEFAULTS.ewa, ...(p.mind.ewa ?? {}) } }, { shop: 8_000, job: 5_000, practice: 4_000 });
    // How far this person's value sits from their world's (standardised, -3..3): a person's rates follow their values,
    // the town's stay as calibrated (docs/design/ai-citizens.md 3a).
    const zValue = (v: Value) => {
      const d = p.values.values[v] ?? { mean_bps: 5_000, sd_bps: 1_500 };
      return Math.max(-3, Math.min(3, (mind.person.values[v] - d.mean_bps) / Math.max(1, d.sd_bps)));
    };
    const shifted = (bps: number, shift: number) => Math.max(0, Math.min(10_000, Math.round(bps * (1 + shift))));
    /** A member of an organisation now: a membership agreement with it in force. */
    const memberOf = (org: string) => book.ofType("agreement").some((r) => r.record === "agreement" && r.terms.template === "membership" && r.terms.parties.includes(me) && r.terms.parties.includes(org) && book.inForce(r.id));
    const isMember = () => !!p.union && memberOf(p.union);
    let lastServed = 10_000; // how fully the last shop served us (basis points)
    const decided: DecisionRecord[] = []; // the mind's decisions since the last action, carried with the next (7)
    // Feelings, about people and things (docs/design/ai-citizens.md 3d), and ties with the people we know.
    const feelings = new Feelings();
    const ties = new Ties();
    const leadFrom = new Map<string, string>(); // a building someone told us to look at -> who told us
    // Goals: what we're pursuing, by which method; since when each need has gone unmet; when we may try again after
    // giving up; and, looking for a cheaper home, the rent to beat (for the first month of the hunt).
    const pursuits = new Map<string, Pursuit>();
    const unmetSince = new Map<string, number>();
    const restUntil = new Map<string, number>();
    let cheaperThan: { rent: number; until: number } | null = null;
    const pursuing = (method: string) => [...pursuits.values()].some((x) => x.method === method);
    // The sparse mind (docs/design/ai-citizens.md 4), when the run has it: the answers we've had (null: none to be had),
    // what we've asked and not yet heard, and the questions out this wake (the orchestrator waits for them with our
    // action, so they're answered by the next).
    const consulted = new Map<string, ConsultAnswer | null>();
    const awaiting = new Set<string>();
    let asking: Promise<void>[] = [];
    /** What the model says, for someone like us, of each option: our own draw from its answer's spread (basis points).
     * "pending": asked, answered by the next wake; undefined: no sparse mind in this run, or no answer to be had. */
    const consult = (about: string, thing: string, options: { key: string; words: string }[], savings: number, t: number): { [key: string]: number } | "pending" | undefined => {
      if (!ctx.consult) return undefined;
      if (awaiting.has(about)) return "pending";
      const a = consulted.get(about);
      if (a === null) return undefined;
      if (a) {
        const r = ctx.rng(`consult-${about}-${t}`);
        const normal = () => { let z = -6 * 10_000; for (let i = 0; i < 12; i++) z += r.below(10_000); return z / 10_000; };
        return Object.fromEntries(Object.entries(a.scores).map(([k, x]) => [k, Math.round(x.mean + x.sd * normal())]));
      }
      awaiting.add(about);
      asking.push(ctx.consult({ thing, about, options, person: { values: { ...mind.person.values }, needs: { ...levelsNow }, monthly_income: householdIncome(), savings, household: household?.members.length ?? 1 } }, ctx.participant)
        .then((ans) => consulted.set(about, ans ?? null), () => consulted.set(about, null))
        .then(() => { awaiting.delete(about); }));
      return "pending";
    };
    // (Fear for our money makes us less sure of our options where money's at stake: we look harder at them.)
    const MONEY_MATTERS = new Set(["shop", "job", "home"]);
    const decide = (domain: string, t: number, rng: Rng, o: Parameters<Mind["decide"]>[2]) => {
      const d = mind.decide(domain, rng, { doubt: MONEY_MATTERS.has(domain) ? Math.round(feelings.level("fear", "money", t) / 2) : 0, ...o });
      decided.push({ t, domain, strategy: d.strategy, ...(d.key !== undefined ? { choice: d.key } : {}), options: d.scores.length ? d.scores : o.options.map((x) => ({ key: x.key, score: 0 })) });
      return d;
    };
    let levelsNow: NeedLevels = { subsistence: 10_000, shelter: 10_000, security: 10_000, social: 10_000, status: 10_000 }; // as last judged
    let nextShop = ctx.rng("shop-day").below(p.shop_every_days) * DAY;
    let trip: { at: number; tried: Set<string> } | null = null;
    let nextUse = 0; // when we next use things up (weekly)
    let carried = 0; // budget not spent last trip (less than an item's price), carried to the next
    let deferred = 0; // money we meant to spend on goods and got back (a shop couldn't serve), spent on the next trip
    const borrowing = new Borrowing(me, ctx.params.bank ?? ""); // (no bank named: no borrowing)
    let nextVenture = ctx.rng("venture-day").below(30) * DAY;
    let founded: { firm?: string; capital: number; paid: boolean } | null = null;
    let pendingFirm = false; // a business we've just founded: its id comes back in the outcome
    const deliveries = new Deliveries();
    let departed = false;
    let todo: Step[] = [];
    let moveStep: Step | null = null; // the move-in step planned this wake
    let plannedAt = -1;
    let pendingRef: { kind: "rent"; agreement: string } | null = null;
    let moving = false; // a move-in is planned this wake
    let lastWasMove = false; // the action we last returned was that move-in
    // Word of mouth: who we know (entity -> when we last shared a home or workplace), whom we asked when,
    // who asked us, and the buildings people told us about.
    const contacts = new Map<string, number>();
    const askedAt: { [w in Want]?: number } = {};
    let asked: { from: string; want: Want }[] = [];
    let leads: string[] = []; // buildings, most recent last
    let looking: "leads" | "market" | null = null; // which search the next observation answers
    const leadFound: { homes: StatementRecord[]; jobs: StatementRecord[] } = { homes: [], jobs: [] };
    // Catching up: what the people we know told us they do, when; whom we've talked with, when; who asked us.
    const toldUs = new Map<string, News & { t: number }>();
    const talked = new Map<string, number>();
    let askedHow: string[] = [];
    let nextCatchUp: number | null = null;
    // Taking part in gatherings (practices): the one we're at, those we mean to go to (practice -> the time it starts), the
    // occurrences we've decided on, how many were there when we went, and those we went to last time.
    let attending: { practice: string; host: string; space: string; until: number } | null = null;
    const going = new Map<string, number>();
    const decidedFor = new Map<string, number>();
    const companyAt = new Map<string, number>();
    const wentLast = new Set<string>();
    const stayedLast = new Set<string>();
    let practiceWake: number | null = null;
    // Belief: each teaching we know of -> how strongly we hold it (basis points); when it last faded.
    const beliefs = new Map<string, number>(Object.entries(p.beliefs as { [k: string]: number }));
    let fadedAt: number | null = null;
    const teachingsOf = (host: string) => book.open("teaching").filter((r) => (r.speaks_for ?? r.author) === host);
    /** How strongly we hold what someone teaches (the most of their teachings). */
    const holdTo = (host: string) => Math.max(0, ...teachingsOf(host).map((r) => beliefs.get(r.id) ?? 0));
    /** Nearer certainty, by a share of the way (basis points of it). */
    const strengthen = (host: string, bps: number) => {
      for (const r of teachingsOf(host)) {
        const b = beliefs.get(r.id) ?? 0;
        beliefs.set(r.id, b + Math.round(((10_000 - b) * bps) / 10_000));
      }
    };
    const newsNow = (t: number) => [...toldUs.values()].filter((n) => t - n.t <= p.news_days * DAY);

    // Support paid to us, once our claim is granted (the decision says how much, how often), and whether it's the kind
    // we claim on retiring.
    let benefit: { claim: string; payment: string; amount: number; every: number; retired: boolean } | null = null;
    let claiming: string | null = null; // a claim we've made and not yet heard back on
    const refusedAt = new Map<string, number>(); // a kind of claim refused, at the age we were: not made again until we're older
    let retired = false;
    const inflows: { t: number; amount: number }[] = []; // money that came in (refunds counted negative), for what our income is
    const wageIncome = () => (job ? Math.floor((job.wage * MONTH) / job.period) : 0);
    // (Support for being out of work isn't income once we're in work: we stop claiming it. Counting it, a household applied
    // for a home only that income could afford, and then couldn't sign.)
    const benefitIncome = () => (benefit && (benefit.retired || !job) ? Math.floor((benefit.amount * MONTH) / benefit.every) : 0);
    const monthlyIncome = () => wageIncome() + benefitIncome();
    /** Income that keeps a household in town: work, or support in retirement (support while out of work is a stopgap). */
    const earnedIncome = () => wageIncome() + (benefit?.retired ? benefitIncome() : 0);

    // The household (a record the members keep; none: living alone, as the leaseholder of one).
    const year: number = p.year;
    let household: HouseholdData | undefined;
    const isLeaseholder = () => !household || household.leaseholder === me;
    const others = () => (household?.members ?? []).filter((m) => m.person !== me);
    const reach = (m: Member) => m.participant ?? m.person;
    let heard: { from: Member; what: Heard }[] = [];
    // As leaseholder: what the other adults earn (they tell us), and the shares of the rent we've told them.
    const memberPay = new Map<string, number>();
    const sharesTold = new Map<string, number>();
    let toldMoveIn: string | null = null; // the space we've told the household to move into
    // As another adult: where we live, our share of the rent, and the pay we last told the leaseholder.
    let livingAt: string | null = null;
    let share: { cents: number; order?: string } | null = null;
    let payTold = -1;
    // Deaths in the household: those we've seen (in our own home, someone leaving because they died).
    const mourned = new Set<string>();
    let wasLeaseholder: boolean | null = null;
    let askedForCare = false;
    // Children: those we already knew of (from the start), a pregnancy's due date, and when we next think about it.
    let knownChildren: Set<string> | null = null;
    let expectingUntil = 0;
    let nextFertility = ctx.rng("fertility-day").below(30) * DAY;
    const householdIncome = () => monthlyIncome() + (isLeaseholder() ? [...memberPay.values()].reduce((a, b) => a + b, 0) : 0);

    const learnFromInitialRecords = (obs: Observation) => {
      // Agreements already in force when we first look (the world's genesis records).
      for (const r of book.ofType("agreement")) {
        if (r.record !== "agreement" || !r.terms.parties.includes(me) || !book.inForce(r.id)) continue;
        const since = book.signedAt(r.id) ?? 0;
        const end = r.terms.term ? since + r.terms.term : Number.MAX_SAFE_INTEGER;
        if (r.terms.template === "lease" && !home) {
          const lt = leaseTerms(r, me);
          const landlord = r.terms.parties.find((x) => x !== me)!;
          const order = book.all("request").find((x) => x.record === "statement" && x.kind === "request" && x.basis === r.id && x.speaks_for === me)?.id;
          home = { agreement: r.id, space: lt.space!, structure: lt.structure!, landlord, rent: lt.rent, order, endsAt: end, movedIn: true };
        }
        if (r.terms.template === "employment" && !job) {
          const employer = r.terms.parties.find((x) => x !== me)!;
          job = { agreement: r.id, employer, ...jobTerms(r, me), endsAt: end, since };
          joinAsked = r.id; // (whether we belong to a union at the start is the world's)
        }
      }
      // Another adult's share of the rent, if one is already standing.
      const mine = book.all("request").find((r) => r.record === "statement" && r.kind === "request" && r.speaks_for === me && r.data?.outcome?.money?.for === "Household share of the rent.");
      if (mine && !share) share = { cents: cents((mine as any).data.outcome.money.amount), order: mine.id };
      void obs;
    };

    // Everything we observe, after every action (not just on waking).
    let fresh: ReturnType<Book["absorb"]> = [];
    const absorb = (obs: Observation) => {
      const news = book.absorb(obs);
      fresh.push(...news);
      // At work (docs/behaviour/unions.md), taken in as it's seen, before the money that comes with it: a rise in an
      // enterprise agreement (paid from the next pay day), a stoppage called, and the return to work (our pay restarts).
      for (const r of news) {
        if (r.record !== "statement" || !job) continue;
        if (r.kind === "enterprise_agreement" && r.data?.employer === job.employer && r.at >= job.since) {
          job.wage = Math.floor((job.wage * (10_000 + Number(r.data?.rise_bps ?? 0))) / 10_000);
          job.paidAt = obs.t;
          if (p.union && isMember()) {
            mind.learn("membership", "member", Math.min(10_000, 6_000 + Number(r.data?.rise_bps ?? 0) * 10)); // it paid
            // Grateful to the union, and surer of what it says.
            feelings.add("gratitude", p.union, 5_000, obs.t);
            strengthen(p.union, 1_000);
          }
        }
        if (!(r.addressed_to ?? []).includes(me)) continue;
        if (r.kind === "stop_work" && r.data?.employer === job.employer && !striking) {
          striking = { employer: job.employer, out: false };
          if (isMember()) mind.learn("membership", "member", 3_000); // pay lost for the time out
        }
        if (r.kind === "return_to_work" && striking && r.data?.employer === striking.employer) {
          backTo = striking.left ? { employer: striking.employer, space: striking.left } : null;
          striking = null;
          job.paidAt = obs.t; // our pay restarts from now (none for the time on strike)
        }
      }
      for (const c of channels.cells(obs)) if (home && c.structure?.structure === home.structure) homeSite = c.structure;
      if (pendingFirm && founded) {
        const id = obs.outcomes.flatMap((o) => (o.created?.firm ? [o.created.firm] : []))[0];
        if (id) {
          founded.firm = id;
          pendingFirm = false;
        } else if (obs.outcomes.some((o) => o.status === "refused")) {
          founded = null;
          pendingFirm = false;
        }
      }
      // Money that came in from others, for what our income is (refunds, which delivery notes tell us of, come off it).
      const mine = new Set(channels.accounts(obs).filter((a) => a.holder === me).map((a) => a.account));
      for (const tx of channels.transactions(obs)) if (mine.has(tx.to) && !mine.has(tx.from)) {
        inflows.push({ t: tx.t, amount: cents(tx.amount) });
        // Our wages, as agreed: the wage, less the income tax the law says our employer withholds.
        if (job && (cents(tx.amount) === job.wage || cents(tx.amount) === job.wage - withholding(incomeTaxLaw(book), job.wage, job.period))) {
          job.paidAt = tx.t;
          mind.learn("job", job.employer, 10_000); // an employer that pays, as agreed
        }
      }
      while (inflows.length && inflows[0]!.t < obs.t - p.income_window_days * DAY) inflows.shift();
      for (const k of ["homes", "jobs", "petitions"] as const) {
        const ch = obs.channels[k];
        if (ch?.kind !== "records" || !ch.search) continue;
        if (looking === "leads" && k !== "petitions") leadFound[k] = ch.records as StatementRecord[];
        else found[k] = ch.records as StatementRecord[];
      }
      // Words from people: someone asking around, or someone telling us where to look.
      household = householdOf(book, me)?.data;
      for (const m of obs.inbox) {
        const from = household?.members.find((x) => x.participant === m.from && x.person !== me);
        const what = from ? hear(m.text) : undefined;
        if (from && what) {
          heard.push({ from, what });
          continue;
        }
        const person = book.participantPerson.get(m.from) ?? m.from; // who wrote (the directory names their person)
        if (m.text === CATCHING_UP.ask) {
          askedHow.push(m.from);
          talked.set(person, obs.t);
          ties.add(person, 300, obs.t);
          continue;
        }
        const told = heardNews(m.text);
        if (told) {
          // What they do, and how it goes for them: counted as others doing it, and learned from as others' payoffs.
          toldUs.set(person, { ...told, t: obs.t });
          talked.set(person, obs.t);
          ties.add(person, 300, obs.t);
          if (told.shop && told.served !== undefined) mind.hear("shop", told.shop, told.served);
          if (told.employer && told.paid !== undefined) mind.hear("job", told.employer, told.paid ? 10_000 : 0);
          // Someone who keeps going somewhere finds it worth it (a placeholder for how much).
          // (All the more, if we hold with what it teaches.)
          for (const host of told.goesTo ?? []) for (const g of book.practices()) if ((g.speaks_for ?? g.author) === host) mind.hear("practice", g.id, Math.min(10_000, 7_000 + Math.round(holdTo(host) * p.belief.meaning)));
          // Told what someone holds: nearer to holding it ourselves, the more so the more conformist we are.
          for (const host of told.holdsTo ?? []) strengthen(host, Math.round((p.belief.told_bps * (5_000 + mind.person.temperament.conformity)) / 10_000));
          continue;
        }
        const want = (Object.keys(ASKING) as Want[]).find((w) => ASKING[w] === m.text);
        if (want) asked.push({ from: m.from, want });
        // A place someone names in reply to our asking (not a reply about a record: those are institutions answering requests).
        else if (m.re && (askedAt.home !== undefined || askedAt.work !== undefined) && !book.records.has(m.re)) {
          leads = [...leads.filter((x) => x !== m.re), m.re].slice(-5);
          leadFrom.set(m.re, book.participantPerson.get(m.from) ?? m.from);
        }
      }
      // Did the move-in we just attempted work?
      if (moving && lastWasMove && obs.outcomes.length) {
        if (obs.outcomes.at(-1)!.status === "applied" && home) home.movedIn = true;
        moving = false;
      }
      // The id of a rent-share standing order we just set up.
      if (share && !share.order) {
        const created = obs.outcomes.flatMap((o) => (o.created?.share ? [o.created.share] : []));
        if (created.length) share.order = created.at(-1);
      }
      // The id of a rent standing order we just set up.
      if (pendingRef && home && home.agreement === pendingRef.agreement) {
        const created = obs.outcomes.flatMap((o) => (o.created?.so ? [o.created.so] : []));
        if (created.length) {
          home.order = created.at(-1);
          pendingRef = null;
        }
      }
    };

    const plan = (obs: Observation): Step[] => {
      if (plannedAt === -1) learnFromInitialRecords(obs);
      const t = obs.t;
      // Our account at a bank (standing orders need one). Money brought from elsewhere is in our own keeping until we deposit it.
      const ours = channels.accounts(obs).filter((a) => a.holder === me).map((a) => ({ ...a, balance: cents(a.balance) }));
      const acc = ours.find((a) => a.custodian !== me);
      const steps: Step[] = [];
      if (acc) for (const k of ours) if (k.custodian === me && k.balance > 0) steps.push(because("Depositing the money we brought into our bank account.", pay(acc.account, k.balance, { from: k.account, for: "Deposit." })));
      moveStep = null;
      childrenNow = children(t);
      // Are we in a building? Around us we see who's in our own buildings; without that view, assume we are.
      const street = obs.channels.street;
      const inside = (space: string) =>
        street?.kind !== "sites" || street.cells.some((c) => c.structure?.spaces.some((sp) => sp.space === space && sp.occupants?.includes(me)));

      // A death at home: someone of the household left our home because they died (we see who left, and why).
      const ourHome = home?.space ?? livingAt;
      if (household && ourHome && street?.kind === "sites") {
        let hh: HouseholdData = household;
        const died = street.cells.flatMap((c) => c.structure?.spaces ?? []).filter((sp) => sp.space === ourHome).flatMap((sp) => sp.left ?? []).filter((l) => l.reason === "died");
        for (const d of died) {
          if (mourned.has(d.occupant) || !hh.members.some((m) => m.person === d.occupant)) continue;
          mourned.add(d.occupant);
          const dead = hh.members.find((m) => m.person === d.occupant)!;
          const heldLease = hh.leaseholder === dead.person;
          const survivors = hh.members.filter((m) => m.person !== d.occupant && !mourned.has(m.person));
          const grown = survivors.filter((m) => ageAt(m, t, year) >= ADULT_YEARS);
          const partner = hh.couples.find((c) => c.includes(dead.person))?.find((x) => x !== dead.person);
          const kids = survivors.filter((m) => m.parents?.includes(dead.person));
          const leaseholder = hh.leaseholder !== dead.person ? hh.leaseholder : (grown.find((m) => m.person === partner) ?? [...grown].sort((a, b) => a.born_at - b.born_at)[0])?.person;
          // The surviving adult first in the household's list reports it, and writes the household's new record.
          if (grown[0]?.person === me && p.registry) {
            steps.push(because(`${dead.person}, of our household, has died: reporting it to the registry.`, say("death_notification", `${dead.person} has died.`, {
              to: [p.registry],
              data: { deceased: dead.person, ...(partner && survivors.some((m) => m.person === partner) ? { partner } : {}),
                children: kids.map((k) => k.person), adult_children: kids.filter((k) => ageAt(k, t, year) >= ADULT_YEARS).map((k) => k.person) },
            })));
            if (leaseholder) {
              const next: HouseholdData = { ...hh, leaseholder, members: survivors, couples: hh.couples.filter((c) => !c.includes(dead.person)) };
              steps.push(because(`${dead.person} has died: the household's record without them${hh.leaseholder === dead.person ? `, ${leaseholder} holding the lease from now` : ""}.`, say("household", `Household: ${survivors.map((m) => m.person).join(", ")}.`, {
                to: survivors.map((m) => m.person), visible: survivors.map((m) => m.person), for: leaseholder, data: next,
              })));
              hh = next; // as we've just written it
            }
          }
          // Our share of the rent went to the one who died: stop it.
          if (share?.order && heldLease) {
            steps.push(because(`${dead.person} held the lease and has died: stopping our share of the rent to them.`, withdraw(share.order, "The leaseholder has died.")));
            share = null;
          }
        }
        household = hh;
      }

      // Newly holding the household's lease (the leaseholder died): we start looking for a home from today.
      if (wasLeaseholder === false && isLeaseholder() && !home) homelessSince = t;
      wasLeaseholder = isLeaseholder();

      if (!isLeaseholder()) {
        // Another adult in the household: we live where the household lives, and move when the leaseholder says.
        if (livingAt === null && street?.kind === "sites")
          livingAt = street.cells.flatMap((c) => c.structure?.spaces ?? []).find((sp) => sp.kind === "dwelling" && sp.occupants?.includes(me))?.space ?? null;
        for (const { what } of heard) {
          if (what.kind === "moveIn" && what.space !== livingAt) {
            const s: Step = because(`The household has a new home (${what.space}): moving in with them.`);
            if (livingAt && inside(livingAt)) s.push(moveOut(livingAt, me));
            s.push(moveIn(what.space));
            steps.push(s);
            livingAt = what.space;
          } else if (what.kind === "moveOut" && livingAt && structureOf(livingAt) === what.from) {
            if (inside(livingAt)) steps.push(because("The household's tenancy has ended: moving out with them.", moveOut(what.from, me)));
            livingAt = null;
          } else if (what.kind === "share" && acc && what.cents !== (share?.cents ?? 0)) {
            const s: Step = because(`Our share of the household's rent is now ${usd(what.cents)} a month, as the leaseholder says.`);
            if (share?.order) s.push(withdraw(share.order, "Replaced by a new share of the rent."));
            if (what.cents > 0) s.push(["share", pay(what.account, what.cents, { from: acc.account, every: MONTH, first: 0, for: "Household share of the rent." })]);
            if (s.length) steps.push(s);
            share = what.cents > 0 ? { cents: what.cents } : null;
          } else if (what.kind === "leaving") {
            heard = [];
            return departure(acc, "The household is leaving town: going with them.");
          }
        }
        heard = [];
        if (!acc) return withoutAccount(steps);
        // The leaseholder budgets with what we earn: we tell them when it changes.
        const lh = household!.members.find((m) => m.person === household!.leaseholder);
        if (lh && payTold !== monthlyIncome()) {
          payTold = monthlyIncome();
          steps.push(because("Telling the leaseholder what we now earn, for the household's budget.", message([reach(lh)], SAYING.pay(payTold))));
        }
      } else {
        for (const { from, what } of heard) if (what.kind === "pay") memberPay.set(from.person, what.cents);
        heard = [];
        if (!acc) return withoutAccount(steps);
      }

      // A child born to us: bring them home, and (as the one who bore them) add them to the household's record.
      const body = obs.body;
      if (body) {
        const kids = body.children ?? [];
        if (!knownChildren) knownChildren = new Set(kids.map((k) => k.person));
        for (const k of kids) {
          if (knownChildren.has(k.person) || !k.alive) continue;
          knownChildren.add(k.person);
          // The parent who bore the child does it (the other parent sees the child too).
          if (body.sex !== "female") continue;
          // A child of the household now, wherever the household goes (before the record says so).
          if (!childrenNow.some((c) => c.person === k.person)) childrenNow.push({ person: k.person, born_at: k.born_at, sex: k.sex } as Member);
          const where = home?.movedIn ? home.space : livingAt;
          if (where) steps.push(because("Our baby is born: bringing them home.", C.call("occupancy", { in: where, who: k.person })));
          if (household && k.sex) {
            const partner = household.couples.find((c) => c.includes(me))?.find((x) => x !== me);
            const father = partner && household.members.find((m) => m.person === partner && m.sex === "male")?.person;
            const members = [...household.members, { person: k.person, born_at: k.born_at, sex: k.sex, parents: father ? [me, father] : [me] }];
            steps.push(because("Our baby is born: adding them to the household's record.", say("household", `Household: ${members.map((m) => m.person).join(", ")}.`, {
              to: members.map((m) => m.person), visible: members.map((m) => m.person), for: household.leaseholder,
              data: { ...household, members },
            })));
          }
        }
        // Having a child: a woman of an age to, not already expecting, once a month, at the rate for her age.
        const age = Math.floor((t - body.born_at) / year);
        if (body.sex === "female" && p.births && body.present && t >= nextFertility && t >= expectingUntil) {
          nextFertility = t + MONTH;
          const rate = [...(p.fertility_per_10000 as { from: number; rate: number }[])].reverse().find((r) => age >= r.from)?.rate ?? 0;
          if (rate > 0 && ctx.rng(`conceive-${t}`).below(120_000) < rate) {
            const partner = household?.couples.find((c) => c.includes(me))?.find((x) => x !== me);
            const man = partner && household!.members.find((m) => m.person === partner && m.sex === "male");
            // With a partner, only when they're here with us (we see who's in our own home).
            const together = !man || (street?.kind === "sites" && street.cells.some((c) => c.structure?.spaces.some((sp) => sp.occupants?.includes(me) && sp.occupants?.includes(man.person))));
            if (together) expectingUntil = t + p.gestation + MONTH;
            if (together) steps.push(because(`Having a child: at ${age}, the chance this month is ${rate} in 120,000 (${rate} births per 10,000 women a year at this age).`,
              C.call("birth", { name: C.text(`baby of ${me}`), template: childTemplate(), ...(man ? { with: man.person } : {}) })));
          }
        }
      }

      // Notices on our agreements move their end dates.
      for (const r of fresh) {
        if (r.record !== "notice" || r.as === me) continue;
        const a = book.records.get(r.agreement);
        if (a?.record !== "agreement") continue;
        const notice = a.terms.termination?.find((x) => x.party === r.as)?.notice ?? MONTH;
        if (home?.agreement === r.agreement) home.endsAt = Math.min(home.endsAt, r.at + notice);
        if (job?.agreement === r.agreement) job.endsAt = Math.min(job.endsAt, r.at + notice);
      }

      // An old rent's last payment made: stopping its order (the new rent's has taken over).
      if (home?.retiring?.some((x) => t >= x.at)) {
        for (const x of home.retiring.filter((x) => t >= x.at)) steps.push(because("The old rent's last payment is made: stopping its order; the new rent's takes over.", withdraw(x.order, "Rent increased; replaced by a new standing order.")));
        home.retiring = home.retiring.filter((x) => t < x.at);
      }
      // A tenancy that has ended: move out and stop paying rent.
      if (home && t >= home.endsAt) {
        // Looking for somewhere cheaper (a goal's method): for the first month of the hunt, only homes that beat this rent.
        if (pursuing("cheaper home")) cheaperThan = { rent: Math.floor((home.rent * p.goals.cheaper_bps) / 10_000), until: t + MONTH };
        const s: Step = because(`Our tenancy of ${home.space} has ended: moving out and stopping the rent${cheaperThan ? `; we'll look for somewhere cheaper, under ${usd(cheaperThan.rent)} a month` : ""}.`, ...(home.movedIn ? [moveOut(home.structure, me)] : []));
        if (home.order) s.push(withdraw(home.order, "Tenancy ended; stop this standing order."));
        for (const x of home.retiring ?? []) s.push(withdraw(x.order, "Tenancy ended; stop this standing order."));
        home.retiring = [];
        if (s.length) steps.push(s);
        // The children come out with us (each on its own, in case one isn't there); the other adults are told.
        if (home.movedIn) for (const k of children(t)) steps.push(because("Our tenancy has ended: taking the children out with us.", moveOut(home.structure, k.person)));
        for (const a of adults(t)) steps.push(because("Our tenancy has ended: telling the household, and that there's no rent to share for now.", message([reach(a)], SAYING.moveOut(home.structure)), message([reach(a)], SAYING.share(0, acc.account)))), sharesTold.set(a.person, 0);
        toldMoveIn = null;
        home = null;
        homelessSince = t;
      }
      // Wages not paid: a pay period (and a few days' grace) without them, we resign, and claim what we're owed, as an
      // employee can (docs/behaviour/citizen.md). The claim is a debt recorded against the employer.
      if (job && !job.claimed && t < job.endsAt && !striking) {
        const last = job.paidAt ?? job.since;
        if (t - last > job.period + 5 * DAY) {
          job.claimed = true;
          mind.learn("job", job.employer, 0); // an employer that didn't pay: remembered
          feelings.feel("anger", job.employer, 8_000, t);
          const missed = Math.max(1, Math.floor((t - last) / job.period));
          steps.push(because(`Our wages haven't been paid for ${Math.floor((t - last) / DAY)} days: resigning, and claiming the ${usd(missed * job.wage)} we're owed.`,
            notice(job.agreement, "Resigning: our wages haven't been paid."),
            record("right", me, { kind: "debt", amount: missed * job.wage, for: `Unpaid wages (${missed} pay period${missed > 1 ? "s" : ""}).` }, { against: job.employer, basis: job.agreement })));
          job.endsAt = t;
        }
      }
      // A job that has ended.
      if (job && t >= job.endsAt) {
        if (job.workplace && inside(job.workplace)) steps.push(because("Our job has ended: leaving the workplace.", moveOut(job.workplace, me)));
        job = null;
        joblessSince = t;
      }
      // Our notice worked out: starting the job we're moving to (signing the offer we took, and going to work there).
      if (!job && switching) {
        const r = book.records.get(switching.offer);
        switching = null;
        if (r?.record === "agreement" && !book.signedBy(r.id, me) && !retired) {
          const terms = jobTerms(r, me);
          const s: Step = because(`Our notice is worked out: starting the job we took (${usd(terms.wage)} every ${Math.round(terms.period / DAY)} days).`, sign(r.id));
          if (terms.workplace) s.push(moveIn(terms.workplace));
          steps.push(s);
          job = { agreement: r.id, employer: r.terms.parties.find((x) => x !== me)!, ...terms, endsAt: r.terms.term ? t + r.terms.term : Number.MAX_SAFE_INTEGER, since: t };
          joblessSince = null;
        }
      }
      if (!home && homelessSince === null) homelessSince = t;
      // How well each need is met, as this citizen judges its own life (docs/design/ai-citizens.md 3a). Placeholders
      // for how each is read from the world, to calibrate: goods in hand against a fortnight's use; a home of our own;
      // savings against a month's outgoings; a household; work.
      const needLevels = (): NeedLevels => {
        const held = channels.holdings(obs).filter((h) => h.kind === p.goods).reduce((x, h) => x + Number(h.quantity), 0);
        const outgoings = Math.max(p.essentials, (home?.rent ?? share?.cents ?? 0) + p.essentials);
        return {
          subsistence: Math.min(10_000, Math.round((held * 10_000) / Math.max(1, p.essentials_units))),
          shelter: home ? 10_000 : livingAt ? 6_000 : 0,
          security: Math.min(10_000, Math.round((acc.balance * 2_500) / Math.max(1, outgoings))),
          // Company: living with others, and the people we've talked with this past month (up to three count).
          social: (household && household.members.length > 1 ? 5_000 : 2_000) + 1_000 * Math.min(3, [...talked.values()].filter((x) => t - x <= MONTH).length),
          status: job ? 7_000 : retired ? 6_000 : 3_000,
        };
      };
      levelsNow = needLevels();
      // Afraid for our money when it's running short (the security need well below met).
      if (levelsNow.security < 5_000) feelings.feel("fear", "money", (5_000 - levelsNow.security) * 2, t);
      // Goals (HTN, lite): a need long unmet becomes a goal, pursued by one method, then another, in the order our values
      // favour; met when the need recovers, given up (for a while) when nothing's left to try. Each choice is recorded.
      {
        const G = p.goals;
        const ways: { [goal: string]: { need: "security" | "social"; below: number; methods: [string, boolean, number][] } } = {
          "make ends meet": { need: "security", below: G.security_bps, methods: [
            ["better work", !retired && p.in_labour_force, zValue("achievement") + zValue("stimulation")],
            ["spend less", true, zValue("security") + zValue("conformity")],
            ["cheaper home", !!home && isLeaseholder(), zValue("security") - zValue("tradition")],
          ] },
          "more company": { need: "social", below: G.social_bps, methods: [
            ["catch up more", contacts.size > 0, zValue("benevolence")],
            ["try a gathering", book.practices().length > 0, (zValue("stimulation") + zValue("benevolence")) / 2],
          ] },
        };
        for (const [goal, w] of Object.entries(ways)) {
          const pur = pursuits.get(goal);
          if (levelsNow[w.need] >= w.below) {
            unmetSince.delete(goal);
            if (pur) pursuits.delete(goal);
            continue;
          }
          if (!unmetSince.has(goal)) unmetSince.set(goal, t);
          const record = (choice: string | undefined, options: [string, boolean, number][]) =>
            decided.push({ t, domain: "goal", strategy: "deliberate", ...(choice ? { choice: `${goal}: ${choice}` } : {}), options: options.map(([m, , z]) => ({ key: `${goal}: ${m}`, score: Math.round(z * 1_000) })) });
          if (!pur && t - unmetSince.get(goal)! >= G.unmet_days * DAY && t >= (restUntil.get(goal) ?? 0)) {
            const open = w.methods.filter(([, ok]) => ok).sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : 1));
            if (open.length) {
              pursuits.set(goal, new Pursuit(goal, open.map(([m]) => m), t));
              record(open[0]![0], open);
            }
          } else if (pur && t - pur.since >= G.method_days * DAY) {
            const next = pur.next(t);
            record(next, w.methods.filter(([m]) => pur.methods.includes(m)));
            if (!next) {
              pursuits.delete(goal);
              restUntil.set(goal, t + G.rest_days * DAY);
            }
          }
        }
      }
      const circumstances = (): Circumstances => ({ monthly_income: householdIncome(), savings: acc.balance, homeless: !home && !livingAt });
      if (!job && joblessSince === null) joblessSince = t;

      // Offers made to us: sign what we asked for and can afford.
      for (const r of fresh) {
        if (r.record !== "agreement" || !r.terms.parties.includes(me) || book.signedBy(r.id, me)) continue;
        const other = r.terms.parties.find((x) => x !== me)!;
        if (r.terms.template === "lease" && !home) {
          const { rent, rentTo, space, structure } = leaseTerms(r, me);
          if (!space || !structure || !rentTo || !affordable(rent, acc.balance)) continue;
          // Signing (a record) and moving in (physics) are separate acts: the
          // flat may not be free yet if the last tenant hasn't left.
          steps.push(because(`Signing the lease offered for ${space}: ${usd(rent)} a month is within our budget (a third of household income, ${usd(Math.floor((householdIncome() * p.rent_share_bps) / 10_000))}; or six months' rent in savings without income)${thank(structure, t)}.`,
            sign(r.id),
            ["so", pay(rentTo, rent, { from: acc.account, every: MONTH, first: 0, basis: r.id, for: `Rent for ${space}, monthly in advance.` })],
          ));
          home = { agreement: r.id, space, structure, landlord: other, rent, endsAt: t + (r.terms.term ?? 365 * DAY), movedIn: false };
          pendingRef = { kind: "rent", agreement: r.id };
          homelessSince = null;
        } else if (r.terms.template === "employment" && !job) {
          const terms = jobTerms(r, me);
          const s: Step = because(`Taking the job offered: ${usd(terms.wage)} every ${Math.round(terms.period / DAY)} days${thank(terms.workplace ? structureOf(terms.workplace) : undefined, t)}.`, sign(r.id));
          if (terms.workplace) s.push(moveIn(terms.workplace));
          steps.push(s);
          job = { agreement: r.id, employer: other, ...terms, endsAt: r.terms.term ? t + r.terms.term : Number.MAX_SAFE_INTEGER, since: t };
          joblessSince = null;
        } else if (r.terms.template === "employment" && job && !switching && !retired && other !== job.employer) {
          // Offered a better-paid job while in one (we applied for it): we take it, give notice at ours, and start the
          // new one when the notice is worked out.
          const terms = jobTerms(r, me);
          if (terms.wage * job.period <= job.wage * terms.period) continue;
          const old = book.records.get(job.agreement);
          const noticeDays = old?.record === "agreement" ? old.terms.termination?.find((x) => x.party === me)?.notice ?? 14 * DAY : 14 * DAY;
          switching = { offer: r.id, wage: terms.wage };
          job.endsAt = Math.min(job.endsAt, t + noticeDays);
          steps.push(because(`Offered a better-paid job (${usd(terms.wage)} every ${Math.round(terms.period / DAY)} days, against our ${usd(job.wage)} every ${Math.round(job.period / DAY)}): taking it, and giving our employer the notice our contract asks.`,
            notice(job.agreement, "Resigning: moving to another job.")));
        }
      }

      // The union (docs/behaviour/unions.md): joining on starting a job, with the chance for its kind of employer; the
      // membership offered, signed, and its dues paid monthly; a protected action ballot, voted in (or not); a
      // stoppage, observed (out of the workplace until the return to work); a rise in an enterprise agreement, taken.
      // What joining would mean to someone like us, if the run has the sparse mind (docs/design/ai-citizens.md 4): asked
      // once, and the decision waits for the answer (by the next wake).
      const saidJoin = p.union && job && joinAsked !== job.agreement && !retired && !isMember()
        ? consult(`join:${p.union}`, "Joining the workers' union on starting a new job. The union represents its members at work and bargains for their pay and conditions; members pay dues each month, and may be called out on strike, unpaid.",
          [{ key: "join", words: "join the union" }, { key: "not", words: "don't join" }], acc.balance, t)
        : undefined;
      if (p.union && job && joinAsked !== job.agreement && !retired && saidJoin !== "pending") {
        joinAsked = job.agreement;
        const member = book.ofType("agreement").some((r) => r.record === "agreement" && r.terms.template === "membership" && r.terms.parties.includes(me) && book.inForce(r.id));
        // The work's industry, as its posting said (none known: "other").
        const industry = industryOf.get(job.employer) ?? "other";
        // The industry's rate (the cited prior), shifted by the person's solidarity, and by what membership has done for
        // them (learned: a raise it won paid, a strike's lost pay didn't).
        const learnedMember = mind.learned("membership").known("member") ? (mind.learned("membership").get("member") - 5_000) / 10_000 : 0;
        const rate = p.union_join_bps[industry] ?? p.union_join_bps.other ?? 0;
        // And by what those we know who work there do: the conformist leans toward the share of them who belong (Boyd
        // and Richerson's conformist transmission).
        const peers = newsNow(t).filter((n) => n.employer === job!.employer && n.member !== undefined);
        const peerShare = peers.length ? (peers.filter((n) => n.member).length * 10_000) / peers.length : null;
        const conform = peerShare === null ? 0 : (p.sway.union_peers * mind.person.temperament.conformity * (peerShare - rate)) / 10_000 / Math.max(1, rate);
        // And by whether we hold with what the union teaches.
        const creed = p.union ? (p.sway.union_belief * holdTo(p.union)) / 10_000 : 0;
        // And by what the model says it would mean to someone like us, if asked.
        const meant = saidJoin ? (p.sway.consult * ((saidJoin.join ?? 0) - (saidJoin.not ?? 0))) / 10_000 : 0;
        const chance = shifted(rate, p.sway.union_join * (zValue("benevolence") + zValue("universalism")) / 2 + learnedMember + conform + creed + meant);
        if (!member && ctx.rng(`join-${job.agreement}`).below(10_000) < chance)
          steps.push(because(`A new job: joining the union (${rate / 100}% of those working in ${industry.replaceAll("_", " ")} do; for me, ${chance / 100}%${saidJoin ? `, thinking what it would mean to me: ${Math.round((saidJoin.join ?? 0) / 1_000)} of 10 against ${Math.round((saidJoin.not ?? 0) / 1_000)} not to` : ""}).`, say("membership_application", "Application to join.", { to: [p.union], visible: [me, p.union], data: { account: acc.account, employer: job.employer } })));
      }
      for (const r of fresh) {
        if (r.record === "agreement" && r.terms.template === "membership" && r.terms.parties.includes(me) && !book.signedBy(r.id, me)) {
          const dues = commitmentOf(r, me).outcome?.money;
          steps.push(because(`Joining the union: signing, and paying the dues monthly.`, sign(r.id),
            ...(dues ? [pay(dues.to, cents(dues.amount), { from: acc.account, every: MONTH, first: 0, basis: r.id, for: "Union dues." })] : [])));
          continue;
        }
        if (r.record !== "statement" || !(r.addressed_to ?? []).includes(me)) continue;
        // Voting, and how, follow the person: those who value others' welfare (benevolence, universalism) turn out and
        // back action more; those who value security, less (the town's rates stay as calibrated).
        const solidarity = (zValue("benevolence") + zValue("universalism")) / 2;
        if (r.kind === "action_ballot" && ctx.rng(`turnout-${r.id}`).below(10_000) < shifted(p.ballot_turnout_bps, p.sway.turnout * solidarity)) {
          const yes = ctx.rng(`vote-${r.id}`).below(10_000) < shifted(p.strike_vote_yes_bps, p.sway.strike_vote * (solidarity - zValue("security")));
          steps.push(because(`The union's protected action ballot: voting ${yes ? "yes" : "no"}.`, vote(r.id, yes ? "yes" : "no")));
        }
      }
      if (striking && !striking.out && job) {
        striking.out = true;
        striking.left = job.workplace && inside(job.workplace) ? job.workplace : undefined;
        steps.push(because(`The union's stoppage at ${job.employer}: stopping work.`, ...(striking.left ? [moveOut(striking.left, me)] : [])));
      }
      if (backTo) {
        // (Only if we still work there: a job may have ended, or another begun, in the meantime.)
        if (job?.employer === backTo.employer && job.workplace === backTo.space) steps.push(because("The stoppage is over: back to work.", moveIn(backTo.space)));
        backTo = null;
      }

      // A rent increase on our home (the landlord's notice, as the tenancy law allows): if we can still afford it, we pay
      // the new rent from when it starts; if not, we give notice and look for somewhere else.
      if (home && isLeaseholder()) for (const r of fresh) {
        if (r.record !== "statement" || r.kind !== "rent_increase" || r.data?.lease !== home.agreement || !(r.addressed_to ?? []).includes(me)) continue;
        const rent = cents(r.data.rent);
        // Angry with the landlord, the more so the more of our income it takes (a placeholder scale).
        const riseShare = householdIncome() > 0 ? ((rent - home.rent) * 10_000) / householdIncome() : 10_000;
        if (rent > home.rent) feelings.feel("anger", home.landlord, 2_000 + 20 * riseShare, t);
        const lease = book.records.get(home.agreement);
        const rentTo = lease ? leaseTerms(lease, me).rentTo : undefined;
        if (affordable(rent, acc.balance) && rentTo) {
          const s: Step = because(`Our rent goes up to ${usd(rent)} a month (from ${usd(home.rent)}): still within our budget, so we'll pay it from when it starts.`);
          // The new rent is paid on the same days as the old, from the first after it starts; the old order runs until
          // then, and is stopped once its last payment is made (a bank's standing order has no end date to give it).
          let starts = Math.max(t, Number(r.data.from));
          let stopAt = t;
          const old = home.order ? (book.records.get(home.order) as any) : undefined;
          if (old && Number.isInteger(old.data?.every) && old.data.every > 0) {
            const every = old.data.every as number;
            const due0 = old.at + (Number.isInteger(old.data.first) ? old.data.first : every);
            starts = due0 >= starts ? due0 : due0 + Math.ceil((starts - due0) / every) * every;
            stopAt = starts - every + DAY;
          }
          if (home.order && stopAt <= t) s.push(withdraw(home.order, "Rent increased; replaced by a new standing order."));
          else if (home.order) home.retiring = [...(home.retiring ?? []), { order: home.order, at: stopAt }];
          s.push(["so", pay(rentTo, rent, { from: acc.account, every: MONTH, first: starts - t, basis: home.agreement, for: `Rent for ${home.space}, monthly in advance.` })]);
          steps.push(s);
          home.rent = rent;
          home.order = undefined;
          pendingRef = { kind: "rent", agreement: home.agreement };
        } else {
          steps.push(because(`Our rent goes up to ${usd(rent)} a month, beyond what we can afford (a third of household income, ${usd(Math.floor((householdIncome() * p.rent_share_bps) / 10_000))}): giving notice, to find somewhere else.`,
            notice(home.agreement, "We can't afford the new rent.")));
          home.endsAt = Math.min(home.endsAt, t + 30 * DAY);
        }
      }

      // Moving into a home we hold a lease on, once there's physical room: with the children, in one go.
      if (home && !home.movedIn && livingAt && livingAt !== home.space) {
        // We still live where the household used to (the lease there wasn't ours): leave it first.
        if (inside(livingAt)) steps.push(because("Moving out of our old home, to the one we now hold a lease on.", moveOut(livingAt, me)));
        for (const k of children(t)) steps.push(because("Taking the children out of our old home.", moveOut(livingAt, k.person)));
        livingAt = null;
      }
      if (home && !home.movedIn) {
        moveStep = because(`Moving into ${home.space}, which we hold a lease on${children(t).length ? ", with the children" : ""}.`, moveIn(home.space), ...children(t).map((k) => C.call("occupancy", { in: home!.space, who: k.person })));
        steps.push(moveStep);
        moving = true;
      }
      // Moved in: the other adults are told to come, and what their share of the rent is (split evenly among those earning).
      if (home?.movedIn && isLeaseholder()) {
        const grown = adults(t);
        if (toldMoveIn !== home.space) {
          for (const a of grown) steps.push(because("We've moved in: telling the household to come.", message([reach(a)], SAYING.moveIn(home.space))));
          toldMoveIn = home.space;
        }
        const earners = (monthlyIncome() > 0 ? 1 : 0) + grown.filter((a) => (memberPay.get(a.person) ?? 0) > 0).length;
        for (const a of grown) {
          if (!memberPay.has(a.person)) continue; // not heard what they earn yet
          const due = memberPay.get(a.person)! > 0 ? Math.floor(home.rent / Math.max(1, earners)) : 0;
          if ((sharesTold.get(a.person) ?? genesisShare(a)) !== due) {
            steps.push(because(`Telling a member of the household their share of the ${usd(home.rent)} rent: split evenly among the ${earners} of us earning.`, message([reach(a)], SAYING.share(due, acc.account))));
          }
          sharesTold.set(a.person, due);
        }
      }

      // Leaving town (exit), decided by the leaseholder for the household: long without a home, or without
      // anyone earning and without money.
      const broke = acc.balance < Math.max(home?.rent ?? 0, p.essentials);
      // Patience with a place follows the person: those who value tradition and security hold on longer.
      const patience = Math.max(0.5, Math.min(1.5, 1 + p.sway.patience_tradition * zValue("tradition") + p.sway.patience_security * zValue("security")));
      const homelessDays = Math.round(p.leave_after_homeless_days * patience);
      const joblessDays = Math.round(p.leave_after_jobless_days * patience);
      const leave = isLeaseholder() && (
        (homelessSince !== null && t - homelessSince >= homelessDays * DAY) ||
        (joblessSince !== null && t - joblessSince >= joblessDays * DAY && earnedIncome() + (isLeaseholder() ? [...memberPay.values()].reduce((a, b) => a + b, 0) : 0) === 0 && broke));
      if (leave) {
        const why = homelessSince !== null && t - homelessSince >= homelessDays * DAY
          ? `Leaving town: ${Math.floor((t - homelessSince) / DAY)} days without a home (we leave after ${homelessDays}).`
          : `Leaving town: ${Math.floor((t - joblessSince!) / DAY)} days with nobody in the household earning (we leave after ${joblessDays}), and less money than a month's rent or essentials.`;
        const tell: Step[] = adults(t).map((a) => because(why, message([reach(a)], SAYING.leaving())));
        // What's already planned this wake (a newborn brought home and put on the household's record) comes first.
        return [...steps, ...tell, ...departure(acc, why)];
      }

      wordOfMouth(obs, t, steps);

      // Taking part (docs/design/ai-citizens.md 2b): gatherings the world holds (practices), where we may come. Going is
      // physics: being in the space for its time. Whether to go is the mind's: the company it brings against the time it
      // takes, how it went the times we went, and who we know goes.
      {
        const age = obs.body ? (t - obs.body.born_at) / year : 0;
        const mayCome = (w?: Eligibility) => !w || ((!w.members_of || memberOf(w.members_of)) && !w.holds && (!w.entities || w.entities.includes(me)) && (!w.min_age_years || age >= w.min_age_years));
        const there = (space: string) => street?.kind === "sites" ? (street.cells.flatMap((c) => c.structure?.spaces ?? []).find((sp) => sp.space === space)?.occupants ?? []).filter((o) => o !== me) : [];
        // Back from one: who was there, and how it was (turned away, it counts for nothing).
        if (attending && t >= attending.until) {
          const others = there(attending.space);
          const got = inside(attending.space);
          // (What it teaches, held, makes it mean more; and others there, keeping to it at a cost of their time, make it
          // more credible: Henrich's credibility-enhancing displays.)
          const meaning = Math.round(holdTo(attending.host) * p.belief.meaning);
          mind.learn("practice", attending.practice, got ? Math.min(10_000, Math.round(Math.log1p(others.length) * 2_500) + meaning) : 0);
          if (got) strengthen(attending.host, Math.round((p.belief.display_bps * Math.min(20, others.length)) / 20));
          if (got) {
            steps.push(because(`${attending.host}'s gathering is over (${others.length} others were there): going home.`, moveOut(attending.space, me)));
            companyAt.set(attending.practice, others.length);
            for (const o of others) {
              talked.set(o, t);
              ties.add(o, 100, t);
            }
          }
          attending = null;
        }
        // Belief fades, a month at a time, unless something keeps it up.
        if (fadedAt === null) fadedAt = t;
        while (t - fadedAt >= MONTH) {
          fadedAt += MONTH;
          for (const [k, b] of beliefs) beliefs.set(k, b - Math.round((b * p.belief.fade_bps) / 10_000));
        }
        practiceWake = null;
        const heard = newsNow(t);
        for (const r of book.practices()) {
          const pr = r.practice!;
          if (!(pr.roles ?? [{ role: "attendee", open: true }]).some((x) => x.open && mayCome(x.who))) continue;
          const first = pr.first ?? r.at;
          const lasts = pr.lasts ?? 3_600;
          const host = r.speaks_for ?? r.author;
          let start = first + Math.max(0, Math.floor((t - first) / pr.every)) * pr.every;
          if (t >= start + lasts) start += pr.every;
          if (t >= start) {
            // On now: there, if we meant to go.
            if (going.get(r.id) === start && !attending) {
              going.delete(r.id);
              attending = { practice: r.id, host, space: pr.at, until: start + lasts };
              if (!inside(pr.at)) steps.push(because(`Going to ${host}'s gathering.`, moveIn(pr.at)));
            }
          } else if (start - t <= 7 * DAY && decidedFor.get(r.id) !== start) {
            // The first time: our routine, as it stands. We go if a membership of ours says we take part (and know it for
            // what it's been); otherwise our evenings are our own.
            if (!decidedFor.has(r.id)) {
              if (!mind.learned("practice").known("stay")) mind.learn("practice", "stay", 5_000);
              const ours = book.ofType("agreement").some((a) => a.record === "agreement" && a.terms.parties.includes(me) && book.inForce(a.id) &&
                a.terms.commitments.some((c: any) => c.who === me && c.does?.outcome?.attend?.practice === r.id));
              if (ours) {
                wentLast.add(r.id);
                if (!mind.learned("practice").known(r.id)) mind.learn("practice", r.id, Math.min(10_000, 7_000 + Math.round(holdTo(host) * p.belief.meaning)));
              } else stayedLast.add(r.id);
            }
            // Coming up this week: going or not. Its company as we found it, or as many as we know go; its time.
            decidedFor.set(r.id, start);
            const friends = heard.filter((n) => n.goesTo?.includes(host)).length;
            const d = decide("practice", t, ctx.rng(`practice-${r.id}-${start}`), {
              options: [
                { key: r.id, facts: { money_per_month: 0, company: Math.max(companyAt.get(r.id) ?? 0, friends), time_hours_per_month: Math.round(((lasts / 3_600) * MONTH) / pr.every) }, others: friends, meaning: Math.round(holdTo(host) * p.belief.meaning) },
                { key: "stay", facts: { money_per_month: 0 } },
              ],
              current: wentLast.has(r.id) ? r.id : stayedLast.has(r.id) ? "stay" : undefined, // our routine, if we have one
              levels: needLevels(), circ: circumstances(),
              // (Trying a gathering, for company: our evenings aren't enough, and we give each real thought.)
              ...(pursuing("try a gathering") && !wentLast.has(r.id) ? { satisfied_here: 0, doubt: 10_000 } : {}),
            });
            if (d.key === r.id) {
              going.set(r.id, start);
              wentLast.add(r.id);
              stayedLast.delete(r.id);
            } else {
              wentLast.delete(r.id);
              stayedLast.add(r.id);
              // An evening at home: as good as the company we have there.
              mind.learn("practice", "stay", levelsNow.social);
            }
          }
          const next = going.get(r.id);
          if (next !== undefined && next > t) practiceWake = Math.min(practiceWake ?? next, next);
        }
        if (attending) practiceWake = Math.min(practiceWake ?? attending.until, attending.until);
      }

      // A service not done: waste piling up at home for `complain_after_days` days' worth. The leaseholder writes to
      // the town, with the week's chance, once until it's seen to.
      if (p.complain_to && home && isLeaseholder() && homeSite?.structure === home.structure) {
        const v = homeSite.variables?.[p.complain_about];
        const now = variableToday(v, t) ?? 0;
        const rate = v?.per_day ?? 0;
        if (complainedOf === home.structure && now < rate * 7) complainedOf = null;
        // Angry with whoever should collect it, the more so the longer it's been (half-way at `complain_after_days`);
        // we write once our anger passes our own threshold (the conformist bears it longer), with the week's chance.
        if (rate > 0) feelings.feel("anger", p.complain_to, Math.min(10_000, (now * 5_000) / (rate * p.complain_after_days)), t);
        const bearing = 5_000 + Math.round((mind.person.temperament.conformity - 5_000) * 0.4);
        // (And only while it's still there: a week's worth or more.)
        if (rate > 0 && now >= rate * 7 && feelings.level("anger", p.complain_to, t) >= bearing && complainedOf !== home.structure && ctx.rng(`complain-${t}`).below(10_000) < p.complain_bps) {
          complainedOf = home.structure;
          steps.push(because(`Our ${p.complain_about} hasn't been collected for about ${Math.floor(now / rate)} days: writing to the town.`,
            say("complaint", `Our ${p.complain_about} at ${home.structure} hasn't been collected for about ${Math.floor(now / rate)} days.`, { to: [p.complain_to], visible: [me, p.complain_to], data: { structure: home.structure, about: p.complain_about, days: Math.floor(now / rate) } })));
        }
      }

      // Looking for a home: what someone told us about first, then the best one we can afford among the listings we've seen.
      if (isLeaseholder() && !home) {
        const fits = (l: StatementRecord) => !applied.has(l.id) && affordable(l.data?.rent ?? Infinity, acc.balance) && (l.data?.bedrooms ?? 0) >= minBedrooms(t);
        const told = leadFound.homes.filter(fits);
        const listings = [...told, ...found.homes.filter((l) => !told.includes(l))].filter(fits);
        // Which one: the mind's (docs/design/ai-citizens.md 3). Each home's offer (its rent) and its bedrooms appraised
        // against needs; where friends told us to look counts as others having gone there. (A home we can't afford, or
        // without the bedrooms we must have, isn't considered.)
        const need = household ? bedroomsNeeded(household, t, year) : 1;
        const toldBy = new Set(told.map((l) => l.id));
        const d = listings.length ? decide("home", t, ctx.rng(`home-${t}`), {
          options: listings.map((l) => {
            const f = l.offer ? factsOf(l.offer) : { money_per_month: -(l.data?.rent ?? 0), home: {} };
            return { key: l.id, facts: { ...f, home: { ...(f.home ?? {}), ...(Number.isInteger(l.data?.bedrooms) ? { bedrooms: l.data!.bedrooms as number } : {}) } }, others: toldBy.has(l.id) ? 1 : 0 };
          }),
          levels: needLevels(), circ: { ...circumstances(), homeBedroomsNeeded: need }, satisfied_here: 0,
        }) : undefined;
        const best = listings.find((l) => l.id === d?.key);
        if (best?.speaks_for) {
          applied.add(best.id);
          const members = household?.members.map((m) => m.person) ?? [me];
          const how = d!.strategy === "imitate" ? "where someone told us to look" : "weighing each home's rent and room";
          steps.push(because(`Applying for ${best.data.space}: within a third of household income, with at least ${minBedrooms(t)} bedrooms, ${how}.`,
            say("rental_application", `Application for ${best.data.space ?? best.data.structure}, for a household of ${members.length}.`, { to: [best.speaks_for], visible: [me, best.speaks_for],
            data: { listing: best.id, account: acc.account, members, household: { people: members.length, bedrooms_needed: household ? bedroomsNeeded(household, t, year) : 0 } }, basis: best.id })));
        }
      }
      // Retiring at the world's retirement age: we stop working (giving our employer notice) and claim support.
      const age = obs.body ? Math.floor((t - obs.body.born_at) / year) : 0;
      if (!retired && p.retirement_age !== null && age >= p.retirement_age) {
        retired = true;
        if (job) {
          steps.push(because(`We've reached the retirement age (${p.retirement_age}): retiring, with the notice our job asks.`, notice(job.agreement, "Retiring.")));
          job.endsAt = Math.min(job.endsAt, t + 14 * DAY);
        }
      }
      // Claims for support: once retired, and while out of work. A claim that no longer fits (work found, or retired)
      // is stopped by saying so.
      const want = !p.support_from ? null : retired ? p.support_kinds.retired ?? null : !job && p.in_labour_force ? p.support_kinds.unemployed ?? null : null;
      if (benefit && benefit.payment !== want) {
        steps.push(because(`Our circumstances have changed (${job ? "working again" : retired ? "retired" : "no longer eligible"}): asking for our ${benefit.payment} payments to stop.`,
          say("benefit_change", `Please stop payment ${benefit.claim}.`, { to: [p.support_from!], visible: [me, p.support_from!], basis: benefit.claim, data: { claim: benefit.claim, stop: true } })));
        benefit = null;
      }
      if (want && !benefit && claiming !== want && !(refusedAt.get(want) === age)) {
        claiming = want;
        steps.push(because(retired ? `Retired, at ${age}: claiming ${want} support.` : `Out of work: claiming ${want} support while we look.`,
          say("benefit_claim", `Claim: ${want}.`, { to: [p.support_from!], visible: [me, p.support_from!], data: { payment: want, account: acc.account, born_at: obs.body?.born_at } })));
      }
      for (const r of fresh) {
        if (r.record !== "statement" || r.kind !== "benefit_decision" || !(r.addressed_to ?? []).includes(me)) continue;
        if (r.data?.granted && claiming && r.data?.payment === claiming) benefit = { claim: r.data.claim, payment: claiming, amount: r.data.amount, every: r.data.every, retired };
        else if (claiming) refusedAt.set(claiming, age);
        claiming = null;
      }
      // Looking for work: where someone told us about first, then the best-paid posting.
      if ((!job || (searchingWork && !switching)) && !retired && p.in_labour_force) {
        // In work, only postings that pay better than ours, elsewhere.
        const better = (j: StatementRecord) => !job || (j.speaks_for !== job.employer && (j.data?.wage ?? 0) * job.period > job.wage * (j.data?.period ?? job.period));
        const told = job ? [] : leadFound.jobs.filter((j) => !applied.has(j.id));
        const posts = [...told, ...found.jobs.filter((j) => !told.includes(j))].filter((j) => !applied.has(j.id) && better(j) && j.speaks_for);
        searchingWork = false;
        // Which one: the mind's (docs/design/ai-citizens.md 3). Each posting's offer appraised (its wage, its hours), with
        // what we've learned of each employer; where friends told us to look counts as others having gone there.
        // An employer is one option (its first posting: one we were told of, if any), as what we learn is of employers;
        // those we know who work there count as others having gone there.
        const toldBy = new Set(told.map((j) => j.id));
        const byEmployer = new Map<string, StatementRecord>();
        for (const j of posts) if (!byEmployer.has(j.speaks_for!)) byEmployer.set(j.speaks_for!, j);
        const working = newsNow(t);
        const d = byEmployer.size ? decide("job", t, ctx.rng(`job-${t}`), {
          options: [...byEmployer].map(([e, j]) => ({ key: e, facts: j.offer ? factsOf(j.offer) : { money_per_month: Math.round(((j.data?.wage ?? 0) * MONTH) / (j.data?.period ?? 14 * DAY)), work_hours_per_month: 160 }, others: (toldBy.has(j.id) ? 1 : 0) + working.filter((n) => n.employer === e).length })),
          levels: needLevels(), circ: circumstances(), satisfied_here: job ? 10_000 : 0,
        }) : undefined;
        const best = d?.key ? byEmployer.get(d.key) : undefined;
        if (best?.speaks_for) {
          applied.add(best.id);
          if (typeof best.data?.industry === "string") industryOf.set(best.speaks_for, best.data.industry);
          const how = d!.strategy === "imitate" ? ", where people we know told us to look or work" : d!.strategy === "compare" ? ", with an employer we know" : ", weighing each job's pay and hours";
          steps.push(because(`Applying for a job at ${usd(best.data?.wage ?? 0)} a fortnight${job ? `, better than ours (${usd(job.wage)})` : ""}${how}.`,
            say("job_application", "Application for the advertised job.", { to: [best.speaks_for], visible: [me, best.speaks_for], data: { posting: best.id, account: acc.account }, basis: best.id })));
        }
      }

      // Starting a business (docs/behaviour/entry.md): premises for sale of a kind this world has ventures for; enough
      // savings for them, the venture's capital and a buffer of three months' housing and essentials; and the month's
      // chance. We found the business and hold its first position (its rules run there), and put in the capital asked.
      if (founded?.firm && !founded.paid) for (const r of book.all("capital_call")) {
        if (r.speaks_for !== founded.firm || !(r.addressed_to ?? []).includes(me)) continue;
        founded.paid = true;
        const amount = Math.min(acc.balance, Math.floor(Number(r.data?.amount) || 0));
        if (amount > 0) steps.push(because(`Putting the ${usd(amount)} of capital into our new business.`, pay(String(r.data.account), amount, { from: acc.account, for: "Capital." })));
      }
      if (!founded && p.ventures.length && p.found_bps > 0 && t >= nextVenture && !retired && p.in_labour_force) {
        nextVenture = t + MONTH;
        const housing = home?.rent ?? share?.cents ?? 0;
        const listings = book.open("property_for_sale").filter((l) => p.ventures.some((v) => v.kind === l.data?.type)).sort((a, b) => (a.data.price as number) - (b.data.price as number) || (a.id < b.id ? -1 : 1));
        const l = listings.find((x) => acc.balance >= (x.data.price as number) + p.ventures.find((v) => v.kind === x.data.type)!.capital + 3 * (housing + p.essentials));
        // The month's chance (the cited prior), shifted by the person: the open (stimulation, self-direction) and those
        // who value achievement found more often.
        const enterprise = p.sway.enterprise_openness * (zValue("stimulation") + zValue("self_direction")) / 2 + p.sway.enterprise_achievement * zValue("achievement");
        // And by what the model says it would mean to someone like us, if the run has the sparse mind: we think it over
        // (asked once, decided at the next wake).
        const saidFound = l ? consult(`found:${l.data.type}`, `Starting a business: buying premises that are for sale and opening a ${l.data.type} there, putting most of one's savings into it, with the chance of losing them if it fails.`,
          [{ key: "found", words: "start the business" }, { key: "not", words: "keep things as they are" }], acc.balance, t) : undefined;
        if (saidFound === "pending") nextVenture = t;
        const meantFound = saidFound && saidFound !== "pending" ? (p.sway.consult * ((saidFound.found ?? 0) - (saidFound.not ?? 0))) / 10_000 : 0;
        if (l && saidFound !== "pending" && ctx.rng(`found-${t}`).below(10_000) < shifted(p.found_bps, enterprise + meantFound)) {
          const v = p.ventures.find((x) => x.kind === l.data.type)!;
          const capital = (l.data.price as number) + v.capital;
          const fill = (x: unknown): unknown => typeof x === "string"
            ? ({ "{structure}": l.data.structure, "{cell}": l.data.cell, "{listing}": l.id, "{founder}": me, "{capital}": capital } as { [k: string]: unknown })[x] ?? x.replaceAll("{structure}", l.data.structure)
            : Array.isArray(x) ? x.map(fill) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, fill(y)])) : x;
          founded = { capital, paid: false };
          const st = because(`${l.data.structure} (a ${l.data.type}) is for sale at ${usd(l.data.price)}, and we have ${usd(acc.balance)}: starting a ${v.kind} there, putting in ${usd(capital)}.`,
            ["firm", C.call("entity", { kind: v.kind, name: C.text(`${v.name} (${l.data.structure})`), position: C.text("Manager"), channels: C.json(fill(v.channels)), role_module: C.json(fill(v.role_module)) })]);
          steps.push(st);
          pendingFirm = true;
        }
      }

      // Borrowing (docs/behaviour/credit.md): short of next month's housing and essentials, with income coming in, we
      // ask our bank for a loan to tide us over (three months' worth, less what we have); we take what's offered.
      steps.push(...borrowing.steps(book, t, acc.account));
      {
        const housing = home?.rent ?? share?.cents ?? 0;
        if (housing > 0 && monthlyIncome() > 0 && acc.balance < housing + p.essentials && borrowing.canApply(t)) {
          const amount = Math.ceil((3 * (housing + p.essentials) - acc.balance) / 10_000) * 10_000;
          steps.push(borrowing.apply(t, acc.account, amount, 12, "living costs", `We have ${usd(acc.balance)}, less than next month's housing and essentials (${usd(housing + p.essentials)}): asking our bank for a loan of ${usd(amount)} to tide us over.`));
        }
      }

      // Spending: essentials, plus a share of savings above the buffer, a month's worth at a time. Where there are
      // shops (their price lists), it buys goods, every fortnight; a world without them takes the money-only stand-in.
      // A month's spending: out of income, what isn't saved (the saving ratio), less housing; never below essentials;
      // plus a little out of savings above a buffer (the wealth effect). Income is a month's worth of what came in lately
      // (before we've a window of it, what our job and payments say).
      /** What we save of income: the household's usual share, or more while we're spending less (a goal's method). */
      const saving = () => (pursuing("spend less") ? Math.max(p.saving_bps, p.goals.spend_less_saving_bps) : p.saving_bps);
      const monthly = () => {
        const housing = home?.rent ?? share?.cents ?? 0;
        const seen = t >= p.income_window_days * DAY;
        const income = seen ? Math.floor((inflows.reduce((x, f) => x + f.amount, 0) * MONTH) / (p.income_window_days * DAY)) : monthlyIncome();
        const fromIncome = Math.max(p.essentials, Math.floor((income * (10_000 - saving())) / 10_000) - housing);
        const above = Math.max(0, acc.balance - housing - p.buffer_months * Math.max(income, p.essentials));
        const fromWealth = Math.floor((above * p.wealth_effect_bps_per_year) / 12 / 10_000);
        return Math.max(0, Math.min(acc.balance - housing, fromIncome + fromWealth));
      };
      const shops = [...new Set(book.open("price_list").map((r) => r.speaks_for!))].sort()
        .map((s) => ({ shop: s, ...goodsPrices(book, s) }))
        .filter((x) => x.prices[p.goods] !== undefined && x.account && (x.min_order ?? 1) <= 1)
        .map((x) => ({ shop: x.shop, price: x.prices[p.goods]!, account: x.account!, at: x.at }));
      const priceAt = (s: string | undefined) => shops.find((x) => x.shop === s);
      // Where the goods go: home, if we're living there (a home let but not yet moved into, or one being demolished, isn't
      // somewhere we keep things), or else kept at the shop for us.
      const homeAt = home && inside(home.space) ? home.structure : livingAt && inside(livingAt) ? structureOf(livingAt) : undefined;
      const placeFor = (s: { at?: string }) => homeAt ?? s.at;
      const buy = (s: (typeof shops)[number], q: number, why: string, retryOf?: string): boolean => {
        const place = placeFor(s);
        if (!place || q < 1) return false;
        trip!.tried.add(s.shop);
        // What it's for: until the next trip (it's what we use until then), and the shop may serve it over that time.
        const forDays = Math.max(1, Math.ceil((nextShop - t) / DAY));
        steps.push(order({ me, seller: s.shop, sellerAccount: s.account, kind: p.goods, quantity: q, unitPrice: s.price, at: place, from: acc.account, why, retryOf, forDays }));
        return true;
      };
      if (shops.length) {
        // A shop that couldn't serve all we asked: now and then we give up on it; and we try another for what's missing.
        for (const d of deliveries.take(book, me)) {
          if (d.refund > 0) inflows.push({ t, amount: -d.refund }); // a refund isn't income
          const short = d.ordered - d.delivered;
          if (d.kind !== p.goods || d.ordered <= 0) continue;
          // What we learn of the shop: how fully it served us (experience-weighted attraction). How our own shop did is
          // what we judge the next trip by (a retry elsewhere doesn't make up for it).
          const served = Math.round((d.delivered * 10_000) / d.ordered);
          mind.learn("shop", d.seller, served);
          if (d.seller === favourite) lastServed = served;
          if (short <= 0) continue;
          // Tried elsewhere now, if this trip can: another shop we know, by what we've learned of each, weighted, not the
          // town's cheapest (everyone short going there at once overwhelms it) and not one that's failed us. If not,
          // what came back is spent on the next trip: it was meant for goods we didn't get, not saved.
          const untried = trip && trip.tried.size < p.beta ? shops.filter((x) => !trip!.tried.has(x.shop)) : [];
          const next = untried.length ? untried.find((x) => x.shop === mind.learned("shop").choose(ctx.rng(`retry-${d.order}`), untried.map((u) => ({ key: u.shop, value: 0 })), mind.person.temperament.openness).key) : undefined;
          const retried = !!next && buy(next, Math.min(short, Math.floor((short * (priceAt(d.seller)?.price ?? next.price)) / next.price)), `${d.seller} could serve ${d.delivered} of the ${d.ordered} we wanted: trying ${next.shop} for the rest.`, d.order);
          if (!retried && d.refund > 0) deferred += d.refund;
        }
        if (t >= nextShop) {
          nextShop = t + p.shop_every_days * DAY;
          trip = { at: t, tried: new Set() };
          const r = ctx.rng(`shopping-${t}`);
          const budget = Math.min(acc.balance, Math.floor((monthly() * p.shop_every_days * DAY) / MONTH) + carried + deferred);
          // Which shop: the mind's decision among the shops' offers, each for what the trip's budget buys there.
          const offerOf = (shop: string) => book.open("price_list").filter((l) => l.speaks_for === shop && l.offer).sort((a, b) => b.at - a.at)[0]?.offer;
          // Those we know who shop there count as others going there.
          const heard = newsNow(t);
          const options = shops.map((x) => {
            const units = Math.floor(budget / x.price);
            const o = offerOf(x.shop);
            return { key: x.shop, facts: o ? factsOf(o, units) : { money_per_month: -units * x.price, goods_per_month: units }, others: heard.filter((n) => n.shop === x.shop).length };
          });
          const was = favourite;
          const d = decide("shop", t, r, { options, current: priceAt(favourite) ? favourite : undefined, levels: needLevels(), circ: circumstances(), satisfied_here: lastServed });
          favourite = d.key ?? r.pick(shops).shop;
          const why = favourite === was ? "" : d.strategy === "imitate" ? `going to ${favourite}, where others go` : d.strategy === "compare" ? `going to ${favourite}, the best of the shops we know` : `choosing ${favourite}, weighing what each shop's prices buy${was ? ` (${was} served us ${Math.round(lastServed / 100)}% last time)` : ""}`;
          const s = priceAt(favourite)!;
          const q = Math.floor(budget / s.price);
          carried = Math.max(0, Math.min(budget - q * s.price, s.price));
          buy(s, q, `Shopping for the fortnight: what we don't save of our income (${100 - saving() / 100}%${pursuing("spend less") ? ": spending less, to make ends meet" : ""}) less the rent, and a little out of savings${deferred ? `, and ${usd(deferred)} we meant to spend last time and got back` : ""}, is ${usd(budget)}: ${q} at ${s.shop} (${usd(s.price)} each)${why ? `; ${why}` : ""}.`);
          deferred = 0;
        }
      } else if (t >= nextSpend) {
        nextSpend = t + MONTH;
        const shopAccounts: string[] = p.shop_accounts ?? [];
        const amount = monthly();
        if (amount > 0 && shopAccounts.length) {
          const shop = ctx.rng(`shop-${t}`).pick(shopAccounts);
          steps.push(because(`Monthly shopping: what we don't save of our income (${100 - p.saving_bps / 100}%) less the rent, and a little out of savings.`, pay(shop, amount, { from: acc.account, for: "Shopping." })));
        }
      }
      // Using things up: what we hold, spread over the weeks until the next trip. With a home, we use things there, and
      // bring home what's elsewhere (kept for us at a shop, or left at a home we've moved from); without one, we use
      // what a shop keeps for us, there.
      const pickups = new Set(shops.flatMap((x) => (x.at ? [x.at] : [])));
      const had = channels.holdings(obs).filter((h) => h.kind === p.goods && Number(h.quantity) > 0 && (homeAt ? true : pickups.has(h.at)))
        .sort((a, b) => Number(b.quantity) - Number(a.quantity) || (a.at < b.at ? -1 : 1));
      const total = had.reduce((x, h) => x + Number(h.quantity), 0);
      if (total > 0 && t >= nextUse) {
        nextUse = t + 7 * DAY;
        const weeks = Math.max(1, Math.ceil((nextShop - t) / (7 * DAY)));
        const lines: C.Call[] = [];
        if (homeAt) {
          for (const h of had) if (h.at !== homeAt) lines.push(C.call("goods", { kind: p.goods, quantity: C.text(h.quantity), to: me, at: homeAt, from_at: h.at }));
          lines.push(C.call("work", { task: "consume", units: C.text(String(Math.ceil(total / weeks))), at: homeAt }));
        } else {
          let use = Math.ceil(total / weeks);
          for (const h of had) {
            const u = Math.min(use, Number(h.quantity));
            if (u <= 0) break;
            lines.push(C.call("work", { task: "consume", units: C.text(String(u)), at: h.at }));
            use -= u;
          }
        }
        steps.push(because(`Using up ${Math.ceil(total / weeks)} of the ${total} ${p.goods} we have: what we have, spread over the ${weeks} week${weeks > 1 ? "s" : ""} until we shop again${homeAt && had.some((h) => h.at !== homeAt) ? " (bringing home what's elsewhere)" : ""}.`, ...lines));
      }
      voice(t, steps);
      fresh = [];
      return steps;
    };

    // Word of mouth. Ties are the people we share (or shared) a home or workplace with: in our own
    // buildings we see who. Asked, we say where we can see room: where we live or next door for a
    // home, our own workplace for work (we're on the inside there). Hunting, we ask once per hunt.
    /** Found a home or work where someone told us to look: grateful to them, and closer. */
    const thank = (structure: string | undefined, t: number): string => {
      const who = structure ? leadFrom.get(structure) : undefined;
      if (!who) return "";
      leadFrom.delete(structure!);
      feelings.add("gratitude", who, 6_000, t);
      ties.add(who, 2_000, t);
      return ` (${who} told us to look there: we're grateful)`;
    };
    /** What we'd tell someone who asks how we are. */
    const newsOfMine = () => [
      favourite && mind.learned("shop").known(favourite) ? CATCHING_UP.shop(favourite, lastServed) : "",
      job ? CATCHING_UP.work(job.employer, !job.claimed) : "",
      job && p.union ? CATCHING_UP.union(isMember()) : "",
      ...[...wentLast].sort().map((id) => book.records.get(id)).flatMap((r) => (r?.record === "statement" && r.speaks_for ? [CATCHING_UP.goes(r.speaks_for)] : [])),
      ...[...new Set(book.open("teaching").filter((r) => (beliefs.get(r.id) ?? 0) >= p.belief.tell_at_bps).map((r) => r.speaks_for ?? r.author))].sort().map(CATCHING_UP.holds),
    ].filter(Boolean).join(" ") || CATCHING_UP.nothing;
    const wordOfMouth = (obs: Observation, t: number, steps: Step[]) => {
      // The buildings around us; in our own we see who's there (they're the people we know).
      const around: SiteStructure[] = obs.channels.street?.kind === "sites" ? channels.structures({ ...obs, channels: { street: obs.channels.street } }) : [];
      for (const st of around) for (const sp of st.spaces) for (const o of sp.occupants ?? []) if (o !== me) contacts.set(o, t);
      if (contacts.size > p.max_contacts) {
        // Those we're close to, and those we've seen lately (a month counts as much as a fair friendship), kept.
        const keeps = (k: string, seen: number) => ties.affinity(k, t) + (t - seen <= MONTH ? 2_000 : 0);
        const keep = [...contacts].sort((a, b) => keeps(b[0], b[1]) - keeps(a[0], a[1]) || b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, p.max_contacts);
        contacts.clear();
        for (const [k, v] of keep) contacts.set(k, v);
      }
      // Room we can see: a home standing empty, or a workplace with space in it.
      const room = (st: SiteStructure, kind: string) =>
        st.complete && st.spaces.some((sp) => sp.kind === kind && (kind === "dwelling" ? sp.count === 0 : sp.count < sp.capacity));
      for (const q of asked) {
        const lead = q.want === "home"
          ? around.find((st) => room(st, "dwelling"))?.structure
          : job?.workplace && around.some((st) => st.structure === structureOf(job!.workplace!) && room(st, "workplace")) ? structureOf(job.workplace) : undefined;
        if (lead && ctx.rng(`pass-on-${q.from}-${t}`).below(10_000) < p.pass_on_bps)
          steps.push(because("Asked about room: passing on what we can see.", message([q.from], q.want === "home" ? `There looks to be room at ${lead}, near me.` : `They have room at my work, ${lead}.`, lead)));
      }
      asked = [];
      const known = [...contacts.keys()];
      // Catching up: answering those who asked how we are, and now and then asking someone we know (one at a time).
      for (const who of askedHow) {
        steps.push(because("Asked how things are: telling them.", message([who], newsOfMine())));
      }
      askedHow = [];
      if (nextCatchUp === null) nextCatchUp = t + ctx.rng("catch-up").below(p.catch_up_days) * DAY;
      if (t >= nextCatchUp) {
        nextCatchUp = t + Math.round((p.catch_up_days * DAY) / (pursuing("catch up more") ? 2 : 1));
        if (known.length) {
          // Whom: more often those we're closer to.
          const pool = [...known].sort();
          const weights = pool.map((k) => 1_000 + Math.max(0, ties.affinity(k, t)));
          let r = ctx.rng(`catch-up-${t}`).below(weights.reduce((a, b) => a + b, 0));
          const who = pool.find((_, i) => (r -= weights[i]!) < 0) ?? pool.at(-1)!;
          talked.set(who, t);
          steps.push(because("Catching up with someone we know.", message([who], CATCHING_UP.ask)));
        }
      }
      for (const [want, needed, chance] of [["home", isLeaseholder() && !home, p.ask_home_bps], ["work", !job, p.ask_work_bps]] as [Want, boolean, number][]) {
        if (!needed) {
          delete askedAt[want];
          continue;
        }
        if (askedAt[want] !== undefined && t - askedAt[want]! < p.ask_again_days * DAY) continue;
        askedAt[want] = t;
        if (known.length && ctx.rng(`ask-${want}-${t}`).below(10_000) < chance) steps.push(because(`Starting to look for ${want === "home" ? "a home" : "work"}: asking the people we know.`, message(known, ASKING[want])));
      }
    };

    // Granovetter (1978): each person joins once the share already joined reaches their own threshold.
    // Irwin–Hall approximation to a normal: the sum of 12 uniforms on [0, 1) has mean 6 and sd 1.
    const tr = ctx.rng("threshold");
    let z = -6 * 10_000;
    for (let i = 0; i < 12; i++) z += tr.below(10_000);
    // A person's threshold follows their temperament (docs/design/ai-citizens.md 3a): the conformist waits for others,
    // the least conformist starts it. Half their conformity (standardised, near its spread among people), half their own
    // draw, so thresholds keep the same mean and spread.
    const zc = Math.max(-3, Math.min(3, (mind.person.temperament.conformity - 5_000) / 1_060));
    const zt = 0.5 * zc + 0.866 * (z / 10_000);
    const threshold = Math.max(0, p.threshold_mean_bps + Math.trunc(zt * p.threshold_sd_bps));
    const signed = new Set<string>();
    // Whether we're someone who signs petitions at all (drawn once); thresholds apply among those who are.
    const willing = ctx.rng("petition-willing").below(10_000) < p.petition_willing_bps;
    const countsPublished = new Map<string, { n: number; at: number }>();
    const voice = (t: number, steps: Step[]) => {
      const burden = home && householdIncome() > 0 ? (home.rent * 10_000) / householdIncome() : 0;
      const noticed = [...book.notices.entries()].some(([ag, ns]) => ag === home?.agreement && ns.some((n) => n.as !== me));
      // Aggrieved: angry with our landlord (given notice to go, or a rent rise), while it lasts; or while the rent
      // takes too much of our income.
      if (home && noticed) feelings.feel("anger", home.landlord, 6_000, t);
      const aggrieved = !!home && (burden >= p.rent_burden_grievance_bps || feelings.level("anger", home.landlord, t) >= p.aggrieved_bps);
      const open = found.petitions.filter((x) => (x.data?.demand?.tags ?? []).includes("tenant_protection"));
      // An organiser closes their petition after `petition_days`; a new one can then start.
      for (const pet of open) if (pet.speaks_for === me && t - pet.at >= p.petition_days * DAY && !signed.has(`closed-${pet.id}`)) {
        signed.add(`closed-${pet.id}`);
        steps.push(because(`Closing our petition after ${p.petition_days} days.`, withdraw(pet.id, "Petition closed.")));
      }
      if (willing && aggrieved && open.length === 0 && ctx.rng(`petition-${t}`).below(10_000) < p.petition_start_bps) {
        steps.push(because(`Aggrieved (${noticed ? "our landlord gave us notice" : `rent is ${Math.round(burden / 100)}% of household income`}) and no tenants' petition is open: starting one.`, say("petition", "Petition: landlords must give 90 days' notice, and may not raise rent by more than 5% a year.", { data: { demand: {
          kind: "law", text: "A landlord must give at least 90 days' notice to end a tenancy, and may not raise the rent by more than 5% in any 12 months.",
          adico: { attribute: "landlords", deontic: "must_not", aim: "end a tenancy on less than 90 days' notice, or raise rent by more than 5% a year" }, tags: ["tenant_protection"] } } })));
        return;
      }
      for (const pet of open) {
        if (pet.speaks_for === me) {
          // The organiser sees every signature (a vote is visible to the signer and the petition's
          // organiser) and publishes the running count, at most every 3 days, as petition sites do.
          const n = petitionSignatures(book, pet.id) + 1;
          const last = countsPublished.get(pet.id);
          if ((!last || last.n !== n) && (!last || t - last.at >= 3 * DAY)) {
            countsPublished.set(pet.id, { n, at: t });
            steps.push(because("Publishing our petition's running count.", say("petition_count", `${n} people have signed.`, { basis: pet.id, data: { petition: pet.id, signatures: n } })));
          }
          continue;
        }
        if (signed.has(pet.id) || !willing) continue;
        const share = (publishedCount(book, pet) * 10_000) / p.population;
        if (aggrieved || ((home || livingAt) && share >= threshold)) {
          signed.add(pet.id);
          steps.push(because(aggrieved ? "Signing the tenants' petition: we're aggrieved ourselves." : `Signing the tenants' petition: ${Math.round(share / 100)}% of the town has signed, past our own threshold of ${Math.round(threshold / 100)}%.`, vote(pet.id, "sign")));
        }
      }
    };

    const affordable = (rent: number, balance: number) =>
      householdIncome() > 0 ? rent * 10_000 <= householdIncome() * p.rent_share_bps : rent * p.savings_rent_months <= balance;

    // The household's members by age now (a child is under 18).
    const children = (t: number) => others().filter((m) => ageAt(m, t, year) < ADULT_YEARS);
    const adults = (t: number) => others().filter((m) => ageAt(m, t, year) >= ADULT_YEARS);
    /** Fewest bedrooms to look for: what the standard asks, less one for each stretch spent hunting without finding it. */
    const minBedrooms = (t: number) => {
      if (!household) return 0;
      const relax = homelessSince === null ? 0 : Math.floor((t - homelessSince) / (p.accept_fewer_bedrooms_after_days * DAY));
      return Math.max(0, bedroomsNeeded(household, t, year) - relax);
    };
    /** At the start, the share of the rent another adult already pays us (a standing order in the world's genesis records). */
    const genesisShare = (a: Member) => {
      const o = book.all("request").find((r) => r.record === "statement" && r.kind === "request" && r.speaks_for === a.person && r.data?.outcome?.money?.for === "Household share of the rent.");
      const paid = (o as any)?.data?.outcome?.money?.amount;
      return paid === undefined ? -1 : cents(paid);
    };

    /** Grown up with no account of our own (children have none): ask the bank for one, once. */
    let accountAsked = false;
    const withoutAccount = (steps: Step[]): Step[] => {
      if (!accountAsked && p.bank) {
        accountAsked = true;
        steps.push(because("Grown up (or new to town) with no bank account: asking the bank for one.", C.call("account", { holder: me, at: p.bank })));
      }
      return steps;
    };

    /** Leaving town: stop paying, give notice, send our money on, and go (taking the children, if we hold the lease). */
    let leaving = false;
    const departure = (acc: { account: string; balance: number } | undefined, why: string): Step[] => {
      const s: Step = because(why);
      if (home) {
        if (home.order) s.push(withdraw(home.order));
        for (const x of home.retiring ?? []) s.push(withdraw(x.order));
        home.retiring = [];
        s.push(notice(home.agreement, "Leaving town."));
      }
      if (share?.order) s.push(withdraw(share.order, "Leaving town."));
      if (job) s.push(notice(job.agreement, "Leaving town."));
      s.push(say("departure", `${me} has left town.`));
      if (acc && acc.balance > 0 && p.outside_account) s.push(pay(p.outside_account, acc.balance, { from: acc.account, for: "Moving away: send all my savings with me." }));
      // Leaving takes a body out of every space it's in. The children go first, each on its own (one may not be here).
      leaving = true;
      s.push(C.call("presence", { leave: "yes" }));
      return [...(isLeaseholder() ? childrenNow.map((k) => because(why, C.call("presence", { who: k.person, leave: "yes" }))) : []), s];
    };
    let childrenNow: Member[] = [];

    return {
      step(obs): ParticipantAction | Promise<ParticipantAction> {
        if (departed) return wait(ctx.world.runEnd + DAY);
        absorb(obs);
        // A child does nothing on their own (their parents house them) until they're 18, except ask for help if no
        // adult of the household is left: all of them seen to die (in our home), or gone from it.
        if (obs.body && obs.t - obs.body.born_at < ADULT_YEARS * year) {
          const street = obs.channels.street;
          if (!askedForCare && household && street?.kind === "sites") {
            const spaces = street.cells.flatMap((c) => c.structure?.spaces ?? []).filter((sp) => sp.occupants?.includes(me));
            const grown = household.members.filter((m) => ageAt(m, obs.t, year) >= ADULT_YEARS);
            const deadHere = new Set(spaces.flatMap((sp) => sp.left ?? []).filter((l) => l.reason === "died").map((l) => l.occupant));
            if (spaces.length && grown.length && grown.every((m) => deadHere.has(m.person)) && p.child_protection) {
              askedForCare = true;
              const kids = household.members.filter((m) => ageAt(m, obs.t, year) < ADULT_YEARS).map((m) => m.person);
              return callAction(because("No adult of our household is left: asking for help.", say("care_request", "We have no adult at home any more.", { to: [p.child_protection], data: { children: kids } })));
            }
          }
          return wait(Math.min(obs.t + MONTH, ctx.world.runEnd + DAY));
        }
        if (plannedAt !== obs.t) {
          const acc = ownBanked(obs, me);
          const usual = acc ? (householdIncome() > 0 ? Math.floor((householdIncome() * p.rent_share_bps) / 10_000) : Math.floor(acc.balance / p.savings_rent_months)) : 0;
          if (cheaperThan && (home || obs.t >= cheaperThan.until)) cheaperThan = null;
          const budget = cheaperThan ? Math.min(usual, cheaperThan.rent) : usual;
          const needHome = isLeaseholder() && !home;
          const rooms = minBedrooms(obs.t);
          const roomy = rooms > 0 ? [{ field: "data.bedrooms", op: ">=" as const, value: rooms }] : [];
          // Told about a building? Look there first: what's on offer in it now.
          if (looking === null && lookedAt !== obs.t && acc && leads.length && (needHome || !job)) {
            const lead = leads.pop()!;
            const looks: LookRequest[] = [];
            if (needHome) looks.push({ channel: "homes", query: { standing: true, where: [{ field: "data.structure", op: "=", value: lead }, { field: "data.rent", op: "<=", value: budget }, ...roomy], limit: p.search_limit } });
            if (!job && !retired && p.in_labour_force) looks.push({ channel: "jobs", query: { standing: true, where: [{ field: "data.workplace", op: "=", value: lead }], limit: p.search_limit } });
            leadFound.homes = [];
            leadFound.jobs = [];
            looking = "leads";
            return { type: "look", looks };
          }
          // Hunting? Look at what's on offer (the next step, at once, has the results).
          const looks: LookRequest[] = [];
          // In work: a month's chance of looking for something better paid.
          if (job && !switching && !retired && p.in_labour_force && obs.t >= nextJobSearch) {
            nextJobSearch = obs.t + MONTH;
            // Looking for a better job (CONSUMAT, docs/design/ai-citizens.md 3b): every month if our life falls short of
            // what we want; otherwise now and then, the more open we are.
            const unsatisfied = satisfaction(mind.person, levelsNow) < mind.p.aspiration_bps;
            searchingWork = unsatisfied || pursuing("better work") || ctx.rng(`job-search-${obs.t}`).below(10_000) < Math.round(mind.person.temperament.openness / 10);
          }
          if (lookedAt !== obs.t && acc) {
            if (needHome) looks.push({ channel: "homes", query: { standing: true, where: [{ field: "data.rent", op: "<=", value: budget }, ...roomy], order: { field: "data.rent", desc: true }, limit: p.search_limit } });
            if ((!job || searchingWork) && !retired && p.in_labour_force) looks.push({ channel: "jobs", query: { standing: true, order: { field: "data.wage", desc: true }, limit: p.search_limit } });
            // A glance at the petitions board: what's standing now.
            looks.push({ channel: "petitions", query: { standing: true, limit: 10 } });
          }
          if (looks.length) {
            lookedAt = obs.t;
            found.homes = [];
            found.jobs = [];
            found.petitions = [];
            looking = "market";
            return { type: "look", looks }; // the results arrive with the next observation, and are planned with
          }
          lookedAt = obs.t;
          looking = null;
          // (What the last wake didn't get to comes first: our state already counts on it.)
          todo = [...todo, ...plan(obs).filter((s) => s.length)]; // (a step with nothing to do isn't sent: as the stepper)
          plannedAt = obs.t;
          leadFound.homes = [];
          leadFound.jobs = [];
        }
        const next = todo.shift();
        lastWasMove = !!next && next === moveStep;
        if (leaving && todo.length === 0) departed = true; // the last of leaving is under way
        // (A gathering to go to, or come back from, before the week is out: awake then.)
        const action = next ? callAction(next) : wait(practiceWake !== null ? Math.min(practiceWake, obs.t + 7 * DAY) : undefined);
        if (decided.length) Object.defineProperty(action, DECISIONS, { value: decided.splice(0), enumerable: false });
        // Questions to the sparse mind out this wake: the action, once they're answered (and if waiting, awake again by
        // the next hour, to decide with the answer).
        if (asking.length) {
          const out = Promise.all(asking.splice(0));
          const then = action.type === "wait" ? wait(Math.min(action.until ?? Infinity, obs.t + ctx.world.tickSeconds)) : action;
          const d = (action as any)[DECISIONS];
          if (d && then !== action) Object.defineProperty(then, DECISIONS, { value: d, enumerable: false });
          return out.then(() => then);
        }
        return action;
      },
    };
  },
};
