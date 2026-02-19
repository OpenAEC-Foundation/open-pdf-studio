import { visible, message } from '../stores/loadingStore.js';

export default function LoadingOverlay() {
  return (
    <div class="loading-overlay" classList={{ visible: visible() }}>
      <div class="loading-content">
        <div class="loading-spinner"></div>
        <div class="loading-text">{message()}</div>
      </div>
    </div>
  );
}
