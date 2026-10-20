const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const WebSocket = globalThis.WebSocket;
const { Config } = require('../src/config'); const { Core } = require('../src/core');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rrc-'));
  const logs = path.join(tmp, 'EFT', 'Logs'), sess = path.join(logs, 'log_2025.10.17_14-00-00_0.16.1.0.1'), shots = path.join(tmp, 'Screenshots');
  fs.mkdirSync(sess, { recursive:true }); fs.mkdirSync(shots);
  const old = path.join(logs, 'log_2025.10.10_10-00-00_0.16.1.0.0'); fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, '2025.10.10 notifications.log'), '{ "type": "new_message", "message": { "_id": "6710c0000000000000000009", "dt": 1759000000, "templateId": "5936d90786f7742b1420ba5b successMessageText" } }');
  fs.writeFileSync(path.join(sess, '2025.10.17 application.log'), '');
  fs.writeFileSync(path.join(sess, '2025.10.17 notifications.log'), '');
  fs.writeFileSync(path.join(shots, '2025-10-17[20-01]_-20.5, 1.53, -56.6_0.01508, -0.84564, 0.02792, 0.53288_16.19 (0).png'), 'x');
  const config = new Config(path.join(tmp, 'cfg.json')); config.set('gameDir', path.join(tmp, 'EFT')); config.set('shotsDir', shots);
  const core = new Core({ config, version:'t', port:47999 }); await core.start();
  const ws = new WebSocket('ws://127.0.0.1:47999'); const got = []; ws.onmessage = e => got.push(JSON.parse(e.data));
  const wait = ms => new Promise(r => setTimeout(r, ms)); await wait(200);
  ws.send(JSON.stringify({ t:'pair', code:'000000' })); await wait(100); assert.ok(got.find(m => m.t === 'error'));
  ws.send(JSON.stringify({ t:'pair', code:core.bridge.code })); await wait(200);
  const paired = got.find(m => m.t === 'paired'); assert.ok(paired && paired.token); assert.ok(got.find(m => m.t === 'ready'));
  assert.ok(got.find(m => m.t === 'shots' && m.shots.length === 1 && m.shots[0].x === -20.5));
  /* live game events */
  fs.appendFileSync(path.join(sess, '2025.10.17 application.log'), "2025-10-17 14:20:01.000|v|Info|application|TRACE-NetworkGameCreate profileStatus: 'RaidMode: Local, Ip: 9.9.9.9, Port: 1, Location: bigmap, GameMode: deathmatch'\n");
  fs.appendFileSync(path.join(sess, '2025.10.17 notifications.log'), '{ "type": "new_message", "message": { "_id": "6710c0000000000000000011", "dt": 1760000000, "templateId": "5ac23c6186f7741247042bad description" } }\n');
  fs.writeFileSync(path.join(shots, '2025-10-17[20-05]_10.5, 1.53, 20.6_0.01508, -0.84564, 0.02792, 0.53288_16.19 (0).png'), 'x');
  await wait(2800);
  const st = got.filter(m => m.t === 'state').pop(); assert.ok(st && st.state.map === 'customs' && st.state.server.ip === '9.9.9.9', 'state');
  assert.ok(got.find(m => m.t === 'quest' && m.id === '5ac23c6186f7741247042bad' && m.status === 'started'), 'quest');
  assert.ok(got.find(m => m.t === 'shot' && m.shot.x === 10.5), 'shot');
  ws.send(JSON.stringify({ t:'history' })); await wait(300);
  const h = got.find(m => m.t === 'history'); assert.ok(h && h.events.some(e => e.id === '5936d90786f7742b1420ba5b' && e.status === 'finished'), 'history');
  /* token auth on a second connection */
  const ws2 = new WebSocket('ws://127.0.0.1:47999'); const g2 = []; ws2.onmessage = e => g2.push(JSON.parse(e.data)); await wait(200);
  ws2.send(JSON.stringify({ t:'auth', token:paired.token })); await wait(200); assert.ok(g2.find(m => m.t === 'ready'));
  const ws3 = new WebSocket('ws://127.0.0.1:47999'); const g3 = []; ws3.onmessage = e => g3.push(JSON.parse(e.data)); await wait(200);
  ws3.send(JSON.stringify({ t:'history' })); ws3.send(JSON.stringify({ t:'auth', token:'nope' })); await wait(200); assert.ok(!g3.find(m => m.t === 'history' || m.t === 'ready'));
  core.stop(); ws.close(); ws2.close(); ws3.close(); console.log('core tests ok'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
