import PrefColorPicker from './PrefColorPicker.jsx';

export default function AnnotationsTab(props) {
  const p = props.prefs;
  return (
    <>
      <div class="preferences-section">
        <h3>General Defaults</h3>
        <div class="pref-row">
          <label>Default Annotation Color</label>
          <PrefColorPicker value={p.defaultAnnotationColor[0]} setValue={p.defaultAnnotationColor[1]} />
        </div>
        <div class="pref-row">
          <label>Default Line Width</label>
          <input type="number" min="1" max="20" value={p.defaultLineWidth[0]()} onInput={e => p.defaultLineWidth[1](parseInt(e.target.value) || 3)} />
        </div>
        <div class="pref-row">
          <label>Default Font Size</label>
          <input type="number" min="8" max="72" value={p.defaultFontSize[0]()} onInput={e => p.defaultFontSize[1](parseInt(e.target.value) || 16)} />
        </div>
        <div class="pref-row">
          <label>Highlight Opacity (%)</label>
          <input type="number" min="10" max="100" value={p.highlightOpacity[0]()} onInput={e => p.highlightOpacity[1](parseInt(e.target.value) || 30)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>Text Box Defaults</h3>
        <div class="pref-row">
          <label>Fill Color</label>
          <PrefColorPicker value={p.textboxFillColor[0]} setValue={p.textboxFillColor[1]} noneChecked={p.textboxFillNone[0]} setNoneChecked={p.textboxFillNone[1]} />
        </div>
        <div class="pref-row">
          <label>Stroke Color</label>
          <PrefColorPicker value={p.textboxStrokeColor[0]} setValue={p.textboxStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>Border Width</label>
          <input type="number" min="0" max="10" value={p.textboxBorderWidth[0]()} onInput={e => p.textboxBorderWidth[1](parseInt(e.target.value) || 1)} />
        </div>
        <div class="pref-row">
          <label>Border Style</label>
          <select value={p.textboxBorderStyle[0]()} onChange={e => p.textboxBorderStyle[1](e.target.value)}>
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </div>
        <div class="pref-row">
          <label>Opacity (%)</label>
          <input type="number" min="10" max="100" value={p.textboxOpacity[0]()} onInput={e => p.textboxOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
        <div class="pref-row">
          <label>Font Size</label>
          <input type="number" min="8" max="72" value={p.textboxFontSize[0]()} onInput={e => p.textboxFontSize[1](parseInt(e.target.value) || 14)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>Callout Defaults</h3>
        <div class="pref-row">
          <label>Fill Color</label>
          <PrefColorPicker value={p.calloutFillColor[0]} setValue={p.calloutFillColor[1]} noneChecked={p.calloutFillNone[0]} setNoneChecked={p.calloutFillNone[1]} />
        </div>
        <div class="pref-row">
          <label>Stroke Color</label>
          <PrefColorPicker value={p.calloutStrokeColor[0]} setValue={p.calloutStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>Border Width</label>
          <input type="number" min="0" max="10" value={p.calloutBorderWidth[0]()} onInput={e => p.calloutBorderWidth[1](parseInt(e.target.value) || 1)} />
        </div>
        <div class="pref-row">
          <label>Border Style</label>
          <select value={p.calloutBorderStyle[0]()} onChange={e => p.calloutBorderStyle[1](e.target.value)}>
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </div>
        <div class="pref-row">
          <label>Opacity (%)</label>
          <input type="number" min="10" max="100" value={p.calloutOpacity[0]()} onInput={e => p.calloutOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
        <div class="pref-row">
          <label>Font Size</label>
          <input type="number" min="8" max="72" value={p.calloutFontSize[0]()} onInput={e => p.calloutFontSize[1](parseInt(e.target.value) || 14)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>Highlight Defaults</h3>
        <div class="pref-row">
          <label>Color</label>
          <PrefColorPicker value={p.highlightColor[0]} setValue={p.highlightColor[1]} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>Comment/Note Defaults</h3>
        <div class="pref-row">
          <label>Color</label>
          <PrefColorPicker value={p.commentColor[0]} setValue={p.commentColor[1]} />
        </div>
        <div class="pref-row">
          <label>Icon</label>
          <select value={p.commentIcon[0]()} onChange={e => p.commentIcon[1](e.target.value)}>
            <option value="comment">Comment</option>
            <option value="key">Key</option>
            <option value="note">Note</option>
            <option value="help">Help</option>
            <option value="newParagraph">New Paragraph</option>
            <option value="paragraph">Paragraph</option>
            <option value="insert">Insert</option>
          </select>
        </div>
      </div>
    </>
  );
}
