// Builds data/extract-photos.json: for every map, the wiki's photo of each extraction (the "Extractions" table on the map's wiki page).
// The site shows the photo when you click an extract pin. Only the wiki's own image addresses are stored; no images are copied.
// Refreshes at most once a week (set FORCE=1 to run now).
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BASE = process.env.WIKI_BASE || 'https://escapefromtarkov.fandom.com';
const UA = { 'User-Agent': 'RaidRoute-extract-photos/1.0 (personal fan project; contact via GitHub repo)' };
const OUT = 'data/extract-photos.json';
const PAGES = { 'customs':'Customs', 'woods':'Woods', 'shoreline':'Shoreline', 'interchange':'Interchange', 'reserve':'Reserve', 'lighthouse':'Lighthouse',
  'streets-of-tarkov':'Streets_of_Tarkov', 'factory':'Factory', 'the-lab':'The_Lab', 'ground-zero':'Ground_Zero' };

export const key = s => String(s).toLowerCase().replace(/&amp;|&#0?38;/g, '&').replace(/&#0?39;|&apos;|[‘’']/g, '').replace(/[^a-z0-9]+/g, '');
const text = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
/* the image address exactly as the wiki serves it (its query string can matter); the site swaps in a larger width when it shows it */
export const baseUrl = u => { const t = String(u).replace(/&amp;/g, '&').trim(); return /^https?:\/\/[^\s"']+\.(?:jpe?g|png|webp)(?:[/?][^\s"']*)?$/i.test(t) ? t : ''; };

/* rows of every table that has an "Extraction" photo column: first cell = photo, second cell = name */
export function parsePage(html) {
  const out = {};
  for (const tr of String(html).split(/<tr[\s>]/i).slice(1)) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => m[1]);
    if (cells.length < 2) continue;
    const im = /<img\b[^>]*>/i.exec(cells[0]); if (!im) continue;
    const attr = n => { const m = new RegExp('\\b' + n + '\\s*=\\s*"([^"]*)"', 'i').exec(im[0]); return m ? m[1] : ''; };
    const url = baseUrl(attr('data-src') || attr('src')); if (!url) continue;
    const name = text(cells[1]); if (!name || name.length > 60) continue;
    if (!out[key(name)]) out[key(name)] = { name, img: url };
  }
  return out;
}

async function page(title) {
  const res = await fetch(`${BASE}/api.php?${new URLSearchParams({ action: 'parse', page: title, prop: 'text', format: 'json', formatversion: '2', redirects: '1' })}`, { headers: UA });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json(); if (!j.parse) throw new Error('no page');
  return typeof j.parse.text === 'string' ? j.parse.text : (j.parse.text && j.parse.text['*']) || '';
}

async function main() {
  if (!process.env.FORCE && existsSync(OUT) && Date.now() - statSync(OUT).mtimeMs < 7 * 864e5) { console.log('Photos are less than a week old; skipping.'); return; }
  let prev = {}; try { prev = JSON.parse(readFileSync(OUT, 'utf8')).maps || {}; } catch (e) {}
  const maps = {}; let n = 0;
  for (const [k, title] of Object.entries(PAGES)) {
    try { const got = parsePage(await page(title)); const c = Object.keys(got).length; if (c) { maps[k] = got; n += c; } else maps[k] = prev[k] || {}; console.log(k + ': ' + c + ' photos'); }
    catch (e) { maps[k] = prev[k] || {}; console.log(k + ': skipped (' + e.message + ')'); }
  }
  if (!n) { console.log('No photos found; leaving the existing file alone.'); return; }
  mkdirSync('data', { recursive: true });
  writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), source: BASE + '/wiki/', pages: PAGES, maps }, null, 1));
  console.log('Wrote ' + OUT + ' with ' + n + ' photos.');
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e); process.exit(1); });
