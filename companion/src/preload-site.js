'use strict';
/* Runs inside the Tarkov Waypoint page when it is opened by the desktop app. Hands the page its link token so no code is needed. */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rrDesktop', {
  isDesktop:true,
  token:ipcRenderer.sendSync('get-token'),
  version:ipcRenderer.sendSync('get-version'),
  openStatus:() => ipcRenderer.send('open-status'),
  /* the backup folder lives in the app, so it never loses permission between runs */
  backup:{
    get:() => ipcRenderer.invoke('bk-get'), pick:() => ipcRenderer.invoke('bk-pick'),
    exists:n => ipcRenderer.invoke('bk-exists', n), read:n => ipcRenderer.invoke('bk-read', n), write:(n, t) => ipcRenderer.invoke('bk-write', n, t)
  }
});
