'use strict';
const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, nativeImage, shell, Notification } = require('electron');
const path = require('path');
const { Config } = require('./config');
const { Core } = require('./core');

const gotLock = app.requestSingleInstanceLock();
if(!gotLock){ app.quit(); }   /* a second copy just hands over to the first and exits quietly */
let siteWin = null, statusWin = null, soundWin = null, tray = null, core = null, config = null, update = { state:'idle', version:'' }, quitting = false, told = false;
const ICON = path.join(__dirname, 'assets', 'icon.png');   /* inside src/ so it is packed into the installed app (build/ is not) */
const siteOrigin = () => { try{ return new URL(config.get('siteUrl')).origin; }catch(e){ return ''; } };

function createSite(){
  if(siteWin){ if(siteWin.isMinimized()) siteWin.restore(); siteWin.show(); siteWin.focus(); return; }
  siteWin = new BrowserWindow({ width:1400, height:900, minWidth:900, minHeight:600, backgroundColor:'#0b1210', title:'Tarkov Waypoint', icon:ICON, autoHideMenuBar:true,
    webPreferences:{ preload:path.join(__dirname, 'preload-site.js'), partition:'persist:tarkovwaypoint', contextIsolation:true, nodeIntegration:false, sandbox:false } });
  siteWin.loadURL(config.get('siteUrl'));
  siteWin.webContents.on('did-fail-load', (_e, code, _d, url, isMain) => { if(isMain && code !== -3) siteWin.loadFile(path.join(__dirname, '..', 'ui', 'offline.html')); });
  /* stay on the site; everything else opens in the normal browser */
  /* the Discord sign-in page is allowed to open inside the app so the login cookie lands here */
  const keep = u => { try{ const o = new URL(u).origin; return o === siteOrigin() || o === 'https://discord.com'; }catch(e){ return false; } };
  siteWin.webContents.on('will-navigate', (e, u) => { if(!keep(u) && !u.startsWith('file:')){ e.preventDefault(); if(/^https?:/.test(u)) shell.openExternal(u); } });
  siteWin.webContents.setWindowOpenHandler(({ url }) => { if(/^https?:/.test(url)) shell.openExternal(url); return { action:'deny' }; });
  siteWin.on('close', e => {
    if(!quitting && config.get('keepInTray')){
      e.preventDefault(); siteWin.hide();
      if(!told && tray && tray.displayBalloon){ told = true; try{ tray.displayBalloon({ title:'Tarkov Waypoint is still running', content:'It keeps following your game from the tray. Right-click the icon to quit.' }); }catch(x){} }
    }
  });
  siteWin.on('closed', () => { siteWin = null; });
}
function createStatus(){
  if(statusWin){ statusWin.show(); statusWin.focus(); return; }
  statusWin = new BrowserWindow({ width:480, height:720, minWidth:420, minHeight:560, backgroundColor:'#0d1311', title:'Tarkov Waypoint', autoHideMenuBar:true, icon:ICON, parent:undefined,
    webPreferences:{ preload:path.join(__dirname, 'preload.js'), contextIsolation:true, nodeIntegration:false, sandbox:true } });
  statusWin.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  statusWin.on('closed', () => { statusWin = null; });
  statusWin.webContents.setWindowOpenHandler(({ url }) => { if(/^https:\/\//.test(url)) shell.openExternal(url); return { action:'deny' }; });
}
/* "Survived" alert: a quiet two-note chime played from a hidden window (so it works with every window closed) plus a small notification */
function playChime(){
  try{
    if(!soundWin || soundWin.isDestroyed()){
      soundWin = new BrowserWindow({ show:false, width:100, height:100, skipTaskbar:true, webPreferences:{ backgroundThrottling:false, autoplayPolicy:'no-user-gesture-required', contextIsolation:true, nodeIntegration:false, sandbox:true } });
      soundWin.loadFile(path.join(__dirname, '..', 'ui', 'sound.html'));
    }
    const go = () => soundWin.webContents.executeJavaScript('window.chime && window.chime()').then(ok => { if(!ok) shell.beep(); }).catch(() => shell.beep());
    if(soundWin.webContents.isLoading()) soundWin.webContents.once('did-finish-load', go); else go();
  }catch(e){ try{ shell.beep(); }catch(x){} }
}
function onSurvive(info){
  playChime();
  try{ if(Notification.isSupported()) new Notification({ title:'Survived status', body:info.min + ' minutes in: leaving now counts as Survived, not a run-through.', silent:true, icon:ICON }).show(); }catch(e){}
}
function push(){ if(statusWin && !statusWin.isDestroyed()) statusWin.webContents.send('status', Object.assign(core.status(), { update, siteUrl:config.get('siteUrl'), keepInTray:!!config.get('keepInTray') })); }

app.on('second-instance', () => createSite());
app.whenReady().then(async () => {
  if(!gotLock) return;
  config = new Config(path.join(app.getPath('userData'), 'config.json'));
  core = new Core({ config, version:app.getVersion(), onSurvive });
  core.onChange(push);
  /* the old copy can still be shutting down (for example right after an update), so retry for a few seconds before complaining */
  let startErr = null;
  for(let i = 0; i < 8; i++){ try{ await core.start(); startErr = null; break; }catch(e){ startErr = e; try{ core.stop(); }catch(x){} await new Promise(r => setTimeout(r, 1000)); } }
  if(startErr) dialog.showErrorBox('Tarkov Waypoint', 'Could not open the local link on port 47831. Another program, or an older Tarkov Waypoint copy, is using it.\nOpen Task Manager, end any "Tarkov Waypoint" processes, then start the app again.\n\n' + startErr.message);
  config.embedded();
  app.setLoginItemSettings({ openAtLogin:!!config.get('startWithWindows'), args:['--hidden'] });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label:'Tarkov Waypoint', submenu:[{ label:'Status and settings', accelerator:'CmdOrCtrl+,', click:createStatus }, { type:'separator' }, { label:'Reload', accelerator:'CmdOrCtrl+R', click:() => siteWin && siteWin.webContents.reload() }, { label:'Quit', click:() => { quitting = true; app.quit(); } }] },
    { label:'View', submenu:[{ role:'zoomIn' }, { role:'zoomOut' }, { role:'resetZoom' }, { role:'togglefullscreen' }] }
  ]));
  /* tray icon: a 16px and a 32px version so it is sharp at any Windows scaling; falls back to the app icon */
  let trayImg = nativeImage.createEmpty();
  try{
    const fsx = require('fs');
    trayImg.addRepresentation({ scaleFactor:1, buffer:fsx.readFileSync(path.join(__dirname, 'assets', 'tray16.png')) });
    trayImg.addRepresentation({ scaleFactor:2, buffer:fsx.readFileSync(path.join(__dirname, 'assets', 'tray.png')) });
  }catch(e){}
  if(trayImg.isEmpty()){ const ic = nativeImage.createFromPath(ICON); trayImg = ic.isEmpty() ? nativeImage.createEmpty() : ic.resize({ width:16, height:16 }); }
  tray = new Tray(trayImg);
  tray.setToolTip('Tarkov Waypoint');
  tray.setContextMenu(Menu.buildFromTemplate([{ label:'Open Tarkov Waypoint', click:createSite }, { label:'Status and settings', click:createStatus }, { type:'separator' }, { label:'Quit', click:() => { quitting = true; app.quit(); } }]));
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
  /* backup for the website's Backup feature: it works from the first launch (Documents\Tarkov Waypoint Backups), only our own file names,
     only inside the backup folder, only from our own page. A dated copy is kept once a day (last 14). */
  const fs = require('fs');
  const okFrame = e => { try{ return new URL(e.senderFrame.url).origin === siteOrigin(); }catch(x){ return false; } };
  const MAIN_RE = /^(TarkovWaypoint|RaidRoute)-quests\.txt$/, HIST_RE = /^TarkovWaypoint-quests-\d{4}-\d{2}-\d{2}\.txt$/;
  const defaultBk = () => path.join(app.getPath('documents'), 'Tarkov Waypoint Backups');
  const bkDir = () => {
    let d = config.get('backupDir') || defaultBk();
    try{ if(!fs.existsSync(d)) fs.mkdirSync(d, { recursive:true }); return d; }catch(x){ try{ d = defaultBk(); fs.mkdirSync(d, { recursive:true }); return d; }catch(y){ return ''; } }
  };
  const histDir = () => { const d = bkDir(); if(!d) return ''; const h = path.join(d, 'History'); try{ fs.mkdirSync(h, { recursive:true }); }catch(x){} return h; };
  const today = () => { const t = new Date(), z = n => String(n).padStart(2, '0'); return t.getFullYear() + '-' + z(t.getMonth() + 1) + '-' + z(t.getDate()); };
  const histList = () => { try{ return fs.readdirSync(histDir()).filter(n => HIST_RE.test(n)).sort().reverse(); }catch(x){ return []; } };
  ipcMain.handle('bk-get', e => okFrame(e) ? bkDir() : '');
  ipcMain.handle('bk-pick', async e => {
    if(!okFrame(e)) return '';
    const r = await dialog.showOpenDialog(siteWin, { properties:['openDirectory', 'createDirectory'], defaultPath:bkDir() || undefined, title:'Choose a folder for your Tarkov Waypoint backup (a cloud-synced folder such as OneDrive is ideal)' });
    if(r.canceled || !r.filePaths[0]) return '';
    config.set('backupDir', r.filePaths[0]); return r.filePaths[0];
  });
  ipcMain.handle('bk-info', e => {
    if(!okFrame(e)) return null; const d = bkDir(); let at = 0;
    try{ at = fs.statSync(path.join(d, 'TarkovWaypoint-quests.txt')).mtimeMs; }catch(x){}
    return { dir:d, isDefault:!config.get('backupDir'), at, history:histList() };
  });
  ipcMain.handle('bk-open', e => { if(okFrame(e)){ const d = bkDir(); if(d) shell.openPath(d); } });
  ipcMain.handle('bk-exists', (e, n) => { try{ return !!(okFrame(e) && MAIN_RE.test(String(n)) && bkDir() && fs.existsSync(path.join(bkDir(), n))); }catch(x){ return false; } });
  ipcMain.handle('bk-read', (e, n) => { try{ if(!okFrame(e) || !bkDir()) return ''; n = String(n);
    if(MAIN_RE.test(n)) return fs.readFileSync(path.join(bkDir(), n), 'utf8');
    if(HIST_RE.test(n)) return fs.readFileSync(path.join(histDir(), n), 'utf8'); return ''; }catch(x){ return ''; } });
  ipcMain.handle('bk-write', (e, n, t) => { try{
    if(!okFrame(e) || !MAIN_RE.test(String(n)) || !bkDir() || typeof t !== 'string' || t.length > 2e6) return false;
    fs.writeFileSync(path.join(bkDir(), n), t, 'utf8');
    fs.writeFileSync(path.join(histDir(), 'TarkovWaypoint-quests-' + today() + '.txt'), t, 'utf8');
    histList().slice(14).forEach(f => { try{ fs.unlinkSync(path.join(histDir(), f)); }catch(x){} });
    return true; }catch(x){ return false; } });
  ipcMain.handle('set-prefs', (_e, p) => core.setPrefs(p));
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
