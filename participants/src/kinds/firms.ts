import { inEngine } from "../in-engine";
import { type BehaviourModule } from "../module";
import { DAY } from "../shared/common";
import * as P from "../shared/papers";


export const landlord: BehaviourModule = {
  name: "firm.landlord",
  issues: P.LANDLORD,
  issuesWith: (p) => ({ city: p.city, tribunal: p.possession?.tribunal, builder: p.repair?.builder }),
  version: "0.20.0", // 0.20.0: a tenant whose death is on record with us ends the lease by our notice, the tenancy is offered to the household member the lease names or the partner the entry names, and nothing is asked of the dead (no arrears chase, no application for possession; one pending is withdrawn), all read from papers and not from who was seen where; 0.19.0: draws are named for the day and which time that is, never the hour or the moment (docs/reliability.md, "Draws and the moment"); 0.18.0: replies to a tenant's answer to its application with what its rent book shows owed; withdraws an application once the rent owed is paid; withdraws its request for a warrant when the tenant has gone; 0.17.0: an application for possession of a home the tenant has since left is withdrawn; rent owed as the year began (its statement of the rent account) is owed with the rest; tenancies already under notice or before the tribunal when its files are first opened are taken up where their papers put them; 0.16.2: an application for possession names the notice to vacate it relies on, the day it was given and the day it gave; its answers to requests, notices and decisions are drawn by who asked and what about, not by a paper's number on file (docs/decisions.md, 2026-10-12); 0.16.1: rent under a lease is counted from the lease's own rent day where it names one (attrs.first_due), and arrears are taken up on the office's own day of the week for its rent book; 0.16.0: possession under the world's law (docs/behaviour/justice.md, "Possession"): a notice to vacate, an application to the tribunal, a warrant, never putting anyone out itself; 0.15.0: everyday frictions (docs/behaviour/frictions.md): a home of ours in disrepair is repaired by the builder when we are asked or ordered and will, at its price; we answer a venue from our books; rent owed us is asked for and then taken to a body that hears arrears; 0.14.0: wants of its own (docs/behaviour/firm-wants.md), for one the world's dial gives initiative: a character from its owner's values, which answers a tenant who asks it to hold a rent or to stay on, sways its markup and its patience with arrears, and a record of its own; 0.13.4: main's 0.13.3 (the builder's answer read with the week's post; what is owed counted before building or asking) with a certified copy of a registration made on someone else's report counting as the registration
  doc: "docs/behaviour/firms.md",
  cadence: () => 7 * DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(7) * DAY,
  create: inEngine("firm.landlord"),
};

export const employer: BehaviourModule = {
  name: "firm.employer",
  version: "0.7.0", // 0.6.5: draws are named for the day and which time that is, never the hour or the moment (docs/reliability.md, "Draws and the moment"); 0.6.4: returns of tax withheld are filed on the days the law states (docs/behaviour/firms.md, "Returns on the law's days")
  doc: "docs/behaviour/firms.md",
  cadence: () => 7 * DAY,
  firstWake: (ctx) => ctx.rng("first-wake").below(7) * DAY,
  create: inEngine("firm.employer"),
};
