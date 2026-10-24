//! The mind's seam: what a citizen's life (lane A1: housing, work, money, lifecycle, deaths, recourse) asks of its
//! mind (lane A2: deciding, feelings, ties, trust, wants, culture, town memory, reading, founding), and what it tells
//! it. participants/src/behaviour/citizen.ts is one closure of 5,000 lines in which both halves share local state;
//! this trait is the line between them, so that the two lanes can port at once (docs/port-guide.md, section 5).
//!
//! **The rule of the seam.** Life owns the body, the household, money, home, job, the book of what was seen, and every
//! act about those; it carries out every act, including those the mind chooses. The mind owns who the person is
//! (values, temperament), what they have learned of options, their feelings, ties, trust and agency, their wants,
//! norms, beliefs and what they remember of the town; it owns the person's own record (the kernel's `own_record`), the
//! `decision` and `outcome` annotations, and every question to a model (consult, compose, reading). Life never reads a
//! mind's insides: it asks (`Outlook`) or tells (`Event`). The mind never reads life's insides: it is given `Life`, a
//! plain picture of the person's circumstances made fresh by life, and the book.
//!
//! **How a wake goes** (citizen.ts `wake`): life absorbs the picture into its book; calls `woke`; reports what
//! happened as `event`s and `outcome`s, in the order TS reported them; asks `decide` where it chooses among options;
//! asks `choose_conduct` where a norm leans a yes-or-no; calls `plan` once a full plan is due (the mind's own steps:
//! wants pursued, gatherings, founding, civic acts, talk); carries out what came back; and at the end `record`.
//!
//! **Determinism.** The mind draws only from `cx` (keyed streams, `cx.rng(purpose)`), with the purposes TS used, so a
//! town and its twin draw alike. Life draws its own (a conduct's draw is life's: `ConductAsk::draw_bps`).
//!
//! **Ownership.** This file is A2's (the implementer's); A1 is told of every change (SendMessage) and it goes in the
//! decisions log. `Plain` below is a stand-in A1 tests with until A2's mind is in; it is no model of anyone.
//!
//! Numbers: money in cents a month unless said; shares and strengths in basis points (0..10,000); z-scores in
//! hundredths of a standard deviation (TS used floats; decided fresh: integers, rounded half away from zero).

use crate::common::Book;
use crate::steps::Step;
use crate::Cx;
use oikos_sight::Picture;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

// ------------------------------------------------------------------ what life tells the mind about itself

/// The person's circumstances, as life knows them, made fresh before each call that needs them (balances change in a
/// plan: a rent missed, a bill paid; TS's `needLevels` read them each time). Everything the mind may know of life.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Life {
    pub t: i64,
    /// Days since birth (from `body.born_at`).
    pub age_days: i64,
    pub adult: bool,
    /// The household's income a month (cents), all adults.
    pub monthly_income: i64,
    /// What the person has in hand (their account's balance).
    pub savings: i64,
    /// A month's essentials for the household (food, rent or loan, bills).
    pub essentials: i64,
    pub household: u32,
    pub children: u32,
    pub housed: Housed,
    pub bedrooms_needed: Option<u32>,
    /// The home's rent a month, its landlord, its lease (absent: none).
    pub rent: Option<i64>,
    pub landlord: Option<String>,
    pub lease: Option<String>,
    /// The job: employer, agreement, wage a period, the period, since when.
    pub employer: Option<String>,
    pub job: Option<String>,
    pub wage: Option<i64>,
    pub period: Option<i64>,
    pub job_since: Option<i64>,
    /// Works for themself (a trade, a pitch, a shop of their own).
    pub own_work: Option<String>,
    pub retired: bool,
    pub in_labour_force: bool,
    /// Goods held at home a month's worth (units), for subsistence.
    pub goods_held: i64,
    /// How many people they know to talk to.
    pub contacts: u32,
    /// The bodies they are members of (unions, groups), and those they deal with (shops, a bank).
    pub member_of: Vec<String>,
    pub deals_with: Vec<String>,
    /// The industry they work in, where they do.
    pub industry: Option<String>,
    /// Holds the household's lease (or lives alone); the leaseholder, where another.
    pub leaseholder: bool,
    pub leaseholder_is: Option<String>,
    /// The other adults of the household (by person), and the children (by person), sorted.
    pub household_adults: Vec<String>,
    /// The dwelling they live in now (their home, moved in, or where the household lives), and whether it is owned.
    pub dwelling: Option<String>,
    pub owned: bool,
    /// Those seen living in the same building now (other dwellings), sorted: neighbours who share its state.
    pub neighbours: Vec<String>,
    /// The body's sex as the kernel shows it ("female", "male"), and whether they are on their way out of town.
    pub sex: Option<String>,
    pub leaving: bool,
    /// The household's other income a month that the leaseholder budgets with (cents), counted in `monthly_income`.
    /// A share of rent the person pays the leaseholder a month (not the leaseholder).
    pub rent_share: Option<i64>,
    /// Their account at a bank, where they have one (a want's acts that cost money need it).
    pub account: Option<String>,
    /// Where they work (the job's workplace), where it has one.
    pub workplace: Option<String>,
    /// The shop they go to and how fully it last served them (basis points), for what they tell (citizen.ts
    /// `favourite`, `lastServed`); whether they have claimed unpaid wages from the job (`job.claimed`).
    pub shop: Option<String>,
    pub served_bps: Option<i64>,
    pub claimed_wages: bool,
}

/// Where the person lives.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Housed {
    /// In a home of their own (owned).
    Own,
    /// Under a lease of their own or a member of their household's.
    #[default]
    Rents,
    /// Staying with someone, on their say-so.
    Lodging,
    /// Nowhere.
    None,
}

/// A person when first made (the generator's draw and the world's dials): what the mind is drawn from.
pub struct Born<'a> {
    pub life: &'a Life,
    /// The person's own values where the world gives them (`own_values`), else drawn from the population's.
    pub own_values: Option<&'a Value>,
    /// The parents' minds as they stand, for a child born in the run (upbringing: citizen.ts 1992-2099).
    pub parents: Vec<&'a dyn Outlook>,
}

// ------------------------------------------------------------------ deciding among options (mind.ts `decide`)

/// What taking up an option would change, in a month, in the world's terms (mind.ts `Facts`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Facts {
    /// Money a month: + in, - out (cents).
    pub money_per_month: i64,
    /// A place to live comes with it (and its bedrooms, if known).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home: Option<HomeFacts>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_hours_per_month: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goods_per_month: Option<i64>,
    /// Others around: members, workmates, fellow attendees, where known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub company: Option<i64>,
    /// Hours a month out of one's own time, unpaid.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_hours_per_month: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct HomeFacts {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bedrooms: Option<i64>,
}

/// An option in a decision (mind.ts `Choice`): its key, what taking it would bring, how many others the person knows
/// took it, and what it means to them beyond the facts (basis points; absent: the mind's own reading).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Choice {
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facts: Option<Facts>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub others: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meaning: Option<i64>,
}

/// A decision life puts to the mind: a domain (as decisions name areas of life: `home`, `job`, `shop`, `practice`,
/// ...), the options, what the person does now, and how this area has gone where life knows (citizen.ts `decide`).
#[derive(Debug, Clone, Default)]
pub struct Decide {
    pub domain: String,
    pub options: Vec<Choice>,
    pub current: Option<String>,
    /// How this area has gone (basis points; the lower of it and life as a whole counts).
    pub satisfied_here: Option<i64>,
    /// Doubt beyond what is known of the options (basis points).
    pub doubt: Option<i64>,
    /// The stream it draws on (TS `ctx.rng("home")`, `"job"`, `"shop"`...): none, the domain's name.
    pub purpose: Option<String>,
    /// Bedrooms the household needs, for a home (the decision's circumstances).
    pub bedrooms_needed: Option<u32>,
    /// The decision this one follows up (the citizen's own count, `DecisionRecord.n`).
    pub follows: Option<u64>,
    /// Extra facts for the decision's record (an area's own: the shop's shortfall), as life has them.
    pub note: Option<Value>,
}

/// What the mind chose (mind.ts `Decision`): the option (none: nothing chosen), how, each option's score, and the
/// decision's number in the citizen's own count (what an outcome later names as `of`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Decision {
    pub key: Option<String>,
    /// repeat, imitate, compare or deliberate (CONSUMAT's quadrants).
    pub strategy: String,
    pub scores: Vec<(String, i64)>,
    pub satisfaction: Option<i64>,
    pub certainty: Option<i64>,
    pub n: Option<u64>,
}

/// A yes-or-no that a norm leans (citizen.ts `reads`, `cul.act`, `cul.facts`, `cul.norm`): whether to stay past a
/// notice, answer a tribunal, take someone in, challenge a rent rise, apply for a debt, complain, take what is not
/// one's own. Life draws the chance; the mind leans it by trust and agency in whoever it concerns (for one who takes
/// initiative) and by culture's lean, records the act against the norm, and gives the norm's facts for life's outcome.
#[derive(Debug, Clone, Default)]
pub struct ConductAsk {
    /// The conduct, as culture names it (culture.ts `Conduct`: `stay_past_notice`, `take_to_tribunal`, ...).
    pub conduct: String,
    /// The chance before any lean (basis points), as life's own rule gives it.
    pub base_bps: i64,
    /// Life's draw for it (basis points, 0..10,000), from its own stream: does = draw below the leaned chance.
    pub draw_bps: i64,
    /// Whom it concerns, where TS read the chance through `reads(bps, who, conduct)` (trust and agency sway it);
    /// none: culture's lean only (`cul.term`), or none at all where `lean` is false.
    pub who: Option<String>,
    /// Whether culture leans the chance at all (TS read some draws plain and only recorded the act).
    pub lean: bool,
    /// Already decided by something else (a want's way chose it: `complainNow`, `applyDebtNow`): does, whatever the draw.
    pub forced: bool,
    /// Whether the act is recorded against the norm (`cul.act`): TS skipped it in a few cases (a notice brought
    /// forward from before the year; a debt applied for by a want's way).
    pub act: bool,
    /// Recorded as a decision (domain, the yes key, the no key), with the chance as scores and the norm.
    pub record: Option<(String, String, String)>,
}

/// The mind's answer to a conduct.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Conduct {
    pub does: bool,
    /// The leaned chance (basis points).
    pub bps: i64,
    /// The picture of the conduct as the person held it, for the outcome's facts (culture.ts `facts`); empty with the
    /// culture dial off.
    pub facts: BTreeMap<String, i64>,
}

// ------------------------------------------------------------------ what life tells the mind happened

/// How the person came to know something (docs/design/knowing.md): their own papers and money, being there, published,
/// or asked of a keeper.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Way {
    #[default]
    Mine,
    Here,
    Published,
    Ask,
}

/// One thing the person learned of how something went (module.ts `OutcomeRecord`, life's part of it): the mind adds
/// what it learned of the option, the feelings it appraised and the belief it moved, then records it. Every outcome of
/// life passes through the mind (citizen.ts `outcome` and `learn`, about 70 places).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Outcome {
    pub domain: String,
    pub option: String,
    /// What happened, in a word (served, paid, unpaid, hired, ended, attended, told ...).
    pub kind: String,
    pub way: Way,
    /// Who told it (`told`).
    pub from: Option<String>,
    pub facts: BTreeMap<String, Value>,
    /// The payoff to learn from (basis points), where it is an experience of the option (`learn`); none: only told.
    pub payoff: Option<i64>,
    /// Another's experience, weighed as such (`hearOf`).
    pub heard: bool,
    /// The person's own act came to this (their decision `of`: life passes the decision's `n` where it has it).
    pub of: Option<u64>,
    /// The paper this is about, where there is one (its words may have been read: `paper`).
    pub paper: Option<String>,
}

/// How someone treated the person, for trust and agency (inner.ts `experience`, `tried`, `doneTo`; about 60 places).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Treated {
    /// Who: a person, an organisation, a post.
    pub who: String,
    /// The kind of dealing, as inner.ts names them (`landlord`, `employer`, `office`, `venue`, `neighbour` ...).
    pub kind: String,
    /// It went well for them.
    pub good: bool,
    /// How much it weighs (basis points; absent: the mind's own).
    pub weight_bps: Option<i64>,
    /// Heard of, not lived.
    pub heard: bool,
    /// They tried to do something about it (an ask, an application): agency moves too (`tried`); or it was done to
    /// them (`done_to`).
    pub tried: bool,
    pub done_to: bool,
    /// The paper it came by, whose words may have been read (reading.ts `landing`).
    pub paper: Option<String>,
    /// The tie with them moves too, by this much and for this reason (after the words read have moved it: `ties.add` after `landing`).
    pub tie: Option<(i64, &'static str)>,
}

/// A thing that happened to the person or those close that is **not** an `Outcome` (inner.ts `happened`, citizen.ts
/// `wantBorn` and `grieve` outside `appraised`). Settled with A1, 2026-10-17: everything citizen.ts recorded with
/// `outcome`/`learn`/`hearOf` goes through `Mind::outcome` with TS's domain, kind and facts, and the mind appraises it
/// there (citizen.ts `appraised`: job hired/paid/rise/unpaid/no_work/ended/told, home lease_signed/moved_in/renewed/
/// rent_increase/notice_received, membership joined/rise_won, practice attended/turned_away, venture founded/refused);
/// so a job ended, a hire, unpaid wages, a claim decided are outcomes, never events. An `Event` is the rest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// Someone of the household died (citizen.ts 1680): grief, a want to mourn, the tie dropped. `adults`: the other
    /// adults of the household, who mourn too. The mind answers `Heard::Mourn` with whom to tell (life sends
    /// `MOURNING.tell`).
    Bereaved { who: String, adults: Vec<String> },
    /// A child conceived, with the partner there (citizen.ts 1858: `happened("child")`).
    Conceived,
    /// Gone from a home told to leave or put out (citizen.ts `recordLeaving`, 1879): `how` is `removed`,
    /// `left_on_order` or `left_on_notice`.
    LeftHome { by: String, how: String },
    /// A notice to vacate for arrears first seen (citizen.ts 3012-3021): trust, tie, fear, a want, a trouble to tell.
    NoticeSeen { by: String, lease: String },
    /// The tribunal ordered possession against them (3108).
    OrderedOut { by: String },
    /// Put out by an officer on a warrant (3126).
    PutOut { by: String },
    /// A rent rise noticed that asks more (3222-3233): a want, pursued at once; `Heard::Took` says which way.
    /// `share_bps`: the rise against the household's income a month (10,000 where none).
    RentRise { landlord: String, notice: String, rent: i64, was: i64, share_bps: i64 },
    /// Something gone wrong at someone's hands, newly held (citizen.ts `grieve`, docs/behaviour/frictions.md): life
    /// keeps the grievance (and says it only the first time); the mind records it arising, trust and agency move,
    /// and a want is born. `size_bps` 6,000 where TS gave none; `need` TS's (security where none).
    Grieved { matter: String, party: String, about: Option<String>, amount: Option<i64>, structure: Option<String>, size_bps: i64, need: String, cause: Option<String> },
    /// A service not done at home (the bin, citizen.ts 3502-3509): anger with whoever should do it, by how long
    /// (`share_bps`: the anger TS computed, (days since emptied) x 5,000 / complain_after_days), and a want once it
    /// is past bearing for a week. `complained`: this home is already complained of.
    ServiceLapsed { whom: String, share_bps: i64, days: i64, complained: bool },
    /// What befell another adult of the household, as they told it (`SAYING.trouble`, 2483): `what` is `let_go`,
    /// `notice` or `rent_increase`; `with`: the household's leaseholder.
    HouseholdTrouble { what: String, by: String, with: Option<String> },
    /// A letter of talk (citizen.ts 1440-1514), after life has taken what is its own (a failed payment, the
    /// household's sayings). The mind takes wrongs heard, upbringing, culture's words, mourning, catching up and news;
    /// anything else is `Heard::NotMine` and life goes on with it (asking for a home or work, an office's letter, a
    /// lead). `from`: the participant; `person`: whose person (the directory's); `re`: what it answers.
    Talk { from: String, person: String, text: String, re: Option<String> },
    /// Anything else, named as TS named it, with its facts: a lane adds a variant for anything that recurs.
    Other { what: String, about: Option<String>, facts: BTreeMap<String, Value> },
}

/// What the mind made of an event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Heard {
    /// Not talk the mind takes (life handles it).
    NotMine,
    /// Taken in.
    Taken,
    /// Someone asked how they are (`CATCHING_UP.ask`): the mind answers in its own talk at the next plan.
    Asked(String),
    /// A death in the household: tell these (closest first), with `MOURNING.tell`.
    Mourn(Vec<String>),
    /// A want pursued at once (a rent rise): the way taken, which life carries out (its kind says what came of it:
    /// `ask` and `desk` wait on the answer). Empty: waited.
    Took(Vec<Chosen>),
}

// ------------------------------------------------------------------ wants, and the ways that open for them

/// A want as life may see it (wants.ts `Want`, read only): what it is about, what it seeks, whom it concerns and the
/// paper in its way, how much it matters.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WantView {
    pub about: String,
    /// What it seeks, as typed outcomes (`money.to`, `money.from`, `occupancy`, `work`, `attend`, `goods`).
    pub seeks: Vec<String>,
    pub whom: Option<String>,
    /// The paper that stands in its way: (record, kind, by).
    pub against: Option<(String, String, String)>,
    pub weight_bps: i64,
    pub since: i64,
}

/// A way open for a want (wants.ts `Opening`, citizen.ts `waysFor`), as life sees it from what it has seen. Life
/// offers the ways that are acts of its own (the boards, asking the other party, a desk, a petition, an election, a
/// venue, telling others of a wrong); the mind adds its own (gatherings, the union, a founded group, spending less,
/// catching up) and weighs every one (trust, fear, agency, culture's lean, belief, what the person heard others did),
/// filters by what the want seeks (`meets`), and chooses; life carries the chosen intent out.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Opening {
    /// `offer:employment`, `ask:<party>`, `desk:<desk>`, `petition:<id>`, `stand:<id>`, `tell` ...
    pub key: String,
    /// `offer:employment`, `offer:lease`, `ask`, `desk`, `petition`, `stand`, `tell` (and the mind's own: `practice`,
    /// `join`, `self`, `ties`).
    pub kind: String,
    /// The record it is about (TS `id`).
    pub on: Option<String>,
    pub by: Option<String>,
    pub brings: Vec<String>,
    /// The record it could undo.
    pub undoes: Option<String>,
    /// Whom it bears on.
    pub bears: Vec<String>,
    /// What taking it up costs at once (cents).
    pub cost: Option<i64>,
    /// How many others are known to take it, where life knows (a petition's signatures); none: the mind counts what
    /// it heard.
    pub others: Option<i64>,
    /// The conduct culture names for it (`take_to_tribunal`, `complain`), for culture's lean.
    pub conduct: Option<String>,
    /// A venue for a matter asking did not settle (the bother of it counts against).
    pub venue: bool,
    pub intent: Intent,
}

/// What life carries out when the mind chooses a way (citizen.ts `waysFor`'s `act`s, as data), and the few things the
/// mind's plan asks of life beyond its own steps (`Planned::intents`). Every `on` names a paper or party life knows.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "do", rename_all = "snake_case")]
pub enum Intent {
    /// Nothing: wait and see (or the way is the mind's own: a gathering, catching up, spending less).
    #[default]
    Wait,
    /// Look at the job board now, whatever the month's chance (`searchForced`).
    SearchJobs,
    /// Hunt for another home while housed, until then, beating this rent where that is the point (`moveHunt`).
    HuntHome { until: i64, beat: Option<i64> },
    /// Ask the landlord to hold the rent (`rise`) or let us stay, about the paper in the way.
    AskLandlord { about: String, rise: bool },
    /// Ask the employer for a rise, to this wage.
    AskRise { agreement: String, wage: i64 },
    /// Take a notice of rent increase to the tribunal.
    ChallengeRent { notice: String },
    /// Take a debt owed us to the tribunal.
    ApplyDebt { claim: String },
    /// Complain to the town's desk now.
    Complain,
    /// Ask the other side of a grievance to put it right (the grievance's key).
    AskPutRight { grievance: String },
    /// Take a grievance to a venue that hears it, on its hearing offer, with its fee.
    Venue { grievance: String, venue: String, hearing: String, cost: i64 },
    /// Tell those we are closest to what was done (the grievance's key; the mind's `closest` says whom).
    TellWronged { grievance: String, whom: Vec<String> },
    Sign { petition: String },
    Stand { notice: String },
    /// Join the union now (`joinNow`).
    JoinUnion,
    /// Join a founded group on its offer (the mind's own: it signs).
    JoinGroup { host: String, offer: String },
    /// Start a business: the venture hooks look now, until then (founding's `business` shape).
    FoundBusiness { until: i64 },
    /// Given up on finding work for now: say so, and stop looking until then (`discouragedUntil`).
    StopLooking { until: i64 },
    /// A way a lane adds: named, with its facts.
    Other { what: String, on: Option<String> },
}

/// A grievance as life holds it (citizen.ts `Grievance`), for the mind's weighing and founding's brief.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GrievanceView {
    pub key: String,
    pub matter: String,
    pub party: String,
    pub since: i64,
    pub amount: Option<i64>,
    /// When asked to put it right, and what they said (`granted`, `refused`, `ignored`; none: no answer yet).
    pub asked_at: Option<i64>,
    pub answer: Option<String>,
    pub venues: u32,
    pub told: bool,
}

/// Life's side of wants: the ways open for a want, from what life has seen (citizen.ts `waysFor`, 2119-2298). The
/// one place the mind asks life for something mid-call; a trait object, so neither side holds the other.
pub trait Openings {
    fn for_want(&self, want: &WantView, t: i64) -> Vec<Opening>;
    /// The grievance a want is about, where life holds one (keyed `matter:about-or-party`).
    fn grievance(&self, want: &WantView) -> Option<GrievanceView>;
}

/// No openings at all (tests, and calls where life has none to give).
pub struct NoOpenings;
impl Openings for NoOpenings {
    fn for_want(&self, _: &WantView, _: i64) -> Vec<Opening> {
        vec![]
    }
    fn grievance(&self, _: &WantView) -> Option<GrievanceView> {
        None
    }
}

/// A way the mind chose for a want: the opening and why, in words for the act's reason.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chosen {
    pub want: String,
    pub opening: Opening,
    pub why: String,
}

/// What the mind adds to a wake beyond its answers to life: its own acts (a gathering gone to, a group founded, a
/// petition started or signed, a vote, a stand, a word to someone, a thank-you) as steps life sends with its own; and
/// ways chosen for wants, which life carries out.
#[derive(Debug, Default)]
pub struct Planned {
    pub steps: Vec<Step<()>>,
    pub chosen: Vec<Chosen>,
    /// What the plan asks of life beyond the ways chosen (`StopLooking`, `FoundBusiness`).
    pub intents: Vec<Intent>,
    /// Steps that come before everything else of the wake (TS `steps.unshift`: going to a gathering that is on now,
    /// going home from one that is over).
    pub first: Vec<Step<()>>,
    /// When the mind wants to be awake again whatever the plan (a gathering's start or end; the next tick, when it has
    /// asked a model and waits on the answer): life wakes by the earliest of this and its own.
    pub wake_at: Option<i64>,
}

// ------------------------------------------------------------------ what life may ask of the mind

/// A tie as the mind holds it, for life's own uses (whom to ask to stay with, whom to tell of a death).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tie {
    pub who: String,
    pub affinity_bps: i64,
    pub trust_bps: Option<i64>,
}

/// What life may read of the mind (the places citizen.ts's life code read mind state directly: about 40). Read only.
pub trait Outlook {
    /// A value's place against the population's, in hundredths of a standard deviation (`zValue`).
    fn value_z(&self, value: &str) -> i64;
    /// A temperament facet (conformity, openness ...), basis points.
    fn facet(&self, facet: &str) -> i64;
    /// Trust in whoever this is, in hundredths of a standard deviation from the person's usual (`inner.zTrust`).
    fn trust_z(&self, who: &str) -> i64;
    /// Agency: how much the person believes doing something works, in hundredths of a standard deviation.
    fn agency_z(&self) -> i64;
    /// How attached to a place or group (basis points).
    fn attached(&self, to: &str) -> i64;
    /// A feeling's level about someone or something now (emotion: joy, distress, hope, fear, anger, gratitude).
    fn feeling(&self, emotion: &str, about: &str, t: i64) -> i64;
    fn affinity(&self, who: &str, t: i64) -> i64;
    /// The closest people, at most `n`, closest first (ties by id).
    /// Whether we have come to know them by talking with them, mourning with them or meeting them (TS `peopleWeKnow`).
    fn knows(&self, _who: &str) -> bool {
        false
    }
    fn closest(&self, n: usize, t: i64) -> Vec<Tie>;
    /// The people we remember from homes and workplaces shared (citizen.ts `contacts`, kept by the mind's word of
    /// mouth): whether this is one, and how many. Life reads them here; until 2026-10-18 it kept a copy of its own that
    /// nothing filled, so nobody ever told those they know of a wrong done them.
    fn contact(&self, _who: &str) -> bool {
        false
    }
    fn contacts(&self) -> usize {
        0
    }
    /// What has been learned of an option in a domain (experience-weighted attraction, basis points), if anything.
    fn learned(&self, domain: &str, option: &str) -> Option<i64>;
    /// The person's wants as they stand, heaviest first.
    fn wants(&self) -> Vec<WantView>;
    /// Whether the person has initiative (the dial, as drawn for them), and is pursuing a way of this kind now: a
    /// goal's method (`spend less`, `better work`, `cheaper home`, `catch up more`, `try a gathering`) or, for one
    /// who takes initiative, the want's way it maps to (`self`, `offer:employment`, `offer:lease`, `ties`,
    /// `practice`): citizen.ts `pursuing`. Life asks by the goal's method name.
    fn initiative(&self) -> bool;
    fn pursuing(&self, method: &str) -> bool;
    /// The space of the gathering they are at now, where they are at one (the daily round keeps them there).
    fn at_gathering(&self, t: i64) -> Option<String>;
    /// How patient with a hard situation before acting on it, as their attachments and temperament make them:
    /// citizen.ts's `patience` multiplier (about 0.5 to 1.8) in thousandths (life multiplies its days by it, as TS
    /// did for leaving town).
    fn patience_days(&self) -> i64;
    /// Life as a whole as the person rates it now (basis points), from `life`.
    fn satisfaction(&self, life: &Life) -> i64;
}

// ------------------------------------------------------------------ the mind

/// A citizen's mind. Implemented by lane A2 (`crate::mind`); called only by the citizen's life (lane A1).
pub trait Mind: Outlook + Send {
    /// The records it holds to for its own reasons, whatever their age (a gathering it goes to): never let go of
    /// what is kept of public goings-on (citizen/memory.rs).
    fn holds_to(&self) -> Vec<String> {
        vec![]
    }
    /// The book has let go of some records: what it kept about them goes with them.
    fn forgot(&mut self, _book: &Book) {}
    /// The start of a wake: the clock, and the book as life has absorbed it (the mind reads practices, offers of
    /// membership, hearings and assertions from it: what the person has seen). Answers to the mind's questions of the
    /// last wake are in `cx.answers`.
    fn woke(&mut self, cx: &mut Cx, pic: &Picture, book: &Book, life: &Life);
    /// Choose among options (citizen.ts `decide`, mind.ts `decide`): the needs are the mind's, read from `life`; the
    /// decision is recorded (`cx.decided`) and numbered.
    fn decide(&mut self, cx: &mut Cx, life: &Life, d: Decide) -> Decision;
    /// Choose among options already known to the person, by what has been learned (`learned(d).choose`: a shop to try
    /// next for what the last could not serve).
    fn choose_known(&mut self, cx: &mut Cx, domain: &str, options: &[String], follows: Option<u64>) -> Option<String>;
    /// A yes-or-no a norm leans.
    fn choose_conduct(&mut self, cx: &mut Cx, life: &Life, c: ConductAsk) -> Conduct;
    /// How something turned out: learned, appraised and recorded (`cx.learned`).
    fn outcome(&mut self, cx: &mut Cx, life: &Life, o: Outcome);
    /// How someone treated the person: trust and agency move.
    fn treated(&mut self, cx: &mut Cx, t: Treated);
    /// Something happened: feelings, ties and wants follow, as the mind holds them. Talk returns what of it was the
    /// mind's; a rent rise, the way taken (`ways`: life's openings, as `plan` has them).
    fn event(&mut self, cx: &mut Cx, pic: &Picture, book: &Book, life: &Life, e: Event, ways: &dyn Openings) -> Heard;
    /// A full plan is due (citizen.ts `plan`'s mind half: upbringing, attachments, drift, views, goals, wants born and
    /// met, wants due and their ways, gatherings, founding and groups, civic acts, talk, thanks). `ways` is life's
    /// openings for each want.
    fn plan(&mut self, cx: &mut Cx, pic: &Picture, book: &Book, life: &Life, ways: &dyn Openings) -> Planned;
    /// What the person says when someone asks how they are or what they know (citizen.ts `newsOfMine`), from the
    /// news life gives (its job, its shop, its home) and what the mind remembers.
    fn say_how(&mut self, cx: &mut Cx, asker: &str, life: &Life) -> String;
    /// The household troubles the mind found to tell (`SAYING.trouble` messages life sends), taken once.
    fn troubles_to_tell(&mut self) -> Vec<(String, String)>;
    /// The person's own record as the kernel holds it, written where it has changed (citizen.ts `writeRecord`): the
    /// mind sets it with `cx.set_record`. `adult`: the record a child has is smaller.
    fn record(&mut self, cx: &mut Cx, life: &Life);
    /// What a translator draft of the person's came to (a founding's words: `Words.done`), at the next wake.
    fn words_done(&mut self, cx: &mut Cx, idea: &str, ok: bool, why: Option<&str>);
    /// Its whole memory (snapshot and fork).
    fn save(&self) -> Result<Value, String>;
}

/// A plain stand-in mind for lane A1's tests until A2's is in: the first option where none is known, else the one with
/// the most money a month; a conduct by its base chance; no feelings, ties, wants or record. Deterministic, keyed by
/// nothing but its inputs. Not a model of anyone; never used in a run.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Plain {
    n: u64,
    learned: BTreeMap<String, BTreeMap<String, i64>>,
}

impl Outlook for Plain {
    fn value_z(&self, _: &str) -> i64 {
        0
    }
    fn facet(&self, _: &str) -> i64 {
        5_000
    }
    fn trust_z(&self, _: &str) -> i64 {
        0
    }
    fn agency_z(&self) -> i64 {
        0
    }
    fn attached(&self, _: &str) -> i64 {
        0
    }
    fn feeling(&self, _: &str, _: &str, _: i64) -> i64 {
        0
    }
    fn affinity(&self, _: &str, _: i64) -> i64 {
        0
    }
    fn closest(&self, _: usize, _: i64) -> Vec<Tie> {
        vec![]
    }
    fn learned(&self, domain: &str, option: &str) -> Option<i64> {
        self.learned.get(domain).and_then(|d| d.get(option)).copied()
    }
    fn wants(&self) -> Vec<WantView> {
        vec![]
    }
    fn initiative(&self) -> bool {
        false
    }
    fn pursuing(&self, _: &str) -> bool {
        false
    }
    fn at_gathering(&self, _: i64) -> Option<String> {
        None
    }
    fn patience_days(&self) -> i64 {
        1_000
    }
    fn satisfaction(&self, life: &Life) -> i64 {
        if life.housed == Housed::None || life.monthly_income + life.savings / 12 < life.essentials {
            3_000
        } else {
            7_000
        }
    }
}

impl Mind for Plain {
    fn woke(&mut self, _: &mut Cx, _: &Picture, _: &Book, _: &Life) {}
    fn decide(&mut self, _: &mut Cx, _: &Life, d: Decide) -> Decision {
        self.n += 1;
        let mut o = d.options.clone();
        o.sort_by(|a, b| a.key.cmp(&b.key));
        let best = o.iter().max_by_key(|c| (c.facts.as_ref().map_or(i64::MIN, |f| f.money_per_month), std::cmp::Reverse(c.key.clone())));
        Decision {
            key: best.map(|c| c.key.clone()),
            strategy: "deliberate".into(),
            scores: o.iter().map(|c| (c.key.clone(), c.facts.as_ref().map_or(0, |f| f.money_per_month))).collect(),
            satisfaction: None,
            certainty: None,
            n: Some(self.n),
        }
    }
    fn choose_known(&mut self, _: &mut Cx, domain: &str, options: &[String], _: Option<u64>) -> Option<String> {
        let mut o = options.to_vec();
        o.sort();
        o.into_iter().max_by_key(|k| (self.learned(domain, k).unwrap_or(0), std::cmp::Reverse(k.clone())))
    }
    fn choose_conduct(&mut self, _: &mut Cx, _: &Life, c: ConductAsk) -> Conduct {
        Conduct { does: c.forced || c.draw_bps < c.base_bps, bps: c.base_bps, facts: BTreeMap::new() }
    }
    fn outcome(&mut self, _: &mut Cx, _: &Life, o: Outcome) {
        if let (Some(p), false) = (o.payoff, o.heard) {
            self.learned.entry(o.domain).or_default().insert(o.option, p);
        }
    }
    fn treated(&mut self, _: &mut Cx, _: Treated) {}
    fn event(&mut self, _: &mut Cx, _: &Picture, _: &Book, _: &Life, e: Event, _: &dyn Openings) -> Heard {
        match e {
            Event::Talk { .. } => Heard::NotMine,
            _ => Heard::Taken,
        }
    }
    fn plan(&mut self, _: &mut Cx, _: &Picture, _: &Book, _: &Life, _: &dyn Openings) -> Planned {
        Planned::default()
    }
    fn say_how(&mut self, _: &mut Cx, _: &str, _: &Life) -> String {
        String::new()
    }
    fn troubles_to_tell(&mut self) -> Vec<(String, String)> {
        vec![]
    }
    fn record(&mut self, _: &mut Cx, _: &Life) {}
    fn words_done(&mut self, _: &mut Cx, _: &str, _: bool, _: Option<&str>) {}
    fn save(&self) -> Result<Value, String> {
        serde_json::to_value(self).map_err(|e| e.to_string())
    }
}

/// A mind for a person, as the world's parameters make it: lane A2's (`crate::mind::make`), or the plain stand-in
/// where the params say `mind: "plain"` (A1's tests).
pub fn make(cx: &mut Cx, born: &Born) -> Result<Box<dyn Mind>, String> {
    if cx.ctx.params.get("mind").and_then(Value::as_str) == Some("plain") {
        return Ok(Box::new(Plain::default()));
    }
    crate::mind::make(cx, born)
}

/// A mind as `Mind::save` left it.
pub fn restore(ctx: &crate::Ctx, saved: Value) -> Result<Box<dyn Mind>, String> {
    if ctx.params.get("mind").and_then(Value::as_str) == Some("plain") {
        return Ok(Box::new(serde_json::from_value::<Plain>(saved).map_err(|e| e.to_string())?));
    }
    crate::mind::restore(ctx, saved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Ctx, Draws, WorldInfo};
    use std::sync::Arc;

    #[test]
    fn the_plain_mind_decides_by_money_and_saves() {
        let ctx = Ctx { participant: "p".into(), performer: Default::default(), entity: "ann".into(), position: None, params: serde_json::from_value(serde_json::json!({ "mind": "plain" })).unwrap(), world: Arc::new(WorldInfo::default()) };
        let mut draws = Draws::default();
        let mut cx = Cx::new(0, &ctx, &mut draws, 1, vec![]);
        let life = Life::default();
        let mut m = make(&mut cx, &Born { life: &life, own_values: None, parents: vec![] }).unwrap();
        let f = |m: i64| Some(Facts { money_per_month: m, ..Default::default() });
        let d = m.decide(&mut cx, &life, Decide { domain: "job".into(), options: vec![Choice { key: "b".into(), facts: f(10), ..Default::default() }, Choice { key: "a".into(), facts: f(20), ..Default::default() }], ..Default::default() });
        assert_eq!((d.key.as_deref(), d.n), (Some("a"), Some(1)));
        m.outcome(&mut cx, &life, Outcome { domain: "shop".into(), option: "s1".into(), kind: "served".into(), payoff: Some(800), ..Default::default() });
        let again = restore(&ctx, m.save().unwrap()).unwrap();
        assert_eq!(again.learned("shop", "s1"), Some(800));
    }
}
