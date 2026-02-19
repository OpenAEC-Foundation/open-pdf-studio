import { createEffect } from 'solid-js';
import {
  visible, resultsText, messageText, notFound, navDisabled,
} from '../stores/findBarStore.js';

export default function FindBar() {
  let inputRef;

  // Focus input when find bar becomes visible
  createEffect(() => {
    if (visible()) {
      // Delay to ensure DOM is updated
      setTimeout(() => {
        inputRef?.focus();
        inputRef?.select();
      }, 0);
    }
  });

  const handleClose = () => {
    import('../../search/find-bar.js').then(m => m.closeFindBar());
  };

  const handleInput = (e) => {
    import('../../search/find-bar.js').then(m => m.handleSearchInput(e.target.value));
  };

  const handleKeyDown = (e) => {
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (e.shiftKey) {
          import('../../search/find-bar.js').then(m => m.onFindPrevious());
        } else {
          import('../../search/find-bar.js').then(m => m.onFindNext());
        }
        break;
      case 'Escape':
        e.preventDefault();
        handleClose();
        break;
    }
  };

  const handlePrev = () => {
    import('../../search/find-bar.js').then(m => m.onFindPrevious());
  };

  const handleNext = () => {
    import('../../search/find-bar.js').then(m => m.onFindNext());
  };

  const handleMatchCase = (e) => {
    const checkboxes = e.target.closest('.find-options').querySelectorAll('input[type="checkbox"]');
    import('../../search/find-bar.js').then(m => m.onOptionsChange({
      matchCase: checkboxes[0].checked,
      wholeWord: checkboxes[1].checked,
    }));
  };

  const handleWholeWord = (e) => {
    const checkboxes = e.target.closest('.find-options').querySelectorAll('input[type="checkbox"]');
    import('../../search/find-bar.js').then(m => m.onOptionsChange({
      matchCase: checkboxes[0].checked,
      wholeWord: checkboxes[1].checked,
    }));
  };

  const handleHighlightAll = (e) => {
    import('../../search/find-bar.js').then(m => m.onHighlightChange(e.target.checked));
  };

  return (
    <div class="find-bar" classList={{ visible: visible() }}>
      <button class="find-close-btn" title="Close (Esc)" onClick={handleClose}>&times;</button>
      <div class="find-input-container">
        <input
          class="find-input"
          classList={{ 'not-found': notFound() }}
          placeholder="Find in document..."
          autocomplete="off"
          ref={inputRef}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div class="find-nav-buttons">
        <button class="find-nav-btn" title="Previous (Shift+Enter)" disabled={navDisabled()} onClick={handlePrev}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <button class="find-nav-btn" title="Next (Enter)" disabled={navDisabled()} onClick={handleNext}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </div>
      <span class="find-results-count">{resultsText()}</span>
      <span class="find-message" classList={{ 'not-found': notFound() }}>{messageText()}</span>
      <div class="find-options">
        <label class="find-option">
          <input type="checkbox" onChange={handleMatchCase} />
          <span>Match case</span>
        </label>
        <label class="find-option">
          <input type="checkbox" onChange={handleWholeWord} />
          <span>Whole words</span>
        </label>
        <label class="find-option">
          <input type="checkbox" checked onChange={handleHighlightAll} />
          <span>Highlight all</span>
        </label>
      </div>
    </div>
  );
}
