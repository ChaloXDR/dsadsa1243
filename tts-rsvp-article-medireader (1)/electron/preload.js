const { contextBridge } = require('electron');

// Expose the API_KEY from the main process's environment variables
// to the renderer process in a secure way.
// The renderer process (your React app) can access it via `window.env.API_KEY`.
contextBridge.exposeInMainWorld('env', {
  API_KEY: process.env.API_KEY,
});
