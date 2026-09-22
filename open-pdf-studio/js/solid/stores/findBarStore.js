import { createSignal } from 'solid-js';

const [visible, setVisible] = createSignal(false);
const [resultsText, setResultsText] = createSignal('');
const [messageText, setMessageText] = createSignal('');
const [notFound, setNotFound] = createSignal(false);
const [navDisabled, setNavDisabled] = createSignal(true);
const [searching, setSearching] = createSignal(false);
const [replaceMode, setReplaceMode] = createSignal(false);
const [replaceText, setReplaceText] = createSignal('');
// Zoekbronnen: de PDF-tekst en de tekst in annotaties (beide standaard aan).
const [searchInText, setSearchInText] = createSignal(true);
const [searchInAnnotations, setSearchInAnnotations] = createSignal(true);
// Resultatenlijst onder de zoekbalk: treffers per pagina + de pagina van de
// huidige treffer (voor het markeren van de actieve regel).
const [resultGroups, setResultGroups] = createSignal([]);
const [resultsOpen, setResultsOpen] = createSignal(true);
const [currentResultPage, setCurrentResultPage] = createSignal(0);
// Beide bronnen uit: geen resultaten, maar ook geen foutmelding.
const [sourcesOff, setSourcesOff] = createSignal(false);

export {
  visible, setVisible,
  resultsText, setResultsText,
  messageText, setMessageText,
  notFound, setNotFound,
  navDisabled, setNavDisabled,
  searching, setSearching,
  replaceMode, setReplaceMode,
  replaceText, setReplaceText,
  searchInText, setSearchInText,
  searchInAnnotations, setSearchInAnnotations,
  resultGroups, setResultGroups,
  resultsOpen, setResultsOpen,
  currentResultPage, setCurrentResultPage,
  sourcesOff, setSourcesOff,
};
