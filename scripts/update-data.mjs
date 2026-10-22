// Pulls the current quest list from json.tarkov.dev (falling back to api.tarkov.dev) using the site's own query code (index.html -> RR_LIVE.pull()),
// and writes data/quests.json. Retries, because the API is flaky. Exits non-zero (and writes nothing) if it never works.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PVE = process.env.GAME_MODE === 'pve';          // GAME_MODE=pve writes the PvE quest list instead
const OUT = PVE ? 'data/quests-pve.json' : 'data/quests.json';
const UPSTREAM = process.env.TARKOV_UPSTREAM || '';   // test hook only
const TRIES = 8, WAIT_MS = 90_000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
let tasks = null, lastErr = '';
for (let i = 1; i <= TRIES && !tasks; i++) {
  const page = await browser.newPage();
  /* The page runs from a local file, so the browser would block its calls to api.tarkov.dev (CORS).
     Make those calls from here instead and hand the answer back with a permissive CORS header. */
  await page.route(/^https:\/\/api\.tarkov\.dev\//, async route => {
    try {
      const url = UPSTREAM ? route.request().url().replace('https://api.tarkov.dev', UPSTREAM) : route.request().url();
      const res = await route.fetch({ url, timeout: 60_000 });
      if (!res.ok()) console.log(`  api.tarkov.dev answered HTTP ${res.status()}: ${(await res.text()).slice(0, 200)}`);
      await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } });
    } catch (e) {
      console.log('  could not reach api.tarkov.dev: ' + String(e.message || e).split('\n')[0]);
      await route.abort();
    }
  });
  /* keep the page's own start-up check from running its API calls at the same time as ours */
  await page.addInitScript(pve => { try { if (pve) localStorage.setItem('rr_gm', 'pve'); localStorage.setItem('rr_live_meta_v1' + (pve ? '_pve' : ''), JSON.stringify({ t: Date.now(), tryT: Date.now(), n: 0 })); } catch {} }, PVE);
  try {
    await page.goto(pathToFileURL(resolve('index.html')).href, { waitUntil: 'load' });
    await page.waitForFunction(() => window.RR_LIVE && typeof RR_LIVE.pull === 'function', null, { timeout: 60_000 });
    await page.waitForFunction(() => typeof S !== 'undefined' && S.tasks && S.tasks.length > 0, null, { timeout: 60_000 });
    tasks = await page.evaluate(() => RR_LIVE.pull());
  } catch (e) {
    lastErr = String(e.message || e).split('\n')[0];
    console.log(`attempt ${i}/${TRIES} failed: ${lastErr}`);
  }
  await page.close();
  if (!tasks && i < TRIES) await sleep(WAIT_MS);
}
await browser.close();
if (!tasks) { console.error('Could not get quest data: ' + lastErr); process.exit(1); }

const next = JSON.stringify(tasks);
let same = false;
if (existsSync(OUT)) { try { same = JSON.stringify(JSON.parse(readFileSync(OUT, 'utf8')).tasks) === next; } catch {} }
if (same) { console.log(`No change (${tasks.length} quests).`); process.exit(0); }
mkdirSync('data', { recursive: true });
writeFileSync(OUT, JSON.stringify({ t: Date.now(), n: tasks.length, tasks }) + '\n');
console.log(`Wrote ${OUT}: ${tasks.length} quests.`);
