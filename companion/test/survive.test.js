/* "Survived" alert: real log lines (game 1.2.5.0.48146) -> raid start -> timer fires once, at the right moment, and stays quiet when it should */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { parseApplication, parseNotifications } = require('../src/parse'); const { GameState } = require('../src/state');
const { Config } = require('../src/config'); const { Core } = require('../src/core');

/* 1. the real log: GameStarting is the deploy countdown, GameStarted is when the raid begins */
const APP = [
  "2026-10-24 14:35:01.170|1.2.5.0.48146|Info|application|scene preset path:maps/lighthouse_preset.bundle rcid:lighthouse.scenespreset.asset",
  "2026-10-24 14:35:42.161|1.2.5.0.48146|Debug|application|TRACE-NetworkGameCreate profileStatus: 'Profileid: 59ff, Status: Busy, RaidMode: Online, Ip: 79.127.255.86, Port: 17000, Location: Lighthouse, Sid: x, GameMode: deathmatch, shortId: 9DN2JZ'",
  "2026-10-24 14:36:54.965|1.2.5.0.48146|Info|application|GameStarting:102.16(7.3) real:114.99(7.3) diff:12.82",
  "2026-10-24 14:37:07.004|1.2.5.0.48146|Info|application|GameStarted:112.04(9.87) real:127.03(12.04) diff:14.98",
  "2026-10-24 15:26:27.778|1.2.5.0.48146|Info|application|Network game matching cancelled."
].join('\n');
const ev = parseApplication(APP), starts = ev.filter(e => e.type === 'start');
assert.strictEqual(starts.length, 1, 'only GameStarted starts the raid, not GameStarting');
assert.strictEqual(new Date(starts[0].ts).toTimeString().slice(0, 8), '14:37:07');
const NOTE = '2026-10-24 15:11:21.177|1.2.5.0.48146|Info|push-notifications|Got notification | UserMatchOver\n{\n  "type": "userMatchOver",\n  "eventId": "6add1efd",\n  "location": "Lighthouse"\n}\n';
assert.ok(parseNotifications(NOTE).some(e => e.type === 'end'), 'UserMatchOver ends the raid');

/* 2. app opened mid-raid: the older "loading" notice that is read second must not wipe the raid start */
const gs = new GameState();
ev.forEach(e => gs.apply(e)); gs.apply({ type:'loading', map:'lighthouse', ts:ev[1].ts - 1000, mode:'', ip:'', port:0 });
assert.ok(gs.snapshot().phase === 'raid' && gs.snapshot().startAt === starts[0].ts, 'late duplicate loading notice ignored');

/* 3. the timer itself, with a short run-through so the test is quick */
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rrs-')), logs = path.join(tmp, 'EFT', 'Logs'), sess = path.join(logs, 'log_2026.10.24_14-33-40_1.2.5.0.48146'), shots = path.join(tmp, 'S');
  fs.mkdirSync(sess, { recursive:true }); fs.mkdirSync(shots);
  const appLog = path.join(sess, '2026.10.24_14-33-40_1.2.5.0.48146 application_000.log'), noteLog = path.join(sess, '2026.10.24_14-33-40_1.2.5.0.48146 push-notifications_000.log');
  const stamp = d => { const z = (n, l = 2) => String(n).padStart(l, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds()) + '.' + z(d.getMilliseconds(), 3); };
  const line = (d, t) => stamp(d) + '|1.2.5.0.48146|Info|application|' + t + '\n';
  const wait = ms => new Promise(r => setTimeout(r, ms));
  /* raid that began 20 minutes ago before the app was opened: must stay silent */
  fs.writeFileSync(appLog, line(new Date(Date.now() - 20 * 60000), "TRACE-NetworkGameCreate profileStatus: 'RaidMode: Online, Ip: 1.1.1.1, Port: 1, Location: Lighthouse, GameMode: deathmatch'") + line(new Date(Date.now() - 20 * 60000 + 12000), 'GameStarted:112.04(9.87) real:127.03(12.04) diff:14.98'));
  fs.writeFileSync(noteLog, '');
  const config = new Config(path.join(tmp, 'cfg.json')); config.set('gameDir', path.join(tmp, 'EFT')); config.set('shotsDir', shots);
  const fired = []; const core = new Core({ config, version:'t', port:47998, surviveMs:2500, onSurvive:i => fired.push(i) }); await core.start();
  await wait(1500); assert.strictEqual(fired.length, 0, 'late app start stays quiet'); assert.strictEqual(core.status().survive.dueAt > 0, true);
  /* a new raid starts now: chime after surviveMs, exactly once */
  fs.appendFileSync(appLog, line(new Date(), "TRACE-NetworkGameCreate profileStatus: 'RaidMode: Online, Ip: 1.1.1.1, Port: 1, Location: Customs, GameMode: deathmatch'") + line(new Date(), 'GameStarted:1.0(1.0) real:1.0(1.0) diff:1.0'));
  await wait(1800); assert.strictEqual(fired.length, 0, 'not before the mark'); assert.ok(core.status().survive.dueAt > Date.now(), 'countdown known');
  await wait(2200); assert.strictEqual(fired.length, 1, 'fires at the mark'); assert.strictEqual(fired[0].map, 'customs');
  assert.strictEqual(core.status().survive.done, true); await wait(2500); assert.strictEqual(fired.length, 1, 'only once');
  /* leaving before the mark cancels it */
  fs.appendFileSync(appLog, line(new Date(), "TRACE-NetworkGameCreate profileStatus: 'RaidMode: Online, Ip: 1.1.1.1, Port: 1, Location: Woods, GameMode: deathmatch'") + line(new Date(), 'GameStarted:1.0(1.0) real:1.0(1.0) diff:1.0'));
  await wait(1600); fs.appendFileSync(noteLog, stamp(new Date()) + '|1.2.5.0.48146|Info|push-notifications|Got notification | UserMatchOver\n{\n  "type": "userMatchOver",\n  "eventId": "e1",\n  "location": "Woods"\n}\n');
  await wait(3500); assert.strictEqual(fired.length, 1, 'ended raid never chimes');
  /* switch off: raid reaches the mark but stays silent */
  core.setPrefs({ survive:false });
  fs.appendFileSync(appLog, line(new Date(), "TRACE-NetworkGameCreate profileStatus: 'RaidMode: Online, Ip: 1.1.1.1, Port: 1, Location: Shoreline, GameMode: deathmatch'") + line(new Date(), 'GameStarted:1.0(1.0) real:1.0(1.0) diff:1.0'));
  await wait(4500); assert.strictEqual(fired.length, 1, 'switched off is silent');
  /* settings are clamped and stored */
  core.setPrefs({ surviveMin:99 }); assert.strictEqual(core.prefs().surviveMin, 30); core.setPrefs({ surviveMin:5.4 }); assert.strictEqual(core.prefs().surviveMin, 5);
  core.setPrefs({ surviveMin:'x' }); assert.strictEqual(core.prefs().surviveMin, 5); assert.strictEqual(new Core({ config:new Config(path.join(tmp, 'none.json')), port:47997 }).prefs().surviveMin, 7);
  core.stop(); console.log('survive tests ok'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
