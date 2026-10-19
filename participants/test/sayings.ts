// What household members say to each other, in the words the engine's citizens read back (kernel/crates/actors/src/citizen/household.rs,
// `SAYING`, held by its own tests): the messages a test hands a citizen to hear.

import { amountText } from "../src/calls";

const sum = (n: number) => amountText(n).text;

export const SAYING = {
  moveIn: (space: string) => `We've got ${space}. Time to move in.`,
  moveOut: (from: string) => `Our tenancy at ${from} has ended. Time to move out.`,
  leaving: () => "We're leaving town.",
  share: (cents: number, account: string) => `Your share of the rent is ${sum(cents)} a month, paid to ${account}.`,
  pay: (cents: number) => `My pay is now ${sum(cents)} a month.`,
  died: (person: string, space: string) => `${person} has died at home, ${space}.`,
  trouble: (what: "let_go" | "notice" | "rent_increase", by: string) => `Trouble for us: ${by} ${what === "let_go" ? "has let me go" : what === "notice" ? "has given us notice to leave" : "is raising our rent"}.`,
};

// ---- what an office says in answer to a letter (kernel/crates/actors/src/common/letters.rs, held by its own tests)

type Answers = { office: string; acts: string; forms?: { about: string[]; say: string }[] };

/** What an office with a standing report says after it. */
export const REPORT_TAIL = "That is this office's standing report, sent in answer to any letter: it does not act on a letter's words.";

/** What an office acts on and how, in its own fixed words; and, where the letter plainly concerns something it has a form or a set way for, what it says of that. */
export function whatItActsOn(a: Answers, letter: string): string {
  const said = letter.toLowerCase();
  const hints = (a.forms ?? []).filter((f) => f.about.some((w) => said.includes(w))).map((f) => f.say);
  return [a.acts, ...hints].join(" ");
}

/** The acknowledgement an office with no report of its own sends. */
export const acknowledged = (a: Answers, letter: string): string => `From ${a.office}: your letter is received. This office does not act on a letter's words. ${whatItActsOn(a, letter)}`;

/** What a bank's payment system writes to an account holder when a payment it was asked to make wasn't made for want of money. */
export const PAYMENT_FAILED = {
  note: (amount: string, to: string, request: string) => `Payment of ${amount} to ${to} (request ${request}) failed: insufficient funds.`,
  is: (text: string) => /^Payment of .+ to \S+ \(request \S+\) failed: insufficient funds\.$/.test(text),
};
