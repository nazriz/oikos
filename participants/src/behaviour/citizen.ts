// citizen.default: a townsperson's everyday economic life. Documented in
// docs/behaviour/citizen.md, with sources.
//
// Housing (after the Bank of England housing model, Baptista et al. 2016):
// renters budget a third of income for rent, take the best home they can
// afford from the listings they see, and don't leave a tenancy early.
// Work: the unemployed apply for the best-paid posting. Spending (after the
// same model's consumption rule): essentials, plus a fraction of savings
// above a desired buffer. Exit (Hirschman 1970): after long enough without a
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
import type { LookRequest, Observation, ParticipantAction, SiteStructure, StatementRecord } from "../contracts";
import { channels } from "../contracts";
import { params, wait, type BehaviourModule, type ParticipantContext } from "../module";
import * as C from "../calls";
import { because, Book, callAction, DAY, usd, jobTerms, leaseTerms, message, MONTH, moveIn, moveOut, notice, ownAccount, pay, petitionSignatures, publishedCount, say, sign, structureOf, vote, withdraw, type Step, ownBanked } from "./common";
import { ADULT_YEARS, ageAt, bedroomsNeeded, hear, householdOf, SAYING, type Heard, type HouseholdData, type Member } from "./household";

/** What a code citizen says when it asks around, and recognises when asked (a code citizen only understands its own phrasing). */
export const ASKING = { home: "I'm looking for somewhere to live. Do you know of anywhere?", work: "I'm looking for work. Do you know of anything going?" } as const;
type Want = keyof typeof ASKING;

/** A home is a unit (a space) in a building. */
interface Home { agreement: string; space: string; structure: string; landlord: string; rent: number; order?: string; endsAt: number; movedIn: boolean }
interface Job { agreement: string; employer: string; wage: number; period: number; workplace?: string; endsAt: number }

export const citizen: BehaviourModule = {
  name: "citizen.default",
  version: "0.9.0",
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
      essentials: 50_000, // cents per month
      spend_above_buffer_bps: 3000, // BoE eq. (2): spend a fraction of savings above the desired buffer
      buffer_months: 3,
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
      search_limit: 20, // how many listings or postings a search shows, best first
      // Word of mouth (docs/behaviour/citizen.md, D44).
      ask_home_bps: 3700, // chance a new home hunt starts by asking around (37% of renters ask friends or family: Apartments.com/NAA 2026)
      ask_work_bps: 6900, // chance a new job hunt starts by asking around (69% of young job seekers used friends and relatives over a year: Holzer 1987)
      ask_again_days: 60, // still hunting after this long: a new hunt, asked about again (placeholder)
      max_contacts: 15, // people remembered from homes and workplaces shared, most recent first (placeholder; Dunbar's ~15 "sympathy group")
      pass_on_bps: 10_000, // chance a contact who can see a lead passes it on (placeholder)
      // Households (docs/behaviour/households.md).
      accept_fewer_bedrooms_after_days: 60, // still hunting after this long: accept one bedroom fewer than the standard asks, and so on (placeholder)
      // Fertility (docs/behaviour/households.md): births per 1,000 women a year by age, ABS Births 2024; a month's chance is a twelfth.
      fertility_per_1000: [{ from: 15, rate: 6.0 }, { from: 20, rate: 30.6 }, { from: 25, rate: 71.3 }, { from: 30, rate: 106.0 }, { from: 35, rate: 66.6 }, { from: 40, rate: 15.5 }, { from: 45, rate: 1.4 }, { from: 50, rate: 0 }],
    },
    ctx.params,
  );
    const me = ctx.entity;
    const book = new Book();
    let home: Home | null = null;
    let job: Job | null = null;
    const applied = new Set<string>();
    // Attention: the market is looked at only when hunting, as a search (what's on offer now).
    let lookedAt = -1;
    const found: { homes: StatementRecord[]; jobs: StatementRecord[]; petitions: StatementRecord[] } = { homes: [], jobs: [], petitions: [] };
    let homelessSince: number | null = null;
    let joblessSince: number | null = null;
    let nextSpend = ctx.rng("spend-day").below(30) * DAY;
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

    const monthlyIncome = () => (job ? Math.floor((job.wage * MONTH) / job.period) : 0);

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
      for (const r of book.records.values()) {
        if (r.record !== "agreement" || !r.terms.parties.includes(me) || !book.inForce(r.id)) continue;
        const since = book.signedAt(r.id) ?? 0;
        const end = r.terms.term ? since + r.terms.term : Number.MAX_SAFE_INTEGER;
        if (r.terms.template === "lease" && !home) {
          const lt = leaseTerms(r, me);
          const landlord = r.terms.parties.find((x) => x !== me)!;
          const order = [...book.records.values()].find((x) => x.record === "statement" && x.kind === "request" && x.basis === r.id && x.speaks_for === me)?.id;
          home = { agreement: r.id, space: lt.space!, structure: lt.structure!, landlord, rent: lt.rent, order, endsAt: end, movedIn: true };
        }
        if (r.terms.template === "employment" && !job) {
          const employer = r.terms.parties.find((x) => x !== me)!;
          job = { agreement: r.id, employer, ...jobTerms(r, me), endsAt: end };
        }
      }
      // Another adult's share of the rent, if one is already standing.
      const mine = [...book.records.values()].find((r) => r.record === "statement" && r.kind === "request" && r.speaks_for === me && r.data?.outcome?.money?.for === "Household share of the rent.");
      if (mine && !share) share = { cents: cents((mine as any).data.outcome.money.amount), order: mine.id };
      void obs;
    };

    // Everything we observe, after every action (not just on waking).
    let fresh: ReturnType<Book["absorb"]> = [];
    const absorb = (obs: Observation) => {
      fresh.push(...book.absorb(obs));
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
        const want = (Object.keys(ASKING) as Want[]).find((w) => ASKING[w] === m.text);
        if (want) asked.push({ from: m.from, want });
        // A place someone names in reply to our asking (not a reply about a record: those are institutions answering requests).
        else if (m.re && (askedAt.home !== undefined || askedAt.work !== undefined) && !book.records.has(m.re)) leads = [...leads.filter((x) => x !== m.re), m.re].slice(-5);
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
          if (grown[0]?.person === me) {
            steps.push(because(`${dead.person}, of our household, has died: reporting it to the registry.`, say("death_notification", `${dead.person} has died.`, {
              to: [p.registry ?? "city"],
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
          const rate = [...(p.fertility_per_1000 as { from: number; rate: number }[])].reverse().find((r) => age >= r.from)?.rate ?? 0;
          if (rate > 0 && ctx.rng(`conceive-${t}`).below(120_000) < Math.round(rate * 10)) {
            const partner = household?.couples.find((c) => c.includes(me))?.find((x) => x !== me);
            const man = partner && household!.members.find((m) => m.person === partner && m.sex === "male");
            // With a partner, only when they're here with us (we see who's in our own home).
            const together = !man || (street?.kind === "sites" && street.cells.some((c) => c.structure?.spaces.some((sp) => sp.occupants?.includes(me) && sp.occupants?.includes(man.person))));
            if (together) expectingUntil = t + p.gestation + MONTH;
            if (together) steps.push(because(`Having a child: at ${age}, the chance this month is ${rate} in 12,000 (ABS: ${rate} births per 1,000 women a year at this age).`,
              C.call("birth", { name: C.text(`baby of ${me}`), template: p.child_template ?? "child", ...(man ? { with: man.person } : {}) })));
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

      // A tenancy that has ended: move out and stop paying rent.
      if (home && t >= home.endsAt) {
        const s: Step = because(`Our tenancy of ${home.space} has ended: moving out and stopping the rent.`, ...(home.movedIn ? [moveOut(home.structure, me)] : []));
        if (home.order) s.push(withdraw(home.order, "Tenancy ended; stop this standing order."));
        if (s.length) steps.push(s);
        // The children come out with us (each on its own, in case one isn't there); the other adults are told.
        if (home.movedIn) for (const k of children(t)) steps.push(because("Our tenancy has ended: taking the children out with us.", moveOut(home.structure, k.person)));
        for (const a of adults(t)) steps.push(because("Our tenancy has ended: telling the household, and that there's no rent to share for now.", message([reach(a)], SAYING.moveOut(home.structure)), message([reach(a)], SAYING.share(0, acc.account)))), sharesTold.set(a.person, 0);
        toldMoveIn = null;
        home = null;
        homelessSince = t;
      }
      // A job that has ended.
      if (job && t >= job.endsAt) {
        if (job.workplace && inside(job.workplace)) steps.push(because("Our job has ended: leaving the workplace.", moveOut(job.workplace, me)));
        job = null;
        joblessSince = t;
      }
      if (!home && homelessSince === null) homelessSince = t;
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
          steps.push(because(`Signing the lease offered for ${space}: ${usd(rent)} a month is within our budget (a third of household income, ${usd(Math.floor((householdIncome() * p.rent_share_bps) / 10_000))}; or six months' rent in savings without income).`,
            sign(r.id),
            ["so", pay(rentTo, rent, { from: acc.account, every: MONTH, first: 0, basis: r.id, for: `Rent for ${space}, monthly in advance.` })],
          ));
          home = { agreement: r.id, space, structure, landlord: other, rent, endsAt: t + (r.terms.term ?? 365 * DAY), movedIn: false };
          pendingRef = { kind: "rent", agreement: r.id };
          homelessSince = null;
        } else if (r.terms.template === "employment" && !job) {
          const terms = jobTerms(r, me);
          const s: Step = because(`Taking the job offered: ${usd(terms.wage)} every ${Math.round(terms.period / DAY)} days.`, sign(r.id));
          if (terms.workplace) s.push(moveIn(terms.workplace));
          steps.push(s);
          job = { agreement: r.id, employer: other, ...terms, endsAt: r.terms.term ? t + r.terms.term : Number.MAX_SAFE_INTEGER };
          joblessSince = null;
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
      const leave = isLeaseholder() && (
        (homelessSince !== null && t - homelessSince >= p.leave_after_homeless_days * DAY) ||
        (joblessSince !== null && t - joblessSince >= p.leave_after_jobless_days * DAY && householdIncome() === 0 && broke));
      if (leave) {
        const why = homelessSince !== null && t - homelessSince >= p.leave_after_homeless_days * DAY
          ? `Leaving town: ${Math.floor((t - homelessSince) / DAY)} days without a home (we leave after ${p.leave_after_homeless_days}).`
          : `Leaving town: ${Math.floor((t - joblessSince!) / DAY)} days with nobody in the household earning (we leave after ${p.leave_after_jobless_days}), and less money than a month's rent or essentials.`;
        const tell: Step[] = adults(t).map((a) => because(why, message([reach(a)], SAYING.leaving())));
        return [...tell, ...departure(acc, why)];
      }

      wordOfMouth(obs, t, steps);

      // Looking for a home: what someone told us about first, then the best one we can afford among the listings we've seen.
      if (isLeaseholder() && !home) {
        const fits = (l: StatementRecord) => !applied.has(l.id) && affordable(l.data?.rent ?? Infinity, acc.balance) && (l.data?.bedrooms ?? 0) >= minBedrooms(t);
        const told = leadFound.homes.filter(fits);
        const listings = (told.length ? told : found.homes).filter(fits);
        listings.sort((a, b) => b.data.rent - a.data.rent || (a.id < b.id ? -1 : 1));
        const best = listings[0];
        if (best?.speaks_for) {
          applied.add(best.id);
          const members = household?.members.map((m) => m.person) ?? [me];
          steps.push(because(`Applying for ${best.data.space}: the dearest home we've seen (rent standing for quality) within a third of household income, with at least ${minBedrooms(t)} bedrooms${told.length ? ", where someone told us to look" : ""}.`,
            say("rental_application", `Application for ${best.data.space ?? best.data.structure}, for a household of ${members.length}.`, { to: [best.speaks_for], visible: [me, best.speaks_for],
            data: { listing: best.id, account: acc.account, members, household: { people: members.length, bedrooms_needed: household ? bedroomsNeeded(household, t, year) : 0 } }, basis: best.id })));
        }
      }
      // Looking for work: where someone told us about first, then the best-paid posting.
      if (!job) {
        const told = leadFound.jobs.filter((j) => !applied.has(j.id));
        const posts = (told.length ? told : found.jobs).filter((j) => !applied.has(j.id));
        posts.sort((a, b) => (b.data?.wage ?? 0) - (a.data?.wage ?? 0) || (a.id < b.id ? -1 : 1));
        const best = posts[0];
        if (best?.speaks_for) {
          applied.add(best.id);
          steps.push(because(`Applying for the best-paid job we've seen (${usd(best.data?.wage ?? 0)} a fortnight)${told.length ? ", where someone told us to look" : ""}.`,
            say("job_application", "Application for the advertised job.", { to: [best.speaks_for], visible: [me, best.speaks_for], data: { posting: best.id, account: acc.account }, basis: best.id })));
        }
      }

      // Spending, once a month: essentials, plus a share of savings above the buffer.
      if (t >= nextSpend) {
        nextSpend = t + MONTH;
        const shops: string[] = p.shop_accounts ?? [];
        const reserve = home?.rent ?? share?.cents ?? 0;
        const buffer = p.buffer_months * monthlyIncome();
        const above = Math.max(0, acc.balance - reserve - buffer);
        const amount = Math.min(acc.balance - reserve, p.essentials + Math.floor((above * p.spend_above_buffer_bps) / 10_000));
        if (amount > 0 && shops.length) {
          const shop = ctx.rng(`shop-${t}`).pick(shops);
          steps.push(because(`Monthly shopping: ${usd(p.essentials)} of essentials plus ${p.spend_above_buffer_bps / 100}% of savings above a ${p.buffer_months}-month buffer, keeping the rent aside.`, pay(shop, amount, { from: acc.account, for: "Shopping." })));
        }
      }
      voice(t, steps);
      fresh = [];
      return steps;
    };

    // Word of mouth. Ties are the people we share (or shared) a home or workplace with: in our own
    // buildings we see who. Asked, we say where we can see room: where we live or next door for a
    // home, our own workplace for work (we're on the inside there). Hunting, we ask once per hunt.
    const wordOfMouth = (obs: Observation, t: number, steps: Step[]) => {
      // The buildings around us; in our own we see who's there (they're the people we know).
      const around: SiteStructure[] = obs.channels.street?.kind === "sites" ? channels.structures({ ...obs, channels: { street: obs.channels.street } }) : [];
      for (const st of around) for (const sp of st.spaces) for (const o of sp.occupants ?? []) if (o !== me) contacts.set(o, t);
      if (contacts.size > p.max_contacts) {
        const keep = [...contacts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, p.max_contacts);
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
    const threshold = Math.max(0, p.threshold_mean_bps + Math.trunc((z * p.threshold_sd_bps) / 10_000)); // z / 10000 ~ N(0, 1)
    const signed = new Set<string>();
    // Whether we're someone who signs petitions at all (drawn once); thresholds apply among those who are.
    const willing = ctx.rng("petition-willing").below(10_000) < p.petition_willing_bps;
    const countsPublished = new Map<string, { n: number; at: number }>();
    let aggrievedUntil = 0;
    const voice = (t: number, steps: Step[]) => {
      const burden = home && householdIncome() > 0 ? (home.rent * 10_000) / householdIncome() : 0;
      const noticed = [...book.notices.entries()].some(([ag, ns]) => ag === home?.agreement && ns.some((n) => n.as !== me));
      if (home && (noticed || burden >= p.rent_burden_grievance_bps)) aggrievedUntil = t + 90 * DAY;
      const aggrieved = t < aggrievedUntil;
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
      const o = [...book.records.values()].find((r) => r.record === "statement" && r.kind === "request" && r.speaks_for === a.person && r.data?.outcome?.money?.for === "Household share of the rent.");
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
      step(obs): ParticipantAction {
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
            if (spaces.length && grown.length && grown.every((m) => deadHere.has(m.person))) {
              askedForCare = true;
              const kids = household.members.filter((m) => ageAt(m, obs.t, year) < ADULT_YEARS).map((m) => m.person);
              return callAction(because("No adult of our household is left: asking for help.", say("care_request", "We have no adult at home any more.", { to: [p.child_protection ?? "city"], data: { children: kids } })));
            }
          }
          return wait(Math.min(obs.t + MONTH, ctx.world.runEnd + DAY));
        }
        if (plannedAt !== obs.t) {
          const acc = ownBanked(obs, me);
          const budget = acc ? (householdIncome() > 0 ? Math.floor((householdIncome() * p.rent_share_bps) / 10_000) : Math.floor(acc.balance / p.savings_rent_months)) : 0;
          const needHome = isLeaseholder() && !home;
          const rooms = minBedrooms(obs.t);
          const roomy = rooms > 0 ? [{ field: "data.bedrooms", op: ">=" as const, value: rooms }] : [];
          // Told about a building? Look there first: what's on offer in it now.
          if (looking === null && lookedAt !== obs.t && acc && leads.length && (needHome || !job)) {
            const lead = leads.pop()!;
            const looks: LookRequest[] = [];
            if (needHome) looks.push({ channel: "homes", query: { standing: true, where: [{ field: "data.structure", op: "=", value: lead }, { field: "data.rent", op: "<=", value: budget }, ...roomy], limit: p.search_limit } });
            if (!job) looks.push({ channel: "jobs", query: { standing: true, where: [{ field: "data.workplace", op: "=", value: lead }], limit: p.search_limit } });
            leadFound.homes = [];
            leadFound.jobs = [];
            looking = "leads";
            return { type: "look", looks };
          }
          // Hunting? Look at what's on offer (the next step, at once, has the results).
          const looks: LookRequest[] = [];
          if (lookedAt !== obs.t && acc) {
            if (needHome) looks.push({ channel: "homes", query: { standing: true, where: [{ field: "data.rent", op: "<=", value: budget }, ...roomy], order: { field: "data.rent", desc: true }, limit: p.search_limit } });
            if (!job) looks.push({ channel: "jobs", query: { standing: true, order: { field: "data.wage", desc: true }, limit: p.search_limit } });
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
          todo = plan(obs);
          plannedAt = obs.t;
          leadFound.homes = [];
          leadFound.jobs = [];
        }
        const next = todo.shift();
        lastWasMove = !!next && next === moveStep;
        if (leaving && todo.length === 0) departed = true; // the last of leaving is under way
        return next ? callAction(next) : wait();
      },
    };
  },
};
