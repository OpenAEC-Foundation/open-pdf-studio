import { buildStavenreeks } from './stavenreeks.js';
import { stavenreeksPxPerMm } from './stavenreeks-scale.js';
import { betonbalkHalfWidthPx } from './betonbalk-scale.js';

const CELL_SIZE = 200; // pixels per grid cell

/**
 * Grid-based spatial index for fast annotation lookup by viewport region.
 *
 * Divides 2D space into a uniform grid of CELL_SIZE x CELL_SIZE cells.
 * Each annotation is registered in every cell its bounding box overlaps.
 * Viewport queries collect all annotation IDs from the cells that overlap
 * the query rectangle, providing O(visible-cells) lookup instead of O(n).
 */
class SpatialIndex {
  constructor() {
    /** @type {Map<string, Set<string>>} 'col_row_page' -> Set of annotation IDs */
    this._cells = new Map();
    /** @type {Map<string, {page: number, minCol: number, maxCol: number, minRow: number, maxRow: number}>} */
    this._annBounds = new Map();
  }

  /**
   * Add or update an annotation in the index.
   * If the annotation already exists, it is removed first and re-inserted
   * with its current geometry.
   *
   * @param {object} annotation - annotation object with at least { id, page } and geometry fields
   */
  update(annotation) {
    if (!annotation || !annotation.id) return;

    // Remove old entry if present
    this.remove(annotation.id);

    if (!annotation.page) return;

    const bounds = this._getBounds(annotation);
    if (!bounds) return;

    const minCol = Math.floor(bounds.x / CELL_SIZE);
    const minRow = Math.floor(bounds.y / CELL_SIZE);
    const maxCol = Math.floor((bounds.x + bounds.width) / CELL_SIZE);
    const maxRow = Math.floor((bounds.y + bounds.height) / CELL_SIZE);

    this._annBounds.set(annotation.id, {
      page: annotation.page,
      minCol,
      maxCol,
      minRow,
      maxRow,
    });

    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const key = `${c}_${r}_${annotation.page}`;
        let cell = this._cells.get(key);
        if (!cell) {
          cell = new Set();
          this._cells.set(key, cell);
        }
        cell.add(annotation.id);
      }
    }
  }

  /**
   * Remove an annotation from the spatial index.
   *
   * @param {string} id - annotation ID
   */
  remove(id) {
    const entry = this._annBounds.get(id);
    if (!entry) return;

    for (let c = entry.minCol; c <= entry.maxCol; c++) {
      for (let r = entry.minRow; r <= entry.maxRow; r++) {
        const key = `${c}_${r}_${entry.page}`;
        const cell = this._cells.get(key);
        if (cell) {
          cell.delete(id);
          // Clean up empty cells to avoid memory leaks
          if (cell.size === 0) {
            this._cells.delete(key);
          }
        }
      }
    }

    this._annBounds.delete(id);
  }

  /**
   * Query all annotation IDs whose bounding boxes might overlap with the
   * given viewport rectangle on a specific page.
   *
   * Note: this returns a superset (candidates). The caller should do a fine
   * bounding-box check if exact overlap is needed.
   *
   * @param {number} page - 1-based page number
   * @param {number} viewportX - left edge of the query rectangle (CSS pixels)
   * @param {number} viewportY - top edge of the query rectangle (CSS pixels)
   * @param {number} viewportW - width of the query rectangle
   * @param {number} viewportH - height of the query rectangle
   * @returns {Set<string>} set of annotation IDs that may overlap
   */
  query(page, viewportX, viewportY, viewportW, viewportH) {
    const result = new Set();

    if (!page || viewportW <= 0 || viewportH <= 0) return result;

    const minCol = Math.floor(viewportX / CELL_SIZE);
    const minRow = Math.floor(viewportY / CELL_SIZE);
    const maxCol = Math.floor((viewportX + viewportW) / CELL_SIZE);
    const maxRow = Math.floor((viewportY + viewportH) / CELL_SIZE);

    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const key = `${c}_${r}_${page}`;
        const cell = this._cells.get(key);
        if (cell) {
          for (const id of cell) {
            result.add(id);
          }
        }
      }
    }

    return result;
  }

  /**
   * Query annotations and return only those that truly overlap with the
   * given viewport rectangle (not just cell-level candidates).
   *
   * @param {number} page - 1-based page number
   * @param {number} vx - viewport X
   * @param {number} vy - viewport Y
   * @param {number} vw - viewport width
   * @param {number} vh - viewport height
   * @param {Array<object>} annotations - full annotation array (to look up bounds)
   * @returns {Array<object>} annotations that truly overlap the viewport
   */
  queryExact(page, vx, vy, vw, vh, annotations) {
    const candidateIds = this.query(page, vx, vy, vw, vh);
    if (candidateIds.size === 0) return [];

    const annMap = new Map();
    for (const ann of annotations) {
      if (candidateIds.has(ann.id)) {
        annMap.set(ann.id, ann);
      }
    }

    const results = [];
    for (const id of candidateIds) {
      const ann = annMap.get(id);
      if (!ann) continue;
      const bounds = this._getBounds(ann);
      if (!bounds) continue;

      // AABB overlap test
      if (
        bounds.x < vx + vw &&
        bounds.x + bounds.width > vx &&
        bounds.y < vy + vh &&
        bounds.y + bounds.height > vy
      ) {
        results.push(ann);
      }
    }

    return results;
  }

  /**
   * Rebuild the entire index from an array of annotations.
   * Clears the existing index first.
   *
   * @param {Array<object>} annotations
   */
  rebuild(annotations) {
    this.clear();
    if (!annotations) return;
    for (const ann of annotations) {
      this.update(ann);
    }
  }

  /**
   * Clear all data from the spatial index.
   */
  clear() {
    this._cells.clear();
    this._annBounds.clear();
  }

  /**
   * Get the number of indexed annotations.
   * @returns {number}
   */
  get size() {
    return this._annBounds.size;
  }

  /**
   * Check whether an annotation is in the index.
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return this._annBounds.has(id);
  }

  /**
   * Compute an axis-aligned bounding box for an annotation.
   * Handles all annotation geometry variants:
   * - Rect-based: x, y, width, height (box, circle, textbox, callout, image, stamp, redaction, comment, scaleBar)
   * - Line-based: startX, startY, endX, endY (line, arrow, measureDistance)
   * - Path-based: path[] (draw/freehand)
   * - Points-based: points[] (polygon, polyline, cloud, cloudPolyline, measureArea, measurePerimeter)
   * - Point-based: x, y (comment without width/height, text annotations)
   * - Angle measurement: point1, vertex, point2
   * - Highlight: quadPoints or rect fallback
   *
   * @param {object} annotation
   * @returns {{x: number, y: number, width: number, height: number}|null}
   */
  _getBounds(annotation) {
    const type = annotation.type;

    // Stavenreeks: the legs, dots and label extend well beyond the series
    // line, so the generic line-based branch below (4 px padding) would make
    // them unselectable. Use the element's full AABB instead.
    if (type === 'stavenreeks') {
      const { aabb } = buildStavenreeks(annotation, { pxPerMm: stavenreeksPxPerMm(annotation) });
      const pad = Math.max(annotation.lineWidth || 2, 4);
      return {
        x: aabb.x - pad,
        y: aabb.y - pad,
        width: aabb.width + pad * 2,
        height: aabb.height + pad * 2,
      };
    }

    // Betonbalk: de band steekt een halve (schaalbewuste) balkbreedte buiten
    // de hartlijnpunten uit — de generieke points-branch hieronder zou het
    // balklijf onaanklikbaar maken.
    if (type === 'betonbalk' && Array.isArray(annotation.points) && annotation.points.length >= 2) {
      const bbBase = this._boundsFromPoints(annotation.points, annotation.lineWidth);
      const bbHalf = betonbalkHalfWidthPx(annotation);
      return {
        x: bbBase.x - bbHalf,
        y: bbBase.y - bbHalf,
        width: bbBase.width + bbHalf * 2,
        height: bbBase.height + bbHalf * 2,
      };
    }

    // Rect-based annotations (most common)
    if (
      annotation.x != null &&
      annotation.y != null &&
      annotation.width != null &&
      annotation.height != null &&
      annotation.width > 0 &&
      annotation.height > 0
    ) {
      return {
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height,
      };
    }

    // Line / arrow / measureDistance: startX, startY, endX, endY
    if (annotation.startX != null && annotation.startY != null &&
        annotation.endX != null && annotation.endY != null) {
      const minX = Math.min(annotation.startX, annotation.endX);
      const minY = Math.min(annotation.startY, annotation.endY);
      const maxX = Math.max(annotation.startX, annotation.endX);
      const maxY = Math.max(annotation.startY, annotation.endY);
      // Add a small padding so zero-area lines are still selectable
      const pad = Math.max(annotation.lineWidth || 2, 4);
      return {
        x: minX - pad,
        y: minY - pad,
        width: (maxX - minX) + pad * 2,
        height: (maxY - minY) + pad * 2,
      };
    }

    // Freehand / draw: path array of {x, y}
    if (Array.isArray(annotation.path) && annotation.path.length > 0) {
      return this._boundsFromPoints(annotation.path, annotation.lineWidth);
    }

    // Polygon / polyline / cloud / cloudPolyline / measureArea / measurePerimeter: points array
    if (Array.isArray(annotation.points) && annotation.points.length > 0) {
      return this._boundsFromPoints(annotation.points, annotation.lineWidth);
    }

    // Angle measurement: point1, vertex, point2
    if (annotation.point1 && annotation.vertex && annotation.point2) {
      const pts = [annotation.point1, annotation.vertex, annotation.point2];
      return this._boundsFromPoints(pts, annotation.lineWidth);
    }

    // Text highlight / strikethrough / underline with quadPoints
    if (Array.isArray(annotation.quadPoints) && annotation.quadPoints.length > 0) {
      const allPts = [];
      for (const quad of annotation.quadPoints) {
        if (Array.isArray(quad)) {
          for (const pt of quad) {
            if (pt && pt.x != null && pt.y != null) allPts.push(pt);
          }
        }
      }
      if (allPts.length > 0) {
        return this._boundsFromPoints(allPts, 0);
      }
    }

    // Point-based annotations (comment without dimensions, text annotation)
    if (annotation.x != null && annotation.y != null) {
      // Use a default size for point-like annotations
      const w = annotation.width || 24;
      const h = annotation.height || 24;
      return {
        x: annotation.x,
        y: annotation.y,
        width: w,
        height: h,
      };
    }

    // Could not determine bounds
    return null;
  }

  /**
   * Compute bounding box from an array of {x, y} points with optional line-width padding.
   *
   * @param {Array<{x: number, y: number}>} points
   * @param {number} [lineWidth=0]
   * @returns {{x: number, y: number, width: number, height: number}}
   */
  _boundsFromPoints(points, lineWidth) {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const pt of points) {
      if (pt == null || pt.x == null || pt.y == null) continue;
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }

    if (minX === Infinity) return null;

    const pad = Math.max((lineWidth || 0) / 2, 2);
    return {
      x: minX - pad,
      y: minY - pad,
      width: (maxX - minX) + pad * 2,
      height: (maxY - minY) + pad * 2,
    };
  }
}

/** Singleton spatial index instance for the application */
export const spatialIndex = new SpatialIndex();

/** Export the class for cases where multiple independent indices are needed */
export { SpatialIndex, CELL_SIZE };
