'use strict';
const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const { Config } = require('./config');
const { Core } = require('./core');

if(!app.requestSingleInstanceLock()){ app.quit(); }
let siteWin = null, statusWin = null, tray = null, core = null, config = null, update = { state:'idle', version:'' }, quitting = false, told = false;
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const siteOrigin = () => { try{ return new URL(config.get('siteUrl')).origin; }catch(e){ return ''; } };

function createSite(){
  if(siteWin){ if(siteWin.isMinimized()) siteWin.restore(); siteWin.show(); siteWin.focus(); return; }
  siteWin = new BrowserWindow({ width:1400, height:900, minWidth:900, minHeight:600, backgroundColor:'#0b1210', title:'Raid Route', icon:ICON, autoHideMenuBar:true,
    webPreferences:{ preload:path.join(__dirname, 'preload-site.js'), partition:'persist:raidroute', contextIsolation:true, nodeIntegration:false, sandbox:false } });
  siteWin.loadURL(config.get('siteUrl'));
  siteWin.webContents.on('did-fail-load', (_e, code, _d, url, isMain) => { if(isMain && code !== -3) siteWin.loadFile(path.join(__dirname, '..', 'ui', 'offline.html')); });
  /* stay on the site; everything else opens in the normal browser */
  const keep = u => { try{ return new URL(u).origin === siteOrigin(); }catch(e){ return false; } };
  siteWin.webContents.on('will-navigate', (e, u) => { if(!keep(u) && !u.startsWith('file:')){ e.preventDefault(); if(/^https?:/.test(u)) shell.openExternal(u); } });
  siteWin.webContents.setWindowOpenHandler(({ url }) => { if(/^https?:/.test(url)) shell.openExternal(url); return { action:'deny' }; });
  siteWin.on('close', e => {
    if(!quitting && config.get('keepInTray')){
      e.preventDefault(); siteWin.hide();
      if(!told && tray && tray.displayBalloon){ told = true; try{ tray.displayBalloon({ title:'Raid Route is still running', content:'It keeps following your game from the tray. Right-click the icon to quit.' }); }catch(x){} }
    }
  });
  siteWin.on('closed', () => { siteWin = null; });
}
function createStatus(){
  if(statusWin){ statusWin.show(); statusWin.focus(); return; }
  statusWin = new BrowserWindow({ width:480, height:720, minWidth:420, minHeight:560, backgroundColor:'#0d1311', title:'Raid Route Companion', autoHideMenuBar:true, icon:ICON, parent:undefined,
    webPreferences:{ preload:path.join(__dirname, 'preload.js'), contextIsolation:true, nodeIntegration:false, sandbox:true } });
  statusWin.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  statusWin.on('closed', () => { statusWin = null; });
  statusWin.webContents.setWindowOpenHandler(({ url }) => { if(/^https:\/\//.test(url)) shell.openExternal(url); return { action:'deny' }; });
}
function push(){ if(statusWin && !statusWin.isDestroyed()) statusWin.webContents.send('status', Object.assign(core.status(), { update, siteUrl:config.get('siteUrl'), keepInTray:!!config.get('keepInTray') })); }

app.on('second-instance', () => createSite());
app.whenReady().then(async () => {
  config = new Config(path.join(app.getPath('userData'), 'config.json'));
  core = new Core({ config, version:app.getVersion() });
  core.onChange(push);
  try{ await core.start(); }catch(e){ dialog.showErrorBox('Raid Route', 'Could not open the local link (port 47831 may be in use by another copy).\n\n' + e.message); }
  config.embedded();
  app.setLoginItemSettings({ openAtLogin:!!config.get('startWithWindows'), args:['--hidden'] });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label:'Raid Route', submenu:[{ label:'Status and settings', accelerator:'CmdOrCtrl+,', click:createStatus }, { type:'separator' }, { label:'Reload', accelerator:'CmdOrCtrl+R', click:() => siteWin && siteWin.webContents.reload() }, { label:'Quit', click:() => { quitting = true; app.quit(); } }] },
    { label:'View', submenu:[{ role:'zoomIn' }, { role:'zoomOut' }, { role:'resetZoom' }, { role:'togglefullscreen' }] }
  ]));
  const icon = nativeImage.createFromPath(ICON);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width:16, height:16 }));
  tray.setToolTip('Raid Route');
  tray.setContextMenu(Menu.buildFromTemplate([{ label:'Open Raid Route', click:createSite }, { label:'Status and settings', click:createStatus }, { type:'separator' }, { label:'Quit', click:() => { quitting = true; app.quit(); } }]));
  tray.on('click', createSite);
  if(!process.argv.includes('--hidden')) createSite();

  ipcMain.on('get-token', e => { e.returnValue = config.embedded(); });
  ipcMain.on('get-version', e => { e.returnValue = app.getVersion(); });
  ipcMain.on('open-status', () => createStatus());
  ipcMain.handle('status', () => Object.assign(core.status(), { update, siteUrl:config.get('siteUrl'), keepInTray:!!config.get('keepInTray') }));
  ipcMain.handle('open-site', () => createSite());
  ipcMain.handle('pick', async (_e, which) => {
    const r = await dialog.showOpenDialog(statusWin, { properties:['openDirectory'], title:which === 'game' ? 'Choose your Escape from Tarkov folder (the one that has a Logs folder)' : 'Choose your Escape from Tarkov Screenshots folder' });
    if(r.canceled || !r.filePaths[0]) return;
    if(which === 'game') core.setGameDir(r.filePaths[0]); else core.setShotsDir(r.filePaths[0]);
  });
  ipcMain.handle('startup', (_e, on) => { config.set('startWithWindows', !!on); app.setLoginItemSettings({ openAtLogin:!!on, args:['--hidden'] }); });
  ipcMain.handle('tray', (_e, on) => { config.set('keepInTray', !!on); push(); });
  ipcMain.handle('config', () => ({ startWithWindows:!!config.get('startWithWindows'), keepInTray:!!config.get('keepInTray') }));

  try{
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', i => { update = { state:'downloading', version:i.version }; push(); });
    autoUpdater.on('update-downloaded', i => { update = { state:'ready', version:i.version }; push(); });
    autoUpdater.on('error', () => {});
    const check = () => { if(app.isPackaged) autoUpdater.checkForUpdates().catch(() => {}); };
    check(); setInterval(check, 4 * 60 * 60 * 1000);
    ipcMain.handle('install', () => { quitting = true; autoUpdater.quitAndInstall(); });
  }catch(e){}
});
app.on('window-all-closed', e => e.preventDefault());
app.on('before-quit', () => { quitting = true; if(core) core.stop(); });
