const { app, BrowserWindow } = require('electron');
const path = require('path');

// Load environment variables from .env file
require('dotenv').config();

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      // Attach the preload script
      preload: path.join(__dirname, 'preload.js'),
      // Recommended security settings
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../assets/icon.png') // Optional: if you have an icon
  });

  // Load the index.html of the app.
  mainWindow.loadFile('index.html');

  // Optional: Open the DevTools for debugging.
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  // Quit when all windows are closed, except on macOS. There, it's common
  // for applications and their menu bar to stay active until the user quits
  // explicitly with Cmd + Q.
  if (process.platform !== 'darwin') app.quit();
});
