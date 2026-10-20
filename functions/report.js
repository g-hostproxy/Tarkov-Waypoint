/* Cloudflare Pages Function: anonymous bug reports.
   Lives at  functions/report.js  in the repo root and answers  POST https://<your-site>.pages.dev/report
   It turns each report into an issue in a PRIVATE GitHub repo, using a token that only exists as a secret on Cloudflare.
   Visitors never see GitHub, the token or the repo, and nothing about them is stored:
     - no cookies, no accounts, no e-mail, no IP address in the issue
     - the user-agent is never forwarded (the page sends only a browser family if the visitor ticks "include technical details")
   Settings (Cloudflare Pages > your project > Settings > Variables and Secrets):
     GITHUB_TOKEN  (Secret)  fine-grained token: ONLY the bug repo, permission "Issues: Read and write"
     BUG_REPO      (Text)    owner/repo of the private repo, for example  g-hostproxy/tarkov-bug-reports
   Fix notices: each report gets a random secret that only the sender's browser keeps (the issue holds just its hash). functions/report-status.js
   lets that browser ask "is my report closed yet?". Close the issue to say it is fixed; a comment starting with  /public  is shown to the sender. */

const CATS = {
  pins:   'Wrong or missing pin',
  route:  'Route problem',
  quest:  'Quest missing or wrong',
  exit:   'Exit or extract',
  broken: 'Something is broken',
  other:  'Other',
};
const MAX_BODY = 12000;                       /* bytes the whole request may be */
const MIN_MSG = 10, MAX_MSG = 1500;
const COOLDOWN_S = 45;                        /* one report per visitor per 45 s (kept as a short-lived hash, see tooSoon) */

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

/* text only: no control characters, bounded length */
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);

/* code fence longer than any run of backticks inside, so a report can never inject markdown, links or @mentions into the issue */
function fence(text) {
  let f = '```';
  while (text.includes(f)) f += '`';
  return f + '\n' + text + '\n' + f;
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Crude flood guard without storing anything about people: a hash of (IP + today's date) lives in Cloudflare's edge cache for
   45 seconds and then disappears. The IP itself is never written anywhere and the hash cannot be turned back into it. */
async function tooSoon(request) {
  try {
    const ip = request.headers.get('cf-connecting-ip');
    if (!ip || typeof caches === 'undefined' || !caches.default) return false;
    const key = new Request('https://report-rate.invalid/' + await sha256(ip + '|' + new Date().toISOString().slice(0, 10) + '|raid-route'));
    if (await caches.default.match(key)) return true;
    await caches.default.put(key, new Response('1', { headers: { 'cache-control': 'max-age=' + COOLDOWN_S } }));
    return false;
  } catch (e) { return false; }
}

export async function onRequestPost({ request, env }) {
  if (!env || !env.GITHUB_TOKEN || !env.BUG_REPO) return json(503, { ok: false, error: 'not-configured' });

  /* only our own pages may post here */
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin) { try { if (new URL(origin).host !== url.host) return json(403, { ok: false }); } catch (e) { return json(403, { ok: false }); } }
  if ((request.headers.get('content-type') || '').indexOf('application/json') !== 0) return json(415, { ok: false });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { ok: false });
  let b; try { b = JSON.parse(raw); } catch (e) { return json(400, { ok: false }); }
  if (!b || typeof b !== 'object') return json(400, { ok: false });

  if (b.website) return json(200, { ok: true });          /* hidden trap field: only bots fill it in. Pretend it worked. */

  const cat = Object.prototype.hasOwnProperty.call(CATS, b.category) ? b.category : 'other';
  const msg = clean(b.message, MAX_MSG);
  if (msg.length < MIN_MSG) return json(400, { ok: false, error: 'too-short' });

  if (await tooSoon(request)) return json(429, { ok: false, error: 'slow-down' });

  /* optional technical details: only these fields, only if the visitor ticked the box and saw them */
  let details = '';
  const d = b.details && typeof b.details === 'object' ? b.details : null;
  if (d) {
    const rows = [];
    const add = (label, v, max) => { const s = clean(v, max); if (s) rows.push(label + ': ' + s); };
    add('Site version', d.build, 40);
    add('Map', d.map, 40);
    add('Browser', d.browser, 40);
    add('Phone or tablet', d.mobile ? 'yes' : 'no', 3);
    add('Window size', d.viewport, 20);
    add('Quests loaded', d.questsLoaded, 8);
    if (Array.isArray(d.quests) && d.quests.length) rows.push('Quests added (' + Math.min(d.quests.length, 30) + '):\n  - ' + d.quests.slice(0, 30).map(q => clean(q, 80)).filter(Boolean).join('\n  - '));
    if (rows.length) details = '\n\n**Technical details the visitor chose to include**\n' + fence(rows.join('\n'));
  }

  const first = msg.split('\n')[0].replace(/@/g, '').slice(0, 70);
  const title = '[' + CATS[cat] + '] ' + first;
  /* a secret only the sender's browser keeps; the issue stores just its hash, so only that browser can ask about this report later */
  const key = [...crypto.getRandomValues(new Uint8Array(24))].map(x => x.toString(16).padStart(2, '0')).join('');
  const body = '**' + CATS[cat] + '**\n\n' + fence(msg) + details + '\n\n_Sent anonymously from the site. No contact details were collected._\n\n<!-- rr-key:' + await sha256('rr-report|' + key) + ' -->';

  let res;
  try {
    res = await fetch('https://api.github.com/repos/' + env.BUG_REPO + '/issues', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + env.GITHUB_TOKEN,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'raid-route-bug-reports',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ title, body, labels: ['from-site', 'type: ' + cat] }),
    });
  } catch (e) { return json(502, { ok: false }); }
  if (!res.ok) { console.error('bug report: GitHub answered', res.status); return json(502, { ok: false }); }
  let id = 0; try { id = +(await res.json()).number || 0; } catch (e) {}
  return json(200, id ? { ok: true, id, key } : { ok: true });
}

/* anything that is not a POST */
export async function onRequest() {
  return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
}
