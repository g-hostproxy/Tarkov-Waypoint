/* Cloudflare Pages Function: pass-through to TarkovTracker's progress API, for browsers that block calling it directly.
   Lives at  functions/tracker.js  in the repo root and answers  https://<your-site>.pages.dev/tracker
   The player's token is forwarded once and is never stored or logged here. Read-only: GET only. */

const URLS = ['https://api.tarkovtracker.org/progress', 'https://api.tarkovtracker.org/api/v2/progress'];

export async function onRequest({ request }) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } });
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer [\w.~+\/=-]{8,200}$/.test(auth)) return new Response(JSON.stringify({ error: 'Missing token' }), { status: 401, headers: { 'content-type': 'application/json' } });
  let denied = null;          // first 401/403 seen: a token for one site is refused by the other, so keep trying
  for (const url of URLS) {
    let r;
    try { r = await fetch(url, { headers: { authorization: auth, accept: 'application/json', 'user-agent': 'TarkovWaypoint/1.0 (progress sync)' } }); }
    catch (e) { continue; }
    if (r.ok) return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' } });
    if ((r.status === 401 || r.status === 403) && !denied) denied = r;
  }
  if (denied) return new Response(denied.body, { status: denied.status, headers: { 'content-type': denied.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' } });
  return new Response(JSON.stringify({ error: 'TarkovTracker unreachable' }), { status: 502, headers: { 'content-type': 'application/json' } });
}
