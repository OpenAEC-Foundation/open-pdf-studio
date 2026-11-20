// Lightweight tab-lifecycle boundary; importing this never opens a session.
export const centralReviewConnections = new WeakMap();
export function stopCentralReview(doc) {
  return centralReviewConnections.get(doc)?.stop();
}
