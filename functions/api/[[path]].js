/* Tarkov Waypoint accounts: Discord sign-in + cloud sync of your progress.
   Runs as a Cloudflare Pages Function (folder: functions/api/ at the repo root). Needs:
     KV namespace binding   TW_KV
     secret / variable      DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
   Stores only: your Discord id, display name and avatar hash, a hashed session token, and the progress file the site sends. No email, no servers list. */

const DAY = 86400;
const SESSION_TTL = 30 * DAY;
const MAX_BODY = 200 * 1024;
const COOKIE = 'tw_s', STATE_COOKIE = 'tw_st';

const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), { status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, extra) });
const redirect = (to, cookies = []) => { const h = new Headers({ location: to, 'cache-control': 'no-store' }); cookies.forEach(c => h.append('set-cookie', c)); return new Response(null, { status: 302, headers: h }); };
const cookieOf = (req, name) => { const m = ('; ' + (req.headers.get('cookie') || '')).split('; ' + name + '='); return m.length > 1 ? decodeURIComponent(m.pop().split(';')[0]) : ''; };
const setCookie = (name, val, maxAge) => `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const rand = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

async function sessionOf(req, env){
  const tok = cookieOf(req, COOKIE); if(!/^[0-9a-f]{64}$/.test(tok)) return null;
  const raw = await env.TW_KV.get('s:' + await sha(tok)); if(!raw) return null;
  try{ return JSON.parse(raw); }catch(e){ return null; }
}
/* state-changing calls must carry our header (a cross-site form or image cannot add it) and come from our own origin */
function sameSite(req){
  if(req.headers.get('x-tw') !== '1') return false;
  const o = req.headers.get('origin'); return !o || o === new URL(req.url).origin;
}
const publicUser = u => ({ id: u.id, name: u.name, avatar: u.avatar || '' });

export async function onRequest(ctx){
  const { request: req, env } = ctx, url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, ''), method = req.method;
  if(!env.TW_KV || !env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return json({ error: 'not-configured' }, 503);
  const redirectUri = (env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/$/, '') : url.origin) + '/api/auth/callback';

  try{
    /* ---- sign in: send the browser to Discord ---- */
    if(path === 'auth/discord' && method === 'GET'){
      const state = rand(16);
      const q = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'identify', state, prompt: 'none' });
      return redirect('https://discord.com/oauth2/authorize?' + q, [setCookie(STATE_COOKIE, state, 600)]);
    }
    /* ---- Discord sends the person back here ---- */
    if(path === 'auth/callback' && method === 'GET'){
      const clear = setCookie(STATE_COOKIE, '', 0);
      if(url.searchParams.get('error')) return redirect('/?login=cancelled', [clear]);
      const code = url.searchParams.get('code'), state = url.searchParams.get('state');
      if(!code || !state || state !== cookieOf(req, STATE_COOKIE)) return redirect('/?login=failed', [clear]);
      const tr = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirectUri }) });
      if(!tr.ok) return redirect('/?login=failed', [clear]);
      const tk = await tr.json();
      const ur = await fetch('https://discord.com/api/users/@me', { headers: { authorization: 'Bearer ' + tk.access_token } });
      if(!ur.ok) return redirect('/?login=failed', [clear]);
      const du = await ur.json(); if(!du.id) return redirect('/?login=failed', [clear]);
      const user = { id: 'discord:' + du.id, name: String(du.global_name || du.username || 'Player').slice(0, 40), avatar: du.avatar ? `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.png?size=64` : '' };
      const token = rand(32);
      await env.TW_KV.put('s:' + await sha(token), JSON.stringify(user), { expirationTtl: SESSION_TTL });
      /* we do not keep Discord's token: it is only needed for this one lookup */
      fetch('https://discord.com/api/oauth2/token/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, token: tk.access_token }) }).catch(() => {});
      return redirect('/?login=ok', [setCookie(COOKIE, token, SESSION_TTL), clear]);
    }
    /* ---- who am I ---- */
    if(path === 'me' && method === 'GET'){
      const u = await sessionOf(req, env);
      return u ? json({ user: publicUser(u) }) : json({ user: null }, 401);
    }
    /* everything below needs a session and our header */
    if(['logout', 'sync', 'account'].includes(path)){
      if(method !== 'GET' && !sameSite(req)) return json({ error: 'bad-origin' }, 403);
      const u = await sessionOf(req, env);
      if(path === 'logout' && method === 'POST'){
        const tok = cookieOf(req, COOKIE); if(/^[0-9a-f]{64}$/.test(tok)) await env.TW_KV.delete('s:' + await sha(tok));
        return json({ ok: true }, 200, { 'set-cookie': setCookie(COOKIE, '', 0) });
      }
      if(!u) return json({ error: 'signed-out' }, 401);
      const key = 'd:' + u.id;
      if(path === 'sync' && method === 'GET'){
        const raw = await env.TW_KV.get(key); if(!raw) return json({ data: null, at: 0 });
        const d = JSON.parse(raw); return json({ data: d.text, at: d.at });
      }
      if(path === 'sync' && method === 'PUT'){
        const len = +req.headers.get('content-length') || 0; if(len > MAX_BODY) return json({ error: 'too-big' }, 413);
        const body = await req.text(); if(body.length > MAX_BODY) return json({ error: 'too-big' }, 413);
        let b; try{ b = JSON.parse(body); }catch(e){ return json({ error: 'bad-json' }, 400); }
        if(typeof b.data !== 'string') return json({ error: 'bad-data' }, 400);
        const raw = await env.TW_KV.get(key), cur = raw ? JSON.parse(raw) : null;
        /* the device must have seen the latest version, otherwise it would overwrite another device's progress */
        if(cur && !b.force && +b.base !== cur.at) return json({ error: 'conflict', data: cur.text, at: cur.at }, 409);
        const at = Math.max(Date.now(), cur ? cur.at + 1 : 0);
        await env.TW_KV.put(key, JSON.stringify({ text: b.data, at }));
        return json({ ok: true, at });
      }
      if(path === 'account' && method === 'DELETE'){
        await env.TW_KV.delete(key);
        const tok = cookieOf(req, COOKIE); if(/^[0-9a-f]{64}$/.test(tok)) await env.TW_KV.delete('s:' + await sha(tok));
        return json({ ok: true }, 200, { 'set-cookie': setCookie(COOKIE, '', 0) });
      }
    }
    return json({ error: 'not-found' }, 404);
  }catch(e){
    /* Cloudflare's free KV plan stops reads/writes for the rest of the day once its daily limit is used up */
    if(/limit|429|too many|quota/i.test(String(e && e.message))) return json({ error: 'busy' }, 429);
    return json({ error: 'server-error' }, 500);
  }
}
