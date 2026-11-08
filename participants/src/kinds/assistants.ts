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
  { form: "report", title: "What became of a matter",
    fields: { referral: f("record", "The matter you were handed.", req), client: f("entity", "Whom you work for in it.", req), done: f("choice", "Whether it is done.", { required: true, options: ["yes", "no"] }), words: f("text", "What was done, or why not.") },
    writes: { kind: "report", text: "{words}", basis: "=referral", to: ["=client"], visible: ["=self", "=client"], data: { referral: "=referral", done: "=done", why: "=words" } } },
  { form: "scope_request", title: "A request for more scope or means",
    fields: { agreement: f("record", "The service you work under.", req), client: f("entity", "Whom you ask.", req), words: f("text", "What you ask for, and why.", req),
      kind: f("text", "A kind of matter you ask to be given, if any."), level: f("choice", "At what level, if any.", { options: ["advice", "draft", "approve", "alone"] }),
      access: f("text", "Access you ask for, if any."), answers: f("record", "What this answers, if anything.") },
    writes: { kind: "scope_request", text: "{words}", basis: "=answers", to: ["=client"], visible: ["=self", "=client"], data: { agreement: "=agreement", kind: "=kind", level: "=level", access: "=access" } } },
  { form: "handover", title: "A handover of what is open, at a service's end",
    fields: { agreement: f("record", "The service that is ending.", req), client: f("entity", "Whom you hand it to.", req), notes: f("text", "What is open, and how far each matter has got, as the agreement allows.") },
    writes: { kind: "handover", text: "{notes}", basis: "=agreement", to: ["=client"], visible: ["=self", "=client"], data: { agreement: "=agreement" } } },
];

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
      kind: f("choice", "The kind of paper, as the referral names it.", { required: true, options: [...kinds].sort() }), to: f("list", "Whom the paper goes to, as the referral has it.", req),
      words: f("text", "The paper's words, as they would stand.", req) },
    writes: { kind: "draft", text: "Draft for sign-off. {words}", basis: "=referral", to: ["=client"], visible: ["=self", "=client"], data: { referral: "=referral", paper: { kind: "=kind", to: ["=to"], text: "=words" } } } };
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
