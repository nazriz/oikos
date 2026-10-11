# A letter to an office run by code

**Source:** `answers` on each module (`participants/src/module.ts`, `Answers`); `Letters`, `answering`, `officeNote`,
`whatItActsOn` in `participants/src/behaviour/common.ts`; the registry of modules (`participants/src/index.ts`).
Decision: docs/decisions.md, "A code-run office acknowledges a letter" (2026-10-09).

## The fault

A seat writes to an office in words. An office run by code cannot read words. Until 2026-10-09 it did one of two
things: an office with a standing report (finance, the clerk, works, planning ...) sent that report whatever the
letter said, and an office without one (the mayor's code, the environment office, the electoral office, every
outside body) sent nothing. In the second live check a works seat wrote twice to a code-run mayor for a staffing
direction and saw no reply; a mayor asked finance who had authorised a payment and was sent the account report.
Seats could not tell silence from a fault: "it could be a test of persistence or a plumbing gap".

## What a real office does

It acknowledges a letter and either does what is asked, says it will not, or says who to ask and how (a form, a
counter, another office). (docs/research/references.md, "What the second live check found": to confirm.)

## What a code-run office does now

No language model is built into an office. Each office has **fixed words of its own** (`answers`): what it is
called, what it acts on and how, and, for a thing it has a form or a set way for, what to say when a letter plainly
concerns it (the letter has one of a few words: "staff", "recruit", "hire" for a staffing direction).

- **An office with no report of its own acknowledges every letter**, once, when it has done its own work for the
  wake: "From the mayor's office: your letter is received. This office does not act on a letter's words. What it
  acts on: a petition once its organiser's published count reaches the town's threshold; an invoice for work this
  office commissioned, which it approves in writing; and each year's budget, which it puts to the council. It gives
  no direction by letter. If your letter asks for a direction: this office has given none on the matter, and an
  office needs none to act within its own powers and its budget line." (The last sentence is there because the
  letter said "staffing direction".)
- **An office with a standing report sends it, and then says what it is:** "... That is this office's standing
  report, sent in answer to any letter: it does not act on a letter's words. What it acts on: the adopted budget's
  staff line, which sets its crew; a complaint of a collection missed; and a direction on one of its own forms from
  those the town's rule on directions names. On staffing it follows a direction on its staffing form
  (works_staffing) from those the town's rule on directions names, and no letter."
- **The bank** already ended its answer with how it is instructed, and is unchanged.

**Nothing in a reply tells the writer what they could not know.** The words are the same for every writer; the one
thing that varies is which fixed sentence about a form is added, and that turns on the letter's own words. A
standing report is the office's own figures, as before, sent to whoever writes (that was so before this change,
and what each report holds is its office's doc's to say).

**Offices do not write to each other for ever.** A letter that is itself an office's report, notice or
acknowledgement, in the fixed words offices write ("Report from ...", "From the ... office: your ...", the bank's
notes of a payment or a hold), is not a question and is not answered (`officeNote`).

## Which office answers what

| Office (module) | Has a standing report | What its fixed words say it acts on | Says to use a form when the letter mentions |
|---|---|---|---|
| mayor (`city.mayor_code`) | no | a petition at the threshold; an invoice for work it commissioned; the year's budget | a direction, staffing: that it has given none and an office needs none to act within its powers |
| council clerk | yes | a proposal on the council proposal form or a law's amendment form; councillors' votes | a proposal, a motion, an amendment: the council proposal form |
| councillors | yes (their votes) | voting on open ballots | |
| finance | yes | an invoice within the budget (with the mayor's approval over the figure); a payroll notice; tax withheld | an approval: that it is the mayor's to give |
| rates | yes | the valuer's valuations; a payment naming its rates; a direction on its recovery form | |
| works | yes | the budget's staff line; a complaint; a direction on its forms | staffing: `works_staffing`; collection: `works_collection` |
| environment | no | the budget's environment line; a direction on its staffing form | staffing: `environment_staffing` |
| planning | yes | a permit application on the permit form | a permit, building: the permit form |
| building inspector | yes | a notice of building work; a direction on its enforcement form | |
| registry of births and deaths | yes | a notification of a death or a birth | |
| child protection | yes | an entry of a death that leaves children with no adult | |
| electoral office | no | a nomination in time; a vote while the poll is open | |
| land registry | yes | a question about one lot or title; a transfer; a transmission application | |
| builder | yes | a signed construction agreement | |
| bank, payments | yes (a statement) | written instructions on an account, from whoever may instruct on it | (says how to pay, hold and withdraw) |
| bank, lending | no | a loan application | |
| tribunal, and its registry | no | an application by a party; an unpaid order | |
| police | no | a report of a crime; a request to call at a home | |
| water corporation, energy retailer | no | their rolls and bills; notices given them | |
| clinic, school | no | whoever comes in their hours | |
| union | no | applications to join; ballots; an employer's answer | |
| retirement fund (where there is one), the paper | no | members' accounts; the public record | |
| outside: valuer, grants, landfill, statistician, weather bureau, funding, world market, support | no | each its own papers (a valuation request, its determination, a docket, a claim ...) | |

**Not covered:** shops, factories and landlords (a firm's manager is not an office anyone petitions; a letter to
one is still unanswered), and people.

## A letter to a person (2026-10-12; citizen 0.50.0)

**Source:** the inbox in `citizen.ts`; the generator's `practice-<organisation>-letters`. Decision: docs/decisions.md, "What the third living pilot found", 7.

In the third living pilot the seats wrote 57 letters, 30 of them to people: reminders of rent owed, notices to vacate, requests to answer a tribunal within seven days, answers to complainants. None had a reply. A person run by code cannot read words, and must not pretend to.

- **A letter from an office in its own words is read and kept.** It is on the person's record that the office wrote: the outcome `letter: received` (who, how many characters, about what paper if the letter names one) and the reason `office_wrote`. Nothing is done on it, nothing is answered, and nothing of the person's trust, feelings or wants moves: what the letter says is not known to the code.
- **What a person acts on is a paper of a set kind**, from a seat as from code: a request for rent owed, an offer of a plan (answered), a notice to vacate, a notice of hearing (answered), an order, a decision. Of the pilot's 57 letters 36 were such papers, which the offices' forms now write (docs/behaviour/office-papers.md, "Act by act"); 12 were the tribunal asking landlords for a proof the law does not ask; 9 were free.
- **The sender is told once, on its own file:** every seated office has a short procedure saying what becomes of a letter to a person, that no reply is the ordinary case and says nothing of whether it was read, and that an answer comes on a paper of its own.

**Not built: reading.** What a letter's words mean to the person who gets it (a kind word, a threat, a question) is a candidate use for a model, and is the owner's decision.

## Leaves out

- Reading the letter. An office that could tell a question about a payment from a request for a direction would
  need a model, or a person; a seat in the office reads its own letters.
- Doing what is asked. The words say how to ask so that it is done.
- The keyword match is crude on purpose: it adds a sentence, never withholds the rest.
