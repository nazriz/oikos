//! The week's plan (citizen.ts `plan`, 1729-4051): each part in its section's file, called here in the order TS did
//! them, since a part's steps go out in the order planned and some read what an earlier part did this week (a rent
//! missed and paid, a tenancy ended, a job started). The mind's half (needs, upbringing, attachments, goals, wants,
//! gatherings, founding, civic acts, talk) is one call to the mind at the place TS did goals; its steps go out there
//! and the ways it chose are carried out by life (`carry_out`).

use super::household::SAYING;
use super::person::{bound, step_of_lines, Person, Said, Week};
use crate::common::calls::{move_in, move_out, withdraw};
use crate::common::{structure_of, MONTH};
use crate::steps::{because, pay, Pay};
use oikos_rules::household::Member;

impl Person {
    pub fn plan(&mut self, w: &mut Week) {
        let t = w.t;
        if self.s.planned_at == -1 {
            self.learn_from_initial_records(w);
        }
        if self.s.home.is_none() {
            self.find_own_home(w);
        }
        // Our account at a bank (standing orders need one). Money brought from elsewhere is in our own keeping until we
        // deposit it.
        self.begin_money(w);
        self.s.children_now = self.children(t);
        // A death at home or at work (seen at any wake there; here for one first seen as the plan is made).
        self.see_death_at_home(w);
        self.see_death_at_work(w);
        // Newly holding the household's lease (the leaseholder died): we start looking for a home from today. (Not
        // while we live there still: the bug hunt of 2026-10-17 found a partner treated as homeless in the home the
        // two had shared; the landlord offers them the tenancy, `housing::offers` signs it.)
        if self.s.was_leaseholder == Some(false) && self.is_leaseholder() && self.s.home.is_none() && self.s.living_at.is_none() {
            self.s.homeless_since = Some(t);
        }
        self.s.was_leaseholder = Some(self.is_leaseholder());
        if !self.is_leaseholder() {
            if self.other_adult(w) {
                return;
            }
        } else {
            for (from, what) in std::mem::take(&mut self.s.heard) {
                if let Said::Pay(c) = what {
                    self.s.member_pay.insert(from, c);
                }
            }
        }
        if w.acc.is_none() {
            self.without_account(w);
            return;
        }
        self.births(w);
        self.retire_old_rents(w);
        self.tenancy_end(w);
        self.trading_from(w);
        self.unpaid_wages(w);
        self.job_end(w);
        self.switch_start(w);
        if self.s.home.is_none() && self.s.homeless_since.is_none() && self.s.living_at.is_none() {
            self.s.homeless_since = Some(t);
        }
        self.offers(w);
        self.union(w);
        self.answers(w);
        self.opening_caseload(w);
        self.rent_rise(w);
        // Out of work (no job, no work of our own), since this wake if not before: as TS's plan says at each wake
        // (citizen.ts, "joblessSince === null"); the Rust port set it only when a job ended, so someone who had none
        // when the year began was never out of work since any day (tenant-answers.test.ts).
        if self.s.job.is_none() && self.s.own_work.is_none() && self.s.jobless_since.is_none() {
            self.s.jobless_since = Some(t);
        }
        self.possession(w);
        self.ordered_to_pay_rent(w);
        self.hours_asked(w);
        self.short_pay(w);
        self.disrepair(w);
        self.left_homes(w);
        self.move_into_home(w);
        self.stay_with_someone(w);
        if self.leaving_town(w) {
            return;
        }
        self.complaints(w);
        self.hunt_home(w);
        self.stop_work(w);
        self.claims(w);
        self.look_for_work(w);
        self.ventures(w);
        self.borrowing(w);
        self.utilities(w);
        self.ordered_to_pay(w);
        self.taking(w);
        self.recorded_against(w);
        self.spending(w);
        self.shopping(w);
        self.use_up(w);
        self.selling_and_buying(w);
        self.justice(w);
        self.schooling_and_care(w);
        // The mind's half (citizen.ts 1966-2531 and what it owns outright: needs, upbringing, attachments, views,
        // goals, wants and their ways, gatherings, founding, civic life, petitions, word of mouth), after life's own
        // for the week; its first steps go before all others (TS's `unshift`).
        let planned = self.mind_plan(w);
        for (i, s) in planned.first.into_iter().enumerate() {
            if !s.lines.is_empty() {
                w.steps.insert(i, s.into());
            }
        }
        for s in planned.steps {
            w.push(s);
        }
        self.s.mind_wake_at = planned.wake_at;
        for c in planned.chosen {
            self.carry_out(w, &c.opening.intent, Some(&c.why));
        }
        for i in planned.intents {
            self.carry_out(w, &i, None);
        }
        for (what, by) in self.mind.troubles_to_tell() {
            self.tell_household_trouble(w, &what, &by);
        }
        // (What was new this week has been planned with.)
        self.take_fresh();
    }

    /// Deposits, and rent the bank could not pay, paid now, oldest first, once there's enough.
    fn begin_money(&mut self, w: &mut Week) {
        let me = self.me.clone();
        let ours: Vec<_> = w.pic.accounts().filter(|a| a.holder == me).map(|a| (a.account.clone(), a.custodian.clone(), crate::common::money::cents(a.balance))).collect();
        let Some(acc) = w.acc.clone() else { return };
        for (account, custodian, balance) in ours {
            if custodian == me && balance > 0 {
                w.push(because(
                    "Depositing the money we brought into our bank account.",
                    vec![pay(&acc.account, balance, Pay { from: Some(account), for_: Some("Deposit.".into()), ..Default::default() }, w.cx)],
                ));
            }
        }
        while let Some(x) = self.s.missed.first().cloned() {
            let bal = w.acc.as_ref().map_or(0, |a| a.balance);
            if x.amount > bal {
                break;
            }
            self.s.missed.remove(0);
            if let Some(a) = w.acc.as_mut() {
                a.balance -= x.amount;
            }
            let what = if x.what == "the rent" { "Rent" } else { "Share of the rent" };
            w.push(because(
                format!("The bank couldn't pay {} ({}) when it was due: paying it now.", x.what, crate::common::money_words(x.amount, &w.cx.ctx.world)),
                vec![pay(&x.to, x.amount, Pay { from: Some(acc.account.clone()), for_: Some(format!("{what} missed ({}).", x.instruction)), ..Default::default() }, w.cx)],
            ));
        }
    }

    /// Another adult in the household: we live where the household lives, move when the leaseholder says, pay our
    /// share, and tell the leaseholder what we earn. True: the plan ends here (leaving with the household).
    fn other_adult(&mut self, w: &mut Week) -> bool {
        let t = w.t;
        let me = self.me.clone();
        if self.s.living_at.is_none() && matches!(w.pic.channels.get("street"), Some(oikos_sight::Seen::Sites { .. })) {
            self.s.living_at = super::person::spaces(w.pic).find(|sp| sp.kind == "dwelling" && super::person::occupants(sp).contains(&me)).map(|sp| sp.space.clone());
        }
        for (_, what) in std::mem::take(&mut self.s.heard) {
            match what {
                Said::MoveIn(space) if Some(&space) != self.s.living_at.as_ref() => {
                    let mut calls = vec![];
                    if let Some(l) = &self.s.living_at {
                        if super::person::inside(w.pic, &me, l) {
                            calls.push(move_out(l, &me));
                        }
                    }
                    calls.push(move_in(&space));
                    w.push(because(format!("The household has a new home ({space}): moving in with them."), calls));
                    self.s.gave_up.remove(&space);
                    self.s.living_at = Some(space);
                }
                Said::MoveOut(from) if self.s.living_at.as_deref().is_some_and(|l| structure_of(l) == from) => {
                    let l = self.s.living_at.take().unwrap_or_default();
                    if super::person::inside(w.pic, &me, &l) {
                        w.push(because("The household's tenancy has ended: moving out with them.", vec![move_out(&from, &me)]));
                    }
                    self.s.gave_up.insert(l);
                }
                Said::Share { cents, account } if w.acc.is_some() && cents != self.s.share.as_ref().map_or(0, |s| s.0) => {
                    let acc = w.acc.clone().unwrap_or_else(|| unreachable!());
                    let mut lines = vec![];
                    if let Some((_, Some(o))) = &self.s.share {
                        lines.push(oikos_sight::calls::Line { bind: None, call: withdraw(o, Some("Replaced by a new share of the rent.")) });
                    }
                    if cents > 0 {
                        lines.push(bound(
                            "share",
                            pay(&account, cents, Pay { from: Some(acc.account.clone()), every: Some(MONTH), first: Some(0), for_: Some("Household share of the rent.".into()), ..Default::default() }, w.cx),
                        ));
                    }
                    if !lines.is_empty() {
                        w.push(step_of_lines(format!("Our share of the household's rent is now {} a month, as the leaseholder says.", crate::common::money_words(cents, &w.cx.ctx.world)), lines));
                    }
                    self.s.share = (cents > 0).then_some((cents, None));
                }
                Said::Leaving => {
                    self.departure(w, "The household is leaving town: going with them.");
                    return true;
                }
                _ => {}
            }
        }
        if w.acc.is_none() {
            self.without_account(w);
            return true;
        }
        // The leaseholder budgets with what we earn: we tell them when it changes (said once, until the words change:
        // a household in the first living pilot was sent "My pay is now 0.00" 478 times in 60 days).
        let lh: Option<Member> = self.s.household.as_ref().and_then(|h| h.member(&h.leaseholder).cloned());
        if let Some(lh) = lh {
            let said = SAYING::pay(self.monthly_income(t), &w.cx.ctx.world);
            if said != self.s.pay_told_as {
                self.s.pay_told_as = said.clone();
                w.push(because("Telling the leaseholder what we now earn, for the household's budget.", vec![crate::common::letters::message(&[lh.reach().to_string()], &said, None)]));
            }
        }
        false
    }

    /// A trouble that befell us, told to the household (the mind found it to tell: `SAYING.trouble`).
    fn tell_household_trouble(&mut self, w: &mut Week, what: &str, by: &str) {
        let to: Vec<String> = self.adults(w.t).iter().map(|m| m.reach().to_string()).collect();
        if to.is_empty() {
            return;
        }
        w.push(because("Telling the household what has befallen us.", vec![crate::common::letters::message(&to, &SAYING::trouble(what, by), None)]));
    }
}
