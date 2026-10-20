'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
class Config {
  constructor(file){
    this.file = file; this.data = { gameDir:'', shotsDir:'', tokens:[], startWithWindows:true, historyDone:false };
    try{ Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8'))); }catch(e){}
  }
  save(){ try{ fs.mkdirSync(path.dirname(this.file), { recursive:true }); fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)); }catch(e){} }
  get(k){ return this.data[k]; }
  set(k, v){ this.data[k] = v; this.save(); }
  newToken(){ const t = crypto.randomBytes(24).toString('hex'); this.data.tokens = this.data.tokens.concat(t).slice(-8); this.save(); return t; }
  hasToken(t){ return !!t && this.data.tokens.includes(t); }
}
module.exports = { Config };
