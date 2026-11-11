// Builds data/door-photos.json: for every key that opens a door or container on a map, the photos on its wiki page's
// "Lock Location" section (the door, the stairs, the building, the spot on the map).
// The key pop-up shows them. Only the wiki's own image addresses are stored; no images are copied.
// Refreshes at most once a week (set FORCE=1 to run now).
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BASE = process.env.WIKI_BASE || 'https://escapefromtarkov.fandom.com';
const UA = { 'User-Agent': 'TarkovWaypoint-door-photos/1.0 (personal fan project; contact via GitHub repo)' };
const OUT = 'data/door-photos.json';
const API = ['https://api.tarkov.dev/graphql'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const text = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
const attr = (tag, n) => { const m = new RegExp('\\b' + n + '\\s*=\\s*"([^"]*)"', 'i').exec(tag); return m ? m[1] : ''; };
const goodUrl = u => { const t = String(u).replace(/&amp;/g, '&').trim(); return /^https?:\/\/[^\s"']+\.(?:jpe?g|png|webp)(?:[/?][^\s"']*)?$/i.test(t) ? t : ''; };

/* which sections of a key's page are about the lock (not about where to find the key, nor what is behind the door) */
export function lockSection(id) {
  const t = String(id || '').toLowerCase();
  if (/^(key_?locations?|keys?_?found|where_to_find|behind|loot|trivia|notes?|gallery|description|references?|see_also)/.test(t)) return false;
  return /lock|door|location|where_to_use|usage/.test(t);
}
/* the photos of every Lock Location section, in page order, each with its caption. k = what the photo is of, so the door can come first. */
export function parseKeyPage(html) {
  const h = String(html).replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<span class="mw-editsection[\s\S]*?<\/span><\/span>/g, '');
  const parts = h.split(/<h[23][\s>]/i).slice(1); const photos = [], seen = new Set();
  for (const p of parts) {
    const id = (/id="([^"]+)"/.exec(p) || [])[1] || '';
    if (!lockSection(id)) continue;
    for (const im of p.matchAll(/<img\b[^>]*>/gi)) {
      const tag = im[0]; const name = attr(tag, 'data-image-name'); if (!name || seen.has(name)) continue;
      const u = goodUrl(attr(tag, 'data-src') || attr(tag, 'src')); if (!u) continue;
      seen.add(name); const c = text(attr(tag, 'alt') || name.replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' '));
      const k = /\b(map|marked on)\b/i.test(c) ? 'map' : /\bdoor\b/i.test(c) ? 'door' : /\b(stair|staircase|entrance|building|exterior|road|path|way|corridor|hall|hallway|room|apartment|lock|container|trunk)\b/i.test(c) ? 'path' : 'path';
      photos.push({ u, c: c.slice(0, 120), k });
    }
  }
  return photos.slice(0, 10);
}

async function wikiPage(title) {
  const res = await fetch(`${BASE}/api.php?${new URLSearchParams({ action:'parse', page:title, prop:'text', format:'json', formatversion:'2', redirects:'1' })}`, { headers: UA });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json(); if (!j.parse) throw new Error('no page');
  return typeof j.parse.text === 'string' ? j.parse.text : (j.parse.text && j.parse.text['*']) || '';
}
async function keyList() {
  const q = '{ maps { locks { key { id name } } } }';
  for (const u of API) {
    try {
      const r = await fetch(u, { method:'POST', headers:{ 'Content-Type':'application/json', ...UA }, body: JSON.stringify({ query:q }), signal: AbortSignal.timeout(60000) });
      const j = await r.json(); if (!(j.data && j.data.maps)) continue;
      const m = new Map(); j.data.maps.forEach(mp => (mp.locks || []).forEach(l => { if (l.key && l.key.id) m.set(l.key.id, l.key.name); })); if (m.size) return m;
    } catch (e) { /* next */ }
  }
  throw new Error('tarkov.dev is not answering');
}

async function main() {
  let prev = {}; try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch (e) {}
  if (!process.env.FORCE && prev.v === 2 && existsSync(OUT) && Date.now() - statSync(OUT).mtimeMs < 7 * 864e5) { console.log('Door photos are less than a week old; skipping.'); return; }
  const names = await keyList(); console.log(names.size + ' keys open a door or container somewhere.');
  const keys = {}; let ok = 0, none = 0, bad = 0; const noPhotos = [];
  for (const [id, name] of names) {
    try {
      const photos = parseKeyPage(await wikiPage(String(name).replace(/ /g, '_')));
      if (photos.length) { keys[id] = { n:name, p:photos }; ok++; } else { none++; noPhotos.push(name); if (prev.keys && prev.keys[id]) keys[id] = prev.keys[id]; }
    } catch (err) { bad++; if (prev.keys && prev.keys[id]) keys[id] = prev.keys[id]; }
    await sleep(250);
  }
  console.log(`${ok} keys have Lock Location photos; ${none} pages have none; ${bad} could not be read.`);
  if (noPhotos.length) console.log('No photos found for: ' + noPhotos.join(', '));
  if (!ok) { console.log('No photos found; leaving the existing file alone.'); return; }
  mkdirSync('data', { recursive: true });
  writeFileSync(OUT, JSON.stringify({ v:2, updated:new Date().toISOString(), source:BASE + '/wiki/', keys }));
  console.log('Wrote ' + OUT + ' with ' + Object.keys(keys).length + ' keys.');
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e); process.exit(1); });
