const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const MAPS = { 'factory':'Factory', 'customs':'Customs', 'woods':'Woods', 'shoreline':'Shoreline', 'reserve':'Reserve', 'lighthouse':'Lighthouse', 'interchange':'Interchange', 'streets-of-tarkov':'Streets of Tarkov', 'ground-zero':'Ground Zero', 'the-lab':'The Lab', 'the-labyrinth':'The Labyrinth', 'icebreaker':'Icebreaker', 'terminal':'Terminal' };
function draw(s){
  $('upd').hidden = s.update.state === 'idle';
  if(s.update.state !== 'idle') $('upd').innerHTML = s.update.state === 'ready' ? '<div class="row"><div class="g"><b>Update ' + esc(s.update.version) + ' is ready</b></div><button id="inst">Restart to update</button></div>' : '<b>Downloading update ' + esc(s.update.version) + '…</b>';
  if($('inst')) $('inst').onclick = () => rr.install();
  $('linkCard').innerHTML = s.linked
    ? '<div class="row"><span class="dot ok"></span><div class="g"><b>Raid Route is connected</b><br><small>Your quests and the Play page now follow the game.</small></div></div>'
    : '<b>Link to the Raid Route website</b><div class="mute" style="margin-top:2px">Open Raid Route, press <b>Play</b> and type this code. You only do this once.</div><div class="code">' + esc(s.code) + '</div>';
  $('gameCard').innerHTML = '<div class="row"><span class="dot ' + (s.logsFound ? 'ok' : '') + '"></span><div class="g"><b>' + (s.logsFound ? 'Game logs found' : 'Game folder not found') + '</b><br><code>' + esc(s.gameDir || 'Not set') + '</code>' + (s.logsFound ? '' : '<br><small>Pick the Escape from Tarkov folder, the one that contains a <b>Logs</b> folder.</small>') + '</div><button id="pg">Change</button></div>';
  $('shotCard').innerHTML = '<div class="row"><span class="dot ' + (s.shotsFound ? 'ok' : '') + '"></span><div class="g"><b>' + (s.shotsFound ? 'Screenshot folder linked' : 'Screenshot folder not found') + '</b><br><code>' + esc(s.shotsDir || 'Not set') + '</code>' + (s.shotsFound ? '' : '<br><small>The game creates it after your first screenshot. Take one in Tarkov (Print Screen by default, or the key you bound), then it appears here by itself.</small>') + '</div><button id="ps">Change</button></div>';
  const st = s.state, live = [];
  live.push('<b>' + ({ idle:'Waiting for a raid', loading:'Loading into ' + (MAPS[st.map] || '…'), raid:'In raid on ' + (MAPS[st.map] || '…'), ended:'Raid finished' }[st.phase] || '') + '</b>');
  if(st.server) live.push('<span class="pill">Server ' + esc(st.server.ip) + '</span>');
  if(st.earnedToday) live.push('<span class="pill">Earned today ₽' + st.earnedToday.toLocaleString() + '</span>');
  if(s.lastQuest) live.push('<div class="mute" style="margin-top:6px">Last quest event: ' + esc(s.lastQuest.status) + '</div>');
  $('liveCard').innerHTML = live.join(' ');
  $('pg').onclick = () => rr.pick('game'); $('ps').onclick = () => rr.pick('shots');
}
rr.status().then(draw); rr.onStatus(draw); rr.config().then(c => { $('startup').checked = c.startWithWindows; });
$('startup').onchange = e => rr.startup(e.target.checked);
setInterval(() => rr.status().then(draw), 3000);
