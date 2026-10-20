/* Tarkov Waypoint accounts: Discord sign-in + cloud sync of your progress.
   Runs as a Cloudflare Pages Function (folder: functions/api/ at the repo root). Needs:
     KV namespace binding   TW_KV
     secret / variable      DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
   Optional, for Friends (live positions): a D1 database binding   TW_DB   (the tables create themselves)
   Stores only: your Discord id, display name and avatar hash, a hashed session token, and the progress file the site sends. No email, no servers list.
   With Friends turned on it also keeps your friend list, your sharing choice, and your last hour of shared map positions. */

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
/* ---------- Friends: needs the D1 database (KV is far too small for live positions: ~1,000 writes a day) ---------- */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', MAX_FRIENDS = 30, MAX_PENDING = 20, POS_KEEP = 60 * 60000, POS_SHOW = 3 * 60 * 60000, POS_GAP = 5000;
let schemaReady = false;
const newCode = () => { const b = crypto.getRandomValues(new Uint8Array(8)); const c = [...b].map(x => CODE_CHARS[x % 32]).join(''); return c.slice(0, 4) + '-' + c.slice(4); };
async function openDb(env){
  if(!env.TW_DB) return null;
  if(!schemaReady){
    await env.TW_DB.batch([
      env.TW_DB.prepare('CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, uname TEXT, name TEXT, avatar TEXT, share INTEGER NOT NULL DEFAULT 0, delay INTEGER NOT NULL DEFAULT 0, seen INTEGER)'),
      env.TW_DB.prepare('CREATE TABLE IF NOT EXISTS friends (lo TEXT NOT NULL, hi TEXT NOT NULL, by TEXT NOT NULL, state TEXT NOT NULL, mlo INTEGER NOT NULL DEFAULT 0, mhi INTEGER NOT NULL DEFAULT 0, at INTEGER, PRIMARY KEY (lo, hi))'),
      env.TW_DB.prepare('CREATE INDEX IF NOT EXISTS friends_hi ON friends (hi)'),
      env.TW_DB.prepare('CREATE TABLE IF NOT EXISTS pos (uid TEXT NOT NULL, at INTEGER NOT NULL, map TEXT, x REAL, z REAL, fx REAL, fz REAL, face INTEGER)'),
      env.TW_DB.prepare('CREATE INDEX IF NOT EXISTS pos_uid ON pos (uid, at)')
    ]);
    schemaReady = true;
  }
  return env.TW_DB;
}
/* make sure this person has a row (and a friend code), and keep their name and picture current */
async function ensurePerson(d, u){
  let p = await d.prepare('SELECT id, code, uname, name, avatar, share, delay FROM people WHERE id = ?1').bind(u.id).first();
  const uname = u.username ? String(u.username).toLowerCase().slice(0, 40) : null;
  if(!p){
    for(let i = 0; i < 5; i++){
      const code = newCode();
      try{ await d.prepare('INSERT INTO people (id, code, uname, name, avatar, share, delay, seen) VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, ?6)').bind(u.id, code, uname, u.name, u.avatar || '', Date.now()).run(); break; }
      catch(e){ if(i === 4) throw e; }
    }
    p = await d.prepare('SELECT id, code, uname, name, avatar, share, delay FROM people WHERE id = ?1').bind(u.id).first();
  }else if(p.name !== u.name || (p.avatar || '') !== (u.avatar || '') || (uname && p.uname !== uname)){
    await d.prepare('UPDATE people SET name = ?2, avatar = ?3, uname = COALESCE(?4, uname) WHERE id = ?1').bind(u.id, u.name, u.avatar || '', uname).run();
    p.name = u.name; p.avatar = u.avatar || ''; if(uname) p.uname = uname;
  }
  return p;
}
const pairOf = (a, b) => a < b ? { lo: a, hi: b } : { lo: b, hi: a };
const num = v => typeof v === 'number' && isFinite(v) && Math.abs(v) < 100000;
async function friendsApi(path, method, req, env, u){
  const d = await openDb(env); if(!d) return json({ error: 'no-db' }, 503);
  const now = Date.now();
  if(path === 'friends/list' && method === 'GET'){
    const me = await ensurePerson(d, u);
    const rows = (await d.prepare('SELECT f.lo, f.hi, f.by, f.state, f.mlo, f.mhi, p.id AS pid, p.name, p.avatar FROM friends f JOIN people p ON p.id = (CASE WHEN f.lo = ?1 THEN f.hi ELSE f.lo END) WHERE f.lo = ?1 OR f.hi = ?1').bind(u.id).all()).results || [];
    const friends = rows.map(r => ({ id: r.pid, name: r.name, avatar: r.avatar || '', state: r.state === 'ok' ? 'ok' : (r.by === u.id ? 'out' : 'in'), muted: !!(r.lo === u.id ? r.mlo : r.mhi) }));
    return json({ me: { code: me.code, share: !!me.share, delay: me.delay, uname: me.uname || '' }, friends });
  }
  if(path === 'friends/pos' && method === 'GET'){
    const rows = (await d.prepare(
      'SELECT p.id, p.name, p.avatar, q.map, q.x, q.z, q.fx, q.fz, q.face, q.at FROM friends f ' +
      'JOIN people p ON p.id = (CASE WHEN f.lo = ?1 THEN f.hi ELSE f.lo END) JOIN pos q ON q.uid = p.id ' +
      "WHERE (f.lo = ?1 OR f.hi = ?1) AND f.state = 'ok' AND p.share = 1 AND (CASE WHEN f.lo = ?1 THEN f.mhi ELSE f.mlo END) = 0 " +
      'AND q.at = (SELECT MAX(at) FROM pos WHERE uid = p.id AND at <= ?2 - p.delay * 60000) AND q.at > ?2 - ?3').bind(u.id, now, POS_SHOW).all()).results || [];
    return json({ now, pins: rows.map(r => ({ id: r.id, name: r.name, avatar: r.avatar || '', map: r.map, x: r.x, z: r.z, fx: r.fx, fz: r.fz, face: !!r.face, at: r.at })) });
  }
  if(method !== 'POST') return json({ error: 'not-found' }, 404);
  let b = {}; try{ const t = await req.text(); if(t.length > 2000) return json({ error: 'too-big' }, 413); b = t ? JSON.parse(t) : {}; }catch(e){ return json({ error: 'bad-json' }, 400); }
  const other = typeof b.id === 'string' ? b.id.slice(0, 80) : '';

  if(path === 'pos'){
    const m = String(b.map || '');
    if(!/^[a-z0-9-]{2,30}$/.test(m) || ![b.x, b.z, b.fx, b.fz].every(num)) return json({ error: 'bad-data' }, 400);
    const st = await d.prepare('SELECT share, (SELECT MAX(at) FROM pos WHERE uid = ?1) AS last, EXISTS(SELECT 1 FROM friends WHERE (lo = ?1 OR hi = ?1) AND state = \'ok\') AS hasf FROM people WHERE id = ?1').bind(u.id).first();
    if(!st || !st.share) return json({ ok: true, sent: false, why: 'off' });
    if(!st.hasf) return json({ ok: true, sent: false, why: 'no-friends' });
    if(st.last && now - st.last < POS_GAP) return json({ ok: true, sent: false, why: 'too-soon' });
    await d.batch([
      d.prepare('INSERT INTO pos (uid, at, map, x, z, fx, fz, face) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)').bind(u.id, now, m, b.x, b.z, b.fx, b.fz, b.face ? 1 : 0),
      d.prepare('DELETE FROM pos WHERE uid = ?1 AND at < ?2').bind(u.id, now - POS_KEEP)
    ]);
    return json({ ok: true, sent: true });
  }
  const me = await ensurePerson(d, u);
  if(path === 'friends/settings'){
    const share = b.share ? 1 : 0, delay = [0, 2, 5, 10].includes(+b.delay) ? +b.delay : 0;
    await d.prepare('UPDATE people SET share = ?2, delay = ?3 WHERE id = ?1').bind(u.id, share, delay).run();
    if(!share) await d.prepare('DELETE FROM pos WHERE uid = ?1').bind(u.id).run();     /* switching sharing off wipes your last positions */
    return json({ ok: true, share: !!share, delay });
  }
  if(path === 'friends/add'){
    let to = String(b.to || '').trim().replace(/^@/, '');
    if(to.length < 3 || to.length > 40) return json({ error: 'not-found-user' }, 404);
    const code = to.toUpperCase().replace(/[\s-]/g, '');
    const target = /^[A-Z0-9]{8}$/.test(code)
      ? await d.prepare('SELECT id, name FROM people WHERE code = ?1').bind(code.slice(0, 4) + '-' + code.slice(4)).first()
      : await d.prepare('SELECT id, name FROM people WHERE uname = ?1').bind(to.toLowerCase()).first();
    if(!target) return json({ error: 'not-found-user' }, 404);
    if(target.id === u.id) return json({ error: 'self' }, 400);
    const { lo, hi } = pairOf(u.id, target.id);
    const row = await d.prepare('SELECT by, state FROM friends WHERE lo = ?1 AND hi = ?2').bind(lo, hi).first();
    if(row){
      if(row.state === 'ok') return json({ ok: true, state: 'ok', name: target.name, already: true });
      if(row.by === u.id) return json({ ok: true, state: 'out', name: target.name, already: true });
      await d.prepare("UPDATE friends SET state = 'ok', at = ?3 WHERE lo = ?1 AND hi = ?2").bind(lo, hi, now).run();      /* they had asked us first */
      return json({ ok: true, state: 'ok', name: target.name });
    }
    const mine = await d.prepare("SELECT COUNT(*) AS n, SUM(state = 'ok') AS ok FROM friends WHERE lo = ?1 OR hi = ?1").bind(u.id).first();
    if((mine.ok || 0) >= MAX_FRIENDS) return json({ error: 'full' }, 400);
    const sent = await d.prepare("SELECT COUNT(*) AS n FROM friends WHERE by = ?1 AND state = 'pending'").bind(u.id).first();
    if(sent.n >= MAX_PENDING) return json({ error: 'too-many-pending' }, 429);
    const theirs = await d.prepare("SELECT COUNT(*) AS n FROM friends WHERE (lo = ?1 OR hi = ?1) AND state = 'pending' AND by <> ?1").bind(target.id).first();
    if(theirs.n >= MAX_PENDING) return json({ ok: true, state: 'out', name: target.name });       /* their inbox is full: look sent, say nothing */
    await d.prepare("INSERT INTO friends (lo, hi, by, state, at) VALUES (?1, ?2, ?3, 'pending', ?4)").bind(lo, hi, u.id, now).run();
    return json({ ok: true, state: 'out', name: target.name });
  }
  if(!other) return json({ error: 'bad-data' }, 400);
  const { lo, hi } = pairOf(u.id, other);
  if(path === 'friends/accept'){
    await d.prepare("UPDATE friends SET state = 'ok', at = ?3 WHERE lo = ?1 AND hi = ?2 AND state = 'pending' AND by <> ?4").bind(lo, hi, now, u.id).run();
    return json({ ok: true });
  }
  if(path === 'friends/remove'){            /* also used to decline a request or cancel one you sent */
    await d.prepare('DELETE FROM friends WHERE lo = ?1 AND hi = ?2').bind(lo, hi).run();
    return json({ ok: true });
  }
  if(path === 'friends/mute'){              /* stop sharing your position with just this friend */
    await d.prepare(lo === u.id ? 'UPDATE friends SET mlo = ?3 WHERE lo = ?1 AND hi = ?2' : 'UPDATE friends SET mhi = ?3 WHERE lo = ?1 AND hi = ?2').bind(lo, hi, b.on ? 1 : 0).run();
    return json({ ok: true });
  }
  return json({ error: 'not-found' }, 404);
}
async function wipeFriends(env, id){
  const d = await openDb(env).catch(() => null); if(!d) return;
  await d.batch([d.prepare('DELETE FROM pos WHERE uid = ?1').bind(id), d.prepare('DELETE FROM friends WHERE lo = ?1 OR hi = ?1').bind(id), d.prepare('DELETE FROM people WHERE id = ?1').bind(id)]);
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
      const user = { id: 'discord:' + du.id, username: String(du.username || '').slice(0, 40), name: String(du.global_name || du.username || 'Player').slice(0, 40), avatar: du.avatar ? `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.png?size=64` : '' };
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
    if(['logout', 'sync', 'account', 'pos'].includes(path) || path.startsWith('friends/')){
      if(method !== 'GET' && !sameSite(req)) return json({ error: 'bad-origin' }, 403);
      const u = await sessionOf(req, env);
      if(path === 'logout' && method === 'POST'){
        const tok = cookieOf(req, COOKIE); if(/^[0-9a-f]{64}$/.test(tok)) await env.TW_KV.delete('s:' + await sha(tok));
        return json({ ok: true }, 200, { 'set-cookie': setCookie(COOKIE, '', 0) });
      }
      if(!u) return json({ error: 'signed-out' }, 401);
      if(path === 'pos' || path.startsWith('friends/')) return friendsApi(path, method, req, env, u);
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
        await env.TW_KV.delete(key); try{ await wipeFriends(env, u.id); }catch(e){}
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
