// The planted bugs of scripts/mutate.ts (docs/testing.md, "Mutation testing"): each one exact replacement in one file,
// of a kind that has happened in this project or would corrupt a run's results. `tests`: the slow test files that
// should catch it, run besides the fast tier and the invariants.

export interface Mutation { id: string; kind: string; file: string; find: string; replace: string; why: string; tests?: string[] }

export const MUTATIONS: Mutation[] = [
 {
  "id": "wage-order-doubled",
  "kind": "1 payment amount doubled",
  "file": "participants/src/behaviour/firms.ts",
  "find": "[ref, pay(to, pays.wage - tax, { from: account, every: pays.period, first, basis: a.id, for: `Wages for ${worker}.`",
  "replace": "[ref, pay(to, pays.wage * 2 - tax, { from: account, every: pays.period, first, basis: a.id, for: `Wages for ${worker}.`",
  "why": "Every new hire's standing wage order pays twice the agreed wage (net of tax computed on the single wage), draining employers.",
  "tests": [
   "orchestrator/test/production.test.ts",
   "orchestrator/test/public-finance.test.ts"
  ]
 },
 {
  "id": "day-wage-sign-flipped",
  "kind": "1 payment sign flipped",
  "file": "participants/src/behaviour/firms.ts",
  "find": "lines.push(pay(to, day - w.total, {",
  "replace": "lines.push(pay(to, day + w.total, {",
  "why": "A casual hand paid by the day receives the wage plus the tax withheld instead of net of it, while the return still reports the withholding.",
  "tests": [
   "orchestrator/test/day-work.test.ts"
  ]
 },
 {
  "id": "shop-price-doubled",
  "kind": "1 payment amount doubled (shop price)",
  "file": "participants/src/behaviour/retailer.ts",
  "find": "priceList({ [p.kind]: price }, acc.account,",
  "replace": "priceList({ [p.kind]: price * 2 }, acc.account,",
  "why": "A shop's published price list asks double what its internal price is, so customers are charged twice what the shop reckons and orders at the listed price look overpaid.",
  "tests": [
   "orchestrator/test/retail.test.ts",
   "orchestrator/test/prices.test.ts"
  ]
 },
 {
  "id": "rent-listing-undercut",
  "kind": "1 sign flipped (rent)",
  "file": "participants/src/behaviour/firms.ts",
  "find": "listing(o, Math.floor((((ref * (10_000 + markupBps)) / 10_000) * noise) / 10_000))",
  "replace": "listing(o, Math.floor((((ref * (10_000 - markupBps)) / 10_000) * noise) / 10_000))",
  "why": "Landlords list vacant homes below the going rent instead of above it, lowering all new rents.",
  "tests": [
   "orchestrator/test/home-market.test.ts",
   "orchestrator/test/tenancy.test.ts"
  ]
 },
 {
  "id": "withheld-total-ceil",
  "kind": "2 rounding (tax withheld)",
  "file": "participants/src/behaviour/tax.ts",
  "find": "const total = Math.floor((year.reduce((x, c) => x + c.amount, 0) * period) / YEAR);",
  "replace": "const total = Math.ceil((year.reduce((x, c) => x + c.amount, 0) * period) / YEAR);",
  "why": "Tax withheld from each pay is rounded up a cent instead of down, so net pay is a cent short and returns disagree with the law's stated rule.",
  "tests": [
   "orchestrator/test/public-finance.test.ts"
  ]
 },
 {
  "id": "band-charge-round",
  "kind": "2 rounding (tax band)",
  "file": "participants/src/behaviour/tax.ts",
  "find": "due += Math.floor((part * b.rate_bps) / 10_000);",
  "replace": "due += Math.round((part * b.rate_bps) / 10_000);",
  "why": "Each band's charge rounds to nearest instead of down, so annual tax is occasionally a cent higher per band.",
  "tests": [
   "orchestrator/test/public-finance.test.ts"
  ]
 },
 {
  "id": "rates-levy-no-floor",
  "kind": "2 rounding (dropped floor)",
  "file": "participants/src/behaviour/government.ts",
  "find": "o.amount += Math.floor((Number(v.data.value) * ratePpm) / 1_000_000 / instalments);",
  "replace": "o.amount += (Number(v.data.value) * ratePpm) / 1_000_000 / instalments;",
  "why": "Rates notices carry fractional cents when value*rate does not divide evenly, breaking integer-cents money.",
  "tests": [
   "orchestrator/test/public-finance.test.ts",
   "orchestrator/test/government.test.ts"
  ]
 },
 {
  "id": "amounttext-round",
  "kind": "2 rounding (amount text)",
  "file": "participants/src/calls.ts",
  "find": "${Math.floor(n / per)}${cur.minor_units > 0",
  "replace": "${Math.round(n / per)}${cur.minor_units > 0",
  "why": "Amounts written into calls round the whole units to nearest, so 9.50 is written as 10.50 and the payment is a unit too large.",
  "tests": [
   "orchestrator/test/llm.test.ts"
  ]
 },
 {
  "id": "penalty-interest-round",
  "kind": "2 rounding (interest)",
  "file": "participants/src/behaviour/government.ts",
  "find": "Math.floor((cents(c.about.amount) * interestBps) / 10_000 / 12)",
  "replace": "Math.ceil((cents(c.about.amount) * interestBps) / 10_000 / 12)",
  "why": "Monthly interest on overdue rates is rounded up, so every overdue notice charges up to a cent more.",
  "tests": [
   "orchestrator/test/government.test.ts"
  ]
 },
 {
  "id": "payer-died-check-inverted",
  "kind": "3 dead person still paid",
  "file": "participants/src/behaviour/firms.ts",
  "find": "const died = doesPay ? [...new Set([...book.all(\"death_registration\")",
  "replace": "const died = !doesPay ? [...new Set([...book.all(\"death_registration\")",
  "why": "The paying office never reads death registrations, so a worker who dies keeps being paid and the employment is never ended on record.",
  "tests": [
   "orchestrator/test/deaths.test.ts"
  ]
 },
 {
  "id": "bank-dead-instructions-run",
  "kind": "3 dead person still acting",
  "file": "participants/src/behaviour/bank.ts",
  "find": "if ((ended.has(ins.id) && !lastCall.has(ins.id)) || dead.has(ins.speaks_for ?? \"\")) continue;",
  "replace": "if ((ended.has(ins.id) && !lastCall.has(ins.id))) continue;",
  "why": "A dead person's standing instructions (rent, bills) keep being carried out after the death registration.",
  "tests": [
   "orchestrator/test/deaths.test.ts"
  ]
 },
 {
  "id": "bank-dead-account-pays",
  "kind": "3 dead person still acting",
  "file": "participants/src/behaviour/bank.ts",
  "find": "if (acc && dead.has(acc.holder)) continue; // the account holder has died",
  "replace": "if (acc && false && dead.has(acc.holder)) continue; // the account holder has died",
  "why": "A dead account holder's account still pays out standing orders instead of only settling the estate.",
  "tests": [
   "orchestrator/test/deaths.test.ts"
  ]
 },
 {
  "id": "known-dead-bank-word-ignored",
  "kind": "3 dead person still paid",
  "file": "participants/src/behaviour/firms.ts",
  "find": "const dead = new Set([...book.all(\"death_registration\").map((r) => r.data?.deceased as string), ...this.bankSaysDead]);",
  "replace": "const dead = new Set([...book.all(\"death_registration\").map((r) => r.data?.deceased as string)]);",
  "why": "Staffing.knownDead ignores the bank's word of a death, so an employer whose registry entry never named it keeps the dead worker on staff.",
  "tests": [
   "orchestrator/test/deaths.test.ts"
  ]
 },
 {
  "id": "household-dead-stay-survivors",
  "kind": "3 dead member kept in household",
  "file": "participants/src/behaviour/citizen.ts",
  "find": "const survivors = hh.members.filter((m) => m.person !== d.occupant && !mourned.has(m.person));",
  "replace": "const survivors = hh.members.filter((m) => m.person !== d.occupant);",
  "why": "Earlier deaths in a household are counted among the survivors, so a dead adult is chosen as leaseholder or counted as grown.",
  "tests": [
   "orchestrator/test/deaths.test.ts",
   "orchestrator/test/households.test.ts"
  ]
 },
 {
  "id": "bank-new-requests-drop-first",
  "kind": "4 dropped from register (off-by-one slice)",
  "file": "participants/src/behaviour/bank.ts",
  "find": "const fresh = all.slice(cursor).filter((r) => (r.addressed_to ?? []).includes(me));",
  "replace": "const fresh = all.slice(cursor + 1).filter((r) => (r.addressed_to ?? []).includes(me));",
  "why": "The bank skips the first new payment request seen on each wake, so one person's payment request or standing order is never set up.",
  "tests": [
   "orchestrator/test/credit.test.ts"
  ]
 },
 {
  "id": "day-hand-presence-inverted",
  "kind": "5 act by someone not present",
  "file": "participants/src/behaviour/firms.ts",
  "find": "(here && !here.has(worker))) continue;",
  "replace": "(here && here.has(worker))) continue;",
  "why": "Day hands are paid only on days they are NOT at the workplace and skipped when present.",
  "tests": [
   "orchestrator/test/day-work.test.ts"
  ]
 },
 {
  "id": "shop-staff-serve-when-closed",
  "kind": "5 act when not at work",
  "file": "participants/src/behaviour/retailer.ts",
  "find": ": p.open_until && !(workDay(t) && tod >= p.open_from && tod < p.open_until) ? []",
  "replace": ": p.open_until && (workDay(t) && tod >= p.open_from && tod < p.open_until) ? []",
  "why": "Shop staff are treated as present exactly outside opening hours, so orders are served when the shop is closed and not when open.",
  "tests": [
   "orchestrator/test/retail.test.ts"
  ]
 },
 {
  "id": "filedbefore-text-compare",
  "kind": "6 ids sorted as text",
  "file": "participants/src/behaviour/common.ts",
  "find": "if (x && y && x[1] === y[1]) return Number(x[2]) - Number(y[2]);",
  "replace": "if (x && y && x[1] === y[1]) return x[2]! < y[2]! ? -1 : x[2]! > y[2]! ? 1 : 0;",
  "why": "rec.10 sorts before rec.9 again, so the bank and benefit office process instructions and claims in the wrong order once ids pass 9.",
  "tests": [
   "orchestrator/test/services.test.ts"
  ]
 },
 {
  "id": "bank-payments-text-order",
  "kind": "6 ids sorted as text",
  "file": "participants/src/behaviour/bank.ts",
  "find": "out.sort((a, b) => a.due - b.due || filedBefore({ id: a.instruction }, { id: b.instruction }));",
  "replace": "out.sort((a, b) => a.due - b.due || (a.instruction < b.instruction ? -1 : a.instruction > b.instruction ? 1 : 0));",
  "why": "Payments due together are ordered by id text, so rec.100 pays before rec.99 and shortfalls fall on different payees.",
  "tests": [
   "orchestrator/test/credit.test.ts"
  ]
 },
 {
  "id": "rent-due-count-short",
  "kind": "7 off-by-one (due date)",
  "file": "participants/src/behaviour/firms.ts",
  "find": "const due = t < firstDue ? 0 : Math.floor((t - firstDue) / MONTH) + 1;",
  "replace": "const due = t < firstDue ? 0 : Math.floor((t - firstDue) / MONTH);",
  "why": "Landlords count one rent fewer as due, so arrears are noticed a month late and the first rent is never chased.",
  "tests": ["orchestrator/test/tenancy.test.ts", "orchestrator/test/possession.test.ts"]
 },
 {
  "id": "possession-notice-day-short",
  "kind": "7 off-by-one (notice period)",
  "file": "participants/src/behaviour/firms.ts",
  "find": "const by = (Math.floor(t / DAY) + 1 + law.notice_days) * DAY;",
  "replace": "const by = (Math.floor(t / DAY) + law.notice_days) * DAY;",
  "why": "A notice to vacate gives a day less than the law's days, so possession can start before the notice has run in full.",
  "tests": ["orchestrator/test/tenancy.test.ts", "orchestrator/test/possession.test.ts"]
 },
 {
  "id": "retirement-age-strict",
  "kind": "7 off-by-one (age threshold)",
  "file": "participants/src/behaviour/citizen.ts",
  "find": "if (!retired && stopAge !== null && age >= stopAge) {",
  "replace": "if (!retired && stopAge !== null && age > stopAge) {",
  "why": "Citizens stop work a year after the age at which the profile says they do, keeping workers employed and taxed longer.",
  "tests": [
   "orchestrator/test/outcomes.test.ts"
  ]
 },
 {
  "id": "self-sees-position-channels",
  "kind": "8 seat shown another's private data",
  "file": "participants/src/contracts.ts",
  "find": "if (self ? !id.includes(\"/\") : id.startsWith(prefix)) channels[self ? id : id.slice(prefix.length)] = ch;",
  "replace": "if (self ? true : id.startsWith(prefix)) channels[self ? id : id.slice(prefix.length)] = ch;",
  "why": "A person's own view includes the prefixed channels of the posts they hold, so org accounts and records appear as their own and ownAccount may pick the office's money.",
  "tests": []
 },
 {
  "id": "view-cache-stale",
  "kind": "8/other stale view",
  "file": "participants/src/view.ts",
  "find": "if (ch.cells.length || ch.whole) this.cache.delete(id);",
  "replace": "if (ch.whole) this.cache.delete(id);",
  "why": "A participant's cached cell list is not refreshed when new cells arrive, so it keeps acting on a stale picture of the street.",
  "tests": []
 },
 {
  "id": "draw-keyed-on-moment",
  "kind": "9 twin perturbed (draw includes time)",
  "file": "orchestrator/src/run.ts",
  "find": "\"\", purpose, String(occ.n)] : [\"participant\", pid, cap, String(day), purpose, String(occ.n)];",
  "replace": "\"\", purpose, String(occ.n)] : [\"participant\", pid, cap, String(t), purpose, String(occ.n)];",
  "why": "Non-matter draws are keyed on the exact second, so a seat that wakes at another hour than its code twin gets different draws and the twin parts.",
  "tests": [
   "orchestrator/test/reliability.test.ts",
   "orchestrator/test/twin-draws.test.ts",
   "orchestrator/test/twin-draws-seat.test.ts",
   "orchestrator/test/twin-draws-year.test.ts"
  ]
 },
 {
  "id": "spend-draw-includes-time",
  "kind": "9 twin perturbed (module purpose has time)",
  "file": "participants/src/behaviour/firms.ts",
  "find": "pay(ctx.rng(`spend`).pick(shops), spend,",
  "replace": "pay(ctx.rng(`spend-${t}`).pick(shops), spend,",
  "why": "Which shop a landlord's owners spend at is keyed on the time, perturbing it between a pilot and its twin.",
  "tests": [
   "orchestrator/test/twin-draws.test.ts",
   "orchestrator/test/twin-draws-seat.test.ts",
   "orchestrator/test/twin-draws-year.test.ts"
  ]
 },
 {
  "id": "stable-purpose-bypassed",
  "kind": "9 twin perturbed (record number in purpose)",
  "file": "orchestrator/src/run.ts",
  "find": "if (!purpose.includes(\"rec.\")) return purpose;",
  "replace": "if (!purpose.includes(\"rec.\") || true) return purpose;",
  "why": "Record numbers are no longer replaced by per-participant counters, so one more paper anywhere moves every later draw keyed on a record.",
  "tests": [
   "orchestrator/test/twin-draws.test.ts",
   "orchestrator/test/twin-draws-seat.test.ts",
   "orchestrator/test/twin-draws-year.test.ts",
   "orchestrator/test/reliability.test.ts"
  ]
 },
 {
  "id": "bank-batch-refusal-ignored",
  "kind": "10 refusal ignored",
  "file": "participants/src/behaviour/bank.ts",
  "find": "if (last?.status === \"refused\" && inFlight.length > 1) queue.unshift(",
  "replace": "if (last?.status === \"refused\" && inFlight.length > 1000) queue.unshift(",
  "why": "A refused batch of payments is never retried one by one, so all its payments are lost though marked handled.",
  "tests": [
   "orchestrator/test/credit.test.ts"
  ]
 },
 {
  "id": "move-in-ignores-refusal",
  "kind": "10 refusal ignored",
  "file": "participants/src/behaviour/citizen.ts",
  "find": "if (obs.outcomes.at(-1)!.status === \"applied\" && home) home.movedIn = true;",
  "replace": "if (home) home.movedIn = true;",
  "why": "A citizen believes they moved in even when the move was refused, and goes on living by a home they are not in.",
  "tests": [
   "orchestrator/test/home-market.test.ts",
   "orchestrator/test/households.test.ts"
  ]
 },
 {
  "id": "order-queue-late-never-leaves",
  "kind": "11 queue never drained",
  "file": "participants/src/behaviour/retailer.ts",
  "find": "const finished = out !== \"wait\";",
  "replace": "const finished = out === \"done\";",
  "why": "Orders that run out of time ('late') never leave the shop's queue, so they are refunded part-by-part every day.",
  "tests": [
   "orchestrator/test/retail.test.ts"
  ]
 },
 {
  "id": "benefit-slip-outside-slip",
  "kind": "12 slip drawn outside slip()",
  "file": "participants/src/behaviour/world.ts",
  "find": "if (d.ok && slip(ctx, \"publish/benefit_decision\", claimNth.key(c.id, who, payment))) {",
  "replace": "if (d.ok && ctx.rng(`wrong-${c.id}`).below(10_000) < 300) {",
  "why": "The benefit office wrongly refuses 3% of qualifying claims by a private draw instead of the sourced slip table, ignoring the world's table and friction dial.",
  "tests": [
   "orchestrator/test/services.test.ts"
  ]
 },
 {
  "id": "employer-notice-is-pay-period",
  "kind": "13 wrong law/param field",
  "file": "participants/src/behaviour/firms.ts",
  "find": "ourNotice: this.o.notice_days * DAY, theirNotice: this.o.notice_days * DAY,",
  "replace": "ourNotice: this.o.period, theirNotice: this.o.notice_days * DAY,",
  "why": "Employers' own notice in new employment agreements is read from the pay period (seconds) instead of notice_days, giving the wrong notice on redundancies.",
  "tests": [
   "orchestrator/test/unions.test.ts"
  ]
 },
 {
  "id": "rent-tax-uses-penalty-rate",
  "kind": "13 wrong law parameter",
  "file": "participants/src/behaviour/government.ts",
  "find": "const rate: number = law?.record === \"statement\" ? law.data?.rate_bps ?? 1000 : 1000;",
  "replace": "const rate: number = law?.record === \"statement\" ? law.data?.penalty_bps ?? 1000 : 1000;",
  "why": "The tax clerk assesses rent tax at the penalty rate (or 10% default), not the law's rate.",
  "tests": [
   "orchestrator/test/public-finance.test.ts"
  ]
 },
 {
  "id": "tax-clerk-wakes-every-tick",
  "kind": "14 extremely frequent cadence",
  "file": "participants/src/behaviour/government.ts",
  "find": "version: \"0.4.2\",\n  doc: \"docs/behaviour/government.md\",\n  cadence: () => 7 * DAY,",
  "replace": "version: \"0.4.2\",\n  doc: \"docs/behaviour/government.md\",\n  cadence: () => 1,",
  "why": "The tax clerk wakes every tick instead of weekly, a runaway cadence that floods the log with wakes.",
  "tests": [
   "orchestrator/test/run-machinery.test.ts"
  ]
 },
 {
  "id": "payroll-body-wakes-every-tick",
  "kind": "14 extremely frequent cadence",
  "file": "participants/src/behaviour/payroll.ts",
  "find": "cadence: () => 3 * DAY,\n  firstWake",
  "replace": "cadence: () => 1,\n  firstWake",
  "why": "Bodies' payroll officers wake every tick; their round gate keeps the work to 3-day rounds but wakes balloon.",
  "tests": [
   "orchestrator/test/run-machinery.test.ts"
  ]
 },
 {
  "id": "trade-fill-refusal-ignored",
  "kind": "10 refusal ignored",
  "file": "participants/src/behaviour/trade.ts",
  "find": "s.then = (out) => (out.status === \"refused\" ? [fillAs(o, 0,",
  "replace": "s.then = (out) => (out.status === \"refused\" && out.refusal?.code === \"never\" ? [fillAs(o, 0,",
  "why": "A refused delivery is no longer refunded, so the customer has paid and received nothing.",
  "tests": [
   "orchestrator/test/production.test.ts"
  ]
 },
 {
  "id": "household-keeps-the-dead",
  "kind": "3 dead person kept in a register",
  "file": "participants/src/behaviour/citizen.ts",
  "find": "const next: HouseholdData = { ...hh, leaseholder, members: survivors,",
  "replace": "const next: HouseholdData = { ...hh, leaseholder, members: hh.members,",
  "why": "After a death the household's new record still lists the dead member, so the household is counted, housed and paid for one person too many.",
  "tests": [
   "orchestrator/test/deaths.test.ts",
   "orchestrator/test/households.test.ts"
  ]
 },
 {
  "id": "roll-drops-first-elector",
  "kind": "4 person dropped from a register",
  "file": "participants/src/behaviour/elections.ts",
  "find": ".filter((x) => !dead.has(x) && !left.has(x)).sort();",
  "replace": ".filter((x) => !dead.has(x) && !left.has(x)).sort().slice(1);",
  "why": "The electoral roll loses its first elector (an off-by-one slice): one person can never vote.",
  "tests": [
   "orchestrator/test/elections.test.ts"
  ]
 },
 {
  "id": "registry-feeds-not-told",
  "kind": "4 person dropped from a register",
  "file": "participants/src/behaviour/institutions.ts",
  "find": "const told = [...new Set([n.speaks_for, ...((Array.isArray(d.tell) ? d.tell : []) as unknown[]), ...p.feeds,",
  "replace": "const told = [...new Set([n.speaks_for, ...((Array.isArray(d.tell) ? d.tell : []) as unknown[]),",
  "why": "The register of deaths stops sending its entries to those sent them as of right (the roll, pension payers): the dead stay on their rolls and are paid.",
  "tests": [
   "orchestrator/test/deaths.test.ts"
  ]
 },
 {
  "id": "kernel-credit-doubled",
  "kind": "1 payment doubled",
  "file": "kernel/crates/world/src/exec.rs",
  "find": "            b.balance += amount;",
  "replace": "            b.balance += amount * 2;",
  "why": "The kernel credits the payee twice what it debits: money is made from nothing on every payment.",
  "tests": []
 },
 {
  "id": "kernel-overdraft-by-a-dollar",
  "kind": "2 integer-cents / off-by-one in a check",
  "file": "kernel/crates/world/src/exec.rs",
  "find": "} else if src.balance < amount {",
  "replace": "} else if src.balance + 100 < amount {",
  "why": "A payment up to a unit more than the balance goes through: accounts go below nothing.",
  "tests": []
 },
 {
  "id": "kernel-dead-participant-not-ended",
  "kind": "3 dead person still acting",
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
  "kind": "3 dead person still in the world",
  "file": "kernel/crates/world/src/exec.rs",
  "find": "    let mut events = vacate_all(s, st, person, VacateReason::Died, None);",
  "replace": "    let mut events: Vec<Timed> = vec![];",
  "why": "A dead body is not taken out of the spaces it was in: it goes on occupying its home (and its bed).",
  "tests": [
   "orchestrator/test/deaths.test.ts"
  ]
 },
 {
  "id": "kernel-absent-may-work",
  "kind": "5 act by someone not present",
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
  "kind": "work without charging time",
  "file": "kernel/crates/world/src/kernel.rs",
  "find": "        let actor_seconds = if others.is_empty() {\n            seconds\n",
  "replace": "        let actor_seconds = if others.is_empty() {\n            oikos_time::DEFAULT_ACT_SECONDS\n",
  "why": "An act its actor does alone takes one second whatever the world's table says: work is done without spending anyone's time.",
  "tests": [
   "orchestrator/test/day-work.test.ts"
  ]
 },
 {
  "id": "kernel-named-sees-private",
  "kind": "8 seat shown another's private data",
  "file": "kernel/crates/perception/src/observe.rs",
  "find": "    rec.visible_to.allows(entity) || st.author_entity(rec).as_deref() == Some(entity)\n",
  "replace": "    rec.visible_to.allows(entity) || rec.entities_named().iter().any(|e| *e == entity)\n",
  "why": "Being named in a private record is taken for being allowed to see it: a tenant named in the landlord's letter to the bank is shown it.",
  "tests": []
 },
 {
  "id": "kernel-care-draw-by-number",
  "kind": "9 twin perturbed",
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
  "id": "kernel-zero-transfer",
  "kind": "2 integer-cents (amount range)",
  "file": "kernel/crates/world/src/exec.rs",
  "find": "if !(1..=MAX_MONEY).contains(&amount) {",
  "replace": "if !(0..=MAX_MONEY).contains(&amount) {",
  "why": "A transfer of nothing is accepted and logged as a payment: a bill is marked settled by a payment of 0.",
  "tests": []
 },
 {
  "id": "kernel-dead-post-still-held",
  "kind": "contract/post inconsistent at death",
  "file": "kernel/crates/world/src/exec.rs",
  "find": "        st.set_holder(&id, None, c);",
  "replace": "        let _ = (&id, c);",
  "why": "A dead person's posts are announced vacant but stay held in the state: nobody can be appointed and the office stops.",
  "tests": [
   "orchestrator/test/deaths.test.ts"
  ]
 }
];
