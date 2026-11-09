// Builds data/promocodes.json: promo codes people report as working, with the date each was first and last seen and where.
// Nobody can test a Tarkov code except by redeeming it on Battlestate's site, so every code here is "reported", not verified.
// Sources (each allowed to fail): the Tarkov wiki, r/EscapefromTarkov, and a couple of code roundup pages.
// Codes you add by hand under "manual" (and ones you put under "dismissed") are never touched. Runs at most every 3 hours (FORCE=1 to run now).
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const OUT = 'data/promocodes.json';
const UA = { 'User-Agent': 'TarkovWaypoint-promocodes/1.0 (personal fan project; contact via GitHub repo)' };
const WIKI = process.env.WIKI_BASE || 'https://escapefromtarkov.fandom.com';
const SOURCES = process.env.PROMO_SOURCES ? JSON.parse(process.env.PROMO_SOURCES) : [
  { name:'Reddit r/EscapefromTarkov', kind:'reddit', url:'https://www.reddit.com/r/EscapefromTarkov/search.json?q=promo%20code&restrict_sr=1&sort=new&t=month&limit=50' },
  { name:'Reddit r/EscapefromTarkov (new)', kind:'reddit', url:'https://www.reddit.com/r/EscapefromTarkov/new.json?limit=100' },
  { name:'Tarkov wiki', kind:'wiki', url:WIKI + '/wiki/Promo_codes', page:'Promo_codes' },
  { name:'games.gg', kind:'html', url:'https://games.gg/news/escape-from-tarkov-active-promo-codes/' },
  { name:'Dexerto', kind:'html', url:'https://dexerto.com/escape-from-tarkov/all-escape-from-tarkov-promo-codes-and-discounts-1752105' }
];
const STOP = new Set(['PROMO','PROMOCODE','PROMOCODES','CODES','REDEEM','ESCAPE','TARKOV','BATTLESTATE','GAMES','DISCOUNT','REWARD','REWARDS','WORKING','ACTIVE','EXPIRED','UPDATED','PLAYERS','ACCOUNT','WEBSITE','OFFICIAL','COUPON','COUPONS','HALLOWEEN','CHRISTMAS','GIVEAWAY','TWITCH','YOUTUBE','DISCORD','REDDIT','STREAMER','STREAMERS','PATCH','WIPE','EVENT','EVENTS','ENTER','CLICK','THESE','THEIR','WHERE','LOGIN','PASSWORD','USERNAME','FREE','GUIDE','LIST','HERE','WITH','FROM','THAT','THIS','HAVE','WILL','YOUR','ABOUT']);
const today = () => new Date().toISOString().slice(0, 10);
const dayOf = ts => new Date(ts).toISOString().slice(0, 10);

/* pull code-like strings out of free text. Returns uppercase codes. */
export function extractCodes(text) {
  const t = String(text || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&');
  const out = new Set();
  const add = (c, quoted) => {
    c = String(c).trim();
    if (!/^[A-Za-z0-9]{6,24}$/.test(c)) return;
    if (!quoted && c !== c.toUpperCase()) return;                 /* bare words after "code" must be written in capitals */
    if (!/[A-Za-z]/.test(c)) return;
    const u = c.toUpperCase(); if (STOP.has(u)) return;
    out.add(u);
  };
  /* "promo code: X", "code is X", "use code X", also wrapped in quotes, backticks or bold */
  for (const m of t.matchAll(/(?:promo\s*-?\s*codes?|codes?|coupon)\s*(?:is|are|:|-|=|–|—)?\s*(["'`*“‘]*)([A-Za-z0-9]{6,24})\1/gi)) add(m[2], !!m[1]);
  /* quoted or backticked tokens on their own: `TARKOVHALLOWEEN`, "TARKOVHALLOWEEN" */
  for (const m of t.matchAll(/[`"“]([A-Za-z0-9]{6,24})[`"”]/g)) if (/code|promo|redeem/i.test(t)) add(m[1], true);
  /* standalone capitals that start like Tarkov codes */
  for (const m of t.matchAll(/\b(?:TARKOV|EFT|BSG|ESCAPE|BATTLESTATE)[A-Z0-9]{3,20}\b/g)) add(m[0], false);
  return [...out];
}

async function get(url, json) {
  const res = await fetch(url, { headers: { ...UA, Accept: json ? 'application/json' : 'text/html' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return json ? res.json() : res.text();
}

/* each reader returns [{ code, at (ms), url }] */
async function readSource(s) {
  const found = [];
  if (s.kind === 'reddit') {
    const j = await get(s.url, true);
    for (const c of (j.data && j.data.children) || []) {
      const d = c.data || {}; const txt = (d.title || '') + '\n' + (d.selftext || '');
      if (!/promo|code|redeem/i.test(txt)) continue;
      for (const code of extractCodes(txt)) found.push({ code, at:(d.created_utc || 0) * 1000, url:'https://www.reddit.com' + (d.permalink || '') });
    }
  } else if (s.kind === 'wiki') {
    const j = await get(`${WIKI}/api.php?${new URLSearchParams({ action:'parse', page:s.page, prop:'text', format:'json', formatversion:'2', redirects:'1' })}`, true);
    for (const code of extractCodes(j.parse && j.parse.text)) found.push({ code, at:Date.now(), url:s.url });
  } else {
    const h = await get(s.url);
    const main = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi, ' ');
    for (const code of extractCodes(main)) found.push({ code, at:Date.now(), url:s.url });
  }
  return found;
}

export function merge(db, hits, now = Date.now()) {
  const dismissed = new Set((db.dismissed || []).map(x => String(x).toUpperCase()));
  const byCode = new Map((db.codes || []).map(c => [c.code, c]));
  for (const h of hits) {
    if (dismissed.has(h.code)) continue;
    const day = dayOf(h.at || now);
    let c = byCode.get(h.code);
    if (!c) { c = { code:h.code, firstSeen:day, lastSeen:day, sources:[] }; byCode.set(h.code, c); }
    if (day < c.firstSeen) c.firstSeen = day;
    if (day > c.lastSeen) c.lastSeen = day;
    const src = c.sources.find(x => x.name === h.name);
    if (src) { if (day > src.date) { src.date = day; src.url = h.url; } } else c.sources.push({ name:h.name, url:h.url, date:day });
  }
  /* manual codes (added by hand) always stay, with their own dates */
  for (const m of db.manual || []) {
    const code = String(m.code).toUpperCase(); if (dismissed.has(code)) continue;
    let c = byCode.get(code); const day = m.date || today();
    if (!c) { c = { code, firstSeen:day, lastSeen:day, sources:[] }; byCode.set(code, c); }
    if (day < c.firstSeen) c.firstSeen = day;
    if (day > c.lastSeen) c.lastSeen = day;
    if (m.note) c.note = m.note;
    if (!c.sources.some(x => x.name === 'Added by hand')) c.sources.push({ name:'Added by hand', url:m.url || '', date:day });
  }
  for (const d of dismissed) byCode.delete(d);
  return [...byCode.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || a.code.localeCompare(b.code));
}

async function main() {
  mkdirSync('data', { recursive: true });
  let db = { codes:[], manual:[], dismissed:[] };
  if (existsSync(OUT)) { try{ db = Object.assign(db, JSON.parse(readFileSync(OUT, 'utf8'))); }catch(e){} }
  if (!process.env.FORCE && existsSync(OUT) && Date.now() - statSync(OUT).mtimeMs < 3 * 3600e3) { console.log('Refreshed less than 3 hours ago; skipping (FORCE=1 to run now).'); return; }
  const hits = []; let okCount = 0;
  for (const s of SOURCES) {
    try{ const f = await readSource(s); okCount++; console.log(`${s.name}: ${f.length} code(s)${f.length ? ' ' + [...new Set(f.map(x => x.code))].join(', ') : ''}`); f.forEach(x => hits.push({ ...x, name:s.name })); }
    catch(e){ console.log(`${s.name}: could not read (${String(e.message || e).split('\n')[0]})`); }
  }
  if (!okCount) { console.log('No source could be read; leaving the file alone.'); return; }
  db.codes = merge(db, hits);
  db.updated = new Date().toISOString();
  db.note = 'Codes are reported by players and sites, not tested. Add a code by hand under "manual" ({ "code":"X", "date":"YYYY-MM-DD", "note":"..." }); put a wrong one under "dismissed".';
  writeFileSync(OUT, JSON.stringify(db, null, 1) + '\n');
  console.log(`Wrote ${db.codes.length} code(s).`);
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
