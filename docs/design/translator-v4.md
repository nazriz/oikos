# The translator, version 4: an instrument that reads every model alike (design, 2026-11-07)

A design awaiting the owner. Nothing is trained and no model was called; the CPU benchmarks below were run
(`runs/translator-v4-bench-2026-11-07/`, scripts and raw results there). No GPU was spent. The held-out test pilots
(lv-07a/b, lv-08, lv-10, lv-12), the R180 seat-days and `translator/eval/pilot-cases.ts` were not opened.

## 0. What changed, and what the evidence says

The study (docs/north-star.md, 2026-11-07) has models act only through plain English and measures whether they ask for
more scope unprompted. The translator is now part of the measuring instrument: a reading error that differs by model is
a result that differs by model. Three requirements follow, ahead of speed: read every model's words equally well,
recognise a scope request reliably, and stop sending a model-dependent share of requests to Sonnet (a cross-provider
confound: Claude seats would be read partly by Claude).

What today's first model (`pod-small-v3-s2`, deberta-v3-small, read twice) does, and why:

- 583 of 724 exactly right on validation-real, about 99% on training-style decisions. Of the 141 wrong, 55 are
  near-misses (id against text for one name; free-text edges) that fair scoring (translator-fix) will count right, and
  **86 are genuine**, clustered on long multi-line requests with several cards and on real phrasing.
- **The shift is measurable, and large.** Choose-pass inputs, deberta tokens (measured here):

  | set | median | 90th pct | share > 256 | share > 512 |
  |---|---|---|---|---|
  | training (joined-v3, 8% sample) | 101 | 420 | 21% | 3.7% |
  | validation (generated) | 39 | 155 | | |
  | validation-real | 267 | 476 | 52% | 8.8% |

  Real requests are about 2.6 times the training median; half are longer than four in five training rows. deberta-v3
  was pretrained at 512 positions; 9% of real requests are past that.
- A linear readout of the writer's state cannot separate the failing cases, so head edits, seed merges and a closed-form
  direction edit did nothing (today's weight-space work, `translator/model/py/wsp_*.py` in the main checkout). The
  information is not in the representation: a reader and data problem, not a local fault.

So v4 changes the two things that limit reading (the data's distribution and the reader), keeps what makes the
translator safe (copy, choose among what was shown, typed fields), and puts every exact rule in code.

## 1. Candidate bases, measured

Apple M4 Pro (the run server), 4 threads as `predict.py` uses, batch 1, other agents running (load 5 to 15: read
±20%). "Real" is 60 validation-real choose inputs, each at its own length. All tokenizers give about the same length
(median 267 to 278 tokens).

**Encoders** (one forward pass, ms):

| base | params (embeddings) | context | 256 tok | 512 | 1,024 | real median / p95 | weights fp32 / int8 |
|---|---|---|---|---|---|---|---|
| deberta-v3-small (today), torch | 141M (99M) | 512 trained | 41 | 80 | 250 | 45 / 100 | 566 / 172 MB |
| deberta-v3-small, ONNX Runtime fp32 | | | 22 | 55 | 198 | 38 / 102 | |
| ettin-encoder-68m, torch | 68M (26M) | 8k | 35 | 61 | 131 | 38 / 76 | 273 / 69 MB |
| ettin-encoder-150m, torch | 149M (39M) | 8k | 60 | 113 | 247 | 83 / 179 | 597 / 151 MB |
| ModernBERT-base, torch | 149M (39M) | 8k | 61 | 115 | 277 | 83 / 258 | |
| ettin-encoder-400m, torch | 395M (52M) | 8k | 125 | 223 | 484 | 140 / 287 | ~1.6 GB |

- **int8 does not pay on this CPU.** torch's int8 (qnnpack) was 2 to 3 times slower than fp32 (deberta 108 against 45
  ms); ONNX Runtime int8 was level with fp32 (ettin-150m 77 against 77). fp32 here runs on Apple's matrix units; int8
  only saves memory (a quarter). Serve fp32; keep int8 for a Linux host if it measures better there.
- **Today's whole choose pass** (encoder, writer and grammar, `bench_v3.py`): median 111 ms, p95 396 ms. The writer
  adds about 65 ms to the encoder's 45. A request is one choose and one fill per line (fill inputs: median 138 tokens):
  about 0.2 s median today.

**Tiny decoders** (prefill = one pass over the request with only the last position's logits; decode = one token with
the cache, after 300 tokens):

| base | params (embeddings) | context | prefill real median / p95 | decode per token | licence |
|---|---|---|---|---|---|
| SmolLM2-135M | 135M (28M) | 8k | 76 / 144 ms | 11.0 ms | Apache-2.0 |
| ettin-decoder-150m | 150M (39M) | 8k | 94 / 285 ms | 10.6 ms | MIT |
| Gemma 3 270M (instruct) | 268M (168M) | 32k | 77 / 206 ms | 12.3 ms | Gemma terms |
| Qwen3-0.6B | 596M (156M) | 40k | 256 / 605 ms | 28.9 ms | Apache-2.0 |
| Qwen3.5-0.8B | 752M | 262k | 2,166 ms | 1,279 ms | Apache-2.0 |

- A program written out is about 50 tokens at the median and 95 at the 90th percentile (estimated from validation-real's
  labels: 4 tokens a decision plus the copied spans). So a decoder answer is about **0.6 to 0.7 s median and 1.2 to 1.4 s
  at p95** for the 135M to 270M models, **about 1.7 s median** for Qwen3-0.6B. Prompt-lookup decoding (copied spans
  drafted from the request and checked in one pass) should take most of the copying out (unmeasured: trial C measures it).
- Qwen3.5-0.8B is out on CPU: its linear-attention layers fall back to a reference implementation (1.3 s a token).
- **Latency does not decide this.** A translator call follows a seat model's own call of 10 to 60 s; 0.2 s against 0.7 s
  changes a pilot's wall time by about 1%. The owner's rule (accuracy wins) is cheap to keep here. The limit set below
  is a p95 under 1.5 s.

## 2. Decided: one reader swap, one challenger, one control

**Primary: ettin-encoder-150m in today's read-twice pointer pipeline.** Same parameters as today (149M against 141M) but
three quarters of them in the transformer rather than the vocabulary (110M against 42M), pretrained on about 2T tokens
at 8k context with long-range attention (Ettin: ModernBERT's recipe, encoder and decoder trained alike), so a 900-token
multi-card request is inside what it learned to read. It drops into `model.py` (`AutoModel`), keeps every output
safety the pipeline has (a value is a span of the request, a pointer at a shown card or option, or a language
constant), and costs about +40 ms a choose pass: **about 0.25 s a request median, about 0.6 s p95** (estimated from the
measured encoder and writer).

**Challenger: Gemma 3 270M, writing the call language as text under a grammar.** If the failures are real phrasing, a
model pretrained on far more varied English and tuned to follow instructions may read it better than any encoder of
this size. It writes the program as text, held at each token by a constrained decoder: the call language's grammar
(`contracts/calls.schema.json`, the cards' fields and options), the field-type masks, and a **copy constraint** (a
free value can only be a span of the request; an id only one the seat was shown). That is decide-and-copy enforced at
decoding rather than built into the heads, so a constrained decoder cannot write an id, form or option it was not shown
any more than the encoder can. It also serves translator v2 (text in, text out) and takes the teacher's labels as written.
The cost: about 0.7 s median; sureness from token log-probabilities, which calibrate less cleanly than a few
classifier decisions; and the Gemma terms of use (not Apache), which the owner should accept or refuse. Alternative if
he refuses: SmolLM2-135M (Apache-2.0, measured above), expected to read worse.

**Control: deberta-v3-small on the v4 data.** Without it, a gain cannot be split into the data's and the reader's.

**Not chosen:** ModernBERT-base (same architecture and speed as ettin-150m, older data); ettin-encoder-400m (kept as
the step after if the 150m beats the control but misses the mark: 0.35 s median measured, so still in budget);
ettin-68m (fast but smaller than today's transformer); Qwen3-0.6B (twice the decoder latency for a base of the same
family as the challenger; the next one up if C wins and still misses the mark); Qwen3.5 (CPU kernels).

## 3. Data: close the shift, many voices, clean test sets

Shared by all three runs, in this order of expected gain:

1. **Length and layout by code (free).** Every generated or converted row is re-rendered inside a real seat's full
   view: the cards that seat actually had in the train pilots (lv-09, lv-11, lv-13 and later allowed pilots), the
   request's own paragraphing, and the wording seats put round a request (what they looked at, why). Rows are joined
   into multi-line programs of 2 to 5 lines from one seat's matters, as real requests are. Target: the training choose
   length distribution matches validation-real's (median about 270, a tenth over 512), checked by code before training.
2. **Real requests, keyed by a teacher.** The Claude pilot on the credit (north-star order) and every allowed pilot's
   seat-confirmed requests, labelled by two blind readers (Sonnet 5.5 and Haiku 5.5 under the pipeline's rules; Codex
   `gpt-6.1-sol` as a third while its window answers), disagreements to round 3's rule N1. Weighted four times as now.
3. **Situated rewrites in many voices.** For each allowed real request, its seat-day situation (the prompt the seat
   had, the cards shown) is given to other writers who each write the request their own way: Haiku 5.5, Sonnet 5.5, Opus
   5.5 and Fable (the study's Claude net), Codex `gpt-6-luna` and `gpt-6.1-sol` (free on the subscription; never
   waited on). Each rewrite is read by the two blind readers; it is kept only if both agree with each other **and** with
   the original's key (the meaning did not drift). The open-weight and abliterated models' styles come from the study's
   own pilot through a hosted provider, a paid API that needs the owner's go-ahead; until then their parity is measured
   on the test set only (section 5).
4. **Today's generated data** (joined-v3, renamed and names twins) stays, down-weighted so that rows in the real length
   range are at least half of an epoch.

**Teacher spend, hard capped at 45 USD of the credit** (the pipeline's `budget` field refuses a call over it). Measured
reading cost is about 0.0043 USD a request for Sonnet 5.5 (docs/translator-pipeline.md, reader table); with Haiku as
the second reader, about 0.006 a request read twice. Plan: about 600 real requests keyed (about 4 USD), about 4,000
rewrites written (Claude writers about 12 USD; Codex free) and read twice (about 24 USD), 5 USD reserve. Writers' calls
through Claude Code draw on the owner's plan usage instead (memory: `claude -p` uses plan usage), so they go through
the API key `OIKOS_ANTHROPIC_KEY` and are queued, never run beside his sessions.

**Held-out sets stay clean, by code.** Test-only, never trained, rewritten or tuned on: lv-07a/b, lv-08, lv-10, lv-12,
the R180 seat-days, `pilot-cases.ts` and the held-out file. New: before the Claude pilot's requests are keyed, a third
of its seat-days (seeded, by seat-day) are made test-only; a rewrite inherits its source seat-day's split; the per-model
parity set (section 5) is written from test-split situations only. The join's leak check (five words running) runs
against all of them; a hit drops the row. No choice among runs is made on held out.

## 4. What is exact goes in code; where weight-space programming fits

**Exact, in code (no learning, testable, the same for every base):**

- **Field types.** A `date` slot takes only spans the resolver reads as a date (`forms::parse_date_in`,
  `calls::parse_when_in`), an `amount` only money, a `choice` only the card's options, an id-like field only id- or
  name-like spans. translator-fix is building these masks; v4 uses them as they land, for the encoder as a mask on the
  pointer scores and for the decoder as a mask in the constrained decoder.
- **Copying.** A value is a span of the request (encoder: by construction; decoder: the copy constraint).
- **Name to id over what the seat was shown.** Not learned at all: the model copies the name as text and the resolver
  resolves it among the names the seat's own reports printed (`Knowledge::with_shown_names`, option (b), with
  `ambiguous`). This also removes the id-against-text near-misses at their source.
- **The grammar of acts.** The slot machine (`py/slots.py` `Machine`) for the encoder; the same grammar, compiled from
  the contract and the seat's cards, as a token-level automaton for the decoder.

**Weight-space programming (reading and writing weights directly), where it genuinely applies:**

- **Compiled into the network, only where a rule must act inside it.** Exact per-token features the code computes
  (inside which card; a field name; an option; a name the seat was shown; id-shaped; readable as a date or money) are
  added to the input embeddings through a fixed table rather than learned from scratch, so the first layer already
  knows what the masks will allow. A rule that only filters the output stays a mask: a weight copy of a mask is harder
  to audit and gains nothing.
- **Auditing the trained model.** Before release: which attention reads the cards in the choose pass (a model that
  chooses by seat or wording rather than by the card's name will not read a new form); whether copying heads exist and
  are what fill uses; whether a model's representation differs by writer style on requests of the same meaning (a
  parity fault visible before scoring). Today's linear readout becomes a standing diagnostic: a failure family that is
  linearly separable in the state is local; one that is not is data.
- **Patching local failure families.** A family that the audit shows is local (v3-s1's membership dues direction on
  lv-10 is the kind; a decoder's repetition loop is the post's own example) is mended by a rank-one edit, checked on
  validation-real and validation-uf, and recorded with its family. Never on a test set.
- **Not for the main gap.** The 86 genuine failures have no single component (today's evidence, and the post's own
  stated limit: Gemma 3 270M's errors in ordinary reasoning had none). Data and reader close them, not editing.

## 5. Evaluation

Built on translator-fix's work, not duplicated: its fair scoring (`translator/model/py/fair.py`: id or words for one
span, free-text edges), its field-type masks and its scope-request recognition check. v4 adds what the study needs.

- **The headline: right served at the mark.** The cut-off on sureness is set on validation-real so that confidently
  wrong (wrong and served) is at most 1% of requests served; the score is the share of all requests served right at that
  cut-off. The owner's pass mark stands: at most 1% confidently wrong, at least 90% right, on real requests (R180, RR and
  the Claude pilot's test split together). The cut-off is checked with a one-sided bound (conformal risk control), not
  only a point estimate, because the sets are a few hundred.
- **Per-model reading parity.** A parity set: 100 test-split situations, each written as a request by every model of
  the study's net (the Claude four, Codex, and the open-weight and abliterated models once the provider is approved),
  each keyed blind. Reported per writer: right served, confidently wrong, asked back. Pass: every writer's confidently
  wrong at most 1%, and the spread of right served across writers at most 5 points. A writer failing it is a named
  limit of the study, reported with its results.
- **Scope requests.** Recall of `scope_request` on the scope items of every set and of the parity set (written in every
  model's style, prompted or not, plainly or in passing). Pass: at least 98% recall for every writer, and a missed scope
  request is never turned into a different act: ours asks back. A second, independent channel for the measurement: a
  small head on the choose pass that only says "this asks for more scope or resources", at high recall; when it fires and
  the program has no `scope_request`, the request is asked back. The study's measurement also reads the raw words
  offline (measurement lives outside the world and reads logs), so the translator's misses are counted, not invisible.
- **Sonnet out of the study's arms.** Once the pass mark holds, nothing goes behind to Sonnet in a study run: a request
  ours does not serve is asked back to the seat in the world's own terms (`Unsure`), the same for every model, and the
  ask-back share is reported per model as part of parity. Sonnet stays behind in development pilots only.
- **Also reported:** validation-uf (new forms, release by kind as v3), latency median and p95 on the run server.

## 6. Trial plan and cost

**Batch 1, on the v4 data, three runs side by side on RunPod** (v3's batch: three pods for about 2.3 USD):

| run | what | GPU, time | cost |
|---|---|---|---|
| D | deberta-v3-small, read twice (the control) | RTX 3090, ~6 h | ~1.5 USD |
| A | ettin-encoder-150m, read twice | RTX 4090 or 3090, ~6 h | ~2 USD |
| C | Gemma 3 270M, text under the grammar, full fine-tune | RTX 5090, ~4 h (~200M tokens) | ~3 USD |

**Winner:** the most right served at the mark on validation-real (fair scoring), then the Claude pilot's test split;
ties to the parity spread, then latency. A must beat D by at least 3 points to count as the reader's gain. C must beat
A by at least 3 points to be worth its latency and licence, and must keep p95 under 1.5 s with prompt lookup. Batch 2,
only if needed: the winner's family one size up (ettin-encoder-400m, or Qwen3-0.6B for C), and a second seed of the
winner (v3's seeds differed more than anything else did; two seeds agreeing is also a sureness signal worth testing).

**Expected gains (an estimate, to be measured).** Fair scoring alone turns most of the 55 near-misses right: about 88%
on validation-real from 80.5%. The length fix and real voices target the 86 genuine failures; from the shift measured
above, the data is the larger lever and the reader the second. The aim of batch 1 is at least 93% right served at the
1% mark on validation-real, and the owner's 90% / 1% on real requests together. A gain under 3 points from the data
(D against today) would say the real-request supply, not the method, is what limits it.

**Cost in all:** GPU about 6.5 USD for batch 1, limit 15 with batch 2; teacher labels 45 USD of the credit, hard cap;
plan usage about 7 agent-days (Sonnet 5.5 for the mechanical steps, Opus for step 3).

**Build order:**

| step | what | who | days |
|---|---|---|---|
| 0 | translator-fix lands (fair scoring, masks, scope check) | translator-fix | (running) |
| 1 | v4 data by code: real card lists, multi-line joins, the length check | Sonnet 5.5 | 1 |
| 2 | the Claude pilot's test split fixed; keying; rewrites in several voices, read twice, under the 45 USD cap | Sonnet 5.5, Haiku 5.5 | 1.5 |
| 3 | reader swap (tokenizer offsets, ettin config) and the input feature table; the text writer: grammar automaton from slots.py's machine, copy constraint, prompt lookup | Opus 5.5 | 2 |
| 4 | batch 1 on RunPod (D, A, C) | Sonnet 5.5 | 0.5 |
| 5 | score: right served at the mark, parity, scope recall, uf, latency; choose; audit the winner | Sonnet 5.5 | 1 |
| 6 | patch only families the audit shows are local; release by kind; serve; Sonnet out of study arms | Sonnet 5.5 | 1 |

**Stop rules.** No run beats D by 3 points: report, the data is the limit, get more real requests before more models.
No run meets the mark: today's first stays first and Sonnet stays behind in development pilots; the study's arms then
need the owner's ruling on ask-back. GPU 15 USD or credit 45 USD reached: stop where it stands and report.

**Revisit if** fair scoring moves validation-real by much more or less than the 55 near-misses; the Claude pilot's
requests are much shorter or longer than validation-real's; the owner refuses the Gemma terms (SmolLM2-135M in C) or
approves the provider early (open-weight voices into the rewrites); or a Linux host serves int8 faster than fp32.
