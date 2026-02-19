import { For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { BUILT_IN_STAMPS } from '../../../annotations/stamps.js';

export default function StampPickerDialog(props) {
  const cancel = () => { closeDialog('stamp-picker'); };

  function handleStampClick(stamp) {
    if (props.data?.onSelect) props.data.onSelect(stamp);
    closeDialog('stamp-picker');
  }

  function handleCustomClick() {
    if (props.data?.onCustom) props.data.onCustom();
    closeDialog('stamp-picker');
  }

  return (
    <Dialog
      title="Select Stamp"
      overlayClass="stamp-picker-overlay"
      dialogClass="stamp-picker-dialog"
      onClose={cancel}
    >
      <div style={{
        display: 'grid',
        'grid-template-columns': 'repeat(2, 1fr)',
        gap: '8px'
      }}>
        <For each={BUILT_IN_STAMPS}>
          {(stamp) => (
            <button
              style={{
                border: `2px solid ${stamp.color}`,
                background: 'transparent',
                padding: '8px 12px',
                cursor: 'pointer',
                'font-weight': 'bold',
                'font-size': '12px',
                color: stamp.color,
                'text-align': 'center',
                'letter-spacing': '1px',
                'border-radius': '0'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = stamp.color + '15'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              onClick={() => handleStampClick(stamp)}
            >
              {stamp.text}
            </button>
          )}
        </For>
        <button
          style={{
            border: '2px dashed #999',
            background: 'transparent',
            padding: '8px 12px',
            cursor: 'pointer',
            'font-size': '12px',
            color: '#666',
            'grid-column': 'span 2',
            'border-radius': '0'
          }}
          onClick={handleCustomClick}
        >
          Custom Stamp from Image...
        </button>
      </div>
    </Dialog>
  );
}
