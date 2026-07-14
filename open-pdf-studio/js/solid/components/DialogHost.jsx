import { For } from 'solid-js';
import { getDialogs } from '../stores/dialogStore.js';
import DocPropertiesDialog from './DocPropertiesDialog.jsx';
import PreferencesDialog from './preferences/PreferencesDialog.jsx';
import NewDocDialog from './dialogs/NewDocDialog.jsx';
import InsertPageDialog from './dialogs/InsertPageDialog.jsx';
import DeletePagesDialog from './dialogs/DeletePagesDialog.jsx';
import PagePropertiesDialog from './dialogs/PagePropertiesDialog.jsx';
import ExtractPagesDialog from './dialogs/ExtractPagesDialog.jsx';
import MergePdfsDialog from './dialogs/MergePdfsDialog.jsx';
import PrintDialog from './dialogs/PrintDialog.jsx';
import PrintQueueDialog from './dialogs/PrintQueueDialog.jsx';
import PageSetupDialog from './dialogs/PageSetupDialog.jsx';
import WatermarkDialog from './dialogs/WatermarkDialog.jsx';
import HeaderFooterDialog from './dialogs/HeaderFooterDialog.jsx';
import ManageWatermarksDialog from './dialogs/ManageWatermarksDialog.jsx';
import SignatureDialog from './dialogs/SignatureDialog.jsx';
import TextAnnotationDialog from './dialogs/TextAnnotationDialog.jsx';
import UpdateDialog from './dialogs/UpdateDialog.jsx';
import BookmarkDialog from './dialogs/BookmarkDialog.jsx';
import FormValidationDialog from './dialogs/FormValidationDialog.jsx';
import StampPickerDialog from './dialogs/StampPickerDialog.jsx';
import CalibrationDialog from './dialogs/CalibrationDialog.jsx';
import ScaleDialog from './dialogs/ScaleDialog.jsx';
import CropMarginsDialog from './dialogs/CropMarginsDialog.jsx';
import ResizePagesDialog from './dialogs/ResizePagesDialog.jsx';
import CompressDialog from './dialogs/CompressDialog.jsx';
import FeedbackDialog from './dialogs/FeedbackDialog.jsx';
import MessageDialog from './dialogs/MessageDialog.jsx';
import AboutDialog from './dialogs/AboutDialog.jsx';
import WhatsNewDialog from './dialogs/WhatsNewDialog.jsx';
import ShortcutsDialog from './dialogs/ShortcutsDialog.jsx';
import ExtensionsDialog from './dialogs/ExtensionsDialog.jsx';
import ConfirmDialog from './dialogs/ConfirmDialog.jsx';
import ViewportScaleDialog from './dialogs/ViewportScaleDialog.jsx';
import ScaleRegionDialog from './dialogs/ScaleRegionDialog.jsx';
import MeasuredLengthDialog from './dialogs/MeasuredLengthDialog.jsx';
import TitleBlockDialog from './dialogs/TitleBlockDialog.jsx';
import CompareDialog from './compare/CompareDialog.jsx';
import TextEditOverlay from './TextEditOverlay.jsx';
import PdfTextEditOverlay from './PdfTextEditOverlay.jsx';
import StickyNotePopupHost from './StickyNotePopup.jsx';
import ParametricSymbolPicker from './dialogs/ParametricSymbolPicker.jsx';
import StyleTypeEditorDialog from './dialogs/StyleTypeEditorDialog.jsx';
import PrintProgressToast from './PrintProgressToast.jsx';

const DIALOG_MAP = {
  'doc-properties': DocPropertiesDialog,
  'preferences': PreferencesDialog,
  'new-doc': NewDocDialog,
  'insert-page': InsertPageDialog,
  'style-type-editor': StyleTypeEditorDialog,
  'delete-pages': DeletePagesDialog,
  'page-properties': PagePropertiesDialog,
  'extract-pages': ExtractPagesDialog,
  'merge-pdfs': MergePdfsDialog,
  'print': PrintDialog,
  'print-queue': PrintQueueDialog,
  'page-setup': PageSetupDialog,
  'watermark': WatermarkDialog,
  'header-footer': HeaderFooterDialog,
  'manage-watermarks': ManageWatermarksDialog,
  'signature': SignatureDialog,
  'text-annotation': TextAnnotationDialog,
  'update': UpdateDialog,
  'bookmark': BookmarkDialog,
  'form-validation': FormValidationDialog,
  'stamp-picker': StampPickerDialog,
  'calibration': CalibrationDialog,
  'scale': ScaleDialog,
  'crop-margins': CropMarginsDialog,
  'resize-pages': ResizePagesDialog,
  'compress': CompressDialog,
  'feedback': FeedbackDialog,
  'message': MessageDialog,
  'about': AboutDialog,
  'whats-new': WhatsNewDialog,
  'shortcuts': ShortcutsDialog,
  'extensions': ExtensionsDialog,
  'confirm': ConfirmDialog,
  'title-block-edit': TitleBlockDialog,
  'viewport-scale': ViewportScaleDialog,
  'scale-region': ScaleRegionDialog,
  'measured-length': MeasuredLengthDialog,
  'compare': CompareDialog,
};

export default function DialogHost() {
  return (
    <>
      <For each={getDialogs()}>
        {(dialog) => {
          const Component = DIALOG_MAP[dialog.name];
          if (!Component) return null;
          return <Component data={dialog.data} />;
        }}
      </For>
      <TextEditOverlay />
      <PdfTextEditOverlay />
      <StickyNotePopupHost />
      <ParametricSymbolPicker />
      <PrintProgressToast />
    </>
  );
}
