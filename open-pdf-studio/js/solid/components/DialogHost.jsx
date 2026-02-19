import { For } from 'solid-js';
import { getDialogs } from '../stores/dialogStore.js';
import DocPropertiesDialog from './DocPropertiesDialog.jsx';
import PreferencesDialog from './preferences/PreferencesDialog.jsx';
import NewDocDialog from './dialogs/NewDocDialog.jsx';
import InsertPageDialog from './dialogs/InsertPageDialog.jsx';
import ExtractPagesDialog from './dialogs/ExtractPagesDialog.jsx';
import MergePdfsDialog from './dialogs/MergePdfsDialog.jsx';
import PrintDialog from './dialogs/PrintDialog.jsx';
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
import TextEditOverlay from './TextEditOverlay.jsx';
import PdfTextEditOverlay from './PdfTextEditOverlay.jsx';

const DIALOG_MAP = {
  'doc-properties': DocPropertiesDialog,
  'preferences': PreferencesDialog,
  'new-doc': NewDocDialog,
  'insert-page': InsertPageDialog,
  'extract-pages': ExtractPagesDialog,
  'merge-pdfs': MergePdfsDialog,
  'print': PrintDialog,
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
    </>
  );
}
