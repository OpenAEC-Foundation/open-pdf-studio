import { createSignal, createEffect, onMount, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument, getPageRotation } from '../../../core/state.js';
import {
  PAPIERFORMATEN, formaatTekst, startPaginaInstelling, bewaarPaginaInstelling,
} from '../../../pdf/print-pagina-instelling.js';
import { viewportOpties } from '../../../pdf/getoonde-pagina.js';

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

// Telt op bij elke wijziging (OK hier, of stelPaginaInstellingIn), zodat een
// open printdialoog zijn papierkop bijwerkt. pageSetupSettings zelf is geen
// signaal; lees dit in een memo/effect en daarna getPageSetupSettings().
const [versie, setVersie] = createSignal(0);
export const paginaInstellingVersie = versie;

/**
 * Formaat en oriëntatie van buitenaf zetten (na OK in de eigenschappen van de
 * printer, zie instellingNaEigenschappen in print-papier.js). Marges en
 * papierbron blijven staan. null/undefined → niets.
 */
export function stelPaginaInstellingIn(instelling) {
  if (!instelling) return;
  pageSetupSettings.docId = instelling.docId ?? null;
  pageSetupSettings.handmatig = Boolean(instelling.handmatig);
  if (typeof instelling.size === 'string') pageSetupSettings.size = instelling.size;
  if (instelling.orientation === 'portrait' || instelling.orientation === 'landscape') {
    pageSetupSettings.orientation = instelling.orientation;
  }
  setVersie((v) => v + 1);
}

// Maat van de huidige pagina zoals getoond (inclusief draaiing), in pt.
async function huidigePaginaMaat(doc) {
  if (!doc?.pdfDoc) return { breedtePt: NaN, hoogtePt: NaN };
  try {
    const pageNum = doc.currentPage || 1;
    const page = await doc.pdfDoc.getPage(pageNum);
    const extra = getPageRotation(pageNum);
    const vp = page.getViewport(viewportOpties(page, extra));
    return { breedtePt: vp.width, hoogtePt: vp.height };
  } catch {
    return { breedtePt: NaN, hoogtePt: NaN };
  }
}

export default function PageSetupDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const [size, setSize] = createSignal(pageSetupSettings.size);
  const [source, setSource] = createSignal(pageSetupSettings.source);
  const [orientation, setOrientation] = createSignal(pageSetupSettings.orientation);
  const [marginLeft, setMarginLeft] = createSignal(pageSetupSettings.marginLeft);
  const [marginRight, setMarginRight] = createSignal(pageSetupSettings.marginRight);
  const [marginTop, setMarginTop] = createSignal(pageSetupSettings.marginTop);
  const [marginBottom, setMarginBottom] = createSignal(pageSetupSettings.marginBottom);

  let canvasRef;

  function updatePreview() {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext('2d');
    const sizeKey = size();
    const orient = orientation();
    const sizeData = PAPIERFORMATEN[sizeKey] || PAPIERFORMATEN.a4;

    let paperW = sizeData.breedte;
    let paperH = sizeData.hoogte;
    if (orient === 'landscape') [paperW, paperH] = [paperH, paperW];

    const mL = parseInt(marginLeft()) || 0;
    const mR = parseInt(marginRight()) || 0;
    const mT = parseInt(marginTop()) || 0;
    const mB = parseInt(marginBottom()) || 0;

    const maxW = 160, maxH = 200;
    const scale = Math.min(maxW / paperW, maxH / paperH) * 0.85;
    const drawW = paperW * scale;
    const drawH = paperH * scale;

    canvasRef.width = maxW;
    canvasRef.height = maxH;
    ctx.clearRect(0, 0, maxW, maxH);

    const offsetX = (maxW - drawW) / 2;
    const offsetY = (maxH - drawH) / 2;

    ctx.fillStyle = '#888';
    ctx.fillRect(offsetX + 2, offsetY + 2, drawW, drawH);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(offsetX, offsetY, drawW, drawH);
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.strokeRect(offsetX, offsetY, drawW, drawH);

    const cL = mL * scale, cR = mR * scale, cT = mT * scale, cB = mB * scale;
    const contentX = offsetX + cL;
    const contentY = offsetY + cT;
    const contentW = drawW - cL - cR;
    const contentH = drawH - cT - cB;

    if (contentW > 5 && contentH > 5) {
      ctx.fillStyle = '#ccc';
      const lineH = 4, lineGap = 3;
      let y = contentY + 2;
      while (y + lineH < contentY + contentH - 2) {
        const lineW = contentW * (0.6 + Math.random() * 0.35);
        ctx.fillRect(contentX + 2, y, Math.min(lineW, contentW - 4), lineH);
        y += lineH + lineGap;
      }

      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#bbb';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(contentX, contentY, contentW, contentH);
      ctx.setLineDash([]);
    }
  }

  // Waarmee de dialoog begon; bepaalt bij OK of de keuze handmatig was.
  let start = {
    size: pageSetupSettings.size,
    orientation: pageSetupSettings.orientation,
    handmatig: pageSetupSettings.handmatig,
  };
  const doc = getActiveDocument();
  const docId = doc?.id ?? null;

  // De startwaarden worden asynchroon uit de paginamaat afgeleid. Kiest de
  // gebruiker intussen al formaat of oriëntatie (aangeraakt), dan blijft die
  // keuze staan; OK wacht op de afleiding zodat 'handmatig' tegen de juiste
  // start wordt beoordeeld.
  let aangeraakt = false;
  let afleiding = Promise.resolve();

  onMount(() => {
    updatePreview();
    afleiding = (async () => {
      const { breedtePt, hoogtePt } = await huidigePaginaMaat(doc);
      start = startPaginaInstelling({ bewaard: pageSetupSettings, docId, breedtePt, hoogtePt });
      if (!aangeraakt) {
        setSize(start.size);
        setOrientation(start.orientation);
      }
    })();
  });

  createEffect(() => {
    size();
    source();
    orientation();
    marginLeft();
    marginRight();
    marginTop();
    marginBottom();
    updatePreview();
  });

  const close = () => closeDialog('page-setup');

  const applyPageSetup = async () => {
    try {
      await afleiding;
    } catch {
      // Afleiding mislukt: OK werkt zoals voorheen met de bewaarde start.
    }
    const bewaard = bewaarPaginaInstelling({
      start, gekozen: { size: size(), orientation: orientation() }, docId,
    });
    pageSetupSettings.docId = bewaard.docId;
    pageSetupSettings.handmatig = bewaard.handmatig;
    pageSetupSettings.size = bewaard.size;
    pageSetupSettings.source = source();
    pageSetupSettings.orientation = bewaard.orientation;
    pageSetupSettings.marginLeft = parseInt(marginLeft()) || 0;
    pageSetupSettings.marginRight = parseInt(marginRight()) || 0;
    pageSetupSettings.marginTop = parseInt(marginTop()) || 0;
    pageSetupSettings.marginBottom = parseInt(marginBottom()) || 0;
    setVersie((v) => v + 1);
    close();
  };

  const footer = (
    <div>
      <div></div>
      <div class="page-setup-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={applyPageSetup}>{tCommon('ok')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </div>
  );

  return (
    <Dialog
      title={t('pageSetup.title')}
      overlayClass="page-setup-overlay"
      dialogClass="page-setup-dialog"
      headerClass="page-setup-header"
      bodyClass="page-setup-content"
      footerClass="page-setup-footer"
      onClose={close}
      footer={footer}
    >
      <div class="page-setup-preview-box">
        <canvas ref={canvasRef} width="160" height="200"></canvas>
      </div>
      <fieldset class="page-setup-group">
        <legend>{t('pageSetup.paper')}</legend>
        <div class="page-setup-row">
          <label class="page-setup-label">{t('pageSetup.size')}</label>
          <select
            class="page-setup-select"
            value={size()}
            onChange={(e) => { aangeraakt = true; setSize(e.target.value); }}
          >
            <option value="printer">{t('pageSetup.printerDefault')}</option>
            {/* Eén bron: dezelfde lijst waaruit het formaat wordt afgeleid. */}
            <For each={Object.keys(PAPIERFORMATEN)}>
              {(sleutel) => <option value={sleutel}>{formaatTekst(sleutel)}</option>}
            </For>
          </select>
        </div>
        <div class="page-setup-row">
          <label class="page-setup-label">{t('pageSetup.source')}</label>
          <select
            class="page-setup-select"
            value={source()}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="auto">{t('pageSetup.autoSelect')}</option>
            <option value="tray1">{t('pageSetup.tray1')}</option>
            <option value="tray2">{t('pageSetup.tray2')}</option>
            <option value="manual">{t('pageSetup.manualFeed')}</option>
          </select>
        </div>
      </fieldset>
      <div class="page-setup-bottom">
        <fieldset class="page-setup-group page-setup-orientation-group">
          <legend>{t('pageSetup.orientation')}</legend>
          <label class="page-setup-radio-label">
            <input
              type="radio"
              name="page-setup-orient"
              value="portrait"
              checked={orientation() === 'portrait'}
              onChange={() => { aangeraakt = true; setOrientation('portrait'); }}
            /> {tCommon('portrait')}
          </label>
          <label class="page-setup-radio-label">
            <input
              type="radio"
              name="page-setup-orient"
              value="landscape"
              checked={orientation() === 'landscape'}
              onChange={() => { aangeraakt = true; setOrientation('landscape'); }}
            /> {tCommon('landscape')}
          </label>
        </fieldset>
        <fieldset class="page-setup-group page-setup-margins-group">
          <legend>{t('pageSetup.margins')}</legend>
          <div class="page-setup-margins-grid">
            <label class="page-setup-margin-label">{t('pageSetup.left')}</label>
            <input
              type="number"
              class="page-setup-margin-input"
              value={marginLeft()}
              min="0"
              max="200"
              onInput={(e) => setMarginLeft(e.target.value)}
            />
            <label class="page-setup-margin-label">{t('pageSetup.right')}</label>
            <input
              type="number"
              class="page-setup-margin-input"
              value={marginRight()}
              min="0"
              max="200"
              onInput={(e) => setMarginRight(e.target.value)}
            />
            <label class="page-setup-margin-label">{t('pageSetup.top')}</label>
            <input
              type="number"
              class="page-setup-margin-input"
              value={marginTop()}
              min="0"
              max="200"
              onInput={(e) => setMarginTop(e.target.value)}
            />
            <label class="page-setup-margin-label">{t('pageSetup.bottom')}</label>
            <input
              type="number"
              class="page-setup-margin-input"
              value={marginBottom()}
              min="0"
              max="200"
              onInput={(e) => setMarginBottom(e.target.value)}
            />
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}
