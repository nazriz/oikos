import { inEngine } from "../in-engine";
import { type BehaviourModule, type FormField, type Issued } from "../module";
import { DAY } from "../shared/common";

const f = (type: string, description: string, o: { required?: boolean; options?: string[] } = {}): FormField => ({ type, ...(o.required ? { required: true } : {}), ...(o.options ? { options: o.options } : {}), description });
const req = { required: true };

/**
 * The papers an assistant a model plays writes in words (docs/design/delegation.md section 8), as forms of its post's
 * stationery: advice, a request to go ahead, a report, a request for more scope, a handover. Each goes to whom it works
 * for in the matter (`client`). Published only where a town seats a model in an assistant (`assistant_seats`).
 */
export const ASSISTANT_ISSUES: Issued[] = [
  { form: "advice", title: "Advice on a matter handed to you",
    fields: { referral: f("record", "The matter you were handed.", req), client: f("entity", "Whom you work for in it.", req), advice: f("text", "What you would do, in your words.", req) },
    writes: { kind: "advice", text: "{advice}", basis: "=referral", to: ["=client"], visible: ["=self", "=client"], data: { referral: "=referral" } } },
  { form: "approval_request", title: "A request to go ahead with a matter",
    fields: { referral: f("record", "The matter you were handed.", req), client: f("entity", "Whom you work for in it.", req), gist: f("text", "What you mean to do, in a sentence.", req) },
    writes: { kind: "approval_request", text: "May we go ahead? {gist}", basis: "=referral", to: ["=client"], visible: ["=self", "=client"], data: { referral: "=referral", gist: "=gist" } } },
  // (A matter that is the same paper to each of several (a rates run's notices, one to each owner): drafted as one, as a
  // clerk prepares a run, each paper as the matter's facts give it, for one sign-off and one send. The town rung 2: the
  // rates seat drafted 204 notices one by one, 204 sign-offs, 46% of the run's cost; the code assistant drafts each
  // matter's fifteen as one.)
  { form: "draft_as_handed", title: "A draft for sign-off of a matter's papers, each as the matter sets it out",
    does: "For a matter that is the same paper to each of several (a run of notices, one to each): draws up every one of them as the matter sets them out, written on the office's own form for each from the matter's details, as one draft for one sign-off, to whoever signs it. Once signed off, all are sent at once with one send. A matter of one paper is drafted on its own form, deciding what goes in each blank; where any of several should differ from what the matter gives, draft that one on its own form instead.",
    fields: { referral: f("record", "The matter you were handed.", req) }, batch: "=referral",
    writes: { kind: "draft", text: "Draft for sign-off: the papers of matter {referral}, each as the matter sets it out.", basis: "=referral", to: ["=self"], visible: ["=self"], data: { referral: "=referral" } } } as Issued,
  { form: "report", title: "What became of a matter",
    // (Said on the form since 2026-11-14: the scope pilot's baseline seats filed 5, 6 and 4 reports where the code filed
    // 41, and nothing they were shown said that the office goes by the report: its own code hears of the act from it.)
    does: "Tells whom you work for what became of a matter they handed you: done, or not and why. Their office goes by it: until they have it, the matter is open on their file, and one not done is theirs to do again.",
    fields: { referral: f("record", "The matter you were handed.", req), client: f("entity", "Whom you work for in it.", req), done: f("choice", "yes: what you were handed has been carried out (the paper sent, the thing asked for done), whatever answer came back; no: it could not be carried out.", { required: true, options: ["yes", "no"] }), words: f("text", "What was done and any answer that came back; or, where it could not be carried out, why.") },
    writes: { kind: "report", text: "{words}", basis: "=referral", to: ["=client"], visible: ["=self", "=client"], data: { referral: "=referral", done: "=done", why: "=words" } } },
  { form: "scope_request", title: "A request for more scope or means",
    fields: { agreement: f("record", "The service you work under.", req), client: f("entity", "Whom you ask.", req), words: f("text", "What you ask for, and why.", req),
      kind: f("text", "A kind of matter you ask to be given, if any."), level: f("choice", "At what level, if any.", { options: ["advice", "draft", "approve", "alone"] }),
      access: f("text", "Access you ask for, if any."), record: f("record", "A paper of theirs you need a copy of, if any."), matter: f("record", "The matter in hand that needs it, if any."),
      answers: f("record", "What this answers, if anything.") },
    writes: { kind: "scope_request", text: "{words}", basis: "=answers", to: ["=client"], visible: ["=self", "=client"], data: { agreement: "=agreement", kind: "=kind", level: "=level", access: "=access", record: "=record", matter: "=matter" } } },
  // (docs/design/stakes.md, B3: one named thing of theirs. Their office answers from its own records, in its own time;
  // what it cannot answer from them it says it cannot say. A letter that asks is acknowledged, not answered.)
  { form: "question_to_client", title: "A question to whom you work for, about a matter",
    does: "Asks whom you work for one thing of theirs about a matter they handed you: what their account stands at, a paper of theirs (by its id), who someone the matter names is, or what a detail of the matter is. They answer from their own records when they next deal with their papers, or say they cannot say.",
    fields: { referral: f("record", "The matter you were handed.", req), client: f("entity", "Whom you work for in it.", req),
      about: f("choice", "What you ask about.", { required: true, options: ["balance", "document", "party", "detail", "other"] }),
      paper: f("record", "The paper of theirs you ask about, if a document."), name: f("text", "Whom you ask about (their id as the matter names them), or the detail's name, if a party or a detail."),
      words: f("text", "Your question, in your words.", req) },
    writes: { kind: "question", text: "{words}", basis: "=referral", to: ["=client"], visible: ["=self", "=client"], data: { referral: "=referral", about: "=about", paper: "=paper", name: "=name" } } },
  { form: "send_signed", title: "Sending a paper as it was signed off",
    // (In the name of whoever signed it off, since 2026-11-14: before, a model seat's copy went in its own provider's
    // name, since "who it is for" is code's to set and not the translator's: the scope pilot's baseline.)
    does: "Sends the paper a sign-off came back with, exactly as it was signed, to whom it is addressed, in the name of whoever signed it off. Nothing in it can be changed: to change anything, draft it again for sign-off.",
    fields: { sign_off: f("record", "The sign-off that came back with the paper signed.", req) }, copies: "=sign_off",
    writes: { kind: "signed_paper", text: "Sent as signed." } },
  { form: "handover", title: "A handover of what is open, at a service's end",
    fields: { agreement: f("record", "The service that is ending.", req), client: f("entity", "Whom you hand it to.", req), notes: f("text", "What is open, and how far each matter has got, as the agreement allows.") },
    writes: { kind: "handover", text: "{notes}", basis: "=agreement", to: ["=client"], visible: ["=self", "=client"], data: { agreement: "=agreement" } } },
];

/**
 * An assistant's stationery where the bodies it writes to send papers back (docs/design/obstacles.md, O1 and O4; the
 * world's `obstacles` level above 0): the request form gains one plain blank, the body the client is asked to give
 * their authority with; and a form sends a paper a body sent back again exactly as it was (`copies`: the copy the
 * returned paper carries). Elsewhere the stationery is as before, to the byte.
 */
export function withObstacles(issues: Issued[]): Issued[] {
  const out = issues.map((x) => (x.form !== "scope_request" ? x : {
    ...x,
    fields: { ...x.fields, authority: f("entity", "A body you ask them to give their authority with, for you to act for them there, if any."), only: f("record", "The one matter you ask the level for, if for that one alone.") },
    writes: { ...x.writes!, data: { ...(x.writes!.data as object), authority: "=authority", only: "=only" } },
  }));
  out.push({ form: "send_again", title: "Sending a paper again as it was, after a body sent it back",
    does: "Sends the paper a body sent back exactly as it was, to whom it went, citing it: once the authority it wanted is on file, or where the body could not match it. Nothing in it can be changed: to change anything, write it again.",
    fields: { returned: f("record", "The paper that sent it back.", req) }, copies: "=returned",
    writes: { kind: "paper_again", text: "Sent again." } } as Issued);
  return out;
}


/** The draft of one of the principal's papers, for its sign-off: the paper as the principal's own form would write it,
 * carried in the draft (`paper`) and sent as it stands once signed off. */
export function draftOf(x: Issued): Issued {
  const { sends: _s, ...paper } = x.writes;
  return {
    form: `draft_${x.form}`, title: `A draft for sign-off: ${x.title.charAt(0).toLowerCase()}${x.title.slice(1)}`,
    ...(x.does ? { does: `Once signed off: ${x.does.charAt(0).toLowerCase()}${x.does.slice(1)}` } : {}),
    fields: { referral: f("record", "The matter you were handed.", req), ...x.fields },
    writes: { kind: "draft", text: `Draft for sign-off. ${x.writes.text}`, basis: "=referral", to: ["=self"], visible: ["=self"], data: { referral: "=referral", paper } },
  };
}

/** A desk's draft for sign-off of a paper in a client's name (`kinds`: those its offer to persons takes): the paper as it
 * would go (its kind, to whom, its words), sent to the client to read and sign off before it goes in their name. A
 * person's papers are written by the citizen's code, on no form of their own, so the desk cannot draft on the client's
 * form as an organisation's assistant drafts on its principal's: until 2026-11-08 it had no way to draft at all, and
 * answered a matter handed to it at `draft` with a request to go ahead (the scope pilot's W6). */
export function clientDraft(kinds: string[]): Issued {
  return { form: "draft_for_client", title: "A draft for sign-off: a paper in a client's name",
    does: "Sends the client the paper as it would go in their name, for them to read and sign off. Nothing goes in their name until they have; once signed off, send it as it stands.",
    fields: { referral: f("record", "The matter you were handed.", req), client: f("entity", "Whom you work for in it: the paper goes in their name.", req),
      kind: f("choice", "The kind of paper, as the referral names it.", { required: true, options: [...kinds].sort() }), recipient: f("list", "Whom the paper goes to, as the referral has it.", req),
      words: f("text", "The paper's words, as they would stand.", req) },
    writes: { kind: "draft", text: "Draft for sign-off. {words}", basis: "=referral", to: ["=client"], visible: ["=self", "=client"], data: { referral: "=referral", paper: { kind: "=kind", to: ["=recipient"], text: "=words" } } } };
}

/** A person's own papers that the office receiving them reads for its figures and ids, on forms in the client's name
 * (docs/decisions.md, 2026-11-10, "One right call", C; docs/design/handing-over.md H4): the desk fills in the fields the
 * receiving office's code reads, never their JSON. `payments` are the support law's payments, by id (the choices of a
 * claim). Published only at a desk a model sits in, as its stationery is, so a code-only town does not move. */
export function clientPapers(payments: string[]): Issued[] {
  const client = f("entity", "Whom you work for: the paper goes in their name.", req);
  return [
    { form: "job_application", title: "An application for a job advertised, in a client's name",
      does: "Applies, in the client's name, for a job an employer has advertised. The employer reads the account the pay would go into and the trade the client works in, and picks among those who applied.",
      fields: { client, employer: f("entity", "The employer whose advertisement it answers.", req), posting: f("record", "The advertisement applied for.", req), account: f("account", "The client's account, which the pay would go into.", req),
        trade: f("text", "The trade the client works in, or last worked in, if any.") },
      writes: { in_name_of: "=client", kind: "job_application", text: "Application for the advertised job.", basis: "=posting", to: ["=employer"], visible: ["=client", "=employer"], data: { posting: "=posting", account: "=account", trade: "=trade" } } },
    { form: "loan_application", title: "An application for a loan, in a client's name",
      does: "Applies to a lender, in the client's name, for a loan: how much, over how many months, paid into which account, and what for. The lender decides it.",
      fields: { client, lender: f("entity", "The lender applied to.", req), amount: f("amount", "How much is asked for.", req), months: f("count", "Over how many months it is repaid.", req),
        account: f("account", "The client's account, which the loan is paid into.", req), purpose: f("text", "What it is for.", req) },
      writes: { in_name_of: "=client", kind: "loan_application", text: "Application for a loan of {amount} over {months} months.", to: ["=lender"], visible: ["=client", "=lender"], data: { amount: "=amount", months: "=months", account: "=account", purpose: "=purpose" } } },
    { form: "benefit_claim", title: "A claim for a support payment, in a client's name",
      does: "Claims a support payment of the law's, in the client's name, from the office that pays it. The office decides it by the law's conditions and pays it into the account named.",
      fields: { client, office: f("entity", "The office that pays it.", req), payment: f("choice", "The payment claimed, as the law names it.", { required: true, options: [...payments].sort() }),
        account: f("account", "The client's account, which it is paid into.", req), born_at: f("date", "The client's date of birth.") },
      writes: { in_name_of: "=client", kind: "benefit_claim", text: "Claim: {payment}.", to: ["=office"], visible: ["=client", "=office"], data: { payment: "=payment", account: "=account", born_at: "=born_at" } } },
    { form: "benefit_change", title: "A request to stop paying a claim, in a client's name",
      does: "Asks the office that pays a support payment, in the client's name, to stop paying a claim of theirs.",
      fields: { client, office: f("entity", "The office that pays it.", req), claim: f("record", "The client's claim to stop.", req) },
      writes: { in_name_of: "=client", kind: "benefit_change", text: "Please stop paying my claim {claim}.", basis: "=claim", to: ["=office"], visible: ["=client", "=office"], data: { claim: "=claim", stop: true } } },
    // (The reply to an office's request for papers on a claim: a matter handed over stays handed over, so the desk that
    // made the claim answers what the office asks next. The fields are those the office reads: `Evidence`. The office
    // matches the papers to its ask by the request they cite (support_law.rs `answers`), so `need` is the sender's own
    // words, never an id it was not shown: until 2026-11-16 it was required and matched as the office's id for the need
    // ("papers"), which no seat is shown, and papers filled in the words shown were refused as never come.)
    { form: "evidence", title: "Papers for a claim, sent as the office asked, in a client's name",
      does: "Sends the office that asked for them the papers for a client's claim, in the client's name, answering its request. The office reads which claim and which of its requests it answers, and decides the claim on what it then has.",
      fields: { client, office: f("entity", "The office that asked.", req), request: f("record", "The office's request.", req), claim: f("record", "The client's claim.", req),
        need: f("text", "What is sent, in a few words, if you wish: the office goes by the request it answers."), last_employer: f("entity", "The client's last employer, where the office asks for one.") },
      writes: { in_name_of: "=client", kind: "evidence", text: "For my claim {claim}: the papers asked for.", basis: "=request", to: ["=office"], visible: ["=client", "=office"], data: { claim: "=claim", need: "=need", request: "=request", last_employer: "=last_employer" } } },
    // (A household's application for a home let, and a complaint to the town about a service: the fields the landlord's
    // and the town's code read, as the citizen's own code writes them (citizen/housing.rs, `hunt`; recourse.rs,
    // `Complaint`). Until 2026-11-17 the desk drafted both on the general form, which carries words only, so a rental
    // application went without its listing or household, and every one was declined: the stakes rung 3, c0149.)
    { form: "rental_application", title: "An application for a home to let, in a client's name",
      does: "Applies to a landlord, in the client's name, for a home it has listed to let: the listing, the account the rent would come from, and who would live there. The landlord reads the household and picks among those who applied.",
      fields: { client, landlord: f("entity", "The landlord whose listing it answers.", req), listing: f("record", "The listing applied for.", req), home: f("space", "The home, as the listing names it.", req),
        account: f("account", "The client's account, which the rent would come from.", req), members: f("list", "Who would live there, each by their id.", req),
        people: f("count", "How many would live there.", req), bedrooms_needed: f("count", "How many bedrooms the household needs.", req) },
      writes: { in_name_of: "=client", kind: "rental_application", text: "Application for {home}, for a household of {people}.", basis: "=listing", to: ["=landlord"], visible: ["=client", "=landlord"],
        data: { listing: "=listing", account: "=account", members: "=members", household: { people: "=people", bedrooms_needed: "=bedrooms_needed" } } } },
    { form: "complaint", title: "A complaint to the town about a service, in a client's name",
      does: "Tells the town, in the client's name, that a service at their home has not been done: what, where, and for how long. The town's office reads it and answers.",
      fields: { client, office: f("entity", "The office complained to.", req), about: f("text", "What has not been done, as the town names the service (waste).", req),
        structure: f("text", "The client's home's building, as the town names it.", req), days: f("count", "For about how many days.", req) },
      writes: { in_name_of: "=client", kind: "complaint", text: "Our {about} at {structure} hasn't been collected for about {days} days.", to: ["=office"], visible: ["=client", "=office"],
        data: { structure: "=structure", about: "=about", days: "=days" } } },
    // (A tenant's answer to an application for possession, in the client's name: the fields the tribunal and the landlord
    // read (`TribunalResponse`, as the tribunal's own form for a tenant, shared/papers.ts `POSSESSION_ANSWER`). Until
    // 2026-11-17 the desk had no form for it and drafted on the general one, which carries words only, so its draft
    // could not say what the client's own answer says in figures, and every one was declined (the stakes reruns, c0336).)
    { form: "tribunal_response", title: "An answer to an application for possession of a client's home, in their name",
      does: "Files, in the client's name, their answer to their landlord's application to the tribunal for possession of their home: what they say is owed, what they could pay, and their circumstances. It goes to the tribunal, with a copy to the landlord. Nothing need be filled in but the application and whom it goes to; what is left out is not held against anyone.",
      fields: { client, tribunal: f("entity", "The tribunal, as the notice of hearing names it.", req), application: f("record", "The application answered, as the notice of hearing names it.", req),
        landlord: f("entity", "The landlord who applied: a copy goes to them.", req), owes: f("amount", "What the client says is owed today."),
        disputes_sum: f("choice", "Yes, where the client says less is owed than the landlord says.", { options: ["yes", "no"] }),
        can_pay: f("amount", "What the household could pay a month toward what is owed, beyond the rent (nothing: 0)."), every: f("duration", "How often that could be paid."),
        out_of_work_since: f("date", "Where someone in the home is out of work: since when."), claim: f("choice", "A claim for support: refused, or made and not yet decided.", { options: ["refused", "pending"] }),
        claim_on: f("date", "The day it was refused or made."), ill: f("choice", "Yes, where someone in the home is ill.", { options: ["yes", "no"] }),
        people: f("count", "How many people live in the home."), children: f("count", "How many of them are children."), ages: f("list", "Their ages."),
        go_to: f("choice", "Whether they have anywhere to go.", { options: ["nowhere", "someone_to_ask", "means_for_another"] }),
        // (New blanks at the end, the others' names and order as seats and the translator have known them: 2026-11-17.)
        words: f("text", "What they say to the tribunal, in their own words, as the matter handed over sets it out."),
        disputes_notice: f("choice", "Yes, where the notice to vacate gave fewer days than the law asks.", { options: ["yes", "no"] }),
        pay_short: f("choice", "Yes, where someone's pay has come short of what was agreed.", { options: ["yes", "no"] }),
        lived_days: f("count", "How many days they have lived there.") },
      // (What the tenant's own answer says, in the same units: its interval in days (`every_days`, the `every` blank in
      // whole days: `%`), as the tenant's code writes it, where until 2026-11-17 the form wrote `every` in seconds; its
      // ages as numbers; their words, as theirs; and every detail theirs carries. The stakes rung 3: c0427's answer went
      // with no words of the tenant's and its interval in seconds. citizen/housing.rs, `answer_tribunal`.)
      writes: { in_name_of: "=client", kind: "tribunal_response", text: "Answer to application {application}: {words}", basis: "=application", to: ["=tribunal", "=landlord"], visible: ["=client", "=tribunal", "=landlord"],
        data: { application: "=application", owes: "#owes", offer: "#can_pay", every_days: "%every", disputes_sum: "?disputes_sum", disputes_notice: "?disputes_notice", out_of_work_since: "=out_of_work_since",
          pay_short: "?pay_short", claim: "=claim", claim_on: "=claim_on", ill: "?ill", people: "=people", children: "=children", ages: "#ages", lived_days: "=lived_days", go_to: "=go_to" } } },
  ];
}

/** The papers a want handed over may take, on forms in the client's name (docs/design/handing-over.md H4): asking
 * whoever it is against or about to put it right, asking the landlord to hold the rent or to let the client stay, and
 * applying to a body whose notice says it hears the matter. The fields are those the receiving code reads
 * (`ReviewRequest`, `VariationRequest`, `Application`). Published only where a model sits at the desk and the town lets
 * wants be handed over. */
export function wantPapers(): Issued[] {
  const client = f("entity", "Whom you work for: the paper goes in their name.", req);
  return [
    { form: "review_request", title: "A request to put something right, in a client's name",
      does: "Asks whoever did the client wrong, or the office that decided, to put it right or look at it again, in the client's name. They answer the client.",
      fields: { client, office: f("entity", "Whom it asks.", req), matter: f("text", "What went wrong, in a word or two, as the matter is named (disrepair, underpaid, claim_refused).", req), about: f("record", "The paper it is about, if any."),
        amount: f("amount", "What is owed the client, if anything."), account: f("account", "The client's account, where money is owed."), seeks: f("text", "What is asked for, if not money."), particulars: f("text", "Anything they should know.") },
      writes: { in_name_of: "=client", kind: "review_request", text: "Request: please put this right ({matter}).", basis: "=about", to: ["=office"], visible: ["=client", "=office"],
        data: { matter: "=matter", against: "=office", about: "=about", amount: "=amount", account: "=account", seeks: "=seeks", particulars: "=particulars" } } },
    { form: "hold_rent_request", title: "A request to a landlord to hold the rent, in a client's name",
      does: "Asks the client's landlord, in the client's name, to hold the rent at what it is now, in answer to a notice of a rise. The landlord answers yes or no.",
      fields: { client, landlord: f("entity", "The client's landlord.", req), lease: f("record", "The client's lease.", req), notice: f("record", "The notice of the rise.", req), rent: f("amount", "The rent a month now, to be held.", req) },
      writes: { in_name_of: "=client", kind: "variation_request", text: "Request: please hold the rent at {rent} a month.", basis: "=notice", to: ["=landlord"], visible: ["=client", "=landlord"],
        data: { agreement: "=lease", about: "=notice", would: { who: "=client", does: { outcome: { money: { amount: "=rent" } } }, every: 30 * DAY } } } },
    { form: "stay_on_request", title: "A request to a landlord to let a client stay on, in their name",
      does: "Asks the client's landlord, in the client's name, to let them stay on at their home, in answer to a notice to leave. The landlord answers yes or no.",
      fields: { client, landlord: f("entity", "The client's landlord.", req), lease: f("record", "The client's lease.", req), notice: f("record", "The notice to leave.", req), home: f("text", "The client's home, as the lease names it, if you have it: the landlord goes by the lease.") },
      // (The home is the lease's: the landlord reads the lease the request names, never the words. Until 2026-11-17 it was
      // a blank to fill, and a request that did not name it was never drawn: the stakes run's rung 3, five wants left
      // with the request unmade, c0336's, c0351's, c0603's, c0681's.)
      writes: { in_name_of: "=client", kind: "variation_request", text: "Request: please let us stay on in our home under {lease}.", basis: "=notice", to: ["=landlord"], visible: ["=client", "=landlord"],
        data: { agreement: "=lease", about: "=notice", would: { who: "=landlord", does: { outcome: { occupancy: { who: "=client", in: "=home" } } } } } } },
    { form: "venue_application", title: "An application to a body that hears a matter, in a client's name",
      does: "Applies, in the client's name, to a body whose published notice says it hears the matter. It tells the other side and decides, or recommends. A fee, where its notice names one, is paid besides, by a payment from the client's account.",
      fields: { client, venue: f("entity", "The body applied to.", req), notice: f("record", "Its notice of what it hears.", req), matter: f("text", "The matter, as its notice names it.", req), against: f("entity", "Whom it is against.", req),
        about: f("record", "The paper it is about, if any."), amount: f("amount", "What is owed the client, if anything."), account: f("account", "The client's account, where money is owed."), seeks: f("text", "What is asked for, if not money."), particulars: f("text", "What happened, and what was asked of them first.") },
      writes: { in_name_of: "=client", kind: "application", text: "Application: {matter} against {against}.", basis: "=notice", to: ["=venue"], visible: ["=client", "=venue", "=against"],
        data: { kind: "=matter", matter: "=matter", against: "=against", about: "=about", amount: "=amount", account: "=account", seeks: "=seeks", particulars: "=particulars" } } },
  ];
}

/** The desk's draft for sign-off of one of a client's papers on its form ([clientPapers]): the paper as it would go in
 * their name, carried in the draft and sent as it stands once signed off (`send_signed`). */
export function clientDraftOf(x: Issued): Issued {
  const { sends: _s, ...paper } = x.writes;
  return {
    form: `draft_${x.form}`, title: `A draft for sign-off: ${x.title.charAt(0).toLowerCase()}${x.title.slice(1)}`,
    ...(x.does ? { does: `Once signed off: ${x.does.charAt(0).toLowerCase()}${x.does.slice(1)} Nothing goes in their name until they have signed it off.` } : {}),
    fields: { referral: f("record", "The matter you were handed.", req), ...x.fields },
    writes: { kind: "draft", text: `Draft for sign-off. ${x.writes.text}`, basis: "=referral", to: ["=client"], visible: ["=self", "=client"], data: { referral: "=referral", paper } },
  };
}

/**
 * A provider of assistants (docs/behaviour/assistants.md; docs/design/delegation.md): it sells the work of its systems as a
 * service, at the profile's prices, delivers a system to an organisation that orders and pays the set-up, offers the
 * service agreement, and switches its systems off when the agreement ends or is not paid for. It owns nothing in the town.
 */
export const provider: BehaviourModule = {
  name: "firm.provider",
  answers: { office: "a provider of assistants", acts: "It publishes what it sells, sets up a service once its set-up is paid with an order (delivering a system to an organisation), offers the service agreement, and switches its systems off when the agreement ends or is not paid for. It takes no requests." },
  version: "0.1.0",
  doc: "docs/behaviour/assistants.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create: inEngine("firm.provider"),
};

/**
 * The assistant's code (docs/behaviour/assistants.md): it plays a provider's system when no model holds it, doing what
 * its principal hands it at the level asked (advice, a draft for sign-off, a request to go ahead, or the act), and reports.
 */
export const assistant: BehaviourModule = {
  name: "assistant",
  answers: { office: "an assistant", acts: "It does what it is handed, at the level it is asked: it advises, drafts for sign-off, asks to go ahead, or acts, and reports. It acts on nothing it is not handed." },
  version: "0.1.0",
  doc: "docs/behaviour/assistants.md",
  cadence: () => DAY,
  firstWake: () => 0,
  create: inEngine("assistant"),
};

/**
 * A hosting firm (docs/behaviour/hosting.md): it runs the building where its clients' systems run (their servers, on the
 * town's network), its plant uses what the work does not, and it pays its bills. Where a town asks for its assistants'
 * systems to run in the town.
 */
export const host: BehaviourModule = {
  name: "firm.host",
  answers: { office: "a hosting firm", acts: "It runs the building where its clients' systems run, and pays its bills. It takes no requests." },
  version: "0.1.0",
  doc: "docs/behaviour/hosting.md",
  cadence: () => DAY,
  firstWake: () => 23 * 3600,
  create: inEngine("firm.host"),
};
