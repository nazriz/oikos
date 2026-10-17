//! firm.employer: a manager who staffs a workplace (ported from participants/src/behaviour/firms.ts `employer`, 0.6.5;
//! docs/behaviour/firms.md, "Adjusting labour"; docs/behaviour/staffing.md, "Hiring follows need").
//!
//! It posts jobs while short of the staff it needs and can afford the wage bill, hires among applicants through the
//! ordinary `Staffing` routine, pays wages by standing order through its bank, pays suppliers (the outside world) a
//! share of its revenue, and lays off when it cannot cover a pay period.
//!
//! **What changed in the port (risk ME-2, owner's ruling 2026-10-17: jobs emerge from general market laws).** The TS
//! aimed at `target_staff` whatever it sold. Now `target_staff` is what the firm opened with and the most its premises
//! hold; once it has a month of takings on record it staffs to the trade it expects, smoothed over `smooth_months`
//! (`rules::labour::staff_needed`: the next worker must pay for themselves, with `required_margin_bps` to spare). While
//! over its need it sheds by not replacing leavers and, once the surplus has lasted as long as letting a worker go and
//! hiring again would cost (`LabourPlan::waits`), by letting the most recent hire go. A firm that has no takings (an
//! employer whose output is not sold through its own account) keeps its opening staff: no trade record, no change.
//! Basis: Hamermesh 1993; Holt et al. 1960; Oi 1962 and Davis, Faberman and Haltiwanger 2012 (docs/research/references.md).

use super::staffing::{AdjustParams, LabourPlan, Staffing, StaffingOpts, Want};
use crate::common::{own_account, receipts, Book, MONTH};
use crate::steps::{because, pay, Done, Pay, Plan, Step, Stepper};
use crate::{Actor, Ctx, Cx, Kind, Picture, DAY};
use oikos_rules::labour::{staff_needed, Need};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub struct Employer;

const TS_MANIFEST: &str = include_str!("../../../../../participants/manifests/firm.employer.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Params {
    wage: i64,
    period: i64,
    target_staff: i64,
    notice_days: i64,
    supplier_share_bps: i64,
    buffer_periods: i64,
    outside_account: Option<String>,
    workplace: Option<String>,
    role: String,
    smooth_months: i64,
    hiring_cost_weeks: f64,
    required_margin_bps: i64,
}

impl Params {
    fn read(ctx: &Ctx) -> Result<Params, String> {
        Ok(Params {
            wage: ctx.param("wage", 140_000)?,
            period: ctx.param("period", 14 * DAY)?,
            target_staff: ctx.param("target_staff", 5)?,
            notice_days: ctx.param("notice_days", 14)?,
            supplier_share_bps: ctx.param("supplier_share_bps", 4_000)?,
            buffer_periods: ctx.param("buffer_periods", 2)?,
            outside_account: ctx.param("outside_account", None)?,
            workplace: ctx.param("workplace", None)?,
            role: ctx.param::<Option<String>>("role", None)?.unwrap_or_else(|| "staff".into()),
            smooth_months: ctx.param("smooth_months", 3)?,
            hiring_cost_weeks: ctx.param("hiring_cost_weeks", 0.0)?,
            required_margin_bps: ctx.param("required_margin_bps", 0)?,
        })
    }
}

impl Kind for Employer {
    fn name(&self) -> &'static str {
        "firm.employer"
    }
    fn version(&self) -> &'static str {
        "0.7.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/firms.md"
    }
    fn manifest(&self) -> Value {
        // The TS manifest's keys, plus the three the port adds (hiring by need). Compile-time text, not I/O.
        let mut m: Value = serde_json::from_str(TS_MANIFEST).expect("the TS manifest");
        let ph = "placeholder";
        let params = m["params"].as_object_mut().expect("params");
        params.insert("smooth_months".into(), json!({ "schema": { "type": "integer", "description": "the horizon trade is expected over" }, "unit": "months", "default": 3, "source": ph }));
        params.insert("hiring_cost_weeks".into(), json!({ "schema": { "type": "number", "description": "what taking someone on costs, in weeks of their pay" }, "default": 0, "source": ph }));
        params.insert("required_margin_bps".into(), json!({ "schema": { "type": "integer", "description": "the margin over a worker's pay their trade must clear before one is taken on" }, "unit": "bps", "default": 0, "source": ph }));
        m["version"] = json!(self.version());
        m
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        7 * DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        // (A day of the week of its own, from its name: the TS drew it from its stream before the kind existed.)
        let mut h: u32 = 2_166_136_261;
        for b in ctx.participant.bytes() {
            h = (h ^ u32::from(b)).wrapping_mul(16_777_619);
        }
        i64::from(h % 7) * DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p = Params::read(ctx)?;
        let mut o = StaffingOpts::new(p.period, p.notice_days, &p.role);
        o.workplace = p.workplace.clone();
        o.wakes = Some(7 * DAY);
        let adjust = AdjustParams { smooth_months: p.smooth_months, hiring_cost_weeks: p.hiring_cost_weeks, hours_step_bps: None };
        Ok(Box::new(Stepper::new(Firm {
            staffing: Staffing::new(&ctx.entity, o),
            book: Book::new(),
            labour: LabourPlan::new(adjust, None),
            month_takings: 0,
            seen_takings: false,
            revenue: 0,
            next_suppliers: MONTH,
            next_month: MONTH,
            p,
        })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Firm>::restore(saved)?))
    }
}

#[derive(Serialize, Deserialize)]
struct Firm {
    p: Params,
    staffing: Staffing,
    book: Book,
    labour: LabourPlan,
    /// This month's takings so far, and whether any month has had any.
    month_takings: i64,
    seen_takings: bool,
    /// Revenue since the suppliers were last paid.
    revenue: i64,
    next_suppliers: i64,
    next_month: i64,
}

impl Firm {
    /// The staff the trade expected can pay, within what the premises hold.
    fn needed(&self) -> i64 {
        let monthly_wage = self.p.wage * MONTH / self.p.period.max(1);
        staff_needed(&Need {
            expected_takings: if self.seen_takings { self.labour.expected() } else { -1 },
            bought_in_bps: self.p.supplier_share_bps,
            wage: monthly_wage,
            required_margin_bps: self.p.required_margin_bps,
            capacity: self.p.target_staff,
            opening: self.p.target_staff,
            least: 1,
        })
    }
}

impl Plan for Firm {
    type Then = ();

    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        self.staffing.absorb(pic);
        if let Some(acc) = own_account(pic) {
            let got: i64 = receipts(pic, &acc.account).values().sum();
            self.revenue += got;
            self.month_takings += got;
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let t = pic.t;
        let Some(acc) = own_account(pic) else { return vec![] };
        let usd = |n: i64| crate::common::money_words(n, &cx.ctx.world);
        // A month's end: its takings move the trade we expect (smoothed), if we have had any.
        let mut month_over = false;
        while t >= self.next_month {
            self.next_month += MONTH;
            month_over = true;
        }
        if month_over && (self.month_takings > 0 || self.seen_takings) {
            self.seen_takings = true;
            self.labour.expect(self.month_takings);
        }
        if month_over {
            self.month_takings = 0;
        }
        let staff = self.staffing.staff(&self.book, t);
        let bill = (staff.len() as i64 + 1) * self.p.wage;
        let need = self.needed();
        let held = staff.len() + self.staffing.offered(&self.book, t).len();
        let can_post = acc.balance >= self.p.buffer_periods * bill;
        let why = format!("Short-staffed ({held} of {need}) with {} pay periods of the wage bill in hand: posting a job.", self.p.buffer_periods);
        let mut steps = self.staffing.routine(pic, &self.book, cx, &acc.account, &Want { target: need, wage: self.p.wage, can_post, why: Some(why), ..Default::default() });
        // Can't cover the next pay period: lay off the most recent hire (and the next, at our next look, until those
        // we're keeping can be paid: not everyone, one after another, because the ones already given notice are still counted).
        let keeping = self.staffing.staying(&self.book, t) as i64;
        if keeping > 0 && acc.balance < keeping * self.p.wage {
            let why = format!("Can't cover the next pay period ({} for {keeping} staff): laying off the most recent hire.", usd(acc.balance));
            steps.extend(self.staffing.let_go(&self.book, t, cx, &why, "Redundancy: we can't cover the wage bill."));
        } else if month_over && self.seen_takings {
            // Over what the trade needs for as long as ending a job and hiring again costs: the most recent hire goes.
            let over = keeping > need;
            let years = self.staffing.last_hire_years(&self.book, t);
            let law = super::staffing::termination_law(&self.book);
            let waits = self.labour.waits(law.as_ref(), keeping, years, self.p.notice_days);
            let (let_go, lasted) = self.labour.month(over, waits);
            if let_go {
                let why = format!("Month's end: the trade we expect ({} a month) needs {need} staff and we have {keeping}, and it has lasted {lasted} months: letting the most recent hire go.", usd(self.labour.expected()));
                steps.extend(self.staffing.let_go(&self.book, t, cx, &why, "Redundancy: the work has fallen."));
            }
        }
        // Monthly: pay suppliers (the outside world) for goods sold.
        if t >= self.next_suppliers {
            self.next_suppliers = t + MONTH;
            let due = acc.balance.min(self.revenue * self.p.supplier_share_bps / 10_000);
            self.revenue = 0;
            if let (true, Some(out)) = (due > 0, &self.p.outside_account) {
                steps.push(because(
                    format!("Monthly: paying suppliers {}% of revenue.", self.p.supplier_share_bps as f64 / 100.0),
                    vec![pay(out, due, Pay { from: Some(acc.account.clone()), for_: Some("Suppliers.".into()), ..Default::default() }, cx)],
                ));
            }
        }
        steps
    }

    fn then(&mut self, _: &(), _: Done, _: &mut Cx) -> Vec<Step<()>> {
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn firm(target: i64) -> Firm {
        let mut o = StaffingOpts::new(14 * DAY, 14, "staff");
        o.wakes = Some(7 * DAY);
        Firm {
            p: Params { wage: 140_000, period: 14 * DAY, target_staff: target, notice_days: 14, supplier_share_bps: 4_000, buffer_periods: 2, outside_account: None, workplace: None, role: "staff".into(), smooth_months: 3, hiring_cost_weeks: 0.0, required_margin_bps: 0 },
            staffing: Staffing::new("firm", o),
            book: Book::new(),
            labour: LabourPlan::new(AdjustParams { smooth_months: 3, hiring_cost_weeks: 0.0, hours_step_bps: None }, None),
            month_takings: 0,
            seen_takings: false,
            revenue: 0,
            next_suppliers: MONTH,
            next_month: MONTH,
        }
    }

    #[test]
    fn with_no_trade_on_record_it_keeps_its_opening_staff() {
        assert_eq!(firm(5).needed(), 5);
    }

    #[test]
    fn staff_follow_the_trade_it_expects_within_what_its_premises_hold() {
        let mut f = firm(8);
        f.seen_takings = true;
        // A wage of 140,000 a fortnight is about 300,000 a month (30 days / 14 days); 60% of takings pay the wages.
        f.labour.expect(1_800_000); // 1.08m after bought-in goods: 3 workers at 300k with margin 0 is 900k; 3.6 -> 3
        assert_eq!(f.needed(), 3);
        f.labour.expect(50_000_000);
        f.labour = LabourPlan::new(AdjustParams { smooth_months: 0, hiring_cost_weeks: 0.0, hours_step_bps: None }, None);
        f.labour.expect(50_000_000);
        assert_eq!(f.needed(), 8, "the premises are a ceiling");
        f.labour.expect(10_000);
        assert_eq!(f.needed(), 1, "never below one while it trades");
    }

    #[test]
    fn the_manifest_keeps_the_ts_keys_and_adds_the_ports() {
        let m = Employer.manifest();
        let ts: Value = serde_json::from_str(TS_MANIFEST).unwrap();
        for (k, v) in ts["params"].as_object().unwrap() {
            assert_eq!(&m["params"][k], v, "{k}");
        }
        assert!(m["params"]["smooth_months"].is_object());
    }
}
