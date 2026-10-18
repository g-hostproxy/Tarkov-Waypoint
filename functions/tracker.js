/* Cloudflare Pages Function: pass-through to TarkovTracker's progress API, for browsers that block calling it directly.
   Lives at  functions/tracker.js  in the repo root and answers  https://<your-site>.pages.dev/tracker
   The player's token is forwarded once and is never stored or logged here. Read-only: GET only. */

const HOSTS = ['https://tarkovtracker.io', 'https://tarkovtracker.org'];

export async function onRequest({ request }) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } });
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer [\w.~+\/=-]{8,200}$/.test(auth)) return new Response(JSON.stringify({ error: 'Missing token' }), { status: 401, headers: { 'content-type': 'application/json' } });
  for (const base of HOSTS) {
    let r;
    try { r = await fetch(base + '/api/v2/progress', { headers: { authorization: auth, accept: 'application/json', 'user-agent': 'RaidRoute/1.0 (progress sync)' } }); }
    catch (e) { continue; }
    if (r.status === 401 || r.status === 403 || r.ok) {
      return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' } });
    }
  }
  return new Response(JSON.stringify({ error: 'TarkovTracker unreachable' }), { status: 502, headers: { 'content-type': 'application/json' } });
}
