const { ipcRenderer } = require('electron');

window.electronAPI = {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  onLoadPdf: (callback) => ipcRenderer.on('load-pdf', (event, filePath) => callback(filePath))
};
