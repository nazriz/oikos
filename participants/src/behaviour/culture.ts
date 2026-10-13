// Culture: what a town holds in common (docs/design/ai-citizens.md section 14; docs/behaviour/culture.md).
//
// For a short list of conducts (each tied to one draw the code mind already makes) a person holds a picture of what
// those around them do and approve of, and their own leaning from their values. Nothing here is the town's: every
// figure is one person's belief, kept in their own record, moved only by what reaches them along a tie, by being
// there, or by what is published (`Culture.learn` refuses any other route). It is arithmetic only: no model, no
// clock, and no draw but a person's starting lean (on their own stream).
//
// The platform judges nothing. No conduct is marked as the one a good town has; no group is better or worse at any
// of them. Every size is a PLACEHOLDER unless docs/behaviour/culture.md names a source, one set for every conduct.
//
// Off (no `dials.culture` in the world's config): nothing here is entered, and the world is the one it was.

import { VALUES, type Value } from "./mind";

/** The conducts a world may hold, in the order the record keeps them. The list is closed, in code: at most 12. */
export const CONDUCTS = [
  "answer_tribunal", "stay_past_notice", "take_to_tribunal", "complain", "take_in", "join_union", "strike", "take_from_employer",
  // (An organisation's own conducts: a person holds a view of them, what landlords here do and whether it is right.)
  "apply_possession", "heads_before_hours", "order_possession",
] as const;
export type Conduct = (typeof CONDUCTS)[number];
export const MAX_CONDUCTS = 12;

/** The conducts a person makes a choice about today: each has a draw, and takes a term there. */
export const PERSONS_CONDUCTS: readonly Conduct[] = CONDUCTS.slice(0, 8);

/** Words for a conduct, in the world's terms: the occasion, and what doing it and not doing it are; and the thing done,
 * for what is said of it. A code person's phrasing, understood only in this phrasing (as every catching-up phrase is). */
export const WORDS: { [c in Conduct]?: { occasion: string; did: string; didNot: string; thing: string } } = {
  answer_tribunal: { occasion: "Served with an application for possession", did: "I answered it", didNot: "I did not answer it", thing: "answering an application for possession" },
  stay_past_notice: { occasion: "Told to vacate and unable to pay", did: "I was still there at the date", didNot: "I left by the date", thing: "staying past a notice to vacate" },
  take_to_tribunal: { occasion: "Wronged by an unlawful rent rise or an unpaid debt", did: "I applied to the tribunal", didNot: "I did not apply", thing: "applying to the tribunal" },
  complain: { occasion: "When a service failed", did: "I wrote to the town", didNot: "I did not write", thing: "writing to the town about a service" },
  take_in: { occasion: "Asked for a roof by someone known", did: "I said yes", didNot: "I said no", thing: "taking in someone who asks for a roof" },
  join_union: { occasion: "At a new job", did: "I joined the union", didNot: "I did not join", thing: "joining the union" },
  strike: { occasion: "Balloted on action", did: "I voted yes", didNot: "I voted no", thing: "voting for action" },
  take_from_employer: { occasion: "Short of money at work among goods", did: "I took some", didNot: "I took nothing", thing: "taking goods from an employer" },
};
/** The same acts in the third person, for what a person tells of someone else's (ordinary talk: "About p12: ...: they answered it. Of that, I say it is wrong."). */
export const THEY: { [c in Conduct]?: { did: string; didNot: string } } = {
  answer_tribunal: { did: "they answered it", didNot: "they did not answer it" },
  stay_past_notice: { did: "they were still there at the date", didNot: "they left by the date" },
  take_to_tribunal: { did: "they applied to the tribunal", didNot: "they did not apply" },
  complain: { did: "they wrote to the town", didNot: "they did not write" },
  take_in: { did: "they said yes", didNot: "they said no" },
  join_union: { did: "they joined the union", didNot: "they did not join" },
  strike: { did: "they voted yes", didNot: "they voted no" },
  take_from_employer: { did: "they took some", didNot: "they took nothing" },
};
/** What is said of a conduct, in five steps, and the middle of each (basis points). */
export const SAYINGS = [["plainly wrong", 1_000], ["wrong", 3_000], ["neither right nor wrong", 5_000], ["right", 7_000], ["plainly right", 9_000]] as const;

/** How a person says what they did, and what they say of it. */
export const CULTURE_WORDS = {
  did: (c: Conduct, did: boolean): string => { const w = WORDS[c]; return w ? `${w.occasion}: ${did ? w.did : w.didNot}.` : ""; },
  says: (c: Conduct, says: number): string => { const w = WORDS[c]; if (!w) return ""; const s = SAYINGS[Math.max(0, Math.min(4, Math.floor(says / 2_000)))]![0]; return `I say ${w.thing} is ${s}.`; },
  /** What a phrase tells: the conducts done or not, and what is said of them (a step's middle). */
  heard: (text: string): { did: { conduct: Conduct; did: boolean }[]; says: { conduct: Conduct; bps: number }[] } | undefined => {
    const did: { conduct: Conduct; did: boolean }[] = [], says: { conduct: Conduct; bps: number }[] = [];
    for (const c of PERSONS_CONDUCTS) {
      const w = WORDS[c]!;
      if (text.includes(`${w.occasion}: ${w.did}.`)) did.push({ conduct: c, did: true });
      else if (text.includes(`${w.occasion}: ${w.didNot}.`)) did.push({ conduct: c, did: false });
      for (const [s, mid] of SAYINGS) if (text.includes(`I say ${w.thing} is ${s}.`)) says.push({ conduct: c, bps: mid });
    }
    return did.length || says.length ? { did, says } : undefined;
  },
  /** What I say to someone of what they did (step 4): of their doing it, or of their not doing it, how I judge it: how far it is right (the five steps of what is said of it, as approval of the act). */
  verdict: (c: Conduct, did: boolean, approvalBps: number): string => { const w = WORDS[c]; if (!w) return ""; const s = SAYINGS[Math.max(0, Math.min(4, Math.floor(approvalBps / 2_000)))]![0]; return `Of your ${did ? "" : "not "}${w.thing}: I say it is ${s}.`; },
  /** What a verdict tells: the conduct, whether it was of their doing or not doing, and how it judges the act (a step's middle). */
  verdictHeard: (text: string): { conduct: Conduct; did: boolean; approval: number } | undefined => {
    for (const c of PERSONS_CONDUCTS) {
      const w = WORDS[c]!;
      for (const did of [true, false]) for (const [s, mid] of SAYINGS) if (text === `Of your ${did ? "" : "not "}${w.thing}: I say it is ${s}.`) return { conduct: c, did, approval: mid };
    }
    return undefined;
  },
  /** What I tell of someone else's act, to someone who asks how things are (ordinary talk): who, the occasion and what they did, and how I judge the act (approval of it, as a verdict does). */
  about: (who: string, c: Conduct, did: boolean, approvalBps: number): string => {
    const w = WORDS[c], th = THEY[c];
    if (!w || !th) return "";
    return `About ${who}: ${w.occasion}: ${did ? th.did : th.didNot}. Of that, I say it is ${SAYINGS[Math.max(0, Math.min(4, Math.floor(approvalBps / 2_000)))]![0]}.`;
  },
  /** What such a phrase tells: of whom, the conduct, whether they did it, and how the teller judges their act (a step's middle). */
  aboutHeard: (text: string): { who: string; conduct: Conduct; did: boolean; approval: number } | undefined => {
    for (const c of PERSONS_CONDUCTS) {
      const w = WORDS[c]!, th = THEY[c]!;
      for (const did of [true, false]) for (const [s, mid] of SAYINGS) {
        const tail = `: ${w.occasion}: ${did ? th.did : th.didNot}. Of that, I say it is ${s}.`;
        const at = text.indexOf(tail);
        if (at < 0) continue;
        const head = text.lastIndexOf("About ", at);
        if (head < 0) continue;
        const who = text.slice(head + 6, at);
        if (who && !/\s/.test(who)) return { who, conduct: c, did, approval: mid };
      }
    }
    return undefined;
  },
  /** What a parent tells a child who asks (step 4): how I see it, in tenths: how many here do it, and how many would call it right. */
  household: (c: Conduct, doesBps: number, approvesBps: number): string => { const w = WORDS[c]; return w ? `As I see it, of ${w.thing}: ${Math.round(doesBps / 1_000)} in 10 do it, ${Math.round(approvesBps / 1_000)} in 10 would call it right.` : ""; },
  householdHeard: (text: string): { conduct: Conduct; does: number; approves: number }[] => {
    const out: { conduct: Conduct; does: number; approves: number }[] = [];
    for (const c of PERSONS_CONDUCTS) {
      const m = new RegExp(`As I see it, of ${WORDS[c]!.thing}: (\\d+) in 10 do it, (\\d+) in 10 would call it right\\.`).exec(text);
      if (m) out.push({ conduct: c, does: Number(m[1]) * 1_000, approves: Number(m[2]) * 1_000 });
    }
    return out;
  },
  /** Where a person comes from, told when asked how things are (only where the world has origin groups). */
  from: (group: string): string => `I come from the ${group} group.`,
  fromHeard: (text: string): string | undefined => /I come from the ([^\s.]+) group\./.exec(text)?.[1],
};

/** Which values speak to a conduct, and which way (ours, to test against data, as needs-from-values is): a signed list. */
export const VALUE_MAP: { [c in Conduct]: [Value, 1 | -1][] } = {
  answer_tribunal: [["conformity", 1], ["security", 1]],
  stay_past_notice: [["security", 1], ["conformity", -1]],
  take_to_tribunal: [["self_direction", 1], ["universalism", 1]],
  complain: [["self_direction", 1], ["universalism", 1], ["conformity", -1]],
  take_in: [["benevolence", 1], ["tradition", 1]],
  join_union: [["universalism", 1], ["benevolence", 1], ["power", -1]],
  strike: [["universalism", 1], ["benevolence", 1], ["security", -1]],
  take_from_employer: [["conformity", -1], ["tradition", -1], ["hedonism", 1]],
  apply_possession: [["power", 1], ["security", 1], ["benevolence", -1]],
  heads_before_hours: [["achievement", 1], ["benevolence", -1]],
  order_possession: [["conformity", 1], ["security", 1]],
};

/** The sizes (docs/behaviour/culture.md; every one a placeholder unless the doc names a source). */
export interface CultureParams {
  /** Weight of the picture a person starts with (as if this many had been seen). */
  prior_weight: number;
  /** The spread of the lean a person starts with, and the movement per standard deviation of the values that speak to a conduct. */
  own_sd_bps: number;
  values_bps: number;
  /** What is seen is held to this much weight: the recent counts for more. */
  window: number;
  /** A sighting's weight: someone known (1), a close tie, a published count (up to). */
  known_weight: number;
  close_weight: number;
  published_weight: number;
  /** A tie is close at this affinity. */
  close_affinity_bps: number;
  /** `own` settles half the way to `approves` in this many days. */
  internalise_days: number;
  /** The decision term: the lean is the share of the standard deviation `sd_bps` the person is moved by, `w_does` and `w_approves` weigh what is done and what is approved. */
  sd_bps: number;
  w_does_bps: number;
  w_approves_bps: number;
  /** The sway of a lean on a rate (`swayed`): thousandths of the rate per standard deviation. */
  sway_milli: number;
  /** One's own conduct is told only if it sits within this of what one takes to be approved (or one's integrity is high). */
  conceal_bps: number;
  /** An integrity above this tells whatever it is. */
  integrity_tells_bps: number;
  /** The weight of the cost of standing out, against the cost of saying what one does not think, in thousandths (1,000 = one to one): what is said is the weighted mean of what one thinks and what one takes the street to approve, with the weights `reputation_scale_milli/1000 x belonging x conformity` and `integrity` (Kuran 1995: one chooses what to say to balance the reputation lost by standing out against the inner cost of misstating one's view). See docs/behaviour/culture.md, "What I think and what I say". */
  reputation_scale_milli: number;
  // ---- ordinary talk about others' conduct (docs/behaviour/culture.md, "Ordinary talk"). Placeholders, fixed before any run and not adjusted after.
  /** The chance that, asked how things are, I also tell of one other person's conduct that I know first-hand of (if I have one to tell). */
  gossip_bps: number;
  /** I tell of an act for this many days after I heard it. */
  gossip_days: number;
  /** The most people whose acts I keep to tell of. */
  third_kept: number;
  /** What fraction (basis points) of the move of a number is kept before the record is written again: the record's grain, whole percent. */
  grain_percent: number;
  /** Placeholder for what is approved where the profile is silent. */
  approves_default_bps: number;
  /** Placeholder for what is done, for a conduct with no rate of its own and no figure. */
  does_default_bps: number;
  /** Most phrases a person adds to what they say when asked how things are. */
  phrases: number;
  /** Disapproval and esteem between ties (step 4). An act told by a tie sits with what I think of it by more than this (of the middle, 5,000) before I feel for them or say anything of it. */
  margin_bps: number;
  /** A tie cools toward someone whose act I hold against by at most this (at the greatest distance from the middle), and warms by at most `esteem_bps` toward one whose act I hold with. */
  cool_bps: number;
  esteem_bps: number;
  /** Told by someone that they hold what I did against: a dent to my belonging of at most this, times a half to one and a half by my conformity. */
  disapproved_bps: number;
  /** A newcomer arrives holding the profile's picture at this weight, so what they see here soon outweighs it. */
  newcomer_weight: number;
  /** The points a standard deviation of the lean adds to a way a want may take (as trust and agency do: wants.ts `choice`). */
  way_points: number;
  // ---- town memory (step 5; docs/behaviour/culture.md): what a person remembers of what was public. Every size a placeholder.
  /** The most events a person holds; the weakest gives way to a stronger arrival. */
  slots: number;
  /** How strongly an event first reaches me: seen (I was there), read (the paper's heaviest item), and told (this share of the teller's strength, `negative_bps` more for what I hold against). */
  seen_bps: number;
  read_bps: number;
  pass_bps: number;
  negative_bps: number;
  /** An event told through more hands than this is not kept. */
  max_hops: number;
  /** A strength halves in this many days: what I saw; what I read or was told. */
  half_life_seen_days: number;
  half_life_told_days: number;
  /** I tell what I hold above this strength. Hearing it again returns this share of the way to what it first was. */
  tell_at_bps: number;
  rehearse_bps: number;
  /** An event bears on my trust in whoever did it, once, at its strength times this, and by where my own view of the conduct it shows sits. */
  bystander_bps: number;
  /** A departure I find in a building I am in counts as seen if it is no older than this. */
  witness_days: number;
}
export const CULTURE_DEFAULTS: CultureParams = {
  prior_weight: 4, own_sd_bps: 1_500, values_bps: 500, window: 20, known_weight: 1, close_weight: 2, published_weight: 4, close_affinity_bps: 3_000,
  internalise_days: 1_095, reputation_scale_milli: 1_000, gossip_bps: 3_000, gossip_days: 180, third_kept: 8, sd_bps: 2_500, w_does_bps: 6_000, w_approves_bps: 4_000, sway_milli: 300, conceal_bps: 7_500, integrity_tells_bps: 7_000,
  grain_percent: 2, approves_default_bps: 5_000, does_default_bps: 5_000, phrases: 3,
  margin_bps: 2_500, cool_bps: 500, esteem_bps: 200, disapproved_bps: 300, newcomer_weight: 1, way_points: 1_500,
  slots: 6, seen_bps: 10_000, read_bps: 5_000, pass_bps: 6_000, negative_bps: 2_000, max_hops: 3, half_life_seen_days: 365, half_life_told_days: 180,
  tell_at_bps: 2_000, rehearse_bps: 3_000, bystander_bps: 5_000, witness_days: 3,
};
const INTS: (keyof CultureParams)[] = Object.keys(CULTURE_DEFAULTS) as (keyof CultureParams)[];

/** The sizes the world gives, over the defaults, refusing any that would break the arithmetic (a weight below 1, a window
 * below the prior, a share outside 0..10000). */
export function cultureParams(given?: any): CultureParams {
  const p = { ...CULTURE_DEFAULTS, ...(given ?? {}) } as CultureParams;
  for (const k of INTS) if (!Number.isInteger(p[k]) || p[k] < 0) throw new Error(`dials.culture.step.${k}: a size is a whole number, not below 0; got ${p[k]}`);
  for (const k of ["own_sd_bps", "values_bps", "w_does_bps", "w_approves_bps", "close_affinity_bps", "conceal_bps", "integrity_tells_bps", "approves_default_bps", "does_default_bps", "margin_bps", "cool_bps", "esteem_bps", "gossip_bps", "disapproved_bps", "seen_bps", "read_bps", "pass_bps", "negative_bps", "tell_at_bps", "rehearse_bps", "bystander_bps"] as const)
    if (p[k] > 10_000) throw new Error(`dials.culture.step.${k}: a share is from 0 to 10000; got ${p[k]}`);
  for (const k of ["prior_weight", "window", "known_weight", "close_weight", "published_weight", "internalise_days", "sd_bps", "newcomer_weight", "slots", "half_life_seen_days", "half_life_told_days", "witness_days", "gossip_days", "third_kept"] as const)
    if (p[k] < 1) throw new Error(`dials.culture.step.${k}: must be at least 1; got ${p[k]}`);
  if (p.window < p.prior_weight || p.window < p.published_weight) throw new Error("dials.culture.step.window: must hold the prior's and a published count's weight");
  if (p.sway_milli > 1_000) throw new Error(`dials.culture.step.sway_milli: a lean may move a rate by at most the whole of it per standard deviation; got ${p.sway_milli}`);
  if (p.slots > 12) throw new Error(`dials.culture.step.slots: at most 12 events held; got ${p.slots}`);
  if (p.max_hops > 8) throw new Error(`dials.culture.step.max_hops: at most 8 hands; got ${p.max_hops}`);
  if (p.way_points > 10_000) throw new Error(`dials.culture.step.way_points: at most 10000 a standard deviation; got ${p.way_points}`);
  if (p.phrases > 6) throw new Error(`dials.culture.step.phrases: at most 6 phrases a time; got ${p.phrases}`);
  return p;
}

/** The profile's figures for a conduct: what is done and what is approved, in basis points, either may be absent. */
export interface ConductFigures { does_bps?: number; approves_bps?: number }
/** The dial as the world carries it: which conducts are live, the sizes, and the profile's figures (the generator copies them, with the dial, from the profile). */
export interface CultureDial {
  conducts: Conduct[];
  params: CultureParams;
  /** The profile's figures by conduct, and by origin group (a group's figures replace the profile's for those who come from it). */
  figures: { [c: string]: ConductFigures };
  byOrigin: { [group: string]: { [c: string]: ConductFigures } };
  /** The profile's origin groups: the shares people are drawn from live in the generator; here only what a person needs to act on (homophily). */
  homophily_bps: number;
  /** The profile's origin groups and their shares of the people (basis points), for a newcomer to be drawn from; empty where the profile has none. */
  shares: { id: string; share_bps: number }[];
}
export function cultureDial(world: { dials?: { [name: string]: unknown } } | undefined): CultureDial | undefined {
  const d = world?.dials?.culture as any;
  if (!d || typeof d !== "object") return undefined;
  const conducts = Array.isArray(d.conducts) ? d.conducts : [...CONDUCTS];
  for (const c of conducts) if (!(CONDUCTS as readonly string[]).includes(c)) throw new Error(`dials.culture.conducts: ${c} is not a conduct the build knows`);
  if (conducts.length > MAX_CONDUCTS) throw new Error(`dials.culture.conducts: at most ${MAX_CONDUCTS}`);
  const params = cultureParams({ ...(d.step ?? {}), ...(Number.isInteger(d.sway_milli) ? { sway_milli: d.sway_milli } : {}) });
  return { conducts, params, figures: d.profile?.conducts ?? {}, byOrigin: d.profile?.by_origin ?? {}, homophily_bps: Number.isInteger(d.profile?.homophily_bps) ? d.profile.homophily_bps : 0,
    shares: Array.isArray(d.profile?.origin_shares) ? d.profile.origin_shares : [] };
}

/** How a person's own situation reaches the arithmetic (closures over the citizen's mind, so this file knows no more of it). */
export interface CultureEnv {
  /** A value's standing against the town's, in standard deviations (-3..3). */
  z(v: Value): number;
  /** Conformity, belonging's weight and integrity, each 0..1. */
  conformity(): number;
  belonging(): number;
  integrity(): number;
  /** A starting lean for a conduct: a standard normal draw on the person's own stream. */
  draw(conduct: Conduct): number;
}

/** The ways a person may learn what others do; nothing else moves a picture (docs/no-god-view.md). */
export type Route = "tie" | "close_tie" | "here" | "published";
export const ROUTES: readonly Route[] = ["tie", "close_tie", "here", "published"];

const clamp = (x: number, lo = 0, hi = 10_000) => Math.max(lo, Math.min(hi, Math.round(x)));
const sd = (z: number) => Math.max(-3, Math.min(3, z));
const half = (days: number, h: number) => Math.pow(0.5, days / h);

/** A conduct's five numbers in the record: [does, approves, own, says, n]. */
export type NormsRow = [number, number, number, number, number];
/** The record's `norms`: one place for each conduct of `CONDUCTS`, in that order, null where the person holds none. */
export type NormsSection = (NormsRow | null)[];
/** The record's norms as named rows (for a reader of a log or a test): the conduct, and its numbers. */
export const normsRows = (section: NormsSection | undefined): { conduct: Conduct; numbers: NormsRow }[] =>
  (section ?? []).flatMap((r, i) => (r ? [{ conduct: CONDUCTS[i]!, numbers: r }] : []));

/** What I feel for a tie whose act was told to me (basis points on the tie: negative cools, positive warms) and, if I would say something of it, how I would judge it (approval of the act, 0..10000). */
export interface Reaction { tie: number; voice?: number }

/** A person's own act at an occasion, kept for `news_days` to be told: to whom already told, so it is counted once by each. */
interface Act { conduct: Conduct; did: boolean; t: number; told: Set<string> }

/** One person's norms: what they take those around them to do and approve of, what they think, what they say. */
export class Culture {
  readonly held: Conduct[];
  private readonly does = new Map<Conduct, number>();
  private readonly approves = new Map<Conduct, number>();
  private readonly ownBase = new Map<Conduct, number>();
  private readonly ownAt = new Map<Conduct, number>();
  private readonly zStart = new Map<Conduct, number>();
  private readonly n = new Map<Conduct, number>();
  /** What the profile says is done and approved (not the person's group's): the point the lean is measured from. */
  private readonly does0 = new Map<Conduct, number>();
  private readonly approves0 = new Map<Conduct, number>();
  private readonly acts = new Map<Conduct, Act>();
  /** The person's own starting lean for each conduct, kept (a standard normal), so a picture taken later can start `own` the same way. */
  private readonly lean0 = new Map<Conduct, number>();
  /** Conducts a tie told me of in the last days: what I may say of them when asked. */
  private readonly heardOf = new Map<Conduct, { t: number; told: Set<string> }>();
  private origin: string | undefined;
  /** What I know first-hand of other people's acts, because they told me (a tie), by who: to tell of in ordinary talk, and to whom already told. */
  private readonly ofOthers = new Map<string, Map<Conduct, { did: boolean; t: number; told: Set<string> }>>();
  /** Acts told to me of someone else, kept so the same one is not counted twice from a second teller. */
  private readonly toldOf = new Set<string>();

  /**
   * @param rates the conducts this person has a rate for in their world, and the rate (what is done there as calibrated)
   * @param group the origin group the person comes from, if the world has any
   */
  constructor(readonly p: CultureParams, readonly dial: CultureDial, private readonly env: CultureEnv, rates: { [c in Conduct]?: number }, group?: string, t = 0) {
    this.origin = group;
    const held: Conduct[] = [];
    for (const c of CONDUCTS) {
      if (!dial.conducts.includes(c)) continue;
      const fig = dial.figures[c], grp = group ? dial.byOrigin[group]?.[c] : undefined;
      // A conduct is held where the world gives it a rate or the profile gives a figure for it.
      if (rates[c] === undefined && fig?.does_bps === undefined && fig?.approves_bps === undefined && grp?.does_bps === undefined) continue;
      held.push(c);
      const does0 = fig?.does_bps ?? rates[c] ?? p.does_default_bps;
      const approves0 = fig?.approves_bps ?? p.approves_default_bps;
      this.does0.set(c, clamp(does0));
      this.approves0.set(c, clamp(approves0));
      this.does.set(c, clamp(grp?.does_bps ?? does0));
      this.approves.set(c, clamp(grp?.approves_bps ?? approves0));
      const z = this.zOf(c);
      this.zStart.set(c, z);
      const draw = env.draw(c);
      this.lean0.set(c, draw);
      this.ownBase.set(c, clamp(this.approves.get(c)! + p.own_sd_bps * draw + p.values_bps * z));
      this.ownAt.set(c, t);
      this.n.set(c, p.prior_weight);
    }
    this.held = held;
  }

  /** Where I come from, if the world has groups and I know. */
  get group(): string | undefined { return this.origin; }

  /** The values that speak to a conduct, summed (signed, in standard deviations). */
  private zOf(c: Conduct): number { return VALUE_MAP[c].reduce((a, [v, s]) => a + s * this.env.z(v), 0); }
  has(c: Conduct): boolean { return this.does.has(c); }

  /** What I think myself: my starting lean and the values as they have moved since, settling toward what I take to be approved. */
  private own(c: Conduct, t: number): number {
    // (Settling is worked out when read, from the days gone: nothing runs daily.)
    const base = this.ownBase.get(c)!, at = this.ownAt.get(c)!, keep = half(Math.max(0, t - at) / 86_400, this.p.internalise_days);
    const settled = this.approves.get(c)! + (base - this.approves.get(c)!) * keep;
    return clamp(settled + this.p.values_bps * (this.zOf(c) - this.zStart.get(c)!));
  }
  /**
   * The share of the way from what I think to what I take the street to approve that I go in what I say, 0..1 (Kuran 1995). I choose what to say to
   * make two costs as small as I can: the reputation lost by saying what is far from what the street approves, which weighs more the more I belong
   * and the more I follow others (`reputation_scale_milli/1000 x belonging x conformity`), and the inner cost of saying what I do not think, which
   * weighs as my integrity does. Each cost grows with the square of its distance, so the best thing to say lies between the two, at the share
   * `reputation / (reputation + integrity)` of the way: nothing if I do not care what the street thinks, the whole way if I have no integrity,
   * half if the two weigh alike. A view farther from the street is moved by more points, the same share of a longer way.
   */
  pressure(): number {
    const rep = (this.p.reputation_scale_milli / 1_000) * this.env.belonging() * this.env.conformity(), inner = this.env.integrity();
    return rep + inner > 0 ? rep / (rep + inner) : 0;
  }
  /** What I say when asked: what I think, moved toward what I take to be approved by `pressure()` of the way. */
  private says(c: Conduct, t: number): number {
    const own = this.own(c, t);
    return clamp(own + this.pressure() * (this.approves.get(c)! - own));
  }

  /** The four numbers and the weight held for a conduct (basis points), as of `t`. */
  read(c: Conduct, t: number): { does: number; approves: number; own: number; says: number; n: number } | undefined {
    if (!this.has(c)) return undefined;
    return { does: this.does.get(c)!, approves: this.approves.get(c)!, own: this.own(c, t), says: this.says(c, t), n: this.n.get(c)! };
  }

  /**
   * The lean at a conduct's decision, in standard deviations (-3..3): the conformist follows what is done and approved
   * about them, the one who is not follows themself (design 14d). With every figure at the profile's, it is the person's
   * own lean alone, which sums to nothing over a town.
   */
  lean(c: Conduct, t: number): number {
    if (!this.has(c)) return 0;
    const k = this.env.conformity(), P = this.p;
    const street = (P.w_does_bps * (this.does.get(c)! - this.does0.get(c)!) + P.w_approves_bps * (this.approves.get(c)! - this.approves0.get(c)!)) / 10_000;
    return sd((k * street + (1 - k) * (this.own(c, t) - this.approves0.get(c)!)) / P.sd_bps);
  }
  /** A rate (basis points) as this person's lean sways it: `swayed`, with this dial's sway. */
  term(bps: number, c: Conduct, t: number, sign: 1 | -1 = 1): number {
    return clamp(bps * (1 + (this.p.sway_milli / 1_000) * sign * this.lean(c, t)));
  }
  /** The numbers and the lean for a recorded decision's `norm` (whole percent; the lean in hundredths of a standard deviation). */
  norm(c: Conduct, t: number): { conduct: string; does: number; approves: number; own: number; says: number; lean: number } | undefined {
    const r = this.read(c, t);
    return r ? { conduct: c, does: Math.round(r.does / 100), approves: Math.round(r.approves / 100), own: Math.round(r.own / 100), says: Math.round(r.says / 100), lean: Math.round(this.lean(c, t) * 100) } : undefined;
  }
  /** The numbers and the lean as whole integers, for the record of a decision (an outcome's facts). */
  facts(c: Conduct, t: number): { [k: string]: number } {
    const r = this.read(c, t);
    return r ? { norm_does: Math.round(r.does / 100), norm_approves: Math.round(r.approves / 100), norm_own: Math.round(r.own / 100), norm_says: Math.round(r.says / 100), norm_lean: Math.round(this.lean(c, t) * 100) } : {};
  }

  // ---------------------------------------------------------------- learning what others do

  /** How much a sighting weighs by the way it came. */
  weight(route: Route): number {
    if (!ROUTES.includes(route)) throw new Error(`culture: a picture of what others do is moved only along a tie, by being there, or by what is published; not by "${route}" (docs/no-god-view.md)`);
    return route === "published" ? this.p.published_weight : route === "close_tie" ? this.p.close_weight : this.p.known_weight;
  }
  /** Saw one person do it, or not (a tie told me, or I was there). Each sighting moves `does` toward it by its weight over the weight held. */
  seeAct(c: Conduct, did: boolean, route: Route): void { this.moveDoes(c, did ? 10_000 : 0, this.weight(route)); }
  /** A published count: the share who did it, of those who met the occasion. */
  seeShare(c: Conduct, shareBps: number, route: Route = "published"): void { this.moveDoes(c, clamp(shareBps), this.weight(route)); }
  private moveDoes(c: Conduct, x: number, w: number): void {
    if (!this.has(c)) return;
    const held = Math.min(this.p.window, this.n.get(c)! + w);
    this.does.set(c, clamp(this.does.get(c)! + ((x - this.does.get(c)!) * w) / held));
    this.n.set(c, held);
    this.dirty = true;
  }
  /** Heard what someone says of it: the same rule on `approves`, from what others say, not what they are thought to think. */
  hearSaid(c: Conduct, bps: number, route: Route): void {
    if (!this.has(c)) return;
    const w = this.weight(route);
    this.approves.set(c, clamp(this.approves.get(c)! + ((clamp(bps) - this.approves.get(c)!) * w) / (this.n.get(c)! + w)));
    this.dirty = true;
  }

  // ---------------------------------------------------------------- telling

  /** My own act at an occasion: kept to be told. */
  act(c: Conduct, did: boolean, t: number): void { if (this.has(c)) this.acts.set(c, { conduct: c, did, t, told: new Set() }); }
  /** What I say when asked how things are, to `asker`: my recent acts (not those I would rather keep back, and none twice to the same person), and what I say of them. */
  tell(asker: string, t: number, newsDays: number): string[] {
    const out: string[] = [];
    const recent = [...this.acts.values()].filter((a) => t - a.t <= newsDays * 86_400).sort((a, b) => b.t - a.t || (a.conduct < b.conduct ? -1 : 1));
    for (const a of recent) {
      if (out.length >= this.p.phrases) break;
      if (a.told.has(asker)) continue;
      a.told.add(asker);
      const position = a.did ? 10_000 : 0;
      // (I mention what I did only if it sits within reach of what I take to be approved, or my integrity is high; what was seen cannot be kept back.)
      const tells = Math.abs(position - this.approves.get(a.conduct)!) <= this.p.conceal_bps || this.env.integrity() * 10_000 >= this.p.integrity_tells_bps;
      if (tells) out.push(CULTURE_WORDS.did(a.conduct, a.did));
      if (out.length < this.p.phrases) out.push(CULTURE_WORDS.says(a.conduct, this.says(a.conduct, t)));
    }
    for (const [c, a] of this.acts) if (t - a.t > newsDays * 86_400) this.acts.delete(c);
    // What I say of what I have been told of (not my own act): my opinion, once to each who asks, for a matter lately in the news (said in company).
    for (const [c, h] of [...this.heardOf].sort((a, b) => b[1].t - a[1].t || (a[0] < b[0] ? -1 : 1))) {
      if (t - h.t > newsDays * 86_400) { this.heardOf.delete(c); continue; }
      if (out.length >= this.p.phrases || h.told.has(asker) || this.acts.has(c)) continue;
      h.told.add(asker);
      const says = this.says(c, t);
      if (Math.floor(says / 2_000) !== 2) out.push(CULTURE_WORDS.says(c, says));
    }
    return out.filter(Boolean);
  }

  // ---------------------------------------------------------------- ordinary talk about others' conduct

  /** A tie told me of their own act: now I know it first-hand, and may tell of it (the oldest person's acts give way beyond `third_kept`). */
  learnOf(about: string, c: Conduct, did: boolean, t: number): void {
    if (!this.has(c)) return;
    const row = this.ofOthers.get(about) ?? new Map();
    row.set(c, { did, t, told: new Set() });
    this.ofOthers.delete(about);
    this.ofOthers.set(about, row);
    while (this.ofOthers.size > this.p.third_kept) this.ofOthers.delete(this.ofOthers.keys().next().value!);
  }
  /**
   * In a talk with `asker`, maybe tell of one act of a third person that I know first-hand (a tie told me; nobody else's, nothing from a register), within
   * `gossip_days`, not the asker's own and not one I have told them; and what I say of it, as `says` is (what the teller says, not what the teller thinks).
   * `roll` draws 0..9,999 on the person's own stream and is called only when there is something to tell. Returns the phrase.
   */
  gossip(asker: string, t: number, roll: () => number): string | undefined {
    let best: { about: string; c: Conduct; a: { did: boolean; t: number; told: Set<string> } } | undefined;
    for (const [about, row] of this.ofOthers) {
      if (about === asker) continue;
      for (const [c, a] of row) {
        if (a.told.has(asker) || t - a.t > this.p.gossip_days * 86_400) continue;
        if (!best || a.t > best.a.t || (a.t === best.a.t && (about + c < best.about + best.c))) best = { about, c, a };
      }
    }
    if (!best || roll() >= this.p.gossip_bps) return undefined;
    best.a.told.add(asker);
    const said = this.says(best.c, t);
    return CULTURE_WORDS.about(best.about, best.c, best.a.did, best.a.did ? said : 10_000 - said);
  }
  /**
   * Told by `teller` of a third person's act and what the teller says of it. By the existing rules: one more sighting of the conduct along a tie (it moves `does`),
   * and what the teller said is what is approved (`hearSaid`), as a verdict is. What I make of the one talked about, by my own view as step 4 has it: the
   * tie to them cools or warms (the caller applies it, if they are anyone to me); and I may say what I think of the matter when asked. The same act told twice
   * is counted once. Returns the reaction, if any.
   */
  hearAbout(who: string, c: Conduct, did: boolean, approval: number, t: number, route: Route = "tie"): Reaction | undefined {
    if (!this.has(c)) return undefined;
    const key = `${who}|${c}|${did}`;
    if (this.toldOf.has(key) || this.ofOthers.get(who)?.get(c)?.did === did) return undefined;
    this.toldOf.add(key);
    while (this.toldOf.size > 64) this.toldOf.delete(this.toldOf.values().next().value!);
    this.seeAct(c, did, route);
    this.hearSaid(c, did ? approval : 10_000 - approval, route);
    this.noteHeard(c, t);
    return this.react(c, did, t);
  }

  // ---------------------------------------------------------------- what a tie's act is to me (step 4)

  /**
   * A tie's act, told to me, as I take it. Privately I judge it by what I think (`own`): it sits with that or against it, and by more than
   * `margin_bps` of the middle I feel for them (a tie cools toward whoever did what I hold against, by at most `cool_bps`, warms by at most
   * `esteem_bps` toward whoever did what I hold with: Ellickson, Brennan and Pettit). What I SAY of it is another thing, `says`, which is `own` moved
   * toward what I take to be approved: one who privately holds it wrong may say nothing, or say it is right, where they take the street to approve
   * (Kuran). I voice a verdict only if what I would say sits beyond the margin. Nothing is blocked and nobody is fined.
   */
  react(c: Conduct, did: boolean, t: number): Reaction | undefined {
    if (!this.has(c)) return undefined;
    const r = this.read(c, t)!, M = this.p.margin_bps;
    const thought = did ? r.own : 10_000 - r.own, said = did ? r.says : 10_000 - r.says;
    const dev = thought - 5_000;
    const tie = Math.abs(dev) <= M ? 0 : dev < 0 ? -Math.round((this.p.cool_bps * -dev) / 5_000) : Math.round((this.p.esteem_bps * dev) / 5_000);
    const voice = Math.abs(said - 5_000) > M ? said : undefined;
    return tie === 0 && voice === undefined ? undefined : { tie, ...(voice !== undefined ? { voice } : {}) };
  }
  /**
   * Told by someone what they say of what I did (`approval` of my doing it, or of my not doing it): what they say is what is approved, so my picture
   * of that moves along the tie (Bicchieri: normative expectations are made of what is said and sanctioned). Held against, it dents my belonging, by
   * at most `disapproved_bps`, from half to one and a half times that as I am a conformist (Williams: being left out hurts, the more the more one
   * belongs). Returns the dent to apply (0 when approved).
   */
  judged(c: Conduct, did: boolean, approval: number, route: Route): number {
    if (!this.has(c)) return 0;
    this.hearSaid(c, did ? approval : 10_000 - approval, route);
    return approval >= 5_000 ? 0 : Math.round(this.p.disapproved_bps * (0.5 + this.env.conformity()) * ((5_000 - approval) / 5_000));
  }
  /** The points the lean adds to a way a want may take (`way_points` a standard deviation, times the sway), bounded as the lean is. */
  way(c: Conduct, t: number): number { return Math.round(this.p.way_points * (this.p.sway_milli / 1_000) * this.lean(c, t)); }
  /** How much an event bears on trust in whoever did it: its strength times `bystander_bps` times how far my own view of the conduct sits from the middle. */
  bearing(strength: number, own: number): number { return (strength / 10_000) * (this.p.bystander_bps / 10_000) * (Math.abs(own - 5_000) / 5_000); }
  /** What a tie warms by when it tells me what I did is approved. */
  get warmth(): number { return Math.round(this.p.esteem_bps / 2); }
  /** A tie told me of an act: I may say what I think of it, to whoever asks, for the next days. */
  noteHeard(c: Conduct, t: number): void { if (this.has(c)) this.heardOf.set(c, { t, told: new Set() }); }

  // ---------------------------------------------------------------- children and newcomers (step 4)

  /** Where I come from, learned now (a child coming of age takes a parent's): and, where the profile gives that group's figures and I took nothing from a household, I start from them. */
  setGroup(group: string | undefined, fromHousehold: Set<Conduct> = new Set()): void {
    this.origin = group;
    if (!group) return;
    for (const c of this.held) {
      const g = this.dial.byOrigin[group]?.[c];
      if (!g || fromHousehold.has(c)) continue;
      if (g.does_bps !== undefined) this.does.set(c, clamp(g.does_bps));
      if (g.approves_bps !== undefined) this.approves.set(c, clamp(g.approves_bps));
      this.rebase(c, 0);
    }
    this.dirty = true;
  }
  /** My own lean restarted from the picture I have now (the same draw, the values as they stand). */
  private rebase(c: Conduct, t: number): void {
    this.zStart.set(c, this.zOf(c));
    this.ownBase.set(c, clamp(this.approves.get(c)! + this.p.own_sd_bps * this.lean0.get(c)! + this.p.values_bps * this.zStart.get(c)!));
    this.ownAt.set(c, t);
  }
  /**
   * Coming of age in a household: what the parents told me, each their own picture of what is done and approved; mine is their mean, held at
   * `prior_weight` (Cavalli-Sforza and Feldman; Bisin and Verdier: parents first, then everyone else, who are met as sightings from then on).
   * A conduct no parent spoke of keeps the picture it had. Returns the conducts taken.
   */
  adoptHousehold(told: { conduct: Conduct; does: number; approves: number }[][], t: number): Set<Conduct> {
    const taken = new Set<Conduct>();
    for (const c of this.held) {
      const rows = told.flatMap((parent) => parent.filter((x) => x.conduct === c));
      if (!rows.length) continue;
      this.does.set(c, clamp(rows.reduce((a, x) => a + x.does, 0) / rows.length));
      this.approves.set(c, clamp(rows.reduce((a, x) => a + x.approves, 0) / rows.length));
      this.n.set(c, this.p.prior_weight);
      this.rebase(c, t);
      taken.add(c);
    }
    if (taken.size) this.dirty = true;
    return taken;
  }
  /** What I tell a child who asks: my picture of what is done and approved, for each conduct I hold. */
  household(): { conduct: Conduct; does: number; approves: number }[] { return this.held.map((c) => ({ conduct: c, does: this.does.get(c)!, approves: this.approves.get(c)! })); }
  /** Arrived here from elsewhere: I bring the picture I have and hold it lightly, so what I see here soon outweighs it (Berry: acculturation). */
  arrive(t: number): void {
    for (const c of this.held) this.n.set(c, this.p.newcomer_weight);
    this.dirty = true;
    void t;
  }

  // ---------------------------------------------------------------- the record

  /** The record's section, positional: the place in `CONDUCTS` is the conduct (so no name is written), a row its five numbers in order
   * [does, approves, own, says, n], the first four in whole percent; `null` where the person holds no such conduct, the tail of nulls left off.
   * Bounded (12 places, whatever the town or the time). A record is canonicalised and hashed whole at every change, so a section pays for each
   * byte every time anything in the record moves: named rows were 400 bytes of a 1,700-byte record, this is about 150. */
  section(t: number): NormsSection {
    // (Worked out again only when a picture has moved or `REFRESH_DAYS` have passed: `own` and `says` drift slowly with the days and the values,
    // and the record is written again only for a move of 2 in 100, so a month's staleness changes nothing written. Nothing runs daily.)
    if (this.cached && !this.dirty && t - this.cachedAt < REFRESH_DAYS * 86_400 && t >= this.cachedAt) return this.cached;
    this.dirty = false;
    this.cachedAt = t;
    const rows: NormsSection = CONDUCTS.map((c) => {
      const r = this.read(c, t);
      return r ? [Math.round(r.does / 100), Math.round(r.approves / 100), Math.round(r.own / 100), Math.round(r.says / 100), Math.round(r.n)] as NormsRow : null;
    });
    while (rows.length && rows[rows.length - 1] === null) rows.pop();
    return (this.cached = rows);
  }
  private cached: NormsSection | undefined;
  private cachedAt = 0;
  private dirty = true;
}

/** How long the record's section may go without being worked out again when nothing moved a picture. */
export const REFRESH_DAYS = 30;

/** A standard normal from a stream (the sum of 12 uniforms less 6: the Irwin-Hall approximation the mind uses). */
export function standardNormal(rng: { below(n: number): number }): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += rng.below(1_000_001) / 1_000_000;
  return s - 6;
}

export const CULTURE_VALUES = VALUES;
