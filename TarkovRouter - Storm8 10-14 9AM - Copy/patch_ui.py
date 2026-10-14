"""UI clean-up + quest backup for raid-route_3.html (run LAST, after patch_chain.py).

  * Pop-ups you get when you click a route pin (and the hover labels) are dark with high contrast.
  * The "N stops / distance on foot / distance to extract" strip at the top of the right panel is removed
    (quest route and key route).
  * The "Spawn as PMC / Scav" option is removed. Routes always end at the nearest PMC exit. Scav exits can
    still be shown on the map with the tick box in the Legend.
  * The Rare items marker is a teal gem instead of a gold star (gold looked like the numbered route stops).
  * Quest backup: a "Backup" button next to "Paste a list".
      - Choose a folder (Chrome / Edge) and the page keeps RaidRoute-quests.txt in it up to date
        (one quest title per line) every time you add or remove a quest.
      - "Download .txt" works in every browser. "Import .txt" / "Restore from folder" bring the quests back.
      - If the quest list is ever empty and a backup folder is set up, a "Restore from backup" bar shows
        at the top of the left panel.
      - An empty list never overwrites the backup file.

Usage:  python patch_ui.py raid-route_work.html
(A backup is saved as <file>.ui.bak.)
"""
import re
import shutil
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "raid-route_work.html"

JS = r"""/* ============ ui clean-up + quest backup ============ */
(function wireUi(){
  /* ---- rare item gem (inline SVG, so no extra files) ---- */
  const GEM_SVG = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>" +
    "<path d='M6.5 3h11L22 9.2 12 21 2 9.2z' fill='#27e0c3' stroke='#07100e' stroke-width='1.6' stroke-linejoin='round'/>" +
    "<path d='M2 9.2h20M9 3 6.8 9.2 12 21l5.2-11.8L15 3' fill='none' stroke='#eafffb' stroke-opacity='.9' stroke-width='1' stroke-linejoin='round'/></svg>";
  const GEM = 'url("data:image/svg+xml,' + encodeURIComponent(GEM_SVG) + '")';

  const st = document.createElement('style');
  st.textContent = `
/* dark pop-ups */
.leaflet-popup-content-wrapper{background:#141c1a;color:#efeadb;border:1px solid #46625f;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.65)}
.leaflet-popup-tip{background:#141c1a;box-shadow:none}
.leaflet-popup-content{margin:11px 14px;color:#efeadb;font-size:13px;line-height:1.4}
.leaflet-popup-content{scrollbar-width:thin;scrollbar-color:#58736f #141c1a}
.leaflet-popup-content::-webkit-scrollbar{width:8px}.leaflet-popup-content::-webkit-scrollbar-track{background:#141c1a}.leaflet-popup-content::-webkit-scrollbar-thumb{background:#58736f;border-radius:4px}
.leaflet-container a.leaflet-popup-close-button{color:#b9c8c3;font-size:20px;top:4px;right:5px}
.leaflet-container a.leaflet-popup-close-button:hover{color:var(--accent)}
.leaflet-popup .pop b{font-weight:600;font-size:14px}
.leaflet-popup .pop .pi{font-size:13px}
.leaflet-popup .pop .pi + .pi{border-top:1px solid #2f4543;padding-top:7px;margin-top:8px}
.leaflet-popup .pop .pi button{background:#25332f;color:#efeadb;border:1px solid #4d6b67;border-radius:4px}
.leaflet-popup .pop .pi button:hover{border-color:var(--accent);color:var(--accent)}
.leaflet-popup .pop .muted{color:#b3c2bd}
.leaflet-popup .pop .tag{color:#c3d0cb;border-color:#58736f}
.leaflet-popup .pop .tag.opt{color:#f0cf7a;border-color:#8a7435}
.leaflet-popup .pop .fir{color:#f0cf7a;border-color:#8a7435}
.leaflet-popup .pop .rq .rv{opacity:1;color:#c9d6d1}
.leaflet-popup .lootpop .lg{opacity:1;color:#b3c2bd}
.leaflet-popup .lootpop .lti em{color:#5fdcec}
.leaflet-popup .lootpop .note{opacity:1;color:#a9b9b3}
.leaflet-popup .fullq{background:rgba(181,123,224,.18);border-left-color:#c79bf0}
.leaflet-popup .fullq li.done{opacity:.6}
.leaflet-popup .cont{background:rgba(181,123,224,.18)}
.leaflet-tooltip{background:#141c1a;color:#efeadb;border:1px solid #46625f;box-shadow:0 4px 12px rgba(0,0,0,.55)}
.leaflet-tooltip-top:before{border-top-color:#46625f}.leaflet-tooltip-bottom:before{border-bottom-color:#46625f}
.leaflet-tooltip-left:before{border-left-color:#46625f}.leaflet-tooltip-right:before{border-right-color:#46625f}

/* rare item gem */
.lootm.rare span{background:${GEM} center/contain no-repeat;border:0;box-shadow:none;border-radius:0;font-size:0;color:transparent;width:22px;height:22px;margin:-2px;
  filter:drop-shadow(0 0 1.5px #000) drop-shadow(0 1px 2px rgba(0,0,0,.7))}
#legend .sw i.lt.rare{background:${GEM} center/contain no-repeat;border:0;box-shadow:none;border-radius:0;font-size:0;color:transparent;width:17px;height:17px}

/* quest backup */
#bkBtn.warn{border-color:#d4b25f;color:#f0cf7a}
#bkDlg{width:min(540px,94vw)}
#bkDlg .bk-sec{margin:12px 0 0;padding-top:10px;border-top:1px solid var(--line)}
#bkDlg .bk-sec>b{font:600 16px var(--f-head);letter-spacing:.02em}
#bkDlg .bk-state{margin:4px 0 0}
#bkDlg .bk-state.ok{color:var(--ok)}
#bkDlg .bk-state.warn{color:#f0cf7a}
#bkDlg .bk-state.bad{color:var(--bad)}
#bkBanner{display:flex;gap:8px;align-items:center;justify-content:space-between;background:#2a2515;border-bottom:1px solid var(--accent)}
`;
  document.head.appendChild(st);

  /* ---- route summary strip is gone (removed from the page by patch_ui.py) ---- */

  /* pop-ups pan the map so they never sit under the floor buttons (top) or the Legend (right) */
  L.Popup.mergeOptions({ autoPanPaddingTopLeft:[16, 64], autoPanPaddingBottomRight:[290, 16] });
  /* ...and a tall pop-up (e.g. the full-quest list) is capped to the room above its pin and scrolls inside */
  L.Map.addInitHook(function(){
    this.on('popupopen', e => {
      const pop = e.popup, c = pop && pop._contentNode, ll = pop && pop.getLatLng && pop.getLatLng(); if(!c || !ll) return;
      const room = Math.max(170, Math.min(480, this.latLngToContainerPoint(ll).y - 64 - 36));
      c.style.maxHeight = room + 'px'; c.style.overflowY = 'auto'; pop.update();
    });
  });

  /* ---- no "Spawn as": always PMC. The legend decides which exits are drawn ---- */
  if(S.opts.faction === 'scav'){ delete S.opts.showPmcEx; delete S.opts.showScavEx; }
  S.opts.faction = 'pmc'; saveOpts();
  document.querySelectorAll('#lgEx small').forEach(n => { n.textContent = 'Orange exits are open to both PMC and Scav, so they show with either.'; });   /* legend note used to mention "Spawn as" */
  { const f = $('#optFac'), pill = f && f.closest('.pill');
    if(pill) pill.style.display = 'none';                       /* the element stays (other code reads it) but nobody sees it */
    else if(f && f.closest('label')) f.closest('label').style.display = 'none'; }

  /* ================= quest backup ================= */
  const FILE = 'RaidRoute-quests.txt';
  const canFolder = typeof window.showDirectoryPicker === 'function';
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}   /* ask the browser not to evict our data */

  const kv = (mode, fn) => new Promise((res, rej) => {
    let r; try{ r = indexedDB.open('rr_backup', 1); }catch(e){ return rej(e); }
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      try{
        const tx = r.result.transaction('kv', mode), q = fn(tx.objectStore('kv'));
        tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error);
      }catch(e){ rej(e); }
    };
  });

  let dir = null, state = canFolder ? 'none' : 'unsupported', stateMsg = '', lastSaved = null;
  const titles = () => [...S.active].map(id => { const t = S.tasks.find(x => x.id === id); return t && t.name; }).filter(Boolean);
  const textOf = list => list.join('\r\n') + '\r\n';
  const setState = (s, msg) => { state = s; stateMsg = msg || ''; paint(); };

  async function perm(ask){
    if(!dir) return false;
    const o = { mode:'readwrite' };
    try{
      if((await dir.queryPermission(o)) === 'granted') return true;
      if(ask && (await dir.requestPermission(o)) === 'granted') return true;
    }catch(e){}
    return false;
  }
  async function writeNow(ask){
    if(!dir) return false;
    const list = titles();
    if(!list.length) return false;                              /* an empty list never replaces the backup */
    if(!(await perm(ask))){ setState('needs'); return false; }
    try{
      const fh = await dir.getFileHandle(FILE, { create:true });
      const w = await fh.createWritable(); await w.write(textOf(list)); await w.close();
      lastSaved = new Date(); setState('ok'); return true;
    }catch(e){ setState('error', e && e.message || String(e)); return false; }
  }
  /* every add / remove goes through saveActive -> LS.set('rr_active'), so hook there */
  { const _set = LS.set; let tm = 0;
    LS.set = function(k){
      const r = _set.apply(this, arguments);
      if(k === 'rr_active' && dir){ clearTimeout(tm); tm = setTimeout(() => writeNow(false), 500); }
      return r;
    }; }

  /* ---- import (shared by file import and folder restore) ---- */
  function importText(text){
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim()).filter(l => l && !l.startsWith('#'));
    const keep = S.opts.kappaOnly; S.opts.kappaOnly = false;    /* match against ALL quests, not just the Kappa ones */
    const miss = []; let added = 0, already = 0;
    try{
      lines.forEach(l => {
        const t = matchTask(l);
        if(!t) miss.push(l); else if(S.active.has(t.id)) already++; else { S.active.add(t.id); added++; }
      });
    } finally { S.opts.kappaOnly = keep; }
    saveActive(); refresh();
    return { added, already, miss, total:lines.length };
  }
  const report = r => r.total === 0 ? 'The file has no quest titles in it.'
    : 'Added ' + r.added + (r.already ? ', ' + r.already + ' already in your list' : '') + '.' +
      (r.miss.length ? ' Could not match ' + r.miss.length + ': ' + r.miss.slice(0, 5).join('; ') + (r.miss.length > 5 ? '; ...' : '') + '. (Wrong game mode? PvP and PvE have different quests.)' : '');

  /* ---- dialog + button ---- */
  $('#clearAll').insertAdjacentHTML('beforebegin', '<button id="bkBtn" title="Save your quest list to a .txt file you can import later">Backup</button>');
  document.body.insertAdjacentHTML('beforeend',
    '<dialog id="bkDlg"><h2>Back up my quests</h2>' +
    '<p class="muted" style="margin:0">Your quest list lives in this browser only. Clearing browser data, switching browsers or opening the page from a different place loses it. ' +
    'A backup is a plain .txt file with one quest title per line.</p>' +
    '<div class="bk-sec" id="bkFolderSec"><b>Automatic backup to a folder</b>' +
    '<div class="muted" style="margin-top:2px">Pick a folder (a cloud-synced one such as OneDrive or Dropbox is ideal). The page keeps <b>' + FILE + '</b> in it up to date whenever you add or remove a quest.</div>' +
    '<div class="bk-state muted" id="bkState"></div>' +
    '<div class="row"><button id="bkPick" class="primary">Choose folder…</button><button id="bkReconnect">Reconnect</button><button id="bkRestore">Restore from folder</button></div></div>' +
    '<div class="bk-sec"><b>Manual copy</b><div class="muted" style="margin-top:2px">Works in every browser.</div>' +
    '<div class="row"><button id="bkDownload">Download .txt</button><button id="bkImport">Import .txt…</button></div>' +
    '<input type="file" id="bkFile" accept=".txt,text/plain" hidden></div>' +
    '<p id="bkOut" class="muted" style="margin:10px 0 0"></p>' +
    '<div class="row" style="justify-content:flex-end"><button id="bkClose">Close</button></div></dialog>');
  const dlg = $('#bkDlg'), out = t => { $('#bkOut').textContent = t || ''; };

  function paint(){
    const btn = $('#bkBtn'), sec = $('#bkFolderSec'); if(!btn) return;
    btn.textContent = 'Backup' + (state === 'ok' ? ' \u2713' : state === 'needs' || state === 'error' ? ' \u26a0' : '');
    btn.classList.toggle('warn', state === 'needs' || state === 'error');
    btn.title = state === 'ok' ? 'Auto-backup is on' : state === 'needs' ? 'Backup folder needs your permission again - click to reconnect' : 'Save your quest list to a .txt file you can import later';
    const el = $('#bkState'); if(!el) return;
    const m = {
      unsupported:['This browser cannot write to a folder. Use Chrome or Edge for automatic backup, or use the manual copy below.', ''],
      none:['No folder chosen yet.', ''],
      ok:['On: ' + (dir ? dir.name : '') + '/' + FILE + (lastSaved ? ' (saved ' + lastSaved.toLocaleTimeString() + ')' : ''), 'ok'],
      needs:['Folder "' + (dir ? dir.name : '') + '" is chosen but the browser wants your OK again for this visit. Click Reconnect.', 'warn'],
      error:['Could not write to the folder: ' + stateMsg, 'bad']
    }[state] || ['', ''];
    el.textContent = m[0]; el.className = 'bk-state ' + (m[1] || 'muted');
    $('#bkPick').style.display = canFolder ? '' : 'none';
    $('#bkReconnect').style.display = state === 'needs' || state === 'error' ? '' : 'none';
    $('#bkRestore').style.display = dir ? '' : 'none';
    if(!canFolder) $('#bkPick').closest('.row').style.display = 'none';
    banner();
  }

  /* bar at the top of the left panel when the list is empty and a backup folder exists */
  function banner(){
    const box = $('#quests'); if(!box) return;
    let b = $('#bkBanner');
    const want = !S.active.size && dir && S.tasks.length;
    if(!want){ if(b) b.remove(); return; }
    if(!b){
      box.insertAdjacentHTML('afterbegin', '<div class="listbox" id="bkBanner"><span>Your quest list is empty. A backup folder is set up.</span><button class="primary" id="bkBannerGo">Restore</button></div>');
    }
  }
  { const _rq = renderQuests; renderQuests = function(){ _rq(); banner(); }; }
  $('#quests').addEventListener('click', e => { if(e.target.closest('#bkBannerGo')) restore(); });

  async function restore(){
    if(!dir) return;
    if(!(await perm(true))){ setState('needs'); out('Permission was not granted.'); return; }
    try{
      const f = await (await dir.getFileHandle(FILE)).getFile();
      const r = importText(await f.text()); out(report(r));
    }catch(e){ out('No ' + FILE + ' found in "' + dir.name + '".'); }
    paint();
  }

  $('#bkBtn').addEventListener('click', () => { out(''); paint(); dlg.showModal(); });
  $('#bkClose').addEventListener('click', () => dlg.close());
  $('#bkPick').addEventListener('click', async () => {
    try{
      const h = await window.showDirectoryPicker({ id:'raidroute-backup', mode:'readwrite' });
      dir = h; try{ await kv('readwrite', s => s.put(h, 'dir')); }catch(e){}
      if(S.active.size){ const ok = await writeNow(true); out(ok ? 'Saved ' + S.active.size + ' quests to ' + FILE + '.' : ''); }
      else { setState('ok'); try{ await dir.getFileHandle(FILE); out('Found an existing ' + FILE + ' in this folder. Press "Restore from folder" to load it.'); }catch(e){ out('Folder set. It will be filled as soon as you add quests.'); } }
    }catch(e){ if(e && e.name !== 'AbortError') setState('error', e.message || String(e)); }
    paint();
  });
  $('#bkReconnect').addEventListener('click', async () => {
    if(await perm(true)){ lastSaved = lastSaved; setState('ok'); if(S.active.size) await writeNow(false); out('Reconnected.'); } else out('Permission was not granted.');
  });
  $('#bkRestore').addEventListener('click', restore);
  $('#bkDownload').addEventListener('click', () => {
    const list = titles(); if(!list.length){ out('Nothing to save: your quest list is empty.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([textOf(list)], { type:'text/plain;charset=utf-8' })); a.download = FILE;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    out('Saved ' + list.length + ' quest titles as ' + FILE + ' (check your Downloads folder).');
  });
  $('#bkImport').addEventListener('click', () => $('#bkFile').click());
  $('#bkFile').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if(!f) return;
    out(report(importText(await f.text())));
  });

  /* remembered folder from an earlier visit */
  if(canFolder) kv('readonly', s => s.get('dir')).then(async h => {
    if(!h) return; dir = h;
    setState((await perm(false)) ? 'ok' : 'needs');
  }).catch(() => {});
  paint();
})();

"""

with open(path, encoding="utf-8") as f:
    src = f.read()
if "wireUi" in src:
    print("UI clean-up already applied - skipping.")
    sys.exit(0)
marker = "/* ============ wiring ============ */"
if src.count(marker) != 1:
    sys.exit("Could not patch: wiring marker not found exactly once. Is this the right HTML file?")
for needed in ("function matchTask(", "function renderQuests", "wireLoot", "wireKappa", "wireChain" if False else "wireTransits", 'id="optFac"', 'id="clearAll"'):
    if needed not in src:
        sys.exit("Could not patch: missing " + needed + " - run the earlier patches first (this one goes last, after patch_chain.py).")

# remove the stops / distance strip from the right panel
strip = re.compile(r'[ \t]*html \+= `<div class="statline">[^\n]*\n')
if len(strip.findall(src)) != 1:
    sys.exit("Could not remove the route summary strip: expected text not found exactly once.")
src = strip.sub("", src)

# the Key route panel has the same strip (locks / stops / on foot / to exit)
kstrip = re.compile(r"""[ \t]*h \+= '<div class="statline">[^\n]*\n[ \t]*\(r\.exit \? '<div><b>'[^\n]*\n""")
if len(kstrip.findall(src)) != 1:
    sys.exit("Could not remove the key route summary strip: expected text not found exactly once.")
src = kstrip.sub("", src)

shutil.copyfile(path, path + ".ui.bak")
with open(path, "w", encoding="utf-8") as f:
    f.write(src.replace(marker, JS + marker))
print("Patched", path, "(backup:", path + ".ui.bak)")
