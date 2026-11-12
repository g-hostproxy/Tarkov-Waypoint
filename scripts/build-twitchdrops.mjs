// Builds data/twitchdrops.json: recent news that Escape from Tarkov Twitch drops are on or coming.
// No site publishes machine-readable drop dates, so this does NOT guess dates. It lists the news headlines (with the outlet and link)
// and the site alerts people to go read them. Exact campaigns you want shown with a start/end go in events.json with kind "twitch".
// BSG's own X account (@tarkov) states exact dates ("runs until August 17, 2:00 PM BST", "ends on November 9 at 3:00 PM GMT"), so posts from it
// are turned into real campaigns with a start and end (db.campaigns). Headlines are the fallback. X may block some servers, so each source is allowed to fail.
// Sources (each allowed to fail): the @tarkov account, then Google News searches. Items older than 21 days drop off. Runs at most every hour (FORCE=1 to run now).
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const OUT = 'data/twitchdrops.json';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; TarkovWaypoint-twitchdrops/1.0; personal fan project)' };
const gn = q => 'https://news.google.com/rss/search?' + new URLSearchParams({ q, hl:'en-US', gl:'US', ceid:'US:en' });
const SOURCES = process.env.TWITCH_SOURCES ? JSON.parse(process.env.TWITCH_SOURCES) : [
  { name:'Google News', url:gn('"Escape from Tarkov" "Twitch Drops" when:14d') },
  { name:'Google News', url:gn('Tarkov Twitch drops live when:14d') }
];
const X_SOURCES = process.env.TWITCH_X_SOURCES ? JSON.parse(process.env.TWITCH_X_SOURCES) : [
  { name:'@tarkov on X', url:'https://syndication.twitter.com/srv/timeline-profile/screen-name/tarkov' },
  { name:'@tarkov (Nitter)', url:'https://nitter.net/tarkov/rss' },
  { name:'@tarkov (xcancel)', url:'https://xcancel.com/tarkov/rss' },
  { name:'@tarkov (Nitter 2)', url:'https://nitter.poast.org/tarkov/rss' },
  { name:'@tarkov (Nitter 3)', url:'https://nitter.privacydev.net/tarkov/rss' }
];
const KEEP_DAYS = 21;
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const TZ = { utc:0, gmt:0, bst:1, cet:1, cest:2, eet:2, eest:3, msk:3, est:-5, edt:-4, cst:-6, cdt:-5, pst:-8, pdt:-7 };
const mIdx = w => { const x = String(w).toLowerCase().replace(/\.$/, ''); return MONTHS.findIndex(m => m === x || (x.length === 3 && m.startsWith(x)) || (x === 'sept' && m === 'september')); };
const snowMs = id => Number((BigInt(id) >> 22n) + 1288834974657n);   /* an X post id carries its own timestamp */
/* "August 17, 2:00 PM BST" / "November 9 at 3:00 PM GMT" / "January 4, 2026, 3:00 PM" -> UTC ms. hint = the post's own time, to pick the year. */
function stamp(mon, day, yr, hh, mm, ap, tz, hint) {
  const mo = mIdx(mon); if (mo < 0) return null;
  let y = yr ? +yr : new Date(hint).getUTCFullYear();
  const off = tz ? (TZ[String(tz).toLowerCase()] ?? 0) : 0;
  let h = hh === undefined ? 0 : (+hh % 12) + (/p/i.test(ap || '') ? 12 : 0), m = mm ? +mm : 0;
  const mk = yy => Date.UTC(yy, mo, +day, h - off, m) + (hh === undefined ? 864e5 : 0);   /* no time given: the whole day counts */
  let t = mk(y); if (!yr && t < hint - 60 * 864e5) t = mk(y + 1);
  return t;
}
const WHEN = '([A-Za-z]{3,9})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?(?:\\s*(?:,|at|@)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(AM|PM)(?:\\s*\\(?([A-Z]{3,4})\\)?)?(?:\\s*/\\s*\\d{1,2}(?::\\d{2})?\\s*[AP]M\\s*[A-Z]{3,4})?)?';
const reEnd = new RegExp('(?:runs?\\s+until|ends?(?:\\s+on)?|until|conclud\\w*\\s+on)\\s+' + WHEN, 'i');
const reThru = new RegExp('through\\s+' + WHEN, 'i');          /* "Through August 8" is usually a side offer, so it only counts when nothing stronger is there */
const reFrom = new RegExp('from\\s+' + WHEN + '\\s*(?:,|\\s)\\s*(?:to|until|through|-|–)\\s+' + WHEN, 'i');
const LIVE = /\b(starts?|started|begins?)\s+(right\s+)?now\b|\b(is|are)\s+(now\s+)?(live|active)\b|\bgo(es)?\s+live\b|\bnow\s+live\b/i;
const tag = t => /halloween/i.test(t) ? 'Halloween ' : /new\s+year/i.test(t) ? "New Year's " : /first season|season\s*1\b/i.test(t) ? 'Season 1 ' : /winter/i.test(t) ? 'Winter ' : /summer/i.test(t) ? 'Summer ' : /exfil\s+brothers/i.test(t) ? 'EXFIL Brothers ' : '';
/* one official post -> { start?, end, title } or null. Only posts about Twitch Drops that state an end date count. */
export function campaignFrom(text, at) {
  const t = String(text || '').replace(/\s+/g, ' ');
  if (!/twitch\s+drops?/i.test(t)) return null;
  let start = null, end = null, m = reFrom.exec(t);
  if (m) {
    const sTz = m[7] || m[14];
    const e = stamp(m[8], m[9], m[10], m[11], m[12], m[13], m[14] || sTz, at);
    const st = stamp(m[1], m[2], m[3], m[4], m[5], m[6], sTz, at);
    if (st && e && e > st) { start = st; end = e; }
  }
  if (end === null && ((m = reEnd.exec(t)) || (m = reThru.exec(t)))) end = stamp(m[1], m[2], m[3], m[4], m[5], m[6], m[7], at);
  if (end === null || end < at - 864e5) return null;
  if (start === null && LIVE.test(t)) start = at;
  return { start, end, title:tag(t) + 'Twitch Drops' };
}
/* syndication page (JSON inside the HTML) or an RSS feed -> [{ id, text, at }] */
export function parsePosts(body) {
  const out = [], b = String(body || '');
  const nd = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(b);
  if (nd) { try {
    const walk = o => { if (!o || typeof o !== 'object') return; if (typeof o.full_text === 'string' && (o.id_str || o.rest_id)) { const id = String(o.id_str || o.rest_id); try { out.push({ id, text:o.full_text, at:snowMs(id) }); } catch (e) {} } for (const k in o) walk(o[k]); };
    walk(JSON.parse(nd[1]));
  } catch (e) {} }
  for (const m of b.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const x = m[1], g = n => { const r = new RegExp('<' + n + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + n + '>', 'i').exec(x); return r ? dec(r[1]) : ''; };
    const idm = /status\/(\d+)/.exec(g('link') + g('guid')), at = Date.parse(g('pubDate'));
    const text = g('description') || g('title');
    if (text && isFinite(at)) out.push({ id:idm ? idm[1] : '', text, at });
  }
  return out;
}
/* group posts by end time (an announcement, a "now live" and a "one day left" post all share it) */
export function campaigns(posts, db = { campaigns:[] }, now = Date.now()) {
  const by = new Map((db.campaigns || []).map(c => [c.end, c]));
  for (const p of posts) {
    const c = campaignFrom(p.text, p.at); if (!c) continue;
    const ex = by.get(c.end), url = p.id ? 'https://x.com/tarkov/status/' + p.id : 'https://x.com/tarkov';
    if (!ex) by.set(c.end, { title:c.title, start:c.start ?? p.at, end:c.end, url, source:'Escape from Tarkov on X' });
    else { if (c.start !== null && c.start < ex.start) ex.start = c.start; else if (c.start === null && p.at < ex.start) ex.start = p.at; if (c.title.length > ex.title.length) ex.title = c.title; if (p.at < (ex._at || Infinity)) { ex._at = p.at; ex.url = url; } }
  }
  return [...by.values()].map(c => { delete c._at; return c; }).filter(c => now - c.end < 30 * 864e5).sort((a, b) => b.end - a.end).slice(0, 12);
}
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
  if (!process.env.FORCE && db.updated && Date.now() - Date.parse(db.updated) < 1 * 3600e3) { console.log('Refreshed less than 2 hours ago; skipping (FORCE=1 to run now).'); return; }
  const hits = []; let ok = 0, posts = [];
  for (const s of X_SOURCES) {
    try {
      const r = await fetch(s.url, { headers:UA, signal:AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const f = parsePosts(await r.text()); if (!f.length) throw new Error('no posts in the response');
      posts = f; console.log(`${s.name}: ${f.length} post(s), ${f.filter(x => campaignFrom(x.text, x.at)).length} about a Twitch drops campaign`); break;
    } catch (e) { console.log(`${s.name}: could not read (${String(e.message || e).split('\n')[0]})`); }
  }
  db.campaigns = campaigns(posts, db);
  for (const s of SOURCES) {
    try {
      const r = await fetch(s.url, { headers:UA, signal:AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const f = parseRss(await r.text()); ok++;
      console.log(`${s.name}: ${f.length} item(s), ${f.filter(x => relevant(x.title)).length} about Twitch drops`);
      f.forEach(x => hits.push(x));
    } catch (e) { console.log(`${s.name}: could not read (${String(e.message || e).split('\n')[0]})`); }
  }
  if (!ok && !posts.length) { console.log('No source could be read; leaving the file alone.'); return; }
  db.items = merge(db, hits);
  db.updated = new Date().toISOString();
  db.note = 'News headlines about Tarkov Twitch drops; dates are the day each was published, not the drop dates. Put a wrong one\'s id under "dismissed".';
  writeFileSync(OUT, JSON.stringify(db, null, 1) + '\n');
  console.log(`Wrote ${db.items.length} item(s).`);
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
