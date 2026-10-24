'use strict';
/* Local link between this app and the Tarkov Waypoint website. Listens on 127.0.0.1 only; the website must pair once with the code shown in the app. */
const { MiniServer } = require('./miniws');
const crypto = require('crypto');
const PORT = 47831;

class Bridge {
  constructor(opts){
    this.config = opts.config; this.getState = opts.getState; this.getStatus = opts.getStatus || (() => ({})); this.onRequest = opts.onRequest || (() => {});
    this.version = opts.version || '0.0.0'; this.port = opts.port || PORT;
    this.clients = new Set(); this.newCode(); this.fails = 0; this.lockUntil = 0;
  }
  newCode(){ this.code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }
  start(){
    return new Promise((res, rej) => {
      this.wss = new MiniServer({ host:'127.0.0.1', port:this.port });
      this.wss.on('error', rej);
      this.wss.on('listening', () => res(this.wss.address().port));
      this.wss.on('connection', (ws, req) => this.accept(ws, req));
    });
  }
  stop(){ try{ this.wss && this.wss.close(); }catch(e){} }
  send(ws, o){ try{ if(ws.readyState === 1) ws.send(JSON.stringify(o)); }catch(e){} }
  broadcast(o){ for(const c of this.clients) if(c.authed) this.send(c, o); }
  authedCount(){ let n = 0; for(const c of this.clients) if(c.authed) n++; return n; }
  accept(ws, req){
    ws.authed = false; this.clients.add(ws);
    ws.origin = req && req.headers && req.headers.origin || '';
    this.send(ws, { t:'hello', app:'tarkov-waypoint-app', v:this.version });
    ws.on('close', () => { this.clients.delete(ws); this.onRequest('clients', {}); });
    ws.on('message', raw => {
      let m; try{ m = JSON.parse(String(raw)); }catch(e){ return; }
      if(!m || typeof m.t !== 'string') return;
      if(m.t === 'pair'){
        if(Date.now() < this.lockUntil){ this.send(ws, { t:'error', code:'locked' }); return; }
        if(String(m.code || '').trim() === this.code){ this.fails = 0; const token = this.config.newToken(); this.newCode(); ws.authed = true; this.send(ws, { t:'paired', token }); this.ready(ws); }
        else { if(++this.fails >= 5){ this.lockUntil = Date.now() + 60000; this.fails = 0; } this.send(ws, { t:'error', code:'bad-code' }); }
      } else if(m.t === 'auth'){
        if(this.config.hasToken(m.token)){ ws.authed = true; this.ready(ws); } else this.send(ws, { t:'error', code:'bad-token' });
      } else if(ws.authed){
        if(m.t === 'history' || m.t === 'state' || m.t === 'shots' || m.t === 'prefs') this.onRequest(m.t, { ws });
        else if(m.t === 'setPrefs') this.onRequest('setPrefs', { ws, prefs:m.prefs });
      }
    });
  }
  ready(ws){ this.send(ws, { t:'ready', status:this.getStatus(), state:this.getState() }); this.onRequest('clients', { ws, ready:true }); }
}
module.exports = { Bridge, PORT };
