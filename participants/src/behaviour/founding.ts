// Founding (docs/design/ai-citizens.md 10b, 10k step 3; docs/behaviour/founding.md): a person whose want has been
// given up, or who can see nothing that would answer it, and who knows others in the same case, may start something
// of their own. What they start is put up from blocks that exist: an organisation with a first post, a statement of
// what it is for, a gathering, an offer of membership, and for some a hearing of grievances. The kernel knows no
// church, union or club: each is a group whose founder said what it is for.
//
// Arithmetic and words only: no model, no clock, no draw but from the streams handed in. Every size is a parameter
// (`founding`, from the world's profile). Unless docs/behaviour/founding.md names a source, a size is a PLACEHOLDER.

import type { Block } from "../contracts";
import type { Rng } from "../rng";

/** The shapes a founded thing may have: each a composition of blocks, none a kind the kernel knows. */
export type Shape = "gathering" | "fund" | "cause" | "business";
export const SHAPES: readonly Shape[] = ["gathering", "fund", "cause", "business"];

export interface FoundingParams {
  /** Which shapes may be founded (the world's dial; none: nobody founds anything). */
  shapes: Shape[];
  /** The chance that a person of the town's mean temperament and standing, at an occasion (a want given up or with
   * nothing to answer it, shared by enough others), founds something. FITTED to the place's sourced rate of new
   * associations per 1,000 residents a year (`per_1000_per_year`, which code never reads). */
  chance_bps: number;
  /** The dial's scale on that chance (10,000: as fitted). */
  scale_bps: number;
  /** How many others must share the want, as the person knows them. PLACEHOLDER (a critical mass: Marwell and Oliver). */
  shared_min: number;
  /** How far a standard deviation of each sways the chance (a share of it): openness and achievement; care for
   * others; the sense of agency; how long they have lived here; how many they are close to. PLACEHOLDERS. */
  sway: { enterprise: number; care: number; agency: number; standing: number; ties: number };
  /** The odds of each shape by what the want is about (`other` for the rest), before the person's values lean them. */
  shape_odds: { [about: string]: { [s in Shape]?: number } };
  /** How far a standard deviation of the values that speak to a shape leans its odds. PLACEHOLDER. */
  lean: number;
  /** After founding, or deciding not to at an occasion, the same person does not weigh it again for this long. */
  rest_days: number;
  /** What a founder may ask of members, as closed choices: dues a month (the world's smallest unit; the first is the
   * plain default), how often it gathers, how soon the first, how long. PLACEHOLDERS. */
  dues: number[];
  every_days: number[];
  starts_in_days: number[];
  lasts_minutes: number[];
  /** The hour of the day gatherings start (seconds from midnight). */
  at_seconds: number;
  /** A thing nobody joins lapses: fewer than `min_members` besides its founder for this long. PLACEHOLDERS. */
  lapse_days: number;
  min_members: number;
  /** A member who has not come for this long gives notice. PLACEHOLDER. */
  leave_after_days: number;
  /** A hall the town lets for hire (none: a group stays where it began): the space, whom the booking is told to, the
   * account the hire is paid into, and the hire for one gathering. */
  hall: { space: string; town: string; account: string; hire: number } | null;
  /** A fund: a member of this long may draw, when short, up to this many months' dues, at most once in `every_days`. */
  fund: { qualify_days: number; draw_months: number; every_days: number };
  /** A body that takes grievances up: the hours a case takes, and the hours a month each member gives. */
  cause: { case_hours: number; hours_per_member_month: number; answer_days: number };
  /** The post a founder holds in what they found: its title, channels and module, with "{...}" filled in. */
  template: { kind: string; title: string; channels: unknown[]; role_module: { code: string; params: { [k: string]: unknown }; keeps_record?: boolean } } | null;
  bank: string;
}

export const FOUNDING_DEFAULTS: FoundingParams = {
  shapes: [],
  chance_bps: 0,
  scale_bps: 10_000,
  shared_min: 2,
  sway: { enterprise: 0.3, care: 0.3, agency: 0.3, standing: 0.2, ties: 0.2 },
  shape_odds: {
    loss: { gathering: 8, fund: 1, cause: 0, business: 0 },
    meaning: { gathering: 8, fund: 0, cause: 1, business: 1 },
    social: { gathering: 9, fund: 0, cause: 0, business: 0 },
    belonging: { gathering: 9, fund: 0, cause: 0, business: 0 },
    slight: { gathering: 5, fund: 0, cause: 3, business: 0 },
    let_go: { gathering: 3, fund: 3, cause: 2, business: 2 },
    security: { gathering: 1, fund: 6, cause: 1, business: 2 },
    shelter: { gathering: 1, fund: 2, cause: 6, business: 0 },
    other: { gathering: 1, fund: 2, cause: 7, business: 0 },
  },
  lean: 0.5,
  rest_days: 365,
  dues: [0],
  every_days: [14, 7, 28],
  starts_in_days: [7, 3, 14],
  lasts_minutes: [90, 60, 120],
  at_seconds: 19 * 3600,
  lapse_days: 120,
  min_members: 2,
  leave_after_days: 90,
  hall: null,
  fund: { qualify_days: 60, draw_months: 6, every_days: 180 },
  cause: { case_hours: 6, hours_per_member_month: 2, answer_days: 14 },
  template: null,
  bank: "",
};

export function foundingParams(given: any, dial: any): FoundingParams | null {
  if (!given || !dial) return null;
  const d = FOUNDING_DEFAULTS, g = given as Partial<FoundingParams>;
  const shapes = (Array.isArray(dial.shapes) ? dial.shapes : g.shapes ?? SHAPES).filter((s: string): s is Shape => (SHAPES as readonly string[]).includes(s));
  return { ...d, ...g, shapes, scale_bps: Number(dial.scale_bps ?? 10_000), sway: { ...d.sway, ...(g.sway ?? {}) }, shape_odds: { ...d.shape_odds, ...(g.shape_odds ?? {}) }, fund: { ...d.fund, ...(g.fund ?? {}) }, cause: { ...d.cause, ...(g.cause ?? {}) } };
}

/**
 * The chance of founding at an occasion, as this person's temperament and standing sway it: symmetric about the
 * town's mean, so the town's rate stays where it is fitted while people differ. Each `z` is in standard deviations.
 */
export function chanceOf(p: FoundingParams, z: { enterprise: number; care: number; agency: number; standing: number; ties: number }): number {
  const c = (x: number) => Math.max(-3, Math.min(3, x));
  const shift = p.sway.enterprise * c(z.enterprise) + p.sway.care * c(z.care) + p.sway.agency * c(z.agency) + p.sway.standing * c(z.standing) + p.sway.ties * c(z.ties);
  return Math.max(0, Math.min(10_000, Math.round(((p.chance_bps * p.scale_bps) / 10_000) * Math.max(0, 1 + shift))));
}

/** Which values speak to which shape (the mapping is ours, to test against data, as an organisation's character is). */
const LEANS: { [s in Shape]: [plus: string[], minus: string[]] } = {
  gathering: [["tradition", "benevolence", "conformity"], ["power"]],
  fund: [["security", "benevolence"], ["stimulation"]],
  cause: [["universalism", "self_direction"], ["conformity"]],
  business: [["achievement", "stimulation", "self_direction"], ["security"]],
};

/** The odds of each shape that may be founded here, for this want and this person (whole numbers; all 0: none). */
export function shapeOdds(p: FoundingParams, about: string, hasParty: boolean, zValue: (v: string) => number, able: { [s in Shape]?: boolean } = {}): { key: Shape; score: number }[] {
  const base = p.shape_odds[about] ?? p.shape_odds.other ?? {};
  return p.shapes.map((s) => {
    const [plus, minus] = LEANS[s];
    const z = plus.reduce((a, v) => a + zValue(v), 0) / plus.length - minus.reduce((a, v) => a + zValue(v), 0) / minus.length;
    // (A body that takes grievances up needs someone the grievance is against.)
    const can = able[s] !== false && (s !== "cause" || hasParty);
    return { key: s, score: can ? Math.max(0, Math.round((base[s] ?? 0) * 1_000 * Math.max(0, 1 + p.lean * Math.max(-3, Math.min(3, z))))) : 0 };
  });
}

/** A draw among options by their scores, on the stream handed in. */
export function drawOf<K extends string>(rng: Rng, options: { key: K; score: number }[]): K | undefined {
  const total = options.reduce((a, o) => a + o.score, 0);
  if (total <= 0) return undefined;
  let x = rng.below(total);
  for (const o of options) {
    if (x < o.score) return o.key;
    x -= o.score;
  }
  return options.at(-1)?.key;
}

/** What a want is about, in the world's own plain words (for a statement written without a model). */
export const MATTER: { [about: string]: string } = {
  let_go: "being let go from work", notice: "being given notice to leave a home", rent_increase: "a rise in the rent", claim_refused: "a claim for support refused",
  disrepair: "a home left in disrepair", bill: "a bill that was wrong", goods: "goods that were faulty", underpaid: "pay that came short", unpaid: "pay that never came",
  loss: "the death of someone close", meaning: "wanting something that matters", social: "wanting company", belonging: "wanting to belong somewhere", security: "having nothing to fall back on",
  shelter: "having no home that is secure", slight: "being turned away", service: "a service the town has not done", arrears: "money owed and unpaid", status: "wanting work of one's own", subsistence: "going short of everyday things",
};
export const matterWords = (about: string) => MATTER[about] ?? about.replace(/_/g, " ");

/** The statement of purpose code writes with no model: the founder's want in the world's own terms. */
export function plainPurpose(shape: Shape, want: { about: string; whom?: string }, sharers: number): string {
  const what = matterWords(want.about);
  // (Someone lost is whom the want is about, not who did it.)
  const whom = want.whom && want.about !== "loss" ? ` at the hands of ${want.whom}` : "";
  const does = shape === "fund" ? "We pay into a common fund, and a member who is short may draw on it."
    : shape === "cause" ? `We take up such matters${want.whom ? ` with ${want.whom}` : ""} for our members, together.`
    : "We meet, so that nobody has to carry it alone.";
  return `This is for those who know ${what}${whom}. ${sharers} of us began it. ${does}`;
}
export const plainName = (shape: Shape, founder: string, want: { about: string; whom?: string }) =>
  `${shape === "fund" ? "Fund" : shape === "cause" ? "Association" : "Circle"} (${want.about.replace(/_/g, " ")}${want.whom ? `, ${want.whom}` : ""}; ${founder})`;

/** The piece asked for is a dark one (VISION 15, point 7: counted and reported with every run), by this rule and no
 * other: what the want is about, or what the record shows of the person. Returns why (none: not dark). */
export const DARK_ABOUT = ["loss", "notice", "claim_refused", "shelter"];
export function darkOf(want: { about: string }, record: { [section: string]: any }, zAgency: number): string[] {
  const why: string[] = [];
  if (DARK_ABOUT.includes(want.about)) why.push(`about:${want.about}`);
  const defining = (record.memory?.defining ?? []) as { what: string }[];
  for (const w of ["bereaved", "ruined", "evicted", "left_on_order"]) if (defining.some((m) => m.what === w)) why.push(`lived:${w}`);
  if (record.circumstances?.housed === 0) why.push("homeless");
  if (zAgency <= -1) why.push("agency_low");
  return why;
}

// ---------------------------------------------------------------------------------------------- what a draft may be

const pub = (b: Block): any => (b.block === "publish" ? b : undefined);
const one = (blocks: Block[]): Block | string => (blocks.length === 1 ? blocks[0]! : `a draft of ${blocks.length} acts where one was meant`);

/** A draft that founds the organisation: one `create_entity` of the kind meant; the post's channels and module are
 * the founder's own plumbing (never words), put in here. */
export function acceptEntity(kind: string, title: string, channels: unknown[], role_module: unknown): (blocks: Block[]) => Block[] | string {
  return (blocks) => {
    const b = one(blocks);
    if (typeof b === "string") return b;
    if (b.block !== "create_entity") return `a draft that ${b.block.replace(/_/g, " ")}s where an organisation was to be founded`;
    if (b.kind !== kind) return `an organisation of kind ${b.kind} where ${kind} was meant`;
    const name = String(b.name ?? "").trim();
    if (!name || name.length > 120) return "no usable name";
    return [{ block: "create_entity", kind, name, ref: "founded", first_position: { title, channels, role_module } } as unknown as Block];
  };
}

/** A draft that says what the organisation is for: one public statement in its own name, nothing else on it. Marked
 * as put forward to be held (`assertion`), which is structure and not words. */
export function acceptPurpose(me: string): (blocks: Block[]) => Block[] | string {
  return (blocks) => {
    const b = pub(one(blocks) as Block);
    if (!b) return "a draft that is no statement";
    if ((b.speaks_for ?? me) !== me) return "a statement in someone else's name";
    if (b.visible_to !== "public") return "a statement that is not public";
    if (b.offer || b.practice || b.addressed_to?.length || typeof b.text !== "string" || !b.text.trim()) return "a statement carrying more than its words";
    return [{ block: "publish", kind: "purpose", text: b.text, visible_to: "public", speaks_for: me, assertion: { that: b.text.slice(0, 1_000) } } as unknown as Block];
  };
}

export interface GatherBounds { at: string; every_days: number[]; lasts_minutes: number[]; first: [number, number]; at_seconds: number }
/** A draft that puts up the gathering: one public notice with a practice, at the one place the group can use, with a
 * rhythm and a length among those open to it. */
export function acceptGathering(me: string, g: GatherBounds): (blocks: Block[]) => Block[] | string {
  return (blocks) => {
    const b = pub(one(blocks) as Block);
    const pr = b?.practice;
    if (!b || !pr) return "a draft with no gathering in it";
    if ((b.speaks_for ?? me) !== me || b.visible_to !== "public") return "a notice that is not ours, or not public";
    if (b.offer) return "a notice carrying an offer as well";
    if (pr.at !== g.at) return `a gathering at ${pr.at}, where we have no place`;
    if (!g.every_days.includes(pr.every / 86_400)) return `a gathering every ${pr.every} seconds, which is not among what was open`;
    const lasts = pr.lasts ?? 3_600;
    if (!g.lasts_minutes.includes(lasts / 60)) return `a gathering of ${lasts} seconds, which is not among what was open`;
    const first = pr.first ?? g.first[0];
    if (first < g.first[0] || first > g.first[1]) return "a first gathering outside the days open to it";
    if (pr.during?.length || (pr.roles ?? []).some((r: any) => r.who && Object.keys(r.who).length)) return "a gathering with rules of its own";
    return [{ block: "publish", kind: "notice", text: String(b.text ?? ""), visible_to: "public", speaks_for: me, practice: { at: g.at, every: pr.every, first, lasts, roles: [{ role: "member", open: true }] } } as unknown as Block];
  };
}

/** A draft that offers membership: one public statement with an offer to join, whose only typed ask is dues among
 * those open, paid into the organisation's own account. */
export function acceptMembership(me: string, o: { account?: string; dues: number[]; notice: number }): (blocks: Block[]) => Block[] | string {
  return (blocks) => {
    const b = pub(one(blocks) as Block);
    const offer = b?.offer;
    if (!b || !offer) return "a draft with no offer in it";
    if ((b.speaks_for ?? me) !== me || b.visible_to !== "public") return "an offer that is not ours, or not public";
    if (offer.take_up !== "join" || offer.hears || b.practice) return "an offer of something other than joining";
    if (offer.to && Object.keys(offer.to).some((k) => k !== "anyone")) return "an offer with conditions of its own";
    let dues = 0;
    for (const c of offer.terms?.commitments ?? []) {
      const m = c.does?.outcome?.money;
      if (c.who !== "taker" || !m) continue;
      if (m.to !== o.account) return "dues paid to an account that is not ours";
      if (c.every !== 30 * 86_400) return "dues that are not monthly";
      dues += Number(m.amount);
    }
    if (!o.dues.includes(dues)) return `dues of ${dues}, which are not among what was open`;
    return [{ block: "publish", kind: "membership", text: String(b.text ?? ""), visible_to: "public", speaks_for: me, offer: membershipOffer(me, dues, o.account, o.notice) } as unknown as Block];
  };
}

/** The offer of membership as the contract's typed vocabulary has it (blocks: Offer): joining, with dues if any. */
export function membershipOffer(me: string, dues: number, account: string | undefined, notice: number, draws?: number): any {
  const commitments: any[] = [
    ...(dues > 0 && account ? [{ who: "taker", does: { outcome: { money: { to: account, amount: String(dues), for: "dues" } } }, every: 30 * 86_400 }] : []),
    ...(draws && draws > 0 ? [{ who: me, does: { outcome: { money: { amount: String(draws), for: "a draw on the fund, for a member who is short" } } } }] : []),
    { who: me, does: { text: "counts whoever joins among its members" } },
  ];
  return { by: me, take_up: "join", terms: { template: "membership", commitments, termination: [{ party: "taker", notice }] } };
}
