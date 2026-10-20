/* Cloudflare Pages Function: "has the bug I reported been fixed?"  ->  POST /report-status
   The page sends the report number and the secret it was given when it sent the report. The secret is checked against the hash hidden in the
   issue, so a browser can only ever ask about its own reports. Nothing about the person is stored or sent.
   Needs the same settings as report.js (GITHUB_TOKEN with Issues read, BUG_REPO).
   You answer by closing the issue on GitHub: "Close as completed" = fixed, "Close as not planned" = could not be fixed.
   Add a comment starting with  /public  (for example  /public Fixed in today's update) and the sender sees that text. */

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const MAX_ITEMS = 10;

async function gh(env, path) {
  return fetch('https://api.github.com/repos/' + env.BUG_REPO + path, {
    headers: { authorization: 'Bearer ' + env.GITHUB_TOKEN, accept: 'application/vnd.github+json', 'user-agent': 'raid-route-bug-reports', 'x-github-api-version': '2022-11-28' },
  });
}

export async function onRequestPost({ request, env }) {
  if (!env || !env.GITHUB_TOKEN || !env.BUG_REPO) return json(503, { ok: false, error: 'not-configured' });
  const url = new URL(request.url), origin = request.headers.get('origin');
  if (origin) { try { if (new URL(origin).host !== url.host) return json(403, { ok: false }); } catch (e) { return json(403, { ok: false }); } }
  if ((request.headers.get('content-type') || '').indexOf('application/json') !== 0) return json(415, { ok: false });
  const raw = await request.text(); if (raw.length > 4000) return json(413, { ok: false });
  let b; try { b = JSON.parse(raw); } catch (e) { return json(400, { ok: false }); }
  const items = Array.isArray(b && b.items) ? b.items.slice(0, MAX_ITEMS) : [];
  const out = [];
  for (const it of items) {
    const n = +it.n, k = String(it.k || '');
    if (!Number.isInteger(n) || n < 1 || !/^[0-9a-f]{48}$/.test(k)) continue;
    try {
      const r = await gh(env, '/issues/' + n);
      if (r.status === 404) { out.push({ n, state: 'gone' }); continue; }
      if (!r.ok) continue;
      const is = await r.json();
      const want = '<!-- rr-key:' + await sha256('rr-report|' + k) + ' -->';
      if (is.pull_request || !String(is.body || '').includes(want)) { out.push({ n, state: 'gone' }); continue; }       /* not this browser's report */
      if (is.state !== 'closed') { out.push({ n, state: 'open' }); continue; }
      let note = '';
      if (is.comments > 0) {
        const cr = await gh(env, '/issues/' + n + '/comments?per_page=50');
        if (cr.ok) { const list = await cr.json(); for (let i = list.length - 1; i >= 0; i--) { const m = /^\/public\s+([\s\S]+)/.exec(String(list[i].body || '').trim()); if (m) { note = clean(m[1], 300); break; } } }
      }
      out.push({ n, state: is.state_reason === 'not_planned' ? 'closed' : 'fixed', note });
    } catch (e) { /* try again next time */ }
  }
  return json(200, { ok: true, items: out });
}

export async function onRequest() {
  return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
}
