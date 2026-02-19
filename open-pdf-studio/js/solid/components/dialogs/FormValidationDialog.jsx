import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';

export default function FormValidationDialog(props) {
  const message = () => props.data?.message || '';

  function handleClose() {
    if (props.data?.onOk) {
      props.data.onOk();
    }
    closeDialog('form-validation');
  }

  const footer = (
    <div class="form-validation-footer">
      <button class="form-validation-ok-btn" onClick={handleClose}>OK</button>
    </div>
  );

  return (
    <Dialog
      title="Validation Error"
      overlayClass="form-validation-overlay"
      dialogClass="form-validation-dialog"
      headerClass="form-validation-header"
      bodyClass="form-validation-body"
      footerClass=""
      onClose={handleClose}
      footer={footer}
    >
      <div class="form-validation-icon">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" fill="#e81123" />
          <rect x="14" y="8" width="4" height="12" rx="2" fill="white" />
          <circle cx="16" cy="24" r="2" fill="white" />
        </svg>
      </div>
      <div class="form-validation-text">{message()}</div>
    </Dialog>
  );
}
