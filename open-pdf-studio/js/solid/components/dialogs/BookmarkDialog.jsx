import { createSignal, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';

export default function BookmarkDialog(props) {
  const [title, setTitle] = createSignal(props.data?.title || '');
  const [page, setPage] = createSignal(props.data?.page || 1);

  let titleInputRef;
  let resolved = false;

  const isEdit = () => !!props.data?.isEdit;
  const headerText = () => isEdit() ? 'Edit Bookmark' : 'Add Bookmark';

  onMount(() => {
    if (titleInputRef) {
      setTimeout(() => titleInputRef.focus(), 50);
    }
  });

  const cancel = () => {
    if (!resolved) {
      resolved = true;
      if (props.data?.onOk) props.data.onOk(null);
    }
    closeDialog('bookmark');
  };

  function handleOk() {
    const t = title().trim();
    if (!t) {
      if (titleInputRef) titleInputRef.focus();
      return;
    }
    let p = parseInt(page());
    if (isNaN(p) || p < 1) p = 1;
    resolved = true;
    if (props.data?.onOk) {
      props.data.onOk({ title: t, page: p });
    }
    closeDialog('bookmark');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      handleOk();
    }
  }

  const footer = (
    <div class="bookmark-dialog-footer">
      <button class="primary" onClick={handleOk}>OK</button>
      <button onClick={cancel}>Cancel</button>
    </div>
  );

  return (
    <Dialog
      title={headerText()}
      overlayClass="bookmark-dialog-overlay"
      dialogClass="bookmark-dialog"
      headerClass="bookmark-dialog-header"
      bodyClass="bookmark-dialog-body"
      footerClass=""
      onClose={cancel}
      footer={footer}
    >
      <label>Title:</label>
      <input
        ref={titleInputRef}
        type="text"
        placeholder="Bookmark title"
        value={title()}
        onInput={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <label>Page:</label>
      <input
        type="number"
        min="1"
        value={page()}
        onInput={(e) => setPage(e.target.value)}
        onKeyDown={handleKeyDown}
      />
    </Dialog>
  );
}
