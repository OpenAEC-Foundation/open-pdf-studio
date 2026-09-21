// Onderdelen van het tabblad Weergave in het importvenster voor DWG en DXF
// (#400): de extra velden bij de kleurstand, de kleurentabel, de lettertabel,
// de externe bestanden met hun zoekpaden en het blok "Geavanceerd".
//
// De rekenregels (wat een geldige kleur, dikte, letterregel of zoekpad is)
// staan in cad-import-logica.js en zijn daar getest; hier staat alleen wat de
// gebruiker ziet. `inst` en `setInst` zijn de instellingen van het venster.

import { createMemo, For, Index, Show } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  MAX_LETTERS, MAX_MEGAPIXELS, MAX_PENDIKTE_MM, MAX_PENNEN, MAX_ZOEKPADEN, drempelProcent, kleurTekst,
  lettersVoorTekening, metLetterRegel, metNieuwePen, metPenKleur, pendikte, pennenUitLagen, schoonZoekpaden,
} from '../../../pdf/cad-import-logica.js';

const kleinste = (grens, eigen) => (Number.isFinite(Number(grens)) && Number(grens) >= 0 ? Math.min(Number(grens), eigen) : eigen);

/**
 * Een kleur kiezen zoals in de andere vensters (het kleurvak van het systeem),
 * met de code ernaast om ze ook te kunnen typen. `opKies` krijgt `#RRGGBB` en
 * antwoordt `false` als de kleur niet mag; het veld springt dan terug.
 */
function KleurVeld(props) {
  const terug = (el) => { el.value = props.waarde; };
  const kies = (el) => {
    const kleur = kleurTekst(el.value);
    if (!kleur || props.opKies(kleur) === false) terug(el);
  };
  return (
    <>
      <input type="color" class="cad-color" aria-label={props.label} title={props.label} disabled={props.uit}
        value={props.waarde.toLowerCase()} onChange={(e) => kies(e.target)} />
      <input type="text" class="cad-input cad-input-short cad-input-code" aria-label={props.label} maxLength={7}
        spellcheck={false} disabled={props.uit} value={props.waarde} onChange={(e) => kies(e.target)} />
    </>
  );
}

/** De velden die bij de kleurstand horen: de drempel of de eigen kleur. */
export function CadKleurstand(props) {
  const { t } = useTranslation('dialogs');
  const inst = props.inst;
  return (
    <>
      <Show when={inst.colors === 'mono'}>
        <div class="cad-row">
          <label class="cad-label" for="cad-import-mono-threshold">{t('cadImport.monoThreshold')}</label>
          <input id="cad-import-mono-threshold" type="number" class="cad-input cad-input-short" min="0" max="100" step="5"
            value={inst.monoThreshold}
            onChange={(e) => { props.setInst('monoThreshold', drempelProcent(e.target.value)); e.target.value = inst.monoThreshold; }} />
          <span class="cad-note">%</span>
        </div>
        <div class="cad-note cad-note-indent">{t('cadImport.monoHint')}</div>
      </Show>
      <Show when={inst.colors === 'single'}>
        <div class="cad-row">
          <label class="cad-label">{t('cadImport.singleColour')}</label>
          <KleurVeld label={t('cadImport.singleColour')} waarde={kleurTekst(inst.singleColor) || '#000000'}
            opKies={(kleur) => props.setInst('singleColor', kleur)} />
        </div>
      </Show>
    </>
  );
}

/**
 * Kleurentabel: kleur uit de tekening naar lijndikte in mm. `lagen` zijn de
 * lagen uit de verkenning (hun kleuren zijn de kleuren die in de tekening
 * voorkomen), `maxPennen` de grens van de omzetter.
 */
export function CadKleurentabel(props) {
  const { t } = useTranslation('dialogs');
  const inst = props.inst;
  const hoogste = () => kleinste(props.maxPennen, MAX_PENNEN);
  const vol = () => inst.pens.length >= hoogste();
  const laagKleuren = createMemo(() => (props.lagen() || []).map((l) => l.color));
  // Is er nog een laagkleur zonder regel?
  const ietsUitTekening = createMemo(() => pennenUitLagen(inst.pens, props.lagen(), hoogste()).length > inst.pens.length);
  const zetDikte = (index, el) => {
    const mm = pendikte(el.value);
    if (mm === null) el.value = inst.pens[index]?.lineweightMm ?? '';
    else props.setInst('pens', index, 'lineweightMm', mm);
  };
  const zetKleur = (index, kleur) => {
    // Alleen de ene regel wijzigen: de rij (en de focus erin) blijft staan.
    if (!metPenKleur(inst.pens, index, kleur)) return false;
    props.setInst('pens', index, 'color', kleur);
    return true;
  };
  return (
    <div class="cad-row cad-row-top">
      <label class="cad-label">{t('cadImport.penTable')}</label>
      <div class="cad-subtable">
        <Show when={inst.pens.length}>
          <div class="cad-sublist" role="list">
            <For each={inst.pens}>
              {(pen, index) => (
                <div class="cad-subrow" role="listitem">
                  <KleurVeld label={`${t('cadImport.penColour')} ${index() + 1}`} waarde={pen.color} opKies={(kleur) => zetKleur(index(), kleur)} />
                  <input type="number" class="cad-input cad-input-short" step="0.05" min="0" max={MAX_PENDIKTE_MM}
                    aria-label={`${t('cadImport.penWidth')} ${index() + 1}`} title={t('cadImport.penWidth')} value={pen.lineweightMm}
                    onChange={(e) => zetDikte(index(), e.target)} />
                  <span class="cad-note">mm</span>
                  <button type="button" class="pref-btn cad-small-btn" aria-label={`${t('cadImport.remove')}: ${pen.color}`}
                    onClick={() => props.setInst('pens', inst.pens.filter((_, i) => i !== index()))}>
                    {t('cadImport.remove')}
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
        <div class="cad-subrow">
          <button type="button" class="pref-btn cad-small-btn" disabled={vol()}
            onClick={() => props.setInst('pens', metNieuwePen(inst.pens, laagKleuren(), hoogste()))}>
            {t('cadImport.penAdd')}
          </button>
          <button type="button" class="pref-btn cad-small-btn" disabled={vol() || !ietsUitTekening()}
            onClick={() => props.setInst('pens', pennenUitLagen(inst.pens, props.lagen(), hoogste()))}>
            {t('cadImport.penFromDrawing')}
          </button>
        </div>
        <div class="cad-note">{t('cadImport.penTableHint')}</div>
      </div>
    </div>
  );
}

/**
 * Lettertabel: elke letter uit de tekening met de letter die ze in de PDF
 * wordt. Zonder keuze staat er wat de omzetter uit de naam raadt; een keuze
 * die daarvan afwijkt wordt onthouden, ook voor een volgende tekening.
 */
export function CadLettertabel(props) {
  const { t } = useTranslation('dialogs');
  const inst = props.inst;
  const hoogste = () => kleinste(props.maxLetters, MAX_LETTERS);
  const regels = createMemo(() => lettersVoorTekening(props.scan(), inst.fonts));
  const zet = (regel, veld, waarde) =>
    props.setInst('fonts', metLetterRegel(inst.fonts, { ...regel, [veld]: waarde }, hoogste()));
  return (
    <Show when={regels().length}>
      <div class="cad-row cad-row-top">
        <label class="cad-label" title={t('cadImport.fonts', { fonts: regels().map((r) => r.from).join(', ') })}>
          {t('cadImport.fontTable')}
        </label>
        <div class="cad-subtable">
          <div class="cad-subrow cad-subhead" aria-hidden="true">
            <span class="cad-col-font">{t('cadImport.fontFrom')}</span>
            <span>{t('cadImport.fontTo')}</span>
          </div>
          <div class="cad-sublist" role="list">
            <Index each={regels()}>
              {(regel) => (
                <div class="cad-subrow" role="listitem">
                  <span class="cad-col-font" title={regel().from}>{regel().from}</span>
                  <select class="cad-select cad-select-short" disabled={!inst.text}
                    aria-label={`${regel().from}: ${t('cadImport.fontTo')}`}
                    title={t(regel().family === 'mono' ? 'cadImport.fontMono' : 'cadImport.fontSans')}
                    value={regel().family} onChange={(e) => zet(regel(), 'family', e.target.value)}>
                    <option value="sans">{t('cadImport.fontSans')}</option>
                    <option value="mono">{t('cadImport.fontMono')}</option>
                  </select>
                  <label class="cad-check">
                    <input type="checkbox" checked={regel().bold} disabled={!inst.text}
                      aria-label={`${regel().from}: ${t('cadImport.fontBold')}`}
                      onChange={(e) => zet(regel(), 'bold', e.target.checked)} />
                    {t('cadImport.fontBold')}
                  </label>
                  <label class="cad-check">
                    <input type="checkbox" checked={regel().italic} disabled={!inst.text}
                      aria-label={`${regel().from}: ${t('cadImport.fontItalic')}`}
                      onChange={(e) => zet(regel(), 'italic', e.target.checked)} />
                    {t('cadImport.fontItalic')}
                  </label>
                </div>
              )}
            </Index>
          </div>
        </div>
      </div>
    </Show>
  );
}

/**
 * Wat er van buiten de tekening gelezen wordt: externe verwijzingen en
 * afbeeldingen aan of uit, de mappen waarin gezocht wordt, en bij naam wat er
 * gevonden is. `kiesMap` opent het mapvenster van het systeem; `padOk(i)` zegt
 * of zoekpad `i` (nog) bestaat; `buiten` zijn de regels van `buitenBestanden`.
 */
export function CadBuitenBestanden(props) {
  const { t } = useTranslation('dialogs');
  const inst = props.inst;
  const hoogste = () => kleinste(props.maxZoekpaden, MAX_ZOEKPADEN);
  const voegToe = async () => {
    const map = await props.kiesMap();
    if (map) props.setInst('searchPaths', schoonZoekpaden([...inst.searchPaths, map], hoogste()));
  };
  return (
    <>
      <label class="cad-check">
        <input type="checkbox" checked={inst.xrefs} onChange={(e) => props.setInst('xrefs', e.target.checked)} /> {t('cadImport.xrefs')}
      </label>
      <label class="cad-check">
        <input type="checkbox" checked={inst.images} onChange={(e) => props.setInst('images', e.target.checked)} /> {t('cadImport.images')}
      </label>
      <div class="cad-row cad-row-top" classList={{ 'cad-disabled': !inst.xrefs && !inst.images }}>
        <label class="cad-label">{t('cadImport.searchPaths')}</label>
        <div class="cad-subtable">
          <Show when={inst.searchPaths.length}>
            <div class="cad-sublist" role="list">
              <For each={inst.searchPaths}>
                {(pad, index) => (
                  <div class="cad-subrow" role="listitem">
                    <span class="cad-path" classList={{ 'cad-note-warn': !props.padOk(index()) }} title={pad}><bdi>{pad}</bdi></span>
                    <Show when={!props.padOk(index())}>
                      <span class="cad-note cad-note-warn" role="status">{t('cadImport.searchPathMissing')}</span>
                    </Show>
                    <button type="button" class="pref-btn cad-small-btn" disabled={props.bezig()} aria-label={`${t('cadImport.remove')}: ${pad}`}
                      onClick={() => props.setInst('searchPaths', inst.searchPaths.filter((_, i) => i !== index()))}>
                      {t('cadImport.remove')}
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <div class="cad-subrow">
            <button type="button" class="pref-btn cad-small-btn" disabled={props.bezig() || inst.searchPaths.length >= hoogste()} onClick={voegToe}>
              {t('cadImport.searchPathAdd')}
            </button>
          </div>
          <div class="cad-note">{t('cadImport.xrefsHint')}</div>
        </div>
      </div>
      <Show when={props.buiten().length}>
        <div class="cad-note cad-externals cad-note-indent">
          <For each={props.buiten()}>
            {(regel) => {
              const tekst = () => t(`cadImport.${regel.sleutel}`, { files: regel.namen });
              return <div class="cad-externals-row" title={tekst()}>{tekst()}</div>;
            }}
          </For>
        </div>
      </Show>
    </>
  );
}

/** Instellingen die zelden nodig zijn, ingeklapt onder "Geavanceerd". */
export function CadGeavanceerd(props) {
  const { t } = useTranslation('dialogs');
  const inst = props.inst;
  const hoogsteMp = () => {
    const plafond = Number(props.maxBeeldpunten);
    return Number.isFinite(plafond) && plafond >= 1e6 ? Math.min(MAX_MEGAPIXELS, Math.floor(plafond / 1e6)) : MAX_MEGAPIXELS;
  };
  const zetMegapixels = (el) => {
    const mp = Math.round(Number(el.value));
    if (Number.isFinite(mp) && mp >= 1) props.setInst('maxImageMegapixels', Math.min(hoogsteMp(), mp));
    el.value = inst.maxImageMegapixels;
  };
  return (
    <details class="cad-details">
      <summary class="cad-summary-line">{t('cadImport.advanced')}</summary>
      <div class="cad-details-body">
        <label class="cad-check">
          <input type="checkbox" checked={inst.reuseBlocks} onChange={(e) => props.setInst('reuseBlocks', e.target.checked)} /> {t('cadImport.reuseBlocks')}
        </label>
        <div class="cad-row">
          <label class="cad-label cad-label-wide" for="cad-import-max-image">{t('cadImport.maxImagePixels')}</label>
          <input id="cad-import-max-image" type="number" class="cad-input cad-input-short" min="1" max={hoogsteMp()} step="1"
            disabled={!inst.images} value={Math.min(inst.maxImageMegapixels, hoogsteMp())} onChange={(e) => zetMegapixels(e.target)} />
        </div>
      </div>
    </details>
  );
}
