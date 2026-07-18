const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskfolkDesktop', {
  configChanged: () => ipcRenderer.send('config:changed')
});
