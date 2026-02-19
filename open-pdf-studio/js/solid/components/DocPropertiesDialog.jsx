import { For } from 'solid-js';
import Dialog from './Dialog.jsx';
import { closeDialog } from '../stores/dialogStore.js';

function PropRow(props) {
  return (
    <div class="doc-props-row">
      <span class="doc-props-label">{props.label}</span>
      <span class="doc-props-value">{props.value}</span>
    </div>
  );
}

export default function DocPropertiesDialog(props) {
  const d = props.data;

  const close = () => closeDialog('doc-properties');

  return (
    <Dialog
      title="Document Properties"
      overlayClass="doc-props-overlay"
      dialogClass="doc-props-dialog"
      bodyClass="doc-props-content"
      footerClass="doc-props-footer"
      onClose={close}
      footer={<button onClick={close}>OK</button>}
    >
      <div class="doc-props-section">
        <h3>File</h3>
        <PropRow label="File Name:" value={d.fileName} />
        <PropRow label="File Path:" value={d.filePath} />
        <PropRow label="File Size:" value={d.fileSize} />
      </div>
      <div class="doc-props-section">
        <h3>Document</h3>
        <PropRow label="Title:" value={d.title} />
        <PropRow label="Author:" value={d.author} />
        <PropRow label="Subject:" value={d.subject} />
        <PropRow label="Keywords:" value={d.keywords} />
        <PropRow label="Creator:" value={d.creator} />
        <PropRow label="Producer:" value={d.producer} />
      </div>
      <div class="doc-props-section">
        <h3>PDF Information</h3>
        <PropRow label="PDF Version:" value={d.pdfVersion} />
        <PropRow label="Page Count:" value={d.pageCount} />
        <PropRow label="Page Size:" value={d.pageSize} />
        <PropRow label="Creation Date:" value={d.created} />
        <PropRow label="Modified Date:" value={d.modified} />
      </div>
    </Dialog>
  );
}
