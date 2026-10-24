// What a decision waits for, and how it is looked at again (docs/design/foundations.md, law 5, step F8; docs/behaviour/decisions.md).
//
// Review and appeal of a decision are routes the law states, as data, for any kind of decision: the world publishes a law
// (`data.decisions`, a list of rules, each for a kind of decision and, where it differs by payment, for some payments only) saying
//
//   - `needs`: what the decision waits for before it is made: papers from the claimant, a confirmation from the claimant's last
//     employer; within how many days; and what comes of it when they do not come (`else`: refuse, or decide on what is on hand);
//   - `review`: that the office whose decision it was will look at it again if asked within so many days, on what grounds, and
//     whether an appeal may be made only after that;
//   - `appeal`: the matter a venue that can set the decision aside hears, within how many days of the decision (or the review's
//     answer), on what grounds, and what applying costs;
//   - `refused_by`: who may refuse, where the office is a head and staff (the staff's procedure says it).
//
// Nothing here makes a decision wait or come out differently by itself. The office writes the request for papers (an act that takes
// its performer's time), the claimant answers when they do (theirs), the employer answers from its own books (its staff's time);
// the office decides at its next round when what it waited for has come or its time has run, and a review is the office doing the
// deciding again on the facts then on file, as work with its time. The kernel knows none of this: these are statements.


/** The papers this runs on. A request to look at a decision again is the one request of every grievance (docs/behaviour/frictions.md). */
export const KIND = {
  /** To whoever did it or put it wrong: look at this again / put this right. */
  request: "review_request",
  /** Their answer, to the one who asked. */
  answer: "remedy_answer",
  /** The office's record that it looked at one of its decisions again: what was found. */
  review: "decision_review",
  /** The office to a claimant: send these papers, by this day. */
  evidence_request: "evidence_request",
  /** The claimant to the office: the papers. */
  evidence: "evidence",
  /** The office to an organisation: confirm this about a person, by this day. */
  confirmation_request: "confirmation_request",
  /** The organisation's answer, from its own books. */
  confirmation: "confirmation_answer",
} as const;

export interface Need {
  id: string;
  /** From whom: the claimant (their papers), or the claimant's last employer (found from the pay reports on the office's file). */
  from: "claimant" | "employer";
  /** In words: what is asked for. */
  what: string;
  /** Within so many days of the asking. */
  within_days: number;
  /** When it has not come in time: refuse the claim, or decide on what is on hand. */
  else: "refuse" | "decide";
}
export interface ReviewRoute {
  /** Asked within so many days of the decision. */
  within_days: number;
  /** On what grounds, in words. */
  grounds: string;
  /** An appeal lies only after a review has been asked for and answered. */
  required?: boolean;
  /** Where the law says so: a review asked for and not answered within so many days of the asking is taken as refused (a deemed
   * refusal), and the appeal's days run from then. None: silence is only silence. */
  deemed_refused_days?: number;
}
export interface AppealRoute {
  /** The matter a venue that can set the decision aside says it hears. */
  matter: string;
  /** Within so many days of the decision, or of the review's answer where a review is required. */
  within_days: number;
  grounds: string;
  /** What applying costs, in the smallest unit of the money (none: nothing). */
  fee?: number;
}
export interface DecisionLaw {
  /** The kind of decision: the kind of statement the office makes. */
  kind: string;
  name: string;
  /** For these payments only (a support payment's id); none: for every decision of the kind. */
  payments?: string[];
  needs?: Need[];
  review?: ReviewRoute;
  appeal?: AppealRoute;
  /** Who may refuse where the office is a head and staff: the head alone (`office-holder`), or the staff as well. */
  refused_by?: "office-holder" | "staff";
}

