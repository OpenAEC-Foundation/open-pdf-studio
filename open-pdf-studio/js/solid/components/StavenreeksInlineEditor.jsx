// Inline invoer van AANTAL en DIAMETER, direct op de stavenreeks.
//
// Wordt geopend door een dubbelklik op het object (tools/tool-dispatcher.js)
// en verschijnt bij het label. Twee velden: aantal (getal, 1–100) en diameter
// (keuzelijst met de standaard staafdiameters).
//
//   Enter of een klik buiten het venstertje  → bevestigen
//   Escape                                   → annuleren
//   Tab                                      → wisselen tussen de velden
//
// Positionering volgt hetzelfde patroon als TextEditOverlay: schermcoördinaten
// die uit de annotatiecoördinaten worden gerekend. Omdat zoom en pan geen
// SolidJS-signaal zijn, wordt de positie elke frame opnieuw opgevraagd bij de
// `locate`-functie die de vanilla-laag meegaf. Levert die null, dan bestaat de
// annotatie niet meer (verwijderd, ander document) en sluit de editor zichzelf.
import { Show, createEffect, onCleanup } from 'solid-js';
import {
  active, anchor, setAnchor, countValue, setCountValue,
  diameterValue, setDiameterValue, fontSizeValue, setFontSizeValue,
  onCommit, onCancel, locator, focusField, hideStavenreeksInput,
} from '../stores/stavenreeksInputStore.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { STAVENREEKS_DIAMETERS } from '../../annotations/stavenreeks.js';
import { createOutsideCommitController } from './parametric-label-outside-events.js';

export default function StavenreeksInlineEditor() {
  const { t } = useTranslation('properties');
  let rootRef;
  let countRef;
  let diameterRef;
  let fontSizeRef;

  const commit = () => {
    if (!active()) return;
    const fn = onCommit();
    hideStavenreeksInput();
    if (fn) fn(countValue(), diameterValue(), fontSizeValue());
  };

  const cancel = () => {
    if (!active()) return;
    const fn = onCancel();
    hideStavenreeksInput();
    if (fn) fn();
  };

  const handleKeyDown = (e) => {
    // Toetsen mogen niet doorlekken naar de canvas-sneltoetsen (Delete zou
    // anders de annotatie wissen terwijl je hem staat te bewerken).
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); return; }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    // Tab laten we met rust: de browser wisselt zelf tussen de twee velden,
    // en omdat het venstertje maar twee focusbare elementen heeft blijft de
    // focus binnen de invoer.
  };

  createEffect(() => {
    if (!active()) return;

    // Focus op het AANGEKLIKTE veld (inline getalbewerking geeft 'count',
    // 'diameter' of 'fontSize' door; dubbelklik houdt de oude default:
    // het aantal-veld), met de bestaande waarde geselecteerd.
    queueMicrotask(() => {
      const target = focusField() === 'diameter' ? diameterRef
        : (focusField() === 'fontSize' ? fontSizeRef : countRef);
      target?.focus();
      target?.select?.();
    });

    // Klik buiten het venstertje bevestigt — via dezelfde race-vrije
    // controller als de parametrische label-editor. Belangrijk sinds de
    // inline getalbewerking: het venstertje opent al op de POINTERDOWN van
    // een enkele klik, en de trailing mousedown/click van diezelfde klik
    // mag de editor niet meteen weer sluiten. De controller ziet die
    // trailing events niet als "buiten-klik" (de pointerdown viel vóór het
    // aankoppelen; de losse click zonder voorafgaande pending wordt
    // genegeerd).
    const outsideController = createOutsideCommitController({
      isActive: active,
      commit,
      isCanvasTarget: (target) =>
        target instanceof Element
        && !!target.closest('#annotation-canvas, .annotation-canvas'),
    });
    const onOutsidePointerDown = (ev) => outsideController.pointerDown(ev, rootRef);
    const onOutsideClick = (ev) => outsideController.click(ev, rootRef);
    // capture: de canvas-tools luisteren ook op pointerdown; wij zijn eerst.
    document.addEventListener('pointerdown', onOutsidePointerDown, true);
    window.addEventListener('click', onOutsideClick);

    // Meebewegen met zoom en pan.
    let raf = 0;
    const tick = () => {
      if (!active()) return;
      const locate = locator();
      if (typeof locate === 'function') {
        const pos = locate();
        if (!pos) { cancel(); return; }
        const cur = anchor();
        if (pos.left !== cur.left || pos.top !== cur.top) setAnchor(pos);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    onCleanup(() => {
      outsideController.reset();
      document.removeEventListener('pointerdown', onOutsidePointerDown, true);
      window.removeEventListener('click', onOutsideClick);
      if (raf) cancelAnimationFrame(raf);
    });
  });

  return (
    <Show when={active()}>
      <div
        ref={rootRef}
        class="stavenreeks-inline-editor"
        title={t('stavenreeks.inlineHint')}
        style={{
          position: 'fixed',
          left: `${anchor().left}px`,
          top: `${anchor().top}px`,
          'z-index': '1200',
        }}
        onKeyDown={handleKeyDown}
      >
        <label class="sr-inline-field">
          <span>{t('stavenreeks.count')}</span>
          <input
            ref={countRef}
            id="sr-inline-count"
            type="number"
            min="1"
            max="100"
            step="1"
            value={countValue()}
            onInput={(e) => setCountValue(e.target.value)}
          />
        </label>
        <label class="sr-inline-field">
          <span>{t('stavenreeks.diameter')}</span>
          <select
            ref={diameterRef}
            id="sr-inline-diameter"
            value={diameterValue()}
            onInput={(e) => setDiameterValue(e.target.value)}
          >
            {STAVENREEKS_DIAMETERS.map((d) => (
              <option value={String(d)}>{`⌀ ${d}`}</option>
            ))}
          </select>
        </label>
        <label class="sr-inline-field">
          <span>{t('stavenreeks.fontSize')}</span>
          <input
            ref={fontSizeRef}
            id="sr-inline-fontsize"
            type="number"
            min="6"
            max="72"
            step="1"
            value={fontSizeValue()}
            onInput={(e) => setFontSizeValue(e.target.value)}
          />
        </label>
      </div>
    </Show>
  );
}
