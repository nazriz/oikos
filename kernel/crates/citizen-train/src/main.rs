//! Trains and evaluates the citizen model (docs/citizen-data.md, "The citizen model"; docs/design/citizen-model.md).
//!
//!   oikos-citizen-train train --data FILE --out DIR [--seeds 1,2,3,4,5] [--hidden 64,64] [--epochs 60] [--lr 0.001]
//!                             [--batch 32] [--patience 6] [--min-count 20] [--limit-train N]
//!   oikos-citizen-train eval --data FILE --model FILE [--out FILE]
//!
//! The data is one want decision a line (`scripts/citizen-model.ts` writes it from captured runs): its split, the
//! situation the mind recorded (less the code mind's own odds), each option's key with what the person had learned of
//! it, and the code mind's odds in parts per million: the targets. A network of the shape `mind/model.rs` serves is
//! fitted to them by soft-target cross-entropy and Adam, one seed at a time, on one thread, in a fixed order, with
//! `mind::math`'s `exp` and `ln`: the same data and seed give the same weights, bit for bit, on any machine. The weights
//! are kept as whole numbers in 1/65,536ths, and every measure is taken on that rounded model through the actors
//! crate's own forward pass, so what is reported is what a run computes.
//!
//! The measures are the design's gate (11e and citizen-model section 6), as far as the code mind's own recorded odds
//! allow (docs/citizen-data.md says which are not yet taken). Nothing here is read by a run.

use oikos_actors::mind::math;
use oikos_actors::mind::model::{self, CitizenModel, Layer, Vocab, ONE};
use serde_json::{json, Value as Json};
use std::collections::BTreeMap;
use std::io::BufRead;

// ------------------------------------------------------------------ data

struct Example {
    split: String,
    run: String,
    s: Json,
    o: Vec<(String, Option<i64>)>,
    /// The code mind's odds (sums to 1).
    y: Vec<f64>,
}

fn read_data(path: &str) -> Vec<Example> {
    let f = std::fs::File::open(path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let mut out = vec![];
    for line in std::io::BufReader::new(f).lines() {
        let line = line.unwrap();
        if line.is_empty() {
            continue;
        }
        let v: Json = serde_json::from_str(&line).unwrap();
        let o: Vec<(String, Option<i64>)> = v["o"].as_array().unwrap().iter().map(|x| (x[0].as_str().unwrap().to_string(), x[1].as_i64())).collect();
        let ppm: Vec<f64> = v["y"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect();
        let t: f64 = ppm.iter().sum();
        if o.len() != ppm.len() || t <= 0.0 {
            continue;
        }
        out.push(Example { split: v["split"].as_str().unwrap().to_string(), run: v["run"].as_str().unwrap_or("").to_string(), s: v["s"].clone(), o, y: ppm.iter().map(|x| x / t).collect() });
    }
    out
}

// ------------------------------------------------------------------ a deterministic stream (training only)

struct Split64(u64);
impl Split64 {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

// ------------------------------------------------------------------ the network, in floats while training

#[derive(Clone)]
struct Net {
    /// (inputs, outputs, weights row-major, biases)
    layers: Vec<(usize, usize, Vec<f64>, Vec<f64>)>,
}

impl Net {
    fn new(sizes: &[usize], rng: &mut Split64) -> Net {
        let layers = sizes
            .windows(2)
            .map(|w| {
                let (i, o) = (w[0], w[1]);
                let a = math::sqrt(6.0 / (i + o) as f64);
                (i, o, (0..i * o).map(|_| (rng.unit() * 2.0 - 1.0) * a).collect(), vec![0.0; o])
            })
            .collect();
        Net { layers }
    }
    /// Activations of every layer (the input first), the last a single score.
    fn forward(&self, x: &[f64]) -> Vec<Vec<f64>> {
        let mut acts = vec![x.to_vec()];
        let last = self.layers.len() - 1;
        for (li, (inp, out, w, b)) in self.layers.iter().enumerate() {
            let h = acts.last().unwrap();
            let mut y = vec![0.0; *out];
            for o in 0..*out {
                let row = &w[o * inp..(o + 1) * inp];
                let mut acc = b[o];
                for (wi, xi) in row.iter().zip(h) {
                    acc += wi * xi;
                }
                y[o] = if li < last { acc.max(0.0) } else { acc };
            }
            acts.push(y);
        }
        acts
    }
    /// Adds d(score)/d(params) * g into `grad`.
    fn backward(&self, acts: &[Vec<f64>], g: f64, grad: &mut Net) {
        let mut d = vec![g];
        for li in (0..self.layers.len()).rev() {
            let (inp, out, w, _) = &self.layers[li];
            let h = &acts[li];
            let (_, _, gw, gb) = &mut grad.layers[li];
            let mut dh = vec![0.0; *inp];
            for o in 0..*out {
                let dz = d[o];
                if dz == 0.0 {
                    continue;
                }
                gb[o] += dz;
                let row = &w[o * inp..(o + 1) * inp];
                let grow = &mut gw[o * inp..(o + 1) * inp];
                for i in 0..*inp {
                    grow[i] += dz * h[i];
                    dh[i] += dz * row[i];
                }
            }
            if li > 0 {
                // Through the ReLU of the layer below.
                for i in 0..*inp {
                    if h[i] <= 0.0 {
                        dh[i] = 0.0;
                    }
                }
            }
            d = dh;
        }
    }
    fn zero(&self) -> Net {
        Net { layers: self.layers.iter().map(|(i, o, w, b)| (*i, *o, vec![0.0; w.len()], vec![0.0; b.len()])).collect() }
    }
    fn params_mut(&mut self) -> impl Iterator<Item = &mut f64> {
        self.layers.iter_mut().flat_map(|(_, _, w, b)| w.iter_mut().chain(b.iter_mut()))
    }
    fn params(&self) -> impl Iterator<Item = &f64> {
        self.layers.iter().flat_map(|(_, _, w, b)| w.iter().chain(b.iter()))
    }
}

fn q16(x: f64) -> i64 {
    math::round(x * ONE)
}

fn rounded(net: &Net, vocab: &Vocab, mean: &[i64], scale: &[i64]) -> CitizenModel {
    CitizenModel {
        vocab: vocab.clone(),
        mean: mean.to_vec(),
        scale: scale.to_vec(),
        layers: net
            .layers
            .iter()
            .map(|(i, o, w, b)| Layer { inp: *i, out: *o, w: w.iter().map(|x| q16(*x).clamp(i32::MIN as i64, i32::MAX as i64) as i32).collect(), b: b.iter().map(|x| q16(*x).clamp(i32::MIN as i64, i32::MAX as i64) as i32).collect() })
            .collect(),
        sha256: String::new(),
        share_bps: 10_000,
    }
}

// ------------------------------------------------------------------ training

struct Rows {
    /// Per example: each option's standardised input.
    x: Vec<Vec<Vec<f64>>>,
}

fn standardise(raw: &[Vec<Vec<f64>>], mean: &[i64], scale: &[i64]) -> Rows {
    Rows { x: raw.iter().map(|ex| ex.iter().map(|x| x.iter().zip(mean).zip(scale).map(|((x, m), s)| (x - *m as f64 / ONE) / (*s as f64 / ONE)).collect()).collect()).collect() }
}

fn raw_rows(vocab: &Vocab, data: &[&Example]) -> Vec<Vec<Vec<f64>>> {
    data.iter().map(|e| e.o.iter().map(|(k, l)| model::features(vocab, &e.s, k, *l)).collect()).collect()
}

/// Mean soft cross-entropy (nats) of a float net on rows.
fn loss_of(net: &Net, rows: &Rows, data: &[&Example]) -> f64 {
    let mut total = 0.0;
    for (ex, e) in rows.x.iter().zip(data) {
        let s: Vec<f64> = ex.iter().map(|x| net.forward(x).last().unwrap()[0]).collect();
        let q = model::softmax(&s);
        total -= e.y.iter().zip(&q).map(|(y, q)| if *y > 0.0 { y * math::ln(q.max(1e-300)) } else { 0.0 }).sum::<f64>();
    }
    total / data.len().max(1) as f64
}

struct Config {
    hidden: Vec<usize>,
    epochs: usize,
    lr: f64,
    batch: usize,
    patience: usize,
    weight_decay: f64,
}

/// One training: returns the net at its best validation loss, and the curve.
fn train(seed: u64, c: &Config, width: usize, train: &Rows, tdata: &[&Example], valid: &Rows, vdata: &[&Example]) -> (Net, Vec<(f64, f64)>) {
    let mut rng = Split64(seed.wrapping_mul(0x2545_F491_4F6C_DD1D) ^ 0x6F69_6B6F_7321);
    let mut sizes = vec![width];
    sizes.extend(&c.hidden);
    sizes.push(1);
    let mut net = Net::new(&sizes, &mut rng);
    let n_params = net.params().count();
    let (mut m1, mut m2) = (vec![0.0; n_params], vec![0.0; n_params]);
    let (b1, b2, eps) = (0.9f64, 0.999f64, 1e-8);
    // (b1^t and b2^t kept as running products: IEEE multiplication, the same bits anywhere.)
    let (mut b1t, mut b2t) = (1.0f64, 1.0f64);
    let mut order: Vec<usize> = (0..train.x.len()).collect();
    let (mut best, mut best_loss, mut since) = (net.clone(), f64::INFINITY, 0usize);
    let mut curve = vec![];
    for _epoch in 0..c.epochs {
        for i in (1..order.len()).rev() {
            let j = rng.below(i + 1);
            order.swap(i, j);
        }
        for chunk in order.chunks(c.batch) {
            let mut grad = net.zero();
            for &ix in chunk {
                let ex = &train.x[ix];
                let acts: Vec<Vec<Vec<f64>>> = ex.iter().map(|x| net.forward(x)).collect();
                let s: Vec<f64> = acts.iter().map(|a| a.last().unwrap()[0]).collect();
                let q = model::softmax(&s);
                for (k, a) in acts.iter().enumerate() {
                    let g = (q[k] - tdata[ix].y[k]) / chunk.len() as f64;
                    if g != 0.0 {
                        net.backward(a, g, &mut grad);
                    }
                }
            }
            b1t *= b1;
            b2t *= b2;
            let (c1, c2) = (1.0 - b1t, 1.0 - b2t);
            for (((p, g), m), v) in net.params_mut().zip(grad.params()).zip(m1.iter_mut()).zip(m2.iter_mut()) {
                let g = g + c.weight_decay * *p;
                *m = b1 * *m + (1.0 - b1) * g;
                *v = b2 * *v + (1.0 - b2) * g * g;
                *p -= c.lr * (*m / c1) / (math::sqrt(*v / c2) + eps);
            }
        }
        let (tl, vl) = (loss_of(&net, train, tdata), loss_of(&net, valid, vdata));
        curve.push((tl, vl));
        if vl < best_loss - 1e-6 {
            best_loss = vl;
            best = net.clone();
            since = 0;
        } else {
            since += 1;
            if since >= c.patience {
                break;
            }
        }
    }
    (best, curve)
}

// ------------------------------------------------------------------ measures

fn tv(p: &[f64], q: &[f64]) -> f64 {
    50.0 * p.iter().zip(q).map(|(a, b)| (a - b).abs()).sum::<f64>()
}
fn median(mut v: Vec<f64>) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}
fn quantile(mut v: Vec<f64>, q: f64) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[((v.len() - 1) as f64 * q).round() as usize]
}
fn r2(x: f64) -> Json {
    if x.is_finite() {
        json!((x * 100.0).round() / 100.0)
    } else {
        Json::Null
    }
}
fn r4(x: f64) -> Json {
    if x.is_finite() {
        json!((x * 10_000.0).round() / 10_000.0)
    } else {
        Json::Null
    }
}

fn odds(m: &CitizenModel, s: &Json, o: &[(String, Option<i64>)]) -> Vec<f64> {
    model::softmax(&m.scores(s, o))
}
fn share_of(o: &[(String, Option<i64>)], p: &[f64], key: &str) -> f64 {
    o.iter().zip(p).filter(|((k, _), _)| k == key).map(|(_, x)| x).sum()
}

/// A one-thing edit: of the decisions it applies to, how many moved the named option's odds (or acting at all) the
/// way the code mind's own sway goes, and by how much on average.
fn edit(m: &CitizenModel, data: &[&Example], applies: &dyn Fn(&Example) -> bool, low: &dyn Fn(&mut Json), high: &dyn Fn(&mut Json), read: &dyn Fn(&[(String, Option<i64>)], &[f64]) -> f64, up: bool) -> Json {
    let (mut n, mut right, mut moved) = (0usize, 0usize, 0.0);
    for e in data.iter().filter(|e| applies(e)) {
        let (mut a, mut b) = (e.s.clone(), e.s.clone());
        low(&mut a);
        high(&mut b);
        let d = 100.0 * (read(&e.o, &odds(m, &b, &e.o)) - read(&e.o, &odds(m, &a, &e.o)));
        n += 1;
        moved += d;
        if (up && d > 0.0) || (!up && d < 0.0) {
            right += 1;
        }
    }
    json!({ "n": n, "right_way": right, "share": r4(right as f64 / n.max(1) as f64), "mean_points": r2(moved / n.max(1) as f64), "passes": n > 0 && right * 20 >= n * 19 })
}

fn kinds_key(e: &Example) -> String {
    let mut k: Vec<&str> = e.o.iter().map(|(k, _)| k.as_str()).collect();
    k.sort();
    format!("{}|{}", e.s["want"]["about"].as_str().unwrap_or(""), k.join(","))
}

/// Every measure on one split, for a rounded model.
fn measure(m: &CitizenModel, data: &[&Example], seed: u64) -> Json {
    let n = data.len();
    if n == 0 {
        return json!({ "n": 0 });
    }
    let p: Vec<Vec<f64>> = data.iter().map(|e| odds(m, &e.s, &e.o)).collect();
    // Fit.
    let (mut ce, mut ent, mut ce_uniform, mut agree, mut tvs) = (0.0, 0.0, 0.0, 0usize, vec![]);
    for (e, q) in data.iter().zip(&p) {
        for (y, q) in e.y.iter().zip(q) {
            if *y > 0.0 {
                ce -= y * math::ln(q.max(1e-300));
                ent -= y * math::ln(*y);
            }
        }
        ce_uniform += math::ln(e.o.len() as f64);
        let am = |v: &[f64]| v.iter().enumerate().fold((0, f64::NEG_INFINITY), |b, (i, x)| if *x > b.1 { (i, *x) } else { b }).0;
        if am(&e.y) == am(q) {
            agree += 1;
        }
        tvs.push(tv(&e.y, q));
    }
    let nf = n as f64;
    // Totals: each kind's share of the town's decisions, code mind and model, where it was open.
    let mut totals = BTreeMap::new();
    for k in model::KINDS {
        let (mut c, mut mm, mut open) = (0.0, 0.0, 0usize);
        for (e, q) in data.iter().zip(&p) {
            if e.o.iter().any(|(x, _)| x == k) {
                open += 1;
            }
            c += share_of(&e.o, &e.y, k);
            mm += share_of(&e.o, q, k);
        }
        if open > 0 {
            totals.insert(k.to_string(), json!({ "open_in": open, "code": r2(100.0 * c / nf), "model": r2(100.0 * mm / nf), "points": r2(100.0 * (mm - c) / nf) }));
        }
    }
    let acting_code = 100.0 - 100.0 * data.iter().map(|e| share_of(&e.o, &e.y, "wait")).sum::<f64>() / nf;
    let acting_model = 100.0 - 100.0 * data.iter().zip(&p).map(|(e, q)| share_of(&e.o, q, "wait")).sum::<f64>() / nf;
    // Telling people apart. (a) Scrambled records: the same situation with another person's record. (b) Spread: two
    // people in the same kind of situation (the same want and options), the code mind's odds against the model's.
    let mut rng = Split64(seed ^ 0x5C4A_3B1E);
    let with_record: Vec<usize> = (0..n).filter(|&i| data[i].s["record"].as_object().is_some_and(|o| !o.is_empty())).collect();
    let mut scrambled = vec![];
    let mut scrambled_rel = vec![];
    for &i in with_record.iter().take(3000) {
        let j = with_record[rng.below(with_record.len())];
        if data[j].s["record"] == data[i].s["record"] {
            continue;
        }
        let mut s = data[i].s.clone();
        s["record"] = data[j].s["record"].clone();
        let d = tv(&p[i], &odds(m, &s, &data[i].o));
        scrambled.push(d);
        scrambled_rel.push(d);
    }
    let mut by_kind: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, e) in data.iter().enumerate() {
        if e.o.len() > 1 {
            by_kind.entry(kinds_key(e)).or_default().push(i);
        }
    }
    let (mut spread_code, mut spread_model) = (vec![], vec![]);
    for ix in by_kind.values().filter(|v| v.len() >= 2) {
        for _ in 0..ix.len().min(200) {
            let (a, b) = (ix[rng.below(ix.len())], ix[rng.below(ix.len())]);
            if a == b {
                continue;
            }
            spread_code.push(tv(&data[a].y, &data[b].y));
            spread_model.push(tv(&p[a], &p[b]));
        }
    }
    let (sc, sm) = (median(spread_code.clone()), median(spread_model.clone()));
    // One-thing edits, each the way the code mind's own sway goes (mind/plan.rs `ways_for`, `pursue`).
    let agency = |lo: bool| {
        move |s: &mut Json| {
            if s["record"]["agency"].is_object() {
                let (mean, sd) = (s["outlook"]["agency"]["mean_bps"].as_i64().unwrap_or(5_000), s["outlook"]["agency"]["sd_bps"].as_i64().unwrap_or(2_000));
                let v = if lo { (mean - sd).max(0) } else { (mean + sd).min(10_000) };
                s["record"]["agency"]["now"] = json!(v);
            }
        }
    };
    let trust_of = |kind: &'static str, v: i64| {
        move |s: &mut Json| {
            for o in s["openings"].as_array_mut().into_iter().flatten() {
                if o["kind"].as_str() == Some(kind) && o["trust"].is_object() {
                    o["trust"]["bps"] = json!(v);
                }
            }
        }
    };
    let has_trusted = |kind: &'static str| move |e: &Example| e.s["openings"].as_array().into_iter().flatten().any(|o| o["kind"].as_str() == Some(kind) && o["trust"].is_object());
    let acting = |o: &[(String, Option<i64>)], p: &[f64]| 1.0 - share_of(o, p, "wait");
    let edits = json!({
        "agency_low_to_high_acting": edit(m, data, &|e| e.o.len() > 1 && e.s["record"]["agency"].is_object(), &agency(true), &agency(false), &acting, true),
        "trust_in_venue_desk": edit(m, data, &has_trusted("desk"), &trust_of("desk", 2_000), &trust_of("desk", 8_000), &|o, p| share_of(o, p, "desk"), true),
        "trust_in_other_side_ask": edit(m, data, &has_trusted("ask"), &trust_of("ask", 2_000), &trust_of("ask", 8_000), &|o, p| share_of(o, p, "ask"), true),
    });
    // Option order: every decision's options reversed give the same weights a run draws on, to the millionth.
    let mut order_max = 0i64;
    for e in data.iter().take(500) {
        let mut o = e.o.clone();
        o.reverse();
        let zero = vec![0.0; o.len()];
        let a = model::blend(&zero, &m.scores(&e.s, &e.o), 10_000);
        let mut b = model::blend(&zero, &m.scores(&e.s, &o), 10_000);
        b.reverse();
        order_max = order_max.max(a.iter().zip(&b).map(|(x, y)| (x - y).abs()).max().unwrap_or(0));
    }
    json!({
        "n": n,
        "runs": data.iter().map(|e| e.run.as_str()).collect::<std::collections::BTreeSet<_>>().len(),
        "fit": {
            "cross_entropy": r4(ce / nf), "targets_entropy": r4(ent / nf), "kl": r4((ce - ent) / nf), "uniform_kl": r4((ce_uniform - ent) / nf),
            "tv_median_points": r2(median(tvs.clone())), "tv_mean_points": r2(tvs.iter().sum::<f64>() / nf), "tv_p90_points": r2(quantile(tvs, 0.9)),
            "likeliest_agrees": r4(agree as f64 / nf),
        },
        "totals": { "acting_at_all": { "code": r2(acting_code), "model": r2(acting_model), "points": r2(acting_model - acting_code), "passes": (acting_model - acting_code).abs() <= 8.0 }, "by_kind": totals },
        "people": {
            "scrambled_record_median_points": r2(median(scrambled)), "scrambled_n": scrambled_rel.len(), "code_mind_scrambled_11g": 26.2,
            "spread_same_kind_code_median": r2(sc), "spread_same_kind_model_median": r2(sm), "spread_kept": r4(sm / sc), "spread_passes": sm >= 0.7 * sc, "pairs": spread_code.len(),
        },
        "edits": edits,
        "order_max_difference_millionths": order_max,
    })
}

/// Microseconds a decision, building the input and scoring every option, on one thread.
fn speed(m: &CitizenModel, data: &[&Example]) -> Json {
    let mut us = vec![];
    let mut options = 0usize;
    let mut sink = 0.0;
    for e in data.iter().take(5000) {
        let t0 = std::time::Instant::now();
        let s = m.scores(&e.s, &e.o);
        us.push(t0.elapsed().as_secs_f64() * 1e6);
        sink += s[0];
        options += e.o.len();
    }
    let n = us.len();
    json!({ "decisions": n, "options_mean": r2(options as f64 / n.max(1) as f64), "us_mean": r2(us.iter().sum::<f64>() / n.max(1) as f64), "us_p50": r2(median(us.clone())), "us_p99": r2(quantile(us, 0.99)), "_": sink.is_finite() })
}

// ------------------------------------------------------------------ commands

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().cloned().unwrap_or_default();
    let data_path = arg(&args, "--data").expect("--data FILE");
    let data = read_data(&data_path);
    let split = |name: &str| -> Vec<&Example> { data.iter().filter(|e| e.split == name).collect() };
    match cmd.as_str() {
        "train" => {
            let out = arg(&args, "--out").expect("--out DIR");
            std::fs::create_dir_all(&out).unwrap();
            let seeds: Vec<u64> = arg(&args, "--seeds").unwrap_or("1,2,3,4,5".into()).split(',').map(|x| x.parse().unwrap()).collect();
            let c = Config {
                hidden: arg(&args, "--hidden").unwrap_or("64,64".into()).split(',').map(|x| x.parse().unwrap()).collect(),
                epochs: arg(&args, "--epochs").map_or(60, |x| x.parse().unwrap()),
                lr: arg(&args, "--lr").map_or(0.001, |x| x.parse().unwrap()),
                batch: arg(&args, "--batch").map_or(32, |x| x.parse().unwrap()),
                patience: arg(&args, "--patience").map_or(6, |x| x.parse().unwrap()),
                weight_decay: arg(&args, "--weight-decay").map_or(1e-5, |x| x.parse().unwrap()),
            };
            let min_count: usize = arg(&args, "--min-count").map_or(20, |x| x.parse().unwrap());
            let mut tdata = split("train");
            if let Some(l) = arg(&args, "--limit-train") {
                // (A learning curve: the first N of the training rows, which are in the data file's fixed order.)
                tdata.truncate(l.parse().unwrap());
            }
            let (vdata, test, pilot) = (split("valid"), split("test"), split("pilot"));
            eprintln!("train {} valid {} test {} pilot {}", tdata.len(), vdata.len(), test.len(), pilot.len());
            let vocab = Vocab::gather(tdata.iter().map(|e| &e.s), min_count);
            let traw = raw_rows(&vocab, &tdata);
            let width = traw[0][0].len();
            // Standardisation from the training rows (every option's row counts once).
            let (mut sum, mut sq, mut cnt) = (vec![0.0; width], vec![0.0; width], 0.0);
            for ex in &traw {
                for x in ex {
                    for i in 0..width {
                        sum[i] += x[i];
                        sq[i] += x[i] * x[i];
                    }
                    cnt += 1.0;
                }
            }
            let mean: Vec<i64> = sum.iter().map(|s| q16(s / cnt)).collect();
            let scale: Vec<i64> = sum.iter().zip(&sq).map(|(s, q)| q16(math::sqrt((q / cnt - (s / cnt) * (s / cnt)).max(0.0)).max(1e-2)).max(1)).collect();
            let train_rows = standardise(&traw, &mean, &scale);
            let valid_rows = standardise(&raw_rows(&vocab, &vdata), &mean, &scale);
            let mut runs = vec![];
            let mut best: Option<(f64, u64, CitizenModel)> = None;
            for &seed in &seeds {
                let (net, curve) = train(seed, &c, width, &train_rows, &tdata, &valid_rows, &vdata);
                let m = rounded(&net, &vocab, &mean, &scale);
                let vm = measure(&m, &vdata, seed);
                let vce = vm["fit"]["cross_entropy"].as_f64().unwrap_or(f64::INFINITY);
                let dir = format!("{out}/seed-{seed}");
                std::fs::create_dir_all(&dir).unwrap();
                let trained = json!({ "seed": seed, "epochs": curve.len(), "hidden": c.hidden, "lr": c.lr, "batch": c.batch, "weight_decay": c.weight_decay, "min_count": min_count, "train_rows": tdata.len(), "data": data_path });
                std::fs::write(format!("{dir}/model.json"), serde_json::to_vec(&m.to_json(trained)).unwrap()).unwrap();
                eprintln!("seed {seed}: {} epochs, valid cross-entropy {vce:.4}", curve.len());
                runs.push(json!({ "seed": seed, "epochs": curve.len(), "curve": curve.iter().map(|(a, b)| json!([r4(*a), r4(*b)])).collect::<Vec<_>>(), "valid": vm, "test": measure(&m, &test, seed), "pilot": measure(&m, &pilot, seed) }));
                if best.as_ref().is_none_or(|b| vce < b.0) {
                    best = Some((vce, seed, m));
                }
            }
            let (_, seed, m) = best.unwrap();
            let bytes = std::fs::read(format!("{out}/seed-{seed}/model.json")).unwrap();
            std::fs::write(format!("{out}/model.json"), &bytes).unwrap();
            // The noise between trainings: each measure's spread over the seeds.
            let spread = |path: &[&str]| -> Json {
                let v: Vec<f64> = runs.iter().filter_map(|r| path.iter().fold(Some(r), |x, k| x.and_then(|x| x.get(*k))).and_then(|x| x.as_f64())).collect();
                let (lo, hi) = (v.iter().cloned().fold(f64::INFINITY, f64::min), v.iter().cloned().fold(f64::NEG_INFINITY, f64::max));
                json!({ "min": r4(lo), "max": r4(hi) })
            };
            let report = json!({
                "schema": "citizen-model-report/1",
                "data": data_path,
                "rows": { "train": tdata.len(), "valid": vdata.len(), "test": test.len(), "pilot": pilot.len() },
                "inputs": width,
                "weights": m.size(),
                "chosen_seed": seed,
                "noise": {
                    "test_kl": spread(&["test", "fit", "kl"]),
                    "test_tv_median_points": spread(&["test", "fit", "tv_median_points"]),
                    "test_acting_points": spread(&["test", "totals", "acting_at_all", "points"]),
                    "test_spread_kept": spread(&["test", "people", "spread_kept"]),
                },
                "speed": speed(&m, &test),
                "seeds": runs,
            });
            std::fs::write(format!("{out}/report.json"), serde_json::to_vec_pretty(&report).unwrap()).unwrap();
            println!("{}", serde_json::to_string(&json!({ "model": format!("{out}/model.json"), "chosen_seed": seed })).unwrap());
        }
        "eval" => {
            let path = arg(&args, "--model").expect("--model FILE");
            let bytes = std::fs::read(&path).unwrap();
            let v: Json = serde_json::from_slice(&bytes).unwrap();
            let m = CitizenModel::from_json(&v, "", 10_000).unwrap();
            let mut out = serde_json::Map::new();
            for name in ["valid", "test", "pilot", "train"] {
                out.insert(name.into(), measure(&m, &split(name), 1));
            }
            out.insert("speed".into(), speed(&m, &split("test")));
            let text = serde_json::to_string_pretty(&Json::Object(out)).unwrap();
            match arg(&args, "--out") {
                Some(f) => std::fs::write(f, text).unwrap(),
                None => println!("{text}"),
            }
        }
        _ => panic!("usage: oikos-citizen-train train|eval --data FILE ..."),
    }
}
