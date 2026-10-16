// group.founded: the post a founder holds in what they have founded (docs/behaviour/founding.md). A group that
// gathers, a fund its members pay into and draw on, or a body that takes its members' grievances up: each put up from
// blocks that exist (a statement of what it is for, a gathering, an offer of membership, a hearing), by one module
// whose parameters say which. The kernel knows none of them by name.
//
// What it does, as a convenor does it: opens an account if it takes dues; says what it is for; puts up its gathering
// at the one place it can use (the founder's home, until it outgrows it and can pay the hire of a hall); offers
// membership and takes in whoever applies; pays a member's draw on the fund by its stated rule; hears its members'
// grievances with the hours its members give; and winds up when nobody has joined.
//
// Words (docs/design/ai-citizens.md 10e): where the founder was given a composed piece, each part of it goes through
// the translator as a plain request, as a seat's words do, and is carried out only if the draft is what this module
// says it may be (founding.ts, `accept...`). What the translator cannot write arrives as the composer's closed choice
// among what was open, written by this code; with no piece, or a choice outside what was open, the plain default
// stands. Which way each part arrived is on the paper it made and in the organisation's record.

import type { Block, Observation, ParticipantAction, StatementRecord } from "../contracts";
import { channels } from "../contracts";
import { cents } from "../money";
import { params, RECORD, wait, WORDS, type BehaviourModule, type ParticipantContext, type RecordChange, type Words } from "../module";
import * as C from "../calls";
import { because, Book, callAction, DAY, MONTH, noted, offer, pay, say, usd, withdraw, type Step } from "./common";
import { Hearings, hearingOffer, type Hears } from "./desk";
import { acceptGathering, acceptMembership, acceptPurpose, membershipOffer, type Shape } from "./founding";

type Way = "translator" | "choice" | "code";
interface Composed { purpose: string; asks: string; gathers: string; choice: { dues: number; every_days: number; starts_in_days: number; lasts_minutes: number }; model: string }
type Item = Step | { words: Words; text: string };

const quoted = (s: string) => s.replace(/\s+/g, " ").replace(/"/g, "'").trim();

export const founded: BehaviourModule = {
  name: "group.founded",
  version: "0.2.1", // 0.2.1: the gathering's request names the cell the founder's home stands on (`place_on`), so that a translator can write the notice's on=; 0.2.0: a fund states its rule with its offer of membership (who may draw, how much, how often), in words and figures, and says it again when it refuses; 0.1.0: what a founder's post does for a group, a fund or a body that takes grievances up (docs/behaviour/founding.md)
  doc: "docs/behaviour/founding.md",
  cadence: (ctx) => (ctx.params.shape === "cause" ? DAY : 7 * DAY),
  firstWake: () => 0,
  create(ctx: ParticipantContext) {
    const p = params({
      founder: "", shape: "gathering" as Shape, idea: "", name: "", purpose: "",
      // The founder's want, carried here as what the organisation is for; and whom it is against, where anyone.
      want: { about: "", since: 0, weight: 0 } as { about: string; whom?: string; since: number; weight: number },
      // Where it can gather: the founder's home, and how many it holds besides those who live there.
      place: "", place_room: 4,
      // The cell the home stands on (empty: not known): the gathering's request puts the notice up on it, for the
      // translator's `on=` (a place on the ground, which a space inside a building is not; docs/decisions.md, 2026-10-14).
      place_on: "",
      bank: "", founded_at: 0,
      // The composed piece, where there is one (the name is the organisation's already).
      composed: null as Composed | null,
      dues: [0] as number[], every_days: [14] as number[], starts_in_days: [7] as number[], lasts_minutes: [90] as number[], at_seconds: 19 * 3600,
      lapse_days: 120, min_members: 2,
      hall: null as { space: string; town: string; account: string; hire: number } | null,
      fund: { qualify_days: 60, draw_months: 6, every_days: 180 },
      cause: { case_hours: 6, hours_per_member_month: 2, answer_days: 14 },
      member_notice_days: 7,
    }, ctx.params);
    const me = ctx.entity;
    const book = new Book();
    const queue: Item[] = [];
    const c = p.composed;
    const pick = (given: number | undefined, open: number[]) => (given !== undefined && open.includes(given) ? given : open[0]!);
    // What the group asks and when it gathers: the composer's closed choice where it is among what was open, else the
    // plain default (the first of each).
    const dues = pick(c?.choice.dues, p.dues);
    const every = pick(c?.choice.every_days, p.every_days) * DAY;
    const lasts = pick(c?.choice.lasts_minutes, p.lasts_minutes) * 60;
    const firstAt = (Math.floor(p.founded_at / DAY) + pick(c?.choice.starts_in_days, p.starts_in_days)) * DAY + p.at_seconds;
    const chose = (given: number | undefined, open: number[]): Way => (c && given !== undefined && open.includes(given) ? "choice" : "code");
    const draws = p.shape === "fund" ? dues * p.fund.draw_months : 0;
    const noticeSecs = p.member_notice_days * DAY;

    // Which way each part arrived, and where things stand.
    const arrived: { [part: string]: Way } = {};
    const asked = new Set<string>(); // parts sent through the translator (once each)
    let accountAsked = false;
    let place = p.place;
    let lapsed = false;
    let fewSince: number | null = null;
    let hallAsked = false;
    const handled = new Set<string>();
    const drew = new Map<string, number>();
    const counts: { [what: string]: number } = {};
    const count = (what: string, n = 1) => { counts[what] = (counts[what] ?? 0) + n; };
    const since: NonNullable<RecordChange["because"]> = [];
    const happened = (t: number, what: string, about?: string, size = 1_000) => { size = Math.max(0, Math.min(10_000, Math.round(size))); since.push({ t, what, ...(about ? { about } : {}), size }); if (since.length > 16) since.shift(); };
    const recent: { t: number; what: string; about?: string; size: number }[] = [];
    const remember = (t: number, what: string, about?: string, size = 1_000) => { size = Math.max(0, Math.min(10_000, Math.round(size))); recent.push({ t, what, ...(about ? { about } : {}), size }); if (recent.length > 8) recent.shift(); happened(t, what, about, size); };
    let written = "";
    let hoursBank = 0;
    let hoursAt = p.founded_at;

    const hears: Hears[] = p.shape === "cause" && p.want.about ? [{ about: p.want.about, can: ["recommend", "represent"] }] : [];
    const hearings = new Hearings(me, ctx.rng, { hears, answer_days: p.cause.answer_days, uphold_bps: { other: 5_000 }, within_days: 28, refer_to: {} });

    const mine = (kind: string): StatementRecord | undefined => book.open(kind).find((r) => r.speaks_for === me);
    const members = (): { who: string; agreement: string; at: number }[] => book.ofType("agreement").flatMap((r) =>
      r.record === "agreement" && r.terms.template === "membership" && r.terms.parties[0] === me && book.inForce(r.id) ? [{ who: r.terms.parties[1] as string, agreement: r.id, at: r.at }] : []);

    /** A part of the piece sent through the translator; if it does not come back as what it may be, `otherwise`. */
    const through = (part: string, text: string, accept: (blocks: Block[]) => Block[] | string, otherwise: () => Step, fallback: Way): Item => ({
      text,
      words: { what: part, idea: p.idea, accept, done: (ok) => {
        if (ok) arrived[part] = "translator";
        else { arrived[part] = fallback; queue.unshift(otherwise()); }
      } },
    });
    const sayPurpose = (): Step => because("Saying what we are for, in plain words.",
      say("purpose", p.purpose, { visible: "public", assertion: { that: p.purpose.slice(0, 1_000) }, data: { idea: p.idea, written_by: "code", for: p.founder } }));
    const gatherText = () => `${p.name} gathers at ${place} every ${every / DAY} days at ${Math.floor(p.at_seconds / 3600)}:00, for ${lasts / 60} minutes. All welcome.`;
    const sayGathering = (way: Way, at = place, first = firstAt): Step => because(`Putting up our gathering (${way === "choice" ? "as chosen" : "as is usual"}).`,
      say("notice", c && way === "choice" ? c.gathers : gatherText(), { visible: "public", practice: { at, every, first, lasts, roles: [{ role: "member", open: true }] }, data: { idea: p.idea, words: way } }));
    // A fund's rule, stated with its offer of membership, in words and as figures: who may draw, how much, how often,
    // and that it pays while it has the money. It pays and refuses by this and nothing else. (Until 2026-10-12 the
    // offer said only "a member who is short may draw": in the fourth living pilot 154 members of a fund 45 days old
    // asked for 167 draws, and every one was refused for a qualifying period the offer never stated.)
    const rule = draws > 0 ? { draw: draws, qualify_days: p.fund.qualify_days, every_days: p.fund.every_days } : undefined;
    const ruleText = () => (rule ? ` The fund's rule: a member of ${rule.qualify_days} days or more who is short may draw up to ${usd(rule.draw)}, once in ${rule.every_days} days, while the fund has it.` : "");
    const memberText = () => `Anyone may join ${p.name}.${dues > 0 ? ` Members pay ${usd(dues)} a month.` : " Nothing is asked but to come."}${ruleText()}`;
    // (Where the founder's own words are the offer, the rule follows them, written by code: a rule is figures.)
    const sayMembership = (way: Way, account?: string): Step => because(`Offering membership (${way === "choice" ? "as chosen" : "as is usual"}).`,
      say("membership", c && way === "choice" ? `${c.asks}${ruleText()}` : memberText(), { visible: "public", offer: membershipOffer(me, dues, account, noticeSecs, draws), data: { idea: p.idea, words: way, dues, ...(rule ? { fund: rule } : {}) } }));

    const plan = (obs: Observation): Item[] => {
      const t = obs.t;
      const out: Item[] = [];
      if (lapsed) return out;
      const acc = channels.accounts(obs).find((a) => a.holder === me && a.custodian !== me);
      // ---- setting up: an account, where money is to pass; what we are for; the gathering; membership; a hearing ----
      if (dues > 0 && !acc) {
        if (!accountAsked) { accountAsked = true; out.push(because("Dues are to be paid: opening an account at the bank.", C.call("account", { holder: me, at: p.bank }))); }
        return out;
      }
      if (!mine("purpose")) {
        if (c && !asked.has("purpose")) {
          asked.add("purpose");
          out.push(through("purpose", `Put out a public statement, of kind purpose, in these words: "${quoted(c.purpose)}"`,
            (blocks) => { const r = acceptPurpose(me)(blocks); return typeof r === "string" ? r : r.map((b: any) => ({ ...b, data: { idea: p.idea, written_by: "composer", model: c.model, for: p.founder } })); }, sayPurpose, "code"));
        } else if (!c || arrived.purpose === undefined) { arrived.purpose = "code"; out.push(sayPurpose()); }
        return out;
      }
      const gathering = book.practices().find((r) => (r.speaks_for ?? r.author) === me);
      if (!gathering) {
        const way: Way = [chose(c?.choice.every_days, p.every_days), chose(c?.choice.lasts_minutes, p.lasts_minutes)].includes("choice") ? "choice" : "code";
        if (c && !asked.has("gathers")) {
          asked.add("gathers");
          out.push(through("gathers", `Put up a public notice of our gathering, a practice held at ${place}${p.place_on && place === p.place ? `, on ${p.place_on}` : ""}: "${quoted(c.gathers)}"`,
            acceptGathering(me, { at: place, every_days: p.every_days, lasts_minutes: p.lasts_minutes, first: [t, t + 30 * DAY], at_seconds: p.at_seconds }), () => sayGathering(way), way));
        } else if (!c) { arrived.gathers = "code"; out.push(sayGathering("code")); }
        return out;
      }
      if (!mine("membership")) {
        const way = chose(c?.choice.dues, p.dues);
        if (c && !asked.has("asks")) {
          asked.add("asks");
          out.push(through("asks", `Offer membership publicly, for anyone to join: "${quoted(c.asks)}"${acc && dues > 0 ? ` Dues are paid monthly into ${acc.account}.` : ""}`,
            acceptMembership(me, { account: acc?.account, dues: p.dues, notice: noticeSecs }), () => sayMembership(way, acc?.account), way));
        } else if (!c) { arrived.asks = "code"; out.push(sayMembership("code", acc?.account)); }
        return out;
      }
      if (hears.length && !book.hearings().some((r) => r.speaks_for === me))
        out.push(because("Saying what we take up for our members.", say("hearing", `${p.name} takes up for its members: ${hears.map((h) => h.about.replace(/_/g, " ")).join(", ")}${p.want.whom ? `, with ${p.want.whom}` : ""}. Members apply in writing; there is no fee.`,
          { visible: "public", offer: hearingOffer(me, hears, { members_of: me }), data: { hears: hears.map((h) => h.about), idea: p.idea } })));

      // ---- members: whoever applies is offered membership on the terms we have put up ----
      const standing = mine("membership");
      const asks = standing?.offer?.terms?.commitments?.find((x: any) => x.who === "taker" && x.does?.outcome?.money)?.does as any;
      const owed = asks ? cents(asks.outcome.money.amount) : 0;
      const now = members();
      const inForce = new Set(now.map((m) => m.who));
      for (const a of book.open("membership_application")) {
        if (handled.has(a.id) || !(a.addressed_to ?? []).includes(me)) continue;
        handled.add(a.id);
        const who = a.speaks_for!;
        if (inForce.has(who)) continue;
        count("applications");
        out.push(because(`${who} asks to join: offering membership${owed > 0 ? `, ${usd(owed)} a month in dues` : ""}.`,
          offer(who, { template: "membership", theirNotice: noticeSecs, we: C.text(`${me} counts ${who} among its members.`) as any,
            ...(owed > 0 && acc ? { they: pay(acc.account, owed, { every: MONTH, for: "Dues." }) } : {}), text: `${who} is a member of ${me}${owed > 0 ? `, paying dues of ${usd(owed)} a month` : ""}.`, basis: a.id })));
      }
      const joined = now.filter((m) => !handled.has(`in:${m.agreement}`));
      for (const m of joined) { handled.add(`in:${m.agreement}`); remember(t, "member_joined", m.who); count("joined"); }

      // ---- a fund: a member who is short asks, and is paid by the rule we stated, while the money lasts ----
      if (draws > 0 && acc) for (const r of book.open("fund_claim")) {
        if (handled.has(r.id) || !(r.addressed_to ?? []).includes(me)) continue;
        handled.add(r.id);
        const who = r.speaks_for!;
        const m = now.find((x) => x.who === who);
        const want = Math.min(draws, cents(r.data?.amount ?? draws));
        const balance = cents(acc.balance);
        const why = !m ? "not a member" : t - m.at < p.fund.qualify_days * DAY ? "not yet a member long enough" : t - (drew.get(who) ?? -Infinity) < p.fund.every_days * DAY ? "drew not long ago" : balance < want ? "the fund has not got it" : !r.data?.account ? "no account given" : "";
        count(why ? "draws_refused" : "draws_paid");
        if (!why) { drew.set(who, t); remember(t, "fund_drawn", who, want); acc.balance = String(balance - want) as any; }
        out.push(because(why ? `${who} asks to draw on the fund: ${why}.` : `${who} is short and asks to draw on the fund: paying ${usd(want)}.`,
          say("fund_decision", why ? `We cannot pay a draw now: ${why}.${ruleText()}` : `A draw of ${usd(want)} from the fund, paid.`, { to: [who], visible: [me, who], basis: r.id, data: { granted: !why, ...(why ? { why } : { amount: want }) } }),
          ...(why ? [] : [pay(String(r.data.account), want, { from: acc.account, for: "A draw on the fund." })])));
      }

      // ---- grievances taken up, as far as our members' hours go ----
      if (hears.length) {
        hoursBank = Math.min(p.cause.case_hours * 4, hoursBank + ((now.length + 1) * p.cause.hours_per_member_month * (t - hoursAt)) / MONTH);
        hoursAt = t;
        const before2 = Object.entries(hearings.counts).filter(([k]) => k !== "applications").reduce((a, [, n]) => a + n, 0);
        out.push(...hearings.steps(book, t, "all", Math.floor(hoursBank / p.cause.case_hours)));
        const decided = Object.entries(hearings.counts).filter(([k]) => k !== "applications").reduce((a, [, n]) => a + n, 0) - before2;
        hoursBank = Math.max(0, hoursBank - decided * p.cause.case_hours);
        if (decided) { count("cases_decided", decided); happened(t, "cases_decided", undefined, decided); }
      }

      // ---- outgrown the founder's home: the hall, when we can pay its hire, booked with whoever keeps it ----
      // (Only a group whose dues, between one gathering and the next, come to the hire: one that could pay for three
      // evenings out of what it has and nothing after would spend its members' money on a room.)
      if (p.hall && !hallAsked && place !== p.hall.space && acc && now.length + 1 > p.place_room && cents(acc.balance) >= 3 * p.hall.hire && (now.length * dues * every) / MONTH >= p.hall.hire) {
        hallAsked = true;
        place = p.hall.space;
        const next = gathering.practice!.first! + Math.ceil(Math.max(0, t + DAY - gathering.practice!.first!) / every) * every;
        remember(t, "moved_to_hall", p.hall.space);
        out.push(because(`${now.length} members are more than ${p.place} holds, and we can pay for the hall: booking it, ${usd(p.hall.hire)} a gathering.`,
          say("hall_booking", `Booking: ${p.name} asks for the hall (${p.hall.space}) every ${every / DAY} days from day ${Math.floor(next / DAY)}, for ${lasts / 60} minutes, at the hire of ${usd(p.hall.hire)} a time, paid into ${p.hall.account}.`,
            { to: [p.hall.town], visible: [me, p.hall.town], data: { space: p.hall.space, every, first: next, lasts, hire: p.hall.hire, account: acc.account, members: now.length } }),
          pay(p.hall.account, p.hall.hire, { from: acc.account, every, first: Math.max(0, next - t), for: "Hall hire." }),
          withdraw(gathering.id, "We have moved to the hall."),
          say("notice", `${p.name} now gathers at ${p.hall.space} every ${every / DAY} days at ${Math.floor(p.at_seconds / 3600)}:00, for ${lasts / 60} minutes. All welcome.`,
            { visible: "public", practice: { at: p.hall.space, every, first: next, lasts, roles: [{ role: "member", open: true }] }, data: { idea: p.idea, words: "code" } })));
      }

      // ---- a thing nobody joins lapses ----
      if (now.length >= p.min_members) fewSince = null;
      else if (fewSince === null) fewSince = Math.max(t, p.founded_at);
      if (fewSince !== null && t - fewSince >= p.lapse_days * DAY) {
        lapsed = true;
        remember(t, "wound_up", undefined, now.length);
        const st = because(`${now.length} members after ${p.lapse_days} days: winding up.`,
          ...[mine("membership"), gathering, ...book.hearings().filter((r) => r.speaks_for === me)].filter((r): r is StatementRecord => !!r).map((r) => withdraw(r.id, "Wound up.")),
          say("wound_up", `${p.name} has wound up: too few came.`, { ...(now.length ? { to: now.map((m) => m.who).sort() } : {}), visible: "public", data: { idea: p.idea, members: now.length, days: Math.floor((t - p.founded_at) / DAY) } }));
        out.push(st);
      }
      return out;
    };

    /** The organisation's record (contracts/entity-record.schema.json, OrganisationRecord): what it is for, carried
     * from its founder's want; the last things that happened to it; how it stands. */
    const change = (obs: Observation): RecordChange | null => {
      const acc = channels.accounts(obs).find((a) => a.holder === me && a.custodian !== me);
      const all = {
        purpose: { idea: p.idea, founder: p.founder, shape: p.shape, about: p.want.about, ...(p.want.whom ? { whom: p.want.whom } : {}), since: Math.round(p.want.since),
          words: mine("purpose")?.text?.slice(0, 1_024) ?? p.purpose.slice(0, 1_024), arrived: { ...arrived }, ...(c ? { model: c.model } : {}) },
        wants: p.want.about ? [{ about: p.want.about, ...(p.want.whom ? { whom: p.want.whom } : {}), seeks: [], weight: Math.max(1, Math.round(p.want.weight)), since: Math.round(p.want.since), from: "other", tried: 0 }] : [],
        memory: { recent: recent.map((r) => ({ ...r })) },
        circumstances: { ...Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1))), members: members().length, lapsed: lapsed ? 1 : 0, at_hall: p.hall && place === p.hall.space ? 1 : 0, ...(acc ? { balance: cents(acc.balance) } : {}) },
      };
      const text = JSON.stringify(all);
      if (text === written) return null;
      const before = written ? JSON.parse(written) : {};
      const set = Object.fromEntries(Object.entries(all).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])));
      written = text;
      const why = since.splice(0);
      return { set, ...(why.length ? { because: why } : {}) };
    };

    let plannedAt = -1;
    return {
      step(obs: Observation): ParticipantAction {
        book.absorb(obs);
        if (plannedAt !== obs.t && (obs.woke_for !== "done" || queue.length === 0)) {
          plannedAt = obs.t;
          queue.push(...plan(obs).filter((x) => "words" in x || x.length));
        }
        const next = queue.shift();
        if (!next) {
          // (Setting up goes a part at a time: awake again within the day until it is done; then on our cadence.)
          const settingUp = !lapsed && (!mine("purpose") || !mine("membership") || !book.practices().some((r) => (r.speaks_for ?? r.author) === me));
          const a = wait(lapsed ? ctx.world.runEnd : settingUp && obs.t - p.founded_at < 3 * DAY ? obs.t + Math.max(3600, ctx.world.tickSeconds) : undefined);
          const ch = change(obs);
          if (ch) Object.defineProperty(a, RECORD, { value: ch, enumerable: false });
          return a;
        }
        if ("words" in next) {
          const a: ParticipantAction = { type: "propose", text: next.text };
          Object.defineProperty(a, WORDS, { value: next.words, enumerable: false });
          return a;
        }
        return noted(book, callAction(next));
      },
    };
  },
};
