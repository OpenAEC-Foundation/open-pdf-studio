import { getAnnotationType } from '../plugins/annotation-type-registry.js';

const tools = new Map();

export function registerTool(name, tool) {
  tools.set(name, tool);
}

export function getTool(name) {
  return tools.get(name) || null;
}

/** Namen van alle geregistreerde gereedschappen — voor app_list_commands. */
export function listToolNames() {
  return [...tools.keys()].sort();
}

export function getToolCursor(name) {
  const tool = tools.get(name);
  if (tool && tool.cursor) return tool.cursor;
  // Fallback to plugin registry
  const typeHandler = getAnnotationType(name);
  return (typeHandler && typeHandler.cursor) || 'crosshair';
}

export function hasRegisteredTool(name) {
  return tools.has(name);
}
