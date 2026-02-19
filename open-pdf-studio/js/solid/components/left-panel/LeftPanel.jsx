import { For } from 'solid-js';
import { activeTab, collapsed, toggleLeftPanelCollapsed } from '../../stores/leftPanelStore.js';
import LeftPanelTab from './LeftPanelTab.jsx';
import {
  thumbnailsIcon, bookmarksIcon, annotationsIcon, attachmentsIcon,
  signaturesIcon, layersIcon, formFieldsIcon, destinationsIcon,
  tagsIcon, linksIcon, toggleIcon
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

const TABS = [
  { panelId: 'thumbnails', title: 'Page Thumbnails', label: 'Pages', icon: thumbnailsIcon },
  { panelId: 'bookmarks', title: 'Bookmarks', label: 'Bookmarks', icon: bookmarksIcon },
  { panelId: 'annotations', title: 'Annotations', label: 'Annotations', icon: annotationsIcon },
  { panelId: 'attachments', title: 'Attachments', label: 'Attachments', icon: attachmentsIcon },
  { panelId: 'signatures', title: 'Digital Signatures', label: 'Signatures', icon: signaturesIcon },
  { panelId: 'layers', title: 'Layers', label: 'Layers', icon: layersIcon },
  { panelId: 'form-fields', title: 'Form Fields', label: 'Form Fields', icon: formFieldsIcon },
  { panelId: 'destinations', title: 'Destinations', label: 'Destinations', icon: destinationsIcon },
  { panelId: 'tags', title: 'Tags', label: 'Tags', icon: tagsIcon },
  { panelId: 'links', title: 'Links', label: 'Links', icon: linksIcon },
];

export default function LeftPanel() {
  return (
    <>
    <div class={`left-panel${collapsed() ? ' collapsed' : ''}`} id="left-panel">
      <div class="left-panel-tabs">
        <For each={TABS}>
          {(tab) => (
            <LeftPanelTab
              panelId={tab.panelId}
              title={tab.title}
              label={tab.label}
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
      </div>

      <button class="left-panel-toggle" id="left-panel-toggle" title="Toggle Panel" onClick={toggleLeftPanelCollapsed}>
        <span innerHTML={toggleIcon}></span>
      </button>
    </div>
    <div class="panel-resize-handle" id="left-panel-resize"></div>
    </>
  );
}
