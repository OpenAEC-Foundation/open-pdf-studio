// Native dialogs return platform paths; browser code cannot use node:path.
export function joinExportPath(folder, fileName) {
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  return folder.replace(/[\\/]+$/, '') + separator + fileName;
}
