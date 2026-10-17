import { createSignal, onMount, Show } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { openExternal } from '../../../core/platform.js';
import { showMessage } from '../../stores/dialogStore.js';
import { GEEN_MINIATUREN, leesMiniatuurStatus, zetMiniaturen } from '../../../core/verkenner-miniaturen.js';

export default function FileAssocTab() {
  const { t } = useTranslation('preferences');
  const { t: tCommon } = useTranslation('common');
  const [currentApp, setCurrentApp] = createSignal(tCommon('checking'));

  // PDF-miniaturen in Verkenner (#605): alleen Windows; de sectie blijft weg
  // zolang Rust niet meldt dat het kan.
  const [miniaturen, setMiniaturen] = createSignal({ ...GEEN_MINIATUREN });
  const [miniaturenBezig, setMiniaturenBezig] = createSignal(false);

  onMount(() => {
    checkDefaultPdfApp();
    leesMiniatuurStatus().then(setMiniaturen);
  });

  async function vraagVervangen(naam) {
    const tekst = t('explorerThumbnails.replaceConfirm', { name: naam });
    if (window.__TAURI__?.dialog?.ask) {
      return await window.__TAURI__.dialog.ask(tekst, { title: t('explorerThumbnails.replaceTitle'), kind: 'warning' });
    }
    return confirm(tekst);
  }

  async function handleMiniaturen(e) {
    // Vastleggen voor de await: na het afhandelen is currentTarget weg.
    const vak = e.currentTarget;
    const aan = vak.checked;
    setMiniaturenBezig(true);
    try {
      setMiniaturen(await zetMiniaturen(aan, miniaturen(), { vraag: vraagVervangen }));
    } catch (err) {
      showMessage(t('explorerThumbnails.failed') + '\n' + (err?.message || err));
      setMiniaturen(await leesMiniatuurStatus());
    }
    // Het vinkje volgt altijd de echte toestand (ook na "nee" op de vraag).
    vak.checked = miniaturen().enabled;
    setMiniaturenBezig(false);
  }

  async function checkDefaultPdfApp() {
    try {
      const os = require('os');
      const platform = os.platform();

      if (platform === 'win32') {
        const { exec } = require('child_process');
        exec('reg query "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\UserChoice" /v ProgId', (err, stdout) => {
          if (err) { setCurrentApp(tCommon('unableToDetect')); return; }
          const match = stdout.match(/ProgId\s+REG_SZ\s+(.+)/);
          if (match) {
            let appName = match[1].trim();
            if (appName.includes('AcroExch') || appName.includes('Acrobat')) appName = 'Adobe Acrobat';
            else if (appName.includes('Edge')) appName = 'Microsoft Edge';
            else if (appName.includes('Chrome')) appName = 'Google Chrome';
            else if (appName.includes('Firefox')) appName = 'Mozilla Firefox';
            else if (appName.includes('OpenPDFStudio') || appName.includes('open-pdf-studio')) appName = tCommon('appName');
            else if (appName.includes('SumatraPDF')) appName = 'SumatraPDF';
            setCurrentApp(appName);
          } else {
            setCurrentApp(t('fileAssoc.notSet'));
          }
        });
      } else if (platform === 'darwin') {
        setCurrentApp(t('fileAssoc.checkFinder'));
      } else {
        const { exec } = require('child_process');
        exec('xdg-mime query default application/pdf', (err, stdout) => {
          if (err || !stdout.trim()) { setCurrentApp(t('fileAssoc.notSet')); return; }
          setCurrentApp(stdout.trim().replace('.desktop', ''));
        });
      }
    } catch {
      setCurrentApp(tCommon('unableToDetect'));
    }
  }

  async function handleSetDefault() {
    const platform = navigator.platform.toLowerCase();
    if (platform.includes('win')) {
      try {
        await openExternal('ms-settings:defaultapps');
        showMessage(t('fileAssoc.windowsInstructions'));
      } catch {
        showMessage(t('fileAssoc.windowsFailed'));
      }
    } else if (platform.includes('mac')) {
      showMessage(t('fileAssoc.macInstructions'));
    } else {
      showMessage(t('fileAssoc.linuxInstructions'));
    }
  }

  return (
    <>
    <fieldset class="pref-fieldset">
      <legend>{t('fileAssoc.defaultPdfApplication')}</legend>
      <div class="pref-row">
        <label>{t('fileAssoc.currentDefault')}</label>
        <span style="font-size:11px;color:var(--theme-text-secondary, #666);">{currentApp()}</span>
      </div>
      <div class="pref-row" style="margin-top:12px;">
        <button type="button" class="pref-btn pref-btn-secondary" style="width:100%;" onClick={handleSetDefault}>
          {t('fileAssoc.setDefault')}
        </button>
      </div>
      <p style="font-size:10px;color:var(--theme-text-secondary, #888);margin-top:12px;line-height:1.4;">
        {t('fileAssoc.setDefaultHelp')}
      </p>
    </fieldset>
    <Show when={miniaturen().supported}>
      <fieldset class="pref-fieldset">
        <legend>{t('explorerThumbnails.title')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input
              type="checkbox"
              data-testid="prefs-explorer-thumbnails"
              checked={miniaturen().enabled}
              disabled={miniaturenBezig() || (!miniaturen().available && !miniaturen().enabled)}
              onChange={handleMiniaturen}
            />
            <span>{t('explorerThumbnails.show')}</span>
          </label>
        </div>
        <p style="font-size:10px;color:var(--theme-text-secondary, #888);margin-top:8px;line-height:1.4;">
          {t('explorerThumbnails.help')}
        </p>
        <Show when={!miniaturen().available}>
          <p style="font-size:10px;color:var(--theme-text-secondary, #888);margin-top:6px;line-height:1.4;">
            {t('explorerThumbnails.unavailable')}
          </p>
        </Show>
        <Show when={miniaturen().otherHandler && !miniaturen().enabled}>
          <p style="font-size:10px;color:var(--theme-text-secondary, #888);margin-top:6px;line-height:1.4;">
            {t('explorerThumbnails.otherHandler', { name: miniaturen().otherHandler })}
          </p>
        </Show>
        <Show when={miniaturen().defaultAppHandler}>
          <p style="font-size:10px;color:#b26a00;margin-top:6px;line-height:1.4;">
            {t('explorerThumbnails.defaultApp', { name: miniaturen().defaultAppHandler })}
          </p>
        </Show>
      </fieldset>
    </Show>
    </>
  );
}
