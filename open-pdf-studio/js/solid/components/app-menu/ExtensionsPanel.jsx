import { createSignal, createMemo, For, Show, onMount, onCleanup } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { levenscyclus, installPluginFromFile, reinstallPlugin } from '../../../plugins/plugin-manager.js';
import { isTauri } from '../../../core/platform.js';
import { state } from '../../../core/state.js';
import {
  catalogusDienst, catalogiUit, bronnenUit, bronSoort, STANDAARD_CATALOGUS, CATALOGUS_PAGINA,
} from '../../../plugins/extension-catalog-app.js';

// Het extensiepaneel toont alles wat de levenscyclus kent (#550): actieve,
// mislukte en niet-geladen extensies, zodat ook een kapotte extensie hier te
// verwijderen is. Een extensie die via de AI-koppeling is geïnstalleerd of
// bijgewerkt, krijgt daarvan een label.
//
// Drie tabbladen (#969): Geïnstalleerd (met de bron en "Bijwerken naar vX"),
// Bladeren (de catalogi, één klik installeren) en Eigen (installeren via een
// link of uit een bestand; niet beoordeeld). Downloads lopen via Rust en gaan
// daarna door dezelfde transactionele installatie als een bestand.
export default function ExtensionsPanel() {
  const { t } = useTranslation('appMenu');
  const tr = (sleutel, waarden = {}) => Object.entries(waarden)
    .reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), t(`extensionsPanel.${sleutel}`));

  const [tab, setTab] = createSignal('installed');
  const [plugins, setPlugins] = createSignal([]);
  const [bezigMet, setBezigMet] = createSignal(null); // id, 'file' of 'link'
  const [message, setMessage] = createSignal(null);
  const [catalogus, setCatalogus] = createSignal(null); // { items, problemen } | null
  const [laden, setLaden] = createSignal(false);
  const [zoek, setZoek] = createSignal('');
  const [link, setLink] = createSignal('');
  const [nieuweCatalogus, setNieuweCatalogus] = createSignal('');
  const [updates, setUpdates] = createSignal({}); // id -> nieuwste versie
  const [catalogi, setCatalogi] = createSignal(catalogiUit(state.preferences));
  const [bronnen, setBronnen] = createSignal(bronnenUit(state.preferences));

  const ververs = () => {
    setCatalogi(catalogiUit(state.preferences));
    setBronnen(bronnenUit(state.preferences));
  };

  async function refreshList() {
    if (!isTauri()) { setPlugins([]); return; }
    try {
      const { extensions } = await levenscyclus.lijstVers();
      setPlugins(extensions);
    } catch (err) {
      console.warn('[extensies] lijst ophalen mislukt', err);
    }
  }

  async function laadCatalogus() {
    if (!isTauri() || laden()) return catalogus();
    setLaden(true);
    try {
      const r = await catalogusDienst.laadCatalogi();
      setCatalogus(r);
      return r;
    } finally {
      setLaden(false);
    }
  }

  // Op de achtergrond: de catalogus en de releases achter de bronnen. Een
  // mislukte controle (geen netwerk) laat het paneel gewoon werken.
  async function zoekUpdates() {
    if (!isTauri()) return;
    try {
      const items = (catalogus() || await laadCatalogus())?.items || [];
      setUpdates(await catalogusDienst.zoekUpdates(plugins().filter((p) => p.installed), items));
    } catch (err) {
      console.warn('[extensies] updates zoeken mislukt', err);
    }
  }

  onMount(async () => {
    await refreshList();
    zoekUpdates();
    // Ook bijwerken als er via MCP iets verandert terwijl het paneel open is.
    const stop = levenscyclus.abonneer(() => refreshList());
    onCleanup(stop);
  });

  const foutTekst = (err) => (err?.resultaat?.code ? `${err.resultaat.code}: ${err.resultaat.error}` : String(err?.message ?? err));

  async function bezig(sleutel, werk) {
    if (!isTauri() || bezigMet()) return;
    setBezigMet(sleutel);
    setMessage(null);
    try {
      const manifest = await werk();
      if (manifest) setMessage({ type: 'success', text: tr('installSuccess', { name: manifest.name || manifest.id }) });
    } catch (err) {
      setMessage({ type: 'error', text: `${tr('installError')}: ${foutTekst(err)}` });
    } finally {
      setBezigMet(null);
      ververs();
      await refreshList();
      // Een update die nu is geïnstalleerd, hoeft niet meer te worden aangeboden.
      setUpdates((u) => {
        const rest = { ...u };
        for (const p of plugins()) if (rest[p.id] && p.version === rest[p.id]) delete rest[p.id];
        return rest;
      });
    }
  }

  async function kiesPakket() {
    return window.__TAURI__.dialog.open({
      multiple: false,
      filters: [{ name: 'Extension Package', extensions: ['oppx'] }]
    });
  }

  const handleInstall = () => bezig('file', async () => {
    const result = await kiesPakket();
    return result ? installPluginFromFile(result) : null;
  });

  const handleLink = () => {
    const l = link().trim();
    if (!l) return;
    return bezig('link', async () => {
      const m = await catalogusDienst.installeerLink(l);
      setLink('');
      return m;
    });
  };

  const handleItem = (item) => bezig(item.id, () => catalogusDienst.installeerItem(item));

  const handleUpdate = (id) => bezig(id, () => catalogusDienst.werkBij(id, catalogus()?.items || []));

  async function handleCatalogusToevoegen() {
    setMessage(null);
    try {
      await catalogusDienst.voegCatalogusToe(nieuweCatalogus().trim());
      setNieuweCatalogus('');
      ververs();
      setCatalogus(null);
      await laadCatalogus();
    } catch (err) {
      setMessage({ type: 'error', text: foutTekst(err) });
    }
  }

  async function handleCatalogusVerwijderen(url) {
    await catalogusDienst.verwijderCatalogus(url);
    ververs();
    setCatalogus(null);
    await laadCatalogus();
  }

  const openLink = (url) => import('../../../core/extern-openen.js').then((m) => m.openExtern(url));

  function openTab(naam) {
    setTab(naam);
    if (naam === 'browse' && !catalogus()) laadCatalogus();
  }

  // Herladen = opnieuw installeren uit een bestand, met terugrollen naar de
  // vorige versie als de nieuwe niet activeert.
  async function handleReload(pluginId, pluginName) {
    if (!isTauri()) return;
    setMessage(null);
    try {
      const result = await kiesPakket();
      if (!result) return;
      const manifest = await reinstallPlugin(pluginId, result);
      setMessage({ type: 'success', text: (t('extensionsPanel.reloadSuccess') || '"{{name}}" reloaded successfully').replace('{{name}}', manifest.name || pluginName) });
    } catch (err) {
      setMessage({ type: 'error', text: `${t('extensionsPanel.reloadError') || 'Failed to reload extension'}: ${foutTekst(err)}` });
    } finally {
      refreshList();
    }
  }

  async function handleUninstall(pluginId, pluginName) {
    if (!isTauri()) return;

    try {
      const confirmed = window.__TAURI__?.dialog?.ask
        ? await window.__TAURI__.dialog.ask(
            t('extensionsPanel.confirmUninstall').replace('{{name}}', pluginName),
            { title: t('extensionsPanel.title'), kind: 'warning' }
          )
        : confirm(t('extensionsPanel.confirmUninstall').replace('{{name}}', pluginName));

      if (!confirmed) return;

      // Uitzetten, opruimen en van schijf halen in één bewerking.
      const r = await levenscyclus.verwijder(pluginId, { bron: 'ui' });
      if (!r.ok) throw new Error(`${r.code}: ${r.error}`);
      await catalogusDienst.vergeetBron(pluginId);
      ververs();
      setUpdates((u) => { const rest = { ...u }; delete rest[pluginId]; return rest; });
      setMessage({ type: 'success', text: t('extensionsPanel.uninstallSuccess').replace('{{name}}', pluginName) });
    } catch (err) {
      setMessage({ type: 'error', text: `${t('extensionsPanel.uninstallError')}: ${foutTekst(err)}` });
    } finally {
      refreshList();
    }
  }

  const geinstalleerd = (id) => plugins().find((p) => p.id === id && p.installed);
  const bronLabel = (id) => {
    const s = bronSoort(bronnen(), id);
    return s === 'catalog' ? tr('fromCatalog') : s === 'custom' ? tr('fromCustom') : '';
  };
  const aantalUpdates = () => Object.keys(updates()).length;

  const gefilterd = createMemo(() => {
    const q = zoek().trim().toLowerCase();
    const items = catalogus()?.items || [];
    if (!q) return items;
    return items.filter((i) => [i.name, i.id, i.description, i.author, ...i.tags].join(' ').toLowerCase().includes(q));
  });

  const pictogram = () => (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
    </svg>
  );

  const updateKnop = (id) => (
    <button class="ext-action-btn ext-action-primary" disabled={!!bezigMet()} onClick={() => handleUpdate(id)}>
      {bezigMet() === id ? t('extensionsPanel.installing') : tr('updateTo', { version: updates()[id] })}
    </button>
  );

  const TABS = [['installed', 'tabInstalled'], ['browse', 'tabBrowse'], ['custom', 'tabCustom']];

  return (
    <div class="bs-export-panel">
      <h2 class="bs-export-title">{t('extensionsPanel.title')}</h2>

      <div class="ext-tabs" role="tablist">
        <For each={TABS}>
          {([id, sleutel]) => (
            <button class="ext-tab" classList={{ 'is-active': tab() === id }} role="tab" aria-selected={tab() === id} onClick={() => openTab(id)}>
              {tr(sleutel)}
              <Show when={id === 'installed' && aantalUpdates()}>
                <span class="ext-tab-count" title={tr('updatesAvailable', { count: String(aantalUpdates()) })}>{aantalUpdates()}</span>
              </Show>
            </button>
          )}
        </For>
      </div>

      <Show when={message()}>
        <div class={`ext-message ext-message-${message().type}`}>
          {message().text}
        </div>
      </Show>

      {/* ── Geïnstalleerd ─────────────────────────────────────────── */}
      <Show when={tab() === 'installed'}>
        <Show when={plugins().length === 0}>
          <p class="ext-empty">{t('extensionsPanel.noExtensions')}</p>
        </Show>

        <div class="ext-list">
          <For each={plugins()}>
            {(plugin) => (
              <div class={`ext-card${plugin.status === 'failed' ? ' ext-card-failed' : ''}`} data-extension-id={plugin.id}>
                <div class="ext-card-icon">{pictogram()}</div>
                <div class="ext-card-info">
                  <div class="ext-card-header">
                    <h4 class="ext-card-name">{plugin.name || plugin.id}</h4>
                    <Show when={plugin.version}>
                      <span class="ext-card-version">v{plugin.version}</span>
                    </Show>
                    <Show when={bronLabel(plugin.id)}>
                      <span class="ext-card-badge" title={bronnen()[plugin.id]?.link}>{bronLabel(plugin.id)}</span>
                    </Show>
                    <Show when={plugin.installedVia === 'mcp' || plugin.source === 'mcp'}>
                      <span class="ext-card-badge">{t('extensionsPanel.viaMcp')}</span>
                    </Show>
                  </div>
                  <Show when={plugin.description}>
                    <p class="ext-card-desc">{plugin.description}</p>
                  </Show>
                  <Show when={plugin.author}>
                    <p class="ext-card-author">{t('extensionsPanel.by')} {plugin.author}</p>
                  </Show>
                  <Show when={!plugin.activated && plugin.error}>
                    <p class="ext-card-status">
                      {t('extensionsPanel.activationFailed').replace('{{error}}', `${plugin.error.code}: ${plugin.error.message}`)}
                    </p>
                  </Show>
                </div>
                <div class="ext-card-actions">
                  <Show when={plugin.installed && updates()[plugin.id]}>
                    {updateKnop(plugin.id)}
                  </Show>
                  <Show when={plugin.installed}>
                    <button class="ext-reload-btn" onClick={() => handleReload(plugin.id, plugin.name || plugin.id)} title={t('extensionsPanel.reload') || 'Reload'}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="23 4 23 10 17 10"/>
                        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                      </svg>
                    </button>
                    <button class="ext-uninstall-btn" onClick={() => handleUninstall(plugin.id, plugin.name || plugin.id)} title={t('extensionsPanel.uninstall')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                      </svg>
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* ── Bladeren in de catalogi ───────────────────────────────── */}
      <Show when={tab() === 'browse'}>
        <Show when={isTauri()} fallback={<p class="ext-empty">{tr('desktopOnly')}</p>}>
          <div class="ext-browse-bar">
            <input class="ext-input" type="search" placeholder={tr('search')} value={zoek()} onInput={(e) => setZoek(e.target.value)} />
            <button class="ext-action-btn" onClick={() => { setCatalogus(null); laadCatalogus().then(zoekUpdates); }} disabled={laden()}>
              {laden() ? tr('loading') : tr('refresh')}
            </button>
          </div>
          <For each={catalogus()?.problemen || []}>
            {(p) => <div class="ext-message ext-message-error">{tr('catalogFailed', { url: p.url })}: {p.error}</div>}
          </For>

          <div class="ext-list">
            <Show when={catalogus() && !laden() && !gefilterd().length}>
              <p class="ext-empty">{catalogus()?.items?.length ? tr('noResults') : tr('catalogEmpty')}</p>
            </Show>
            <For each={gefilterd()}>
              {(item) => (
                <div class="ext-card" data-extension-id={item.id}>
                  <div class="ext-card-icon">{pictogram()}</div>
                  <div class="ext-card-info">
                    <div class="ext-card-header">
                      <h4 class="ext-card-name">{item.name}</h4>
                      <Show when={item.version}>
                        <span class="ext-card-version">v{item.version}</span>
                      </Show>
                      <For each={item.tags}>{(tag) => <span class="ext-card-badge">{tag}</span>}</For>
                    </div>
                    <p class="ext-card-desc">{item.description}</p>
                    <p class="ext-card-author">
                      {t('extensionsPanel.by')} {item.author}
                      <Show when={item.homepage}>
                        {' · '}<a class="ext-link" href={item.homepage} onClick={(e) => { e.preventDefault(); openLink(item.homepage); }}>{tr('homepage')}</a>
                      </Show>
                    </p>
                  </div>
                  <div class="ext-card-actions">
                    <Show when={geinstalleerd(item.id)} fallback={
                      <button class="ext-action-btn ext-action-primary" disabled={!!bezigMet()} onClick={() => handleItem(item)}>
                        {bezigMet() === item.id ? t('extensionsPanel.installing') : tr('install')}
                      </button>
                    }>
                      <Show when={updates()[item.id]} fallback={<span class="ext-card-badge">{tr('isInstalled')}</span>}>
                        {updateKnop(item.id)}
                      </Show>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>

          <div class="ext-catalogs">
            <h3 class="ext-section-title">{tr('catalogs')}</h3>
            <For each={catalogi()}>
              {(url) => (
                <div class="ext-catalog-row">
                  <span class="ext-catalog-url" title={url}>{url}</span>
                  <Show when={url !== STANDAARD_CATALOGUS} fallback={<span class="ext-card-badge">{tr('defaultCatalog')}</span>}>
                    <button class="ext-action-btn" onClick={() => handleCatalogusVerwijderen(url)}>{tr('removeCatalog')}</button>
                  </Show>
                </div>
              )}
            </For>
            <div class="ext-browse-bar">
              <input class="ext-input" type="url" placeholder="https://…/extensions.json" value={nieuweCatalogus()}
                onInput={(e) => setNieuweCatalogus(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && nieuweCatalogus().trim()) handleCatalogusToevoegen(); }} />
              <button class="ext-action-btn" disabled={!nieuweCatalogus().trim()} onClick={handleCatalogusToevoegen}>{tr('addCatalog')}</button>
            </div>
            <p class="ext-install-hint">
              {tr('submitHint')}{' '}
              <a class="ext-link" href={CATALOGUS_PAGINA} onClick={(e) => { e.preventDefault(); openLink(CATALOGUS_PAGINA); }}>extensions.json</a>
            </p>
          </div>
        </Show>
      </Show>

      {/* ── Eigen: via een link of uit een bestand ────────────────── */}
      <Show when={tab() === 'custom'}>
        <p class="ext-warning">{tr('customWarning')}</p>
        <h3 class="ext-section-title">{tr('installFromLink')}</h3>
        <div class="ext-browse-bar">
          <input class="ext-input" type="url" placeholder="https://github.com/owner/repo" value={link()} disabled={!isTauri()}
            onInput={(e) => setLink(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLink(); }} />
          <button class="ext-action-btn ext-action-primary" disabled={!isTauri() || !link().trim() || !!bezigMet()} onClick={handleLink}>
            {bezigMet() === 'link' ? t('extensionsPanel.installing') : tr('install')}
          </button>
        </div>
        <p class="ext-install-hint">{tr('linkHint')}</p>

        <div class="ext-divider" />

        <div class="ext-install-section">
          <button class="ext-install-btn" onClick={handleInstall} disabled={!!bezigMet()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {bezigMet() === 'file' ? t('extensionsPanel.installing') : t('extensionsPanel.installFromFile')}
          </button>
          <p class="ext-install-hint">{t('extensionsPanel.installHint')}</p>
        </div>
      </Show>
    </div>
  );
}
