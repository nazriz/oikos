//! Support payments, as an actor reads the law (ported from participants/src/behaviour/payments.ts;
//! docs/behaviour/boundary.md, "world.transfers"). The rules and the reckoning are `oikos_rules::support` (pure,
//! shared with the generator and the paying office); this is the part that needs a book: the support law in force.

use super::tax::latest_law;
use crate::common::{data, Book};

pub use oikos_rules::support::{
    age_in, declaration_for, decide, for_age, for_household, for_out_of_work, payer_words, payments_in_words, reads_record, record_since,
    stops_work_at, Amount, Claimant, Declared, Facts, Granted, PaymentRule, Refusal,
};

/// The support law in force that we've seen: the latest published and not withdrawn (none: no payments). A payment
/// that names no payer is its lawmaker's.
pub fn support_law(book: &Book) -> Option<(String, Vec<PaymentRule>)> {
    let l = latest_law(book, |r| data(r).get("payments").is_some_and(|x| x.is_array()))?;
    let mut payments: Vec<PaymentRule> = serde_json::from_value(data(l)["payments"].to_value()).ok()?;
    for p in &mut payments {
        if p.payer.is_empty() {
            p.payer = l.speaks_for.unwrap_or_default().to_string();
        }
    }
    Some((l.id.to_string(), payments))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::firms::testkit::{statement, taken};
    use serde_json::json;

    #[test]
    fn the_support_law_in_force_fills_in_the_lawmaker_as_payer() {
        let law = |id: &str, at: i64, flat: i64| {
            statement(id, at, "law", json!({ "support": "payments", "payments": [{ "id": "pension", "account": "acc-o", "every_days": 14, "amount": { "flat": flat }, "who": { "from_age": 67 } }] }), "outside")
        };
        let book = taken(vec![law("law-1", 0, 100), law("law-2", 9, 200)]);
        let (id, payments) = support_law(&book).unwrap();
        assert_eq!((id.as_str(), payments[0].payer.as_str(), payments[0].amount.clone()), ("law-2", "outside", Amount::Flat { flat: 200 }));
        assert!(for_age(&payments[0]));
        assert!(support_law(&Book::new()).is_none());
    }
}
