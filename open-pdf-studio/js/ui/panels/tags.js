import { getActiveDocument } from '../../core/state.js';
import { setTree, setCountText, setEmptyMessage } from '../../solid/stores/panels/tagsStore.js';

function countNodes(node) {
  let count = 1;
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

export async function updateTagsList() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    setTree([]);
    setCountText('0 tags');
    setEmptyMessage('No document open');
    return;
  }

  setEmptyMessage('Loading...');

  try {
    const pdfDoc = activeDoc.pdfDoc;
    const numPages = pdfDoc.numPages;
    const collectedTrees = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDoc.getPage(i);

      if (typeof page.getStructTree !== 'function') {
        break;
      }

      try {
        const structTree = await page.getStructTree();
        if (structTree && structTree.children && structTree.children.length > 0) {
          collectedTrees.push(structTree);
        }
      } catch {
        // Page may not have structure tree
      }
    }

    if (collectedTrees.length === 0) {
      setTree([]);
      setCountText('0 tags');
      setEmptyMessage('No structure tags in this document');
      return;
    }

    let totalTagCount = 0;
    for (const tree of collectedTrees) {
      totalTagCount += countNodes(tree);
    }

    setEmptyMessage(null);
    setTree(collectedTrees);
    setCountText(`${totalTagCount} tag${totalTagCount !== 1 ? 's' : ''}`);
  } catch (e) {
    console.warn('Failed to load tags:', e);
    setTree([]);
    setCountText('0 tags');
    setEmptyMessage('Could not load structure tags');
  }
}
