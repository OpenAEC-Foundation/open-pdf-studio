import { createSignal, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { state } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';

export default function CalibrationDialog(props) {
  const [distance, setDistance] = createSignal(1);
  const [unit, setUnit] = createSignal('px');
  const [pixels, setPixels] = createSignal(72);

  onMount(() => {
    const ms = state.preferences.measureScale;
    if (ms) {
      setUnit(ms.unit || 'px');
    }
  });

  const cancel = () => { closeDialog('calibration'); };

  function handleApply() {
    const d = parseFloat(distance());
    const p = parseFloat(pixels());
    if (d > 0 && p > 0) {
      state.preferences.measureScale = { pixelsPerUnit: p / d, unit: unit() };
      savePreferences();
    }
    closeDialog('calibration');
  }

  function handleReset() {
    delete state.preferences.measureScale;
    savePreferences();
    closeDialog('calibration');
  }

  const footer = (
    <div style={{ display: 'flex', 'justify-content': 'flex-end', gap: '8px' }}>
      <button
        style={{
          padding: '4px 12px',
          border: '1px solid #ccc',
          background: '#fff',
          cursor: 'pointer',
          'font-size': '12px',
          'border-radius': '0'
        }}
        onClick={handleReset}
      >
        Reset
      </button>
      <button
        style={{
          padding: '4px 12px',
          border: '1px solid #0078d4',
          background: '#0078d4',
          color: '#fff',
          cursor: 'pointer',
          'font-size': '12px',
          'border-radius': '0'
        }}
        onClick={handleApply}
      >
        Apply
      </button>
    </div>
  );

  return (
    <Dialog
      title="Scale Calibration"
      overlayClass="calibration-overlay"
      dialogClass="calibration-dialog"
      onClose={cancel}
      footer={footer}
    >
      <p style={{ 'font-size': '12px', color: '#666', margin: '0 0 12px 0' }}>
        Draw a measurement line of known length, then enter the real-world distance here.
      </p>
      <div style={{ display: 'flex', gap: '8px', 'align-items': 'center', 'margin-bottom': '12px' }}>
        <label style={{ 'font-size': '13px' }}>Known distance:</label>
        <input
          type="number"
          style={{ width: '80px', padding: '4px', border: '1px solid #ccc', 'border-radius': '0' }}
          min="0.01"
          step="0.01"
          value={distance()}
          onInput={(e) => setDistance(e.target.value)}
        />
        <select
          style={{ padding: '4px', border: '1px solid #ccc', 'border-radius': '0' }}
          value={unit()}
          onChange={(e) => setUnit(e.target.value)}
        >
          <option value="mm">mm</option>
          <option value="cm">cm</option>
          <option value="in">in</option>
          <option value="pt">pt</option>
          <option value="px">px</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: '8px', 'align-items': 'center', 'margin-bottom': '12px' }}>
        <label style={{ 'font-size': '13px' }}>Measured pixels:</label>
        <input
          type="number"
          style={{ width: '80px', padding: '4px', border: '1px solid #ccc', 'border-radius': '0' }}
          min="1"
          value={pixels()}
          onInput={(e) => setPixels(e.target.value)}
        />
      </div>
    </Dialog>
  );
}
