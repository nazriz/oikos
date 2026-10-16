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
import { dateWords } from "../forms";
import type { Eligibility, LookRequest, Observation, ParticipantAction, Record, SiteStructure, StatementRecord } from "../contracts";
import { basesOf, channels, cites } from "../contracts";
import { DECISIONS, OUTCOMES, RECORD, WORDS, params, wait, type Belief, type BehaviourModule, type ComposeBrief, type ComposePiece, type ConsultAnswer, type DecisionRecord, type OutcomeRecord, type Situation, type ParticipantContext, type RecordChange, type Words } from "../module";
import type { Rng } from "../rng";
import * as C from "../calls";
import { advertisedJob, ask, Asked, because, officeNote, Book, firstDue, breaches, noted, callAction, commitmentOf, DAY, nextLook, usd, jobTerms, record, leaseTerms, message, MONTH, moveIn, moveOut, notice, pay, PAYMENT_FAILED, petitionSignatures, publishedCount, say, sign, stoodEmpty, structureOf, variableToday, vote, withdraw, type Step, ownBanked } from "./common";
import { ADULT_YEARS, ageAt, bedroomsNeeded, hear, householdOf, SAYING, type Heard, type HouseholdData, type Member, type OccupancyStandard } from "./household";
import { Deliveries, goodsPrices, offerOf as shopOffer, order } from "./trade";
import { dayPayPeriod, incomeTaxLaw, withholding } from "./tax";
import { declarationFor, forHousehold, forOutOfWork, stopsWorkAt, supportLaw, type PaymentRule } from "./payments";
import { daysLeft, decisionLaw, KIND as DECISION } from "./decisions";
import { Borrowing, loanFor } from "./credit";
import { Inner, innerParams, UPBRINGING, type InnerParams, type Outlook } from "./inner";
import { VALUES as VALUES_OF_MIND, NEEDS as NEEDS_OF_MIND } from "./mind";
import { chancePpm, frictionDial, PAPER, particularsOf, tendered } from "./frictions";
import { acceptEntity, chanceOf, darkOf, drawOf, foundingParams, plainName, plainPurpose, shapeOdds, type FoundingParams, type Shape } from "./founding";
import { Culture, CULTURE_WORDS, cultureDial, standardNormal, type Conduct } from "./culture";
import { EVENT_CONDUCT, EVENT_CONDUCTS, PAPER_WEIGHT, paperStrength, TOWN_WORDS, TownMemory, trustDirection, type EventKind } from "./townmemory";
import { angerAdded, doneToAgency, failedAgency, fearAdded, grantTrust, isNoShift, obeyRate, readFacts, readingDial, recourseScore, refusalTrust, tieMoved, type PaperRead } from "./reading";
import { bringsOf, meets, swayed, SEEKS_OF_NEED, Wants, wantParams, type Opening, type SeekKey, type Want as Wanted, type WantParams } from "./wants";
import { factsOf, Feelings, Mind, MIND_DEFAULTS, MIND_VERSION, Pursuit, satisfaction, Ties, type Circumstances, type Facts, type MindParams, type NeedLevels, type PopulationValues, type Value } from "./mind";

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
  // (Since the richer record, docs/design/ai-citizens.md 10c: what was done to us lately, and what we say of how the
  // town is run: what we say, which is not always what we think.)
  lostWork: (employer: string) => `${employer} let me go.`,
  noticed: (landlord: string) => `${landlord} has given me notice to leave my home.`,
  town: (view: number) => `I'd say the town is run ${view >= 2_000 ? "well" : view <= -2_000 ? "badly" : "well enough"}.`,
  // (Since wants, docs/design/ai-citizens.md 10a: what we are trying to bring about and how, which those who copy us
  // may take up; and what we have stopped trying for.)
  after: (list: { about: string; way: string }[]) => (list.length ? `What I'm after: ${list.map((x) => `${x.about} by ${x.way}`).join("; ")}.` : ""),
  gaveUp: (about: string) => `I've stopped trying about ${about}: there's no use.`,
  nothing: "Much the same.",
};
/** Telling those we are close to that someone of our household has died (a code citizen's phrasing, and its reading). */
/** Telling someone we know that someone has done wrong by us (docs/behaviour/frictions.md): in our own phrasing, and
 * what is heard of it by one who knows that phrasing. */
export const WRONGED = {
  say: (matter: string, by: string) => `${by} has done wrong by me (${matter.replace(/_/g, " ")}).`,
  heard: (text: string): { by: string; matter: string } | undefined => {
    const m = /^(\S+) has done wrong by me \(([a-z ]+)\)\.$/.exec(text);
    return m ? { by: m[1]!, matter: m[2]!.replace(/ /g, "_") } : undefined;
  },
};
export const MOURNING = {
  tell: (who: string) => `I have sad news: ${who} has died.`,
  heard: (text: string): string | undefined => /^I have sad news: ([^\s;]+) has died\.$/.exec(text)?.[1],
};
/** Coming of age, someone born or brought here as a child asks the parents they live with what matters to them, and
 * is told in words (docs/behaviour/citizen.md, "Upbringing"): the three values a parent holds most, and the three least. */
export const UPBRINGING_WORDS = {
  ask: "What matters most to you in life?",
  say: (most: string[], least: string[]) => `What matters most to me: ${most.join(", ")}. Least: ${least.join(", ")}.`,
  heard: (text: string): { most: string[]; least: string[] } | undefined => {
    const m = /^What matters most to me: ([a-z_, ]+)\. Least: ([a-z_, ]+)\.$/.exec(text);
    return m ? { most: m[1]!.split(", "), least: m[2]!.split(", ") } : undefined;
  },
};
export interface News { shop?: string; served?: number; employer?: string; paid?: boolean; member?: boolean; goesTo?: string[]; holdsTo?: string[]; leansTo?: string[];
  /** Who let them go, who gave them notice to leave their home; and what they say of how the town is run (1 well, 0 well enough, -1 badly). */
  letGoBy?: string; noticedBy?: string; town?: number;
  /** What they are after, and by what way; what they have stopped trying for. */
  after?: { about: string; way: string }[]; gaveUp?: string }
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
  if ((m = /([^\s;]+) let me go\./.exec(text))) n.letGoBy = m[1]!;
  if ((m = /([^\s;]+) has given me notice to leave my home\./.exec(text))) n.noticedBy = m[1]!;
  if ((m = /I'd say the town is run (well enough|well|badly)\./.exec(text))) n.town = m[1] === "well" ? 1 : m[1] === "badly" ? -1 : 0;
  if ((m = /What I'm after: ([^.]+)\./.exec(text))) n.after = m[1]!.split("; ").flatMap((x) => { const i = x.lastIndexOf(" by "); return i > 0 ? [{ about: x.slice(0, i), way: x.slice(i + 4) }] : []; });
  if ((m = /I've stopped trying about ([^\s:]+): there's no use\./.exec(text))) n.gaveUp = m[1]!;
  return Object.keys(n).length ? n : undefined;
}

/** A home is a unit (a space) in a building. */
interface Home {
  agreement: string; space: string; structure: string; landlord: string; rent: number; order?: string; movedIn: boolean;
  /** Ours (`agreement` is the title; `rent`, the mortgage repayment, if any): docs/behaviour/ownership.md. */
  owned?: boolean;
  /** Rent orders replaced by a new rent's, to stop once their last payment is made (when). */
  retiring?: { order: string; at: number }[];
  /** Told to leave it for arrears (docs/behaviour/justice.md, "Possession"): by the landlord's notice to vacate, by
   * the tribunal's order for possession (`ordered`), or put out on its warrant (`removed`); by when; and whether we
   * mean to stay past that. */
  vacate?: { paper: string; by: number; stays: boolean; ordered?: boolean; removed?: boolean };
}
interface Job { /** A change of our pay the employer's paper told us of (hours cut or restored, docs/behaviour/firms.md, "Hours before heads"): from when, and the wage then. */ coming?: { at: number; wage: number }; /** The wage before such a change, still taken as our pay for a few days after it (the employer changes the order on its own day). */ prev?: { wage: number; until: number }; /** The account our pay has come from, as we have seen it come. */ paidFrom?: string; /** What our pay has come short of what was agreed, in all, and not yet put right. */ short?: number; agreement: string; employer: string; wage: number; period: number; workplace?: string; since: number; /** When we walked out (unpaid), whatever the terms say. */ leftAt?: number; paidAt?: number; claimed?: boolean }

/** The least a fund's stated draw must cover of a month of a household's essentials to count, for that household,
 * as something that answers having nothing to fall back on: a tenth. Our own figure, no source (docs/behaviour/founding.md). */
export const FUND_WORTH_MIN = 0.1;

export const citizen: BehaviourModule = {
  name: "citizen.default",
  version: "0.57.0", // 0.57.0: an application to a venue states its particulars, from our own record (the dispute, the paper, the sum where we have one, what we seek, the dates), as an application form asks (docs/behaviour/justice.md, "Particulars"); 0.56.0: an employer's paper cutting or restoring our hours (hours_notice, hours_restored) is the pay agreed from the day it names, so a cut told or agreed is not pay come short; asked to agree to a cut, we answer by a paper (hours_reply) (docs/behaviour/firms.md, "Hours before heads"); 0.55.0: draws are named for the day and which time that is, never the hour or the moment (docs/reliability.md, "Draws and the moment"); 0.54.0: a claim made before the year began and waiting is not made again; one refused before it is not made again until a year older; a request or an application of ours made before it (an opening caseload) is a grievance already asked of, or taken to, whoever the paper names, and is not asked or taken again; 0.53.0: a tenant served with an application for possession answers it or not, as often as tenants there do, read against who they are, and tells of their own record what they choose (what they owe, what they could pay or that they can pay nothing and why, who lives there, whether they have anywhere to go); an order of the tribunal and a removal are on the person's record with who made them; a household with no dwelling asks the people it is closest to whether it may stay, is taken in where there is room, means and willingness, and does not leave town for want of a home while someone has it; the draws about a notice and an order are keyed on the lease (docs/behaviour/justice.md, "A tenant's answer"; households.md, "Taken in during the year"); 0.52.0: a payment already granted when the year began (a grant brought forward on paper) is drawn from the first day and not claimed again; 0.51.0: a home given up is not gone back to (someone with no home was taken back to the dwelling they had left); a tenant who left on a notice to vacate says so to the tribunal if possession is then applied for; a member draws on a fund when its stated rule would pay, and a fund's answer moves their trust in it; joining a fund weighs its draw against a month of the household's essentials; nobody founds what they can see already answers them and would take them; rent owed as the year began is owed and paid as missed rent is (docs/decisions.md, "What the fourth living pilot found"); 0.50.0: what being told to leave does to a tenant (trust, the tie, fear, the household told, the want) is done by a notice to vacate as it was by a notice on the lease, once a tenancy; a landlord's request for rent owed, an offer of a plan (answered with what the household could pay) and an application for possession are on the tenant's record; a letter from an office in its own words is read, kept and noted, never acted on (docs/decisions.md, 2026-10-12); 0.49.0: a decision about a want, and whether to found, is recorded with its situation (docs/design/ai-citizens.md 11a): recording only, nothing a citizen does changes; 0.48.0: takes for pay only what is paid as wages (a refund or a dividend from an employer is not pay come short); starts a business of one from home, and gives one up that pays no living (docs/behaviour/entry.md); told to vacate for arrears, goes or stays, answers the tribunal, and is out when its warrant is carried out (docs/behaviour/justice.md, "Possession"); 0.46.0: everyday frictions (docs/behaviour/frictions.md), with the world's dial: a home in disrepair, pay come short (no longer taken for no pay), a bill well over the usual, a claim refused, goods found faulty; each a grievance about whoever did it, asked of them, taken to any body that says it hears such things, or told to those one knows; what comes back moves trust and the sense of agency; a job is left only for one that pays enough more, the more so the longer held (where the world says); giving up on work stops the looking; a need short at the start has been short for a while; pay told to the household once until it changes; 0.45.0: wants and initiative (docs/design/ai-citizens.md 10a, 10b), for those the world's dial gives it to: wants born of needs, events and those one copies, met with openings by what they bring in typed outcomes, the way chosen by the mind; trust, agency and attachment read; starting attachment from the world; nothing changes with the dial at 0; 0.44.0: the richer record (docs/design/ai-citizens.md 10c, 10d): belonging and meaning as needs, trust in particular institutions, a sense of agency, attachments, what is thought and what is said, values that drift and are shocked, bounded ties, where the hours go; held by the kernel as the person's own record; 0.43.2: offered a job that names no place of work, on an advertisement, goes to work where the advertisement says; 0.43.1: tells their own business when they move home; 0.43.0: someone who works for themself (own_work): not out of work, their income what the business pays them, at their pitch in working hours; 0.42.1: work by the day (a day's pay known as pay; no claim for a day not worked); 0.42.0: reads the support law, stops work at an age of its own (0.41.0 on its branch), with main's 0.41.1 0.47.0: founding (docs/behaviour/founding.md), where the world's dial has it on: at a want given up or with nothing to answer it, shared by others one knows of, a person may found a group, a fund or a body that takes grievances up, in words of their own or a composing model's; a thing made in a run is joined as any opening is taken up, left when one no longer comes, and a fund drawn on when short; with the dial off nothing changes; 0.46.0: everyday frictions (docs/behaviour/frictions.md), with the world's dial: a home in disrepair, pay come short (no longer taken for no pay), a bill well over the usual, a claim refused, goods found faulty; each a grievance about whoever did it, asked of them, taken to any body that says it hears such things, or told to those one knows; what comes back moves trust and the sense of agency; a job is left only for one that pays enough more, the more so the longer held (where the world says); giving up on work stops the looking; a need short at the start has been short for a while; pay told to the household once until it changes; 0.45.0: wants and initiative (docs/design/ai-citizens.md 10a, 10b), for those the world's dial gives it to: wants born of needs, events and those one copies, met with openings by what they bring in typed outcomes, the way chosen by the mind; trust, agency and attachment read; starting attachment from the world; nothing changes with the dial at 0; 0.44.0: the richer record (docs/design/ai-citizens.md 10c, 10d): belonging and meaning as needs, trust in particular institutions, a sense of agency, attachments, what is thought and what is said, values that drift and are shocked, bounded ties, where the hours go; held by the kernel as the person's own record; 0.43.2: offered a job that names no place of work, on an advertisement, goes to work where the advertisement says; 0.43.1: tells their own business when they move home; 0.43.0: someone who works for themself (own_work): not out of work, their income what the business pays them, at their pitch in working hours; 0.42.1: work by the day (a day's pay known as pay; no claim for a day not worked); 0.42.0: reads the support law, stops work at an age of its own (0.41.0 on its branch), with main's 0.41.1
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
      // Stopping work, and claiming support (docs/behaviour/citizen.md). None unless the world says: no age, no payer.
      // The age at which people here stop work, where the world gives one age for everyone; or this person's own
      // (`stops_work_at`: an age, or "never"), drawn when the world was made; or, for someone who comes later, the
      // share of people in the labour force by age it is drawn from (`stop_work_curve`).
      retirement_age: null as number | null,
      stops_work_at: null as number | "never" | null,
      stop_work_curve: null as { from: number; bps: number }[] | null,
      // Working for ourselves (docs/behaviour/entry.md, "A person working for themself"): the business we run alone,
      // the account it pays our drawings from, where we work from when that is not our home, and what it was
      // expected to bring in a month before it had (none: we work for an employer, or look for work).
      // (`home`: the dwelling it trades from, where it trades from our home: we tell it when we live somewhere else.)
      own_work: null as { firm: string; account: string; at?: string; home?: string; expect_per_month: number } | null,
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
      ventures: [] as { kind: string; name: string; capital: number; channels: unknown[]; role_module: { code: string; params: { [k: string]: unknown } };
        /** A business its founder runs alone, from their home (docs/behaviour/entry.md, "Starting a business of one"):
         * it needs no premises bought. `expect_per_month`: what such a business is expected to clear at first. */
        own?: boolean; expect_per_month?: number }[],
      found_bps: 0,
      // Starting a business of one: the month's chance, in parts per million, for someone with a home to trade from
      // and the means (the world derives it from its place's business birth rate and its own counts; 0: nobody does);
      // the months of housing and essentials a founder keeps back beyond the capital; and when its owner gives it
      // up: after `give_up_months` in which it paid them less than `give_up_below_bps` of a month's essentials
      // (placeholders: docs/behaviour/entry.md).
      found_own_ppm: 0, found_own_buffer_months: 1, give_up_months: 6, give_up_below_bps: 5000,
      // Possession (docs/behaviour/justice.md, "Possession"): of tenants given a notice to vacate for arrears they
      // cannot pay, the share who stay past its date; and of those the tribunal orders out, the share who are gone
      // by its date (the rest stay until they are put out). The world's figures (placeholders there); none: a
      // tenant leaves when told, as before.
      // `answer_bps`: of tenants served with an application for possession, the share who answer it (the
      // world's, read against who each is; none: one with something to offer answers, as before). `notice_days`:
      // the days the law says a notice to vacate must give, as the tenant reads it.
      possession: null as { stay_bps: number; obey_bps: number; answer_bps?: number; notice_days?: number } | null,
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
      // This person's own values, where the world gave them (who lives in a town is the town's; a child's come from
      // the adults who raise them: docs/behaviour/citizen.md "Upbringing"). None: drawn from the world's figures.
      own_values: null as { [value: string]: number } | null,
      // How people here start out (the world's profile: docs/behaviour/citizen.md "The record"): the share with
      // confidence in each kind of institution, the share who say most people can be trusted, how much control over
      // their lives people feel. None given: the record's own placeholders (`inner`).
      outlook: {} as Outlook,
      // The record's arithmetic (docs/behaviour/citizen.md "The record"): every size a placeholder unless sourced there.
      inner: {} as Partial<InnerParams>,
      // Which of the world's offices is which kind of institution (the kinds a place's survey gives confidence in),
      // for those the module does not know by a parameter of its own (the world says; none: by parameter only).
      institutions: {} as { [entity: string]: string },
      // Wants and initiative (docs/behaviour/citizen.md "Wants and initiative"; docs/design/ai-citizens.md 10a, 10b).
      // Whether this person takes initiative: holds wants, goes after them, and has their trust, sense of agency and
      // attachments read by what they do. None given: drawn once, from the person's own stream, with the world's
      // dial (`dials.initiative_bps`; 0 or absent: nobody does, and the town is the one it was before wants).
      initiative: null as boolean | null,
      wants: {} as Partial<WantParams>,
      // Founding (docs/behaviour/founding.md; docs/design/ai-citizens.md 10b): what a person who starts something of
      // their own goes by, from the world's profile. Read only where the world's dial has founding on (`dials.founding`);
      // none, or the dial off: nobody founds a group, joins one made in a run, or leaves one.
      founding: null as Partial<FoundingParams> | null,
      // What holds someone in a job they have (docs/behaviour/citizen.md, "Moving to another job"): another must pay
      // this much more before it is worth the move (`premium_bps`), and more for each year they have been where
      // they are (`per_year_bps`, up to `cap_years`): what is known there, and being the last in somewhere new.
      // The world's, for one who takes initiative (none: any posting that pays more is worth it, as before).
      job_move: null as { premium_bps: number; per_year_bps: number; cap_years: number; /** More again for a job in another line of work than ours (starting over). */ other_trade_bps?: number } | null,
      // Everyday frictions (docs/behaviour/frictions.md), as far as they are a person's to notice: the variable of a
      // home that says how far it has fallen into disrepair, and the level at which whoever lives there finds it
      // needs repair; how far over our usual a bill must be before we look at it twice; how long the other side is
      // given to answer, and to do what it said it would. None of it arises unless the world's dial is on.
      frictions: {} as { disrepair?: { variable: string; at: number }; bill_over_bps?: number; answer_days?: number; promise_days?: number; faulty_bps_per_year?: number; faulty_share_bps?: number },
      // How long this person had lived here, worked at their trade and belonged to their group when the world began
      // (days; the world's, from its profile's figures: docs/profiles.md). None: attached to nothing at the start.
      started: null as { place_days?: number; trade_days?: number; group_days?: number } | null,
      // The town's mean attachment to place and trade at the start, which a person's own is read against (the
      // world's, worked out from the same figures). None: attachment sways nothing.
      attach_mean: null as { place_bps?: number; trade_bps?: number } | null,
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
      // Staying with someone (docs/behaviour/households.md, "Taken in during the year"): a household with no dwelling
      // asks the people it is closest to, at most `ask` of them, and again after `ask_again_days` with no roof;
      // someone asked is willing where their own affinity for the asker is at least `willing_affinity_bps` (moved
      // by how they hold benevolence) and they trust them no less than people in general. PLACEHOLDERS: no source
      // gives a rate of taking in; it is a stated rule on the host's own record.
      stay: { ask: 5, ask_again_days: 30, willing_affinity_bps: 1_500 },
      leave_after_jobless_days: 180,
      // Civic life (docs/behaviour/citizen.md "Elections and news"): enrolling, judging the town's government, standing
      // and voting; reading the local paper. Placeholders, but the turnout and readership the world gives (its profile).
      electoral_town: null as string | null, // the town whose government we elect (the world says; none: no elections)
      electoral_body: null as string | null, // with whom we enrol, nominate and vote, where that is not the town itself (the world says)
      paper: null as string | null, // the local paper, whose news we read (the world says; none: no paper, and nothing is read as news)
      // School (docs/behaviour/education.md): the school children of its ages go to (the world says; none: no school).
      school: null as { entity: string; building: string; ages: [number, number] } | null,
      // Whom we tell when we leave town for good (the world gives them; none: our leaving is said to nobody in particular).
      tell_on_leaving: [] as string[],
      // A home next to ours that someone went into and has not come out of, with nobody in it (docs/behaviour/deaths.md):
      // whom we ask to call there (the police), the channel that shows us the buildings next to where we are, and how
      // long such a silence goes before anybody remarks on it (shares within so many days: the world's figures). None:
      // we remark on nothing.
      welfare: null as { police: string; channel: string; found_after: { within_days: number; bps: number }[] } | null,
      // Health (docs/behaviour/health.md): the clinic and its waiting room; the share who go when something's wrong of a
      // kind it sees; and the conditions nobody works with (the world says; none: no clinic).
      care: null as { entity: string; waiting: string; seek_bps: number; severities: string[]; off_work: string[]; wait_days: number } | null,
      // The tribunal (docs/behaviour/justice.md): where we take a rent increase that breaks the law (with the chance
      // `challenge_bps`) or a debt owed us unpaid after `apply_after_days` (with `apply_bps`), and where we ask for an
      // unpaid order to be enforced (the world says; none: no tribunal).
      tribunal: null as { entity: string; challenge_bps: number; apply_bps: number; apply_after_days: number; hears?: string[] } | null,
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
      // The occupancy standard a home is judged by, where the world states its own (none: the module's, household.ts).
      occupancy: null as OccupancyStandard | null,
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
      /** Where this person comes from, if the world has origin groups (docs/behaviour/culture.md): given by the generator only where the culture dial is on. */
      origin: null as string | null,
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
    let lastEmployer: string | undefined; // whose employment we last left (what a claim for support is asked to show)
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
    let saleSeenAt = -1; // when we last had an answer from the listings
    const forSaleNow = (): StatementRecord[] => (p.sale_board ? onSale ?? [] : book.open("property_for_sale"));
    let nextShopSearch = ctx.rng("shop-search-day").below(30) * DAY;
    const lookedUp = new Set<string>(); // shops whose prices we know from looking them up, not from passing
    let homelessSince: number | null = null;
    /** Homes we have given up or been put out of (a tenancy ended, a household that moved out): no longer where we
     * belong, though our body was last there. Until 2026-10-12 someone with no home was taken back, by the daily
     * round, to the dwelling they had just left, and lived on in it with no tenancy (docs/decisions.md, "What the
     * fourth living pilot found"). A home leased again is ours again. */
    const gaveUp = new Set<string>();
    /** A let home we left when told to vacate for arrears: the lease, the landlord, and when (for an answer to the
     * tribunal if the landlord applies for possession of a home we have already given up). */
    let leftHome: { agreement: string; landlord: string; space: string; at: number } | null = null;
    /** Applications for possession made against us, by lease: how many (which one a draw is about, whatever number
     * the paper took on file), and those we answered (what came of answering is learned). */
    /** The people we have talked with, met or mourned with: those of our ties who are people (a tie may be to an
     * organisation, which nobody asks for a bed). */
    const peopleWeKnow = new Set<string>();
    /** Whose home we are staying in as guests (our household keeps its own record and goes on looking), and whom
     * we have asked; those we have taken in ourselves (told if our own home ends). */
    let stay: { host: string; space: string; since: number } | null = null;
    let stayAskedAt: number | null = null;
    let stayEndedAt: number | null = null;
    const tookIn = new Set<string>();
    /** Whom we have asked to take us in since we last had a home: nobody is asked twice. */
    const stayAsked = new Set<string>();
    /** A draw that is ours and about one thing (a tenancy, an application), whatever hour we come to make it: on the
     * run's stream that is not keyed on the hour, named for us and for what it is about. A person's other draws are
     * named for the moment too (docs/reliability.md, "Draws and the order papers were filed in"). */
    const fixed = (purpose: string) => (ctx.chance ?? ctx.rng)(`${me}/${purpose}`);
    const appliedFor = new Map<string, number>();
    const answeredApps = new Set<string>();
    let joblessSince: number | null = null;
    let nextSpend = ctx.rng("spend-day").below(30) * DAY;
    // Shopping: the shop we go to, this trip's shortfalls still to find elsewhere, and when we next shop.
    let favourite: string | undefined;
    // The mind: a person drawn once from the world's figures, and what it learns (docs/design/ai-citizens.md 3).
    // (A shop not yet tried is expected to serve most of what's asked: one that serves nothing then counts against it.)
    const mind = new Mind(ctx.rng("person"), p.values, { ...MIND_DEFAULTS, ...p.mind, ewa: { ...MIND_DEFAULTS.ewa, ...(p.mind.ewa ?? {}) } }, { shop: 8_000, job: 5_000, practice: 4_000 }, p.own_values ?? undefined);
    // The richer record (docs/design/ai-citizens.md 10c): trust, agency, attachments, views, dents, memory, hours.
    const inner = new Inner(ctx.rng("inner"), mind.person.values, p.values.values, p.outlook, innerParams(p.inner));
    // Wants and initiative (docs/design/ai-citizens.md 10a): whether this person is one who takes initiative (their
    // own draw against the world's dial, or as the world says of them), and the wants they hold.
    const dial = Number(ctx.world.dials?.initiative_bps ?? 0);
    const initiative: boolean = p.initiative ?? (dial > 0 && ctx.rng("initiative").below(10_000) < dial);
    const wants = new Wants(wantParams(p.wants));
    // What going after a want has set in train, for the parts of the week's plan that carry it out: a look at the job
    // board whatever the month's chance; a hunt for another home while we have one (to beat a rent, if that is the
    // point); whom we last asked to vary an agreement, and the papers we are waiting on an answer about; joining the
    // union; a debt taken to the tribunal now; a complaint made now; petitions to sign and elections to stand in.
    let searchForced = false;
    let moveHunt: { until: number; beat?: number } | null = null;
    const askedParty = new Map<string, number>();
    const askedOf = new Map<string, { t: number; by: string }>();
    let joinNow = false;
    // Founding (docs/behaviour/founding.md): what we have begun to found and are finding words for; what we founded;
    // the groups made in a run that we have asked to join, belong to (since when, and when we last came), and what
    // those we know have told us was done to them.
    const F = initiative ? foundingParams(p.founding, (ctx.world.dials as { founding?: unknown } | undefined)?.founding) : null;
    let foundRest = 0;
    type Begun = { want: Wanted; shape: Shape; sharers: { who: string; how: string }[]; brief: ComposeBrief; dues: number[]; piece?: ComposePiece | null; sent?: boolean; nameBy?: "translator" | "code" };
    let begun = null as Begun | null;
    let pendingGroup = false;
    let myGroup: { org: string; shape: Shape; about: string } | null = null;
    let ventureWanted = 0;
    const joinGroup = new Set<string>();
    const appliedTo = new Set<string>();
    const groups = new Map<string, { t: number; agreement: string; went: number; claimed?: number; drew?: number }>();
    /** Bodies that turned us away at their door or refused us what their own stated rule did not say they would: no
     * longer something that answers a want of ours, whatever their offer says (docs/behaviour/founding.md). */
    const refusedBy = new Set<string>();
    const heardWronged = new Map<string, { by: string; matter: string; t: number }>();
    const mourners = new Map<string, Set<string>>(); // someone who died -> those we know to mourn them (who told us, whom we told)
    const applyDebtNow = new Set<string>();
    let complainNow = false;
    // Everyday frictions (docs/behaviour/frictions.md): what has gone wrong for us and is not yet put right, each
    // with the other side, what we asked of them and what they said, and the venues we took it to. A grievance is a
    // want about them (for one who takes initiative); whatever becomes of it is recorded for everyone.
    const fdial = frictionDial(ctx.world);
    interface Grievance { key: string; matter: string; party: string; since: number; about?: string; amount?: number; structure?: string; seeks?: string; evidence?: unknown;
      asked?: { t: number }; answer?: "granted" | "refused" | "ignored"; answeredAt?: number; promised?: number; applied: Map<string, { t: number; finding?: string }>; ordered?: { id: string; by: string; binding: boolean; due: number; amount: number; enforced?: boolean }; told?: boolean }
    const grievances = new Map<string, Grievance>();
    const evidenceSent = new Set<string>(); // requests for papers to support a claim of ours, answered
    const gkey = (matter: string, party: string, about?: string) => `${matter}:${about ?? party}`;
    const billed = new Map<string, number>(); // a service -> what its last bill came to a day
    const billSeen = new Set<string>();
    let spoiled = 0; // goods found faulty, to be thrown out
    let faultSeen = 0; // when goods last came home
    let discouragedUntil = 0; // not looking for work until then, having given up on it (0: looking)
    /** How much more another job must pay before it is worth leaving ours (basis points; 0: anything more), for one
     * who takes initiative where the world says what holds people: a premium, more for each year in the job (the
     * years before the world began count for the job we began with), and more again for another line of work. */
    const heldIn = (t: number, industry?: unknown): number => {
      const m = p.job_move;
      if (!job || !initiative || !m) return 0;
      const years = Math.min(m.cap_years, (t - job.since + (job.since < 7 * DAY ? (p.started?.trade_days ?? 0) * DAY : 0)) / p.year);
      return m.premium_bps + Math.round(m.per_year_bps * years) + (typeof industry === "string" && industryOf.get(job.employer) !== industry ? m.other_trade_bps ?? 0 : 0);
    };
    const signNow = new Set<string>();
    const standNow = new Set<string>();
    const shortSince = new Map<string, number>(); // a need -> since when it has been short
    let withdrew: { about: string; t: number } | null = null; // what we last gave up on or did nothing about, to say when asked
    let troubles: { what: "let_go" | "notice" | "rent_increase"; by: string }[] = []; // what befell one of our household, as they told us
    const leftHomes: { agreement: string; orders: string[] }[] = []; // homes we moved out of before their tenancy ended: their rent is paid until it does
    /** What kind of institution someone is to us (the kinds a place's survey gives confidence in). */
    const kindOf = (who: string): string =>
      p.institutions[who] ?? (who === p.bank ? "banks" : who === p.union ? "unions" : who === p.complain_to || who === p.electoral_town ? "government"
        : who === p.tribunal?.entity ? "courts" : who === p.welfare?.police ? "policing" : who === p.paper ? "press"
        : who === p.care?.entity || who === p.school?.entity ? "civil_service" : employers.has(who) ? "companies" : "other");
    const employers = new Set<string>(); // those we have worked for (an employer is a company to us)
    // What was done to us lately, that we tell those who ask how we are (for `news_days`).
    let letGo: { by: string; t: number } | null = null;
    let noticedBy: { by: string; t: number } | null = null;
    // The record as last written (each section's JSON), and the change waiting to go with our next action.
    const written = new Map<string, string>();
    let recordChange: RecordChange | null = null;
    let lastSeenT = 0; // when we last woke
    // Upbringing (docs/behaviour/citizen.md): someone the world gave no values of their own (born here, or come as a
    // child) has, until they come of age, those drawn for them; then they ask the parents they live with, and theirs settle.
    const upbringing = { settled: !!p.own_values, askedAt: null as number | null, told: [] as { most: string[]; least: string[] }[],
      /** What the parents told of how they see things here, and where they say they come from (culture, step 4): one entry for each parent who spoke. */
      culture: [] as { pictures: { conduct: Conduct; does: number; approves: number }[]; group?: string }[] };
    let askedWhatMatters: string[] = [];
    /** What we were at since we last woke, by where our body is (where the hours go: docs/design/ai-citizens.md 10b,
     * 10h): work, learning, a gathering, care, home (our own, or any dwelling: a child knows theirs only by being in
     * it), or away (anywhere else, or nowhere). The way there is not told apart. */
    const whereAt = (space: string | undefined): string =>
      !space ? "away" : space === attending?.space ? "gathering" : space === job?.workplace || (ownWork?.at !== undefined && space === ownWork.at) ? "work"
        : p.school && structureOf(space) === p.school.building ? "learning" : p.care && space === p.care.waiting ? "care"
        : space === home?.space || space === livingAt || /\/dwelling\.\d+$/.test(space) ? "home" : "away";
    /** Whether a section has moved enough to be written again: any change of shape or words, or a number by more
     * than the section's grain. (The record is a summary to read, not the mind's own working figures: writing every
     * week's fading of every tie would be most of a log.) */
    const moved = (a: unknown, b: unknown, grain: number): boolean => {
      if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) > grain;
      if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a !== b;
      const ka = Object.keys(a as object), kb = Object.keys(b as object);
      if (ka.length !== kb.length || Array.isArray(a) !== Array.isArray(b)) return true;
      return ka.some((k) => !(k in (b as object)) || moved((a as any)[k], (b as any)[k], grain));
    };
    // How far a number in each section must move before the section is written again (basis points; money by a
    // twentieth of itself, below). Needs, values and what is remembered are written whenever they change.
    const GRAIN: { [section: string]: number } = { agency: 50, trust: 100, attached: 200, views: 200, ties: 500, beliefs: 100 };
    let hoursAt = 0;
    let normsNow: ReturnType<Culture["section"]> | undefined, normsWritten: typeof normsNow;
    let heardNow: ReturnType<TownMemory["section"]> | undefined, heardWritten: typeof heardNow;
    /** The record as it stands, for the kernel to hold (contracts/entity-record.schema.json): the sections that have
     * moved since they were last written, to go with our next action. `adult`: needs and the rest are judged. */
    const writeRecord = (t: number, adult: boolean, means?: { income: number; savings: number }) => {
      const sec = inner.sections();
      const whole = (x: number) => Math.round(x);
      const tie = (x: { who: string; affinity: number; trust: number; last?: { what: string; t: number } }) => ({ who: x.who, affinity: whole(x.affinity), trust: whole(x.trust), ...(x.last ? { last: x.last } : {}) });
      const all: { [section: string]: unknown } = {
        values: { ...mind.person.values },
        temperament: { ...mind.person.temperament },
        ...(adult ? { needs: { ...levelsNow } } : {}),
        agency: sec.agency,
        trust: { people: whole(p.outlook.people_bps ?? inner.p.trust.start_bps), in: sec.trust },
        attached: sec.attached,
        views: sec.views,
        ties: { close: ties.closest(5, t).map(tie), resented: ties.resented(3, t).map(tie) },
        beliefs: [...beliefs].filter(([, b]) => b > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 6).map(([teaching, bps]) => {
          const r = book.records.get(teaching);
          const from = r?.record === "statement" ? r.speaks_for ?? r.author : undefined;
          return { teaching, bps: whole(bps), ...(from ? { from } : {}) };
        }),
        // (Wants: docs/design/ai-citizens.md 10a. A want held with one's household names it.)
        wants: initiative ? wants.section() : [],
        // (Only when the picture has been worked out again: the same array as last time is not compared again.)
        ...(cul && (normsNow = cul.section(t)) !== normsWritten ? { norms: normsNow } : {}),
        ...(mem && (heardNow = mem.section()) !== heardWritten && (heardNow.length || heardWritten) ? { heard: heardNow } : {}),
        memory: sec.memory,
        circumstances: { household: household?.members.length ?? 1, housed: home || livingAt ? 1 : 0, working: job || ownWork ? 1 : 0, retired: retired ? 1 : 0,
          ...(means ? { income: whole(means.income), savings: whole(means.savings) } : {}) },
      };
      if (all.norms) normsWritten = all.norms as typeof normsNow;
      if (all.heard) heardWritten = all.heard as typeof heardNow;
      // Where the hours went: a week's at a time.
      if (t - hoursAt >= 7 * DAY) {
        hoursAt = t;
        all.hours = inner.takeHours(t);
      }
      const set: { [section: string]: unknown } = { ...(recordChange?.set ?? {}) };
      for (const [k, v] of Object.entries(all)) {
        const before = written.get(k);
        const was = before === undefined ? undefined : JSON.parse(before);
        const changed = was === undefined ? true
          : k === "circumstances" ? moved({ ...(v as any), income: 0, savings: 0 }, { ...was, income: 0, savings: 0 }, 0) || ["income", "savings"].some((m) => Math.abs(((v as any)[m] ?? 0) - (was[m] ?? 0)) * 20 > Math.max(1, Math.abs(was[m] ?? 0)))
          : moved(v, was, GRAIN[k] ?? 0);
        if (!changed) continue;
        written.set(k, JSON.stringify(v));
        set[k] = v;
      }
      const because = [...(recordChange?.because ?? []), ...inner.takeSince()].slice(-16);
      if (Object.keys(set).length) recordChange = { set, ...(because.length ? { because } : {}) };
    };
    // How far this person's value sits from their world's (standardised, -3..3): a person's rates follow their values,
    // the town's stay as calibrated (docs/design/ai-citizens.md 3a).
    const zValue = (v: Value) => {
      const d = p.values.values[v] ?? { mean_bps: 5_000, sd_bps: 1_500 };
      return Math.max(-3, Math.min(3, (mind.person.values[v] - d.mean_bps) / Math.max(1, d.sd_bps)));
    };
    const shifted = (bps: number, shift: number) => Math.max(0, Math.min(10_000, Math.round(bps * (1 + shift))));
    /** A cited rate of turning to an institution, as this person's trust in it and their sense of agency sway it
     * (docs/behaviour/citizen.md "Readers"): symmetric about the town's mean, so the town's rate stays as
     * calibrated. Read only for one who takes initiative. */
    const reads = (bps: number, who: string, conduct?: Conduct): number => {
      const read = initiative ? swayed(swayed(bps, inner.zTrust(who, kindOf(who), lastSeenT), wants.p.sway.trust), inner.zAgency(), wants.p.sway.agency) : bps;
      // (And, where the world has culture on, the lean of what we take those around us to do and approve of: one bounded term, beside trust and agency.)
      return cul && conduct ? cul.term(read, conduct, lastSeenT) : read;
    };
    /** A member of an organisation now: a membership agreement with it in force. */
    /** How much of a month of our household's essentials a fund's stated draw would cover (0 to 1); undefined for
     * what is no fund. Under `FUND_WORTH_MIN` a fund does not answer "nothing to fall back on" for us at all. */
    const fundWorth = (s: StatementRecord): number | undefined => {
      const host = s.speaks_for ?? s.author;
      const draw = (s.offer?.terms?.commitments ?? []).filter((c) => c.who === host).map((c) => (c.does as any)?.outcome?.money).find((x) => x?.amount);
      return draw ? Math.min(1, cents(draw.amount) / Math.max(1, p.essentials)) : undefined;
    };
    const memberOf = (org: string) => book.ofType("agreement").some((r) => r.record === "agreement" && r.terms.template === "membership" && r.terms.parties.includes(me) && r.terms.parties.includes(org) && book.inForce(r.id));
    const isMember = () => !!p.union && memberOf(p.union);
    /** Party to an agreement in force with someone (their tenant, their worker, their member): what an offer or a
     * gathering may ask for in place of membership of anything (blocks: Eligibility.dealing_with). */
    const dealsWith = (whom: string) => book.ofType("agreement").some((r) => r.record === "agreement" && r.terms.parties.includes(me) && r.terms.parties.includes(whom) && book.inForce(r.id));
    let lastServed = 10_000; // how fully the last shop served us (basis points)
    const decided: DecisionRecord[] = []; // the mind's decisions since the last action, carried with the next (7)
    // How things turned out, as we came to know it, since the last action (7): recording only. Nothing below reads
    // any of it back: what we do is the same whether or not a run keeps it.
    const outcomes: OutcomeRecord[] = [];
    let decisions = 0; // our own count of our recorded decisions: an outcome names the one it follows by it
    const chose = new Map<string, number>(); // "area:option" -> our latest decision that chose it
    /** A decision, recorded: numbered, and remembered by what it chose (`as`: other names its outcomes come under). */
    const decision = (d: DecisionRecord, ...as: string[]): number => {
      d.n = ++decisions;
      decided.push(d);
      for (const key of [d.choice, ...as]) if (key !== undefined) chose.set(`${d.domain}:${key}`, d.n);
      return d.n;
    };
    /** Something we came to know of how a choice went (`own`: of our own choosing, so it follows our decision, if one
     * is recorded; another's experience told to us follows none). */
    const outcome = (o: OutcomeRecord, own = true) => {
      const of = own ? chose.get(`${o.domain}:${o.option}`) : undefined;
      outcomes.push({ ...o, ...(of !== undefined ? { of } : {}) });
      appraised(o, own);
    };
    /**
     * What a thing that happened does to trust, agency and the rest of the record (docs/behaviour/citizen.md "The
     * record"): every outcome the citizen comes to know passes here once, so nothing is appraised that it did not
     * know, and nothing twice. `own`: ours; else someone else's, told to us.
     */
    /** A want born of something that happened (docs/design/ai-citizens.md 10a): what it seeks in the world's typed
     * outcomes, whom it concerns and the paper in its way; how much it matters is the event's size as this person
     * weighs the need it touches. Nothing, for someone who takes no initiative. */
    const wantBorn = (t: number, about: string, seeks: SeekKey[], size: number, need: keyof NeedLevels, o: { whom?: string; against?: { record: string; kind: string; by: string }; from?: "event" | "other"; with?: string } = {}) => {
      if (!initiative) return undefined;
      return wants.born({ about, seeks, weight: Math.round((wants.p.event_bps * Math.max(0.1, Math.min(1.5, size)) * mind.person.weights[need]) / 15_000), since: t, from: o.from ?? "event",
        ...(o.whom ? { whom: o.whom } : {}), ...(o.against ? { against: o.against } : {}), ...(o.with ? { with: o.with } : {}) }, t);
    };
    /** Something has gone wrong for us at someone's hands (docs/behaviour/frictions.md): held until it is put right or
     * let go, and, for one who takes initiative, a want about them. */
    const grieve = (t: number, matter: string, party: string, o: { about?: string; amount?: number; structure?: string; seeks?: string; evidence?: unknown; size?: number; need?: keyof NeedLevels; cause?: string } = {}): Grievance => {
      const key = gkey(matter, party, o.about);
      const held = grievances.get(key);
      if (held) {
        if (o.amount !== undefined) held.amount = o.amount;
        return held;
      }
      const { size, need, cause, ...rest } = o;
      const g: Grievance = { key, matter, party, since: t, ...rest, applied: new Map() };
      grievances.set(key, g);
      outcome({ t, domain: "friction", option: matter, kind: "arose", way: "mine", from: party, facts: { ...(o.amount !== undefined ? { amount: o.amount } : {}), ...(cause ? { cause } : {}), ...(o.structure ? { structure: o.structure } : {}) } });
      inner.experience(party, kindOf(party), false, t);
      inner.doneTo(0.5);
      // (Into the record's reasons, so that a lean log has it: what arose, and against whom.)
      inner.note({ t, what: "friction_arose", about: matter, size: Math.min(10_000, Math.max(0, Math.round((o.amount ?? 0) / 100))), by: party });
      wantBorn(t, matter, o.amount ? ["money.to"] : [], size ?? 0.6, need ?? "security", { whom: party, ...(o.about ? { against: { record: o.about, kind: matter, by: party } } : {}) });
      return g;
    };
    /** Something that befell our household, to tell its other adults (once each). */
    let troubleToTell: { what: "let_go" | "notice" | "rent_increase"; by: string }[] = [];
    const appraised = (o: OutcomeRecord, own: boolean) => {
      const t = o.t;
      const who = o.option;
      if (initiative && own) switch (`${o.domain}:${o.kind}`) {
        case "job:ended":
          if (o.facts?.by !== "self" && !retired) { wantBorn(t, "let_go", ["work", "money.to"], 0.7 + inner.attachedTo("trade") / 20_000, "status", { whom: who }); troubleToTell.push({ what: "let_go", by: who }); }
          break;
        case "job:unpaid": wantBorn(t, "unpaid", ["money.to"], 1, "security", { whom: who }); break;
        case "home:notice_received": {
          const by = String(o.facts?.from ?? "");
          if (by && home) { wantBorn(t, "notice", ["occupancy"], 1, "shelter", { whom: by, against: { record: home.agreement, kind: "notice", by } }); troubleToTell.push({ what: "notice", by }); }
          break;
        }
        case "practice:turned_away": { const host = String(o.facts?.host ?? ""); if (host) wantBorn(t, "slight", [], 0.3, "belonging", { whom: host }); break; }
        default:
      }
      switch (`${o.domain}:${o.kind}`) {
        case "job:hired": employers.add(who); inner.tried(true); inner.experience(who, "companies", true, t); inner.remember({ t, what: "hired", about: who, size: 2_000 }); break;
        case "job:paid": inner.experience(who, kindOf(who), true, t, { weight: 0.2 }); break;
        case "job:rise": inner.experience(who, kindOf(who), true, t); break;
        case "job:unpaid": inner.experience(who, kindOf(who), false, t, { weight: 2 }); inner.doneTo(); ties.add(who, -3_000, t, "unpaid"); feelings.feel("fear", who, 3_000, t); inner.remember({ t, what: "unpaid", about: who, size: 4_000 }); break;
        case "job:no_work": inner.experience(who, kindOf(who), false, t); inner.doneTo(0.5); break;
        case "job:ended":
          if (o.facts?.by !== "self") {
            // Let go: more than income is lost, the more so the more the trade was ours (docs/design/ai-citizens.md 10c).
            inner.experience(who, kindOf(who), false, t);
            inner.doneTo();
            ties.add(who, -1_000, t, "let_go");
            inner.happened("job_lost", t, { about: who, closeness: 0.5 + inner.attachedTo("trade") / 20_000 });
            letGo = { by: who, t };
          }
          break;
        case "job:told":
          if (!own && (inner.trusted(who) !== undefined || job?.employer === who)) inner.experience(who, kindOf(who), o.facts?.paid !== false, t, { heard: true });
          break;
        case "home:lease_signed": inner.tried(true); inner.remember({ t, what: "housed", about: who, size: 2_000 }); break;
        case "home:moved_in": inner.tried(true, 0.5); break;
        case "home:renewed": if (home) inner.experience(home.landlord, kindOf(home.landlord), true, t); break;
        case "home:rent_increase":
          if (home && Number(o.facts?.rent) > Number(o.facts?.was)) { inner.experience(home.landlord, kindOf(home.landlord), false, t); inner.doneTo(0.5); ties.add(home.landlord, -1_000, t, "rent_rise"); feelings.feel("fear", home.landlord, 2_000, t); }
          break;
        case "home:notice_received": {
          const by = String(o.facts?.from ?? "");
          if (!by) break;
          inner.experience(by, kindOf(by), false, t, { weight: 2 });
          inner.doneTo();
          ties.add(by, -3_000, t, "notice");
          feelings.feel("fear", by, 5_000, t);
          inner.happened("evicted", t, { about: by });
          noticedBy = { by, t };
          break;
        }
        case "membership:joined": inner.tried(true, 0.5); break;
        case "membership:rise_won": if (p.union) inner.experience(p.union, "unions", true, t, { weight: 2 }); inner.tried(true); break;
        case "practice:attended": { const host = String(o.facts?.host ?? ""); if (host) inner.experience(host, kindOf(host), true, t, { weight: 0.2 }); break; }
        case "practice:turned_away": inner.tried(false); inner.happened("turned_away", t, { about: String(o.facts?.host ?? "") }); if (o.facts?.host) refusedBy.add(String(o.facts.host)); break;
        case "goal:met": inner.tried(true); break;
        case "goal:not_met": inner.tried(false); break;
        case "venture:founded": inner.tried(true, 2); inner.remember({ t, what: "founded", about: String(o.facts?.firm ?? ""), size: 5_000 }); break;
        case "venture:refused": inner.tried(false); break;
        default:
      }
    };
    /** What the mind has learned of an option, for the record: before an update (what it expected of one never tried or
     * heard of, marked `first`), and now. */
    const was = (domain: string, option: string) => ({ before: Math.round(mind.learned(domain).get(option)), ...(mind.learned(domain).known(option) ? {} : { first: true as const }) });
    const now = (domain: string, option: string) => Math.round(mind.learned(domain).get(option));
    /** What the mind learns of an option from how it went for us, with the record of it: the payoff as the mind
     * computed it, and what it had learned of the option before and has now. */
    const learn = (domain: string, option: string, payoff: number, o: Omit<OutcomeRecord, "domain" | "option" | "learned">, own = true) => {
      const before = was(domain, option);
      mind.learn(domain, option, payoff);
      outcome({ ...o, domain, option, learned: { payoff: Math.round(payoff), ...before, after: now(domain, option) } }, own);
    };
    /** What the mind makes of what someone told us an option gave them, with the record of it. */
    const hearOf = (domain: string, option: string, payoff: number, o: Omit<OutcomeRecord, "domain" | "option" | "learned">) => {
      const before = was(domain, option);
      mind.hear(domain, option, payoff);
      outcome({ ...o, domain, option, learned: { payoff: Math.round(payoff), ...before, after: now(domain, option), heard: true } }, false);
    };
    /** A feeling as the mind appraised it, for the record: `feel` (at least this strongly) or `add` (more, by a share). */
    const felt = (how: "feel" | "add", emotion: Parameters<Feelings["level"]>[0], about: string, bps: number, t: number): NonNullable<OutcomeRecord["felt"]>[number] => {
      const before = feelings.level(emotion, about, t);
      feelings[how](emotion, about, bps, t);
      return { emotion, about, bps: Math.round(bps), before, after: feelings.level(emotion, about, t) };
    };
    /** Holding more strongly to what someone teaches, for the record. */
    const strengthened = (host: string, bps: number): NonNullable<OutcomeRecord["belief"]> => {
      const before = holdTo(host);
      strengthen(host, bps);
      return { host, before, after: holdTo(host) };
    };
    let thanked: NonNullable<OutcomeRecord["felt"]>[number] | undefined; // gratitude for a lead, for the record of what it led to
    const noticeSeen = new Set<string>(); // (for the record: a landlord's notice on a lease, said once)
    const noticeOver = new Set<string>(); // tenancies whose notice to vacate has lapsed (paid up), or was answered by a plan or a dismissal: we stay
    const petitionSeen = new Set<string>(); // (for the record: a petition we first saw and did not sign, said once)
    let personTold = false; // who we are goes with our first recorded decision, once (it does not change)
    const wholeFacts = (f: Facts): NonNullable<DecisionRecord["options"][number]["facts"]> => ({ money_per_month: Math.round(f.money_per_month),
      ...(f.home ? { home: f.home.bedrooms !== undefined ? { bedrooms: f.home.bedrooms } : {} } : {}),
      ...(f.work_hours_per_month !== undefined ? { work_hours_per_month: Math.round(f.work_hours_per_month) } : {}), ...(f.goods_per_month !== undefined ? { goods_per_month: Math.round(f.goods_per_month) } : {}),
      ...(f.company !== undefined ? { company: Math.round(f.company) } : {}), ...(f.time_hours_per_month !== undefined ? { time_hours_per_month: Math.round(f.time_hours_per_month) } : {}) });
    // Feelings, about people and things (docs/design/ai-citizens.md 3d), and ties with the people we know.
    const feelings = new Feelings();
    // (Kept: as many as we keep contacts, and the few we resent. How far a tie is trusted starts from how far people
    // here say most people can be trusted, where the world says.)
    const ties = new Ties(180, p.max_contacts + 3, p.outlook.people_bps ?? 5_000);
    // ---- reading (docs/behaviour/reading.md): what the words of a paper addressed to us were read to be. Only where the
    // world's dial has reading on and the paper was read (a seat's own words); otherwise nothing here is entered and
    // every figure is the one it always was. The reader saw the paper and nothing of us; what the words mean to us is
    // worked out here, from our own record.
    const rdial = readingDial(ctx.world);
    // ---- culture (docs/behaviour/culture.md): what we take those around us to do and approve of. Only where the world's
    // dial has it on; otherwise nothing here is entered, no section is written, no phrase said, no term applied.
    const cdial = cultureDial(ctx.world);
    if (cdial) GRAIN.norms = cdial.params.grain_percent; // (the record's grain for the norms: whole percent)
    const cul: Culture | undefined = cdial ? new Culture(cdial.params, cdial, {
      z: (v) => inner.zOf(v), conformity: () => mind.person.temperament.conformity / 10_000, belonging: () => (mind.person.weights.belonging - 10_000) / 10_000,
      integrity: () => inner.integrity(), draw: (c) => standardNormal(ctx.rng(`culture-own-${c}`)),
    }, ((): { [c in Conduct]?: number } => {
      const union = p.union ? Object.values(p.union_join_bps) : [];
      return {
        ...(p.possession?.answer_bps !== undefined ? { answer_tribunal: p.possession.answer_bps } : {}),
        ...(p.possession ? { stay_past_notice: p.possession.stay_bps } : {}),
        ...(p.tribunal ? { take_to_tribunal: p.tribunal.challenge_bps } : {}),
        ...(p.complain_to ? { complain: p.complain_bps } : {}),
        take_in: cdial!.params.does_default_bps, // (no rate of its own: the placeholder, marked in the doc)
        ...(p.union && union.length ? { join_union: Math.round(union.reduce((a, b) => a + b, 0) / union.length) } : {}),
        ...(p.union ? { strike: p.strike_vote_yes_bps } : {}),
        ...(p.crime ? { take_from_employer: Math.round((p.crime.take_bps * (10_000 - p.crime.caught_bps)) / 10_000) } : {}),
        // (A landlord's applying for possession: a view of it is held where the world has a law on possession; no rate of its own: the placeholder.)
        ...(p.possession ? { apply_possession: cdial!.params.does_default_bps } : {}),
      };
    })(), p.origin ?? undefined) : undefined;
    // ---- town memory (step 5): what we remember of what was public, in a few typed slots of our own record; only where the dial is on.
    const mem: TownMemory | undefined = cul ? new TownMemory(cul.p) : undefined;
    /** Who carries out a removal in this world, for an event about one: whoever the law on possession names (it is published: foundations F8, law 6). None where the world has no such law. */
    const enforcerOfRemovals = (): string | undefined => { const by = book.open("law").find((r) => r.data?.tenancy === "possession")?.data?.enforced_by; return typeof by === "string" ? by : undefined; };
    /** An event has just become ours for the first time: it bears once on trust in whoever did it, by the sign of OUR view of the conduct it shows (never the platform's),
     * at its strength times `bystander_bps` and how strong that view is, whether or not we have dealt with them. Hearing it again moves nothing. */
    const bearOnTrust = (kind: EventKind, about: string, strength: number, t: number) => {
      const conduct = EVENT_CONDUCT[kind];
      const own = conduct && cul ? cul.read(conduct, t)?.own : undefined;
      if (own === undefined || own === 5_000) return;
      // A removal held right is the doer vindicated; a walk-out held right is the employer's trust lost (`trustDirection`).
      const ok = trustDirection(kind, own) > 0;
      inner.experience(about, kindOf(about), ok, t, { weight: cul!.bearing(strength, own), heard: true });
    };
    /** Something public reached us (we saw it, read it): kept, and, the first time, a sighting of the conduct it shows where we were there. */
    const remember = (kind: EventKind, about: string, eventT: number, t: number, how: "saw" | "read", strength: number) => {
      if (!mem || !cul) return;
      const r = how === "saw" ? mem.saw(kind, about, eventT, t) : mem.read(kind, about, eventT, t, strength);
      if (r !== "fresh") return;
      bearOnTrust(kind, about, mem.strengthOf(kind, about, eventT, t), t);
    };
    /** What a tie told us of the town (found anywhere in a message): the same, at the teller's strength less a hand's. */
    const hearTown = (text: string, t: number, who: string) => {
      const w = mem && TOWN_WORDS.heard(text);
      if (!mem || !cul || !w) return;
      const conduct = EVENT_CONDUCT[w.kind];
      const against = conduct ? (cul.read(conduct, t)?.own ?? 5_000) < 5_000 : false;
      if (mem.heardFrom(w.kind, w.about, w.day, t, w.strength, w.hops, against) === "fresh") {
        const held = mem.strengthOf(w.kind, w.about, w.day * DAY, t);
        bearOnTrust(w.kind, w.about, held, t);
        // The event is an instance of the conduct(s) it shows: evidence of what people here do, and the teller's said view of it of what they approve (once, when it becomes mine).
        const route = ties.affinity(who, t) >= cul.p.close_affinity_bps ? "close_tie" : "tie";
        (EVENT_CONDUCTS[w.kind] ?? []).forEach((c, i) => cul.sawEvent(c, route, held, i === 0 ? w.says : undefined));
      }
    };
    // Where those we have talked with say they come from (told when asked how things are, only where the profile gives a homophily):
    // bounded by the people we keep up with.
    const originSeen = new Map<string, string>();
    const sameOrigin = (who: string): boolean => !!cul?.group && originSeen.get(who) === cul.group;
    /** What a tie said of itself in the words of culture: what they did at an occasion and what they say of it move what we take
     * others to do and approve of, by the tie's weight (design 14b: first-hand only, so no act is counted twice); and where they
     * come from, which makes a tie to someone of our own group likelier (homophily). */
    const hearCulture = (text: string, who: string, t: number, replyTo: string) => {
      if (!cul || !cdial) return;
      const heard = CULTURE_WORDS.heard(text);
      if (heard) {
        const route = ties.affinity(who, t) >= cul.p.close_affinity_bps ? "close_tie" : "tie";
        for (const d of heard.did) {
          cul.seeAct(d.conduct, d.did, route);
          // What I make of it, and what I say of it (step 4: the tie cools or warms by what I think; I voice it by what I would say).
          cul.noteHeard(d.conduct, t);
          const r = cul.react(d.conduct, d.did, t);
          if (r) {
            if (r.tie) ties.add(who, r.tie, t, r.tie < 0 ? "disapproved" : "esteemed");
            if (r.voice !== undefined) verdicts.push({ to: replyTo, text: CULTURE_WORDS.verdict(d.conduct, d.did, r.voice) });
          }
        }
        for (const s of heard.says) cul.hearSaid(s.conduct, s.bps, route);
        // (They told me of themselves, so I know it first-hand and may tell of it in ordinary talk.)
        for (const d of heard.did) cul.learnOf(who, d.conduct, d.did, t);
      }
      // Ordinary talk: told of a third person's act, and what the teller says of it (design 14c; docs/behaviour/culture.md, "Ordinary talk"). The one talked about
      // gains or loses standing with me only if they are anyone to me; a stranger's act still moves my picture of what is done and approved.
      const about = CULTURE_WORDS.aboutHeard(text);
      if (about && about.who !== me) {
        const r = cul.hearAbout(about.who, about.conduct, about.did, about.approval, t, ties.affinity(who, t) >= cul.p.close_affinity_bps ? "close_tie" : "tie");
        if (r?.tie && ties.trust(about.who) !== undefined) ties.add(about.who, r.tie, t, r.tie < 0 ? "disapproved" : "esteemed");
      }
      const from = CULTURE_WORDS.fromHeard(text);
      if (from && cdial.homophily_bps > 0) {
        originSeen.delete(who);
        originSeen.set(who, from);
        while (originSeen.size > p.max_contacts * 4) originSeen.delete(originSeen.keys().next().value!);
        if (sameOrigin(who)) ties.add(who, Math.round((300 * cdial.homophily_bps) / 10_000), t, "talked");
      }
    };
    /** The weight of catching up with someone: ours is the closer the more alike (homophily, where the profile gives it). */
    const likeness = (who: string): number => (sameOrigin(who) && cdial ? 1 + cdial.homophily_bps / 10_000 : 1);
    const readOf = (paper: string): PaperRead | undefined => {
      const x = rdial && ctx.read ? ctx.read(paper, "addressee") : undefined;
      return x && !isNoShift(x.shift) ? x : undefined;
    };
    /** The odds of appealing, by matter: a step of recourse in the last answer read raises the score of asking again and of a venue. */
    const recourseBump = new Map<string, number>();
    /** A decision that reached us, landing on the record: trust in whoever decided (`trust`: the decision's own weight), the sense of agency (`tried`: something we tried, which worked or not; `doneTo`: something done to us), and, where its words were read, what they changed. Returns what moved, beside what it would have been, for the outcome. */
    const landing = (rd: PaperRead | undefined, by: string, ok: boolean, t: number, o: { trust?: number; tried?: boolean; doneTo?: number; kind?: string; feel?: boolean }): { [what: string]: { after: number; plain: number; before?: number } } => {
      const P = rdial?.params;
      const moved: { [what: string]: { after: number; plain: number; before?: number } } = {};
      if (o.tried !== undefined) { const a = inner.tried(o.tried, 1, rd && !o.tried ? failedAgency(rd.shift, P!) : undefined); if (rd) moved.agency = { before: a.before, after: a.after, plain: a.plain }; }
      if (o.trust !== undefined) { const e = inner.experience(by, o.kind ?? kindOf(by), ok, t, { weight: o.trust, ...(rd ? { scale: ok ? grantTrust(rd.shift, P!) : refusalTrust(rd.shift, P!) } : {}) }); if (rd) moved.trust = { before: e.before, after: e.after, plain: e.plain }; }
      if (o.doneTo !== undefined) { const a = inner.doneTo(o.doneTo, rd ? doneToAgency(rd.shift, P!) : undefined); if (rd) moved.agency_done_to = { before: a.before, after: a.after, plain: a.plain }; }
      if (rd && o.feel !== false) {
        const anger = angerAdded(rd.shift, P!), fear = fearAdded(rd.shift, P!), tie = tieMoved(rd.shift, P!);
        if (anger) { const was = feelings.level("anger", by, t); feelings.add("anger", by, anger, t); moved.anger = { after: feelings.level("anger", by, t), plain: was }; }
        if (fear) { const was = feelings.level("fear", by, t); feelings.add("fear", by, fear, t); moved.fear = { after: feelings.level("fear", by, t), plain: was }; }
        if (tie) { const was = ties.affinity(by, t); ties.add(by, tie, t); moved.tie = { after: ties.affinity(by, t), plain: was }; }
      }
      return moved;
    };
    /** What the words did, on the outcome just recorded (the person's side is theirs: the paper, the shift, each figure beside what it would have been). */
    const withRead = (rd: PaperRead | undefined, moved: { [what: string]: { after: number; plain: number; before?: number } }): void => {
      const last = outcomes[outcomes.length - 1];
      if (rd && last) last.read = readFacts(rd, moved);
    };
    const leadFrom = new Map<string, string>(); // a building someone told us to look at -> who told us
    // Goals: what we're pursuing, by which method; since when each need has gone unmet; when we may try again after
    // giving up; and, looking for a cheaper home, the rent to beat (for the first month of the hunt).
    const pursuits = new Map<string, Pursuit>();
    const unmetSince = new Map<string, number>();
    const restUntil = new Map<string, number>();
    let cheaperThan: { rent: number; until: number } | null = null;
    /** The way a goal's method names, as a want's way (for one who takes initiative, wants stand where goals did:
     * the same hooks in spending, the hunt for a home, the look for work and the rest are reached by whichever
     * opening the want was matched to, not by a list of methods a goal). */
    const WAY_OF: { [method: string]: string } = { "spend less": "self", "better work": "offer:employment", "cheaper home": "offer:lease", "catch up more": "ties", "try a gathering": "practice" };
    const pursuing = (method: string) => (initiative ? wants.taking(WAY_OF[method] ?? method) : [...pursuits.values()].some((x) => x.method === method));
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
        const r = ctx.rng(`consult-${about}`);
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
      const doubt = o.doubt ?? (MONEY_MATTERS.has(domain) ? Math.round(feelings.level("fear", "money", t) / 2) : 0);
      const d = mind.decide(domain, rng, { ...o, doubt });
      // (With the mind's state behind it: training data for citizen models, contracts-0.7 A2.)
      const emotion = feelings.strongest(t);
      const held = Object.fromEntries([...beliefs].filter(([, b]) => b > 0).sort(([a], [b]) => (a < b ? -1 : 1)));
      const goal = [...pursuits.values()].find((x) => x.method !== undefined);
      // And what it had before it (docs/design/ai-citizens.md 7): every option with its facts, how many it knows took it,
      // what it means to them and what they have learned of it; their routine; their circumstances. Whole numbers only.
      // (An option the way of deciding gave no score has 0: none under repeat, under imitate those nobody is known to take.)
      const scoreOf = new Map(d.scores.map((x) => [x.key, x.score]));
      const learned = mind.learned(domain);
      const seen = [...o.options].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((x) => ({ key: x.key, score: scoreOf.get(x.key) ?? 0,
        ...(x.facts ? { facts: wholeFacts(x.facts) } : {}), ...(x.others ? { others: x.others } : {}), ...(x.meaning ? { meaning: Math.round(x.meaning) } : {}),
        ...(learned.known(x.key) ? { learned: Math.round(learned.get(x.key)) } : {}) }));
      const c = o.circ;
      const person = personTold ? undefined : { values: { ...mind.person.values }, temperament: { ...mind.person.temperament }, weights: { ...mind.person.weights } };
      personTold = true;
      decision({ t, domain, strategy: d.strategy, ...(d.key !== undefined ? { choice: d.key } : {}), options: seen,
        ...(o.current !== undefined ? { current: o.current } : {}),
        circumstances: { monthly_income: Math.round(c.monthly_income), savings: Math.round(c.savings), homeless: c.homeless,
          ...(c.homeBedroomsNeeded !== undefined ? { bedrooms_needed: c.homeBedroomsNeeded } : {}), ...(c.essentials !== undefined ? { essentials: Math.round(c.essentials) } : {}) },
        ...(o.satisfied_here !== undefined ? { satisfied_here: Math.round(o.satisfied_here) } : {}), ...(doubt ? { doubt: Math.round(doubt) } : {}),
        ...(person ? { person } : {}),
        state: { mind: MIND_VERSION, needs: { ...levelsNow }, satisfaction: d.satisfaction ?? 0, certainty: d.certainty ?? 0,
          ...(emotion ? { emotion } : {}), ...(Object.keys(held).length ? { beliefs: held } : {}), ...(goal ? { goal: { goal: goal.goal, method: goal.method! } } : {}) } });
      return d;
    };
    let levelsNow: NeedLevels = { subsistence: 10_000, shelter: 10_000, security: 10_000, social: 10_000, status: 10_000, belonging: 10_000, meaning: 10_000 }; // as last judged
    let nextShop = ctx.rng("shop-day").below(p.shop_every_days) * DAY;
    let lastShop: number | null = null; // when the last trip was
    let trip: { at: number; tried: Set<string> } | null = null;
    let nextUse = 0; // when we next use things up (weekly)
    let carried = 0; // budget not spent last trip (less than an item's price), carried to the next
    let deferred = 0; // money we meant to spend on goods and got back (a shop couldn't serve), spent on the next trip
    const borrowing = new Borrowing(me, ctx.params.bank ?? ""); // (no bank named: no borrowing)
    let nextVenture = ctx.rng("venture-day").below(30) * DAY;
    let founded: { firm?: string; capital: number; paid: boolean; own?: { home: string; expect: number } } | null = null;
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
    /** What we hold to say of an act a tie told us of, and to whom (culture, step 4): sent with our next steps. */
    let verdicts: { to: string; text: string }[] = [];
    const readNews = new Set<string>(); // the paper's items already held as events
    const countedBallots = new Set<string>(); // declared results counted once into the culture's picture
    const complainNoted = new Set<string>(); // homes we have noted not writing about, for the culture's sake
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

    // Support paid to us, by payment, once our claim is granted (the decision says how much, how often), and whether it's
    // a stopgap while out of work or income that lasts (a pension, a household's payment).
    const benefits = new Map<string, { claim: string; payment: string; payer: string; amount: number; every: number; lasting: boolean }>();
    const claiming = new Set<string>(); // claims we've made and not yet heard back on, by payment
    const refusedAt = new Map<string, number>(); // a kind of claim refused, at the age we were: not made again until we're older
    const refusedOn = new Map<string, number>(); // and when
    const ranOut = new Set<string>(); // payments whose time ran out, since we last worked
    let worked = false; // we have held a job here (what a record of contributions is made of)
    // The age at which we stop work (null: we never do): our own, or drawn from the world's curve, or the world's one age.
    const stopAge: number | null = p.stops_work_at === "never" ? null : p.stops_work_at ?? (p.stop_work_curve ? stopsWorkAt(p.stop_work_curve, ctx.rng("stops-work").below(10_000)) ?? null : p.retirement_age);
    let retired = false; // we have stopped work
    const hoursAsked: { notice: string; agreement: string; wage: number; from: number; consentBps: number; hours: number }[] = []; // cuts our employer asks our agreement to (docs/behaviour/firms.md, "Hours before heads")
    const inflows: { t: number; amount: number }[] = []; // money that came in (refunds counted negative), for what our income is
    // (Work by the day is paid for the days worked: the working days of a month, not every day of it.)
    // What our own business has paid us (our drawings), for what it brings in a month: over the days our income is
    // reckoned on; before that many days have passed, what it was expected to.
    const drawings: { t: number; amount: number }[] = [];
    const drawnLog: { t: number; amount: number }[] = []; // what our own business paid us, kept as long as we judge it by
    let ownWork = p.own_work;
    // A business of one we mean to start once our job has ended (we gave notice to); and when ours began, if in this run.
    let venturing: { at: number } | null = null;
    let ownSince = p.own_work ? 0 : -1;
    let nextOwnVenture = ctx.rng("own-venture-day").below(30) * DAY;
    let nextOwnReview = MONTH + ctx.rng("own-review-day").below(30) * DAY;
    let tradingFrom: string | null = ownWork?.home ?? null; // where our business, worked from home, has been told it trades
    const ownIncome = (t: number) => (!ownWork ? 0 : t < p.income_window_days * DAY ? ownWork.expect_per_month : Math.floor((drawings.reduce((x, d) => x + d.amount, 0) * MONTH) / (p.income_window_days * DAY)));
    const wageIncome = () => ownIncome(book.now) + (!job ? 0 : job.period === DAY ? Math.floor((job.wage * 30 * (p.round?.work_days ?? 5)) / 7) : Math.floor((job.wage * MONTH) / job.period));
    // (Support for being out of work isn't income once we're in work: we stop claiming it. Counting it, a household applied
    // for a home only that income could afford, and then couldn't sign.)
    const supportIncome = (lastingOnly: boolean) => [...benefits.values()].filter((b) => b.lasting || (!lastingOnly && !job)).reduce((x, b) => x + Math.floor((b.amount * MONTH) / b.every), 0);
    const benefitIncome = () => supportIncome(false);
    const monthlyIncome = () => wageIncome() + benefitIncome();
    /** Income that keeps a household in town: work, or support that lasts (support while out of work is a stopgap). */
    const earnedIncome = () => wageIncome() + supportIncome(true);

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
    let payToldAs = "";
    // Deaths in the household: those we've seen (in our own home, someone leaving because they died).
    const mourned = new Set<string>();
    let wasLeaseholder: boolean | null = null;
    let askedForCare = false;
    // A death at home we were told of by a child of the household (nobody grown was there to see it), and, as that
    // child, whose death we have told someone of.
    const toldDead: { person: string; space: string }[] = [];
    // Homes we have wondered about (someone went in and never came out; a neighbour in our building who died and whose
    // home has stood empty): when the silence will have gone on long enough to ask, and those we have asked about.
    const wondered = new Map<string, { space: string; structure: string; at: string; since: number; due: number }>();
    const askedAbout = new Set<string>();
    let nextDoorAsOf = -1;
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
          job = { agreement: r.id, employer, ...jobTerms(r, me, book), since };
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
          outcome({ t: obs.t, domain: "job", option: job.employer, kind: "rise", way: "published", facts: { rise_bps: Number(r.data?.rise_bps ?? 0), wage: job.wage, made_at: r.at } });
          for (const x of inflows) if (x.t >= r.at && (x.amount === job.wage || x.amount === net)) learn("job", job.employer, 10_000, { t: obs.t, kind: "paid", way: "mine", facts: { amount: x.amount, agreed: job.wage, paid_at: x.t } });
          if (p.union && isMember()) {
            // it paid. Grateful to the union, and surer of what it says.
            const payoff = Math.min(10_000, 6_000 + Number(r.data?.rise_bps ?? 0) * 10);
            const before = was("membership", "member");
            mind.learn("membership", "member", payoff);
            const grateful = felt("add", "gratitude", p.union, 5_000, obs.t);
            const belief = strengthened(p.union, 1_000);
            outcome({ t: obs.t, domain: "membership", option: "member", kind: "rise_won", way: "published", facts: { employer: job.employer, rise_bps: Number(r.data?.rise_bps ?? 0) },
              learned: { payoff: Math.round(payoff), ...before, after: now("membership", "member") }, felt: [grateful], belief });
          }
        }
        if (!(r.addressed_to ?? []).includes(me)) continue;
        // Our hours cut, asked or restored, by our employer's paper (docs/behaviour/firms.md, "Hours before heads"): a
        // cut we are told of, or have agreed to, is the pay agreed from the day it names, and not pay come short.
        if ((r.kind === "hours_notice" || r.kind === "hours_restored") && r.data?.employer === job.employer && r.data?.agreement === job.agreement && Number.isFinite(Number(r.data?.wage)) && Number.isFinite(Number(r.data?.from))) {
          if (r.kind === "hours_notice" && r.data?.consent === true) hoursAsked.push({ notice: r.id, agreement: job.agreement, wage: Number(r.data.wage), from: Number(r.data.from), consentBps: Number.isFinite(Number(r.data?.consent_bps)) ? Number(r.data.consent_bps) : 10_000, hours: Math.round((Number(r.data?.minutes_week) || 0) / 6) / 10 });
          else {
            job.coming = { at: Number(r.data.from), wage: Number(r.data.wage) };
            outcome({ t: obs.t, domain: "job", option: job.employer, kind: r.kind === "hours_notice" ? "hours_cut" : "hours_restored", way: "published", facts: { minutes_week: Number(r.data?.minutes_week) || 0, wage: Number(r.data.wage), was: job.wage, from: Number(r.data.from), made_at: r.at } });
          }
        }
        if (r.kind === "stop_work" && r.data?.employer === job.employer && !striking) {
          striking = { employer: job.employer, out: false };
          if (isMember()) learn("membership", "member", 3_000, { t: obs.t, kind: "stoppage_called", way: "mine", facts: { employer: job.employer } }); // pay lost for the time out
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
      if (pendingGroup && begun) {
        const id = obs.outcomes.flatMap((o) => (o.created?.founded ? [o.created.founded] : []))[0];
        if (id) {
          pendingGroup = false;
          myGroup = { org: id, shape: begun.shape, about: begun.want.about };
          const piece = begun.piece;
          inner.tried(true, 2);
          inner.remember({ t: obs.t, what: "founded", about: id, size: 5_000 });
          outcome({ t: obs.t, domain: "found", option: begun.shape, kind: "founded", way: "mine", facts: { org: id, idea: begun.brief.idea, about: begun.want.about, ...(begun.want.whom ? { whom: begun.want.whom } : {}), sharers: begun.sharers.length,
            name_by: begun.nameBy ?? "code", composer: piece ? (piece.declined ? "declined" : piece.model) : "none", dark: begun.brief.dark.length }, brief: begun.brief });
          begun = null;
        } else if (obs.outcomes.some((o) => o.status === "refused")) {
          outcome({ t: obs.t, domain: "found", option: begun.shape, kind: "refused", way: "mine", facts: { why: String(obs.outcomes.find((o) => o.status === "refused")?.refusal?.code ?? "") } });
          begun = null;
          pendingGroup = false;
        }
      }
      if (pendingFirm && founded) {
        const id = obs.outcomes.flatMap((o) => (o.created?.firm ? [o.created.firm] : []))[0];
        if (id) {
          founded.firm = id;
          pendingFirm = false;
          outcome({ t: obs.t, domain: "venture", option: "found", kind: "founded", way: "mine", facts: { firm: id, capital: founded.capital } });
        } else if (obs.outcomes.some((o) => o.status === "refused")) {
          outcome({ t: obs.t, domain: "venture", option: "found", kind: "refused", way: "mine", facts: { why: String(obs.outcomes.find((o) => o.status === "refused")?.refusal?.code ?? "") } });
          founded = null;
          pendingFirm = false;
        }
      }
      // A change of our hours the employer's paper named: from its day, the pay agreed is the paper's (for a few days after, the
      // old pay is still taken as pay too, as the employer changes the order on a day of its own).
      if (job?.coming && obs.t >= job.coming.at) {
        job.prev = { wage: job.wage, until: job.coming.at + 3 * DAY };
        job.wage = job.coming.wage;
        job.coming = undefined;
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
        if (ownWork && tx.from === ownWork.account) {
          drawings.push({ t: tx.t, amount: cents(tx.amount) });
          drawnLog.push({ t: tx.t, amount: cents(tx.amount) });
          // (For the record: what our own business paid us. The mind makes nothing of it; it follows no decision.)
          outcome({ t: obs.t, domain: "own_work", option: ownWork.firm, kind: "drawn", way: "mine", facts: { amount: cents(tx.amount), paid_at: tx.t } });
        }
        // Our wages, as agreed: the wage, less the income tax the law says our employer withholds.
        // (A day's pay for work by the day: less what the law takes from a day's pay, reckoned over the working week.)
        const asAgreed = (w: number) => cents(tx.amount) === w || cents(tx.amount) === w - withholding(incomeTaxLaw(book), w, job!.period === DAY ? dayPayPeriod(p.round?.work_days ?? 5) : job!.period);
        if (job && (asAgreed(job.wage) || (job.prev && tx.t < job.prev.until && asAgreed(job.prev.wage)))) {
          const since = tx.t - (job.paidAt ?? job.since);
          job.paidAt = tx.t;
          job.paidFrom = tx.from;
          // an employer that pays, as agreed
          learn("job", job.employer, 10_000, { t: obs.t, kind: "paid", way: "mine", facts: { amount: cents(tx.amount), agreed: job.wage, paid_at: tx.t, days_since_last: Math.floor(since / DAY), period_days: Math.round(job.period / DAY) } });
        } else if (job && fdial > 0 && job.period > DAY) {
          // Pay that comes short of what was agreed (docs/behaviour/frictions.md): from our employer's account, less
          // than the wage after what the law withholds, and not so little that it is something else. It is pay, and
          // it is short: the difference is owed us.
          const from = job.paidFrom ?? (commitmentOf(book.records.get(job.agreement), job.employer).outcome as any)?.money?.from;
          const net = job.wage - withholding(incomeTaxLaw(book), job.wage, job.period);
          // (Only what a standing wage order pays: a part pay at the return from a stoppage, or any other single
          // payment from our employer, is not our wage come short.)
          // (And only what was paid as wages: the bank's statement says what the payer said a payment was for. A refund
          // from the shop we work at, or a dividend from the works we hold a share of, is not our pay come short. Until
          // 2026-10-11 the bank narrated nothing, and about three in five "short pays" in a year were those. A payment
          // that says nothing of what it is for is judged by its size, as before.)
          const asWages = !tx.memo || /wage|salar|\bpay\b|day's work/i.test(tx.memo);
          if (from && tx.from === from && tx.per_instruction && asWages && cents(tx.amount) < net && cents(tx.amount) * 2 >= net) {
            job.paidAt = tx.t;
            job.short = (job.short ?? 0) + net - cents(tx.amount);
            learn("job", job.employer, 6_000, { t: obs.t, kind: "short", way: "mine", facts: { amount: cents(tx.amount), agreed: net, short: net - cents(tx.amount), paid_at: tx.t } });
          }
        }
      }
      while (inflows.length && inflows[0]!.t < obs.t - p.income_window_days * DAY) inflows.shift();
      while (drawings.length && drawings[0]!.t < obs.t - p.income_window_days * DAY) drawings.shift();
      const ads = p.adverts ? obs.channels[p.adverts] : undefined;
      if (ads?.kind === "records" && ads.search) for (const r of ads.records) if (r.speaks_for) lookedUp.add(r.speaks_for);
      const sale = p.sale_board ? obs.channels[p.sale_board] : undefined;
      // (Only the answer to a look we just made: the channel goes on holding its last answer.)
      if (saleAsked && sale?.kind === "records" && sale.search) {
        onSale = sale.records as StatementRecord[];
        saleSeenAt = obs.t;
      }
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
        if (from && what?.kind === "trouble") {
          if (initiative) troubles.push({ what: what.what, by: what.by });
          continue;
        }
        if (from && what) {
          heard.push({ from, what });
          continue;
        }
        const person = m.from_entity ?? book.participantPerson.get(m.from) ?? m.from; // who wrote (the directory names their person)
        // Someone we know says who did wrong by them: we think the less of whoever it was, a little (word of mouth).
        const wronged = WRONGED.heard(m.text);
        if (wronged) {
          inner.experience(wronged.by, kindOf(wronged.by), false, obs.t, { weight: 0.3, heard: true });
          if (F) heardWronged.set(person, { ...wronged, t: obs.t });
          outcome({ t: obs.t, domain: "friction", option: wronged.matter, kind: "told", way: "mine", from: person, facts: { by: wronged.by } }, false);
          continue;
        }
        // A child of ours come of age asks what matters to us; or a parent of ours answers.
        if (m.text === UPBRINGING_WORDS.ask) {
          askedWhatMatters.push(m.from);
          continue;
        }
        const matters = UPBRINGING_WORDS.heard(m.text);
        if (matters) {
          if (upbringing.askedAt !== null && !upbringing.settled) upbringing.told.push(matters);
          continue;
        }
        // (Culture: a parent tells a child who asked how they see things here, and where they come from; or someone tells us what they say of what we did.)
        if (cul) {
          const seen = CULTURE_WORDS.householdHeard(m.text);
          if (seen.length) {
            if (upbringing.askedAt !== null && !upbringing.settled) upbringing.culture.push({ pictures: seen, ...(CULTURE_WORDS.fromHeard(m.text) ? { group: CULTURE_WORDS.fromHeard(m.text)! } : {}) });
            continue;
          }
          const verdict = CULTURE_WORDS.verdictHeard(m.text);
          if (verdict) {
            const dent = cul.judged(verdict.conduct, verdict.did, verdict.approval, ties.affinity(person, obs.t) >= cul.p.close_affinity_bps ? "close_tie" : "tie");
            if (dent) { inner.disapproved(dent, obs.t, person); ties.add(person, -Math.round(dent / 2), obs.t, "disapproved"); }
            else ties.add(person, cul.warmth, obs.t, "esteemed");
            continue;
          }
        }
        // Someone we know tells us that one of theirs has died: felt by how close the one who died was to us; and
        // they are no longer anyone we can turn to.
        const gone = MOURNING.heard(m.text);
        if (gone) {
          const close = ties.affinity(gone, obs.t);
          if (close > 0) { inner.happened("bereaved", obs.t, { about: gone, closeness: close / 10_000 }); wantBorn(obs.t, "loss", ["attend"], close / 10_000, "meaning", { whom: gone }); }
          else inner.remember({ t: obs.t, what: "death_told", about: gone, size: 1_000 });
          if (F) mourners.set(gone, new Set([...(mourners.get(gone) ?? []), person]));
          ties.drop(gone);
          contacts.delete(gone);
          toldUs.delete(gone);
          ties.add(person, 500, obs.t, "mourned"); peopleWeKnow.add(person);
          continue;
        }
        if (m.text === CATCHING_UP.ask) {
          askedHow.push(m.from);
          talked.set(person, obs.t);
          ties.add(person, 300, obs.t, "talked"); peopleWeKnow.add(person);
          continue;
        }
        if (cul) { hearCulture(m.text, person, obs.t, m.from); hearTown(m.text, obs.t, person); }
        const told = heardNews(m.text);
        if (told) {
          // What they do, and how it goes for them: counted as others doing it, and learned from as others' payoffs.
          toldUs.set(person, { ...told, t: obs.t });
          talked.set(person, obs.t);
          ties.add(person, 300, obs.t, "talked"); peopleWeKnow.add(person);
          ties.trusted(person, true, 200); // (they answered: a little surer of them)
          // What was done to someone we know, by someone we deal with too: it counts against them, as hearsay.
          if (told.letGoBy && (inner.trusted(told.letGoBy) !== undefined || job?.employer === told.letGoBy)) inner.experience(told.letGoBy, kindOf(told.letGoBy), false, obs.t, { heard: true });
          if (told.noticedBy && (inner.trusted(told.noticedBy) !== undefined || home?.landlord === told.noticedBy)) inner.experience(told.noticedBy, kindOf(told.noticedBy), false, obs.t, { heard: true });
          if (told.shop && told.served !== undefined) hearOf("shop", told.shop, told.served, { t: obs.t, kind: "told", way: "mine", from: person, facts: { served_bps: told.served } });
          if (told.employer && told.paid !== undefined) hearOf("job", told.employer, told.paid ? 10_000 : 0, { t: obs.t, kind: "told", way: "mine", from: person, facts: { paid: told.paid } });
          // Someone who keeps going somewhere finds it worth it (a placeholder for how much).
          // (All the more, if we hold with what it teaches.)
          for (const host of told.goesTo ?? []) for (const g of book.practices()) if ((g.speaks_for ?? g.author) === host) hearOf("practice", g.id, Math.min(10_000, 7_000 + Math.round(holdTo(host) * p.belief.meaning)), { t: obs.t, kind: "told", way: "mine", from: person, facts: { goes: true, host } });
          // Told what someone holds: if we hold it too, surer of it, the more so the more conformist we are. (Words alone
          // don't bring someone to a belief they don't hold; taking part, among those who keep to it, does: Henrich 2009.)
          for (const host of told.holdsTo ?? []) if (holdTo(host) > 0) outcome({ t: obs.t, domain: "belief", option: host, kind: "told", way: "mine", from: person, belief: strengthened(host, Math.round((p.belief.told_bps * (5_000 + mind.person.temperament.conformity)) / 10_000)) }, false);
          continue;
        }
        const want = (Object.keys(ASKING) as Want[]).find((w) => ASKING[w] === m.text);
        // A letter from an office, in words of its own (docs/behaviour/letters.md, "A letter to a person"): read and
        // kept, and on our record that the office wrote, about what paper if it says. We cannot tell what it asks,
        // and do not pretend to: nothing is done on it and nothing is answered. (What an office wants a person to
        // act on, it sends on its own papers: a request for rent owed, an offer of a plan, a notice of hearing.)
        const office = m.as ? (m.from_entity ?? book.positions.get(m.as)?.entity) : undefined;
        if (!want && office && office !== me && !officeNote(m.text) && !(m.re && (askedAt.home !== undefined || askedAt.work !== undefined) && !book.records.has(m.re))) {
          inner.note({ t: obs.t, what: "office_wrote", about: office, size: Math.min(10_000, m.text.length) });
          outcome({ t: obs.t, domain: "letter", option: office, kind: "received", way: "mine", from: office, facts: { characters: m.text.length, ...(m.re ? { about: m.re } : {}) } }, false);
          continue;
        }
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
        if (home && !home.owned) outcome({ t: obs.t, domain: "home", option: home.space, kind: home.movedIn ? "moved_in" : "not_in_yet", way: "mine", ...(home.movedIn ? {} : { facts: { why: String(obs.outcomes.at(-1)!.refusal?.code ?? "") } }) });
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
    /** How long a silence in a home goes before anybody remarks on it: a band by its share, then any moment in it. The
     * draw is the home's, not ours (whoever lives beside it would wait as long): `chance`. */
    const remarkedAfter = (key: string): number => {
      const bands = p.welfare?.found_after ?? [];
      const total = bands.reduce((n, b) => n + b.bps, 0);
      if (total <= 0) return 0;
      const rng = (ctx.chance ?? ctx.rng)(`unremarked-${key}`);
      let x = rng.below(total);
      let from = 0;
      for (const b of bands) {
        if (x < b.bps) return from * DAY + rng.below(Math.max(1, (b.within_days - from) * DAY));
        x -= b.bps;
        from = b.within_days;
      }
      return from * DAY;
    };
    // The homes beside us (docs/behaviour/deaths.md, "Nobody else at home"). From outside a home shows how many are in
    // it and when anyone was last seen going in or coming out, never who. One that someone went into after anyone last
    // left, with nobody in it now, holds someone who has not come out. In our own building we know our neighbours by
    // name, and see that one has died and their home stood empty since. Either way, when the silence has gone on as
    // long as such a silence goes unremarked, an adult asks the police to call (once for each).
    const wonderNextDoor = (obs: Observation): Step | undefined => {
      const w = p.welfare;
      if (!w || !obs.body || obs.t - obs.body.born_at < ADULT_YEARS * year) return undefined;
      const t = obs.t;
      const ourHome = home?.space ?? livingAt;
      const wonder = (key: string, space: string, structure: string, at: string, since: number) => {
        // (Never before nobody has been in or out for a day: where people share a home one of them comes or goes within
        // a day, and it is theirs to say who has died.)
        if (!wondered.has(key) && !askedAbout.has(key)) wondered.set(key, { space, structure, at, since, due: since + Math.max(DAY, remarkedAfter(key)) });
      };
      const next = obs.channels[w.channel];
      if (next?.kind === "sites" && next.as_of !== nextDoorAsOf) {
        nextDoorAsOf = next.as_of;
        const still = new Set<string>();
        for (const c of next.cells) for (const sp of c.structure?.spaces ?? []) {
          if (sp.kind !== "dwelling" || sp.occupants !== undefined || sp.count > 0 || sp.seen_entering === undefined || sp.seen_entering <= (sp.seen_leaving ?? -1)) continue;
          const key = `${sp.space}@${sp.seen_entering}`;
          still.add(key);
          wonder(key, sp.space, c.structure!.structure, c.structure!.at, sp.seen_entering);
        }
        // (Someone has come out of it, or gone in, since: nothing to wonder at. One we know by name is kept.)
        for (const key of [...wondered.keys()]) if (!key.startsWith("died:") && !still.has(key)) wondered.delete(key);
      }
      const street = obs.channels.street;
      if (street?.kind === "sites") for (const c of street.cells) for (const sp of c.structure?.spaces ?? []) {
        if (sp.kind !== "dwelling" || sp.space === ourHome || sp.occupants === undefined || !stoodEmpty(sp, t)) continue;
        for (const l of sp.left ?? []) if (l.reason === "died" && !household?.members.some((m) => m.person === l.occupant)) wonder(`died:${l.occupant}`, sp.space, c.structure!.structure, c.structure!.at, l.at);
      }
      // (One at a time: it is written at once, apart from the week's plan; another that is due is written at the next wake.)
      for (const [key, x] of [...wondered].sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (t < x.due) continue;
        wondered.delete(key);
        askedAbout.add(key);
        return because(`Nobody has been seen at ${x.space} for ${Math.max(1, Math.round((t - x.since) / DAY))} days, and whoever went in has not come out: asking the police to call there.`,
          say("welfare_check_request", `Nobody has been seen at ${x.space} for some days. Please call there.`, { to: [w.police], data: { space: x.space, structure: x.structure, at: x.at, since: x.since } }));
      }
      return undefined;
    };

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
      // Someone who died in the home we live in and is not of our household (a home let again over our heads, a
      // lodger): an adult living there says so to the registry, as whoever is present at a death may. We can't say who
      // their family is, so the report names none (docs/behaviour/deaths.md).
      if (ourHome && street?.kind === "sites" && p.registry && obs.body && t - obs.body.born_at >= ADULT_YEARS * year) {
        const here = street.cells.flatMap((c) => c.structure?.spaces ?? []).filter((sp) => sp.space === ourHome);
        if (here.some((sp) => (sp.occupants ?? []).includes(me))) for (const l of here.flatMap((sp) => sp.left ?? [])) {
          if (l.reason !== "died" || mourned.has(l.occupant) || household?.members.some((m) => m.person === l.occupant)) continue;
          mourned.add(l.occupant);
          steps.push(because(`${l.occupant}, who lived where we live and is not of our household, has died here: reporting it to the registry.`,
            say("death_notification", `${l.occupant} has died at ${ourHome}.`, { to: [p.registry], data: { deceased: l.occupant, found_at: ourHome } })));
        }
      }
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
          // A death in the household: ours (docs/design/ai-citizens.md 10c). And told to those we are closest to, who
          // may have known them: how a bereavement becomes a circle's.
          inner.happened("bereaved", t, { about: dead.person });
          wantBorn(t, "loss", ["attend"], 1, "meaning", { whom: dead.person });
          ties.drop(dead.person);
          contacts.delete(dead.person);
          {
            const close = ties.closest(5, t).map((x) => x.who).filter((w) => !hh.members.some((m) => m.person === w));
            if (close.length) steps.push(because(`${dead.person}, of our household, has died: telling those we are closest to.`, message(close, MOURNING.tell(dead.person))));
            if (F) mourners.set(dead.person, new Set([...(mourners.get(dead.person) ?? []), ...close, ...hh.members.filter((m) => m.person !== me && m.person !== dead.person && ageAt(m, t, year) >= ADULT_YEARS).map((m) => m.person)]));
          }
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
      // Culture (step 4): someone made in the run, born here or come from elsewhere, holds the picture they have lightly (a newcomer sees the local
      // one soon outweigh it); a newcomer with no parents here is of a group drawn from the profile's shares, as the people of the town were.
      if (cul && plannedAt === -1 && !p.own_values) {
        cul.arrive(obs.t);
        const shares = cdial!.shares, total = shares.reduce((x, g) => x + g.share_bps, 0);
        if (!cul.group && shares.length && total > 0 && !(obs.body?.parents ?? []).length) {
          let r = ctx.rng("culture-origin").below(total);
          cul.setGroup((shares.find((g) => (r -= g.share_bps) < 0) ?? shares.at(-1)!).id);
        }
      }
      if (!home) findOwnHome(obs);
      // How long we had lived, worked and belonged here when the world began (the world's figures, from its profile).
      if (plannedAt === -1 && p.started) {
        if (p.started.place_days) inner.startAttached("place", "town", p.started.place_days, obs.t);
        const trade = job ? industryOf.get(job.employer) ?? job.employer : ownWork ? ownWork.firm : undefined;
        if (p.started.trade_days && trade) inner.startAttached("trade", trade, p.started.trade_days, obs.t);
        const group = p.started.group_days ? book.ofType("agreement").flatMap((a) => (a.record === "agreement" && a.terms.template === "membership" && a.terms.parties.includes(me) && book.inForce(a.id) && a.terms.commitments.some((c: any) => c.who === me && c.does?.outcome?.attend) ? [a.terms.parties.find((x) => x !== me)!] : [])).sort()[0] : undefined;
        if (group) inner.startAttached("group", group, p.started.group_days!, obs.t);
      }
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
            gaveUp.delete(what.space);
          } else if (what.kind === "moveOut" && livingAt && structureOf(livingAt) === what.from) {
            if (inside(livingAt)) steps.push(because("The household's tenancy has ended: moving out with them.", moveOut(what.from, me)));
            gaveUp.add(livingAt);
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
        // (Said once, until it changes: what is told is the sum as it is said, so an income that moves by less than
        // can be said, or is not a number at all, is not told again. A household in the first living pilot was
        // sent "My pay is now 0.00" 478 times in 60 days.)
        if (lh && SAYING.pay(Math.round(monthlyIncome()) || 0) !== payToldAs) {
          payToldAs = SAYING.pay(Math.round(monthlyIncome()) || 0);
          payTold = Math.round(monthlyIncome()) || 0;
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
          // (And registered, as a birth must be: docs/behaviour/institutions.md.)
          if (p.registry) steps.push(because("Our baby is born: registering the birth.", say("birth_notification", `A child was born to ${me}.`, { to: [p.registry], data: { child: k.person, born_at: k.born_at, mother: me } })));
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
          if (rate > 0 && ctx.rng(`conceive`).below(120_000) < rate) {
            expectingUntil = t + p.gestation + MONTH;
            if (together) inner.happened("child", t);
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
      // A tenancy that has ended: move out and stop paying rent. (Told to leave for arrears: at the date we were
      // given, if we mean to go; one who means to stay is there until the tribunal's date, or until put out.)
      const put = home?.vacate;
      if (home && (put ? (!put.stays && t >= put.by) || (!put.stays && t >= endsAt(home)) : t >= endsAt(home))) {
        if (put) {
          outcome({ t, domain: "home", option: home.space, kind: "evicted", way: "mine", from: home.landlord, facts: { how: put.removed ? "removed" : put.ordered ? "left_on_order" : "left_on_notice" } });
          // (What it is called on the record: put out on a warrant, or given notice and gone, is "evicted"; gone on the
          // tribunal's order with no warrant carried out is its own kind, which dents and shocks as "evicted" does.)
          inner.happened(put.ordered && !put.removed ? "left_on_order" : "evicted", t, { about: home.landlord });
          // (Ours to end on the record too, if nobody has: we are gone.)
          if (endsAt(home) === Number.MAX_SAFE_INTEGER || t < endsAt(home)) if (!(book.notices.get(home.agreement) ?? []).some((n) => n.as === me)) steps.push(because(put.removed ? "We have been put out of our home on the tribunal's warrant." : put.ordered ? "The tribunal has ordered us out of our home, and its date has come: leaving." : "We cannot pay what is owed and have been given notice to vacate: leaving.", notice(home.agreement, "Leaving: told to vacate for arrears.")));
        }
        // Looking for somewhere cheaper (a goal's method): for the first month of the hunt, only homes that beat this rent.
        if (pursuing("cheaper home")) cheaperThan = { rent: Math.floor((home.rent * p.goals.cheaper_bps) / 10_000), until: t + MONTH };
        if (!home.owned) outcome({ t, domain: "home", option: home.space, kind: "ended", way: "mine", facts: { by: endedBy(home.agreement), rent: home.rent, ...(book.signedAt(home.agreement) !== undefined ? { held_days: Math.floor((t - book.signedAt(home.agreement)!) / DAY) } : {}) } });
        const s: Step = because(`Our tenancy of ${home.space} has ended: moving out and stopping the rent${cheaperThan ? `; we'll look for somewhere cheaper, under ${usd(cheaperThan.rent)} a month` : ""}.`, ...(home.movedIn ? [moveOut(home.structure, me)] : []));
        if (home.order) s.push(withdraw(home.order, "Tenancy ended; stop this standing order."));
        for (const x of home.retiring ?? []) s.push(withdraw(x.order, "Tenancy ended; stop this standing order."));
        home.retiring = [];
        if (s.length) steps.push(s);
        // The children come out with us (each on its own, in case one isn't there); the other adults are told.
        // (And told, as the other adults are: a child goes home by itself after school, and the home it knows is this one.)
        if (home.movedIn) for (const k of children(t)) steps.push(because("Our tenancy has ended: taking the children out with us.", moveOut(home.structure, k.person), message([reach(k)], SAYING.moveOut(home.structure))));
        for (const a of adults(t)) steps.push(because("Our tenancy has ended: telling the household, and that there's no rent to share for now.", message([reach(a)], SAYING.moveOut(home.structure)), message([reach(a)], SAYING.share(0, acc.account)))), sharesTold.set(a.person, 0);
        toldMoveIn = null;
        gaveUp.add(home.space);
        if (put && !home.owned) leftHome = { agreement: home.agreement, landlord: home.landlord, space: home.space, at: t };
        home = null;
        homelessSince = t;
      }
      // Our own business, worked from our home: when we live somewhere else (or nowhere), we tell it, and it trades
      // from there (its stock goes with us). Where our new home stands we know from having been there.
      if (ownWork && !ownWork.at) {
        const dwelling = home?.movedIn ? home.space : livingAt ?? null;
        const where = dwelling ? channels.cells(obs).find((c) => c.structure?.structure === structureOf(dwelling))?.cell : undefined;
        if (dwelling !== tradingFrom && (dwelling === null || where)) {
          tradingFrom = dwelling;
          steps.push(because(dwelling ? `We live at ${dwelling} now: our business trades from there.` : "We have no home to trade from: our business stops trading until we do.",
            say("trading_from", dwelling ? `Trading from ${dwelling} now.` : "Not trading: nowhere to trade from.", { to: [ownWork.firm], visible: [me, ownWork.firm], data: dwelling ? { space: dwelling, structure: structureOf(dwelling), cell: where } : { nowhere: true } })));
        }
      }
      // Wages not paid: a pay period (and a few days' grace) without them, we resign, and claim what we're owed, as an
      // employee can (docs/behaviour/citizen.md). The claim is a debt recorded against the employer.
      if (job && !job.claimed && t < jobEnds(job) && !striking) {
        const last = job.paidAt ?? job.since;
        if (t - last > job.period + 5 * DAY && job.period === DAY) {
          // Work by the day that has brought no pay for most of a week: there is no work there for us. Nothing is owed
          // for a day not worked, so there is nothing to claim; we end it, as its terms let either side, and look elsewhere.
          job.claimed = true;
          outcome({ t, domain: "job", option: job.employer, kind: "no_work", way: "mine", facts: { days_since_last: Math.floor((t - last) / DAY), period_days: 1 } });
          steps.push(because(`No pay from our work by the day for ${Math.floor((t - last) / DAY)} days: there is no work for us there. Ending it.`, notice(job.agreement, "No work by the day for us here.")));
          job.leftAt = t;
        } else if (t - last > job.period + 5 * DAY) {
          job.claimed = true;
          const missed = Math.max(1, Math.floor((t - last) / job.period));
          // an employer that didn't pay: remembered
          const before = was("job", job.employer);
          mind.learn("job", job.employer, 0);
          outcome({ t, domain: "job", option: job.employer, kind: "unpaid", way: "mine", facts: { days_since_last: Math.floor((t - last) / DAY), period_days: Math.round(job.period / DAY), periods_missed: missed, owed: missed * job.wage },
            learned: { payoff: 0, ...before, after: now("job", job.employer) }, felt: [felt("feel", "anger", job.employer, 8_000, t)] });
          steps.push(because(`Our wages haven't been paid for ${Math.floor((t - last) / DAY)} days: resigning, and claiming the ${usd(missed * job.wage)} we're owed.`,
            notice(job.agreement, "Resigning: our wages haven't been paid."),
            record("right", me, { kind: "debt", amount: missed * job.wage, for: `Unpaid wages (${missed} pay period${missed > 1 ? "s" : ""}).` }, { against: job.employer, basis: job.agreement })));
          job.leftAt = t;
        }
      }
      // A job that has ended.
      if (job && t >= jobEnds(job)) {
        if (job.workplace && inside(job.workplace)) steps.push(because("Our job has ended: leaving the workplace.", moveOut(job.workplace, me)));
        outcome({ t, domain: "job", option: job.employer, kind: "ended", way: "mine", facts: { by: job.leftAt !== undefined ? "self" : endedBy(job.agreement), held_days: Math.floor((t - job.since) / DAY), ...(job.claimed ? { unpaid: true } : {}) } });
        lastEmployer = job?.employer ?? lastEmployer;
        job = null;
        joblessSince = t;
      }
      // Our notice worked out: starting the job we're moving to (signing the offer we took, and going to work there).
      if (!job && switching) {
        const r = book.records.get(switching.offer);
        switching = null;
        if (r?.record === "agreement" && !book.signedBy(r.id, me) && !retired) {
          const terms = jobTerms(r, me, book);
          const s: Step = because(`Our notice is worked out: starting the job we took (${usd(terms.wage)} every ${Math.round(terms.period / DAY)} days).`, sign(r.id));
          if (terms.workplace && !p.round) s.push(moveIn(terms.workplace)); // (with the round, we go when work starts)
          steps.push(s);
          job = { agreement: r.id, employer: r.terms.parties.find((x) => x !== me)!, ...terms, since: t };
          joblessSince = null;
          outcome({ t, domain: "job", option: job.employer, kind: "hired", way: "mine", facts: { wage: terms.wage, period_days: Math.round(terms.period / DAY), after_notice: true } });
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
          // Belonging: being part of something (a household, a group one takes part in, a few close ties, a place),
          // less what a loss has taken. Meaning: what one holds to, work that is one's own, children to raise, taking
          // part; less the same. Placeholders for how each is read from a life, as the five above are, with their
          // floors set so that in an ordinary life the two are about as well met as the other five (in a town of 300
          // over 90 days the five averaged 7,080 and these 7,350 and 7,100): adding them does not of itself make a
          // town less satisfied; what happens to people does.
          belonging: Math.max(0, Math.min(10_000, 3_200 + (household && household.members.length > 1 ? 3_000 : 0) + 1_000 * Math.min(3, ties.closest(5, t).filter((x) => x.affinity >= 1_000).length)
            + Math.round(inner.attachedTo("group") / 5) + Math.round(inner.attachedTo("place") / 10) - inner.dent("belonging", t))),
          meaning: Math.max(0, Math.min(10_000, 3_700 + Math.round(Math.max(0, ...beliefs.values()) * 0.3) + (job || ownWork ? 1_500 + Math.round(inner.attachedTo("trade") / 10) : retired ? 1_000 : 0)
            + (children(t).length ? 2_000 : 0) + Math.round(inner.attachedTo("group") / 10) - inner.dent("meaning", t))),
        };
      };
      // Asked by a child of ours what matters to us: said, as it is (at home nobody shades it).
      if (askedWhatMatters.length) {
        const ranked = [...VALUES_OF_MIND].sort((a, b) => mind.person.values[b] - mind.person.values[a] || (a < b ? -1 : 1));
        steps.push(because("Asked by one of ours what matters to us: telling them.", message([...new Set(askedWhatMatters)].sort(), UPBRINGING_WORDS.say(ranked.slice(0, 3), ranked.slice(-3).reverse()))));
        // (And, where the world has culture, how we see things here and where we come from: what a child takes with them.)
        if (cul) steps.push(because("Asked by one of ours how things are here: telling them as we see it.", message([...new Set(askedWhatMatters)].sort(),
          [...(cul.group ? [CULTURE_WORDS.from(cul.group)] : []), ...cul.household().map((x) => CULTURE_WORDS.household(x.conduct, x.does, x.approves))].filter(Boolean).join(" "))));
        askedWhatMatters = [];
      }
      // Come of age without values the world gave us: we ask the parents we live with, once; a fortnight on (or as
      // soon as all have answered) what we were told settles ours: toward each parent's most, away from their least,
      // by the share upbringing counts for, the rest our own.
      if (!upbringing.settled) {
        const parents = (household?.members ?? []).filter((m) => m.person !== me && (obs.body?.parents ?? []).includes(m.person) && ageAt(m, t, year) >= ADULT_YEARS);
        if (upbringing.askedAt === null) {
          if (!parents.length) upbringing.settled = true;
          else {
            upbringing.askedAt = t;
            steps.push(because("Come of age: asking our parents what matters to them.", message(parents.map(reach).sort(), UPBRINGING_WORDS.ask)));
          }
        } else if (upbringing.told.length >= parents.length || t - upbringing.askedAt >= 14 * DAY) {
          upbringing.settled = true;
          if (upbringing.told.length) {
            const a = UPBRINGING.share_bps / 10_000;
            for (const v of VALUES_OF_MIND) {
              const d = p.values.values[v] ?? { mean_bps: 5_000, sd_bps: 1_500 };
              const lean = upbringing.told.reduce((x, said) => x + (said.most.includes(v) ? 1 : said.least.includes(v) ? -1 : 0), 0) / upbringing.told.length;
              mind.person.values[v] = Math.max(0, Math.min(10_000, Math.round(d.mean_bps + a * lean * d.sd_bps + Math.sqrt(1 - (a * a * 0.6) / upbringing.told.length) * (mind.person.values[v] - d.mean_bps))));
            }
            mind.reweigh();
            inner.remember({ t, what: "came_of_age", size: 5_000 });
          }
          // (Culture: from the household, the picture of what is done and approved, and where they come from. Parents of two groups: either, equally.)
          if (cul && upbringing.culture.length) {
            const groups = upbringing.culture.flatMap((c) => (c.group ? [c.group] : []));
            const group = cul.group ?? (groups.length ? groups[groups.length > 1 ? ctx.rng("culture-parent-group").below(groups.length) : 0] : undefined);
            const taken = cul.adoptHousehold(upbringing.culture.map((c) => c.pictures), t);
            if (group) cul.setGroup(group, taken);
          }
        }
      }
      // Attachments grow with time (docs/design/ai-citizens.md 10c): to the place lived in, the trade worked at, the
      // group taken part in; and what was lost fades. Trust and agency drift back toward the person's own.
      inner.attach("place", home || livingAt ? "town" : undefined, t);
      inner.attach("trade", job ? industryOf.get(job.employer) ?? job.employer : ownWork ? ownWork.firm : undefined, t);
      inner.attach("group", [...wentLast].sort().map((id) => { const r = book.records.get(id); return r?.record === "statement" ? r.speaks_for ?? r.author : undefined; }).find((x) => x) ?? (inner.attached.group && memberOf(inner.attached.group.to) ? inner.attached.group.to : undefined), t);
      inner.settle(t);
      // Values drift, slowly (docs/behaviour/citizen.md "Values move"); what they weigh follows.
      if (inner.drift(ctx.rng, t)) mind.reweigh();
      levelsNow = needLevels();
      // What we think of those who hold power over us, and what we say of them (docs/design/ai-citizens.md 10c): the
      // landlord who houses us and the employer who pays us could each cost us a great deal (a placeholder for how
      // much). What we think follows how far we trust them, less our anger with them.
      for (const who of [home && !home.owned ? home.landlord : undefined, job?.employer]) {
        if (!who) continue;
        if (who === job?.employer) employers.add(who);
        const tr = inner.trustIn(who, kindOf(who), t);
        inner.view(who, 2 * (tr - 5_000) - feelings.level("anger", who, t), { dependence: 8_000, fear: Math.max(feelings.level("fear", who, t), feelings.level("fear", "money", t)), trust: tr });
      }
      // (Those we deal with as a matter of course are known to us from the start: our bank, and our union if we belong.)
      if (p.bank) inner.trustIn(p.bank, "banks", t);
      if (p.union && isMember()) inner.trustIn(p.union, "unions", t);
      // Afraid for our money when it's running short (the security need well below met).
      if (levelsNow.security < 5_000) feelings.feel("fear", "money", (5_000 - levelsNow.security) * 2, t);
      // Goals (HTN, lite): a need long unmet becomes a goal, pursued by one method, then another, in the order our values
      // favour; met when the need recovers, given up (for a while) when nothing's left to try. Each choice is recorded.
      if (!initiative) {
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
            if (pur?.method) outcome({ t, domain: "goal", option: `${goal}: ${pur.method}`, kind: "met", way: "mine", need: w.need, facts: { level: levelsNow[w.need], wanted: w.below, days: Math.floor((t - pur.since) / DAY) } });
            if (pur) pursuits.delete(goal);
            continue;
          }
          if (!unmetSince.has(goal)) unmetSince.set(goal, t);
          const record = (choice: string | undefined, options: [string, boolean, number][]) =>
            decision({ t, domain: "goal", strategy: "deliberate", ...(choice ? { choice: `${goal}: ${choice}` } : {}), options: options.map(([m, , z]) => ({ key: `${goal}: ${m}`, score: Math.round(z * 1_000) })) });
          if (!pur && t - unmetSince.get(goal)! >= G.unmet_days * DAY && t >= (restUntil.get(goal) ?? 0)) {
            const open = w.methods.filter(([, ok]) => ok).sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : 1));
            if (open.length) {
              pursuits.set(goal, new Pursuit(goal, open.map(([m]) => m), t));
              record(open[0]![0], open);
            }
          } else if (pur && t - pur.since >= G.method_days * DAY) {
            if (pur.method) outcome({ t, domain: "goal", option: `${goal}: ${pur.method}`, kind: "not_met", way: "mine", need: w.need, facts: { level: levelsNow[w.need], wanted: w.below, days: Math.floor((t - pur.since) / DAY) } });
            const next = pur.next(t);
            record(next, w.methods.filter(([m]) => pur.methods.includes(m)));
            if (!next) {
              // Nothing left to try for making ends meet: ruin (docs/design/ai-citizens.md 10c).
              if (goal === "make ends meet") inner.happened("ruined", t);
              pursuits.delete(goal);
              restUntil.set(goal, t + G.rest_days * DAY);
            }
          }
        }
      }
      const circumstances = (): Circumstances => ({ monthly_income: householdIncome(), savings: acc.balance, homeless: !home && !livingAt, essentials: p.essentials });
      // ---------------------------------------------------------------- wants and initiative
      // (docs/design/ai-citizens.md 10a, 10b; docs/behaviour/citizen.md "Wants and initiative".) A want names what
      // would satisfy it in the world's typed outcomes; here it is set against what we can see (the boards the
      // world gives us and what such offers bring, the gatherings open to us, the other party to an agreement of
      // ours or the author of a paper, a desk that hears such papers, a petition or an election that bears on
      // someone, our own conduct, those we know), and the mind chooses among what would bring it about, or waits.
      const kindOfWay = (key: string) => (key.startsWith("offer:") ? key : key.split(":")[0]!);
      const zAttached = (which: "place" | "trade") => {
        const mean = which === "place" ? p.attach_mean?.place_bps : p.attach_mean?.trade_bps;
        return mean === undefined ? 0 : Math.max(-3, Math.min(3, (inner.attachedTo(which) - mean) / 3_000)); // (3,000: a PLACEHOLDER spread)
      };
      /** A want met: what was tried for it worked (or waiting did), and it is no longer held. */
      const wantMet = (w: Wanted, why: string) => {
        if (w.way) learn("way", kindOfWay(w.way), w.way === "wait" ? 7_000 : 10_000, { t, kind: "worked", way: "mine", facts: { about: w.about, why } });
        if (w.way && w.way !== "wait") inner.tried(true);
        wants.met(w, t, why);
      };
      type Way = Opening & { adj: number; others: number; /** What taking it up asks in money at once (a fee, a first month's dues), where its terms say. */ cost?: number; act: () => string | undefined };
      const waysFor = (w: Wanted): Way[] => {
        const K = wants.p.choice;
        const heardNow = newsNow(t);
        const after = (kind: string) => heardNow.filter((n) => n.after?.some((a) => a.way === kind)).length;
        const ag = Math.round(K.agency * inner.zAgency());
        const trustOf = (who: string) => Math.round(K.trust * inner.zTrust(who, kindOf(who), t)); // (against the town's figure for its kind: the town's rates stay put)
        const fearOf = (who: string) => Math.round((K.fear * Math.max(feelings.level("fear", who, t), Math.round(feelings.level("fear", "money", t) / 2))) / 10_000);
        // The lean of what we take those around us to do and approve of, in points, on a way that is a conduct (culture: the same lean the conduct's draw takes,
        // bounded as every term is; `way_points` a standard deviation, as trust and agency have).
        const nw = (c: Conduct): number => (cul ? cul.way(c, t) : 0);
        const out: Way[] = [];
        // The job board: what its offers bring (as the postings we last saw there say; none seen: pay for work).
        if (!retired && p.in_labour_force && !ownWork) {
          // (To someone in work a posting brings more money, if it pays more; work they already have.)
          const offered = bringsOf(found.jobs[0]?.offer as any);
          const brings = (offered.length ? offered : (["money.to", "work"] as SeekKey[])).filter((k) => !job || k !== "work");
          out.push({ key: "offer:employment", kind: "offer:employment", brings, bears: job ? [job.employer] : [],
            adj: K.own + ag - (job ? Math.round(K.own * 2 * wants.p.sway.attachment * zAttached("trade")) : 0), others: after("offer:employment"),
            act: () => { searchForced = true; return undefined; } });
        }
        // The homes board: another home (and, housed, one that asks less).
        if (isLeaseholder() && !home?.owned) {
          out.push({ key: "offer:lease", kind: "offer:lease", brings: home ? ["occupancy", "money.from"] : ["occupancy"], bears: home ? [home.landlord] : [],
            adj: K.own + ag - (home ? K.own : 0), others: after("offer:lease"),
            act: () => { if (home) moveHunt = { until: t + 60 * DAY, ...(w.seeks.includes("occupancy") ? {} : { beat: Math.floor((home.rent * p.goals.cheaper_bps) / 10_000) }) }; return undefined; } });
        }
        // Gatherings open to us, by host: company, and what the host teaches if we hold to it.
        const hosts = new Map<string, number>();
        for (const r of book.practices()) {
          const host = r.speaks_for ?? r.author;
          if (!(r.practice!.roles ?? [{ role: "attendee", open: true }]).some((x) => x.open && (!x.who || !x.who.members_of || memberOf(x.who.members_of)))) continue;
          hosts.set(host, Math.round((K.belief * holdTo(host)) / 10_000));
        }
        for (const [host, belief] of [...hosts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3))
          out.push({ key: `practice:${host}`, kind: "practice", by: host, brings: ["attend"], adj: K.own + belief + ag, others: heardNow.filter((n) => n.goesTo?.includes(host)).length, act: () => undefined });
        // The union, whose offer is in words (it "represents" its members): it bears on our employer only as we
        // believe it does, by what it teaches us or by those we work with who belong.
        if (p.union && job && !isMember()) {
          const peers = heardNow.filter((n) => n.employer === job!.employer && n.member).length;
          if (holdTo(p.union) > 0 || peers > 0 || mind.learned("membership").known("member"))
            out.push({ key: `join:${p.union}`, kind: "join", by: p.union, brings: [], bears: [job.employer],
              adj: Math.round((K.belief * holdTo(p.union)) / 10_000) + trustOf(p.union) + ag + nw("join_union"), others: peers, act: () => { joinNow = true; return undefined; } });
        }
        // Whoever made the paper in our way, or is the other party to an agreement of ours: they can vary or undo
        // it, and we can ask (a letter). Less readily the more we fear them and the less we trust them.
        const mayAsk = (agreement: string) => t - (askedParty.get(agreement) ?? -Infinity) >= wants.p.ask_again_days * DAY;
        if (home && !home.owned && isLeaseholder() && w.against?.by === home.landlord && mayAsk(`${home.agreement}:${w.against.record}`)) {
          const lord = home.landlord, lease = home.agreement, space = home.space, was = home.rent, paper = w.against;
          out.push({ key: `ask:${lord}`, kind: "ask", id: paper.record, by: lord, brings: [], undoes: { record: paper.record }, bears: [lord], adj: trustOf(lord) - fearOf(lord) + ag, others: after("ask"),
            act: () => {
              askedParty.set(`${lease}:${paper.record}`, t);
              const rise = paper.kind === "rent_increase";
              steps.push(because(rise ? `Our landlord means to raise the rent: asking them to hold it at ${usd(was)} a month.` : "Our landlord has given us notice: asking to stay on.",
                say("variation_request", rise ? `Request: please hold the rent for ${space} at ${usd(was)} a month.` : `Request: please let us stay on at ${space}.`, { to: [lord], visible: [me, lord], basis: paper.record,
                  data: { agreement: lease, about: paper.record, would: rise ? { who: me, does: { outcome: { money: { amount: String(was) } } }, every: MONTH } : { who: lord, does: { outcome: { occupancy: { who: me, in: space } } } } } })));
              return paper.record;
            } });
        }
        if (job && !job.claimed && w.seeks.includes("money.to") && job.period > DAY && t - job.since >= 180 * DAY && mayAsk(job.agreement)) {
          const boss = job.employer, agreement = job.agreement, wage = Math.floor((job.wage * (10_000 + wants.p.rise_bps)) / 10_000), period = job.period;
          out.push({ key: `ask:${boss}`, kind: "ask", id: agreement, by: boss, brings: ["money.to"], bears: [boss], adj: trustOf(boss) - fearOf(boss) + ag, others: after("ask"),
            act: () => {
              askedParty.set(agreement, t);
              steps.push(because(`Asking our employer for a rise, to ${usd(wage)} every ${Math.round(period / DAY)} days.`,
                say("variation_request", `Request: a rise in my pay, to ${usd(wage)} every ${Math.round(period / DAY)} days.`, { to: [boss], visible: [me, boss], basis: agreement,
                  data: { agreement, about: agreement, would: { who: boss, does: { outcome: { money: { amount: String(wage) } } }, every: period } } })));
              return agreement;
            } });
        }
        // A desk that hears papers of the kind in our way (the world tells us of it, and what it hears): the
        // tribunal, for a notice of rent increase that breaks the law as we read it, or a debt owed us.
        if (p.tribunal) {
          const hears = p.tribunal.hears ?? ["rent_increase", "debt"];
          const desk = p.tribunal.entity;
          const notice = w.against?.kind === "rent_increase" && hears.includes("rent_increase") ? book.records.get(w.against.record) : undefined;
          if (notice?.record === "statement" && notice.speaks_for && !challenged.has(notice.id) && breaches(book, { block: "publish", kind: "rent_increase", data: notice.data }, notice.speaks_for, notice.at).length)
            out.push({ key: `desk:${desk}`, kind: "desk", id: notice.id, by: desk, brings: [], undoes: { record: notice.id }, adj: trustOf(desk) + ag + nw("take_to_tribunal"), others: after("desk"),
              act: () => {
                challenged.add(notice.id);
                steps.push(because("A notice of rent increase that breaks the law: taking it to the tribunal, and paying the rent as it was meanwhile.",
                  say("tribunal_application", `Application: the notice of rent increase ${notice.id} from ${notice.speaks_for} breaks the law; we ask that it be found invalid.`, { to: [desk], visible: [me, desk, notice.speaks_for!], basis: notice.id, data: { kind: "rent_increase", against: notice.speaks_for, notice: notice.id, evidence: evidence(notice) } })));
                return notice.id;
              } });
          const owed = hears.includes("debt") && w.whom ? (book.claimsBy("holder", me) as readonly any[]).find((c) => c.holder === me && c.about?.kind === "debt" && c.counterparty === w.whom && !pursued.has(c.id)) : undefined;
          if (owed) out.push({ key: `desk:${desk}`, kind: "desk", id: owed.id, by: desk, brings: ["money.to"], bears: [w.whom!], adj: trustOf(desk) + ag + nw("take_to_tribunal"), others: after("desk"), act: () => { applyDebtNow.add(owed.id); return owed.id; } });
        }
        // The town's own desk for what it has not done (a complaint).
        if (p.complain_to && home && isLeaseholder() && complainedOf !== home.structure)
          out.push({ key: `desk:${p.complain_to}`, kind: "desk", by: p.complain_to, brings: [], bears: [p.complain_to], adj: trustOf(p.complain_to) + ag + nw("complain"), others: after("desk"), act: () => { complainNow = true; return undefined; } });
        // A petition on the board about landlords, and an election called: they bear on the landlord, and on the town.
        if (willing && home && !home.owned) for (const pet of found.petitions) {
          if (pet.speaks_for === me || signed.has(pet.id) || !(pet.data?.demand?.tags ?? []).includes("tenant_protection")) continue;
          out.push({ key: `petition:${pet.id}`, kind: "petition", id: pet.id, brings: [], bears: [home.landlord], adj: ag - fearOf(home.landlord), others: publishedCount(book, pet), act: () => { signNow.add(pet.id); return pet.id; } });
        }
        if (p.electoral_town) for (const n of book.open("election_notice")) {
          if (stoodFor.has(n.id) || t >= Number(n.data?.nominations_close_at ?? 0)) continue;
          out.push({ key: `stand:${n.id}`, kind: "stand", id: n.id, brings: [], bears: [p.electoral_town, ...(p.complain_to ? [p.complain_to] : [])], adj: ag + Math.round((K.own * (zValue("achievement") + zValue("power"))) / 2) - 4 * K.own, others: 0, act: () => { standNow.add(n.id); return n.id; } });
        }
        // Something gone wrong at someone's hands (docs/behaviour/frictions.md): asking them to put it right; any
        // body that says it hears such a matter (an offer's `hears`: found by what it says, never by its name);
        // and telling those we know.
        const g = grievances.get(gkey(w.about, w.whom ?? "", w.against?.record));
        if (g && acc) {
          const account = acc.account;
          const words = g.matter.replace(/_/g, " ");
          const data = () => ({ matter: g.matter, against: g.party, ...(g.about ? { about: g.about } : {}), ...(g.amount !== undefined ? { amount: g.amount, account } : {}), ...(g.structure ? { structure: g.structure } : {}), ...(g.seeks ? { seeks: g.seeks } : {}) });
          // The law's route for a refused claim (foundations F8): whether the decision may be asked to be looked at again, still, and an appeal made, and in what days.
          const dec = g.matter === "claim_refused" && g.about ? (book.records.get(g.about) as StatementRecord | undefined) : undefined;
          const law = dec ? decisionLaw(book, "benefit_decision", typeof dec.data?.payment === "string" ? dec.data.payment : g.seeks) : undefined;
          const decidedAt = dec?.at ?? (typeof (g.evidence as any)?.at === "number" ? (g.evidence as any).at : undefined);
          const mayAsk = !law || (!!law.review && decidedAt !== undefined && daysLeft(decidedAt, law.review.within_days, t) >= 0);
          const mayApply = (): boolean => {
            if (!law) return true;
            if (law.review && !g.answer) return false;
            if (!law.appeal) return false;
            const from = law.review?.required ? g.answeredAt : decidedAt;
            return from !== undefined && daysLeft(from, law.appeal.within_days, t) >= 0;
          };
          if (!g.asked && mayAsk) out.push({ key: `ask:${g.party}`, kind: "ask", by: g.party, brings: [], bears: [g.party], adj: trustOf(g.party) - fearOf(g.party) + ag, others: after("ask"),
            act: () => {
              g.asked = { t };
              steps.push(because(`Asking ${g.party} to put it right (${words}${g.amount ? `, ${usd(g.amount)}` : ""}).`,
                say(PAPER.request, `Request: please put this right (${words}${g.amount ? `: ${usd(g.amount)} is owed to us` : ""}${g.structure ? ` at ${g.structure}` : ""}).`, { to: [g.party], visible: [me, g.party], ...(g.about ? { basis: g.about } : {}), data: data() })));
              return g.about;
            } });
          // (A venue is for what asking did not settle: one goes there after the other side has said no, said
          // nothing, or said yes and not done it. It is a bother, in forms and waiting, whatever it costs in money.)
          for (const h of (g.answer && g.answer !== "granted") || (law && !law.review) ? (mayApply() ? book.hearings() : []) : []) {
            const venue = h.speaks_for ?? h.author;
            const entry = h.offer?.hears?.find((x) => x.about === g.matter);
            if (!entry || venue === g.party || venue === me || g.applied.has(venue)) continue;
            if (h.offer?.to?.members_of && !memberOf(h.offer.to.members_of)) continue;
            // (What applying costs, where its terms say: paid with the application, by one who has it.)
            const fee = (h.offer?.terms?.commitments ?? []).filter((c) => c.who === "taker").map((c) => (c.does as any)?.outcome?.money).find((m) => m?.to);
            const cost = fee ? cents(fee.amount) : 0;
            if (cost > acc.balance) continue;
            out.push({ key: `desk:${venue}`, kind: "desk", id: h.id, by: venue, brings: [], bears: [g.party], ...(cost ? { cost } : {}), adj: trustOf(venue) + ag - K.venue - Math.round((K.own * Math.min(4, cost / Math.max(1, p.essentials / 10)))), others: after("desk"),
              act: () => {
                g.applied.set(venue, { t });
                steps.push(because(`Taking it to ${venue}, which hears such things (${words} against ${g.party})${cost ? `, with its fee of ${usd(cost)}` : ""}.`,
                  say(entry.form ?? PAPER.application, `Application: ${words} against ${g.party}${g.amount ? `; ${usd(g.amount)} is owed to us` : ""}${g.structure ? `; at ${g.structure}` : ""}${g.asked ? `; we asked them ${Math.floor((t - g.asked.t) / DAY)} days ago${g.answer === "refused" ? " and they refused" : g.answer === "ignored" ? " and had no answer" : ""}` : ""}.`,
                    { to: [venue], visible: [me, venue, g.party], basis: h.id, data: { kind: g.matter, ...data(), particulars: particularsOf(g, t), ...(g.asked ? { request: `asked on day ${Math.floor(g.asked.t / DAY)}` } : {}), ...(g.evidence !== undefined ? { evidence: g.evidence } : {}), ...(decidedAt !== undefined ? { decided_on: decidedAt } : {}), ...(g.answeredAt !== undefined ? { reviewed_on: g.answeredAt } : {}) } }),
                  ...(cost > 0 ? [pay(String(fee.to), cost, { from: account, for: "Application fee." })] : [])));
                return h.id;
              } });
          }
          if (contacts.size && !g.told) out.push({ key: "tell", kind: "tell", brings: [], bears: [g.party], adj: Math.round(K.own * zValue("benevolence")) - K.own, others: 0,
            act: () => {
              g.told = true;
              const whom = ties.closest(3, t).map((x) => x.who).filter((x) => contacts.has(x));
              if (whom.length) steps.push(because(`Telling those we know what ${g.party} did.`, message(whom, WRONGED.say(g.matter, g.party))));
              return undefined;
            } });
        }
        // Something made in a run that offers membership (docs/behaviour/founding.md): found as any opening is, by
        // what its offer brings (dues the other way, a draw on a fund, its gatherings), and, where it says it takes
        // up matters like ours for its members, by whom that bears on.
        if (F && acc) for (const s of book.open("membership")) {
          const host = s.speaks_for ?? s.author, o = s.offer;
          if (!o || o.take_up !== "join" || host === me || host === p.union || memberOf(host) || appliedTo.has(host)) continue;
          if (o.to && ((o.to.members_of && !memberOf(o.to.members_of)) || (o.to.dealing_with && !dealsWith(o.to.dealing_with)) || (o.to.entities && !o.to.entities.includes(me)))) continue;
          const asks = (o.terms?.commitments ?? []).filter((c) => c.who === "taker").map((c) => (c.does as any)?.outcome?.money).filter((m) => m?.to).reduce((a, m) => a + cents(m.amount), 0);
          if (asks > acc.balance) continue;
          const gathers = book.practices().some((r) => (r.speaks_for ?? r.author) === host);
          const takesUp = !!g && book.hearings().some((h) => (h.speaks_for ?? h.author) === host && h.offer?.hears?.some((x) => x.about === g.matter));
          const brings = [...new Set<SeekKey>([...bringsOf(o as any).filter((k) => k !== "money.from"), ...(gathers ? (["attend"] as SeekKey[]) : [])])];
          // (How much: a fund's stated draw against what a month of our household's essentials costs. A draw that
          // would cover a month counts for joining as much as anything of our own doing; one that would cover a
          // twentieth of it counts against. Until 2026-10-12 a fund was an opening by its kind alone, and 202 people
          // joined one whose draw was a hundredth of a month's essentials: docs/behaviour/founding.md.)
          const worth = fundWorth(s);
          out.push({ key: `join:${host}`, kind: "join", id: s.id, by: host, brings, bears: takesUp ? [g!.party] : [], ...(asks ? { cost: asks } : {}),
            adj: K.own + Math.round((K.belief * holdTo(host)) / 10_000) + trustOf(host) + ag - Math.round(K.own * Math.min(4, asks / Math.max(1, p.essentials / 10))) + (worth === undefined ? 0 : Math.round(K.own * 2 * (worth - 0.5))), others: heardNow.filter((n) => n.goesTo?.includes(host)).length,
            act: () => { joinGroup.add(host); return s.id; } });
        }
        // Our own conduct (spending less), and those we know (their company; what they know of).
        out.push({ key: "self", kind: "self", brings: ["money.from"], adj: K.own + Math.round((K.own * (zValue("security") + zValue("conformity"))) / 2), others: after("self"), act: () => undefined });
        if (contacts.size) out.push({ key: "ties", kind: "ties", brings: ["attend"], adj: K.own + Math.round(K.own * zValue("benevolence")), others: 0, act: () => undefined });
        return out.filter((o) => meets(w, o));
      };
      /**
       * An occasion for founding (docs/behaviour/founding.md): a want of ours given up, or with nothing we can see
       * that would answer it. If enough of those we know are in the same case, we may start something ourselves:
       * whether, by our temperament and standing against the town's; what shape, by what the want is about and
       * what we value; both drawn on our own stream. Then the words, if this world has a composer.
       */
      const occasion = (w: Wanted, how: "given_up" | "withdrew", t: number) => {
        if (!F || !F.shapes.length || begun || myGroup || leaving || t < foundRest || !acc || !obs.body || (t - obs.body.born_at) / year < ADULT_YEARS) return;
        const sharers = new Map<string, string>();
        // (What befell one of a household is told to its other adults, who hold it with them: so the household shares
        // it whichever of them we are.)
        const mates = new Set(adults(t).map((a) => a.person));
        if (w.with || w.about === "let_go" || w.about === "notice" || w.about === "rent_increase") for (const who of [...mates].sort()) sharers.set(who, "of our household, holding it with us");
        for (const [who, n] of [...toldUs].sort(([a], [b]) => (a < b ? -1 : 1))) {
          if (t - n.t > p.news_days * DAY || who === me) continue;
          if (n.after?.some((a) => a.about === w.about)) sharers.set(who, "told us they are after the same");
          else if (n.gaveUp === w.about) sharers.set(who, "told us they have stopped trying for the same");
          else if (w.about === "let_go" && n.letGoBy) sharers.set(who, `told us ${n.letGoBy} let them go`);
          else if (w.about === "notice" && n.noticedBy) sharers.set(who, `told us ${n.noticedBy} gave them notice`);
        }
        for (const [who, x] of [...heardWronged].sort(([a], [b]) => (a < b ? -1 : 1)))
          if (t - x.t <= p.news_days * DAY && (x.matter === w.about || (w.whom !== undefined && x.by === w.whom))) sharers.set(who, `told us ${x.by} did wrong by them (${x.matter.replace(/_/g, " ")})`);
        // A death: those of the household, those who told us of it, and those we told. A home in disrepair: those we
        // see living in the same building, which wears as one.
        if (w.about === "loss" && w.whom) for (const who of [...(mourners.get(w.whom) ?? [])].sort()) if (who !== me) sharers.set(who, `mourns ${w.whom} too`);
        if (w.about === "disrepair" && home && homeSite?.structure === home.structure) for (const sp of homeSite.spaces) if (sp.space !== home.space) for (const who of [...(sp.occupants ?? [])].sort()) if (who !== me && !sharers.has(who)) sharers.set(who, "lives in the same building, which is in the same disrepair");
        // Enough of them, and one at least from beyond our own household: a household alone is not others.
        if (sharers.size < F.shared_min || ![...sharers.keys()].some((who) => !mates.has(who))) return;
        // (What we could found at all: a group needs somewhere to gather, the home we live in; a business, its means.)
        const hasPlace = !!(home?.movedIn ? home.space : livingAt);
        const able = { gathering: hasPlace, fund: hasPlace, cause: hasPlace, business: p.ventures.length > 0 && (p.found_bps > 0 || p.found_own_ppm > 0 || p.ventures.some((v) => v.own)) && !retired && p.in_labour_force };
        if (!shapeOdds(F, w.about, !!w.whom, (v) => zValue(v as Value), able).some((o) => o.score > 0)) return;
        foundRest = t + F.rest_days * DAY;
        // Something we can see already answers it and would take us (or has us): we do not start another. What we
        // know of, not the town: an offer of membership we have seen, of a body that brings what this want seeks or
        // takes up matters with whoever it is against, that has not turned us away or refused us against its own
        // rule, that we have not come to distrust, and (a fund) whose draw is worth something against our month.
        const answers = [...book.open("membership")].filter((s) => {
          const host = s.speaks_for ?? s.author, o = s.offer;
          if (!o || o.take_up !== "join" || host === me || host === p.union || refusedBy.has(host)) return false;
          if (!memberOf(host)) {
            if (o.to && ((o.to.members_of && !memberOf(o.to.members_of)) || (o.to.dealing_with && !dealsWith(o.to.dealing_with)) || (o.to.entities && !o.to.entities.includes(me)))) return false;
            const asks = (o.terms?.commitments ?? []).filter((c) => c.who === "taker").map((c) => (c.does as any)?.outcome?.money).filter((m) => m?.to).reduce((a, m) => a + cents(m.amount), 0);
            if (asks > acc.balance) return false;
          }
          if (inner.zTrust(host, kindOf(host), t) <= -1) return false;
          const worth = fundWorth(s);
          if (worth !== undefined && worth < FUND_WORTH_MIN) return false;
          const takesUp = w.whom !== undefined && book.hearings().some((h) => (h.speaks_for ?? h.author) === host && h.offer?.hears?.some((x) => x.about === w.about));
          return meets(w, { key: `join:${host}`, kind: "join", brings: bringsOf(o as any).filter((k) => k !== "money.from"), bears: takesUp ? [w.whom!] : [], adj: 0, others: 0, act: () => undefined } as Opening);
        }).map((s) => s.speaks_for ?? s.author).sort();
        if (answers.length) {
          decision({ t, domain: "found", strategy: "deliberate", choice: "not", options: [{ key: "found", score: 0, others: sharers.size }, { key: "not", score: 10_000 }],
            situation: situationOf(w, [], [{ key: "found", weight: 0 }, { key: "not", weight: 10_000 }], t, { occasion: { how, sharers: sharers.size, beyond_household: [...sharers.keys()].filter((who) => !mates.has(who)).length, answered_by: answers[0], answering: answers.length } }) });
          return;
        }
        const chance = chanceOf(F, { enterprise: (zValue("stimulation") + zValue("self_direction") + zValue("achievement")) / 3, care: (zValue("benevolence") + zValue("universalism")) / 2,
          agency: inner.zAgency(), standing: zAttached("place"), ties: (ties.closest(5, t).length - 2.5) / 1.5 });
        const founds = ctx.rng(`found-group-${w.about}`).below(10_000) < chance;
        decision({ t, domain: "found", strategy: "deliberate", choice: founds ? "found" : "not", options: [{ key: "found", score: chance, others: sharers.size }, { key: "not", score: 10_000 - chance }],
          situation: situationOf(w, [], [{ key: "found", weight: chance }, { key: "not", weight: 10_000 - chance }], t, { occasion: { how, sharers: sharers.size, beyond_household: [...sharers.keys()].filter((who) => !mates.has(who)).length } }) });
        if (!founds) return;
        const odds = shapeOdds(F, w.about, !!w.whom, (v) => zValue(v as Value), able);
        const shape = drawOf(ctx.rng(`found-shape-${w.about}`), odds);
        decision({ t, domain: "found_shape", strategy: "deliberate", ...(shape ? { choice: shape } : {}), options: odds.map((o) => ({ key: o.key, score: o.score })) });
        if (!shape) return;
        if (shape === "business") {
          // (Work of one's own: the existing way of starting a business, taken when its premises and means are there.)
          // (Either way there is: a shop in premises for sale, or a business of one from home, whichever its means
          // allow first: docs/behaviour/entry.md, "Starting a business of one".)
          ventureWanted = t + 180 * DAY;
          nextVenture = Math.min(nextVenture, t);
          nextOwnVenture = Math.min(nextOwnVenture, t);
          outcome({ t, domain: "found", option: "business", kind: "meant", way: "mine", facts: { about: w.about, sharers: sharers.size } });
          return;
        }
        const record = Object.fromEntries([...written].filter(([k]) => k !== "hours").map(([k, v]) => [k, JSON.parse(v)]));
        const g = grievances.get(gkey(w.about, w.whom ?? "", w.against?.record));
        const list = [...sharers].map(([who, how]) => ({ who, how }));
        const duesOpen = shape === "fund" && F.dues.some((c) => c > 0) ? F.dues.filter((c) => c > 0) : F.dues;
        const brief: ComposeBrief = {
          idea: `idea.${me}.${Math.floor(t)}`, founder: me, record,
          want: { about: w.about, ...(w.whom ? { whom: w.whom } : {}), ...(w.with ? { befell: "household" as const } : {}), days: Math.floor((t - w.since) / DAY), tried: w.tried, ...(w.way ? { way: kindOfWay(w.way) } : {}), weight: Math.round(w.weight), how,
            ...(g?.asked ? { asked: g.answer ?? "no answer" } : {}), ...(g?.applied.size ? { venues: g.applied.size } : {}), ...(g?.amount !== undefined ? { amount: usd(g.amount) } : {}) },
          sharers: list, shape,
          open: { dues: duesOpen.map((c) => ({ cents: c, words: c > 0 ? `${usd(c)} a month` : "nothing" })), every_days: F.every_days, starts_in_days: F.starts_in_days, lasts_minutes: F.lasts_minutes, place: "their own home" },
          means: { income: usd(householdIncome()), savings: usd(acc.balance) },
          dark: darkOf(w, record, inner.zAgency()),
          code: { purpose: plainPurpose(shape, w, list.length + 1), name: plainName(shape, me, w) },
        };
        const mine: Begun = { want: { ...w }, shape, sharers: list, brief, dues: duesOpen };
        begun = mine;
        // The words: asked of the composing model where this world has one (answered by the next wake); else our own.
        if (ctx.compose) asking.push(ctx.compose(brief, ctx.participant).then((piece) => { mine.piece = piece ?? null; }, () => { mine.piece = null; }));
        else mine.piece = null;
      };
      /**
       * The situation a decision about a want was made in, for the record of decisions (docs/design/ai-citizens.md 11):
       * the want, what stands behind it, each opening as what it would bring in typed terms with what we know of it,
       * our own record as the kernel holds it, and the odds our mind gave. Recording only: it reads what is already
       * here (nothing is created by looking: trust is read only where the choice already read it) and nothing reads
       * it back. Nothing of anyone else's record is in it, and no text we have not read.
       */
      const situationOf = (w: Wanted, ways: Way[], odds: { key: string; weight: number }[], t: number, more: { [k: string]: unknown } = {}): Situation => {
        const g = grievances.get(gkey(w.about, w.whom ?? "", w.against?.record));
        const paper = w.against ? book.records.get(w.against.record) : undefined;
        const notice = paper?.record === "statement" && paper.kind === "rent_increase" ? paper.data : undefined;
        const rentTo = notice?.rent !== undefined ? cents(notice.rent) : undefined;
        const townTrust = (who: string) => (p.outlook.trust as { [k: string]: number } | undefined)?.[kindOf(who)] ?? inner.p.trust.start_bps;
        const role = (who: string | undefined) => (who === undefined ? undefined : home && who === home.landlord && !home.owned ? "landlord" : job && who === job.employer ? "employer" : who === w.whom || who === w.against?.by ? "other_side" : kindOf(who));
        const learnedWay = mind.learned("way");
        const total = Math.max(1, odds.reduce((a, o) => a + o.weight, 0));
        return {
          v: 1,
          want: { about: w.about, from: w.from, weight: Math.round(w.weight), days: Math.floor((t - w.since) / DAY), tried: w.tried, grown: w.grown, seeks: [...w.seeks], ...(w.with ? { household: true } : {}),
            ...(w.whom ? { whom: role(w.whom)! } : {}), ...(w.against ? { against: w.against.kind } : {}), ...(w.way ? { last_way: kindOfWay(w.way) } : {}) },
          ...(g ? { matter: { matter: g.matter, days: Math.floor((t - g.since) / DAY), ...(g.asked ? { asked_days: Math.floor((t - g.asked.t) / DAY), answer: g.answer ?? "none yet" } : {}), venues: g.applied.size, ...(g.amount !== undefined ? { amount: g.amount } : {}), ...(g.told ? { told: true } : {}) } } : {}),
          ...(home ? { home: { rent: home.rent, ...(home.owned ? { owned: true } : {}), ...(rentTo !== undefined ? { rent_to: rentTo } : {}), ...(rentTo !== undefined && Number.isFinite(Number(notice?.from)) ? { from_days: Math.floor((Number(notice.from) - t) / DAY) } : {}) } } : {}),
          means: { income: Math.round(householdIncome()), savings: Math.round(acc?.balance ?? 0), essentials: Math.round(p.essentials) },
          openings: ways.map((o) => {
            const tr = o.by !== undefined ? inner.trusted(o.by) : undefined;
            return { kind: o.kind, ...(o.by !== undefined ? { by: role(o.by)! } : {}), brings: [...o.brings], ...(o.undoes ? { undoes: true } : {}), ...(o.bears?.length ? { bears: true } : {}),
              ...(tr !== undefined ? { trust: { bps: tr, town_bps: townTrust(o.by!) } } : {}),
              ...(o.by !== undefined && feelings.level("fear", o.by, t) > 0 ? { fear: Math.round(feelings.level("fear", o.by, t)) } : {}),
              ...(o.by !== undefined && holdTo(o.by) > 0 ? { belief: Math.round(holdTo(o.by)) } : {}),
              others: o.others, ...(o.cost ? { cost: o.cost } : {}), ...(learnedWay.known(o.kind) ? { learned: Math.round(learnedWay.get(o.kind)) } : {}), adj: Math.round(o.adj) };
          }),
          record: Object.fromEntries([...written].filter(([k]) => k !== "hours").map(([k, v]) => [k, JSON.parse(v)])),
          outlook: { agency: { ...(p.outlook.agency ?? { mean_bps: inner.p.agency.mean_bps, sd_bps: inner.p.agency.sd_bps }) }, ...(p.attach_mean?.place_bps !== undefined ? { place_bps: p.attach_mean.place_bps } : {}) },
          code: { odds: odds.map((o) => ({ key: o.key, ppm: Math.round((o.weight * 1_000_000) / total) })) },
          ...more,
        };
      };
      /** Going after a want now: the way the mind takes among what would bring it about, or none (waiting). */
      const pursue = (w: Wanted): string => {
        const K = wants.p.choice;
        const ways = waysFor(w);
        // (One option a kind of way: what the mind learns of is ways. Of several of a kind, the likeliest.)
        const best = new Map<string, Way>();
        for (const o of ways) if (!best.has(o.kind) || o.adj > best.get(o.kind)!.adj) best.set(o.kind, o);
        const learned = mind.learned("way");
        const options = [...best.values()].map((o) => ({ key: o.kind, value: o.adj + Math.round((K.others * Math.min(5, o.others) * (10_000 + mind.person.temperament.conformity)) / 10_000) + (o.kind === "ask" || o.kind === "desk" ? recourseBump.get(w.about) ?? 0 : 0) }));
        // Doing nothing: the likelier the less a person believes what they do makes a difference.
        options.push({ key: "wait", value: -K.own - Math.round(K.agency * inner.zAgency()) });
        options.sort((a, b) => (a.key < b.key ? -1 : 1));
        const c = learned.choose(ctx.rng(`want-${w.about}-${w.against?.record ?? w.whom ?? ""}`), options, mind.person.temperament.openness);
        decision({ t, domain: "want", strategy: "deliberate", choice: c.key, options: options.map((o) => ({ key: o.key, score: Math.round(learned.get(o.key) + o.value), ...(learned.known(o.key) ? { learned: Math.round(learned.get(o.key)) } : {}) })),
          situation: situationOf(w, ways, options.map((o, i) => ({ key: o.key, weight: c.weights[i]! })), t) });
        const way = best.get(c.key);
        if (!way) {
          wants.tried(w, "wait", t);
          // Withdrawal: nothing we can see would answer it, or we do not believe acting would. Said, when asked.
          if (!ways.length) occasion(w, "withdrew", t);
          if (!ways.length || inner.zAgency() < -1) {
            withdrew = { about: w.about, t };
            inner.note({ t, what: "want_withdrew", about: w.about, size: Math.round(w.weight) });
            outcome({ t, domain: "want", option: w.about, kind: "withdrew", way: "mine", facts: { weight: Math.round(w.weight), ways_seen: ways.length, ...(w.whom ? { whom: w.whom } : {}) } });
          }
          return "wait";
        }
        const on = way.act();
        wants.tried(w, way.key, t, on ?? way.id);
        return way.key;
      };
      /** What has become of our wants since we last said: into the record's reasons, and the record of outcomes. */
      const tellWants = () => {
        for (const e of wants.take()) {
          if (e.kind === "given_up") occasion(e.want, "given_up", e.t);
          // Giving up on work stops the looking (the want rests for as long as any want given up does).
          if (e.kind === "given_up" && !job && !ownWork && !retired && p.in_labour_force && discouragedUntil === 0 && (e.want.about === "let_go" || e.want.about === "unpaid" || (e.want.seeks.includes("work") && e.want.from !== "other"))) {
            discouragedUntil = e.t + wants.p.rest_days * DAY;
            steps.push(because("We have given up on finding work, for now: no longer looking.", say("work_search", "No longer looking for work.", { visible: [me], data: { looking: false } })));
            outcome({ t: e.t, domain: "job", option: "search", kind: "gave_up", way: "mine", facts: { about: e.want.about, days: Math.floor((e.t - e.want.since) / DAY) } });
          }
          inner.note({ t: e.t, what: `want_${e.kind}`, about: e.want.about, size: Math.round(e.want.weight), ...(e.kind === "pursued" ? { by: kindOfWay(e.way ?? "wait") } : {}) });
          outcome({ t: e.t, domain: "want", option: e.want.about, kind: e.kind, way: "mine", facts: { weight: Math.round(e.want.weight), from: e.want.from, tried: e.want.tried,
            ...(e.way ? { by: kindOfWay(e.way) } : {}), ...(e.want.whom ? { whom: e.want.whom } : {}), ...(e.want.with ? { with: e.want.with } : {}), ...(e.why ? { why: e.why } : {}), days: Math.floor((e.t - e.want.since) / DAY) } });
        }
      };
      if (initiative) {
        const W = wants.p;
        // What befell us, told to the household's other adults; and what befell one of them, told to us: more than
        // income (a spouse's wellbeing falls almost as far as the one let go: Marcus 2013), and a want held together.
        for (const x of troubleToTell.splice(0)) for (const a of adults(t)) steps.push(because("Telling the household what has happened.", message([reach(a)], SAYING.trouble(x.what, x.by))));
        for (const x of troubles.splice(0)) {
          inner.happened(x.what === "let_go" ? "job_lost" : x.what === "notice" ? "evicted" : "rent_rise", t, { about: x.by, closeness: 0.5 });
          wantBorn(t, x.what, x.what === "notice" ? ["occupancy"] : x.what === "let_go" ? ["money.to"] : ["money.from", "money.to"], 0.5, x.what === "notice" ? "shelter" : "security", { whom: x.by, with: household?.leaseholder });
        }
        // A need short for long becomes a want, as this person weighs it; and one met is no longer a want.
        const heardNow = newsNow(t);
        for (const n of NEEDS_OF_MIND) {
          const level = levelsNow[n];
          const short = W.unmet_bps[n] ?? W.unmet_bps.other!;
          const held = wants.all().find((w) => w.about === n);
          if (level >= short) {
            shortSince.delete(n);
            // (One taken up from others is met when life is back to what the person aspires to; one of their own,
            // when the need is clear of the level it fell under.)
            if (held && level >= (held.from === "other" ? mind.p.aspiration_bps : short + W.met_margin_bps)) wantMet(held, "need met");
            // What those we know are after, we take up too if we are short of it ourselves (the conformist sooner: 3b).
            const copied = heardNow.filter((x) => x.after?.some((a) => a.about === n)).length;
            if (!held && level < mind.p.aspiration_bps && copied >= Math.max(1, W.copy_from - (mind.person.temperament.conformity >= 6_000 ? 1 : 0)))
              wants.born({ about: n, seeks: SEEKS_OF_NEED[n], weight: Math.round((W.need_bps * 0.3 * mind.person.weights[n]) / 15_000), since: t, from: "other" }, t);
            continue;
          }
          // (A need found short in a town's first week has been short for some time already: the clock starts at
          // day 0 and lives do not. Without this nobody wanted anything for the first two months of any run.)
          if (!shortSince.has(n)) shortSince.set(n, t < 7 * DAY ? t - ctx.rng(`short-before-${n}`).below(W.unmet_days + 1) * DAY : t);
          if (!held && t - shortSince.get(n)! >= W.unmet_days * DAY)
            wants.born({ about: n, seeks: SEEKS_OF_NEED[n], weight: Math.round((W.need_bps * (0.5 + 0.5 * (1 - level / Math.max(1, short))) * mind.person.weights[n]) / 15_000), since: t, from: "need",
              ...((n === "security" || n === "shelter") && household && household.members.length > 1 ? { with: household.leaseholder } : {}) }, t);
        }
        // Wants born of what happened: met when what they sought has come about.
        for (const w of [...wants.all()]) {
          if (w.from === "need" || NEEDS_OF_MIND.includes(w.about as any)) continue;
          if (w.about === "let_go" && !w.with && (job || ownWork || retired)) wantMet(w, "in work");
          else if (w.about === "unpaid" && w.whom && !(book.claimsBy("holder", me) as readonly any[]).some((c) => c.about?.kind === "debt" && c.counterparty === w.whom && cents(c.about.amount) > (settledToUs.get(c.id) ?? 0)) && w.tried > 0) wantMet(w, "paid");
          else if (w.about === "rent_increase" && w.against && book.withdrawn.has(w.against.record)) wantMet(w, "withdrawn");
          else if (w.about === "notice" && !w.with && w.against && noticeOver.has(w.against.record)) wantMet(w, "the notice lapsed, or we were let stay");
          else if ((w.about === "rent_increase" || w.about === "notice") && !w.with && w.against && (!home ? w.about === "rent_increase" : home.landlord !== w.against.by || (w.about === "notice" && home.agreement !== w.against.record))) wantMet(w, home ? "housed elsewhere, or let stay" : "left");
          else if (w.about === "loss" && inner.dent("meaning", t) + inner.dent("belonging", t) < 2_000) wantMet(w, "time, and company");
          else if (w.about === "service" && complainedOf === null && feelings.level("anger", w.whom ?? "", t) < 1_000) wantMet(w, "seen to");
          else if (w.with && t - w.since >= 180 * DAY) wants.giveUp(w, t, "time passed");
        }
      }
      if (!job && !ownWork && joblessSince === null) joblessSince = t;

      // (Culture: a body founded in the run, its statement of purpose read when it reaches us: an event the town can remember.)
      if (mem) for (const r of fresh) if (r.record === "statement" && r.kind === "purpose" && r.speaks_for && r.speaks_for !== me && r.at > 0 && (r.data as any)?.for !== me && !readNews.has(r.id)) {
        readNews.add(r.id);
        remember("founded", r.speaks_for, r.at, t, "read", paperStrength(3, cul!.p));
      }
      // Offers made to us: sign what we asked for and can afford.
      for (const r of fresh) {
        if (r.record !== "agreement" || !r.terms.parties.includes(me) || book.signedBy(r.id, me) || book.takenBack(r.id)) continue; // (an offer its maker has taken back is not signed)
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
            const due0 = firstDue(old, every);
            starts = due0 >= starts ? due0 : due0 + Math.ceil((starts - due0) / every) * every;
            stopAt = starts - every + DAY;
          }
          steps.push(because(`Our landlord offers a new lease on ${home.space} as ours runs out, at ${usd(rent)} a month: staying, and signing it.`,
            sign(r.id), ["so", pay(rentTo, rent, { from: acc.account, every: MONTH, first: Math.max(0, starts - t), basis: r.id, for: `Rent for ${home.space}, monthly in advance.` })]));
          if (home.order && stopAt <= t) steps.push(because("The old lease's rent is replaced by the new one's.", withdraw(home.order, "Replaced by a new standing order.")));
          else if (home.order) home.retiring = [...(home.retiring ?? []), { order: home.order, at: stopAt }];
          outcome({ t, domain: "home", option: home.space, kind: "renewed", way: "mine", facts: { rent, was: home.rent } });
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
          gaveUp.delete(space);
          pendingRef = { kind: "rent", agreement: r.id };
          outcome({ t, domain: "home", option: space, kind: "lease_signed", way: "mine", facts: { rent, ...(homelessSince !== null ? { days_without: Math.floor((t - homelessSince) / DAY) } : {}) }, ...(thanked ? { felt: [thanked] } : {}) });
          thanked = undefined;
          homelessSince = null;
        } else if (r.terms.template === "lease" && home && !home.owned && moveHunt && isLeaseholder() && !cites(r, home.agreement)) {
          // Another home, offered while we still have ours (we went looking: a notice to go, or a rent to beat): we
          // sign, leave the old one now, and pay its rent until its tenancy ends (giving notice if none runs).
          const { rent, rentTo, space, structure } = leaseTerms(r, me);
          if (!space || !structure || !rentTo || !affordable(rent, acc.balance)) continue;
          const old = home;
          steps.push(because(`Signing the lease offered for ${space} (${usd(rent)} a month), and leaving ${old.space}${thank(structure, t)}.`,
            sign(r.id), ["so", pay(rentTo, rent, { from: acc.account, every: MONTH, first: 0, basis: r.id, for: `Rent for ${space}, monthly in advance.` })]));
          const out: Step = because(`Leaving ${old.space} for the home we have taken${endsAt(old) === Number.MAX_SAFE_INTEGER ? ", with the notice our lease asks" : ""}.`, ...(old.movedIn ? [moveOut(old.structure, me)] : []));
          if (endsAt(old) === Number.MAX_SAFE_INTEGER) out.push(notice(old.agreement, "Moving to another home."));
          if (out.length) steps.push(out);
          if (old.movedIn) for (const k of children(t)) steps.push(because("Taking the children out of our old home.", moveOut(old.structure, k.person)));
          leftHomes.push({ agreement: old.agreement, orders: [...(old.order ? [old.order] : []), ...(old.retiring ?? []).map((x) => x.order)] });
          outcome({ t, domain: "home", option: old.space, kind: "ended", way: "mine", facts: { by: "self", rent: old.rent, moved: true } });
          home = { agreement: r.id, space, structure, landlord: other, rent, movedIn: false };
          gaveUp.delete(space);
          pendingRef = { kind: "rent", agreement: r.id };
          toldMoveIn = null;
          moveHunt = null;
          outcome({ t, domain: "home", option: space, kind: "lease_signed", way: "mine", facts: { rent, was: old.rent, moved: true }, ...(thanked ? { felt: [thanked] } : {}) });
          thanked = undefined;
        } else if (r.terms.template === "employment" && !job) {
          const terms = jobTerms(r, me, book);
          const s: Step = because(`Taking the job offered: ${usd(terms.wage)} every ${Math.round(terms.period / DAY)} days${thank(terms.workplace ? structureOf(terms.workplace) : undefined, t)}.`, sign(r.id));
          if (terms.workplace && !p.round) s.push(moveIn(terms.workplace)); // (with the round, we go when work starts)
          steps.push(s);
          job = { agreement: r.id, employer: other, ...terms, since: t };
          outcome({ t, domain: "job", option: other, kind: "hired", way: "mine", facts: { wage: terms.wage, period_days: Math.round(terms.period / DAY), ...(joblessSince !== null ? { days_without: Math.floor((t - joblessSince) / DAY) } : {}) }, ...(thanked ? { felt: [thanked] } : {}) });
          thanked = undefined;
          joblessSince = null;
        } else if (r.terms.template === "employment" && job && !switching && !retired && other !== job.employer) {
          // Offered a better-paid job while in one (we applied for it): we take it, give notice at ours, and start the
          // new one when the notice is worked out.
          const terms = jobTerms(r, me, book);
          if (terms.wage * job.period <= job.wage * terms.period) continue;
          // (And, for one who takes initiative where the world says what holds people, only if it pays enough more:
          // an offer that comes of an application made while out of work is weighed against the job since found.)
          const hold = heldIn(t, advertisedJob(book, r)?.data?.industry);
          if (hold > 0 && terms.wage * job.period * 10_000 <= job.wage * terms.period * (10_000 + hold)) continue;
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
        const chance = shifted(rate, p.sway.union_join * (zValue("benevolence") + zValue("universalism")) / 2 + learnedMember + conform + creed + meant + (cul ? (cul.p.sway_milli / 1_000) * cul.lean("join_union", t) : 0));
        const joins = !member && ctx.rng(`join-${job.agreement}`).below(10_000) < chance;
        if (!member) cul?.act("join_union", joins, t);
        // Recorded as the mind's decision (docs/design/ai-citizens.md 7): weighed, from the chance as the person came to it.
        if (!member) decision({ t, domain: "membership", strategy: "deliberate", choice: joins ? "join" : "not",
          options: [{ key: "join", score: chance }, { key: "not", score: 10_000 - chance }], ...(cul ? { norm: cul.norm("join_union", t) } : {}) }, ...(joins ? ["member"] : []));
        if (joins)
          steps.push(because(`A new job: joining the union (${rate / 100}% of those working in ${industry.replaceAll("_", " ")} do; for me, ${chance / 100}%${saidJoin ? `, thinking what it would mean to me: ${Math.round((saidJoin.join ?? 0) / 1_000)} of 10 against ${Math.round((saidJoin.not ?? 0) / 1_000)} not to` : ""}).`, say("membership_application", "Application to join.", { to: [p.union], visible: [me, p.union], data: { account: acc.account, employer: job.employer, industry } })));
      }
      // Joining the union out of a want (a grievance at work, or pay that falls short), whenever that comes.
      if (joinNow && p.union && job && !isMember()) {
        joinAsked = job.agreement;
        steps.push(because("Joining the union: there is something at work we want put right.", say("membership_application", "Application to join.", { to: [p.union], visible: [me, p.union], data: { account: acc.account, employer: job.employer, industry: industryOf.get(job.employer) ?? "other" } })));
      }
      joinNow = false;
      // Founding and what was founded (docs/behaviour/founding.md).
      if (F && acc) {
        // What we have begun, once its words are in hand (ours, or the composer's): the organisation, with us in its
        // first post. A composed name goes through the translator, as a seat's words would; the post's channels and
        // module are our own plumbing, put in by the check of the draft.
        const ourPlace = home?.movedIn ? home.space : livingAt;
        if (begun && begun.piece !== undefined && !begun.sent && F.template && ourPlace) {
          begun.sent = true;
          const b = begun, piece = b.piece && !b.piece.declined ? b.piece : null;
          const room = Math.max(1, (homeSite?.spaces.find((sp) => sp.space === ourPlace)?.capacity ?? 4 + (household?.members.length ?? 1)) - (household?.members.length ?? 1));
          const fill = (x: unknown): unknown => typeof x === "string" ? x.replaceAll("{founder}", me) : Array.isArray(x) ? x.map(fill) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, fill(y)])) : x;
          const module = (name: string) => ({ ...(fill(F.template!.role_module) as object), params: { ...(fill(F.template!.role_module.params) as object),
            founder: me, shape: b.shape, idea: b.brief.idea, name, purpose: b.brief.code.purpose, want: { about: b.want.about, ...(b.want.whom ? { whom: b.want.whom } : {}), since: Math.round(b.want.since), weight: Math.round(b.want.weight) },
            place: ourPlace, ...(homeSite?.at && ourPlace === home?.space ? { place_on: homeSite.at } : {}), place_room: room, bank: F.bank, founded_at: t,
            ...(piece ? { composed: { purpose: piece.purpose, asks: piece.asks, gathers: piece.gathers, choice: piece.choice, model: piece.model } } : {}),
            dues: b.dues, every_days: F.every_days, starts_in_days: F.starts_in_days, lasts_minutes: F.lasts_minutes, at_seconds: F.at_seconds, lapse_days: F.lapse_days, min_members: F.min_members,
            hall: F.hall, fund: F.fund, cause: F.cause, ...(F.template!.role_module.params.values ? { owner_values: { ...mind.person.values } } : {}) } });
          const channelsOf = fill(F.template.channels) as unknown[];
          const plain = (): Step => because(`${b.sharers.length} others we know are in the same case (${b.want.about.replace(/_/g, " ")}), and nothing answers it: starting something of our own (${b.shape}).`,
            ["founded", C.call("entity", { kind: F.template!.kind, name: C.text(b.brief.code.name), position: C.text(F.template!.title), channels: C.json(channelsOf), role_module: C.json(module(b.brief.code.name)) })]);
          const st = plain();
          if (piece?.name.trim()) {
            const name = piece.name.replace(/\s+/g, " ").replace(/"/g, "'").trim().slice(0, 100);
            const words: Words = { what: "name", idea: b.brief.idea,
              accept: (blocks) => { const r = acceptEntity(F.template!.kind, F.template!.title, channelsOf, {})(blocks); if (typeof r === "string") return r; const made = r[0] as any; made.first_position.role_module = module(String(made.name)); return r; },
              done: (ok) => { b.nameBy = ok ? "translator" : "code"; if (!ok) todo.unshift(plain()); } };
            (st as Step & { propose?: { text: string; words: Words } }).propose = { text: `Found a ${F.template.kind} called "${name}", with me in its first post as ${F.template.title}.`, words };
          }
          steps.push(st);
          pendingGroup = true;
        }
        // Our own: we belong to what we founded, as anyone who joins does.
        if (myGroup && !memberOf(myGroup.org) && !appliedTo.has(myGroup.org) && book.open("membership").some((r) => r.speaks_for === myGroup!.org)) joinGroup.add(myGroup.org);
        for (const host of [...joinGroup].sort()) {
          joinGroup.delete(host);
          appliedTo.add(host);
          steps.push(because(`Asking to join ${host}.`, say("membership_application", "Application to join.", { to: [host], visible: [me, host], data: { account: acc.account } })));
        }
        // Wound up: its members end what they pay it.
        const leave = (host: string, why: string, kind: string) => {
          const m = groups.get(host);
          if (!m) return;
          groups.delete(host);
          const lines: C.Call[] = [];
          for (const o of book.all("request")) if (o.record === "statement" && cites(o, m.agreement) && o.speaks_for === me && !book.withdrawn.has(o.id)) lines.push(withdraw(o.id, why));
          if (book.inForce(m.agreement)) lines.push(notice(m.agreement, why));
          if (lines.length) steps.push(because(`${why} Leaving ${host}.`, ...lines));
          outcome({ t, domain: "membership", option: "member", kind, way: "mine", facts: { with: host, days: Math.floor((t - m.t) / DAY) } });
        };
        for (const r of fresh) if (r.record === "statement" && r.kind === "wound_up" && r.speaks_for && groups.has(r.speaks_for)) leave(r.speaks_for, "It has wound up.", "wound_up");
        for (const [host, m] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
          // Not come for long: we give notice (its founder stays while it stands).
          if (host !== myGroup?.org && t - Math.max(m.went, m.t) >= F.leave_after_days * DAY) { leave(host, "We no longer come.", "left"); continue; }
          // A fund we pay into, when we are short: asking for the draw its terms state (once in a while).
          // (By the rule the fund states with its offer: a member long enough, who has not drawn within its time. A
          // member asks when the rule would pay them, as anyone reads the terms of what they belong to; a fund that
          // states no rule is asked whenever we are short.)
          const standing = book.open("membership").find((r) => r.speaks_for === host);
          const draw = (standing?.offer?.terms?.commitments ?? []).filter((c) => c.who === host).map((c) => (c.does as any)?.outcome?.money).find((x) => x?.amount);
          const stated = standing?.data?.fund as { qualify_days?: number; every_days?: number } | undefined;
          const qualifies = !stated || (t - m.t >= Number(stated.qualify_days ?? 0) * DAY && t - (m.drew ?? -Infinity) >= Number(stated.every_days ?? 0) * DAY);
          if (draw && qualifies && levelsNow.security < (wants.p.unmet_bps.security ?? 3_000) && t - (m.claimed ?? -Infinity) >= 30 * DAY) {
            m.claimed = t;
            steps.push(because(`Short of money, and a member of ${host}: asking to draw on its fund.`, say("fund_claim", `Request: a draw on the fund, ${usd(cents(draw.amount))}.`, { to: [host], visible: [me, host], data: { amount: cents(draw.amount), account: acc.account } })));
            outcome({ t, domain: "membership", option: "member", kind: "draw_asked", way: "mine", facts: { with: host, amount: cents(draw.amount) } });
          }
        }
      }
      // A fund's answer to our asking: paid, we have reason to trust it; refused, less, and more so where the rule
      // it stated with its offer did not say it would refuse (it is then no longer something that answers us).
      for (const r of fresh) {
        if (r.record !== "statement" || r.kind !== "fund_decision" || !(r.addressed_to ?? []).includes(me) || !r.speaks_for) continue;
        const host = r.speaks_for, m = groups.get(host);
        const granted = r.data?.granted === true, why = String(r.data?.why ?? "");
        const rd = readOf(r.id);
        const stated = book.open("membership").find((x) => x.speaks_for === host)?.data?.fund as { qualify_days?: number; every_days?: number } | undefined;
        // (What its stated rule foretold: too new a member, drawn too lately, the fund without the money.)
        const foretold = !!stated && (why === "the fund has not got it" || (!!m && ((why === "not yet a member long enough" && t - m.t < Number(stated.qualify_days ?? 0) * DAY) || why === "drew not long ago")));
        let moved: ReturnType<typeof landing> = {};
        if (granted) { if (m) m.drew = t; moved = landing(rd, host, true, t, { trust: 2 }); }
        else { moved = landing(rd, host, false, t, { trust: foretold ? 1 : 2 }); if (!foretold) refusedBy.add(host); }
        outcome({ t, domain: "membership", option: "member", kind: granted ? "draw_paid" : "draw_refused", way: "mine", from: host, facts: { with: host, ...(granted ? { amount: cents(r.data?.amount ?? 0) } : { why, foretold }) } });
        withRead(rd, moved);
      }
      for (const r of fresh) {
        if (r.record === "agreement" && r.terms.template === "membership" && r.terms.parties.includes(me) && !book.signedBy(r.id, me) && !book.takenBack(r.id)) {
          const host = r.terms.parties.find((x) => x !== me) ?? "";
          const ofRun = !!F && host !== p.union;
          const dues = (ofRun ? r.terms.commitments.find((c: any) => c.who === me && c.does?.outcome?.money)?.does : commitmentOf(r, me))?.outcome?.money;
          outcome({ t, domain: "membership", option: "member", kind: "joined", way: "mine", facts: { with: host, ...(dues ? { dues: cents(dues.amount) } : {}) } });
          if (ofRun) {
            // (Something made in a run: we mean to come to its gatherings, and hold a little to what it says it is for.)
            groups.set(host, { t, agreement: r.id, went: t });
            for (const g of book.practices()) if ((g.speaks_for ?? g.author) === host) { wentLast.add(g.id); stayedLast.delete(g.id); }
            const belief = strengthened(host, p.belief.told_bps);
            if (belief.after !== belief.before) outcome({ t, domain: "belief", option: host, kind: "joined", way: "mine", from: host, belief }, false);
            steps.push(because(`Joining ${host}: signing${dues ? ", and paying the dues monthly" : ""}.`, sign(r.id),
              ...(dues ? [pay(dues.to, cents(dues.amount), { from: acc.account, every: MONTH, first: 0, basis: r.id, for: "Dues." })] : [])));
            continue;
          }
          steps.push(because(`Joining the union: signing, and paying the dues monthly.`, sign(r.id),
            ...(dues ? [pay(dues.to, cents(dues.amount), { from: acc.account, every: MONTH, first: 0, basis: r.id, for: "Union dues." })] : [])));
          continue;
        }
        if (r.record !== "statement" || !(r.addressed_to ?? []).includes(me)) continue;
        // A ballot's declared result, sent to the members it was held among, is a published count of how many voted yes: a sighting of
        // what members do (docs/behaviour/culture.md), once.
        if (cul && r.kind === "ballot_result" && typeof r.data?.employer === "string" && Number(r.data.voted) > 0 && Number.isFinite(Number(r.data.yes)) && !countedBallots.has(r.id)) {
          countedBallots.add(r.id);
          const share = Math.round((Number(r.data.yes) * 10_000) / Number(r.data.voted));
          cul.seeShare("strike", share, "published");
          // (A count of a ballot taken in secret is also what those who voted thought: a sighting of what people approve, which can undo a street's ignorance of it.)
          cul.hearSaid("strike", share, "published");
        }
        // Voting, and how, follow the person: those who value others' welfare (benevolence, universalism) turn out and
        // back action more; those who value security, less (the town's rates stay as calibrated).
        const solidarity = (zValue("benevolence") + zValue("universalism")) / 2;
        // (A ballot about a workplace we've left isn't ours to vote in.)
        if (r.kind === "action_ballot" && r.data?.employer === job?.employer && ctx.rng(`turnout-${r.id}`).below(10_000) < shifted(p.ballot_turnout_bps, p.sway.turnout * solidarity)) {
          const yesChance = shifted(p.strike_vote_yes_bps, p.sway.strike_vote * (solidarity - zValue("security")) + (cul ? (cul.p.sway_milli / 1_000) * cul.lean("strike", t) : 0));
          const yes = ctx.rng(`vote-${r.id}`).below(10_000) < yesChance;
          cul?.act("strike", yes, t);
          // (Recorded as a choice, with the picture it was made from; the lean is in the chance beside the vote's own shift.)
          if (cul) decision({ t, domain: "strike", strategy: "deliberate", choice: yes ? "yes" : "no", options: [{ key: "yes", score: yesChance }, { key: "no", score: 10_000 - yesChance }], norm: cul.norm("strike", t) });
          steps.push(because(`The union's protected action ballot: voting ${yes ? "yes" : "no"}.`, vote(r.id, yes ? "yes" : "no")));
        }
      }
      if (striking && !striking.out && job) {
        striking.out = true;
        if (mem) mem.saw("strike", job.employer, t, t);
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
      // An answer to something we asked of the other party to an agreement: granted (the paper is withdrawn, the
      // wage raised, a new lease offered) or not; either way we learn what asking them is worth. A paper we asked
      // about and have no answer on after a fortnight is dealt with as it stands.
      for (const r of fresh) {
        if (r.record !== "statement" || r.kind !== "variation_answer" || !(r.addressed_to ?? []).includes(me)) continue;
        const about = String(r.data?.about ?? "");
        const by = r.speaks_for ?? r.author;
        const ok = !!r.data?.granted;
        const rd = readOf(r.id);
        learn("way", "ask", ok ? 10_000 : 1_000, { t, kind: ok ? "granted" : "refused", way: "mine", from: by, facts: { about } });
        const moved = landing(rd, by, ok, t, { tried: ok, trust: ok ? 2 : 1 });
        withRead(rd, moved);
        ties.add(by, ok ? 1_500 : -500, t, ok ? "granted" : "refused");
        if (ok && job && by === job.employer && about === job.agreement && Number(r.data?.wage) > job.wage) {
          outcome({ t, domain: "job", option: job.employer, kind: "rise", way: "mine", facts: { wage: Number(r.data.wage), was: job.wage, asked: true } });
          job.wage = Number(r.data.wage);
          job.paidAt = t;
        }
        if (askedOf.delete(about) && !ok) upheld.push(about);
        const w = wants.all().find((x) => x.on === about);
        if (w && ok) wantMet(w, "granted");
      }
      // ---- everyday frictions (docs/behaviour/frictions.md): what the other side answered, what a venue decided,
      // and what became of each thing gone wrong. What happens feeds trust in whoever it was, and the sense that
      // what we do counts; the next thing tried, if any, is the mind's.
      const wantOf = (g: Grievance) => wants.get(g.matter, g.about ?? g.party);
      const ended = (g: Grievance, how: string, good: boolean) => {
        grievances.delete(g.key);
        inner.note({ t, what: "friction_ended", about: g.matter, size: Math.min(10_000, Math.floor((t - g.since) / DAY)), by: `${how}${g.asked ? `; asked: ${g.answer ?? "no answer yet"}` : ""}${g.applied.size ? `; venues: ${g.applied.size}` : ""}` });
        outcome({ t, domain: "friction", option: g.matter, kind: "ended", way: "mine", from: g.party, facts: { how, put_right: good, days: Math.floor((t - g.since) / DAY), asked: !!g.asked, ...(g.answer ? { answer: g.answer } : {}), venues: g.applied.size, ...(g.amount !== undefined ? { amount: g.amount } : {}) } });
        const w = wantOf(g);
        if (w && good) wantMet(w, how);
        else if (w) wants.giveUp(w, t, how);
      };
      const again = (g: Grievance) => {
        const w = wantOf(g);
        if (w && initiative) pursue(w);
      };
      const civil = (who: string) => (kindOf(who) === "other" ? "civil_service" : kindOf(who));
      // A grievance already put when the year began (an opening caseload: a request or an application of ours, made
      // before it, brought forward on paper): ours, asked of or taken to whoever the paper names, and not asked again.
      if (fdial > 0) for (const r of fresh) {
        if (r.record !== "statement" || !r.data?.brought_forward || r.speaks_for !== me || (r.kind !== PAPER.request && r.kind !== PAPER.application)) continue;
        const matter = String(r.data.matter ?? r.data.kind ?? ""), party = String(r.data.against ?? (r.addressed_to ?? [])[0] ?? ""), since = Number(r.data.since ?? r.at);
        if (!matter || !party) continue;
        const g = grieve(t, matter, party, { ...(typeof r.data.about === "string" ? { about: r.data.about } : {}), ...(typeof r.data.structure === "string" ? { structure: r.data.structure } : {}), ...(typeof r.data.seeks === "string" ? { seeks: r.data.seeks } : {}) });
        g.since = Math.min(g.since, since);
        g.asked = { t: since };
        if (r.kind === PAPER.application) g.applied.set((r.addressed_to ?? [])[0] ?? party, { t: since });
      }
      for (const r of fresh) {
        if (r.record !== "statement" || !(r.addressed_to ?? []).includes(me)) continue;
        const by = r.speaks_for ?? r.author;
        // An office that waits for papers before it decides our claim asks for them (the law's, foundations F8): we send what we have, as a person does
        // when a letter comes, if it is for a claim of ours and we have not answered it.
        if (r.kind === DECISION.evidence_request && typeof r.data?.claim === "string" && typeof r.data?.need === "string" && by !== me && !evidenceSent.has(r.id)) {
          evidenceSent.add(r.id);
          steps.push(because(`${by} asks for papers for our claim ${r.data.claim} (${String(r.data.what ?? "what the law asks")}): sending them.`,
            say(DECISION.evidence, `For my claim ${r.data.claim}: ${String(r.data.what ?? "the papers asked for")}, as asked.`, { to: [by], visible: [me, by], basis: r.id, data: { claim: r.data.claim, need: r.data.need, request: r.id, ...(lastEmployer || job?.employer ? { last_employer: lastEmployer ?? job!.employer } : {}) } })));
          continue;
        }
        if (r.kind === PAPER.answer) {
          const g = [...grievances.values()].find((x) => x.matter === r.data?.matter && x.party === by && x.asked && !x.answer);
          if (!g) continue;
          const ok = !!r.data?.granted;
          g.answer = ok ? "granted" : "refused";
          g.answeredAt = t;
          const rd = readOf(r.id);
          learn("way", "ask", ok ? 10_000 : 1_000, { t, kind: ok ? "granted" : "refused", way: "mine", from: by, facts: { about: g.matter } });
          const moved = landing(rd, by, ok, t, { tried: ok, trust: ok ? 2 : 1 });
          withRead(rd, moved);
          if (rd && rdial) recourseBump.set(g.matter, recourseScore(rd.shift, rdial.params));
          ties.add(by, ok ? 1_000 : -1_000, t, ok ? "granted" : "refused");
          if (ok && g.amount !== undefined) {
            if (g.matter === "underpaid" && job && job.agreement === g.about) job.short = 0;
            ended(g, "put right on asking", true);
          } else if (ok) {
            g.promised = t;
            // (A refusal set aside: the claim is ours to make again.)
            if (g.matter === "claim_refused" && g.seeks) { refusedAt.delete(g.seeks); refusedOn.delete(g.seeks); }
          } else again(g);
        } else if ((r.kind === PAPER.decision || r.kind === "tribunal_order") && r.data?.applicant === me && typeof r.data?.matter === "string") {
          const g = [...grievances.values()].find((x) => x.matter === r.data!.matter && x.party === r.data!.against && x.applied.has(by));
          if (!g) continue;
          const f = String(r.data.finding);
          g.applied.get(by)!.finding = f;
          const won = f === "pay" || f === "do" || f === "set_aside" || f === "settled";
          const rd = readOf(r.id);
          learn("way", "desk", won ? 10_000 : f === "referred" ? 5_000 : 500, { t, kind: f, way: "mine", from: by, facts: { about: g.matter, days: Math.floor((t - g.applied.get(by)!.t) / DAY), binding: r.data.binding !== false } });
          if (f !== "referred") {
            withRead(rd, landing(rd, by, won, t, { tried: won, trust: 2, kind: civil(by) }));
            if (rd && rdial) recourseBump.set(g.matter, recourseScore(rd.shift, rdial.params));
          }
          if (f === "settled") ended(g, "settled", true);
          else if (won) {
            g.ordered = { id: r.id, by, binding: r.data.binding !== false, due: Number(r.data.due ?? t + 28 * DAY), amount: f === "pay" ? cents(r.data.amount ?? 0) : 0 };
            if (f === "set_aside" && g.matter === "claim_refused" && g.seeks) { refusedAt.delete(g.seeks); refusedOn.delete(g.seeks); }
          } else if (f !== "referred") again(g);
        }
      }
      // Told to leave our home for arrears (docs/behaviour/justice.md, "Possession"). A notice to vacate: we go by
      // its date, or stay (the rent we can pay is paid as it can be, as always; paid up, the notice lapses). An
      // application for possession: we answer the tribunal with what we could pay a month toward what is owed.
      // Its order: a plan (we stay), or possession by a date, which we obey or not. Its warrant carried out: we are out.
      for (const r of fresh) {
        // (The landlord has applied for possession of a home we have already left on its notice: we tell the
        // tribunal so. There is nothing left for it to order.)
        if (r.record === "statement" && r.kind === "hearing_notice" && r.data?.kind === "possession" && r.data?.against === me && leftHome && r.data?.about === leftHome.agreement && (!home || home.agreement !== leftHome.agreement)) {
          steps.push(because(`${leftHome.landlord} has applied for possession of ${leftHome.space}, which we left on ${dateWords(leftHome.at)}: telling the tribunal we have gone.`,
            say("tribunal_response", `Answer to application ${r.data.application}: we left ${leftHome.space} on ${dateWords(leftHome.at)}, on the landlord's notice to vacate, and gave notice on the lease. We are not there.`, { to: [r.speaks_for!], visible: [me, r.speaks_for!, leftHome.landlord], basis: String(r.data.application), data: { application: r.data.application, left: true, left_at: leftHome.at } })));
          continue;
        }
        // Asked by someone we know whether their household may stay with us (docs/behaviour/households.md, "Taken in
        // during the year"): yes where the home is ours to open, there is room for their bodies in it, nobody is
        // staying already, what we have coming in covers a month's essentials for every adult we would then hold who
        // has nothing coming in, and we are willing. Otherwise no, and why.
        if (r.record === "statement" && r.kind === "stay_request" && (r.addressed_to ?? []).includes(me) && r.speaks_for && r.speaks_for !== me) {
          // (Asked by a member of our own household for someone they know: their word stands for willingness.)
          const vouched = typeof r.data?.vouched_by === "string" && r.data.vouched_by === r.speaks_for && (household?.members ?? []).some((m) => m.person === r.speaks_for) && typeof r.data?.for === "string";
          const asker = vouched ? String(r.data!.for) : r.speaks_for, asking = String(vouched ? r.data?.request ?? r.id : r.id);
          const adultsIn = Number(r.data?.adults ?? 1), kids = Number(r.data?.children ?? 0), without = Number(r.data?.without_income ?? 0);
          const place = home?.movedIn ? home.space : null;
          const lean0 = initiative ? Math.max(-3, Math.min(3, zValue("benevolence"))) : 0;
          const willingOurselves = vouched || (ties.affinity(asker, t) >= (cul ? cul.term(Math.round(p.stay.willing_affinity_bps * (1 - 0.3 * lean0)), "take_in", t, -1) : Math.round(p.stay.willing_affinity_bps * (1 - 0.3 * lean0))) && (ties.trust(asker) ?? 0) >= (p.outlook.people_bps ?? 5_000));
          // (We live in a home that is someone else's to open, and would have them: we put it to whoever holds it.)
          if (!place && !vouched && !stay && livingAt && household && household.leaseholder !== me && willingOurselves) {
            outcome({ t, domain: "home", option: livingAt, kind: "asked_for_another", way: "mine", from: asker, facts: { adults: adultsIn, children: kids } });
            steps.push(because(`${asker} asks whether their household may stay with us: the home is ${household.leaseholder}'s to open; asking them.`,
              say("stay_request", `${asker}, whom I know, has no home and asks whether they may stay with us. They are ${adultsIn} adult${adultsIn > 1 ? "s" : ""}${kids ? ` and ${kids} child${kids > 1 ? "ren" : ""}` : ""}.`, { to: [household.leaseholder], visible: [me, household.leaseholder, asker], basis: r.id, data: { adults: adultsIn, children: kids, without_income: without, for: asker, vouched_by: me, request: r.id } })));
            continue;
          }
          const sp = place ? homeSite?.spaces.find((x) => x.space === place) : undefined;
          const ours = new Set((household?.members ?? [{ person: me }]).map((m) => m.person));
          const ownAdults = 1 + adults(t).length;
          const why = !place || !sp ? "not_mine" : tookIn.size > 0 ? "hosting" : ours.size + adultsIn + kids > sp.capacity ? "no_room"
            : householdIncome() < p.essentials * (ownAdults + without) ? "means"
            : !willingOurselves ? "not_willing" : undefined;
          if (!why) tookIn.add(asker);
          if (!why || why === "not_willing") cul?.act("take_in", !why, t); // (no room or no means is not a matter of willingness)
          outcome({ t, domain: "home", option: place ?? "none", kind: why ? "declined_to_take_in" : "took_in", way: "mine", from: asker, facts: { adults: adultsIn, children: kids, ...(why ? { why } : {}), ...(cul?.facts("take_in", t) ?? {}) } });
          steps.push(because(why ? `${asker} asks whether their household may stay with us: ${why === "not_mine" ? "the home is not ours to open" : why === "hosting" ? "someone is staying with us already" : why === "no_room" ? "there is no room for them here" : why === "means" ? "we could not carry them" : "we are not close enough to them"}; saying no.` : `${asker} asks whether their household may stay with us: there is room, and we are willing; saying yes.`,
            say("stay_answer", why ? `Answer to your asking ${asking}: no, we cannot take you in.` : `Answer to your asking ${asking}: yes. Come and stay with us at ${place}.`, { to: [asker], visible: [me, asker], basis: r.id, data: { request: asking, yes: !why, ...(why ? { why } : { space: place }) } })));
          continue;
        }
        // The answer of someone we asked. Yes, and we still have no dwelling: we go there as their guests, with the
        // children; the other adults are told. Our household's record stays ours, and we go on looking for a home.
        if (r.record === "statement" && r.kind === "stay_answer" && (r.addressed_to ?? []).includes(me) && r.speaks_for) {
          const host = r.speaks_for, yes = r.data?.yes === true && typeof r.data?.space === "string";
          if (yes && !home && !stay && livingAt === null && isLeaseholder()) {
            const space = String(r.data!.space);
            stay = { host, space, since: t };
            livingAt = space;
            gaveUp.delete(space);
            outcome({ t, domain: "home", option: space, kind: "taken_in", way: "mine", from: host, facts: { ...(homelessSince !== null ? { days_without: Math.floor((t - homelessSince) / DAY) } : {}), people: 1 + others().length } });
            inner.tried(true);
            ties.add(host, 2_000, t, "took_us_in");
            ties.trusted(host, true, 2_000);
            steps.push(because(`${host} will take us in: going to stay at ${space}${children(t).length ? ", with the children" : ""}.`, moveIn(space), ...children(t).map((k) => C.call("occupancy", { in: space, who: k.person }))));
            for (const a of adults(t)) steps.push(because(`${host} will take us in: telling the household to come.`, message([reach(a)], SAYING.moveIn(space))));
          } else if (!yes) {
            outcome({ t, domain: "home", option: "stay", kind: "not_taken_in", way: "mine", from: host, facts: { why: String(r.data?.why ?? "") } });
            inner.tried(false);
            if (r.data?.why === "not_willing") ties.add(host, -500, t, "refused");
          } else if (stay?.host !== host) steps.push(because(`${host} would take us in, and we no longer need it: telling them.`, say("stay_ended", "Thank you: we do not need to stay after all.", { to: [host], visible: [me, host], basis: r.id, data: { by: "guest" } })));
          continue;
        }
        // A stay ended. By our host (their own home has ended): we are out with them, and without a roof again. By
        // our guests (they have a home, or have gone): they are no longer with us.
        if (r.record === "statement" && r.kind === "stay_ended" && (r.addressed_to ?? []).includes(me) && r.speaks_for) {
          if (r.data?.by === "guest") tookIn.delete(r.speaks_for);
          else if (stay && stay.host === r.speaks_for) {
            const from = structureOf(stay.space);
            steps.push(because(`${stay.host}'s home has ended, where we were staying: leaving it${children(t).length ? ", with the children" : ""}.`, moveOut(from, me), ...children(t).map((k) => moveOut(from, k.person))));
            for (const a of adults(t)) steps.push(because("Where we were staying has ended: telling the household.", message([reach(a)], SAYING.moveOut(from))));
            outcome({ t, domain: "home", option: stay.space, kind: "stay_ended", way: "mine", from: stay.host, facts: { days: Math.floor((t - stay.since) / DAY) } });
            gaveUp.add(stay.space);
            stay = null; livingAt = null; stayAskedAt = null; stayEndedAt = t;
          }
          continue;
        }
        if (r.record !== "statement" || !home || home.owned) continue;
        // (The rent account as the year began, where rent was owed then: we owe it as we owe any rent the bank could
        // not pay, a rent at a time, the oldest first, and pay it when we can.)
        if (r.kind === "rent_statement" && r.data?.brought_forward && r.data?.lease === home.agreement && r.speaks_for === home.landlord && (r.addressed_to ?? []).includes(me) && r.data?.account) {
          const each = cents(r.data.rent ?? home.rent) || home.rent;
          for (let left = cents(r.data.owed ?? 0); left > 0; left -= each) missed.push({ instruction: r.id, to: String(r.data.account), amount: Math.min(each, left), what: "the rent" });
          continue;
        }
        if (r.kind === "notice_to_vacate" && r.data?.lease === home.agreement && (r.addressed_to ?? []).includes(me)) {
          // (A notice whose date had gone before it is first on our file, and we are still here: we stayed. That was
          // decided then; it is not drawn again.)
          const stays = Number(r.data.by) <= r.at && r.data?.brought_forward ? true : fixed(`stay-${home.agreement}`).below(10_000) < (cul ? cul.term(p.possession?.stay_bps ?? 0, "stay_past_notice", t) : (p.possession?.stay_bps ?? 0));
          if (!(Number(r.data.by) <= r.at && r.data?.brought_forward)) cul?.act("stay_past_notice", stays, t);
          home.vacate = { paper: r.id, by: Number(r.data.by) || t, stays };
          outcome({ t, domain: "home", option: home.space, kind: "notice_to_vacate", way: "mine", from: home.landlord, facts: { arrears: cents(r.data.arrears ?? 0), by: home.vacate.by, stays, ...(cul?.facts("stay_past_notice", t) ?? {}) } });
          inner.doneTo();
          // What being told to leave does to a tenant, whoever the landlord is and whatever paper says it: until
          // 2026-10-12 it was done by a notice on the lease alone, and under a law on possession that comes only
          // after an order, so a tenant given notice to vacate thought no less of the landlord, feared nothing,
          // told nobody at home and wanted nothing about it (320 such wants in the second living pilot, none in the
          // third). Once for a tenancy: a notice given again, or the lease's own notice later, is not a second blow.
          // (Being put out is the defining event, when it happens: not this.)
          if (!noticeSeen.has(home.agreement)) {
            noticeSeen.add(home.agreement);
            const by = home.landlord;
            inner.experience(by, kindOf(by), false, t, { weight: 2 });
            ties.add(by, -3_000, t, "notice");
            feelings.feel("fear", by, 5_000, t);
            noticedBy = { by, t };
            noticeOver.delete(home.agreement);
            if (initiative) { wantBorn(t, "notice", ["occupancy"], 1, "shelter", { whom: by, against: { record: home.agreement, kind: "notice", by } }); troubleToTell.push({ what: "notice", by }); }
          }
        } else if (r.kind === "plan_offer" && r.data?.lease === home.agreement && r.speaks_for === home.landlord && (r.addressed_to ?? []).includes(me)) {
          // The landlord offers a plan to pay what is owed: answered with what the household could pay a month
          // beyond its rent and essentials (the sum it would give a tribunal), yes if that covers the instalment.
          const can = Math.max(0, householdIncome() - home.rent - p.essentials), instalment = cents(r.data.instalment ?? 0);
          const accepts = instalment > 0 && can >= instalment;
          steps.push(because(`${home.landlord} offers a plan to pay the rent owed, ${usd(instalment)} a month: ${accepts ? "we can pay that" : can > 0 ? `we could pay ${usd(can)} a month, not that` : "we can pay nothing beyond the rent now"}; answering.`,
            say("plan_answer", accepts ? `Answer to your offer ${r.id}: yes. We can pay ${usd(instalment)} a month toward the rent owed, and the rent as it falls due.` : `Answer to your offer ${r.id}: no. ${can > 0 ? `We could pay ${usd(can)} a month toward the rent owed, beyond the rent` : "We can pay nothing beyond the rent now"}.`,
              { to: [home.landlord], visible: [me, home.landlord], basis: r.id, data: { offer: r.id, lease: home.agreement, accepts, can_pay: can } })));
          outcome({ t, domain: "home", option: home.space, kind: "plan_offered", way: "mine", from: home.landlord, facts: { instalment, can_pay: can, accepts } });
        } else if (r.kind === PAPER.request && r.data?.matter === "arrears" && r.data?.about === home.agreement && r.speaks_for === home.landlord && (r.addressed_to ?? []).includes(me)) {
          // Asked in writing for the rent owed: on our record that the landlord asked, and for how much. (What we
          // can pay we pay, as always: the asking changes nothing of that.)
          outcome({ t, domain: "home", option: home.space, kind: "rent_asked", way: "mine", from: home.landlord, facts: { amount: cents(r.data.amount ?? 0) } });
        } else if (r.kind === "hearing_notice" && r.data?.kind === "possession" && r.data?.against === me && r.data?.about === home.agreement) {
          // Served with an application for possession (docs/behaviour/justice.md, "A tenant's answer"). Whether we
          // answer at all is ours: as often as tenants here do (the world's figure), read against who we are. What
          // we tell is ours too, and all of it is our own to know: what we owe by our own reckoning, what we could
          // pay, why not, who lives here, how long we have, whether we have anywhere to go. Never a number of the
          // mind's; never anything of anyone else's.
          const tribunal = r.speaks_for!, app = String(r.data.application);
          const nth = (appliedFor.get(home.agreement) ?? 0) + 1;
          appliedFor.set(home.agreement, nth);
          const offer = Math.max(0, householdIncome() - home.rent - p.essentials);
          const claimed = cents(r.data.amount ?? 0);
          const owes = missed.filter((x) => x.what === "the rent").reduce((a, x) => a + x.amount, 0);
          const others_ = ties.closest(5, t).filter((x) => peopleWeKnow.has(x.who) && !(household?.members ?? []).some((m) => m.person === x.who));
          const goTo = acc.balance >= home.rent + p.essentials ? "means_for_another" : others_.some((x) => x.affinity >= 1_000 && x.trust >= (p.outlook.people_bps ?? 5_000)) ? "someone_to_ask" : "nowhere";
          let answers: boolean;
          const base = p.possession?.answer_bps;
          if (base === undefined) answers = offer > 0;
          else {
            let bps = base;
            if (initiative) {
              const S = wants.p.sway, way = mind.learned("way");
              bps = swayed(swayed(bps, inner.zTrust(tribunal, kindOf(tribunal), t), S.trust), inner.zAgency(), S.agency);
              if (way.known("desk")) bps = swayed(bps, (way.get("desk") - 5_000) / 5_000, S.trust);
              bps = swayed(bps, -(feelings.level("fear", home.landlord, t) - 5_000) / 5_000, S.agency);
              bps = swayed(bps, goTo === "nowhere" ? 0.5 : -0.5, S.attachment);
            }
            if (cul) bps = cul.term(bps, "answer_tribunal", t);
            answers = fixed(`answer-${home.agreement}-${nth}`).below(10_000) < bps;
          }
          cul?.act("answer_tribunal", answers, t);
          outcome({ t, domain: "home", option: home.space, kind: "possession_applied", way: "mine", from: home.landlord, facts: { owed: claimed, answer_by: Number(r.data.answer_by ?? r.data.hearing_at ?? t), offer, answers, ...(cul?.facts("answer_tribunal", t) ?? {}) } });
          if (answers) {
            // (How ready we are to say what we think of it: the gap our record keeps between what we think of the
            // landlord and what we say. Each further thing is told or left out by it; the money is always said.)
            const v = inner.viewOf(home.landlord);
            const holdsBack = initiative && v ? Math.min(10_000, Math.round((Math.abs(v.private - v.expressed) * 10_000) / Math.max(1, Math.abs(v.private)))) : 0;
            const tells = (what: string) => holdsBack <= 0 || fixed(`tells-${home!.agreement}-${nth}-${what}`).below(10_000) >= holdsBack;
            const data: { [k: string]: unknown } = { application: app, owes, offer, every_days: 30 };
            const said: string[] = [`we say ${usd(owes)} is owed today`, offer > 0 ? `we could pay ${usd(offer)} a month toward it, beyond the rent as it falls due` : "we can pay nothing toward it beyond the rent now"];
            if (owes < claimed) { data.disputes_sum = true; said[0] = `we say ${usd(owes)} is owed today, not ${usd(claimed)}`; }
            const ntv = home.vacate ? (book.records.get(home.vacate.paper) as StatementRecord | undefined) : undefined;
            const gave = ntv?.kind === "notice_to_vacate" ? Number(ntv.data?.by) - (Number.isFinite(Number(ntv.data?.given)) ? Number(ntv.data!.given) : ntv.at) : undefined;
            if (gave !== undefined && p.possession?.notice_days && gave < p.possession.notice_days * DAY) { data.disputes_notice = true; said.push(`the notice to vacate gave ${Math.floor(gave / DAY)} days, and the law asks ${p.possession.notice_days}`); }
            if (tells("why")) {
              if (!job && !ownWork && joblessSince !== null) { data.out_of_work_since = joblessSince; said.push(`out of work since ${dateWords(joblessSince)}`); }
              if ((job?.short ?? 0) > 0) { data.pay_short = true; said.push("our pay has come short of what was agreed"); }
              const refused = [...refusedOn.values()].sort((a, b) => b - a)[0];
              if (refused !== undefined) { data.claim = "refused"; data.claim_on = refused; said.push(`a claim for support was refused on ${dateWords(refused)}`); }
              else if (claiming.size) { data.claim = "pending"; said.push("a claim for support has been made and not decided"); }
              if ((obs.body?.conditions ?? []).some((x) => x.until > t)) { data.ill = true; said.push("there is illness in the home"); }
            }
            if (tells("household")) {
              const all = household?.members ?? [];
              const ages = all.map((m) => ageAt(m, t, year)).sort((a, b) => b - a);
              if (all.length) { data.people = all.length; data.children = ages.filter((a) => a < ADULT_YEARS).length; data.ages = ages; said.push(all.length === 1 ? `I live here alone (aged ${ages[0]})` : `${all.length} of us live here${data.children ? `, ${data.children} of them children` : ""} (aged ${ages.join(", ")})`); }
            }
            const signed = book.signedAt(home.agreement);
            // (A tenancy that began before the year has no day on our file: nothing is said of it.)
            if (signed !== undefined && signed > 0 && tells("lived")) { data.lived_days = Math.max(0, Math.floor((t - signed) / DAY)); said.push(`we have lived here ${data.lived_days} days`); }
            if (tells("go_to")) { data.go_to = goTo; said.push(goTo === "nowhere" ? "we have nowhere else to go" : goTo === "someone_to_ask" ? "there is someone we could ask to take us in" : "we have the means for another home"); }
            answeredApps.add(app);
            steps.push(because(`${home.landlord} has applied for possession of our home: answering the tribunal.`,
              say("tribunal_response", `Answer to application ${app}: ${said.join("; ")}.`, { to: [tribunal, home.landlord], visible: [me, tribunal, home.landlord], basis: app, data })));
          }
        } else if (r.kind === "tribunal_order" && r.data?.kind === "possession" && r.data?.against === me && r.data?.about === home.agreement) {
          const by = r.speaks_for!;
          const rd = readOf(r.id);
          if (r.data.finding === "possession") {
            // (The words of the order, where read, move the odds of obeying: the same draw, another threshold.)
            const obeyAt = rd && rdial ? obeyRate(p.possession?.obey_bps ?? 10_000, rd.shift, rdial.params) : (p.possession?.obey_bps ?? 10_000);
            const obeys = fixed(`obey-${home.agreement}`).below(10_000) < obeyAt;
            // (The order is on our record as its own event, with who made it: until 2026-10-12 only the notice was.)
            inner.happened("ordered_out", t, { about: by });
            const movedTrust = landing(rd, by, false, t, { trust: 2 });
            if (answeredApps.has(String(r.data.application))) learn("way", "desk", 500, { t, kind: "possession", way: "mine", from: by, facts: { about: "possession", answered: true } });
            home.vacate = { paper: r.id, by: Number(r.data.due) || t, stays: !obeys, ordered: true };
            outcome({ t, domain: "home", option: home.space, kind: "possession_ordered", way: "mine", from: home.landlord, facts: { by: home.vacate.by, obeys } });
            withRead(rd, { ...movedTrust, ...landing(rd, by, false, t, { doneTo: 1, feel: false }) });
          } else {
            home.vacate = undefined;
            noticeOver.add(home.agreement);
            const movedTrust = landing(rd, by, true, t, { trust: 2 });
            if (answeredApps.has(String(r.data.application))) learn("way", "desk", 10_000, { t, kind: String(r.data.finding), way: "mine", from: by, facts: { about: "possession", answered: true } });
            outcome({ t, domain: "home", option: home.space, kind: r.data.finding === "plan" ? "plan_ordered" : "possession_dismissed", way: "mine", from: home.landlord, facts: r.data.finding === "plan" ? { instalment: cents(r.data.instalment ?? 0), owed: cents(r.data.amount ?? 0) } : {} });
            withRead(rd, movedTrust);
          }
        } else if (r.kind === "warrant_executed" && r.data?.lease === home.agreement) {
          home.vacate = { paper: r.id, by: t, stays: false, ordered: true, removed: true };
          // (Put out by an officer: on our record with who did it.)
          if (r.speaks_for) { inner.happened("put_out", t, { about: r.speaks_for }); inner.experience(r.speaks_for, kindOf(r.speaks_for), false, t, { weight: 2 }); if (mem) mem.saw("put_out", r.speaks_for, t, t); }
        }
      }
      // (A notice to vacate that has lapsed: the arrears were paid.)
      if (home?.vacate && !home.vacate.ordered && book.withdrawn.has(home.vacate.paper)) { home.vacate = undefined; noticeOver.add(home.agreement); noticeSeen.delete(home.agreement); }
      // Ordered to pay someone (rent in arrears, by a tribunal that heard it): paid, if it can be and leave the
      // month's essentials; if not, it is theirs to have enforced.
      for (const r of fresh) {
        if (r.record !== "statement" || (r.kind !== "tribunal_order" && r.kind !== PAPER.decision) || r.data?.against !== me || r.data?.finding !== "pay" || typeof r.data?.matter !== "string") continue;
        const amount = cents(r.data.amount ?? 0);
        const pays = !!acc && typeof r.data.to === "string" && amount > 0 && acc.balance >= amount + p.essentials;
        outcome({ t, domain: "friction", option: String(r.data.matter), kind: "ordered_to_pay", way: "mine", from: String(r.data.applicant ?? ""), facts: { amount, paid: pays, binding: r.data.binding !== false } });
        inner.doneTo();
        if (pays) {
          acc!.balance -= amount;
          steps.push(because(`${r.speaks_for} orders us to pay ${r.data.applicant} ${usd(amount)}: paying it.`, pay(String(r.data.to), amount, { from: acc!.account, for: `Under ${r.id}.`, settles: r.id })));
        }
      }
      for (const g of [...grievances.values()]) {
        if (g.asked && !g.answer && t - g.asked.t >= (p.frictions.answer_days ?? 14) * DAY) {
          // No answer in the time anyone would give: ignored.
          g.answer = "ignored";
          learn("way", "ask", 0, { t, kind: "ignored", way: "mine", from: g.party, facts: { about: g.matter } });
          inner.tried(false);
          inner.experience(g.party, kindOf(g.party), false, t);
          again(g);
        }
        if (g.promised !== undefined && t - g.promised >= (p.frictions.promise_days ?? 45) * DAY) {
          // Said yes, and it is not done: worse than a no.
          g.promised = undefined;
          g.answer = "refused";
          inner.experience(g.party, kindOf(g.party), false, t, { weight: 2 });
          inner.tried(false);
          again(g);
        }
        const o = g.ordered;
        if (o && o.amount > 0 && (settledToUs.get(o.id) ?? 0) >= o.amount) {
          if (g.matter === "underpaid" && job && job.agreement === g.about) job.short = 0;
          ended(g, o.binding ? "paid under an order" : "paid on a recommendation", true);
          continue;
        }
        if (o && t >= o.due + DAY && !o.enforced) {
          o.enforced = true;
          if (o.amount > 0 && o.binding && p.tribunal && o.by === p.tribunal.entity) {
            steps.push(because(`${o.by} ordered ${g.party} to pay us ${usd(o.amount)} by day ${Math.floor(o.due / DAY)} and it is unpaid: asking for the order to be enforced.`,
              say("enforcement_request", `Request to enforce order ${o.id}: ${usd(o.amount)} unpaid.`, { to: [o.by], visible: [me, o.by], basis: o.id, data: { order: o.id, unpaid: o.amount } })));
          } else {
            // Ordered or recommended, and not done: this venue's word did not carry.
            inner.experience(o.by, civil(o.by), false, t);
            inner.tried(false);
            g.ordered = undefined;
            again(g);
          }
        }
        // Long enough with nothing in train: let go (it stays in the record as given up).
        if (t - g.since >= 365 * DAY && g.promised === undefined && (!g.ordered || t >= g.ordered.due + 90 * DAY)) ended(g, "let go", false);
      }
      // A cut of our hours our employer asks our agreement to (where the law asks for it): the alternative is that it lets
      // someone go. Whether we agree is the profile's share (`consent_bps`, a placeholder), drawn on our own stream.
      for (const q of hoursAsked.splice(0)) {
        if (!job || job.agreement !== q.agreement) continue;
        const agree = ctx.rng(`hours-consent-${q.agreement}-${Math.floor(t / DAY)}`).below(10_000) < q.consentBps;
        if (agree) job.coming = { at: Math.max(q.from, t + 3 * DAY), wage: q.wage };
        outcome({ t, domain: "job", option: job.employer, kind: agree ? "hours_agreed" : "hours_refused", way: "mine", facts: { minutes_week: Math.round(q.hours * 60), wage: q.wage, was: job.wage } });
        steps.push(because(agree ? `Our employer asks us to agree to cut hours (${q.hours} a week, ${usd(q.wage)} a pay), because there is not the trade for everyone's full week: agreeing, rather than see someone let go.` : `Our employer asks us to agree to cut hours (${q.hours} a week, ${usd(q.wage)} a pay): we do not agree.`,
          say("hours_reply", agree ? "I agree to the cut in my hours you asked for." : "I do not agree to the cut in my hours.", { to: [job.employer], visible: [me, job.employer], basis: q.notice, data: { agreement: q.agreement, agree, notice: q.notice } })));
      }
      // Pay come short: owed us by our employer, for as long as it is not put right.
      if (fdial > 0 && job?.short) grieve(t, "underpaid", job.employer, { about: job.agreement, amount: job.short, evidence: tendered(book.records.get(job.agreement)), cause: "short pay", size: 0.8 });
      // A home fallen into disrepair, as whoever lives there sees it: the landlord's to put right. Put right, or
      // left behind, it is over.
      {
        const D = p.frictions.disrepair;
        if (fdial > 0 && D && home && !home.owned && isLeaseholder() && homeSite?.structure === home.structure) {
          const level = variableToday(homeSite.variables?.[D.variable], t) ?? 0;
          const g0 = grievances.get(gkey("disrepair", home.landlord));
          if (level >= D.at && !g0) grieve(t, "disrepair", home.landlord, { structure: home.structure, seeks: "repair", need: "shelter", size: Math.min(1.2, 0.5 + (level - D.at) / (2 * Math.max(1, D.at))), cause: "wear" });
          else if (g0 && g0.structure === home.structure && level < D.at) {
            inner.experience(home.landlord, kindOf(home.landlord), true, t, { weight: g0.asked ? 2 : 1 });
            if (g0.asked) inner.tried(true);
            ended(g0, "repaired", true);
          }
        }
        for (const g of [...grievances.values()]) if (g.matter === "disrepair" && (!home || home.structure !== g.structure)) ended(g, "left", false);
      }
      for (const [paper, a] of [...askedOf]) if (book.withdrawn.has(paper) || t - a.t >= wants.p.answer_days * DAY) {
        askedOf.delete(paper);
        if (!book.withdrawn.has(paper)) upheld.push(paper);
      }
      // A home we left for another before its tenancy ended: its rent's orders are stopped once it has.
      for (const x of leftHomes.splice(0)) {
        if (t < (book.endsAt(x.agreement) ?? Number.MAX_SAFE_INTEGER)) leftHomes.push(x);
        else if (x.orders.length) steps.push(because("The tenancy of the home we left has ended: stopping its rent.", ...x.orders.map((o) => withdraw(o, "Tenancy ended; stop this standing order."))));
      }
      const upheldNow = upheld.splice(0).map((id) => book.records.get(id)).filter((r): r is Record => !!r);
      if (home && isLeaseholder()) for (const r of [...fresh, ...upheldNow]) {
        if (r.record !== "statement" || r.kind !== "rent_increase" || r.data?.lease !== home.agreement || !(r.addressed_to ?? []).includes(me)) continue;
        const rent = cents(r.data.rent);
        if (book.withdrawn.has(r.id)) continue; // (taken back: the rent stays as it was)
        // A rise is something to do something about, for one who takes initiative: a want (to pay no more), set
        // against what we can see (the landlord, who can hold it; the tribunal, if it breaks the law; another home;
        // better pay; spending less). Asked of the landlord or taken to the tribunal, the notice waits on the answer.
        if (initiative && rent > home.rent && !upheldNow.includes(r)) {
          const share0 = householdIncome() > 0 ? ((rent - home.rent) * 10_000) / householdIncome() : 10_000;
          const w = wantBorn(t, "rent_increase", ["money.from"], Math.min(1.5, 0.3 + share0 / 1_000), "security", { whom: home.landlord, against: { record: r.id, kind: "rent_increase", by: home.landlord },
            ...(household && household.members.length > 1 ? { with: household.leaseholder } : {}) });
          if (adults(t).length) troubleToTell.push({ what: "rent_increase", by: home.landlord });
          const took = w && w.tried === 0 ? pursue(w) : "";
          if (took.startsWith("ask:")) { askedOf.set(r.id, { t, by: home.landlord }); continue; }
          if (took.startsWith("desk:")) continue;
        }
        // A notice that breaks the tenancy law (as we read the law): some of us take it to the tribunal, and pay the rent
        // as it was meanwhile; an invalid notice changes nothing.
        if (p.tribunal && !challenged.has(r.id) && r.speaks_for && breaches(book, { block: "publish", kind: "rent_increase", data: r.data }, r.speaks_for, r.at).length) {
          challenged.add(r.id);
          const challenging = ctx.rng(`challenge-${r.id}`).below(10_000) < reads(p.tribunal.challenge_bps, p.tribunal.entity, "take_to_tribunal");
          cul?.act("take_to_tribunal", challenging, t);
          if (challenging) {
            outcome({ t, domain: "home", option: home.space, kind: "rent_increase", way: "mine", facts: { rent, was: home.rent, from: Number(r.data.from), challenged: true, ...(cul?.facts("take_to_tribunal", t) ?? {}) }, felt: [felt("feel", "anger", home.landlord, 4_000, t)] });
            steps.push(because(`A notice of rent increase that breaks the law: taking it to the tribunal, and paying the rent as it was meanwhile.`,
              say("tribunal_application", `Application: the notice of rent increase ${r.id} from ${r.speaks_for} breaks the law; we ask that it be found invalid.`, { to: [p.tribunal.entity], visible: [me, p.tribunal.entity, r.speaks_for], basis: r.id, data: { kind: "rent_increase", against: r.speaks_for, notice: r.id, evidence: evidence(r) } })));
            continue;
          }
        }
        // Angry with the landlord, the more so the more of our income it takes (a placeholder scale).
        const riseShare = householdIncome() > 0 ? ((rent - home.rent) * 10_000) / householdIncome() : 10_000;
        const angry = rent > home.rent ? felt("feel", "anger", home.landlord, 2_000 + 20 * riseShare, t) : undefined;
        const lease = book.records.get(home.agreement);
        const rentTo = lease ? leaseTerms(lease, me).rentTo : undefined;
        const bearable = householdIncome() > 0 ? rent * 10_000 <= householdIncome() * p.rent_bearable_share_bps : affordable(rent, acc.balance);
        outcome({ t, domain: "home", option: home.space, kind: "rent_increase", way: "mine", facts: { rent, was: home.rent, from: Number(r.data.from), bearable: !!(bearable && rentTo) }, ...(angry ? { felt: [angry] } : {}) });
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
            const due0 = firstDue(old, every);
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

      // With no dwelling: asking the people we are closest to whether we may stay with them (docs/behaviour/
      // households.md, "Taken in during the year"). All of them at once, the closest first; whoever says yes first
      // has us. Asked again after a while with no roof, of whoever we are close to then.
      if (isLeaseholder() && !home && !stay && livingAt === null && homelessSince !== null && (stayAskedAt === null || t - stayAskedAt >= p.stay.ask_again_days * DAY)) {
        const mine = new Set((household?.members ?? []).map((m) => m.person));
        const whom = ties.closest(p.stay.ask + mine.size + stayAsked.size, t).map((x) => x.who).filter((w) => peopleWeKnow.has(w) && !mine.has(w) && !stayAsked.has(w)).slice(0, p.stay.ask);
        for (const w of whom) stayAsked.add(w);
        stayAskedAt = t;
        const grown = adults(t), kids = children(t);
        const without = (monthlyIncome() > 0 ? 0 : 1) + grown.filter((a) => (memberPay.get(a.person) ?? 0) <= 0).length;
        if (whom.length) outcome({ t, domain: "home", option: "stay", kind: "asked_to_stay", way: "mine", facts: { asked: whom.length, adults: 1 + grown.length, children: kids.length } });
        for (const w of whom) steps.push(because(`We have no home: asking ${w}, whom we know, whether we may stay with them.`,
          say("stay_request", `We have no home. May we stay with you? We are ${1 + grown.length} adult${grown.length ? "s" : ""}${kids.length ? ` and ${kids.length} child${kids.length > 1 ? "ren" : ""}` : ""}.`, { to: [w], visible: [me, w], data: { adults: 1 + grown.length, children: kids.length, without_income: without } })));
      }
      // (Our guests are told if our own home has ended: they were there by our leave.)
      if (!home && tookIn.size) {
        for (const g of [...tookIn].sort()) steps.push(because(`Our home has ended: telling ${g}, who was staying with us.`, say("stay_ended", "Our home has ended: you cannot stay with us any longer.", { to: [g], visible: [me, g], data: { by: "host" } })));
        tookIn.clear();
      }
      // (In a home of our own again: whoever took us in is told we have gone.)
      if (home && stayAsked.size) stayAsked.clear();
      if (home && stay) {
        steps.push(because(`We have a home of our own: telling ${stay.host}, with our thanks.`, say("stay_ended", "We have a home of our own now. Thank you for taking us in.", { to: [stay.host], visible: [me, stay.host], data: { by: "guest" } })));
        outcome({ t, domain: "home", option: stay.space, kind: "stay_ended", way: "mine", from: stay.host, facts: { days: Math.floor((t - stay.since) / DAY), own_home: true } });
        stay = null;
      }
      // Leaving town (exit), decided by the leaseholder for the household: long without a home, or without
      // anyone earning and without money.
      const broke = acc.balance < Math.max(home?.rent ?? 0, p.essentials);
      // Patience with a place follows the person: those who value tradition and security hold on longer.
      // (And, for one whose attachments are read: those long here hold on longer than those newly come.)
      const patience = Math.max(0.5, Math.min(initiative ? 1.8 : 1.5, 1 + p.sway.patience_tradition * zValue("tradition") + p.sway.patience_security * zValue("security") + (initiative ? wants.p.sway.attachment * zAttached("place") : 0)));
      const homelessDays = Math.round(p.leave_after_homeless_days * patience);
      const joblessDays = Math.round(p.leave_after_jobless_days * patience);
      // (Days without a home count toward leaving only while there is no roof at all: not while someone has us.)
      const roofless = homelessSince !== null && !stay ? Math.max(homelessSince, stayEndedAt ?? 0) : null;
      const wouldLeave = isLeaseholder() && (
        (roofless !== null && t - roofless >= homelessDays * DAY) ||
        (joblessSince !== null && t - joblessSince >= joblessDays * DAY && earnedIncome() + (isLeaseholder() ? [...memberPay.values()].reduce((a, b) => a + b, 0) : 0) === 0 && broke));
      // (An owner who'd leave sells first, and goes once it's sold: docs/behaviour/ownership.md.)
      if (wouldLeave && home?.owned && p.market && !selling) { const lot = ownLot(); if (lot) sell(obs, lot, true); }
      const leave = wouldLeave && !home?.owned && !selling;
      if (leave) {
        const why = roofless !== null && homelessSince !== null && t - roofless >= homelessDays * DAY
          ? `Leaving town: ${Math.floor((t - homelessSince) / DAY)} days without a home (we leave after ${homelessDays}).`
          : `Leaving town: ${Math.floor((t - joblessSince!) / DAY)} days with nobody in the household earning (we leave after ${joblessDays}), and less money than a month's rent or essentials.`;
        const tell: Step[] = adults(t).map((a) => because(why, message([reach(a)], SAYING.leaving())));
        // (Whoever had taken us in is told we have gone.)
        if (stay) tell.push(because(why, say("stay_ended", "We are leaving town. Thank you for taking us in.", { to: [stay.host], visible: [me, stay.host], data: { by: "guest" } })));
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
        const mayCome = (w?: Eligibility) => !w || ((!w.members_of || memberOf(w.members_of)) && !w.holds && (!w.entities || w.entities.includes(me)) && (!w.min_age_years || age >= w.min_age_years) && (!w.dealing_with || dealsWith(w.dealing_with)));
        const there = (space: string) => street?.kind === "sites" ? (street.cells.flatMap((c) => c.structure?.spaces ?? []).find((sp) => sp.space === space)?.occupants ?? []).filter((o) => o !== me) : [];
        // Back from one: who was there, and how it was (turned away, it counts for nothing).
        if (attending && t >= attending.until) {
          const others = attending.seen ?? there(attending.space);
          const got = !!attending.gone || inside(attending.space);
          // (What it teaches, held, makes it mean more; and others there, keeping to it at a cost of their time, make it
          // more credible: Henrich's credibility-enhancing displays.)
          const meaning = Math.round(holdTo(attending.host) * p.belief.meaning);
          {
            const payoff = got ? Math.min(10_000, Math.round(Math.log1p(others.length) * 2_500) + meaning) : 0;
            const before = was("practice", attending.practice);
            mind.learn("practice", attending.practice, payoff);
            const after = now("practice", attending.practice);
            const belief = got ? strengthened(attending.host, Math.round((p.belief.display_bps * Math.min(20, others.length)) / 20)) : undefined;
            outcome({ t, domain: "practice", option: attending.practice, kind: got ? "attended" : "turned_away", way: "here", facts: { host: attending.host, ...(got ? { others: others.length } : {}), ...(meaning ? { meaning } : {}) },
              learned: { payoff, ...before, after }, ...(belief && belief.after !== belief.before ? { belief } : {}) });
          }
          if (got) {
            // (Before anything else: it's over now. Acts take time, so a plan's order is the order things get done.)
            if (!attending.gone) steps.unshift(because(`${attending.host}'s gathering is over (${others.length} others were there): going home.`, moveOut(attending.space, me)));
            companyAt.set(attending.practice, others.length);
            const mine = groups.get(attending.host);
            if (mine) mine.went = t;
            for (const o of others) {
              talked.set(o, t);
              ties.add(o, 100, t, "met"); peopleWeKnow.add(o);
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
              if (!mind.learned("practice").known("stay")) learn("practice", "stay", 5_000, { t, kind: "expected", way: "mine" }, false);
              const ours = book.ofType("agreement").some((a) => a.record === "agreement" && a.terms.parties.includes(me) && book.inForce(a.id) &&
                a.terms.commitments.some((c: any) => c.who === me && c.does?.outcome?.attend?.practice === r.id));
              if (ours) {
                wentLast.add(r.id);
                if (!mind.learned("practice").known(r.id)) learn("practice", r.id, Math.min(10_000, 7_000 + Math.round(holdTo(host) * p.belief.meaning)), { t, kind: "expected", way: "mine", facts: { host, member: true } }, false);
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
              learn("practice", "stay", levelsNow.social, { t, kind: "stayed", way: "mine", need: "social" });
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
        if (complainedOf === home.structure && days < 7) {
          // Collected after we wrote: writing made a difference, and the town did its part.
          complainedOf = null;
          inner.tried(true);
          inner.experience(p.complain_to, kindOf(p.complain_to), true, t);
        }
        // Angry with whoever should collect it, the more so the longer it's been (half-way at `complain_after_days`);
        // we write once our anger passes our own threshold (the conformist bears it longer), with the week's chance.
        if (now > 0) feelings.feel("anger", p.complain_to, Math.min(10_000, Math.floor(((t - binSeen.emptiedAt) * 5_000) / (DAY * p.complain_after_days))), t);
        const bearing = 5_000 + Math.round((mind.person.temperament.conformity - 5_000) * 0.4);
        // (And only while it's still there, a week or more on.)
        // (For one who takes initiative it is a grievance against whoever should have come, held until it is seen to.)
        if (now > 0 && days >= 7 && feelings.level("anger", p.complain_to, t) >= bearing && complainedOf !== home.structure) wantBorn(t, "service", [], feelings.level("anger", p.complain_to, t) / 10_000, "shelter", { whom: p.complain_to });
        const writes = complainNow || ctx.rng(`complain`).below(10_000) < reads(p.complain_bps, p.complain_to, "complain");
        complainNow = false;
        // (An occasion for the town's culture: a service failed and we are angry enough; noted once if we did not write, and when we do.)
        if (cul && now > 0 && days >= 7 && feelings.level("anger", p.complain_to, t) >= bearing && complainedOf !== home.structure && (writes || !complainNoted.has(home.structure))) {
          complainNoted.add(home.structure);
          cul.act("complain", writes, t);
          decision({ t, domain: "complain", strategy: "deliberate", choice: writes ? "write" : "not", options: [{ key: "write", score: reads(p.complain_bps, p.complain_to, "complain") }, { key: "not", score: 10_000 - reads(p.complain_bps, p.complain_to, "complain") }], norm: cul.norm("complain", t) });
        }
        if (now > 0 && days >= 7 && feelings.level("anger", p.complain_to, t) >= bearing && complainedOf !== home.structure && writes) {
          complainedOf = home.structure;
          inner.experience(p.complain_to, kindOf(p.complain_to), false, t);
          // (What is said against what is thought, for one whose views are read: the letter's words follow what
          // the person says of the town, which is not always what they think of it.)
          const says = initiative && p.electoral_town ? inner.viewOf(p.electoral_town)?.expressed : undefined;
          const tone = says === undefined ? "" : says <= -2_000 ? " It is not good enough." : says >= 2_000 ? " We would be grateful if it were seen to." : "";
          steps.push(because(`Our ${p.complain_about} hasn't been collected for about ${days} days: writing to the town.`,
            say("complaint", `Our ${p.complain_about} at ${home.structure} hasn't been collected for about ${days} days.${tone}`, { to: [p.complain_to], visible: [me, p.complain_to], data: { structure: home.structure, about: p.complain_about, days } })));
        }
      }

      // Looking for a home: what someone told us about first, then the best one we can afford among the listings we've seen.
      if (moveHunt && (t >= moveHunt.until || !home)) moveHunt = null;
      if (isLeaseholder() && (!home || (moveHunt && !home.owned))) {
        const fits = (l: StatementRecord) => l.data?.space !== home?.space && !applied.has(l.id) && affordable(l.data?.rent ?? Infinity, acc.balance) && (l.data?.bedrooms ?? 0) >= minBedrooms(t);
        const told = leadFound.homes.filter(fits);
        const listings = [...told, ...found.homes.filter((l) => !told.includes(l))].filter(fits);
        // Which one: the mind's (docs/design/ai-citizens.md 3). Each home's offer (its rent) and its bedrooms appraised
        // against needs; where friends told us to look counts as others having gone there. (A home we can't afford, or
        // without the bedrooms we must have, isn't considered.)
        const need = household ? bedroomsNeeded(household, t, year, p.occupancy) : 1;
        const toldBy = new Set(told.map((l) => l.id));
        const d = listings.length ? decide("home", t, ctx.rng(`home`), {
          options: listings.map((l) => {
            const f = l.offer ? factsOf(l.offer) : { money_per_month: -(l.data?.rent ?? 0), home: {} };
            return { key: l.id, facts: { ...f, home: { ...(f.home ?? {}), ...(Number.isInteger(l.data?.bedrooms) ? { bedrooms: l.data!.bedrooms as number } : {}) } }, others: toldBy.has(l.id) ? 1 : 0 };
          }),
          levels: needLevels(), circ: { ...circumstances(), homeBedroomsNeeded: need }, satisfied_here: 0,
        }) : undefined;
        const best = listings.find((l) => l.id === d?.key);
        if (best && typeof best.data?.space === "string") chose.set(`home:${best.data.space}`, decisions);
        if (best?.speaks_for) {
          applied.add(best.id);
          const members = household?.members.map((m) => m.person) ?? [me];
          const how = d!.strategy === "imitate" ? "where someone told us to look" : "weighing each home's rent and room";
          steps.push(because(`Applying for ${best.data.space}: within a third of household income, with at least ${minBedrooms(t)} bedrooms, ${how}.`,
            say("rental_application", `Application for ${best.data.space ?? best.data.structure}, for a household of ${members.length}.`, { to: [best.speaks_for], visible: [me, best.speaks_for],
            data: { listing: best.id, account: acc.account, members, household: { people: members.length, bedrooms_needed: household ? bedroomsNeeded(household, t, year, p.occupancy) : 0 } }, basis: best.id })));
        }
      }
      // Stopping work at our age for it (the world's one age, or our own): we give our employer notice.
      const age = obs.body ? Math.floor((t - obs.body.born_at) / year) : 0;
      if (!retired && stopAge !== null && age >= stopAge) {
        retired = true;
        if (job) {
          steps.push(because(stopAge === p.retirement_age ? `We've reached the retirement age (${p.retirement_age}): retiring, with the notice our job asks.` : `We've reached the age at which we stop work (${stopAge}): retiring, with the notice our job asks.`, notice(job.agreement, "Retiring.")));
        }
      }
      // Claims for support, as the published law sets the payments out (docs/behaviour/boundary.md): a payment for those
      // out of work, while out of work and looking (the first the law lists that hasn't refused us or run out); a payment
      // for age, from its age, working or not; a household's payment, as its head. Where a payment's rule turns on
      // what we know of ourselves (our household's income and children, another pension), we claim it only if we fit, and
      // declare those on the claim. A claim that no longer fits is stopped by saying so.
      const rules: PaymentRule[] = supportLaw(book)?.payments ?? [];
      if (job) {
        worked = true;
        ranOut.clear();
        for (const r of rules) if (r.who?.record) { refusedAt.delete(r.id); refusedOn.delete(r.id); } // (work is what a record is made of: worth asking again)
      }
      // A refused claim isn't made again until we're a year older; one that turns on a record of contributions, which
      // employers send in monthly, is tried again a month on.
      const blocked = (r: PaymentRule) => (r.who?.record ? refusedOn.has(r.id) && t - refusedOn.get(r.id)! < MONTH : refusedAt.get(r.id) === age);
      const facts = () => ({
        household_income: wageIncome() + (isLeaseholder() ? [...memberPay.values()].reduce((x, y) => x + y, 0) : 0),
        household_members: household?.members.length ?? 1,
        children_born_at: (household?.members ?? []).filter((m) => ageAt(m, t, year) < ADULT_YEARS).map((m) => m.born_at),
        other_pension: rules.some((r) => benefits.has(r.id) && !forOutOfWork(r) && !forHousehold(r)),
      });
      const fits = (r: PaymentRule): boolean => {
        const w = r.who ?? {}, f = facts();
        if (w.record && !worked) return false; // (nobody has reported pay for someone who hasn't worked here)
        if (w.income_under && (w.income_under.per === "head" ? Math.floor(f.household_income / f.household_members) : f.household_income) >= w.income_under.amount) return false;
        if (w.no_other_pension && rules.some((o) => o.id !== r.id && benefits.has(o.id) && !forOutOfWork(o) && !forHousehold(o))) return false;
        if (w.children && f.children_born_at.filter((b) => Math.floor((t - b) / year) < w.children!.under_age).length < w.children.least) return false;
        return true;
      };
      const looking = !job && !ownWork && !retired && p.in_labour_force; // (working for ourselves, we are not out of work)
      const stopgaps = rules.filter(forOutOfWork);
      // (The first the law lists that we may have; one we already draw is kept until an earlier one is granted.)
      const preferred = !looking ? undefined : stopgaps.find((r) => claiming.has(r.id)) ?? stopgaps.find((r) => !blocked(r) && !ranOut.has(r.id) && fits(r));
      const drawn = !looking ? undefined : stopgaps.find((r) => benefits.has(r.id));
      const wanted = (r: PaymentRule) => (forOutOfWork(r) ? r === preferred || (r === drawn && !(preferred && benefits.has(preferred.id)))
        : (forHousehold(r) ? isLeaseholder() : true) && age >= (r.who?.from_age ?? 0) && age <= (r.who?.to_age ?? Infinity) && fits(r));
      // (A payment already ours when the year began, granted on paper before it: drawn from the first day, not claimed again.)
      // (A claim made before the year began and not yet decided is waited on, not made again; one refused before it is
      // not made again until we are a year older, as one refused in the run: an opening caseload, docs/behaviour/generator.md.)
      for (const r of fresh) {
        if (r.record !== "statement" || !r.data?.brought_forward || typeof r.data?.payment !== "string") continue;
        if (r.kind === "benefit_claim" && r.speaks_for === me) { if (!book.all("benefit_decision").some((d) => d.data?.brought_forward && d.data?.claim === r.id)) claiming.add(r.data.payment); } // (one already decided, on paper, is not waited on)
        else if (r.kind === "benefit_decision" && r.data?.granted === false && (r.addressed_to ?? []).includes(me)) { refusedAt.set(r.data.payment, age); refusedOn.set(r.data.payment, t); claiming.delete(r.data.payment); }
      }
      for (const r of fresh) {
        if (r.record !== "statement" || r.kind !== "benefit_decision" || !r.data?.brought_forward || r.data?.granted !== true || !(r.addressed_to ?? []).includes(me)) continue;
        const payment = String(r.data.payment), rule = rules.find((x) => x.id === payment);
        benefits.set(payment, { claim: String(r.data.claim), payment, payer: rule?.payer ?? r.speaks_for!, amount: Number(r.data.amount), every: Number(r.data.every), lasting: !!rule && !forOutOfWork(rule) });
      }
      for (const b of [...benefits.values()]) {
        const r = rules.find((x) => x.id === b.payment);
        if (r && wanted(r)) continue;
        steps.push(because(`Our circumstances have changed (${job ? "working again" : retired ? "retired" : "no longer eligible"}): asking for our ${b.payment} payments to stop.`,
          say("benefit_change", `Please stop payment ${b.claim}.`, { to: [b.payer], visible: [me, b.payer], basis: b.claim, data: { claim: b.claim, stop: true } })));
        benefits.delete(b.payment);
      }
      for (const r of rules) {
        if (!wanted(r) || benefits.has(r.id) || claiming.has(r.id) || blocked(r)) continue;
        claiming.add(r.id);
        const declares = declarationFor(r, facts());
        steps.push(because(forOutOfWork(r) ? `Out of work: claiming ${r.id} support while we look.` : forHousehold(r) ? `Our household may be paid ${r.id} support: claiming it.` : retired ? `Retired, at ${age}: claiming ${r.id} support.` : `At ${age}: claiming ${r.id} support.`,
          say("benefit_claim", `Claim: ${r.id}.`, { to: [r.payer], visible: [me, r.payer], data: { payment: r.id, account: acc.account, born_at: obs.body?.born_at, ...(declares ? { declares } : {}) } })));
      }
      for (const r of fresh) {
        if (r.record !== "statement" || !(r.addressed_to ?? []).includes(me)) continue;
        const payment = String(r.data?.payment);
        if (r.kind === "benefit_end") {
          // A payment whose time has run out: it isn't claimed again until we've worked.
          if (benefits.get(payment)?.claim === r.data?.claim) benefits.delete(payment);
          ranOut.add(payment);
        }
        // (A refusal put right by the office on a second look, or set aside by a venue: the decision that grants it comes when we are no longer claiming.)
        if (r.kind !== "benefit_decision" || !(claiming.has(payment) || (r.data?.on_review && r.data?.granted === true && !benefits.has(payment)))) continue;
        const rule = rules.find((x) => x.id === payment);
        if (r.data?.granted) benefits.set(payment, { claim: r.data.claim, payment, payer: rule?.payer ?? r.speaks_for!, amount: r.data.amount, every: r.data.every, lasting: !!rule && !forOutOfWork(rule) });
        else {
          refusedAt.set(payment, age);
          refusedOn.set(payment, t);
          // (Refused: to one who believes they qualify, a wrong of the office's, to be looked at again.)
          if (fdial > 0 && r.speaks_for && !r.data?.reviewed) grieve(t, "claim_refused", r.speaks_for, { about: r.id, seeks: payment, evidence: tendered(r), size: 1, cause: String(r.data?.reason ?? "refused") });
        }
        if (r.data?.granted) for (const g of [...grievances.values()]) if (g.matter === "claim_refused" && g.seeks === payment) {
          grievances.delete(g.key);
          inner.note({ t, what: "friction_ended", about: g.matter, size: Math.min(10_000, Math.floor((t - g.since) / DAY)), by: `granted on review${g.asked ? `; asked: ${g.answer ?? "no answer yet"}` : ""}${g.applied.size ? `; venues: ${g.applied.size}` : ""}` });
          outcome({ t, domain: "friction", option: g.matter, kind: "ended", way: "mine", from: g.party, facts: { how: "granted on review", put_right: true, days: Math.floor((t - g.since) / DAY), asked: !!g.asked, venues: g.applied.size } });
          const w = wants.get(g.matter, g.about ?? g.party);
          if (w) wants.met(w, t, "granted on review");
        }
        // (A claim answered: what we asked for came, or did not; and the office that decides is trusted more, or less.)
        inner.tried(!!r.data?.granted);
        if (r.speaks_for) inner.experience(r.speaks_for, kindOf(r.speaks_for) === "other" ? "civil_service" : kindOf(r.speaks_for), !!r.data?.granted, t);
        claiming.delete(payment);
      }
      // Looking for work: where someone told us about first, then the best-paid posting.
      // (Someone who has given up on finding work is not looking, for as long as that lasts: they are out of the
      // labour force, as a survey would count them, and say so for their own record when it changes.)
      if (initiative && (job || ownWork) && discouragedUntil > 0) discouragedUntil = t;
      if (initiative && discouragedUntil > 0 && t >= discouragedUntil) {
        discouragedUntil = 0;
        steps.push(because(job || ownWork ? "In work again." : "Looking for work again.", say("work_search", "Looking for work again.", { visible: [me], data: { looking: true } })));
      }
      if ((!job || (searchingWork && !switching)) && !ownWork && !retired && p.in_labour_force && t >= discouragedUntil) {
        // In work, only postings that pay better than ours, elsewhere.
        // (For one who takes initiative, where the world says what holds people: only if it pays enough more, and
        // more the longer we have been where we are; the years before the world began count for the job we began with.)
        const held = heldIn(t);
        const better = (j: StatementRecord) => !job || (j.speaks_for !== job.employer && (j.data?.wage ?? 0) * job.period > job.wage * (j.data?.period ?? job.period) && (held === 0 || (j.data?.wage ?? 0) * job.period * 10_000 > job.wage * (j.data?.period ?? job.period) * (10_000 + heldIn(t, j.data?.industry))));
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
        const d = byEmployer.size ? decide("job", t, ctx.rng(`job`), {
          options: [...byEmployer].map(([e, j]) => ({ key: e, facts: j.offer ? factsOf(j.offer) : { money_per_month: Math.round(((j.data?.wage ?? 0) * MONTH) / (j.data?.period ?? 14 * DAY)), work_hours_per_month: 160 }, others: (toldBy.has(j.id) ? 1 : 0) + working.filter((n) => n.employer === e).length })),
          levels: needLevels(), circ: circumstances(), satisfied_here: job ? 10_000 : 0,
        }) : undefined;
        const best = d?.key ? byEmployer.get(d.key) : undefined;
        if (best?.speaks_for) {
          applied.add(best.id);
          if (typeof best.data?.industry === "string") industryOf.set(best.speaks_for, best.data.industry);
          const how = d!.strategy === "imitate" ? ", where people we know told us to look or work" : d!.strategy === "compare" ? ", with an employer we know" : ", weighing each job's pay and hours";
          steps.push(because(`Applying for a job at ${usd(best.data?.wage ?? 0)} a pay period${job ? `, better than ours (${usd(job.wage)})` : ""}${how}.`,
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
        outcome({ t, domain: "venture", option: "found", kind: "capital_called", way: "mine", facts: { firm: founded.firm, asked: Math.floor(Number(r.data?.amount) || 0), paid: Math.max(0, amount) } });
        // (A business of one: it is our work from now on. It trades from our home, and what it clears is our income.)
        if (founded.own && founded.firm) {
          ownWork = { firm: founded.firm, account: String(r.data.account), home: founded.own.home, expect_per_month: founded.own.expect };
          tradingFrom = founded.own.home;
          ownSince = t;
          nextOwnReview = t + MONTH;
        }
      }
      // Starting a business of one (docs/behaviour/entry.md, "Starting a business of one"): someone in the labour
      // force with a home to trade from, and savings for its stock beside a month or so of housing and essentials,
      // does it with the month's chance (the world's, from its place's business birth rate), shifted by who they are
      // as for any venture. Most new businesses are these: no premises, no staff. Someone in a job gives notice
      // first and starts when it has run; someone out of work starts at once.
      const ownV = p.ventures.find((v) => v.own);
      if (ownV && !founded && !ownWork && (p.found_own_ppm > 0 || t < ventureWanted) && !retired && p.in_labour_force && (venturing ? !job : t >= nextOwnVenture)) {
        nextOwnVenture = t + MONTH;
        const dwelling = home?.movedIn ? home.space : livingAt ?? null;
        const where = dwelling ? channels.cells(obs).find((c) => c.structure?.structure === structureOf(dwelling))?.cell : undefined;
        const housing = home?.rent ?? share?.cents ?? 0;
        const means = !!dwelling && !!where && acc.balance >= ownV.capital + p.found_own_buffer_months * (housing + p.essentials);
        const enterprise = p.sway.enterprise_openness * (zValue("stimulation") + zValue("self_direction")) / 2 + p.sway.enterprise_achievement * zValue("achievement");
        const chance = means ? Math.round((p.found_own_ppm * shifted(1_000, enterprise + (initiative && wants.all().some((w) => w.seeks.includes("work")) ? wants.p.sway.found : 0))) / 1_000) : 0;
        // (Someone who has meant to start a business, a founding's draw of that shape, does so when the means are there.)
        const founds = means && (!!venturing || t < ventureWanted || ctx.rng(`found-own`).below(1_000_000) < chance);
        if (means && !venturing) decision({ t, domain: "venture", strategy: "deliberate", choice: founds ? "found_own" : "not", options: [{ key: "found_own", score: t < ventureWanted ? 10_000 : Math.round(chance / 100) }, { key: "not", score: t < ventureWanted ? 0 : 10_000 - Math.round(chance / 100) }] });
        if (!means) venturing = null;
        else if (founds && job && !switching) {
          // (In a job: notice first. The business starts when the job has ended.)
          if (!venturing) {
            venturing = { at: t };
            if (t < jobEnds(job) && !(book.notices.get(job.agreement) ?? []).length) steps.push(because(`We have ${usd(acc.balance)} saved and mean to work for ourselves: giving notice at ${job.employer}, to start a business of our own when it has run.`, notice(job.agreement, "Resigning: starting a business of my own.")));
          }
        } else if (founds && !job) {
          venturing = null;
          const fill = (x: unknown): unknown => typeof x === "string"
            ? ({ "{structure}": structureOf(dwelling!), "{home}": dwelling, "{cell}": where, "{founder}": me, "{capital}": ownV.capital, "{values}": { ...mind.person.values } } as { [k: string]: unknown })[x] ?? x
            : Array.isArray(x) ? x.map(fill) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, fill(y)])) : x;
          founded = { capital: ownV.capital, paid: false, own: { home: dwelling!, expect: ownV.expect_per_month ?? 0 } };
          steps.push(because(`We have ${usd(acc.balance)} saved and a home to trade from: starting a business of our own there (${ownV.name.toLowerCase()}), putting in ${usd(ownV.capital)}.`,
            ["firm", C.call("entity", { kind: ownV.kind, name: C.text(`${ownV.name} (${me})`), position: C.text("Owner"), channels: C.json(fill(ownV.channels)), role_module: C.json(fill(ownV.role_module)) })]));
          pendingFirm = true;
        }
      }
      // Giving a business of one up: one that has not paid its owner a living for months is closed by them, and they
      // look for work again (a business that fails closes; most that close are closed by their owners:
      // docs/behaviour/entry.md). Not in its first months, while customers are still finding it.
      if (ownWork && ownSince >= 0 && t >= nextOwnReview) {
        nextOwnReview = t + MONTH;
        const months = Math.floor((t - ownSince) / MONTH);
        const since = t - p.give_up_months * MONTH;
        const drawn = drawnLog.reduce((x, d) => x + (d.t >= since ? d.amount : 0), 0);
        while (drawnLog.length && drawnLog[0]!.t < since) drawnLog.shift();
        if (months >= p.give_up_months && drawn * 10_000 < p.give_up_below_bps * p.essentials * p.give_up_months) {
          outcome({ t, domain: "own_work", option: ownWork.firm, kind: "given_up", way: "mine", facts: { months, drawn, essentials: p.essentials } });
          steps.push(because(`Our business has paid us ${usd(drawn)} in ${p.give_up_months} months, under ${p.give_up_below_bps / 100}% of what essentials cost: closing it, and looking for work.`,
            say("trading_from", "Closing: the business is given up.", { to: [ownWork.firm], visible: [me, ownWork.firm], data: { closed: true } })));
          ownWork = null;
          tradingFrom = null;
          ownSince = -1;
          founded = null;
        }
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
        // Recorded as a decision (docs/design/ai-citizens.md 7), from the chance as the person came to it.
        const weighing = !!l && saidFound !== "pending";
        // (And by wanting work of one's own: someone let go, or short of work, with the means, is likelier to.)
        const chanceFound = weighing ? (t < ventureWanted ? 10_000 : shifted(p.found_bps, enterprise + meantFound + (initiative && wants.all().some((w) => w.seeks.includes("work")) ? wants.p.sway.found : 0))) : 0;
        const founds = weighing && ctx.rng(`found`).below(10_000) < chanceFound;
        if (weighing) decision({ t, domain: "venture", strategy: "deliberate", choice: founds ? "found" : "not", options: [{ key: "found", score: chanceFound }, { key: "not", score: 10_000 - chanceFound }] });
        if (l && founds) {
          const v = p.ventures.find((x) => x.kind === l.data.type)!;
          const capital = (l.data.price as number) + v.capital;
          const fill = (x: unknown): unknown => typeof x === "string"
            ? ({ "{structure}": l.data.structure, "{cell}": l.data.cell, "{listing}": l.id, "{founder}": me, "{capital}": capital, "{values}": { ...mind.person.values } } as { [k: string]: unknown })[x] ?? x.replaceAll("{structure}", l.data.structure)
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
        // (A want long unmet, with little trust in the town and little belief that anything one does counts, sways it:
        // symmetric about the town's mean, as every sway is. Circumstances still decide who is ever in this position.)
        const strain = initiative && wants.all().some((w) => w.grown > 0 || w.tried >= wants.p.tries) ? -(inner.zAgency() + (p.electoral_town ? inner.zTrust(p.electoral_town, "government", t) : 0)) / 2 : 0;
        const chance = (cul ? (x: number) => cul.term(x, "take_from_employer", t) : (x: number) => x)(swayed(Math.round((p.crime.take_bps * (10_000 - p.crime.caught_bps)) / 10_000), strain, wants.p.sway.agency));
        const homeAt = home?.movedIn ? structureOf(home.space) : livingAt ? structureOf(livingAt) : undefined;
        const takes = !!homeAt && ctx.rng(`take`).below(10_000) < chance;
        if (homeAt) cul?.act("take_from_employer", takes, t);
        if (homeAt && cul) decision({ t, domain: "take", strategy: "deliberate", choice: takes ? "take" : "not", options: [{ key: "take", score: chance }, { key: "not", score: 10_000 - chance }], norm: cul.norm("take_from_employer", t) });
        if (takes) {
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
        // A bill well over what the last one came to a day is looked at twice (docs/behaviour/frictions.md): the
        // difference is what we say we were overcharged. It is paid all the same.
        if (fdial > 0 && amount > 0 && !billSeen.has(inv.id) && inv.speaks_for && Number(inv.data?.days) > 0) {
          billSeen.add(inv.id);
          const service = String(inv.data!.service), perDay = Math.round(amount / Number(inv.data!.days)), usual = billed.get(service);
          if (usual !== undefined && perDay * 10_000 > usual * (10_000 + (p.frictions.bill_over_bps ?? 1_500))) grieve(t, "bill", inv.speaks_for, { about: inv.id, amount: amount - usual * Number(inv.data!.days), evidence: tendered(inv), size: 0.5, cause: "over the usual" });
          else billed.set(service, perDay);
        }
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
          learn("shop", d.seller, served, { t, kind: "served", way: "mine", facts: { ordered: d.ordered, delivered: d.delivered, ...(d.refund > 0 ? { refund: d.refund } : {}), ...(d.order ? { order: d.order } : {}) } });
          if (d.seller === favourite) lastServed = served;
          // What was bought and is faulty (docs/behaviour/frictions.md): found at home, of no use, and paid for.
          // (The chance is for the days since goods last came home: a second delivery on one trip adds none.)
          const since = Math.max(0, Math.min(p.shop_every_days, Math.floor((t - faultSeen) / DAY)));
          faultSeen = t;
          if (fdial > 0 && d.delivered > 0 && ctx.rng(`faulty-${d.order}`).below(1_000_000) < chancePpm(p.frictions.faulty_bps_per_year ?? 0, since, fdial)) {
            const bad = Math.max(1, Math.round((d.delivered * (p.frictions.faulty_share_bps ?? 2_500)) / 10_000));
            const price = priceAt(d.seller)?.price ?? 0;
            spoiled += bad;
            mind.learn("shop", d.seller, Math.round((served * (d.delivered - bad)) / d.delivered));
            if (price > 0) grieve(t, "goods", d.seller, { about: d.order, amount: bad * price, evidence: { order: d.order, delivered: d.delivered, faulty: bad }, size: 0.4, need: "subsistence", cause: "faulty" });
          }
          if (short <= 0) continue;
          // Tried elsewhere now, if this trip can: another shop we know, by what we've learned of each, weighted, not the
          // town's cheapest (everyone short going there at once overwhelms it) and not one that's failed us. If not,
          // what came back is spent on the next trip: it was meant for goods we didn't get, not saved.
          const untried = trip && trip.tried.size < p.beta ? shops.filter((x) => !trip!.tried.has(x.shop)) : [];
          // (Chosen once: the draw is this order's own, the same however often it's made, so not once per shop looked at.)
          const chosen = untried.length ? mind.learned("shop").choose(ctx.rng(`retry-${d.order}`), untried.map((u) => ({ key: u.shop, value: 0 })), mind.person.temperament.openness).key : undefined;
          // (Recorded as a decision that follows the trip's: among the shops not yet tried, by what we've learned of each.)
          if (chosen !== undefined) {
            const a = mind.learned("shop");
            const trips = chose.get(`shop:${d.seller}`);
            decision({ t, domain: "shop", strategy: "compare", choice: chosen, ...(trips !== undefined ? { follows: trips } : {}),
              options: [...untried].sort((x, y) => (x.shop < y.shop ? -1 : x.shop > y.shop ? 1 : 0)).map((u) => ({ key: u.shop, score: Math.round(a.get(u.shop)), ...(a.known(u.shop) ? { learned: Math.round(a.get(u.shop)) } : {}) })) });
          }
          const next = untried.find((x) => x.shop === chosen);
          const retried = !!next && buy(next, Math.min(short, Math.floor((short * (priceAt(d.seller)?.price ?? next.price)) / next.price)), `${d.seller} could serve ${d.delivered} of the ${d.ordered} we wanted: trying ${next.shop} for the rest.`, d.order);
          if (!retried && d.refund > 0) deferred += d.refund;
        }
        if (t >= nextShop) {
          nextShop = t + p.shop_every_days * DAY;
          trip = { at: t, tried: new Set() };
          const r = ctx.rng(`shopping`);
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
          const shop = ctx.rng(`shop`).pick(shopAccounts);
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
          // (What was faulty is thrown out with what is used: it is gone, and the week is shorter for it.)
          const out = Math.min(total, Math.ceil(total / weeks) + spoiled);
          spoiled = 0;
          lines.push(C.call("work", { task: "consume", units: C.text(String(out)), at: homeAt }));
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
      // Wants whose time has come (never tried, or their way has had its time): what was tried is judged, and the
      // want is gone after again, grows, or is given up. At most two a week: most weeks, none.
      if (initiative) {
        const persistence = zValue("achievement") + zValue("self_direction") + inner.zAgency();
        let acted = 0;
        for (const w of wants.due(t, patience)) {
          if (acted >= 2) break;
          if (w.triedAt === t) continue;
          if (w.tried > 0 && w.way) {
            learn("way", kindOfWay(w.way), w.way === "wait" ? 3_000 : 2_000, { t, kind: "not_yet", way: "mine", facts: { about: w.about, tried: w.tried } });
            if (w.way !== "wait") inner.tried(false, 0.5);
            if (wants.wornOut(w, t, persistence) === "given_up") {
              // (Nothing left to try for making ends meet: ruin, as when the goal was given up.)
              if (w.about === "security") inner.happened("ruined", t);
              inner.tried(false);
              withdrew = { about: w.about, t };
              continue;
            }
          }
          pursue(w);
          acted += 1;
        }
        tellWants();
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
      thanked = felt("add", "gratitude", who, 6_000, t);
      ties.add(who, 2_000, t, "tip"); peopleWeKnow.add(who);
      ties.trusted(who, true, 2_000); // (what they told us was so)
      return ` (${who} told us to look there: we're grateful)`;
    };
    /** What we'd tell someone who asks how we are. */
    const newsOfMine = (asker?: string) => [
      favourite && mind.learned("shop").known(favourite) ? CATCHING_UP.shop(favourite, lastServed) : "",
      job ? CATCHING_UP.work(job.employer, !job.claimed) : "",
      job && p.union ? CATCHING_UP.union(isMember()) : "",
      ...[...wentLast].sort().map((id) => book.records.get(id)).flatMap((r) => (r?.record === "statement" && r.speaks_for ? [CATCHING_UP.goes(r.speaks_for)] : [])),
      ...[...new Set(book.assertions().filter((r) => (beliefs.get(r.id) ?? 0) >= p.belief.tell_at_bps).map((r) => r.speaks_for ?? r.author))].sort().map(CATCHING_UP.holds),
      // (Held less firmly, but still one's own, as someone would answer a census: said, without urging it on anyone.)
      ...[...new Set(book.assertions().filter((r) => { const b = beliefs.get(r.id) ?? 0; return b >= p.belief.affiliate_bps && b < p.belief.tell_at_bps; }).map((r) => r.speaks_for ?? r.author))].sort().map(CATCHING_UP.leans),
      letGo && lastSeenT - letGo.t <= p.news_days * DAY && !job ? CATCHING_UP.lostWork(letGo.by) : "",
      noticedBy && lastSeenT - noticedBy.t <= p.news_days * DAY ? CATCHING_UP.noticed(noticedBy.by) : "",
      // (What we say of the town: the expressed view, once we have one.)
      p.electoral_town && inner.viewOf(p.electoral_town) ? CATCHING_UP.town(inner.viewOf(p.electoral_town)!.expressed) : "",
      // (What we are after, and by what way; and what we have given up on: for one who takes initiative.)
      initiative && wants.all().length ? CATCHING_UP.after(wants.all().filter((w) => w.way).slice(0, 3).map((w) => ({ about: w.about, way: w.way!.startsWith("offer:") ? w.way! : w.way!.split(":")[0]! }))) : "",
      initiative && withdrew && lastSeenT - withdrew.t <= p.news_days * DAY ? CATCHING_UP.gaveUp(withdrew.about) : "",
      // (Culture: where we come from, and what we did at an occasion and say of it; docs/behaviour/culture.md.)
      ...(cul ? [...(cul.group && cdial!.homophily_bps > 0 ? [CULTURE_WORDS.from(cul.group)] : []), ...(asker ? cul.tell(asker, lastSeenT, p.news_days) : []), ...(asker ? [cul.gossip(asker, lastSeenT, () => ctx.rng("culture-gossip").below(10_000)) ?? ""] : []), ...(asker && mem ? [mem.tell(asker, lastSeenT, (kind) => { const c = EVENT_CONDUCT[kind], says = c ? cul.read(c, lastSeenT)?.says : undefined; return says !== undefined && Math.floor(says / 2_000) !== 2 ? says : undefined; }) ?? ""] : [])] : []),
    ].filter(Boolean).join(" ") || CATCHING_UP.nothing;
    /**
     * Being there (culture, step 5): in a building we are in the world shows who is there and who last left and why, so a removal carried out in our building,
     * is seen by us and by no one whose own place did not put them there. (A walk-out is not read off who left a workplace: people leave it at all hours, part-timers among them, and the world shows no cause. Those who stop work hold it as theirs; the rest are told.) Each departure is taken in once,
     * and only while it is recent (`witness_days`). What is seen is held (strongly), bears once on trust in whoever did it, and is a sighting of the conduct it shows
     * (the landlord applied; the household stayed past the notice). A building we are not in shows only that someone was seen leaving.
     */
    const witnessAround = (around: SiteStructure[], t: number) => {
      if (!mem || !cul) return;
      const W = cul.p, ours = new Set<string>([me, ...(household?.members ?? []).map((m) => m.person)]);
      const by = enforcerOfRemovals();
      if (by) for (const st of around) for (const sp of st.spaces) for (const d of sp.left ?? []) {
        if (d.reason !== "removed" || ours.has(d.occupant) || d.at > t || t - d.at > W.witness_days * DAY) continue;
        if (!mem.newSighting(`${sp.space}|${d.occupant}|${d.at}`)) continue;
        remember("put_out", by, d.at, t, "saw", W.seen_bps);
        cul.seeAct("apply_possession", true, "here");
        cul.seeAct("stay_past_notice", true, "here");
      }
    };
    const wordOfMouth = (obs: Observation, t: number, steps: Step[]) => {
      // The buildings around us; in our own we see who's there (they're the people we know).
      const around: SiteStructure[] = obs.channels.street?.kind === "sites" ? channels.structures({ ...obs, channels: { street: obs.channels.street } }) : [];
      for (const st of around) for (const sp of st.spaces) for (const o of sp.occupants ?? []) if (o !== me) contacts.set(o, t);
      if (mem) witnessAround(around, t);
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
        if (lead && ctx.rng(`pass-on-${q.from}`).below(10_000) < p.pass_on_bps)
          steps.push(because("Asked about room: passing on what we can see.", message([q.from], q.want === "home" ? `There looks to be room at ${lead}, near me.` : `They have room at my work, ${lead}.`, lead)));
      }
      asked = [];
      const known = [...contacts.keys()];
      // Catching up: answering those who asked how we are, and now and then asking someone we know (one at a time).
      for (const who of askedHow) {
        steps.push(because("Asked how things are: telling them.", message([who], newsOfMine(who))));
      }
      askedHow = [];
      // (Culture: what we hold to say to someone of what they did, said once, when we heard of it.)
      for (const v of verdicts) steps.push(because("Told what they did: saying what we make of it.", message([v.to], v.text)));
      verdicts = [];
      if (nextCatchUp === null) nextCatchUp = t + ctx.rng("catch-up").below(p.catch_up_days) * DAY;
      if (t >= nextCatchUp) {
        nextCatchUp = t + Math.round((p.catch_up_days * DAY) / (pursuing("catch up more") ? 2 : 1));
        if (known.length) {
          // Whom: more often those we're closer to.
          const pool = [...known].sort();
          const weights = pool.map((k) => Math.round((1_000 + Math.max(0, ties.affinity(k, t))) * likeness(k)));
          let r = ctx.rng(`catch-up`).below(weights.reduce((a, b) => a + b, 0));
          const who = pool.find((_, i) => (r -= weights[i]!) < 0) ?? pool.at(-1)!;
          talked.set(who, t);
          steps.push(because("Catching up with someone we know.", message([who], CATCHING_UP.ask)));
        }
      }
      for (const [want, needed, chance] of [["home", isLeaseholder() && !home, p.ask_home_bps], ["work", !job && !ownWork, p.ask_work_bps]] as [Want, boolean, number][]) {
        if (!needed) {
          delete askedAt[want];
          continue;
        }
        if (askedAt[want] !== undefined && t - askedAt[want]! < p.ask_again_days * DAY) continue;
        askedAt[want] = t;
        if (known.length && ctx.rng(`ask-${want}`).below(10_000) < chance) steps.push(because(`Starting to look for ${want === "home" ? "a home" : "work"}: asking the people we know.`, message(known, ASKING[want])));
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
      if (tenancy && noticed) {
        const angry = felt("feel", "anger", tenancy.landlord, 6_000, t);
        if (!noticeSeen.has(tenancy.agreement)) outcome({ t, domain: "home", option: tenancy.space, kind: "notice_received", way: "mine", facts: { from: tenancy.landlord }, felt: [angry] });
        noticeSeen.add(tenancy.agreement);
      }
      const aggrieved = !!tenancy && (burden >= p.rent_burden_grievance_bps || feelings.level("anger", tenancy.landlord, t) >= p.aggrieved_bps);
      const open = found.petitions.filter((x) => (x.data?.demand?.tags ?? []).includes("tenant_protection"));
      // An organiser closes their petition after `petition_days`; a new one can then start.
      for (const pet of open) if (pet.speaks_for === me && t - pet.at >= p.petition_days * DAY && !signed.has(`closed-${pet.id}`)) {
        signed.add(`closed-${pet.id}`);
        steps.push(because(`Closing our petition after ${p.petition_days} days.`, withdraw(pet.id, "Petition closed.")));
        outcome({ t, domain: "petition", option: "start", kind: "closed", way: "mine", facts: { petition: pet.id, signatures: petitionSignatures(book, pet.id) + 1, days_open: Math.floor((t - pet.at) / DAY) } });
      }
      // (Recorded as a decision, from the chance: docs/design/ai-citizens.md 7.)
      const weighing = willing && aggrieved && open.length === 0;
      const starts = weighing && ctx.rng(`petition`).below(10_000) < p.petition_start_bps;
      if (weighing) decision({ t, domain: "petition", strategy: "deliberate", choice: starts ? "start" : "not", options: [{ key: "start", score: p.petition_start_bps }, { key: "not", score: 10_000 - p.petition_start_bps }] });
      if (starts) {
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
            outcome({ t, domain: "petition", option: "start", kind: "signatures", way: "mine", facts: { petition: pet.id, signatures: n, days_open: Math.floor((t - pet.at) / DAY) } });
          }
          continue;
        }
        if (signed.has(pet.id) || !willing) continue;
        const share = (publishedCount(book, pet) * 10_000) / p.population;
        // (Recorded as a decision when we sign, and once when we first see it and do not: the share of the town that
        // has signed, as published, against our own threshold.)
        // (What is said against what is thought: signing is said in public, and one who says less of their landlord
        // than they think, for fear of them, waits for more to have signed.)
        const view = initiative && tenancy ? inner.viewOf(tenancy.landlord) : undefined;
        const hush = view ? Math.min(1, Math.abs(view.private - view.expressed) / 5_000) : 0;
        const signs = signNow.has(pet.id) || (aggrieved && hush < 1) || ((home || livingAt) && share >= threshold * (1 + hush));
        if (signs || !petitionSeen.has(pet.id)) decision({ t, domain: "petition", strategy: aggrieved ? "deliberate" : "imitate", choice: signs ? "sign" : "not", options: [{ key: "not", score: threshold }, { key: "sign", score: Math.round(share) }] });
        petitionSeen.add(pet.id);
        if (signs) {
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
    /** For the record: who ended an agreement of ours, as far as its notices say (ours, the other side's, or its term). */
    const endedBy = (agreement: string): string => {
      const ns = book.notices.get(agreement) ?? [];
      return ns.some((n) => n.as === me) ? "self" : ns.length ? "other" : "term";
    };
    const jobEnds = (j: Job) => Math.min(j.leftAt ?? Number.MAX_SAFE_INTEGER, endsAt(j));
    const children = (t: number) => others().filter((m) => ageAt(m, t, year) < ADULT_YEARS);
    const adults = (t: number) => others().filter((m) => ageAt(m, t, year) >= ADULT_YEARS);
    /** Fewest bedrooms to look for: what the standard asks, less one for each stretch spent hunting without finding it. */
    const minBedrooms = (t: number) => {
      if (!household) return 0;
      const relax = homelessSince === null ? 0 : Math.floor((t - homelessSince) / (p.accept_fewer_bedrooms_after_days * DAY));
      return Math.max(0, bedroomsNeeded(household, t, year, p.occupancy) - relax);
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
      if (here && street?.kind === "sites" && street.cells.some((c) => c.structure?.spaces.some((sp) => sp.space === here && sp.kind === "dwelling")) && !gaveUp.has(here)) lastDwelling = here;
      if (lastDwelling && gaveUp.has(lastDwelling)) lastDwelling = undefined;
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
      // (On strike from the moment we know of the stoppage, not only once we have walked out: someone who learned of it
      // in the middle of something else went in to work the next morning, until 2026-10-09.)
      if (job?.workplace && !offSick && !striking && t < jobEnds(job) && workday(t, r.work_days) && tod(t) >= r.work_start && tod(t) < r.work_end) return job.workplace;
      // (Working for ourselves from somewhere other than home, a pitch: there in working hours.)
      if (ownWork?.at && !offSick && workday(t, r.work_days) && tod(t) >= r.work_start && tod(t) < r.work_end) return ownWork.at;
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
        // (Looked up, a home being relisted is found with no listing standing: a seller takes it off and lists it again
        // for less at their next week's plan. So it is gone when a look more than a week after the first that found
        // none still finds none. Shown listings unasked, as before: gone when it is not there.)
        if (forSale) b.goneSince = undefined;
        else b.goneSince ??= p.sale_board ? saleSeenAt : -Infinity;
        const gone = !forSale && (p.sale_board ? saleSeenAt : t) - b.goneSince! > 7 * DAY;
        if (declined || gone || t - b.since > 60 * DAY) buying = null;
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
        if (ctx.rng(`buy`).below(10_000) < m.buy_bps && borrowing.canApply(t)) {
          const rooms = minBedrooms(t);
          const l = forSaleNow()
            .filter((r) => r.data?.type === "home" && r.speaks_for !== me && Number(r.data?.bedrooms ?? rooms) >= rooms && acc.balance * 10_000 >= Number(r.data?.price) * (m.deposit_bps + m.costs_bps))
            .sort((a, b) => Number(a.data?.price) - Number(b.data?.price) || (a.id < b.id ? -1 : 1))[0];
          if (l) {
            const price = Number(l.data!.price);
            // (The deposit rounded up to a whole unit, the loan the rest: what a lender's share of the price admits.)
            const loan = loanFor(price, m.deposit_bps);
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
        if (c.holder !== me || c.about?.kind !== "debt" || !c.counterparty || pursued.has(c.id) || (!applyDebtNow.has(c.id) && t - c.at < tr.apply_after_days * DAY)) continue;
        pursued.add(c.id);
        const owed = cents(c.about.amount) - (settledToUs.get(c.id) ?? 0);
        if (owed <= 0 || !acc) continue;
        const applying = applyDebtNow.has(c.id) || ctx.rng(`apply-${c.id}`).below(10_000) < reads(tr.apply_bps, tr.entity, "take_to_tribunal");
        if (!applyDebtNow.has(c.id)) cul?.act("take_to_tribunal", applying, t);
        if (!applying) continue;
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
      if (ctx.rng(`care-${ill.kind}-${ill.since}`).below(10_000) >= c.seek_bps) return;
      atClinic = { condition: ill.id, since: t };
      steps.push(because(`A ${ill.severity} ${ill.kind}: going to the clinic.`, moveIn(c.waiting),
        say("care_request", `Asking to be seen: a ${ill.severity} ${ill.kind}.`, { to: [c.entity], visible: [me, c.entity], data: { condition: ill.id, kind: ill.kind, severity: ill.severity } })));
    };

    const civic = (obs: Observation, t: number, steps: Step[]) => {
      if (!p.electoral_town || !obs.body || t - obs.body.born_at < ADULT_YEARS * year) return;
      const town = p.electoral_town;
      const electoral = p.electoral_body ?? town;
      // On the roll: enrolled at the start, or now (of age, or new to town), once.
      if (enrolled === null) enrolled = book.all("enrolment").some((r) => r.speaks_for === me);
      if (!enrolled) {
        enrolled = true;
        steps.push(because("Of voting age (or new to town) and not on the roll: enrolling, as the law requires.", say("enrolment", `Enrolment: ${me}.`, { to: [electoral], visible: [me, electoral], data: { born_at: obs.body.born_at } })));
      }
      // Approval of the town's government, weekly: our own fortunes (retrospective, economic voting) and our anger at the
      // town, remembered over about half a year; and what we read of it in the paper.
      if (approvedAt < 0 || t - approvedAt >= 7 * DAY) {
        approvedAt = t;
        const signal = Math.max(-10_000, Math.min(10_000, 2 * (satisfaction(mind.person, levelsNow) - 5_000) - feelings.level("anger", town, t)));
        approval = Math.round(approval + (signal - approval) / Math.max(1, p.civic.approval_memory_weeks));
        // What we think of how the town is run, and what we say (docs/design/ai-citizens.md 10c): the town governs us,
        // which is some hold over us (a placeholder for how much); what those we know say of it is what is safe to say.
        const said = newsNow(t).flatMap((n) => (n.town !== undefined ? [n.town] : []));
        inner.view(town, approval, { dependence: 3_000, fear: Math.max(feelings.level("fear", town, t), feelings.level("fear", "money", t)), trust: inner.trustIn(town, "government", t),
          ...(said.length ? { norm: Math.round((said.reduce((a, b) => a + b, 0) * 6_000) / said.length) } : {}) });
      }
      // The paper's news (docs/behaviour/news.md): what's published in the paper's name, and nobody else's statement of
      // the kind; about the government; each item once. Its tone as the paper gives it, -1 to 1: one beyond that counts
      // as the limit, one that isn't a number as none. (Until 0.35.6 any statement of kind `news` was read, whoever
      // published it, with whatever tone it claimed: one item from anyone could set a reader's approval to either end.)
      if (mem && readsNews && p.paper) for (const r of book.open("news")) {
        // (An event in the paper, read: held at the paper's weight for the item, to `read_bps`; who made the law, the budget, the result or the decision is on the record it reports.)
        const reported = PAPER_WEIGHT[String(r.data?.kind)];
        if (!reported || r.speaks_for !== p.paper || readNews.has(r.id)) continue;
        readNews.add(r.id);
        const basis = basesOf(r)[0] !== undefined ? book.records.get(basesOf(r)[0]!) : undefined;
        const by = (basis?.record === "statement" ? basis.speaks_for : undefined) ?? p.electoral_town;
        if (by) remember(reported.kind, by, r.at, t, "read", paperStrength(reported.weight, cul!.p));
      }
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
        const drive = 1 + 0.5 * zValue("achievement") + 0.5 * zValue("power") + (approval < 0 ? -approval / 5_000 : 0) + (initiative ? wants.p.sway.agency * inner.zAgency() : 0);
        if (!standNow.has(n.id) && ctx.rng(`stand-${n.id}`).below(10_000) >= shifted(p.civic.stand_bps, drive - 1)) continue;
        const top = (Object.keys(mind.person.values) as Value[]).sort((a, b) => zValue(b) - zValue(a) || (a < b ? -1 : 1)).slice(0, 2);
        const platform = `Standing for ${n.data?.office}: for ${top.join(" and ")}.`;
        steps.push(because(`An election: standing for office (drive ${drive.toFixed(2)}; we think the town is run ${approval >= 0 ? "well enough" : "badly"}).`,
          say("nomination", platform, { to: [electoral], visible: "public", data: { office: n.data?.office, name: me, values: top }, assertion: { that: platform } })));
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
        decision({ t, domain: "vote", strategy: "deliberate", choice: scores[0]!.key, options: scores.map((x) => ({ key: x.key, score: x.score })) });
        steps.push(because(`Voting: ranking the ${scores.length} candidates (our approval of the town's government: ${approval}).`, vote(b.id, scores.map((x) => x.number).join(">"), [electoral])));
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
      // (A union member in work tells the union they no longer are, as members keep their details up: their membership
      // runs on for its notice, and until 2026-10-09 the union went on taking them to work there for as long.)
      if (job && p.union && isMember() && toldUnion !== "") {
        toldUnion = "";
        s.push(say("membership_update", "I'm no longer in work.", { to: [p.union], visible: [me, p.union], data: { employer: "" } }));
      }
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
    let childRecordAt = 0;

    return {
      /** Our job and home, as we have them (truth audits). */
      // (Someone leaving has given notice on everything and holds nothing more to be true of the town; found
      // 2026-10-08: one who took a job and left in the same wake, with a step still queued behind the leaving, was
      // never marked gone, and a letter weeks later woke them still believing in the job.)
      beliefs: (): Belief[] => departed || leaving ? [] : [
        ...(job ? [{ of: "agreement" as const, agreement: job.agreement, in_force: true }] : []),
        ...(home && !home.owned ? [{ of: "agreement" as const, agreement: home.agreement, in_force: true }] : []),
      ],
      step(obs): ParticipantAction | Promise<ParticipantAction> {
        // What was decided and what was learned since our last action go with this one, whatever it is (a symbol each:
        // never part of the action).
        const carry = (action: ParticipantAction): ParticipantAction => {
          if (decided.length) Object.defineProperty(action, DECISIONS, { value: decided.splice(0), enumerable: false });
          if (outcomes.length) Object.defineProperty(action, OUTCOMES, { value: outcomes.splice(0), enumerable: false });
          if (recordChange) {
            Object.defineProperty(action, RECORD, { value: recordChange, enumerable: false });
            recordChange = null;
          }
          return action;
        };
        const action = wake(obs);
        return action instanceof Promise ? action.then(carry) : carry(action);
      },
    };
    function wake(obs: Observation): ParticipantAction | Promise<ParticipantAction> {
      {
        if (leaving && obs.body && !obs.body.present) departed = true; // gone from the world: nothing more is ours to do
        if (departed) return wait(ctx.world.runEnd + DAY);
        // Where the hours since we last woke went, by where we are.
        // (Someone who came to town in the run first wakes then: the time before it is not theirs to count. Until
        // 2026-10-12 a newcomer's first record held every day since the year began as hours "away", and one arriving
        // after a year broke the record's own bound.)
        if (lastSeenT === 0 && obs.t > DAY) inner.hoursBegin(obs.t);
        else if (obs.body?.present) inner.spent(whereAt(obs.body.in), obs.t - lastSeenT);
        lastSeenT = obs.t;
        absorb(obs);
        // (Taken out of the world with our household, or gone from it: nothing more here.)
        if (obs.body && !obs.body.present) return wait(ctx.world.runEnd + DAY);
        heardGo(obs);

        // A child does nothing on their own (their parents house them) until they're 18, except ask for help if no
        // adult of the household is left: all of them seen to die (in our home), or gone from it.
        if (obs.body && obs.t - obs.body.born_at < ADULT_YEARS * year) {
          // (Told by our household that the tenancy of our home has ended: it is no longer where we go back to.)
          for (const m of obs.inbox) {
            const what = household?.members.some((x) => x.participant === m.from && x.person !== me) ? hear(m.text) : undefined;
            if (what?.kind === "moveOut") for (const d of [lastDwelling, livingAt]) if (d && structureOf(d) === what.from) gaveUp.add(d);
          }
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
          // (A child's record: who they are, whom they are tied to, where their hours go; written when it has moved, a
          // month at a time.)
          if (written.size === 0 || obs.t - childRecordAt >= MONTH) {
            childRecordAt = obs.t;
            writeRecord(obs.t, false);
          }
          const go = goWhereWeBelong(obs);
          if (go) return sendGo(go);
          return wait(Math.min(obs.t + MONTH, ctx.world.runEnd + DAY, p.round ? nextChange(obs.t) : Infinity));
        }
        // A death at home, seen now: what it asks of us is done first, and the week's plan is made afresh as soon as
        // that is done (who holds the lease may have changed, and with it who must find the household a home).
        const mournedBefore = mourned.size;
        todo.push(...seeDeathAtHome(obs).filter((s) => s.length));
        if (mourned.size > mournedBefore) nextPlanAt = Math.min(nextPlanAt, obs.t);
        // A silent home beside us, when the silence has gone on long enough: asked about now, as an act of its own (it
        // is no part of the week's plan, and makes none).
        if (todo.length === 0) {
          const wonder = wonderNextDoor(obs);
          if (wonder) return callAction(wonder);
        }
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
          const budget = cheaperThan ? Math.min(usual, cheaperThan.rent) : moveHunt?.beat !== undefined ? Math.min(usual, moveHunt.beat) : usual;
          const needHome = isLeaseholder() && (!home || (!!moveHunt && obs.t < moveHunt.until && !home.owned));
          const rooms = minBedrooms(obs.t);
          const roomy = rooms > 0 ? [{ field: "data.bedrooms", op: ">=" as const, value: rooms }] : [];
          // Told about a building? Look there first: what's on offer in it now.
          // (Only someone who wants what a building might offer: a home, or work. Someone out of work and not looking
          // for any, retired say, used to ask to look at nothing, which is refused: found in the stress run of 2026-10-06.)
          if (looking === null && lookedAt !== obs.t && acc && leads.length && (needHome || (!job && !ownWork && !retired && p.in_labour_force))) {
            const lead = leads.pop()!;
            const looks: LookRequest[] = [];
            if (needHome) looks.push(ask.board("homes", { most: p.search_limit, where: [{ field: "data.structure", op: "=", value: lead }, { field: "data.rent", op: "<=", value: budget }, ...roomy] }));
            if (!job && !ownWork && !retired && p.in_labour_force) looks.push(ask.board("jobs", { most: p.search_limit, where: [{ field: "data.workplace", op: "=", value: lead }] }));
            leadFound.homes = [];
            leadFound.jobs = [];
            looking = "leads";
            return { type: "look", looks: [...register, ...looks] };
          }
          // Hunting? Look at what's on offer (the next step, at once, has the results).
          const looks: LookRequest[] = [];
          // In work: a month's chance of looking for something better paid.
          if (job && !ownWork && !switching && !retired && p.in_labour_force && (obs.t >= nextJobSearch || searchForced)) {
            nextJobSearch = obs.t + MONTH;
            // Looking for a better job (CONSUMAT, docs/design/ai-citizens.md 3b): every month if our life falls short of
            // what we want; otherwise now and then, the more open we are.
            const unsatisfied = satisfaction(mind.person, levelsNow) < mind.p.aspiration_bps;
            searchingWork = unsatisfied || pursuing("better work") || searchForced || ctx.rng(`job-search`).below(10_000) < Math.round(mind.person.temperament.openness / 10);
          }
          searchForced = false;
          if (lookedAt !== obs.t && acc) {
            if (needHome) looks.push(ask.board("homes", { most: p.search_limit, where: [{ field: "data.rent", op: "<=", value: budget }, ...roomy], by: "data.rent", desc: true }));
            if ((!job || searchingWork) && !ownWork && !retired && p.in_labour_force) looks.push(ask.board("jobs", { most: p.search_limit, by: "data.wage", desc: true }));
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
                if (ctx.rng(`shop-search`).below(10_000) < p.shop_search_bps) shop = newsNow(obs.t).map((n) => n.shop).filter((s): s is string => !!s && !known.has(s)).sort()[0];
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
          // The record, as the week leaves it: what has moved goes to the kernel with our next action.
          writeRecord(obs.t, true, { income: householdIncome(), savings: acc?.balance ?? 0 });
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
        const proposing = (next as (Step & { propose?: { text: string; words: Words } }) | undefined)?.propose;
        const action = proposing ? Object.defineProperty({ type: "propose", text: proposing.text } as ParticipantAction, WORDS, { value: proposing.words, enumerable: false })
          : next ? noted(book, callAction(next))
          : p.round ? wait(Math.min(practiceWake ?? Infinity, nextPlanAt, nextChange(obs.t)))
          : wait(practiceWake !== null ? Math.min(practiceWake, obs.t + 7 * DAY) : undefined);
        // Questions to the sparse mind out this wake: the action, once they're answered (and if waiting, awake again by
        // the next hour, to decide with the answer).
        if (asking.length) {
          const out = Promise.all(asking.splice(0));
          const then = action.type === "wait" ? wait(Math.min(action.until ?? Infinity, obs.t + ctx.world.tickSeconds)) : action;
          return out.then(() => then);
        }
        return action;
      }
    }
  },
};
