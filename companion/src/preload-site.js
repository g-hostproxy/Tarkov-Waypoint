'use strict';
/* Runs inside the Tarkov Waypoint page when it is opened by the desktop app. Hands the page its link token so no code is needed. */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rrDesktop', {
  isDesktop:true,
  token:ipcRenderer.sendSync('get-token'),
  version:ipcRenderer.sendSync('get-version'),
  openStatus:() => ipcRenderer.send('open-status')
});
