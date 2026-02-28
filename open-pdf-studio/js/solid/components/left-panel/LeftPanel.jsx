import { For } from 'solid-js';
import { activeTab, collapsed, toggleLeftPanelCollapsed } from '../../stores/leftPanelStore.js';
import LeftPanelTab from './LeftPanelTab.jsx';
import {
  thumbnailsIcon, bookmarksIcon, annotationsIcon, attachmentsIcon,
  signaturesIcon, layersIcon, formFieldsIcon, destinationsIcon,
  tagsIcon, linksIcon, measurementsIcon, elementsIcon, toggleIcon
} from '../../data/leftPanelIcons.js';
import ThumbnailsPanel from './panels/ThumbnailsPanel.jsx';
import BookmarksPanel from './panels/BookmarksPanel.jsx';
import AnnotationsPanel from './panels/AnnotationsPanel.jsx';
import AttachmentsPanel from './panels/AttachmentsPanel.jsx';
import SignaturesPanel from './panels/SignaturesPanel.jsx';
import LayersPanel from './panels/LayersPanel.jsx';
import FormFieldsPanel from './panels/FormFieldsPanel.jsx';
import DestinationsPanel from './panels/DestinationsPanel.jsx';
import TagsPanel from './panels/TagsPanel.jsx';
import LinksPanel from './panels/LinksPanel.jsx';
import MeasurementsPanel from './panels/MeasurementsPanel.jsx';
import ElementDetectionPanel from './panels/ElementDetectionPanel.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function LeftPanel() {
  const { t } = useTranslation('properties');

  const TABS = [
    { panelId: 'thumbnails', title: () => t('leftPanel.thumbnails'), label: () => t('docInfo.pages'), icon: thumbnailsIcon },
    { panelId: 'bookmarks', title: () => t('leftPanel.bookmarks'), label: () => t('leftPanel.bookmarks'), icon: bookmarksIcon },
    { panelId: 'annotations', title: () => t('leftPanel.annotations'), label: () => t('leftPanel.annotations'), icon: annotationsIcon },
    { panelId: 'attachments', title: () => t('leftPanel.attachments'), label: () => t('leftPanel.attachments'), icon: attachmentsIcon },
    { panelId: 'signatures', title: () => t('leftPanel.signatures'), label: () => t('leftPanel.signatures'), icon: signaturesIcon },
    { panelId: 'layers', title: () => t('leftPanel.layers'), label: () => t('leftPanel.layers'), icon: layersIcon },
    { panelId: 'form-fields', title: () => t('leftPanel.formFields'), label: () => t('leftPanel.formFields'), icon: formFieldsIcon },
    { panelId: 'destinations', title: () => t('leftPanel.destinations'), label: () => t('leftPanel.destinations'), icon: destinationsIcon },
    { panelId: 'tags', title: () => t('leftPanel.tags'), label: () => t('leftPanel.tags'), icon: tagsIcon },
    { panelId: 'links', title: () => t('leftPanel.links'), label: () => t('leftPanel.links'), icon: linksIcon },
    { panelId: 'measurements', title: () => t('leftPanel.measurements') || 'Measurements', label: () => t('leftPanel.measurements') || 'Measurements', icon: measurementsIcon },
    { panelId: 'elements', title: () => t('leftPanel.elements'), label: () => t('leftPanel.elements'), icon: elementsIcon },
  ];

  return (
    <>
    <div class={`left-panel${collapsed() ? ' collapsed' : ''}`} id="left-panel">
      <div class="left-panel-tabs">
        <For each={TABS}>
          {(tab) => (
            <LeftPanelTab
              panelId={tab.panelId}
              title={tab.title()}
              label={tab.label()}
              icon={tab.icon}
            />
          )}
        </For>
      </div>

      <div class="left-panel-body">
        <ThumbnailsPanel />

        <BookmarksPanel />
        <AnnotationsPanel />
        <AttachmentsPanel />
        <SignaturesPanel />
        <LayersPanel />
        <FormFieldsPanel />
        <DestinationsPanel />
        <TagsPanel />
        <LinksPanel />
        <MeasurementsPanel />
        <ElementDetectionPanel />
      </div>

      <button class="left-panel-toggle" id="left-panel-toggle" title={t('leftPanel.togglePanel')} onClick={toggleLeftPanelCollapsed}>
        <span innerHTML={toggleIcon}></span>
      </button>
    </div>
    <div class="panel-resize-handle" id="left-panel-resize"></div>
    </>
  );
}
