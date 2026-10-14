"""Add the key route system to raid-route_3.html.

Usage:  python patch_keys.py raid-route_3.html
(Run patch_app.py and patch_prep.py first. A backup is saved as <file>.keys.bak.)
"""
import shutil
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "raid-route_3.html"

JS = r"""/* ============ key routes ============ */
S.locks = S.locks || {};
S.myKeys = new Set(LS.get('rr_keys', []));
const saveKeys = () => LS.set('rr_keys', [...S.myKeys]);
const KCOL = '#4fd1e0';
const KEY_CSS = `
#keysBtn{white-space:nowrap}
#keysDlg{width:min(700px,94vw)}
#keysDlg[open]{display:flex;flex-direction:column;max-height:88vh}
#keysDlg .kh{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
#keysDlg .kh h2{margin:0}
#keysDlg .ktools{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
#keysDlg .ktools input[type=text]{flex:1;min-width:160px;background:var(--bg);border:1px solid var(--line);border-radius:5px;padding:7px 10px}
#keysDlg select{background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:5px;padding:6px}
#kBody{overflow-y:auto;min-height:0;flex:1;margin:6px 0;padding-right:4px}
label.kr{display:flex;gap:9px;align-items:flex-start;padding:6px 4px;border-bottom:1px solid var(--line);cursor:pointer}
label.kr:hover{background:var(--panel2)}
label.kr input{margin-top:4px}
label.kr b{font-weight:600;margin-right:6px}
label.kr small{display:block;color:var(--mute);font-size:12px;margin-top:1px}
.kstop{background:none;border:0}
.kstop span{display:grid;place-items:center;width:26px;height:26px;border-radius:6px;background:${KCOL};color:#06242a;font:700 15px/1 var(--f-head);border:2px solid #06242a;box-shadow:0 0 0 2px ${KCOL},0 2px 6px #000a}
#keyroute .kr-h{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 6px;border-top:1px solid var(--line)}
#keyroute .kr-h h2{margin:0;font:600 18px var(--f-head);letter-spacing:.02em;color:${KCOL}}
.ksteps .n{background:${KCOL};color:#06242a;border-radius:6px}
`;

function normalizeLocks(raw){
  const out = {};
  (raw || []).forEach(m => {
    const k = canon(m.normalizedName); if(!k || !SVG_FILES[k]) return;
    const arr = out[k] = out[k] || [];
    (m.locks || []).forEach(l => {
      const p = l.position; if(!p || p.x == null || p.z == null || !l.keyId) return;
      if(arr.some(a => a.id === l.id || (a.keyId === l.keyId && Math.abs(a.p.x - p.x) < 1 && Math.abs(a.p.z - p.z) < 1))) return;
      arr.push({ id:l.id, keyId:l.keyId, key:l.key || l.keyId, type:l.type || 'door', power:!!l.power, p:{ x:p.x, y:p.y || 0, z:p.z } });
    });
  });
  return out;
}
{ const _ne = normalizeExtracts; normalizeExtracts = function(raw){ S.locks = normalizeLocks(raw); return _ne(raw); }; }

function keyIndex(){
  const m = new Map();
  Object.keys(S.locks).forEach(mk => S.locks[mk].forEach(l => {
    let e = m.get(l.keyId); if(!e){ e = { id:l.keyId, name:l.key, maps:new Map() }; m.set(l.keyId, e); }
    e.maps.set(mk, (e.maps.get(mk) || 0) + 1);
  }));
  return [...m.values()];
}
function neededKeyNames(){
  const need = new Map();
  [...S.active].map(id => S.byId.get(id)).filter(Boolean).forEach(t => {
    const add = n => { if(!need.has(n)) need.set(n, new Set()); need.get(n).add(t.name); };
    t.objs.filter(o => !S.done.has(o.id) && (S.opts.optional || !o.optional)).forEach(o => o.req && o.req.keys && o.req.keys.forEach(g => g.forEach(add)));
    (t.keys || []).forEach(kk => kk.names.forEach(add));
  });
  return need;
}

const keySigCache = {};
function keyRoute(k){
  const locks = (S.locks[k] || []).filter(l => S.myKeys.has(l.keyId));
  if(!locks.length) return null;
  const sig = k + '|' + locks.map(l => l.id).sort().join(',') + '|' + S.opts.faction;
  if(keySigCache[sig]) return keySigCache[sig];
  const r = buildRoute({ groups:locks.map(l => ({ lock:l, pts:[l.p] })), key:k });
  r.count = locks.length;
  return (keySigCache[sig] = r);
}
const kLine = it => {
  const l = it.g.lock;
  return '<b style="color:#1c6f78">' + esc(l.key) + '</b>' + (l.type === 'trunk' ? 'Trunk / container' : 'Door') + (l.power ? ' · needs power' : '');
};
function drawKeys(){
  const k = S.curMap, map = S.map; S.keyMarkers = [];
  if(!map || !S.layer || S.opts.showKeys === false) return;
  const r = keyRoute(k); if(!r) return;
  const pts = r.stops.map(s => [s.p.z, s.p.x]);
  if(r.exit) L.polyline([pts[pts.length - 1], [r.exit.e.p.z, r.exit.e.p.x]], { color:'#8fe3ee', weight:2, opacity:.7, dashArray:'3 7', interactive:false }).addTo(S.layer);
  if(pts.length > 1) L.polyline(pts, { color:KCOL, weight:3, opacity:.95, dashArray:'4 8', className:'route-line', interactive:false }).addTo(S.layer);
  r.stops.forEach((s, i) => {
    const el = document.createElement('div'); el.className = 'pop';
    el.innerHTML = '<b>Key stop ' + (i + 1) + '</b>' + s.items.map(it => '<div class="pi">' + kLine(it) + '</div>').join('');
    S.keyMarkers.push(L.marker([s.p.z, s.p.x], { icon:L.divIcon({ className:'kstop', html:'<span>' + (i + 1) + '</span>', iconSize:[26, 26] }), zIndexOffset:900 })
      .bindPopup(el).addTo(S.layer));
  });
}
function renderKeyRoute(){
  const box = $('#keyroute'); if(!box) return;
  const k = S.curMap;
  if(S.opts.showKeys === false || !k || !S.tasks.length){ box.innerHTML = ''; return; }
  let h = '<div class="kr-h"><h2>Key route · ' + esc(MAP_LABEL[k] || k) + '</h2><button class="quiet" id="krManage">My keys' + (S.myKeys.size ? ' (' + S.myKeys.size + ')' : '') + '</button></div>';
  const r = S.myKeys.size ? keyRoute(k) : null;
  if(!S.myKeys.size){
    h += '<div class="empty"><b>No keys yet</b>Tick the keys you own and this plans the fastest run past every door and container they open on this map.<div class="row"><button class="primary" id="krAdd">Add my keys</button></div></div>';
  } else if(!r){
    h += '<div class="empty"><b>Nothing on ' + esc(MAP_LABEL[k] || k) + '</b>None of your ' + S.myKeys.size + ' key' + (S.myKeys.size === 1 ? '' : 's') + ' open anything on this map.</div>';
  } else {
    h += '<div class="statline"><div><b>' + r.count + '</b><span>locks</span></div><div><b>' + r.stops.length + '</b><span>stops</span></div><div><b>' + fmt(r.len) + '</b><span>on foot between stops</span></div>' +
      (r.exit ? '<div><b>' + fmt(r.exit.dist) + '</b><span>to ' + esc(r.exit.e.name) + '</span></div>' : '') + '</div>';
    h += '<ol class="steps ksteps">' + r.stops.map((s, i) => {
      const d = i ? dist(r.stops[i - 1].p, s.p) : null;
      return '<li data-i="' + i + '"><span class="n">' + (i + 1) + '</span><div>' + s.items.map(it => '<div class="it">' + kLine(it).replace('color:#1c6f78', 'color:' + KCOL) + '</div>').join('') +
        '<div class="d">' + (d == null ? 'Start here' : fmt(d) + ' from previous stop') + '</div></div></li>';
    }).join('') + (r.exit ? '<li data-x="1"><span class="n x">⇥</span><div><div class="it"><i>Extract: ' + esc(r.exit.e.name) + '</i></div><div class="d">Nearest ' + (S.opts.faction === 'scav' ? 'Scav' : 'PMC') + ' exit to your last stop · ' + fmt(r.exit.dist) + '</div></div></li>' : '') + '</ol>';
  }
  box.innerHTML = h;
  const mg = $('#krManage'), ad = $('#krAdd'); if(mg) mg.addEventListener('click', openKeysDlg); if(ad) ad.addEventListener('click', openKeysDlg);
  box.querySelectorAll('.ksteps li[data-i]').forEach(li => li.addEventListener('click', () => {
    const rt = keyRoute(S.curMap); if(!rt || !S.map) return;
    const s = rt.stops[+li.dataset.i];
    S.map.flyTo([s.p.z, s.p.x], Math.max(S.map.getZoom(), S.fitZoom + 2));
    if(S.keyMarkers && S.keyMarkers[+li.dataset.i]) S.keyMarkers[+li.dataset.i].openPopup();
  }));
  box.querySelectorAll('.ksteps li[data-x]').forEach(li => li.addEventListener('click', () => {
    const rt = keyRoute(S.curMap); if(rt && rt.exit && S.map) S.map.flyTo([rt.exit.e.p.z, rt.exit.e.p.x], S.fitZoom + 2);
  }));
}

let kShowOwned = false, kMap = 'all';
function updateKeysUI(){
  const n = S.myKeys.size;
  const b = $('#keysBtn'); if(b) b.textContent = 'My keys' + (n ? ' (' + n + ')' : '');
  const c = $('#kCount'); if(c) c.textContent = n + ' owned';
}
function renderKeysDlg(){
  const body = $('#kBody'), prev = body.scrollTop;
  const all = keyIndex(), need = neededKeyNames();
  const q = norm($('#kq').value), words = q ? q.split(' ') : [];
  const rows = all.filter(e => words.every(w => norm(e.name).includes(w)) && (kMap === 'all' || e.maps.has(kMap)) && (!kShowOwned || S.myKeys.has(e.id)))
    .sort((a, b) => (need.has(b.name) ? 1 : 0) - (need.has(a.name) ? 1 : 0) || a.name.localeCompare(b.name));
  $('#kNeed').hidden = !need.size;
  updateKeysUI();
  body.innerHTML = !all.length
    ? '<div class="empty"><b>No key location data</b>Rebuild quest_data.json with the latest build_quest_data.py (it needs maps_data.json and items_en.json), then rebuild the page.</div>'
    : (rows.map(e => '<label class="kr"><input type="checkbox" data-k="' + esc(e.id) + '" ' + (S.myKeys.has(e.id) ? 'checked' : '') + '><span><b>' + esc(e.name) + '</b>' +
        (need.has(e.name) ? '<span class="tag opt">needed for your quests</span>' : '') + '<small>' +
        [...e.maps].map(([mk, n]) => esc(MAP_LABEL[mk] || mk) + ' ×' + n).join(' · ') + '</small></span></label>').join('') || '<div class="empty">No keys match.</div>');
  body.scrollTop = prev;
}
function openKeysDlg(){ $('#keysDlg').showModal(); $('#kMsg').textContent = ''; renderKeysDlg(); }
function afterKeysChange(){
  saveKeys(); updateKeysUI(); renderKeyRoute();
  if(S.map) drawOverlay();
}

(function wireKeys(){
  const st = document.createElement('style'); st.textContent = KEY_CSS; document.head.appendChild(st);
  $('#modeSeg').insertAdjacentHTML('beforebegin', '<button id="keysBtn" title="Tell the app which keys you own to plan a key route">My keys</button>');
  $('#route').insertAdjacentHTML('afterend', '<div id="keyroute"></div>');
  $('#fit').insertAdjacentHTML('beforebegin', '<div class="pill"><label><input type="checkbox" id="optQRoute"> Quest route</label><label style="margin-top:4px"><input type="checkbox" id="optKRoute"> Key route</label></div>');
  document.body.insertAdjacentHTML('beforeend',
    '<dialog id="keysDlg"><div class="kh"><h2>My keys</h2><span class="muted" id="kCount"></span></div>' +
    '<p class="muted" style="margin:4px 0 0">Tick the keys you own. The key route visits every door and container they open on the map you are viewing.</p>' +
    '<div class="ktools"><input type="text" id="kq" placeholder="Search keys…" autocomplete="off"><select id="kMapSel" aria-label="Filter by map"></select>' +
    '<label class="muted" style="display:flex;gap:5px;align-items:center"><input type="checkbox" id="kOwned"> only owned</label></div>' +
    '<div class="row" style="margin:0 0 4px"><button id="kNeed" hidden>Add keys my quests need</button><button id="kClear" class="quiet">Clear all</button></div>' +
    '<p class="muted" id="kMsg" style="margin:2px 0"></p><div id="kBody"></div>' +
    '<div class="row" style="justify-content:flex-end;margin-top:0"><button id="kClose" class="primary">Done</button></div></dialog>');
  $('#kMapSel').innerHTML = '<option value="all">All maps</option>' + MAPS.map(m => '<option value="' + m + '">' + esc(MAP_LABEL[m]) + '</option>').join('');
  $('#optQRoute').checked = S.opts.showQuest !== false;
  $('#optKRoute').checked = S.opts.showKeys !== false;
  const redraw = () => { saveOpts(); renderRoute(); renderKeyRoute(); if(S.map) drawOverlay(); };
  $('#optQRoute').addEventListener('change', e => { S.opts.showQuest = e.target.checked; redraw(); });
  $('#optKRoute').addEventListener('change', e => { S.opts.showKeys = e.target.checked; redraw(); });
  $('#keysBtn').addEventListener('click', openKeysDlg);
  $('#kClose').addEventListener('click', () => $('#keysDlg').close());
  $('#kq').addEventListener('input', renderKeysDlg);
  $('#kMapSel').addEventListener('change', e => { kMap = e.target.value; renderKeysDlg(); });
  $('#kOwned').addEventListener('change', e => { kShowOwned = e.target.checked; renderKeysDlg(); });
  $('#kClear').addEventListener('click', () => { if(!S.myKeys.size || !confirm('Remove all keys from your list?')) return; S.myKeys.clear(); afterKeysChange(); renderKeysDlg(); });
  $('#kBody').addEventListener('change', e => {
    const cb = e.target.closest('input[data-k]'); if(!cb) return;
    if(cb.checked) S.myKeys.add(cb.dataset.k); else S.myKeys.delete(cb.dataset.k);
    afterKeysChange();
  });
  $('#kNeed').addEventListener('click', () => {
    const need = neededKeyNames(), byName = new Map(keyIndex().map(e => [norm(e.name), e]));
    let added = 0, miss = 0;
    need.forEach((qs, name) => { const e = byName.get(norm(name)); if(!e) miss++; else if(!S.myKeys.has(e.id)){ S.myKeys.add(e.id); added++; } });
    $('#kMsg').textContent = 'Added ' + added + ' key' + (added === 1 ? '' : 's') + '.' + (miss ? ' ' + miss + ' needed key' + (miss === 1 ? ' has' : 's have') + ' no known door positions, so ' + (miss === 1 ? 'it' : 'they') + ' cannot be routed.' : '') +
      ' Where a quest accepts any of several keys, all of them were added; untick the ones you do not have.';
    afterKeysChange(); renderKeysDlg();
  });
  /* "Zoom to route" fits whichever routes are visible */
  $('#fit').addEventListener('click', () => {
    if(!S.map || !S.an) return;
    const pts = [], a = S.an.A[S.curMap];
    if(S.opts.showQuest !== false && a && a.route){ a.route.stops.forEach(s => pts.push([s.p.z, s.p.x])); if(a.route.exit) pts.push([a.route.exit.e.p.z, a.route.exit.e.p.x]); }
    const kr = S.opts.showKeys !== false ? keyRoute(S.curMap) : null;
    if(kr){ kr.stops.forEach(s => pts.push([s.p.z, s.p.x])); if(kr.exit) pts.push([kr.exit.e.p.z, kr.exit.e.p.x]); }
    if(pts.length) S.map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom:S.fitZoom + 3 });
  });
  /* wrap existing renderers so the quest route can be hidden and the key route added */
  { const _rr = renderRoute;
    renderRoute = function(){
      _rr();
      const box = $('#route');
      if(S.opts.showQuest === false && box){
        box.querySelectorAll('.statline,.steps').forEach(n => n.remove());
        box.insertAdjacentHTML('beforeend', '<div class="listbox muted">Quest route hidden. Turn it back on with “Quest route” on the map.</div>');
      }
      renderKeyRoute();
    }; }
  { const _do = drawOverlay;
    drawOverlay = function(){
      const a = S.an && S.an.A[S.curMap];
      if(a && S.opts.showQuest === false){
        const g = a.groups, r = a.route; a.groups = []; a.route = null;
        try{ _do(); } finally { a.groups = g; a.route = r; }
      } else _do();
      drawKeys();
    }; }
  updateKeysUI();
})();

"""

with open(path, encoding="utf-8") as f:
    src = f.read()
if "wireKeys" in src:
    print("Key route system already applied - skipping."); sys.exit(0)
marker = "/* ============ wiring ============ */"
if src.count(marker) != 1:
    sys.exit("Could not patch: wiring marker not found exactly once. Is this the right HTML file?")
for needed in ("function renderRoute(", "function drawOverlay(", "function normalizeExtracts(", "function buildRoute("):
    if needed not in src:
        sys.exit("Could not patch: missing " + needed + " - run patch_app.py first and use the r4 HTML.")
shutil.copyfile(path, path + ".keys.bak")
with open(path, "w", encoding="utf-8") as f:
    f.write(src.replace(marker, JS + marker))
print("Patched", path, "(backup:", path + ".keys.bak)")
