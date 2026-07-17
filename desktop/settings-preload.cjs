const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clawOffice', {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  importConfig: () => ipcRenderer.invoke('settings:import-config'),
  exportConfig: () => ipcRenderer.invoke('settings:export-config'),
  connect: (settings) => ipcRenderer.invoke('settings:connect', settings),
  testOpenClaw: (settings) => ipcRenderer.invoke('settings:openclaw-test', settings),
  onError: (callback) => ipcRenderer.on('settings:error', (_event, message) => callback(message)),
  onDockVisibilityChanged: (callback) => ipcRenderer.on('settings:dock-visibility', (_event, hidden) => callback(hidden))
});
