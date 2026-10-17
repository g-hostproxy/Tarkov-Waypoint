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

const siteSet = new Set(site.map(norm)), wikiSet = new Set(titles.map(norm));
const missing = titles.filter(t => !siteSet.has(norm(t))).sort();
const extra = site.filter(n => !wikiSet.has(norm(n))).sort();
console.log(`=== On the wiki but NOT on your site (${missing.length}) ===`);
missing.forEach(t => console.log('  ' + t));
console.log(`\n=== On your site but not found on the wiki by name (${extra.length}) ===`);
extra.forEach(t => console.log('  ' + t));

/* ---- show how one quest page is written, so quest details can be read from it ---- */
const sample = missing[0] || 'Hidden Route';
try {
  const j = await api({ action: 'parse', page: sample, prop: 'wikitext' });
  console.log(`\n=== Sample wiki page source: ${sample} (first 1800 characters) ===`);
  console.log(String(j.parse?.wikitext?.['*'] || '').slice(0, 1800));
} catch (e) { console.log('\nSample page failed: ' + e.message); }
