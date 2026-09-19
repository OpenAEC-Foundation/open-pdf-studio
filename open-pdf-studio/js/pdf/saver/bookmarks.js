import { getActiveDocument } from '../../core/state.js';
import { PDFName } from 'pdf-lib';
import { pdfTextString } from './pdf-text.js';

// Save bookmarks to PDF outline structure
export function saveBookmarksToOutline(pdfDocLib) {
  const doc = getActiveDocument();
  const bookmarks = doc ? doc.bookmarks : [];
  const context = pdfDocLib.context;
  const catalog = context.lookup(context.trailerInfo.Root);
  if (!catalog) return;

  // Remove existing Outlines if no bookmarks
  if (!bookmarks || bookmarks.length === 0) {
    catalog.delete(PDFName.of('Outlines'));
    return;
  }

  const pages = pdfDocLib.getPages();

  // Build tree from flat array
  function buildTree(items) {
    const map = {};
    const roots = [];
    for (const bm of items) {
      map[bm.id] = { ...bm, children: [] };
    }
    for (const bm of items) {
      const node = map[bm.id];
      if (bm.parentId && map[bm.parentId]) {
        map[bm.parentId].children.push(node);
      } else {
        roots.push(node);
      }
    }
    function sortChildren(nodes) {
      nodes.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      for (const n of nodes) {
        if (n.children.length > 0) sortChildren(n.children);
      }
    }
    sortChildren(roots);
    return roots;
  }

  const tree = buildTree(bookmarks);

  // Count all visible descendants (for /Count entry)
  function countVisible(nodes) {
    let count = 0;
    for (const node of nodes) {
      count++;
      if (node.expanded && node.children.length > 0) {
        count += countVisible(node.children);
      }
    }
    return count;
  }

  function countDescendants(nodes) {
    let count = 0;
    for (const node of nodes) {
      count++;
      if (node.children.length > 0) {
        count += countDescendants(node.children);
      }
    }
    return count;
  }

  function hexToRgbArr(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return null;
    return [
      parseInt(result[1], 16) / 255,
      parseInt(result[2], 16) / 255,
      parseInt(result[3], 16) / 255
    ];
  }

  // Create outline item dicts recursively, returning { ref, dict } for linking
  function createOutlineItems(nodes, parentRef) {
    const items = [];
    for (const node of nodes) {
      const pageIndex = Math.max(0, Math.min((node.page || 1) - 1, pages.length - 1));
      const pageRef = pages[pageIndex].ref;

      // Build destination array: [pageRef, /XYZ, left, top, zoom]
      const destArray = [pageRef, PDFName.of('XYZ')];
      destArray.push(node.left != null ? node.left : null);
      destArray.push(node.top != null ? node.top : null);
      destArray.push(node.zoom != null ? node.zoom : null);

      const flags = (node.italic ? 1 : 0) | (node.bold ? 2 : 0);

      const dictObj = {
        Title: pdfTextString(node.title || 'Untitled'),
        Parent: parentRef,
        Dest: destArray,
      };

      if (flags !== 0) {
        dictObj.F = flags;
      }

      if (node.color) {
        const c = hexToRgbArr(node.color);
        if (c) dictObj.C = c;
      }

      const dict = context.obj(dictObj);
      const ref = context.register(dict);

      // Recursively create children
      let childItems = [];
      if (node.children.length > 0) {
        childItems = createOutlineItems(node.children, ref);

        // Link children: First, Last, Prev, Next
        for (let i = 0; i < childItems.length; i++) {
          if (i > 0) {
            childItems[i].dict.set(PDFName.of('Prev'), childItems[i - 1].ref);
          }
          if (i < childItems.length - 1) {
            childItems[i].dict.set(PDFName.of('Next'), childItems[i + 1].ref);
          }
        }

        dict.set(PDFName.of('First'), childItems[0].ref);
        dict.set(PDFName.of('Last'), childItems[childItems.length - 1].ref);

        // Count: positive if open, negative if closed
        const childCount = countDescendants(node.children);
        dict.set(PDFName.of('Count'), context.obj(node.expanded ? childCount : -childCount));
      }

      items.push({ ref, dict, node });
    }
    return items;
  }

  // Create the root /Outlines dictionary
  const outlinesDict = context.obj({
    Type: 'Outlines',
  });
  const outlinesRef = context.register(outlinesDict);

  // Create all items
  const topItems = createOutlineItems(tree, outlinesRef);

  if (topItems.length === 0) {
    catalog.delete(PDFName.of('Outlines'));
    return;
  }

  // Link top-level siblings
  for (let i = 0; i < topItems.length; i++) {
    if (i > 0) {
      topItems[i].dict.set(PDFName.of('Prev'), topItems[i - 1].ref);
    }
    if (i < topItems.length - 1) {
      topItems[i].dict.set(PDFName.of('Next'), topItems[i + 1].ref);
    }
  }

  // Set First, Last, Count on root
  outlinesDict.set(PDFName.of('First'), topItems[0].ref);
  outlinesDict.set(PDFName.of('Last'), topItems[topItems.length - 1].ref);
  outlinesDict.set(PDFName.of('Count'), context.obj(countVisible(tree)));

  // Set /Outlines on catalog
  catalog.set(PDFName.of('Outlines'), outlinesRef);
}
