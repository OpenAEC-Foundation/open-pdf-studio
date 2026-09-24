//! De echte transformatie: Little CMS, van sRGB (of een ingebed
//! RGB-profiel) naar het gekozen CMYK-drukprofiel.

use crate::transform::CmykTransform;
use lcms2::{ColorSpaceSignature, Flags, Intent, PixelFormat, Profile, Transform};

/// Rendering intent van de omzetting.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RenderingIntent {
    /// Relatief colorimetrisch met zwartpuntcompensatie (standaard).
    RelativeColorimetricBpc,
    /// Perceptueel.
    Perceptual,
}

impl RenderingIntent {
    /// Uit de code die de interface meestuurt; onbekend valt terug op de standaard.
    pub fn from_code(code: &str) -> Self {
        match code {
            "perceptual" => RenderingIntent::Perceptual,
            _ => RenderingIntent::RelativeColorimetricBpc,
        }
    }

    fn lcms(self) -> (Intent, Flags) {
        match self {
            RenderingIntent::RelativeColorimetricBpc => (Intent::RelativeColorimetric, Flags::BLACKPOINT_COMPENSATION),
            RenderingIntent::Perceptual => (Intent::Perceptual, Flags::default()),
        }
    }
}

/// RGB naar CMYK via Little CMS.
pub struct LcmsTransform {
    /// De bestemming, om met een ander bronprofiel een nieuwe te maken.
    dest_icc: Vec<u8>,
    intent: RenderingIntent,
    /// 8 bits per component, voor afbeeldingen.
    pixels: Transform<u8, u8>,
    /// 16 bits, voor losse kleuren. Geen double: alleen bij gehele getallen
    /// zet Little CMS papierwit precies op 0 0 0 0 (anders een zweem van een
    /// paar procent over elk wit vlak).
    single: Transform<[u16; 3], [u16; 4]>,
}

impl LcmsTransform {
    /// sRGB naar het profiel in `dest_icc`.
    pub fn new(dest_icc: &[u8], intent: RenderingIntent) -> Result<Self, String> {
        Self::from_source(&Profile::new_srgb(), dest_icc, intent)
    }

    fn from_source(source: &Profile, dest_icc: &[u8], intent: RenderingIntent) -> Result<Self, String> {
        let dest = Profile::new_icc(dest_icc).map_err(|e| e.to_string())?;
        if dest.color_space() != ColorSpaceSignature::CmykData {
            return Err("destination profile is not CMYK".into());
        }
        let (lcms_intent, flags) = intent.lcms();
        let pixels = Transform::new_flags(source, PixelFormat::RGB_8, &dest, PixelFormat::CMYK_8, lcms_intent, flags)
            .map_err(|e| e.to_string())?;
        let single = Transform::new_flags(source, PixelFormat::RGB_16, &dest, PixelFormat::CMYK_16, lcms_intent, flags)
            .map_err(|e| e.to_string())?;
        Ok(LcmsTransform { dest_icc: dest_icc.to_vec(), intent, pixels, single })
    }
}

impl CmykTransform for LcmsTransform {
    fn rgb_to_cmyk(&self, rgb: [f32; 3]) -> [f32; 4] {
        let mut out = [[0u16; 4]];
        self.single.transform_pixels(&[rgb.map(|v| (v.clamp(0.0, 1.0) * 65535.0).round() as u16)], &mut out);
        out[0].map(|v| v as f32 / 65535.0)
    }

    fn rgb8_to_cmyk8(&self, rgb: &[u8], cmyk: &mut [u8]) {
        let n = (rgb.len() / 3).min(cmyk.len() / 4);
        self.pixels.transform_pixels(&rgb[..n * 3], &mut cmyk[..n * 4]);
    }

    fn with_source_profile(&self, icc: &[u8]) -> Option<Box<dyn CmykTransform>> {
        let source = Profile::new_icc(icc).ok()?;
        if source.color_space() != ColorSpaceSignature::RgbData {
            return None;
        }
        let own = Self::from_source(&source, &self.dest_icc, self.intent).ok()?;
        Some(Box::new(own))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intent_codes() {
        assert_eq!(RenderingIntent::from_code("perceptual"), RenderingIntent::Perceptual);
        assert_eq!(RenderingIntent::from_code("relative"), RenderingIntent::RelativeColorimetricBpc);
        assert_eq!(RenderingIntent::from_code("iets anders"), RenderingIntent::RelativeColorimetricBpc);
    }

    #[test]
    fn a_profile_that_is_not_cmyk_is_refused() {
        // sRGB als "bestemming" is geen CMYK: de transformatie moet weigeren.
        let srgb = lcms2::Profile::new_srgb().icc().unwrap();
        assert!(LcmsTransform::new(&srgb, RenderingIntent::Perceptual).is_err());
        assert!(LcmsTransform::new(b"geen profiel", RenderingIntent::Perceptual).is_err());
    }
}
