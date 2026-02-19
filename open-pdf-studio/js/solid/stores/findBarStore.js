import { createSignal } from 'solid-js';

const [visible, setVisible] = createSignal(false);
const [resultsText, setResultsText] = createSignal('');
const [messageText, setMessageText] = createSignal('');
const [notFound, setNotFound] = createSignal(false);
const [navDisabled, setNavDisabled] = createSignal(true);

export {
  visible, setVisible,
  resultsText, setResultsText,
  messageText, setMessageText,
  notFound, setNotFound,
  navDisabled, setNavDisabled,
};
