// Tells the render scheduler (render-queue.js) which document is shown: the
// file paths of the active tab. Kept apart from render-queue.js so that one
// stays free of app state and runs under plain node.

import { state } from '../core/state.js';
import { documentShown, renderQueue } from './render-queue.js';

renderQueue.setActiveDocumentProvider(
  (docKey) => documentShown(docKey, state.documents, state.activeDocumentIndex),
);

export { renderQueue };
