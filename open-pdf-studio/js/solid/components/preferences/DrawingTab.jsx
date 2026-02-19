import PrefColorPicker from './PrefColorPicker.jsx';

export default function DrawingTab(props) {
  const p = props.prefs;
  return (
    <>
      <div class="preferences-section">
        <h3>Freehand Defaults</h3>
        <div class="pref-row">
          <label>Stroke Color</label>
          <PrefColorPicker value={p.drawStrokeColor[0]} setValue={p.drawStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>Line Width</label>
          <input type="number" min="1" max="20" value={p.drawLineWidth[0]()} onInput={e => p.drawLineWidth[1](parseInt(e.target.value) || 3)} />
        </div>
        <div class="pref-row">
          <label>Opacity (%)</label>
          <input type="number" min="10" max="100" value={p.drawOpacity[0]()} onInput={e => p.drawOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>Line Defaults</h3>
        <div class="pref-row">
          <label>Stroke Color</label>
          <PrefColorPicker value={p.lineStrokeColor[0]} setValue={p.lineStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>Line Width</label>
          <input type="number" min="1" max="20" value={p.lineLineWidth[0]()} onInput={e => p.lineLineWidth[1](parseInt(e.target.value) || 2)} />
        </div>
        <div class="pref-row">
          <label>Border Style</label>
          <select value={p.lineBorderStyle[0]()} onChange={e => p.lineBorderStyle[1](e.target.value)}>
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </div>
        <div class="pref-row">
          <label>Opacity (%)</label>
          <input type="number" min="10" max="100" value={p.lineOpacity[0]()} onInput={e => p.lineOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>Arrow Defaults</h3>
        <div class="pref-row">
          <label>Stroke Color</label>
          <PrefColorPicker value={p.arrowStrokeColor[0]} setValue={p.arrowStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>Fill Color</label>
          <PrefColorPicker value={p.arrowFillColor[0]} setValue={p.arrowFillColor[1]} />
        </div>
        <div class="pref-row">
          <label>Line Width</label>
          <input type="number" min="1" max="20" value={p.arrowLineWidth[0]()} onInput={e => p.arrowLineWidth[1](parseInt(e.target.value) || 2)} />
        </div>
        <div class="pref-row">
          <label>Border Style</label>
          <select value={p.arrowBorderStyle[0]()} onChange={e => p.arrowBorderStyle[1](e.target.value)}>
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </div>
        <div class="pref-row">
          <label>Start Head</label>
          <select value={p.arrowStartHead[0]()} onChange={e => p.arrowStartHead[1](e.target.value)}>
            <option value="none">None</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="diamond">Diamond</option>
            <option value="circle">Circle</option>
            <option value="square">Square</option>
            <option value="slash">Slash</option>
          </select>
        </div>
        <div class="pref-row">
          <label>End Head</label>
          <select value={p.arrowEndHead[0]()} onChange={e => p.arrowEndHead[1](e.target.value)}>
            <option value="none">None</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="diamond">Diamond</option>
            <option value="circle">Circle</option>
            <option value="square">Square</option>
            <option value="slash">Slash</option>
          </select>
        </div>
        <div class="pref-row">
          <label>Head Size</label>
          <input type="number" min="4" max="40" value={p.arrowHeadSize[0]()} onInput={e => p.arrowHeadSize[1](parseInt(e.target.value) || 12)} />
        </div>
        <div class="pref-row">
          <label>Opacity (%)</label>
          <input type="number" min="10" max="100" value={p.arrowOpacity[0]()} onInput={e => p.arrowOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>Polyline Defaults</h3>
        <div class="pref-row">
          <label>Stroke Color</label>
          <PrefColorPicker value={p.polylineStrokeColor[0]} setValue={p.polylineStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>Line Width</label>
          <input type="number" min="1" max="20" value={p.polylineLineWidth[0]()} onInput={e => p.polylineLineWidth[1](parseInt(e.target.value) || 2)} />
        </div>
        <div class="pref-row">
          <label>Opacity (%)</label>
          <input type="number" min="10" max="100" value={p.polylineOpacity[0]()} onInput={e => p.polylineOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
      </div>
    </>
  );
}
