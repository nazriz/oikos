//! The overlays' values, as the Three.js client computes them (renderer/src/client/main.ts `applyOverlay`), so the
//! two explorers show the same thing: each a named raw quantity with its definition on the legend, never a score.
//! - *who decided*: per building, the consequential changes reaching the people who live there in the last 30 days,
//!   by the class of who decided (the `pulses` track);
//! - *hardship*: sense of agency from people's own records (the `agency` track), or money held as a rank (`money`).
//!
//! Pure: no Bevy.

use crate::data::{Pulse, DAY};

/// Colours of the classes (renderer/src/client/api.ts `CLASS_COLOR`), sRGB, in CLASSES order.
pub const CLASS_COLOR: [[u8; 3]; 5] = [[0x8c, 0x9b, 0xb0], [0xf2, 0xc1, 0x4e], [0x3f, 0xd0, 0xc9], [0xff, 0x4f, 0xa0], [0x6f, 0x7a, 0x8c]];
pub const HARD_COLOR: [u8; 3] = [0xff, 0x5a, 0x4f];
pub const SEAT_COLORS: [[u8; 3]; 6] =
    [[0xff, 0x4f, 0xa0], [0xb4, 0x8c, 0xff], [0xff, 0xad, 0x4a], [0x4c, 0xc3, 0xff], [0xa6, 0xf0, 0x4e], [0xff, 0x7b, 0x6b]];
pub const BASE: [u8; 3] = [0x66, 0x6e, 0x80];
pub const NO_DATA: [u8; 3] = [0x5b, 0x64, 0x75];
/// People's colours by where they are: at home, at work, elsewhere.
pub const KIND_COLOR: [[u8; 3]; 3] = [[0xff, 0xd2, 0x7a], [0x7f, 0xd3, 0xff], [0xd2, 0xa8, 0xff]];

pub fn lin(c: [u8; 3]) -> [f32; 3] {
    let f = |v: u8| {
        let s = v as f32 / 255.0;
        if s <= 0.04045 {
            s / 12.92
        } else {
            ((s + 0.055) / 1.055).powf(2.4)
        }
    };
    [f(c[0]), f(c[1]), f(c[2])]
}
pub fn lerp3(a: [f32; 3], b: [f32; 3], k: f32) -> [f32; 3] {
    [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

/// Counts of consequential changes by day, building and class.
pub struct Decided {
    pub days: usize,
    pub structs: usize,
    counts: Vec<u16>,
}

impl Decided {
    pub fn new(pulses: &[Pulse], days: i64, structs: usize) -> Decided {
        let days = days.max(0) as usize + 1;
        let mut counts = vec![0u16; days * structs * 5];
        for p in pulses {
            if p.st < 0 || p.st as usize >= structs {
                continue;
            }
            let d = (p.t.div_euclid(DAY)).clamp(0, days as i64 - 1) as usize;
            let at = (d * structs + p.st as usize) * 5 + p.cls as usize;
            counts[at] = counts[at].saturating_add(1);
        }
        Decided { days, structs, counts }
    }

    /// Per building, the last 30 days' counts by class, to day `d`.
    pub fn window(&self, d: i64) -> Vec<[u32; 5]> {
        let d = d.clamp(0, self.days as i64 - 1) as usize;
        let mut sum = vec![[0u32; 5]; self.structs];
        for dd in d.saturating_sub(29)..=d {
            for (s, acc) in sum.iter_mut().enumerate() {
                let k = (dd * self.structs + s) * 5;
                for c in 0..5 {
                    acc[c] += self.counts[k + c] as u32;
                }
            }
        }
        sum
    }

    /// The overlay's colours on day `d` (decided_colors over the last 30 days' counts).
    pub fn colors(&self, d: i64, focus: Option<usize>) -> Vec<Option<[f32; 3]>> {
        decided_colors(&self.window(d), focus)
    }
}

/// A building's colour for the who-decided overlay, from its counts by class: the classes' colours mixed by count over
/// the base, brighter where more landed (`focus`: one class, or None for all but the person's own).
pub fn decided_colors(sum: &[[u32; 5]], focus: Option<usize>) -> Vec<Option<[f32; 3]>> {
    let val = |s: &[u32; 5]| -> u32 {
        match focus {
            Some(c) => s[c],
            None => s[1] + s[2] + s[3] + s[4],
        }
    };
    let max = sum.iter().map(val).max().unwrap_or(0).max(1) as f32;
    let base = lin(BASE);
    sum.iter()
        .map(|s| {
            let v = val(s);
            if v == 0 {
                return Some(base);
            }
            Some(match focus {
                Some(c) => lerp3(base, lin(CLASS_COLOR[c]), 0.35 + 0.65 * (v as f32 / max).sqrt()),
                None => {
                    let mut mix = [0.0; 3];
                    for c in 1..5 {
                        let k = s[c] as f32 / v as f32;
                        let cc = lin(CLASS_COLOR[c]);
                        for i in 0..3 {
                            mix[i] += cc[i] * k;
                        }
                    }
                    lerp3(base, mix, 0.45 + 0.55 * (v as f32 / max).sqrt())
                }
            })
        })
        .collect()
}

/// The hardship ramp: low red, middle gold, high teal (0..1).
pub fn ramp(v: f32) -> [f32; 3] {
    let (a, b, c) = (lin(HARD_COLOR), lin([0xf2, 0xc1, 0x4e]), lin([0x3f, 0xd0, 0xc9]));
    if v < 0.5 {
        lerp3(a, b, v * 2.0)
    } else {
        lerp3(b, c, (v - 0.5) * 2.0)
    }
}

/// Each person's hardship value (0..1) on day `d`, or None where nothing is on record.
/// `agency`: int16 by day by person (0..10,000; negative: none). `money`: float64 by day by holder (persons first),
/// shown as a rank in the town (nothing or less: 0).
pub fn hardship(agency: Option<&[i16]>, money: Option<&[f64]>, persons: usize, days: i64, d: i64) -> Vec<Option<f32>> {
    let d = d.clamp(0, days) as usize;
    if let Some(a) = agency {
        return (0..persons).map(|p| a.get(d * persons + p).and_then(|&v| (v >= 0).then(|| v as f32 / 10_000.0))).collect();
    }
    if let Some(m) = money {
        let holders = m.len() / (days as usize + 1).max(1);
        let xs: Vec<f64> = (0..persons).map(|p| m.get(d * holders + p).copied().unwrap_or(0.0)).collect();
        let mut sorted = xs.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        return xs
            .iter()
            .map(|&v| Some(if v <= 0.0 { 0.0 } else { sorted.partition_point(|&x| x < v) as f32 / sorted.len().max(1) as f32 }))
            .collect();
    }
    vec![None; persons]
}

/// Per building, the mean of a per-person value over those who slept there (home spaces at midnight).
pub fn by_home(vals: &[Option<f32>], where_midnight: &[u32], space_struct: &[i32], space_kind: &[u8], structs: usize) -> Vec<Option<f32>> {
    let mut acc = vec![(0.0f32, 0u32); structs];
    for (p, v) in vals.iter().enumerate() {
        let (Some(v), Some(&w)) = (v, where_midnight.get(p)) else {
            continue;
        };
        if w == 0 || space_kind.get(w as usize - 1) != Some(&0) {
            continue;
        }
        if let Some(&st) = space_struct.get(w as usize - 1) {
            if st >= 0 && (st as usize) < structs {
                acc[st as usize].0 += v;
                acc[st as usize].1 += 1;
            }
        }
    }
    acc.into_iter().map(|(s, n)| (n > 0).then(|| s / n as f32)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pulse(t: i64, st: i32, cls: u8) -> Pulse {
        Pulse { t, person: 0, st, cls, flags: 0, ord: 0 }
    }

    #[test]
    fn who_decided_counts_the_last_thirty_days_by_class() {
        let ps = vec![pulse(0, 0, 2), pulse(DAY, 0, 3), pulse(40 * DAY, 0, 1), pulse(40 * DAY, 1, 0), pulse(5, -1, 2)];
        let d = Decided::new(&ps, 60, 2);
        assert_eq!(d.window(10)[0], [0, 0, 1, 1, 0]);
        assert_eq!(d.window(40)[0], [0, 1, 0, 0, 0], "day 0 and 1 are more than 30 days back");
        assert_eq!(d.window(40)[1], [1, 0, 0, 0, 0]);
        let c = d.colors(40, None);
        assert_eq!(c[1], Some(lin(BASE)), "their own acts are not counted in 'all'");
        assert_ne!(c[0], Some(lin(BASE)));
        let seat = d.colors(10, Some(3));
        assert_ne!(seat[0], Some(lin(BASE)));
        assert_eq!(seat[1], Some(lin(BASE)));
    }

    #[test]
    fn hardship_is_one_raw_variable() {
        let agency = vec![5000i16, -1, 10000, 0];
        let v = hardship(Some(&agency), None, 2, 1, 1);
        assert_eq!(v, vec![Some(1.0), Some(0.0)]);
        assert_eq!(hardship(Some(&agency), None, 2, 1, 0)[1], None, "not on record");
        // money: a rank; nothing held is the bottom
        let money = vec![0.0, 300.0, 100.0, 999.0]; // one day, two persons and two other holders
        let r = hardship(None, Some(&money), 3, 0, 0);
        assert_eq!(r, vec![Some(0.0), Some(2.0 / 3.0), Some(1.0 / 3.0)]);
        // a building's mean over those who slept there
        let b = by_home(&[Some(1.0), Some(0.0), Some(0.5)], &[1, 1, 2], &[0, 1], &[0, 1], 2);
        assert_eq!(b, vec![Some(0.5), None]);
    }
}
