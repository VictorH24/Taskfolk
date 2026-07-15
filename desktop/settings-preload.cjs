const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clawOffice', {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  connect: (settings) => ipcRenderer.invoke('settings:connect', settings),
  onError: (callback) => ipcRenderer.on('settings:error', (_event, message) => callback(message))
});

