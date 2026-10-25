# Testing: what the suite guarantees

Naz, 2026-10-17: "I don't want slop tests, I want meaningful tests that would actually catch real shit."

This page says what the suite holds, how we know (mutation testing), which kinds of test catch little, and how to run
the measurement again. The reasoning and the first measurement are in docs/decisions.md ("What the tests catch",
2026-10-17).

## The invariants

`orchestrator/test/invariants.test.ts` runs small towns (60 people) of the three main profiles (au-vic-2026,
gb-eng-2026, ke-nakuru-2026) for a year on several seeds, and reads each log with `orchestrator/src/invariants.ts`.
The checker reads **only the log** (contracts/log.schema.json): it knows nothing of how the world is computed, so it
judges any implementation that writes the log, the TypeScript actors today and their Rust port next. Each invariant
is a property no run may break, whatever its town and its draws:

| Invariant | What must hold |
|---|---|
| `money_conserved` | Every transfer moves a whole positive amount between two accounts that exist, are open and are in one currency; nobody but the world's edge goes below nothing; the balances add up at the end to what the town began with; an account is closed only empty; and every balance a seat is shown is the balance the transfers say it has at that moment. |
| `integer_cents` | Every amount on the wire is a whole number of the smallest unit: transfers, opening balances, balances shown, and every money field of every record's data (by name: `amount`, `price`, `wage`, `rent`, `withheld`, ...). |
| `pays_as_instructed` | A payment made under an instruction pays exactly what it says, from and to whom it says; a payment once is made once; a standing order no more often than its due dates have come round; a withdrawn order not after it was withdrawn. |
| `pays_as_agreed` | A standing order made under an employment agreement pays no more often than the agreement commits. (Not "no more": an unmutated ke-nakuru-2026 town has a factory's new wage orders 2% above the agreements they cite, not yet traced; leases are left out, a rent being raised by notice, which the terms do not carry.) |
| `notice_as_the_law_says` | A notice to vacate gives at least the days the law it cites gives, counted from the day after it is on record. (Small towns rarely reach one in a year: it is held mostly where a test makes one, as orchestrator/test/possession.test.ts does.) |
| `dead_not_paid` | No standing order pays into the account of someone who died more than two of its periods (or 45 days, if longer) and a week before: the bank tells the payer at the next payment, and the payer stops it at its next round (docs/behaviour/deaths.md). A payer with nobody left to act for it (its only post-holder the one who died) is counted, not failed: see "The gaps". No wage into that of someone who left town more than a month beyond that (their notice). |
| `no_act_by_dead` | A dead person's participant begins no act, and no act is performed by someone dead or ended before it began. |
| `no_act_by_absent` | Nobody who has left town performs an act that needs a body there (work, moving goods, occupying, building). A letter, a payment or a notice they still can. |
| `work_takes_time` | Every act is begun before it is applied and applied when done; done comes after it starts; it names who did it; and an act its actor does alone takes at least what the world's table of work (`orchestration.act_time`) says for its blocks. |
| `one_timeline` | A person's own acts never take the same seconds. |
| `one_place` | A body is in one space at a time and never vacates where it is not; nobody dead or gone is in any space, then or at the end; at the end nobody is in two. (Someone alive in no space is counted, not failed: see "The gaps".) |
| `one_household` | At the end every living person in town has a household (the newest household record naming them), everyone it names who is alive and here has the same one, and it names nobody dead for more than 60 days. |
| `posts_fall_vacant` | A participant that ends holds no post, and no post is given to someone dead, gone or ended. |
| `no_god_view` | Every record a seat is shown is public, addressed to its entity, or its entity's own; every account it is shown is its entity's or kept by it; every transfer it is shown touches one of those; every message in its inbox is to it, its person, its entity or one of its posts. (Checked on runs that record every observation.) |
| `queues_drain` | No act is still under way, and no question to a keeper unanswered, 60 days after it was due; fewer than 5% of the payments asked of the bank once, a month or more before the end, are unpaid with the money there. |
| `bounded` | No week's log is more than three times the median week (a module waking, retrying or filing over and over shows here; unmutated towns' busiest week is about 1.3 times the median). |
| twins | The same town run twice is the same town, entry for entry (state hash and every entry of the log). |

Each run also counts what each invariant looked at (`seen`), and the test fails if the towns did none of a thing an
invariant is about (no deaths, no payments under instructions...): an invariant that saw nothing proves nothing.

More seeds: `OIKOS_INVARIANT_SEEDS=6`; bigger towns: `OIKOS_INVARIANT_CITIZENS=200`.

That file is in the slow tier (CI, on every push to main; docs/dev-machine.md, "Tiers"). The merge gate runs
`orchestrator/test/invariants-gate.test.ts`: the same checker on 90 days of a 60-person town of each main profile, one
seed, every observation recorded, so a broken invariant stops a merge within a minute; what takes a year (deaths,
appointments) it leaves to the year.

**What the invariants cannot see.** Whether an amount is the right amount (a wage doubled by the employer, a tax
rounded the wrong way, a rent listed low): the log has the payment and the instruction, both wrong alike. Whether a
law value was read from the right field, a notice period is a day short, or a draw is keyed on the right thing: those
are behaviours, held by the tests of the module that does them. See "The gaps" below.

## Mutation testing

**Rebuilt 2026-10-25** against the code that runs (docs/decisions.md, "The mutation catalogue rebuilt"): 46 bugs in the engine and its actors (`kernel/crates`: 35) and the live TypeScript (the seat host, the seat's readers, the translator, the measures, the generator), each with the hard rule or route it breaks as its `kind` (money, integer cents, the dead, the absent, work's time, sight, twins, review and appeal, the decision law). The bugs planted in the deleted TypeScript actors are gone from it.

`scripts/mutate.ts` plants one realistic bug at a time (`scripts/mutations.ts`: each one exact replacement in one file,
of a kind that has happened here or would corrupt results) in a scratch copy of the repo, runs the tests, records
which failed, and puts the source back. The repo itself is never touched.

```
bun scripts/slots.ts --weight 3 --what "mutations" -- bun scripts/mutate.ts --copy /path/to/scratch/copy [--only id,id] [--tests fast|own|invariants]
```

- The copy is a copy-on-write clone (`cp -c -R`), made on first use; files this checkout changed are copied in at
  every start. Its kernel is built in the `gate` profile (no whole-program link: a mutation's rebuild in a minute or
  two), every test file is pointed at that build, it is rebuilt for a kernel mutation, and rebuilt clean at the end.
- First, every test file is run unmutated (the baseline, which also times them); a test failing there is never
  counted as catching anything. Then each bug against the files that took under 30 s in the baseline, the slow files
  the bug names, the invariants, and, for a kernel bug, the kernel's own tests (`cargo test --profile gate`, also run
  once unmutated). `--tests own` is the quick pass: the files the bug names, the gate's 90-day invariants and the
  kernel's tests; run the survivors again with the default to be sure nothing else catches them.
- A file that runs past 25 minutes under a bug counts as catching it (a hang is a failure).
- Results: `<copy>/mutation-results.json`, written after each bug (a stopped run keeps what it found and resumes).
  `--tests invariants` re-runs only the invariants against every bug and merges the result.
- Delete the copy when done (`runs/` inside it holds the towns the tests ran).

A bug nothing catches is a gap: add the test that would have (an invariant if it is a property of every run; the
module's own test if it is a behaviour).

## Change detectors

A test whose only assertion is a pinned hash (of a state, a config or a world) catches change, not bugs: every
change to what every town runs moves it, and it is re-taken with the change, so the bug that came with the change is
re-pinned too. Several pins had been re-taken fifteen to twenty times. Where such a test stands for a property, say the
property instead (the option adds only its papers; the dial at 0 is the dial absent; a town is a twin of itself), and
keep a pin only where the test is about the bytes (the log's hash chain, a config's canonical form).

Done on 2026-10-17: the pins of `opening-caseload-offices.test.ts` (replaced by "the option adds only brought-forward
papers, removes none, changes nothing else"), `living-dial.test.ts` (the dial absent, at 0, and at 0 with frictions
at 0 are one town), `founding.test.ts` and `worlds/test/living.test.ts` (each also held by the assertions beside it, and
duplicating culture-dial's pins), and `kernel/tests/entity_record.rs` (with and without the new fields: one hash).
**Kept, deliberately:** the three states and configs of `culture-dial.test.ts`, as the one place a change that moves
every town shows (re-take them with the change and say why there; they are an alarm, not a check).

## Pruning: when a budget is hit

The gate and the slow tier have time budgets (`scripts/test-budgets.json`; raising one is a decision with its entry in
docs/decisions.md). When one is hit, or about monthly, prune as on 2026-10-24 (docs/decisions.md, "Test pruning"):

1. **Inventory.** For each test file: what it guards (a law, an invariant, a contract, a real rule from a profile or a
   law, a bug we had: `git log -S` and docs/decisions.md), and its time (`scripts/test-times.json`, written by every run
   of `scripts/test.ts`; the slowest first). A file with no tests in it, or that tests only its own fixtures, goes.
2. **Seed pins.** `grep -n "where it was\|draws alone\|by the draws\|draws, not\|seed [0-9]"` over the test files finds
   the numbers re-taken at changes: a floor hopped seed to seed, a ceiling raised a little each time. Replace each with
   the rule it stood for (the dial's own figure, the code's own ceiling, "some" where the count is the draws') or say
   the property; never hop a seed or widen a bound to pass.
3. **Duplicates and shared fixtures.** Two tests running the same config and seed run one town: run it once in the file
   (a memoised promise, as `twin-seat-year.test.ts` and `reading-dial.test.ts` do). A slow file whose last tests only
   generate towns is split, so its runs and its generation are not one file's queue (`scenarios-generate.test.ts`).
   A run lengthened only to find a rare draw (a case falling ripe, a dividend) is held where the case is made by
   construction instead.
4. **Mutations.** `bun scripts/slots.ts --weight 3 -- bun scripts/mutate.ts --copy <scratch>` before and after on the
   bugs that still apply (`--only`; a mutation whose `find` no longer matches its file is not planted). For the before side, `--source` a `git archive` of main with `node_modules` and `kernel/target` cloned in (`cp -c -R`), and a fresh `--out`: an archive alone runs no test, and a reused results file keeps its baseline, so a baseline where every file "did not run" counts every bug missed. A cut must not
   leave a bug that was caught caught by nothing, above all on the hard rules (money, the dead, the absent, work's time,
   sight, twins).
5. **Record.** One decisions entry: each file or test cut or replaced, what covers it instead, and what would bring it
   back; the suite's file count, test count and the two tiers' times before and after.

## The gaps

**2026-10-25, the rebuilt catalogue** (docs/decisions.md, "Test strength"): of 46 bugs, 34 caught for certain, 2 survive (both equivalent or nearly: another guard holds the rule), 10 unconfirmed (their only catchers were the generator-backed town tests, which a harness fault failed under every kernel bug; run them again). What follows is the measurement of 2026-10-17, against the TypeScript actors since deleted.

Measured 2026-10-17 on main at ac99bbba (docs/decisions.md, "What the tests catch"): 49 bugs planted, 32 caught. The
invariants caught 10 of them (wrong pay, fractional cents, the dead paid or acting or left in their homes and
households, work charged no time, a bank's queue left undrained, a notice a day short), each one also caught by an
older test; they add no catch of their own among the 49, but they are what judges a port that rewrites those older
tests' subjects. Nothing caught these 17, and each needs a test of its module's behaviour (the log cannot say the
amount, field or day is wrong when it is wrong consistently):

- **Amounts the log cannot judge:** a shop's listed price doubled; overdue rates' interest rounded up a cent; rent tax
  assessed at the penalty rate; an employer's notice taken from the pay period.
- **The dead:** a bank going on with a dead person's standing instructions, or paying out of a dead holder's account;
  an employer that ignores the bank's word of a death; a household that counts an earlier death among the survivors.
- **Order and dates:** the bank paying payments due together in id-as-text order; a landlord counting one rent fewer
  as due; retirement a year late.
- **Refusals believed:** a refused batch of payments never retried; a move-in believed though refused; a refused
  delivery not refunded.
- **Sight:** a person's own view including the channels of the posts they hold (the kernel's records filter still
  holds, so nothing is shown that it may not see, but the module mistakes the office's money for its own).
- **Cost only:** a module woken every tick (an hour here) wastes time and changes nothing the log can call wrong.

What the invariants found in towns no bug was planted in (findings, not failures; each is counted in `seen` or kept
out of the rule, with the reason in the code):

- A newcomer who finds no home, and someone put out of theirs, is in no space at all: nowhere to be found, unable to
  work. A person sleeping rough is somewhere.
- A shop whose only post-holder dies has nobody to stop the dead man's wages: paid for months (the missing law of
  docs/behaviour/staffing.md: no owner or board appoints).
- A notice to vacate is dated from when the landlord decided, and goes on the record later (all work takes time), so it
  can give a day less than the law (seen once, au-vic-2026 seed 2 under an unrelated bug: recorded day 300, given until
  day 314, the law's 14 full days end at 315). firms.ts reckons `by` from the decision's `t`.
- A person's own act can be placed during work their employer placed on their time (5 to 40 times a year in a
  60-person town): the timeline check is held to a person's own acts until this is traced.
- In ke-nakuru-2026 a factory's new wage orders pay 2% more than the employment agreements they cite.
