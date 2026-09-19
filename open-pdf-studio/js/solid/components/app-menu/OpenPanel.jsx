import { createSignal, createMemo, For, Show, Switch, Match, onMount } from 'solid-js';
import { closeAppMenu } from '../../stores/appMenuStore.js';
import { openPDFFile, loadPDFIfNeeded } from '../../../pdf/loader.js';
import { getRecentFiles, removeRecentFile, pinRecentFile, unpinRecentFile } from '../../../mobile/recent-files.js';
import { createTab } from '../../../ui/chrome/tabs.js';
import { isTauri, fileExists, openFolderDialog, downloadPdfFromUrl, listPdfFiles } from '../../../core/platform.js';
import { useTranslation, localizeNumber } from '../../../i18n/useTranslation.js';
import { getSavedSessions, saveCurrentSession, deleteSession, restoreSession } from '../../../stores/sessions.js';
import { getSavedPlaces, addPlace, removePlace } from '../../../stores/places.js';

export default function OpenPanel() {
  const { t } = useTranslation('appMenu');
  const [activeSubPanel, setActiveSubPanel] = createSignal('recent');
  const [recentFiles, setRecentFiles] = createSignal([]);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [pinnedCollapsed, setPinnedCollapsed] = createSignal(false);
  const [unpinnedCollapsed, setUnpinnedCollapsed] = createSignal(false);

  // Sessions state
  const [sessions, setSessions] = createSignal([]);
  const [sessionName, setSessionName] = createSignal('');

  // URL state
  const [urlInput, setUrlInput] = createSignal('');
  const [urlLoading, setUrlLoading] = createSignal(false);
  const [urlError, setUrlError] = createSignal('');

  // Places state
  const [places, setPlaces] = createSignal([]);
  const [expandedPlace, setExpandedPlace] = createSignal(null);
  const [placeFiles, setPlaceFiles] = createSignal([]);
  const [placeFilesLoading, setPlaceFilesLoading] = createSignal(false);

  onMount(() => {
    refreshFiles();
    refreshSessions();
    refreshPlaces();
  });

  function refreshFiles() {
    const files = getRecentFiles();
    files.sort((a, b) => b.timestamp - a.timestamp);
    setRecentFiles(files);
  }

  function refreshSessions() {
    setSessions(getSavedSessions());
  }

  function refreshPlaces() {
    setPlaces(getSavedPlaces());
  }

  const pinnedFiles = createMemo(() => {
    const q = searchQuery().toLowerCase();
    return recentFiles().filter(f => f.pinned && (!q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)));
  });

  const unpinnedFiles = createMemo(() => {
    const q = searchQuery().toLowerCase();
    return recentFiles().filter(f => !f.pinned && (!q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)));
  });

  async function handleBrowse() {
    closeAppMenu();
    await openPDFFile();
  }

  async function handleOpenRecent(file) {
    closeAppMenu();
    if (isTauri()) {
      try {
        // Grant FS scope FIRST — fileExists needs it to access the path
        await window.__TAURI__.core.invoke('allow_fs_scope', { path: file.path });
        const exists = await fileExists(file.path);
        if (!exists) {
          removeRecentFile(file.path);
          refreshFiles();
          return;
        }
      } catch (e) {
        // If we can't check, try opening anyway
      }
    }
    const { index } = createTab(file.path);
    await loadPDFIfNeeded(file.path, index);
  }

  function handlePin(e, file) {
    e.stopPropagation();
    if (file.pinned) {
      unpinRecentFile(file.path);
    } else {
      pinRecentFile(file.path);
    }
    refreshFiles();
  }

  function handleRemove(e, file) {
    e.stopPropagation();
    removeRecentFile(file.path);
    refreshFiles();
  }

  // Sessions handlers
  function handleSaveSession() {
    const name = sessionName().trim();
    if (!name) return;
    const result = saveCurrentSession(name);
    if (result) {
      setSessionName('');
      refreshSessions();
    }
  }

  async function handleRestoreSession(session) {
    closeAppMenu();
    await restoreSession(session);
  }

  function handleDeleteSession(e, session) {
    e.stopPropagation();
    deleteSession(session.name);
    refreshSessions();
  }

  // URL handlers
  async function handleOpenUrl() {
    const url = urlInput().trim();
    if (!url) return;

    try {
      new URL(url);
    } catch {
      setUrlError(t('openPanel.invalidUrl'));
      return;
    }

    setUrlError('');
    setUrlLoading(true);

    try {
      const tempPath = await downloadPdfFromUrl(url);
      if (tempPath) {
        closeAppMenu();
        const { index } = createTab(tempPath);
        await loadPDFIfNeeded(tempPath, index);
        setUrlInput('');
      } else {
        setUrlError(t('openPanel.downloadError'));
      }
    } catch (e) {
      setUrlError(e?.toString() || t('openPanel.downloadError'));
    } finally {
      setUrlLoading(false);
    }
  }

  // Places handlers
  async function handleAddFolder() {
    const folder = await openFolderDialog(t('openPanel.addFolder'));
    if (folder) {
      addPlace(folder);
      refreshPlaces();
    }
  }

  function handleRemovePlace(e, place) {
    e.stopPropagation();
    removePlace(place.path);
    if (expandedPlace() === place.path) {
      setExpandedPlace(null);
      setPlaceFiles([]);
    }
    refreshPlaces();
  }

  async function handleClickPlace(place) {
    if (expandedPlace() === place.path) {
      setExpandedPlace(null);
      setPlaceFiles([]);
      return;
    }

    setExpandedPlace(place.path);
    setPlaceFilesLoading(true);
    setPlaceFiles([]);

    try {
      const files = await listPdfFiles(place.path);
      setPlaceFiles(files || []);
    } catch (e) {
      console.warn('Failed to list PDF files:', e);
      setPlaceFiles([]);
    } finally {
      setPlaceFilesLoading(false);
    }
  }

  async function handleOpenPlaceFile(filePath) {
    closeAppMenu();
    if (isTauri() && window.__TAURI__) {
      try { await window.__TAURI__.core.invoke('allow_fs_scope', { path: filePath }); } catch {}
    }
    const { index } = createTab(filePath);
    await loadPDFIfNeeded(filePath, index);
  }

  function extractFileName(path) {
    return path.replace(/\\/g, '/').split('/').pop() || path;
  }

  function formatDate(timestamp) {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function FileRow(props) {
    return (
      <div class="recent-file-item" onClick={() => handleOpenRecent(props.file)}>
        <div class="recent-file-icon">
          <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 0H2C0.9 0 0 0.9 0 2V22C0 23.1 0.9 24 2 24H18C19.1 24 20 23.1 20 22V8L12 0Z" fill="#E53935"/>
            <path d="M12 0V8H20L12 0Z" fill="#EF9A9A"/>
            <text x="10" y="19" font-size="7" font-weight="bold" fill="white" text-anchor="middle" font-family="Arial, sans-serif">PDF</text>
          </svg>
        </div>
        <div class="recent-file-info">
          <div class="recent-file-name">{props.file.name}</div>
          <div class="recent-file-path" title={props.file.path}>{props.file.path}</div>
        </div>
        <div class="recent-file-actions">
          <button
            class={`recent-file-action-btn${props.file.pinned ? ' pinned' : ''}`}
            onClick={(e) => handlePin(e, props.file)}
            title={props.file.pinned ? t('openPanel.unpin') : t('openPanel.pin')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={props.file.pinned ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 17v5"/>
              <path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24z"/>
            </svg>
          </button>
          <button
            class="recent-file-action-btn remove"
            onClick={(e) => handleRemove(e, props.file)}
            title={t('openPanel.remove')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ── Content panels ──

  function RecentFilesContent() {
    return (
      <>
        <h2 class="open-panel-title">{t('openPanel.recentFiles')}</h2>

        <div class="open-panel-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            class="open-panel-search-input"
            placeholder={t('openPanel.find')}
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div class="open-panel-groups">
          <div class="open-panel-group">
            <button class="open-panel-group-header" onClick={() => setPinnedCollapsed(!pinnedCollapsed())}>
              <svg class={`open-panel-chevron${pinnedCollapsed() ? ' collapsed' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
              <span>{t('openPanel.pinnedRecents')} ({localizeNumber(pinnedFiles().length)})</span>
            </button>
            <Show when={!pinnedCollapsed()}>
              <div class="open-panel-group-list">
                <For each={pinnedFiles()}>
                  {(file) => <FileRow file={file} />}
                </For>
              </div>
            </Show>
          </div>

          <div class="open-panel-group">
            <button class="open-panel-group-header" onClick={() => setUnpinnedCollapsed(!unpinnedCollapsed())}>
              <svg class={`open-panel-chevron${unpinnedCollapsed() ? ' collapsed' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
              <span>{t('openPanel.unpinnedRecents')} ({localizeNumber(unpinnedFiles().length)})</span>
            </button>
            <Show when={!unpinnedCollapsed()}>
              <div class="open-panel-group-list">
                <Show when={unpinnedFiles().length > 0} fallback={
                  <div class="open-panel-empty">{t('openPanel.noRecentFiles')}</div>
                }>
                  <For each={unpinnedFiles()}>
                    {(file) => <FileRow file={file} />}
                  </For>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </>
    );
  }

  function SessionsContent() {
    return (
      <>
        <h2 class="open-panel-title">{t('openPanel.sessions')}</h2>

        <div class="session-save-form">
          <input
            type="text"
            class="session-name-input"
            placeholder={t('openPanel.sessionName')}
            value={sessionName()}
            onInput={(e) => setSessionName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveSession(); }}
          />
          <button
            class="session-save-btn"
            onClick={handleSaveSession}
            disabled={!sessionName().trim()}
          >
            {t('openPanel.saveSession')}
          </button>
        </div>

        <div class="open-panel-groups" style="margin-top: 16px">
          <Show when={sessions().length > 0} fallback={
            <div class="open-panel-empty">{t('openPanel.noSessions')}</div>
          }>
            <For each={sessions()}>
              {(session) => (
                <div class="session-item" onClick={() => handleRestoreSession(session)}>
                  <div class="session-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="3" width="7" height="7"/>
                      <rect x="14" y="3" width="7" height="7"/>
                      <rect x="3" y="14" width="7" height="7"/>
                      <rect x="14" y="14" width="7" height="7"/>
                    </svg>
                  </div>
                  <div class="session-info">
                    <div class="session-name">{session.name}</div>
                    <div class="session-meta">
                      {formatDate(session.timestamp)} — {t('openPanel.fileCount', { count: session.files.length })}
                    </div>
                  </div>
                  <div class="recent-file-actions">
                    <button
                      class="recent-file-action-btn remove"
                      onClick={(e) => handleDeleteSession(e, session)}
                      title={t('openPanel.deleteSession')}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </>
    );
  }

  function UrlContent() {
    return (
      <>
        <h2 class="open-panel-title">{t('openPanel.openFromUrl')}</h2>

        <div class="url-form">
          <input
            type="text"
            class="url-input"
            placeholder={t('openPanel.urlPlaceholder')}
            value={urlInput()}
            onInput={(e) => { setUrlInput(e.target.value); setUrlError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !urlLoading()) handleOpenUrl(); }}
            disabled={urlLoading()}
          />
          <button
            class="url-open-btn"
            onClick={handleOpenUrl}
            disabled={urlLoading() || !urlInput().trim()}
          >
            {urlLoading() ? t('openPanel.downloading') : t('openPanel.openUrl')}
          </button>
        </div>

        <Show when={urlError()}>
          <div class="url-error">{urlError()}</div>
        </Show>
      </>
    );
  }

  function PlacesContent() {
    return (
      <>
        <h2 class="open-panel-title">{t('openPanel.addAPlace')}</h2>

        <button class="places-add-btn" onClick={handleAddFolder}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          {t('openPanel.addFolder')}
        </button>

        <div class="open-panel-groups" style="margin-top: 12px">
          <Show when={places().length > 0} fallback={
            <div class="open-panel-empty">{t('openPanel.noPlaces')}</div>
          }>
            <For each={places()}>
              {(place) => (
                <div class="place-wrapper">
                  <div class="place-item" onClick={() => handleClickPlace(place)}>
                    <div class="place-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                      </svg>
                    </div>
                    <div class="place-info">
                      <div class="place-name">{place.name}</div>
                      <div class="place-path" title={place.path}>{place.path}</div>
                    </div>
                    <div class="recent-file-actions">
                      <button
                        class="recent-file-action-btn remove"
                        onClick={(e) => handleRemovePlace(e, place)}
                        title={t('openPanel.removePlace')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  </div>

                  <Show when={expandedPlace() === place.path}>
                    <div class="place-files">
                      <Show when={!placeFilesLoading()} fallback={
                        <div class="open-panel-empty">Loading...</div>
                      }>
                        <Show when={placeFiles().length > 0} fallback={
                          <div class="open-panel-empty">{t('openPanel.noFilesInFolder')}</div>
                        }>
                          <For each={placeFiles()}>
                            {(filePath) => (
                              <div class="place-file-item" onClick={() => handleOpenPlaceFile(filePath)}>
                                <div class="recent-file-icon">
                                  <svg width="16" height="20" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M12 0H2C0.9 0 0 0.9 0 2V22C0 23.1 0.9 24 2 24H18C19.1 24 20 23.1 20 22V8L12 0Z" fill="#E53935"/>
                                    <path d="M12 0V8H20L12 0Z" fill="#EF9A9A"/>
                                    <text x="10" y="19" font-size="7" font-weight="bold" fill="white" text-anchor="middle" font-family="Arial, sans-serif">PDF</text>
                                  </svg>
                                </div>
                                <span class="place-file-name">{extractFileName(filePath)}</span>
                              </div>
                            )}
                          </For>
                        </Show>
                      </Show>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>
      </>
    );
  }

  return (
    <div class="open-panel">
      <div class="open-panel-nav">
        <button
          class={`open-panel-nav-item${activeSubPanel() === 'recent' ? ' active' : ''}`}
          onClick={() => setActiveSubPanel('recent')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span>{t('openPanel.recentFiles')}</span>
        </button>
        <button
          class={`open-panel-nav-item${activeSubPanel() === 'sessions' ? ' active' : ''}`}
          onClick={() => setActiveSubPanel('sessions')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7"/>
            <rect x="14" y="3" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/>
          </svg>
          <span>{t('openPanel.sessions')}</span>
        </button>
        <button
          class={`open-panel-nav-item${activeSubPanel() === 'url' ? ' active' : ''}`}
          onClick={() => setActiveSubPanel('url')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
          </svg>
          <span>{t('openPanel.openFromUrl')}</span>
        </button>
        <button
          class={`open-panel-nav-item${activeSubPanel() === 'places' ? ' active' : ''}`}
          onClick={() => setActiveSubPanel('places')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          <span>{t('openPanel.addAPlace')}</span>
        </button>
        <button class="open-panel-nav-item" onClick={handleBrowse}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
          </svg>
          <span>{t('openPanel.browse')}</span>
        </button>
      </div>

      <div class="open-panel-content">
        <Switch>
          <Match when={activeSubPanel() === 'recent'}>
            <RecentFilesContent />
          </Match>
          <Match when={activeSubPanel() === 'sessions'}>
            <SessionsContent />
          </Match>
          <Match when={activeSubPanel() === 'url'}>
            <UrlContent />
          </Match>
          <Match when={activeSubPanel() === 'places'}>
            <PlacesContent />
          </Match>
        </Switch>
      </div>
    </div>
  );
}
