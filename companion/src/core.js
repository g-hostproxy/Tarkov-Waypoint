'use strict';
/* Everything the app does, without any Electron: config + log watching + screenshot watching + the website link. */
const path = require('path');
const { GameState } = require('./state');
const { Bridge } = require('./bridge');
const { detectGameDir, defaultShotsDir, LogWatcher, ShotWatcher, exists } = require('./watcher');

class Core {
  constructor(opts){
    this.config = opts.config; this.version = opts.version || '0.0.0'; this.port = opts.port;
    this.state = new GameState(); this.logs = null; this.shots = null; this.listeners = [];
    this.lastQuest = null; this.sv = { key:0, t:0 }; this.survived = 0; this.onSurvive = opts.onSurvive || null; this.surviveMsOverride = opts.surviveMs || 0;
    this.bridge = new Bridge({
      config:this.config, version:this.version, port:this.port,
      getState:() => this.state.snapshot(), getStatus:() => this.status(),
      onRequest:(t, ctx) => this.request(t, ctx)
    });
    this.state.onChange(s => { this.bridge.broadcast({ t:'state', state:s }); this.armSurvive(s); this.changed(); });
  }
  onChange(fn){ this.listeners.push(fn); }
  changed(){ this.listeners.forEach(f => { try{ f(this.status()); }catch(e){} }); }
  status(){
    const gameDir = this.config.get('gameDir'), shotsDir = this.config.get('shotsDir');
    return {
      version:this.version, gameDir, logsFound:!!(gameDir && exists(path.join(gameDir, 'Logs'))),
      shotsDir, shotsFound:!!(shotsDir && exists(shotsDir)),
      code:this.bridge.code, linked:this.bridge.authedCount(), prefs:this.prefs(), state:this.state.snapshot(), lastQuest:this.lastQuest,
      survive:{ on:this.prefs().survive, min:this.prefs().surviveMin, dueAt:this.sv.key ? this.sv.key + this.surviveMs() : 0, done:!!this.survived && this.survived === this.sv.key }
    };
  }
  /* "Survived" alert: a raid counts as run-through for its first few minutes (7 by default). When that mark passes we tell the app to chime.
     The clock starts at the game's own "GameStarted" log line, so the deploy countdown is not counted. An app opened late, or an old log being read back, stays quiet. */
  surviveMs(){ return this.surviveMsOverride || this.prefs().surviveMin * 60000; }
  armSurvive(s){
    const key = (s.phase === 'raid' && !s.estimated && s.startAt) || 0;
    if(key === this.sv.key) return;
    clearTimeout(this.sv.t); this.sv = { key, t:0 };
    if(!key || key === this.survived) return;
    const wait = key + this.surviveMs() - Date.now();
    if(wait < -5000) return;
    this.sv.t = setTimeout(() => this.fireSurvive(key), Math.max(0, wait));
    if(this.sv.t.unref) this.sv.t.unref();
  }
  fireSurvive(key){
    if(this.sv.key !== key) return;
    const s = this.state.snapshot();
    if(s.phase !== 'raid' || s.startAt !== key) return;
    this.survived = key;
    if(this.prefs().survive){
      const info = { map:s.map, min:Math.round(this.surviveMs() / 600) / 100 };
      this.bridge.broadcast({ t:'survived', map:s.map, startAt:key });
      if(this.onSurvive){ try{ this.onSurvive(info); }catch(e){} }
    }
    this.changed();
  }
  async start(){
    if(!this.config.get('gameDir')){ const d = await detectGameDir(); if(d) this.config.set('gameDir', d); }
    if(!this.config.get('shotsDir')) this.config.set('shotsDir', defaultShotsDir());
    await this.bridge.start();
    this.watch();
  }
  watch(){
    if(this.logs) this.logs.stop(); if(this.shots) this.shots.stop();
    const gd = this.config.get('gameDir');
    if(gd && exists(path.join(gd, 'Logs'))){
      this.logs = new LogWatcher({
        logsDir:path.join(gd, 'Logs'),
        onApp:(e, startup) => this.state.apply(e),
        onQuest:(e, startup) => { if(startup) return; this.lastQuest = e; this.bridge.broadcast({ t:'quest', id:e.id, status:e.status, ts:e.ts, live:true }); this.changed(); },
        onEarned:(e, startup) => this.state.apply(e)
      });
      this.logs.start();
    }
    const sd = this.config.get('shotsDir');
    this.shots = new ShotWatcher({ dir:sd, onShot:(p, first) => { if(!first) this.bridge.broadcast({ t:'shot', shot:p, live:true }); this.changed(); } });
    if(sd && exists(sd)) this.shots.start();
  }
  request(t, ctx){
    if(t === 'clients'){ if(ctx && ctx.ready && ctx.ws){ this.bridge.send(ctx.ws, this.prefsMsg()); if(this.shots) this.bridge.send(ctx.ws, { t:'shots', shots:this.shots.recent.slice(-12) }); } this.changed(); return; }
    const ws = ctx && ctx.ws; if(!ws) return;
    if(t === 'setPrefs'){ this.setPrefs(ctx.prefs); return; }
    if(t === 'prefs') this.bridge.send(ws, this.prefsMsg());
    else if(t === 'state') this.bridge.send(ws, { t:'state', state:this.state.snapshot() });
    else if(t === 'shots') this.bridge.send(ws, { t:'shots', shots:this.shots ? this.shots.recent.slice(-12) : [] });
    else if(t === 'history'){ const ev = this.logs ? this.logs.history() : []; this.bridge.send(ws, { t:'history', events:ev, logsFound:!!this.logs }); this.config.set('historyDone', true); }
  }
  /* the switches for log reading and alerts live here, so the Tarkov Waypoint window and any browser linked to the app always agree */
  prefs(){
    const d = { auto:true, follow:true, note:true, chime:true, survive:true }, p = this.config.get('prefs') || {}; Object.keys(d).forEach(k => { if(typeof p[k] === 'boolean') d[k] = p[k]; });
    d.surviveMin = Number.isFinite(p.surviveMin) ? Math.min(30, Math.max(1, Math.round(p.surviveMin))) : 7;
    return d;
  }
  prefsMsg(){ return { t:'prefs', prefs:this.prefs(), fresh:!this.config.get('prefsSet') }; }
  setPrefs(p){
    if(!p || typeof p !== 'object') return;
    const cur = this.prefs(); Object.keys(cur).forEach(k => { if(typeof p[k] === 'boolean') cur[k] = p[k]; });
    if(Number.isFinite(p.surviveMin)) cur.surviveMin = Math.min(30, Math.max(1, Math.round(p.surviveMin)));
    this.config.set('prefs', cur); this.config.set('prefsSet', true);
    this.sv.key = 0; this.armSurvive(this.state.snapshot());   /* a changed length takes effect in the raid that is running now */
    this.bridge.broadcast(this.prefsMsg()); this.changed();
  }
  setGameDir(d){ this.config.set('gameDir', d); this.watch(); this.changed(); }
  setShotsDir(d){ this.config.set('shotsDir', d); this.watch(); this.changed(); }
  stop(){ clearTimeout(this.sv.t); if(this.logs) this.logs.stop(); if(this.shots) this.shots.stop(); this.bridge.stop(); }
}
module.exports = { Core };
