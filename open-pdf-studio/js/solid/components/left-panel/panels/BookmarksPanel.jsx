import BookmarkTitle from './BookmarkTitle.jsx';
import { isPdfAReadOnly } from '../../../../pdf/loader.js';
import { For, Show, createSignal, createMemo, createEffect, on, onCleanup } from 'solid-js';
import { activeTab, collapsed } from '../../../stores/leftPanelStore.js';
import { tree, countText, emptyMessage, selectedId, selectedIds, toolbarDisabled } from '../../../stores/panels/bookmarksStore.js';
import { activePage } from '../../../stores/panels/thumbnailStore.js';
import { showBookmarkMenu } from '../../../stores/contextMenuStore.js';
import { getActiveDocument } from '../../../../core/state.js';
import { huidigeBladwijzer, volgendeTreffer, scrollVoorItem } from '../../../../ui/panels/bladwijzer-zoeken.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';
import { currentTheme } from '../../../stores/ribbonStore.js';
import { weergaveKleur, leesCssKleur } from '../../../../ui/panels/bladwijzer-stijl.js';
import { dropToegestaan, sleepPositie } from '../../../../ui/panels/bladwijzer-boom.js';
import i18next from '../../../../i18n/config.js';

// Treffer van het zoekveld (#578): krijgt een streep links en wordt in beeld
// geschoven. De lijst zelf wordt niet gefilterd.
const [gevondenId, setGevondenId] = createSignal(null);

// Achtergrond van de lijst als [r,g,b] (#689): een bladwijzerkleur met te
// weinig contrast (donkerblauw op een donker thema) wordt voor de weergave
// lichter getekend. Het PDF houdt de gekozen kleur.
const [lijstAchtergrond, setLijstAchtergrond] = createSignal(null);

function achtergrondVan(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const rgb = leesCssKleur(getComputedStyle(n).backgroundColor);
    if (rgb) return rgb;
  }
  return null;
}

// Slepen (#690): de gesleepte ids en waar ze zouden vallen
// ({ id, positie: 'before' | 'after' | 'inside' }, of id null = einde lijst).
const [gesleept, setGesleept] = createSignal(null);
const [dropDoel, setDropDoel] = createSignal(null);

// Een ingeklapte ouder klapt open als je er ongeveer een seconde boven blijft.
let openklapTimer = null;
let openklapId = null;
function stopOpenklappen() {
  clearTimeout(openklapTimer);
  openklapTimer = null;
  openklapId = null;
}
function planOpenklappen(id) {
  if (openklapId === id) return;
  stopOpenklappen();
  openklapId = id;
  openklapTimer = setTimeout(() => {
    openklapTimer = null;
    import('../../../../ui/panels/bookmarks.js').then(m => m.toggleBookmarkExpand(id));
  }, 1000);
}

function stopSlepen() {
  setGesleept(null);
  setDropDoel(null);
  stopOpenklappen();
}

// Bij meerdere bladwijzers een klein label als sleepbeeld ("3 bladwijzers").
function sleepbeeld(e, aantal) {
  if (aantal < 2 || !e.dataTransfer?.setDragImage) return;
  const label = document.createElement('div');
  label.className = 'bookmark-drag-image';
  label.textContent = i18next.t('leftPanel.bookmarksCount', { count: aantal });
  document.body.appendChild(label);
  e.dataTransfer.setDragImage(label, 8, 8);
  setTimeout(() => label.remove(), 0);
}

function BookmarkNode(props) {
  const indent = () => props.depth * 16;
  const geselecteerd = () => selectedIds().includes(props.node.id);
  const bewerkbaar = () => !toolbarDisabled().add;
  const drop = () => (dropDoel()?.id === props.node.id ? dropDoel().positie : null);
  const bladwijzers = () => import('../../../../ui/panels/bookmarks.js');

  return (
    <div>
      <div
        class={`bookmark-item${geselecteerd() ? ' selected' : ''}${selectedId() === props.node.id ? ' focused' : ''}${props.huidig() === props.node.id ? ' current' : ''}${gevondenId() === props.node.id ? ' found' : ''}`}
        classList={{
          dragging: !!gesleept()?.includes(props.node.id),
          'drop-before': drop() === 'before',
          'drop-after': drop() === 'after',
          'drop-inside': drop() === 'inside',
        }}
        data-bm-id={props.node.id}
        style={{ 'padding-left': `${indent()}px`, '--bm-indent': `${indent() + 14}px` }}
        draggable={bewerkbaar() && props.rename.session()?.id !== props.node.id}
        onClick={(e) => {
          // Ctrl: toevoegen/weghalen; Shift: bereik; gewoon: één en naar de pagina.
          const id = props.node.id;
          if (e.shiftKey) bladwijzers().then(m => m.selectBookmarkRange(id, e.ctrlKey || e.metaKey));
          else if (e.ctrlKey || e.metaKey) bladwijzers().then(m => m.toggleBookmarkSelection(id));
          else bladwijzers().then(m => m.selectBookmark(id));
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          bladwijzers().then(m => {
            m.selectBookmarkForMenu(props.node.id);
          });
          showBookmarkMenu(e.clientX, e.clientY);
        }}
        onDragStart={(e) => {
          if (!bewerkbaar() || props.rename.session()) { e.preventDefault(); return; }
          // Een geselecteerde sleept de hele selectie mee, een andere alleen zichzelf.
          const ids = geselecteerd() ? [...selectedIds()] : [props.node.id];
          setGesleept(ids);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', props.node.title || '');
          sleepbeeld(e, ids.length);
        }}
        onDragOver={(e) => {
          const ids = gesleept();
          if (!ids) return;
          // Niet stoppen: de lijst schuift mee als de rij dicht bij de rand is.
          const lijst = getActiveDocument()?.bookmarks || [];
          if (!dropToegestaan(lijst, ids, props.node.id)) {
            // In zichzelf of een eigen kind: geweigerd, de cursor laat het zien.
            // Afgehandeld met dropEffect 'none' en niet doorgeven: de algemene
            // dragover van het document (ui/setup.js) zou er anders een
            // verplaats-cursor van maken.
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'none';
            setDropDoel(null);
            stopOpenklappen();
            return;
          }
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const rect = e.currentTarget.getBoundingClientRect();
          const positie = sleepPositie(rect.top, rect.height, e.clientY);
          const d = dropDoel();
          if (d?.id !== props.node.id || d?.positie !== positie) setDropDoel({ id: props.node.id, positie });
          if (positie === 'inside' && props.node.hasChildren && !props.node.expanded) planOpenklappen(props.node.id);
          else if (openklapId === props.node.id) stopOpenklappen();
        }}
        onDrop={(e) => {
          const ids = gesleept();
          const d = dropDoel();
          e.preventDefault();
          e.stopPropagation();
          stopSlepen();
          if (!ids || !d || d.id !== props.node.id) return;
          bladwijzers().then(m => m.moveBookmarks(ids, d.id, d.positie));
        }}
        onDragEnd={stopSlepen}
      >
        <span
          class={`bookmark-arrow${props.node.hasChildren ? ' has-children' : ' empty'}`}
          onClick={(e) => {
            e.stopPropagation();
            if (props.node.hasChildren) {
              import('../../../../ui/panels/bookmarks.js').then(m => m.toggleBookmarkExpand(props.node.id));
            }
          }}
        >
          {props.node.hasChildren ? (props.node.expanded ? '\u25BC' : '\u25B6') : ''}
        </span>
        <span class="bookmark-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        </span>
        <BookmarkTitle node={props.node} rename={props.rename}
          class={`bookmark-title${props.node.bold ? ' bold' : ''}${props.node.italic ? ' italic' : ''}`}
          style={props.node.color ? { color: weergaveKleur(props.node.color, lijstAchtergrond()) } : {}}
        />
      </div>
      <Show when={props.node.hasChildren && props.node.expanded}>
        <div class="bookmark-children">
          <For each={props.node.children}>
            {(child) => <BookmarkNode node={child} depth={props.depth + 1} huidig={props.huidig} rename={props.rename} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

export default function BookmarksPanel() {
  const { t } = useTranslation('properties');
  const disabled = () => toolbarDisabled();
  let lijstRef;
  let zoekRef;
  const [geenTreffer, setGeenTreffer] = createSignal(false);
  const [renameSession, setRenameSession] = createSignal(null);
  const rename = {
    session: renameSession,
    start(id) {
      const doc = getActiveDocument();
      const bm = doc?.bookmarks?.find(b => b.id === id);
      if (!bm || isPdfAReadOnly()) return;
      setRenameSession({ doc, id, title: bm.title, draft: bm.title || '' });
    },
    change(draft) { setRenameSession(s => s && ({ ...s, draft })); },
    finish(save, focusList = false) {
      const session = renameSession();
      setRenameSession(null);
      if (focusList) lijstRef?.focus({ preventScroll: true });
      if (save && session) import('../../../../ui/panels/bookmarks.js').then(m =>
        m.renameBookmarkTitle(session.doc, session.id, session.draft, session.title));
    },
  };
  createEffect(() => {
    const session = renameSession();
    if (session && (session.doc !== getActiveDocument() || isPdfAReadOnly()
        || !session.doc.bookmarks.some(b => b.id === session.id))) setRenameSession(null);
  });


  // De bladwijzer van de pagina in beeld: zachte achtergrond, hoe er ook
  // genavigeerd wordt (zelfde activePage als de actieve miniatuur).
  const huidig = createMemo(() => huidigeBladwijzer(tree(), activePage()));
  const paneelOpen = () => activeTab() === 'bookmarks' && !collapsed();

  // Schuif een bladwijzer in beeld binnen de lijst (niet de panelen eromheen).
  function scrollNaar(id, modus) {
    if (!id || !lijstRef) return;
    const el = lijstRef.querySelector(`[data-bm-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const top = scrollVoorItem(lijstRef.getBoundingClientRect(), el.getBoundingClientRect(), lijstRef.scrollTop, modus);
    if (top != null) lijstRef.scrollTop = top;
  }

  // Volgt de pagina: staat de huidige bladwijzer buiten beeld, dan schuift
  // hij erin. Een frame later, zodat een net ververste boom er al staat.
  createEffect(on([huidig, paneelOpen], ([id, open]) => {
    if (id && open) requestAnimationFrame(() => scrollNaar(id, 'nearest'));
  }));

  onCleanup(stopSlepen);

  // Slepen boven de lijst zelf: dicht bij de rand schuift hij mee; in de lege
  // ruimte onder de laatste rij valt de selectie achteraan in de wortel.
  function onLijstSleep(e) {
    const ids = gesleept();
    if (!ids || !lijstRef) return;
    const rect = lijstRef.getBoundingClientRect();
    const rand = 24;
    if (e.clientY < rect.top + rand) lijstRef.scrollTop -= 12;
    else if (e.clientY > rect.bottom - rand) lijstRef.scrollTop += 12;
    if (e.target !== lijstRef) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    stopOpenklappen();
    if (dropDoel()?.id !== null || dropDoel()?.positie !== 'end') setDropDoel({ id: null, positie: 'end' });
  }

  function onLijstDrop(e) {
    const ids = gesleept();
    const d = dropDoel();
    e.preventDefault();
    stopSlepen();
    if (!ids || !d || d.id !== null) return;
    import('../../../../ui/panels/bookmarks.js').then(m => m.moveBookmarks(ids, null, 'end'));
  }

  // Klik in de lege ruimte van de lijst wist de selectie; Esc ook.
  function onLijstKlik(e) {
    if (e.target !== lijstRef) return;
    import('../../../../ui/panels/bookmarks.js').then(m => m.clearBookmarkSelection());
  }

  function onLijstToets(e) {
    if (e.key === 'F2' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      e.preventDefault(); e.stopPropagation(); rename.start(selectedId()); return;
    }
    if (e.key !== 'Escape' || selectedIds().length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    import('../../../../ui/panels/bookmarks.js').then(m => m.clearBookmarkSelection());
  }

  // Thema gewisseld: achtergrond opnieuw meten (data-theme staat dan al).
  createEffect(on(currentTheme, () => {
    requestAnimationFrame(() => { if (lijstRef) setLijstAchtergrond(achtergrondVan(lijstRef)); });
  }));

  function wisZoeken() {
    if (zoekRef) zoekRef.value = '';
    setGevondenId(null);
    setGeenTreffer(false);
  }

  // Ander document in beeld: de ids beginnen per document opnieuw (bm_1 ...),
  // dus een oude treffer zou een willekeurige bladwijzer markeren.
  let laatsteDocId;
  createEffect(on(tree, () => {
    const docId = getActiveDocument()?.id ?? null;
    if (docId === laatsteDocId) return;
    laatsteDocId = docId;
    wisZoeken();
    if (paneelOpen()) requestAnimationFrame(() => scrollNaar(huidig(), 'nearest'));
  }));

  function zoek(tekst, naId) {
    const id = volgendeTreffer(tree(), tekst, naId);
    setGevondenId(id);
    setGeenTreffer(String(tekst).trim() !== '' && !id);
    return id;
  }

  // Klap de ouders van de treffer open en zet hem midden in de lijst.
  async function toon(id) {
    if (!id) return;
    const m = await import('../../../../ui/panels/bookmarks.js');
    m.revealBookmark(id);
    requestAnimationFrame(() => scrollNaar(id, 'center'));
  }

  function onZoekInvoer() {
    toon(zoek(zoekRef.value, null));
  }

  async function onZoekToets(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      wisZoeken();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    let id = gevondenId();
    // De eerste Enter opent de treffer; elke volgende gaat naar de volgende.
    if (!id || selectedId() === id) {
      id = zoek(zoekRef.value, id);
      if (!id) return;
      await toon(id);
    }
    const m = await import('../../../../ui/panels/bookmarks.js');
    m.selectBookmark(id);
    zoekRef?.focus();
  }

  return (
    <div class={`left-panel-content${activeTab() === 'bookmarks' ? ' active' : ''}`} id="bookmarks-panel">
      <div class="left-panel-header">
        <span>{t('leftPanel.bookmarks')}</span>
        <input
          ref={zoekRef}
          class="bookmarks-search"
          classList={{ 'no-match': geenTreffer() }}
          type="text"
          spellcheck={false}
          autocomplete="off"
          disabled={!!emptyMessage()}
          placeholder={t('leftPanel.findBookmark')}
          title={t('leftPanel.findBookmarkTip')}
          aria-label={t('leftPanel.findBookmark')}
          onInput={onZoekInvoer}
          onKeyDown={onZoekToets}
        />
      </div>
      <div class="bookmarks-toolbar">
        <button
          class="bookmarks-toolbar-btn"
          title={t('leftPanel.addBookmark')}
          disabled={disabled().add}
          onClick={() => import('../../../../ui/panels/bookmarks.js').then(m => m.addBookmark())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button
          class="bookmarks-toolbar-btn"
          title={t('leftPanel.addChildBookmark')}
          disabled={disabled().addChild}
          onClick={() => import('../../../../ui/panels/bookmarks.js').then(m => m.addChildBookmark())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="14" y1="7" x2="14" y2="17"/><line x1="9" y1="12" x2="19" y2="12"/><line x1="5" y1="5" x2="5" y2="19"/></svg>
        </button>
        <button
          class="bookmarks-toolbar-btn"
          title={t('leftPanel.editBookmark')}
          disabled={disabled().edit}
          onClick={() => import('../../../../ui/panels/bookmarks.js').then(m => m.editBookmark())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button
          class="bookmarks-toolbar-btn"
          title={t('leftPanel.deleteBookmark')}
          disabled={disabled().delete}
          onClick={() => import('../../../../ui/panels/bookmarks.js').then(m => m.deleteBookmark())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
      <div
        class="bookmarks-container"
        classList={{ 'drop-end': dropDoel()?.id === null && dropDoel()?.positie === 'end' }}
        ref={lijstRef}
        tabIndex={-1}
        onMouseDown={e => { if (!e.target.closest('input,textarea,button')) lijstRef.focus({ preventScroll: true }); }}
        onClick={onLijstKlik}
        on:keydown={onLijstToets}
        onDragOver={onLijstSleep}
        onDrop={onLijstDrop}
        onDragLeave={(e) => {
          // De lijst helemaal uit: geen doel meer tonen.
          if (!lijstRef?.contains(e.relatedTarget)) setDropDoel(null);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          showBookmarkMenu(e.clientX, e.clientY);
        }}
      >
        <Show when={emptyMessage()}>
          <div class="bookmarks-empty">{emptyMessage()}</div>
        </Show>
        <Show when={!emptyMessage()}>
          <For each={tree()}>
            {(node) => <BookmarkNode node={node} depth={0} huidig={huidig} rename={rename} />}
          </For>
        </Show>
      </div>
      <div class="bookmarks-count">{countText()}</div>
    </div>
  );
}
