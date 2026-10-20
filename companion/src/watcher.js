'use strict';
/* Finds the game's Logs folder, follows the newest log files, and watches the Screenshots folder. Read-only: nothing here writes to the game folder. */
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { parseApplication, parseNotifications, parseShot } = require('./parse');

function exists(p){ try{ return fs.statSync(p).isDirectory(); }catch(e){ return false; } }

/* where is Tarkov installed? registry first, then the usual places on every drive */
async function detectGameDir(){
  const found = [];
  if(process.platform === 'win32'){
    for(const key of ['HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov']){
      try{
        const out = cp.execFileSync('reg', ['query', key, '/v', 'InstallLocation'], { encoding:'utf8', windowsHide:true, timeout:4000 });
        const m = /InstallLocation\s+REG_SZ\s+(.+)/i.exec(out); if(m) found.push(m[1].trim());
      }catch(e){}
    }
  }
  const roots = process.platform === 'win32' ? ['C', 'D', 'E', 'F', 'G'].map(d => d + ':\\') : [os.homedir() + '/'];
  for(const r of roots) for(const rel of ['Battlestate Games\\EFT', 'Battlestate Games\\Escape from Tarkov', 'Games\\Battlestate Games\\EFT', 'Games\\EFT', 'EFT', 'Escape from Tarkov', 'Program Files\\Battlestate Games\\EFT', 'Program Files (x86)\\Battlestate Games\\EFT']) found.push(path.join(r, rel));
  return found.find(d => exists(path.join(d, 'Logs'))) || '';
}
function defaultShotsDir(){ return path.join(os.homedir(), 'Documents', 'Escape from Tarkov', 'Screenshots'); }

/* session folders look like log_2025.10.17_14-22-33_0.14.9.0.12345 ; the newest sorts last */
function sessions(logsDir){
  try{ return fs.readdirSync(logsDir).filter(n => /^log_/i.test(n) && exists(path.join(logsDir, n))).sort(); }catch(e){ return []; }
}
function fileIn(dir, suffix){
  try{ const n = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(suffix)).sort(); return n.length ? path.join(dir, n[n.length - 1]) : null; }catch(e){ return null; }
}
function readFrom(file, from){
  let fd; try{ fd = fs.openSync(file, 'r'); const size = fs.fstatSync(fd).size; if(size < from) from = 0; const len = size - from; if(len <= 0) return { text:'', size }; const buf = Buffer.alloc(Math.min(len, 8 * 1024 * 1024)); const n = fs.readSync(fd, buf, 0, buf.length, from); return { text:buf.toString('utf8', 0, n), size:from + n }; }
  catch(e){ return { text:'', size:from }; } finally { if(fd !== undefined) try{ fs.closeSync(fd); }catch(e){} }
}

class LogWatcher {
  constructor(opts){ this.logsDir = opts.logsDir; this.onApp = opts.onApp || (() => {}); this.onQuest = opts.onQuest || (() => {}); this.onEarned = opts.onEarned || (() => {}); this.session = ''; this.off = {}; this.seenMsg = new Set(); this.timer = 0; this.live = false; }
  start(){
    this.session = ''; this.off = {}; this.live = false;
    this.tick(true); this.live = true;
    this.timer = setInterval(() => this.tick(false), 1000);
  }
  stop(){ clearInterval(this.timer); this.timer = 0; }
  tick(first){
    const all = sessions(this.logsDir); if(!all.length) return;
    const cur = all[all.length - 1];
    if(cur !== this.session){ this.session = cur; this.off = {}; this.first = true; }
    const dir = path.join(this.logsDir, cur);
    for(const [kind, suffix] of [['app', 'application.log'], ['notif', 'notifications.log']]){
      const f = fileIn(dir, suffix); if(!f) continue;
      const startup = this.off[kind] === undefined;
      const r = readFrom(f, this.off[kind] || 0); this.off[kind] = r.size;
      if(!r.text) continue;
      if(kind === 'app'){ parseApplication(r.text).forEach(e => this.onApp(e, startup)); }
      else parseNotifications(r.text).forEach(e => {
        const key = e.msg || (e.type + e.id + e.status + e.ts); if(this.seenMsg.has(key)) return; this.seenMsg.add(key);
        if(e.type === 'quest') this.onQuest(e, startup); else if(e.type === 'earned') this.onEarned(e, startup);
      });
    }
  }
  /* every quest message in every old log, oldest first (used once to fill in history) */
  history(){
    const out = [], seen = new Set();
    for(const s of sessions(this.logsDir)){
      const f = fileIn(path.join(this.logsDir, s), 'notifications.log'); if(!f) continue;
      let text = ''; try{ text = fs.readFileSync(f, 'utf8'); }catch(e){ continue; }
      for(const e of parseNotifications(text)){ if(e.type !== 'quest') continue; const k = e.msg || (e.id + e.status + e.ts); if(seen.has(k)) continue; seen.add(k); out.push({ id:e.id, status:e.status, ts:e.ts }); }
    }
    return out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  }
}

class ShotWatcher {
  constructor(opts){ this.dir = opts.dir; this.onShot = opts.onShot || (() => {}); this.seen = new Set(); this.timer = 0; this.recent = []; }
  start(){ this.seen = new Set(); this.recent = []; this.scan(true); this.timer = setInterval(() => this.scan(false), 2000); }
  stop(){ clearInterval(this.timer); this.timer = 0; }
  scan(first){
    let names; try{ names = fs.readdirSync(this.dir); }catch(e){ return; }
    const fresh = names.filter(n => /\.(png|jpe?g|bmp|webp)$/i.test(n) && !this.seen.has(n)).sort();
    fresh.forEach(n => this.seen.add(n));
    const take = first ? fresh.slice(-12) : fresh;
    take.forEach(n => { const p = parseShot(n); if(p){ this.recent = this.recent.concat(p).slice(-40); this.onShot(p, first); } });
  }
  exists(){ return exists(this.dir); }
}
module.exports = { detectGameDir, defaultShotsDir, LogWatcher, ShotWatcher, sessions, fileIn, exists };
