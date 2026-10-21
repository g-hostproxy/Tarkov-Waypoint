/* Cloudflare Pages Function: /api/wiki?page=Quest_Name
   Reads one page of the Escape from Tarkov wiki on the server and hands it to the site from the SAME address, so browsers that block
   or fail a direct request to fandom.com (privacy shields, extensions, CORS) can still load the quest photos. Answers are kept for a day. */
export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const page = (url.searchParams.get('page') || '').slice(0, 200);
  const file = (url.searchParams.get('file') || '').slice(0, 200);
  if (!/^[\w\-.,'()!:%&+ ]+$/.test(page || file)) return json({ error: { info: 'bad page name' } }, 400);
  const api = 'https://escapefromtarkov.fandom.com/api.php?action=parse&format=json&prop=text&redirects=1&disableeditsection=1&disablelimitreport=1&page=' +
    encodeURIComponent(file ? 'File:' + file : page);
  const cache = caches.default, key = new Request(url.origin + '/api/wiki?' + (file ? 'file=' + encodeURIComponent(file) : 'page=' + encodeURIComponent(page)));
  const hit = await cache.match(key);
  if (hit) return hit;
  let r;
  try { r = await fetch(api, { headers: { 'User-Agent': 'TarkovWaypoint/1.0 (tarkov-waypoint.pages.dev)', 'Accept': 'application/json' } }); }
  catch (e) { return json({ error: { info: 'wiki unreachable' } }, 502); }
  if (!r.ok) return json({ error: { info: 'wiki answered ' + r.status } }, 502);
  const res = new Response(await r.text(), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' } });
  try { await cache.put(key, res.clone()); } catch (e) {}
  return res;
}
function json(o, status) { return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } }); }
