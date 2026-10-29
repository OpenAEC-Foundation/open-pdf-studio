import { createSignal } from 'solid-js';

const [visible, setVisible] = createSignal(false);
const [message, setMessage] = createSignal('Loading...');
// Optioneel: voortgang 0..1 (null = alleen de draaiende cirkel) en een
// annuleerfunctie (null = geen knop). Zie showLoading in ui/chrome/dialogs.js.
const [progress, setProgress] = createSignal(null);
const [cancelHandler, setCancelHandler] = createSignal(null);
// De knop staat er wel, maar uit: het werk is voorbij het punt waarop het nog
// te annuleren was (bv. een save die het bestand al vervangt, #766).
const [cancelDisabled, setCancelDisabled] = createSignal(false);

export {
  visible, setVisible, message, setMessage,
  progress, setProgress, cancelHandler, setCancelHandler,
  cancelDisabled, setCancelDisabled,
};
