# `firm.newspaper` (v0.2.0): the local paper

**Source:** `participants/src/behaviour/news.ts`. The editor's position at the paper (a firm, `paper`), run by code
here; a person or a model could hold it. Design: docs/design/world-expansion.md §3.2.

People don't read the public record; most hear of it, if at all, through the paper and each other. The paper chooses
what to run and how to tell it, and that choice is where information can be shaped.

| | Rule | Source |
|---|---|---|
| **What's news** | New public records of some kinds, each with a weight: an election's result (4); a petition, an election notice (3); an environment report, a budget, a law, a nomination (2); a complaint, a permit decision (1). | Placeholder weights, after news values (Galtung and Ruge 1965) |
| **Tone** (0.2.0) | Whether an item reflects badly on the town's government (−1), well (+1), or neither (0), **by what the record shows, one rule for every kind**. A petition is residents pressing the town and a complaint a service not delivered: −1. The answer to a petition that puts it to the council is the town delivering: +1; one that only says what the law already is, 0. A permit granted is a request met (+1), one refused a request turned down (−1). An environment report is −1 if a species fell by `change_bps` (20%) or more and none rose as much, +1 if one rose as much and none fell, else 0. The process (budget, law, ballot result, election notice, nomination) is 0. | Placeholders after news values: Harcup and O'Neill (2001, 2017) list "bad news" and "good news" both |
| **Leaning** | `leaning_bps`, from −10,000 (against the government) to +10,000 (for it). It weights the items that reflect on the government up or down, so it changes what is chosen and in what order (slant by selection). **It no longer decides the tone of a neutral item with a chance of half its strength** (0.2.0: a draw of that kind is a coin flip with no cause). The generator gives none. | Media slant (Gentzkow and Shapiro 2010) |
| **Negativity** (0.2.0) | `negativity_bps`: a premium for a story that reflects badly on the town over one of equal weight that does not. Nought unless the profile sources it: the direction is known, the size for a local paper is not. | Soroka and McAdams (2015); Trussler and Soroka (2014) **(to confirm)** |
| **An edition** | Every `every_days` (7), the `items_per_edition` (5) highest-scoring items new since the last, each a public `news` statement put forward to be believed (an `assertion` about the town), with its kind, tone and edition number. No edition in a week with nothing new. | — |

Readers: a share of citizens (the profile's `news_readers_bps`, 40%) read each item about the government, and it moves
their approval of the town by its tone (docs/behaviour/citizen.md, "Elections"). They read what is published in the
paper's name (the world tells them which entity is the paper: `paper`), and nobody else's statement of kind `news`; and
they take a tone within the paper's range, -1 to 1 (citizen 0.35.6: before, any `news` statement was read, whoever
published it and whatever tone it claimed, so one item from anyone could set a reader's approval to either end). A reader
knows the paper by the name an item is published in, as every reader of records does: nothing stops someone publishing
in the paper's name (a forged masthead), and a citizen has no way to see who holds the paper's posts.

**In the small town** the public record is thin: an edition about every month (6 in the first 205 days), mostly
budgets, laws, nominations and the election.

## Leaves out (for now)

- Reporting: interviewing people, investigating, getting things wrong, corrections.
- Sales and advertising: the paper has no income and pays no one (its editor is unpaid).
- Other media: radio, social media, word of mouth about what the paper said.
- More than one paper, or competition between them.

## Why 0.2.0 (risk register PC-7, A-3)

The paper printed only bad news for the government: a petition and a complaint were always −1, an environment report −1 on a fall and never +1 on a recovery, and no kind of item could be good news. So every approval and election measure drifted against incumbents whatever they did, and a steward who answered petitions was not credited for it. A local paper reports what the record shows, and whether that reads well or badly for the government is what the record shows. The tone is now decided by the record's content; what the paper runs is the item's news value; and the paper's own tilt (its leaning, its premium for bad news) acts on selection, not on the facts. What the print shows is now a result of what the town did. Not built: the framing a paper gives a neutral item in its words (a want of the paper's own, not a draw); other kinds of record a town makes (a petition answered with a refusal, a complaint answered).
