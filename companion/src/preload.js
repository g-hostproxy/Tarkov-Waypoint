'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rr', {
  status:() => ipcRenderer.invoke('status'), config:() => ipcRenderer.invoke('config'),
  pick:w => ipcRenderer.invoke('pick', w), startup:on => ipcRenderer.invoke('startup', on), install:() => ipcRenderer.invoke('install'),
  onStatus:fn => ipcRenderer.on('status', (_e, s) => fn(s))
});
