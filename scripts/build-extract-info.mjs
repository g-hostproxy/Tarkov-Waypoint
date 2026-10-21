// Builds data/extract-info.json: for every map, the wiki's "Extractions" table (when each exit is open, what it needs, notes).
// Read by the Extract details list in the map legend. No photos. Refreshes at most once a week (set FORCE=1 to run now).
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BASE = process.env.WIKI_BASE || 'https://escapefromtarkov.fandom.com';
const UA = { 'User-Agent': 'RaidRoute-extract-info/1.0 (personal fan project; contact via GitHub repo)' };
const OUT = 'data/extract-info.json';
const PAGES = { 'customs':'Customs', 'woods':'Woods', 'shoreline':'Shoreline', 'interchange':'Interchange', 'reserve':'Reserve', 'lighthouse':'Lighthouse',
  'streets-of-tarkov':'Streets_of_Tarkov', 'factory':'Factory', 'the-lab':'The_Lab', 'ground-zero':'Ground_Zero' };

export const key = s => String(s).toLowerCase().replace(/&amp;|&#0?38;/g, '&').replace(/&#0?39;|&apos;|[‘’']/g, '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/[^a-z0-9]+/g, '');
const text = h => String(h).replace(/<br\s*\/?>/gi, '; ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').replace(/\s+;/g, ';').trim();

/* the Extractions tables: header row has "Faction" and either "Extraction" or "Always available" */
export function parsePage(html) {
  const out = {};
  for (const tb of String(html).split(/<table[\s>]/i).slice(1)) {
    const hrow = (/<tr[\s>][\s\S]*?<\/tr>/i.exec(tb) || [''])[0];
    const heads = [...hrow.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => text(m[1]).toLowerCase());
    const head = heads.join(' ');
    if (!/faction/.test(head) || !/extraction|always/.test(head)) continue;
    const col = re => heads.findIndex(h => re.test(h));
    const cName = col(/^name$/) >= 0 ? col(/^name$/) : 1, cFac = col(/faction/), cAlw = col(/always/), cOne = col(/single/), cReq = col(/requirement/), cNote = col(/note/);
    for (const tr of tb.split(/<tr[\s>]/i).slice(1)) {
      const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => m[1]);
      if (cells.length < 3) continue;
      const name = text(cells[cName] || ''); if (!name || name.length > 60 || /^(name|extraction)$/i.test(name)) continue;
      const cell = i => i >= 0 && cells[i] != null ? text(cells[i]) : '';
      const tick = i => { const h = i >= 0 && cells[i] != null ? cells[i] : ''; const t = text(h), alt = h.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, ' $1 ').replace(/<[^>]+>/g, ' ');
        if (/✘|✗|✖|\bnot\b|\bno\b/i.test(t + ' ' + alt)) return 'Not always'; if (/✔|✓|\byes\b|\balways\b|check|tick/i.test(t + ' ' + alt)) return 'Always'; return t; };
      const reqHtml = cReq >= 0 ? cells[cReq] || '' : '';
      const items = [...new Set([...reqHtml.matchAll(/<a\b[^>]*\btitle="([^"]+)"/gi)].map(m => text(m[1])).filter(t => t && !/^file:/i.test(t)))];
      const dash = v => (v === '-' || v === '—' ? '' : v);
      const k = key(name);
      if (!out[k]) out[k] = { name, faction: cell(cFac), always: tick(cAlw), single: /✔|✓|yes/i.test(cell(cOne)) ? 'Yes' : '', req: dash(cell(cReq)), notes: dash(cell(cNote)), items };
    }
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
  let cur = null; try { cur = JSON.parse(readFileSync(OUT, 'utf8')); } catch (e) {}
  if (!process.env.FORCE && cur && cur.v === 1 && Date.now() - statSync(OUT).mtimeMs < 7 * 864e5) { console.log('Extract info is less than a week old; skipping.'); return; }
  const prev = (cur && cur.maps) || {}, maps = {}; let n = 0;
  for (const [k, title] of Object.entries(PAGES)) {
    try { const got = parsePage(await page(title)); const c = Object.keys(got).length; if (c) { maps[k] = got; n += c; } else maps[k] = prev[k] || {}; console.log(k + ': ' + c + ' exits'); }
    catch (e) { maps[k] = prev[k] || {}; console.log(k + ': skipped (' + e.message + ')'); }
  }
  if (!n) { console.log('Nothing found; leaving the existing file alone.'); return; }
  mkdirSync('data', { recursive: true });
  writeFileSync(OUT, JSON.stringify({ v: 1, updated: new Date().toISOString(), source: BASE + '/wiki/', maps }, null, 1));
  console.log('Wrote ' + OUT + ' with ' + n + ' exits.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e); process.exit(1); });
