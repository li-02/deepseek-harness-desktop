const { contextBridge, ipcRenderer } = require('electron')

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args)
}

contextBridge.exposeInMainWorld('pluginStore', {
  list: () => invoke('desktop:plugin-store:list'),
  install: (pluginName) => invoke('desktop:plugin-store:install', pluginName),
  restart: () => invoke('desktop:plugin-store:restart'),
  openExternal: (url) => invoke('desktop:plugin-store:open-external', url)
})
