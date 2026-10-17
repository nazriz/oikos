//! The lending office's own staff payroll, done by lane C1's `Staffing` (credit.ts built one: `new Staffing(ctx, me, { period,
//! notice_days, role: "staff", does: { hire: false, pay: true }, wakes: DAY })`; foundations F6). The bank's people are on
//! the bank's books from the start of the world; nobody here hires them. What the office does is what any employer's
//! payroll does: sets up each person's wage by standing order through the bank, stops it for a death, pays the tax withheld
//! over, and files the returns on the days the law states. It is asked once a day (`credit::Lender`).

use super::credit::{PayrollMaker, StaffPayroll};
use crate::common::{Book, OwnAccount};
use crate::firms::staffing::{Staffing, StaffingOpts, Want};
use crate::steps::Step;
use crate::{Ctx, Cx, Picture, DAY};
use serde_json::Value;

struct BankStaff {
    staffing: Staffing,
}

impl StaffPayroll for BankStaff {
    fn absorb(&mut self, pic: &Picture, _cx: &mut Cx) {
        self.staffing.absorb(pic);
    }

    fn routine(&mut self, pic: &Picture, book: &Book, own: &OwnAccount, cx: &mut Cx) -> Vec<Step<()>> {
        // (No hiring: nothing is wanted of the headcount, and no job is posted.)
        self.staffing.routine(pic, book, cx, &own.account, &Want { target: 0, wage: 0, can_post: false, ..Default::default() })
    }

    fn save(&self) -> Value {
        serde_json::to_value(&self.staffing).unwrap_or(Value::Null)
    }
}

/// Builds the bank's payroll in this context, from what `save` left (`Null`: new).
pub fn make(ctx: &Ctx, saved: &Value) -> Result<Box<dyn StaffPayroll>, String> {
    let staffing = if saved.is_null() {
        let opts = StaffingOpts { hire: false, pay: true, wakes: Some(DAY), ..StaffingOpts::new(ctx.param("period", 14 * DAY)?, ctx.param("notice_days", 14)?, "staff") };
        Staffing::new(&ctx.entity, opts)
    } else {
        serde_json::from_value(saved.clone()).map_err(|e| format!("{}: its saved payroll: {e}", ctx.participant))?
    };
    Ok(Box::new(BankStaff { staffing }))
}

/// The maker `Lending` takes.
pub const MAKER: PayrollMaker = make;

#[cfg(test)]
mod tests {
    use super::super::credit::Lending;
    use super::super::kit::*;
    use super::{Value, MAKER};
    use serde_json::json;

    const BANK: &str = "bank";

    fn staff_on_the_books(worker: &str, id: &str) -> Vec<Value> {
        vec![
            json!({ "id": id, "record": "agreement", "author": "bank-lending-system", "at": 0, "visible_to": [BANK, worker], "terms": { "template": "employment", "parties": [BANK, worker],
                "commitments": [{ "who": BANK, "does": { "outcome": { "money": { "to": format!("acc-{worker}"), "amount": "300000", "for": "Wages." } } }, "every": 14 * DAY },
                                { "who": worker, "does": { "outcome": { "work": { "at": "bank-hall" } } } }] } }),
            json!({ "id": format!("{id}-a"), "record": "signature", "author": "bank-lending-system", "at": 0, "visible_to": [BANK, worker], "agreement": id, "as": BANK }),
            json!({ "id": format!("{id}-b"), "record": "signature", "author": format!("{worker}-self"), "at": 0, "visible_to": [BANK, worker], "agreement": id, "as": worker }),
        ]
    }

    fn accounts() -> Value {
        json!({ "kind": "accounts", "accounts": [{ "account": "acc-bank", "holder": BANK, "custodian": BANK, "currency": "XTS", "balance": "900000000" }], "transactions": [] })
    }

    fn bank(pay_staff: bool) -> Rig {
        Rig::new(&Lending { payroll: Some(MAKER) }, BANK, "bank-lending-system", json!({ "pay_staff": pay_staff }))
    }

    #[test]
    fn a_bank_that_pays_its_staff_sets_up_their_wages_by_standing_order_and_one_that_does_not_pays_nothing() {
        let mut paying = bank(true);
        let said = paying.at(DAY, json!({ "mine": records(staff_on_the_books("clerk", "emp0")), "bank": accounts() }), json!([]));
        let text = said.iter().map(|c| format!("{c:?}")).collect::<Vec<_>>().join("\n");
        assert!(text.contains("Wages for clerk"), "the clerk's wage is a standing order from the bank's own account: {text}");
        let mut not = bank(false);
        let said = not.at(DAY, json!({ "mine": records(staff_on_the_books("clerk", "emp0")), "bank": accounts() }), json!([]));
        assert!(!said.iter().any(|c| format!("{c:?}").contains("Wages for")), "no pay_staff: the bank pays its staff nothing");
    }

    #[test]
    fn the_bank_payroll_saves_and_the_restored_bank_carries_on_where_it_was() {
        let mut m = bank(true);
        m.at(DAY, json!({ "mine": records(staff_on_the_books("clerk", "emp0")), "bank": accounts() }), json!([]));
        m.snapshot_round_trip();
        let again = m.at(2 * DAY, json!({ "mine": records(vec![]), "bank": accounts() }), json!([]));
        assert!(!again.iter().any(|c| format!("{c:?}").contains("Wages for clerk")), "the wage order already set up is not set up again");
    }
}
