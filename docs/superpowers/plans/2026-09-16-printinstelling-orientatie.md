# Printinstelling volgt het document — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De Pagina-instelling neemt oriëntatie en papierformaat over van het document, en die keuze (plus het vinkje Automatisch draaien) bereikt de printer echt.

**Architecture:** Alle beslisregels zitten in twee pure modules die zonder UI of printer te testen zijn: `js/pdf/print-pagina-instelling.js` (afleiden, keuze onthouden, argumenten voor de printer) en `src-tauri/src/print_instelling.rs` (keuzes parsen, oriëntatie per pagina, DEVMODE-papiercode, `lp`-opties). De dialogen en `print_pdf` roepen alleen die modules aan.

**Tech Stack:** SolidJS, `node --test`, Rust (`windows-sys 0.59`, `cargo test`), Tauri 2.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-16-printinstelling-orientatie-design.md`.
- Werk in een eigen worktree op branch `fix/printinstelling-orientatie`; nooit in de hoofd-checkout (daar draait het dev-venster van de gebruiker op Vite 3041).
- `print_pdf` zonder de nieuwe argumenten gedraagt zich exact als nu.
- Papiercodes uit `windows-sys 0.59`: A2=66, A3=8, A4=9, A5=11, Letter=1, Legal=5, Tabloid=3. Windows heeft geen A1/A0.
- Formaattolerantie 3 mm. Vierkante pagina = staand.
- i18n-sleutels in alle 39 locales.
- Geen namen van commerciële derde partijen in code, comments of commits.
- Vóór elke commit: `npm run test:unit` en `npx vite build` groen (ESM-fouten mist `node --check`).
- Commit-berichten zonder AI-attributie; niet pushen zonder akkoord van de gebruiker.

---

### Task 0: Worktree

**Files:** geen.

- [ ] **Step 1: Worktree aanmaken**

```bash
cd "C:/Users/rickd/Documents/GitHub/open-pdf-studio"
git fetch -q origin
git worktree add -b fix/printinstelling-orientatie "C:/Users/rickd/AppData/Local/Temp/opds-print" origin/main
```

- [ ] **Step 2: Spec en plan meenemen en node_modules koppelen**

```bash
W="C:/Users/rickd/AppData/Local/Temp/opds-print"
mkdir -p "$W/docs/superpowers/specs" "$W/docs/superpowers/plans"
cp "C:/Users/rickd/Documents/GitHub/open-pdf-studio/docs/superpowers/specs/2026-09-16-printinstelling-orientatie-design.md" "$W/docs/superpowers/specs/"
cp "C:/Users/rickd/Documents/GitHub/open-pdf-studio/docs/superpowers/plans/2026-09-16-printinstelling-orientatie.md" "$W/docs/superpowers/plans/"
cmd //c mklink /J "$(cygpath -w "$W/open-pdf-studio/node_modules")" "$(cygpath -w "C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules")"
cd "$W/open-pdf-studio" && npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
npx vite build 2>&1 | grep -iE "error|built in"
```

Expected: `fail 0` en `✓ built in`. (Een junction naar node_modules is prima voor tests en build; alleen de Vite-devserver struikelt erover. De vite-build maakt `dist/` aan, die Tauri bij `cargo check`/`cargo test` inbakt — zonder faalt de Rust-compilatie.)

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/rickd/AppData/Local/Temp/opds-print"
git add docs/superpowers/specs/2026-09-16-printinstelling-orientatie-design.md docs/superpowers/plans/2026-09-16-printinstelling-orientatie.md
git commit -m "docs: ontwerp en plan voor printinstelling die het document volgt"
```

---

### Task 1: Pure JS-beslisregels

**Files:**
- Create: `open-pdf-studio/js/pdf/print-pagina-instelling.js`
- Create: `open-pdf-studio/js/pdf/print-pagina-instelling.test.mjs`
- Modify: `open-pdf-studio/package.json` (script `test:unit`)

**Interfaces:**
- Produces:
  - `PAPIERFORMATEN: Record<'a2'|'a3'|'a4'|'a5'|'letter'|'legal'|'tabloid', {breedte:number, hoogte:number, label:string}>` (mm, staand)
  - `paginaOrientatie(breedtePt:number, hoogtePt:number): 'landscape'|'portrait'`
  - `paginaFormaat(breedtePt:number, hoogtePt:number): keyof PAPIERFORMATEN | 'printer'`
  - `startPaginaInstelling({bewaard, docId, breedtePt, hoogtePt}): {size, orientation, handmatig:boolean}`
  - `bewaarPaginaInstelling({start, gekozen, docId}): {docId, size, orientation, handmatig:boolean}`
  - `printArgumenten({autoRotate:boolean, paginaInstelling, docId}): {orientatie:'auto'|'portrait'|'landscape', papier:string}`

- [ ] **Step 1: Test schrijven**

`open-pdf-studio/js/pdf/print-pagina-instelling.test.mjs`:

```js
// Beslisregels van de Pagina-instelling: afleiden uit het document, een
// handmatige keuze onthouden per document, en wat er naar de printer gaat.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PAPIERFORMATEN, paginaOrientatie, paginaFormaat,
  startPaginaInstelling, bewaarPaginaInstelling, printArgumenten,
} from './print-pagina-instelling.js';

const MM = 72 / 25.4; // pt per mm
const pt = (mm) => mm * MM;

test('oriëntatie: breder dan hoog is liggend, vierkant is staand', () => {
  assert.equal(paginaOrientatie(pt(420), pt(297)), 'landscape');
  assert.equal(paginaOrientatie(pt(297), pt(420)), 'portrait');
  assert.equal(paginaOrientatie(500, 500), 'portrait');
});

test('formaat: herkend in beide oriëntaties', () => {
  assert.equal(paginaFormaat(pt(210), pt(297)), 'a4');
  assert.equal(paginaFormaat(pt(297), pt(210)), 'a4');
  assert.equal(paginaFormaat(pt(594), pt(420)), 'a2');
  assert.equal(paginaFormaat(pt(279), pt(432)), 'tabloid');
});

test('formaat: tolerantie van 3 mm, daarbuiten printerstandaard', () => {
  assert.equal(paginaFormaat(pt(212.9), pt(299.9)), 'a4');
  assert.equal(paginaFormaat(pt(213.5), pt(297)), 'printer');
});

test('formaat: A1 en A0 bestaan niet in Windows en worden printerstandaard', () => {
  assert.equal(paginaFormaat(pt(841), pt(594)), 'printer');
  assert.equal(paginaFormaat(pt(1189), pt(841)), 'printer');
});

test('formaat en oriëntatie: ongeldige maten', () => {
  assert.equal(paginaFormaat(0, 100), 'printer');
  assert.equal(paginaFormaat(NaN, NaN), 'printer');
  assert.equal(paginaOrientatie(NaN, NaN), 'portrait');
});

test('A2 staat in de lijst met de juiste maten', () => {
  assert.deepEqual(
    { breedte: PAPIERFORMATEN.a2.breedte, hoogte: PAPIERFORMATEN.a2.hoogte },
    { breedte: 420, hoogte: 594 },
  );
});

test('start: niets bewaard → afgeleid uit de pagina', () => {
  const s = startPaginaInstelling({ bewaard: null, docId: 'd1', breedtePt: pt(420), hoogtePt: pt(297) });
  assert.deepEqual(s, { size: 'a3', orientation: 'landscape', handmatig: false });
});

test('start: handmatige keuze in hetzelfde document blijft staan', () => {
  const bewaard = { docId: 'd1', size: 'a4', orientation: 'portrait', handmatig: true };
  const s = startPaginaInstelling({ bewaard, docId: 'd1', breedtePt: pt(420), hoogtePt: pt(297) });
  assert.deepEqual(s, { size: 'a4', orientation: 'portrait', handmatig: true });
});

test('start: handmatige keuze in een ánder document telt niet', () => {
  const bewaard = { docId: 'd1', size: 'a4', orientation: 'portrait', handmatig: true };
  const s = startPaginaInstelling({ bewaard, docId: 'd2', breedtePt: pt(420), hoogtePt: pt(297) });
  assert.deepEqual(s, { size: 'a3', orientation: 'landscape', handmatig: false });
});

test('start: niets handmatig gewijzigd → volgt de huidige pagina (gemengde oriëntaties)', () => {
  const bewaard = { docId: 'd1', size: 'a3', orientation: 'landscape', handmatig: false };
  const s = startPaginaInstelling({ bewaard, docId: 'd1', breedtePt: pt(297), hoogtePt: pt(420) });
  assert.deepEqual(s, { size: 'a3', orientation: 'portrait', handmatig: false });
});

test('start: maten onbekend → bewaarde waarden, anders A4 staand', () => {
  const bewaard = { docId: 'd9', size: 'a3', orientation: 'landscape', handmatig: false };
  assert.deepEqual(
    startPaginaInstelling({ bewaard, docId: 'd1', breedtePt: NaN, hoogtePt: NaN }),
    { size: 'a3', orientation: 'landscape', handmatig: false },
  );
  assert.deepEqual(
    startPaginaInstelling({ bewaard: null, docId: 'd1', breedtePt: NaN, hoogtePt: NaN }),
    { size: 'a4', orientation: 'portrait', handmatig: false },
  );
});

test('bewaren: handmatig zodra de gebruiker iets anders kiest dan de start', () => {
  const start = { size: 'a3', orientation: 'landscape', handmatig: false };
  assert.equal(bewaarPaginaInstelling({ start, gekozen: { size: 'a3', orientation: 'landscape' }, docId: 'd1' }).handmatig, false);
  assert.equal(bewaarPaginaInstelling({ start, gekozen: { size: 'a3', orientation: 'portrait' }, docId: 'd1' }).handmatig, true);
  assert.equal(bewaarPaginaInstelling({ start, gekozen: { size: 'a4', orientation: 'landscape' }, docId: 'd1' }).handmatig, true);
});

test('bewaren: een eerdere handmatige keuze blijft handmatig bij OK zonder wijziging', () => {
  const start = { size: 'a4', orientation: 'portrait', handmatig: true };
  const b = bewaarPaginaInstelling({ start, gekozen: { size: 'a4', orientation: 'portrait' }, docId: 'd1' });
  assert.deepEqual(b, { docId: 'd1', size: 'a4', orientation: 'portrait', handmatig: true });
});

test('printer: Automatisch draaien aan → oriëntatie auto', () => {
  const p = { docId: 'd1', size: 'a3', orientation: 'portrait', handmatig: true };
  assert.deepEqual(printArgumenten({ autoRotate: true, paginaInstelling: p, docId: 'd1' }),
    { orientatie: 'auto', papier: 'a3' });
});

test('printer: Automatisch draaien uit → oriëntatie uit de Pagina-instelling', () => {
  const p = { docId: 'd1', size: 'a4', orientation: 'landscape', handmatig: true };
  assert.deepEqual(printArgumenten({ autoRotate: false, paginaInstelling: p, docId: 'd1' }),
    { orientatie: 'landscape', papier: 'a4' });
});

test('printer: Pagina-instelling niet voor dit document geopend → nooit een verzonnen standaard', () => {
  const vreemd = { docId: 'ander', size: 'a4', orientation: 'portrait', handmatig: true };
  assert.deepEqual(printArgumenten({ autoRotate: false, paginaInstelling: vreemd, docId: 'd1' }),
    { orientatie: 'auto', papier: 'printer' });
  assert.deepEqual(printArgumenten({ autoRotate: false, paginaInstelling: null, docId: 'd1' }),
    { orientatie: 'auto', papier: 'printer' });
});
```

- [ ] **Step 2: Test draaien, moet falen**

Run: `cd open-pdf-studio && node --test js/pdf/print-pagina-instelling.test.mjs`
Expected: FAIL — `Cannot find module './print-pagina-instelling.js'`.

- [ ] **Step 3: Implementatie**

`open-pdf-studio/js/pdf/print-pagina-instelling.js`:

```js
// Beslisregels van de Pagina-instelling (bereikbaar vanuit de printdialoog).
//
// De dialoog begon altijd op A4 staand, ongeacht het document, en wat erin
// werd ingesteld bereikte de printer niet. Hier staat de pure logica:
// afleiden uit de pagina, een handmatige keuze per document onthouden, en de
// argumenten voor print_pdf. Geen DOM, geen state — volledig te testen.

/** Papierformaten in mm (staand). Windows kent geen A1/A0; die worden printerstandaard. */
export const PAPIERFORMATEN = Object.freeze({
  a2: { breedte: 420, hoogte: 594, label: 'A2' },
  a3: { breedte: 297, hoogte: 420, label: 'A3' },
  a4: { breedte: 210, hoogte: 297, label: 'A4' },
  a5: { breedte: 148, hoogte: 210, label: 'A5' },
  letter: { breedte: 216, hoogte: 279, label: 'Letter' },
  legal: { breedte: 216, hoogte: 356, label: 'Legal' },
  tabloid: { breedte: 279, hoogte: 432, label: 'Tabloid' },
});

const TOLERANTIE_MM = 3;
const PT_NAAR_MM = 25.4 / 72;

function geldig(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** Breder dan hoog → liggend; vierkant of onbekend → staand. */
export function paginaOrientatie(breedtePt, hoogtePt) {
  return geldig(breedtePt) && geldig(hoogtePt) && breedtePt > hoogtePt ? 'landscape' : 'portrait';
}

/** Formaat uit de lijst dat binnen de tolerantie past, in beide oriëntaties; anders 'printer'. */
export function paginaFormaat(breedtePt, hoogtePt) {
  if (!geldig(breedtePt) || !geldig(hoogtePt)) return 'printer';
  const kort = Math.min(breedtePt, hoogtePt) * PT_NAAR_MM;
  const lang = Math.max(breedtePt, hoogtePt) * PT_NAAR_MM;
  for (const [sleutel, f] of Object.entries(PAPIERFORMATEN)) {
    if (Math.abs(kort - f.breedte) <= TOLERANTIE_MM && Math.abs(lang - f.hoogte) <= TOLERANTIE_MM) {
      return sleutel;
    }
  }
  return 'printer';
}

/**
 * Waarmee de dialoog opent. Een handmatige keuze blijft staan zolang het om
 * hetzelfde document gaat; anders volgt de dialoog de huidige pagina.
 */
export function startPaginaInstelling({ bewaard, docId, breedtePt, hoogtePt }) {
  if (bewaard && bewaard.handmatig && bewaard.docId === docId) {
    return { size: bewaard.size, orientation: bewaard.orientation, handmatig: true };
  }
  if (!geldig(breedtePt) || !geldig(hoogtePt)) {
    return {
      size: bewaard?.size || 'a4',
      orientation: bewaard?.orientation || 'portrait',
      handmatig: false,
    };
  }
  return {
    size: paginaFormaat(breedtePt, hoogtePt),
    orientation: paginaOrientatie(breedtePt, hoogtePt),
    handmatig: false,
  };
}

/** Wat er bij OK bewaard wordt. Handmatig = afwijkend van de start, of dat al was. */
export function bewaarPaginaInstelling({ start, gekozen, docId }) {
  const afwijkend = gekozen.size !== start.size || gekozen.orientation !== start.orientation;
  return {
    docId,
    size: gekozen.size,
    orientation: gekozen.orientation,
    handmatig: Boolean(start.handmatig || afwijkend),
  };
}

/**
 * Argumenten voor print_pdf. Alleen een Pagina-instelling die voor dít
 * document is bevestigd telt; anders geen verzonnen A4-standaard maar het
 * gedrag van vóór deze wijziging (per pagina draaien, papier van de printer).
 */
export function printArgumenten({ autoRotate, paginaInstelling, docId }) {
  const voorDitDocument = Boolean(paginaInstelling) && paginaInstelling.docId === docId;
  return {
    orientatie: autoRotate || !voorDitDocument ? 'auto' : paginaInstelling.orientation,
    papier: voorDitDocument ? paginaInstelling.size : 'printer',
  };
}
```

- [ ] **Step 4: Test draaien, moet slagen**

Run: `cd open-pdf-studio && node --test js/pdf/print-pagina-instelling.test.mjs`
Expected: PASS, 16 tests.

- [ ] **Step 5: Aan test:unit toevoegen**

In `open-pdf-studio/package.json`, achteraan de waarde van `"test:unit"` (vóór het afsluitende `"`), toevoegen:

```
 js/pdf/print-pagina-instelling.test.mjs
```

Run: `cd open-pdf-studio && npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add open-pdf-studio/js/pdf/print-pagina-instelling.js open-pdf-studio/js/pdf/print-pagina-instelling.test.mjs open-pdf-studio/package.json
git commit -m "feat(print): beslisregels voor een pagina-instelling die het document volgt"
```

---

### Task 2: Pure Rust-module

**Files:**
- Create: `open-pdf-studio/src-tauri/src/print_instelling.rs`
- Modify: `open-pdf-studio/src-tauri/src/lib.rs:17` (moduledeclaratie)

**Interfaces:**
- Produces:
  - `pub enum Orientatie { Auto, Staand, Liggend }` met `pub fn uit_keuze(keuze: Option<&str>) -> Orientatie`
  - `pub enum Papier { Printer, A2, A3, A4, A5, Letter, Legal, Tabloid }` met `pub fn uit_keuze(keuze: Option<&str>) -> Papier`
  - `pub fn liggend_voor_pagina(keuze: Orientatie, breedte: u32, hoogte: u32) -> bool`
  - `pub fn dmpaper(papier: Papier) -> Option<i16>`
  - `pub fn lp_opties(orientatie: Orientatie, papier: Papier) -> Vec<String>`

- [ ] **Step 1: Module met tests schrijven**

`open-pdf-studio/src-tauri/src/print_instelling.rs`:

```rust
//! Printkeuzes uit de Pagina-instelling vertaald naar wat de printer begrijpt.
//!
//! Puur en platformonafhankelijk, zodat de regels zonder printer te testen
//! zijn. `print_pdf` gebruikt ze voor de DEVMODE op Windows en voor de
//! `lp`-opties op Linux en macOS.

/// Gevraagde oriëntatie. `Auto` = per pagina afleiden (breder dan hoog → liggend).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Orientatie {
    Auto,
    Staand,
    Liggend,
}

impl Orientatie {
    /// Onbekende of ontbrekende keuze → `Auto` (het gedrag van vóór deze wijziging).
    pub fn uit_keuze(keuze: Option<&str>) -> Orientatie {
        match keuze {
            Some("portrait") => Orientatie::Staand,
            Some("landscape") => Orientatie::Liggend,
            _ => Orientatie::Auto,
        }
    }
}

/// Gevraagd papierformaat. `Printer` = niets instellen, standaard van de printer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Papier {
    Printer,
    A2,
    A3,
    A4,
    A5,
    Letter,
    Legal,
    Tabloid,
}

impl Papier {
    /// Onbekende of ontbrekende keuze → `Printer`.
    pub fn uit_keuze(keuze: Option<&str>) -> Papier {
        match keuze {
            Some("a2") => Papier::A2,
            Some("a3") => Papier::A3,
            Some("a4") => Papier::A4,
            Some("a5") => Papier::A5,
            Some("letter") => Papier::Letter,
            Some("legal") => Papier::Legal,
            Some("tabloid") => Papier::Tabloid,
            _ => Papier::Printer,
        }
    }
}

/// Moet deze pagina liggend? Bij `Auto`: breder dan hoog.
pub fn liggend_voor_pagina(keuze: Orientatie, breedte: u32, hoogte: u32) -> bool {
    match keuze {
        Orientatie::Auto => breedte > hoogte,
        Orientatie::Staand => false,
        Orientatie::Liggend => true,
    }
}

/// DEVMODE `dmPaperSize`. Waarden gelijk aan de `DMPAPER_*`-constanten uit
/// windows-sys 0.59; `None` bij `Printer` (dan wordt `DM_PAPERSIZE` niet gezet).
pub fn dmpaper(papier: Papier) -> Option<i16> {
    match papier {
        Papier::Printer => None,
        Papier::A2 => Some(66),
        Papier::A3 => Some(8),
        Papier::A4 => Some(9),
        Papier::A5 => Some(11),
        Papier::Letter => Some(1),
        Papier::Legal => Some(5),
        Papier::Tabloid => Some(3),
    }
}

/// Extra `lp`-argumenten (CUPS). Bij `Auto` geen oriëntatie-optie, bij `Printer` geen media.
pub fn lp_opties(orientatie: Orientatie, papier: Papier) -> Vec<String> {
    let mut opties = Vec::new();
    match orientatie {
        Orientatie::Auto => {}
        Orientatie::Staand => {
            opties.push("-o".to_string());
            opties.push("orientation-requested=3".to_string());
        }
        Orientatie::Liggend => {
            opties.push("-o".to_string());
            opties.push("orientation-requested=4".to_string());
        }
    }
    let media = match papier {
        Papier::Printer => None,
        Papier::A2 => Some("A2"),
        Papier::A3 => Some("A3"),
        Papier::A4 => Some("A4"),
        Papier::A5 => Some("A5"),
        Papier::Letter => Some("Letter"),
        Papier::Legal => Some("Legal"),
        Papier::Tabloid => Some("Tabloid"),
    };
    if let Some(m) = media {
        opties.push("-o".to_string());
        opties.push(format!("media={m}"));
    }
    opties
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keuzes_parsen_met_veilige_terugval() {
        assert_eq!(Orientatie::uit_keuze(Some("landscape")), Orientatie::Liggend);
        assert_eq!(Orientatie::uit_keuze(Some("portrait")), Orientatie::Staand);
        assert_eq!(Orientatie::uit_keuze(Some("auto")), Orientatie::Auto);
        assert_eq!(Orientatie::uit_keuze(Some("onzin")), Orientatie::Auto);
        assert_eq!(Orientatie::uit_keuze(None), Orientatie::Auto);
        assert_eq!(Papier::uit_keuze(Some("a3")), Papier::A3);
        assert_eq!(Papier::uit_keuze(Some("printer")), Papier::Printer);
        assert_eq!(Papier::uit_keuze(Some("a1")), Papier::Printer);
        assert_eq!(Papier::uit_keuze(None), Papier::Printer);
    }

    #[test]
    fn auto_volgt_de_pagina_zoals_voorheen() {
        assert!(liggend_voor_pagina(Orientatie::Auto, 1684, 1191));
        assert!(!liggend_voor_pagina(Orientatie::Auto, 1191, 1684));
        assert!(!liggend_voor_pagina(Orientatie::Auto, 1000, 1000));
    }

    #[test]
    fn expliciete_keuze_wint_van_de_pagina() {
        assert!(liggend_voor_pagina(Orientatie::Liggend, 1191, 1684));
        assert!(!liggend_voor_pagina(Orientatie::Staand, 1684, 1191));
    }

    #[test]
    fn printerstandaard_zet_geen_papiercode() {
        assert_eq!(dmpaper(Papier::Printer), None);
        assert_eq!(dmpaper(Papier::A4), Some(9));
    }

    #[cfg(windows)]
    #[test]
    fn papiercodes_gelijk_aan_windows_constanten() {
        use windows_sys::Win32::Graphics::Gdi::{
            DMPAPER_A2, DMPAPER_A3, DMPAPER_A4, DMPAPER_A5, DMPAPER_LEGAL, DMPAPER_LETTER, DMPAPER_TABLOID,
        };
        assert_eq!(dmpaper(Papier::A2), Some(DMPAPER_A2 as i16));
        assert_eq!(dmpaper(Papier::A3), Some(DMPAPER_A3 as i16));
        assert_eq!(dmpaper(Papier::A4), Some(DMPAPER_A4 as i16));
        assert_eq!(dmpaper(Papier::A5), Some(DMPAPER_A5 as i16));
        assert_eq!(dmpaper(Papier::Letter), Some(DMPAPER_LETTER as i16));
        assert_eq!(dmpaper(Papier::Legal), Some(DMPAPER_LEGAL as i16));
        assert_eq!(dmpaper(Papier::Tabloid), Some(DMPAPER_TABLOID as i16));
    }

    #[test]
    fn lp_opties_per_keuze() {
        assert!(lp_opties(Orientatie::Auto, Papier::Printer).is_empty());
        assert_eq!(
            lp_opties(Orientatie::Liggend, Papier::A3),
            vec!["-o", "orientation-requested=4", "-o", "media=A3"]
        );
        assert_eq!(lp_opties(Orientatie::Staand, Papier::Printer), vec!["-o", "orientation-requested=3"]);
    }
}
```

- [ ] **Step 2: Module declareren**

In `open-pdf-studio/src-tauri/src/lib.rs`, direct na regel `pub mod pdfium_renderer;`:

```rust
pub mod print_instelling;
```

- [ ] **Step 3: Tests draaien**

Run:
```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR=C:/opds-cargo-target-print cargo test --lib print_instelling 2>&1 | tail -15
```
Expected: `test result: ok. 6 passed` (op Windows; 5 op andere platforms).

- [ ] **Step 4: Commit**

```bash
git add open-pdf-studio/src-tauri/src/print_instelling.rs open-pdf-studio/src-tauri/src/lib.rs
git commit -m "feat(print): printkeuzes vertalen naar DEVMODE en lp-opties"
```

---

### Task 3: `print_pdf` gebruikt de keuzes

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/lib.rs` — functie `print_pdf` (signatuur, `use`-lijst, DEVMODE-opbouw, paginalus, `lp`-tak)

**Interfaces:**
- Consumes: `print_instelling::{Orientatie, Papier, liggend_voor_pagina, dmpaper, lp_opties}` (Task 2)
- Produces: Tauri-commando `print_pdf(path: String, printer: String, orientatie: Option<String>, papier: Option<String>)`

- [ ] **Step 1: Signatuur en keuzes**

Vervang:

```rust
async fn print_pdf(path: String, printer: String) -> Result<bool, String> {
```

door:

```rust
async fn print_pdf(
    path: String,
    printer: String,
    orientatie: Option<String>,
    papier: Option<String>,
) -> Result<bool, String> {
    // Keuzes uit de Pagina-instelling. Zonder argumenten: Auto + printerstandaard,
    // precies het gedrag van vóór deze parameters.
    let orientatie = print_instelling::Orientatie::uit_keuze(orientatie.as_deref());
    let papier = print_instelling::Papier::uit_keuze(papier.as_deref());
```

- [ ] **Step 2: `DM_PAPERSIZE` importeren**

In de `use windows_sys::Win32::Graphics::Gdi::{ … }` binnen `print_pdf`, vervang:

```rust
            DM_ORIENTATION, DMORIENT_PORTRAIT, DMORIENT_LANDSCAPE,
```

door:

```rust
            DM_ORIENTATION, DM_PAPERSIZE, DMORIENT_PORTRAIT, DMORIENT_LANDSCAPE,
```

- [ ] **Step 3: DEVMODE-velden**

Vervang:

```rust
            devmode.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
            devmode.dmFields = DM_ORIENTATION;
```

door:

```rust
            devmode.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
            devmode.dmFields = DM_ORIENTATION;
            // Papierformaat alleen als de gebruiker er een koos; anders blijft
            // het formaat van de printer staan.
            if let Some(code) = print_instelling::dmpaper(papier) {
                devmode.dmFields |= DM_PAPERSIZE;
                devmode.Anonymous1.Anonymous1.dmPaperSize = code;
            }
```

- [ ] **Step 4: Oriëntatie per pagina en `ResetDCW` controleren**

Vervang:

```rust
                devmode.Anonymous1.Anonymous1.dmOrientation =
                    (if w > h { DMORIENT_LANDSCAPE } else { DMORIENT_PORTRAIT }) as i16;
                ResetDCW(hdc, &devmode);
```

door:

```rust
                devmode.Anonymous1.Anonymous1.dmOrientation =
                    (if print_instelling::liggend_voor_pagina(orientatie, w, h) {
                        DMORIENT_LANDSCAPE
                    } else {
                        DMORIENT_PORTRAIT
                    }) as i16;
                if ResetDCW(hdc, &devmode).is_null() {
                    // De driver weigerde de wijziging; de pagina gaat met de
                    // vorige instelling mee in plaats van de opdracht af te breken.
                    eprintln!("[print] ResetDC geweigerd voor pagina {} ({:?}, {:?})", i + 1, orientatie, papier);
                }
```

- [ ] **Step 5: `lp`-tak**

Vervang:

```rust
        let output = cmd
            .arg(&path)
```

door:

```rust
        for optie in print_instelling::lp_opties(orientatie, papier) {
            cmd.arg(optie);
        }
        let output = cmd
            .arg(&path)
```

En in de laatste tak (niet-ondersteund platform) vervang:

```rust
        let _ = (&path, &printer);
```

door:

```rust
        let _ = (&path, &printer, &orientatie, &papier);
```

- [ ] **Step 6: Bouwen**

Run:
```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR=C:/opds-cargo-target-print cargo check 2>&1 | grep -E "^(error|warning: unused)|error\[" ; echo "exit=${PIPESTATUS[0]}"
```
Expected: `exit=0`, geen errors.

- [ ] **Step 7: Commit**

```bash
git add open-pdf-studio/src-tauri/src/lib.rs
git commit -m "feat(print): oriëntatie en papierformaat uit de pagina-instelling naar de printer"
```

---

### Task 4: Dialogen en printopdracht

**Files:**
- Modify: `open-pdf-studio/js/solid/components/dialogs/PageSetupDialog.jsx`
- Modify: `open-pdf-studio/js/solid/components/dialogs/PrintDialog.jsx:222-258` (`executePrint`)
- Modify: `open-pdf-studio/js/pdf/print-job.js` (`runPrintJob`)
- Modify: `open-pdf-studio/js/i18n/locales/*/dialogs.json` (39 bestanden)

**Interfaces:**
- Consumes: alle exports van Task 1; `print_pdf`-argumenten `orientatie`, `papier` (Task 3)
- Produces: `pageSetupSettings` krijgt `docId` en `handmatig`; `runPrintJob({pages, copies, printer, orientatie, papier})`

- [ ] **Step 1: i18n-sleutel in alle 39 locales**

Script (eenmalig, uitvoeren vanuit de worktree-root) `scratch-i18n.py`:

```python
import io, json, os

VERTALING = {
    "ar": "الافتراضي للطابعة", "bg": "По подразбиране за принтера", "bn": "প্রিন্টারের ডিফল্ট",
    "ca": "Predeterminat de la impressora", "cs": "Výchozí nastavení tiskárny", "da": "Printerens standard",
    "de": "Druckerstandard", "el": "Προεπιλογή εκτυπωτή", "en": "Printer default",
    "es": "Predeterminado de la impresora", "fa": "پیش‌فرض چاپگر", "fi": "Tulostimen oletus",
    "fr": "Valeur par défaut de l'imprimante", "he": "ברירת המחדל של המדפסת", "hi": "प्रिंटर डिफ़ॉल्ट",
    "hr": "Zadano za pisač", "hu": "Nyomtató alapértelmezése", "id": "Bawaan printer",
    "it": "Predefinito della stampante", "ja": "プリンターの既定", "ko": "프린터 기본값",
    "ms": "Lalai pencetak", "nb": "Skriverens standard", "nl": "Standaard van de printer",
    "pl": "Domyślne drukarki", "pt": "Padrão da impressora", "ro": "Implicit imprimantă",
    "ru": "По умолчанию для принтера", "sk": "Predvolené nastavenie tlačiarne", "sr": "Подразумевано за штампач",
    "sv": "Skrivarens standard", "sw": "Chaguo-msingi la printa", "ta": "அச்சுப்பொறி இயல்புநிலை",
    "th": "ค่าเริ่มต้นของเครื่องพิมพ์", "tr": "Yazıcı varsayılanı", "uk": "За замовчуванням для принтера",
    "ur": "پرنٹر کا ڈیفالٹ", "vi": "Mặc định của máy in", "zh": "打印机默认",
}
MAP = os.path.join("open-pdf-studio", "js", "i18n", "locales")
talen = sorted(d for d in os.listdir(MAP) if os.path.isdir(os.path.join(MAP, d)))
assert set(talen) == set(VERTALING), set(talen) ^ set(VERTALING)
for taal in talen:
    pad = os.path.join(MAP, taal, "dialogs.json")
    ruw = io.open(pad, encoding="utf-8").read()
    insp = next((len(r) - len(r.lstrip(" ")) for r in ruw.splitlines()[1:4] if r.startswith(" ")), 2)
    data = json.loads(ruw)
    data["pageSetup"]["printerDefault"] = VERTALING[taal]
    io.open(pad, "w", encoding="utf-8", newline="").write(
        json.dumps(data, ensure_ascii=False, indent=insp) + ("\n" if ruw.endswith("\n") else ""))
print(len(talen), "locales bijgewerkt")
```

Run: `python scratch-i18n.py && rm scratch-i18n.py`
Expected: `39 locales bijgewerkt`.

- [ ] **Step 2: PageSetupDialog — imports en opslag**

In `PageSetupDialog.jsx`, vervang de regels van `import { createSignal, createEffect, onMount } from 'solid-js';` tot en met het einde van `getPageSetupSettings()` door:

```jsx
import { createSignal, createEffect, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument, getPageRotation } from '../../../core/state.js';
import {
  PAPIERFORMATEN, startPaginaInstelling, bewaarPaginaInstelling,
} from '../../../pdf/print-pagina-instelling.js';

// docId + handmatig: een zelf gekozen oriëntatie/formaat blijft staan zolang
// je in hetzelfde document werkt (zie print-pagina-instelling.js).
export let pageSetupSettings = {
  docId: null,
  handmatig: false,
  size: 'a4',
  source: 'auto',
  orientation: 'portrait',
  marginLeft: 25,
  marginRight: 25,
  marginTop: 25,
  marginBottom: 25,
};

export function getPageSetupSettings() {
  return { ...pageSetupSettings };
}

// Maat van de huidige pagina zoals getoond (inclusief draaiing), in pt.
async function huidigePaginaMaat(doc) {
  if (!doc?.pdfDoc) return { breedtePt: NaN, hoogtePt: NaN };
  try {
    const pageNum = doc.currentPage || 1;
    const page = await doc.pdfDoc.getPage(pageNum);
    const extra = getPageRotation(pageNum);
    const opts = { scale: 1 };
    if (extra) opts.rotation = (page.rotate + extra) % 360;
    const vp = page.getViewport(opts);
    return { breedtePt: vp.width, hoogtePt: vp.height };
  } catch {
    return { breedtePt: NaN, hoogtePt: NaN };
  }
}
```

- [ ] **Step 3: PageSetupDialog — starten vanuit het document**

Vervang in de component (4 spaties inspringing, binnen `updatePreview`):

```jsx
    const sizeData = PAGE_SETUP_SIZES[sizeKey] || PAGE_SETUP_SIZES.a4;
```

door:

```jsx
    const sizeData = PAPIERFORMATEN[sizeKey] || PAPIERFORMATEN.a4;
```

en vervang daar direct onder:

```jsx
    let paperW = sizeData.width;
    let paperH = sizeData.height;
```

door:

```jsx
    let paperW = sizeData.breedte;
    let paperH = sizeData.hoogte;
```

Vervang:

```jsx
  onMount(() => {
    updatePreview();
  });
```

door:

```jsx
  // Waarmee de dialoog begon; bepaalt bij OK of de keuze handmatig was.
  let start = {
    size: pageSetupSettings.size,
    orientation: pageSetupSettings.orientation,
    handmatig: pageSetupSettings.handmatig,
  };
  const doc = getActiveDocument();
  const docId = doc?.id ?? null;

  onMount(async () => {
    updatePreview();
    const { breedtePt, hoogtePt } = await huidigePaginaMaat(doc);
    start = startPaginaInstelling({ bewaard: pageSetupSettings, docId, breedtePt, hoogtePt });
    setSize(start.size);
    setOrientation(start.orientation);
  });
```

Vervang in `applyPageSetup`:

```jsx
    pageSetupSettings.size = size();
    pageSetupSettings.source = source();
    pageSetupSettings.orientation = orientation();
```

door:

```jsx
    const bewaard = bewaarPaginaInstelling({
      start, gekozen: { size: size(), orientation: orientation() }, docId,
    });
    pageSetupSettings.docId = bewaard.docId;
    pageSetupSettings.handmatig = bewaard.handmatig;
    pageSetupSettings.size = bewaard.size;
    pageSetupSettings.source = source();
    pageSetupSettings.orientation = bewaard.orientation;
```

En verwijder de nu ongebruikte constante `PAGE_SETUP_SIZES` (het blok `const PAGE_SETUP_SIZES = { … };` bovenaan).

- [ ] **Step 4: PageSetupDialog — A2 en printerstandaard in de keuzelijst**

Vervang:

```jsx
            <option value="a3">A3 (297 x 420 mm)</option>
```

door:

```jsx
            <option value="printer">{t('pageSetup.printerDefault')}</option>
            <option value="a2">A2 (420 x 594 mm)</option>
            <option value="a3">A3 (297 x 420 mm)</option>
```

- [ ] **Step 5: Printopdracht krijgt de keuzes**

In `PrintDialog.jsx`, voeg aan de imports toe:

```jsx
import { printArgumenten } from '../../../pdf/print-pagina-instelling.js';
import { getPageSetupSettings } from './PageSetupDialog.jsx';
```

Vervang in `executePrint`:

```jsx
    runPrintJob({ pages, copies: numCopies, printer });
```

door:

```jsx
    // Oriëntatie en papier: Automatisch draaien en de Pagina-instelling
    // bereiken nu echt de printer (zie print-pagina-instelling.js).
    const { orientatie, papier } = printArgumenten({
      autoRotate: autoRotate(),
      paginaInstelling: getPageSetupSettings(),
      docId: getActiveDocument()?.id ?? null,
    });
    runPrintJob({ pages, copies: numCopies, printer, orientatie, papier });
```

In `open-pdf-studio/js/pdf/print-job.js`, vervang:

```js
 * @param {{ pages:number[], copies:number, printer:string }} opts
 */
export async function runPrintJob({ pages, copies, printer }) {
```

door:

```js
 * @param {{ pages:number[], copies:number, printer:string,
 *           orientatie?:'auto'|'portrait'|'landscape', papier?:string }} opts
 */
export async function runPrintJob({ pages, copies, printer, orientatie = 'auto', papier = 'printer' }) {
```

en vervang:

```js
      await invoke('print_pdf', { path: tempPath, printer });
```

door:

```js
      await invoke('print_pdf', { path: tempPath, printer, orientatie, papier });
```

- [ ] **Step 6: Tests en build**

Run:
```bash
cd open-pdf-studio && npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)" && npx tsc --noEmit -p . 2>&1 | head -5; npx vite build 2>&1 | grep -iE "error|built in" | head -3
```
Expected: `fail 0`, geen tsc-uitvoer, `✓ built in`.

- [ ] **Step 7: Commit**

```bash
git add open-pdf-studio/js/solid/components/dialogs/PageSetupDialog.jsx open-pdf-studio/js/solid/components/dialogs/PrintDialog.jsx open-pdf-studio/js/pdf/print-job.js open-pdf-studio/js/i18n/locales
git commit -m "fix(print): pagina-instelling volgt het document en bereikt de printer"
```

---

### Task 5: Verificatie

**Files:** geen wijzigingen; scratch-scripts buiten de repo.

Scratch-scripts komen in een tijdelijke map buiten de repo (`$S`), niet in de repo:
`S="<tijdelijke map>"`.

- [ ] **Step 1: DEVMODE-proef met papierformaat (zonder te printen)**

Maak `$S/papier-proef.cs`:

```csharp
// Toetst DM_PAPERSIZE op echte drivers. Er wordt NIETS geprint:
// CreateDC + ResetDC + GetDeviceCaps. HORZSIZE/VERTSIZE in mm.
using System;
using System.Runtime.InteropServices;

public static class PapierProef
{
    const int HORZSIZE = 4, VERTSIZE = 6;
    const uint DM_ORIENTATION = 1, DM_PAPERSIZE = 2;
    const short DMORIENT_PORTRAIT = 1, DMPAPER_A4 = 9, DMPAPER_A3 = 8;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public uint dmFields;
        public short dmOrientation, dmPaperSize, dmPaperLength, dmPaperWidth,
                     dmScale, dmCopies, dmDefaultSource, dmPrintQuality;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels;
        public uint dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags,
                    dmDisplayFrequency, dmICMMethod, dmICMIntent, dmMediaType,
                    dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }

    [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CreateDCW(string driver, string device, string output, IntPtr devmode);
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr ResetDCW(IntPtr hdc, ref DEVMODE dm);
    [DllImport("gdi32.dll")] static extern int GetDeviceCaps(IntPtr hdc, int index);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);

    static string Meet(string printer, short papier)
    {
        IntPtr hdc = CreateDCW(null, printer, null, IntPtr.Zero);
        if (hdc == IntPtr.Zero) return "CreateDC mislukt";
        var dm = new DEVMODE { dmDeviceName = printer, dmFields = DM_ORIENTATION | DM_PAPERSIZE,
                               dmOrientation = DMORIENT_PORTRAIT, dmPaperSize = papier };
        dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
        IntPtr r = ResetDCW(hdc, ref dm);
        string uit = string.Format("ResetDC={0} {1}x{2} mm", r == IntPtr.Zero ? "NULL" : "ok",
                                   GetDeviceCaps(hdc, HORZSIZE), GetDeviceCaps(hdc, VERTSIZE));
        DeleteDC(hdc);
        return uit;
    }

    public static void Draai(string printer)
    {
        Console.WriteLine(printer);
        Console.WriteLine("  A4: " + Meet(printer, DMPAPER_A4));
        Console.WriteLine("  A3: " + Meet(printer, DMPAPER_A3));
    }
}
```

Run (PowerShell):
```powershell
$S = '<tijdelijke map>'
Add-Type -TypeDefinition (Get-Content "$S\papier-proef.cs" -Raw) -Language CSharp
foreach ($p in '<printer met A3>', '<printer met alleen A4>') { [PapierProef]::Draai($p) }
```
Expected: op "<printer met A3>" is het A3-formaat duidelijk groter dan A4 (ongeveer 297×420 vs 210×297 mm minus marges); op beide printers geen crash. Noteer de uitkomst letterlijk in het verslag.

- [ ] **Step 2: Release-build en rig**

```bash
S="<tijdelijke map>"
W="C:/Users/rickd/AppData/Local/Temp/opds-print"
cd "$W/open-pdf-studio" && CARGO_TARGET_DIR=C:/opds-cargo-target-print npm run tauri:build 2>&1 | grep -E "nsis.*setup.exe$|error\[|^error"
R="C:/Users/rickd/AppData/Local/Temp/opds-rig-print/app"
mkdir -p "$R" && cp C:/opds-cargo-target-print/release/{open-pdf-studio.exe,pdfium-worker.exe,pdfium.dll,WebView2Loader.dll,file-icon.ico} "$R/" && cp -r C:/opds-cargo-target-print/release/kaders C:/opds-cargo-target-print/release/onderhoeken "$R/"
RIG_ISO="C:/Users/rickd/AppData/Local/Temp/opds-rig-print" bash "$S/rig.sh" start "$R/open-pdf-studio.exe"
```
Expected: `rig klaar: MCP 9223, CDP 9345`. (Build-exit 1 door alleen de updater-signing is normaal; de NSIS-regel telt.)

- [ ] **Step 3: Gemeld symptoom in de app**

Maak `$S/pagina-instelling-proef.mjs`:

```js
// Opent een bestand, dan de printdialoog (Ctrl+P) en de Pagina-instelling, en
// leest wat die toont. Werkt tegen een releasebouw: alleen DOM en echte toetsen.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const playwright = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright');
const MCP = 'http://127.0.0.1:9223/mcp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tool(name, args = {}) {
  const r = await fetch(MCP, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }) });
  const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}
const bestand = process.argv[2];
const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9345');
const page = browser.contexts()[0].pages()[0];

await tool('app_open_pdf', { path: bestand });
await sleep(2500);
await page.keyboard.press('Control+p');
await page.waitForSelector('.print-printer-action-btn', { timeout: 15000 });
await page.locator('.print-printer-action-btn').nth(1).click();          // Pagina-instelling
await page.waitForSelector('input[name=page-setup-orient]', { timeout: 10000 });
await sleep(1500);                                                          // async afleiding in onMount
const uitkomst = await page.evaluate(() => ({
  orientatie: document.querySelector('input[name=page-setup-orient]:checked')?.value,
  formaat: document.querySelector('.page-setup-select')?.value,
}));
console.log(JSON.stringify({ bestand: bestand.split('/').pop(), ...uitkomst }));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
process.exit(0);
```

Run:
```bash
S="<tijdelijke map>"
B="C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden"
node "$S/pagina-instelling-proef.mjs" "$B/Technische tekening.pdf"
node "$S/pagina-instelling-proef.mjs" "$B/a2-staand.pdf"
node "$S/pagina-instelling-proef.mjs" "$B/Tekst.pdf"
```
Paginamaten van pagina 1 zoals getoond, gemeten met PyMuPDF (niet aangenomen):
Technische tekening 841×594 mm met /Rotate 90; a2-staand 420×594 mm; Tekst 210×297 mm.

Expected:
- Technische tekening → `"orientatie":"landscape"`, `"formaat":"printer"` (A1 bestaat niet in Windows; toetst ook de draaiingshelper via /Rotate 90);
- a2-staand → `"orientatie":"portrait"`, `"formaat":"a2"` (toetst de nieuwe A2-optie);
- Tekst → `"orientatie":"portrait"`, `"formaat":"a4"`.

- [ ] **Step 4: Uitvoer naar de virtuele PDF-printer**

Let op: printer "Open PDF Printer" schrijft naar een vaste map
(`C:\Users\rickd\AppData\Local\OpenPDFPrinter\spool`). Een draaiend dev-venster
van de gebruiker hernoemt `latest.pdf` daar naar `job_<tijd>.pdf` voor zijn
printwachtrij. Het script pakt daarom het eerste nieuwe bestand (`latest.pdf`
of `job_*.pdf`), meet het, en verwijdert het meteen.

Maak `$S/print-uitvoer-proef.mjs`:

```js
// Print het actieve document naar de virtuele PDF-printer en meet de oriëntatie
// van de uitvoer. Argumenten: <autoRotate: aan|uit> <orientatie: landscape|portrait>
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
const playwright = require('C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright');
const SPOOL = 'C:/Users/rickd/AppData/Local/OpenPDFPrinter/spool';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [autoRotate, orientatie] = process.argv.slice(2);

const bestaand = new Set(fs.readdirSync(SPOOL));
const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9345');
const page = browser.contexts()[0].pages()[0];

await page.keyboard.press('Control+p');
await page.waitForSelector('.print-printer-action-btn', { timeout: 15000 });
// Alleen de huidige pagina: alle pagina's van een A1-set op 300 dpi is onnodig zwaar.
await page.locator('.print-page-btn').nth(1).click();
// Printer kiezen.
await page.locator('select', { has: page.locator('option', { hasText: 'Open PDF Printer' }) })
  .first().selectOption({ label: 'Open PDF Printer' });
// Pagina-instelling: oriëntatie zetten en OK.
await page.locator('.print-printer-action-btn').nth(1).click();
await page.waitForSelector('input[name=page-setup-orient]', { timeout: 10000 });
await sleep(1500);
await page.locator(`input[name=page-setup-orient][value=${orientatie}]`).check();
await page.locator('.page-setup-footer-right .pref-btn-primary').click();
// Automatisch draaien: het vinkje staat direct voor het label met die tekst.
const vinkje = page.locator('label', { hasText: /Auto-Rotate|Automatisch draaien/ }).locator('input[type=checkbox]');
if ((await vinkje.isChecked()) !== (autoRotate === 'aan')) await vinkje.click();
await page.locator('.print-footer-right .pref-btn-primary').click();

let nieuw = null;
for (let i = 0; i < 90 && !nieuw; i++) {
  await sleep(1000);
  nieuw = fs.readdirSync(SPOOL).find((f) => f.endsWith('.pdf') && !bestaand.has(f)) || null;
}
if (!nieuw) { console.log('GEEN uitvoer binnen 90 s'); process.exit(1); }
await sleep(2000); // spooler klaar met schrijven
const pad = path.join(SPOOL, nieuw);
const maat = execFileSync('python', ['-c',
  'import fitz,sys; p=fitz.open(sys.argv[1])[0].rect; print(f"{p.width:.0f}x{p.height:.0f}")', pad]).toString().trim();
fs.unlinkSync(pad);
const [w, h] = maat.split('x').map(Number);
console.log(JSON.stringify({ autoRotate, orientatie, uitvoer: maat, liggend: w > h, opgeruimd: nieuw }));
process.exit(0);
```

Run (maak eerst `Technische tekening.pdf` het actieve document — liggend, 841×594 mm):
```bash
S="<tijdelijke map>"
node -e "fetch('http://127.0.0.1:9223/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'app_open_pdf',arguments:{path:'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden/Technische tekening.pdf'}}})}).then(r=>r.text()).then(t=>console.log(t.slice(0,120)))"
node "$S/print-uitvoer-proef.mjs" aan landscape
node "$S/print-uitvoer-proef.mjs" uit portrait
```
Expected: eerste regel `"liggend":true`; tweede regel `"liggend":false`. Beide `opgeruimd` gevuld.

Faalt het selecteren van het vinkje op tekst (andere taal in de rig), lees dan het label in de rig met `page.locator('.print-dialog label').allTextContents()` en pas de regex aan; niet de verwachting.

- [ ] **Step 5: Unit-tests, typecheck, build en Rust-tests nogmaals**

```bash
W="C:/Users/rickd/AppData/Local/Temp/opds-print"
cd "$W/open-pdf-studio" && npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)" && npx tsc --noEmit -p . 2>&1 | head -5; npx vite build 2>&1 | grep -iE "error|built in"
cd src-tauri && CARGO_TARGET_DIR=C:/opds-cargo-target-print cargo test --lib print_instelling 2>&1 | grep "test result"
```
Expected: `fail 0`, geen tsc-uitvoer, `✓ built in`, `test result: ok. 6 passed`.

- [ ] **Step 6: Rig stoppen en commitlijst voorleggen**

```bash
S="<tijdelijke map>"
W="C:/Users/rickd/AppData/Local/Temp/opds-print"
RIG_ISO="C:/Users/rickd/AppData/Local/Temp/opds-rig-print" bash "$S/rig.sh" stop
cd "$W" && git log --oneline origin/main..HEAD
```
Toon de lijst aan de gebruiker. Niet pushen of mergen zonder akkoord.
