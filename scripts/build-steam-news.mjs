// Builds data/steam-news.json: Battlestate's own announcements from the game's Steam news page
// (https://store.steampowered.com/news/app/3932890), with a cover image, a short summary and a tag, for the "Tarkov updates" menu.
// Only the official feed (steam_community_announcements) is used; third-party reposts are left out. Runs at most hourly (FORCE=1 to run now).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const OUT = 'data/steam-news.json';
const APP = 3932890;
const API = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${APP}&count=60&maxlength=0&format=json`;
const IMG = 'https://clan.fastly.steamstatic.com/images/';
const MAX_ITEMS = 12;

export const tagOf = t => /patch|hotfix|update\s*\d/i.test(t) ? 'Patch notes' : /twitch|drops?\b/i.test(t) ? 'Twitch drops' : /survey/i.test(t) ? 'Survey' :
  /discount|bundle|edition|sale|%/i.test(t) ? 'Sale' : /event|anniversary|season|league|wipe/i.test(t) ? 'Event' : 'News';

/* the first picture of a post: Steam's {STEAM_CLAN_IMAGE}/<clan>/<hash>.jpg shorthand, or a full https image link */
export function coverOf(contents) {
  const c = String(contents || '');
  let m = /\{STEAM_CLAN_IMAGE\}\/(\d+\/[0-9a-f]+\.(?:jpe?g|png|gif|webp))/i.exec(c);
  if (m) return IMG + m[1];
  m = /(https?:\/\/[^\s\[\]"'<>]+\.(?:jpe?g|png|gif|webp))/i.exec(c);
  return m ? m[1] : '';
}

/* Steam's BBCode -> one plain sentence or two */
export function summaryOf(contents, max = 170) {
  let t = String(contents || '')
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, ' ').replace(/\{STEAM_CLAN_IMAGE\}\/\S+/g, ' ').replace(/<img[^>]*>/gi, ' ')
    .replace(/\[h[1-6]\]\s*(?:changes|patch notes|fixes)\s*\[\/h[1-6]\]/gi, ' ')
    .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, '$1').replace(/\[(?:\/)?(?:h[1-6])\]/gi, ' ').replace(/\[\*\]/g, ' · ')
    .replace(/\[\/?(?:list|olist|p|b|i|u|strike|spoiler|quote|code|table|tr|td|th|previewyoutube|hr)(?:=[^\]]*)?\]/gi, ' ')
    .replace(/\[[^\]]{0,40}\]/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').replace(/^[\s·]+/, '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max), at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf(' · '));
  return (at > 60 ? cut.slice(0, at) : cut.slice(0, cut.lastIndexOf(' '))).replace(/[\s·;,.]+$/, '') + '…';
}

export function buildItems(newsitems) {
  return (newsitems || []).filter(n => n && n.feedname === 'steam_community_announcements' && n.title && n.gid && +n.date)
    .sort((a, b) => b.date - a.date).slice(0, MAX_ITEMS)
    .map(n => ({ id:String(n.gid), title:String(n.title).replace(/\s+/g, ' ').trim(), date:new Date(n.date * 1000).toISOString().slice(0, 10), ts:+n.date * 1000,
      url:`https://store.steampowered.com/news/app/${APP}/view/${n.gid}`, img:coverOf(n.contents), summary:summaryOf(n.contents), tag:tagOf(n.title) }));
}

async function main() {
  mkdirSync('data', { recursive: true });
  let db = {}; if (existsSync(OUT)) { try { db = JSON.parse(readFileSync(OUT, 'utf8')); } catch (e) {} }
  if (!process.env.FORCE && db.updated && Date.now() - Date.parse(db.updated) < 3600e3) { console.log('Refreshed less than an hour ago; skipping (FORCE=1 to run now).'); return; }
  const r = await fetch(API, { headers:{ 'User-Agent':'TarkovWaypoint-steamnews/1.0 (personal fan project)' }, signal:AbortSignal.timeout(25000) });
  if (!r.ok) { console.log('Steam news: HTTP ' + r.status + '; leaving the file alone.'); return; }
  const items = buildItems((await r.json()).appnews.newsitems);
  if (!items.length) { console.log('Steam news: no official posts found; leaving the file alone.'); return; }
  writeFileSync(OUT, JSON.stringify({ updated:new Date().toISOString(), app:APP, items }, null, 1) + '\n');
  console.log(`Wrote ${items.length} post(s); newest: ${items[0].title} (${items[0].date}).`);
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
