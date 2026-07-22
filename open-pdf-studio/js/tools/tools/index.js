/**
 * Tool registration — imports all tools and registers them in the tool-registry
 */
import { registerTool } from '../tool-registry.js';
import { handTool } from './hand-tool.js';
import { selectTool } from './select-tool.js';
import { drawTool } from './draw-tool.js';
import { shapeTool } from './shape-tool.js';
import { lineTool } from './line-tool.js';
import { polylineTool, cloudPolylineTool } from './polyline-tool.js';
import { arcTool } from './arc-tool.js';
import { splineTool } from './spline-tool.js';
import { splineArrowTool } from './spline-arrow-tool.js';
import { measureDistanceTool, measureAreaTool, measurePerimeterTool, addHoleTool } from './measurement-tool.js';
import { filledAreaTool } from './filled-area-tool.js';
import { measureAngleTool } from './angle-tool.js';
import { commentTool, textTool, stampTool, signatureTool, editTextTool } from './text-tool.js';
import { calibrationPickTool } from './calibration-pick-tool.js';
import { scaleMeasureTool } from './scale-measure-tool.js';
import { pluginClickTool } from './plugin-tool.js';
import { viewportTool } from './viewport-tool.js';
import { scaleRegionTool } from './scale-region-tool.js';
import { scaleBarTool } from './scalebar-tool.js';
import { trimTool } from './trim-tool.js';
import { extendTool } from './extend-tool.js';
import { arrayTool } from './array-tool.js';
import { removeImageTool } from './remove-image-tool.js';
import { splitTool, breakTool } from './split-tool.js';
import { lengthenTool } from './lengthen-tool.js';
import { radiusTool, diameterTool } from './dimension-radius-tool.js';

export function registerAllTools() {
  // Navigation / selection
  registerTool('hand', handTool);
  registerTool('select', selectTool);


  // Freehand
  registerTool('draw', drawTool);

  // Shapes (all use the same drag-to-create pattern)
  registerTool('box', shapeTool);
  registerTool('mask', shapeTool);
  registerTool('circle', shapeTool);
  registerTool('ellipse', shapeTool);
  registerTool('highlight', shapeTool);
  registerTool('cloud', shapeTool);
  registerTool('polygon', shapeTool);
  registerTool('redaction', shapeTool);
  registerTool('textbox', shapeTool);
  registerTool('callout', shapeTool);
  registerTool('parametricSymbol', shapeTool);
  registerTool('count', shapeTool);
  // Stavenreeks (wapeningsstaven-reeks): sleep begin→eind bepaalt de
  // reekslijn; een klik zonder sleep plaatst een standaardlengte.
  registerTool('stavenreeks', shapeTool);
  // L-shaped outline — drag-to-create like the other shapes (buildAnnotationProps
  // emits a closed polyline for the 'lshape' tool).
  registerTool('lshape', shapeTool);

  // Lines
  registerTool('line', lineTool);
  registerTool('arrow', lineTool);
  // Walls share the click-click line flow (incl. type-length + ortho); the
  // band rendering/joins live in annotations/rendering/walls.js.
  registerTool('wall', lineTool);
  registerTool('arc', arcTool);
  registerTool('spline', splineTool);
  registerTool('splineArrow', splineArrowTool);

  // Multi-click tools
  registerTool('polyline', polylineTool);
  registerTool('cloudPolyline', cloudPolylineTool);

  // Measurements
  registerTool('measureDistance', measureDistanceTool);
  registerTool('measureArea', measureAreaTool);
  registerTool('measurePerimeter', measurePerimeterTool);
  registerTool('measureAngle', measureAngleTool);
  registerTool('addHole', addHoleTool);

  // Filled area (contour with arcs and optional holes; solid or hatched fill)
  registerTool('filledArea', filledAreaTool);

  // Calibration
  registerTool('calibrationPick', calibrationPickTool);

  // Temporary 2-click distance pick for scale regions ("Meet op tekening")
  registerTool('scaleMeasure', scaleMeasureTool);

  // Scale bar
  registerTool('scaleBar', scaleBarTool);

  // Single-click placement
  registerTool('comment', commentTool);
  registerTool('text', textTool);
  registerTool('stamp', stampTool);
  registerTool('signature', signatureTool);
  registerTool('editText', editTextTool);

  // Viewports
  registerTool('viewport', viewportTool);

  // Scale regions (per-region calibration)
  registerTool('scaleRegion', scaleRegionTool);

  // Plugin fallback
  registerTool('_plugin_click', pluginClickTool);

  // Remove an image that is embedded in the PDF page content (issue #184)
  registerTool('removeImage', removeImageTool);

  // CAD tools
  registerTool('trim', trimTool);
  registerTool('extend', extendTool);
  registerTool('array', arrayTool);
  registerTool('split', splitTool);
  registerTool('break', breakTool);
  registerTool('lengthen', lengthenTool);

  // Radius / diameter dimensioning (measureDistance with a prefixed label)
  registerTool('radius', radiusTool);
  registerTool('diameter', diameterTool);
}
