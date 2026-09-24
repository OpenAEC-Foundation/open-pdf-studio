//! De kleurtransformatie als uitwisselbaar onderdeel.
//!
//! De omzetting van het document kent alleen deze trait. In de app zit er
//! Little CMS achter (`lcms::LcmsTransform`); de unit-tests gebruiken een
//! eenvoudige, deterministische formule zodat de verwachte getallen met de
//! hand na te rekenen zijn.

/// RGB naar CMYK. Alle componenten lopen van 0 tot en met 1.
pub trait CmykTransform {
    /// Eén kleur: een vectorkleur, een verloopkleur of een paletkleur.
    fn rgb_to_cmyk(&self, rgb: [f32; 3]) -> [f32; 4];

    /// Pixels met 8 bits per component: RGB-drietallen in, CMYK-viertallen
    /// uit. `cmyk` is precies `rgb.len() / 3 * 4` lang.
    fn rgb8_to_cmyk8(&self, rgb: &[u8], cmyk: &mut [u8]) {
        for (src, dst) in rgb.chunks_exact(3).zip(cmyk.chunks_exact_mut(4)) {
            let c = self.rgb_to_cmyk([src[0] as f32 / 255.0, src[1] as f32 / 255.0, src[2] as f32 / 255.0]);
            for (d, v) in dst.iter_mut().zip(c) {
                *d = to_u8(v);
            }
        }
    }

    /// Dezelfde bestemming, maar met een ingebed RGB-bronprofiel
    /// (ICCBased met N=3) in plaats van sRGB. `None`: het profiel is niet
    /// bruikbaar; de omzetting valt dan terug op deze transformatie.
    fn with_source_profile(&self, _icc: &[u8]) -> Option<Box<dyn CmykTransform>> {
        None
    }
}

/// Zet een component (0..=1) om naar 8 bits.
pub(crate) fn to_u8(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}

/// De klassieke formule zonder profiel, voor tests: K = 1 − max(R, G, B).
#[cfg(test)]
pub(crate) struct NaiveCmyk;

#[cfg(test)]
impl CmykTransform for NaiveCmyk {
    fn rgb_to_cmyk(&self, [r, g, b]: [f32; 3]) -> [f32; 4] {
        let k = 1.0 - r.max(g).max(b);
        if k >= 1.0 {
            return [0.0, 0.0, 0.0, 1.0];
        }
        [(1.0 - r - k) / (1.0 - k), (1.0 - g - k) / (1.0 - k), (1.0 - b - k) / (1.0 - k), k]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn naive_formula_is_what_the_tests_expect() {
        assert_eq!(NaiveCmyk.rgb_to_cmyk([1.0, 0.0, 0.0]), [0.0, 1.0, 1.0, 0.0]);
        assert_eq!(NaiveCmyk.rgb_to_cmyk([0.0, 0.0, 0.0]), [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(NaiveCmyk.rgb_to_cmyk([1.0, 1.0, 1.0]), [0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn default_pixel_path_rounds_the_single_colour_path() {
        let rgb = [255, 0, 0, 128, 128, 128, 0, 0, 0];
        let mut cmyk = [9u8; 12];
        NaiveCmyk.rgb8_to_cmyk8(&rgb, &mut cmyk);
        assert_eq!(cmyk, [0, 255, 255, 0, 0, 0, 0, 127, 0, 0, 0, 255]);
    }
}
