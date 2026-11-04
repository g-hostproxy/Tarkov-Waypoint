'use strict';
/* Turns the stream of parsed log events into one "what is the player doing" object */
const { RAID_MINUTES } = require('./parse');

class GameState {
  constructor(){ this.reset(); this.earned = {}; this.listeners = []; }
  reset(){ this.sceneSeen = false; Object.assign(this, { estimated:false, phase:'idle', map:null, mode:'', ip:'', port:0, loadingAt:0, startAt:0, endAt:0 }); }
  onChange(fn){ this.listeners.push(fn); }
  emit(){ this.listeners.forEach(f => { try{ f(this.snapshot()); }catch(e){} }); }
  dayKey(ts){ const d = new Date(ts || Date.now()); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  apply(ev){
    if(ev.type === 'loading'){
      /* the same raid can be announced by several log files, and old messages are re-read when the app starts. Never let an older or second-hand message move us back to another map. */
      if(ev.ts && this.loadingAt && ev.ts < this.loadingAt) return;
      if(ev.src === 'notif' && this.sceneSeen) return;
      /* the same raid is announced in two log files; when the app starts mid-raid the older notice can arrive after the raid-start line, so ignore it */
      if(this.startAt && ev.ts && ev.ts <= this.startAt && ev.map === this.map && this.phase === 'raid') return;
      Object.assign(this, { estimated:false, phase:'loading', map:ev.map, mode:ev.mode, ip:ev.ip, port:ev.port, loadingAt:ev.ts, startAt:0, endAt:0 }); }
    else if(ev.type === 'scene'){
      this.sceneSeen = true;
      /* a scene preset is only loaded when a raid is loading. Newer game versions have no "profileStatus" line, and "raid over" arrives in another log, so a second raid on the same map must start a fresh loading here too */
      if(this.phase === 'idle' || this.phase === 'ended' || !this.loadingAt || (ev.ts || 0) > Math.max(this.loadingAt, this.startAt || 0)){ this.phase = 'loading'; this.loadingAt = ev.ts; this.startAt = 0; this.endAt = 0; }
      this.map = ev.map; }
    else if(ev.type === 'mapnote'){
      /* only matters when it disagrees with what we have (or we have nothing): then it counts as a fresh raid loading on that map */
      if(this.phase === 'idle' || this.phase === 'ended' || !this.map || ev.map !== this.map){ this.apply({ type:'scene', map:ev.map, ts:ev.ts }); return; }
    }
    else if(ev.type === 'start'){ if(this.map){ this.phase = 'raid'; this.startAt = ev.ts; this.estimated = false; } }
    else if(ev.type === 'end'){ if(this.phase !== 'idle' && !(ev.ts && this.loadingAt && ev.ts < this.loadingAt)){ this.phase = 'ended'; this.endAt = ev.ts; } }
    else if(ev.type === 'earned'){ const k = this.dayKey(ev.ts); this.earned[k] = (this.earned[k] || 0) + ev.roubles; }
    this.emit();
  }
  snapshot(now){
    now = now || Date.now();
    /* the match-ready message has no separate "raid started" line, so assume the raid begins about a minute after loading starts */
    if(this.phase === 'loading' && this.loadingAt && now - this.loadingAt > 60000 && !this.endAt){ this.phase = 'raid'; this.startAt = this.startAt || (this.loadingAt + 60000); this.estimated = true; }
    const mins = this.map && RAID_MINUTES[this.map] || 0;
    const t0 = this.startAt || (this.phase === 'raid' ? this.loadingAt : 0);
    return {
      phase:this.phase, estimated:this.estimated, map:this.map, mode:this.mode, server:this.ip ? { ip:this.ip, port:this.port } : null,
      loadingAt:this.loadingAt, startAt:this.startAt, endAt:this.endAt,
      raidMinutes:mins, remainingMs:t0 && mins && this.phase === 'raid' ? Math.max(0, mins * 60000 - (now - t0)) : null,
      earnedToday:this.earned[this.dayKey(now)] || 0,
      dbg:this.dbg || null
    };
  }
}
module.exports = { GameState };
