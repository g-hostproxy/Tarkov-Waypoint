/* Cloudflare Pages Function: /events
   Reads the Escape from Tarkov wiki "Events" page (MediaWiki API, wikitext) and returns the recent events as JSON.
   Cached for an hour, so the wiki is asked at most about once an hour no matter how many people open the site.
   The wiki lists a START date in every heading ("Name (16 October 2026)", sometimes a range "(26-30 November 2022)").
   End dates are only used when the section text states one ("until 31 October", "ends on ...").
   Nothing here needs a binding or a secret. */
const SRC = 'https://escapefromtarkov.fandom.com/api.php?action=parse&page=Events&prop=wikitext&format=json&formatversion=2';
const PAGE = 'https://escapefromtarkov.fandom.com/wiki/Events';
const MON = { january:0, february:1, march:2, april:3, may:4, june:5, july:6, august:7, september:8, october:9, november:10, december:11 };
const M3 = {}; Object.keys(MON).forEach(k => { M3[k.slice(0, 3)] = MON[k]; });
const mon = s => { const k = String(s || '').toLowerCase(); return MON[k] !== undefined ? MON[k] : (k.length >= 3 && k.length <= 4 ? M3[k.slice(0, 3)] : undefined); };
const utc = (y, m, d) => Date.UTC(+y, m, +d);
const DAY = 864e5;

function strip(t){
  return String(t || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\{\{[^{}]*\}\}/g, '').replace(/\{\{[^{}]*\}\}/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'{2,}/g, '').replace(/<[^>]+>/g, '').replace(/\[https?:\/\/\S+\s*([^\]]*)\]/g, '$1');
}
/* "== Name (16 October 2026) ==" or "(26-30 November 2022)" or "(28 Nov - 2 Dec 2022)" */
function head(line){
  const m = /^={2,3}\s*(.+?)\s*={2,3}\s*$/.exec(line.trim()); if(!m) return null;
  const h = strip(m[1]).trim();
  let r = /^(.*?)\s*\(\s*(\d{1,2})\s*(?:([A-Za-z]+)\s*)?(?:-|–|—|to)\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*\)\s*$/.exec(h);
  if(r){ const em = mon(r[5]), sm = r[3] ? mon(r[3]) : em; if(em === undefined || sm === undefined) return null; return { title:r[1].trim(), start:utc(r[6], sm, r[2]), end:utc(r[6], em, r[4]) + DAY }; }
  r = /^(.*?)\s*\(\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*\)\s*$/.exec(h);
  if(r){ const sm = mon(r[3]); if(sm === undefined) return null; return { title:r[1].trim(), start:utc(r[4], sm, r[2]), end:null }; }
  return null;
}
/* an end date written in the section text, after the start: "until 31 October", "ends on 4 November 2026", "will last until ..." */
function endIn(body, start){
  const y0 = new Date(start).getUTCFullYear();
  const re = /(?:until|till|through|ends?(?:\s+on)?|ending(?:\s+on)?|lasts?\s+until|available\s+until)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]+)(?:\s+(\d{4}))?/gi;
  let m, best = null;
  while((m = re.exec(body))){ const mo = mon(m[2]); if(mo === undefined) continue; let y = m[3] ? +m[3] : y0, t = utc(y, mo, m[1]); if(!m[3] && t < start) t = utc(y + 1, mo, m[1]); if(t >= start && t - start < 120 * DAY) best = best === null ? t : Math.max(best, t); }
  return best === null ? null : best + DAY;
}
const slug = t => t.replace(/ /g, '_').replace(/[^\w()\-.,%:']/g, '');
function kindOf(t){ return /wipe/i.test(t) ? 'wipe' : /discount|sale|shortage|bonus|weekend/i.test(t) ? 'sale' : 'event'; }

function parse(wikitext, now, sinceDays){
  const out = [], lines = String(wikitext || '').split(/\r?\n/);
  let cur = null;
  const flush = () => {
    if(!cur) return;
    const body = strip(cur.body.join('\n')), end = cur.end !== null ? cur.end : endIn(body, cur.start);
    const first = body.split('\n').map(s => s.replace(/^[\s*#:;=]+/, '').trim()).find(s => s.length > 25 && !/^(gameplay|item) changes/i.test(s) && !/^(file|image):/i.test(s)) || '';
    out.push({ title:cur.title, kind:kindOf(cur.title), start:new Date(cur.start).toISOString(), end:end === null ? null : new Date(end).toISOString(), endKnown:end !== null, text:first.slice(0, 220), url:PAGE + '#' + slug(cur.raw) });
  };
  for(const ln of lines){
    if(/^==[^=]/.test(ln.trim()) && !/^===/.test(ln.trim())){ flush(); const h = head(ln); cur = h ? Object.assign({ body:[], raw:ln.trim().replace(/^=+\s*|\s*=+$/g, '') }, h) : null; if(cur) cur.raw = strip(cur.raw).trim(); }
    else if(cur) cur.body.push(ln);
  }
  flush();
  const min = now - (sinceDays || 60) * DAY;
  return out.filter(e => Date.parse(e.end || e.start) >= min).sort((a, b) => Date.parse(b.start) - Date.parse(a.start)).slice(0, 12);
}

export async function onRequestGet(ctx){
  const cache = caches.default, key = new Request(new URL('/__events_v1', ctx.request.url).toString());
  const hit = await cache.match(key); if(hit) return hit;
  let body = { events:[], at:Date.now(), ok:false };
  try{
    const r = await fetch(SRC, { headers:{ 'user-agent':'TarkovWaypoint/1.0 (events badge; cached 1h)', accept:'application/json' }, cf:{ cacheTtl:1800 } });
    if(r.ok){ const j = await r.json(); const wt = j && j.parse && j.parse.wikitext; if(typeof wt === 'string' && wt.length > 500){ body = { events:parse(wt, Date.now(), 60), at:Date.now(), ok:true }; } }
  }catch(e){}
  const res = new Response(JSON.stringify(body), { headers:{ 'content-type':'application/json; charset=utf-8', 'cache-control':'public, max-age=' + (body.ok ? 3600 : 120), 'access-control-allow-origin':'*' } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
export { parse, head, endIn };
