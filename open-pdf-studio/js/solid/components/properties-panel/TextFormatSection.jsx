import { Show, For, createMemo } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, cycleSelectNext, panelMode, pdfTekstBronFont } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import ColorPalettePicker from './ColorPalettePicker.jsx';
import PrefComboBox from '../preferences/PrefComboBox.jsx';
import { systemFontList } from '../../stores/fontStore.js';
import { ensureFontInStore } from '../../../utils/fonts.js';
import { lettertypeMelding } from '../../../text/lettertype-inbedding.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

const FONT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

export default function TextFormatSection() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const isLocked = () => annotProps.locked === true || annotProps.locked === 'mixed';

  const fonts = createMemo(() => {
    const currentFont = annotProps.fontFamily;
    // 'mixed' (meervoudige selectie) is geen lettertype: niet in de lijst.
    if (currentFont && currentFont !== 'mixed') {
      ensureFontInStore(currentFont);
    }
    return systemFontList();
  });

  // Het lettertype wordt niet ingebed (#765): zeg welke standaardletter een
  // lezer zonder dat lettertype toont, of (PDF-tekst bewerken) waarin de
  // tekst geschreven wordt.
  // Bij PDF-tekst in het eigen lettertype van het bestand blijft dat font.
  const melding = createMemo(() => {
    const pdfTekst = annotProps.id === '_pdfTextEdit';
    if (pdfTekst && annotProps.fontFamily === pdfTekstBronFont()) return null;
    return lettertypeMelding(annotProps.fontFamily, pdfTekst ? 'paginatekst' : 'tekstvak');
  });

  return (
    <Show when={sectionVis.textFormat}>
      <CollapsibleSection title={t('textFormat.title')} name="textFormat" id="prop-text-format-section">
        <ColorPalettePicker
          label={t('textFormat.textColor')}
          color={() => annotProps.textColor}
          showNone={false}
          disabled={isLocked()}
          onColorChange={(color) => updateAnnotProp('textColor', color)}
        />

        <div class="property-group">
          <label>{t('textFormat.font')}</label>
          <select value={annotProps.fontFamily} disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('fontFamily', e.target.value)}>
            <Show when={annotProps.fontFamily === 'mixed'}>
              <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
            </Show>
            <For each={fonts()}>
              {(font) => <option value={font} selected={font === annotProps.fontFamily} style={{ 'font-family': `'${font}', sans-serif` }}>{font}</option>}
            </For>
          </select>
        </div>
        <Show when={melding()}>
          <div class="font-inbedding-melding" role="note">
            {t(melding().sleutel, { font: melding().font, fallback: melding().fallback })}
          </div>
        </Show>

        <div class="property-group">
          <label>{t('textFormat.fontSize')}</label>
          <PrefComboBox
            value={() => annotProps.textFontSize}
            setValue={(val) => updateAnnotProp('textFontSize', val)}
            options={FONT_SIZE_OPTIONS}
            min={1} max={999} fallback={14} suffix="pt"
            disabled={isLocked}
          />
        </div>

        <div class="property-group">
          <label>{t('textFormat.style')}</label>
          <div class="text-style-buttons">
            <button type="button" class={`text-style-btn${annotProps.fontBold === true ? ' active' : ''}`}
              title={t('textFormat.bold')} disabled={isLocked()}
              onClick={() => updateAnnotProp('fontBold', annotProps.fontBold === 'mixed' ? true : !annotProps.fontBold)}>
              <strong>B</strong>
            </button>
            <button type="button" class={`text-style-btn${annotProps.fontItalic === true ? ' active' : ''}`}
              title={t('textFormat.italic')} disabled={isLocked()}
              onClick={() => updateAnnotProp('fontItalic', annotProps.fontItalic === 'mixed' ? true : !annotProps.fontItalic)}>
              <em>I</em>
            </button>
            <button type="button" class={`text-style-btn${annotProps.fontUnderline === true ? ' active' : ''}`}
              title={t('textFormat.underline')} disabled={isLocked()}
              onClick={() => updateAnnotProp('fontUnderline', annotProps.fontUnderline === 'mixed' ? true : !annotProps.fontUnderline)}>
              <u>U</u>
            </button>
            <button type="button" class={`text-style-btn${annotProps.fontStrikethrough === true ? ' active' : ''}`}
              title={t('textFormat.strikethrough')} disabled={isLocked()}
              onClick={() => updateAnnotProp('fontStrikethrough', annotProps.fontStrikethrough === 'mixed' ? true : !annotProps.fontStrikethrough)}>
              <s>S</s>
            </button>
          </div>
        </div>

        {/* PDF text-edit mode: allow deleting the text edit that is open in the
            inline editor (inserted or existing PDF text). */}
        <Show when={panelMode() === 'textEdit'}>
          <div class="property-group">
            <button type="button" class="text-edit-delete-btn"
              onClick={() => import('../../../tools/text-edit-tool.js')
                .then(m => m.deleteActiveTextEdit && m.deleteActiveTextEdit())
                .catch(() => {})}>
              {tCommon('delete')}
            </button>
          </div>
        </Show>
      </CollapsibleSection>
    </Show>
  );
}
