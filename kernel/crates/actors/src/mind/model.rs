//! The citizen model (docs/design/citizen-model.md; docs/citizen-data.md, "The citizen model"): a small network of our
//! own, the same weights for every person, that gives the odds of each way of going after a want. Round 1's head is
//! that one decision (`want-way`: ask the other side, a desk or venue, a petition, an offer, telling others, ... or
//! wait), trained on the code mind's own recorded odds. It is a pure function from what the decision was made from
//! (the `situation` the mind records with the decision, and each option's key and what the person has learned of it)
//! to a score an option; it keeps nothing between calls, sees no name or id, and never writes words (VISION 15.7).
//!
//! **What it reads is what the capture holds.** `features` reads the situation exactly as `plan.rs` writes it into the
//! decision, less the code mind's own scoring (`code.odds`, each opening's `adj`, each option's `score`): its odds are
//! targets, never inputs. Training reads the same rows through the same function, so training and serving read one
//! thing.
//!
//! **Deterministic.** Weights and the standardisation are whole numbers in 1/65,536ths (so the file says exactly what
//! the run computes, and a value read from JSON is the value trained); the forward pass is IEEE addition and
//! multiplication in a fixed order with ReLU, and the odds are made by `math::exp` and rounded to whole parts per
//! million, as the code mind's are. The draw is the kernel's stream, taken by the caller as the code mind takes it.
//!
//! **Order cannot count.** One scorer is applied to each option alone (the person and the situation beside the
//! option's own row), so the odds are the same in any order of the options, to the part per million.

use super::math;
use serde_json::Value as Json;
use std::collections::BTreeMap;

/// Fixed point of weights, means and scales: 2^16.
pub const ONE: f64 = 65_536.0;
pub const SCHEMA: &str = "citizen-model/1";
/// The decision this round's head gives odds for.
pub const HEAD: &str = "want-way";

/// The kinds of way a want is gone after, as the mind names its options (plan.rs `ways_for`, and `wait`).
pub const KINDS: [&str; 12] = ["ask", "desk", "join", "offer:employment", "offer:lease", "petition", "practice", "self", "stand", "tell", "ties", "wait"];
/// What a want seeks, and what an opening brings (wants.rs `SEEK_KEYS`, by name).
pub const SEEKS: [&str; 6] = ["money.to", "money.from", "occupancy", "work", "attend", "goods"];
/// The values, temperament and needs of a record, by name (mind/person.rs).
pub const VALUES: [&str; 10] = ["achievement", "benevolence", "conformity", "hedonism", "power", "security", "self_direction", "stimulation", "tradition", "universalism"];
pub const TEMPERAMENT: [&str; 3] = ["conformity", "openness", "prestige"];
pub const NEEDS: [&str; 7] = ["belonging", "meaning", "security", "shelter", "social", "status", "subsistence"];

/// The open vocabularies of a situation (what a want is about, whom, a matter's answer, a party's role, a kind of
/// trust, what a memory is of), as the trainer found them in its data, each sorted; a word not listed reads as
/// "another". Part of the model's file: the platform names no place's words here.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Vocab {
    pub about: Vec<String>,
    pub from: Vec<String>,
    pub whom: Vec<String>,
    pub against: Vec<String>,
    pub matter: Vec<String>,
    pub answer: Vec<String>,
    pub role: Vec<String>,
    pub trust_kind: Vec<String>,
    pub memory: Vec<String>,
}

const VOCABS: [&str; 9] = ["about", "from", "whom", "against", "matter", "answer", "role", "trust_kind", "memory"];

impl Vocab {
    fn get(&self, name: &str) -> &Vec<String> {
        match name {
            "about" => &self.about,
            "from" => &self.from,
            "whom" => &self.whom,
            "against" => &self.against,
            "matter" => &self.matter,
            "answer" => &self.answer,
            "role" => &self.role,
            "trust_kind" => &self.trust_kind,
            _ => &self.memory,
        }
    }
    fn get_mut(&mut self, name: &str) -> &mut Vec<String> {
        match name {
            "about" => &mut self.about,
            "from" => &mut self.from,
            "whom" => &mut self.whom,
            "against" => &mut self.against,
            "matter" => &mut self.matter,
            "answer" => &mut self.answer,
            "role" => &mut self.role,
            "trust_kind" => &mut self.trust_kind,
            _ => &mut self.memory,
        }
    }
    pub fn of_json(v: &Json) -> Result<Vocab, String> {
        let mut out = Vocab::default();
        for name in VOCABS {
            let words = v.get(name).and_then(|x| x.as_array()).ok_or_else(|| format!("citizen model: vocab.{name} missing"))?;
            let mut w: Vec<String> = words.iter().map(|x| x.as_str().map(str::to_string).ok_or(format!("citizen model: vocab.{name}: not a word"))).collect::<Result<_, _>>()?;
            w.sort();
            w.dedup();
            *out.get_mut(name) = w;
        }
        Ok(out)
    }
    pub fn to_json(&self) -> Json {
        Json::Object(VOCABS.iter().map(|n| (n.to_string(), Json::Array(self.get(n).iter().map(|w| Json::String(w.clone())).collect()))).collect())
    }
    /// The words of a set of situations, those seen at least `min` times (the trainer's).
    pub fn gather<'a>(situations: impl Iterator<Item = &'a Json>, min: usize) -> Vocab {
        let mut seen: BTreeMap<(&'static str, String), usize> = BTreeMap::new();
        let mut add = |k: &'static str, w: Option<&str>| {
            if let Some(w) = w {
                *seen.entry((k, w.to_string())).or_default() += 1;
            }
        };
        for s in situations {
            let want = &s["want"];
            add("about", want["about"].as_str());
            add("from", want["from"].as_str());
            add("whom", want["whom"].as_str());
            add("against", want["against"].as_str());
            add("matter", s["matter"]["matter"].as_str());
            add("answer", s["matter"]["answer"].as_str());
            for o in s["openings"].as_array().into_iter().flatten() {
                add("role", o["by"].as_str());
            }
            for t in s["record"]["trust"]["in"].as_array().into_iter().flatten() {
                add("trust_kind", t["kind"].as_str());
            }
            for part in ["defining", "recent"] {
                for m in s["record"]["memory"][part].as_array().into_iter().flatten() {
                    add("memory", m["what"].as_str());
                }
            }
        }
        let mut v = Vocab::default();
        for ((k, w), n) in seen {
            if n >= min {
                v.get_mut(k).push(w);
            }
        }
        v
    }
}

/// One-hot (or a count) over a vocabulary, with a last slot for a word not in it.
fn hot(out: &mut Vec<f64>, words: &[String], w: Option<&str>, by: f64) {
    let at = out.len();
    out.resize(at + words.len() + 1, 0.0);
    if let Some(w) = w {
        let i = words.binary_search_by(|x| x.as_str().cmp(w)).unwrap_or(words.len());
        out[at + i] += by;
    }
}
fn hot_fixed(out: &mut Vec<f64>, words: &[&str], w: Option<&str>) {
    let at = out.len();
    out.resize(at + words.len() + 1, 0.0);
    if let Some(w) = w {
        let i = words.iter().position(|x| *x == w).unwrap_or(words.len());
        out[at + i] = 1.0;
    }
}
fn num(v: &Json) -> f64 {
    v.as_i64().map(|x| x as f64).or_else(|| v.as_f64()).unwrap_or(0.0)
}
fn bps(v: &Json) -> f64 {
    num(v) / 10_000.0
}
/// ln(1 + max(x, 0)), for counts, days and sums that span orders of magnitude.
fn log1p(x: f64) -> f64 {
    math::ln(1.0 + x.max(0.0))
}
fn has(v: &Json) -> f64 {
    if v.is_null() || v == &Json::Bool(false) {
        0.0
    } else {
        1.0
    }
}

/// The person and the situation, as numbers: the same for every option of a decision.
pub fn context(v: &Vocab, s: &Json) -> Vec<f64> {
    let mut x = Vec::with_capacity(160);
    let want = &s["want"];
    hot(&mut x, &v.about, want["about"].as_str(), 1.0);
    hot(&mut x, &v.from, want["from"].as_str(), 1.0);
    hot(&mut x, &v.whom, want["whom"].as_str(), 1.0);
    hot(&mut x, &v.against, want["against"].as_str(), 1.0);
    hot_fixed(&mut x, &KINDS, want["last_way"].as_str());
    let seeks: Vec<&str> = want["seeks"].as_array().into_iter().flatten().filter_map(|x| x.as_str()).collect();
    for k in SEEKS {
        x.push(if seeks.contains(&k) { 1.0 } else { 0.0 });
    }
    x.push(bps(&want["weight"]));
    x.push(log1p(num(&want["days"])));
    x.push(num(&want["tried"]).min(20.0));
    x.push(bps(&want["grown"]));
    x.push(has(&want["household"]));
    // The matter, where the want has one.
    let m = &s["matter"];
    x.push(has(m));
    hot(&mut x, &v.matter, m["matter"].as_str(), 1.0);
    hot(&mut x, &v.answer, m["answer"].as_str(), 1.0);
    x.push(log1p(num(&m["days"])));
    x.push(num(&m["venues"]).min(10.0));
    x.push(has(&m["asked_days"]));
    x.push(log1p(num(&m["asked_days"])));
    x.push(has(&m["told"]));
    // Means and home, against what a month's essentials cost (so no place's currency is read).
    let ess = num(&s["means"]["essentials"]).max(1.0);
    let income = num(&s["means"]["income"]);
    x.push(log1p(income / ess));
    x.push(log1p(num(&s["means"]["savings"]) / ess));
    x.push(has(&s["home"]));
    x.push(has(&s["home"]["owned"]));
    x.push((num(&s["home"]["rent"]) / income.max(ess)).min(3.0));
    x.push(log1p(num(&s["home"]["rent"]) / ess));
    // The record.
    let r = &s["record"];
    x.push(if r.as_object().is_some_and(|o| !o.is_empty()) { 1.0 } else { 0.0 });
    let (mean, sd) = (num(&s["outlook"]["agency"]["mean_bps"]), num(&s["outlook"]["agency"]["sd_bps"]).max(1.0));
    x.push(bps(&r["agency"]["now"]));
    x.push(bps(&r["agency"]["own"]));
    x.push(if r["agency"]["now"].is_null() { 0.0 } else { (num(&r["agency"]["now"]) - mean) / sd });
    x.push(bps(&r["attached"]["place"]["bps"]) - bps(&s["outlook"]["place_bps"]));
    x.push(bps(&r["attached"]["place"]["bps"]));
    x.push(bps(&r["attached"]["trade"]["bps"]));
    x.push(bps(&r["attached"]["group"]["bps"]));
    for k in TEMPERAMENT {
        x.push(bps(&r["temperament"][k]));
    }
    for k in VALUES {
        x.push(bps(&r["values"][k]));
    }
    for k in NEEDS {
        x.push(bps(&r["needs"][k]));
    }
    let c = &r["circumstances"];
    x.push(num(&c["housed"]));
    x.push(num(&c["household"]).min(10.0));
    x.push(num(&c["retired"]));
    x.push(num(&c["working"]));
    x.push(bps(&r["trust"]["people"]));
    // Trust in each kind of body known, as a mean (a kind not held: 0, beside a count).
    let at = x.len();
    let n = v.trust_kind.len() + 1;
    x.resize(at + 2 * n, 0.0);
    let mut count = vec![0.0; n];
    for t in r["trust"]["in"].as_array().into_iter().flatten() {
        let i = v.trust_kind.binary_search_by(|w| w.as_str().cmp(t["kind"].as_str().unwrap_or(""))).unwrap_or(v.trust_kind.len());
        x[at + i] += bps(&t["bps"]);
        count[i] += 1.0;
    }
    for i in 0..n {
        if count[i] > 0.0 {
            x[at + i] /= count[i];
        }
        x[at + n + i] = count[i].min(5.0);
    }
    // Views: of the town, and the harshest and the mean of the rest (whom they are of is an id: not read).
    let views: Vec<&Json> = r["views"].as_array().into_iter().flatten().collect();
    let town = views.iter().find(|w| w["of"].as_str() == Some("city"));
    x.push(town.map_or(0.0, |w| bps(&w["private"])));
    x.push(town.map_or(0.0, |w| bps(&w["expressed"])));
    let rest: Vec<f64> = views.iter().filter(|w| w["of"].as_str() != Some("city")).map(|w| bps(&w["private"])).collect();
    x.push(rest.iter().cloned().fold(0.0, f64::min));
    x.push(if rest.is_empty() { 0.0 } else { rest.iter().sum::<f64>() / rest.len() as f64 });
    x.push((rest.len() as f64).min(10.0));
    // Memory, by what it is of (counts), defining and recent.
    for part in ["defining", "recent"] {
        let at = x.len();
        hot(&mut x, &v.memory, None, 0.0);
        for m in r["memory"][part].as_array().into_iter().flatten() {
            let i = v.memory.binary_search_by(|w| w.as_str().cmp(m["what"].as_str().unwrap_or(""))).unwrap_or(v.memory.len());
            x[at + i] += 1.0;
        }
    }
    x.push((r["ties"]["close"].as_array().map_or(0, |a| a.len()) as f64).min(15.0));
    x.push((r["ties"]["resented"].as_array().map_or(0, |a| a.len()) as f64).min(15.0));
    x.push((r["wants"].as_array().map_or(0, |a| a.len()) as f64).min(6.0));
    let beliefs: Vec<f64> = r["beliefs"].as_array().into_iter().flatten().map(|b| bps(&b["bps"])).collect();
    x.push((beliefs.len() as f64).min(5.0));
    x.push(beliefs.iter().cloned().fold(0.0, f64::max));
    x
}

/// One option's own row: its kind, and the openings of that kind the person found (how many, who offers them as the
/// person knows them by role, the trust and fear the person holds, what they bring and cost), and what the person has
/// learned of going that way.
pub fn option(v: &Vocab, s: &Json, key: &str, learned: Option<i64>) -> Vec<f64> {
    let mut x = Vec::with_capacity(48);
    hot_fixed(&mut x, &KINDS, Some(key));
    let ess = num(&s["means"]["essentials"]).max(1.0);
    let found: Vec<&Json> = s["openings"].as_array().into_iter().flatten().filter(|o| o["kind"].as_str() == Some(key)).collect();
    x.push((found.len() as f64).min(10.0));
    let max = |f: &dyn Fn(&Json) -> f64| found.iter().map(|o| f(o)).fold(0.0, f64::max);
    x.push(max(&|o| num(&o["others"]).min(5.0)));
    x.push(max(&|o| has(&o["trust"])));
    x.push(max(&|o| bps(&o["trust"]["bps"])));
    x.push(max(&|o| bps(&o["trust"]["bps"]) - bps(&o["trust"]["town_bps"])));
    x.push(max(&|o| bps(&o["fear"])));
    x.push(max(&|o| bps(&o["belief"])));
    x.push(max(&|o| log1p(num(&o["cost"]) / ess)));
    x.push(max(&|o| has(&o["bears"])));
    x.push(max(&|o| has(&o["undoes"])));
    for k in SEEKS {
        x.push(max(&|o| if o["brings"].as_array().into_iter().flatten().any(|b| b.as_str() == Some(k)) { 1.0 } else { 0.0 }));
    }
    let at = x.len();
    hot(&mut x, &v.role, None, 0.0);
    for o in &found {
        if let Some(r) = o["by"].as_str() {
            let i = v.role.binary_search_by(|w| w.as_str().cmp(r)).unwrap_or(v.role.len());
            x[at + i] = 1.0;
        }
    }
    x.push(if learned.is_some() { 1.0 } else { 0.0 });
    x.push(learned.unwrap_or(0) as f64 / 10_000.0);
    x
}

/// The whole input of one option: the context, then the option's row.
pub fn features(v: &Vocab, s: &Json, key: &str, learned: Option<i64>) -> Vec<f64> {
    let mut x = context(v, s);
    x.extend(option(v, s, key, learned));
    x
}

/// One layer: `out` rows of `inp` weights, row-major, and `out` biases, in 1/65,536ths.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layer {
    pub inp: usize,
    pub out: usize,
    pub w: Vec<i32>,
    pub b: Vec<i32>,
}

/// The model as its file holds it.
#[derive(Debug, Clone, PartialEq)]
pub struct CitizenModel {
    pub vocab: Vocab,
    /// Standardisation of each input: (x - mean) / scale, both in 1/65,536ths (scale at least 1).
    pub mean: Vec<i64>,
    pub scale: Vec<i64>,
    pub layers: Vec<Layer>,
    /// The file's SHA-256 (set by whoever read the file), as the world config names it.
    pub sha256: String,
    /// How far its odds replace the code mind's, in basis points of log-odds (the dial's `share_bps`; 10,000: its own).
    pub share_bps: i64,
}

fn ints<T: TryFrom<i64>>(v: &Json, what: &str) -> Result<Vec<T>, String> {
    v.as_array()
        .ok_or_else(|| format!("citizen model: {what} is not a list"))?
        .iter()
        .map(|x| x.as_i64().and_then(|i| T::try_from(i).ok()).ok_or_else(|| format!("citizen model: {what}: not a whole number in range")))
        .collect()
}

impl CitizenModel {
    /// From the file's JSON (`citizen-model/1`).
    pub fn from_json(v: &Json, sha256: &str, share_bps: i64) -> Result<CitizenModel, String> {
        if v["schema"].as_str() != Some(SCHEMA) {
            return Err(format!("citizen model: schema {} (this engine reads {SCHEMA})", v["schema"]));
        }
        if v["head"].as_str() != Some(HEAD) {
            return Err(format!("citizen model: head {} (this engine has {HEAD})", v["head"]));
        }
        let vocab = Vocab::of_json(&v["vocab"])?;
        let mean: Vec<i64> = ints(&v["mean"], "mean")?;
        let scale: Vec<i64> = ints(&v["scale"], "scale")?;
        let width = features(&vocab, &Json::Null, "wait", None).len();
        if mean.len() != width || scale.len() != width || scale.iter().any(|&s| s < 1) {
            return Err(format!("citizen model: {} means and {} scales for {width} inputs", mean.len(), scale.len()));
        }
        let mut layers = vec![];
        let mut inp = width;
        for (i, l) in v["layers"].as_array().ok_or("citizen model: no layers")?.iter().enumerate() {
            let out = l["out"].as_u64().ok_or("citizen model: a layer without out")? as usize;
            let w: Vec<i32> = ints(&l["w"], "w")?;
            let b: Vec<i32> = ints(&l["b"], "b")?;
            if w.len() != inp * out || b.len() != out {
                return Err(format!("citizen model: layer {i} has {} weights and {} biases for {inp} in and {out} out", w.len(), b.len()));
            }
            layers.push(Layer { inp, out, w, b });
            inp = out;
        }
        if inp != 1 {
            return Err("citizen model: the last layer must give one score".into());
        }
        if !(0..=10_000).contains(&share_bps) {
            return Err(format!("citizen model: share_bps {share_bps} is not 0..10000"));
        }
        Ok(CitizenModel { vocab, mean, scale, layers, sha256: sha256.to_string(), share_bps })
    }

    pub fn to_json(&self, trained: Json) -> Json {
        serde_json::json!({
            "schema": SCHEMA,
            "head": HEAD,
            "vocab": self.vocab.to_json(),
            "mean": self.mean,
            "scale": self.scale,
            "layers": self.layers.iter().map(|l| serde_json::json!({ "out": l.out, "w": l.w, "b": l.b })).collect::<Vec<_>>(),
            "trained": trained,
        })
    }

    /// How many weights it has.
    pub fn size(&self) -> usize {
        self.layers.iter().map(|l| l.w.len() + l.b.len()).sum()
    }

    /// The standardised input.
    pub fn standard(&self, x: &[f64]) -> Vec<f64> {
        x.iter().zip(&self.mean).zip(&self.scale).map(|((x, m), s)| (x - *m as f64 / ONE) / (*s as f64 / ONE)).collect()
    }

    /// One option's score (a log-odds), from its raw input.
    pub fn score(&self, x: &[f64]) -> f64 {
        let mut h = self.standard(x);
        let last = self.layers.len() - 1;
        for (li, l) in self.layers.iter().enumerate() {
            let mut y = vec![0.0; l.out];
            for (o, y) in y.iter_mut().enumerate() {
                let row = &l.w[o * l.inp..(o + 1) * l.inp];
                let mut acc = l.b[o] as f64 / ONE;
                for (w, x) in row.iter().zip(&h) {
                    acc += (*w as f64 / ONE) * x;
                }
                *y = if li < last { acc.max(0.0) } else { acc };
            }
            h = y;
        }
        h[0]
    }

    /// Each option's score, in the order given: `options` are the decision's keys with what the person has learned of
    /// each (where known).
    pub fn scores(&self, s: &Json, options: &[(String, Option<i64>)]) -> Vec<f64> {
        let ctx = context(&self.vocab, s);
        options
            .iter()
            .map(|(k, learned)| {
                let mut x = ctx.clone();
                x.extend(option(&self.vocab, s, k, *learned));
                self.score(&x)
            })
            .collect()
    }
}

/// Integer weights (millionths) to draw on, from the code mind's own exponents (`code`: lam * (score - max), as
/// `Attractions::choose` makes them, so the largest is 0) and the model's scores, the model's taking `share_bps` of
/// the way in log-odds. At 0 they are the code mind's weights to the bit.
pub fn blend(code: &[f64], model: &[f64], share_bps: i64) -> Vec<i64> {
    let s = share_bps as f64 / 10_000.0;
    let mmax = model.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let f: Vec<f64> = code.iter().zip(model).map(|(c, m)| c + s * ((m - mmax) - c)).collect();
    let fmax = f.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    f.iter().map(|x| math::round(math::exp(x - fmax) * 1_000_000.0)).collect()
}

/// Weights as parts per million of their total (the code mind's rounding, plan.rs).
pub fn ppm(weights: &[i64]) -> Vec<i64> {
    let total: i64 = weights.iter().sum::<i64>().max(1);
    weights.iter().map(|w| math::round((*w as f64 * 1_000_000.0) / total as f64)).collect()
}

/// Softmax of scores as probabilities (the trainer's and the evaluator's view of the same odds).
pub fn softmax(scores: &[f64]) -> Vec<f64> {
    let max = scores.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let e: Vec<f64> = scores.iter().map(|s| math::exp(s - max)).collect();
    let t: f64 = e.iter().sum();
    e.iter().map(|x| x / t).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tiny() -> CitizenModel {
        let vocab = Vocab { about: vec!["shelter".into()], role: vec!["landlord".into()], ..Default::default() };
        let width = features(&vocab, &Json::Null, "wait", None).len();
        let mut w1 = vec![0i32; width * 2];
        for (i, w) in w1.iter_mut().enumerate() {
            *w = ((i * 7919) % 2000) as i32 - 1000;
        }
        CitizenModel {
            vocab,
            mean: vec![0; width],
            scale: vec![65_536; width],
            layers: vec![Layer { inp: width, out: 2, w: w1, b: vec![100, -100] }, Layer { inp: 2, out: 1, w: vec![65_536, -32_768], b: vec![0] }],
            sha256: String::new(),
            share_bps: 10_000,
        }
    }

    fn situation() -> Json {
        json!({ "v": 1, "want": { "about": "shelter", "from": "need", "weight": 5000, "days": 3, "tried": 1, "grown": 0, "seeks": ["occupancy"] },
            "means": { "income": 100_000, "savings": 500_000, "essentials": 50_000 },
            "openings": [{ "kind": "offer:lease", "brings": ["occupancy"], "others": 2, "adj": 999 }, { "kind": "ask", "by": "landlord", "brings": [], "others": 0, "adj": -5, "trust": { "bps": 4000, "town_bps": 5000 } }],
            "record": { "agency": { "now": 6000, "own": 5000 }, "values": { "security": 7000 } },
            "outlook": { "agency": { "mean_bps": 5000, "sd_bps": 2000 } },
            "code": { "odds": [{ "key": "wait", "ppm": 1 }] } })
    }

    #[test]
    fn the_odds_are_the_same_in_any_order_of_the_options() {
        let m = tiny();
        let s = situation();
        let a: Vec<(String, Option<i64>)> = vec![("ask".into(), None), ("offer:lease".into(), Some(300)), ("wait".into(), None)];
        let mut b = a.clone();
        b.reverse();
        let (sa, mut sb) = (m.scores(&s, &a), m.scores(&s, &b));
        sb.reverse();
        assert_eq!(sa, sb);
        let code = [0.0, -1.0, -2.0];
        let mut code_b = code;
        code_b.reverse();
        let mut wb = blend(&code_b, &m.scores(&s, &b), 5_000);
        wb.reverse();
        assert_eq!(blend(&code, &sa, 5_000), wb);
    }

    #[test]
    fn the_code_minds_scoring_is_never_read() {
        let m = tiny();
        let mut s = situation();
        let opts: Vec<(String, Option<i64>)> = vec![("ask".into(), None), ("offer:lease".into(), None), ("wait".into(), None)];
        let before = m.scores(&s, &opts);
        s["openings"][0]["adj"] = json!(-123_456);
        s["code"] = json!({ "odds": [{ "key": "ask", "ppm": 1_000_000 }] });
        assert_eq!(m.scores(&s, &opts), before);
    }

    #[test]
    fn at_share_zero_the_weights_are_the_code_minds_to_the_bit() {
        // As Attractions::choose makes them: exp(lam * (s - max)) in millionths.
        let lam = 1.7 * (1.0 - 4_321.0 / 20_000.0);
        let scores = [0.1234, -0.5, 0.33];
        let max = scores.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let x: Vec<f64> = scores.iter().map(|s| lam * (s - max)).collect();
        let code: Vec<i64> = x.iter().map(|x| math::round(math::exp(*x) * 1_000_000.0)).collect();
        assert_eq!(blend(&x, &[5.0, -3.0, 0.0], 0), code);
        assert_ne!(blend(&x, &[5.0, -3.0, 0.0], 10_000), code);
    }

    #[test]
    fn a_file_reads_back_to_the_same_model() {
        let m = tiny();
        let j = m.to_json(json!({}));
        let back = CitizenModel::from_json(&j, "", 10_000).unwrap();
        assert_eq!(back, m);
        let mut bad = j.clone();
        bad["layers"][0]["b"] = json!([1]);
        assert!(CitizenModel::from_json(&bad, "", 10_000).is_err());
    }
}
