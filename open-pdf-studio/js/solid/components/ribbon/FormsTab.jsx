import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { textFieldIcon, checkboxIcon, radioIcon } from '../../data/ribbonIcons.js';

export default function FormsTab() {
  return (
    <div class="ribbon-content active" id="tab-forms">
      <div class="ribbon-groups">
        <RibbonGroup label="Form Fields">
          <RibbonButton id="form-text-field" title="Text Field" icon={textFieldIcon} label="Text Field" disabled={isPdfAReadOnly()} />
          <RibbonButton id="form-checkbox" title="Checkbox" icon={checkboxIcon} label="Checkbox" disabled={isPdfAReadOnly()} />
          <RibbonButton id="form-radio" title="Radio Button" icon={radioIcon} label="Radio" disabled={isPdfAReadOnly()} />
        </RibbonGroup>
      </div>
    </div>
  );
}
