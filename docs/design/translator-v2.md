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

## What changes for the translator, in outline

- Its closed set of outputs grows: beside a program or a refusal, a use of one of the other tools with its input.
- Two of today's refusals change meaning. A request to see or check something is `none(not_an_act)` today, because
  looking is the seat's own to do with another tool; in v2 it is a look. And `look_first` could become a look that is
  made for the participant and reported, with the act asked for again once it has the id. Neither is decided.
- It is shown what the participant could name: its reports, by id and title, and what is waiting for its yes or no.
- A turn may hold several things ("write to the works office, and I am done for three days"): it has to split a turn.
- `opt_out` must stay reachable in plain words by the simplest participant (VISION §15). That is a requirement, not
  a detail.

## Sequence

After v1 passes its mark on acts (at most 1% confidently wrong, at least 90% right). Not before: v1's failures are
on acts, and v2 adds to the job. The steps then are a design for the closed set, a reader for turns, and a pilot of
one simple model behind it.

## What is being banked now

A separate part of plain-text turns whose right reading is one of the seat's other tools, labelled with the tool and
its input exactly as `participant.ts` defines them (`translator/train/v2.ts`; made by `oikos translator-v2-data` and
`oikos translator-data-batch`, docs/translator-pipeline.md, "A wide part"). Two sources: what real seats did in the
pilots' logs, one use of a tool at a time (never a test-only pilot's, never an act: a seat's own request is the first
translator's data), put into plain words by a writer in several registers; and cases generated from the tools' own
shapes. A turn is kept only if it carries every id, number and word its reading holds, and a reader of another model,
shown the turn alone, writes the same reading back. It is in its own files (`v2-*.jsonl`) and in no v1 training set:
the model there is has no such outputs. Every v1 example is also a v2 case of an act (`do`, with the request as it
stands), so nothing of that kind is banked twice.

## Revisit if

- v1 passes its mark (then this note becomes a design);
- a simple model is wanted in a run before then (the cheaper step is a stand-in that maps a short list of plain
  phrases to tools, which is not this);
- the knowing work changes what a seat is shown (position 1 depends on it).
