const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wrbDesktop', {
  getDeviceId: () => ipcRenderer.invoke('wrb:get-device-id'),
  setFullscreen: (enabled) => ipcRenderer.invoke('wrb:set-fullscreen', !!enabled),
  onFullscreenChanged: (callback) => {
    ipcRenderer.on('wrb:fullscreen-changed', (_event, enabled) => callback(!!enabled));
  }
});
