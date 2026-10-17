// Pulls the current quest list from api.tarkov.dev using the site's own query code (index.html -> RR_LIVE.pull()),
// and writes data/quests.json. Retries, because the API is flaky. Exits non-zero (and writes nothing) if it never works.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = 'data/quests.json';
const TRIES = 8, WAIT_MS = 90_000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
let tasks = null, lastErr = '';
for (let i = 1; i <= TRIES && !tasks; i++) {
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(resolve('index.html')).href, { waitUntil: 'load' });
    await page.waitForFunction(() => window.RR_LIVE && typeof RR_LIVE.pull === 'function', null, { timeout: 60_000 });
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
