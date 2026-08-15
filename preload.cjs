const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('harnessDesktop', {
  retry: () => ipcRenderer.invoke('desktop:retry'),
  openLogs: () => ipcRenderer.invoke('desktop:open-logs')
})
