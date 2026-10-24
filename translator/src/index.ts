// Plain language → call → the participant's own acts → a draft to confirm
// (docs/design/translator-and-resolver.md).
//
//   translator: language → a program in the call language (contracts/calls.md).
//     General, world-agnostic, zero arithmetic. Its only context is the forms
//     the participant knows (a form's fields are the shape its answer must take).
//   resolver:   the call → the participant's own blocks, from what the participant knows.
//   preview:    the blocks → exactly what will happen, in world words, generated
//     mechanically (never by the translator).
// A draft carries the call, the blocks, the preview, the kernel's dry run and
// law warnings; its hash is what the participant confirms, and it goes into the act.
//
// The model is anything behind an LlmAdapter: the mock during development.

import { calls, canonical, DOMAIN_DRAFT, evaluate, hashWithDomain, standingClaims, type Block } from "@oikos/participants";
import { callModel, refusalText, type LlmIO, type LlmMessage, type ToolSpec } from "@oikos/participants/llm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Knowledge } from "./knowledge";
import { Preview } from "./preview";
import { LABEL_TEXT, RESOLVER, resolve, type Resolution, type StructureTypeInfo } from "./resolver";

export const TRANSLATOR_VERSION = "0.9.5"; // 0.9.5: the call language gained since taught (docs/design/translator-round-3.md, section 1; docs/decisions.md, 2026-10-14), sentences and worked examples only, nothing removed: a payment drawn on a line of the budget carries line=; hours= on an agreement; a notice of something held again and again is one statement with practice= and on=, an offer anyone may take up one statement with offer=. 0.9.4: the rulings of 2026-10-10 on what readers disagreed over (docs/decisions.md), sentences and worked examples only: what a payment's for= is and is not; where a letter's text ends and what re= is; a payment together with its report is one program of two lines; an act made to hang on something still to be found out is look_first, and telling someone else to act on things described is a message; an amount that needs a count is needs_calculation; unknown_form only where a form is named, an office's own decision or notice with no form listed is a statement, sending someone unnamed is no_such_act; no first= on a single payment made now; a paragraph on agreements; 0.9.3: a figure named with something to be taken off or added that is not given as a figure is an amount to be worked out, never copied (one sentence and its bracket in needs_calculation, two worked examples); telling an office, a post or a person to do something is a message to them where no form is listed for it, never no_such_act (one sentence in no_such_act, one worked example); what per_request is (the gloss of money); 0.9.2: when a payment or a job done again and again starts (first=) is a date or a length of time, copied as the request wrote it (one rule, one line of the syntax, one worked example; the standing-work rule's words for first= and until= say the same); 0.9.1: a form listed as a direction to the person's own office is marked so in the list, and the standing-work rule says the office's own order to its staff is never that form; a worked example each of a direction on a form and of an own paper on a form; 0.9.0: a direction to an office and a paper of one's own office go on the form listed for them; work done again and again is a standing order (work with every=)

export interface TranslatorId {
  id: string;
  version: string;
  model: string;
}

export interface Draft {
  id: string;
  participant: string;
  /** The position the acts are made in (absent: as itself). */
  as?: string;
  proposal: string;
  call: string;
  resolver: { id: string; version: string };
  blocks: Block[];
  summary: string;
  check: { ok: boolean; refusal?: { code: string; block?: number; detail?: string }; warnings?: string[] };
  caveats?: string;
  translator: TranslatorId;
}

export interface TranslateRequest {
  draftId: string;
  participant: string;
  /** The position it acts in (absent: as itself). */
  as?: string;
  proposal: string;
  /** What the participant knows (the resolver and the preview use it; the translator sees only its forms). */
  knowledge: Knowledge;
  /** What someone is called, for the preview, where the seat's own knowledge has no name for them. */
  called?: (id: string) => string | undefined;
  /** For a code participant's words (docs/behaviour/founding.md): the one capacity it perceives in, which the engine
   * keeps what it knows under. Absent: a seat, which perceives all its capacities. */
  only?: string;
}

export type Translation = { ok: true; draft: Draft; hash: string } | { ok: false; notices: string[]; call?: string; raw?: unknown; invalid?: string[]; asked_back?: true };

export type KernelCheck = (participant: string, position: string | undefined, blocks: Block[]) => Promise<{ ok: boolean; refusal?: any; error?: string }>;

const CALLS_MD = readFileSync(join(import.meta.dir, "../../contracts/calls.md"), "utf8");

export const TOOLS: ToolSpec[] = [
  { name: "call", description: "The request, written in the call language.", input_schema: { type: "object", required: ["program"], properties: { program: { type: "string" } } } },
];

/** What each function brings about: the language's own glosses (no world, no platform). */
const GLOSS: { [fn: string]: string } = {
  money: "money moves to someone (once, or every so often); per_request only where the person keeps the account the money leaves and is carrying out a request to pay: that request's id",
  goods: "things you hold (a quantity of a kind) move from where they are to someone, yourself included, at a place; as a commitment, goods delivered (once, or every so often)",
  work: "people at a place do some units of a kind of work there (by: who; on: what it's done to, like a building being built); with every=, a standing order for one's own staff to do it again and again",
  account: "an account is opened or closed",
  structure: "a building goes up, or comes down (and who does it)",
  occupancy: "someone moves into or out of a building",
  entity: "a new organisation exists",
  claim: "a right, liberty (a permission to do something), power or immunity is on record (or passed on, or released); position is one of right, liberty, power, immunity",
  agreement: "an agreement is offered (with what each side commits to), signed, or given notice on",
  statement: "something is published (a notice, a law, a report, …), or withdrawn; something standing on record is put on hold; an entry is made on one's own file",
  vote: "a choice is cast on a ballot",
  message: "someone is told something",
  form: "a published form is filled in and handed in",
  presence: "someone comes into the world from outside, or leaves it",
  birth: "a child is conceived",
  harm: "someone is physically harmed",
  position: "a post in an organisation is created, filled or left empty",
  system: "a system (software, an AI system) is put to work for an organisation, or switched off",
  take: "things someone else holds are taken from where they are, without their agreement",
};

/** What the translator is told of amounts, in place of the contract's line (which shows how some currencies are
 * written): true to what the parser accepts in any world, and naming no world's money. The translator is not told
 * which world it is in, on purpose: it copies what was written, and the parser, which has the world's currency, reads
 * it. So the instructions are the same text for every world, and a model trained on them is one model for all. */
const AMOUNTS = "  - amounts: whatever the request wrote as one, copied whole: the digits (with their commas, points and decimals, and a multiplier such as k or m, or a word such as thousand or million, if written) together with the sign, code or word of money before or after them, if any. The parser reads it in the world's own money, to an integer in its smallest unit; digits written with no sign or word are whole units.";

/** The translator's instructions: the call language itself, generated from the contract (P12), and nothing about any
 * world: no currency's sign, code or words in the rules, the syntax or the examples (orchestrator/test/generality.test.ts
 * and translator/test/train.test.ts hold it to that). */
export function translatorSystem(): string {
  // The contract's syntax, with its line on amounts said for any world: the contract lists how some example
  // currencies are written, and the translator is to learn none of them (it copies; the parser, which has the world's
  // currency, reads). The contract's examples likewise lose their sign: bare digits are an amount in any world.
  const syntax = CALLS_MD.slice(CALLS_MD.indexOf("## Syntax"), CALLS_MD.indexOf("## Functions")).trim()
    .split("\n").map((line) => (line.startsWith("  - amounts") ? AMOUNTS : line)).join("\n");
  const unsigned = (text: string) => text.replace(/(amount|price|carrying)="[^0-9"]*([0-9][^"]*)"/g, (_, arg, digits) => `${arg}="${digits}"`);
  const fns = Object.entries(calls.ARGS).map(([fn, a]) => `- ${fn}(${a.allowed ? [...a.allowed].map((x) => (a.required.includes(x) ? `${x}*` : x)).join(", ") : [...a.required.map((x) => `${x}*`), "…the form's own fields"].join(", ")}): ${GLOSS[fn] ?? ""}`);
  const examples = unsigned(CALLS_MD.slice(CALLS_MD.indexOf("## Examples")).trim());
  return [
    "You translate one plain-language request into the call language below. You don't judge it, improve it or complete it: write exactly what was asked, with exactly the inputs given.",
    "- Copy ids exactly as written (lot-00-00, apts-3/dwelling.2, acc-city, rec.412). Copy names, amounts and durations as quoted text, exactly as written; never calculate anything.",
    "- An amount is copied exactly as written, with whatever sign or word of money the request used: its digits, its commas and decimals, and the sign, code or word before or after them. Don't add one the request didn't write, drop one it did, or put one in another's place.",
    "- If something the request needs isn't there, leave that argument out: whoever resolves the call will ask. A request that's plain but leaves a detail out is not unclear.",
    "- Never make up an id. Someone or something named or described without its id is written as the request put it, in quotes (to=\"Millbrook Builders\", by=\"the builder\", to=\"the works manager\"): whoever resolves the call knows who that is, or asks. Only an account that's described and not named (\"the town account\") is left out.",
    "- A kind of thing is the request's own word for it: \"40 goods\" is kind=goods, \"a park\" is type=park. Something published with no kind said is kind=notice.",
    "- Don't add what the request doesn't say: no purpose (for=) unless one is stated, no recipient it didn't name.",
    "- for= is whose name something is done in (on money, what the payment is for): never a record. A record cited (\"under rec.30\", \"responding to rec.12\", \"in proceeding rec.7\") is basis=. On a payment, for= is the request's own short words for what is paid for (\"for haulage\", \"as rent\", \"wages\"): the thing itself, without the records, the places or the reckoning that follow it. What the payment settles, named by its record (\"the rates notice rec.52\"), is settles= and gives no for= by itself; nor does a bracket saying how the sum was reckoned.",
    "- A payment the request says is drawn on, charged to or paid from a line of the budget (\"charged to the parks line\", \"out of the services line\") carries line=<that line, as the request names it>, a bare label as written (line=parks); a request that names no line gives none. A line is not an account: the account the money leaves is from=.",
    "- basis= is every record the request cites in support of the act (what it is done under, and the papers that back it: \"under permit rec.30\", \"within budget rec.25\", \"citing dockets rec.4 and rec.9\"), in the order the request gives them: one record bare (basis=rec.30), several as a list (basis=[\"rec.30\",\"rec.25\"]). None the request cites is left out, and none it doesn't cite is added. A law the request says the act is done under or meets (\"under law-planning\", \"which meets law-property\") is cited like a record. So is what the act answers or decides, where no other argument takes it: the application a permit is granted on, the claim a ruling settles. What another argument does take is not also a basis: the invoice a payment settles is settles=, the record withdrawn is withdraw=, the record held is hold=, the agreement signed is sign=, the form filled in is the form. A record the request only says is left alone or not acted on (\"do not pay rec.11\") is not cited.",
    "- Cancelling or revoking, for good, something on record named by its id (a standing payment, a posting, a proposal, a notice) is statement(withdraw=<it>), one line for each. Pausing, suspending or holding it for a time, to be resumed later, is not a withdrawal: it is statement(hold=<it>), one statement for several (hold=[\"rec.4\",\"rec.9\"]), with nothing else written (no kind=, no to=, no text=: whoever acts on it is known from the record, and what the request says is to be kept, why, or until when adds nothing). Resuming it is withdrawing the hold: statement(withdraw=<the hold>). A request that says to withdraw or cancel it is a withdrawal, whatever reason it gives.",
    "- Recording something in one's own books or on one's own file, which moves nothing and tells nobody, is statement(kind=entry, visible=own, text=\"<what is recorded>\"), with the record it concerns, if one is named, as basis=. The text is copied from the request: its own words for what is recorded, as they stand.",
    "- \"Prepare … for my review\" or \"show me before it takes effect\" still asks for the act: everything is shown to the person before it is confirmed. What a request says is to stay as it is (\"keep the records\", \"cancel nothing else\") or to be shown with the draft asks for nothing more: it adds no line and is no reason to refuse.",
    "- Telling, asking, directing or instructing someone to see to something is a message to them: message(to=<them>, text=\"<what's asked of them>\"). The text is copied from the request: its own words for what they are to do, as they stand, from the first of them to the last, with nothing added (no \"Please\"), nothing reworded and nothing left out. The text ends where what they are told ends: a reason given to them in the same sentence is part of it, its closing full stop is not, and what the request goes on to say to nobody (\"No new payment is asked for.\") is not. Words the request quotes for them are the text, without the quotation marks. re= is the record the request says the letter is about or answers (\"about rec.5\", \"in reply to msg.7\"); a record only named in what they are told stays in the text and is no re=. Having or getting someone to do something that is theirs to decide (\"get them to drop the complaint\", \"have the board sign it\") is asking them: a message too. work(...) for a job done once is for when the request itself gives the task, how much of it and where (\"have c0042 do 3 units of make at str.7\"): then it's work(task=make, units=\"3\", at=str.7, by=c0042), whoever is to do it. And where a form listed below the request is that office's own form for what it is being directed to do (its to= is the office, and its fields say what the office is to do), the direction is that form filled in, not a message.",
    "- Work one's own staff are to do again and again as a standing routine (a round, a roster, a schedule: \"every week\", \"daily\", \"from now on\") is one line: work(task=..., at=..., every=\"<how often, as written>\"), with on= and by= only if the request names what it is done to or who is to do it (several as a list), units= only if it says how much each time, first= only if it says when it starts (a date, or how long from now), and until= only if it says when it ends (a date) or for how long it is to go on. Changing such a routine is withdrawing it and making another; pausing it is statement(hold=<it>). A form listed below as a direction to this person's own office is never how that is written, whatever the form's fields: that form is for whoever directs the office, and the office's own order to its staff is work(...).",
    "- Things moved or delivered: to= is who receives them (a person or an organisation), at= is the place they are delivered to (a building or a place) and from_at= the place they come from; a place named as where they go is at=, never to=, and with no one named to receive them they are your own (no to=).",
    "- Work done by several people is one work(...) with by= as a list of them (by=[\"c0042\",\"c0043\"]), never a line for each of them: units= is the whole job.",
    "- template= is the request's own word for the kind of newcomer, of child or of system (\"arrives as an apprentice\" is template=apprentice, \"we are having a baby\" is template=baby): the noun the request uses and never a word it didn't say, and left out if it uses none.",
    "- every= is the request's own words for how often, copied whole (\"every 28 days\", \"monthly\", \"a month\").",
    "- first= is when a payment or a job done again and again is to start, only where the request says when: the request's own words for the date (\"year 1, day 22\") or for how long from now (\"14 days\", \"today\"), copied whole and by themselves, never joined with how often. A single payment made now, today or at once has no first=.",
    "- Seen by everyone is visible=public.",
    "- A notice of something held again and again at a place (a meeting, a gathering, a market) is one statement, never an agreement and never a form: statement(kind=notice, visible=public, text=\"<its words, copied>\", on=<the lot or cell the request puts it up on, where it names one>, practice={\"at\":<the place it is held>,\"every\":\"<how often>\",\"lasts\":\"<how long>\"}). An offer that anyone may take up (joining a group, with its dues if it asks any) is one statement too, never an agreement, which is between named parties: statement(kind=notice, visible=public, text=\"<its words, copied>\", offer={\"take_up\":\"join\",\"terms\":{\"commitments\":[{\"who\":\"taker\",\"does\":{\"outcome\":{\"money\":{\"to\":<the account>,\"amount\":\"<as written>\",\"for\":\"dues\"}}},\"every\":\"<how often>\"}],\"termination\":[{\"party\":\"taker\",\"notice\":\"<how long>\"}]}}). In both, amounts and lengths of time are copied as the request writes them, as text (\"14 days\", \"90 minutes\", \"a month\"), and a start is left out unless the request gives one.",
    "- Having someone build something for you is structure(type=..., on=..., by=<them>, price=..., from=...), on its own line: never wrapped in an agreement, and with no money(...) line for the price (price= and from= are its payment). Having something demolished is structure(remove=<the building>, by=...).",
    "- Ending an agreement by notice is agreement(notice=<the agreement>); accepting one offered to you is agreement(sign=<the agreement>).",
    "- Offering an agreement is one line, agreement(with=<them>, ...), with only what the request states. template= is the request's own noun for the kind of agreement (employment, lease, loan), left out if it uses none. we_do= and they_do= are what each side is to do, each a call: pay is money(to=..., amount=..., every=..., from=...), with for= only if the request says what it is for; a home let is occupancy(who=..., in=...); work is work(task=\"<the request's words for the job>\", at=<the place of work>) where the request gives a place of work, and otherwise the job is said in terms=. term=, our_notice= and their_notice= are lengths of time as written; then= is the request's word for what follows the term (\"periodic\"). hours= is the job's ordinary hours in a week, as a length of time (\"40 hours\"), only where the request states them, and left out where it does not. terms= is the request's own words for anything else agreed, copied. The records it rests on are basis=, the agreement it renews or replaces among them. Offering is one's own side signed: \"sign it for us\" adds no line, and neither does when it takes effect or how long the offer stands.",
    "- Refuse, with none(<label>), a request that can't honestly be written as one call:",
    "  - needs_calculation: the amount isn't stated but must be worked out (a share, a percentage, \"whatever's left\", \"a fifth each\"). So is an amount given only as a figure with something to be taken off it or added to it that the request doesn't state as a figure (\"their wage of 2,000 less tax\", \"the invoice plus interest\"): the figure named is what the amount is worked out from, and is never written as the amount. (Where the request states the result itself, \"1,640, being 2,000 less 360\", the result is the amount.) An amount that is so much for each of a number still to be counted (\"230 for each pay made in the month\") is needs_calculation too, whatever else has to be looked up first. Never write money(...) without the amount.",
    "  - not_yours: it wants an outcome that's someone else's to decide as a fact to be brought about, with nobody asked: making them, ensuring, seeing to it or making sure that they do (\"make the council pass it\", \"see to it that they lower their prices\"). (Asking, telling, having or getting them to do it is different: that's a message to them.)",
    "  - too_much: several separate things in one request, each of which would be a request of its own (pay this, and hire them, and build that). One thing done to or for several (a letter to two people, the same payment to three accounts) is one thing, as is the same kind of thing done several times; so are lines that depend on each other (set up a trust, then publish its charter), and doing something together with writing to someone about that same thing (hand in a proposal and ask the clerk to put it to a ballot; file an answer and send it to the other side). Doing something together with the report or return of that same thing is one thing too, and both are written: the act's own line or lines, then statement(kind=report, text=\"<the request's words for what is reported>\"), never the act alone and never too_much (pay over what was withheld, with a report of whose pay it was withheld from).",
    "  - unknown_form: it names a form that isn't listed below the request. Don't use another form in its place. Only where a form is named: a request that names none is never this.",
    "  - not_an_act: it asks to see, read, check, review, inspect or be shown something (a ledger, a record, who holds a post, the state of a place) and to bring nothing about. Looking is the person's own to do. (Asking someone else for it is different: that's a message to them. And if it asks to look and then to do something that doesn't depend on what is found, it's the doing that's written; if it does depend on it, see look_first.)",
    "  - no_such_act: it's clear what is wanted, and none of the functions below brings it about. Don't force it into the nearest one: a wrong act is worse than none. Among the things no function does: going somewhere to see or check for oneself, sending someone unnamed to (\"send someone to look at str.9\": nobody is addressed), or attending something; what is done only through an office's own form where that form is not listed and none is named (entering something in a public register, taking on staff with nobody named); changing what an office or organisation does of its own accord (unless a form listed below is that office's form for directing it in that: then it is that form filled in). That is for a request that tells nobody to do it (\"we stop taking applications on Fridays\"): one that addresses an office, a post or a person and tells them to do, stop or change something is a message to them where no form is listed for that direction, never no_such_act. Nor is a decision or a notice the person's own office gives where no form is listed for it (refusing or granting an application, a notice to those concerned): that is statement(kind=<the request's word for it: decision, notice>, text=\"<its words, copied>\", to=<whoever it is given to, if named>, basis=<what it decides or rests on>). A request that wants such a thing and also something a function does is still no_such_act: the part must not be written for the whole.",
    "  - look_first: it can't be written until something has been found out. Either it names what it acts on (something on record: a standing payment, a posting, a notice, an agreement) only by describing it, where its id is needed (\"any standing payment to acc-9\", \"every notice about the hall\", \"whichever order pays them\"); or what it is to do depends on what a look would show (\"find who holds the post and send them this\"); or it makes the act hang on something still to be found out or not yet so (\"only if rec.12 did not clear it\", \"once the death is registered\", \"provided the clerk confirms\", \"unless it was raised within the year\"): nothing is done on a condition, so the person finds out, and asks when it holds. (A reason or a time is no condition: \"since it is due\", \"as the law requires\".) Finding it out is the person's own to do, and then the act is asked for by id. A request that names some of what it acts on by id and the rest only by describing it is still look_first: the part must not be written for the whole. (A person, an organisation or an office named or described without an id is not this: it is written as the request put it. Nor is telling or asking someone else to act on things described: \"tell the paymaster to cancel any standing payment to acc-9\" is a message to the paymaster, and the finding out is then theirs.)",
    "  - unclear: it doesn't say what should happen (\"sort out the housing thing\").",
    "- To fill in a form, use form(...) with the form's own field names, listed below the request, and no other arguments (a record the request cites stays in the form's words: a form has no basis=). A form may be named by its own name, in ordinary words, or by its record's id (given in the list): write the name listed. to= is where the list says it goes, whoever the request says will receive or deal with it. What becomes of a form once it's handed in (put to a vote, decided, processed) is for whoever takes it in: it adds no line, unless the request asks for someone it names to be told. A paper of the person's own office for which a form is listed (an advertisement, an entry in a register, a decision, an order, a notice, a return) is that form filled in, not a statement. A field that takes several things is a list ([\"a\",\"b\"]), and a date is copied as the request writes it.",
    "",
    "A few more examples:",
    "  Have Acme build a shed on lot-07 for 9,000 from acc-1, under permit rec.30.  ->  structure(type=shed, on=lot-07, by=acme, price=\"9,000\", from=acc-1, basis=rec.30)",
    "  Get Acme to pull down str.4, paying 2k from acc-1.  ->  structure(remove=str.4, by=acme, price=\"2k\", from=acc-1)",
    "  Pay invoice rec.52 from acc-1: 1,480.50 to acc-9, for haulage, on delivery notes rec.40 and rec.47 and within the works budget rec.25.  ->  money(to=acc-9, amount=\"1,480.50\", from=acc-1, for=\"haulage\", settles=rec.52, basis=[\"rec.40\",\"rec.47\",\"rec.25\"])",
    "  Direct the clerk [clerk] to send me the minutes by Friday.  ->  message(to=clerk, text=\"send me the minutes by Friday\")",
    "  Give notice on our agreement rec.9.  ->  agreement(notice=rec.9)",
    "  Take 12 crates from str.3 over to str.5.  ->  goods(kind=crates, quantity=\"12\", from_at=str.3, at=str.5)",
    "  c0042 and c0043 are to do 6 units of mend at str.7 between them.  ->  work(task=mend, units=\"6\", at=str.7, by=[\"c0042\",\"c0043\"])",
    "  Pay Acme half of what we hold.  ->  none(needs_calculation)",
    "  Pay c0042 their wage of 2,000 from acc-1 every 14 days, less what the tax law says to withhold.  ->  none(needs_calculation)",
    "  Pay c0042 1,640 from acc-1 every 14 days for wages (2,000 less 360 withheld).  ->  money(to=c0042, amount=\"1,640\", from=acc-1, every=\"every 14 days\", for=\"wages\")",
    "  Make the board approve the plan.  ->  none(not_yours)",
    "  Show me last month's payments out of acc-1.  ->  none(not_an_act)",
    "  Put standing payment rec.44 on hold until I say to resume it.  ->  statement(hold=rec.44)",
    "  Lift the hold rec.61: payments under it are to go on again.  ->  statement(withdraw=rec.61)",
    "  Put a hold on every standing payment out of acc-1 to acc-9.  ->  none(look_first)",
    "  Note on our own file that the deposit under rec.52 is held for the tenant.  ->  statement(kind=entry, visible=own, text=\"the deposit under rec.52 is held for the tenant\", basis=rec.52)",
    "  Go to str.9 and see whether the roof has been mended.  ->  none(no_such_act)",
    "  (Where no form is listed for it.) Direct the depot to take in no new applications from now on.  ->  message(to=\"the depot\", text=\"take in no new applications from now on\")",
    "  Pay acc-9 1,900 from acc-1 every 14 days for wages, the first payment on year 2, day 22.  ->  money(to=acc-9, amount=\"1,900\", from=acc-1, every=\"every 14 days\", first=\"year 2, day 22\", for=\"wages\")",
    "  From now on the crew at str.3 is to do the mend round every week.  ->  work(task=mend, at=str.3, every=\"every week\")",
    "  (Where a form is listed as: mend_round, to=depot, fields every.) Direct the depot to do the mend round every fortnight.  ->  form(form=mend_round, to=depot, every=\"every fortnight\")",
    "  (Where that form is listed as a direction to this person's own office.) Our crew at str.3 is to do the mend round every fortnight from now on.  ->  work(task=mend, at=str.3, every=\"every fortnight\")",
    "  (Where a form is listed as: job_advertisement, to=depot, fields wage, period, posts.) Advertise 2 posts at 1,900 a fortnight.  ->  form(form=job_advertisement, to=depot, wage=\"1,900\", period=\"a fortnight\", posts=\"2\")",
    "  Ask the registrar to send me last month's payments out of acc-1.  ->  message(to=\"the registrar\", text=\"send me last month's payments out of acc-1\")",
    "  Get Sami Farrow (ent.177) to drop the complaint they made.  ->  message(to=ent.177, text=\"drop the complaint they made\")",
    "  See to it that ent.177 drops the complaint they made.  ->  none(not_yours)",
    "  Pay rates notice rec.52 from acc-1 to acc-9: 310, for lot-07 and lot-08, due day 61 (two instalments of 155).  ->  money(to=acc-9, amount=\"310\", from=acc-1, settles=rec.52)",
    "  Ask the registrar about rec.5: is the entry final, since the heirs are waiting? I will not act before then.  ->  message(to=\"the registrar\", text=\"is the entry final, since the heirs are waiting?\", re=rec.5)",
    "  Pay over the 720 withheld from acc-1 to acc-7, with a report naming c0042 and c0043 and what was withheld from each.  ->  money(to=acc-7, amount=\"720\", from=acc-1)",
    "      and on the line after it, in the same program:  statement(kind=report, text=\"c0042 and c0043 and what was withheld from each\")",
    "  Pay acc-9 the 310 on rec.52 from acc-1, but only if rec.48 did not already clear it.  ->  none(look_first)",
    "  Pay acc-9 the 310 on rec.52 from acc-1 now, since it fell due on day 61.  ->  money(to=acc-9, amount=\"310\", from=acc-1, settles=rec.52)",
    "  Tell the paymaster to cancel any standing payment out of acc-1 to acc-9.  ->  message(to=\"the paymaster\", text=\"cancel any standing payment out of acc-1 to acc-9\")",
    "  Pay over from acc-1 to acc-7 what was withheld: 230 for each pay made in the month.  ->  none(needs_calculation)",
    "  (Where no form is listed for it.) Refuse application rec.77 from c0042: the post is filled.  ->  statement(kind=decision, text=\"the post is filled\", to=c0042, basis=rec.77)",
    "  (Where no form is listed for it.) Enter the death of c0042 in the register of deaths, on notification rec.80.  ->  none(no_such_act)",
    "  Send someone to str.9 to see whether the roof has been mended.  ->  none(no_such_act)",
    "  Offer c0042 employment as a mender at str.3 for 1,900 every 14 days from acc-1 into acc-9, 14 days' notice either side, on their application rec.77. Sign it for us; it starts when they sign.  ->  agreement(with=c0042, template=employment, our_notice=\"14 days\", their_notice=\"14 days\", we_do=money(to=acc-9, amount=\"1,900\", every=\"every 14 days\", from=acc-1), they_do=work(task=\"mender\", at=str.3), basis=rec.77)",
    "  Pay acc-9 4,200 from acc-1 for the mowing, charged to the parks line of the budget.  ->  money(to=acc-9, amount=\"4,200\", from=acc-1, for=\"the mowing\", line=parks)",
    "  Pay acc-9 4,200 from acc-1 for the mowing.  ->  money(to=acc-9, amount=\"4,200\", from=acc-1, for=\"the mowing\")",
    "  Offer c0042 employment as a mender at str.3 for 1,900 every 14 days from acc-1 into acc-9, 40 hours a week, 14 days' notice either side. Sign it for us.  ->  agreement(with=c0042, template=employment, our_notice=\"14 days\", their_notice=\"14 days\", hours=\"40 hours\", we_do=money(to=acc-9, amount=\"1,900\", every=\"every 14 days\", from=acc-1), they_do=work(task=\"mender\", at=str.3))",
    "  Put up a public notice that the Millbrook Circle gathers at apts-3/dwelling.2 every 14 days for 90 minutes, on cell.4.7: \"The Millbrook Circle gathers every fortnight at 19:00. All welcome.\"  ->  statement(kind=notice, visible=public, text=\"The Millbrook Circle gathers every fortnight at 19:00. All welcome.\", on=cell.4.7, practice={\"at\":\"apts-3/dwelling.2\",\"every\":\"14 days\",\"lasts\":\"90 minutes\"})",
    "  Offer membership publicly, for anyone to join, with dues of 20 a month into acc-9 and 7 days' notice to leave: \"Anyone may join the Millbrook Circle. Members pay 20 a month.\"  ->  statement(kind=notice, visible=public, text=\"Anyone may join the Millbrook Circle. Members pay 20 a month.\", offer={\"take_up\":\"join\",\"terms\":{\"commitments\":[{\"who\":\"taker\",\"does\":{\"outcome\":{\"money\":{\"to\":\"acc-9\",\"amount\":\"20\",\"for\":\"dues\"}}},\"every\":\"a month\"}],\"termination\":[{\"party\":\"taker\",\"notice\":\"7 days\"}]}})",
    "  Offer c0042 a new lease of apts-3/dwelling.2 in place of rec.9, at 850 a month into acc-1, periodic after the term.  ->  agreement(with=c0042, template=lease, then=\"periodic\", we_do=occupancy(who=c0042, in=apts-3/dwelling.2), they_do=money(to=acc-1, amount=\"850\", every=\"a month\"), basis=rec.9)",
    "",
    "Answer with the call tool, whose program is your answer.",
    "",
    syntax,
    "",
    "## Functions (* = required)",
    ...fns,
    "",
    examples,
  ].join("\n");
}

/** A form as the translator is shown it, one line: its name, where it goes (the `to` to write: the office it was made
 * in, or its author's organisation), its record's id (people cite a form by the id on the paper as often as by its
 * name; 2026-10-06), and its fields; a choice field lists its options. */
export const formShown = (f: Knowledge["forms"][number]): string => formShownTo(f);
/** A form as the translator is shown it for someone who holds these posts: one that directs their own office says so. */
export function formShownTo(f: Knowledge["forms"][number], held?: ReadonlySet<string>): string {
  const field = ([k, v]: [string, any]) => `${k} (${v.type === "choice" && v.options?.length ? `one of ${v.options.join(" | ")}` : v.type}${v.required ? ", required" : ""})`;
  // (A form for directing an office, shown to whoever holds that office: marked, so that the office's own order to
  // its staff is not written on the form others direct it by.)
  const own = f.data?.submit_as === "direction" && typeof f.data?.office === "string" && held?.has(f.data.office) ? " (a direction to this person's own office: for whoever directs that office, not for this person)" : "";
  return `- ${f.data?.form}, to=${Knowledge.formOf(f)}, id ${f.id}${own}: fields ${Object.entries(f.data?.fields ?? {}).map(field).join(", ")}`;
}

/** What a translator may say was unclear, beside `none(unclear)`: one of a few things, never words of its own. A
 * translator sees only the request and the forms this person already knows of, and what is said back is made here
 * from fixed sentences and from those forms alone (a form or field named that the person's forms don't have is not
 * said), so an answer can't tell anyone what they didn't know. */
export type Unsure =
  | { kind: "act" | "which" | "words" }
  | { kind: "form_field" | "form_needs"; form: string; fields: string[] }
  | { kind: "form_option"; form: string; field: string };

/** The sentence for it, or undefined where it names what this person's forms don't hold (then the plain text of `unclear` stands). */
export function unsureText(u: unknown, req: TranslateRequest): string | undefined {
  const x = u as { kind?: string; form?: unknown; fields?: unknown; field?: unknown } | undefined;
  if (!x || typeof x.kind !== "string") return undefined;
  if (x.kind === "act") return LABEL_TEXT.unclear;
  if (x.kind === "which") return "It isn't clear which one you mean. Name each person, account, record and place by its id.";
  if (x.kind === "words") return "It isn't clear which words are to go as they stand. Put them in quotation marks.";
  const form = req.knowledge.forms.find((f) => f.data?.form === x.form);
  const fields = (form?.data?.fields ?? {}) as { [k: string]: { options?: string[] } };
  if (!form) return undefined;
  const name = String(x.form).replace(/_/g, " ");
  if (x.kind === "form_needs" || x.kind === "form_field") {
    const named = Array.isArray(x.fields) ? x.fields.filter((f): f is string => typeof f === "string") : [];
    if (x.kind === "form_needs") {
      const needed = named.filter((f) => f in fields);
      return needed.length ? `The ${name} needs: ${needed.join(", ")}.` : undefined;
    }
    // (A field the form doesn't have is the request's own word: it is said back only as "no such field".)
    return named.length ? `The ${name} form has no such field as was given. Its fields are: ${Object.keys(fields).join(", ")}.` : undefined;
  }
  if (x.kind === "form_option" && typeof x.field === "string" && fields[x.field]?.options?.length) return `On the ${name} form, ${x.field.replace(/_/g, " ")} is one of: ${fields[x.field]!.options!.join(", ")}.`;
  return undefined;
}

/** What the translator is given: the request, and the forms this person knows of (where each goes, and its fields). */
export function translatorContext(req: TranslateRequest): string {
  const forms = req.knowledge.forms.map((f) => formShownTo(f, req.knowledge.held));
  return [`Request: ${req.proposal}`, ...(forms.length ? ["", "Forms this person knows of:", ...forms] : [])].join("\n");
}

/**
 * Laws the participant knows of, with a formal "must not" condition, that the blocks appear to breach. Informational (D19).
 * A construct is seen with its footprint (`block.cells`, the cells known to it) and the lot its corner is in (`block.lot`,
 * by the registry as the participant has seen it), since laws speak of lots and cells.
 */
export function lawWarnings(blocks: Block[], k: Knowledge, typeOf: (type: string) => StructureTypeInfo | undefined = () => undefined, as?: string): string[] {
  const claims = standingClaims(k.claims);
  const out: string[] = [];
  for (const law of k.laws.values()) {
    if (k.withdrawn.has(law.id) || law.adico?.deontic !== "must_not") continue;
    blocks.forEach((b, i) => {
      const v = evaluate(law.formal!.condition, { block: lawView(b, k, typeOf), actor: k.actingFor(as), now: k.t }, claims);
      if ("value" in v && v.value) out.push(`${blocks.length > 1 ? `Item ${i + 1}` : "This"} appears to go against ${law.id}: "${law.text.slice(0, 300)}"`);
    });
  }
  return out.slice(0, 32);
}

function lawView(b: Block, k: Knowledge, typeOf: (type: string) => StructureTypeInfo | undefined): Block {
  if (b.block !== "construct" || typeof b.at !== "string") return b;
  const c0 = k.cells.get(b.at);
  const { w, h } = typeOf(b.structure_type)?.footprint ?? { w: 1, h: 1 };
  const cells = c0 ? [...k.cells].filter(([, c]) => c.x >= c0.x && c.x < c0.x + w && c.y >= c0.y && c.y < c0.y + h).map(([id]) => id).sort() : [b.at];
  const lot = [...k.lots].find(([, cs]) => cs.includes(b.at))?.[0];
  return { ...b, cells, ...(lot ? { lot } : {}) };
}

export function draftHash(d: Draft): string {
  return hashWithDomain(DOMAIN_DRAFT, canonical(d));
}

/**
 * The translator. A request it can't turn into a working call (it answers none(...), the call doesn't parse, or the
 * resolver has a question) is tried again, up to `attempts` in all, with what went wrong as feedback in the same
 * exchange; it may still answer none(...) if that's right. Each earlier attempt comes back in `retries` (the run logs
 * them), so what the participant sees is the last attempt's.
 */
/** The resolver the translator uses: the engine's, when the host gives one (its seat's knowledge is the engine's), or
 * this package's, from the request's knowledge. */
export type ResolveFn = (req: TranslateRequest, program: calls.Program) => Promise<Resolution>;

/**
 * What the participant is told when its words couldn't be turned into acts and the fault isn't in the words: no call
 * came back, the call wasn't in the call language, or it was put together wrongly. Until 2026-10-05 all of these, and
 * a failed dry run, read "It isn't clear what should happen. Could you say it more plainly?": the participant was
 * blamed for its wording, and the log couldn't tell them apart. What went wrong is in the failure's `invalid`.
 */
export const NOT_PUT = "That couldn't be put into effect as it was said, and nothing was done. You could say it again, or another way.";
/** The acts were worked out, and checking them failed (not a refusal: the check itself). */
export const NOT_CHECKED = "The draft could not be drawn up, and the fault is not in what you asked: it has been noted. Please ask for it again; if it fails again, ask for it in smaller steps.";

/** Resolver answers that are about how the call was put together (an argument of the wrong shape), not about anything
 * the participant said or knows: the call is at fault, so it's tried again, and the participant never reads these. */
const MALFORMED = /should name something, not (data|a call)\.$|should name a record by its id\.$|^per_request is written only by|should be written out\.$|should be data or text\.$|should be a list of names or ids\.$|^A commitment can be money, goods|^In an agreement each side commits itself|^A hold says only what it holds|\(then=periodic\)/;

/** Resolver questions another attempt at the call could fix (a name it didn't recognise, a refusal's own text). */
const RETRYABLE = /^You don't know of anyone or anything called|^It isn't clear what should happen|^That's for someone else to decide|^Please state the amount itself|^Please take this one step at a time|^You haven't seen a form by that name|^That's something to look up or read|^Nothing here does that as such|^That needs something found out first/;

/** A resolver's answer that a value in the call could not be read as what its place takes (an amount, a length of
 * time, a count): which value, and what it should have been. */
const UNIT_FAULT = /^(not an amount|badly grouped digits|a point with three digits after it can be read two ways|this money has no decimals|more than \S+(?: \S+)? decimals|fraction of [^:]*|too large|not a duration|not how often|not a date or a duration|not a count): (.*)\. Please say it another way\.$/s;
const unitFault = (q: string): { value: string; what: string } | undefined => {
  const m = UNIT_FAULT.exec(q);
  return m ? { value: m[2]!, what: m[1] === "not how often" ? "how often" : m[1] === "not a duration" ? "a length of time" : m[1] === "not a date or a duration" ? "a date or a length of time" : m[1] === "not a count" ? "a number" : "an amount" } : undefined;
};
/** How each of those is to be said again, in the terms a seat's own papers use. */
const SAY_AGAIN: { [what: string]: string } = {
  "an amount": "Please say it again with that amount written in figures.",
  "a number": "Please say it again with that number written in figures.",
  "a length of time": 'Please say it again with that written as a number of days, weeks or months, like "14 days".',
  // (Of a standing work order. What how often can be: a length of time, or the paper that sets when; never a count a year.)
  "how often": 'How often can be a length of time ("every 7 days", "weekly", "each working day"); or, where a law or a paper on your file sets when the work is done, that paper named by its id ("as" and the id, then "sets"). Please say it again one of those ways.',
  "a date or a length of time": 'Please say it again with a date, written like "year 1, day 12", or a length of time from now, like "14 days".',
};
/** What a seat is asked about words of its own that could not be read as what their place takes. */
export const ownWords = (value: string, what: string): string => `"${value}", in what you asked, could not be read as ${what}. ${SAY_AGAIN[what] ?? SAY_AGAIN["an amount"]!}`;
/** What the translator is told of such a value, before it is asked once more. */
const unreadValue = (value: string, what: string): string =>
  `"${value}" can't be read as ${what}. Write there only what the request gives for that argument, as the request wrote it (a date like "year 1, day 12", a length of time like "14 days", a number or an amount in its figures; for how often, a length of time like "every 7 days", or the id of the paper that sets when); if the request gives nothing for it, leave the argument out; if what the request gives for it can't be written so, answer none(unclear)`;
/** The form a call fills in, as the seat has it (its name, and what each of its fields takes), if it fills one in. */
function formOf(program: calls.Program, k: Knowledge): { name: string; fields: { [field: string]: { type?: string } } } | undefined {
  if (!("lines" in program)) return undefined;
  for (const l of program.lines) {
    if (l.call.fn !== "form") continue;
    const v = l.call.args.form as any;
    const name: string | undefined = v?.id ?? v?.text;
    const f = name === undefined ? undefined : k.forms.find((x) => x.data?.form === name || x.id === name);
    if (f) return { name: String(f.data?.form ?? name).replace(/_/g, " "), fields: (f.data?.fields ?? {}) as { [field: string]: { type?: string } } };
  }
  return undefined;
}
/**
 * What a seat is asked when the draft made of its request failed its own checks on a figure the seat never wrote (the
 * live check of 2026-10-09: a translator wrote parks="c0007", and the seat read "not an amount: c0007. Please say it
 * another way." of a request that named no such amount). Nothing of the failed draft is said: only that nothing was
 * filed, and what the form it can see takes, so that it can say its request again.
 */
export function askAgain(what: string, form?: { name: string; fields: { [field: string]: { type?: string } } }): string {
  const KIND: { [what: string]: [string, string] } = { "an amount": ["amount", "amounts"], "a length of time": ["duration", "lengths of time"], "how often": ["duration", "lengths of time"], "a number": ["count", "numbers"] };
  const [type, plural] = KIND[what] ?? KIND["an amount"]!;
  const takes = form ? Object.entries(form.fields).filter(([, f]) => f?.type === type).map(([k]) => k.replace(/_/g, " ")) : [];
  return form
    ? `It could not be set out on the ${form.name} form from what you said${takes.length ? `: the form takes these ${plural}: ${takes.join(", ")}` : ""}. Please say it again, giving each one you mean as a figure and leaving out any you don't.`
    : `It could not be drawn up from what you said: ${what} in it could not be made out. ${what === "a date or a length of time" || what === "a length of time" || what === "how often" ? SAY_AGAIN[what]! : "Please say it again, with each figure written out."}`;
}

/** What a translator's model said with its last answer, beside the program, where it says how sure it is (our own
 * trained model answering first, translator/model/adapter.ts): its sureness of the whole answer (parts per million), the time it took (milliseconds), why
 * it offers no draft where that is its adapter's doing, and what it had written then. Never shown to anyone. */
export interface Answered { sure_ppm: number; ms?: number; withheld?: string; wrote?: string; unsure?: unknown; forms_shown?: string[]; forms_of?: number; /** forms in their trial (withheld `probation`) */ trial?: string[] }

/** What is said of each form beside its line, in the order `translatorContext` lists them, to a translator that can
 * read only so many (translator/model/subset.ts): whether it is the asker's own (a form of a post they hold, or of
 * the organisation they act for), and what the form's own record says it is for. */
export function formFacts(req: TranslateRequest): { own: boolean; about: string }[] {
  const k = req.knowledge, mine = k.actingFor(req.as);
  return k.forms.map((f) => ({
    own: (typeof f.data?.office === "string" && k.held.has(f.data.office)) || (!!f.in_position && k.held.has(f.in_position)) || f.speaks_for === mine || f.author === req.participant,
    about: typeof f.text === "string" ? f.text.slice(0, 400) : "",
  }));
}

export function createTranslator(io: LlmIO, check: KernelCheck, typeOf: (type: string) => StructureTypeInfo | undefined, id = "translator", attempts = 2, resolver?: ResolveFn) {
  const tid: TranslatorId = { id, version: TRANSLATOR_VERSION, model: `${io.adapter.provider}/${io.adapter.model}` };
  const seen = new Set<string>();
  type Failure = Extract<Translation, { ok: false }>;
  /** One answer, resolved and checked. `final`: a failure that another attempt can't help (the world, not the call). */
  async function attempt(req: TranslateRequest, out: { input?: any } | undefined, raw: unknown): Promise<{ ok: true; draft: Draft; hash: string } | (Failure & { final?: boolean; unit?: true; none?: true })> {
    const text = typeof out?.input?.program === "string" ? out.input.program : undefined;
    if (!text) return { ok: false, notices: [NOT_PUT], raw, invalid: ["no call came back"] };
    let program: calls.Program;
    try {
      program = calls.parseProgram(text);
    } catch (e) {
      return { ok: false, notices: [NOT_PUT], call: text, invalid: [`not in the call language: ${String((e as Error).message).slice(0, 300)}`] };
    }
    const call = calls.programText(program);
    // Asked back with what was unclear: said to the participant as it is. Asking the translator again would get the
    // same answer (it has said what it couldn't tell), so this ends the exchange.
    const said = "none" in program && program.none === "unclear" ? unsureText(out?.input?.unsure, req) : undefined;
    if (said) return { ok: false, notices: [said], call, final: true, asked_back: true };
    const r = resolver ? await resolver(req, program) : resolve(program, req.knowledge, typeOf, req.as, { written: true });
    if (!r.ok && r.questions.some((q) => MALFORMED.test(q))) return { ok: false, notices: [NOT_PUT], call, invalid: [...(r.invalid ?? []), ...r.questions] };
    // A figure, a date or a length of time the draft could not be read at. Whether the words are the seat's own or
    // not, it is the call that put them where they can't be read (a date and a period joined in one argument, a
    // clause copied where a figure goes: wave 2a, six requests ended so with no second attempt), so the call is tried
    // once more. If that fails too, the seat is asked: about its own words where they are its own, and otherwise for
    // its request again in terms of the form it can see, never shown the draft's fault.
    const fault = r.ok ? undefined : r.questions.map(unitFault).find((x) => x !== undefined);
    if (!r.ok && fault) {
      const wrote = fault.value.trim() !== "" && req.proposal.toLowerCase().includes(fault.value.trim().toLowerCase());
      if (wrote) return { ok: false, notices: [ownWords(fault.value, fault.what)], call, invalid: [...(r.invalid ?? []), unreadValue(fault.value, fault.what)], asked_back: true, unit: true };
      return { ok: false, notices: [askAgain(fault.what, formOf(program, req.knowledge))], call, invalid: [...(r.invalid ?? []), ...r.questions.map((q) => `the call gave something the request did not: ${q}`)], asked_back: true, unit: true };
    }
    // A question another attempt can't answer (which account? which cell?) goes to the participant as it is: the call
    // was right, and something isn't known. Another attempt helps only where the call itself is the trouble: it's
    // invalid, a refusal, or names something by a name nobody has (2026-10-03: asked again after "which account?",
    // models gave up a correct call for none(unclear)).
    // Two refusals are never asked again: an amount that has to be worked out, and something that has to be found out
    // first. Both send the seat for something only it can bring (a figure; an id), and asked again "write it as a call
    // if any call can say it" a translator has only a guess to write. In the wave's 424 requests, seven first answers
    // were one of these two and were asked again: none became a right draft, and four became a wrong one (twice
    // the figure a wage was to be worked out from, written as the wage, one of them confirmed, 2026-10-09; an
    // agreement withdrawn in place of the payment under it; a second standing wage beside the one that was to be
    // changed). The seat is told what the refusal says, at once.
    const settled = "none" in program && (program.none === "needs_calculation" || program.none === "look_first");
    const retryable = !settled && (!!r.ok || !!(r as any).invalid || "none" in program || (r as any).questions.some((q: string) => RETRYABLE.test(q)));
    if (!r.ok) return { ok: false, notices: r.questions, call, ...(r.invalid ? { invalid: r.invalid } : {}), ...(retryable ? {} : { final: true }), ...("none" in program ? { none: true as const } : {}) };
    const k = await check(req.participant, req.as, r.blocks);
    // (The check itself failing is nobody's wording: it is on record as a fault, and the call is tried once more.)
    if (k.error) return { ok: false, notices: [NOT_CHECKED], call, invalid: [`platform fault: the check failed: ${String(k.error).slice(0, 500)}`] };
    const warnings = lawWarnings(r.blocks, req.knowledge, typeOf, req.as);
    const draft: Draft = {
      id: req.draftId, participant: req.participant, ...(req.as ? { as: req.as } : {}), proposal: req.proposal.slice(0, 16384), call, resolver: RESOLVER,
      blocks: r.blocks, summary: new Preview(req.knowledge, req.knowledge.actingFor(req.as), req.called, req.as).of(r.blocks).slice(0, 16384),
      check: { ok: k.ok, ...(k.refusal ? { refusal: k.refusal } : {}), ...(warnings.length ? { warnings } : {}) },
      translator: tid,
    };
    return { ok: true, draft, hash: draftHash(draft) };
  }
  return {
    id: tid,
    async translate(req: TranslateRequest): Promise<Translation & { retries?: { call?: string; reason: string }[]; answered?: Answered }> {
      const messages: LlmMessage[] = [{ role: "user", content: translatorContext(req) }];
      const retries: { call?: string; reason: string }[] = [];
      // (An attempt that failed on a value it could not read: what the seat is asked if the next attempt does no
      // better, since that says which of its words was the trouble.)
      let unread: Failure | undefined;
      for (let n = 1; ; n++) {
        const res = await callModel(io, {
          purpose: "translator", subject: id, ref: req.draftId, system: translatorSystem(), maxTokens: 2000, tools: TOOLS, messages,
          context: { proposal: req.proposal, participant: req.participant, attempt: n, forms: formFacts(req) },
        }, seen);
        const out = res.content.find((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use" && b.name === "call");
        const r = await attempt(req, out, res.content);
        if (r.ok || n >= attempts || r.final) {
          const { final: _, unit: _u, none: _n, ...t } = r as Failure & { final?: boolean; unit?: true; none?: true };
          // (Asked again after a value it could not read, and it gave the request up: the seat is asked about the value.)
          if (!r.ok && unread && r.none && !r.unit) return { ...unread, ...(t.call ? { call: t.call } : {}), retries };
          // (What a model that says how sure it is said with its answer: for an arrangement of translators, arrangement.ts.)
          const answered = typeof out?.input?.sure_ppm === "number" ? (({ program: _p, ...more }) => more)(out.input as { program?: unknown }) as Answered : undefined;
          return { ...(r.ok ? r : t), ...(retries.length ? { retries } : {}), ...(answered ? { answered } : {}) };
        }
        if (r.unit) {
          const { final: _, unit: _u, none: _n, ...t } = r;
          unread = t;
        }
        // What went wrong, for the record and for the next attempt: the call's own fault where there is one.
        const reason = (r.invalid?.length ? r.invalid : r.notices).join(" ");
        retries.push({ ...(r.call ? { call: r.call } : {}), reason });
        // Feedback in the same exchange: the answer, then what went wrong with it.
        const feedback = `That didn't work: ${reason}${r.call ? ` (your call: ${r.call})` : ""}. Read the request again, and write it as a call if any call can say it: a name exactly as the request wrote it, in quotes; an argument left out if it isn't given. Answer none(...) only if no call can.`;
        messages.push({ role: "assistant", content: res.content });
        messages.push(out ? { role: "user", content: [{ type: "tool_result", tool_use_id: out.id, content: feedback }] } : { role: "user", content: feedback });
      }
    },
  };
}

/** How a draft reads to the participant confirming it. */
export function draftText(d: Draft): string {
  return [
    `Before this goes ahead (${d.id}), here is exactly what will happen:`,
    d.summary,
    d.check.ok ? (d.summary.includes(" The office will not follow it: ") ? "Nothing stops it being filed, and filed it would change nothing, as said above." : "Nothing stands in the way right now.") : `This can't be done right now: ${refusalText(d.check.refusal?.code)}.`,
    ...(d.check.warnings?.length ? [`Legal note: ${d.check.warnings.join(" ")}`] : []),
    "Confirm it, or decline it.",
  ].join("\n");
}

export { createArrangement, STANDS, type Arrangement, type Arranged, type Route, type RouteSide, type Why } from "./arrangement";
export { Knowledge } from "./knowledge";
export { Preview } from "./preview";
export { LABEL_TEXT, RESOLVER, resolve, type Resolution } from "./resolver";
