import { createSignal, Show, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { controleerWachtwoorden, STANDAARD_RECHTEN } from '../../../pdf/protect-pdf-regels.js';
import { RECHTEN_LIJST, magBeveiligingWijzigen, isVersleuteld } from '../../../pdf/document-beveiliging.js';
import { updateStatusMessage } from '../../../ui/chrome/status-bar.js';

/**
 * Documentbeveiliging (#378): openwachtwoord, rechtenwachtwoord en rechten
 * (AES-256), of geen beveiliging. De keuze geldt bij het volgende opslaan
 * (js/pdf/beveiliging-toepassen.js). Windows-stijl via Dialog.jsx:
 * verplaatsbaar, sluit niet bij een klik ernaast.
 */
export default function ProtectPdfDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const doc = getActiveDocument();
  const huidig = doc?.beveiliging || null;
  const versleuteld = isVersleuteld(doc);

  const [keuze, setKeuze] = createSignal(versleuteld ? 'wachtwoord' : 'geen');
  const [gebruiker, setGebruiker] = createSignal('');
  const [gebruikerHerhaald, setGebruikerHerhaald] = createSignal('');
  const [eigenaar, setEigenaar] = createSignal('');
  const [eigenaarHerhaald, setEigenaarHerhaald] = createSignal('');
  const [huidigWachtwoord, setHuidigWachtwoord] = createSignal('');
  const [rechten, setRechten] = createSignal({ ...STANDAARD_RECHTEN, ...(huidig?.rechten || {}) });
  const [fout, setFout] = createSignal('');
  const [bezig, setBezig] = createSignal(false);

  const close = () => closeDialog('protect-pdf');
  const wachtwoordKeuze = () => keuze() === 'wachtwoord';
  const zetRecht = (sleutel, aan) => setRechten((r) => ({ ...r, [sleutel]: aan }));
  const wisWachtwoorden = () => {
    setGebruiker(''); setGebruikerHerhaald(''); setEigenaar(''); setEigenaarHerhaald(''); setHuidigWachtwoord('');
  };
  const sluit = () => { wisWachtwoorden(); close(); };

  const handleApply = async () => {
    if (bezig()) return;
    const invoer = {
      gebruiker: gebruiker(),
      gebruikerHerhaald: gebruikerHerhaald(),
      eigenaar: eigenaar(),
      eigenaarHerhaald: eigenaarHerhaald(),
    };
    // Nieuwe wachtwoorden controleren; alles leeg bij een beveiligd document
    // = de huidige wachtwoorden houden.
    const nieuweWachtwoorden = Object.values(invoer).some(Boolean);
    if (wachtwoordKeuze() && (nieuweWachtwoorden || !versleuteld)) {
      const probleem = controleerWachtwoorden(invoer);
      if (probleem) {
        setFout(t(probleem));
        return;
      }
    }
    // Hoge kwaliteit hoort bij printen.
    const r0 = rechten();
    const gekozen = { ...r0, printHogeKwaliteit: r0.print && r0.printHogeKwaliteit };
    setFout('');
    setBezig(true);
    try {
      const { pasBeveiligingToe } = await import('../../../pdf/beveiliging-toepassen.js');
      const r = await pasBeveiligingToe(doc, {
        keuze: keuze(),
        gebruiker: wachtwoordKeuze() ? invoer.gebruiker : '',
        eigenaar: wachtwoordKeuze() ? invoer.eigenaar : '',
        rechten: gekozen,
        huidigWachtwoord: huidigWachtwoord(),
      });
      if (!r.ok) {
        setFout(t(r.fout));
        return;
      }
      sluit();
      if (r.soort !== 'niets') updateStatusMessage(t('protectPdf.pending'));
    } catch (e) {
      console.warn('Beveiligen mislukt:', e?.message || e);
      setFout(t('protectPdf.failed', { error: e?.message || String(e) }));
    } finally {
      setBezig(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    }
  };

  const footer = (
    <>
      <div></div>
      <div class="crop-margins-footer-right">
        <button class="pref-btn pref-btn-primary" id="protect-pdf-apply" disabled={bezig()} onClick={handleApply}>{tCommon('ok')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={sluit}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  const wachtwoordRij = (labelKey, waarde, zet, uit = () => false) => (
    <div class="crop-margins-row">
      <label class="crop-margins-label protect-pdf-label">{t(labelKey)}</label>
      <input
        type="password"
        class="crop-margins-input-wide"
        autocomplete="new-password"
        spellcheck={false}
        disabled={uit()}
        value={waarde()}
        onInput={(e) => zet(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );

  const huidigeStaat = () => {
    if (!versleuteld) return t('protectPdf.stateNone');
    return [
      t('protectPdf.stateProtected', { method: huidig.methode || '?' }),
      huidig.openWachtwoord ? t('protectPdf.stateOpenPassword') : t('protectPdf.stateNoOpenPassword'),
    ].join(' ');
  };

  const uit = () => !wachtwoordKeuze();

  return (
    <Dialog
      title={t('protectPdf.title')}
      overlayClass="crop-margins-overlay"
      dialogClass="crop-margins-dialog protect-pdf-dialog"
      headerClass="crop-margins-header"
      bodyClass="crop-margins-content"
      footerClass="crop-margins-footer"
      onClose={sluit}
      footer={footer}
    >
      <div class="crop-margins-form">
        <div class="crop-margins-info">{t('protectPdf.info')}</div>

        <fieldset class="pref-fieldset">
          <legend>{t('protectPdf.current')}</legend>
          <div id="protect-pdf-state">{huidigeStaat()}</div>
          <Show when={huidig?.inAfwachting}>
            <div class="protect-pdf-hint">{t('protectPdf.pending')}</div>
          </Show>
          <Show when={versleuteld && !huidig.sessie}>
            <div class="protect-pdf-hint">{t('protectPdf.olderMethodInfo')}</div>
          </Show>
          <Show when={versleuteld && !magBeveiligingWijzigen(huidig)}>
            {wachtwoordRij('protectPdf.password', huidigWachtwoord, setHuidigWachtwoord)}
            <div class="protect-pdf-hint">{t('protectPdf.ownerPasswordHint')}</div>
          </Show>
        </fieldset>

        <fieldset class="pref-fieldset">
          <legend>{t('protectPdf.method')}</legend>
          <label class="pref-checkbox-label">
            <input type="radio" name="protect-pdf-keuze" checked={keuze() === 'geen'} onChange={() => setKeuze('geen')} />
            <span>{t('protectPdf.none')}</span>
          </label>
          <label class="pref-checkbox-label">
            <input type="radio" name="protect-pdf-keuze" checked={keuze() === 'wachtwoord'} onChange={() => setKeuze('wachtwoord')} />
            <span>{t('protectPdf.passwordSecurity')}</span>
          </label>
        </fieldset>

        <fieldset class="pref-fieldset">
          <legend>{t('protectPdf.openPassword')}</legend>
          {wachtwoordRij('protectPdf.password', gebruiker, setGebruiker, uit)}
          {wachtwoordRij('protectPdf.repeat', gebruikerHerhaald, setGebruikerHerhaald, uit)}
          <div class="protect-pdf-hint">{t('protectPdf.openPasswordHint')}</div>
        </fieldset>

        <fieldset class="pref-fieldset">
          <legend>{t('protectPdf.rightsPassword')}</legend>
          {wachtwoordRij('protectPdf.password', eigenaar, setEigenaar, uit)}
          {wachtwoordRij('protectPdf.repeat', eigenaarHerhaald, setEigenaarHerhaald, uit)}
          <div class="protect-pdf-hint">{t('protectPdf.rightsPasswordHint')} {t('protectPdf.rightsWarning')}</div>
          <Show when={versleuteld}>
            <div class="protect-pdf-hint">{t('protectPdf.keepPasswordsHint')}</div>
          </Show>
        </fieldset>

        <fieldset class="pref-fieldset">
          <legend>{t('protectPdf.allow')}</legend>
          <div class="protect-pdf-rechten">
            <For each={RECHTEN_LIJST}>
              {([sleutel, label]) => (
                <label class="pref-checkbox-label">
                  <input
                    type="checkbox"
                    checked={rechten()[sleutel]}
                    disabled={uit() || (sleutel === 'printHogeKwaliteit' && !rechten().print)}
                    onChange={(e) => zetRecht(sleutel, e.target.checked)}
                  />
                  <span>{t(label)}</span>
                </label>
              )}
            </For>
          </div>
        </fieldset>

        {fout() && <div class="protect-pdf-fout" role="alert">{fout()}</div>}
      </div>
    </Dialog>
  );
}
