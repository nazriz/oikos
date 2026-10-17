//! Tax on pay, as an employer's payroll reads the law (ported from participants/src/behaviour/tax.ts;
//! docs/behaviour/public-finance.md). The arithmetic is `oikos_rules::withholding` (pure, shared with the generator);
//! this is the part that needs a book: the income tax law in force that an actor has seen.

use crate::common::{data, filed_before, Book};
use oikos_sight::Record;
use std::sync::Arc;

pub use oikos_rules::withholding::{
    annual_tax, charges_in_words, charges_on, day_pay_period, returns_in_words, tax_law_of, withheld, withholding, withholding_in_words, Band,
    Charge, IncomeTaxLaw, Withheld,
};

/// The latest of the open laws (statements of kind `law`) that satisfy `test`: the latest published, then the later
/// filed. (`.sort((a, b) => b.at - a.at || ...)[0]` in the TS.)
pub fn latest_law<'a>(book: &'a Book, test: impl Fn(&Record) -> bool) -> Option<&'a Arc<Record>> {
    book.open("law").filter(|r| test(r)).max_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)))
}

/// The income tax law in force that we've seen: the latest published and not withdrawn (none: no income tax).
pub fn income_tax_law(book: &Book) -> Option<IncomeTaxLaw> {
    let l = latest_law(book, |r| {
        let d = data(r);
        d.get("tax").and_then(|t| t.as_str()) == Some("income") && (d.get("brackets").is_some_and(|b| b.is_array()) || d.get("charges").is_some_and(|b| b.is_array()))
    })?;
    tax_law_of(&l.id, data(l), l.speaks_for.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::firms::testkit::{statement, taken};
    use serde_json::json;

    #[test]
    fn the_latest_income_tax_law_not_withdrawn_is_the_one_in_force() {
        let law = |id: &str, at: i64, rate: i64| {
            statement(id, at, "law", json!({ "tax": "income", "charges": [{ "id": "tax", "schedule": [{ "from": 0, "rate_bps": rate }], "account": "a" }] }), "outside")
        };
        let book = taken(vec![law("law-1", 0, 1000), law("law-2", 10, 2000), statement("law-x", 20, "law", json!({ "support": "payments", "payments": [] }), "outside")]);
        let l = income_tax_law(&book).unwrap();
        assert_eq!((l.id.as_str(), l.charges[0].schedule[0].rate_bps, l.charges[0].collector.as_str()), ("law-2", 2000, "outside"));
        assert!(income_tax_law(&Book::new()).is_none());
        // Two laws made at the same moment: the later filed (rec.10 after rec.9).
        let book = taken(vec![law("rec.9", 5, 1000), law("rec.10", 5, 3000)]);
        assert_eq!(income_tax_law(&book).unwrap().id, "rec.10");
    }
}
