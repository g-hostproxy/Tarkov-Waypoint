// Builds data/door-photos.json: for every key that opens a door on a map, what its wiki page says about the lock
// (the sentence that names the floor, and the photos of the door, stairs, building).
// The key pop-up shows the floor and the door photo. Only the wiki's own image addresses are stored; no images are copied.
// It also checks the "floor from height" guess against the wiki's own words, map by map, and only turns that guess on for maps where it agrees.
// Refreshes at most once a week (set FORCE=1 to run now).
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BASE = process.env.WIKI_BASE || 'https://escapefromtarkov.fandom.com';
const UA = { 'User-Agent': 'TarkovWaypoint-door-photos/1.0 (personal fan project; contact via GitHub repo)' };
const OUT = 'data/door-photos.json';
const API = ['https://api.tarkov.dev/graphql'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const text = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();

/* ---- floors ---- */
const ORD = { ground:'ground', first:'1st', second:'2nd', third:'3rd', fourth:'4th', fifth:'5th', sixth:'6th', '1st':'1st', '2nd':'2nd', '3rd':'3rd', '4th':'4th', '5th':'5th', '6th':'6th' };
/* one spelling for every way of saying a floor, so the wiki's words and the map's layer names can be compared */
export function canonFloor(s) {
  const t = String(s || '').toLowerCase();
  if (/\b(basement|underground|cellar|tunnels?|bunkers?)\b/.test(t)) return 'underground';
  const m = /\b(ground|first|second|third|fourth|fifth|sixth|1st|2nd|3rd|4th|5th|6th)\s+(?:floor|level)\b/.exec(t);
  if (!m) return '';
  const o = ORD[m[1]]; return (o === 'ground' || o === '1st') ? 'ground floor' : o + ' floor';
}
/* every floor a piece of wiki text names, in the canonical spelling */
export function floorsIn(t) {
  const out = new Set(); const s = String(t || '').toLowerCase();
  for (const m of s.matchAll(/\b(ground|first|second|third|fourth|fifth|sixth|1st|2nd|3rd|4th|5th|6th)\s+(?:floor|level)\b/g)) out.add(canonFloor(m[0]));
  if (/\b(basement|underground|cellar)\b/.test(s)) out.add('underground');
  return [...out];
}
/* the map's own floor layers (height bands), read from the page's bundled map data. Maps whose layers are limited to areas (bounds) are left out: a height alone is not enough there. */
export function layersFor(rawCal, mapKey) {
  const m = (rawCal || []).find(x => x.normalizedName === mapKey); const mm = m && m.maps && m.maps[0];
  const ls = mm && mm.layers; if (!ls || !ls.length) return null;
  if (ls.some(l => (l.extents || []).some(e => e.bounds))) return null;
  return ls.map(l => ({ f: canonFloor(l.name) || (/(underground|garage|tunnel|technical|bunker)/i.test(l.name) ? 'underground' : ''), ext: (l.extents || []).map(e => e.height) })).filter(l => l.f);
}
export function floorByHeight(layers, y) {
  if (!layers || y == null || isNaN(y)) return '';
  let best = null, bw = Infinity;
  for (const l of layers) for (const [a, b] of l.ext) if (y >= a && y < b && b - a < bw) { best = l.f; bw = b - a; }
  return best || 'ground floor';
}

/* ---- the wiki page ---- */
const attr = (tag, n) => { const m = new RegExp('\\b' + n + '\\s*=\\s*"([^"]*)"', 'i').exec(tag); return m ? m[1] : ''; };
const goodUrl = u => { const t = String(u).replace(/&amp;/g, '&').trim(); return /^https?:\/\/[^\s"']+\.(?:jpe?g|png|webp)(?:[/?][^\s"']*)?$/i.test(t) ? t : ''; };
const SECTION = /^(lock_?locations?|door_?locations?|locations?|doors?|lock|where_to_use|usage)$/i;
export function parseKeyPage(html) {
  const h = String(html).replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<span class="mw-editsection[\s\S]*?<\/span><\/span>/g, '');
  const parts = h.split(/<h2[\s>]/i).slice(1); let t = '', photos = [], seen = new Set();
  for (const p of parts) {
    const id = (/id="([^"]+)"/.exec(p) || [])[1] || '';
    if (!SECTION.test(id)) continue;
    for (const m of p.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) { const x = text(m[1]); if (x) t += (t ? ' ' : '') + x; }
    for (const im of p.matchAll(/<img\b[^>]*>/gi)) {
      const tag = im[0]; const name = attr(tag, 'data-image-name'); if (!name || seen.has(name)) continue;
      const u = goodUrl(attr(tag, 'data-src') || attr(tag, 'src')); if (!u) continue;
      seen.add(name); const c = text(attr(tag, 'alt') || name);
      const k = /\b(map|marked on)\b/i.test(c) ? 'map' : /\b(stair|staircase|entrance|building|exterior|road|path|way)\b/i.test(c) && !/\bdoor\b/i.test(c) ? 'path' : /\b(door|lock|room|apartment)\b/i.test(c) ? 'door' : 'path';
      photos.push({ u, c, k });
    }
  }
  t = t.slice(0, 420);
  return { t, fls: floorsIn(t), p: photos.slice(0, 8) };
}

async function wikiPage(title) {
  const res = await fetch(`${BASE}/api.php?${new URLSearchParams({ action:'parse', page:title, prop:'text', format:'json', formatversion:'2', redirects:'1' })}`, { headers: UA });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json(); if (!j.parse) throw new Error('no page');
  return typeof j.parse.text === 'string' ? j.parse.text : (j.parse.text && j.parse.text['*']) || '';
}
async function locks() {
  const q = '{ maps { normalizedName locks { id key { id name } position { x y z } } } }';
  for (const u of API) {
    try { const r = await fetch(u, { method:'POST', headers:{ 'Content-Type':'application/json', ...UA }, body: JSON.stringify({ query:q }), signal: AbortSignal.timeout(60000) }); const j = await r.json(); if (j.data && j.data.maps) return j.data.maps; } catch (e) { /* next */ }
  }
  throw new Error('tarkov.dev is not answering');
}
function rawCal() {
  const html = readFileSync('index.html', 'utf8'); const i = html.indexOf('const EMBEDDED_CAL_RAW = ');
  if (i < 0) return []; const a = i + 'const EMBEDDED_CAL_RAW = '.length; const e = html.indexOf('\n', a);
  try { return JSON.parse(html.slice(a, e).replace(/;\s*$/, '')); } catch (x) { return []; }
}

async function main() {
  if (!process.env.FORCE && existsSync(OUT) && Date.now() - statSync(OUT).mtimeMs < 7 * 864e5) { console.log('Door photos are less than a week old; skipping.'); return; }
  let prev = {}; try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch (e) {}
  const maps = await locks();
  const byKey = new Map();                                                     /* key id -> { name, locks:[{map,y}] } */
  for (const m of maps) for (const l of m.locks || []) {
    if (!l.key || !l.key.id) continue;
    const e = byKey.get(l.key.id) || { name:l.key.name, locks:[] }; e.locks.push({ map:m.normalizedName, y:l.position && l.position.y }); byKey.set(l.key.id, e);
  }
  console.log(byKey.size + ' keys open a door or container somewhere.');
  const keys = {}; let ok = 0, bad = 0;
  for (const [id, e] of byKey) {
    try {
      const info = parseKeyPage(await wikiPage(String(e.name).replace(/ /g, '_')));
      if (info.t || info.p.length) { keys[id] = { n:e.name, ...info }; ok++; } else if (prev.keys && prev.keys[id]) keys[id] = prev.keys[id];
    } catch (err) { bad++; if (prev.keys && prev.keys[id]) keys[id] = prev.keys[id]; }
    await sleep(250);
  }
  console.log(`Read ${ok} wiki pages; ${bad} could not be read.`);
  if (!ok) { console.log('Nothing read; leaving the existing file alone.'); return; }
  /* does "floor from height" agree with the wiki? Only keys with one lock on a map and one floor in the wiki text count. */
  const cal = rawCal(), tally = {};
  for (const [id, e] of byKey) {
    const k = keys[id]; if (!k || k.fls.length !== 1) continue;
    const perMap = {}; e.locks.forEach(l => { (perMap[l.map] = perMap[l.map] || []).push(l); });
    for (const [mk, ls] of Object.entries(perMap)) {
      if (ls.length !== 1) continue; const layers = layersFor(cal, mk); if (!layers) continue;
      const t = tally[mk] = tally[mk] || { n:0, agree:0 }; t.n++; if (floorByHeight(layers, ls[0].y) === k.fls[0]) t.agree++;
    }
  }
  const floorTrust = {};
  for (const [mk, t] of Object.entries(tally)) { floorTrust[mk] = t.n >= 5 && t.agree / t.n >= 0.85; console.log(`${mk}: height guess agrees with the wiki on ${t.agree} of ${t.n}${floorTrust[mk] ? ' -> used' : ' -> not used'}`); }
  mkdirSync('data', { recursive: true });
  writeFileSync(OUT, JSON.stringify({ v:1, updated:new Date().toISOString(), source:BASE + '/wiki/', floorTrust, keys }));
  console.log('Wrote ' + OUT + ' with ' + Object.keys(keys).length + ' keys.');
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e); process.exit(1); });
