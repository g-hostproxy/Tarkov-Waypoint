// Builds data/wiki-quests.json: every quest the wiki has that your site does not, converted to the site's quest format and tagged
// (Current / Event / Seasonal / Arena / Removed). Quests the site already has are left alone.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BASE = process.env.WIKI_BASE || 'https://escapefromtarkov.fandom.com';
const UA = { 'User-Agent': 'RaidRoute-quest-check/1.0 (personal fan project; contact via GitHub repo)' };
const OUT = 'data/wiki-quests.json';

const norm = s => String(s).toLowerCase().replace(/&amp;/g, '&').replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const clean = n => norm(String(n).replace(/\s*\[PVP ZONE\]/i, '').replace(/\s*\((quest|prestige \d+)\)\s*$/i, ''));
const slug = s => norm(s).replace(/ /g, '-');

/* ---------- wiki text -> plain text ---------- */
export const plain = s => {
  let t = String(s || '');
  for (let i = 0; i < 4; i++) t = t.replace(/\{\{[^{}]*\}\}/g, '');
  return t.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/'{2,}/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
};
const field = (wt, name) => { const m = new RegExp('\\|\\s*' + name + '\\s*=([^\\n]*)', 'i').exec(wt); return m ? plain(m[1]) : ''; };
const section = (wt, name) => { const m = new RegExp('==\\s*' + name + '\\s*==([\\s\\S]*?)(?=\\n==[^=]|$)', 'i').exec(wt); return m ? m[1] : ''; };
export const tagsOf = wt => {
  const tags = new Set();
  for (const m of wt.split(/\{\{\s*Infobox quest/i)[0].matchAll(/\{\{\s*([^|}\n]+?)\s*(?:\|[^}]*)?\}\}/g)) tags.add('T:' + m[1].trim());
  for (const m of wt.matchAll(/\[\[\s*Category\s*:\s*([^\]|]+)/gi)) if (m[1].trim().toLowerCase() !== 'quests') tags.add('C:' + m[1].trim());
  return [...tags];
};

const MAPS = { 'customs': 'customs', 'woods': 'woods', 'shoreline': 'shoreline', 'interchange': 'interchange', 'reserve': 'reserve', 'lighthouse': 'lighthouse',
  'streets of tarkov': 'streets-of-tarkov', 'factory': 'factory', 'night factory': 'factory', 'day factory': 'factory', 'nighttime factory': 'factory',
  'the lab': 'the-lab', 'labs': 'the-lab', 'ground zero': 'ground-zero' };
const mapsOf = loc => [...new Set(String(loc).split(/,|\bor\b/i).map(x => MAPS[x.replace(/\(.*?\)/g, '').trim().toLowerCase()]).filter(Boolean))];
const TRADERS = ['Prapor', 'Therapist', 'Skier', 'Peacekeeper', 'Mechanic', 'Ragman', 'Jaeger', 'Fence', 'Lightkeeper', 'Ref', 'BTR Driver'];

/* Current = no wiki label at all (live in the regular game); the rest are tagged and kept out of the map routes */
export function kindOf(wt, tags, req, loc) {
  const all = tags.join(' ') + ' ' + req;
  if (/arena/i.test(all) || /^arena$/i.test(loc)) return 'Arena';
  if (/season/i.test(all)) return 'Seasonal';
  if (/historical content/i.test(all)) return 'Removed';
  if (/event/i.test(all)) return 'Event';
  return 'Current';
}

export function parseQuest(title, wt, traderIds) {
  const tags = tagsOf(wt), req = plain(section(wt, 'Requirements')), loc = field(wt, 'location'), kind = kindOf(wt, tags, req, loc);
  const giver = field(wt, 'given by'), trader = TRADERS.find(t => new RegExp('\\b' + t + '\\b', 'i').test(giver)) || '';
  const lvl = /level\s+(\d+)/i.exec(req), rew = section(wt, 'Rewards');
  const exp = /([\d,]+)\s*(?:\[\[)?EXP/i.exec(rew);
  const maps = mapsOf(loc);
  const raw = section(wt, 'Objectives');
  let lines = raw.split('\n').map(l => /^\s*([*#]+)\s*(.*)$/.exec(l)).filter(Boolean).map(m => (m[1].length > 1 ? '– ' : '') + plain(m[2])).filter(Boolean);
  if (!lines.length && plain(raw)) lines = [plain(raw)];
  if (!lines.length) lines = ['See the wiki page for this quest’s objectives.'];
  const name = title.replace(/\s*\(quest\)\s*$/i, '');
  const mapQuest = kind === 'Current' && maps.length === 1;
  return {
    id: 'wiki-' + slug(title), name,
    minPlayerLevel: lvl ? +lvl[1] : 1,
    wikiLink: BASE + '/wiki/' + encodeURIComponent(title.replace(/ /g, '_')),
    kappaRequired: kind === 'Current' && /yes/i.test(field(wt, 'reqkappa')),
    experience: exp ? +exp[1].replace(/,/g, '') : 0,
    trader: trader ? { id: traderIds[trader] || '', name: trader } : { id: '', name: 'Unknown' },
    map: mapQuest ? { normalizedName: maps[0] } : null,
    wikiKind: kind, wikiLocation: loc, wikiTags: tags.map(t => t.slice(2)),
    objectives: lines.map((d, i) => ({
      id: 'wiki-' + slug(title) + '-' + (i + 1),
      type: mapQuest ? 'visit' : 'taskStatus',       /* 'taskStatus' = no map: listed on the No-map quests page */
      description: d, optional: false, maps: [], zones: [], possibleLocations: []
    }))
  };
}

/* ---------- the site's own quests ---------- */
function siteInfo() {
  const names = new Set(), traderIds = {};
  const html = readFileSync('index.html', 'utf8');
  const i = html.indexOf('const EMBEDDED_QUEST_DATA = ');
  if (i >= 0) {
    const start = i + 'const EMBEDDED_QUEST_DATA = '.length;
    let depth = 0, j = start, inStr = false, esc = false;
    for (; j < html.length; j++) {
      const c = html[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) { j++; break; }
    }
    const d = JSON.parse(html.slice(start, j));
    d.tasks.forEach(t => { names.add(t.name); if (t.trader && t.trader.name && t.trader.id) traderIds[t.trader.name] = t.trader.id; });
    (d.traders || []).forEach(t => { if (t.name && t.id) traderIds[t.name] = traderIds[t.name] || t.id; });
  }
  for (const m of html.matchAll(/id:'manual-[^']*',\s*name:'([^']+)'/g)) names.add(m[1]);
  if (existsSync('data/quests.json')) {
    try { JSON.parse(readFileSync('data/quests.json', 'utf8')).tasks.forEach(t => { names.add(t.name); if (t.trader && t.trader.name && t.trader.id) traderIds[t.trader.name] = t.trader.id; }); } catch {}
  }
  return { names, traderIds };
}

async function api(params) {
  const res = await fetch(`${BASE}/api.php?${new URLSearchParams({ format: 'json', ...params })}`, { headers: UA });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function main() {
  const { names, traderIds } = siteInfo();
  const titles = [];
  let cont = {};
  for (let p = 0; p < 20; p++) {
    const j = await api({ action: 'query', list: 'categorymembers', cmtitle: 'Category:Quests', cmlimit: '500', cmnamespace: '0', ...cont });
    (j.query?.categorymembers || []).forEach(m => titles.push(m.title));
    if (!j.continue) break; cont = j.continue;
  }
  if (titles.length < 300) throw new Error(`only ${titles.length} wiki quests came back`);
  const have = new Set([...names].map(clean));
  const todo = titles.filter(t => t !== 'Quests' && t !== 'Action test' && !have.has(clean(t)));
  const out = [];
  for (let i = 0; i < todo.length; i += 40) {
    const batch = todo.slice(i, i + 40);
    const j = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', formatversion: '2', titles: batch.join('|') });
    for (const pg of j.query?.pages || []) {
      const wt = pg.revisions?.[0]?.slots?.main?.content || '';
      if (!wt || /^#redirect/i.test(wt.trim())) continue;
      try { out.push(parseQuest(pg.title, wt, traderIds)); } catch (e) { console.log('skipped ' + pg.title + ': ' + e.message); }
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  const counts = {}; out.forEach(q => counts[q.wikiKind] = (counts[q.wikiKind] || 0) + 1);
  console.log(`Wiki has ${titles.length} quests; ${out.length} are not on the site:`, counts);
  const next = JSON.stringify(out);
  if (existsSync(OUT)) { try { if (JSON.stringify(JSON.parse(readFileSync(OUT, 'utf8')).tasks) === next) { console.log('No change.'); return; } } catch {} }
  mkdirSync('data', { recursive: true });
  writeFileSync(OUT, JSON.stringify({ t: Date.now(), n: out.length, tasks: out }) + '\n');
  console.log(`Wrote ${OUT}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error('Could not build wiki quests: ' + e.message); process.exit(1); });
