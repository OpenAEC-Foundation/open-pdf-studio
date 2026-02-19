import PrefColorPicker from './PrefColorPicker.jsx';

export default function MarkupTab(props) {
  const p = props.prefs;
  return (
    <>
      <div class="preferences-section">
        <h3>Redaction Defaults</h3>
        <div class="pref-row">
          <label>Overlay Color</label>
          <PrefColorPicker value={p.redactionOverlayColor[0]} setValue={p.redactionOverlayColor[1]} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>Measurement Defaults</h3>
        <div class="pref-row">
          <label>Stroke Color</label>
          <PrefColorPicker value={p.measureStrokeColor[0]} setValue={p.measureStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>Line Width</label>
          <input type="number" min="1" max="20" value={p.measureLineWidth[0]()} onInput={e => p.measureLineWidth[1](parseInt(e.target.value) || 1)} />
        </div>
        <div class="pref-row">
          <label>Opacity (%)</label>
          <input type="number" min="10" max="100" value={p.measureOpacity[0]()} onInput={e => p.measureOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
      </div>
    </>
  );
}
