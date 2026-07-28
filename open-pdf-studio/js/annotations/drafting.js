// Gedeelde tekenconventies van de NL-tekenwerkcomponenten (pure constanten).

/**
 * Standaard lijndikte (app-px op schaal 1) van de NL-tekenwerkcomponenten:
 * parametrische symbolen, stavenreeks en betonbalk.
 *
 * BEWUST LOSGEKOPPELD van de lijndikte-keuze in het lint. Die keuze (default
 * 2–3 px) is bedoeld voor markeringen (pijlen, wolken, kaders); de
 * tekenwerkcomponenten zijn daarentegen technische symbolen met fijne
 * details op mm-schaal (beugel-dubbellijn, staafpunten, diametertekens) die
 * bij 2–3 px dichtlopen tot klodders. 0,7 app-px ≈ een 0,18 mm-pen op 100%
 * — dezelfde waarde die de wand-tool al gebruikt en visueel gangbaar op een
 * bouwkundige tekening. De kleur was al losgekoppeld (zwart); de dikte volgt
 * nu dezelfde regel. Achteraf aanpassen kan per annotatie in het
 * eigenschappen-paneel.
 */
export const DRAFTING_LINE_WIDTH = 0.7;
