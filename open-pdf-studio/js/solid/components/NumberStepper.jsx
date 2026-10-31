import { For } from 'solid-js';
import { verwerkVerlaten } from '../../ui/getal-veld.js';

// Keep the existing locale-aware text field and its validation handlers.
export default function NumberStepper(props) {
  let root;
  return <span class="number-stepper" ref={root}>
    {props.children}
    <span class="number-stepper-buttons">
      <For each={[1, -1]}>{direction => <button type="button"
        aria-label={`${props.label} ${direction > 0 ? '+1' : '−1'}`}
        disabled={props.disabled || (direction > 0 ? props.value >= props.max : props.value <= props.min)}
        onMouseDown={e => e.preventDefault()}
        onClick={() => {
          verwerkVerlaten(root.querySelector('input'));
          props.onStep(direction);
        }}>{direction > 0 ? '▴' : '▾'}</button>}</For>
    </span>
  </span>;
}
