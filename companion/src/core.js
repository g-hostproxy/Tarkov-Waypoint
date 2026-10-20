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
    this.lastQuest = null; this.bridge = new Bridge({
      config:this.config, version:this.version, port:this.port,
      getState:() => this.state.snapshot(), getStatus:() => this.status(),
      onRequest:(t, ctx) => this.request(t, ctx)
    });
    this.state.onChange(s => { this.bridge.broadcast({ t:'state', state:s }); this.changed(); });
  }
  onChange(fn){ this.listeners.push(fn); }
  changed(){ this.listeners.forEach(f => { try{ f(this.status()); }catch(e){} }); }
  status(){
    const gameDir = this.config.get('gameDir'), shotsDir = this.config.get('shotsDir');
    return {
      version:this.version, gameDir, logsFound:!!(gameDir && exists(path.join(gameDir, 'Logs'))),
      shotsDir, shotsFound:!!(shotsDir && exists(shotsDir)),
      code:this.bridge.code, linked:this.bridge.authedCount(), state:this.state.snapshot(), lastQuest:this.lastQuest
    };
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
    if(t === 'clients'){ if(ctx && ctx.ready && ctx.ws && this.shots) this.bridge.send(ctx.ws, { t:'shots', shots:this.shots.recent.slice(-12) }); this.changed(); return; }
    const ws = ctx && ctx.ws; if(!ws) return;
    if(t === 'state') this.bridge.send(ws, { t:'state', state:this.state.snapshot() });
    else if(t === 'shots') this.bridge.send(ws, { t:'shots', shots:this.shots ? this.shots.recent.slice(-12) : [] });
    else if(t === 'history'){ const ev = this.logs ? this.logs.history() : []; this.bridge.send(ws, { t:'history', events:ev, logsFound:!!this.logs }); this.config.set('historyDone', true); }
  }
  setGameDir(d){ this.config.set('gameDir', d); this.watch(); this.changed(); }
  setShotsDir(d){ this.config.set('shotsDir', d); this.watch(); this.changed(); }
  stop(){ if(this.logs) this.logs.stop(); if(this.shots) this.shots.stop(); this.bridge.stop(); }
}
module.exports = { Core };
