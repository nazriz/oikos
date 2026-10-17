// body.payroll: a body's payroll officer, and the deputy who keeps the officer's post filled (foundations F6;
// docs/behaviour/staffing.md, "A body's own paperwork"). Every body of the town that employs people (the tribunal, the
// bank, the union, the land registry, the water and energy bodies...) has a post whose holder, one of its staff, does what
// any employer's payroll does: starts and stops the wages its staff are paid, files and pays over the tax withheld on the
// law's days, and, when a member of its staff dies, hears of it as any employer does (the registry's entry, or its
// bank's word at the next pay day), ends the employment on record and stops the wage. It is the same `Staffing` every
// firm and the town's finance office runs; nothing about a body's payroll is special.
//
// A post whose holder has died is vacant (the kernel vacates a dead person's posts, and only a living holder of one of an
// organisation's posts can appoint into another). The officer, and the deputy for the officer's own post, look at the
// organisation's posts every few days (one look: who holds each), and where one is empty appoint one of the organisation's
// living staff to it, as a body's head of administration fills a vacancy from its own staff. A body with one member of
// staff has no one left to do it; that is the missing law (no owner or board of the body can appoint), and is said so
// in docs/behaviour/staffing.md.

import * as C from "../calls";
import type { LookRequest } from "../contracts";
import { params, type BehaviourModule, type ParticipantContext } from "../module";
import { Asked, because, Book, DAY, lookUp, LOOKS_MAX, ownAccount, type Step } from "./common";
import { Staffing, stepper } from "./firms";

/** How often the officers look at the organisation's posts (seconds): a post empty is filled within a few days. */
const LOOK_EVERY = 3 * DAY;
/** The rounds in which an appointer has looked at every post it watches that it has not seen vacant. */
const WATCH_ROUNDS = 6;
/** The round, of WATCH_ROUNDS, on which a post is looked at: from its name alone. */
const slotOf = (post: string): number => { let h = 2166136261; for (let i = 0; i < post.length; i++) h = Math.imul(h ^ post.charCodeAt(i), 16777619) >>> 0; return h % WATCH_ROUNDS; };

export const bodyPayroll: BehaviourModule = {
  name: "body.payroll",
  answers: { office: "the payroll office", acts: "What it acts on: the employment agreements of its organisation's staff and the standing payments that pay them; the tax withheld from wages, paid over on the law's days; and a member of staff who has died." },
  version: "0.4.1", // 0.4.1: an appointer looks at each post it has not seen vacant once in six rounds, on a round of the post's own (from its name), not by a turn kept in the holder's memory, so a vacancy is found on the same round whatever else is watched (bug hunt 2026-10-17); 0.4.0: an appointer that finds none of the staff to second hires for the body; 0.3.0: an appointer (the authority a body's constitution names fills a post that has stood vacant); 0.2.0: deaf to news, on a round of its own
  deaf: true,
  doc: "docs/behaviour/staffing.md",
  cadence: () => 3 * DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(3) * DAY,
  create(ctx: ParticipantContext) {
    const p = params({
      period: 14 * DAY, notice_days: 14,
      part: "officer" as "officer" | "deputy" | "appointer", // the officer runs the payroll; the deputy keeps the officer's post filled; the appointer is the authority a body's constitution names, which fills a post of that body when none of its own staff is left to
      after_days: 14, // an appointer: how long a post has stood vacant before the authority fills it (the body's own deputy has its few days first)
      role: "", // when the organisation's own module employs others (the clinic's doctors), the role of the staff this payroll pays: absent, all of the organisation's
      watch: [] as string[], // the organisation's posts a person holds, which this post keeps filled
      who: "who", // its channel onto who's who
      // An appointer that recruits (the city's: where no staff is left to second, it hires for the body it is part of, through ordinary hiring).
      workplace: "", industry: "", wage: 0, payroll_office: "", staff_line: "",
      own: [] as string[], // an appointer: the posts of its own body (no deputy keeps them filled, so it need not wait for one)
    }, ctx.params);
    const me = ctx.entity;
    const book = new Book();
    const asked = new Asked();
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, role: p.role || "staff", does: { hire: !!(p.part === "appointer" && p.workplace), pay: p.part === "officer" }, ...(p.role ? { own: "role" as const } : {}), ...(p.part === "appointer" && p.workplace ? { workplace: p.workplace, ...(p.industry ? { industry: p.industry } : {}), ...(p.payroll_office ? { payroll: p.payroll_office, line: p.staff_line } : {}) } : {}), wakes: 3 * DAY });
    const filled = new Set<string>(); // posts we have appointed into, once
    const vacantSince = new Map<string, number>(); // an appointer: a post -> when we first saw it vacant
    const gone = new Set<string>(); // staff we found had died when we tried to appoint them (nobody is told us by the registry)
    /** The people of the organisation's staff we may appoint: those in force and not known to have died. */
    const living = (t: number): string[] => {
      const dead = new Set(staffing.knownDead(book, t));
      const deaths = new Set(book.all("death_registration").map((r) => r.data?.deceased as string));
      return staffing.staff(book, t).map((a) => a.terms.parties[1] as string).filter((w) => !dead.has(w) && !deaths.has(w) && !gone.has(w));
    };
    const waits = (post: string) => (p.own.includes(post) ? 0 : p.after_days * DAY); // (a body's own posts have no deputy to give a few days to)
    const vacant = (post: string) => book.positions.has(post) && !book.positions.get(post)!.holder;
    const participantOf = (person: string) => [...book.participantPerson].find(([, who]) => who === person)?.[0];
    // The round is the payroll's own: every few days on a day of its own, whatever else wakes it. A paper addressed to the organisation wakes everyone who acts
    // for it (a seat's, say), and a payroll that did its work whenever it was woken would file on other days in a town with a seat than in the town without one.
    const phase = ctx.rng("first-wake").below(3) * DAY;
    // It acts at the first wake at or after each of its days, whatever woke it (a paper's news wake that falls on the day does the round, and the cadence's
    // wake after it finds it done): so it acts at the same moments with or without the papers.
    let ranRound = -1;
    const roundOf = (t: number) => Math.floor((t - phase) / (3 * DAY));
    const onRound = (obs: { t: number }) => roundOf(obs.t) > ranRound;
    return stepper(
      (obs) => {
        book.absorb(obs);
        staffing.absorb(obs);
      },
      (obs) => {
        if (!onRound(obs)) return [];
        ranRound = roundOf(obs.t);
        const t = obs.t;
        const steps: Step[] = [];
        const acc = ownAccount(obs);
        if (p.part === "officer" && acc) steps.push(...staffing.routine(obs, book, acc.account, { target: 0, wage: 0, canPost: false }));
        // An appointer keeps the vacancies it has seen: a post seen full is forgotten, one seen vacant is dated.
        if (p.part === "appointer") for (const post of p.watch) if (book.positions.has(post)) {
          if (vacant(post)) { if (!vacantSince.has(post)) vacantSince.set(post, t); } else vacantSince.delete(post);
        }
        // A vacant post of the organisation's: one of its living staff takes it.
        const candidates = living(t);
        // An appointer where none of the staff is left to second: it hires for the body, through the ordinary hiring (a posting, an
        // applicant, an agreement, a wage as the body's staff are paid), and seconds whoever is hired at the next round.
        if (p.part === "appointer" && p.workplace && !candidates.length) {
          const stale = p.watch.filter((post) => vacant(post) && t - (vacantSince.get(post) ?? t) >= waits(post));
          if (stale.length) steps.push(...staffing.routine(obs, book, "", { target: staffing.workers(book, t).length + 1, wage: p.wage, canPost: true,
            why: `${stale.join(", ")} stand${stale.length === 1 ? "s" : ""} vacant and none of our staff is left to fill ${stale.length === 1 ? "it" : "them"}: posting a job, to fill ${stale.length === 1 ? "it" : "them"} from whoever is hired.` }));
        }
        for (const post of p.watch) {
          if (!vacant(post) || filled.has(`${post}@${asked.since("posts")}`) || !candidates.length) continue;
          // (The authority acts only on a post that has stood vacant: its body's own deputy fills one from its staff within days.)
          if (p.part === "appointer" && t - (vacantSince.get(post) ?? t) < waits(post)) continue;
          const choice = ctx.rng(`succeed-${post}-${Math.floor(t / DAY)}`).pick(candidates);
          const participant = participantOf(choice);
          if (!participant) continue;
          filled.add(`${post}@${asked.since("posts")}`);
          const step = because(p.part === "appointer" ? `The ${post} post has stood vacant for ${Math.floor((t - (vacantSince.get(post) ?? t)) / DAY)} days and nobody of its body is left to fill it: as the authority that fills it, seconding ${choice}, of our staff, to it.` : `The ${post} post of ours is empty (its holder has died or gone): appointing ${choice}, of our staff, to it.`, C.call("position", { appoint: post, to: participant }));
          // (Refused because they have died too, and nobody told us: they are not asked again, and the next look names another.)
          step.then = (o) => { if (o.status === "refused") gone.add(choice); };
          steps.push(step);
        }
        return steps;
      },
      (obs) => phase + (Math.floor((obs.t - phase) / (3 * DAY)) + 1) * 3 * DAY,
      (obs) => {
        if (!p.who || !onRound(obs)) return [];
        const out: LookRequest[] = [];
        const t = obs.t;
        // Every few days: who holds each of the posts we keep filled.
        if (p.watch.length && (asked.since("posts") < 0 || t - asked.since("posts") >= LOOK_EVERY)) {
          asked.again("posts", t);
          if (p.part === "appointer") {
            // (Those seen vacant are looked at every round; the rest take turns.)
            const suspects = p.watch.filter((post) => vacantSince.has(post)).slice(0, LOOKS_MAX);
            const rest = p.watch.filter((post) => !vacantSince.has(post));
            const room = LOOKS_MAX - suspects.length;
            // (Which of the rest are looked at in a round is a matter of the post and the round: each is looked at once in WATCH_ROUNDS rounds, on a round of its
            // own, never of where it stands in a list or how many looks this holder has made. So a town with one more post watched, or a post that changed
            // hands, finds a vacancy on the same round as the town without: the order of finding two vacancies is not a matter of the list's length.)
            const due = rest.filter((post) => (roundOf(t) + slotOf(post)) % WATCH_ROUNDS === 0).sort();
            const take = due.slice(0, Math.max(0, room));
            for (const post of [...suspects, ...take]) out.push(lookUp.position(p.who, post));
            return out;
          }
          for (const post of p.watch.slice(0, LOOKS_MAX)) out.push(lookUp.position(p.who, post));
          return out;
        }
        // And, where one is empty, who of the staff could take it (their participants).
        if (p.watch.some(vacant)) {
          for (const person of living(t)) if (out.length < LOOKS_MAX && !participantOf(person) && asked.first(`person:${person}`)) out.push(lookUp.entity(p.who, person));
        }
        return out;
      },
    );
  },
};
