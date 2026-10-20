'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
class Config {
  constructor(file){
    this.file = file; this.data = { gameDir:'', shotsDir:'', tokens:[], embeddedToken:'', siteUrl:'https://tarkov-waypoint.pages.dev/', startWithWindows:true, keepInTray:true, historyDone:false, prefs:{ auto:true, follow:true, note:true, chime:true }, prefsSet:false };
    try{ Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8'))); }catch(e){}
  }
  save(){ try{ fs.mkdirSync(path.dirname(this.file), { recursive:true }); fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)); }catch(e){} }
  get(k){ return this.data[k]; }
  set(k, v){ this.data[k] = v; this.save(); }
  newToken(){ const t = crypto.randomBytes(24).toString('hex'); this.data.tokens = this.data.tokens.concat(t).slice(-8); this.save(); return t; }
  /* the site window inside this app is trusted by default: it gets its own token, no code needed */
  embedded(){ if(!this.data.embeddedToken){ this.data.embeddedToken = crypto.randomBytes(24).toString('hex'); this.save(); } return this.data.embeddedToken; }
  hasToken(t){ return !!t && (this.data.tokens.includes(t) || t === this.data.embeddedToken); }
}
module.exports = { Config };
