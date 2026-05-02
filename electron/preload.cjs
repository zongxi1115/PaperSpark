const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('papersparkDesktop', {
  isDesktop: true,
  platform: process.platform,
  launcher: {
    getState: () => ipcRenderer.invoke('desktop:get-launcher-state'),
    browsePythonPath: () => ipcRenderer.invoke('desktop:browse-python-path'),
    confirmPythonPath: (pythonPath) => ipcRenderer.invoke('desktop:confirm-python-path', pythonPath),
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke('desktop:window-action', 'minimize'),
    toggleMaximize: () => ipcRenderer.invoke('desktop:window-action', 'toggle-maximize'),
    close: () => ipcRenderer.invoke('desktop:window-action', 'close'),
    getState: () => ipcRenderer.invoke('desktop:get-window-state'),
    onStateChange: (listener) => {
      const handler = (_event, state) => listener(state)
      ipcRenderer.on('desktop:window-state', handler)
      return () => {
        ipcRenderer.removeListener('desktop:window-state', handler)
      }
    },
  },
})
