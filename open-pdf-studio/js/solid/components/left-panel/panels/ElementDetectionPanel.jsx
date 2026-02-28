import { For, Show } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import {
  walls, rooms, grids,
  isDetecting, detectedPage,
  showWalls, showRooms, showGrids,
  selectedElement,
  countText, emptyMessage,
  filteredStats,
} from '../../../stores/panels/elementDetectionStore.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';

export default function ElementDetectionPanel() {
  const { t } = useTranslation('properties');

  const handleDetect = () => {
    import('../../../../ui/panels/element-detection.js').then(m => m.runDetection());
  };

  const handleClear = () => {
    import('../../../../ui/panels/element-detection.js').then(m => m.clearDetection());
  };

  const handleToggleType = (type, checked) => {
    import('../../../../ui/panels/element-detection.js').then(m => m.toggleTypeVisibility(type, checked));
  };

  const handleSelectElement = (element) => {
    import('../../../../ui/panels/element-detection.js').then(m => m.selectElement(element));
  };

  return (
    <div class={`left-panel-content${activeTab() === 'elements' ? ' active' : ''}`} id="elements-panel">
      <div class="left-panel-header">
        <span>{t('leftPanel.elements')}</span>
      </div>

      <div class="elements-toolbar">
        <button
          class="elements-toolbar-btn primary"
          onClick={handleDetect}
          disabled={isDetecting()}
        >
          {isDetecting() ? t('leftPanel.elementsDetecting') : t('leftPanel.elementsDetect')}
        </button>
        <button
          class="elements-toolbar-btn"
          onClick={handleClear}
          disabled={isDetecting() || (!walls().length && !rooms().length && !grids().length)}
        >
          {t('leftPanel.elementsClear')}
        </button>
      </div>

      <div class="elements-container">
        <Show when={emptyMessage()}>
          <div class="elements-empty">{emptyMessage()}</div>
        </Show>

        <Show when={!emptyMessage()}>
          {/* Walls section */}
          <Show when={walls().length > 0}>
            <div class="elements-section-header">
              <label class="elements-type-toggle" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={showWalls()}
                  onChange={(e) => handleToggleType('walls', e.target.checked)}
                />
              </label>
              <span class="elements-section-color wall-color"></span>
              <span>{t('leftPanel.elementsWalls')} ({walls().length})</span>
            </div>
            <Show when={showWalls()}>
              <For each={walls()}>
                {(wall) => (
                  <div
                    class={`element-list-item${selectedElement()?.id === wall.id ? ' selected' : ''}`}
                    onClick={() => handleSelectElement(wall)}
                  >
                    <span class="element-list-color wall-color"></span>
                    <div class="element-list-info">
                      <div class="element-list-type">
                        {t('leftPanel.elementsWall')} - {wall.orientation}
                      </div>
                      <div class="element-list-detail">
                        {wall.lengthFormatted} x {wall.thicknessFormatted}
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </Show>

          {/* Rooms section */}
          <Show when={rooms().length > 0}>
            <div class="elements-section-header">
              <label class="elements-type-toggle" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={showRooms()}
                  onChange={(e) => handleToggleType('rooms', e.target.checked)}
                />
              </label>
              <span class="elements-section-color room-color"></span>
              <span>{t('leftPanel.elementsRooms')} ({rooms().length})</span>
            </div>
            <Show when={showRooms()}>
              <For each={rooms()}>
                {(room) => (
                  <div
                    class={`element-list-item${selectedElement()?.id === room.id ? ' selected' : ''}`}
                    onClick={() => handleSelectElement(room)}
                  >
                    <span class="element-list-color room-color"></span>
                    <div class="element-list-info">
                      <div class="element-list-type">{room.label}</div>
                      <div class="element-list-detail">{room.areaFormatted}</div>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </Show>

          {/* Grids section */}
          <Show when={grids().length > 0}>
            <div class="elements-section-header">
              <label class="elements-type-toggle" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={showGrids()}
                  onChange={(e) => handleToggleType('grids', e.target.checked)}
                />
              </label>
              <span class="elements-section-color grid-color"></span>
              <span>{t('leftPanel.elementsGrids')} ({grids().length})</span>
            </div>
            <Show when={showGrids()}>
              <For each={grids()}>
                {(grid) => (
                  <div
                    class={`element-list-item${selectedElement()?.id === grid.id ? ' selected' : ''}`}
                    onClick={() => handleSelectElement(grid)}
                  >
                    <span class="element-list-color grid-color"></span>
                    <div class="element-list-info">
                      <div class="element-list-type">
                        {t('leftPanel.elementsGrid')} - {grid.orientation}
                      </div>
                      <div class="element-list-detail">
                        {grid.count} lines, {grid.spacingFormatted} spacing
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </div>

      <div class="elements-count">
        {countText()}
        <Show when={filteredStats()}>
          {(stats) => (
            <div class="elements-filtered-stats">
              filtered: {stats().thinLines} thin, {stats().hatching} hatching, {stats().dimensions} dim
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
