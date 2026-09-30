const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wrbDesktop', {
  getDeviceId: () => ipcRenderer.invoke('wrb:get-device-id'),
  setFullscreen: (enabled) => ipcRenderer.invoke('wrb:set-fullscreen', !!enabled),
  setAppFullscreen: (enabled) => ipcRenderer.invoke('wrb:set-app-fullscreen', !!enabled),
  isFullscreen: () => ipcRenderer.invoke('wrb:is-fullscreen'),
  onFullscreenChanged: (callback) => {
    ipcRenderer.on('wrb:fullscreen-changed', (_event, enabled) => callback(!!enabled));
  },
  onAppFullscreenChanged: (callback) => {
    ipcRenderer.on('wrb:app-fullscreen-changed', (_event, enabled) => callback(!!enabled));
  }
});
