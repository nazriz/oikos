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
/** What is said of a conduct, in five steps, and the middle of each (basis points). */
export const SAYINGS = [["plainly wrong", 1_000], ["wrong", 3_000], ["neither right nor wrong", 5_000], ["right", 7_000], ["plainly right", 9_000]] as const;

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
  // ---- an organisation's practice (step 6; docs/behaviour/culture.md, "An office's practice"). Placeholders, fixed before any run.
  /** Practice is counted over this many days (older counts are halved as the window rolls). */
  practice_window_days: number;
  /** Below this many occasions an office's habit is not yet one. */
  practice_min_occasions: number;
  /** A code holder's rate is drawn this much of the way from what its character gives toward its own practice. */
  practice_inertia_bps: number;
  /** An office is never new on day 1: it opens with a past of this many occasions, at the rate its character gives. */
  practice_opening: number;
}
export const CULTURE_DEFAULTS: CultureParams = {
  prior_weight: 4, own_sd_bps: 1_500, values_bps: 500, window: 20, known_weight: 1, close_weight: 2, published_weight: 4, close_affinity_bps: 3_000,
  internalise_days: 1_095, reputation_scale_milli: 1_000, gossip_bps: 3_000, gossip_days: 180, third_kept: 8, sd_bps: 2_500, w_does_bps: 6_000, w_approves_bps: 4_000, sway_milli: 300, conceal_bps: 7_500, integrity_tells_bps: 7_000,
  grain_percent: 2, approves_default_bps: 5_000, does_default_bps: 5_000, phrases: 3,
  margin_bps: 2_500, cool_bps: 500, esteem_bps: 200, disapproved_bps: 300, newcomer_weight: 1, way_points: 1_500,
  slots: 6, seen_bps: 10_000, read_bps: 5_000, pass_bps: 6_000, negative_bps: 2_000, max_hops: 3, half_life_seen_days: 365, half_life_told_days: 180,
  tell_at_bps: 2_000, rehearse_bps: 3_000, bystander_bps: 5_000, witness_days: 3,
  practice_window_days: 1_825, practice_min_occasions: 5, practice_inertia_bps: 5_000, practice_opening: 100,
};
const INTS: (keyof CultureParams)[] = Object.keys(CULTURE_DEFAULTS) as (keyof CultureParams)[];

/** The sizes the world gives, over the defaults, refusing any that would break the arithmetic (a weight below 1, a window
 * below the prior, a share outside 0..10000). */
export function cultureParams(given?: any): CultureParams {
  const p = { ...CULTURE_DEFAULTS, ...(given ?? {}) } as CultureParams;
  for (const k of INTS) if (!Number.isInteger(p[k]) || p[k] < 0) throw new Error(`dials.culture.step.${k}: a size is a whole number, not below 0; got ${p[k]}`);
  for (const k of ["own_sd_bps", "values_bps", "w_does_bps", "w_approves_bps", "close_affinity_bps", "conceal_bps", "integrity_tells_bps", "approves_default_bps", "does_default_bps", "margin_bps", "cool_bps", "esteem_bps", "gossip_bps", "disapproved_bps", "seen_bps", "read_bps", "pass_bps", "negative_bps", "tell_at_bps", "rehearse_bps", "bystander_bps", "practice_inertia_bps"] as const)
    if (p[k] > 10_000) throw new Error(`dials.culture.step.${k}: a share is from 0 to 10000; got ${p[k]}`);
  for (const k of ["prior_weight", "window", "known_weight", "close_weight", "published_weight", "internalise_days", "sd_bps", "newcomer_weight", "slots", "half_life_seen_days", "half_life_told_days", "witness_days", "gossip_days", "third_kept", "practice_window_days", "practice_min_occasions", "practice_opening"] as const)
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

/** A conduct's five numbers in the record: [does, approves, own, says, n]. */
export type NormsRow = [number, number, number, number, number];
/** The record's `norms`: one place for each conduct of `CONDUCTS`, in that order, null where the person holds none. */
export type NormsSection = (NormsRow | null)[];
/** The record's norms as named rows (for a reader of a log or a test): the conduct, and its numbers. */
export const normsRows = (section: NormsSection | undefined): { conduct: Conduct; numbers: NormsRow }[] =>
  (section ?? []).flatMap((r, i) => (r ? [{ conduct: CONDUCTS[i]!, numbers: r }] : []));
