import { pdfjsRecord } from '../../pdf/pdfjs-record.js';
import i18next from '../../i18n/config.js';
import { getActiveDocument } from '../../core/state.js';
import { goToPage } from '../../pdf/renderer.js';
import { setDestinationItems as setItems, setDestinationCountText as setCountText, setDestinationEmptyMessage as setEmptyMessage } from '../../bridge.js';

let destinationsMap = {};

export async function navigateToDestination(name) {
  try {
    const dest = destinationsMap[name];
    if (dest && Array.isArray(dest) && dest[0]) {
      const pageRef = dest[0];
      if (pageRef.num !== undefined) {
        const activeDoc = getActiveDocument();
        if (activeDoc && activeDoc.pdfDoc) {
          const pageIndex = await activeDoc.pdfDoc.getPageIndex(pageRef);
          goToPage(pageIndex + 1);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to navigate to destination:', e);
  }
}

export async function updateDestinationsList() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    destinationsMap = {};
    setItems([]);
    setCountText(i18next.t('leftPanel.destinationsCount', { count: 0 }));
    setEmptyMessage(i18next.t('leftPanel.noDocumentOpen'));
    return;
  }

  setEmptyMessage(i18next.t('loading'));

  try {
    const pdfDoc = activeDoc.pdfDoc;

    if (typeof pdfDoc.getDestinations !== 'function') {
      destinationsMap = {};
      setItems([]);
      setCountText(i18next.t('leftPanel.destinationsCount', { count: 0 }));
      setEmptyMessage(i18next.t('leftPanel.noDestinations'));
      return;
    }

    const destinations = pdfjsRecord(await pdfDoc.getDestinations());

    if (!destinations || Object.keys(destinations).length === 0) {
      destinationsMap = {};
      setItems([]);
      setCountText(i18next.t('leftPanel.destinationsCount', { count: 0 }));
      setEmptyMessage(i18next.t('leftPanel.noDestinations'));
      return;
    }

    destinationsMap = destinations;
    const names = Object.keys(destinations).sort();

    setEmptyMessage(null);
    setItems(names.map(name => {
      const dest = destinations[name];
      let fitType = '';
      if (dest && Array.isArray(dest) && dest.length > 1) {
        fitType = dest[1]?.name || '';
      }
      return { name, fitType };
    }));
    setCountText(i18next.t('leftPanel.destinationsCount', { count: names.length }));
  } catch (e) {
    console.warn('Failed to load destinations:', e);
    destinationsMap = {};
    setItems([]);
    setCountText(i18next.t('leftPanel.destinationsCount', { count: 0 }));
    setEmptyMessage(i18next.t('leftPanel.couldNotLoadDestinations'));
  }
}
