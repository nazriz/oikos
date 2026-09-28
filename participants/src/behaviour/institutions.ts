// The people inside the town's institutions, and the builder. Documented in
// docs/behaviour/institutions.md, with sources.
//
// None of this is law in the kernel: each participant reads the town's statements
// and applies them to what it can see, because that is its job, and
// (depending on its parameters) it may do the job well, badly, or not at all.

import * as C from "../calls";
import type { StatementRecord } from "../contracts";
import { channels } from "../contracts";
import { evaluate, standingClaims } from "../law";
import { params, type BehaviourModule, type ParticipantContext } from "../module";
import { because, Book, commitmentOf, DAY, Letters, lotOf, ownAccount, record, say, sign, type Step } from "./common";
import { stepper } from "./firms";

/** Laws with a formal condition and a "must not" (prohibitions), in id order. */
function prohibitions(book: Book): StatementRecord[] {
  return book.open("law").filter((l) => l.formal?.condition && l.adico?.deontic === "must_not").sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Who the registry says owns a lot: the latest standing ownership claim, following transfers. */
export function ownerOf(book: Book, lot: string): string | undefined {
  let holder: string | undefined;
  const all = [...book.records.values()];
  const titles = standingClaims(all).filter((c) => c.about?.kind === "ownership" && c.about?.object === lot);
  for (const c of titles) holder = c.holder;
  for (const r of all) if (r.record === "claim_transfer" && titles.some((c) => c.id === r.claim)) holder = r.to;
  return holder;
}

/**
 * city.planning_officer: decides permit applications. For each application it
 * asks whether granting it would breach a prohibition addressed to the office
 * (e.g. "no permit may be granted on the river lots"), by evaluating the
 * law's formal condition on the act of granting. It grants (records a
 * liberty to build) or refuses (publishes the decision), citing the law.
 * params: compliance_bps (how often it follows the law; default 10000).
 */
export const planningOfficer: BehaviourModule = {
  name: "city.planning_officer",
  version: "0.5.0",
  doc: "docs/behaviour/institutions.md",
  cadence: () => 7 * DAY,
  create(ctx: ParticipantContext) {
    const p = params({ compliance_bps: 10_000 }, ctx.params);
    const book = new Book();
    const decided = new Set<string>();
    const letters = new Letters();
    return stepper(
      (obs) => {
        book.absorb(obs);
        letters.take(obs);
      },
      (obs) => {
        const me = obs.entity;
        const steps: Step[] = [];
        const apps = book.open("permit_application").filter((a) => (a.addressed_to ?? []).includes(me) && !decided.has(a.id));
        for (const app of apps.sort((a, b) => (a.id < b.id ? -1 : 1))) {
          decided.add(app.id);
          const applicant = app.speaks_for!;
          // An application it can't decide gets a reply saying why (§9.3).
          const missing = ["lot", "structure_type"].filter((f) => typeof app.data?.[f] !== "string");
          if (missing.length) {
            steps.push(because("An application missing what it needs: saying so.", say("permit_decision", `Application ${app.id} can't be decided: it doesn't say ${missing.map((f) => (f === "lot" ? "which lot" : "what kind of building")).join(" or ")}.`,
              { to: [applicant], basis: app.id, data: { application: app.id, decision: "incomplete", missing } })));
            continue;
          }
          const granting = { block: "grant_permit", lot: app.data?.lot, structure_type: app.data?.structure_type };
          const breached = prohibitions(book).find((l) => {
            const v = evaluate(l.formal!.condition, { block: granting, actor: applicant, now: obs.t }, []);
            return "value" in v && v.value;
          });
          const follows = ctx.rng(`comply-${app.id}`).below(10_000) < p.compliance_bps;
          const refuse = breached && follows;
          const decision = say("permit_decision",
            refuse ? `Permit refused for ${app.data?.lot}: it would breach ${breached!.id}.` : `Permit granted to build ${app.data?.structure_type} on ${app.data?.lot}.`,
            { to: [applicant], basis: app.id, data: { application: app.id, decision: refuse ? "refused" : "granted", ...(breached ? { law: breached.id } : {}) } });
          const step: Step = because(
            refuse ? `Refusing: granting it would breach ${breached!.id}, and we follow the law.` : breached ? `Granting, although it breaches ${breached.id} (we don't always follow the law).` : "Granting: no law we know of forbids it.",
            decision);
          if (!refuse) step.unshift(record("liberty", applicant, { action: "build", object: app.data?.lot, structure_type: app.data?.structure_type }, { basis: app.id }));
          steps.push(step);
        }
        steps.push(...letters.answer(() => {
          const decisions = book.open("permit_decision").filter((d) => d.speaks_for === me || d.in_position !== undefined);
          const granted = decisions.filter((d) => d.data?.decision === "granted").length;
          const refused = decisions.filter((d) => d.data?.decision === "refused").map((d) => `${d.data?.application} (${d.data?.law ?? "?"})`);
          return `Report from the planning office: ${decided.size} applications decided: ${granted} granted, ${refused.length} refused${refused.length ? ` (${refused.join(", ")})` : ""}. Apply on the permit application form (form-permit).`;
        }));
        return steps;
      },
    );
  },
};

/**
 * city.inspector: patrols. Through a `sites` channel (whose coverage and
 * refresh interval the world sets) it sees what's built. Anything new that
 * the building law prohibits (evaluated against the permits it knows of,
 * for the lot's registered owner) gets a fine (a claim) and a demolition
 * order. What happens next is up to the owner, and whoever enforces orders.
 * params: fine (cents), compliance_bps (how often it acts on what it finds).
 */
export const inspector: BehaviourModule = {
  name: "city.inspector",
  version: "0.3.0",
  doc: "docs/behaviour/institutions.md",
  cadence: () => 7 * DAY,
  create(ctx: ParticipantContext) {
    const p = params({ fine: 5_000_000, compliance_bps: 10_000 }, ctx.params);
    const book = new Book();
    const known = new Set<string>(); // structures already judged (or standing when we started)
    let first = true;
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const me = obs.entity;
        const buildings = channels.structures(obs);
        const steps: Step[] = [];
        if (first) {
          for (const st of buildings) known.add(st.structure);
          first = false;
          return steps;
        }
        const claims = standingClaims(book.records.values());
        for (const st of buildings) {
          if (known.has(st.structure)) continue;
          known.add(st.structure);
          // The lot it stands on (its corner cell's), by the registry.
          const lot = lotOf(book, st.at);
          const owner = (lot && ownerOf(book, lot)) ?? st.built_by ?? "unknown";
          const cells = channels.cells(obs).filter((c) => c.structure?.structure === st.structure).map((c) => c.cell).sort();
          const act = { block: "construct", lot, at: st.at, cells, structure_type: st.type };
          const breached = prohibitions(book).find((l) => {
            const v = evaluate(l.formal!.condition, { block: act, actor: owner, now: obs.t }, claims);
            return "value" in v && v.value;
          });
          if (!breached || ctx.rng(`act-${st.structure}`).below(10_000) >= p.compliance_bps) continue;
          steps.push(because(`On patrol: ${st.structure} was built in breach of ${breached.id}; fining the owner and ordering it demolished.`,
            record("right", me, { kind: "fine", amount: p.fine, for: `Unpermitted ${st.type} on ${lot ?? st.at} (${st.structure}).` }, { against: owner, basis: breached.id }),
            say("demolition_order", `Order: demolish ${st.structure} on ${lot ?? st.at}, built in breach of ${breached.id}.`, { to: [owner], basis: breached.id, data: { structure: st.structure, lot, law: breached.id } }),
          ));
        }
        return steps;
      },
    );
  },
};

/**
 * firm.builder: takes construction contracts. When a client it has a
 * contract with has signed, and it can pay for materials, it signs, builds,
 * and invoices the contract price.
 */
export const builder: BehaviourModule = {
  name: "firm.builder",
  version: "0.4.0",
  doc: "docs/behaviour/institutions.md",
  cadence: () => 7 * DAY,
  create(ctx: ParticipantContext) {
    const book = new Book();
    const started = new Set<string>();
    const types = new Map<string, any>(ctx.world.config.catalogue.structure_types.map((t: any) => [t.id, t]));
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const me = obs.entity;
        const acc = ownAccount(obs);
        const steps: Step[] = [];
        if (!acc) return steps;
        let balance = acc.balance;
        for (const r of book.records.values()) {
          if (r.record !== "agreement" || r.terms.template !== "construction" || !r.terms.parties.includes(me) || started.has(r.id)) continue;
          const client = r.terms.parties.find((x) => x !== me)!;
          if (!book.signedBy(r.id, client)) continue;
          const job = commitmentOf(r, me).outcome?.structure ?? {};
          const cost = job.type ? types.get(job.type)?.materials_cost ?? Infinity : Infinity;
          if (!job.on || balance < cost) continue;
          started.add(r.id);
          balance -= cost;
          const price = commitmentOf(r, client).outcome?.money?.amount;
          steps.push(because("A client has signed a construction contract and we can pay for materials: building, and invoicing the price.",
            ...(book.signedBy(r.id, me) ? [] : [sign(r.id)]),
            C.call("structure", { type: job.type, on: job.on, by: me, from: acc.account }),
            ...(price ? [say("invoice", `Invoice: ${price} cents for building a ${job.type} on ${job.on}.`, { to: [client], basis: r.id, data: { outcome: { money: { to: acc.account, amount: price, for: `building a ${job.type} on ${job.on}` } }, agreement: r.id } })] : []),
          ));
        }
        return steps;
      },
    );
  },
};


/**
 * city.registry: the registry of deaths (after Victoria's Registry of Births, Deaths and Marriages, where a death
 * is registered from a notification). It reads death notifications addressed to the town and, once per death,
 * publishes a public registration with what it was told: who died, who reported it, the partner, the children and
 * any children left with no adult at home. It doesn't check what it's told (a later module could).
 */
export const registry: BehaviourModule = {
  name: "city.registry",
  version: "0.1.0",
  doc: "docs/behaviour/institutions.md",
  cadence: () => DAY,
  create(_ctx: ParticipantContext) {
    const book = new Book();
    const registered = new Set<string>();
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const me = obs.entity;
        const steps: Step[] = [];
        for (const r of book.all("death_registration")) registered.add(r.data?.deceased);
        for (const n of book.open("death_notification")) {
          const who = n.data?.deceased;
          if (!who || registered.has(who) || !(n.addressed_to ?? []).includes(me)) continue;
          registered.add(who);
          const d = n.data;
          steps.push(because(`A death is reported to us (${who}, by ${n.speaks_for}): registering it.`, say("death_registration", `Death registered: ${who}.`, {
            basis: n.id, visible: "public",
            data: { deceased: who, reported_by: n.speaks_for, ...(d.partner ? { partner: d.partner } : {}), children: d.children ?? [], without_adult: d.without_adult ?? [] },
          })));
        }
        return steps;
      },
    );
  },
};

/**
 * city.child_protection: children left with no adult at home. On a death registration naming children without an
 * adult, or a child's own request for help, it takes them into care, which (the town having no foster homes yet)
 * is care elsewhere: they leave the town with the office's worker. After Victoria's child protection service, much
 * simplified (docs/behaviour/institutions.md).
 */
export const childProtection: BehaviourModule = {
  name: "city.child_protection",
  version: "0.1.0",
  doc: "docs/behaviour/institutions.md",
  cadence: () => DAY,
  create(_ctx: ParticipantContext) {
    const book = new Book();
    const taken = new Set<string>();
    return stepper(
      (obs) => void book.absorb(obs),
      () => {
        const steps: Step[] = [];
        const children = [
          ...book.all("death_registration").flatMap((r) => (r.data?.without_adult ?? []) as string[]),
          ...book.all("care_request").flatMap((r) => (r.data?.children ?? []) as string[]),
        ];
        for (const c of children) {
          if (taken.has(c)) continue;
          taken.add(c);
          steps.push(because("A child with no adult at home: taking them into care elsewhere.", C.call("presence", { who: c, leave: "yes" })));
        }
        return steps;
      },
    );
  },
};
