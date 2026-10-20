'use strict';
/* A tiny WebSocket server (RFC 6455, text frames only) so the app needs no extra packages. Listens on one host/port. */
const http = require('http'), crypto = require('crypto'), { EventEmitter } = require('events');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Conn extends EventEmitter {
  constructor(socket){ super(); this.socket = socket; this.readyState = 1; this.buf = Buffer.alloc(0); this.frag = null;
    socket.on('data', d => { this.buf = Buffer.concat([this.buf, d]); if(this.buf.length > 256 * 1024){ this.close(); return; } this.parse(); });
    socket.on('close', () => { this.readyState = 3; this.emit('close'); }); socket.on('error', () => { try{ socket.destroy(); }catch(e){} });
  }
  parse(){
    for(;;){
      const b = this.buf; if(b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 0x0f, masked = !!(b[1] & 0x80); let len = b[1] & 0x7f, off = 2;
      if(len === 126){ if(b.length < 4) return; len = b.readUInt16BE(2); off = 4; } else if(len === 127){ if(b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if(len > 64 * 1024){ this.close(); return; }
      if(!masked){ this.close(); return; }
      if(b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4), data = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for(let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if(op === 0x8){ this.close(); return; }
      if(op === 0x9){ this.frame(0xA, data); continue; }
      if(op === 0xA) continue;
      if(op === 0x1 || op === 0x2){ this.frag = fin ? null : [data]; if(fin) this.emit('message', data); }
      else if(op === 0x0 && this.frag){ this.frag.push(data); if(fin){ const all = Buffer.concat(this.frag); this.frag = null; this.emit('message', all); } }
    }
  }
  frame(op, data){
    const n = data.length; let head;
    if(n < 126) head = Buffer.from([0x80 | op, n]); else if(n < 65536){ head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); } else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    try{ this.socket.write(Buffer.concat([head, data])); }catch(e){}
  }
  send(text){ this.frame(0x1, Buffer.from(String(text), 'utf8')); }
  close(){ if(this.readyState === 3) return; this.readyState = 2; try{ this.frame(0x8, Buffer.alloc(0)); this.socket.end(); }catch(e){} }
}
class MiniServer extends EventEmitter {
  constructor(opts){
    super(); this.http = http.createServer((q, r) => { r.writeHead(426); r.end('WebSocket only'); });
    this.http.on('upgrade', (req, socket) => {
      const key = req.headers['sec-websocket-key'];
      if(!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket'){ socket.destroy(); return; }
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + GUID).digest('base64') + '\r\n\r\n');
      this.emit('connection', new Conn(socket), req);
    });
    this.http.on('error', e => this.emit('error', e)); this.http.on('listening', () => this.emit('listening'));
    this.http.listen(opts.port, opts.host);
  }
  address(){ return this.http.address(); }
  close(){ try{ this.http.close(); }catch(e){} }
}
module.exports = { MiniServer };
