// Builds data/door-photos.json: for every key that opens a door or container on a map, the photos on its wiki page's
// "Lock Location" section (the door, the stairs, the building, the spot on the map), and the floor if that section says one.
// The key pop-up shows them. Only the wiki's own image addresses are stored; no images are copied.
// Refreshes at most once a week (set FORCE=1 to run now).
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BASE = process.env.WIKI_BASE || 'https://escapefromtarkov.fandom.com';
const UA = { 'User-Agent': 'TarkovWaypoint-door-photos/1.0 (personal fan project; contact via GitHub repo)' };
const OUT = 'data/door-photos.json';
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
/* floors the wiki's Lock Location text names ("on the third floor", "2nd floor", "basement"). Only the wiki's own words; nothing is guessed. */
const FLOOR_RE = /\b(ground|first|second|third|fourth|fifth|sixth|seventh|top|upper|1st|2nd|3rd|4th|5th|6th|7th)[\s-]+(?:floor|level)\b|\b(basement|underground|cellar|attic)\b/gi;
const FKEY = { ground:'g', first:'g', '1st':'g', second:'2', '2nd':'2', third:'3', '3rd':'3', fourth:'4', '4th':'4', fifth:'5', '5th':'5', sixth:'6', '6th':'6', seventh:'7', '7th':'7', top:'top', upper:'upper', basement:'b', underground:'b', cellar:'b', attic:'a' };
export function floorsIn(t) {
  const out = [], seen = new Set();
  for (const m of String(t || '').matchAll(FLOOR_RE)) {
    const w = (m[1] || m[2]).toLowerCase(), k = FKEY[w]; if (!k || seen.has(k)) continue; seen.add(k);
    out.push(m[1] ? w + ' floor' : w);
  }
  return out;
}
/* the photos of every Lock Location section, in page order, each with its caption. k = what the photo is of, so the door can come first. */
export function parseKeyPage(html) {
  const h = String(html).replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<span class="mw-editsection[\s\S]*?<\/span><\/span>/g, '');
  /* cut the page at every h2 / h3; a sub-heading ("The Lab", "Streets of Tarkov") under a Lock Location heading belongs to it */
  const marks = [...h.matchAll(/<h([23])[\s>]/gi)].map(m => ({ lvl:+m[1], at:m.index }));
  const photos = [], seen = new Set(); let inLock = false, words = '';
  marks.forEach((m, n) => {
    const part = h.slice(m.at, n + 1 < marks.length ? marks[n + 1].at : h.length);
    const id = (/id="([^"]+)"/.exec(part) || [])[1] || '';
    if (m.lvl === 2) inLock = lockSection(id);
    else if (!inLock && !lockSection(id)) return;
    if (m.lvl === 2 && !inLock) return;
    words += ' ' + text(part.replace(/^<h[23][\s\S]*?<\/h[23]>/i, ' ').replace(/<img\b[^>]*>/gi, ' '));
    for (const im of part.matchAll(/<img\b[^>]*>/gi)) {
      const tag = im[0]; const name = attr(tag, 'data-image-name'); if (!name || seen.has(name)) continue;
      const u = goodUrl(attr(tag, 'data-src') || attr(tag, 'src')); if (!u) continue;
      seen.add(name); const c = text(attr(tag, 'alt') || name.replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' '));
      const k = /\b(map|marked on)\b/i.test(c) ? 'map' : /\bdoor\b/i.test(c) ? 'door' : 'path';
      photos.push({ u, c:c.slice(0, 120), k });
    }
  });
  const fl = floorsIn(words);
  const sentence = fl.length ? (words.split(/(?<=[.!?])\s+/).find(x => floorsIn(x).length) || '').trim().slice(0, 220) : '';
  return { p:photos.slice(0, 12), fl, ft:sentence };
}

async function wikiPage(title) {
  const res = await fetch(`${BASE}/api.php?${new URLSearchParams({ action:'parse', page:title, prop:'text', format:'json', formatversion:'2', redirects:'1' })}`, { headers: UA });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json(); if (!j.parse) throw new Error('no page');
  return typeof j.parse.text === 'string' ? j.parse.text : (j.parse.text && j.parse.text['*']) || '';
}
/* every key that opens something: the ones in the site's bundled map data, plus the hand-placed ones. Needs no network, so a flaky tarkov.dev cannot stop it. */
export function keyList(html) {
  const m = new Map(); const a = html.indexOf('const EMBEDDED_QUEST_DATA = ');
  if (a >= 0) {
    const from = a + 'const EMBEDDED_QUEST_DATA = '.length, e = html.indexOf('\n', from);
    try { (JSON.parse(html.slice(from, e).replace(/;\s*$/, '')).maps || []).forEach(mp => (mp.locks || []).forEach(l => { if (l.keyId && l.key && l.key !== l.keyId) m.set(l.keyId, l.key); })); } catch (x) { console.log('could not read the bundled map data: ' + x.message); }
  }
  for (const x of html.matchAll(/keyId:\s*'([0-9a-f]{24})',\s*key:\s*"([^"]+)"/g)) m.set(x[1], x[2]);
  return m;
}

async function main() {
  let prev = {}; try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch (e) {}
  if (!process.env.FORCE && prev.v === 3 && prev.updated && Date.now() - Date.parse(prev.updated) < 7 * 864e5) { console.log('Door photos are less than a week old; skipping.'); return; }
  const names = keyList(readFileSync('index.html', 'utf8')); console.log(names.size + ' keys open a door or container somewhere.');
  const keys = {}; let ok = 0, none = 0, bad = 0; const noPhotos = [];
  for (const [id, name] of names) {
    try {
      const info = parseKeyPage(await wikiPage(String(name).replace(/ /g, '_')));
      if (info.p.length || info.fl.length) { keys[id] = { n:name, p:info.p, ...(info.fl.length ? { fl:info.fl, ft:info.ft } : {}) }; ok++; } else { none++; noPhotos.push(name); if (prev.keys && prev.keys[id]) keys[id] = prev.keys[id]; }
    } catch (err) { bad++; if (prev.keys && prev.keys[id]) keys[id] = prev.keys[id]; }
    await sleep(250);
  }
  console.log(`${ok} keys have Lock Location photos or a floor; ${none} pages have none; ${bad} could not be read.`);
  if (noPhotos.length) console.log('No photos found for: ' + noPhotos.join(', '));
  if (!ok) { console.log('No photos found; leaving the existing file alone.'); return; }
  mkdirSync('data', { recursive: true });
  writeFileSync(OUT, JSON.stringify({ v:3, updated:new Date().toISOString(), source:BASE + '/wiki/', keys }));
  console.log('Wrote ' + OUT + ' with ' + Object.keys(keys).length + ' keys.');
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e); process.exit(1); });
