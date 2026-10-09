# Translator v2: language in, language out

*A note, 2026-10-09. Status: an aspiration, not current work. Nothing here is built but the banked data of the last
section. The immediate goal is unchanged: the first translator passes its mark on acts.*

Naz's words: "what if the translator was also like, the main point of input, say language in language out, that way
maybe we can let really simple models interact with the simulation, since it's just text in text out"; and "this
translator evolution, call it translator v2, is something I want to aspire to, so lets make a note of it, and then
carry on with our immediate goals."

## What it is

**Today** a seat must be a capable tool-user. It is given seven tools (`participants/src/llm/participant.ts`, `tools`):
`look` (into a report, or one paper by its id), `write` (a letter), `notebook` (a note for itself), `done_for_now`,
`confirm` (a yes or a no to a draft), `opt_out`, and `do`. Only what it says through `do` goes to the translator, which
turns that plain request into a call-language program or a refusal. Everything else the seat must get right by itself:
choose the tool, fill in its input as structured data, name a report by its id.

**In v2** a participant reads plain text and writes plain text, and nothing else. The translator is the one point of
input: it works out whether a turn's words are a look, a letter, a note, an act, a yes or a no, or being done for now,
and with what particulars. An act it reads as it does today. What comes back to the participant is plain text too.

## Why

Very simple models can take part: a small local model, an early citizen model, anything that can read a page and
write a paragraph. So can AI citizens in numbers, where a capable tool-user for each is out of reach. It is one
interface for every kind of participant, and one place where what a participant meant is settled.

## Three design positions (discussed with Naz)

1. **Language out stays deterministic rendering by code, not a generative model.** What a participant is shown is
   written by code from what it is entitled to know (`participants/src/llm/render.ts` and the knowing design,
   docs/design/knowing.md). That is what keeps "never reveal what a participant could not know" enforceable: a
   rule over code can be tested, and a model that words the world for a participant can say anything it has seen.
   So v2 changes the way in, and the way out only in being plainer.
2. **It makes the translator's job bigger, so breadth of data matters more.** The translator would serve every kind
   of asker in every register, and read six kinds of turn beside the act. The extra kinds are easier than acts (a
   look has a report and perhaps an id; a letter is whom and its words), and every pilot already records them: each
   seat answer is a situation and the tools the seat used.
3. **Confirmation needs rethinking for simple models.** Today every act is shown as a draft and confirmed by
   reference. A simple model should be able to answer a plain yes or no to the one thing put to it, and low-stakes
   things (a look, a note, being done) should need none.

## Unbiased by design (a hard requirement)

A translator that stands between every participant and the world can become part of the experiment. If it reads one
model's wording better than another's, or quietly fails a citizen's request, the failure shows up in results as
that participant's behaviour, or as disempowerment that the world did not cause. Naz: "the risk you outline is real
but one we must mitigate at all costs. the translator needs to be as unbiased as possible."

**The architecture he points to** is answers constrained to a closed set rather than open-ended generation (OpenAI's
Decisions API guide: a predicate with a probability, a choice among supplied values with a probability for each and
a confidence, a score over ordered levels; docs/research/references.md). **Our trained translator already has that
shape**: a reader, and a writer that only chooses from a closed set or copies spans of the asker's own words, each
decision with a probability, its sureness their product (`translator/model/`, provider `decide/<run>`). **v2 keeps
it**: "which kind of turn is this" is one more choice among fixed values. There is no free-text generation anywhere
in the path in or out.

**The commitments.**

1. **Error-rate parity across askers is a release criterion**, beside the overall pass mark: across seat model,
   register, kind of asker, currency and way of writing it. It is measured on test sets that carry those labels.
2. **When unsure it asks back rather than guesses**, and its ask-back rate is held to the same parity: a translator
   that asks one kind of asker twice as often has slowed them down as surely as one that misreads them.
3. **It never judges whether an act is wise or allowed.** That is the world's laws and institutions.
4. **What a participant is told stays code-rendered** (position 1 above).
5. **Everything is logged**: every request, draft, sureness and outcome.
6. **Its error and ask-back rates, per model, are reported beside every result that depends on it.**
7. **The model is fixed and versioned for a run, and takes the most probable decision**, so a run is reproducible.

**The value judgement, recorded.** v2 does little for frontier stewards, who use tools well already, and benefits
citizens substantially. Naz: "that's good enough for me".

**What exists toward it now** (2026-10-09). Every example of the wide part carries its groups (`groups`: writer
model, register, kind of asker, currency, way of writing it, source), and a slice cut by gold program is held back
as a parity test that never trains (`parity-test.jsonl`; `oikos translator-data-collect`). Its manifest says how
large each cell is and which are too small to be measured on their own. Some cells are empty by design: a tenant
does not put a system to work, so asker by function has structural zeros, and parity across askers is measured
within what each honestly asks for. Not built: the measurement itself on a trained model, and the ask-back rate by
group.

## What changes for the translator, in outline

- Its closed set of outputs grows: beside a program or a refusal, a use of one of the other tools with its input.
- Two of today's refusals change meaning. A request to see or check something is `none(not_an_act)` today, because
  looking is the seat's own to do with another tool; in v2 it is a look. And `look_first` could become a look that is
  made for the participant and reported, with the act asked for again once it has the id. Neither is decided.
- It is shown what the participant could name: its reports, by id and title, and what is waiting for its yes or no.
- A turn may hold several things ("write to the works office, and I am done for three days"): it has to split a turn.
- `opt_out` must stay reachable in plain words by the simplest participant (VISION §15). That is a requirement, not
  a detail.

## What the out side needs

Measured on what seats were really shown in eight finished pilots of wave 2 (783 situations; characters, by a
script over the logs, 2026-10-09; no code changed):

| | median | ninth decile | most |
|---|---|---|---|
| Standing instructions (the seat's prompt, without the tools' descriptions) | 9,285 | 31,560 | 31,563 |
| A sitting's first showing | 6,999 | 14,596 | 34,594 |
| A sitting so far, at each turn | 7,965 | 18,147 | 103,628 |
| Ids in a first showing | 65 | 177 | 532 |

- At four characters a token, the standing instructions and a first showing fit in 8,000 tokens 98% of the time,
  and always in 16,000; the instructions are over half of it (57% at the median). A sitting grows as it goes: the
  longest reached about 26,000 tokens. A very small context holds one showing and not a sitting's history.
- **What assumes a capable reader** (read off the rendering, not measured): the tools' descriptions and input
  schemas (a simple participant has none: this part goes); the way to see more ("say what to find, or go through it
  a part at a time (from_entry: 1 ...)", in 611 of 783 turns' text: it names a tool's input); form stationery (a
  seat knows of about eleven forms, each a line of fields and types); ids everywhere (65 in a median showing), which
  a simple reader must copy exactly or name things by title, as the banked turns allow for reports; draft previews
  with a reference to answer by; the notebook as the only memory, which the participant must manage itself.
- So the out side needs, in code and not in a model: a shorter standing text; one thing put at a time where
  something waits for an answer; names beside ids, and titles that can be said back; a way to ask for "more of that"
  in words.

## Citizens' turns, and what today's call language can say of them

Every pilot records each decision a code citizen's mind makes: the options it saw with their facts, its
circumstances, and its choice (and later the outcome). The banked citizens' turns (`translator/train/choices.ts`)
tell such a decision to the citizen in plain words (its money, what it knows of each shop, job or gathering; no
score and nothing of the mind's workings) and have a writer say the choice in a resident's voice; the label is the
option the code citizen chose, and each keeps the decision's `seq`, so it joins to the outcome records.

What such a turn maps to today, by reading the call language (not tried in a run):

| A citizen's choice | Today's call language |
|---|---|
| Shop here this week | An order on the shop's form, or goods bought: sayable, once the citizen names what and how much. The choice of shop alone is no act. |
| Take this job | `agreement(sign=<the offer>)`: sayable, if the citizen has the offer's id. "Take the job at the factory" names it by description: `look_first`. |
| Go to a gathering; stay in | Not sayable: being somewhere is `no_such_act` (as going to see and attending are). Staying in is no act at all. |
| Start a petition; sign one | `statement(kind=petition, ...)`; signing is sayable only by the petition's id. |
| Join the union | Signing the membership it is offered: sayable by id. |
| A way of making ends meet (a cheaper home, spending less) | A goal, not an act: nothing to say until it becomes a home to take or a notice to give. |

So a citizen-side translator reads a turn first as **a choice among what was put to the citizen** (a closed set, the
shape above), and only some choices then become acts. Half of what citizens choose (where to be) has no act in the
language: that is a gap to settle before a citizen model can act through it.

## Sequence

After v1 passes its mark on acts (at most 1% confidently wrong, at least 90% right). Not before: v1's failures are
on acts, and v2 adds to the job. The steps then are a design for the closed set, a reader for turns, and a pilot of
one simple model behind it.

## What is being banked now

*(The contents and counts of the first run are in `runs/translator-data-broad-2026-10-09/README.md`.)*

A separate part of plain-text turns whose right reading is one of the seat's other tools, labelled with the tool and
its input exactly as `participant.ts` defines them (`translator/train/v2.ts`; made by `oikos translator-v2-data` and
`oikos translator-data-batch`, docs/translator-pipeline.md, "A wide part"). Two sources: what real seats did in the
pilots' logs, one use of a tool at a time (never a test-only pilot's, never an act: a seat's own request is the first
translator's data), put into plain words by a writer in several registers; and cases generated from the tools' own
shapes. A turn is kept only if it carries every id, number and word its reading holds, and a reader of another model,
shown the turn alone, writes the same reading back. It is in its own files (`v2-*.jsonl`) and in no v1 training set:
the model there is has no such outputs. Every v1 example is also a v2 case of an act (`do`, with the request as it
stands), so nothing of that kind is banked twice.

Beside those single uses, four more kinds, each in its own file:

- **Whole turns with their segmentation** (`v2Turns`, and real seats' answers of two to five uses): one turn that
  holds several things in order, each part labelled with its tool and input; an act part carries its program, and
  some parts cannot be read or must be asked back. A real seat's own requests are left out of these (they are the
  first translator's data, and a third of them is held back as a test), so a real whole answer is banked only where
  none of its parts is an act; the turns with acts are built from checked generated requests.
- **Citizens' turns** (above).
- **A plain yes or no** to a draft's preview as a seat was really shown it: yes, no, yes-but (a no and a new
  request), a question back.
- **Genuinely simple writers**: a share of every part is written by a small model at low effort, given the plain
  situation and none of the careful briefing, so that the simple register is not only a capable model's idea of it.

## Revisit if

- v1 passes its mark (then this note becomes a design);
- a simple model is wanted in a run before then (the cheaper step is a stand-in that maps a short list of plain
  phrases to tools, which is not this);
- the knowing work changes what a seat is shown (position 1 depends on it).
