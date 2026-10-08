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
import type { Eligibility, LookRequest, Observation, ParticipantAction, Record, SiteStructure, StatementRecord } from "../contracts";
import { basesOf, channels, cites } from "../contracts";
import { DECISIONS, params, wait, type Belief, type BehaviourModule, type ConsultAnswer, type DecisionRecord, type ParticipantContext } from "../module";
import type { Rng } from "../rng";
import * as C from "../calls";
import { ask, Asked, because, Book, breaches, noted, callAction, commitmentOf, DAY, nextLook, usd, jobTerms, record, leaseTerms, message, MONTH, moveIn, moveOut, notice, pay, PAYMENT_FAILED, petitionSignatures, publishedCount, say, sign, structureOf, variableToday, vote, withdraw, type Step, ownBanked } from "./common";
import { ADULT_YEARS, ageAt, bedroomsNeeded, hear, householdOf, SAYING, type Heard, type HouseholdData, type Member } from "./household";
import { Deliveries, goodsPrices, offerOf as shopOffer, order } from "./trade";
import { incomeTaxLaw, withholding } from "./tax";
import { Borrowing } from "./credit";
import { factsOf, Feelings, Mind, MIND_DEFAULTS, MIND_VERSION, Pursuit, satisfaction, Ties, type Circumstances, type MindParams, type NeedLevels, type PopulationValues, type Value } from "./mind";

/** How belief changes (docs/behaviour/citizen.md "Belief"; placeholders): a month's fading; how much of the way to
 * certainty a gathering takes it (with 20 or more others there), and being told; how strongly it's held to say so, and
 * to count it one's own (as a census asks); and how much it adds to the worth of the gatherings of those who teach it. */
/** Goals (docs/behaviour/citizen.md "Goals"; placeholders): how long a need goes unmet before it becomes a goal, how long
 * each method is given, how long after giving up before trying again; the needs' levels that count as unmet; what
 * spending less saves, and how much cheaper a cheaper home is (of the old rent). */
const GOALS = { unmet_days: 60, method_days: 90, rest_days: 180, security_bps: 3_000, social_bps: 4_000, spend_less_saving_bps: 2_000, cheaper_bps: 9_000 };

const BELIEF = { fade_bps: 300, display_bps: 500, told_bps: 300, tell_at_bps: 6_000, affiliate_bps: 3_000, meaning: 0.2 };

/** How far a person's values sway the cited rates (a fraction of the rate per standard deviation of the value):
 * placeholders, unsourced, chosen small so the town's rates stay as calibrated (docs/behaviour/citizen.md). */
const SWAY = { consult: 1, union_belief: 0.5, union_peers: 0.5, union_join: 0.3, turnout: 0.15, strike_vote: 0.08, patience_tradition: 0.2, patience_security: 0.1, enterprise_openness: 0.4, enterprise_achievement: 0.3 };

/** What a code citizen says when it asks around, and recognises when asked (a code citizen only understands its own phrasing). */
export const ASKING = { home: "I'm looking for somewhere to live. Do you know of anywhere?", work: "I'm looking for work. Do you know of anything going?" } as const;
type Want = keyof typeof ASKING;

/** What a citizen asks the sparse mind about (docs/design/ai-citizens.md 4): the words a run uses, and an audit checks
 * (consult-audit). */
export const CONSULT_THINGS = {
  join: (union: string) => ({
    about: `join:${union}`,
    thing: "Joining the workers' union on starting a new job. The union represents its members at work and bargains for their pay and conditions; members pay dues each month, and may be called out on strike, unpaid.",
    options: [{ key: "join", words: "join the union" }, { key: "not", words: "don't join" }],
  }),
  found: (kind: string) => ({
    about: `found:${kind}`,
    thing: `Starting a business: buying premises that are for sale and opening a ${kind} there, putting most of one's savings into it, with the chance of losing them if it fails.`,
    options: [{ key: "found", words: "start the business" }, { key: "not", words: "keep things as they are" }],
  }),
};

/** Catching up with someone we know: the question, and a code citizen's answer (where they shop and how it serves them,
 * whom they work for and whether they're paid, whether they're in the union). Understood only in this phrasing. */
export const CATCHING_UP = {
  ask: "How are things with you?",
  shop: (shop: string, served: number) => `I shop at ${shop}; ${served >= 9_000 ? "it has what I need" : served >= 6_000 ? "it mostly has what I need" : "it often runs short"}.`,
  work: (employer: string, paid: boolean) => `I work for ${employer}; ${paid ? "they pay on time" : "they've stopped paying me"}.`,
  union: (member: boolean) => (member ? "I'm in the union." : "I'm not in the union."),
  goes: (host: string) => `I go to ${host}'s gatherings.`,
  holds: (host: string) => `I hold to what ${host} teaches.`,
  leans: (host: string) => `I lean towards what ${host} teaches.`,
  nothing: "Much the same.",
};
export interface News { shop?: string; served?: number; employer?: string; paid?: boolean; member?: boolean; goesTo?: string[]; holdsTo?: string[]; leansTo?: string[] }
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
  const leans = [...text.matchAll(/I lean towards what ([^\s;']+) teaches\./g)].map((x) => x[1]!);
  if (leans.length) n.leansTo = leans;
  return Object.keys(n).length ? n : undefined;
}

/** A home is a unit (a space) in a building. */
interface Home {
  agreement: string; space: string; structure: string; landlord: string; rent: number; order?: string; movedIn: boolean;
  /** Ours (`agreement` is the title; `rent`, the mortgage repayment, if any): docs/behaviour/ownership.md. */
  owned?: boolean;
  /** Rent orders replaced by a new rent's, to stop once their last payment is made (when). */
  retiring?: { order: string; at: number }[];
}
interface Job { agreement: string; employer: string; wage: number; period: number; workplace?: string; since: number; /** When we walked out (unpaid), whatever the terms say. */ leftAt?: number; paidAt?: number; claimed?: boolean }

export const citizen: BehaviourModule = {
  name: "citizen.default",
  version: "0.39.0",
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
      // A rent rise on the home we have: kept, and paid, up to this share of household income (in rental stress: many
      // renters pay over 30%, as income and housing surveys find); beyond it, notice, to find somewhere else. Placeholder.
      rent_bearable_share_bps: 5000,
      savings_rent_months: 6, // without income, rent only if savings cover this many months
      // Place-specific figures are placeholders here: a world sets them from its profile (docs/profiles.md).
      essentials: 40_000, // cents per month: what's spent however little comes in
      // Spending out of income (docs/behaviour/citizen.md): what isn't saved, less housing, plus a little out of wealth.
      saving_bps: 500, // the household saving ratio
      wealth_effect_bps_per_year: 300, // consumption a year per unit of wealth
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
      // (Looking for a better-paid job while employed is the mind's: docs/design/ai-citizens.md 3b.)
      // Starting a business (docs/behaviour/entry.md): the kinds of venture this world has (a template each: its capital
      // beyond the premises, the founder's position's channels and rules, with "{structure}", "{cell}", "{listing}",
      // "{founder}" and "{capital}" filled in), and the monthly chance a person able to, seeing premises for sale, does.
      ventures: [] as { kind: string; name: string; capital: number; channels: unknown[]; role_module: { code: string; params: { [k: string]: unknown } } }[],
      found_bps: 0,
      // Shopping (Lengnick 2013, Table 1): how often, and how many shops a trip may try. Which shop is the mind's
      // (docs/design/ai-citizens.md 3b, 3c): it replaces Lengnick's price and quantity switching rules.
      shop_every_days: 14,
      beta: 5, // shops tried in one trip, at most
      // How a household comes to know a shop's prices (docs/behaviour/citizen.md, "Which shops a household knows"): it
      // is shown the prices put up at the shops near where it lives and works; and it looks through what sellers
      // advertise (`adverts`: its channel onto that, searched; none: it knows what it is shown) for a shop it has
      // heard of from someone it knows, with this chance a month, or for a few shops when it knows none.
      adverts: "",
      shop_search_bps: 2500, // Lengnick 2013, Table 1: the monthly chance of looking at another seller's price (0.25)
      shops_known: 7, // Lengnick 2013, Table 1: sellers a household deals with (7): how many it looks up, knowing none
      // Property for sale (docs/behaviour/ownership.md): the channel onto the listings, searched when we're looking to
      // buy a home or premises (none: we know the listings we're shown).
      sale_board: "",
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
      // Civic life (docs/behaviour/citizen.md "Elections and news"): enrolling, judging the town's government, standing
      // and voting; reading the local paper. Placeholders, but the turnout and readership the world gives (its profile).
      electoral_town: null as string | null, // where we enrol and vote (the world says; none: no elections)
      paper: null as string | null, // the local paper, whose news we read (the world says; none: no paper, and nothing is read as news)
      // School (docs/behaviour/education.md): the school children of its ages go to (the world says; none: no school).
      school: null as { entity: string; building: string; ages: [number, number] } | null,
      // Whom we tell when we leave town for good (the world gives them; none: our leaving is said to nobody in particular).
      tell_on_leaving: [] as string[],
      // Health (docs/behaviour/health.md): the clinic and its waiting room; the share who go when something's wrong of a
      // kind it sees; and the conditions nobody works with (the world says; none: no clinic).
      care: null as { entity: string; waiting: string; seek_bps: number; severities: string[]; off_work: string[]; wait_days: number } | null,
      // The tribunal (docs/behaviour/justice.md): where we take a rent increase that breaks the law (with the chance
      // `challenge_bps`) or a debt owed us unpaid after `apply_after_days` (with `apply_bps`), and where we ask for an
      // unpaid order to be enforced (the world says; none: no tribunal).
      tribunal: null as { entity: string; challenge_bps: number; apply_bps: number; apply_after_days: number } | null,
      // Utilities (docs/behaviour/utilities.md): the energy retailer we sign up with once we hold a home (the world says).
      utilities: null as { energy: string } | null,
      // The daily round (world-expansion 6.3): when work and school are (times of day, seconds; working days of each
      // week). With it, we go to work and school and come home; without it, a body stays where it went.
      round: null as { work_start: number; work_end: number; work_days: number; school_start: number; school_end: number } | null,
      // Where we go when our home is under water (the town's relief centre: a space), if the world has one.
      relief: null as string | null,
      // Crime (docs/behaviour/crime.md): in need and at work where our employer keeps goods, the month's chance we take
      // some (`take_bps`), less as the chance of being caught we reckon (`caught_bps`) is higher. Circumstances only.
      crime: null as { take_bps: number; caught_bps: number; quantity: number } | null,
      // Homes for sale (docs/behaviour/ownership.md): the month's chance a renting household that can afford a home that
      // suits it buys one (`buy_bps`), with the deposit and costs it takes, on a mortgage from our bank. A home of ours
      // unsold after `relist_days` is listed again for `cut_bps` less, down to `floor_bps` of what we first asked.
      // The land register, where this world keeps one for people to look things up in (docs/behaviour/ownership.md):
      // our channels onto its plans of lots, its titles, and the dealings in a title, each searched when we need it.
      // (None: whatever of the register we know is what we're shown.)
      register: null as { lots: string; titles: string; dealings: string } | null,
      // Enterprise agreements, where this world keeps them to be looked up (docs/behaviour/unions.md): our channel onto
      // them, read for our own workplace's when we plan. (None: we know of those we're shown.)
      work_board: null as string | null,
      market: null as { buy_bps: number; deposit_bps: number; costs_bps: number; mortgage_months: number; bedrooms_by_type: { [type: string]: number }; relist_days: number; cut_bps: number; floor_bps: number } | null,
      civic: { turnout_bps: 9000, stand_bps: 30, reads_news_bps: 5000, approval_memory_weeks: 26, news_weight_bps: 1500, platform_weight_bps: 2500 },
      // Voice (docs/behaviour/citizen.md): petitions, after Granovetter (1978).
      petition_start_bps: 300, // chance per wake that an aggrieved renter starts a petition, if none is open
      petition_willing_bps: 4400, // share of people who sign petitions at all (AES 2016: 44% had signed a written petition in the last five years)
      petition_days: 180, // how long an organiser keeps a petition open
      // The schedule of the world's law on ending a tenancy, if it has one made from figures: a tenants' petition then
      // names it and the notice it asks for, so that whoever answers can put that part as an amendment of the law.
      tenancy_schedule: "",
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
      // variables (waste building up); the days' worth at which anger with them is half-way; and, angry enough, the
      // chance each week of writing (placeholder).
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
    let toldUnion: string | undefined; // where we last said we work, as a member (the union's register, at the start)
    const industryOf = new Map<string, string>(); // employer -> the industry its posting said
    let complainedOf: string | null = null; // the home we've complained about, until it's seen to
    // When we last saw the waste at home go down (a collection), and what it was then: how long it's been is what we go
    // by, not what's in the bin over how fast it's filling now (which depends on who's home at the moment: pilot 7d's
    // flats, judged in the daytime with half the building out, complained of a week's waste as two).
    const binSeen = { structure: "", value: 0, emptiedAt: -1, at: -1, view: undefined as { value: number; as_of_day: number; per_day: number; min: number; max: number } | undefined };
    // Moving to a better-paid job: the offer we've taken, to sign once our notice at the old one is worked out.
    let switching: { offer: string; wage: number } | null = null;
    let searchingWork = false; // this month's look for a better-paid job while employed
    let nextJobSearch = ctx.rng("job-search-day").below(30) * DAY;
    const applied = new Set<string>();
    let nextMoveTry = 0; // when we next try moving into a home we hold a lease on
    // Attention: the market is looked at only when hunting, as a search (what's on offer now).
    let lookedAt = -1;
    const found: { homes: StatementRecord[]; jobs: StatementRecord[]; petitions: StatementRecord[] } = { homes: [], jobs: [], petitions: [] };
    /** Property for sale, as far as we know: what our last look at the listings showed (searched), or, shown listings
     * unasked, those standing. */
    let onSale: StatementRecord[] | null = null;
    let saleAsked = false;
    const forSaleNow = (): StatementRecord[] => (p.sale_board ? onSale ?? [] : book.open("property_for_sale"));
    let nextShopSearch = ctx.rng("shop-search-day").below(30) * DAY;
    const lookedUp = new Set<string>(); // shops whose prices we know from looking them up, not from passing
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
      // (With the mind's state behind it: training data for citizen models, contracts-0.7 A2.)
      const emotion = feelings.strongest(t);
      const held = Object.fromEntries([...beliefs].filter(([, b]) => b > 0).sort(([a], [b]) => (a < b ? -1 : 1)));
      const goal = [...pursuits.values()].find((x) => x.method !== undefined);
      decided.push({ t, domain, strategy: d.strategy, ...(d.key !== undefined ? { choice: d.key } : {}), options: d.scores.length ? d.scores : o.options.map((x) => ({ key: x.key, score: 0 })),
        state: { mind: MIND_VERSION, needs: { ...levelsNow }, satisfaction: d.satisfaction ?? 0, certainty: d.certainty ?? 0,
          ...(emotion ? { emotion } : {}), ...(Object.keys(held).length ? { beliefs: held } : {}), ...(goal ? { goal: { goal: goal.goal, method: goal.method! } } : {}) } });
      return d;
    };
    let levelsNow: NeedLevels = { subsistence: 10_000, shelter: 10_000, security: 10_000, social: 10_000, status: 10_000 }; // as last judged
    let nextShop = ctx.rng("shop-day").below(p.shop_every_days) * DAY;
    let lastShop: number | null = null; // when the last trip was
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
    // (`gone`: we went home as it ended, in the middle of a long plan, with those still there then: `seen`.)
    let attending: { practice: string; host: string; space: string; until: number; gone?: boolean; seen?: string[] } | null = null;
    const going = new Map<string, number>();
    const decidedFor = new Map<string, number>();
    const companyAt = new Map<string, number>();
    const wentLast = new Set<string>();
    const stayedLast = new Set<string>();
    let practiceWake: number | null = null;
    // Belief: each teaching we know of -> how strongly we hold it (basis points); when it last faded.
    const beliefs = new Map<string, number>(Object.entries(p.beliefs as { [k: string]: number }));
    let fadedAt: number | null = null;
    const teachingsOf = (host: string) => book.assertions().filter((r) => (r.speaks_for ?? r.author) === host);
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
    // Rent (or our share of it) the bank told us it couldn't pay: still owed, and paid as soon as we can.
    const missed: { instruction: string; to: string; amount: number; what: string }[] = [];
    let payTold = -1;
    // Deaths in the household: those we've seen (in our own home, someone leaving because they died).
    const mourned = new Set<string>();
    let wasLeaseholder: boolean | null = null;
    let askedForCare = false;
    // A death at home we were told of by a child of the household (nobody grown was there to see it), and, as that
    // child, whose death we have told someone of.
    const toldDead: { person: string; space: string }[] = [];
    const toldOf = new Set<string>();
    // Children: those we already knew of (from the start), a pregnancy's due date, and when we next think about it.
    let knownChildren: Set<string> | null = null;
    let expectingUntil = 0;
    let nextFertility = ctx.rng("fertility-day").below(30) * DAY;
    const householdIncome = () => monthlyIncome() + (isLeaseholder() ? [...memberPay.values()].reduce((a, b) => a + b, 0) : 0);

    // ---- the land register, looked up (docs/behaviour/ownership.md, "What an owner knows, and what is looked up") ----
    // Nobody is shown the register. A title of ours reaches us as our own paper (held from the start, or passed to us);
    // what that paper doesn't say is looked up where it is kept, once: the plan of its lot, and, for a title that came
    // to us from someone else, the title itself and the dealings in it (was it theirs to pass on?).
    const planAsked = new Asked(); // lots whose plan we've asked the register for
    const titleAsked = new Asked(); // a title -> when we last asked the register about it
    /** In the order made (a record the kernel numbered is later than one it didn't, and than a lower number). */
    const madeBefore = (a: Record, b: Record) => {
      const n = (r: Record) => (r.id.startsWith("rec.") ? Number(r.id.slice(4)) : -1);
      return a.at - b.at || n(a) - n(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    };
    /** Whom a title is registered to, by what we've read of the register: the title, and the dealings in it in the order
     * made (a transfer counts if the holder made it, or whoever issued the title, as `ownerOf` reads a whole register).
     * Nobody: released or withdrawn, or not a title we've read. */
    const holderOf = (title: string): string | undefined => {
      const c = book.records.get(title) as any;
      if (c?.record !== "claim" || c.about?.kind !== "ownership" || book.released.has(c.id) || book.withdrawn.has(c.id)) return undefined;
      let holder: string = c.holder;
      for (const r of book.ofType("claim_transfer").filter((r: any) => r.claim === c.id).sort(madeBefore) as any[]) if (r.speaks_for === holder || r.speaks_for === c.speaks_for) holder = r.to;
      return holder;
    };
    /** The titles that are ours, as far as we've read: ours from the start, then those passed to us. */
    const ourTitles = (): { id: string; about: { object: string } }[] =>
      [...new Set([...book.claimsBy("holder", me).filter((c: any) => c.about?.kind === "ownership").map((c) => c.id), ...book.ofType("claim_transfer").filter((r: any) => r.to === me).map((r: any) => r.claim as string)])]
        .filter((id) => holderOf(id) === me).map((id) => book.records.get(id) as any);
    /** What we need to read in the register now, as one look: a title passed to us that we haven't read since (the
     * title and its dealings), else the plan of a lot of ours we've never seen. One thing a look; the next follows. */
    const registerLooks = (t: number): LookRequest[] => {
      const reg = p.register;
      if (!reg) return [];
      for (const r of book.ofType("claim_transfer") as any[]) {
        if (r.to !== me || titleAsked.since(r.claim) >= r.at) continue;
        titleAsked.again(r.claim, t);
        return [ask.one(reg.titles, r.claim), ask.about(reg.dealings, "claim", r.claim, { most: p.search_limit, oldest: true })];
      }
      for (const title of ourTitles()) {
        const lot = title.about.object;
        if (book.records.has(lot) || !planAsked.first(lot)) continue;
        return [ask.one(reg.lots, lot)];
      }
      return [];
    };

    /** A home we own (world-expansion 6.2): a lot whose title is ours (the world's, bought, or inherited), with a dwelling
     * we live in on it. What we pay on a loan for it (its text names the home) is what it costs us a month. */
    const findOwnHome = (obs: Observation) => {
      const street = obs.channels.street;
      if (!isLeaseholder() || street?.kind !== "sites") return;
      for (const title of ourTitles()) {
        const lot = title.about.object;
        const cells = new Set((book.records.get(lot) as any)?.data?.cells ?? []);
        const st = street.cells.find((c) => cells.has(c.cell) && c.structure)?.structure;
        const space = st?.spaces.find((sp) => sp.kind === "dwelling" && sp.occupants?.includes(me))?.space;
        if (!st || !space) continue;
        const loan = book.ofType("agreement").find((r: any) => r.record === "agreement" && r.terms.template === "loan" && r.terms.parties.includes(me) && book.inForce(r.id) && String(r.terms.text ?? "").includes(space)) as any;
        const repay = loan ? cents(loan.terms.commitments.find((c: any) => c.who === me)?.does?.outcome?.money?.amount ?? 0) : 0;
        home = { agreement: title.id, space, structure: st.structure, landlord: me, rent: repay, movedIn: true, owned: true };
        livingAt = null;
        return;
      }
    };

    const learnFromInitialRecords = (obs: Observation) => {
      // Agreements already in force when we first look (the world's genesis records).
      for (const r of book.ofType("agreement")) {
        if (r.record !== "agreement" || !r.terms.parties.includes(me) || !book.inForce(r.id)) continue;
        const since = book.signedAt(r.id) ?? 0;
        if (r.terms.template === "lease" && !home) {
          const lt = leaseTerms(r, me);
          const landlord = r.terms.parties.find((x) => x !== me)!;
          const order = book.all("request").find((x) => x.record === "statement" && x.kind === "request" && cites(x, r.id) && x.speaks_for === me)?.id;
          home = { agreement: r.id, space: lt.space!, structure: lt.structure!, landlord, rent: lt.rent, order, movedIn: true };
        }
        if (r.terms.template === "employment" && !job) {
          const employer = r.terms.parties.find((x) => x !== me)!;
          job = { agreement: r.id, employer, ...jobTerms(r, me), since };
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
      // What's paid to us against a debt owed us (by the debtor, or its bank under a garnishee order).
      for (const tx of channels.transactions(obs)) if (tx.settles && tx.from !== tx.to && ownBanked(obs, me)?.account === tx.to) settledToUs.set(tx.settles, (settledToUs.get(tx.settles) ?? 0) + cents(tx.amount));
      // At work (docs/behaviour/unions.md), taken in as it's seen, before the money that comes with it: a rise in an
      // enterprise agreement (paid from the next pay day), a stoppage called, and the return to work (our pay restarts).
      for (const r of news) {
        if (r.record !== "statement" || !job) continue;
        if (r.kind === "enterprise_agreement" && r.data?.employer === job.employer && r.at >= job.since) {
          job.wage = Math.floor((job.wage * (10_000 + Number(r.data?.rise_bps ?? 0))) / 10_000);
          job.paidAt = obs.t;
          // (Read at work some days after it was made: a pay at the new rate that came before we had read of the rise
          // was our wages as agreed, and counts as that now, as it would have had we known.)
          const net = job.wage - withholding(incomeTaxLaw(book), job.wage, job.period);
          for (const x of inflows) if (x.t >= r.at && (x.amount === job.wage || x.amount === net)) mind.learn("job", job.employer, 10_000);
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
      for (const c of channels.cells(obs)) if (home && c.structure?.structure === home.structure) {
        homeSite = c.structure;
        // The bin at home, each time we see it: emptied if there's less in it than last time.
        // (Emptied since we last looked, if there's well under what there would be had nobody come: less than last time
        // misses it for a household that looks weekly, at the same point of each week's round. When, we reckon from
        // what's in it now, no earlier than our last look.)
        const view = c.structure.variables?.[p.complain_about];
        const now = variableToday(view, obs.t) ?? 0;
        if (binSeen.structure !== home.structure) Object.assign(binSeen, { structure: home.structure, emptiedAt: obs.t });
        else if (binSeen.view && obs.t - binSeen.at >= DAY) {
          const untouched = variableToday(binSeen.view, obs.t) ?? 0;
          if (now < binSeen.value || now * 10 < untouched * 6)
            binSeen.emptiedAt = Math.max(binSeen.at, obs.t - Math.floor((now * DAY) / Math.max(1, view?.per_day ?? 1)));
        } else if (now < binSeen.value) binSeen.emptiedAt = obs.t;
        Object.assign(binSeen, { value: now, at: obs.t, view });
      }
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
        // (A home's price, paid us for one we're selling, and a mortgage's principal aren't income: they're the home's.)
        if (selling?.listing === "pending") selling.listing = book.open("property_for_sale").find((r) => r.speaks_for === me && r.data?.lot === selling!.lot)?.id ?? "pending";
        if (selling?.listing && selling.listing !== "pending" && !selling.listings.includes(selling.listing)) selling.listings.push(selling.listing);
        const sale = selling?.listings.length ? book.open("property_purchase").find((r) => basesOf(r).some((b) => selling!.listings.includes(b)) && r.data?.account === tx.from) : undefined;
        if (sale && selling) {
          selling.buyer ??= sale.speaks_for;
          selling.buyerAccount ??= tx.from;
          if (selling.buyerAccount === tx.from) selling.received += cents(tx.amount);
          continue;
        }
        if (buying && tx.settles && String((book.records.get(tx.settles) as any)?.terms?.text ?? "").includes(`their home, ${buying.space}`)) {
          buying.funded = true;
          continue;
        }
        inflows.push({ t: tx.t, amount: cents(tx.amount) });
        // Our wages, as agreed: the wage, less the income tax the law says our employer withholds.
        if (job && (cents(tx.amount) === job.wage || cents(tx.amount) === job.wage - withholding(incomeTaxLaw(book), job.wage, job.period))) {
          job.paidAt = tx.t;
          mind.learn("job", job.employer, 10_000); // an employer that pays, as agreed
        }
      }
      while (inflows.length && inflows[0]!.t < obs.t - p.income_window_days * DAY) inflows.shift();
      const ads = p.adverts ? obs.channels[p.adverts] : undefined;
      if (ads?.kind === "records" && ads.search) for (const r of ads.records) if (r.speaks_for) lookedUp.add(r.speaks_for);
      const sale = p.sale_board ? obs.channels[p.sale_board] : undefined;
      // (Only the answer to a look we just made: the channel goes on holding its last answer.)
      if (saleAsked && sale?.kind === "records" && sale.search) onSale = sale.records as StatementRecord[];
      saleAsked = false;
      for (const k of ["homes", "jobs", "petitions"] as const) {
        const ch = obs.channels[k];
        if (ch?.kind !== "records" || !ch.search) continue;
        if (looking === "leads" && k !== "petitions") leadFound[k] = ch.records as StatementRecord[];
        else found[k] = ch.records as StatementRecord[];
      }
      // Words from people: someone asking around, or someone telling us where to look.
      household = householdOf(book, me)?.data;
      for (const m of obs.inbox) {
        // The bank couldn't make a payment of our rent (or our share of it): we still owe it.
        const ours = [home?.order, share?.order, ...(home?.retiring ?? []).map((x) => x.order)];
        if (m.re && ours.includes(m.re) && PAYMENT_FAILED.is(m.text)) {
          const money = (book.records.get(m.re) as any)?.data?.outcome?.money;
          if (money?.to && Number.isInteger(cents(money.amount))) missed.push({ instruction: m.re, to: money.to, amount: cents(money.amount), what: m.re === share?.order ? "our share of the rent" : "the rent" });
          continue;
        }
        const from = household?.members.find((x) => x.participant === m.from && x.person !== me);
        const what = from ? hear(m.text) : undefined;
        if (from && what?.kind === "died") {
          toldDead.push({ person: what.person, space: what.space });
          continue;
        }
        if (from && what) {
          heard.push({ from, what });
          continue;
        }
        const person = m.from_entity ?? book.participantPerson.get(m.from) ?? m.from; // who wrote (the directory names their person)
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
          // Told what someone holds: if we hold it too, surer of it, the more so the more conformist we are. (Words alone
          // don't bring someone to a belief they don't hold; taking part, among those who keep to it, does: Henrich 2009.)
          for (const host of told.holdsTo ?? []) if (holdTo(host) > 0) strengthen(host, Math.round((p.belief.told_bps * (5_000 + mind.person.temperament.conformity)) / 10_000));
          continue;
        }
        const want = (Object.keys(ASKING) as Want[]).find((w) => ASKING[w] === m.text);
        if (want) asked.push({ from: m.from, want });
        // A place someone names in reply to our asking (not a reply about a record: those are institutions answering requests).
        else if (m.re && (askedAt.home !== undefined || askedAt.work !== undefined) && !book.records.has(m.re)) {
          leads = [...leads.filter((x) => x !== m.re), m.re].slice(-5);
          leadFrom.set(m.re, m.from_entity ?? book.participantPerson.get(m.from) ?? m.from);
        }
      }
      // Did the move-in we just attempted work?
      if (moving && lastWasMove && obs.outcomes.length) {
        if (obs.outcomes.at(-1)!.status === "applied" && home) home.movedIn = true;
        // (Under water: not a home anyone can live in. We end the lease, as a tenant of uninhabitable premises may.)
        if (obs.outcomes.at(-1)!.refusal?.code === "flooded" && home && !home.owned) uninhabitable = home.agreement;
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

    // A death at home: someone of the household left our home because they died (we see who left, and why). Looked for
    // at every wake at home, not only when the week's plan is made: whoever shares a home with someone who has died knows
    // it the next time they are awake there, leaving in the morning or coming in (docs/behaviour/deaths.md). Until
    // 2026-10-08 it was seen only in a full plan, made while the death was still among the home's last few departures,
    // which a household's own comings and goings push out within a day or two.
    const seeDeathAtHome = (obs: Observation): Step[] => {
      const steps: Step[] = [];
      const street = obs.channels.street;
      const t = obs.t;
      const ourHome = home?.space ?? livingAt;
      /** Those to be told of a household member's death, as far as we know whom they dealt with. */
      const tellOfDeath = (dead: Member, at: number): string[] => {
        const age = ageAt(dead, at, year);
        const school = p.school && age >= p.school.ages[0] && age <= p.school.ages[1] ? p.school.entity : undefined;
        return [...new Set([p.bank, p.utilities?.energy, school, home && !home.owned ? home.landlord : undefined].filter((x): x is string => !!x && x !== me))].sort();
      };
      if (household) {
        let hh: HouseholdData = household;
        const ours = ourHome && street?.kind === "sites" ? street.cells.flatMap((c) => c.structure?.spaces ?? []).filter((sp) => sp.space === ourHome) : [];
        const atHome = new Set(ours.flatMap((sp) => sp.occupants ?? []));
        // (Seen ourselves; or told by a child of the household, who tells one adult when none is at home: ours to report.)
        const died: { occupant: string; told?: string }[] = [...ours.flatMap((sp) => sp.left ?? []).filter((l) => l.reason === "died"), ...toldDead.splice(0).map((x) => ({ occupant: x.person, told: x.space }))];
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
          // Of the surviving adults at home now, the first in the household's list reports it, and writes the household's
          // new record (one who comes home later finds the record already without them, and has nothing to report).
          if ((d.told || grown.find((m) => atHome.has(m.person))?.person === me) && p.registry) {
            steps.push(because(`${dead.person}, of our household, has died: reporting it to the registry.`, say("death_notification", `${dead.person} has died.`, {
              to: [p.registry],
              // (And whom they had dealings with, as far as we know: their bank, the energy retailer, the school of a
              // child, the landlord if the lease is ours to know. The registry sends its entry to each.)
              data: { deceased: dead.person, tell: tellOfDeath(dead, t), ...(partner && survivors.some((m) => m.person === partner) ? { partner } : {}),
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
          // (Told of it, and we never knew where the household had come to live: it is there, and so do we.)
          if (d.told && !home && livingAt === null) {
            steps.push(because(`The household lives at ${d.told}: going there.`, moveIn(d.told)));
            livingAt = d.told;
          }
          // Our share of the rent went to the one who died: stop it.
          if (share?.order && heldLease) {
            steps.push(because(`${dead.person} held the lease and has died: stopping our share of the rent to them.`, withdraw(share.order, "The leaseholder has died.")));
            share = null;
          }
        }
        household = hh;
      }
      return steps;
    };

    const plan = (obs: Observation): Step[] => {
      if (plannedAt === -1) learnFromInitialRecords(obs);
      if (!home) findOwnHome(obs);
      const t = obs.t;
      // Our account at a bank (standing orders need one). Money brought from elsewhere is in our own keeping until we deposit it.
      const ours = channels.accounts(obs).filter((a) => a.holder === me).map((a) => ({ ...a, balance: cents(a.balance) }));
      const acc = ours.find((a) => a.custodian !== me);
      const steps: Step[] = [];
      if (acc) for (const k of ours) if (k.custodian === me && k.balance > 0) steps.push(because("Depositing the money we brought into our bank account.", pay(acc.account, k.balance, { from: k.account, for: "Deposit." })));
      // Rent the bank couldn't pay: paid now, before anything else, once there's enough (oldest first).
      while (acc && missed.length && missed[0]!.amount <= acc.balance) {
        const x = missed.shift()!;
        acc.balance -= x.amount;
        steps.push(because(`The bank couldn't pay ${x.what} (${usd(x.amount)}) when it was due: paying it now.`, pay(x.to, x.amount, { from: acc.account, for: `${x.what === "the rent" ? "Rent" : "Share of the rent"} missed (${x.instruction}).` })));
      }
      moveStep = null;
      childrenNow = children(t);
      // Are we in a building? Around us we see who's in our own buildings; without that view, assume we are.
      const street = obs.channels.street;
      const inside = (space: string) =>
        street?.kind !== "sites" || street.cells.some((c) => c.structure?.spaces.some((sp) => sp.space === space && sp.occupants?.includes(me)));

      // A death at home (seen at any wake there; here for one first seen as the plan is made).
      steps.push(...seeDeathAtHome(obs));

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
        const partner = household?.couples.find((c) => c.includes(me))?.find((x) => x !== me);
        const man = partner ? household!.members.find((m) => m.person === partner && m.sex === "male") : undefined;
        // With a partner, only when they're here with us (we see who's in our own home): the month's chance waits for it.
        const together = !man || (street?.kind === "sites" && street.cells.some((c) => c.structure?.spaces.some((sp) => sp.occupants?.includes(me) && sp.occupants?.includes(man.person))));
        if (body.sex === "female" && p.births && body.present && t >= nextFertility && t >= expectingUntil && together) {
          nextFertility = t + MONTH;
          const rate = [...(p.fertility_per_10000 as { from: number; rate: number }[])].reverse().find((r) => age >= r.from)?.rate ?? 0;
          if (rate > 0 && ctx.rng(`conceive-${t}`).below(120_000) < rate) {
            expectingUntil = t + p.gestation + MONTH;
            if (together) steps.push(because(`Having a child: at ${age}, the chance this month is ${rate} in 120,000 (${rate} births per 10,000 women a year at this age).`,
              C.call("birth", { name: C.text(`baby of ${me}`), template: childTemplate(), ...(man ? { with: man.person } : {}) })));
          }
        }
      }

      // An old rent's last payment made: stopping its order (the new rent's has taken over).
      if (home?.retiring?.some((x) => t >= x.at)) {
        for (const x of home.retiring.filter((x) => t >= x.at)) steps.push(because("The old rent's last payment is made: stopping its order; the new one takes over.", withdraw(x.order, "Replaced by a new standing order.")));
        home.retiring = home.retiring.filter((x) => t < x.at);
      }
      // A tenancy that has ended: move out and stop paying rent.
      if (home && t >= endsAt(home)) {
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
      if (job && !job.claimed && t < jobEnds(job) && !striking) {
        const last = job.paidAt ?? job.since;
        if (t - last > job.period + 5 * DAY) {
          job.claimed = true;
          mind.learn("job", job.employer, 0); // an employer that didn't pay: remembered
          feelings.feel("anger", job.employer, 8_000, t);
          const missed = Math.max(1, Math.floor((t - last) / job.period));
          steps.push(because(`Our wages haven't been paid for ${Math.floor((t - last) / DAY)} days: resigning, and claiming the ${usd(missed * job.wage)} we're owed.`,
            notice(job.agreement, "Resigning: our wages haven't been paid."),
            record("right", me, { kind: "debt", amount: missed * job.wage, for: `Unpaid wages (${missed} pay period${missed > 1 ? "s" : ""}).` }, { against: job.employer, basis: job.agreement })));
          job.leftAt = t;
        }
      }
      // A job that has ended.
      if (job && t >= jobEnds(job)) {
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
          if (terms.workplace && !p.round) s.push(moveIn(terms.workplace)); // (with the round, we go when work starts)
          steps.push(s);
          job = { agreement: r.id, employer: r.terms.parties.find((x) => x !== me)!, ...terms, since: t };
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
      const circumstances = (): Circumstances => ({ monthly_income: householdIncome(), savings: acc.balance, homeless: !home && !livingAt, essentials: p.essentials });
      if (!job && joblessSince === null) joblessSince = t;

      // Offers made to us: sign what we asked for and can afford.
      for (const r of fresh) {
        if (r.record !== "agreement" || !r.terms.parties.includes(me) || book.signedBy(r.id, me)) continue;
        const other = r.terms.parties.find((x) => x !== me)!;
        if (r.terms.template === "lease" && home && isLeaseholder() && cites(r, home.agreement) && r.terms.parties.includes(home.landlord)) {
          // A new lease for the home we have, as the old one runs out: signed if we can bear its rent (moving costs
          // too), its rent paid on the old one's days from the first after the old ends; the old order stops after its
          // last payment.
          const { rent, rentTo, space } = leaseTerms(r, me);
          const bearable = householdIncome() > 0 ? rent * 10_000 <= householdIncome() * p.rent_bearable_share_bps : affordable(rent, acc.balance);
          if (!rentTo || space !== home.space || !bearable) continue;
          let starts = Math.max(t, endsAt(home));
          let stopAt = t;
          const old = home.order ? (book.records.get(home.order) as any) : undefined;
          if (old && Number.isInteger(old.data?.every) && old.data.every > 0) {
            const every = old.data.every as number;
            const due0 = old.at + (Number.isInteger(old.data.first) ? old.data.first : every);
            starts = due0 >= starts ? due0 : due0 + Math.ceil((starts - due0) / every) * every;
            stopAt = starts - every + DAY;
          }
          steps.push(because(`Our landlord offers a new lease on ${home.space} as ours runs out, at ${usd(rent)} a month: staying, and signing it.`,
            sign(r.id), ["so", pay(rentTo, rent, { from: acc.account, every: MONTH, first: Math.max(0, starts - t), basis: r.id, for: `Rent for ${home.space}, monthly in advance.` })]));
          if (home.order && stopAt <= t) steps.push(because("The old lease's rent is replaced by the new one's.", withdraw(home.order, "Replaced by a new standing order.")));
          else if (home.order) home.retiring = [...(home.retiring ?? []), { order: home.order, at: stopAt }];
          home = { ...home, agreement: r.id, rent, order: undefined };
          pendingRef = { kind: "rent", agreement: r.id };
        } else if (r.terms.template === "lease" && !home) {
          const { rent, rentTo, space, structure } = leaseTerms(r, me);
          if (!space || !structure || !rentTo || !affordable(rent, acc.balance)) continue;
          // Signing (a record) and moving in (physics) are separate acts: the
          // flat may not be free yet if the last tenant hasn't left.
          steps.push(because(`Signing the lease offered for ${space}: ${usd(rent)} a month is within our budget (a third of household income, ${usd(Math.floor((householdIncome() * p.rent_share_bps) / 10_000))}; or six months' rent in savings without income)${thank(structure, t)}.`,
            sign(r.id),
            ["so", pay(rentTo, rent, { from: acc.account, every: MONTH, first: 0, basis: r.id, for: `Rent for ${space}, monthly in advance.` })],
          ));
          home = { agreement: r.id, space, structure, landlord: other, rent, movedIn: false };
          pendingRef = { kind: "rent", agreement: r.id };
          homelessSince = null;
        } else if (r.terms.template === "employment" && !job) {
          const terms = jobTerms(r, me);
          const s: Step = because(`Taking the job offered: ${usd(terms.wage)} every ${Math.round(terms.period / DAY)} days${thank(terms.workplace ? structureOf(terms.workplace) : undefined, t)}.`, sign(r.id));
          if (terms.workplace && !p.round) s.push(moveIn(terms.workplace)); // (with the round, we go when work starts)
          steps.push(s);
          job = { agreement: r.id, employer: other, ...terms, since: t };
          joblessSince = null;
        } else if (r.terms.template === "employment" && job && !switching && !retired && other !== job.employer) {
          // Offered a better-paid job while in one (we applied for it): we take it, give notice at ours, and start the
          // new one when the notice is worked out.
          const terms = jobTerms(r, me);
          if (terms.wage * job.period <= job.wage * terms.period) continue;
          switching = { offer: r.id, wage: terms.wage };
          steps.push(because(`Offered a better-paid job (${usd(terms.wage)} every ${Math.round(terms.period / DAY)} days, against our ${usd(job.wage)} every ${Math.round(job.period / DAY)}): taking it, and giving our employer the notice our contract asks.`,
            notice(job.agreement, "Resigning: moving to another job.")));
        }
      }

      // The union (docs/behaviour/unions.md): joining on starting a job, with the chance for its kind of employer; the
      // membership offered, signed, and its dues paid monthly; a protected action ballot, voted in (or not); a
      // stoppage, observed (out of the workplace until the return to work); a rise in an enterprise agreement, taken.
      // A member tells the union where they now work (or that they're out of work), as members keep their details up.
      if (p.union && isMember()) {
        const at = job?.employer ?? "";
        if (toldUnion === undefined) toldUnion = at; // (the register we joined with has it)
        else if (at !== toldUnion) {
          toldUnion = at;
          steps.push(because(at ? `Telling the union we now work at ${at}.` : "Telling the union we're out of work.",
            say("membership_update", at ? `I now work at ${at}.` : "I'm no longer in work.", { to: [p.union], visible: [me, p.union], data: { employer: at, ...(at && industryOf.has(at) ? { industry: industryOf.get(at) } : {}) } })));
        }
      }
      // What joining would mean to someone like us, if the run has the sparse mind (docs/design/ai-citizens.md 4): asked
      // once, and the decision waits for the answer (by the next wake).
      const saidJoin = p.union && job && joinAsked !== job.agreement && !retired && !isMember()
        ? (({ about, thing, options }) => consult(about, thing, options, acc.balance, t))(CONSULT_THINGS.join(p.union))
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
        const joins = !member && ctx.rng(`join-${job.agreement}`).below(10_000) < chance;
        // Recorded as the mind's decision (docs/design/ai-citizens.md 7): weighed, from the chance as the person came to it.
        if (!member) decided.push({ t, domain: "membership", strategy: "deliberate", choice: joins ? "join" : "not",
          options: [{ key: "join", score: chance }, { key: "not", score: 10_000 - chance }] });
        if (joins)
          steps.push(because(`A new job: joining the union (${rate / 100}% of those working in ${industry.replaceAll("_", " ")} do; for me, ${chance / 100}%${saidJoin ? `, thinking what it would mean to me: ${Math.round((saidJoin.join ?? 0) / 1_000)} of 10 against ${Math.round((saidJoin.not ?? 0) / 1_000)} not to` : ""}).`, say("membership_application", "Application to join.", { to: [p.union], visible: [me, p.union], data: { account: acc.account, employer: job.employer, industry } })));
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
        // (A ballot about a workplace we've left isn't ours to vote in.)
        if (r.kind === "action_ballot" && r.data?.employer === job?.employer && ctx.rng(`turnout-${r.id}`).below(10_000) < shifted(p.ballot_turnout_bps, p.sway.turnout * solidarity)) {
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
        if (job?.employer === backTo.employer && job.workplace === backTo.space && !p.round) steps.push(because("The stoppage is over: back to work.", moveIn(backTo.space)));
        backTo = null;
      }

      // A rent increase on our home (the landlord's notice, as the tenancy law allows): if we can still afford it, we pay
      // the new rent from when it starts; if not, we give notice and look for somewhere else.
      // (A notice we challenged, upheld by the tribunal: it applies after all.)
      const upheldNow = upheld.splice(0).map((id) => book.records.get(id)).filter((r): r is Record => !!r);
      if (home && isLeaseholder()) for (const r of [...fresh, ...upheldNow]) {
        if (r.record !== "statement" || r.kind !== "rent_increase" || r.data?.lease !== home.agreement || !(r.addressed_to ?? []).includes(me)) continue;
        const rent = cents(r.data.rent);
        // A notice that breaks the tenancy law (as we read the law): some of us take it to the tribunal, and pay the rent
        // as it was meanwhile; an invalid notice changes nothing.
        if (p.tribunal && !challenged.has(r.id) && r.speaks_for && breaches(book, { block: "publish", kind: "rent_increase", data: r.data }, r.speaks_for, r.at).length) {
          challenged.add(r.id);
          if (ctx.rng(`challenge-${r.id}`).below(10_000) < p.tribunal.challenge_bps) {
            feelings.feel("anger", home.landlord, 4_000, t);
            steps.push(because(`A notice of rent increase that breaks the law: taking it to the tribunal, and paying the rent as it was meanwhile.`,
              say("tribunal_application", `Application: the notice of rent increase ${r.id} from ${r.speaks_for} breaks the law; we ask that it be found invalid.`, { to: [p.tribunal.entity], visible: [me, p.tribunal.entity, r.speaks_for], basis: r.id, data: { kind: "rent_increase", against: r.speaks_for, notice: r.id, evidence: evidence(r) } })));
            continue;
          }
        }
        // Angry with the landlord, the more so the more of our income it takes (a placeholder scale).
        const riseShare = householdIncome() > 0 ? ((rent - home.rent) * 10_000) / householdIncome() : 10_000;
        if (rent > home.rent) feelings.feel("anger", home.landlord, 2_000 + 20 * riseShare, t);
        const lease = book.records.get(home.agreement);
        const rentTo = lease ? leaseTerms(lease, me).rentTo : undefined;
        const bearable = householdIncome() > 0 ? rent * 10_000 <= householdIncome() * p.rent_bearable_share_bps : affordable(rent, acc.balance);
        if (bearable && rentTo) {
          const s: Step = because(affordable(rent, acc.balance)
            ? `Our rent goes up to ${usd(rent)} a month (from ${usd(home.rent)}): still within our budget, so we'll pay it from when it starts.`
            : `Our rent goes up to ${usd(rent)} a month (from ${usd(home.rent)}): more than a third of household income, but we can bear it (up to ${usd(Math.floor((householdIncome() * p.rent_bearable_share_bps) / 10_000))}), and moving costs too: we'll pay it from when it starts.`);
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
          steps.push(because(`Our rent goes up to ${usd(rent)} a month, beyond what we can bear (${usd(Math.floor((householdIncome() * p.rent_bearable_share_bps) / 10_000))} of household income): giving notice, to find somewhere else.`,
            notice(home.agreement, "We can't afford the new rent.")));
        }
      }

      // Moving into a home we hold a lease on, once there's physical room: with the children, in one go.
      if (home && !home.movedIn && livingAt && livingAt !== home.space) {
        // We still live where the household used to (the lease there wasn't ours): leave it first.
        if (inside(livingAt)) steps.push(because("Moving out of our old home, to the one we now hold a lease on.", moveOut(livingAt, me)));
        for (const k of children(t)) steps.push(because("Taking the children out of our old home.", moveOut(livingAt, k.person)));
        livingAt = null;
      }
      if (uninhabitable && home?.agreement === uninhabitable) {
        steps.push(because("The home we lease is under water: ending the lease, as one may for premises no one can live in.", notice(home.agreement, "The premises are uninhabitable (flooded)."),
          ...(home.order ? [withdraw(home.order, "Lease ended: the premises are flooded.")] : [])));
        home = null;
        homelessSince = t;
      }
      uninhabitable = null;
      // (Already there, the round having brought us: in.)
      if (home && !home.movedIn && obs.body?.in === home.space) home.movedIn = true;
      // (Tried and not yet in, because the last tenants are still there: again the next day, whenever we look again.)
      if (home && !home.movedIn && t >= nextMoveTry) {
        nextMoveTry = t + DAY;
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
      const wouldLeave = isLeaseholder() && (
        (homelessSince !== null && t - homelessSince >= homelessDays * DAY) ||
        (joblessSince !== null && t - joblessSince >= joblessDays * DAY && earnedIncome() + (isLeaseholder() ? [...memberPay.values()].reduce((a, b) => a + b, 0) : 0) === 0 && broke));
      // (An owner who'd leave sells first, and goes once it's sold: docs/behaviour/ownership.md.)
      if (wouldLeave && home?.owned && p.market && !selling) { const lot = ownLot(); if (lot) sell(obs, lot, true); }
      const leave = wouldLeave && !home?.owned && !selling;
      if (leave) {
        const why = homelessSince !== null && t - homelessSince >= homelessDays * DAY
          ? `Leaving town: ${Math.floor((t - homelessSince) / DAY)} days without a home (we leave after ${homelessDays}).`
          : `Leaving town: ${Math.floor((t - joblessSince!) / DAY)} days with nobody in the household earning (we leave after ${joblessDays}), and less money than a month's rent or essentials.`;
        const tell: Step[] = adults(t).map((a) => because(why, message([reach(a)], SAYING.leaving())));
        // What's already planned this wake (a newborn brought home and put on the household's record) comes first.
        return [...steps, ...tell, ...departure(acc, why)];
      }

      wordOfMouth(obs, t, steps);
      civic(obs, t, steps);
      bodily(obs, t, steps, inside);
      justice(obs, t, steps);
      market(obs, t, steps);
      if (soldAndGoing !== null && t > soldAndGoing) {
        soldAndGoing = null;
        return [...steps, ...departure(ownBanked(obs, me), "Our home sold: leaving town, as we meant to.")];
      }

      // Taking part (docs/design/ai-citizens.md 2b): gatherings the world holds (practices), where we may come. Going is
      // physics: being in the space for its time. Whether to go is the mind's: the company it brings against the time it
      // takes, how it went the times we went, and who we know goes.
      {
        const age = obs.body ? (t - obs.body.born_at) / year : 0;
        const mayCome = (w?: Eligibility) => !w || ((!w.members_of || memberOf(w.members_of)) && !w.holds && (!w.entities || w.entities.includes(me)) && (!w.min_age_years || age >= w.min_age_years));
        const there = (space: string) => street?.kind === "sites" ? (street.cells.flatMap((c) => c.structure?.spaces ?? []).find((sp) => sp.space === space)?.occupants ?? []).filter((o) => o !== me) : [];
        // Back from one: who was there, and how it was (turned away, it counts for nothing).
        if (attending && t >= attending.until) {
          const others = attending.seen ?? there(attending.space);
          const got = !!attending.gone || inside(attending.space);
          // (What it teaches, held, makes it mean more; and others there, keeping to it at a cost of their time, make it
          // more credible: Henrich's credibility-enhancing displays.)
          const meaning = Math.round(holdTo(attending.host) * p.belief.meaning);
          mind.learn("practice", attending.practice, got ? Math.min(10_000, Math.round(Math.log1p(others.length) * 2_500) + meaning) : 0);
          if (got) strengthen(attending.host, Math.round((p.belief.display_bps * Math.min(20, others.length)) / 20));
          if (got) {
            // (Before anything else: it's over now. Acts take time, so a plan's order is the order things get done.)
            if (!attending.gone) steps.unshift(because(`${attending.host}'s gathering is over (${others.length} others were there): going home.`, moveOut(attending.space, me)));
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
              if (!inside(pr.at)) steps.unshift(because(`Going to ${host}'s gathering.`, moveIn(pr.at))); // (first: it's on now)
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
        if (binSeen.structure !== home.structure) Object.assign(binSeen, { structure: home.structure, value: now, emptiedAt: t });
        const days = Math.floor((t - binSeen.emptiedAt) / DAY);
        if (complainedOf === home.structure && days < 7) complainedOf = null;
        // Angry with whoever should collect it, the more so the longer it's been (half-way at `complain_after_days`);
        // we write once our anger passes our own threshold (the conformist bears it longer), with the week's chance.
        if (now > 0) feelings.feel("anger", p.complain_to, Math.min(10_000, Math.floor(((t - binSeen.emptiedAt) * 5_000) / (DAY * p.complain_after_days))), t);
        const bearing = 5_000 + Math.round((mind.person.temperament.conformity - 5_000) * 0.4);
        // (And only while it's still there, a week or more on.)
        if (now > 0 && days >= 7 && feelings.level("anger", p.complain_to, t) >= bearing && complainedOf !== home.structure && ctx.rng(`complain-${t}`).below(10_000) < p.complain_bps) {
          complainedOf = home.structure;
          steps.push(because(`Our ${p.complain_about} hasn't been collected for about ${days} days: writing to the town.`,
            say("complaint", `Our ${p.complain_about} at ${home.structure} hasn't been collected for about ${days} days.`, { to: [p.complain_to], visible: [me, p.complain_to], data: { structure: home.structure, about: p.complain_about, days } })));
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
        const listings = forSaleNow().filter((l) => p.ventures.some((v) => v.kind === l.data?.type)).sort((a, b) => (a.data.price as number) - (b.data.price as number) || (a.id < b.id ? -1 : 1));
        const l = listings.find((x) => acc.balance >= (x.data.price as number) + p.ventures.find((v) => v.kind === x.data.type)!.capital + 3 * (housing + p.essentials));
        // The month's chance (the cited prior), shifted by the person: the open (stimulation, self-direction) and those
        // who value achievement found more often.
        const enterprise = p.sway.enterprise_openness * (zValue("stimulation") + zValue("self_direction")) / 2 + p.sway.enterprise_achievement * zValue("achievement");
        // And by what the model says it would mean to someone like us, if the run has the sparse mind: we think it over
        // (asked once, decided at the next wake).
        const saidFound = l ? (({ about, thing, options }) => consult(about, thing, options, acc.balance, t))(CONSULT_THINGS.found(String(l.data.type))) : undefined;
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
      // Utilities: signed up for energy once we hold a home and live there; bills paid when they come, if we can (before
      // anything else we spend on), and counted with the rent in the month's outgoings.
      if (p.utilities && home?.movedIn && isLeaseholder() && energyFor !== home.agreement) {
        energyFor = home.agreement;
        steps.push(because("A home of ours: signing up for its energy supply.", say("supply_request", `Supply request: energy for ${home.space}.`, { to: [p.utilities.energy], visible: [me, p.utilities.energy], data: { account: acc.account, home: home.space } })));
      }
      // A tribunal's order that we pay (a debt, or making good what we took): paid when we can, keeping a month's essentials.
      for (const o of book.open("tribunal_order").filter((x) => x.data?.against === me && x.data?.finding === "pay" && !billsPaid.has(x.id))) {
        const amount = cents(o.data?.amount ?? 0);
        const to = o.data?.to;
        if (!to || amount <= 0 || acc.balance < amount + p.essentials) continue;
        billsPaid.add(o.id);
        acc.balance -= amount;
        steps.push(because(`The tribunal ordered us to pay ${usd(amount)}: paying it.`, pay(String(to), amount, { from: acc.account, for: `Paying under order ${o.id}.`, settles: String(o.data?.claim ?? o.id) })));
      }
      // Taking (crime): in need (less than a month's essentials), at work where our employer keeps goods, rarely, the more
      // rarely the likelier we'd be caught; and home with them.
      // (Where the employer keeps goods: one that sells them, by its price list. A builder's yard holds materials: until
      // 2026-10-02 its workers tried, and found none.)
      const sellsGoods = !!job && goodsPrices(book, job.employer).prices[p.goods] !== undefined;
      if (p.crime && job?.workplace && sellsGoods && obs.body?.in === job.workplace && acc.balance < p.essentials && t >= nextTakeChance) {
        nextTakeChance = t + MONTH;
        const chance = Math.round((p.crime.take_bps * (10_000 - p.crime.caught_bps)) / 10_000);
        const homeAt = home?.movedIn ? structureOf(home.space) : livingAt ? structureOf(livingAt) : undefined;
        if (homeAt && ctx.rng(`take-${t}`).below(10_000) < chance) {
          const at = structureOf(job.workplace);
          steps.push(because(`We can't make ends meet (${usd(acc.balance)}, less than a month's essentials): taking ${p.crime.quantity} ${p.goods} from ${job.employer}'s stock at work, and home with them.`,
            C.call("take", { kind: p.goods, quantity: C.text(String(p.crime.quantity)), from: job.employer, at }),
            C.call("goods", { kind: p.goods, quantity: C.text(String(p.crime.quantity)), to: me, at: homeAt, from_at: at })));
        }
      }
      // What's recorded against us to pay (rates on a home we own, a fine): paid when we can, keeping a month's essentials.
      for (const c of book.claimsBy("counterparty", me) as readonly any[]) {
        if (c.counterparty !== me || c.position !== "right" || !["rates", "rates_interest", "fine"].includes(c.about?.kind) || billsPaid.has(c.id)) continue;
        const amount = cents(c.about.amount ?? 0);
        const to = c.about.account;
        if (!to || amount <= 0 || acc.balance < amount + p.essentials) continue;
        billsPaid.add(c.id);
        bills.push({ at: t, amount });
        acc.balance -= amount;
        steps.push(because(`Paying the ${c.about.kind} recorded against us (${c.about.for ?? c.id}).`, pay(to, amount, { from: acc.account, for: `Paying ${c.about.kind} ${c.id}.`, settles: c.id })));
      }
      for (const inv of book.open("invoice").filter((r) => (r.addressed_to ?? []).includes(me) && r.data?.service && !billsPaid.has(r.id))) {
        const m = inv.data?.outcome?.money;
        const amount = cents(m?.amount ?? 0);
        if (!m?.to || amount <= 0 || acc.balance < amount) continue;
        billsPaid.add(inv.id);
        bills.push({ at: t, amount });
        acc.balance -= amount;
        steps.push(because(`Paying our ${inv.data?.service} bill.`, pay(m.to, amount, { from: acc.account, for: `${inv.data?.service} bill.`, settles: inv.id })));
      }
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
        const housing = (home?.rent ?? share?.cents ?? 0) + billsMonthly(t);
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
          // (Chosen once: the draw is this order's own, the same however often it's made, so not once per shop looked at.)
          const chosen = untried.length ? mind.learned("shop").choose(ctx.rng(`retry-${d.order}`), untried.map((u) => ({ key: u.shop, value: 0 })), mind.person.temperament.openness).key : undefined;
          const next = untried.find((x) => x.shop === chosen);
          const retried = !!next && buy(next, Math.min(short, Math.floor((short * (priceAt(d.seller)?.price ?? next.price)) / next.price)), `${d.seller} could serve ${d.delivered} of the ${d.ordered} we wanted: trying ${next.shop} for the rest.`, d.order);
          if (!retried && d.refund > 0) deferred += d.refund;
        }
        if (t >= nextShop) {
          nextShop = t + p.shop_every_days * DAY;
          trip = { at: t, tried: new Set() };
          const r = ctx.rng(`shopping-${t}`);
          // The trip's spending is for the time since the last one: a trip can only be made when we're awake, often a
          // few days after it was due, and spending a fixed fortnight's worth left a tenth of what was meant to be spent
          // unspent (23 trips a year, not 26). Up to two fortnights' worth: a long absence isn't made up at once.
          const since = lastShop === null ? p.shop_every_days * DAY : Math.min(t - lastShop, 2 * p.shop_every_days * DAY);
          lastShop = t;
          const budget = Math.min(acc.balance, Math.floor((monthly() * since) / MONTH) + carried + deferred);
          // Which shop: the mind's decision among the shops' offers, each for what the trip's budget buys there.
          const offerOf = (shop: string) => shopOffer(book, shop);
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
      ...[...new Set(book.assertions().filter((r) => (beliefs.get(r.id) ?? 0) >= p.belief.tell_at_bps).map((r) => r.speaks_for ?? r.author))].sort().map(CATCHING_UP.holds),
      // (Held less firmly, but still one's own, as someone would answer a census: said, without urging it on anyone.)
      ...[...new Set(book.assertions().filter((r) => { const b = beliefs.get(r.id) ?? 0; return b >= p.belief.affiliate_bps && b < p.belief.tell_at_bps; }).map((r) => r.speaks_for ?? r.author))].sort().map(CATCHING_UP.leans),
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
      // (Tenants only: an owner has no landlord, and no tenancy to protect.)
      const tenancy = home && !home.owned ? home : null;
      const burden = tenancy && householdIncome() > 0 ? (tenancy.rent * 10_000) / householdIncome() : 0;
      const noticed = [...book.notices.entries()].some(([ag, ns]) => ag === home?.agreement && ns.some((n) => n.as !== me));
      // Aggrieved: angry with our landlord (given notice to go, or a rent rise), while it lasts; or while the rent
      // takes too much of our income.
      if (tenancy && noticed) feelings.feel("anger", tenancy.landlord, 6_000, t);
      const aggrieved = !!tenancy && (burden >= p.rent_burden_grievance_bps || feelings.level("anger", tenancy.landlord, t) >= p.aggrieved_bps);
      const open = found.petitions.filter((x) => (x.data?.demand?.tags ?? []).includes("tenant_protection"));
      // An organiser closes their petition after `petition_days`; a new one can then start.
      for (const pet of open) if (pet.speaks_for === me && t - pet.at >= p.petition_days * DAY && !signed.has(`closed-${pet.id}`)) {
        signed.add(`closed-${pet.id}`);
        steps.push(because(`Closing our petition after ${p.petition_days} days.`, withdraw(pet.id, "Petition closed.")));
      }
      if (willing && aggrieved && open.length === 0 && ctx.rng(`petition-${t}`).below(10_000) < p.petition_start_bps) {
        steps.push(because(`Aggrieved (${noticed ? "our landlord gave us notice" : `rent is ${Math.round(burden / 100)}% of household income`}) and no tenants' petition is open: starting one.`, say("petition", "Petition: landlords must give 90 days' notice, and may not raise rent by more than 5% a year.", { data: { demand: {
          kind: "law", text: "A landlord must give at least 90 days' notice to end a tenancy, and may not raise the rent by more than 5% in any 12 months.",
          adico: { attribute: "landlords", deontic: "must_not", aim: "end a tenancy on less than 90 days' notice, or raise rent by more than 5% a year" }, tags: ["tenant_protection"],
          // (The notice it asks for, as a figure of the law on ending a tenancy. The cap on rises is in no law's figures.)
          ...(p.tenancy_schedule ? { amend: { schedule: p.tenancy_schedule, figures: { notice: 90 * DAY } } } : {}) } } })));
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
    // When our home or job ends: by the terms' reading (a term run out, or notice given by either side under its clause),
    // or, for a job, when we walked out.
    const endsAt = (x: { agreement: string }) => book.endsAt(x.agreement) ?? Number.MAX_SAFE_INTEGER;
    const jobEnds = (j: Job) => Math.min(j.leftAt ?? Number.MAX_SAFE_INTEGER, endsAt(j));
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
    // ---- civic life: the roll, approval of the town's government, standing and voting, the paper ----
    let enrolled: boolean | null = null; // (on the roll at the start, if the world enrolled us)
    let approval = 0; // of the town's government (its office holders), -10,000 to 10,000
    let approvedAt = -1;
    const voted = new Set<string>();
    const stoodFor = new Set<string>();
    const readsNews = ctx.rng("reads-news").below(10_000) < p.civic.reads_news_bps;
    const readItems = new Set<string>();
    // ---- the daily round (world-expansion 6.3) ----
    let lastDwelling: string | undefined; // the home we were last in (a dwelling): where we go back to
    let nextPlanAt = 0; // when our next full plan is due (a week on from the last): other wakes only take us where we belong
    const tod = (t: number) => t - Math.floor(t / DAY) * DAY;
    const workday = (t: number, days: number) => Math.floor(t / DAY) % 7 < days;
    /** Where we belong now: school or work in their hours (not while too ill, on strike, or gone from the job), the clinic
     * while waiting there, a gathering while it lasts; otherwise home. Undefined: anywhere will do (no round, no home). */
    const belong = (obs: Observation): string | undefined => {
      const r = p.round;
      if (!r || !obs.body) return undefined;
      const t = obs.t;
      const street = obs.channels.street;
      const here = obs.body.in;
      if (here && street?.kind === "sites" && street.cells.some((c) => c.structure?.spaces.some((sp) => sp.space === here && sp.kind === "dwelling"))) lastDwelling = here;
      let home_ = home?.movedIn ? home.space : livingAt ?? lastDwelling;
      // (Our home under water: the relief centre, until a day on, when we try home again.)
      if (floodedOut && t < floodedOut.until && home_ === floodedOut.home && p.relief) home_ = p.relief;
      if (atClinic && p.care) return p.care.waiting;
      if (attending && !attending.gone && t < attending.until) return here;
      const age = Math.floor((t - obs.body.born_at) / year);
      if (age < ADULT_YEARS) {
        const place = p.school && age >= p.school.ages[0] && age <= p.school.ages[1] ? book.open("school_place").filter((x) => (x.addressed_to ?? []).includes(me)).sort((a, b) => b.at - a.at)[0] : undefined;
        if (place?.data?.classroom && workday(t, r.work_days) && tod(t) >= r.school_start && tod(t) < r.school_end) return String(place.data.classroom);
        return home_;
      }
      if (job?.workplace && !offSick && !striking?.out && t < jobEnds(job) && workday(t, r.work_days) && tod(t) >= r.work_start && tod(t) < r.work_end) return job.workplace;
      return home_;
    };
    /** The next time where we belong may change: work and school starting or ending, on working days. */
    const nextChange = (t: number): number => {
      const r = p.round!;
      let best = Infinity;
      for (const at of [r.work_start, r.work_end, r.school_start, r.school_end]) best = Math.min(best, nextLook(t, at, r.work_days));
      return best;
    };
    /** Going where we belong, if we're not there (not again before things change, if the world refused it: a home pulled
     * down, a workplace full). */
    let refusedGo: { to: string; until: number } | null = null;
    const goWhereWeBelong = (obs: Observation): Step | undefined => {
      const to = belong(obs);
      if (!to || obs.body?.in === to) return undefined;
      if (refusedGo && refusedGo.to === to && obs.t < refusedGo.until) return undefined;
      const st: Step = because(to === obs.body?.in ? "" : `${job?.workplace === to ? "Off to work" : home?.space === to || livingAt === to || lastDwelling === to ? "Home" : "Going"}: ${to}.`, moveIn(to));
      (st as any).goTo = to;
      return st;
    };
    /** The round move we sent last, and how it went (the outcome comes with our next look). */
    let pendingGo: string | null = null;
    let floodedOut: { home: string; until: number } | null = null;
    let nextTakeChance = 0;
    let uninhabitable: string | null = null; // a lease on a home we found under water
    const heardGo = (obs: Observation) => {
      if (!pendingGo) return;
      const out = obs.outcomes.at(-1);
      const to = pendingGo;
      pendingGo = null;
      if (!out || out.status === "applied") return;
      refusedGo = { to, until: nextChange(obs.t) };
      // (Our home under water: to the relief centre at once. Work or school under water: not before things change.)
      const homeNow = home?.movedIn ? home.space : livingAt ?? lastDwelling;
      if (out.refusal?.code === "flooded" && to === homeNow && p.relief) {
        floodedOut = { home: to, until: obs.t + DAY };
        refusedGo = null;
      }
      // (A place pulled down, or coming down: not again.)
      if (["unknown_structure", "unknown_space", "coming_down"].includes(out.refusal?.code ?? "")) {
        refusedGo = { to, until: Infinity };
        if (lastDwelling === to) lastDwelling = undefined;
        if (livingAt === to) livingAt = null;
      }
    };
    const sendGo = (st: Step) => {
      pendingGo = (st as any).goTo ?? null;
      return callAction(st);
    };

    // ---- utilities ----
    let energyFor: string | undefined; // the lease we've signed up for energy on
    const billsPaid = new Set<string>();
    const bills: { at: number; amount: number }[] = [];
    /** What our bills come to a month: what we've paid over the last 90 days (from when we first paid one). */
    const billsMonthly = (t: number) => {
      while (bills.length && t - bills[0]!.at > 90 * DAY) bills.shift();
      if (!bills.length) return 0;
      const span = Math.max(30 * DAY, Math.min(90 * DAY, t - bills[0]!.at + 30 * DAY));
      return Math.floor((bills.reduce((a, b) => a + b.amount, 0) * MONTH) / span);
    };

    // ---- homes for sale (docs/behaviour/ownership.md) ----
    type Selling = { lot: string; space?: string; structure: string; bedrooms?: number; price: number; asked: number; /** Every listing we've made of it (a buyer may answer one since replaced by a cheaper). */ listings: string[]; leaveAfter: boolean; listing?: string; buyer?: string; buyerAccount?: string; received: number; sold?: boolean; loan?: string };
    let selling: Selling | null = null;
    let buying: { listing: string; seller: string; account: string; price: number; lot: string; space: string; structure: string; stage: "applied" | "paid"; since: number; funded?: boolean; goneSince?: number } | null = null;
    let nextBuyChance = ctx.rng("buy-day").below(30) * DAY;
    let soldAndGoing: number | null = null; // when we'd sold up to leave (we go at a later wake, with what's left)
    const soldLots = new Set<string>();
    /** The title to a lot: ours, if one of those we've read is; else the first we've read. */
    const titleOf = (lot: string) => { const all = book.claimsBy("object", lot).filter((c: any) => c.about?.kind === "ownership") as any[]; return all.find((c) => holderOf(c.id) === me) ?? all[0]; };
    const valuationOf = (lot: string) => book.open("valuation").filter((v) => v.data?.lot === lot).sort((a, b) => b.at - a.at)[0]?.data?.value as number | undefined;
    const mortgageFor = (space: string) => book.ofType("agreement").find((r: any) => r.record === "agreement" && r.terms.template === "loan" && r.terms.parties.includes(me) && book.inForce(r.id) && String(r.terms.text ?? "").includes(space)) as any;
    /** The house on a lot (from the street), and its dwelling. */
    const houseOn = (obs: Observation, lot: string) => {
      const cells = new Set((book.records.get(lot) as any)?.data?.cells ?? []);
      const st = channels.cells(obs).find((c) => cells.has(c.cell) && c.structure)?.structure;
      return st ? { structure: st.structure, type: st.type, space: st.spaces.find((sp) => sp.kind === "dwelling")?.space } : undefined;
    };
    /** The lot our own home stands on: the one its title names (our own paper: nothing to look up). */
    const ownLot = () => (home?.owned ? (book.records.get(home.agreement) as any)?.about?.object as string | undefined : undefined);
    /** Put a lot of ours with a house on it up for sale, at its valuation. */
    const sell = (obs: Observation, lot: string, leaveAfter: boolean): boolean => {
      const h = houseOn(obs, lot);
      const price = valuationOf(lot);
      if (!h?.space || !price) return false;
      selling = { lot, space: h.space, structure: h.structure, bedrooms: p.market?.bedrooms_by_type[h.type], price, asked: price, listings: [], leaveAfter, received: 0, loan: mortgageFor(h.space)?.id };
      return true;
    };
    const market = (obs: Observation, t: number, steps: Step[]) => {
      const m = p.market;
      const acc = ownBanked(obs, me);
      if (!m || !acc || !isLeaseholder()) return;
      // Our mortgage in default: the home sold before the bank takes it (we rent after).
      const ourLoan = home?.owned ? mortgageFor(home.space) : undefined;
      if (!selling && ourLoan && book.all("loan_default").some((r) => r.data?.loan === ourLoan.id && (r.addressed_to ?? []).includes(me))) {
        const lot = ownLot();
        if (lot) sell(obs, lot, false);
      }
      // Inherited land with a house we don't live in: sold.
      if (!selling) for (const r of book.ofType("claim_transfer")) {
        const lot = r.to === me ? (book.records.get(r.claim) as any)?.about?.object as string | undefined : undefined;
        if (!lot || soldLots.has(lot) || holderOf(r.claim) !== me || home?.owned && r.claim === home.agreement) continue;
        if (sell(obs, lot, false)) break; // (Not until it's valued in our name.)
      }
      // ---- selling: listed at the valuation; once paid in full, the title passed and the mortgage paid off ----
      const s = selling as Selling | null;
      if (s?.listing === "pending") s.listing = book.open("property_for_sale").find((r) => r.speaks_for === me && r.data?.lot === s.lot)?.id ?? "pending";
      if (s?.listing && s.listing !== "pending" && !s.listings.includes(s.listing)) s.listings.push(s.listing);
      if (s && !s.listing) {
        s.listing = "pending";
        const st = because(`Selling ${s.structure} at its valuation, ${usd(s.price)}${s.leaveAfter ? ", to leave town once it's sold" : ""}.`,
          say("property_for_sale", `For sale: ${s.structure}, a home${s.bedrooms ? ` with ${s.bedrooms} bedrooms` : ""}, ${usd(s.price)}. To buy it, send a purchase naming this listing, and pay.`, { visible: "public",
            data: { structure: s.structure, lot: s.lot, space: s.space, type: "home", price: s.price, account: acc.account, ...(s.bedrooms ? { bedrooms: s.bedrooms } : {}) } }));
        steps.push(st);
      } else if (s?.listing && s.listing !== "pending" && !s.sold && !s.buyer && t - (book.records.get(s.listing)?.at ?? t) >= m.relist_days * DAY
        && s.price > Math.floor((s.asked * m.floor_bps) / 10_000)) {
        const was = s.price;
        s.price = Math.max(Math.floor((s.asked * m.floor_bps) / 10_000), s.price - Math.floor((s.price * m.cut_bps) / 10_000));
        steps.push(because(`${s.structure} hasn't sold in ${m.relist_days} days at ${usd(was)}: taking it off, to list it for ${usd(s.price)}.`, withdraw(s.listing, "Relisting for less.")));
        s.listing = undefined;
      } else if (s?.listing && s.listing !== "pending" && !s.sold) {
        // (A purchase answering any listing we made of it: until 2026-10-05 only the current one, and a buyer whose
        // mortgage came through as we relisted for less paid us, and got nothing.)
        const buy = s.buyer ? undefined : book.open("property_purchase").filter((r) => basesOf(r).some((b) => s.listings.includes(b)) && (r.addressed_to ?? []).includes(me)).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))[0];
        if (buy) {
          s.buyer = buy.speaks_for;
          s.buyerAccount = String(buy.data?.account);
        }
        if (s.buyer && s.received >= s.price) {
          s.sold = true;
          soldLots.add(s.lot);
          const title = titleOf(s.lot);
          steps.push(because(`${s.buyer} has paid ${usd(s.received)} for ${s.structure}: passing them the title.`,
            ...(title ? [C.call("claim", { transfer: title.id, to: s.buyer })] : []), withdraw(s.listing, "Sold."),
            // (Paid at an earlier, higher price: the difference goes back.)
            ...(s.received > s.price && s.buyerAccount ? [pay(s.buyerAccount, s.received - s.price, { from: acc.account, for: `The difference: ${s.structure} was down to ${usd(s.price)}.` })] : []),
            say("property_sold", `Sold: ${s.structure} to ${s.buyer} for ${usd(s.price)}.`, { visible: "public", basis: s.listing, data: { structure: s.structure, lot: s.lot, buyer: s.buyer, price: s.price } })));
          if (s.loan) steps.push(because("Sold: asking the bank what paying our mortgage off takes.",
            say("loan_payout_request", `What does paying off ${s.loan} take?`, { to: [p.bank], visible: [me, p.bank], data: { loan: s.loan } })));
          // (Leaving: we stay in it until we go, a day or so. Not leaving: we look for somewhere to rent, and stay until we
          // find it.)
          if (!s.leaveAfter && home?.owned && home.space === s.space) home = null;
          if (!s.loan) {
            if (s.leaveAfter) soldAndGoing = t;
            selling = null;
          }
        }
      } else if (s?.sold && s.loan) {
        const fig = book.open("loan_payout").find((r) => r.data?.loan === s.loan && (r.addressed_to ?? []).includes(me));
        if (fig) {
          const amount = cents(fig.data?.amount ?? 0);
          const order = book.all("request").find((r) => r.record === "statement" && r.kind === "request" && cites(r, s.loan) && r.speaks_for === me && !book.withdrawn.has(r.id));
          steps.push(because(`Paying our mortgage off (${usd(amount)}), and stopping its repayments.`,
            pay(String(fig.data?.account), amount, { from: acc.account, for: `Paying off ${s.loan}.`, settles: s.loan }), ...(order ? [withdraw(order.id, "Mortgage paid off.")] : [])));
          if (s.leaveAfter) soldAndGoing = t;
          selling = null;
        }
      }
      // ---- buying: a renting household with income that can afford a home that suits it, now and then ----
      const b = buying as typeof buying;
      if (b?.stage === "applied") {
        const declined = book.all("loan_decision").some((r) => r.at >= b.since && (r.addressed_to ?? []).includes(me) && r.data?.approved === false);
        // (Still for sale: the listing we answered, or the seller's later one for the same lot. A home relisted cheaper
        // is the same home, and the seller takes a purchase answering any of its listings; we are shown listings being
        // taken down now, and a relisting must not read as the home gone.)
        const forSale = forSaleNow().some((r) => r.id === b.listing || (r.speaks_for === b.seller && r.data?.lot === b.lot));
        // (Looked up, a home being relisted can be found with no listing standing for a moment, the old one taken down
        // and the new not yet up: it is gone when a look a day or more later still finds none.)
        if (forSale) b.goneSince = undefined;
        else b.goneSince ??= t;
        if (declined || (!forSale && t - b.goneSince! >= DAY) || t - b.since > 60 * DAY) buying = null;
        else if (forSale && b.funded && acc.balance >= b.price) {
          b.stage = "paid";
          steps.push(because(`Our mortgage is through: buying ${b.structure} for ${usd(b.price)}.`,
            say("property_purchase", `Purchase of ${b.structure}, as listed.`, { to: [b.seller], visible: [me, b.seller], basis: b.listing, data: { listing: b.listing, account: acc.account } }),
            pay(b.account, b.price, { from: acc.account, for: `Buying ${b.structure}.` })));
        }
      } else if (b?.stage === "paid" && ourTitles().some((x) => x.about.object === b.lot)) {
        // Ours: notice on the home we rented, and in once the seller's out (the round takes us there).
        const old = home;
        if (old && !old.owned) steps.push(because(`${b.structure} is ours: giving notice on the home we rented.`,
          notice(old.agreement, "We've bought a home."), ...(old.order ? [withdraw(old.order, "Moving to a home we've bought.")] : [])));
        const loan = mortgageFor(b.space);
        home = { agreement: titleOf(b.lot)?.id ?? b.lot, space: b.space, structure: b.structure, landlord: me, movedIn: false, owned: true,
          rent: loan ? cents(commitmentOf(loan, me).outcome?.money?.amount ?? "0") : 0 };
        buying = null;
      }
      if (!buying && !selling && home && !home.owned && householdIncome() > 0 && t >= nextBuyChance) {
        nextBuyChance = t + MONTH;
        if (ctx.rng(`buy-${t}`).below(10_000) < m.buy_bps && borrowing.canApply(t)) {
          const rooms = minBedrooms(t);
          const l = forSaleNow()
            .filter((r) => r.data?.type === "home" && r.speaks_for !== me && Number(r.data?.bedrooms ?? rooms) >= rooms && acc.balance * 10_000 >= Number(r.data?.price) * (m.deposit_bps + m.costs_bps))
            .sort((a, b) => Number(a.data?.price) - Number(b.data?.price) || (a.id < b.id ? -1 : 1))[0];
          if (l) {
            const price = Number(l.data!.price);
            const loan = price - Math.floor((price * m.deposit_bps) / 10_000);
            buying = { listing: l.id, seller: l.speaks_for!, account: String(l.data!.account), price, lot: String(l.data!.lot), space: String(l.data!.space), structure: String(l.data!.structure), stage: "applied", since: t };
            steps.push(borrowing.apply(t, acc.account, loan, m.mortgage_months, "a home",
              `${l.data!.structure} is for sale at ${usd(price)}, and we have the deposit and costs: asking the bank for a mortgage of ${usd(loan)}.`, { price, home: l.data!.space }));
          }
        }
      }
    };

    // ---- the tribunal ----
    /** A copy of a record we rely on, for the tribunal (which can't see what was between us and the other side). */
    const evidence = (r: any) => JSON.parse(JSON.stringify(r));
    const challenged = new Set<string>(); // notices of rent increase we've weighed taking to the tribunal
    const upheld: string[] = []; // notices we challenged that the tribunal upheld: they apply after all
    const pursued = new Set<string>(); // debts owed us we've weighed applying over
    const enforcing = new Set<string>(); // orders we've asked to be enforced
    const settledToUs = new Map<string, number>(); // a debt owed us -> what's been paid against it
    /** What the tribunal decided on our applications; debts owed us left unpaid, applied over; unpaid orders enforced. */
    const justice = (obs: Observation, t: number, steps: Step[]) => {
      const tr = p.tribunal;
      if (!tr) return;
      for (const o of book.open("tribunal_order").filter((x) => (x.addressed_to ?? []).includes(me) && x.data?.applicant === me && !enforcing.has(x.id))) {
        if (o.data?.kind === "rent_increase") {
          enforcing.add(o.id);
          if (o.data.finding === "valid") upheld.push(String(o.data.notice));
          continue;
        }
        if (o.data?.kind !== "debt" || o.data.finding !== "pay" || t < Number(o.data.due) + DAY) continue;
        enforcing.add(o.id);
        const claim = book.records.get(String(o.data.claim)) as any;
        const unpaid = Math.min(cents(o.data.amount), cents(claim?.about?.amount ?? o.data.amount) - (settledToUs.get(String(o.data.claim)) ?? 0));
        if (unpaid > 0) steps.push(because(`The tribunal ordered ${o.data.against} to pay us ${usd(cents(o.data.amount))} by day ${Math.floor(Number(o.data.due) / DAY)}, and ${usd(unpaid)} is still unpaid: asking for the order to be enforced.`,
          say("enforcement_request", `Request to enforce order ${o.id}: ${usd(unpaid)} unpaid.`, { to: [tr.entity], visible: [me, tr.entity], basis: o.id, data: { order: o.id, unpaid } })));
      }
      const acc = ownBanked(obs, me);
      for (const c of book.claimsBy("holder", me) as readonly any[]) {
        if (c.holder !== me || c.about?.kind !== "debt" || !c.counterparty || pursued.has(c.id) || t - c.at < tr.apply_after_days * DAY) continue;
        pursued.add(c.id);
        const owed = cents(c.about.amount) - (settledToUs.get(c.id) ?? 0);
        if (owed <= 0 || !acc || ctx.rng(`apply-${c.id}`).below(10_000) >= tr.apply_bps) continue;
        steps.push(because(`${c.counterparty} still owes us ${usd(owed)} (${c.about.for ?? "a debt"}), ${Math.floor((t - c.at) / DAY)} days on: applying to the tribunal.`,
          say("tribunal_application", `Application: ${c.counterparty} owes us ${usd(owed)} (${c.about.for ?? "a debt"}, recorded as ${c.id}).`, { to: [tr.entity], visible: [me, tr.entity, c.counterparty], basis: c.id, data: { kind: "debt", against: c.counterparty, claim: c.id, amount: owed, account: acc.account, evidence: evidence(c) } })));
      }
    };

    // ---- school (a child's) ----
    let askedSchool = -1;
    const triedPlace = new Set<string>();
    const classroomOf = (obs: Observation): string | undefined => {
      const street = obs.channels.street;
      if (!p.school || street?.kind !== "sites") return undefined;
      return street.cells.flatMap((c) => c.structure?.structure === p.school!.building ? c.structure.spaces : []).find((sp) => sp.kind === "classroom" && sp.occupants?.includes(me))?.space;
    };
    /** A child of school age who isn't at school: to the place offered, or asking for one (once a month). */
    const schooling = (obs: Observation): Step | undefined => {
      if (!p.school || !obs.body) return undefined;
      const t = obs.t;
      const age = Math.floor((t - obs.body.born_at) / year);
      if (age < p.school.ages[0] || age > p.school.ages[1] || classroomOf(obs)) return undefined;
      const place = book.open("school_place").filter((r) => (r.addressed_to ?? []).includes(me)).sort((a, b) => b.at - a.at)[0];
      // (With the round, a place is ours to go to in school hours; without it, we go now and stay.)
      if (p.round && place?.data?.classroom) return undefined;
      if (place?.data?.classroom && !triedPlace.has(place.id)) {
        triedPlace.add(place.id);
        return because("A place at school: going.", moveIn(String(place.data.classroom)));
      }
      if (askedSchool >= 0 && t - askedSchool < MONTH) return undefined;
      askedSchool = t;
      return because(`Of school age (${age}) and not at school: asking the school for a place.`, say("school_enrolment", `Enrolment at school: ${me}.`, { to: [p.school.entity], visible: [me, p.school.entity], data: { born_at: obs.body.born_at, years_before: Math.max(0, age - p.school.ages[0]) } })); // (years at school elsewhere: a newcomer's)
    };

    // ---- the body: off work while too ill to work, care at the clinic, and leaving school at its end ----
    let offSick: string | null = null; // the workplace we're off from
    let atClinic: { condition: string; since: number } | null = null;
    const soughtCare = new Set<string>();
    const bodily = (obs: Observation, t: number, steps: Step[], inside: (space: string) => boolean) => {
      if (!obs.body) return;
      // School's over at its end: out of the classroom.
      const room = classroomOf(obs);
      if (room && p.school && !p.round && Math.floor((t - obs.body.born_at) / year) > p.school.ages[1]) steps.push(because("School's over: leaving it.", moveOut(room, me)));
      const c = p.care;
      if (!c) return;
      const now = (obs.body.conditions ?? []).filter((x) => x.until > t);
      // Too ill or hurt to work (a hospital-level condition): out of the workplace until better.
      const tooIll = now.some((x) => c.off_work.includes(x.severity));
      if (tooIll && job?.workplace && !offSick && (p.round || inside(job.workplace))) {
        offSick = job.workplace;
        // (Telling our employer, as a worker on personal leave does; with the round, we just don't go in.)
        steps.push(because("Too ill to work: staying away until we're better.", say("sick_leave", `Off sick from ${Math.floor(t / DAY)} (day): too ill to work.`, { to: [job.employer], visible: [me, job.employer], data: { from: t } }),
          ...(p.round ? [] : [moveOut(job.workplace, me)])));
      } else if (!tooIll && offSick) {
        if (job?.workplace === offSick) steps.push(because("Better: back to work.", ...(p.round ? [] : [moveIn(offSick)])));
        offSick = null;
      }
      seekCare(obs, t, steps, inside);
    };
    /** At the clinic, home once seen (felt), better, or after waiting long enough; else, with something wrong of a kind it
     * sees, to the clinic (most do), asking for care. A child too (their parents would take them). */
    const seekCare = (obs: Observation, t: number, steps: Step[], inside: (space: string) => boolean) => {
      const c = p.care;
      if (!c || !obs.body) return;
      const now = (obs.body.conditions ?? []).filter((x) => x.until > t);
      if (atClinic) {
        const x = now.find((y) => y.id === atClinic!.condition);
        if (!x || x.treated || t - atClinic.since >= c.wait_days * DAY) {
          if (inside(c.waiting)) steps.push(because(x?.treated ? "Seen at the clinic: going home." : "Done at the clinic: going home.", moveOut(c.waiting, me)));
          atClinic = null;
        }
        return;
      }
      // Something wrong of a kind the clinic sees, not yet seen to: to the clinic (most do), asking for care.
      const ill = now.find((x) => !x.treated && c.severities.includes(x.severity) && !soughtCare.has(x.id));
      if (!ill) return;
      soughtCare.add(ill.id);
      if (ctx.rng(`care-${ill.id}`).below(10_000) >= c.seek_bps) return;
      atClinic = { condition: ill.id, since: t };
      steps.push(because(`A ${ill.severity} ${ill.kind}: going to the clinic.`, moveIn(c.waiting),
        say("care_request", `Asking to be seen: a ${ill.severity} ${ill.kind}.`, { to: [c.entity], visible: [me, c.entity], data: { condition: ill.id, kind: ill.kind, severity: ill.severity } })));
    };

    const civic = (obs: Observation, t: number, steps: Step[]) => {
      if (!p.electoral_town || !obs.body || t - obs.body.born_at < ADULT_YEARS * year) return;
      const town = p.electoral_town;
      // On the roll: enrolled at the start, or now (of age, or new to town), once.
      if (enrolled === null) enrolled = book.all("enrolment").some((r) => r.speaks_for === me);
      if (!enrolled) {
        enrolled = true;
        steps.push(because("Of voting age (or new to town) and not on the roll: enrolling, as the law requires.", say("enrolment", `Enrolment: ${me}.`, { to: [town], visible: [me, town], data: { born_at: obs.body.born_at } })));
      }
      // Approval of the town's government, weekly: our own fortunes (retrospective, economic voting) and our anger at the
      // town, remembered over about half a year; and what we read of it in the paper.
      if (approvedAt < 0 || t - approvedAt >= 7 * DAY) {
        approvedAt = t;
        const signal = Math.max(-10_000, Math.min(10_000, 2 * (satisfaction(mind.person, levelsNow) - 5_000) - feelings.level("anger", town, t)));
        approval = Math.round(approval + (signal - approval) / Math.max(1, p.civic.approval_memory_weeks));
      }
      // The paper's news (docs/behaviour/news.md): what's published in the paper's name, and nobody else's statement of
      // the kind; about the government; each item once. Its tone as the paper gives it, -1 to 1: one beyond that counts
      // as the limit, one that isn't a number as none. (Until 0.35.6 any statement of kind `news` was read, whoever
      // published it, with whatever tone it claimed: one item from anyone could set a reader's approval to either end.)
      if (readsNews && p.paper) for (const r of book.open("news")) {
        if (readItems.has(r.id) || r.speaks_for !== p.paper || r.data?.about_office !== true) continue;
        readItems.add(r.id);
        const tone = Number(r.data?.tone ?? 0);
        approval = Math.max(-10_000, Math.min(10_000, approval + Math.round((Number.isFinite(tone) ? Math.max(-1, Math.min(1, tone)) : 0) * p.civic.news_weight_bps)));
      }
      // An election called: standing, with a small chance, swayed by drive (achievement, power) and by how badly we think
      // the town is run; our platform speaks to what we value most.
      for (const n of book.open("election_notice")) {
        if (stoodFor.has(n.id) || t >= Number(n.data?.nominations_close_at ?? 0)) continue;
        stoodFor.add(n.id);
        const drive = 1 + 0.5 * zValue("achievement") + 0.5 * zValue("power") + (approval < 0 ? -approval / 5_000 : 0);
        if (ctx.rng(`stand-${n.id}`).below(10_000) >= shifted(p.civic.stand_bps, drive - 1)) continue;
        const top = (Object.keys(mind.person.values) as Value[]).sort((a, b) => zValue(b) - zValue(a) || (a < b ? -1 : 1)).slice(0, 2);
        const platform = `Standing for ${n.data?.office}: for ${top.join(" and ")}.`;
        steps.push(because(`An election: standing for office (drive ${drive.toFixed(2)}; we think the town is run ${approval >= 0 ? "well enough" : "badly"}).`,
          say("nomination", platform, { to: [town], visible: "public", data: { office: n.data?.office, name: me, values: top }, assertion: { that: platform } })));
      }
      // Voting: on a ballot open to the roll, if we're on it, once; nearly everyone, where voting is compulsory. A ranking:
      // the incumbent by our approval, a challenger by how well their platform speaks to our values.
      // (On the roll: we know it by having enrolled before the ballot was put. The roll itself is the electoral
      // office's, and nobody is sent it: docs/behaviour/elections.md.)
      const enrolledAt = Math.min(...book.open("enrolment").filter((r) => r.speaks_for === me).map((r) => r.at), Infinity);
      for (const b of book.open("ballot")) {
        if (voted.has(b.id) || b.data?.electorate !== "roll" || !(enrolledAt < b.at) || t < Number(b.data?.opens_at ?? 0) || t >= Number(b.data?.closes_at ?? 0)) continue;
        voted.add(b.id);
        if (ctx.rng(`turnout-${b.id}`).below(10_000) >= p.civic.turnout_bps) continue;
        const candidates = (b.data?.candidates ?? []) as { candidate: string; number?: string; nomination: string }[];
        const scores = candidates.map((c) => {
          const nom = book.records.get(c.nomination) as any;
          const incumbent = !!nom?.data?.incumbent;
          const values = ((nom?.data?.values ?? []) as Value[]).filter((v) => v in mind.person.values);
          const fit = values.length ? values.reduce((a, v) => a + zValue(v), 0) / values.length : 0;
          const score = Math.round(incumbent ? approval : fit * p.civic.platform_weight_bps) + (c.candidate === ctx.participant ? 100_000 : 0);
          return { key: c.candidate, number: c.number ?? c.candidate, score };
        }).sort((x, y) => y.score - x.score || (x.key < y.key ? -1 : 1));
        if (!scores.length) continue;
        decided.push({ t, domain: "vote", strategy: "deliberate", choice: scores[0]!.key, options: scores });
        steps.push(because(`Voting: ranking the ${scores.length} candidates (our approval of the town's government: ${approval}).`, vote(b.id, scores.map((x) => x.number).join(">"), [town])));
      }
    };

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
      if (home && !home.owned) {
        if (home.order) s.push(withdraw(home.order));
        for (const x of home.retiring ?? []) s.push(withdraw(x.order));
        home.retiring = [];
        s.push(notice(home.agreement, "Leaving town."));
      }
      if (share?.order) s.push(withdraw(share.order, "Leaving town."));
      if (job) s.push(notice(job.agreement, "Leaving town."));
      // Everything else of ours that we can end by notice under its terms (memberships): ended, and what we pay under
      // it stopped.
      for (const r of book.ofType("agreement")) {
        if (r.record !== "agreement" || r.id === home?.agreement || r.id === job?.agreement || !r.terms.parties.includes(me) || !book.inForce(r.id)) continue;
        if (!r.terms.termination?.some((x) => x.party === me)) continue;
        for (const o of book.all("request")) if (o.record === "statement" && cites(o, r.id) && o.speaks_for === me && !book.withdrawn.has(o.id)) s.push(withdraw(o.id, "Leaving town."));
        s.push(notice(r.id, "Leaving town."));
      }
      // (Told to those we deal with, as the world says who they are: where we're enrolled, who supplies us, who pays us.)
      s.push(say("departure", `${me} has left town.`, p.tell_on_leaving.length ? { to: [...p.tell_on_leaving].sort() } : {}));
      if (acc && acc.balance > 0 && p.outside_account) s.push(pay(p.outside_account, acc.balance, { from: acc.account, for: "Moving away: send all my savings with me." }));
      // Leaving takes a body out of every space it's in. The children go first, each on its own (one may not be here).
      leaving = true;
      s.push(C.call("presence", { leave: "yes" }));
      return [...(isLeaseholder() ? childrenNow.map((k) => because(why, C.call("presence", { who: k.person, leave: "yes" }))) : []), s];
    };
    let childrenNow: Member[] = [];

    return {
      /** Our job and home, as we have them (truth audits). */
      beliefs: (): Belief[] => departed ? [] : [
        ...(job ? [{ of: "agreement" as const, agreement: job.agreement, in_force: true }] : []),
        ...(home && !home.owned ? [{ of: "agreement" as const, agreement: home.agreement, in_force: true }] : []),
      ],
      step(obs): ParticipantAction | Promise<ParticipantAction> {
        if (departed) return wait(ctx.world.runEnd + DAY);
        absorb(obs);
        // (Taken out of the world with our household, or gone from it: nothing more here.)
        if (obs.body && !obs.body.present) return wait(ctx.world.runEnd + DAY);
        heardGo(obs);

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
          // Someone of the household has died at home and no adult of it is there: a child old enough for school tells
          // the first of its adults still living (docs/behaviour/deaths.md), once.
          if (household && street?.kind === "sites" && (!p.school || obs.t - obs.body.born_at >= p.school.ages[0] * year)) {
            for (const sp of street.cells.flatMap((c) => c.structure?.spaces ?? []).filter((x) => x.kind === "dwelling" && x.occupants?.includes(me))) {
              const dead = new Set((sp.left ?? []).filter((l) => l.reason === "died").map((l) => l.occupant));
              const grown = household.members.filter((m) => ageAt(m, obs.t, year) >= ADULT_YEARS && !dead.has(m.person));
              for (const who of dead) {
                if (toldOf.has(who) || !household.members.some((m) => m.person === who)) continue;
                toldOf.add(who);
                if (!grown.length || grown.some((m) => sp.occupants?.includes(m.person))) continue;
                return callAction(because(`${who}, of our household, has died at home and no adult is here: telling ${grown[0]!.person}.`, message([reach(grown[0]!)], SAYING.died(who, sp.space))));
              }
            }
          }
          const cared: Step[] = [];
          const sees = obs.channels.street;
          seekCare(obs, obs.t, cared, (space) => sees?.kind !== "sites" || sees.cells.some((c) => c.structure?.spaces.some((sp) => sp.space === space && sp.occupants?.includes(me))));
          if (cared.length) return callAction(cared[0]!);
          const learn = schooling(obs);
          if (learn) return callAction(learn);
          const go = goWhereWeBelong(obs);
          if (go) return sendGo(go);
          return wait(Math.min(obs.t + MONTH, ctx.world.runEnd + DAY, p.round ? nextChange(obs.t) : Infinity));
        }
        // A death at home, seen now: what it asks of us is done first, and the week's plan is made afresh as soon as
        // that is done (who holds the lease may have changed, and with it who must find the household a home).
        const mournedBefore = mourned.size;
        todo.push(...seeDeathAtHome(obs).filter((s) => s.length));
        if (mourned.size > mournedBefore) nextPlanAt = Math.min(nextPlanAt, obs.t);
        // The daily round: a wake that's only for going somewhere (one we asked for, our cadence, or a move done), with
        // nothing left to do and no full plan due, just takes us where we belong.
        if (p.round && obs.t < nextPlanAt && todo.length === 0 && obs.woke_for !== "news" && obs.woke_for !== "start" && !(practiceWake !== null && obs.t >= practiceWake)) {
          const go = goWhereWeBelong(obs);
          if (go) return sendGo(go);
          return wait(Math.min(nextChange(obs.t), nextPlanAt, practiceWake ?? Infinity));
        }
        // (Planned when a wake begins; woken because an act of ours is done, we carry on with the plan, and plan afresh
        // only once it's done: the stepper.)
        if (plannedAt !== obs.t && (obs.woke_for !== "done" || todo.length === 0)) {
          // Papers about land of ours that we haven't read up on: the register, in the same look as the boards where
          // one is made (the answer comes at once, with the next observation, and the plan is made knowing it).
          const register = registerLooks(obs.t);
          const acc = ownBanked(obs, me);
          const usual = acc ? (householdIncome() > 0 ? Math.floor((householdIncome() * p.rent_share_bps) / 10_000) : Math.floor(acc.balance / p.savings_rent_months)) : 0;
          if (cheaperThan && (home || obs.t >= cheaperThan.until)) cheaperThan = null;
          const budget = cheaperThan ? Math.min(usual, cheaperThan.rent) : usual;
          const needHome = isLeaseholder() && !home;
          const rooms = minBedrooms(obs.t);
          const roomy = rooms > 0 ? [{ field: "data.bedrooms", op: ">=" as const, value: rooms }] : [];
          // Told about a building? Look there first: what's on offer in it now.
          // (Only someone who wants what a building might offer: a home, or work. Someone out of work and not looking
          // for any, retired say, used to ask to look at nothing, which is refused: found in the stress run of 2026-10-06.)
          if (looking === null && lookedAt !== obs.t && acc && leads.length && (needHome || (!job && !retired && p.in_labour_force))) {
            const lead = leads.pop()!;
            const looks: LookRequest[] = [];
            if (needHome) looks.push(ask.board("homes", { most: p.search_limit, where: [{ field: "data.structure", op: "=", value: lead }, { field: "data.rent", op: "<=", value: budget }, ...roomy] }));
            if (!job && !retired && p.in_labour_force) looks.push(ask.board("jobs", { most: p.search_limit, where: [{ field: "data.workplace", op: "=", value: lead }] }));
            leadFound.homes = [];
            leadFound.jobs = [];
            looking = "leads";
            return { type: "look", looks: [...register, ...looks] };
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
            if (needHome) looks.push(ask.board("homes", { most: p.search_limit, where: [{ field: "data.rent", op: "<=", value: budget }, ...roomy], by: "data.rent", desc: true }));
            if ((!job || searchingWork) && !retired && p.in_labour_force) looks.push(ask.board("jobs", { most: p.search_limit, by: "data.wage", desc: true }));
            // The listings of property for sale, when we're looking: waiting on a purchase (the seller's own listings,
            // to know it still stands), or with this month's chance of buying a home or founding a business coming up.
            if (p.sale_board) {
              if (buying) looks.push(ask.about(p.sale_board, "speaks_for", buying.seller, { most: p.search_limit, standing: true }));
              else if ((p.market && home && !home.owned && !selling && obs.t >= nextBuyChance) || (!founded && p.ventures.length && p.found_bps > 0 && obs.t >= nextVenture && !retired && p.in_labour_force))
                looks.push(ask.board(p.sale_board, { most: p.search_limit, by: "data.price" }));
              else onSale = null;
              saleAsked = looks.some((l) => l.channel === p.sale_board);
            }
            // What sellers advertise: a few shops, if we know of none; else, with the month's chance, the prices of a
            // shop someone we know shops at and we don't; else those of our own shop, if we know it only from looking.
            if (p.adverts) {
              const known = new Set(book.standingOf("price_list").map((r) => r.speaks_for));
              const knowsShop = book.standingOf("price_list").some((r) => r.data?.goods?.[p.goods] !== undefined && !r.data?.min_order);
              let shop: string | undefined;
              if (knowsShop && obs.t >= nextShopSearch) {
                nextShopSearch = obs.t + MONTH;
                if (ctx.rng(`shop-search-${obs.t}`).below(10_000) < p.shop_search_bps) shop = newsNow(obs.t).map((n) => n.shop).filter((s): s is string => !!s && !known.has(s)).sort()[0];
              }
              if (!knowsShop) looks.push(ask.board(p.adverts, { most: p.shops_known, where: [{ field: "data.at", op: ">", value: "" }] }));
              else if (shop) looks.push(ask.about(p.adverts, "speaks_for", shop, { most: 1, standing: true, newest: true }));
              else if (favourite && lookedUp.has(favourite)) looks.push(ask.about(p.adverts, "speaks_for", favourite, { most: 1, standing: true, newest: true }));
            }
            // A glance at the petitions board: what's standing now.
            looks.push(ask.board("petitions", { most: 10 }));
            // And at the notices at work: an enterprise agreement at our own workplace, made since we started there.
            if (job && p.work_board) looks.push(ask.about(p.work_board, "data.employer", job.employer, { most: p.search_limit, since: job.since }));
          }
          if (looks.length) {
            lookedAt = obs.t;
            found.homes = [];
            found.jobs = [];
            found.petitions = [];
            looking = "market";
            return { type: "look", looks: [...register, ...looks] }; // the results arrive with the next observation, and are planned with
          }
          if (register.length) return { type: "look", looks: register };
          lookedAt = obs.t;
          looking = null;
          // (What the last wake didn't get to comes first: our state already counts on it.)
          todo = [...todo, ...plan(obs).filter((s) => s.length)]; // (a step with nothing to do isn't sent: as the stepper)
          plannedAt = obs.t;
          if (p.round) {
            nextPlanAt = obs.t + 7 * DAY;
            // (Unless a step of the plan already takes us there: going to the clinic, say.)
            const go = goWhereWeBelong(obs);
            const goingThere = (to: string) => todo.some((st) => st.some((l) => { const c = Array.isArray(l) ? l[1] : l; return c.fn === "occupancy" && JSON.stringify(c.args.in ?? "").includes(to) && !c.args.leave; }));
            if (go && !goingThere(String(belong(obs)))) todo.push(go);
          }
          leadFound.homes = [];
          leadFound.jobs = [];
        }
        // A gathering we're at ends while we're busy with a long plan (a move, say): going home comes first; the rest of
        // the plan follows, and how it went is learned at the next plan.
        if (attending && !attending.gone && obs.t >= attending.until && todo.length) {
          const street = obs.channels.street;
          const here = street?.kind === "sites" ? street.cells.flatMap((c) => c.structure?.spaces ?? []).find((sp) => sp.space === attending!.space)?.occupants ?? [] : [];
          if (here.includes(me)) {
            attending.gone = true;
            attending.seen = here.filter((o) => o !== me);
            todo.unshift(because(`${attending.host}'s gathering is over (${attending.seen.length} others were there): going home.`, moveOut(attending.space, me)));
          }
        }
        const next = todo.shift();
        lastWasMove = !!next && next === moveStep;
        if (leaving && todo.length === 0) departed = true; // the last of leaving is under way
        // (A gathering to go to, or come back from, before the week is out: awake then.)
        if (next && (next as any).goTo) pendingGo = (next as any).goTo;
        const action = next ? noted(book, callAction(next))
          : p.round ? wait(Math.min(practiceWake ?? Infinity, nextPlanAt, nextChange(obs.t)))
          : wait(practiceWake !== null ? Math.min(practiceWake, obs.t + 7 * DAY) : undefined);
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
