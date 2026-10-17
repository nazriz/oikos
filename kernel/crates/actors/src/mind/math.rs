//! The few transcendental functions the mind needs (softmax's `exp`, a feeling's half-life, a trust's fade), written
//! with nothing but IEEE 754 addition, multiplication and division, so that the same inputs give the same bits on any
//! machine (Rust never fuses or reorders float arithmetic of its own accord). `std`'s `exp` and `ln` call the
//! platform's libm, whose last bit may differ between machines; the port guide asks for `libm` or this. Decided
//! fresh: this, so that `oikos-actors` gains no dependency. Accurate to within a few units in the last place over the
//! ranges the mind uses, which is far finer than anything it records (every result is rounded to an integer before
//! anything compares or records it).
//!
//! Also the rounding rules: `round` is JavaScript's `Math.round` (half toward positive infinity), which the TS used
//! everywhere; `clamp_bps` rounds and bounds to 0..10,000.

const LN2: f64 = std::f64::consts::LN_2;

/// e^x. Range reduction x = k ln 2 + r, |r| <= ln2 / 2, then a Taylor series to 18 terms.
pub fn exp(x: f64) -> f64 {
    if x.is_nan() {
        return x;
    }
    if x > 709.0 {
        return f64::INFINITY;
    }
    if x < -745.0 {
        return 0.0;
    }
    let k = floor(x / LN2 + 0.5);
    let r = x - k * LN2;
    let mut term = 1.0;
    let mut sum = 1.0;
    let mut i = 1.0;
    while i < 19.0 {
        term = term * r / i;
        sum += term;
        i += 1.0;
    }
    scale2(sum, k as i64)
}

/// The natural logarithm (x > 0). x = m 2^e with m in [1/sqrt2, sqrt2); ln m by the series of atanh.
pub fn ln(x: f64) -> f64 {
    if !(x > 0.0) {
        return if x == 0.0 { f64::NEG_INFINITY } else { f64::NAN };
    }
    if x.is_infinite() {
        return x;
    }
    let mut m = x;
    let mut e = 0i64;
    while m >= std::f64::consts::SQRT_2 {
        m /= 2.0;
        e += 1;
    }
    while m < std::f64::consts::FRAC_1_SQRT_2 {
        m *= 2.0;
        e -= 1;
    }
    let s = (m - 1.0) / (m + 1.0);
    let s2 = s * s;
    let mut term = s;
    let mut sum = 0.0;
    let mut n = 1.0;
    while n < 60.0 {
        sum += term / n;
        term *= s2;
        n += 2.0;
    }
    2.0 * sum + (e as f64) * LN2
}

/// base^y for base > 0.
pub fn pow(base: f64, y: f64) -> f64 {
    if y == 0.0 {
        return 1.0;
    }
    exp(y * ln(base))
}

/// What is left of something halving every `half_life` after `elapsed` (both in the same unit): 0.5^(elapsed/half).
pub fn halved(elapsed: f64, half_life: f64) -> f64 {
    if elapsed <= 0.0 {
        return 1.0;
    }
    if half_life <= 0.0 {
        return 0.0;
    }
    exp(-LN2 * elapsed / half_life)
}

/// The square root (IEEE 754 requires it correctly rounded, so `f64::sqrt` is the same everywhere).
pub fn sqrt(x: f64) -> f64 {
    x.sqrt()
}

/// x * 2^k, exactly.
fn scale2(mut x: f64, mut k: i64) -> f64 {
    while k > 0 {
        let s = k.min(1000);
        x *= f64::from_bits(((1023 + s) as u64) << 52);
        k -= s;
    }
    while k < 0 {
        let s = (-k).min(1000);
        x *= f64::from_bits(((1023 - s) as u64) << 52);
        k += s;
    }
    x
}

/// The largest integer at most x (IEEE: exact).
pub fn floor(x: f64) -> f64 {
    x.floor()
}

/// JavaScript's `Math.round`: the nearest integer, a half toward positive infinity.
pub fn round(x: f64) -> i64 {
    floor(x + 0.5) as i64
}

/// Rounded and held to 0..10,000 (mind.ts `clamp`).
pub fn clamp_bps(x: f64) -> i64 {
    round(x).clamp(0, 10_000)
}

/// Rounded and held to lo..hi.
pub fn clamp(x: f64, lo: i64, hi: i64) -> i64 {
    round(x).clamp(lo, hi)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exp_and_ln_agree_with_std_to_the_last_few_places() {
        for i in -400..=400 {
            let x = i as f64 / 37.0;
            let (a, b) = (exp(x), x.exp());
            assert!(((a - b) / b).abs() < 1e-14, "exp({x}): {a} vs {b}");
        }
        for i in 1..=500 {
            let x = i as f64 / 13.0;
            let (a, b) = (ln(x), x.ln());
            assert!((a - b).abs() < 1e-13, "ln({x}): {a} vs {b}");
        }
        assert!((halved(14.0, 14.0) - 0.5).abs() < 1e-15);
        assert!((pow(2.0, 10.0) - 1024.0).abs() < 1e-9);
    }

    #[test]
    fn round_is_javascripts() {
        assert_eq!((round(2.5), round(-2.5), round(-2.6), round(0.49)), (3, -2, -3, 0));
        assert_eq!((clamp_bps(10_400.0), clamp_bps(-3.0)), (10_000, 0));
    }
}
