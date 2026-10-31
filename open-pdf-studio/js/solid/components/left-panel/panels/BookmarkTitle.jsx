import { Show } from 'solid-js';
import { useTranslation } from '../../../../i18n/useTranslation.js';

// The panel owns the draft so refreshing the tree during page navigation does
// not discard it. Removed inputs must not commit a draft during that refresh.
export default function BookmarkTitle(props) {
  const { t } = useTranslation('dialogs');
  const editing = () => props.rename.session()?.id === props.node.id;
  const stop = e => e.stopPropagation();
  return <Show when={editing()} fallback={
    <span class={props.class} style={props.style} onDblClick={e => {
      e.stopPropagation(); props.rename.start(props.node.id);
    }}>{props.node.title}</span>
  }>
    <input class="bookmark-title-input" type="text" spellcheck={false}
      aria-label={t('bookmark.titleLabel')} value={props.rename.session()?.draft || ''}
      ref={el => queueMicrotask(() => { if (el.isConnected) { el.focus({preventScroll:true}); el.select(); } })}
      onInput={e => props.rename.change(e.currentTarget.value)}
      onClick={stop} onDblClick={stop} onPointerDown={stop} onMouseDown={stop} onContextMenu={stop}
      on:keydown={e => {
        e.stopPropagation();
        if (e.isComposing) return;
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault(); props.rename.finish(e.key === 'Enter', true);
        }
      }}
      onBlur={e => {
        const el = e.currentTarget;
        const session = props.rename.session();
        queueMicrotask(() => {
          if (el.isConnected && props.rename.session() === session) props.rename.finish(true);
        });
      }}
    />
  </Show>;
}
