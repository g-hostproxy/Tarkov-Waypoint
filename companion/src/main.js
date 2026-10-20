'use strict';
const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const { Config } = require('./config');
const { Core } = require('./core');

if(!app.requestSingleInstanceLock()){ app.quit(); }
let win = null, tray = null, core = null, update = { state:'idle', version:'' }, quitting = false;

function createWindow(){
  if(win){ win.show(); win.focus(); return; }
  win = new BrowserWindow({ width:460, height:640, minWidth:420, minHeight:520, backgroundColor:'#101614', title:'Raid Route Companion', autoHideMenuBar:true, icon:path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences:{ preload:path.join(__dirname, 'preload.js'), contextIsolation:true, nodeIntegration:false, sandbox:true } });
  win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  win.on('close', e => { if(!quitting){ e.preventDefault(); win.hide(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if(/^https:\/\//.test(url)) shell.openExternal(url); return { action:'deny' }; });
}
function push(){ if(win && !win.isDestroyed()) win.webContents.send('status', Object.assign(core.status(), { update })); }

app.on('second-instance', () => createWindow());
app.whenReady().then(async () => {
  const config = new Config(path.join(app.getPath('userData'), 'config.json'));
  core = new Core({ config, version:app.getVersion() });
  core.onChange(push);
  try{ await core.start(); }catch(e){ dialog.showErrorBox('Raid Route Companion', 'Could not open the local link (port 47831 may be in use by another copy).\n\n' + e.message); }
  app.setLoginItemSettings({ openAtLogin:!!config.get('startWithWindows'), args:['--hidden'] });

  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width:16, height:16 }));
  tray.setToolTip('Raid Route Companion');
  tray.setContextMenu(Menu.buildFromTemplate([{ label:'Open', click:createWindow }, { type:'separator' }, { label:'Quit', click:() => { quitting = true; app.quit(); } }]));
  tray.on('click', createWindow);
  if(!process.argv.includes('--hidden')) createWindow();

  ipcMain.handle('status', () => Object.assign(core.status(), { update }));
  ipcMain.handle('pick', async (_e, which) => {
    const r = await dialog.showOpenDialog(win, { properties:['openDirectory'], title:which === 'game' ? 'Choose your Escape from Tarkov folder (the one that has a Logs folder)' : 'Choose your Escape from Tarkov Screenshots folder' });
    if(r.canceled || !r.filePaths[0]) return;
    if(which === 'game') core.setGameDir(r.filePaths[0]); else core.setShotsDir(r.filePaths[0]);
  });
  ipcMain.handle('startup', (_e, on) => { config.set('startWithWindows', !!on); app.setLoginItemSettings({ openAtLogin:!!on, args:['--hidden'] }); });
  ipcMain.handle('config', () => ({ startWithWindows:!!config.get('startWithWindows') }));

  /* self-update from the GitHub release */
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
