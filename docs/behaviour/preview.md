# The preview: a draft read back to whoever asked for it

**Source:** `translator/src/preview.ts` (`Preview.of`), put before the seat by `draftText` (`translator/src/index.ts`).
Tests: `translator/test/preview-harms.test.ts` (the five kinds of harm below), `preview.test.ts` (nothing an act
carries is left out), `preview-reads.test.ts`, `first-falls.test.ts`, `payments.test.ts`,
`orchestrator/test/office-form-preview.test.ts`. Measurement: `scripts/preview-replay.ts`. Decision:
docs/decisions.md, "A draft's preview says each thing it does on a line of its own" (2026-10-11).

A participant says what it wants done in its own words; what comes back, before anything takes effect, is a draft:
the acts those words were turned into. The preview is that draft read back, and it is all that stands between a
wrong draft and the world. It is written by code from the draft's own acts and the participant's own papers. It is
not written by whoever turned the words into acts, it never reads the request, and it calls no model. Nothing in it
speaks for the platform: it is the participant's own draft, in the world's terms.

## How it is set out

```
This does one thing: a payment.
1. You will ask Millbrook Savings Bank (bank) to pay ¥327,166 from your account (acc-city) to acc-outside-social-insurance, once.
   - For, in words only: "withheld social insurance for wages paid from day 24 to day 58, with the worker-by-worker report: ..."
```

- **The first line says how many things the draft does and what kind each is**: "one thing: a payment"; "three
  things, in this order: two payments and a report". Each thing is numbered, one alone too. A draft that does one
  thing is seen to do one, by its shape; no sentence warns of what is missing, because the preview does not know
  what was asked.
- **Each act is one sentence of what happens**, and under it **one plain line for each further thing it carries**.
- **Nothing is said twice.** A payment request's own words ("Please pay ...") are left out where they are exactly
  what its figures say; a form's own summary of its fields is left out where the fields are listed; who sees a paper
  is said only where that is not simply whoever makes it and those it is addressed to.
- **Nothing an act carries is left out.** Whatever no line says follows as "Also: ...", by name
  (`preview.test.ts` changes every field of every kind of act and expects the preview to change).

## What each kind of act says

| Act | Its sentence | Its lines |
|---|---|---|
| A payment asked of whoever keeps the account | who is asked, how much, from which account, to which account and whose it is (where the participant has seen that account), "once" or how often, what it settles | `For, in words only: "..."` (a purpose is words on the payment: nothing is filed or reported by it); for a standing payment, when the first falls due as the keeper will count it; against an agreement it cites, whether it is the whole sum agreed or how much less or more; what it cites |
| A form filed (a proposal, an application, a direction) | the form, by name and id, and with whom it is filed | `Filled in: ...` each field as the form says it is (money, days, a date); `Left empty: ...` the form's other fields, by name; for a direction, whether the office will follow it and that it changes nothing by itself |
| A paper of the office's own, on its form | the kind of paper, the form, the paper's words | `Filled in`, `Left empty`; what it offers, in words; whom it goes to and why each, in the form's own words |
| An offer of an agreement | to whom, what kind, for how long, whether it is signed on the offerer's side | one line a side: `You would be bound to: ...`, `c0042 would be bound to: ...`, or `... would be bound to nothing: no act of theirs is set down.`; `Its terms, in words only: "..."` and `In words only, which bind nobody to an act that can be checked: ...` for a duty that is a sentence; who may end it on what notice; for employment with no place of work, where the advertisement it is made on puts it, or that it has none |
| A law or other paper published | its kind and its words | its details; for a law with no rule recorded, `Words only: no rule is recorded with it for acts to be checked against.`; its rule and the condition acts are checked against, where it has them |
| A withdrawal | the paper withdrawn | what that paper is, from the participant's own papers, and what stops with it; or that no such paper is among its own |
| A standing work order, a hold | as before (docs/behaviour/standing-work.md) | each sentence on its own line |
| A letter | to whom, about what, its words | `A letter only: it pays, files and orders nothing.` |
| Anything else | one sentence | whatever it does not say, as "Also: ..." |

## The five harms it was changed for

Seats confirmed 116 of 155 wrong drafts in the pilots read on 2026-10-10 (`runs/translator-wrong-acts-2026-10-10` on
the run server), against 94% of right ones. Each kind, as it read and as it reads:

1. **A payment whose separate report was asked for and not drafted** (15). It read as the payment said twice, the
   word "report" inside the purpose both times. It reads "This does one thing: a payment." and the purpose as
   `For, in words only`.
2. **The gross paid where a net was to be worked out** (2). The line added on 2026-10-09 stands, now on its own:
   "This is the whole of the pay agreed in rec.1225 (1.944,46 € every 14 days), with nothing withheld from it."
3. **A budget form without its staff amount** (1). It read the proposal's text twice. It reads `Left empty:
   environment, parks, roads, services, staff.`
4. **An employment agreement whose duty was free text or missing** (17). It read "you will pay ... Its terms:
   '...'". It reads "c0693 would be bound to nothing: no act of theirs is set down." and "Its terms, in words only".
5. **"Ask the bank to pay" drafted as a payment** (5), and its reverse, a payment asked for and drafted as a letter
   (wave 2c, three times). A payment says it is a payment; a letter says "A letter only: it pays, files and orders
   nothing."

## What it does not do

- **It does not compare the draft with the request, and does not guess what was meant.** It cannot say "the report
  you asked for is missing": it does not know one was asked for. It can only make one thing look like one thing.
- **It says nothing of the world beyond the draft's own acts and the participant's own papers** (docs/no-god-view.md).
  A payee, a paper or an account the participant has not been shown is named as written and no more; whose account
  it is, what an agreement has someone pay, what a form's fields are and what a paper to be withdrawn is are said
  only from what the participant has itself seen. It never says that something does or does not exist: of a paper
  it cannot place it says "No paper by that id is among your own papers as you have been shown them".
- **It is not long.** Over 120 drafts of the pilots (the replay's sample) it is 440 characters on average against
  446 before and a request of 260; a payment is shorter than it was by a third to a half, an agreement and an
  office paper somewhat longer (a line a side; the fields left empty).

## What the replay measured (2026-10-11)

`runs/preview-replay-2026-10-11` on the run server: 60 wrong and 60 right drafts of earlier pilots, each rendered from
the log (the seat's knowledge rebuilt from the observations recorded for it) with the preview as it was and as it is,
and read by a seat model shown the seat's own request and reason and the draft, as at a sitting. Wrong drafts
confirmed, of 60: 54 before and 53 after (Sonnet 5.5), 53 and 54 (Haiku 5.5 at low effort); right drafts declined, of
60: 3 and 4, 8 and 6. The decisions entry has the table. In short: **the new preview does not, by itself, make a seat
model decline a wrong draft.**
The lines are read (a form's "Left empty" turned two budget forms back; "a letter only" is quoted in the seats'
notes), but a seat that asked for a payment with a report and is shown "one thing: a payment" confirms it, because
the payment is right. What a seat does with a draft that is right as far as it goes is the seat's instruction's to
say, not the preview's: with one sentence there ("What you confirm is all that is done. Anything you asked for that
the draft does not list among the things it does is not done: decline, or confirm and ask for the rest.") the same
models confirm 41 and 48 of the 60 and name the missing report in 12 and 10 of 15, at the cost of about twice as many
right drafts declined. That sentence is proposed, not in the code.

## Left out

- Whether what is drafted is what was asked. That is the participant's to judge, and the readers' in the data
  pipeline.
- A paper's standing in the world (whether a ballot is still open, whether a payee exists): only the dry run's
  "Nothing stands in the way right now" or its refusal, which `draftText` puts under the preview.
- What a letter, a direction or an agreement will lead to. Each says what it is; none says what others will do.
