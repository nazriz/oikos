# `firm.newspaper` (v0.1.0): the local paper

**Source:** `participants/src/behaviour/news.ts`. The editor's position at the paper (a firm, `paper`), run by code
here; a person or a model could hold it. Design: docs/design/world-expansion.md §3.2.

People don't read the public record; most hear of it, if at all, through the paper and each other. The paper chooses
what to run and how to tell it, and that choice is where information can be shaped.

| | Rule | Source |
|---|---|---|
| **What's news** | New public records of some kinds, each with a weight: an election's result (4); a petition, an election notice (3); an environment report, a budget, a law, a nomination (2); a complaint, a permit decision (1). | Placeholder weights, after news values (Galtung and Ruge 1965) |
| **Tone** | Whether an item reflects badly on the town's government (−1), well (+1), or neither (0). A petition or a complaint is −1. An environment report is −1 if a species fell by 20% or more, else 0. | Placeholders |
| **Leaning** | `leaning_bps`, from −10,000 (against the government) to +10,000 (for it). It weights the items that reflect on the government up or down, and, where tone is a matter of judgement (0), with a chance of half its strength, decides it. The generator gives none. | Media slant (Gentzkow and Shapiro 2010) |
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
