// Builds data/landmark-photos.json: the photos (with their captions) on each map's wiki page: the Gallery section and any captioned pictures.
// The "Find my spawn" picker shows these so you can tap what you can see. Only the wiki's own image addresses are stored; no images are copied.
// Refreshes at most once a week (set FORCE=1 to run now).
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BASE = process.env.WIKI_BASE || 'https://escapefromtarkov.fandom.com';
const UA = { 'User-Agent': 'RaidRoute-landmark-photos/1.0 (personal fan project; contact via GitHub repo)' };
const OUT = 'data/landmark-photos.json';
const PAGES = { 'customs':'Customs', 'woods':'Woods', 'shoreline':'Shoreline', 'interchange':'Interchange', 'reserve':'Reserve', 'lighthouse':'Lighthouse',
  'streets-of-tarkov':'Streets_of_Tarkov', 'factory':'Factory', 'the-lab':'The_Lab', 'ground-zero':'Ground_Zero' };

const text = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const baseUrl = u => { const t = String(u).replace(/&amp;/g, '&').trim(); return /^https?:\/\/[^\s"']+\.(?:jpe?g|png|webp)(?:[/?][^\s"']*)?$/i.test(t) ? t : ''; };
const attr = (tag, n) => { const m = new RegExp('\\b' + n + '\\s*=\\s*"([^"]*)"', 'i').exec(tag); return m ? m[1] : ''; };
const imgOf = block => { const im = /<img\b[^>]*>/i.exec(block); return im ? { url: baseUrl(attr(im[0], 'data-src') || attr(im[0], 'src')), alt: text(attr(im[0], 'alt')), name: attr(im[0], 'data-image-name') } : null; };

/* walks the page top to bottom, remembering the current heading, and collects gallery items and captioned figures (not table cells) */
export function parsePage(html) {
  const out = [], seen = new Set(), sections = [];
  const body = String(html).replace(/<table[\s\S]*?<\/table>/gi, ' ');
  const re = /<h[23][^>]*>([\s\S]*?)<\/h[23]>|<(?:div|li)\b[^>]*class="[^"]*(?:wikia-gallery-item|gallerybox)[^"]*"[^>]*>([\s\S]*?)(?=<(?:div|li)\b[^>]*class="[^"]*(?:wikia-gallery-item|gallerybox)|<\/ul>|<\/div>\s*<\/div>\s*<\/div>)|<figure\b[^>]*>([\s\S]*?)<\/figure>/gi;
  let sec = '', m;
  while ((m = re.exec(body))) {
    if (m[1] !== undefined) { sec = text(m[1]).replace(/\[edit.*$/i, '').trim(); if (sec) sections.push(sec); continue; }
    const blk = m[2] !== undefined ? m[2] : m[3], im = imgOf(blk); if (!im || !im.url) continue;
    const cap = text((/<(?:div|p|figcaption)\b[^>]*(?:lightbox-caption|gallerytext|caption)[^>]*>([\s\S]*?)<\/(?:div|p|figcaption)>/i.exec(blk) || [])[1] || '') || im.alt;
    if (/icon|logo|flag|button/i.test(im.name + ' ' + im.url.split('/revision')[0].split('/').pop())) continue;
    if (seen.has(im.url)) continue; seen.add(im.url);
    out.push({ caption: cap, section: sec, img: im.url });
  }
  return { photos: out, sections };
}

async function page(title) {
  const res = await fetch(`${BASE}/api.php?${new URLSearchParams({ action: 'parse', page: title, prop: 'text', format: 'json', formatversion: '2', redirects: '1' })}`, { headers: UA });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json(); if (!j.parse) throw new Error('no page');
  return typeof j.parse.text === 'string' ? j.parse.text : (j.parse.text && j.parse.text['*']) || '';
}

async function main() {
  try { if (!process.env.FORCE && Date.now() - statSync(OUT).mtimeMs < 7 * 864e5) { console.log('Photos are less than a week old; skipping.'); return; } } catch (e) {}
  let prev = {}; try { prev = JSON.parse(readFileSync(OUT, 'utf8')).maps || {}; } catch (e) {}
  const maps = {}; let n = 0;
  for (const [k, title] of Object.entries(PAGES)) {
    try { const got = parsePage(await page(title)); if (got.photos.length) { maps[k] = got; n += got.photos.length; } else maps[k] = prev[k] || got; console.log(k + ': ' + got.photos.length + ' photos; sections: ' + got.sections.join(' | ')); }
    catch (e) { maps[k] = prev[k] || { photos: [], sections: [] }; console.log(k + ': skipped (' + e.message + ')'); }
  }
  if (!n) { console.log('No photos found; leaving the existing file alone.'); return; }
  mkdirSync('data', { recursive: true });
  writeFileSync(OUT, JSON.stringify({ v: 1, updated: new Date().toISOString(), source: BASE + '/wiki/', pages: PAGES, maps }, null, 1));
  console.log('Wrote ' + OUT + ' with ' + n + ' photos.');
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e); process.exit(1); });
