// Everyday frictions, and how they are heard (docs/behaviour/frictions.md; docs/design/ai-citizens.md 10k step 2b).
//
// Things really go wrong: a home falls into disrepair and the repair asked for is not done; a bond is kept; pay comes
// short; a bill is wrong; a claim is wrongly refused; a road is left; a neighbour is loud; what was bought is faulty.
// Each is a mechanism where its cause lives (a building's age and its owner's upkeep, an employer's character and cash,
// an office's load), at a rate the world's profile gives with its source and the world's dial scales
// (`dials.friction_bps`; 0 or absent: none of it arises). Nothing here blocks or carries anything out: a friction leaves
// a state of the world or a paper; whoever suffers it puts up with it, asks, or goes to a venue that says it hears
// such things (an offer's `hears`); a venue decides by its own procedure, and its decision is words that the other
// side obeys or does not.
//
// This file is the shared part: the dial and the arithmetic of a rate, the papers a grievance travels on, and what an
// organisation does when it is asked to put something right, told of a complaint, or ordered to (`Respondent`).
// Arithmetic only; every draw is from a stream the module is handed.

import { DAY, usd } from "./common";
import { dateWords } from "../forms";
import { KIND } from "./decisions";

/** The papers a grievance travels on. A tribunal keeps its own forms (docs/behaviour/justice.md): an offer's `hears`
 * names the form an application to it is made on. */
export const PAPER = {
  /** To the other side: put this right. */
  request: KIND.request,
  /** Their answer. */
  answer: "remedy_answer",
  /** To a venue that hears the matter (unless its `hears` names another form). */
  application: "application",
  /** The venue to the one complained of: what is said, and by when to answer. */
  notice: "complaint_notice",
  /** Their answer to the venue. */
  response: "complaint_response",
  /** What the venue decided, to both. */
  decision: "venue_decision",
} as const;

/**
 * What a person who applies to a venue states about what they apply for, from their own record: the dispute (what it
 * is, against whom, about which paper or place), the sum if their record shows one, what they seek, and the dates (when it
 * arose, when they asked the other side and what came of it). A real application form asks for exactly this, and a
 * venue turns away one that says nothing (docs/behaviour/justice.md, "Particulars"). A sum is stated only where the
 * person's record has one: nothing is made up for them.
 */
export function particularsOf(g: { matter: string; party: string; since: number; about?: string; amount?: number; structure?: string; seeks?: string; asked?: { t: number }; answer?: string }, t: number): string {
  const words = g.matter.replace(/_/g, " ");
  const arose = g.since < 0 ? `${Math.ceil(-g.since / DAY)} days before the year began` : `on ${dateWords(g.since)}`;
  const asked = g.asked ? `we asked them ${g.asked.t < 0 ? `${Math.ceil(-g.asked.t / DAY)} days before the year began` : `on ${dateWords(g.asked.t)}`}${g.answer === "refused" ? " and they refused" : g.answer === "ignored" ? " and they have not answered" : g.answer === "granted" ? " and they agreed, but it is not done" : ""}` : "we have not yet asked them";
  return `${words} against ${g.party}${g.about ? `, about ${g.about}` : ""}${g.structure ? `, at ${g.structure}` : ""}${g.seeks ? `; what we seek: ${g.seeks.replace(/_/g, " ")}` : ""}${g.amount ? `; the sum: ${usd(g.amount)}` : ""}; it arose ${arose}; ${asked}; made on ${dateWords(t)}.`;
}
