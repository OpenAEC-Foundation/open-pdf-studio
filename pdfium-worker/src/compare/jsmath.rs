//! Rekenkunde zoals de JS-kant van Vergelijken haar doet, zodat de Rust-poort
//! dezelfde getallen oplevert als js/compare/*.
//!
//! - `hypot`: V8's Math.hypot (normaliseren op het maximum + Kahan-som), niet
//!   de C-bibliotheek-hypot, die in de laatste bit kan afwijken.
//! - `round`: Math.round (halve waarden naar +oneindig).
//! - cos/sin/atan2/exp/ln via de `libm`-crate (fdlibm-afstamming, net als
//!   V8's ieee754-functies) in plaats van de platform-CRT.

#[inline]
pub fn cos(x: f64) -> f64 {
    libm::cos(x)
}

#[inline]
pub fn sin(x: f64) -> f64 {
    libm::sin(x)
}

#[inline]
pub fn atan2(y: f64, x: f64) -> f64 {
    libm::atan2(y, x)
}

#[inline]
pub fn exp(x: f64) -> f64 {
    libm::exp(x)
}

#[inline]
pub fn ln(x: f64) -> f64 {
    libm::log(x)
}

/// Math.hypot(a, b) zoals V8 hem uitrekent.
pub fn hypot(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        if a.is_infinite() || b.is_infinite() {
            return f64::INFINITY;
        }
        return f64::NAN;
    }
    let aa = a.abs();
    let ab = b.abs();
    let max = if ab > aa { ab } else { aa };
    if max == f64::INFINITY {
        return f64::INFINITY;
    }
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0f64;
    let mut compensation = 0.0f64;
    for v in [aa, ab] {
        let n = v / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

/// Math.round: dichtstbijzijnde geheel getal, halve waarden naar +oneindig.
pub fn round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let c = x.ceil();
    if c - 0.5 > x {
        c - 1.0
    } else {
        c
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_matches_math_round() {
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(0.49999999999999994), 0.0);
        assert_eq!(round(1.4), 1.0);
        assert_eq!(round(-1.6), -2.0);
    }

    #[test]
    fn hypot_matches_the_obvious_cases() {
        assert_eq!(hypot(3.0, 4.0), 5.0);
        assert_eq!(hypot(0.0, 0.0), 0.0);
        assert_eq!(hypot(-3.0, 0.0), 3.0);
        assert!(hypot(f64::NAN, 1.0).is_nan());
        assert_eq!(hypot(f64::NAN, f64::INFINITY), f64::INFINITY);
    }
}
