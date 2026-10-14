"""Add the "Pre-raid check" screen to raid-route_3.html.

Usage:  python patch_prep.py raid-route_3.html
(Run patch_app.py first. A backup is saved as <file>.prep.bak.)
"""
import shutil
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "raid-route_3.html"

CSS = r"""
#prepBtn{white-space:nowrap}
#prepDlg{width:min(700px,94vw)}
#prepDlg[open]{display:flex;flex-direction:column;max-height:88vh}
.prep-h{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.prep-h h2{margin:0}
#prepBody{overflow-y:auto;min-height:0;flex:1;margin:8px 0;padding-right:4px}
#prepBody h3{margin:14px 0 4px;font:600 18px var(--f-head);letter-spacing:.02em;color:var(--accent)}
#prepBody h3:first-child{margin-top:0}
label.pr{display:flex;gap:9px;align-items:flex-start;padding:6px 4px;border-bottom:1px solid var(--line);cursor:pointer}
label.pr:hover{background:var(--panel2)}
label.pr input{margin-top:4px}
label.pr b{font-weight:600;margin-right:6px}
label.pr small{display:block;color:var(--mute);font-size:12px;margin-top:1px}
label.pr.on span{color:var(--mute);text-decoration:line-through}
.fir{display:inline-block;font-size:11px;border:1px solid #6a5a2e;color:#d4b25f;border-radius:3px;padding:0 4px;margin-left:5px}
"""

BUTTON = '<button id="prepBtn" class="primary" title="Keys, items and gear needed for your selected quests">Pre-raid check</button>\n      '

DIALOG = r"""<dialog id="prepDlg">
  <div class="prep-h"><h2>Pre-raid check</h2>
    <div class="seg" id="prepScopeSeg" role="group" aria-label="Scope"><button data-s="map">This map</button><button data-s="all">All my quests</button></div>
  </div>
  <p class="muted" id="prepSub" style="margin:0"></p>
  <div id="prepBody"></div>
  <div class="row" style="justify-content:space-between;margin-top:0">
    <button id="prepReset" class="quiet">Clear all ticks</button>
    <button id="prepClose" class="primary">Close</button>
  </div>
</dialog>

"""

JS = r"""/* ============ pre-raid checklist ============ */
const packed = new Set(LS.get('rr_packed', []));
let prepScope = LS.get('rr_prepScope', 'map');
const savePacked = () => LS.set('rr_packed', [...packed]);

function prepCollect(scope){
  const k = S.curMap;
  const act = [...S.active].map(id => S.byId.get(id)).filter(Boolean);
  const R = { keys:new Map(), bring:new Map(), find:new Map(), gear:[] };
  const bump = (m, sig, init, n, q, maps) => {
    let r = m.get(sig);
    if(!r){ r = Object.assign({ sig, count:0, quests:new Set(), maps:new Set() }, init); m.set(sig, r); }
    r.count += n; r.quests.add(q); (maps || []).forEach(x => r.maps.add(x));
    return r;
  };
  act.forEach(t => {
    const objs = t.objs.filter(o => !S.done.has(o.id) && (S.opts.optional || !o.optional));
    const rel = o => scope === 'all' || o.maps.has(k) || o.flex || o.nonmap;
    const here = objs.some(o => o.maps.has(k));
    const labels = o => [...o.maps].map(m => MAP_LABEL[m] || m);
    const perTask = new Map();
    const covered = new Set();
    objs.forEach(o => {
      const q = o.req; if(!q || !rel(o)) return;
      (q.keys || []).forEach(g => { g.forEach(n => covered.add(n)); bump(R.keys, 'k|' + g.join('|'), { names:g }, 0, t.name, labels(o)); });
      (q.bring || []).forEach(b => bump(R.bring, 'b|' + b.note + '|' + b.names.join('|'),
        { names:b.names, note:b.note, fir:b.fir }, b.count || 1, t.name, labels(o)));
      (q.find || []).forEach(f => {
        const sig = 'f|' + f.names.join('|');
        const cur = perTask.get(sig);
        if(!cur) perTask.set(sig, { f, count:f.count || 1, notes:new Set([f.note]) });
        else { cur.count = Math.max(cur.count, f.count || 1); cur.notes.add(f.note); }
      });
      if(q.gear) R.gear.push({ quest:t.name, text:o.desc, maps:labels(o), sig:'g|' + t.id + '|' + o.id });
    });
    perTask.forEach((v, sig) => bump(R.find, sig, { names:v.f.names, fir:v.f.fir, extra:v.f.extra, notes:new Set() }, v.count, t.name, []).notes.add([...v.notes].join(' + ')));
    (t.keys || []).forEach(kk => {
      if(kk.names.every(n => covered.has(n))) return;
      if(scope === 'all' || (kk.map === k && here)) bump(R.keys, 'k|' + kk.names.join('|'), { names:kk.names }, 0, t.name, [MAP_LABEL[kk.map] || kk.map]);
    });
  });
  return R;
}
function prepHTML(scope){
  const R = prepCollect(scope);
  const ids = [];
  const nm = names => {
    const s = names.length > 3 ? names.slice(0,3).join(' / ') + ' / +' + (names.length - 3) + ' more' : names.join(' / ');
    return '<span title="' + esc(names.join(' / ')) + '">' + esc(s) + '</span>';
  };
  const sub = r => [...r.quests].map(esc).join(', ') + (scope === 'all' && r.maps.size ? ' · ' + [...r.maps].map(esc).join(', ') : '');
  const row = (id, lead, text, small) => {
    ids.push(id);
    return '<label class="pr ' + (packed.has(id) ? 'on' : '') + '"><input type="checkbox" data-r="' + esc(id) + '" ' + (packed.has(id) ? 'checked' : '') +
      '><span>' + (lead ? '<b>' + lead + '</b>' : '') + text + '<small>' + small + '</small></span></label>';
  };
  let h = '';
  const keys = [...R.keys.values()].sort((a,b) => a.names[0].localeCompare(b.names[0]));
  if(keys.length) h += '<h3>Keys</h3>' + keys.map(r => row(r.sig, '', nm(r.names), sub(r))).join('');
  const bring = [...R.bring.values()].sort((a,b) => a.names[0].localeCompare(b.names[0]));
  if(bring.length) h += '<h3>Bring into the raid</h3>' + bring.map(r =>
    row(r.sig, r.count + '×', nm(r.names) + ' <span class="muted">(' + esc(r.note) + ')</span>' + (r.fir ? '<span class="fir">found in raid</span>' : ''), sub(r))).join('');
  if(R.gear.length) h += '<h3>Weapon / gear conditions</h3>' + R.gear.map(g =>
    row(g.sig, '', esc(g.text), esc(g.quest) + (scope === 'all' && g.maps.length ? ' · ' + g.maps.map(esc).join(', ') : ''))).join('');
  const find = [...R.find.values()].sort((a,b) => a.names[0].localeCompare(b.names[0]));
  if(find.length) h += '<h3>Find in raid / hand in</h3>' + find.map(r =>
    row(r.sig, r.count + '×', nm(r.names) + (r.fir ? '<span class="fir">found in raid</span>' : '') + (r.extra ? ' <span class="muted">(' + esc(r.extra) + ')</span>' : ''),
      [...r.notes].map(esc).join(', ') + ' · ' + sub(r))).join('');
  return { html:h, ids };
}
function renderPrep(){
  const btn = $('#prepBtn'); if(!btn || !S.byId.size) return;
  const { html, ids } = prepHTML(prepScope);
  const open = ids.filter(id => !packed.has(id)).length;
  btn.textContent = 'Pre-raid check' + (open ? ' (' + open + ')' : '');
  const dlg = $('#prepDlg');
  if(dlg.open){
    $('#prepScopeSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.s === prepScope));
    $('#prepSub').textContent = !S.active.size ? '' : (prepScope === 'map'
      ? 'For ' + (MAP_LABEL[S.curMap] || S.curMap) + ': what your selected quests need on this map, plus items you can find on any map.'
      : 'Everything your selected quests need, across all maps.');
    $('#prepBody').innerHTML = !S.active.size
      ? '<div class="empty"><b>No quests selected</b>Add your active quests first.</div>'
      : (html || '<div class="empty"><b>Nothing to bring</b>None of your remaining objectives need keys, items or special gear' + (prepScope === 'map' ? ' on this map' : '') + '.</div>');
  }
}
(function wirePrep(){
  const dlg = $('#prepDlg');
  $('#prepBtn').addEventListener('click', () => { dlg.showModal(); renderPrep(); });
  $('#prepClose').addEventListener('click', () => dlg.close());
  $('#prepReset').addEventListener('click', () => { packed.clear(); savePacked(); renderPrep(); });
  $('#prepScopeSeg').addEventListener('click', e => {
    const b = e.target.closest('button[data-s]'); if(!b) return;
    prepScope = b.dataset.s; LS.set('rr_prepScope', prepScope); renderPrep();
  });
  $('#prepBody').addEventListener('change', e => {
    const cb = e.target.closest('input[data-r]'); if(!cb) return;
    if(cb.checked) packed.add(cb.dataset.r); else packed.delete(cb.dataset.r);
    savePacked(); renderPrep();
  });
})();
function renderRoute(){ renderRoute0(); renderPrep(); }

"""

EDITS = [
    ("quest data: requirements",
     "return { id:o.id, type:o.type, desc:text, optional:!!o.optional, pts, polys, maps, nonmap, flex: !maps.size && !nonmap };",
     "return { id:o.id, type:o.type, desc:text, optional:!!o.optional, pts, polys, maps, nonmap, flex: !maps.size && !nonmap, req:o.req || null };"),
    ("quest data: keys",
     "return { id:t.id, name:t.name, trader:(t.trader && t.trader.name) || '', level:t.minPlayerLevel, kappa:!!t.kappaRequired, map:tmap, objs };",
     "return { id:t.id, name:t.name, trader:(t.trader && t.trader.name) || '', level:t.minPlayerLevel, kappa:!!t.kappaRequired, map:tmap, objs, keys:(t.keys || []).map(x => ({ map:canon(x.map), names:x.names })) };"),
    ("header button",
     '<div class="seg" id="modeSeg"',
     BUTTON + '<div class="seg" id="modeSeg"'),
    ("dialog",
     '<div id="overlay"><h2>',
     DIALOG + '<div id="overlay"><h2>'),
    ("styles", "</style>", CSS + "</style>"),
    ("route hook",
     "function renderRoute(){\n  const box = $('#route'), an = S.an",
     "function renderRoute0(){\n  const box = $('#route'), an = S.an"),
    ("script", "/* ============ wiring ============ */", JS + "/* ============ wiring ============ */"),
]

with open(path, encoding="utf-8") as f:
    src = f.read()
if 'id="prepDlg"' in src:
    print("Pre-raid check already applied - skipping."); sys.exit(0)
for label, old, new in EDITS:
    if src.count(old) != 1:
        sys.exit("Could not patch (%s): expected text not found exactly once. Is this the right HTML file?" % label)
    src = src.replace(old, new)
shutil.copyfile(path, path + ".prep.bak")
with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("Patched", path, "(backup:", path + ".prep.bak)")
