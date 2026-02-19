import { For } from 'solid-js';
import { pageCount } from '../../../stores/panels/thumbnailStore.js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import ThumbnailItem from '../ThumbnailItem.jsx';

export default function ThumbnailsPanel() {
  const pages = () => {
    const count = pageCount();
    return Array.from({ length: count }, (_, i) => i + 1);
  };

  const handleNavigate = (pageNum) => {
    import('../../../../pdf/renderer.js').then(m => m.goToPage(pageNum));
  };

  const handleReorder = async (fromPage, toPage, dropBefore) => {
    const { reorderPages } = await import('../../../../pdf/page-manager.js');
    const numPages = pageCount();
    const currentOrder = Array.from({ length: numPages }, (_, i) => i + 1);
    const fromIdx = currentOrder.indexOf(fromPage);
    currentOrder.splice(fromIdx, 1);
    let toIdx = currentOrder.indexOf(toPage);
    if (!dropBefore) toIdx++;
    currentOrder.splice(toIdx, 0, fromPage);
    await reorderPages(currentOrder);
  };

  return (
    <div class={`left-panel-content${activeTab() === 'thumbnails' ? ' active' : ''}`} id="thumbnails-panel">
      <div class="left-panel-header">
        <span>Page Thumbnails</span>
      </div>
      <div class="thumbnails-container" id="thumbnails-container">
        <For each={pages()}>
          {(pageNum) => (
            <ThumbnailItem
              pageNum={pageNum}
              onNavigate={handleNavigate}
              onReorder={handleReorder}
            />
          )}
        </For>
      </div>
    </div>
  );
}
