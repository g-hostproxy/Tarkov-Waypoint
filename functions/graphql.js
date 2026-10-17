/* Cloudflare Pages Function: same-origin proxy for the Tarkov.dev GraphQL API.
   Lives at  functions/graphql.js  in the repo root (next to index.html) and answers  https://<your-site>.pages.dev/graphql
   The page asks this address first, so the browser never has to talk to api.tarkov.dev directly (no CORS problems).
   GET answers are cached at Cloudflare for an hour, so the API is not hit once per visitor. */

const TARGET = 'https://api.tarkov.dev/graphql';
const MAX_BODY = 50000;                                   /* bytes: the page's queries are a few KB */

export async function onRequest({ request }) {
  const method = request.method;
  if (method !== 'GET' && method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, POST' } });
  }

  const url = new URL(request.url);
  const init = {
    method,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    /* cache good answers for an hour, never cache errors */
    cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 3600, '400-599': 0 } },
  };

  let target = TARGET;
  if (method === 'GET') {
    if (!url.searchParams.get('query')) return new Response('Missing ?query=', { status: 400 });
    target += url.search;
  } else {
    const body = await request.text();
    if (body.length > MAX_BODY) return new Response('Request too large', { status: 413 });
    init.body = body;
    delete init.cf;                                       /* POST answers are not cached */
  }

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch (e) {
    return new Response(JSON.stringify({ errors: [{ message: 'tarkov.dev API unreachable' }] }), {
      status: 502, headers: { 'content-type': 'application/json' },
    });
  }

  const headers = new Headers({ 'content-type': upstream.headers.get('content-type') || 'application/json' });
  if (upstream.ok && method === 'GET') headers.set('cache-control', 'public, max-age=300');
  else headers.set('cache-control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers });
}
