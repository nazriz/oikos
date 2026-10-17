//! city.finance_officer, city.tax_clerk, city.rates_officer, city.works: the town's treasury and works offices.
//! Ported to Rust from participants/src/behaviour/government.ts (finance_officer 0.10.1, tax_clerk 0.4.2,
//! rates_officer 0.4.2 + the bug-hunt fix of 2026-10-17, works 0.6.2); versions are the TS manifests' (the guide
//! holds the manifest equal), the Rust port is noted here. Documented in docs/behaviour/public-finance.md,
//! government.md and services.md.
//!
//! **Where the Rust decides fresh (docs/port-guide.md, section 2).**
//! - *What an office keeps is read from its own file* (bug hunt 2026-10-17, finding 2; risks WM-7, PB-6, PB-19): a
//!   successor in a post carries on and neither repeats work nor holds a levy out of cycle. The rates officer reads
//!   when its last notices went out and the interest charged on each claim from its own `rates_notice` and
//!   `rates_interest` papers; the tax clerk reads which reports are assessed and which are chased from its own `tax`
//!   and `tax_penalty` claims; the finance officer reads its wage standing orders from the requests on file; the
//!   works office reads its standing work from the orders on file (a crew's order is never in a holder's memory), its
//!   notices of leaving from the notices on its agreements, its last disposal from its dockets, its complaints from
//!   the papers addressed to it. A staff part stands in the post and follows the order whoever is in it.
//! - *Memory only where no paper records the thing* (and it is a cache of what the office was shown): payments into
//!   and out of the account (the account's statement), what the crew found at each address, the invoices paid.
//!   A new holder of the finance, rates or tax post starts these from the statement it is shown; the report says so.
//! - A stage that moves on only when its act is applied: a refused payment, assessment, penalty, interest or
//!   notice is tried again at the next wake.
//! - Order: owners, invoices and addresses are walked in id order (`filed_before` for record ids), not hash or
//!   insertion order. Money is `i64` cents; percentages are written from integers.
//! - `Math.round`: none needed. First wake of the works office: a stable spread by the participant's id.
//! - Payroll: C1's `Staffing` (`firms::staffing`) for the finance officer (pays: a wage by standing order, tax withheld
//!   and reported) and for the works office (hires and sends the payroll notices of starters and leavers).
//! - Papers read by someone (PB-7): `payroll_notice` by the finance officer; `rates_notice`, `rates_interest` and
//!   `tax_penalty` by their payers (citizen, landlord) and by the issuing office itself; `disposal_docket` by the
//!   works office (its next weekly round) and the landfill; `staff_report` by the office-holder. The finance
//!   officer's letter to the mayor for an approval is read by the mayor.

use crate::firms::staffing::{Own, Staffing, StaffingOpts, Want};
use super::systems::{DeskParams, DeskThen, OfficeDesk};
use crate::firms::tax::{income_tax_law, withholding};
use super::auditor::{Answerer, Audited, InBank, InBooks, Statement};
use crate::common::work::ReportOf;
use crate::common::{
    addressed_to, approval_of, bases_of, bill_settled, cents, data, filed_before, is_kind, message,
    money_words, out_of_time, own_account, record, team, variable_today, visited, when_words,
    CounterWork, Directions, Fields, Letters, Part, StandingWork, DAY, MONTH, YEAR,
};
use crate::papers::agreements::{self, job_terms};
use crate::papers::firms::TaxReport;
use crate::papers::market::{Invoice, Valuation};
use crate::papers::offices::{Approval, Budget, Direction, DisposalDocket, Law, RatesNotice};
use crate::papers::{self, data as paper_data};
use crate::steps::{arg, because, call, json, pay, say, text, Done, Pay, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_rules::forms::{self, Answers, Issued};
use oikos_sight::calls::Call;
use oikos_sight::{LookRequest, Record, RecordBody, Seen, SiteStructure};
use oikos_contracts::blocks::Position;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

// ------------------------------------------------------------------ shared small things

/// Whether a paper is the office's own: made in this position, or by this participant where it has none.
fn ours(r: &Record, position: &Option<String>, participant: &str) -> bool {
    match position {
        Some(p) => r.position.as_deref() == Some(p.as_str()),
        None => r.author == participant,
    }
}

/// An integer over `per` written as JavaScript wrote the number: `1250/10000` -> "0.125", `10/1` -> "10".
fn trimmed(n: i64, per: i64) -> String {
    let (w, f) = (n / per, (n % per).abs());
    if f == 0 {
        return w.to_string();
    }
    let digits = per.to_string().len() - 1;
    let s = format!("{f:0digits$}");
    format!("{w}.{}", s.trim_end_matches('0'))
}

/// A stable spread over `span` seconds from a participant's id (FNV-1a): the kind has no random stream at first wake.
fn spread(ctx: &Ctx, base: i64, span: i64) -> i64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in ctx.participant.bytes() {
        h = (h ^ u64::from(b)).wrapping_mul(0x100000001b3);
    }
    base + (h % span.max(1) as u64) as i64
}

fn answers_of(raw: &str) -> Answers {
    serde_json::from_str(raw).unwrap_or(Answers { office: String::new(), acts: String::new(), forms: vec![], report: false })
}

/// The manifest: the TS manifest's keys, its forms issued from the catalogue, and what the office says of itself.
fn manifest_of(raw: &str, answers: &str, issues: Option<Vec<Issued>>) -> Value {
    let mut m: Value = serde_json::from_str(raw).unwrap_or(Value::Null);
    if let (Some(i), Some(o)) = (issues, m.as_object_mut()) {
        o.insert("issues".into(), serde_json::to_value(i).unwrap_or(Value::Null));
    }
    if let (Ok(a), Some(o)) = (serde_json::from_str::<Value>(answers), m.as_object_mut()) {
        o.insert("answers".into(), a);
    }
    m
}

fn str_param(ctx: &Ctx, key: &str, default: &str) -> Result<String, String> {
    ctx.param(key, default.to_string())
}

fn dir_of(r: &Record) -> Option<Direction> {
    papers::read::<Direction>(r)
}

fn claim_parts(r: &Record) -> Option<(&Position, &str, Option<&str>, &Value)> {
    match &r.body {
        RecordBody::Claim { position, holder, counterparty, about } => Some((position, holder.as_str(), counterparty.as_deref(), about)),
        _ => None,
    }
}

/// A right the town holds, of this kind, made by this office.
fn rights_of<'a>(book: &'a crate::common::Book, me: &'a str, kind: &'a str) -> impl Iterator<Item = &'a Arc<Record>> + 'a {
    book.of_type("claim").filter(move |c| claim_parts(c).is_some_and(|(p, h, _, a)| *p == Position::Right && h == me && a.s("kind") == Some(kind)))
}

fn age_year(t: i64) -> i64 {
    t.div_euclid(YEAR) + 1
}

fn year_in_days(year: i64) -> String {
    format!("day {} to day {}", (year - 1) * 365, year * 365 - 1)
}

const MANIFEST_FINANCE: &str = r##"{
  "name": "city.finance_officer",
  "version": "0.10.1",
  "doc": "docs/behaviour/government.md",
  "params": {
    "budget_lines": {
      "schema": {
        "type": "object"
      },
      "default": {},
      "source": "placeholder"
    },
    "compliance_bps": {
      "schema": {
        "type": "integer"
      },
      "unit": "bps",
      "default": 10000,
      "source": "placeholder"
    },
    "lines_by_position": {
      "schema": {
        "type": "object"
      },
      "default": {},
      "source": "placeholder"
    },
    "lines_by_structure": {
      "schema": {
        "type": "object"
      },
      "default": {},
      "source": "placeholder"
    },
    "notice_days": {
      "schema": {
        "type": "integer"
      },
      "unit": "days",
      "default": 14,
      "source": "placeholder"
    },
    "part": {
      "schema": {},
      "source": "the world gives it (no default)"
    },
    "payroll_wait_days": {
      "schema": {
        "type": "integer",
        "description": "how long it waits for the hiring office's notice of a new starter before setting the wage up from the agreement on file"
      },
      "unit": "days",
      "default": 3,
      "source": "placeholder"
    },
    "period": {
      "schema": {
        "type": "integer"
      },
      "default": 1209600,
      "source": "placeholder"
    },
    "procedure": {
      "schema": {
        "type": "string",
        "description": "the record its approval rule comes from (who approves a payment over what sum: its `data.approval`); withdrawn, or none, and no approval is asked"
      },
      "default": "",
      "source": "placeholder"
    }
  },
  "perceives": [],
  "state": "none",
  "issues": [
    {
      "form": "withholding_return",
      "title": "Return of tax withheld from wages, to a collector",
      "does": "Reports to a collector what has been withheld from the wages paid in a period and what is paid over with it. It moves no money: what is paid over is paid besides, by a payment to each collector's account. The office's books count what is withheld and not yet paid over from the day of the last return. The law on tax from pay lists its returns and the day each falls due by; one return reports the charges the law names for it, and the books say which return falls due next.",
      "fields": {
        "collector": {
          "type": "entity",
          "required": true,
          "description": "The collector reported to."
        },
        "account": {
          "type": "account",
          "required": true,
          "description": "The account the wages were paid from."
        },
        "period_end": {
          "type": "date",
          "required": true,
          "description": "The day the period ended."
        },
        "withheld": {
          "type": "amount",
          "required": true,
          "description": "What was withheld in the period, in all."
        },
        "paid": {
          "type": "amount",
          "required": true,
          "description": "What is paid over now, in all."
        },
        "law": {
          "type": "record",
          "description": "The law it is withheld under: the tax law that lists the return (it names the charges each return reports; report them in that return, not in another)."
        }
      },
      "writes": {
        "kind": "withholding_report",
        "text": "Withheld from wages, owed: {withheld}; paid now: {paid}.",
        "basis": "=law",
        "to": [
          "=collector"
        ],
        "visible": [
          "=self",
          "=collector"
        ],
        "data": {
          "account": "=account",
          "paid": "#paid",
          "period_end": "=period_end",
          "withheld": "#withheld"
        }
      }
    },
    {
      "form": "audit_answer",
      "title": "Answer to the audit office's request for a named item",
      "does": "Answers the audit office's public request under the audit law, by the day it gives: the count of your decisions of a kind in a period, one of them by its number with its file, or your payments for the period against the bank's record. Say only what your books show. It does nothing else by itself.",
      "fields": {
        "request": {
          "type": "record",
          "required": true,
          "description": "The request this answers."
        },
        "auditor": {
          "type": "entity",
          "required": true,
          "description": "The audit office."
        },
        "audit": {
          "type": "text",
          "required": true,
          "description": "The audit's key, as the request gives it."
        },
        "ask": {
          "type": "choice",
          "required": true,
          "options": [
            "count",
            "nth",
            "statement"
          ],
          "description": "What was asked for."
        },
        "nth": {
          "type": "count",
          "description": "For a decision by its number: which."
        },
        "count": {
          "type": "count",
          "description": "For a count: how many."
        },
        "statement": {
          "type": "text",
          "description": "The books' entries asked for, in words."
        }
      },
      "writes": {
        "kind": "audit_answer",
        "text": "Answer to audit request {request}: {statement}",
        "basis": "=request",
        "to": [
          "=auditor"
        ],
        "visible": [
          "=auditor",
          "=self"
        ],
        "data": {
          "request": "=request",
          "audit": "=audit",
          "ask": "=ask",
          "nth": "=nth",
          "count": "=count"
        }
      }
    }
  ]
}"##;

const MANIFEST_TAX: &str = r##"{
 "name": "city.tax_clerk",
 "version": "0.4.2",
 "doc": "docs/behaviour/government.md",
 "params": {
  "grace_days": {
   "schema": {
    "type": "integer"
   },
   "unit": "days",
   "default": 45,
   "source": "placeholder"
  },
  "law": {
   "schema": {
    "type": "string"
   },
   "default": "law-tax",
   "source": "placeholder"
  }
 },
 "perceives": [],
 "state": "none"
}"##;

const MANIFEST_RATES: &str = r##"{
  "name": "city.rates_officer",
  "version": "0.4.3",
  "doc": "docs/behaviour/public-finance.md",
  "params": {
    "automation": {
      "schema": {},
      "default": null,
      "source": "placeholder"
    },
    "casework": {
      "schema": {},
      "default": null,
      "source": "placeholder"
    },
    "directed_under": {
      "schema": {
        "type": "string"
      },
      "default": "",
      "source": "placeholder"
    },
    "direction_compliance_bps": {
      "schema": {
        "type": "integer"
      },
      "unit": "bps",
      "default": 10000,
      "source": "placeholder"
    },
    "first_day": {
      "schema": {
        "type": "integer"
      },
      "default": 30,
      "source": "placeholder"
    },
    "law": {
      "schema": {
        "type": "string"
      },
      "default": "law-rates",
      "source": "placeholder"
    },
    "office": {
      "schema": {
        "type": "string",
        "description": "where its clerks work, as a standing order names it (none given: the office itself)"
      },
      "default": "",
      "source": "placeholder"
    },
    "part": {
      "schema": {
        "type": "string"
      },
      "default": "",
      "source": "placeholder"
    },
    "procurement": {
      "schema": {},
      "default": null,
      "source": "placeholder"
    }
  },
  "perceives": [],
  "state": "none",
  "keeps": [
    {
      "what": "valuation",
      "why": "The rating authority keeps the rate book: the valuer sends it the valuation of every rateable lot, which is what it levies on."
    }
  ],
  "takes": [
    {
      "form": "rates_recovery",
      "title": "Recovery direction to the rates officer",
      "fields": {
        "interest": {
          "type": "choice",
          "options": [
            "yes",
            "no"
          ],
          "required": true,
          "description": "Whether rates left unpaid after their due date are charged the law's penalty interest: yes, as the office does of its own accord; no, none is added."
        }
      },
      "follows": "While a direction with interest no stands, the rates officer adds no penalty interest to overdue rates and writes to nobody about them. The rates themselves are still levied and still owed, and interest already recorded stays on record."
    }
  ],
  "routines": [
    {
      "task": "levy",
      "at": "office",
      "follows": [
        "law",
        "law-rates"
      ],
      "what": "At each instalment the rating law sets, the rates clerks send every owner on the rate book a notice of their share and record it as owed to the town; each month they add the law's penalty interest to what is overdue and write to the owner. When the notices go out is the law's: the first once the valuer has valued the town's properties and not before the office's first levy day, then one for each instalment the law sets, evenly through the year (two instalments a year are 182 days apart, four are 91). The order says only that they are to be sent."
    }
  ]
}"##;

const MANIFEST_WORKS: &str = r##"{
  "name": "city.works",
  "version": "0.6.2",
  "doc": "docs/behaviour/services.md",
  "params": {
    "collect_every_days": {
      "schema": {
        "type": "integer"
      },
      "unit": "days",
      "default": 7,
      "source": "placeholder"
    },
    "collect_labour": {
      "schema": {
        "type": "integer"
      },
      "default": 0,
      "source": "placeholder"
    },
    "collect_per_unit": {
      "schema": {
        "type": "integer"
      },
      "default": 0,
      "source": "placeholder"
    },
    "collect_task": {
      "schema": {
        "type": "string"
      },
      "default": "collect",
      "source": "placeholder"
    },
    "counter": {
      "schema": {
        "type": "boolean"
      },
      "default": false,
      "source": "placeholder"
    },
    "depot": {
      "schema": {
        "type": "string",
        "description": "its depot, and the space the crew works in there (the world must say)"
      },
      "default": "",
      "required": true,
      "source": "its depot, and the space the crew works in there (the world must say)"
    },
    "depot_channel": {
      "schema": {
        "type": "string",
        "description": "the channel that shows the depot, with who's there by name"
      },
      "default": "depot",
      "source": "placeholder"
    },
    "directed_under": {
      "schema": {
        "type": "string"
      },
      "default": "",
      "source": "placeholder"
    },
    "direction_compliance_bps": {
      "schema": {
        "type": "integer"
      },
      "unit": "bps",
      "default": 10000,
      "source": "placeholder"
    },
    "dispose_every_days": {
      "schema": {
        "type": "integer"
      },
      "unit": "days",
      "default": 7,
      "source": "placeholder"
    },
    "industry": {
      "schema": {
        "type": "string",
        "description": "what the work is (its postings say)"
      },
      "default": "",
      "source": "placeholder"
    },
    "inspections": {
      "schema": {
        "type": "string"
      },
      "default": "",
      "source": "placeholder"
    },
    "kind": {
      "schema": {
        "type": "string"
      },
      "default": "waste",
      "source": "placeholder"
    },
    "landfill": {
      "schema": {
        "type": "string"
      },
      "default": "",
      "required": true,
      "source": "placeholder"
    },
    "look_at": {
      "schema": {
        "type": "integer"
      },
      "default": 0,
      "source": "placeholder"
    },
    "look_days": {
      "schema": {
        "type": "integer"
      },
      "unit": "days",
      "default": 5,
      "source": "placeholder"
    },
    "maintain_labour": {
      "schema": {
        "type": "integer"
      },
      "default": 0,
      "source": "placeholder"
    },
    "maintain_over": {
      "schema": {
        "type": "integer"
      },
      "default": 0,
      "source": "placeholder"
    },
    "maintain_per_unit": {
      "schema": {
        "type": "integer"
      },
      "default": 0,
      "source": "placeholder"
    },
    "maintain_task": {
      "schema": {
        "type": "string"
      },
      "default": "maintain",
      "source": "placeholder"
    },
    "notice_days": {
      "schema": {
        "type": "integer"
      },
      "unit": "days",
      "default": 14,
      "source": "placeholder"
    },
    "part": {
      "schema": {
        "type": "string"
      },
      "default": "",
      "source": "placeholder"
    },
    "payroll_office": {
      "schema": {
        "type": "string",
        "description": "the office of the town that pays its staff, which is sent notice of starters and leavers (the world says; none: no notice is sent)"
      },
      "default": "",
      "source": "placeholder"
    },
    "period": {
      "schema": {
        "type": "integer"
      },
      "default": 1209600,
      "source": "placeholder"
    },
    "role": {
      "schema": {
        "type": "string"
      },
      "default": "works crew",
      "source": "placeholder"
    },
    "round": {
      "schema": {
        "type": "string"
      },
      "default": "",
      "source": "placeholder"
    },
    "staff_line": {
      "schema": {
        "type": "string"
      },
      "default": "staff",
      "source": "placeholder"
    },
    "wage": {
      "schema": {
        "type": "integer"
      },
      "default": 0,
      "source": "placeholder"
    },
    "waste": {
      "schema": {
        "type": "string",
        "description": "per unit: seconds of work, and waste taken"
      },
      "default": "waste",
      "source": "placeholder"
    },
    "wear": {
      "schema": {
        "type": "string",
        "description": "wear worth a crew's time above this"
      },
      "default": "wear",
      "source": "placeholder"
    },
    "work_days": {
      "schema": {
        "type": "integer"
      },
      "unit": "days",
      "default": 5,
      "source": "placeholder"
    },
    "working_day": {
      "schema": {
        "type": "integer",
        "description": "when its staff are in (a time of day on working days: the world's; 0, whenever it wakes)"
      },
      "default": 28800,
      "source": "placeholder"
    },
    "workplace": {
      "schema": {
        "type": "string"
      },
      "default": "",
      "required": true,
      "source": "placeholder"
    }
  },
  "perceives": [],
  "state": "none",
  "keeps": [
    {
      "what": "service_address",
      "why": "The round is the works office's own: it makes an entry for each address its crew collects from, and adds to it as homes are built."
    }
  ],
  "takes": [
    {
      "form": "works_staffing",
      "title": "Staffing direction to the works office",
      "fields": {
        "recruit": {
          "type": "choice",
          "options": [
            "yes",
            "no"
          ],
          "required": true,
          "description": "Whether the works office recruits: yes, it advertises and fills the posts it is short of; no, it advertises none and takes nobody on."
        },
        "posts": {
          "type": "count",
          "description": "The most works crew it is to have, where that is fewer than its budget pays for. Left out: as many as the budget pays for."
        }
      },
      "follows": "While a direction with recruit no stands, the works office advertises no post, takes down the advertisements it has out and offers nobody employment. With recruit yes it recruits up to what its budget pays for, or up to posts where that is fewer. Nobody is stood down by it and nobody's pay changes."
    },
    {
      "form": "works_collection",
      "title": "Collection direction to the works office",
      "fields": {
        "every": {
          "type": "duration",
          "required": true,
          "description": "How often each address on the round is to be collected from (a week, a fortnight)."
        }
      },
      "follows": "While it stands, the crew collects from each address on the round once in that time, as its hours allow, homes complained about first. With no direction, the office keeps to its own round."
    }
  ],
  "issues": [
    {
      "form": "job_advertisement",
      "title": "Job advertisement",
      "does": "How the office takes on staff of its own: it puts the posts on the jobs board at the wage given, for people to apply, and the office then offers employment to those it takes on. It commits no money until someone is taken on.",
      "fields": {
        "wage": {
          "type": "amount",
          "required": true,
          "description": "The wage for each pay period."
        },
        "period": {
          "type": "duration",
          "required": true,
          "description": "The pay period: how often the wage is paid."
        },
        "posts": {
          "type": "count",
          "required": true,
          "description": "How many posts this advertisement is for."
        },
        "account": {
          "type": "account",
          "description": "The account the wages are paid from, where the office itself pays them."
        }
      },
      "writes": {
        "kind": "job_posting",
        "text": "Hiring: {wage} every {period}.",
        "data": {
          "wage": "#wage",
          "period": "=period",
          "role": "@role",
          "industry": "@industry",
          "workplace": "@workplace_structure",
          "space": "@workplace"
        },
        "offer": {
          "by": "=self",
          "to": {
            "min_age_years": 18
          },
          "take_up": "apply",
          "available": "=posts",
          "terms": {
            "template": "employment",
            "commitments": [
              {
                "who": "=self",
                "does": {
                  "outcome": {
                    "money": {
                      "from": "=account",
                      "amount": "=wage",
                      "for": "wages"
                    }
                  }
                },
                "every": "=period"
              },
              "@occupancy"
            ],
            "termination": "@termination"
          }
        }
      }
    },
    {
      "form": "payroll_starter",
      "title": "Payroll notice of a new starter, to the office that pays the organisation's staff",
      "does": "Tells the office that pays the organisation's staff that someone has been taken on, with what it needs to set their wage up. It pays nobody by itself: the paying office sets the payment up. Write to that office too, naming the notice: a paper on the organisation's own file is not put in front of it.",
      "fields": {
        "employee": {
          "type": "entity",
          "required": true,
          "description": "Who has been taken on."
        },
        "post": {
          "type": "text",
          "required": true,
          "description": "The post they hold."
        },
        "agreement": {
          "type": "record",
          "required": true,
          "description": "The employment agreement, signed by both."
        },
        "wage": {
          "type": "amount",
          "required": true,
          "description": "The wage for each pay period, before tax."
        },
        "period": {
          "type": "duration",
          "required": true,
          "description": "The pay period."
        },
        "first_pay": {
          "type": "date",
          "required": true,
          "description": "The first pay day (a pay period after both signed, unless the agreement says otherwise)."
        },
        "account": {
          "type": "account",
          "required": true,
          "description": "The account the wage is paid into."
        }
      },
      "writes": {
        "kind": "payroll_notice",
        "text": "Payroll notice, new starter: {employee}, {post}, under employment agreement {agreement}. Pay: {wage} every {period} before tax, into {account}; first pay day {first_pay}, then every {period}. The post is one of those the {@budget_line} line of the adopted budget pays for: the wage is on that line. For the {@payroll_office} office: the wage payment is to be set up from that day.",
        "basis": "=agreement",
        "to": [
          "=self"
        ],
        "visible": [
          "=self"
        ],
        "data": {
          "notice": "starter",
          "office": "@payroll_office",
          "employee": "=employee",
          "post": "=post",
          "agreement": "=agreement",
          "wage": "=wage",
          "period": "=period",
          "first_pay": "=first_pay",
          "account": "=account",
          "line": "@budget_line"
        }
      }
    },
    {
      "form": "payroll_leaver",
      "title": "Payroll notice of a leaver, to the office that pays the organisation's staff",
      "does": "Tells the office that pays the organisation's staff that someone's employment is ending and when, so that their wage payment ends then. It ends no employment and stops no payment by itself. Write to that office too, naming the notice.",
      "fields": {
        "employee": {
          "type": "entity",
          "required": true,
          "description": "Who is leaving."
        },
        "post": {
          "type": "text",
          "required": true,
          "description": "The post they held."
        },
        "agreement": {
          "type": "record",
          "required": true,
          "description": "The employment agreement that is ending."
        },
        "last_day": {
          "type": "date",
          "required": true,
          "description": "The last day of the employment."
        },
        "reason": {
          "type": "choice",
          "required": true,
          "options": [
            "notice",
            "died"
          ],
          "description": "Why it ends."
        }
      },
      "writes": {
        "kind": "payroll_notice",
        "text": "Payroll notice, leaver: {employee}, {post}, employment agreement {agreement} ends on {last_day} ({reason}). For the {@payroll_office} office: pay is due to that day, and the wage payment under the agreement is to end then.",
        "basis": "=agreement",
        "to": [
          "=self"
        ],
        "visible": [
          "=self"
        ],
        "data": {
          "notice": "leaver",
          "office": "@payroll_office",
          "employee": "=employee",
          "post": "=post",
          "agreement": "=agreement",
          "last_day": "=last_day",
          "reason": "=reason"
        }
      }
    },
    {
      "form": "disposal_docket",
      "title": "Docket for waste delivered to the landfill",
      "does": "Goes with a load of waste taken to the landfill: what was delivered and how much, which the landfill charges by.",
      "fields": {
        "kind": {
          "type": "text",
          "required": true,
          "description": "What was delivered."
        },
        "quantity": {
          "type": "count",
          "required": true,
          "description": "How much of it."
        }
      },
      "writes": {
        "sends": [
          {
            "to": [
              "@landfill"
            ],
            "why": "The landfill takes the load and charges by the docket."
          }
        ],
        "kind": "disposal_docket",
        "text": "Delivered: {quantity} of {kind}.",
        "to": [
          "@landfill"
        ],
        "visible": [
          "=self",
          "@landfill"
        ],
        "data": {
          "kind": "=kind",
          "quantity": "=quantity"
        }
      }
    }
  ],
  "routines": [
    {
      "task": "collect",
      "at": "depot",
      "every": [
        "collect_every_days",
        7
      ],
      "what": "The crew at the depot collects waste from each address on the round as often as the order says, homes complained about first, as far as its hours go, and takes what it has collected to the landfill each week with a docket."
    },
    {
      "task": "maintain",
      "at": "depot",
      "every": 1,
      "what": "With the hours the round leaves, the crew keeps up the most worn of the town's own assets, and someone is sent to inspect an asset nobody has seen."
    },
    {
      "task": "answer",
      "at": "depot",
      "every": 1,
      "what": "The office's counter staff sort the day's post that is routine under this procedure and answer it, each working day, so that the works manager is not brought back for it.",
      "papers": [
        {
          "kind": "complaint",
          "how": "a complaint of a collection missed puts the home first on the next round of collection"
        }
      ]
    }
  ]
}"##;


// ================================================================== city.tax_clerk


/// city.tax_clerk: administers the tax law. For each tax report it records the tax owed as a claim (the town's right,
/// the reporter's duty) at the law's rate; watches the town's account for payment; after `grace_days` unpaid, records
/// the law's penalty and sends a demand. It works only from what is reported: under-reporting is invisible to it.
/// Ported 2026-10-17; the assessments and penalties are read from its own claims (a successor does not assess twice).
pub struct TaxClerk;

#[derive(Clone, Serialize, Deserialize)]
enum TaxThen {
    Assess(String),
    Chase(String),
}

#[derive(Serialize, Deserialize)]
struct TaxPlan {
    grace_days: i64,
    law: String,
    me: String,
    position: Option<String>,
    participant: String,
    book: crate::common::Book,
    letters: Letters,
    /// Paying account -> total received into the town's account (the account's statement: no paper records it).
    received: BTreeMap<String, i64>,
    /// Acts planned and not yet seen on the file ("assess:<report>" / "chase:<report>").
    in_flight: BTreeSet<String>,
    /// Reports whose tax came to nothing (a cache; nothing is recorded for them).
    zero: BTreeSet<String>,
}

struct Assessed {
    report: String,
    claim: String,
    payer: String,
    account: String,
    amount: i64,
    at: i64,
}

impl TaxPlan {
    fn new(ctx: &Ctx) -> Result<Self, String> {
        Ok(TaxPlan {
            grace_days: ctx.param("grace_days", 45)?,
            law: str_param(ctx, "law", "law-tax")?,
            me: ctx.entity.clone(),
            position: ctx.position.clone(),
            participant: ctx.participant.clone(),
            book: Default::default(),
            letters: Default::default(),
            received: BTreeMap::new(),
            in_flight: BTreeSet::new(),
            zero: BTreeSet::new(),
        })
    }
    /// Its own assessments, read from its file, oldest first.
    fn assessed(&self) -> Vec<Assessed> {
        let mut v: Vec<Assessed> = rights_of(&self.book, &self.me, "tax")
            .filter(|c| ours(c, &self.position, &self.participant))
            .filter_map(|c| {
                let (_, _, payer, about) = claim_parts(c)?;
                let report = bases_of(c).first()?.clone();
                let account = self.book.get(&report).map(|r| data(r).s("account").unwrap_or("").to_string()).unwrap_or_default();
                Some(Assessed { report, claim: c.id.clone(), payer: payer.unwrap_or("").to_string(), account, amount: about.i("amount").unwrap_or(0), at: c.at })
            })
            .collect();
        v.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.claim, &b.claim)));
        v
    }
}

fn pct(bps: i64) -> String {
    trimmed(bps, 100)
}

impl Plan for TaxPlan {
    type Then = TaxThen;
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        self.letters.take(pic, &self.book);
        if let Some(acc) = own_account(pic) {
            for tx in pic.transactions() {
                if tx.to == acc.account {
                    *self.received.entry(tx.from.clone()).or_insert(0) += cents(tx.amount);
                }
            }
        }
    }
    fn then(&mut self, tok: &TaxThen, done: Done, _: &mut Cx) -> Vec<Step<TaxThen>> {
        if !done.applied() {
            self.in_flight.remove(&match tok {
                TaxThen::Assess(r) => format!("assess:{r}"),
                TaxThen::Chase(r) => format!("chase:{r}"),
            });
        }
        vec![]
    }
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<TaxThen>> {
        let t = pic.t;
        let me = self.me.clone();
        let mut steps = vec![];
        // The law in force (itself, or what has replaced it). Withdrawn with nothing in its place: no tax is assessed
        // and no new penalty recorded.
        let law = self.book.current(&self.law).and_then(|l| papers::read::<Law>(l));
        let repealed = self.book.repealed(&self.law);
        let rate = law.as_ref().and_then(|l| l.rate_bps).unwrap_or(1000);
        let penalty = law.as_ref().and_then(|l| l.penalty_bps).unwrap_or(2000);
        let assessed = self.assessed();
        let penalised: BTreeSet<String> = rights_of(&self.book, &me, "tax_penalty").flat_map(|c| bases_of(c).to_vec()).collect();
        self.in_flight.retain(|k| match k.split_once(':') {
            Some(("assess", r)) => !assessed.iter().any(|a| a.report == r),
            Some(("chase", r)) => !penalised.contains(r),
            _ => false,
        });
        let reports: Vec<Arc<Record>> = self.book.open("tax_report").cloned().collect();
        for rep in reports {
            if repealed {
                break;
            }
            if !addressed_to(&rep).contains(&me)
                || assessed.iter().any(|a| a.report == rep.id)
                || self.in_flight.contains(&format!("assess:{}", rep.id))
                || self.zero.contains(&rep.id)
            {
                continue;
            }
            let Some(r) = papers::read::<TaxReport>(&rep) else { continue };
            let payer = rep.speaks_for.clone().unwrap_or_default();
            let amount = r.rent_received * rate / 10_000;
            if amount > 0 {
                self.in_flight.insert(format!("assess:{}", rep.id));
                let mut s = because(
                    format!("A tax report: recording the tax owed at the law's rate ({}%).", pct(rate)),
                    vec![record("right", &me, json!({ "kind": "tax", "amount": amount, "period_end": r.period_end }), Some(&payer), Some(&rep.id))],
                );
                s.then = Some(TaxThen::Assess(rep.id.clone()));
                steps.push(s);
            } else {
                self.zero.insert(rep.id.clone());
            }
        }
        // Chase: what has arrived from each account is applied to its assessments, oldest first; one still unpaid
        // after the grace period is chased, once.
        let mut applied: BTreeMap<&str, i64> = BTreeMap::new();
        for a in &assessed {
            let up_to = applied.get(a.account.as_str()).copied().unwrap_or(0) + a.amount;
            applied.insert(a.account.as_str(), up_to);
            if repealed || penalised.contains(&a.report) || self.in_flight.contains(&format!("chase:{}", a.report)) || t - a.at < self.grace_days * DAY {
                continue;
            }
            if self.received.get(&a.account).copied().unwrap_or(0) >= up_to {
                continue;
            }
            let fine = a.amount * penalty / 10_000;
            self.in_flight.insert(format!("chase:{}", a.report));
            let mut s = because(
                format!("Tax still unpaid after {} days: recording the law's penalty ({}%) and writing to the payer.", self.grace_days, pct(penalty)),
                vec![
                    record("right", &me, json!({ "kind": "tax_penalty", "amount": fine }), Some(&a.payer), Some(&a.report)),
                    message(std::slice::from_ref(&a.payer), &format!("Tax of {} on report {} is overdue; a penalty of {} has been recorded.", money_words(a.amount, &cx.ctx.world), a.report, money_words(fine, &cx.ctx.world)), Some(&a.report)),
                ],
            );
            s.then = Some(TaxThen::Chase(a.report.clone()));
            steps.push(s);
        }
        if !self.letters.is_empty() {
            let total: i64 = assessed.iter().map(|a| a.amount).sum();
            let accounts: BTreeSet<&str> = assessed.iter().map(|a| a.account.as_str()).collect();
            let paid_in: i64 = accounts.iter().map(|a| self.received.get(*a).copied().unwrap_or(0)).sum();
            let chased: BTreeSet<&str> = assessed.iter().filter(|a| penalised.contains(&a.report)).map(|a| a.payer.as_str()).collect();
            let w = &cx.ctx.world;
            let report = format!(
                "Report from the tax clerk: {} tax reports assessed, {} owed under the tax law ({}% of rent), {} received from those who owe it.{}",
                assessed.len(),
                money_words(total, w),
                pct(rate),
                money_words(paid_in, w),
                if chased.is_empty() { " Nothing is overdue.".to_string() } else { format!(" Overdue, with penalties recorded: {}.", chased.into_iter().collect::<Vec<_>>().join(", ")) }
            );
            steps.extend(self.letters.answer::<TaxThen>(None, "A letter to our office: answering with our standard report.", |_| report.clone()));
        }
        steps
    }
}

impl Kind for TaxClerk {
    fn name(&self) -> &'static str {
        "city.tax_clerk"
    }
    fn version(&self) -> &'static str {
        "0.4.2"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/government.md"
    }
    fn manifest(&self) -> Value {
        manifest_of(MANIFEST_TAX, "null", None)
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        7 * DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::new(TaxPlan::new(ctx)?)))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<TaxPlan>::restore(saved)?))
    }
}

// ================================================================== city.rates_officer

const RATES_ANSWERS: &str = r#"{"office":"the rates office","acts":"What it acts on: the valuer's valuations, on which it levies under the rating law; a payment that names the rates it pays; and a direction on its recovery form (rates_recovery) from those the town's rule on directions names.","report":true}"#;

/// city.rates_officer: administers the rating law (docs/behaviour/public-finance.md). From the latest valuation of
/// each property it reckons a year's rates at the law's rate on its value, and every instalment sends each owner a
/// notice for their share, recorded as the town's claim against them (payable into the town's account, by the due
/// date). What is still unpaid after the due date draws the law's penalty interest, monthly, recorded as a claim too,
/// with a letter. A payment settles a claim when it names it (or the notice that goes with it).
///
/// Bug hunt 2026-10-17, finding 2: when the last notices went out and the interest charged on each claim are read
/// from the office's own file (its `rates_notice` papers and `rates_interest` claims, by position), so a new holder
/// carries on and does not levy out of cycle or charge a month's interest twice.
pub struct RatesOfficer;

#[derive(Clone, Serialize, Deserialize)]
enum RatesThen {
    /// A chunk of notices to these owners (a refused one is sent again).
    Levy(Vec<String>),
    /// Interest charged on a claim at this moment.
    Interest(String, i64),
    /// What follows from the office's dealings with systems.
    Desk(DeskThen),
}

impl From<DeskThen> for RatesThen {
    fn from(d: DeskThen) -> Self {
        RatesThen::Desk(d)
    }
}

#[derive(Serialize, Deserialize)]
struct RatesPlan {
    law: String,
    first_day: i64,
    office: String,
    me: String,
    position: Option<String>,
    participant: String,
    book: crate::common::Book,
    letters: Letters,
    directions: Directions,
    routines: StandingWork,
    /// Claims (or notices) a payment into our account has named (the account's statement: no paper records it).
    settled: BTreeSet<String>,
    received: i64,
    /// When the next notices go out: a cache, kept at least as late as the file says.
    next: i64,
    report_day: i64,
    /// Owners whose notice was refused: sent again.
    retry: BTreeSet<String>,
    /// Interest charged and not yet on the file.
    interest_cache: BTreeMap<String, i64>,
    /// The systems it may take up to write its notices (docs/behaviour/automation.md): none unless the world gives it.
    desk: OfficeDesk,
}

impl RatesPlan {
    fn new(ctx: &Ctx) -> Result<Self, String> {
        let under = str_param(ctx, "directed_under", "")?;
        let bps: i64 = ctx.param("direction_compliance_bps", 10_000)?;
        let part = Part::from_param(&str_param(ctx, "part", "")?);
        let first_day: i64 = ctx.param("first_day", 30)?;
        Ok(RatesPlan {
            law: str_param(ctx, "law", "law-rates")?,
            first_day,
            office: str_param(ctx, "office", "")?,
            me: ctx.entity.clone(),
            position: ctx.position.clone(),
            participant: ctx.participant.clone(),
            book: Default::default(),
            letters: Default::default(),
            directions: Directions::new(ctx, &under, Some(bps), "the rates office"),
            routines: StandingWork::new(&ctx.entity, part, []),
            settled: BTreeSet::new(),
            received: 0,
            next: first_day * DAY,
            report_day: -1,
            retry: BTreeSet::new(),
            interest_cache: BTreeMap::new(),
            desk: OfficeDesk::new(&ctx.entity, DeskParams::read(ctx)?),
        })
    }
    fn paid(&self, c: &Record) -> bool {
        bill_settled(&self.book, c, &self.settled)
    }
    /// The rates claims we hold, in the order made.
    fn rates_claims(&self) -> Vec<Arc<Record>> {
        rights_of(&self.book, &self.me, "rates").cloned().collect()
    }
}

impl Plan for RatesPlan {
    type Then = RatesThen;
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        self.desk.absorb(&self.book);
        self.letters.take(pic, &self.book);
        if let Some(acc) = own_account(pic) {
            for tx in pic.transactions() {
                if tx.to == acc.account {
                    if let Some(s) = &tx.settles {
                        self.settled.insert(s.clone());
                        self.received += cents(tx.amount);
                    }
                }
            }
        }
    }
    fn then(&mut self, tok: &RatesThen, done: Done, _: &mut Cx) -> Vec<Step<RatesThen>> {
        if let RatesThen::Desk(d) = tok {
            self.desk.then(d, done);
            return vec![];
        }
        if !done.applied() {
            match tok {
                RatesThen::Levy(owners) => self.retry.extend(owners.iter().cloned()),
                RatesThen::Interest(c, at) => {
                    if self.interest_cache.get(c) == Some(at) {
                        self.interest_cache.remove(c);
                    }
                }
                RatesThen::Desk(_) => {}
            }
        }
        vec![]
    }
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<RatesThen>> {
        let t = pic.t;
        let me = self.me.clone();
        let mut steps: Vec<Step<RatesThen>> = vec![];
        // The law in force (itself, or what has replaced it); withdrawn with nothing in its place, nothing is levied.
        let law_rec = self.book.current(&self.law).cloned();
        let terms = law_rec.as_ref().and_then(|l| papers::read::<Law>(l)).unwrap_or_default();
        let rate_ppm = terms.rate_ppm.unwrap_or(0);
        let instalments = terms.instalments.unwrap_or(4).max(1);
        let due_days = terms.due_days.unwrap_or(30);
        let interest_bps = terms.penalty_interest_bps.unwrap_or(0);
        let Some(acc) = own_account(pic) else { return steps };
        let every = (365 / instalments) * DAY;
        // The office's own file: when the last notices went out, and when interest was last charged on each claim.
        let last_notices = self.book.open("rates_notice").filter(|n| ours(n, &self.position, &self.participant)).map(|n| n.at).max();
        if let Some(l) = last_notices {
            self.next = self.next.max(l + every);
        }
        let mut last_interest: BTreeMap<String, i64> = self.interest_cache.clone();
        for r in rights_of(&self.book, &me, "rates_interest").filter(|r| ours(r, &self.position, &self.participant)) {
            for b in bases_of(r) {
                let e = last_interest.entry(b.clone()).or_insert(i64::MIN);
                *e = (*e).max(r.at);
            }
        }
        if self.routines.part != Part::Staff {
            steps.extend(self.desk.steps::<RatesThen>(&mut self.book, t, &acc.account, acc.balance, 1, 0, cx));
        }
        let office_at = if !self.office.is_empty() { self.office.clone() } else { self.position.clone().unwrap_or_else(|| "office".into()) };
        let why = "Setting the rates clerks' work: the notices sent at each instalment and interest added to what is overdue, as a standing work order.";
        steps.extend(self.routines.set::<RatesThen>(&self.book, &[crate::common::work::Routine { task: "levy", at: &office_at, every, why }]));
        let levying = self.routines.does(&self.book, "levy", t, DAY).is_some();
        let has_valuations = self.book.open("valuation").next().is_some();
        // Notices: each owner's share of a year's rates on what they own, as last valued. (Not before there are
        // valuations: until 2026-10-02 the first instalment went out on the first morning, levied nothing, and the
        // next waited a quarter.)
        let all = levying && law_rec.is_some() && t >= self.next && rate_ppm > 0 && has_valuations;
        let again = levying && law_rec.is_some() && rate_ppm > 0 && has_valuations && !self.retry.is_empty();
        if let (true, Some(law)) = (all || again, law_rec.as_ref()) {
            if all {
                self.next = t + every;
            }
            let mut latest: BTreeMap<String, Valuation> = BTreeMap::new();
            let mut vals: Vec<&Arc<Record>> = self.book.open("valuation").collect();
            vals.sort_by_key(|v| v.at);
            for v in vals {
                if let Some(p) = papers::read::<Valuation>(v) {
                    latest.insert(p.lot.clone(), p);
                }
            }
            let mut by_owner: BTreeMap<String, (Vec<String>, i64)> = BTreeMap::new();
            for v in latest.values() {
                let o = by_owner.entry(v.owner.clone()).or_default();
                o.0.push(v.lot.clone());
                o.1 += (i128::from(v.value) * i128::from(rate_ppm) / (1_000_000 * i128::from(instalments))) as i64;
            }
            let wanted = std::mem::take(&mut self.retry);
            let mut owners: Vec<String> = vec![];
            let mut lines: Vec<(String, Vec<Call>)> = vec![];
            for (owner, (lots, amount)) in &by_owner {
                if *amount <= 0 || !(all || wanted.contains(owner)) {
                    continue;
                }
                let due = t + due_days * DAY;
                let n = RatesNotice { amount: *amount, lots: lots.clone(), due, account: acc.account.clone() };
                lines.push((
                    owner.clone(),
                    vec![
                        say(
                            "rates_notice",
                            &format!("Rates notice: {} on {}, due in {} days, into {}.", money_words(*amount, &cx.ctx.world), lots.join(", "), due_days, acc.account),
                            Say { to: Some(vec![owner.clone()]), visible: Some(Visible::Only(vec![me.clone(), owner.clone()])), basis: Some(law.id.clone()), data: Some(paper_data(&n)), ..Default::default() },
                        ),
                        record("right", &me, json!({ "kind": "rates", "amount": amount, "account": acc.account, "due": due, "lots": lots }), Some(owner), Some(&law.id)),
                    ],
                ));
                owners.push(owner.clone());
            }
            self.routines.did("levy", t, lines.len() as i64, &[]);
            for chunk in lines.chunks(15) {
                let calls: Vec<Call> = chunk.iter().flat_map(|(_, c)| c.clone()).collect();
                let who: Vec<String> = chunk.iter().map(|(o, _)| o.clone()).collect();
                let mut s = because(
                    format!("The rates instalment: a {}'s rates at the law's {}% of each property's value.", if instalments == 1 { "year".to_string() } else { format!("{instalments}th of a year") }, trimmed(rate_ppm, 10_000)),
                    calls,
                );
                s.then = Some(RatesThen::Levy(who));
                self.desk.assign(&mut s, "rates_notice"); // (a system of ours that writes them does, if we hold one)
                steps.push(s);
            }
        }
        // The clerks' note for their report, once a day (docs/behaviour/standing-work.md, "The staff's report").
        if levying {
            let note = if law_rec.is_none() || rate_ppm <= 0 {
                Some("the rating law on file sets no rate, so no notice is sent".to_string())
            } else if !has_valuations {
                Some("no property has been valued yet: the first notices go out once the valuer has valued".to_string())
            } else {
                Some(format!("the next notices go out on {}, as the rating law's instalments fall", when_words(self.next, &cx.ctx.world)))
            };
            self.routines.note("levy", note);
        }
        if self.routines.part == Part::Staff && self.report_day != t.div_euclid(DAY) {
            self.report_day = t.div_euclid(DAY);
            let office = self.position.clone().unwrap_or_default();
            let office = office.strip_suffix("-staff").unwrap_or(&office).to_string();
            let of = ReportOf { office: &office, from: "the rates clerks", tasks: vec![("levy", "instalments", Some("notices"))], ..Default::default() };
            steps.extend(self.routines.report::<RatesThen>(&self.book, cx, &of));
        }
        // Overdue: penalty interest, monthly, on what is still unpaid after its due date (unless a recovery direction
        // that stands, from whoever the town says may direct us, says to add none).
        let no_interest = self.directions.standing(&self.book, "rates_recovery", cx).and_then(|d| dir_of(d)).is_some_and(|d| d.interest.as_deref() == Some("no"));
        if self.routines.part != Part::Staff {
            steps.extend(self.directions.letters::<RatesThen>(&self.book, |d, _| {
                if dir_of(d).is_some_and(|x| x.interest.as_deref() == Some("no")) {
                    "No penalty interest is added to overdue rates while it stands; the rates are still owed.".to_string()
                } else {
                    "Overdue rates are charged the law's penalty interest.".to_string()
                }
            }));
        }
        if levying && interest_bps > 0 && !no_interest {
            for c in self.rates_claims() {
                let Some((_, _, Some(owner), about)) = claim_parts(&c) else { continue };
                let due = about.i("due").unwrap_or(i64::MAX);
                if self.paid(&c) || t < due {
                    continue;
                }
                if t - last_interest.get(&c.id).copied().unwrap_or(due) < 30 * DAY {
                    continue;
                }
                self.interest_cache.insert(c.id.clone(), t);
                let amount = about.i("amount").unwrap_or(0);
                let interest = amount * interest_bps / 10_000 / 12;
                if interest > 0 {
                    let w = &cx.ctx.world;
                    let mut s = because(
                        format!("Rates overdue a month or more: recording a month's penalty interest ({}% a year) and writing to the owner.", pct(interest_bps)),
                        vec![
                            record("right", &me, json!({ "kind": "rates_interest", "amount": interest, "account": acc.account }), Some(owner), Some(&c.id)),
                            message(&[owner.to_string()], &format!("Rates of {} are overdue; interest of {} has been added.", money_words(amount, w), money_words(interest, w)), Some(&c.id)),
                        ],
                    );
                    s.then = Some(RatesThen::Interest(c.id.clone(), t));
                    steps.push(s);
                }
            }
        }
        if !self.letters.is_empty() {
            let w = &cx.ctx.world;
            let claims = self.rates_claims();
            let overdue: BTreeSet<String> = claims
                .iter()
                .filter(|c| !self.paid(c) && claim_parts(c).is_some_and(|(_, _, _, a)| t >= a.i("due").unwrap_or(i64::MAX)))
                .filter_map(|c| claim_parts(c).and_then(|(_, _, o, _)| o.map(String::from)))
                .collect();
            let levied: i64 = claims.iter().filter_map(|c| claim_parts(c).and_then(|(_, _, _, a)| a.i("amount"))).sum();
            let valued = self.book.open("valuation").filter_map(|v| data(v).s("lot").map(String::from)).collect::<BTreeSet<_>>().len();
            let report = if law_rec.is_none() {
                format!(
                    "Report from the rates officer: {}; {} levied so far, {} received.",
                    if self.book.repealed(&self.law) { "the rating law has been withdrawn, so no rates are levied" } else { "there is no rating law that we know of, so no rates are levied" },
                    money_words(levied, w),
                    money_words(self.received, w)
                )
            } else {
                let when = if valued == 0 {
                    " No property has been valued yet (the valuer values every property once a year): the first notices go out once it has.".to_string()
                } else if t >= self.next {
                    " The next instalment's notices go out today.".to_string()
                } else {
                    format!(" The next instalment's notices go out on day {}.", self.next / DAY + 1)
                };
                format!(
                    "Report from the rates officer: rates at {}% of value a year, in {} instalments, each due {} days after its notice; {} properties valued; {} levied so far, {} received.{}{}",
                    trimmed(rate_ppm, 10_000),
                    instalments,
                    due_days,
                    valued,
                    money_words(levied, w),
                    money_words(self.received, w),
                    when,
                    if overdue.is_empty() { " Nothing is overdue.".to_string() } else { format!(" Overdue: {}.", overdue.into_iter().collect::<Vec<_>>().join(", ")) }
                )
            };
            let answers = answers_of(RATES_ANSWERS);
            steps.extend(self.letters.answer::<RatesThen>(Some(&answers), "A letter to our office: answering with our standard report.", |_| report.clone()));
        }
        steps
    }
    fn until(&self, _: &Picture) -> Option<i64> {
        None
    }
}

impl Kind for RatesOfficer {
    fn name(&self) -> &'static str {
        "city.rates_officer"
    }
    fn version(&self) -> &'static str {
        "0.4.3"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/public-finance.md"
    }
    fn manifest(&self) -> Value {
        manifest_of(MANIFEST_RATES, RATES_ANSWERS, None)
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::new(RatesPlan::new(ctx)?)))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<RatesPlan>::restore(saved)?))
    }
}

// ================================================================== city.finance_officer

const FINANCE_ANSWERS: &str = r#"{"office":"the finance office","acts":"What it acts on: an invoice addressed to the town, paid within the adopted budget (over the payments procedure's figure, once the mayor's written approval is on file); a payroll notice from an office that has taken someone on or is losing someone; and the tax withheld from wages, paid over each month. It does not start, stop or change a payment on a letter.","forms":[{"about":["approv"],"say":"An approval of an invoice is the mayor's to give, in writing, naming the invoice."}],"report":true}"#;

/// city.finance_officer: pays the town's invoices within the adopted budget, runs the town's payroll, and reports.
/// Pays within the adopted budget of the year it is in; while the year has none, under the budget last adopted at a
/// twelfth a month (the charter's interim rule); spending is reckoned by the year. An invoice over the payments
/// procedure's figure waits for the written approval of the post the procedure names, which it asks of that post once.
pub struct FinanceOfficer;

#[derive(Clone, Serialize, Deserialize)]
enum FinThen {
    /// An invoice paid.
    Paid(String),
}

#[derive(Clone, Serialize, Deserialize)]
struct Flow {
    t: i64,
    amount: i64,
    party: String,
}

#[derive(Serialize, Deserialize)]
struct FinPlan {
    compliance_bps: i64,
    budget_lines: BTreeMap<String, String>,
    period: i64,
    procedure: String,
    payroll_wait_days: i64,
    lines_by_structure: BTreeMap<String, String>,
    lines_by_position: BTreeMap<String, String>,
    me: String,
    book: crate::common::Book,
    letters: Letters,
    /// The town's payroll: whose staff the town has, their wages by standing order, the tax withheld (C1's `Staffing`).
    staff: Staffing,
    /// Invoices paid: id -> (sum, year). Read from the account's statement and from our own payments.
    paid: BTreeMap<String, (i64, i64)>,
    /// Invoices a payment is under way for.
    pending: BTreeMap<String, (i64, i64)>,
    /// Our books of what we paid against an invoice, and the bank's record of it as the account shows it (the audit office
    /// asks for both: docs/behaviour/auditor.md): invoice -> (sum, when).
    booked: BTreeMap<String, (i64, i64)>,
    banked: BTreeMap<String, (i64, i64)>,
    audited: Audited,
    /// Invoices the mayor has been asked to approve (a letter: no paper records it).
    asked: BTreeSet<String>,
    flows: Vec<Flow>,
    /// The year the town's wages are counted from, and what the payroll had paid (gross) when it began.
    wages_year: i64,
    wages_at_year: i64,
}

impl FinPlan {
    fn new(ctx: &Ctx) -> Result<Self, String> {
        let period: i64 = ctx.param("period", 14 * DAY)?;
        let notice_days: i64 = ctx.param("notice_days", 14)?;
        let payroll_wait_days: i64 = ctx.param("payroll_wait_days", 3)?;
        Ok(FinPlan {
            compliance_bps: ctx.param("compliance_bps", 10_000)?,
            budget_lines: ctx.param("budget_lines", BTreeMap::new())?,
            period,
            procedure: str_param(ctx, "procedure", "")?,
            payroll_wait_days,
            lines_by_structure: ctx.param("lines_by_structure", BTreeMap::new())?,
            lines_by_position: ctx.param("lines_by_position", BTreeMap::new())?,
            me: ctx.entity.clone(),
            book: Default::default(),
            letters: Default::default(),
            staff: Staffing::new(
                &ctx.entity,
                StaffingOpts { hire: false, pay: true, notice_wait: Some(payroll_wait_days * DAY), wakes: Some(3 * DAY), ..StaffingOpts::new(period, notice_days, "staff") },
            ),
            paid: BTreeMap::new(),
            pending: BTreeMap::new(),
            booked: BTreeMap::new(),
            banked: BTreeMap::new(),
            audited: Audited::new(&ctx.entity),
            asked: BTreeSet::new(),
            flows: vec![],
            wages_year: 0,
            wages_at_year: 0,
        })
    }
    fn spent(&self, year: i64) -> i64 {
        let paid: i64 = self.paid.values().filter(|(_, y)| *y == year).map(|(a, _)| a).sum();
        let pend: i64 = self.pending.iter().filter(|(k, (_, y))| *y == year && !self.paid.contains_key(*k)).map(|(_, (a, _))| a).sum();
        paid + pend
    }
}

impl Plan for FinPlan {
    type Then = FinThen;
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        self.staff.absorb(pic);
        self.letters.take(pic, &self.book);
        if let Some(mine) = own_account(pic).map(|a| a.account) {
            for x in pic.transactions() {
                let amount = cents(x.amount);
                if x.to == mine && x.from != mine {
                    self.flows.push(Flow { t: x.t, amount, party: x.from.clone() });
                }
                if x.from == mine && x.to != mine {
                    self.flows.push(Flow { t: x.t, amount: -amount, party: x.to.clone() });
                    if let Some(s) = &x.settles {
                        self.paid.insert(s.clone(), (amount, age_year(x.t)));
                        self.banked.insert(s.clone(), (amount, x.t));
                        self.pending.remove(s);
                    }
                }
            }
            let cut = pic.t - 365 * DAY;
            self.flows.retain(|f| f.t > cut);
        }
    }
    fn then(&mut self, tok: &FinThen, done: Done, _: &mut Cx) -> Vec<Step<FinThen>> {
        match tok {
            FinThen::Paid(inv) => {
                if !done.applied() {
                    self.pending.remove(inv);
                }
            }
        }
        vec![]
    }
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<FinThen>> {
        let t = pic.t;
        let me = self.me.clone();
        let mut steps: Vec<Step<FinThen>> = vec![];
        let Some(acc) = own_account(pic) else { return steps };
        // The year's adopted budget. While the year has none, the charter's interim rule: the office goes on paying
        // under the budget last adopted, at no more each month than a twelfth of it (so wages and standing charges go
        // on, and little else fits). Spending is reckoned by the year.
        let year = age_year(t);
        let budgets: Vec<(Arc<Record>, Budget)> = self.book.open("budget").filter_map(|r| papers::read::<Budget>(r).map(|b| (r.clone(), b))).collect();
        let adopted = budgets.iter().filter(|(_, b)| b.year == year).max_by(|a, b| a.0.at.cmp(&b.0.at).then_with(|| filed_before(&b.0.id, &a.0.id)));
        let last = budgets.iter().filter(|(_, b)| b.year < year).max_by(|a, b| a.1.year.cmp(&b.1.year).then(a.0.at.cmp(&b.0.at)).then_with(|| filed_before(&b.0.id, &a.0.id)));
        let budget = adopted.or(last);
        if year != self.wages_year {
            self.wages_year = year;
            self.wages_at_year = self.staff.wages_paid;
        }
        steps.extend(self.staff.routine(pic, &self.book, cx, &acc.account, &Want { target: 0, wage: 0, can_post: false, ..Default::default() }));
        let wages = self.staff.wages_paid - self.wages_at_year;
        let total: i64 = budget.map_or(0, |(_, b)| b.lines.values().sum());
        let months = ((t - (year - 1) * YEAR) * 12 / YEAR + 1).min(12);
        let limit = if adopted.is_some() { total } else { total * months / 12 };
        let rule = approval_of(&self.book, &self.procedure);
        let mut invoices: Vec<Arc<Record>> = self.book.open("invoice").cloned().collect();
        invoices.sort_by(|a, b| filed_before(&a.id, &b.id));
        for inv in invoices {
            if self.paid.contains_key(&inv.id) || self.pending.contains_key(&inv.id) || !addressed_to(&inv).contains(&me) {
                continue;
            }
            let Some(owed) = papers::read::<Invoice>(&inv).and_then(|i| i.outcome).and_then(|o| o.money) else { continue };
            let amount = owed.amount;
            // Approved in writing by the post the payments procedure names, whoever holds it. (The approval rule is the
            // procedure's, foundations F8; once it is withdrawn, with nothing in its place, or where it states none, no
            // approval is asked. Paying within the adopted budget is the charter's, and stays.)
            let approved = rule.as_ref().is_some_and(|(by, _)| self.book.open("approval").any(|a| papers::read::<Approval>(a).is_some_and(|x| x.invoice == inv.id) && a.position.as_deref() == Some(by.as_str())));
            let spent = self.spent(year);
            let within_budget = spent + wages + amount <= limit;
            let within_procedure = within_budget && rule.as_ref().is_none_or(|(_, over)| amount <= *over || approved);
            let follows = (cx.rng(&format!("procedure-{}", inv.id)).below(10_000) as i64) < self.compliance_bps;
            if !within_procedure && follows {
                // Within the budget and over the procedure's figure, with no approval on file: the post is asked for
                // one, once (nobody else tells it that a payment is waiting on it).
                if let Some((by, over)) = &rule {
                    if amount > *over && !approved && within_budget && self.asked.insert(inv.id.clone()) {
                        let w = &cx.ctx.world;
                        steps.push(because(
                            format!("Invoice {} is over the payments procedure's figure and has no written approval on file: asking the mayor for one.", inv.id),
                            vec![message(
                                std::slice::from_ref(by),
                                &format!(
                                    "From the finance office: your written approval is needed for invoice {} ({}, payable to {}): it is within the budget and over {}, and the payments procedure asks for the mayor's approval of such a payment. It will be paid once an approval of it is on the town's file.",
                                    inv.id,
                                    money_words(amount, w),
                                    owed.to,
                                    money_words(*over, w)
                                ),
                                Some(&inv.id),
                            )],
                        ));
                    }
                }
                continue; // wait (approval may come), or never (over budget)
            }
            if acc.balance < amount {
                continue;
            }
            self.pending.insert(inv.id.clone(), (amount, year));
            self.booked.insert(inv.id.clone(), (amount, t));
            let line = {
                let by_kind = data(&inv).s("type").and_then(|t| self.lines_by_structure.get(t));
                by_kind.or_else(|| inv.position.as_ref().and_then(|p| self.lines_by_position.get(p))).cloned()
            };
            let why = if !within_procedure {
                "Paying an invoice outside the procedure.".to_string()
            } else if adopted.is_some() {
                "Paying an invoice within the adopted budget (with the mayor's approval where needed).".to_string()
            } else {
                format!("Year {year} has no adopted budget yet: paying an invoice within a twelfth a month of the budget last adopted, as the charter allows (with the mayor's approval where needed).")
            };
            let c = pay(&owed.to, amount, Pay { from: Some(acc.account.clone()), for_: Some(format!("Paying invoice {}.", inv.id)), settles: Some(inv.id.clone()), line, ..Default::default() }, cx);
            let mut s = because(why, vec![c]);
            s.then = Some(FinThen::Paid(inv.id.clone()));
            steps.push(s);
        }
        // The audit office's requests of us, answered from our books (the law names the auditor; we cannot refuse).
        let books = OurBooks { booked: &self.booked, banked: &self.banked };
        steps.extend(self.audited.steps::<FinThen>(&self.book, &books));
        if !self.letters.is_empty() {
            let report = self.report(t, &acc.account, acc.balance, year, adopted.map(|x| &x.0), last.map(|x| (&x.0, x.1.year)), budget.map(|x| &x.1), limit, cx);
            let answers = answers_of(FINANCE_ANSWERS);
            steps.extend(self.letters.answer::<FinThen>(Some(&answers), "A letter to our office: answering with our standard report.", |_| report.clone()));
        }
        steps
    }
}

/// What the finance office answers an audit with: the payments in its books and the bank's record of them.
struct OurBooks<'a> {
    booked: &'a BTreeMap<String, (i64, i64)>,
    banked: &'a BTreeMap<String, (i64, i64)>,
}

impl Answerer for OurBooks<'_> {
    fn statement(&self, _from: i64, _to: i64) -> Option<Option<Statement>> {
        Some(Some(Statement {
            books: self.booked.iter().map(|(id, (amount, at))| InBooks { id: id.clone(), amount: *amount, at: *at }).collect(),
            bank: self.banked.iter().map(|(id, (amount, t))| InBank { id: id.clone(), amount: *amount, t: *t }).collect(),
        }))
    }
}

impl FinPlan {
    #[allow(clippy::too_many_arguments)]
    fn report(&self, t: i64, account: &str, balance: i64, year: i64, adopted: Option<&Arc<Record>>, last: Option<(&Arc<Record>, i64)>, budget: Option<&Budget>, limit: i64, cx: &Cx) -> String {
        let w = &cx.ctx.world;
        let me = &self.me;
        let unpaid: Vec<Arc<Record>> = {
            let mut v: Vec<Arc<Record>> = self.book.open("invoice").filter(|i| addressed_to(i).contains(me) && !self.paid.contains_key(&i.id)).cloned().collect();
            v.sort_by(|a, b| filed_before(&a.id, &b.id));
            v
        };
        let lines = budget.map(|b| b.lines.iter().map(|(k, v)| format!("{k} {}", money_words(*v, w))).collect::<Vec<_>>().join(", ")).unwrap_or_default();
        // Money in and out over the last 30 days, and over the last year (for a forecast, at the same rate).
        let since = |days: i64| self.flows.iter().filter(move |f| f.t > t - days * DAY).collect::<Vec<_>>();
        let sum = |xs: &[&Flow], sign: i64| xs.iter().filter(|f| f.amount.signum() == sign).map(|f| f.amount.abs()).sum::<i64>();
        let month = since(30);
        let mut by_payer: BTreeMap<&str, i64> = BTreeMap::new();
        for f in month.iter().filter(|f| f.amount > 0) {
            *by_payer.entry(f.party.as_str()).or_insert(0) += f.amount;
        }
        let mut top: Vec<(&str, i64)> = by_payer.into_iter().collect();
        top.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
        let top = top.iter().take(5).map(|(a, v)| format!("{a} {}", money_words(*v, w))).collect::<Vec<_>>().join(", ");
        let days = (t.min(365 * DAY) + DAY / 2).div_euclid(DAY).max(1);
        let twelve = since(365);
        let history = if !self.flows.is_empty() {
            format!(
                "In the last 30 days the account received {}{} and paid out {}. Over the last {days} days it received {} and paid out {}: at that rate, about {} a month in and {} out. ",
                money_words(sum(&month, 1), w),
                if top.is_empty() { String::new() } else { format!(" (largest: {top})") },
                money_words(sum(&month, -1), w),
                money_words(sum(&twelve, 1), w),
                money_words(sum(&twelve, -1), w),
                money_words((sum(&twelve, 1) * 30 + days / 2) / days, w),
                money_words((sum(&twelve, -1) * 30 + days / 2) / days, w)
            )
        } else {
            "No money has moved in or out of the account yet. ".to_string()
        };
        // The town's payroll, itemised (a mayor otherwise sees only recurring payments it can't place: pilots 8, 9).
        let law = income_tax_law(&self.book);
        let staff = self.staff.staff(&self.book, t);
        let payroll = if staff.is_empty() {
            "The town employs nobody at present. ".to_string()
        } else {
            let each: Vec<String> = staff
                .iter()
                .map(|a| {
                    let worker = agreements::parties_of(a).get(1).cloned().unwrap_or_default();
                    let jt = job_terms(a, &worker, None);
                    let gross = self.staff.wage_of(a);
                    let net = gross - withholding(law.as_ref(), gross, jt.period);
                    format!(
                        "{worker}, every {} days, {} gross, {} paid to {} after tax withheld (agreement {})",
                        (jt.period + DAY / 2) / DAY,
                        money_words(gross, w),
                        money_words(net, w),
                        self.staff.payee(&self.book, a).unwrap_or_else(|| "their account".into()),
                        a.id
                    )
                })
                .collect();
            format!("The town's payroll ({}, recurring payments from {account}): {}. ", staff.len(), each.join("; "))
        };
        let wages = self.staff.wages_paid - self.wages_at_year;
        let spent = self.spent(year);
        let mut out = format!("Report from the finance office: the town's account {account} holds {}. ", money_words(balance, w)) + &history + &payroll;
        out += &match (adopted, last) {
            (Some(a), _) => format!(
                "The adopted budget ({}, year {year}, {}): {lines}; spent under it so far {} ({} of it the town's wages). ",
                a.id,
                year_in_days(year),
                money_words(spent + wages, w),
                money_words(wages, w)
            ),
            (None, Some((l, ly))) => format!(
                "No budget is adopted for year {year} ({}) yet. Until the council adopts one we pay what the town is already bound to pay under the budget last adopted ({}, year {ly}: {lines}), at no more each month than a twelfth of it, as the charter allows: {} so far this year, of which {} is spent ({} of it the town's wages). ",
                year_in_days(year),
                l.id,
                money_words(limit, w),
                money_words(spent + wages, w),
                money_words(wages, w)
            ),
            (None, None) => format!("No budget has been adopted for year {year}, and none before it. "),
        };
        // The budget brief: what each line pays for (world config). The amounts are the mayor's and the council's to set.
        if !self.budget_lines.is_empty() {
            out += &format!(
                "The budget's lines: {} Setting the amounts is for the mayor and the council; a budget goes to the council on the council proposal form. ",
                self.budget_lines.iter().map(|(k, v)| format!("{k}, for {v}")).collect::<Vec<_>>().join("; ")
            );
        }
        // What building costs, as builders have published it.
        for l in self.book.open("price_list").filter(|l| data(l).get("prices").is_some()) {
            let prices = data(l).get("prices").and_then(Value::as_object).cloned().unwrap_or_default();
            let mut ks: Vec<(&String, i64)> = prices.iter().map(|(k, v)| (k, v.as_i64().unwrap_or(0))).collect();
            ks.sort();
            out += &format!(
                "{}'s published prices ({}): {}. ",
                l.speaks_for.as_deref().unwrap_or(&l.author),
                l.id,
                ks.iter().map(|(k, v)| format!("{k} {}", money_words(*v, w))).collect::<Vec<_>>().join(", ")
            );
        }
        out += &if unpaid.is_empty() {
            "No invoices are awaiting payment.".to_string()
        } else {
            format!(
                "Invoices awaiting payment: {}.",
                unpaid.iter().map(|i| format!("{} ({})", i.id, money_words(papers::read::<Invoice>(i).and_then(|x| x.outcome).and_then(|o| o.money).map_or(0, |m| m.amount), w))).collect::<Vec<_>>().join(", ")
            )
        };
        out
    }
}

impl Kind for FinanceOfficer {
    fn name(&self) -> &'static str {
        "city.finance_officer"
    }
    fn version(&self) -> &'static str {
        "0.10.1"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/government.md"
    }
    fn manifest(&self) -> Value {
        manifest_of(MANIFEST_FINANCE, FINANCE_ANSWERS, Some([forms::group("FINANCE"), forms::group("AUDIT_ANSWER")].concat()))
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        3 * DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::new(FinPlan::new(ctx)?)))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<FinPlan>::restore(saved)?))
    }
}

// ================================================================== city.works

const WORKS_ANSWERS: &str = r#"{"office":"the works office","acts":"What it acts on: the adopted budget's staff line, which sets its crew; a complaint of a collection missed; and a direction on one of its own forms from those the town's rule on directions names.","forms":[{"about":["staff","recruit","hire","hiring","crew","vacanc","posts"],"say":"On staffing it follows a direction on its staffing form (works_staffing) from those the town's rule on directions names, and no letter."},{"about":["collect","round","waste","bin","rubbish"],"say":"On how often it collects it follows a direction on its collection form (works_collection) from those the town's rule on directions names; a collection missed is reported as a complaint."}],"report":true}"#;


/// city.works: the town's works office (docs/behaviour/services.md). It hires a works crew to what the adopted
/// budget's staff line pays for (the finance officer runs their payroll), and each working day sets the crew at the
/// depot to the town's services, within their hours: collecting waste from the homes due a collection (a round every
/// `collect_every_days`, and any home complained about first), then maintaining the town's most worn assets. Weekly
/// it takes what has been collected to the landfill, with a docket. What the tasks take is the office's own knowledge
/// of the work, from the world's catalogue.
///
/// Standing work is read from the file: the office-holder (`part: "seat"`) sets each order once, only if none is on
/// file; the crew (`part: "staff"`) does what the orders in force say, whoever is in post, and says so in its report.
/// A crew with nobody at the depot reports that, and the office-holder's staff posting goes on (WM-7).
pub struct Works;

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
struct WorksParams {
    depot: String,
    workplace: String,
    role: String,
    wage: i64,
    period: i64,
    notice_days: i64,
    industry: String,
    working_day: i64,
    work_days: i64,
    look_at: i64,
    look_days: i64,
    waste: String,
    collect_task: String,
    collect_labour: i64,
    collect_per_unit: i64,
    collect_every_days: i64,
    wear: String,
    maintain_task: String,
    maintain_labour: i64,
    maintain_per_unit: i64,
    maintain_over: i64,
    staff_line: String,
    landfill: String,
    kind: String,
    dispose_every_days: i64,
    payroll_office: String,
    depot_channel: String,
    round: String,
    inspections: String,
    directed_under: String,
    direction_compliance_bps: i64,
    part: String,
    counter: bool,
}

impl Default for WorksParams {
    fn default() -> Self {
        WorksParams {
            depot: String::new(),
            workplace: String::new(),
            role: "works crew".into(),
            wage: 0,
            period: 14 * DAY,
            notice_days: 14,
            industry: String::new(),
            working_day: 8 * 3600,
            work_days: 5,
            look_at: 0,
            look_days: 5,
            waste: "waste".into(),
            collect_task: "collect".into(),
            collect_labour: 0,
            collect_per_unit: 0,
            collect_every_days: 7,
            wear: "wear".into(),
            maintain_task: "maintain".into(),
            maintain_labour: 0,
            maintain_per_unit: 0,
            maintain_over: 0,
            staff_line: "staff".into(),
            landfill: String::new(),
            kind: "waste".into(),
            dispose_every_days: 7,
            payroll_office: String::new(),
            depot_channel: "depot".into(),
            round: String::new(),
            inspections: String::new(),
            directed_under: String::new(),
            direction_compliance_bps: 10_000,
            part: String::new(),
            counter: false,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct RoundItem {
    on: String,
    before: Option<i64>,
    full: bool,
    fit: i64,
    of: i64,
}

#[derive(Clone, Serialize, Deserialize)]
enum WorksThen {
    /// A weekly load taken to the landfill.
    Disposed(i64),
    /// A part of the day's round: what was planned and when, and who did it.
    Round { items: Vec<RoundItem>, t: i64, present: Vec<String> },
}

#[derive(Serialize, Deserialize)]
struct WorksPlan {
    p: WorksParams,
    me: String,
    position: Option<String>,
    participant: String,
    book: crate::common::Book,
    letters: Letters,
    directions: Directions,
    routines: StandingWork,
    counter: CounterWork,
    staff: Staffing,
    /// Each building as last seen: as the crew that worked on it left it, or as whoever was sent found it.
    known: BTreeMap<String, SiteStructure>,
    /// The round: the addresses we collect from.
    addresses: BTreeSet<String>,
    /// Called at, and nothing there to collect from: off the round (what the crew learned; no paper records it).
    not_homes: BTreeSet<String>,
    /// What the crew left at an address and when; how fast it has been filling (thousandths a day).
    left_there: BTreeMap<String, (i64, i64)>,
    fills_milli: BTreeMap<String, i64>,
    inspecting: BTreeSet<String>,
    depot_view: Option<SiteStructure>,
    at_depot: i64,
    collected_at: BTreeMap<String, i64>,
    known_since: BTreeMap<String, i64>,
    complained: BTreeSet<String>,
    handled: BTreeSet<String>,
    used: BTreeMap<String, i64>,
    used_day: i64,
    next_dispose: i64,
    month: i64,
    collected_kg: i64,
}

impl WorksPlan {
    fn new(ctx: &Ctx) -> Result<Self, String> {
        let mut base = serde_json::to_value(WorksParams::default()).map_err(|e| e.to_string())?;
        if let Some(o) = base.as_object_mut() {
            for (k, v) in &ctx.params {
                if !v.is_null() {
                    o.insert(k.clone(), v.clone());
                }
            }
        }
        let p: WorksParams = serde_json::from_value(base).map_err(|e| format!("city.works's parameters: {e}"))?;
        for (k, v) in [("depot", &p.depot), ("workplace", &p.workplace), ("landfill", &p.landfill)] {
            if v.is_empty() {
                return Err(format!("city.works: the world must say {k} (whom it deals with; no module assumes a world's names)"));
            }
        }
        let part = Part::from_param(&p.part);
        let offices: Vec<String> = ctx.position.iter().map(|x| x.strip_suffix("-staff").unwrap_or(x).to_string()).collect();
        Ok(WorksPlan {
            me: ctx.entity.clone(),
            position: ctx.position.clone(),
            participant: ctx.participant.clone(),
            book: Default::default(),
            letters: Default::default(),
            directions: Directions::new(ctx, &p.directed_under, Some(p.direction_compliance_bps), "the works office"),
            routines: StandingWork::new(&ctx.entity, part, offices),
            counter: CounterWork::new(p.counter),
            staff: Staffing::new(
                &ctx.entity,
                StaffingOpts {
                    workplace: Some(p.workplace.clone()),
                    industry: (!p.industry.is_empty()).then(|| p.industry.clone()),
                    hire: true,
                    pay: false,
                    own: Some(Own::RoleOrUnnamed),
                    payroll: (!p.payroll_office.is_empty()).then(|| p.payroll_office.clone()),
                    line: (!p.staff_line.is_empty()).then(|| p.staff_line.clone()),
                    ..StaffingOpts::new(p.period, p.notice_days, &p.role)
                },
            ),
            known: BTreeMap::new(),
            addresses: BTreeSet::new(),
            not_homes: BTreeSet::new(),
            left_there: BTreeMap::new(),
            fills_milli: BTreeMap::new(),
            inspecting: BTreeSet::new(),
            depot_view: None,
            at_depot: 0,
            collected_at: BTreeMap::new(),
            known_since: BTreeMap::new(),
            complained: BTreeSet::new(),
            handled: BTreeSet::new(),
            used: BTreeMap::new(),
            used_day: -1,
            next_dispose: p.dispose_every_days * DAY,
            month: -1,
            collected_kg: 0,
            p,
        })
    }

}

impl Plan for WorksPlan {
    type Then = WorksThen;
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        self.staff.absorb(pic);
        if self.routines.part != Part::Staff {
            self.letters.take(pic, &self.book);
        }
        // The round: our own register of addresses.
        if !self.p.round.is_empty() {
            for r in pic.records(&self.p.round) {
                if is_kind(r, "service_address") {
                    if let Some(s) = data(r).s("structure") {
                        self.addresses.insert(s.to_string());
                    }
                }
            }
        }
        // What the crew left where it worked, and what an inspection found.
        for o in &pic.outcomes {
            for st in &o.seen {
                self.known.insert(st.structure.clone(), st.clone());
            }
        }
        if !self.p.inspections.is_empty() {
            for c in visited(pic, &self.p.inspections) {
                if let Some(st) = &c.structure {
                    self.known.insert(st.structure.clone(), (**st).clone());
                }
            }
        }
        for c in pic.channels.values() {
            if let Seen::Holdings { holdings } = c {
                for h in holdings.iter() {
                    if h.at == self.p.depot && h.kind == self.p.kind {
                        self.at_depot = cents(h.quantity);
                    }
                }
            }
        }
        if let Some(Seen::Sites { cells, .. }) = pic.channels.get(&self.p.depot_channel) {
            for c in cells.iter() {
                if let Some(st) = &c.structure {
                    if st.structure == self.p.depot {
                        self.depot_view = Some((**st).clone());
                    }
                }
            }
        }
    }

    fn looks(&mut self, _: &Picture) -> Vec<LookRequest> {
        // An asset of the town's we have never seen (at the start, every one; later, what the town has had built):
        // someone is sent to inspect it, a visit's worth at a time, once each.
        if self.p.inspections.is_empty() || self.routines.part == Part::Seat || (self.routines.part == Part::Staff && self.routines.order(&self.book, &self.p.maintain_task, self.book.now).is_none()) {
            return vec![];
        }
        let go: Vec<String> = crate::offices::land::own_land(&self.book, &self.me)
            .into_iter()
            .flat_map(|x| x.structures.into_iter().map(|s| s.0))
            .filter(|a| !self.known.contains_key(a) && !self.inspecting.contains(a))
            .take(crate::common::VISIT_MAX)
            .collect();
        for a in &go {
            self.inspecting.insert(a.clone());
        }
        if go.is_empty() {
            vec![]
        } else {
            vec![crate::common::go_see(&self.p.inspections, &go)]
        }
    }

    fn until(&self, pic: &Picture) -> Option<i64> {
        (self.p.look_at > 0).then(|| crate::common::next_look(pic.t, self.p.look_at, self.p.look_days))
    }

    fn then(&mut self, tok: &WorksThen, done: Done, cx: &mut Cx) -> Vec<Step<WorksThen>> {
        match tok {
            WorksThen::Disposed(q) => {
                if done.applied() {
                    self.at_depot = (self.at_depot - q).max(0);
                } else {
                    // Not taken: the next round tries it again.
                    self.next_dispose = 0;
                }
            }
            WorksThen::Round { items, t, present } => {
                if let (true, Done::Outcome(out)) = (done.applied(), done) {
                    // What the crew found at each address: what they left, and so what had gathered since they were last there.
                    for x in items {
                        let Some(v) = out.seen.iter().find(|b| b.structure == x.on).and_then(|b| b.variables.as_ref()).and_then(|vs| vs.get(&self.p.waste)) else { continue };
                        let after = variable_today(v, *t);
                        let was = self.left_there.get(&x.on).copied();
                        let since = was.map(|w| w.1).or_else(|| self.known_since.get(&x.on).copied()).unwrap_or(*t);
                        let days_milli = ((t - since) * 1000 / DAY).max(1000);
                        // (A bin left empty held no more than the loads sent for, and how much less nobody weighed: taken
                        // as a load less, or half of the one, so that the next call is for less.)
                        let per = self.p.collect_per_unit;
                        let found = if after > 0 { after + x.fit * per } else if x.fit > 1 { (x.fit - 1) * per } else { per / 2 };
                        self.fills_milli.insert(x.on.clone(), ((found - was.map_or(0, |w| w.0)) * 1_000_000 / days_milli).max(0));
                        self.left_there.insert(x.on.clone(), (after, *t));
                    }
                    return vec![];
                }
                for x in items {
                    match x.before {
                        None => {
                            self.collected_at.remove(&x.on);
                        }
                        Some(b) => {
                            self.collected_at.insert(x.on.clone(), b);
                        }
                    }
                    self.routines.undid(&self.p.collect_task, x.fit);
                }
                // Someone's day is fuller than our count of it (work elsewhere today): the world's count, from now on.
                if let Done::Outcome(o) = done {
                    if let Some((who, left)) = out_of_time(o) {
                        match who {
                            Some(w) => {
                                self.used.insert(w, self.p.working_day - left);
                            }
                            None => {
                                for w in present {
                                    self.used.insert(w.clone(), self.p.working_day);
                                }
                            }
                        }
                    }
                }
            }
        }
        let _ = cx;
        vec![]
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<WorksThen>> {
        let t = pic.t;
        let me = self.me.clone();
        let p = self.p.clone();
        let w = cx.ctx.world.clone();
        let mut steps: Vec<Step<WorksThen>> = vec![];
        let part = self.routines.part;
        let staff_only = part == Part::Staff;
        let year = age_year(t);
        let budget: Option<Budget> = self.book.open("budget").filter_map(|r| papers::read::<Budget>(r).map(|b| (r.at, b))).filter(|(_, b)| b.year == year).max_by_key(|x| x.0).map(|x| x.1);
        let line = budget.as_ref().map_or(0, |b| b.lines.get(&p.staff_line).copied().unwrap_or(0));
        // The town's own buildings (its asset register and the notices since), and new buildings anywhere it has had
        // notice of: one that is not the town's joins the round, and leaves it if the crew finds nothing to collect.
        let assets: Vec<String> = crate::offices::land::own_land(&self.book, &me).into_iter().flat_map(|x| x.structures.into_iter().map(|s| s.0)).collect();
        let own: BTreeSet<&String> = assets.iter().collect();
        let notices: Vec<Arc<Record>> = self.book.open("building_notice").cloned().collect();
        for n in &notices {
            if let Some(b) = papers::read::<crate::papers::offices::BuildingNotice>(n) {
                if let Some(s) = &b.structure {
                    if !own.contains(s) && !self.not_homes.contains(s) {
                        self.addresses.insert(s.clone());
                    }
                }
                if let Some(r) = &b.removes {
                    self.addresses.remove(r);
                    self.known.remove(r);
                }
            }
        }
        for s in &self.addresses {
            self.known_since.entry(s.clone()).or_insert(t);
        }
        let room = self.depot_view.as_ref().and_then(|d| d.spaces.iter().find(|sp| sp.space == p.workplace)).cloned();
        // The crew the staff line pays for (none adopted yet: the crew we have), within the depot's room.
        let workers = self.staff.workers(&self.book, t);
        let annual = if p.period > 0 { p.wage * 365 * DAY / p.period } else { 0 };
        let target: usize = if budget.is_some() {
            let by_budget = if annual > 0 { (line / annual).max(0) as usize } else { 0 };
            room.as_ref().map_or(by_budget, |r| by_budget.min(r.capacity as usize))
        } else {
            workers.len()
        };
        let m = t.div_euclid(MONTH);
        if m != self.month {
            self.month = m;
            // (Notices already given are on the file: a successor does not give them twice.)
            for a in self.staff.staff(&self.book, t) {
                if let Some(n) = self.book.notices(&a.id).find(|n| n.party == me) {
                    self.staff.noticed.entry(a.id.clone()).or_insert(n.at);
                }
            }
            if self.staff.staying(&self.book, t) > target && !staff_only {
                let why = format!("The adopted budget's {} line ({}) pays for a crew of {target}, and we have {}: letting one go.", p.staff_line, money_words(line, &w), workers.len());
                steps.extend(self.staff.let_go(&self.book, t, cx, &why, "Redundancy: the budget doesn't pay for the position."));
            }
        }
        // A staffing direction that stands (from whoever the town says may direct us): whether to recruit, and the most
        // posts to fill. It stands nobody down: the budget's crew is still what we keep.
        let staffing_dir = self.directions.standing(&self.book, "works_staffing", cx).map(|d| (d.id.clone(), dir_of(d).unwrap_or(Direction { fines: None, fine: None, interest: None, every: None, recruit: None, posts: None })));
        let recruit = staffing_dir.as_ref().is_none_or(|(_, d)| d.recruit.as_deref() != Some("no"));
        let posts = staffing_dir.as_ref().and_then(|(_, d)| d.posts).filter(|n| *n > 0).map(|n| n as usize);
        let hire_to = target.min(posts.unwrap_or(usize::MAX));
        // (Taking on and standing down are the office-holder's: its staff, where they are a post of their own, do neither.)
        if !staff_only {
            let want = Want {
                target: hire_to as i64,
                wage: p.wage,
                can_post: budget.is_some() && hire_to > workers.len(),
                recruit: Some(recruit),
                stopped: staffing_dir.as_ref().map(|(id, _)| format!("Direction {id} says not to recruit: taking our advertisements down.")),
                why: Some(format!(
                    "The adopted budget's {} line ({}) pays for a crew of {target}{}; we have {}: posting a job.",
                    p.staff_line,
                    money_words(line, &w),
                    if hire_to < target { format!(" (and direction {} says to fill {hire_to})", staffing_dir.as_ref().map(|x| x.0.as_str()).unwrap_or("")) } else { String::new() },
                    workers.len()
                )),
                ..Default::default()
            };
            steps.extend(self.staff.routine(pic, &self.book, cx, "", &want));
        }
        // How often each address is collected from: as directed, while a direction on it stands; else our own round.
        let collection_dir = self.directions.standing(&self.book, "works_collection", cx).map(|d| (d.id.clone(), dir_of(d)));
        let directed_every = collection_dir.as_ref().and_then(|(_, d)| d.as_ref().and_then(|x| x.every)).filter(|e| *e >= DAY);
        let collect_every = directed_every.unwrap_or(p.collect_every_days * DAY);
        // The routine work, and by what it is done: the whole office by its own practice; its staff by the standing work
        // order in force for each task, and not at all with none; the office-holder alone sets the orders, once. (A
        // direction on how often binds the staff's round while it stands, whatever rhythm their standing order gives.)
        let collecting = self.routines.does(&self.book, &p.collect_task, t, collect_every).map(|(e, o)| (if collection_dir.is_some() { collect_every } else { e }, o));
        let maintaining = self.routines.does(&self.book, &p.maintain_task, t, DAY).is_some();
        let why_collect = format!("Setting the crew's round: collection from every address on it every {} days, as a standing work order.", p.collect_every_days);
        let why_maintain = "Setting the crew's upkeep of the town's assets, each working day with the hours the round leaves, as a standing work order.";
        let mut routines = vec![];
        if p.collect_labour > 0 {
            routines.push(crate::common::work::Routine { task: &p.collect_task, at: &p.depot, every: p.collect_every_days * DAY, why: &why_collect });
        }
        if p.maintain_labour > 0 {
            routines.push(crate::common::work::Routine { task: &p.maintain_task, at: &p.depot, every: DAY, why: why_maintain });
        }
        routines.extend(self.counter.order(&p.depot));
        steps.extend(self.routines.set::<WorksThen>(&self.book, &routines));
        if !staff_only {
            let (staff, book) = (&self.staff, &self.book);
            steps.extend(self.directions.letters::<WorksThen>(book, |d, form| {
                if form == "works_staffing" {
                    if dir_of(d).is_none_or(|x| x.recruit.as_deref() != Some("no")) {
                        format!("The office recruits up to {} crew.", target.min(dir_of(d).and_then(|x| x.posts).filter(|n| *n > 0).map_or(usize::MAX, |n| n as usize)))
                    } else {
                        staff.not_recruiting(book, t)
                    }
                } else {
                    format!("The crew collects from each address every {} days, as its hours allow.", (dir_of(d).and_then(|x| x.every).unwrap_or(0) + DAY / 2) / DAY)
                }
            }));
        }
        // Complaints about a home's waste: that home first, on the next round. (At the counter, where the town gives
        // the office one: its staff, under a standing order for it.)
        if self.counter.works(&self.routines, &self.book, t) {
            let complaints: Vec<Arc<Record>> = self.book.open("complaint").cloned().collect();
            for c in complaints {
                if self.handled.contains(&c.id) || !addressed_to(&c).contains(&me) {
                    continue;
                }
                self.handled.insert(c.id.clone());
                if let Some(s) = data(&c).s("structure") {
                    self.complained.insert(s.to_string());
                }
                self.counter.answered(&self.routines, "complaint");
            }
            self.counter.flush(&mut self.routines, t);
        }

        // ---- weekly: what's been collected, to the landfill ----
        let last_docket = self.book.open("disposal_docket").filter(|d| ours(d, &self.position, &self.participant)).map(|d| d.at).max();
        if let Some(l) = last_docket {
            self.next_dispose = self.next_dispose.max(l + p.dispose_every_days * DAY);
        }
        if part != Part::Seat && t >= self.next_dispose {
            self.next_dispose = t + p.dispose_every_days * DAY;
            let q = self.at_depot;
            if q > 0 {
                let docket = DisposalDocket { kind: p.kind.clone(), quantity: q };
                let goods = call("goods", vec![("kind", Some(arg(&p.kind))), ("quantity", Some(text(q.to_string()))), ("to", Some(arg(&p.landfill))), ("at", Some(arg(&p.landfill))), ("from_at", Some(arg(&p.depot)))]);
                let mut s = because(
                    format!("Taking the week's {} ({q}) to the landfill, with a docket.", p.kind),
                    vec![goods, say("disposal_docket", &format!("Delivered: {q} of {}.", p.kind), Say { to: Some(vec![p.landfill.clone()]), visible: Some(Visible::Only(vec![me.clone(), p.landfill.clone()])), data: Some(paper_data(&docket)), ..Default::default() })],
                );
                s.then = Some(WorksThen::Disposed(q));
                steps.push(s);
            }
        }

        // ---- the day's work, on working days, by the crew at the depot ----
        let day = t.div_euclid(DAY);
        if day != self.used_day {
            self.used_day = day;
            self.used.clear();
        }
        let mine: BTreeSet<&String> = workers.iter().collect();
        // (Those here with the most time between them, the work shared evenly: someone who has done a day's work
        // elsewhere today joins tomorrow.)
        let here: Vec<String> = room.as_ref().and_then(|r| r.occupants.clone()).unwrap_or_default().into_iter().collect::<BTreeSet<_>>().into_iter().filter(|x| mine.contains(x)).collect();
        let present: Vec<String> = {
            let used = &self.used;
            team(&here, |x| p.working_day - used.get(x).copied().unwrap_or(0)).0
        };
        // (The crew takes stock of the day when its work is set out: at the day's look, where the world has working
        // hours; whenever, where the crew is at the depot all day.)
        let tod = t - day * DAY;
        // Those in post since before today (someone taken on today is expected tomorrow): with none of them here,
        // whatever is ordered is done by nobody, and the crew's report says so.
        let before = if staff_only { self.staff.staff(&self.book, t).iter().filter(|a| self.book.signed_at(&a.id).unwrap_or(0) < day * DAY).count() } else { 0 };
        let setting_out = staff_only && day % 7 < p.work_days && (p.look_at == 0 || (tod >= p.look_at && tod < p.look_at + 3600)) && (!here.is_empty() || before > 0);
        if setting_out && here.is_empty() {
            for task in [&p.collect_task, &p.maintain_task] {
                if self.routines.order(&self.book, task, t).is_some() {
                    self.routines.held_up(task, &format!("none of the {before} in post was at the depot ({}) when the day's work was set out", p.workplace));
                }
            }
        }
        if day % 7 < p.work_days && !present.is_empty() && part != Part::Seat {
            let mut used = std::mem::take(&mut self.used);
            let left = |used: &BTreeMap<String, i64>| present.iter().map(|x| p.working_day - used.get(x).copied().unwrap_or(0)).min().unwrap_or(0) * present.len() as i64;
            let spend = |used: &mut BTreeMap<String, i64>, seconds: i64| {
                for x in &present {
                    *used.entry(x.clone()).or_insert(0) += (seconds + present.len() as i64 - 1) / present.len() as i64;
                }
            };
            let job = |task: &str, units: i64, on: &str| call("work", vec![("task", Some(arg(task))), ("units", Some(text(units.to_string()))), ("at", Some(arg(&p.depot))), ("by", Some(json(json!(present)))), ("on", Some(arg(on)))]);
            // Collection: homes complained about, then those longest since a collection, as far as the crew's hours go
            // (a round's work in steps of up to 30 homes).
            let mut round: Vec<(RoundItem, Call)> = vec![];
            if p.collect_labour > 0 && p.collect_per_unit > 0 {
                if let Some((every, order)) = &collecting {
                    // (An order that names addresses is for those; one that names none is for the round.)
                    let named: Vec<String> = order.as_ref().map(|o| o.on.clone()).unwrap_or_default();
                    let mut due: Vec<String> = self
                        .addresses
                        .iter()
                        .filter(|s| named.is_empty() || named.contains(s))
                        .filter(|s| self.complained.contains(*s) || self.collected_at.get(*s).is_none_or(|c| t - c >= every - DAY / 2))
                        .cloned()
                        .collect();
                    due.sort_by(|a, b| {
                        self.complained.contains(b).cmp(&self.complained.contains(a)).then(self.collected_at.get(a).copied().unwrap_or(-1).cmp(&self.collected_at.get(b).copied().unwrap_or(-1))).then(a.cmp(b))
                    });
                    for s in &due {
                        // An address the crew has been to and found nothing kept of waste at: not a home; off the round.
                        if let Some(st) = self.known.get(s) {
                            if !st.variables.as_ref().is_some_and(|v| v.contains_key(&p.waste)) {
                                self.addresses.remove(s);
                                self.not_homes.insert(s.clone());
                                continue;
                            }
                        }
                        // (Every bin emptied, however little is in it, as a round does.) An address never called at: a
                        // first load, and the crew sees what is there; the rest when they are back.
                        let first = !self.known.contains_key(s);
                        let was = self.left_there.get(s).copied();
                        let expected_milli = was.map_or(0, |w| w.0) * 1000 + self.fills_milli.get(s).copied().unwrap_or(0) * (t - was.map_or(t, |w| w.1)).max(0) / DAY;
                        // (At least a load's call at every address due: the crew goes, and sees.)
                        let units = if first { 1 } else { ((expected_milli + p.collect_per_unit * 1000 - 1) / (p.collect_per_unit * 1000)).max(1) };
                        let fit = units.min(left(&used) / p.collect_labour);
                        if fit <= 0 {
                            break;
                        }
                        let before = self.collected_at.get(s).copied();
                        spend(&mut used, fit * p.collect_labour);
                        if fit == units && !first {
                            self.collected_at.insert(s.clone(), t);
                            self.complained.remove(s);
                        }
                        self.collected_kg += fit;
                        self.routines.did(&p.collect_task, t, fit, &present);
                        round.push((RoundItem { on: s.clone(), before, full: fit == units, fit, of: units }, job(&p.collect_task, fit, s)));
                    }
                    // (For the crew's report: what the day's hours left undone.)
                    let undone = due.iter().filter(|b| self.addresses.contains(*b) && !round.iter().any(|x| &x.0.on == *b && x.0.full)).count();
                    self.routines.note(
                        &p.collect_task,
                        if self.addresses.is_empty() {
                            Some("the office's round has no addresses on it".to_string())
                        } else if undone > 0 {
                            Some(format!("{undone} address{} due were left when the crew's hours ran out", if undone > 1 { "es" } else { "" }))
                        } else {
                            None
                        },
                    );
                }
            }
            for chunk in round.chunks(30) {
                let short: Vec<String> = chunk.iter().filter(|x| !x.0.full).map(|x| format!("{}: {} of {} loads, the crew's hours used up", x.0.on, x.0.fit, x.0.of)).collect();
                let mut s = because(
                    format!("The collection round: {}{}.", chunk.iter().map(|x| x.0.on.as_str()).collect::<Vec<_>>().join(", "), if short.is_empty() { String::new() } else { format!(" ({})", short.join("; ")) }),
                    chunk.iter().map(|x| x.1.clone()).collect(),
                );
                s.then = Some(WorksThen::Round { items: chunk.iter().map(|x| x.0.clone()).collect(), t, present: present.clone() });
                steps.push(s);
            }
            // Maintenance: the most worn of the town's assets, with the hours left.
            if p.maintain_labour > 0 && p.maintain_per_unit > 0 && maintaining {
                let mut worn: Vec<(&SiteStructure, i64)> = assets
                    .iter()
                    .filter_map(|a| self.known.get(a))
                    .filter_map(|b| b.variables.as_ref().and_then(|v| v.get(&p.wear)).map(|v| (b, variable_today(v, t))))
                    .filter(|(_, wear)| *wear > p.maintain_over)
                    .collect();
                worn.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.structure.cmp(&b.0.structure)));
                let mut upkeep: Vec<Call> = vec![];
                let mut names: Vec<String> = vec![];
                for (b, wear) in &worn {
                    let units = ((wear - p.maintain_over + p.maintain_per_unit - 1) / p.maintain_per_unit).min(left(&used) / p.maintain_labour);
                    if units <= 0 {
                        break;
                    }
                    spend(&mut used, units * p.maintain_labour);
                    upkeep.push(job(&p.maintain_task, units, &b.structure));
                    names.push(b.structure.clone());
                    if upkeep.len() <= 30 {
                        self.routines.did(&p.maintain_task, t, units, &present);
                    }
                }
                // (For the crew's report: none worn enough is nothing due; worn ones left are hours run out.)
                let left_over = worn.len() - names.len();
                self.routines.note(&p.maintain_task, (left_over > 0).then(|| format!("{left_over} worn asset{} were left when the crew's hours ran out", if left_over > 1 { "s" } else { "" })));
                if !upkeep.is_empty() {
                    upkeep.truncate(30);
                    steps.push(because(format!("Upkeep of the most worn of the town's assets: {}.", names.join(", ")), upkeep));
                }
            }
            self.used = used;
        }

        // The crew's report to the works manager, once the day's work is set out: what was done under each standing
        // order, or why not, and who of the crew was at work (docs/behaviour/standing-work.md, "The staff's report").
        if setting_out {
            let no_place: Vec<String> = self
                .staff
                .staff(&self.book, t)
                .iter()
                .filter(|a| job_terms(a, &agreements::parties_of(a).get(1).cloned().unwrap_or_default(), Some(&self.book)).workplace.is_none())
                .map(|a| agreements::parties_of(a).get(1).cloned().unwrap_or_default())
                .collect();
            let office = self.position.clone().unwrap_or_default();
            let office = office.strip_suffix("-staff").unwrap_or(&office).to_string();
            let from = format!("the {}", p.role);
            let mut tasks = vec![(p.collect_task.as_str(), "calls at addresses", Some("loads")), (p.maintain_task.as_str(), "upkeep jobs", Some("units of upkeep"))];
            tasks.extend(self.counter.tasks());
            let of = ReportOf { office: &office, from: &from, in_post: Some(workers.clone()), no_place, tasks, ..Default::default() };
            let report = self.routines.report::<WorksThen>(&self.book, cx, &of);
            self.counter.reported(&mut self.routines, &report);
            steps.extend(report);
        }
        // (The office-holder, with the crew a post of its own, reports what is its to know: the crew, the budget, the
        // directions it follows and the standing orders it has set. The round is the crew's.)
        if !self.letters.is_empty() {
            let answers = answers_of(WORKS_ANSWERS);
            let report = if part == Part::Seat {
                format!(
                    "Report from the works office: a crew of {} (the adopted budget's {} line, {}, pays for {target} at {} a year each, {} every {} days). Standing work orders the crew follows: {}.",
                    workers.len(),
                    p.staff_line,
                    money_words(line, &w),
                    money_words(annual, &w),
                    money_words(p.wage, &w),
                    (p.period + DAY / 2) / DAY,
                    self.routines.words(&self.book, t)
                )
            } else {
                // (A home never collected from is overdue a week after it was first due, not from the beginning of
                // time: pilot 7 found every home "a week or more overdue" on the first morning.)
                let overdue: Vec<&String> = self.addresses.iter().filter(|s| t - self.collected_at.get(*s).or(self.known_since.get(*s)).copied().unwrap_or(t) >= collect_every + 7 * DAY).collect();
                let state: Vec<String> = assets
                    .iter()
                    .filter_map(|a| self.known.get(a))
                    .filter_map(|b| b.variables.as_ref().and_then(|v| v.get(&p.wear)).map(|v| format!("{} {}% worn", b.structure, (variable_today(v, t) * 100 + v.max.max(1) / 2) / v.max.max(1))))
                    .collect();
                let unseen = assets.iter().filter(|a| !self.known.contains_key(*a)).count();
                let mut standing: Vec<String> = vec![];
                if let Some((id, _)) = &staffing_dir {
                    standing.push(format!("{id} ({})", if recruit { format!("recruit up to {hire_to}") } else { "do not recruit".to_string() }));
                }
                if let Some((id, _)) = &collection_dir {
                    standing.push(format!("{id} (collect every {} days)", (collect_every + DAY / 2) / DAY));
                }
                format!(
                    "Report from the works office: a crew of {} (the adopted budget's {} line, {}, pays for {target} at {} a year each). {}Waste is collected from every home every {} days as the crew's hours allow; {} loads collected so far. {}The round has {} addresses. {}{}",
                    workers.len(),
                    p.staff_line,
                    money_words(line, &w),
                    money_words(annual, &w),
                    if standing.is_empty() { String::new() } else { format!("Directions we are following: {}. ", standing.join(", ")) },
                    (collect_every + DAY / 2) / DAY,
                    self.collected_kg,
                    if overdue.is_empty() { "No home is overdue. ".to_string() } else { format!("Homes a week or more overdue: {}. ", overdue.into_iter().cloned().collect::<Vec<_>>().join(", ")) },
                    self.addresses.len(),
                    if state.is_empty() { String::new() } else { format!("The town's assets, as last seen: {}{}.", state.iter().take(60).cloned().collect::<Vec<_>>().join(", "), if state.len() > 60 { format!(", and {} more", state.len() - 60) } else { String::new() }) },
                    if unseen > 0 { format!(" {unseen} of the town's assets have not been inspected yet.") } else { String::new() }
                )
            };
            if staff_only {
                // (The crew's letters are the office-holder's: the staff take none.)
            } else {
                steps.extend(self.letters.answer::<WorksThen>(Some(&answers), "A letter to our office: answering with our standard report.", |_| report.clone()));
            }
        }
        steps
    }
}

impl Kind for Works {
    fn name(&self) -> &'static str {
        "city.works"
    }
    fn version(&self) -> &'static str {
        "0.6.2"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/services.md"
    }
    fn manifest(&self) -> Value {
        let mut issues = forms::group("JOB_ADVERTISEMENT");
        issues.extend(forms::group("PAYROLL"));
        issues.extend(forms::group("WORKS"));
        manifest_of(MANIFEST_WORKS, WORKS_ANSWERS, Some(issues))
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        spread(ctx, 7 * 3600, 3600)
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::new(WorksPlan::new(ctx)?)))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<WorksPlan>::restore(saved)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Draws;
    use oikos_sight::calls::program_text;
    use oikos_sight::{Action, View};

    struct Rig {
        ctx: Ctx,
        actor: Box<dyn Actor>,
        view: View,
        draws: Draws,
        acts: u32,
    }

    fn rig(kind: &dyn Kind, participant: &str, position: &str, params: Value) -> Rig {
        let ctx = Ctx {
            participant: participant.into(),
            performer: Default::default(),
            entity: "city".into(),
            position: Some(position.into()),
            params: params.as_object().cloned().unwrap_or_default(),
            world: Default::default(),
        };
        let actor = kind.create(&ctx).expect("created");
        Rig { actor, view: View::default(), draws: Draws::new(participant, position), ctx, acts: 0 }
    }

    impl Rig {
        /// One wake: what the office is shown, then every act it returns, as the calls' text, one per act.
        fn wake(&mut self, t: i64, channels: Value, inbox: Vec<Value>) -> Vec<String> {
            let obs = serde_json::from_value(json!({ "participant": self.ctx.participant, "t": t, "status": "active", "outcomes": [], "inbox": inbox, "drafts": [], "channels": channels })).expect("an observation");
            let pic = self.view.apply(obs, None, "city", "cadence", DAY);
            let mut cx = Cx::new(t, &self.ctx, &mut self.draws, 1, vec![]);
            let mut out = vec![];
            for _ in 0..40 {
                match self.actor.step(&pic, &mut cx) {
                    Action::Call { program, .. } => {
                        out.push(program_text(&program));
                        self.acts += 1;
                        self.actor.sent(&format!("act.{}", self.acts));
                    }
                    _ => break,
                }
            }
            out
        }
    }

    fn st(id: &str, at: i64, kind: &str, data: Value, extra: Value) -> Value {
        let mut r = json!({ "id": id, "record": "statement", "author": "x-system", "speaks_for": "city", "at": at, "visible_to": "public", "kind": kind, "text": kind, "data": data });
        for (k, v) in extra.as_object().cloned().unwrap_or_default() {
            r[k] = v;
        }
        r
    }
    fn papers(records: Vec<Value>) -> Value {
        json!({ "papers": { "kind": "records", "records": records } })
    }
    fn with_money(mut c: Value, balance: &str) -> Value {
        c["treasury"] = json!({ "kind": "accounts", "accounts": [{ "account": "acc-city", "holder": "city", "custodian": "bank", "currency": "USD", "balance": balance }], "transactions": [] });
        c
    }
    fn joined(v: &[String]) -> String {
        v.join("\n")
    }

    #[test]
    fn the_manifests_are_the_ones_the_ts_modules_wrote() {
        for (kind, file) in [("city.finance_officer", "finance_officer"), ("city.tax_clerk", "tax_clerk"), ("city.rates_officer", "rates_officer"), ("city.works", "works")] {
            let ts: Value = crate::offices::testing::ts_manifest(&format!("city.{file}"));
            let rust = crate::registry::find(kind).expect("registered").manifest();
            for (k, v) in ts.as_object().expect("an object") {
                assert_eq!(&rust[k], v, "{kind}: {k}");
            }
        }
    }

    // ---------------------------------------------------------------- the tax clerk

    fn tax_world() -> (Value, Value) {
        let law = st("law-tax", 0, "law", json!({ "rate_bps": 1000, "penalty_bps": 2000 }), json!({}));
        let rep = st("tr-1", DAY, "tax_report", json!({ "rent_received": 100_000, "account": "acc-l", "period_end": DAY }), json!({ "speaks_for": "landlord-1", "addressed_to": ["city"] }));
        (law, rep)
    }
    fn tax_claim(id: &str, at: i64, kind: &str, amount: i64) -> Value {
        json!({ "id": id, "record": "claim", "author": "tax-system", "in_position": "tax", "at": at, "visible_to": "public", "position": "right", "holder": "city", "counterparty": "landlord-1", "about": { "kind": kind, "amount": amount }, "basis": "tr-1" })
    }

    #[test]
    fn the_tax_clerk_assesses_a_report_once_and_chases_it_once_even_when_the_post_changes_hands() {
        let (law, rep) = tax_world();
        let mut clerk = rig(&TaxClerk, "tax-system", "tax", json!({}));
        let first = joined(&clerk.wake(DAY, with_money(papers(vec![law.clone(), rep.clone()]), "0"), vec![]));
        assert!(first.contains("claim(") && first.contains("10000"), "{first}");
        // The claim reaches the file; a new holder reads it and assesses nothing.
        let claim = tax_claim("rec.9", DAY + 60, "tax", 10_000);
        let mut next = rig(&TaxClerk, "tax-system-2", "tax", json!({}));
        assert!(next.wake(2 * DAY, with_money(papers(vec![law.clone(), rep.clone(), claim.clone()]), "0"), vec![]).is_empty());
        // Unpaid after the grace period: the penalty and a letter, once.
        let chase = joined(&next.wake(60 * DAY, with_money(papers(vec![]), "0"), vec![]));
        assert!(chase.contains("tax_penalty") && chase.contains("message("), "{chase}");
        let penalty = tax_claim("rec.10", 60 * DAY, "tax_penalty", 2_000);
        let mut third = rig(&TaxClerk, "tax-system-3", "tax", json!({}));
        assert!(third.wake(70 * DAY, with_money(papers(vec![law, rep, claim, penalty]), "0"), vec![]).is_empty(), "already chased on the file");
    }

    #[test]
    fn the_tax_clerk_assesses_nothing_once_the_law_is_withdrawn() {
        let (law, rep) = tax_world();
        let gone = json!({ "id": "w1", "record": "withdrawal", "author": "clerk", "speaks_for": "city", "at": 8 * DAY, "visible_to": "public", "withdraws": "law-tax" });
        let mut clerk = rig(&TaxClerk, "tax-system", "tax", json!({}));
        assert!(clerk.wake(8 * DAY, with_money(papers(vec![law, gone, rep]), "0"), vec![]).is_empty());
    }

    // ---------------------------------------------------------------- the rates officer

    fn rates_world(interest: i64) -> Vec<Value> {
        vec![
            st("law-rates", 0, "law", json!({ "tax": "rates", "rate_ppm": 10_000, "instalments": 4, "due_days": 30, "penalty_interest_bps": interest }), json!({})),
            st("val-1", 0, "valuation", json!({ "lot": "lot-1", "owner": "landlord-1", "land": 1, "value": 100_000_000, "year": 1 }), json!({})),
        ]
    }

    #[test]
    fn the_rates_officer_levies_at_the_laws_rate_and_a_new_holder_does_not_levy_out_of_cycle() {
        let mut office = rig(&RatesOfficer, "rates-system", "rates", json!({ "first_day": 1 }));
        let first = joined(&office.wake(DAY, with_money(papers(rates_world(0)), "0"), vec![]));
        assert!(first.contains("rates_notice") && first.contains("250000"), "{first}");
        // Its notice is on the file; a successor reads when the last went out and sends no other before the next
        // instalment (91 days), and sends one then.
        let notice = st("rec.20", DAY + 60, "rates_notice", json!({ "amount": 250_000, "lots": ["lot-1"], "due": 31 * DAY, "account": "acc-city" }), json!({ "in_position": "rates", "author": "rates-system", "addressed_to": ["landlord-1"] }));
        let mut next = rig(&RatesOfficer, "rates-system-2", "rates", json!({ "first_day": 1 }));
        let mut recs = rates_world(0);
        recs.push(notice);
        assert!(next.wake(2 * DAY, with_money(papers(recs), "0"), vec![]).is_empty());
        assert!(next.wake(60 * DAY, with_money(papers(vec![]), "0"), vec![]).is_empty());
        assert!(joined(&next.wake(93 * DAY, with_money(papers(vec![]), "0"), vec![])).contains("rates_notice"));
    }

    #[test]
    fn overdue_rates_draw_a_months_interest_and_a_successor_reads_what_was_charged_from_the_file() {
        let claim = json!({ "id": "rec.30", "record": "claim", "author": "rates-system", "in_position": "rates", "at": DAY, "visible_to": "public", "position": "right", "holder": "city", "counterparty": "landlord-1", "about": { "kind": "rates", "amount": 250_000, "account": "acc-city", "due": 31 * DAY } });
        let mut recs = rates_world(1200);
        recs.push(claim);
        let mut office = rig(&RatesOfficer, "rates-system", "rates", json!({ "first_day": 400 }));
        let out = joined(&office.wake(62 * DAY, with_money(papers(recs.clone()), "0"), vec![]));
        assert!(out.contains("rates_interest") && out.contains("2500"), "{out}");
        let charged = json!({ "id": "rec.31", "record": "claim", "author": "rates-system", "in_position": "rates", "at": 62 * DAY, "visible_to": "public", "position": "right", "holder": "city", "counterparty": "landlord-1", "about": { "kind": "rates_interest", "amount": 2_500 }, "basis": "rec.30" });
        recs.push(charged);
        let mut next = rig(&RatesOfficer, "rates-system-2", "rates", json!({ "first_day": 400 }));
        assert!(next.wake(63 * DAY, with_money(papers(recs.clone()), "0"), vec![]).is_empty(), "a month's interest is not charged twice");
        assert!(joined(&next.wake(93 * DAY, with_money(papers(vec![]), "0"), vec![])).contains("rates_interest"), "the next month's is");
    }

    #[test]
    fn the_rates_officer_says_why_when_the_rating_law_is_withdrawn() {
        let gone = json!({ "id": "w3", "record": "withdrawal", "author": "clerk", "speaks_for": "city", "at": 100 * DAY, "visible_to": "public", "withdraws": "law-rates" });
        let mut office = rig(&RatesOfficer, "rates-system", "rates", json!({ "first_day": 1 }));
        let letter = json!({ "id": "m1", "t": 120 * DAY, "from": "mayor-system", "to": ["rates-system"], "text": "?" });
        let mut recs = rates_world(0);
        recs.push(gone);
        let out = joined(&office.wake(120 * DAY, with_money(papers(recs), "0"), vec![letter]));
        assert!(!out.contains("rates_notice"));
        assert!(out.contains("the rating law has been withdrawn, so no rates are levied"), "{out}");
    }

    // ---------------------------------------------------------------- the finance officer

    fn budget(year: i64, at: i64, lines: Value) -> Value {
        st(&format!("budget-{year}"), at, "budget", json!({ "year": year, "lines": lines }), json!({}))
    }
    fn invoice(id: &str, at: i64, amount: i64) -> Value {
        st(id, at, "invoice", json!({ "outcome": { "money": { "to": "acc-builder", "amount": amount.to_string() } } }), json!({ "author": "builder-system", "speaks_for": "builder", "addressed_to": ["city"] }))
    }

    #[test]
    fn the_finance_office_pays_within_the_years_budget_and_under_a_twelfth_a_month_while_the_year_has_none() {
        let money = "100000000";
        let mut fin = rig(&FinanceOfficer, "finance-system", "finance", json!({}));
        let first = joined(&fin.wake(DAY, with_money(papers(vec![budget(1, 0, json!({ "parks": 1_200_000 })), invoice("inv-1", DAY, 900_000)]), money), vec![]));
        assert!(first.contains("settles=inv-1"), "{first}");
        assert!(!joined(&fin.wake(4 * DAY, with_money(papers(vec![invoice("inv-2", 4 * DAY, 400_000)]), money), vec![])).contains("money("), "over the budget");
        // A year with no budget: a twelfth of the last, a month.
        let mut interim = rig(&FinanceOfficer, "finance-system", "finance", json!({}));
        interim.wake(DAY, with_money(papers(vec![budget(1, 0, json!({ "parks": 1_200_000 }))]), money), vec![]);
        let day = |n: i64| 365 * DAY + n * DAY;
        let paid = joined(&interim.wake(day(2), with_money(papers(vec![invoice("inv-a", day(1), 60_000), invoice("inv-b", day(1), 70_000)]), money), vec![]));
        assert!(paid.contains("settles=inv-a") && !paid.contains("settles=inv-b"), "{paid}");
        assert!(joined(&interim.wake(day(32), with_money(papers(vec![]), money), vec![])).contains("settles=inv-b"), "the second month's twelfth");
        // A town that never had a budget pays nothing.
        let mut none = rig(&FinanceOfficer, "finance-system", "finance", json!({}));
        assert!(!joined(&none.wake(DAY, with_money(papers(vec![invoice("inv-1", DAY, 100)]), money), vec![])).contains("money("));
    }

    #[test]
    fn an_invoice_over_the_procedures_figure_waits_for_the_mayors_approval_which_is_asked_once() {
        let mut fin = rig(&FinanceOfficer, "finance-system", "finance", json!({ "procedure": "proc-payments" }));
        let procedure = st("proc-payments", 0, "procedure", json!({ "approval": { "by": "mayor", "over": 5_000_000 } }), json!({}));
        let first = fin.wake(6 * DAY, with_money(papers(vec![budget(1, 0, json!({ "parks": 20_000_000 })), procedure, invoice("inv-1", 5 * DAY, 12_000_000)]), "900000000"), vec![]);
        let text = joined(&first);
        assert!(!text.contains("money(") && text.contains("message(") && text.contains("your written approval is needed for invoice inv-1"), "{text}");
        assert!(fin.wake(9 * DAY, with_money(papers(vec![]), "900000000"), vec![]).is_empty(), "not asked again");
        let approval = st("app-1", 10 * DAY, "approval", json!({ "invoice": "inv-1" }), json!({ "in_position": "mayor", "addressed_to": ["city"], "basis": "inv-1" }));
        assert!(joined(&fin.wake(12 * DAY, with_money(papers(vec![approval]), "900000000"), vec![])).contains("settles=inv-1"));
    }

    fn job(id: &str, at: i64, worker: &str) -> Value {
        json!({ "id": id, "record": "agreement", "author": "environment-system", "at": at, "visible_to": ["city", worker],
            "terms": { "template": "employment", "parties": ["city", worker], "text": format!("{worker} works for city as works crew for 300000 cents every 14 days."),
                "commitments": [{ "who": "city", "does": { "outcome": { "money": { "to": format!("acc-{worker}"), "amount": "300000", "for": "wages" } } }, "every": 14 * DAY }] } })
    }
    fn signature(id: &str, at: i64, agreement: &str, who: &str) -> Value {
        json!({ "id": id, "record": "signature", "author": who, "at": at, "visible_to": ["city"], "agreement": agreement, "as": who })
    }

    #[test]
    fn the_payroll_sets_a_wage_up_on_the_hiring_offices_notice_or_from_the_agreement_after_the_wait() {
        let staff = vec![job("job-9", 2 * DAY, "c9"), signature("s1", 2 * DAY, "job-9", "city"), signature("s2", 4 * DAY, "job-9", "c9")];
        let notice = st("rec.50", 4 * DAY + 3600, "payroll_notice", json!({ "notice": "starter", "employee": "c9", "post": "scientist", "agreement": "job-9", "wage": 300_000, "period": 14 * DAY, "first_pay": 18 * DAY, "account": "acc-c9", "line": "environment" }), json!({ "author": "environment-system", "in_position": "environment" }));
        let mut with = rig(&FinanceOfficer, "finance-system", "finance", json!({}));
        let made = joined(&with.wake(6 * DAY, with_money(papers([staff.clone(), vec![notice]].concat()), "900000000"), vec![]));
        assert!(made.contains("acc-c9") && made.contains("12 days") && made.contains("line=environment"), "{made}");
        // With none it waits (two days since the signing) and then sets the wage up from the agreement.
        let mut without = rig(&FinanceOfficer, "finance-system", "finance", json!({}));
        assert!(without.wake(6 * DAY, with_money(papers(staff), "900000000"), vec![]).is_empty());
        let late = joined(&without.wake(9 * DAY, with_money(papers(vec![]), "900000000"), vec![]));
        assert!(late.contains("acc-c9"), "{late}");
    }

    // ---------------------------------------------------------------- an office and the systems on offer

    fn system_offer(id: &str) -> Value {
        st(
            "rec.90",
            DAY,
            "system_offer",
            json!({ "id": id, "title": "rates notice writer", "for": "offices", "kinds": ["rates_notice"], "template": "installed-system", "seconds": 600, "speed_bps": 2000, "scope_bps": 9000, "setup": 100_000, "fee_per_year": 120_000,
                "exit": 0, "term_days": 365, "notice_days": 30, "oversight_hours_per_month": 0, "error_bps": 0, "account": "acc-vendor", "fee_month": 10_000, "references": 0 }),
            json!({ "speaks_for": "vendor-1", "author": "vendor-system" }),
        )
    }
    fn made_notices(n: i64) -> Vec<Value> {
        (0..n).map(|i| st(&format!("rec.{}", 100 + i), 5 * DAY + i, "rates_notice", json!({ "amount": 1000, "lots": ["lot-1"], "due": 40 * DAY, "account": "acc-city" }), json!({ "addressed_to": ["landlord-1"] }))).collect()
    }
    fn desk_params(procurement: Value) -> Value {
        json!({ "automation": {}, "procurement": procurement,
            "casework": { "kinds": ["rates_notice"], "person_seconds": { "rates_notice": 3600 }, "wage_month": 500_000, "seconds_per_worker_month": 144_000, "utilisation_bps": 8000 } })
    }

    #[test]
    fn an_office_that_may_take_systems_orders_those_that_save_its_staff_more_than_they_cost_once_and_only_once() {
        let mut rates = rig(&RatesOfficer, "rates-system", "rates", desk_params(Value::Null));
        let mut shown = made_notices(40);
        shown.push(system_offer("writer-1"));
        // Before the first monthly look it does nothing about systems.
        assert!(!joined(&rates.wake(10 * DAY, with_money(papers(shown.clone()), "900000000"), vec![])).contains("system:writer-1"));
        let out = joined(&rates.wake(35 * DAY, with_money(papers(vec![]), "900000000"), vec![]));
        assert!(out.contains("kind=order") && out.contains("system:writer-1") && out.contains("acc-vendor"), "{out}");
        let again = joined(&rates.wake(66 * DAY, with_money(papers(vec![]), "900000000"), vec![]));
        assert!(!again.contains("system:writer-1"), "one order out until the systems come: {again}");
    }

    #[test]
    fn above_the_laws_threshold_it_invites_bids_first() {
        let mut rates = rig(&RatesOfficer, "rates-system", "rates", desk_params(json!({ "threshold": 1, "bid_days": 10 })));
        let mut shown = made_notices(40);
        shown.push(system_offer("writer-1"));
        let out = joined(&rates.wake(35 * DAY, with_money(papers(shown), "900000000"), vec![]));
        assert!(out.contains("kind=tender") && out.contains("write rates_notice"), "{out}");
        assert!(!out.contains("system:writer-1"), "not ordered before the bids are in: {out}");
    }

    #[test]
    fn an_office_given_no_systems_to_weigh_looks_at_none() {
        let mut rates = rig(&RatesOfficer, "rates-system", "rates", json!({}));
        let mut shown = made_notices(40);
        shown.push(system_offer("writer-1"));
        assert!(!joined(&rates.wake(35 * DAY, with_money(papers(shown), "900000000"), vec![])).contains("system:writer-1"));
    }

    // ---------------------------------------------------------------- the works office

    fn works_params(part: &str) -> Value {
        json!({ "depot": "depot-1", "workplace": "depot-1/ws.1", "landfill": "landfill-1", "collect_labour": 600, "collect_per_unit": 10, "wage": 100_000, "round": "round", "part": part, "payroll_office": "finance" })
    }
    fn depot_channels(occupants: Vec<&str>) -> Value {
        json!({
            "round": { "kind": "records", "records": [st("round-house-1", 0, "service_address", json!({ "structure": "house-1", "at": "c2" }), json!({})), st("round-house-2", 0, "service_address", json!({ "structure": "house-2", "at": "c3" }), json!({}))] },
            "depot": { "kind": "sites", "as_of": 0, "cells": [{ "cell": "c1", "x": 0, "y": 0, "structure": { "structure": "depot-1", "type": "depot", "at": "c1", "w": 1, "h": 1, "complete": true,
                "spaces": [{ "space": "depot-1/ws.1", "kind": "workplace", "capacity": 4, "count": occupants.len(), "occupants": occupants }] } }] },
        })
    }
    fn order(id: &str, task: &str) -> Value {
        st(id, 0, "work_order", json!({ "work": { "task": task, "at": "depot-1" }, "every": 7 * DAY }), json!({ "in_position": "works", "author": "works-system" }))
    }

    #[test]
    fn the_crew_collects_by_the_standing_order_and_does_nothing_without_one() {
        let crew = vec![job("job-1", 0, "w1"), signature("s1", 0, "job-1", "city"), signature("s2", 0, "job-1", "w1")];
        let mut chans = depot_channels(vec!["w1"]);
        let all: Vec<Value> = [crew.clone(), vec![order("wo-1", "collect"), budget(1, 0, json!({ "staff": 1_000_000 }))]].concat();
        chans["papers"] = json!({ "kind": "records", "records": all });
        let mut staff = rig(&Works, "works-staff-system", "works-staff", works_params("staff"));
        let out = joined(&staff.wake(8 * 3600 + 7 * DAY, with_money(chans, "0"), vec![]));
        assert!(out.contains("work(") && out.contains("task=collect") && out.contains("on=house-1"), "{out}");
        // No order: the crew does not collect, and its report says so.
        let mut chans = depot_channels(vec!["w1"]);
        chans["papers"] = json!({ "kind": "records", "records": crew });
        let mut idle = rig(&Works, "works-staff-system", "works-staff", works_params("staff"));
        let out = joined(&idle.wake(8 * 3600 + 7 * DAY, with_money(chans, "0"), vec![]));
        assert!(!out.contains("work(task"), "{out}");
        assert!(out.contains("no standing work order for collect"), "{out}");
    }

    #[test]
    fn the_office_holder_sets_each_order_once_and_a_successor_finds_it_on_the_file() {
        let mut seat = rig(&Works, "works-system", "works", works_params("seat"));
        let first = joined(&seat.wake(8 * 3600, with_money(depot_channels(vec![]), "0"), vec![]));
        assert!(first.contains("work(") && first.contains("task=collect") && first.contains("7 days"), "{first}");
        let mut next = rig(&Works, "works-system-2", "works", works_params("seat"));
        let mut chans = depot_channels(vec![]);
        chans["papers"] = json!({ "kind": "records", "records": [order("wo-1", "collect")] });
        let again = joined(&next.wake(8 * 3600 + DAY, with_money(chans, "0"), vec![]));
        assert!(!again.contains("task=collect"), "{again}");
    }

    #[test]
    fn the_weekly_load_goes_to_the_landfill_with_a_docket_and_a_successor_reads_the_last_one_from_the_file() {
        let mut chans = depot_channels(vec![]);
        chans["holdings"] = json!({ "kind": "holdings", "holdings": [{ "kind": "waste", "at": "depot-1", "quantity": "5" }] });
        let mut office = rig(&Works, "works-system", "works", works_params(""));
        let out = joined(&office.wake(8 * DAY, with_money(chans.clone(), "0"), vec![]));
        assert!(out.contains("goods(") && out.contains("disposal_docket"), "{out}");
        let docket = st("rec.70", 8 * DAY, "disposal_docket", json!({ "kind": "waste", "quantity": 5 }), json!({ "in_position": "works", "author": "works-system" }));
        let mut next = rig(&Works, "works-system-2", "works", works_params(""));
        chans["papers"] = json!({ "kind": "records", "records": [docket] });
        let out = joined(&next.wake(9 * DAY, with_money(chans, "0"), vec![]));
        assert!(!out.contains("goods("), "{out}");
    }

    #[test]
    fn the_office_posts_a_job_when_short_of_the_crew_its_staff_line_pays_for_and_tells_the_payroll_of_a_starter() {
        let mut chans = depot_channels(vec![]);
        chans["papers"] = json!({ "kind": "records", "records": [budget(1, 0, json!({ "staff": 5_000_000 }))] });
        let mut office = rig(&Works, "works-system", "works", works_params(""));
        let out = joined(&office.wake(8 * 3600, with_money(chans, "0"), vec![]));
        assert!(out.contains("job_posting"), "{out}");
        let staff = vec![job("job-9", 2 * DAY, "c9"), signature("s1", 2 * DAY, "job-9", "city"), signature("s2", 4 * DAY, "job-9", "c9")];
        let mut chans = depot_channels(vec![]);
        chans["papers"] = json!({ "kind": "records", "records": staff });
        let mut office = rig(&Works, "works-system", "works", works_params(""));
        let out = joined(&office.wake(5 * DAY + 8 * 3600, with_money(chans, "0"), vec![]));
        assert!(out.contains("payroll_notice") && out.contains("Payroll notice from the hiring office, new starter: c9"), "{out}");
    }

    #[test]
    fn every_office_saves_and_the_restored_one_steps_as_the_original() {
        let (law, rep) = tax_world();
        let mut clerk = rig(&TaxClerk, "tax-system", "tax", json!({}));
        clerk.wake(DAY, with_money(papers(vec![law, rep]), "0"), vec![]);
        let saved = clerk.actor.save().expect("saves");
        let back = TaxClerk.restore(&clerk.ctx, saved.clone()).expect("restores");
        assert_eq!(back.save().expect("saves"), saved);
        for (kind, position, params) in [(&FinanceOfficer as &dyn Kind, "finance", json!({})), (&RatesOfficer, "rates", json!({})), (&Works, "works", works_params(""))] {
            let r = rig(kind, "x", position, params);
            let saved = r.actor.save().expect("saves");
            assert_eq!(kind.restore(&r.ctx, saved.clone()).expect("restores").save().expect("saves"), saved);
        }
    }
}
