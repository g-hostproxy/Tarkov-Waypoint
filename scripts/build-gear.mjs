// Builds data/gear.json for the site's "Meta gear" tool: armor, rigs, helmets, backpacks, stims, guns and weapon attachments,
// with current PvP flea prices and the stats players compare. It asks api.tarkov.dev from here (the Action), so the browser never has to.
// The API's field names change now and then, so a field it no longer knows is dropped and the query is retried; a category that
// cannot be read at all is skipped and logged. Exits non-zero (and writes nothing) only if nothing at all could be read.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const OUT = 'data/gear.json';
const API = process.env.TARKOV_API || 'https://api.tarkov.dev/graphql';   // TARKOV_API is a test hook
const sleep = ms => new Promise(r => setTimeout(r, ms));

const BASE = 'id name shortName weight avg24hPrice lastLowPrice types category { name } buyFor { vendor { normalizedName } priceRUB }';
const WMOD = { on: 'ItemPropertiesWeaponMod', fields: ['ergonomics', 'recoilModifier', 'accuracyModifier'] };
const GEAR = ['class', 'durability', 'ergoPenalty', 'speedPenalty', 'turnPenalty'];
/* tab = what the site shows it under; type = tarkov.dev's ItemType filter */
const JOBS = [
  { tab: 'armor',  type: 'armor',       frags: [{ on: 'ItemPropertiesArmor', fields: GEAR.concat(['zones']) }] },
  { tab: 'plates', type: 'armorPlate',  frags: [{ on: 'ItemPropertiesArmorAttachment', fields: GEAR }] },
  { tab: 'rigs',   type: 'rig',         frags: [{ on: 'ItemPropertiesChestRig', fields: GEAR.concat(['capacity']) }] },
  { tab: 'helmets', type: 'helmet',     frags: [{ on: 'ItemPropertiesHelmet', fields: GEAR.concat(['ricochetY', 'deafening']) }] },
  { tab: 'backpacks', type: 'backpack', frags: [{ on: 'ItemPropertiesBackpack', fields: ['capacity', 'ergoPenalty', 'speedPenalty', 'turnPenalty'] }] },
  { tab: 'stims',  type: 'injectors',   frags: [{ on: 'ItemPropertiesStim', fields: ['useTime', 'cures', 'stimEffects { type value duration delay }'] }] },
  { tab: 'guns',   type: 'gun',         frags: [{ on: 'ItemPropertiesWeapon', fields: ['caliber', 'ergonomics', 'recoilVertical', 'recoilHorizontal', 'fireRate'] }] },
  { tab: 'suppressors', type: 'suppressor', frags: [WMOD, { on: 'ItemPropertiesBarrel', fields: ['ergonomics', 'recoilModifier'] }] },
  { tab: 'mods',   type: 'mods',        frags: [WMOD, { on: 'ItemPropertiesScope', fields: ['ergonomics', 'zoomLevels', 'sightModes'] }, { on: 'ItemPropertiesMagazine', fields: ['capacity', 'ergonomics'] }] },
];

async function post(query) {
  let last = '';
  for (let i = 1; i <= 5; i++) {
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'TarkovWaypoint-data-build' }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(90_000) });
      const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
      if (j) return j;
      last = `HTTP ${r.status} ${txt.slice(0, 120)}`;
    } catch (e) { last = String(e.message || e); }
    await sleep(4000 * i);
  }
  throw new Error(last);
}
const queryOf = (type, frags) => `query { items(type: ${type}) { ${BASE}${frags.length ? ` properties { ${frags.map(f => `... on ${f.on} { ${f.fields.join(' ')} }`).join(' ')} }` : ''} } }`;

/* run one job; when the API says it does not know a field / type, remove it and try again */
async function runJob(job) {
  const frags = job.frags.map(f => ({ on: f.on, fields: f.fields.slice() }));
  for (let i = 0; i < 12; i++) {
    const j = await post(queryOf(job.type, frags.filter(f => f.fields.length)));
    const errs = (j.errors || []).map(e => String(e.message || ''));
    if (j.data && Array.isArray(j.data.items) && !errs.length) return j.data.items;
    let changed = false;
    for (const m of errs) {
      let x;
      if ((x = /Cannot query field "(\w+)" on type "(\w+)"/.exec(m))) {
        const [, fld, on] = x;
        frags.forEach(f => { const n = f.fields.length; f.fields = f.fields.filter(s => !new RegExp(`^${fld}\\b`).test(s)); if (f.on === on && f.fields.length !== n) changed = true; });
        if (!changed) frags.forEach(f => { f.fields = f.fields.map(s => { const t = s.replace(new RegExp(`\\b${fld}\\b`), '').replace(/\{\s+/, '{ '); if (t !== s) changed = true; return t; }); });   // a nested field
      } else if ((x = /Unknown type "(\w+)"/.exec(m))) {
        const k = frags.findIndex(f => f.on === x[1]); if (k >= 0) { frags.splice(k, 1); changed = true; }
      } else if (/does not exist in "ItemType" enum|Expected type "?ItemType/i.test(m)) { throw new Error('this item type is not known to the API'); }
    }
    if (!changed) {
      if (j.data && Array.isArray(j.data.items)) return j.data.items;   // errors we cannot fix, but there is data
      throw new Error(errs[0] || 'no data');
    }
  }
  throw new Error('gave up removing unknown fields');
}

const num = v => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 1000) / 1000 : undefined;
function compact(tab, it) {
  const noFlea = (it.types || []).includes('noFlea');
  const flea = noFlea ? 0 : (it.avg24hPrice || it.lastLowPrice || 0);
  const tr = (it.buyFor || []).filter(b => b && b.vendor && !/flea/i.test(b.vendor.normalizedName || '')).map(b => b.priceRUB || 0).filter(Boolean).sort((a, b) => a - b)[0] || 0;
  const p = {}; const pr = it.properties || {};
  for (const k of Object.keys(pr)) { const v = pr[k]; if (v == null) continue; if (typeof v === 'number') p[k] = num(v); else if (Array.isArray(v) || typeof v === 'string') p[k] = v; }
  return { i: it.id, n: it.name, s: it.shortName, t: tab, c: (it.category && it.category.name) || '', w: num(it.weight) || 0, f: flea, r: tr, p };
}

const items = []; const done = {}, failed = {};
for (const job of JOBS) {
  try {
    const list = await runJob(job);
    const rows = list.filter(it => it && it.id && it.name).map(it => compact(job.tab, it));
    done[job.tab] = rows.length; rows.forEach(r => items.push(r));
    console.log(`${job.tab}: ${rows.length}`);
  } catch (e) { failed[job.tab] = String(e.message || e).slice(0, 160); console.log(`${job.tab}: skipped (${failed[job.tab]})`); }
}
if (!items.length) { console.error('Could not read any gear from the API.'); process.exit(1); }

/* the same item can come back under two jobs (a suppressor is also a mod): keep the first */
const seen = new Set(); const uniq = items.filter(r => { if (r.t === 'mods' && seen.has(r.i)) return false; seen.add(r.i); return true; });

let same = false;
if (existsSync(OUT)) { try { same = JSON.stringify(JSON.parse(readFileSync(OUT, 'utf8')).items) === JSON.stringify(uniq); } catch {} }
if (same) { console.log('No change.'); process.exit(0); }
mkdirSync('data', { recursive: true });
writeFileSync(OUT, JSON.stringify({ t: Date.now(), n: uniq.length, done, failed, items: uniq }) + '\n');
console.log(`Wrote ${OUT}: ${uniq.length} items.`);
