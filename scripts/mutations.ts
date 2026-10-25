// The planted bugs of scripts/mutate.ts (docs/testing.md, "Mutation testing"): each one exact replacement in one file,
// of a kind that has happened in this project or would corrupt a run's results, in the code that runs: the engine and its
// actors (kernel/crates) and the live TypeScript (the seat host, the seat's readers, the translator, the measures, the
// generator). Rebuilt 2026-10-25 against the engine after the cut-over (docs/decisions.md, "The mutation catalogue
// rebuilt"); `kind` is the hard rule or route each one breaks. `tests`: the slow or named test files that should catch
// it, run besides the fast tier (or alone, with --tests own) and the invariants; the kernel's own tests run for a kernel bug.

export interface Mutation { id: string; kind: string; file: string; find: string; replace: string; why: string; tests?: string[] }

export const MUTATIONS: Mutation[] = [
 {
  "id": "kernel-credit-doubled",
  "kind": "money",
  "file": "kernel/crates/world/src/exec.rs",
  "find": "            b.balance += amount;",
  "replace": "            b.balance += amount * 2;",
  "why": "The kernel credits the payee twice what it debits: money is made from nothing on every payment."
 },
 {
  "id": "kernel-overdraft-by-a-dollar",
  "kind": "money",
  "file": "kernel/crates/world/src/exec.rs",
  "find": "} else if src.balance < amount {",
  "replace": "} else if src.balance + 100 < amount {",
  "why": "A payment up to a unit more than the balance goes through: accounts go below nothing."
 },
 {
  "id": "rs-bank-estate-remainder-lost",
  "kind": "money",
  "file": "kernel/crates/actors/src/finance/bank.rs",
  "find": "let amount = if i == 0 { balance - each * (to.len() as i64 - 1) } else { each };",
  "replace": "let amount = if i == 0 { each } else { each };",
  "why": "The first heir no longer takes the cents left over from an even split: the remainder stays in the dead person's account.",
  "tests": [
   "orchestrator/test/deaths.test.ts"
  ]
 },
 {
  "id": "rs-treasury-rent-tax-tenfold",
  "kind": "money",
  "file": "kernel/crates/actors/src/offices/treasury.rs",
  "find": "let amount = r.rent_received * rate / 10_000;",
  "replace": "let amount = r.rent_received * rate / 1_000;",
  "why": "The tax assessed on a landlord's rent is ten times the law's rate.",
  "tests": [
   "orchestrator/test/public-finance.test.ts"
  ]
 },
 {
  "id": "rs-support-benefit-floor-capped",
  "kind": "money",
  "file": "kernel/crates/actors/src/boundary/support.rs",
  "find": "most.min(least.unwrap_or(0).max(",
  "replace": "most.min(least.unwrap_or(0).min(",
  "why": "A benefit set as a share of pay is capped at its minimum instead of floored at it.",
  "tests": [
   "orchestrator/test/services.test.ts"
  ]
 },
 {
  "id": "kernel-account-closed-with-balance",
  "kind": "money",
  "file": "kernel/crates/world/src/exec.rs",
  "find": "if a.balance != 0 {",
  "replace": "if a.balance < 0 {",
  "why": "An account holding money can be closed: the money leaves the world."
 },
 {
  "id": "amounttext-round",
  "kind": "integer-cents",
  "file": "participants/src/calls.ts",
  "find": "${Math.floor(n / per)}${cur.minor_units > 0",
  "replace": "${Math.round(n / per)}${cur.minor_units > 0",
  "why": "Amounts written into calls round the whole units to nearest, so 9.50 is written as 10.50 and the payment is a unit too large.",
  "tests": [
   "orchestrator/test/llm.test.ts"
  ]
 },
 {
  "id": "kernel-zero-transfer",
  "kind": "integer-cents",
  "file": "kernel/crates/world/src/exec.rs",
  "find": "if !(1..=MAX_MONEY).contains(&amount) {",
  "replace": "if !(0..=MAX_MONEY).contains(&amount) {",
  "why": "A transfer of nothing is accepted and logged as a payment: a bill is marked settled by a payment of 0."
 },
 {
  "id": "ts-withholding-rounded-to-nearest",
  "kind": "integer-cents",
  "file": "participants/src/shared/tax.ts",
  "find": "const total = Math.floor((year.reduce((x, c) => x + c.amount, 0) * period) / YEAR);",
  "replace": "const total = Math.round((year.reduce((x, c) => x + c.amount, 0) * period) / YEAR);",
  "why": "The tax withheld from a period's pay is rounded to the nearest unit, not down as the law says: a seat's own reckoning of net pay parts from the engine's payroll by a cent half the time.",
  "tests": [
   "participants/test/tax.test.ts"
  ]
 },
 {
  "id": "kernel-dead-participant-not-ended",
  "kind": "the dead",
  "file": "kernel/crates/world/src/exec.rs",
  "find": "        events.extend(end_participant(st, &p, EndReason::Died));",
  "replace": "        let _ = &p;",
  "why": "A person dies but their participant is not ended: it keeps waking and acting, and their posts stay held.",
  "tests": [
   "orchestrator/test/deaths.test.ts"
  ]
 },
 {
  "id": "kernel-dead-stay-home",
  "kind": "the dead",
  "file": "kernel/crates/world/src/exec.rs",
  "find": "    let mut events = vacate_all(s, st, person, VacateReason::Died, None);",
  "replace": "    let mut events: Vec<Timed> = vec![];",
  "why": "A dead body is not taken out of the spaces it was in: it goes on occupying its home (and its bed).",
  "tests": [
   "orchestrator/test/deaths.test.ts"
  ]
 },
 {
  "id": "kernel-dead-post-still-held",
  "kind": "the dead",
  "file": "kernel/crates/world/src/exec.rs",
  "find": "        st.set_holder(&id, None, c);",
  "replace": "        let _ = (&id, c);",
  "why": "A dead person's posts are announced vacant but stay held in the state: nobody can be appointed and the office stops.",
  "tests": [
   "orchestrator/test/deaths.test.ts"
  ]
 },
 {
  "id": "rs-bank-dead-order-paid",
  "kind": "the dead",
  "file": "kernel/crates/actors/src/finance/bank.rs",
  "find": "if dead.contains(ins.speaks_for.as_deref().unwrap_or(\"\")) {",
  "replace": "if dead.contains(ins.id.as_str()) {",
  "why": "The bank looks for the instruction's number among the dead instead of whose it is, so a dead person's standing orders go on being paid.",
  "tests": [
   "orchestrator/test/deaths.test.ts"
  ]
 },
 {
  "id": "rs-bank-dead-holder-pays-out",
  "kind": "the dead",
  "file": "kernel/crates/actors/src/finance/bank.rs",
  "find": "if acc.is_some_and(|a| dead.contains(&a.holder)) {",
  "replace": "if acc.is_some_and(|a| dead.contains(&a.account)) {",
  "why": "The guard looks for the account's number among the dead, not its holder: an instruction filed before the death is still paid out of a dead holder's account.",
  "tests": [
   "orchestrator/test/deaths.test.ts"
  ]
 },
 {
  "id": "rs-staffing-bank-word-ignored",
  "kind": "the dead",
  "file": "kernel/crates/actors/src/firms/staffing.rs",
  "find": "self.bank_says_dead.insert(who.to_string());",
  "replace": "let _ = who;",
  "why": "An employer drops the bank's word that a payee has died: with no registry entry it goes on paying a dead worker's wage.",
  "tests": [
   "orchestrator/test/deaths.test.ts",
   "orchestrator/test/body-payroll.test.ts"
  ]
 },
 {
  "id": "kernel-absent-may-work",
  "kind": "the absent",
  "file": "kernel/crates/world/src/exec.rs",
  "find": "    if !b.present {\n        return Err(refuse(RefusalCode::NotPresent, format!(\"{p} isn't",
  "replace": "    if !b.present && !b.alive {\n        return Err(refuse(RefusalCode::NotPresent, format!(\"{p} isn't",
  "why": "Someone who has left town can still be named to do work (the presence check folded into the death check).",
  "tests": [
   "orchestrator/test/migration.test.ts"
  ]
 },
 {
  "id": "kernel-work-costs-no-time",
  "kind": "work takes time",
  "file": "kernel/crates/world/src/kernel.rs",
  "find": "        let actor_seconds = if others.is_empty() {\n            seconds\n",
  "replace": "        let actor_seconds = if others.is_empty() {\n            oikos_time::DEFAULT_ACT_SECONDS\n",
  "why": "An act its actor does alone takes one second whatever the world's table says: work is done without spending anyone's time.",
  "tests": [
   "orchestrator/test/day-work.test.ts"
  ]
 },
 {
  "id": "rs-retailer-hours-used-forgotten",
  "kind": "work takes time",
  "file": "kernel/crates/actors/src/market/retailer.rs",
  "find": "(s.p.working_day * s.body.hours_bps(w, t) / 10_000 - s.used.get(w).copied().unwrap_or(0)).max(0)",
  "replace": "(s.p.working_day * s.body.hours_bps(w, t) / 10_000).max(0)",
  "why": "The shop forgets the hours its staff have already worked today: each is offered a whole day again at every serving, and orders are served in hours nobody has.",
  "tests": [
   "orchestrator/test/retail.test.ts",
   "orchestrator/test/all-work-takes-time.test.ts"
  ]
 },
 {
  "id": "rs-utilities-slip-row-misnamed",
  "kind": "work takes time",
  "file": "kernel/crates/actors/src/offices/utilities.rs",
  "find": "slip(cx, \"publish/invoice/metered_bill\", who, &SlipOptions { days, lean: None })",
  "replace": "slip(cx, \"publish/invoice/metered_bills\", who, &SlipOptions { days, lean: None })",
  "why": "The billing slip is read from a row the world's table does not have: the utility never mis-bills, whatever the sourced rate.",
  "tests": [
   "orchestrator/test/utilities.test.ts",
   "orchestrator/test/all-work-takes-time.test.ts"
  ]
 },
 {
  "id": "kernel-performer-not-charged",
  "kind": "work takes time",
  "file": "kernel/crates/world/src/kernel.rs",
  "find": "*shares.entry(w.clone()).or_insert(0) += share;",
  "replace": "let _ = (w, share);",
  "why": "Someone named to do an act is never charged their share of its time: only the actor pays for work others do.",
  "tests": [
   "orchestrator/test/day-work.test.ts"
  ]
 },
 {
  "id": "self-sees-position-channels",
  "kind": "no god's view",
  "file": "participants/src/contracts.ts",
  "find": "if (self ? !id.includes(\"/\") : id.startsWith(prefix)) channels[self ? id : id.slice(prefix.length)] = ch;",
  "replace": "if (self ? true : id.startsWith(prefix)) channels[self ? id : id.slice(prefix.length)] = ch;",
  "why": "A person's own view includes the prefixed channels of the posts they hold, so org accounts and records appear as their own and ownAccount may pick the office's money."
 },
 {
  "id": "view-cache-stale",
  "kind": "no god's view",
  "file": "participants/src/view.ts",
  "find": "if (ch.cells.length || ch.whole) this.cache.delete(id);",
  "replace": "if (ch.whole) this.cache.delete(id);",
  "why": "A participant's cached cell list is not refreshed when new cells arrive, so it keeps acting on a stale picture of the street."
 },
 {
  "id": "kernel-named-sees-private",
  "kind": "no god's view",
  "file": "kernel/crates/perception/src/observe.rs",
  "find": "    rec.visible_to.allows(entity) || st.author_entity(rec).as_deref() == Some(entity)\n",
  "replace": "    rec.visible_to.allows(entity) || rec.entities_named().iter().any(|e| *e == entity)\n",
  "why": "Being named in a private record is taken for being allowed to see it: a tenant named in the landlord's letter to the bank is shown it."
 },
 {
  "id": "kernel-record-seen-unless-authored",
  "kind": "no god's view",
  "file": "kernel/crates/perception/src/observe.rs",
  "find": "|| st.author_entity(rec).as_deref() == Some(entity)",
  "replace": "|| st.author_entity(rec).as_deref() != Some(entity)",
  "why": "The author clause of who may see a record is inverted: every record someone else wrote is visible to all, whatever its readers.",
  "tests": [
   "orchestrator/test/no-god-view.test.ts",
   "orchestrator/test/seat-sight.test.ts"
  ]
 },
 {
  "id": "kernel-mine-channel-shows-all",
  "kind": "no god's view",
  "file": "kernel/crates/perception/src/observe.rs",
  "find": "(Way::Mine, _) => Some(Want::Involving([me].into_iter().collect())),",
  "replace": "(Way::Mine, _) => None,",
  "why": "A channel of one's own papers loses its filter: it shows every record of its kind in town the viewer may see, not the viewer's own.",
  "tests": [
   "orchestrator/test/no-god-view.test.ts",
   "orchestrator/test/seat-sight.test.ts"
  ]
 },
 {
  "id": "kernel-search-skips-visibility",
  "kind": "no god's view",
  "file": "kernel/crates/perception/src/observe.rs",
  "find": ".filter(|(_, r)| can_see(st, r, me) && placed_ok(st, r, me, area)",
  "replace": ".filter(|(_, r)| placed_ok(st, r, me, area)",
  "why": "A question to a register's keeper no longer checks the asker may see each record: private records come back in the answer.",
  "tests": [
   "orchestrator/test/no-god-view.test.ts"
  ]
 },
 {
  "id": "kernel-answer-cap-ignored",
  "kind": "no god's view",
  "file": "kernel/crates/perception/src/observe.rs",
  "find": "let limit = q.limit.unwrap_or(20).min(most.unwrap_or(u32::MAX));",
  "replace": "let limit = q.limit.unwrap_or(20).max(most.unwrap_or(0));",
  "why": "The keeper's limit on one answer no longer limits it: a register can be read whole by asking for a large answer.",
  "tests": [
   "orchestrator/test/no-god-view.test.ts"
  ]
 },
 {
  "id": "kernel-inbox-across-capacities",
  "kind": "no god's view",
  "file": "kernel/crates/world/src/kernel.rs",
  "find": "let keys: Vec<Id> = p.pending.keys().filter(|k| only.is_none_or(|o| o == k.as_str())).cloned().collect();",
  "replace": "let keys: Vec<Id> = p.pending.keys().cloned().collect();",
  "why": "A unit stepped in one capacity is handed every capacity's letters and outcomes: a person reads their post's mail as their own, and the post goes without it.",
  "tests": [
   "orchestrator/test/seat-sight.test.ts"
  ]
 },
 {
  "id": "ts-office-forms-known-to-all",
  "kind": "no god's view",
  "file": "translator/src/knowledge.ts",
  "find": "|| this.held.has(f.data.office);",
  "replace": "|| f.data.office !== undefined;",
  "why": "A form that writes an office's own papers is known to every seat that has seen it, not only to the office's holder: another seat's request is drawn up on stationery it does not keep.",
  "tests": [
   "translator/test/resolver.test.ts"
  ]
 },
 {
  "id": "ts-roster-orders-of-any-body",
  "kind": "no god's view",
  "file": "participants/src/readers/roster.ts",
  "find": "filter((r) => r.speaks_for === this.entity && (r.in_position === this.office ||",
  "replace": "filter((r) => (r.in_position === this.office ||",
  "why": "An office's staff list takes in standing work orders of other bodies that reached its book, as if they were its own.",
  "tests": [
   "participants/test/staff-report.test.ts"
  ]
 },
 {
  "id": "kernel-care-draw-by-number",
  "kind": "twins",
  "file": "kernel/crates/world/src/exec.rs",
  "find": "let mut rng = self.s.randomness.stream(&[\"care\", person, &kind, &since]);",
  "replace": "let mut rng = self.s.randomness.stream(&[\"care\", person, &kind, &c.id]);",
  "why": "Whether care saves a life is drawn on the condition's number (its place among all conditions in town), so one more illness anywhere changes who dies: a pilot parts from its twin.",
  "tests": [
   "orchestrator/test/twin-draws.test.ts",
   "orchestrator/test/twin-draws-seat.test.ts",
   "orchestrator/test/twin-draws-year.test.ts",
   "orchestrator/test/deaths.test.ts"
  ]
 },
 {
  "id": "rs-draws-key-moment",
  "kind": "twins",
  "file": "kernel/crates/actors/src/draws.rs",
  "find": "let day = t.div_euclid(86_400);",
  "replace": "let day = t;",
  "why": "An actor's stream is named for the moment of its wake, not the day: the same draw falls otherwise whenever it wakes at another hour, and a pilot parts from its twin.",
  "tests": [
   "orchestrator/test/twin-draws.test.ts",
   "orchestrator/test/twin-draws-seat.test.ts"
  ]
 },
 {
  "id": "rs-draws-records-not-replaced",
  "kind": "twins",
  "file": "kernel/crates/actors/src/draws.rs",
  "find": "if !purpose.contains(\"rec.\") {",
  "replace": "if !purpose.contains(\"rec:\") {",
  "why": "A paper's number in the town's file is never replaced by which paper it is to the drawer: one more paper filed anywhere moves every later draw keyed on a paper.",
  "tests": [
   "orchestrator/test/twin-draws.test.ts",
   "orchestrator/test/twin-draws-seat.test.ts"
  ]
 },
 {
  "id": "kernel-rng-length-prefix-dropped",
  "kind": "twins",
  "file": "kernel/crates/core/src/rng.rs",
  "find": "h.update((part.len() as u64).to_le_bytes());",
  "replace": "h.update(0u64.to_le_bytes());",
  "why": "A stream's key parts lose their lengths: [\"ab\", \"c\"] and [\"a\", \"bc\"] are one stream, and two draws meant to be apart fall alike."
 },
 {
  "id": "rs-world-price-moment",
  "kind": "twins",
  "file": "kernel/crates/actors/src/boundary/trade.rs",
  "find": "cx.chance(&format!(\"world-price/{kind}/{m0}\"))",
  "replace": "cx.chance(&format!(\"world-price/{kind}/{t}\"))",
  "why": "The world's price for a month is drawn on the moment its office woke, not the month: the prices part between a run and its twin.",
  "tests": [
   "orchestrator/test/twin-draws-year.test.ts"
  ]
 },
 {
  "id": "ts-draws-day-is-moment",
  "kind": "twins",
  "file": "orchestrator/src/draws.ts",
  "find": "const day = Math.floor(t / DAY);",
  "replace": "const day = t;",
  "why": "The host names a seat-side stream for the moment, not the day (the planted bug of the old catalogue's draw-keyed-on-moment, in its new home).",
  "tests": [
   "orchestrator/test/twin-draws-seat.test.ts"
  ]
 },
 {
  "id": "ts-draws-paper-number-kept",
  "kind": "twins",
  "file": "orchestrator/src/draws.ts",
  "find": "return `paper#${seen!.get(id)}`;",
  "replace": "return `paper#${id.slice(4)}`;",
  "why": "The host names a paper by its number in the world's file, not by which paper it is to the drawer (the old catalogue's stable-purpose-bypassed, in its new home).",
  "tests": [
   "orchestrator/test/twin-draws-seat.test.ts"
  ]
 },
 {
  "id": "rs-appeal-window-off-by-one",
  "kind": "review and appeal",
  "file": "kernel/crates/actors/src/offices/hearing.rs",
  "find": "if late > within {",
  "replace": "if late >= within {",
  "why": "An appeal made on the last day the law allows is turned away as out of time.",
  "tests": [
   "orchestrator/test/recourse-town.test.ts"
  ]
 },
 {
  "id": "rs-hearing-listed-in-seconds",
  "kind": "review and appeal",
  "file": "kernel/crates/actors/src/offices/tribunal.rs",
  "find": "let hearing = t + self.hearing_after_days * DAY;",
  "replace": "let hearing = t + self.hearing_after_days;",
  "why": "A hearing is listed the respondent's days to answer counted as seconds: decided before the respondent could answer.",
  "tests": [
   "orchestrator/test/possession.test.ts"
  ]
 },
 {
  "id": "rs-landlord-notice-to-vacate-short",
  "kind": "review and appeal",
  "file": "kernel/crates/actors/src/firms/landlord.rs",
  "find": "by: starts_on(t, law.notice_days * DAY),",
  "replace": "by: starts_on(t, (law.notice_days - 1) * DAY),",
  "why": "A landlord's notice to vacate gives a day fewer than the law's days.",
  "tests": [
   "orchestrator/test/possession.test.ts"
  ]
 },
 {
  "id": "rs-grievance-ignored-in-seconds",
  "kind": "review and appeal",
  "file": "kernel/crates/actors/src/citizen/recourse.rs",
  "find": "if g.asked.is_some_and(|a| g.answer.is_none() && t - a >= answer_days * DAY) {",
  "replace": "if g.asked.is_some_and(|a| g.answer.is_none() && t - a >= answer_days) {",
  "why": "A citizen takes a complaint as ignored after the party's days to answer counted as seconds, and goes to the tribunal before the party could answer.",
  "tests": [
   "orchestrator/test/recourse-town.test.ts"
  ]
 },
 {
  "id": "rs-retire-a-year-late",
  "kind": "decision law",
  "file": "kernel/crates/actors/src/citizen/work.rs",
  "find": "if self.s.retired || age < stop {",
  "replace": "if self.s.retired || age <= stop {",
  "why": "A person stops work a year after the age at which the profile says they do."
 },
 {
  "id": "rs-method-order-inverted",
  "kind": "decision law",
  "file": "kernel/crates/actors/src/mind/plan.rs",
  "find": "open.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(b.0)));",
  "replace": "open.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(b.0)));",
  "why": "A citizen pursuing an unmet need tries the method it reckons worst first."
 },
 {
  "id": "ts-generator-owners-one-more",
  "kind": "generator",
  "file": "worlds/generator/generate.ts",
  "find": "const n = 1 + Math.max(0, FO.closely_held.households_bps.findIndex((b) => (u -= b) < 0));",
  "replace": "const n = 2 + Math.max(0, FO.closely_held.households_bps.findIndex((b) => (u -= b) < 0));",
  "why": "Every closely held firm gets one owning household more than the profile's distribution drew.",
  "tests": [
   "worlds/test/generate.test.ts"
  ]
 },
 {
  "id": "ts-measure-people-work-inverted",
  "kind": "measures",
  "file": "measure/src/stewardship.ts",
  "find": "if (this.classOf(makers) === \"person\") this.workSeconds.people += s.seconds;",
  "replace": "if (this.classOf(makers) !== \"person\") this.workSeconds.people += s.seconds;",
  "why": "The seconds of work counted as people's are the seconds systems did: the people's share of work is its complement.",
  "tests": [
   "measure/test/stewardship.test.ts"
  ]
 },
 {
  "id": "ts-arrangement-failure-not-behind",
  "kind": "translator",
  "file": "translator/src/arrangement.ts",
  "find": "if (!(e instanceof ModelCallFailed)) throw e;",
  "replace": "throw e;",
  "why": "When the first translator's model call fails the seat's request fails with it, instead of going to the translator behind.",
  "tests": [
   "translator/test/arrangement.test.ts"
  ]
 }
];
