const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const MAPS = { 'factory':'Factory', 'customs':'Customs', 'woods':'Woods', 'shoreline':'Shoreline', 'reserve':'Reserve', 'lighthouse':'Lighthouse', 'interchange':'Interchange', 'streets-of-tarkov':'Streets of Tarkov', 'ground-zero':'Ground Zero', 'the-lab':'The Lab', 'the-labyrinth':'The Labyrinth', 'icebreaker':'Icebreaker', 'terminal':'Terminal' };
const I = { link:'<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>', doc:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>', img:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>' };
const ic = (k, cls) => '<div class="ic ' + cls + '"><svg viewBox="0 0 24 24">' + I[k] + '</svg></div>';
function fmtMin(ms){ const m = Math.max(0, Math.floor(ms / 60000)); return m + ' min'; }
function draw(s){
  $('ver').textContent = 'v' + s.version + ' · ALPHA';
  const u = $('upd'); u.hidden = s.update.state === 'idle';
  if(!u.hidden){ u.innerHTML = s.update.state === 'ready' ? '<div class="g"><b>Update ' + esc(s.update.version) + ' is ready</b><br><small class="m">Restart to finish installing</small></div><button class="sm" id="inst">Restart</button>' : '<div class="g"><b>Downloading update ' + esc(s.update.version) + '…</b></div>'; if($('inst')) $('inst').onclick = () => rr.install(); }
  const st = s.state || {}, ph = st.phase || 'idle', map = MAPS[st.map] || '';
  const title = { idle:'Waiting for a raid', loading:'Loading into ' + (map || '…'), raid:'In raid on ' + (map || '…'), ended:'Raid finished' }[ph] || 'Waiting for a raid';
  const chips = [];
  if(st.earnedToday) chips.push('<span class="chip">Earned today <b>₽' + Number(st.earnedToday).toLocaleString() + '</b></span>');
  if(s.lastQuest) chips.push('<span class="chip">Last quest <b>' + esc(s.lastQuest.status) + '</b></span>');
  $('hero').className = 'hero ' + ph;
  $('hero').innerHTML = '<small>Right now</small><h2>' + esc(title) + '</h2>' + (chips.length ? '<div class="chips">' + chips.join('') + '</div>' : '<small style="text-transform:none;letter-spacing:0">Start Tarkov and this fills in by itself.</small>');
  $('linkCard').innerHTML = '<div class="card">' + ic('link', 'ok') + '<div class="g"><b>Tarkov Waypoint window is linked</b><br><small class="m">Quests you start, finish or fail in the game tick on their own.</small></div></div>' +
    (s.linked > 1 || (s.linked === 1 && false) ? '' : '') +
    '<div class="card">' + ic('link', '') + '<div class="g"><b>Use it in your browser too</b><br><small class="m">Open Tarkov Waypoint in Chrome, go to Tools, Desktop app, and type this code.</small><div class="code">' + esc(s.code) + '</div></div></div>';
  $('gameCard').innerHTML = '<div class="card">' + ic('doc', s.logsFound ? 'ok' : 'warn') + '<div class="g"><b>' + (s.logsFound ? 'Game logs found' : 'Game folder not found') + '</b><code>' + esc(s.gameDir || 'Not set') + '</code>' + (s.logsFound ? '' : '<small class="m">Pick the Escape from Tarkov folder, the one that has a <b>Logs</b> folder.</small>') + '</div><button class="sm" id="pg">Change</button></div>';
  $('shotCard').innerHTML = '<div class="card">' + ic('img', s.shotsFound ? 'ok' : 'warn') + '<div class="g"><b>' + (s.shotsFound ? 'Screenshot folder linked' : 'Screenshot folder not found') + '</b><code>' + esc(s.shotsDir || 'Not set') + '</code>' + (s.shotsFound ? '' : '<small class="m">The game creates it after your first screenshot. Take one in Tarkov, then it appears here.</small>') + '</div><button class="sm" id="ps">Change</button></div>';
  $('pg').onclick = () => rr.pick('game'); $('ps').onclick = () => rr.pick('shots');
  $('tray').checked = s.keepInTray !== false;
  $('foot').textContent = s.siteUrl ? s.siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
}
$('open').onclick = () => rr.openSite();
rr.status().then(draw); rr.onStatus(draw); rr.config().then(c => { $('startup').checked = c.startWithWindows; $('tray').checked = c.keepInTray; });
$('startup').onchange = e => rr.startup(e.target.checked);
$('tray').onchange = e => rr.tray(e.target.checked);
setInterval(() => rr.status().then(draw), 3000);
