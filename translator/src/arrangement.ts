// Two translators as one (docs/real-models.md, "Our own translator first"; docs/decisions.md, 2026-10-11).
//
// The owner's decision of 2026-10-11: the trained translator is used at its present quality. It translates first; when
// it fails, the prompt-driven translator behind it takes that request. An interim arrangement for pilots: one model
// that works alone remains the goal, and nothing here changes what a translator is. To whoever asks there is one
// translator, in the world's terms: nothing a seat is shown or told says which model drafted, or that there are two.
//
//   then     The first answers. Its draft is offered, and a refusal it is sure of that is in `stands` is said as it
//            is. The request goes to the one behind when
//              - the first offers no draft: it is unsure (under its cut-off), its draft fails the form check, its
//                answer is no program of the call language, the resolver cannot make acts of it, the check of it
//                failed, it refuses with a label that does not stand, or it did not answer at all;
//              - the seat declined a draft of the first's and asks again (its next request); or asks again, in much
//                the same words, for something the first answered and that has not ended in a confirmed draft. Such
//                a matter stays behind until the seat confirms a draft or asks for something else.
//   beside   The first's answer is only recorded. The one behind answers every request: for measuring a model
//            without it touching the world.
//
// Whenever the one behind answers, its answer is what the seat gets, whatever it is. If it cannot be reached or is at
// a usage limit, that is the run's to deal with as it deals with any translator's (the error passes through): the
// first is never a silent substitute. The first is always asked, also where the request is going behind anyway: its
// answer costs nothing and is the record of what it would have done.
//
// Every request's `route` says who drafted, why it went behind, what each answered (the first's sureness, time and why
// it offered no draft), and, where both answered, whether they agree by meaning. The run writes it to the log.

import { ModelCallFailed } from "@oikos/participants/llm";
import { sameButForFreeText, sameMeaning } from "../train/meaning";
import { Knowledge } from "./knowledge";
import { NOT_CHECKED, type Answered, type Translation, type TranslateRequest, type TranslatorId } from "./index";

export type Arrangement = "then" | "beside";

/** The first's refusals that stand, where it is sure of them (at or over its cut-off): the seat is told, and the one
 * behind is not asked. Only `not_an_act`: on the 180 real requests the trained model (pod-small-r2-s1) said it 58
 * times and was right 56 (and 3 of 3 on seats' own requests in the set tests), and it is a third of what seats ask.
 * No other label is both frequent and reliable there: `look_first` right 6 of 11, `no_such_act` 13 of 15, `unclear`
 * 0 of 3, `needs_calculation` 0 of 2, `too_much` 4 of 4 (too few to rest on). Wrong refusals are the model's largest
 * kind of error, so every other refusal goes behind. A pilot's report counts, by label, how often the two agreed
 * where both answered: that is what would move a label into this list (docs/decisions.md, 2026-10-11). */
export const STANDS: readonly string[] = ["not_an_act"];

/** Why a request went to the one behind. */
export type Why =
  | "beside" // the arrangement: the one behind answers everything
  | "unsure" // the first was under its cut-off
  | "form_check" // the first's draft is not one of the forms shown, as shown
  | "no_program" // the first's answer is no program of the call language (or the request is longer than it reads)
  | "forms_subset" // the first was shown fewer forms than the asker knows of: its draft is recorded, never offered
  | "form_unseen" // the first's draft fills a form outside its training: recorded, never offered
  | "type_unreleased" // the first reads forms by name, and its draft has a function or a kind of field it is not released for: recorded, never offered
  | "probation" // the first's draft fills a form it was not taught and that is still in its trial: recorded, never offered
  | "form_not_shown" // the request names a form the first was not shown (more forms than its reader takes: translator/model/subset.ts)
  | "refused" // the first refused, sure of it, with a label that does not stand
  | "not_resolved" // acts could not be made of the first's call (the resolver asked, or the call was put together wrongly)
  | "check_failed" // the check of the first's acts failed
  | "first_failed" // the first did not answer
  | "declined_before" // the seat declined a draft of the first's, and this is its next request
  | "asked_again"; // the seat asks again, in much the same words, for what was answered and not confirmed

/** What one of the two answered for a request. */
export interface RouteSide {
  model: string;
  /** `draft`: a draft was drawn up. `refusal`: none(label), and `label`. `asked_back`: it asked for the request again.
   * `question`: the resolver had a question about its call. `failed`: no usable answer (or none at all). */
  result: "draft" | "refusal" | "asked_back" | "question" | "failed";
  call?: string;
  label?: string;
  /** Its draft's hash (a draft not offered is nowhere else in the log). */
  draft_hash?: string;
  /** The first's own: how sure it was of its whole answer (parts per million: a log holds whole numbers), the time it
   * took (milliseconds), why its adapter offered no draft, and what it had written then. */
  sure_ppm?: number;
  ms?: number;
  withheld?: string;
  wrote?: string;
  /** Where the first was shown only some of the forms the asker knows of (more than its reader takes): which, by
   * their records' ids, and of how many. Absent where it was shown them all. */
  forms_shown?: string[];
  forms_of?: number;
  /** Forms of the first's draft still in their trial, where that is why it went behind. */
  trial?: string[];
  /** Attempts beyond its first (the prompt-driven translator is asked again with what went wrong). */
  retries?: number;
  error?: string;
}

export interface Route {
  arrangement: Arrangement;
  /** Whose answer the seat got. */
  used: "first" | "behind";
  /** Why it went behind, where it did. */
  why?: Why;
  first: RouteSide;
  behind?: RouteSide;
  /** Where both answered: whether they agree. Two drafts agree if their calls mean the same with copied free text left
   * out of the comparison (the real requests' scorer's rule), `agree_text` if they also agree in it; two refusals, if
   * they give the same label; anything else is no agreement. */
  agree?: boolean;
  agree_text?: boolean;
}

type Translated = Translation & { retries?: { call?: string; reason: string }[]; answered?: Answered };
export type Arranged = Translated & { route: Route };

interface One { id: TranslatorId; translate(req: TranslateRequest): Promise<Translated> }

const LABEL = /^none\((\w+)\)$/;
const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._\/-]*/gu) ?? []);
/** Whether two requests are in much the same words: half or more of the words of the two together are in both. */
export function muchTheSame(a: string, b: string): boolean {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both) >= 0.5;
}

function sideOf(id: TranslatorId, r: Translated | undefined, error?: string): RouteSide {
  if (!r) return { model: id.model, result: "failed", ...(error ? { error: error.slice(0, 500) } : {}) };
  const a = r.answered;
  const more = { ...(a ? { sure_ppm: a.sure_ppm, ...(a.ms !== undefined ? { ms: a.ms } : {}), ...(a.withheld ? { withheld: a.withheld } : {}), ...(a.wrote !== undefined ? { wrote: a.wrote } : {}), ...(a.forms_shown ? { forms_shown: a.forms_shown, forms_of: a.forms_of } : {}), ...(a.trial?.length ? { trial: a.trial } : {}) } : {}), ...(r.retries?.length ? { retries: r.retries.length } : {}) };
  if (r.ok) return { model: id.model, result: "draft", call: r.draft.call, draft_hash: r.hash, ...more };
  const label = LABEL.exec(r.call ?? "")?.[1];
  const result = r.asked_back ? "asked_back" : label ? "refusal" : r.call && !r.invalid?.length && r.notices[0] !== NOT_CHECKED ? "question" : "failed";
  return { model: id.model, result, ...(r.call ? { call: r.call } : {}), ...(label ? { label } : {}), ...more };
}

/** Why the first's failure sends the request behind; undefined where its refusal stands. */
function noDraft(r: Extract<Translated, { ok: false }>, stands: readonly string[]): Why | undefined {
  const withheld = r.answered?.withheld;
  if (withheld === "cut_off") return "unsure";
  if (withheld === "form_check") return "form_check";
  if (withheld === "form_not_shown") return "form_not_shown";
  if (withheld === "forms_subset" || withheld === "form_unseen" || withheld === "type_unreleased" || withheld === "probation") return withheld;
  if (withheld) return "no_program";
  const label = LABEL.exec(r.call ?? "")?.[1];
  // (An asking back that is not a refusal's own: a value of the call that could not be read. The call's fault.)
  if (label) return !r.asked_back && stands.includes(label) ? undefined : "refused";
  if (r.notices[0] === NOT_CHECKED) return "check_failed";
  if (!r.call) return "no_program";
  return r.invalid?.some((x) => x.startsWith("not in the call language")) ? "no_program" : "not_resolved";
}

/**
 * The two as one translator. `first` should be made to answer once (an answer asked again of a model that decides
 * without sampling is the same answer). `id` is the first's under `then` and the one behind's under `beside`: whose
 * drafts the world gets when nothing sends a request elsewhere. A draft carries the id of whoever drew it up.
 */
export function createArrangement(first: One, behind: One, o: { arrangement: Arrangement; stands?: readonly string[]; /** Told each seat-confirmed request on a form in its trial, and whether the first's draft agreed (adapter.ts `probationOutcome`). */ probation?: { probationOutcome(form: string, agree: boolean): void } }) {
  const stands = o.stands ?? STANDS;
  /** By seat (a participant in a capacity): its last request that was answered and has not ended in a confirmed
   * draft, where that should send its next behind. `declined`: it declined the draft; else it was refused or asked. */
  const open = new Map<string, { proposal: string; declined: boolean }>();
  /** Drafts offered and not yet answered: whose, for what, and whether the request had gone behind for an open matter. */
  const offered = new Map<string, { who: string; proposal: string; by: "first" | "behind"; continued: boolean; trial?: { forms: string[]; agree: boolean } }>();
  const seat = (participant: string, as?: string) => `${participant}|${as ?? ""}`;
  const agreement = (req: TranslateRequest, first: RouteSide, b: RouteSide): { agree: boolean; agree_text?: boolean } => {
    // (A draft of the first's that was recorded and not offered is still compared, as under `beside`: what it wrote.)
    const a: RouteSide = (first.withheld === "forms_subset" || first.withheld === "form_unseen" || first.withheld === "type_unreleased" || first.withheld === "probation") && first.wrote ? { ...first, result: "draft", call: first.wrote } : first;
    if (a.result === "draft" && b.result === "draft") {
      const forms = req.knowledge.forms.map((f) => ({ form: String(f.data?.form), to: Knowledge.formOf(f), id: f.id, fields: (f.data?.fields ?? {}) as { [name: string]: { type: string } } }));
      const ctx = { currency: req.knowledge.currency, forms };
      try {
        const text = sameMeaning(a.call!, b.call!, ctx);
        return { agree: text || sameButForFreeText(a.call!, b.call!, ctx), agree_text: text };
      } catch {
        return { agree: a.call === b.call };
      }
    }
    return { agree: a.result === "refusal" && b.result === "refusal" && a.label === b.label };
  };
  return {
    id: o.arrangement === "beside" ? behind.id : first.id,
    arrangement: o.arrangement,
    first: first.id,
    behind: behind.id,
    stands,
    async translate(req: TranslateRequest): Promise<Arranged> {
      const who = seat(req.participant, req.as);
      // (Read before anything is awaited: a seat's requests are routed in the order it made them.)
      const before = open.get(who);
      let f: Translated | undefined, failed: string | undefined;
      try {
        f = await first.translate(req);
      } catch (e) {
        // (Its model did not answer: the call's failure is on record, and the request goes behind. Anything else, a
        // limit or a fault of the run's own, is the run's.)
        if (!(e instanceof ModelCallFailed)) throw e;
        failed = e.message;
      }
      const mine = sideOf(first.id, f, failed);
      const again = before && (before.declined || muchTheSame(before.proposal, req.proposal));
      const why: Why | undefined = o.arrangement === "beside" ? "beside"
        : again ? (before!.declined ? "declined_before" : "asked_again")
        : !f ? "first_failed"
        : f.ok ? undefined
        : noDraft(f, stands);
      if (!why) {
        const r = f!;
        // A draft of the first's: what the seat answers decides (`signed`). A refusal that stood: asked again in much
        // the same words, it goes behind.
        if (r.ok) offered.set(r.draft.id, { who, proposal: req.proposal, by: "first", continued: false });
        else open.set(who, { proposal: req.proposal, declined: false });
        return { ...r, route: { arrangement: o.arrangement, used: "first", first: mine } };
      }
      const b = await behind.translate(req);
      const theirs = sideOf(behind.id, b);
      // (Under `beside` nothing is kept of what was declined or refused: everything goes behind as it is.)
      if (o.arrangement === "then") {
        if (b.ok) {
          offered.set(b.draft.id, { who, proposal: req.proposal, by: "behind", continued: !!again });
          // (A matter that went behind stays behind while it is asked for in much the same words.)
          if (again) open.set(who, { proposal: req.proposal, declined: false });
        } else if (again || b.asked_back || theirs.result === "refusal") open.set(who, { proposal: req.proposal, declined: false });
      }
      const { answered: _, ...rest } = b;
      const agreed: { agree?: boolean; agree_text?: boolean } = mine.result !== "failed" || mine.call ? agreement(req, mine, theirs) : {};
      // (A form in its trial: what the seat answers to the draft behind decides whether ours agreed on a confirmed request.)
      if (o.arrangement === "then" && b.ok && why === "probation" && mine.trial?.length) offered.get(b.draft.id)!.trial = { forms: mine.trial, agree: !!agreed.agree };
      return { ...rest, route: { arrangement: o.arrangement, used: "behind", why, first: mine, behind: theirs, ...agreed } };
    },
    /** A seat's answer to a draft: confirmed, its matter is through; declined, its next request goes behind where the
     * draft was the first's (or the matter was behind already). */
    signed(draftId: string, decision: "accept" | "reject"): void {
      const d = offered.get(draftId);
      if (!d) return;
      offered.delete(draftId);
      if (decision === "accept") {
        open.delete(d.who);
        for (const f of d.trial?.forms ?? []) o.probation?.probationOutcome(f, d.trial!.agree);
      }
      else if (d.by === "first" || d.continued) open.set(d.who, { proposal: d.proposal, declined: true });
    },
  };
}
