// Builds data/twitchdrops.json: recent news that Escape from Tarkov Twitch drops are on or coming.
// No site publishes machine-readable drop dates, so this does NOT guess dates. It lists the news headlines (with the outlet and link)
// and the site alerts people to go read them. Exact campaigns you want shown with a start/end go in events.json with kind "twitch".
// Sources (each allowed to fail): Google News searches. Items older than 21 days drop off. Runs at most every 2 hours (FORCE=1 to run now).
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const OUT = 'data/twitchdrops.json';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; TarkovWaypoint-twitchdrops/1.0; personal fan project)' };
const gn = q => 'https://news.google.com/rss/search?' + new URLSearchParams({ q, hl:'en-US', gl:'US', ceid:'US:en' });
const SOURCES = process.env.TWITCH_SOURCES ? JSON.parse(process.env.TWITCH_SOURCES) : [
  { name:'Google News', url:gn('"Escape from Tarkov" "Twitch Drops" when:14d') },
  { name:'Google News', url:gn('Tarkov Twitch drops live when:14d') }
];
const KEEP_DAYS = 21;
const dayOf = t => new Date(t).toISOString().slice(0, 10);
const dec = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/<[^>]+>/g, '').trim();
const norm = t => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const idOf = t => { let h = 5381; for (const c of norm(t)) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(36); };

/* a headline counts only when it is about Tarkov AND Twitch AND drops */
export function relevant(title) { return /tarkov/i.test(title) && /twitch/i.test(title) && /drops?\b/i.test(title); }

export function parseRss(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1], tag = n => { const r = new RegExp('<' + n + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + n + '>', 'i').exec(b); return r ? dec(r[1]) : ''; };
    let title = tag('title'), source = tag('source');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3)).trim();
    const at = Date.parse(tag('pubDate')); const url = tag('link');
    if (!title || !url || !isFinite(at)) continue;
    out.push({ title, source, url, at });
  }
  return out;
}

export function merge(db, hits, now = Date.now()) {
  const by = new Map((db.items || []).map(x => [x.id, x]));
  for (const h of hits) {
    if (!relevant(h.title) || now - h.at > KEEP_DAYS * 864e5) continue;
    const id = idOf(h.title), date = dayOf(h.at);
    const ex = by.get(id);
    if (!ex) by.set(id, { id, title:h.title, source:h.source || '', url:h.url, date });
    else if (date < ex.date) ex.date = date;          /* keep the earliest day we saw it */
  }
  const dismissed = new Set((db.dismissed || []).map(String));
  return [...by.values()].filter(x => !dismissed.has(x.id) && now - Date.parse(x.date + 'T12:00:00Z') < KEEP_DAYS * 864e5)
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title)).slice(0, 30);
}

async function main() {
  mkdirSync('data', { recursive: true });
  let db = { items:[], dismissed:[] };
  if (existsSync(OUT)) { try { db = Object.assign(db, JSON.parse(readFileSync(OUT, 'utf8'))); } catch (e) {} }
  if (!process.env.FORCE && existsSync(OUT) && Date.now() - statSync(OUT).mtimeMs < 2 * 3600e3) { console.log('Refreshed less than 2 hours ago; skipping (FORCE=1 to run now).'); return; }
  const hits = []; let ok = 0;
  for (const s of SOURCES) {
    try {
      const r = await fetch(s.url, { headers:UA, signal:AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const f = parseRss(await r.text()); ok++;
      console.log(`${s.name}: ${f.length} item(s), ${f.filter(x => relevant(x.title)).length} about Twitch drops`);
      f.forEach(x => hits.push(x));
    } catch (e) { console.log(`${s.name}: could not read (${String(e.message || e).split('\n')[0]})`); }
  }
  if (!ok) { console.log('No source could be read; leaving the file alone.'); return; }
  db.items = merge(db, hits);
  db.updated = new Date().toISOString();
  db.note = 'News headlines about Tarkov Twitch drops; dates are the day each was published, not the drop dates. Put a wrong one\'s id under "dismissed".';
  writeFileSync(OUT, JSON.stringify(db, null, 1) + '\n');
  console.log(`Wrote ${db.items.length} item(s).`);
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
