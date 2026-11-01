//! Setting up a firm just founded (docs/behaviour/entry.md, "How a business starts"; foundations-2 7.3, step E3): an
//! account at the bank; the founder's capital, called and paid; its shareholders (the founder); its premises bought from
//! the listing it was founded on. If someone else buys them first, the capital goes back and the firm closes. The same
//! for a shop and a factory, whatever the industry: the firm's own rules take over once it is set up. (Moved here from the
//! retailer unchanged, 2026-11-01, so that a factory can be founded as a shop is.)

use crate::common::{data, money_words, Book, Fields, DAY};
use crate::papers::{self, market::CapitalCall};
use crate::steps::{arg, because, call, pay, say, Pay, Say, Step, Visible};
use crate::{Cx, Picture};
use oikos_sight::Seen;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// A firm just founded (entry.md): who founded it, the capital, the listing it buys its premises from, its bank.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Founding {
    pub founder: Option<String>,
    pub capital: i64,
    pub listing: Option<String>,
    pub bank: String,
}

/// A firm just founded, setting up.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Setup {
    pub account_asked: bool,
    pub capital_called: bool,
    pub founder_account: Option<String>,
    pub registered: bool,
    pub purchased: bool,
    pub ready: bool,
    pub asked: i64,
    pub listings: Option<Vec<String>>,
    pub sold: Option<Vec<String>>,
    pub gone_since: Option<i64>,
}

/// What the setting up reads of the firm: its name, what it is (`shop`, `factory`), its founding, whether it trades from
/// its owner's home, the boards it looks through for its premises' listing and sale (empty: its records hold them), and
/// the premises it was founded for.
pub struct Firm<'a> {
    pub me: &'a str,
    pub what: &'a str,
    pub founding: &'a Founding,
    pub from_home: bool,
    pub sale_board: &'a str,
    pub premises: &'a str,
}

/// The ids a look through a board found, if this wake brings its results.
pub fn found(pic: &Picture, channel: &str) -> Option<Vec<String>> {
    if channel.is_empty() {
        return None;
    }
    match pic.channels.get(channel) {
        Some(Seen::Records { records, search: true }) => Some(records.iter().map(|r| r.id).map(|x| x.to_string()).collect()),
        _ => None,
    }
}

impl Setup {
    /// What a wake brings to a firm setting up: its looks' results (the listings and the sale of its premises), and the
    /// founder's capital as it arrives (the account it comes from is theirs).
    pub fn absorb(&mut self, pic: &Picture, account: Option<&str>, sale_board: &str, sold_board: &str) {
        if self.asked == pic.t {
            if let Some(l) = found(pic, sale_board) {
                self.listings = Some(l);
            }
            if let Some(l) = found(pic, sold_board) {
                self.sold = Some(l);
            }
        }
        if !self.ready && self.capital_called && self.founder_account.is_none() {
            if let Some(mine) = account {
                for tx in pic.transactions() {
                    if tx.to == mine && tx.from != mine {
                        self.founder_account = Some(tx.from.to_string());
                        break;
                    }
                }
            }
        }
    }

    /// Setting up: the steps, and whether the firm closes (its premises were sold to someone else).
    pub fn setting_up<T>(&mut self, firm: &Firm, book: &Book, pic: &Picture, acct: Option<&crate::common::OwnAccount>, cx: &Cx) -> (Vec<Step<T>>, bool) {
        let money = |n| money_words(n, &cx.ctx.world);
        let me = firm.me.to_string();
        let what = firm.what;
        let founder = firm.founding.founder.clone().unwrap_or_default();
        let Some(acc) = acct else {
            if self.account_asked {
                return (vec![], false);
            }
            self.account_asked = true;
            return (vec![because(format!("A new {what}: opening our account at the bank."), vec![call("account", vec![("holder", Some(arg(&me))), ("at", Some(arg(&firm.founding.bank)))])])], false);
        };
        if !self.capital_called {
            self.capital_called = true;
            let cap = firm.founding.capital;
            return (
                vec![because(
                    format!("A new {what}: asking our founder for the {} of capital they're putting in.", money(cap)),
                    vec![say(
                        "capital_call",
                        &format!("Please pay the {} of capital into {}.", money(cap), acc.account),
                        Say {
                            to: Some(vec![founder.clone()]),
                            visible: Some(Visible::Only(vec![me.clone(), founder.clone()])),
                            data: Some(papers::data(&CapitalCall { account: acc.account.clone(), amount: cap })),
                            ..Default::default()
                        },
                    )],
                )],
                false,
            );
        }
        let mut steps: Vec<Step<T>> = vec![];
        if self.founder_account.is_some() && !self.registered {
            self.registered = true;
            steps.push(because(
                "Our shareholders: our founder, who put in the capital.",
                vec![say(
                    "shareholders",
                    &format!("The shareholders of {me}, and their shares."),
                    Say {
                        to: Some(vec![founder.clone()]),
                        visible: Some(Visible::Only(vec![me.clone(), founder.clone()])),
                        data: Some(json!({ "holders": [{ "holder": founder, "account": self.founder_account, "shares": 10_000 }] })),
                        ..Default::default()
                    },
                )],
            ));
        }
        // (A business of one, founded to trade from its owner's home: no premises to buy. Once the capital is in, it trades.)
        if firm.from_home && firm.founding.listing.is_none() {
            if self.founder_account.is_some() {
                self.ready = true;
            }
            if self.ready {
                steps.push(because("Our owner's capital is in: opening for trade, from their home.", vec![]));
            }
            return (steps, false);
        }
        let looked = !firm.sale_board.is_empty();
        if looked && self.listings.is_none() {
            return (steps, false);
        }
        let first = firm.founding.listing.as_deref().and_then(|l| book.get(l)).cloned();
        let structure: Option<String> = if looked { Some(firm.premises.to_string()) } else { first.as_ref().and_then(|f| data(f).s("structure").map(str::to_string)) };
        let standing: Vec<std::sync::Arc<oikos_sight::Record>> = if looked {
            self.listings.iter().flatten().filter_map(|id| book.get(id).cloned()).collect()
        } else {
            book.open("property_for_sale").cloned().collect()
        };
        let mut relisted: Vec<_> = standing.into_iter().filter(|r| data(r).s("structure") == structure.as_deref()).collect();
        relisted.sort_by(|a, b| b.at.cmp(&a.at));
        let listing = relisted.first().cloned().or(if looked { None } else { first.clone() });
        let sold_rec = {
            let pool: Vec<std::sync::Arc<oikos_sight::Record>> = if looked { self.sold.iter().flatten().filter_map(|id| book.get(id).cloned()).collect() } else { book.all("property_sold").cloned().collect() };
            pool.into_iter().find(|r| structure.is_some() && data(r).s("structure") == structure.as_deref())
        };
        if looked && sold_rec.is_none() {
            if listing.is_some() {
                self.gone_since = None;
            } else if *self.gone_since.get_or_insert(pic.t) > pic.t - DAY {
                return (steps, false);
            }
        }
        if let Some(s) = sold_rec.as_ref().filter(|s| data(s).s("buyer") == Some(me.as_str())) {
            self.ready = true;
            steps.push(because(format!("Our premises ({}) are ours: opening for trade.", data(s).s("structure").unwrap_or_default()), vec![]));
            return (steps, false);
        }
        let taken_by_other = sold_rec.is_some() || if looked { listing.is_none() } else { listing.as_ref().is_some_and(|l| book.withdrawn(&l.id)) };
        if taken_by_other {
            // Someone else bought them: the capital goes back, and we close.
            let mut calls = vec![];
            if let (Some(fa), true) = (&self.founder_account, acc.balance > 0) {
                calls.push(pay(fa, acc.balance, Pay { from: Some(acc.account.clone()), for_: Some("Capital returned: the venture didn't go ahead.".into()), ..Default::default() }, cx));
            }
            calls.push(say(
                "closure",
                &format!("{me} didn't open: its premises were sold to someone else."),
                Say { visible: Some(Visible::Public), data: Some(json!({ "firm": me, "to_creditors": 0, "to_shareholders": acc.balance })), ..Default::default() },
            ));
            steps.push(because("The premises we meant to buy were sold to someone else: returning the capital, and closing.", calls));
            self.ready = true; // (the firm never trades: its body, told it is closed, does nothing more)
            self.purchased = true;
            return (steps, true);
        }
        if let Some(l) = &listing {
            let d = data(l);
            if let (Some(price), false) = (d.i("price"), self.purchased) {
                if acc.balance >= price {
                    self.purchased = true;
                    let structure = d.s("structure").unwrap_or_default().to_string();
                    steps.push(because(
                        format!("Buying our premises ({structure}) at the {} asked: publishing our purchase, and paying with it.", money(price)),
                        vec![
                            say(
                                "property_purchase",
                                &format!("Purchase of {structure}, as listed."),
                                Say {
                                    to: l.speaks_for.map(|s| vec![s.to_string()]),
                                    visible: l.speaks_for.map(|s| Visible::Only(vec![me.clone(), s.to_string()])),
                                    basis: Some(l.id.to_string()),
                                    data: Some(json!({ "listing": l.id, "account": acc.account })),
                                    ..Default::default()
                                },
                            ),
                            pay(d.s("account").unwrap_or_default(), price, Pay { from: Some(acc.account.clone()), for_: Some(format!("Premises: {structure}.")), ..Default::default() }, cx),
                        ],
                    ));
                }
            }
        }
        (steps, false)
    }
}
