'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rr', {
  status:() => ipcRenderer.invoke('status'), config:() => ipcRenderer.invoke('config'),
  pick:w => ipcRenderer.invoke('pick', w), startup:on => ipcRenderer.invoke('startup', on), tray:on => ipcRenderer.invoke('tray', on),
  install:() => ipcRenderer.invoke('install'), openSite:() => ipcRenderer.invoke('open-site'),
  onStatus:fn => ipcRenderer.on('status', (_e, s) => fn(s))
});
