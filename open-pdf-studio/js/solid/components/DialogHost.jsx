import { For, lazy } from 'solid-js';
import { getDialogs } from '../stores/dialogStore.js';
import MessageDialog from './dialogs/MessageDialog.jsx';
import ConfirmDialog from './dialogs/ConfirmDialog.jsx';
import ExportVerliesDialog from './dialogs/ExportVerliesDialog.jsx';
import PasswordDialog from './dialogs/PasswordDialog.jsx';
import RecoveryDialog from './dialogs/RecoveryDialog.jsx';
import TextEditOverlay from './TextEditOverlay.jsx';
import StavenreeksInlineEditor from './StavenreeksInlineEditor.jsx';
import ParametricLabelInlineEditor from './ParametricLabelInlineEditor.jsx';
import PdfTextEditOverlay from './PdfTextEditOverlay.jsx';
import StickyNotePopupHost from './StickyNotePopup.jsx';
import ParametricSymbolPicker from './dialogs/ParametricSymbolPicker.jsx';
import PrintProgressToast from './PrintProgressToast.jsx';

// Dialogen die pas op verzoek openen, laden bij het eerste gebruik als eigen
// chunk (#454): ze horen niet in de chunk die bij het opstarten laadt. Alleen
// wat bij het opstarten of het openen van een PDF kan verschijnen (melding,
// bevestiging, wachtwoord, herstel) en wat altijd gemonteerd is (overlays,
// toast), blijft hierboven statisch.
const DocPropertiesDialog = lazy(() => import('./DocPropertiesDialog.jsx'));
const PreferencesDialog = lazy(() => import('./preferences/PreferencesDialog.jsx'));
const NewDocDialog = lazy(() => import('./dialogs/NewDocDialog.jsx'));
const InsertPageDialog = lazy(() => import('./dialogs/InsertPageDialog.jsx'));
const DeletePagesDialog = lazy(() => import('./dialogs/DeletePagesDialog.jsx'));
const PagePropertiesDialog = lazy(() => import('./dialogs/PagePropertiesDialog.jsx'));
const ExtractPagesDialog = lazy(() => import('./dialogs/ExtractPagesDialog.jsx'));
const ChoosePagesDialog = lazy(() => import('./dialogs/ChoosePagesDialog.jsx'));
const SplitDocumentDialog = lazy(() => import('./dialogs/SplitDocumentDialog.jsx'));
const MergePdfsDialog = lazy(() => import('./dialogs/MergePdfsDialog.jsx'));
const PrintDialog = lazy(() => import('./dialogs/PrintDialog.jsx'));
const PageSetupDialog = lazy(() => import('./dialogs/PageSetupDialog.jsx'));
const WatermarkDialog = lazy(() => import('./dialogs/WatermarkDialog.jsx'));
const HeaderFooterDialog = lazy(() => import('./dialogs/HeaderFooterDialog.jsx'));
const ManageWatermarksDialog = lazy(() => import('./dialogs/ManageWatermarksDialog.jsx'));
const SignatureDialog = lazy(() => import('./dialogs/SignatureDialog.jsx'));
const TextAnnotationDialog = lazy(() => import('./dialogs/TextAnnotationDialog.jsx'));
const UpdateDialog = lazy(() => import('./dialogs/UpdateDialog.jsx'));
const BookmarkDialog = lazy(() => import('./dialogs/BookmarkDialog.jsx'));
const PageLabelsDialog = lazy(() => import('./dialogs/PageLabelsDialog.jsx'));
const BookmarkNamesDialog = lazy(() => import('./dialogs/BookmarkNamesDialog.jsx'));
const FormValidationDialog = lazy(() => import('./dialogs/FormValidationDialog.jsx'));
const StampPickerDialog = lazy(() => import('./dialogs/StampPickerDialog.jsx'));
const StampTemplatesDialog = lazy(() => import('./dialogs/StampTemplatesDialog.jsx'));
const DynamicStampFieldsDialog = lazy(() => import('./dialogs/DynamicStampFieldsDialog.jsx'));
const CalibrationDialog = lazy(() => import('./dialogs/CalibrationDialog.jsx'));
const ScaleCheckDialog = lazy(() => import('./dialogs/ScaleCheckDialog.jsx'));
const ScaleDialog = lazy(() => import('./dialogs/ScaleDialog.jsx'));
const CropMarginsDialog = lazy(() => import('./dialogs/CropMarginsDialog.jsx'));
const StraightenDialog = lazy(() => import('./dialogs/StraightenDialog.jsx'));
const ShiftPageDialog = lazy(() => import('./dialogs/ShiftPageDialog.jsx'));
const ProtectPdfDialog = lazy(() => import('./dialogs/ProtectPdfDialog.jsx'));
const OcrLanguageDialog = lazy(() => import('./dialogs/OcrLanguageDialog.jsx'));
const ResizePagesDialog = lazy(() => import('./dialogs/ResizePagesDialog.jsx'));
const CompressDialog = lazy(() => import('./dialogs/CompressDialog.jsx'));
const PdfAEditDialog = lazy(() => import('./dialogs/PdfAEditDialog.jsx'));
const PdfADialog = lazy(() => import('./dialogs/PdfADialog.jsx'));
const ScreenshotDialog = lazy(() => import('./dialogs/ScreenshotDialog.jsx'));
const FeedbackDialog = lazy(() => import('./dialogs/FeedbackDialog.jsx'));
const AboutDialog = lazy(() => import('./dialogs/AboutDialog.jsx'));
const WhatsNewDialog = lazy(() => import('./dialogs/WhatsNewDialog.jsx'));
const ShortcutsDialog = lazy(() => import('./dialogs/ShortcutsDialog.jsx'));
const ExtensionsDialog = lazy(() => import('./dialogs/ExtensionsDialog.jsx'));
const HandtekeningDetailDialog = lazy(() => import('./dialogs/HandtekeningDetailDialog.jsx'));
const ViewportScaleDialog = lazy(() => import('./dialogs/ViewportScaleDialog.jsx'));
const ScaleRegionDialog = lazy(() => import('./dialogs/ScaleRegionDialog.jsx'));
const LinkDialog = lazy(() => import('./dialogs/LinkDialog.jsx'));
const MeasuredLengthDialog = lazy(() => import('./dialogs/MeasuredLengthDialog.jsx'));
const ScreenCalibrationDialog = lazy(() => import('./dialogs/ScreenCalibrationDialog.jsx'));
const TitleBlockDialog = lazy(() => import('./dialogs/TitleBlockDialog.jsx'));
const CompareDialog = lazy(() => import('./compare/CompareDialog.jsx'));
const CadExportDialog = lazy(() => import('./dialogs/CadExportDialog.jsx'));
const CadImportDialog = lazy(() => import('./dialogs/CadImportDialog.jsx'));
const IfcxExportDialog = lazy(() => import('./dialogs/IfcxExportDialog.jsx'));
const AnnotationLayerDeleteDialog = lazy(() => import('./dialogs/AnnotationLayerDeleteDialog.jsx'));
const FlattenAllDialog = lazy(() => import('./dialogs/FlattenAllDialog.jsx'));
const WorkspaceDialog = lazy(() => import('./dialogs/WorkspaceDialog.jsx'));
const ToolSetImportDialog = lazy(() => import('./dialogs/ToolSetsDialogs.jsx').then((m) => ({ default: m.ToolSetImportDialog })));
const ToolSetConfirmDialog = lazy(() => import('./dialogs/ToolSetsDialogs.jsx').then((m) => ({ default: m.ToolSetConfirmDialog })));
const StyleTypeEditorDialog = lazy(() => import('./dialogs/StyleTypeEditorDialog.jsx'));
const TekeninstellingenDialog = lazy(() => import('./dialogs/TekeninstellingenDialog.jsx'));
const SysteemtypenDialog = lazy(() => import('./dialogs/SysteemtypenDialog.jsx'));
const SysteemPaneelComponentDialog = lazy(() => import('./dialogs/SysteemPaneelComponentDialog.jsx'));

// Feature dialogs that are opened rarely: loaded on first use, with their
// services, so they stay out of the main chunk.
const OcrReviewDialog = lazy(() => import('./dialogs/OcrReviewDialog.jsx'));
const HostSaveAsDialog = lazy(() => import('./dialogs/HostSaveAsDialog.jsx'));
const HostKeuzeDialog = lazy(() => import('./dialogs/HostKeuzeDialog.jsx'));
const BatchOcrDialog = lazy(() => import('./dialogs/BatchOcrDialog.jsx'));
const ScanDialog = lazy(() => import('./dialogs/ScanDialog.jsx'));
const DocumentWorkflowsDialog = lazy(() => import('./dialogs/DocumentWorkflowsDialog.jsx'));
const DrawingSetsDialog = lazy(() => import('./dialogs/DrawingSetsDialog.jsx'));
const SheetLinksDialog = lazy(() => import('./dialogs/SheetLinksDialog.jsx'));
const SharedReviewDialog = lazy(() => import('./dialogs/SharedReviewDialog.jsx'));
const ApprovalRoutingDialog = lazy(() => import('./dialogs/ApprovalRoutingDialog.jsx'));
const PortfolioDialog = lazy(() => import('./dialogs/PortfolioDialog.jsx'));
const FormRecognitionDialog = lazy(() => import('./dialogs/FormRecognitionDialog.jsx'));
const SymbolSearchDialog = lazy(() => import('./dialogs/SymbolSearchDialog.jsx'));
const WorkbookBindingsDialog = lazy(() => import('./dialogs/WorkbookBindingsDialog.jsx'));
const PageOrganizerDialog = lazy(() => import('./dialogs/PageOrganizerDialog.jsx'));
const AccessibilityReportDialog = lazy(() => import('./dialogs/AccessibilityReportDialog.jsx'));
const DigitaalOndertekenenDialog = lazy(() => import('./dialogs/DigitaalOndertekenenDialog.jsx'));

const DIALOG_MAP = {
  'portfolio': PortfolioDialog,
  'accessibility-report': AccessibilityReportDialog,
  'form-recognition': FormRecognitionDialog,
  'symbol-search': SymbolSearchDialog,
  'workbook-bindings': WorkbookBindingsDialog,
  'document-workflows': DocumentWorkflowsDialog,
  'drawing-sets': DrawingSetsDialog,
  'sheet-links': SheetLinksDialog,
  'shared-review': SharedReviewDialog,
  'approval-routing': ApprovalRoutingDialog,
  'doc-properties': DocPropertiesDialog,
  'preferences': PreferencesDialog,
  'new-doc': NewDocDialog,
  'insert-page': InsertPageDialog,
  'style-type-editor': StyleTypeEditorDialog,
  'tekeninstellingen': TekeninstellingenDialog,
  'systeemtypen': SysteemtypenDialog,
  'systeem-paneel-component': SysteemPaneelComponentDialog,
  'delete-pages': DeletePagesDialog,
  'page-organizer': PageOrganizerDialog,
  'page-properties': PagePropertiesDialog,
  'extract-pages': ExtractPagesDialog,
  'choose-pages': ChoosePagesDialog,
  'split-document': SplitDocumentDialog,
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
  'page-labels': PageLabelsDialog,
  'bookmark-names': BookmarkNamesDialog,
  'form-validation': FormValidationDialog,
  'stamp-picker': StampPickerDialog,
  'stamp-templates': StampTemplatesDialog,
  'dynamic-stamp-fields': DynamicStampFieldsDialog,
  'calibration': CalibrationDialog,
  'scale-check': ScaleCheckDialog,
  'scale': ScaleDialog,
  'crop-margins': CropMarginsDialog,
  'straighten-page': StraightenDialog,
  'shift-page': ShiftPageDialog,
  'protect-pdf': ProtectPdfDialog,
  'ocr-language': OcrLanguageDialog,
  'ocr-review': OcrReviewDialog,
  'batch-ocr': BatchOcrDialog,
  'scan': ScanDialog,
  'resize-pages': ResizePagesDialog,
  'compress': CompressDialog,
  'pdfa': PdfADialog,
  'pdfa-edit': PdfAEditDialog,
  'screenshot': ScreenshotDialog,
  'feedback': FeedbackDialog,
  'message': MessageDialog,
  'about': AboutDialog,
  'whats-new': WhatsNewDialog,
  'shortcuts': ShortcutsDialog,
  'extensions': ExtensionsDialog,
  'confirm': ConfirmDialog,
  'export-verlies': ExportVerliesDialog,
  'host-save-as': HostSaveAsDialog,
  'host-keuze': HostKeuzeDialog,
  'tool-sets-import': ToolSetImportDialog,
  'tool-sets-confirm': ToolSetConfirmDialog,
  'handtekening-detail': HandtekeningDetailDialog,
  'digital-sign': DigitaalOndertekenenDialog,
  'title-block-edit': TitleBlockDialog,
  'viewport-scale': ViewportScaleDialog,
  'scale-region': ScaleRegionDialog,
  'link': LinkDialog,
  'measured-length': MeasuredLengthDialog,
  'screen-calibration': ScreenCalibrationDialog,
  'compare': CompareDialog,
  'cad-export': CadExportDialog,
  'cad-import': CadImportDialog,
  'ifcx-export': IfcxExportDialog,
  'annotation-layer-delete': AnnotationLayerDeleteDialog,
  'flatten-all': FlattenAllDialog,
  'workspaces': WorkspaceDialog,
  'pdf-password': PasswordDialog,
  'recovery': RecoveryDialog,
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
      <StavenreeksInlineEditor />
      <ParametricLabelInlineEditor />
      <PdfTextEditOverlay />
      <StickyNotePopupHost />
      <ParametricSymbolPicker />
      <PrintProgressToast />
    </>
  );
}
