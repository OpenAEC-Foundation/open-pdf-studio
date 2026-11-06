import { createSignal, For, Show, onCleanup } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { pdfaLabel, bevindingTekst, wijzigingTekst } from '../../../pdf/pdfa/meldingen.js';

// PDF/A valideren en opslaan als PDF/A (#379). De validatie kijkt naar het
// bestand zoals het opgeslagen is; "Opslaan als PDF/A" neemt ook de
// onopgeslagen wijzigingen mee en schrijft een nieuw bestand.
export default function PdfADialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const doc = getActiveDocument();
  const geclaimd = doc?.pdfaCompliance || null;
  const startDeel = [1, 2, 3].includes(Number(geclaimd?.part)) ? Number(geclaimd.part) : 2;
  const [deel, setDeel] = createSignal(startDeel);
  const [bezig, setBezig] = createSignal('');
  const [rapport, setRapport] = createSignal(null);
  const [conversie, setConversie] = createSignal(null);
  const [fout, setFout] = createSignal('');
  const [melding, setMelding] = createSignal('');
  let controller = null;
  let rapportDoc = null;
  onCleanup(() => controller?.abort());

  const close = () => closeDialog('pdfa');
  const label = () => pdfaLabel(deel());

  const valideer = async () => {
    const d = getActiveDocument();
    if (!d?.pdfDoc) return;
    controller?.abort();
    controller = new AbortController();
    setFout(''); setMelding(''); setConversie(null); setRapport(null);
    setBezig(t('pdfa.busy'));
    try {
      const { valideerDocument } = await import('../../../pdf/pdfa/pdfa-service.js');
      const r = await valideerDocument(d, deel(), { signal: controller.signal });
      rapportDoc = { doc: d, pdf: d.pdfDoc };
      setRapport(r);
    } catch (e) {
      if (e?.message !== 'CANCELLED') setFout(t('pdfa.error', { error: e?.message || String(e) }));
    } finally {
      setBezig('');
    }
  };

  const slaOp = async () => {
    const d = getActiveDocument();
    if (!d?.pdfDoc) return;
    controller?.abort();
    controller = new AbortController();
    setFout(''); setMelding(''); setRapport(null); setConversie(null);
    setBezig(t('pdfa.converting', { label: label() }));
    try {
      const { slaOpAlsPdfA } = await import('../../../pdf/pdfa/pdfa-service.js');
      const r = await slaOpAlsPdfA(d, deel(), { signal: controller.signal });
      if (!r) return;
      rapportDoc = { doc: d, pdf: d.pdfDoc };
      setConversie(r.resultaat);
      if (r.resultaat.ok) setMelding(r.pad ? t('pdfa.converted', { label: label(), path: r.pad }) : t('pdfa.convertedDownload', { label: label() }));
    } catch (e) {
      if (e?.message === 'PDFA_ENCRYPTED') setFout(t('pdfa.encrypted'));
      else if (e?.message !== 'CANCELLED') setFout(t('pdfa.error', { error: e?.message || String(e) }));
    } finally {
      setBezig('');
    }
  };

  const naarPagina = async (pagina) => {
    const d = getActiveDocument();
    if (!rapportDoc || d !== rapportDoc.doc || d.pdfDoc !== rapportDoc.pdf) { setFout(t('pdfa.stale')); return; }
    const { goToPage } = await import('../../../pdf/renderer.js');
    await goToPage(pagina);
  };

  const bevindingen = () => rapport()?.bevindingen || conversie()?.onopgelost || [];

  const footer = (
    <>
      <div></div>
      <div class="crop-margins-footer-right">
        <button class="pref-btn pref-btn-secondary" disabled={!!bezig() || !doc} onClick={valideer}>{t('pdfa.validate')}</button>
        <button class="pref-btn pref-btn-primary" disabled={!!bezig() || !doc} onClick={slaOp}>{t('pdfa.saveAs')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('close')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('pdfa.title')}
      overlayClass="crop-margins-overlay"
      dialogClass="crop-margins-dialog pdfa-dialog"
      headerClass="crop-margins-header"
      bodyClass="crop-margins-content"
      footerClass="crop-margins-footer"
      onClose={close}
      footer={footer}
    >
      <div class="crop-margins-form">
        <div class="crop-margins-row">
          <label class="crop-margins-label pdfa-label">{t('pdfa.part')}</label>
          <select class="crop-margins-select" value={deel()} disabled={!!bezig()}
            onChange={(e) => { setDeel(Number(e.currentTarget.value)); setRapport(null); setConversie(null); }}>
            <option value="1">{t('pdfa.part1')}</option>
            <option value="2">{t('pdfa.part2')}</option>
            <option value="3">{t('pdfa.part3')}</option>
          </select>
        </div>
        <div class="crop-margins-info">
          {geclaimd ? t('pdfa.claims', { label: pdfaLabel(geclaimd.part, geclaimd.conformance || 'b') }) : t('pdfa.claimsNone')}
        </div>
        <Show when={doc?.modified}>
          <div class="crop-margins-info">{t('pdfa.unsavedNote')}</div>
        </Show>
        <Show when={bezig()}><div class="crop-margins-info" role="status">{bezig()}</div></Show>
        <Show when={melding()}><div class="pdfa-ok" role="status">{melding()}</div></Show>
        <Show when={fout()}><div class="pdfa-fout" role="alert">{fout()}</div></Show>

        <Show when={rapport()}>
          {(r) => (
            <div class={r().conform ? 'pdfa-ok' : 'pdfa-fout'}>
              {r().conform
                ? t('pdfa.noFindings', { label: label(), count: r().gecontroleerd.length })
                : t('pdfa.findings', { label: label(), count: r().bevindingen.length })}
            </div>
          )}
        </Show>
        <Show when={conversie() && !conversie().ok}>
          <div class="pdfa-fout">{t('pdfa.unresolved', { label: label() })}</div>
        </Show>

        <Show when={bevindingen().length}>
          <div class="pdfa-tabel-kader">
            <table class="pdfa-tabel">
              <thead>
                <tr>
                  <th>{t('pdfa.colClause')}</th>
                  <th>{t('pdfa.colPage')}</th>
                  <th>{t('pdfa.colFinding')}</th>
                  <th>{t('pdfa.colObject')}</th>
                </tr>
              </thead>
              <tbody>
                <For each={bevindingen()}>
                  {(b) => (
                    <tr>
                      <td>{b.clausule}</td>
                      <td>
                        <Show when={b.pagina} fallback="">
                          <button class="pdfa-pagina" onClick={() => naarPagina(b.pagina)}>{b.pagina}</button>
                        </Show>
                      </td>
                      <td>{bevindingTekst(t, b)}</td>
                      <td class="pdfa-object">{b.object}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>

        <Show when={conversie()?.wijzigingen?.length}>
          <div class="crop-margins-label pdfa-kop">{t('pdfa.changes')}</div>
          <ul class="pdfa-wijzigingen">
            <For each={conversie().wijzigingen}>
              {(w) => <li>{w.pagina ? `${t('pdfa.pageShort', { page: w.pagina })}: ` : ''}{wijzigingTekst(t, w)}</li>}
            </For>
          </ul>
        </Show>

        <div class="crop-margins-info">{t('pdfa.builtin')}</div>
      </div>
    </Dialog>
  );
}
