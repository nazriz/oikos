// The people inside the town's institutions, and the builder. Documented in
// docs/behaviour/institutions.md, with sources.
//
// None of this is law in the kernel: each seat reads the town's statements
// and applies them to what it can see, because that is its job, and
// (depending on its parameters) it may do the job well, badly, or not at all.

import type { Block, SiteParcel, StatementRecord } from "../contracts";
import { channels } from "../contracts";
import { evaluate, standingClaims } from "../law";
import { params, type BehaviourModule, type SeatContext } from "../module";
import { Book, DAY, ownAccount } from "./common";
import { stepper } from "./firms";

/** Laws with a formal condition and a "must not" (prohibitions), in id order. */
function prohibitions(book: Book): StatementRecord[] {
  return book.open("law").filter((l) => l.formal?.condition && l.adico?.deontic === "must_not").sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Who the registry says owns a parcel: the latest standing ownership claim, following transfers. */
export function ownerOf(book: Book, parcel: string): string | undefined {
  let holder: string | undefined;
  const all = [...book.records.values()];
  const titles = standingClaims(all).filter((c) => c.about?.kind === "ownership" && c.about?.object === parcel);
  for (const c of titles) holder = c.holder;
  for (const r of all) if (r.record === "claim_transfer" && titles.some((c) => c.id === r.claim)) holder = r.to;
  return holder;
}

/**
 * city.planning_officer: decides permit applications. For each application it
 * asks whether granting it would breach a prohibition addressed to the office
 * (e.g. "no permit may be granted on the river parcels"), by evaluating the
 * law's formal condition on the act of granting. It grants (records a
 * liberty to build) or refuses (publishes the decision), citing the law.
 * params: compliance_bps (how often it follows the law; default 10000).
 */
export const planningOfficer: BehaviourModule = {
  name: "city.planning_officer",
  version: "0.1.0",
  doc: "docs/behaviour/institutions.md",
  cadence: () => 7 * DAY,
  create(ctx: SeatContext) {
    const p = params({ compliance_bps: 10_000 }, ctx.params);
    const book = new Book();
    const decided = new Set<string>();
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const me = obs.entity;
        const steps: Block[][] = [];
        const apps = book.open("permit_application").filter((a) => (a.addressed_to ?? []).includes(me) && !decided.has(a.id));
        for (const app of apps.sort((a, b) => (a.id < b.id ? -1 : 1))) {
          decided.add(app.id);
          const applicant = app.speaks_for!;
          const granting = { block: "grant_permit", parcel: app.data?.parcel, structure_type: app.data?.structure_type };
          const breached = prohibitions(book).find((l) => {
            const v = evaluate(l.formal!.condition, { block: granting, actor: applicant, now: obs.t }, []);
            return "value" in v && v.value;
          });
          const follows = ctx.rng(`comply-${app.id}`).below(10_000) < p.compliance_bps;
          const refuse = breached && follows;
          const decision: Block = {
            block: "publish", kind: "permit_decision", speaks_for: me, addressed_to: [applicant], basis: app.id,
            text: refuse ? `Permit refused for ${app.data?.parcel}: it would breach ${breached!.id}.` : `Permit granted to build ${app.data?.structure_type} on ${app.data?.parcel}.`,
            data: { application: app.id, decision: refuse ? "refused" : "granted", ...(breached ? { law: breached.id } : {}) },
          };
          const blocks: Block[] = [decision];
          if (!refuse) blocks.unshift({ block: "record_claim", position: "liberty", holder: applicant, speaks_for: me, basis: app.id, about: { action: "build", parcel: app.data?.parcel, structure_type: app.data?.structure_type } });
          steps.push(blocks);
        }
        return steps;
      },
    );
  },
};

/**
 * city.inspector: patrols. Through a `sites` channel (whose coverage and
 * refresh interval the world sets) it sees what's built. Anything new that
 * the building law prohibits (evaluated against the permits it knows of,
 * for the parcel's registered owner) gets a fine (a claim) and a demolition
 * order. What happens next is up to the owner, and whoever enforces orders.
 * params: fine (cents), compliance_bps (how often it acts on what it finds).
 */
export const inspector: BehaviourModule = {
  name: "city.inspector",
  version: "0.1.0",
  doc: "docs/behaviour/institutions.md",
  cadence: () => 7 * DAY,
  create(ctx: SeatContext) {
    const p = params({ fine: 5_000_000, compliance_bps: 10_000 }, ctx.params);
    const book = new Book();
    const known = new Set<string>(); // structures already judged (or standing when we started)
    let first = true;
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const me = obs.entity;
        const sites: SiteParcel[] = channels.sites(obs);
        const steps: Block[][] = [];
        if (first) {
          for (const s of sites) if (s.structure) known.add(s.structure.structure);
          first = false;
          return steps;
        }
        const claims = standingClaims(book.records.values());
        for (const site of sites) {
          const st = site.structure;
          if (!st || known.has(st.structure)) continue;
          known.add(st.structure);
          const owner = ownerOf(book, site.parcel) ?? st.built_by ?? "unknown";
          const act = { block: "construct", parcel: site.parcel, structure_type: st.type };
          const breached = prohibitions(book).find((l) => {
            const v = evaluate(l.formal!.condition, { block: act, actor: owner, now: obs.t }, claims);
            return "value" in v && v.value;
          });
          if (!breached || ctx.rng(`act-${st.structure}`).below(10_000) >= p.compliance_bps) continue;
          steps.push([
            { block: "record_claim", position: "right", holder: me, counterparty: owner, speaks_for: me, basis: breached.id, about: { kind: "fine", amount: p.fine, for: `Unpermitted ${st.type} on ${site.parcel} (${st.structure}).` } },
            { block: "publish", kind: "demolition_order", speaks_for: me, addressed_to: [owner], basis: breached.id, text: `Order: demolish ${st.structure} on ${site.parcel}, built in breach of ${breached.id}.`, data: { structure: st.structure, parcel: site.parcel, law: breached.id } },
          ]);
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
  version: "0.2.0",
  doc: "docs/behaviour/institutions.md",
  cadence: () => 7 * DAY,
  create(ctx: SeatContext) {
    const book = new Book();
    const started = new Set<string>();
    const types = new Map<string, any>(ctx.world.config.catalogue.structure_types.map((t: any) => [t.id, t]));
    return stepper(
      (obs) => void book.absorb(obs),
      (obs) => {
        const me = obs.entity;
        const acc = ownAccount(obs);
        const steps: Block[][] = [];
        if (!acc) return steps;
        let balance = acc.balance;
        for (const r of book.records.values()) {
          if (r.record !== "agreement" || r.terms.template !== "construction" || !r.terms.parties.includes(me) || started.has(r.id)) continue;
          const client = r.terms.parties.find((x) => x !== me)!;
          if (!book.signedBy(r.id, client)) continue;
          const job = r.terms.commitments.find((c) => c.who === me)?.does ?? {};
          const cost = types.get(job.build)?.materials_cost ?? Infinity;
          if (balance < cost) continue;
          started.add(r.id);
          balance -= cost;
          const price = r.terms.commitments.find((c) => c.who === client)?.does?.pay;
          steps.push([
            ...(book.signedBy(r.id, me) ? [] : [{ block: "sign_agreement", agreement: r.id, as: me } as Block]),
            { block: "construct", parcel: job.on, structure_type: job.build, materials_from: acc.account },
            ...(price ? [{ block: "publish", kind: "invoice", speaks_for: me, addressed_to: [client], basis: r.id, text: `Invoice: ${price} cents for building a ${job.build} on ${job.on}.`, data: { amount: price, pay_to: acc.account, agreement: r.id } } as Block] : []),
          ]);
        }
        return steps;
      },
    );
  },
};

