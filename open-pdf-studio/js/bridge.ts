/**
 * Bridge module — the official interface for plain JavaScript code
 * to interact with the SolidJS UI layer.
 *
 * Instead of plain JS files importing directly from js/solid/stores/*,
 * they should import from this module. This provides:
 *
 * 1. A single, documented import source
 * 2. Domain-grouped APIs (dialogs, ribbon, panels, etc.)
 * 3. Decoupling — if store implementations change, only this file updates
 *
 * Usage:
 *   import { showMessage, openDialog } from '../bridge.js';
 *   import { switchRibbonTab, getColorPickerValue } from '../bridge.js';
 */

// ============= DIALOGS =============
export {
  openDialog,
  closeDialog,
  getDialogs,
  showMessage,
} from './solid/stores/dialogStore.js';

// ============= RIBBON =============
export {
  switchToTab as switchRibbonTab,
  activeTab as ribbonActiveTab,
  setActiveTab as setRibbonActiveTab,
  contextualTabsVisible,
  setContextualTabsVisible,
  getColorPickerValue,
  setColorPickerValue,
  getLineWidthValue,
  setLineWidthValue,
  currentTheme,
  setCurrentTheme,
} from './solid/stores/ribbonStore.js';

// ============= PROPERTIES PANEL =============
export {
  storeShowProperties,
  storeHideProperties,
  storeClosePanel,
  storeShowMultiSelection,
  storeShowTextEditProperties,
  populateDocInfo,
  updateAnnotProp,
  panelVisible as propertiesPanelVisible,
  setPanelVisible as setPropertiesPanelVisible,
  panelCollapsed as propertiesPanelCollapsed,
  setPanelCollapsed as setPropertiesPanelCollapsed,
  panelMode as propertiesPanelMode,
} from './solid/stores/propertiesStore.js';

// ============= FORMAT =============
export {
  syncFormatStore,
  applyToSelected,
} from './solid/stores/formatStore.js';

// ============= LEFT PANEL =============
export {
  switchToLeftPanelTab,
  toggleLeftPanelCollapsed,
  activeTab as leftPanelActiveTab,
  setActiveTab as setLeftPanelActiveTab,
  collapsed as leftPanelCollapsed,
  setCollapsed as setLeftPanelCollapsed,
} from './solid/stores/leftPanelStore.js';

// ============= CONTEXT MENU =============
export {
  showAnnotationMenu,
  showMultiAnnotationMenu,
  showPageMenu,
  showTextSelectionMenu,
  showBookmarkMenu,
  showThumbnailMenu,
  hideMenu,
} from './solid/stores/contextMenuStore.js';

// ============= FIND BAR =============
export {
  visible as findBarVisible,
  setVisible as setFindBarVisible,
  resultsText as findBarResultsText,
  setResultsText as setFindBarResultsText,
  messageText as findBarMessageText,
  setMessageText as setFindBarMessageText,
  notFound as findBarNotFound,
  setNotFound as setFindBarNotFound,
  navDisabled as findBarNavDisabled,
  setNavDisabled as setFindBarNavDisabled,
  searching as findBarSearching,
  setSearching as setFindBarSearching,
  replaceMode as findBarReplaceMode,
  setReplaceMode as setFindBarReplaceMode,
  replaceText as findBarReplaceText,
  setReplaceText as setFindBarReplaceText,
} from './solid/stores/findBarStore.js';

// ============= LOADING OVERLAY =============
export {
  visible as loadingVisible,
  setVisible as setLoadingVisible,
  message as loadingMessage,
  setMessage as setLoadingMessage,
} from './solid/stores/loadingStore.js';

// ============= APP MENU =============
export {
  openAppMenu,
  closeAppMenu,
  setActivePanel as setAppMenuPanel,
  isAppMenuOpen,
} from './solid/stores/appMenuStore.js';

// ============= STICKY NOTE POPUPS =============
export {
  openStickyPopup,
  closeStickyPopup,
  closeAllPopups,
  getOpenPopups,
} from './solid/stores/stickyNotePopupStore.js';

// ============= TEXT EDIT OVERLAY =============
export {
  showTextEditOverlay,
  hideTextEditOverlay,
  getTextValue as getTextEditValue,
  getHeightGrowth as getTextEditHeightGrowth,
} from './solid/stores/textEditOverlayStore.js';

// ============= STAVENREEKS INLINE INVOER =============
export {
  showStavenreeksInput,
  hideStavenreeksInput,
  stavenreeksInputActive,
} from './solid/stores/stavenreeksInputStore.js';

// ============= PARAMETRISCH LABEL INLINE INVOER =============
export {
  showParametricLabelInput,
  hideParametricLabelInput,
  parametricLabelInputActive,
} from './solid/stores/parametricLabelInputStore.js';

export {
  validateSymbolParams,
} from './solid/stores/parametricSymbolStore.js';

// ============= PDF TEXT EDITOR =============
export {
  showPdfTextEditor,
  hidePdfTextEditor,
  getEditorText as getPdfEditorText,
  getEditorLineRuns as getPdfEditorLineRuns,
  updateEditorStyle as updatePdfEditorStyle,
  shiftEditorPosition as shiftPdfEditorPosition,
} from './solid/stores/pdfTextEditStore.js';

// ============= SCREENSHOT =============
export {
  startScreenshot,
  endScreenshot,
} from './solid/stores/screenshotStore.js';

// ============= BARS =============
export {
  showFormFieldsBar,
  hideFormFieldsBar,
} from './solid/stores/formFieldsBarStore.js';

export {
  showPdfABar,
  hidePdfABar,
} from './solid/stores/pdfaBarStore.js';

export {
  showDefaultAppBar,
  hideDefaultAppBar,
} from './solid/stores/defaultAppBarStore.js';

// ============= FONTS =============
export {
  systemFontList,
  setSystemFontList,
} from './solid/stores/fontStore.js';

// ============= THUMBNAIL PANEL =============
export {
  setPageCount as setThumbnailPageCount,
  setActivePage as setThumbnailActivePage,
  setPlaceholderSize as setThumbnailPlaceholderSize,
  setThumbnailImage,
  clearAllThumbnails,
  removeThumbnailImage,
  getContainerRef as getThumbnailContainerRef,
  selectedPages as thumbnailSelectedPages,
  selectPage as selectThumbnailPage,
} from './solid/stores/panels/thumbnailStore.js';

// ============= PANEL DATA STORES =============
// These are used by js/ui/panels/*.js to push data into SolidJS panel components

export {
  setItems as setAnnotationItems,
  setCountText as setAnnotationCountText,
  setEmptyMessage as setAnnotationEmptyMessage,
  sortMode as annotationSortMode,
  filterMode as annotationFilterMode,
  setFilterMode as setAnnotationFilterMode,
  hiddenStatuses as annotationHiddenStatuses,
} from './solid/stores/panels/annotationsStore.js';

export {
  setGroups as setLinkGroups,
  setCountText as setLinkCountText,
  setEmptyMessage as setLinkEmptyMessage,
  setSelectedIndex as setLinkSelectedIndex,
  setToolbarDisabled as setLinkToolbarDisabled,
} from './solid/stores/panels/linksStore.js';

export {
  setItems as setAttachmentItems,
  setCountText as setAttachmentCountText,
  setEmptyMessage as setAttachmentEmptyMessage,
  setSelectedKey as setAttachmentSelectedKey,
  setToolbarDisabled as setAttachmentToolbarDisabled,
} from './solid/stores/panels/attachmentsStore.js';

export {
  setTree as setBookmarkTree,
  setCountText as setBookmarkCountText,
  setEmptyMessage as setBookmarkEmptyMessage,
  setSelectedId as setBookmarkSelectedId,
  setToolbarDisabled as setBookmarkToolbarDisabled,
} from './solid/stores/panels/bookmarksStore.js';

export {
  setItems as setSignatureItems,
  setCountText as setSignatureCountText,
  setEmptyMessage as setSignatureEmptyMessage,
} from './solid/stores/panels/signaturesStore.js';

export {
  setItems as setLayerItems,
  setCountText as setLayerCountText,
  setEmptyMessage as setLayerEmptyMessage,
} from './solid/stores/panels/layersStore.js';

export {
  setGroups as setFormFieldGroups,
  setCountText as setFormFieldCountText,
  setEmptyMessage as setFormFieldEmptyMessage,
} from './solid/stores/panels/formFieldsStore.js';

export {
  setItems as setDestinationItems,
  setCountText as setDestinationCountText,
  setEmptyMessage as setDestinationEmptyMessage,
} from './solid/stores/panels/destinationsStore.js';

export {
  setTree as setTagTree,
  setCountText as setTagCountText,
  setEmptyMessage as setTagEmptyMessage,
} from './solid/stores/panels/tagsStore.js';

