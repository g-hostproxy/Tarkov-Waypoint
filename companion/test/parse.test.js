const assert = require('assert');
const { parseApplication, parseNotifications, parseShot, mapFromLocation, lineTime } = require('../src/parse');
const { GameState } = require('../src/state');

assert.strictEqual(mapFromLocation('factory4_day'), 'factory'); assert.strictEqual(mapFromLocation('bigmap'), 'customs');
assert.strictEqual(mapFromLocation('RezervBase'), 'reserve'); assert.strictEqual(mapFromLocation('TarkovStreets'), 'streets-of-tarkov');
assert.strictEqual(mapFromLocation('Sandbox_high'), 'ground-zero'); assert.strictEqual(mapFromLocation('laboratory'), 'the-lab');
assert.ok(lineTime('2025-10-17 14:22:33.123|1.0|Info|application|x'));

const app = [
 "2025-10-17 14:20:01.000|0.16.1.0|Info|application|TRACE-NetworkGameCreate profileStatus: 'Profileid: abc, Status: Busy, RaidMode: Local, Ip: 185.1.2.3, Port: 17005, Location: factory4_day, Sid: , GameMode: deathmatch, shortId: X1'",
 "2025-10-17 14:21:00.000|0.16.1.0|Info|application|GameStarted",
 "2025-10-17 14:35:00.000|0.16.1.0|Info|application|Got notification | UserMatchOver"
].join('\n');
const ev = parseApplication(app);
assert.deepStrictEqual(ev.map(e => e.type), ['loading', 'start', 'end']);
assert.strictEqual(ev[0].map, 'factory'); assert.strictEqual(ev[0].ip, '185.1.2.3'); assert.strictEqual(ev[0].port, 17005);

const notif = `2025-10-17 14:00:00.000|Info|notifications|Got notification | ChatMessageReceived
{
  "type": "new_message",
  "eventId": "x",
  "message": {
    "_id": "6710c0000000000000000001",
    "type": 10,
    "dt": 1760000000,
    "templateId": "5936d90786f7742b1420ba5b description"
  }
}
Got notification | ChatMessageReceived
{ "type": "new_message", "message": { "_id": "6710c0000000000000000002", "type": 12, "dt": 1760000500, "templateId": "5936d90786f7742b1420ba5b successMessageText" } }
{ "type": "new_message", "message": { "_id": "6710c0000000000000000003", "type": 11, "dt": 1760000900, "templateId": "5ac23c6186f7741247042bad failMessageText" } }
{ "type": "new_message", "message": { "_id": "6710c0000000000000000004", "type": 4, "dt": 1760001000, "templateId": "5bdabfe486f7743e1665df6e 0", "items": { "data": [ { "_id": "a", "_tpl": "5449016a4bdc2d6f028b456f", "upd": { "StackObjectsCount": 125000 } } ] } } }`;
const q = parseNotifications(notif);
assert.deepStrictEqual(q.filter(e => e.type === 'quest').map(e => [e.id, e.status]), [['5936d90786f7742b1420ba5b', 'started'], ['5936d90786f7742b1420ba5b', 'finished'], ['5ac23c6186f7741247042bad', 'failed']]);
assert.strictEqual(q.find(e => e.type === 'earned').roubles, 125000);
assert.strictEqual(q[0].ts, 1760000000000);

const s = parseShot('2025-10-17[20-01]_-20.5, 1.53, -56.6_0.01508, -0.84564, 0.02792, 0.53288_16.19 (0).png');
assert.strictEqual(s.x, -20.5); assert.strictEqual(s.z, -56.6); assert.strictEqual(s.q.length, 4);
assert.strictEqual(parseShot('random.png'), null);

const g = new GameState(); ev.forEach(e => g.apply(e));
assert.strictEqual(g.phase, 'ended');
const g2 = new GameState(); g2.apply(ev[0]); g2.apply(ev[1]);
const snap = g2.snapshot(ev[1].ts + 5 * 60000); assert.strictEqual(snap.phase, 'raid'); assert.strictEqual(Math.round(snap.remainingMs / 60000), 15);
console.log('parse tests ok');
