import { createSignal } from 'solid-js';
import { magMelden } from '../../core/beheerd.js';

const [visible, setVisible] = createSignal(false);

// In de beheerde modus (OPENAEC_BEHEERD=1) blijft de vraag weg: de omgeving
// regelt de bestandskoppeling (core/beheerd.js).
export async function showDefaultAppBar() {
  if (!(await magMelden('standaard-app'))) return;
  setVisible(true);
}

export function hideDefaultAppBar() {
  setVisible(false);
}

export { visible };
