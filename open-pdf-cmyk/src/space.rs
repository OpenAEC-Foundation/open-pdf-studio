//! Kleurruimten zoals de omzetting ze ziet.

use lopdf::ObjectId;

/// Waar een RGB-kleur vandaan komt: sRGB (DeviceRGB, CalRGB) of het
/// ingebedde profiel van een ICCBased-ruimte met N=3.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum RgbSource {
    Srgb,
    Icc(ObjectId),
}

/// Een kleurruimte, ingedeeld naar wat de omzetting ermee moet.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Space {
    Gray,
    /// DeviceRGB, CalRGB of ICCBased met N=3: componenten worden omgezet.
    Rgb(RgbSource),
    Cmyk,
    /// Indexed op een RGB-basis: de indices blijven, alleen het palet
    /// verandert (in de resources of het afbeeldingswoordenboek).
    IndexedRgb,
    /// Patroon. Met een RGB-basis (ongekleurd tiling-patroon) staan er vóór
    /// de patroonnaam drie componenten die mee moeten.
    Pattern(Option<RgbSource>),
    /// Separation of DeviceN met een RGB-alternatief: de tinttransformatie
    /// levert RGB en is niet algemeen om te zetten. Blijft staan en wordt
    /// gemeld.
    SpotOnRgb,
    /// Alles waar niets aan omgezet hoeft of kan (Lab, Separation op een
    /// grijs- of CMYK-alternatief, …).
    Other,
}
