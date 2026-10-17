//! Fractions as integers (the kernel has no floating point: kernel/tests/determinism_lint.rs). A parameter written as
//! a decimal in a world's config (`0.5` of a standard deviation, `2.5` weeks) is read as a whole number of a fixed
//! scale, from the number's own digits, never through a binary float; and a ratio is written back in words the way
//! JavaScript prints a short decimal.

use serde_json::Value;

/// A JSON number as a whole number of `1/scale` (half away from nought on any digits past the scale), or none where it
/// is not a plain decimal number.
pub fn scaled(v: &Value, scale: i64) -> Option<i64> {
    let n = v.as_number()?;
    if let Some(i) = n.as_i64() {
        return i.checked_mul(scale);
    }
    let text = n.to_string();
    if text.contains(['e', 'E']) {
        return None;
    }
    let (neg, digits) = match text.strip_prefix('-') {
        Some(d) => (true, d),
        None => (false, text.as_str()),
    };
    let (whole, frac) = digits.split_once('.').unwrap_or((digits, ""));
    let mut out: i128 = whole.parse::<i128>().ok()? * i128::from(scale);
    let mut unit = i128::from(scale);
    let mut rest = frac.chars();
    for c in rest.by_ref() {
        unit /= 10;
        if unit == 0 {
            // The next digit rounds.
            if c >= '5' {
                out += 1;
            }
            break;
        }
        out += i128::from(c.to_digit(10)?) * unit;
    }
    let out = if neg { -out } else { out };
    i64::try_from(out).ok()
}

/// `num / den` as JavaScript prints a short decimal: whole numbers bare, at most four places, trailing zeros dropped
/// (rounded half away from nought at the fourth).
pub fn fmt_dec(num: i64, den: i64) -> String {
    if den == 0 {
        return "0".into();
    }
    let neg = (num < 0) != (den < 0) && num != 0;
    let (n, d) = (i128::from(num).abs(), i128::from(den).abs());
    let scaled = (n * 10_000 * 2 + d) / (2 * d);
    let (whole, frac) = (scaled / 10_000, scaled % 10_000);
    let sign = if neg { "-" } else { "" };
    if frac == 0 {
        return format!("{sign}{whole}");
    }
    let f = format!("{frac:04}");
    format!("{sign}{whole}.{}", f.trim_end_matches('0'))
}

/// `num / den` rounded half away from nought.
pub fn round_div(num: i128, den: i128) -> i128 {
    if den == 0 {
        return 0;
    }
    let (n, d) = (num.abs(), den.abs());
    let q = (2 * n + d) / (2 * d);
    if (num < 0) != (den < 0) {
        -q
    } else {
        q
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decimals_are_read_from_their_digits_and_written_back_short() {
        assert_eq!(scaled(&json!(0.5), 10_000), Some(5_000));
        assert_eq!(scaled(&json!(2), 1_000), Some(2_000));
        assert_eq!(scaled(&json!(-0.25), 10_000), Some(-2_500));
        assert_eq!(scaled(&json!(0.12345), 1_000), Some(123));
        assert_eq!(scaled(&json!(0.1235), 1_000), Some(124));
        assert_eq!(scaled(&json!("1"), 1), None);
        assert_eq!((fmt_dec(14, 7), fmt_dec(10, 7), fmt_dec(375, 10), fmt_dec(-5, 2), fmt_dec(1933, 100)), ("2".into(), "1.4286".into(), "37.5".into(), "-2.5".into(), "19.33".into()));
        assert_eq!((round_div(5, 2), round_div(-5, 2), round_div(4, 3)), (3, -3, 1));
    }
}
