import { panelVisible } from '../../stores/propertiesStore.js';
import PanelHeader from './PanelHeader.jsx';
import DocInfoView from './DocInfoView.jsx';
import GeneralSection from './GeneralSection.jsx';
import RepliesSection from './RepliesSection.jsx';
import AppearanceSection from './AppearanceSection.jsx';
import LineEndingsSection from './LineEndingsSection.jsx';
import DimensionsSection from './DimensionsSection.jsx';
import TextFormatSection from './TextFormatSection.jsx';
import ParagraphSection from './ParagraphSection.jsx';
import ContentSection from './ContentSection.jsx';
import ImageSection from './ImageSection.jsx';
import ActionsSection from './ActionsSection.jsx';

export default function PropertiesPanel() {
  return (
    <div class={`properties-panel${panelVisible() ? ' visible' : ''}`} id="properties-panel"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}>
      <PanelHeader />
      <DocInfoView />
      <GeneralSection />
      <RepliesSection />
      <AppearanceSection />
      <LineEndingsSection />
      <DimensionsSection />
      <TextFormatSection />
      <ParagraphSection />
      <ContentSection />
      <ImageSection />
      <ActionsSection />
    </div>
  );
}
