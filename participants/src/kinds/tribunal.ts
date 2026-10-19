import { inEngine } from "../in-engine";
import { type BehaviourModule } from "../module";
import { DAY } from "../shared/common";
import { hearingNotices, type Hears } from "../shared/hearings";
import * as P from "../shared/papers";


/** Everything the tribunal says it hears: its own three lists apart from a charge (the police's), and the world's. */
const tribunalHears = (hears: Hears[]): Hears[] => [{ about: "rent_increase", can: ["order"], undoes: true, form: "tribunal_application" }, { about: "debt", can: ["order"], form: "tribunal_application" }, ...hears.map((h) => ({ ...h, form: "tribunal_application" }))];

export const member: BehaviourModule = {
  name: "tribunal.member",
  // (Its registry: docs/behaviour/justice.md, "The registry lists; the member decides". Listing is routine; deciding is not.)
  routines: [{ task: "answer", at: "office", every: 1, what: "The tribunal's registry staff take in each application, list it for a hearing and tell both sides, with the day the other side may answer by. They decide nothing: every case is the member's to decide, on or after its day.",
    papers: [
      { kind: "tribunal_application", how: "taken in and listed; both sides are told, and the other side given the tribunal's time to answer. An application the tribunal does not hear is told so. The case is then the member's to decide" },
      { kind: "tribunal_response", how: "filed with its application, for the member who decides it" },
    ] }],
  opens: (p, me) => ((p.hears ?? []).length && p.part !== "staff" ? hearingNotices(me, "The tribunal hears", tribunalHears(p.hears), { fee: p.fee, account: p.account }) : []),
  answers: {"office": "the tribunal", "acts": "What it acts on: an application made to it by a party to a dispute, which it hears and decides by the laws in force."},
  issues: P.TRIBUNAL_MEMBER,
  version: "0.8.0", // 0.8.0: an application that states no particulars is dismissed with leave to apply again (desk.ts, `Hearings`); 0.7.0: decides an application for possession by a stated rule on the tenant's answer and the landlord's reply (left; a notice shorter than the law asks; nothing owed; a plan where the law has one and the offer clears what is owed; else possession), the law on plans read from the world's; 0.6.0: an application for possession of a home the tenant has left is dismissed, and one its maker withdraws is decided by nobody; cases its own file says are already listed are taken as they stand, never listed again; 0.5.0: where a model holds the member's chair in a living town, the tribunal's registry staff list each application and tell both sides, under a standing work order, and the member decides (docs/behaviour/justice.md, "The registry lists; the member decides"); its notice of what it hears is on file when a seat arrives; 0.4.0: hears applications for possession of a let home for arrears: a plan to pay, or possession on a date (docs/behaviour/justice.md, "Possession"); 0.3.0: lists (docs/behaviour/frictions.md): the matters the world says it hears beyond its own three, heard by the common procedure on its own forms, as far as its hearing days go; it says what it hears and what applying costs
  doc: "docs/behaviour/justice.md",
  cadence: () => DAY,
  firstWake: (ctx) => 9 * 3600 + ctx.rng("first-wake").below(3600),
  create: inEngine("tribunal.member"),
};

export const registrar: BehaviourModule = {
  name: "tribunal.registrar",
  answers: {"office": "the tribunal's registry", "acts": "What it acts on: an order of the tribunal to pay that has gone unpaid, which it enforces by an order to the debtor's bank."},
  issues: P.TRIBUNAL_REGISTRAR,
  issuesWith: (p) => ({ banks: p.banks ?? [], enforcer: p.enforcer || undefined }),
  version: "0.3.0", // 0.3.0: withdraws a warrant not yet carried out when the landlord withdraws its request (the tenant has gone); 0.2.0: issues a warrant of possession, to whoever carries its warrants out, on an order whose date has passed; 0.1.1: an order to pay that rests on no recorded debt is settled against the order itself
  doc: "docs/behaviour/justice.md",
  cadence: () => DAY,
  firstWake: (ctx) => 10 * 3600 + ctx.rng("first-wake").below(3600),
  create: inEngine("tribunal.registrar"),
};
