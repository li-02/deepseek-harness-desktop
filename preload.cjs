const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('harnessDesktop', {
  retry: () => ipcRenderer.invoke('desktop:retry'),
  openLogs: () => ipcRenderer.invoke('desktop:open-logs'),
  getCloseBehavior: () => ipcRenderer.invoke('desktop:get-close-behavior'),
  setCloseBehavior: (behavior) => ipcRenderer.invoke('desktop:set-close-behavior', behavior)
})
