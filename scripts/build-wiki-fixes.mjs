// Builds data/wiki-fixes.json: where a quest's numbers or maps on the Escape from Tarkov wiki no longer match the quest data
// (api.tarkov.dev), the wiki's values are written here and the site applies them on top. This is what keeps a change like
// "Job for a Patriot: 20 PMCs on Lighthouse/Customs/Reserve -> 10 PMCs on Streets/Shoreline/Ground Zero" from going stale while the
// game data lags behind the wiki. It only changes what differs in a number or a map (wording differences are left alone), and
// only when exactly one wiki line and one objective clearly belong together.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BASE = process.env.WIKI_BASE || 'https://escapefromtarkov.fandom.com';
const UA = { 'User-Agent': 'RaidRoute-quest-check/1.0 (personal fan project; contact via GitHub repo)' };
const OUT = 'data/wiki-fixes.json';
const MAX_FIXES = 60;              // more than this in one run means the parser is probably wrong: write nothing and say so

export const plain = s => {
  let t = String(s || '');
  for (let i = 0; i < 4; i++) t = t.replace(/\{\{[^{}]*\}\}/g, '');
  return t.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/'{2,}/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
};
const section = (wt, name) => { const m = new RegExp('==\\s*' + name + '\\s*==([\\s\\S]*?)(?=\\n==[^=]|$)', 'i').exec(wt); return m ? m[1] : ''; };

/* map names as they are written in objective text -> the site's map keys */
const MAPNAMES = [['streets of tarkov', 'streets-of-tarkov'], ['ground zero', 'ground-zero'], ['customs', 'customs'], ['woods', 'woods'], ['shoreline', 'shoreline'],
  ['interchange', 'interchange'], ['reserve', 'reserve'], ['lighthouse', 'lighthouse'], ['factory', 'factory'], ['the lab', 'the-lab'], ['labs', 'the-lab'], ['labyrinth', 'the-labyrinth']];
export const mapsIn = text => {
  const t = ' ' + String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  return [...new Set(MAPNAMES.filter(([n]) => t.includes(' ' + n + ' ')).map(([, k]) => k))].sort();
};
const nums = text => [...String(text).matchAll(/\b\d[\d,]*(?:\.\d+)?\b/g)].map(m => +m[0].replace(/,/g, '')).sort((a, b) => a - b);
const words = text => {
  let t = ' ' + String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ') + ' ';
  for (const [n] of MAPNAMES) t = t.split(' ' + n + ' ').join('  ');
  return new Set(t.split(/\s+/).filter(w => w && !/^\d+$/.test(w) && !['the', 'a', 'an', 'of', 'on', 'in', 'or', 'and', 'with', 'to', 'at', 'from'].includes(w)));
};
const sim = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let i = 0; for (const w of A) if (B.has(w)) i++; return i / (A.size + B.size - i); };

export const wikiInfo = wt => {
  const lines = section(wt, 'Objectives').split('\n').map(l => /^\s*\*(?!\*)\s*(.*)$/.exec(l)).filter(Boolean).map(m => plain(m[1])).filter(Boolean);
  const rew = plain(section(wt, 'Rewards').split('\n')[0] || '') + ' ' + plain(section(wt, 'Rewards'));
  const xp = /\+\s*([\d,]+)\s*EXP/i.exec(rew);
  let level = null;
  for (const l of section(wt, 'Requirements').split('\n')) {
    const p = plain(l).replace(/^[*#:\s]+/, '');
    const m = /^(?:you must be |must be )?(?:player )?level\s+(\d+)\b/i.exec(p);
    if (m && !/loyalty|trader/i.test(p)) { level = +m[1]; break; }
  }
  return { lines, xp: xp ? +xp[1].replace(/,/g, '') : null, level };
};

/* what differs for one quest: { experience?, minPlayerLevel?, objectives:{ id:{description,maps?,count?} } } or null */
export function analyse(task, wt) {
  const w = wikiInfo(wt), fix = {}, why = [];
  if (w.xp && task.experience && w.xp !== task.experience) { fix.experience = w.xp; why.push(`XP ${task.experience} -> ${w.xp}`); }
  if (w.level && task.minPlayerLevel && w.level !== task.minPlayerLevel) { fix.minPlayerLevel = w.level; why.push(`level ${task.minPlayerLevel} -> ${w.level}`); }
  const objs = (task.objectives || []).filter(o => o.description);
  const best = (txt, list, key) => { let b = -1, s = 0; list.forEach((x, i) => { const v = sim(txt, key(x)); if (v > s) { s = v; b = i; } }); return { b, s }; };
  const fixes = {};
  w.lines.forEach((line, li) => {
    const { b, s } = best(line, objs, o => o.description);
    if (b < 0 || s < 0.5) return;
    const back = best(objs[b].description, w.lines, x => x);          // the pairing must be mutual
    if (back.b !== li) return;
    const o = objs[b], dn = nums(o.description), wn = nums(line), dm = mapsIn(o.description), wm = mapsIn(line);
    const numDiff = JSON.stringify(dn) !== JSON.stringify(wn), mapDiff = wm.length && JSON.stringify(dm) !== JSON.stringify(wm);
    if (!numDiff && !mapDiff) return;
    const f = { description: line };
    if (wm.length) f.maps = wm;
    if (o.type === 'shoot' && wn.length && wn[0] !== o.count && /^eliminate\b/i.test(line)) f.count = wn[0];
    fixes[o.id] = f; why.push(`"${o.description}" -> "${line}"`);
  });
  if (Object.keys(fixes).length) fix.objectives = fixes;
  return Object.keys(fix).length ? { fix, why } : null;
}

async function api(params) {
  const res = await fetch(`${BASE}/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`, { headers: UA, signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text);
}
const titleOf = t => { try { return decodeURIComponent(new URL(t.wikiLink).pathname.replace(/^\/wiki\//, '')).replace(/_/g, ' '); } catch { return ''; } };

async function main() {
  const tasks = new Map();
  for (const f of ['data/quests.json', 'data/quests-pve.json']) {
    if (!existsSync(f)) continue;
    try { for (const t of JSON.parse(readFileSync(f, 'utf8')).tasks) if (!tasks.has(t.id)) tasks.set(t.id, t); } catch (e) { console.log(f + ': ' + e.message); }
  }
  const byTitle = new Map();
  for (const t of tasks.values()) { const ti = titleOf(t); if (ti) (byTitle.get(ti) || byTitle.set(ti, []).get(ti)).push(t); }
  const titles = [...byTitle.keys()], fixes = {}, notes = [];
  let seen = 0;
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40);
    let j; try { j = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', titles: batch.join('|') }); }
    catch (e) { console.log('wiki batch skipped: ' + e.message); continue; }
    const back = {};                                                   // requested title -> final title
    for (const n of j.query?.normalized || []) back[n.from] = n.to;
    for (const r of j.query?.redirects || []) back[r.from] = r.to;
    const pages = new Map((j.query?.pages || []).map(p => [p.title, p]));
    for (const ti of batch) {
      let fin = ti; for (let k = 0; k < 3 && back[fin]; k++) fin = back[fin];
      const wt = pages.get(fin)?.revisions?.[0]?.slots?.main?.content; if (!wt) continue; seen++;
      for (const t of byTitle.get(ti)) {
        const r = analyse(t, wt); if (!r) continue;
        fixes[t.id] = Object.assign(fixes[t.id] || {}, r.fix, r.fix.objectives ? { objectives: Object.assign({}, fixes[t.id]?.objectives, r.fix.objectives) } : {});
        notes.push(t.name + ': ' + r.why.join(' | '));
      }
    }
  }
  console.log(`Checked ${seen} of ${titles.length} quests against the wiki; ${Object.keys(fixes).length} differ.`);
  notes.forEach(n => console.log('  FIX ' + n.slice(0, 400)));
  if (seen < titles.length * 0.6) throw new Error(`only ${seen} of ${titles.length} wiki pages came back, so nothing was changed`);
  if (Object.keys(fixes).length > MAX_FIXES) throw new Error(`${Object.keys(fixes).length} quests differ, which is more than ${MAX_FIXES}: not writing, look at the list above`);
  const next = JSON.stringify(fixes);
  if (existsSync(OUT)) { try { if (JSON.stringify(JSON.parse(readFileSync(OUT, 'utf8')).fixes) === next) { console.log('No change.'); return; } } catch {} }
  writeFileSync(OUT, JSON.stringify({ t: Date.now(), n: Object.keys(fixes).length, fixes }) + '\n');
  console.log(`Wrote ${OUT}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error('Could not build wiki fixes: ' + e.message); process.exit(1); });
