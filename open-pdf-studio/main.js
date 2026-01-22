const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');

// Auto-reload in development
try {
  require('electron-reloader')(module, {
    watchRenderer: true
  });
} catch {}

// Allow running as root on Linux (adds --no-sandbox if needed)
if (process.platform === 'linux' && process.getuid && process.getuid() === 0) {
  app.commandLine.appendSwitch('no-sandbox');
}

// Development: auto-load this PDF on startup (set to null for production)
const DEV_AUTO_LOAD_PDF = null;

function createWindow() {
  // Remove default menu
  Menu.setApplicationMenu(null);

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true
    }
  });

  // Window control handlers
  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.on('window-close', () => mainWindow.close());

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools();

  // Auto-load PDF for development
  mainWindow.webContents.on('did-finish-load', () => {
    if (DEV_AUTO_LOAD_PDF) {
      mainWindow.webContents.send('load-pdf', DEV_AUTO_LOAD_PDF);
    }
  });
}

// Handle file selection
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'PDF Files', extensions: ['pdf'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Handle getting file from command line arguments
ipcMain.handle('get-opened-file', () => {
  // Check if a PDF file was passed as command line argument
  const args = process.argv.slice(1);
  for (const arg of args) {
    if (arg.endsWith('.pdf') && !arg.startsWith('-')) {
      return arg;
    }
  }
  return null;
});

// Handle save file dialog
ipcMain.handle('dialog:saveFile', async (event, defaultPath) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultPath,
    filters: [
      { name: 'PDF Files', extensions: ['pdf'] }
    ]
  });

  if (!result.canceled && result.filePath) {
    return result.filePath;
  }
  return null;
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
