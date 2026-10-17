// Compares the quests on the Escape from Tarkov wiki with the quests your site has, and prints the differences.
// Read-only: it changes nothing. Run it from the Actions tab ("Compare quests with wiki").
import { readFileSync, existsSync } from 'node:fs';

const BASE = process.env.WIKI_BASE || 'https://escapefromtarkov.fandom.com';
const UA = { 'User-Agent': 'RaidRoute-quest-check/1.0 (personal fan project; contact via GitHub repo)' };
const norm = s => String(s).toLowerCase().replace(/&amp;/g, '&').replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function api(params) {
  const url = `${BASE}/api.php?${new URLSearchParams({ format: 'json', ...params })}`;
  const res = await fetch(url, { headers: UA });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
  try { return JSON.parse(text); } catch { throw new Error('not JSON: ' + text.slice(0, 200).replace(/\s+/g, ' ')); }
}

/* ---- the site's quests: bundled list + hand-added ones + data/quests.json when it exists ---- */
function siteQuests() {
  const html = readFileSync('index.html', 'utf8');
  const names = new Set();
  const i = html.indexOf('const EMBEDDED_QUEST_DATA = ');
  if (i >= 0) {
    try {
      const start = i + 'const EMBEDDED_QUEST_DATA = '.length;
      let depth = 0, j = start, inStr = false, esc = false;
      for (; j < html.length; j++) {
        const c = html[j];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) { j++; break; }
      }
      JSON.parse(html.slice(start, j)).tasks.forEach(t => names.add(t.name));
    } catch (e) { console.log('could not read the bundled quests: ' + e.message); }
  }
  for (const m of html.matchAll(/id:'manual-[^']*',\s*name:'([^']+)'/g)) names.add(m[1]);
  if (existsSync('data/quests.json')) {
    try { JSON.parse(readFileSync('data/quests.json', 'utf8')).tasks.forEach(t => names.add(t.name)); } catch {}
  }
  return [...names];
}

async function wikiTitles(category) {
  const out = [];
  let cont = {};
  for (let page = 0; page < 20; page++) {
    const j = await api({ action: 'query', list: 'categorymembers', cmtitle: category, cmlimit: '500', cmnamespace: '0', ...cont });
    (j.query?.categorymembers || []).forEach(m => out.push(m.title));
    if (!j.continue) break;
    cont = j.continue;
  }
  return out;
}

const site = siteQuests();
console.log(`Your site has ${site.length} quests.`);

let titles = [], used = '';
for (const cat of ['Category:Quests', 'Category:Tasks', 'Category:Quest']) {
  try {
    const t = await wikiTitles(cat);
    console.log(`${cat}: ${t.length} pages`);
    if (t.length > titles.length) { titles = t; used = cat; }
  } catch (e) { console.log(`${cat}: failed (${e.message})`); }
}
if (!titles.length) { console.error('Could not read a quest list from the wiki.'); process.exit(1); }
console.log(`Using ${used}: ${titles.length} wiki pages.\n`);

/* names: ignore the site's [PVP ZONE] tag and the wiki's "(quest)" page disambiguation */
const clean = n => norm(String(n).replace(/\s*\[PVP ZONE\]/i, '').replace(/\s*\((quest|prestige \d+)\)\s*$/i, ''));
const siteSet = new Set(site.map(clean)), wikiSet = new Set(titles.map(clean));
const missing = titles.filter(t => !siteSet.has(clean(t)) && t !== 'Quests').sort();
const extra = site.filter(n => !wikiSet.has(clean(n))).sort();

/* ---- read each missing page's source, in batches ---- */
async function sources(list) {
  const out = new Map();
  for (let i = 0; i < list.length; i += 40) {
    const batch = list.slice(i, i + 40);
    try {
      const j = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', formatversion: '2', titles: batch.join('|') });
      (j.query?.pages || []).forEach(p => out.set(p.title, p.revisions?.[0]?.slots?.main?.content || ''));
    } catch (e) { console.log(`batch ${i} failed: ${e.message}`); }
  }
  return out;
}
const field = (wt, name) => {
  const m = new RegExp('\\|\\s*' + name + '\\s*=([^\\n]*)', 'i').exec(wt);
  return m ? m[1].replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
};
const reqOf = wt => { const m = /==\s*Requirements\s*==([\s\S]*?)(?:\n==[^=]|$)/i.exec(wt); return m ? m[1].replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/\s+/g, ' ').trim() : ''; };
const kindOf = (wt, req) => /season/i.test(req) ? 'Seasonal' : /arena|gladiator/i.test(req + field(wt, 'given by')) ? 'Arena' : /\bPvE\b/.test(req) ? 'PvE' : /^#redirect/i.test(wt.trim()) ? 'Redirect' : 'Regular?';

const src = await sources(missing);
const groups = {};
missing.forEach(t => {
  const wt = src.get(t) || '', req = reqOf(wt), k = kindOf(wt, req);
  (groups[k] ||= []).push({ t, wt, giver: field(wt, 'given by'), loc: field(wt, 'location'), req: req.slice(0, 110) });
});
console.log(`=== On the wiki but NOT on your site: ${missing.length}, sorted by what the wiki says about them ===`);
Object.entries(groups).forEach(([k, v]) => console.log(`  ${k}: ${v.length}`));
for (const k of ['Regular?', 'PvE', 'Arena', 'Seasonal', 'Redirect']) {
  if (!groups[k]) continue;
  console.log(`\n--- ${k} (${groups[k].length}) : title | given by | location | requirements ---`);
  groups[k].forEach(g => console.log(`${g.t} | ${g.giver} | ${g.loc} | ${g.req}`));
}
console.log(`\n=== On your site but not found on the wiki by name (${extra.length}) ===`);
extra.forEach(t => console.log('  ' + t));

const sample = groups['Regular?']?.[0];
if (sample) { console.log(`\n=== Sample page source: ${sample.t} (first 3500 characters) ===`); console.log(sample.wt.slice(0, 3500)); }
