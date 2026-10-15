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

export const bodyPayroll: BehaviourModule = {
  name: "body.payroll",
  answers: { office: "the payroll office", acts: "What it acts on: the employment agreements of its organisation's staff and the standing payments that pay them; the tax withheld from wages, paid over on the law's days; and a member of staff who has died." },
  version: "0.1.0",
  doc: "docs/behaviour/staffing.md",
  cadence: () => 3 * DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(3) * DAY,
  create(ctx: ParticipantContext) {
    const p = params({
      period: 14 * DAY, notice_days: 14,
      part: "officer" as "officer" | "deputy", // the officer runs the payroll; the deputy keeps the officer's post filled
      role: "", // when the organisation's own module employs others (the clinic's doctors), the role of the staff this payroll pays: absent, all of the organisation's
      watch: [] as string[], // the organisation's posts a person holds, which this post keeps filled
      who: "who", // its channel onto who's who
    }, ctx.params);
    const me = ctx.entity;
    const book = new Book();
    const asked = new Asked();
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, role: p.role || "staff", does: { hire: false, pay: p.part === "officer" }, ...(p.role ? { own: "role" as const } : {}), wakes: 3 * DAY });
    const filled = new Set<string>(); // posts we have appointed into, once
    const gone = new Set<string>(); // staff we found had died when we tried to appoint them (nobody is told us by the registry)
    /** The people of the organisation's staff we may appoint: those in force and not known to have died. */
    const living = (t: number): string[] => {
      const dead = new Set(staffing.knownDead(book, t));
      const deaths = new Set(book.all("death_registration").map((r) => r.data?.deceased as string));
      return staffing.staff(book, t).map((a) => a.terms.parties[1] as string).filter((w) => !dead.has(w) && !deaths.has(w) && !gone.has(w));
    };
    const vacant = (post: string) => book.positions.has(post) && !book.positions.get(post)!.holder;
    const participantOf = (person: string) => [...book.participantPerson].find(([, who]) => who === person)?.[0];
    // The round is the payroll's own: every few days on a day of its own, whatever else wakes it. A paper addressed to the organisation wakes everyone who acts
    // for it (a seat's, say), and a payroll that did its work whenever it was woken would file on other days in a town with a seat than in the town without one.
    const phase = ctx.rng("first-wake").below(3) * DAY;
    const onRound = (obs: { woke_for?: string }) => obs.woke_for !== "news";
    return stepper(
      (obs) => {
        book.absorb(obs);
        staffing.absorb(obs);
      },
      (obs) => {
        if (!onRound(obs)) return [];
        const t = obs.t;
        const steps: Step[] = [];
        const acc = ownAccount(obs);
        if (p.part === "officer" && acc) steps.push(...staffing.routine(obs, book, acc.account, { target: 0, wage: 0, canPost: false }));
        // A vacant post of the organisation's: one of its living staff takes it.
        const candidates = living(t);
        for (const post of p.watch) {
          if (!vacant(post) || filled.has(`${post}@${asked.since("posts")}`) || !candidates.length) continue;
          const choice = ctx.rng(`succeed-${post}-${Math.floor(t / DAY)}`).pick(candidates);
          const participant = participantOf(choice);
          if (!participant) continue;
          filled.add(`${post}@${asked.since("posts")}`);
          const step = because(`The ${post} post of ours is empty (its holder has died or gone): appointing ${choice}, of our staff, to it.`, C.call("position", { appoint: post, to: participant }));
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
