"""Add quest sorting to the left quest panel of raid-route_3.html.

Sort by: order added (default), name A-Z, trader, map, or experience gained.
Trader and map sorting show group headings. A Reverse button flips the order.

Usage:  python patch_sort.py raid-route_3.html
(Run patch_app.py first, and rebuild quest_data.json with the latest
build_quest_data.py so experience values are included. Backup: <file>.sort.bak.)
"""
import shutil
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "raid-route_3.html"

JS = r"""/* ============ quest sorting ============ */
(function wireSort(){
  const st = document.createElement('style');
  st.textContent = `
.sortbar{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--line);background:var(--panel)}
.sortbar label{color:var(--mute);font-size:13px}
.sortbar select{flex:1;min-width:0;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:5px;padding:5px 8px}
.sortbar button.on{border-color:var(--accent);color:var(--accent)}
.qgrp{display:flex;justify-content:space-between;padding:6px 14px 4px;background:var(--bg);border-bottom:1px solid var(--line);font:600 15px var(--f-head);letter-spacing:.03em;color:var(--accent);text-transform:uppercase}
.qgrp span{color:var(--mute);font-weight:500}
`;
  document.head.appendChild(st);

  /* carry the experience reward through normalizeTasks */
  { const _nt = normalizeTasks;
    normalizeTasks = function(raw){
      const out = _nt(raw), by = new Map(raw.map(r => [r.id, r]));
      out.forEach(t => { const r = by.get(t.id); t.exp = (r && r.experience) || 0; });
      return out;
    }; }

  const mapOf = t => {
    if(t.map && SVG_FILES[t.map]) return t.map;
    const c = {};
    t.objs.forEach(o => o.maps.forEach(m => { if(SVG_FILES[m]) c[m] = (c[m] || 0) + 1; }));
    return Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b))[0] || null;
  };
  const mapLabelOf = t => { const m = mapOf(t); return m ? (MAP_LABEL[m] || m) : 'Any map'; };
  const byName = (a, b) => a.t.name.localeCompare(b.t.name);
  const CMP = {
    added:  (a, b) => a.i - b.i,
    name:   byName,
    trader: (a, b) => (a.t.trader || '').localeCompare(b.t.trader || '') || (a.t.level || 0) - (b.t.level || 0) || byName(a, b),
    map:    (a, b) => {
      const la = mapLabelOf(a.t), lb = mapLabelOf(b.t);
      if((la === 'Any map') !== (lb === 'Any map')) return la === 'Any map' ? 1 : -1;
      return la.localeCompare(lb) || byName(a, b);
    },
    exp:    (a, b) => (b.t.exp || 0) - (a.t.exp || 0) || byName(a, b)
  };

  function applySort(){
    const box = $('#quests'); if(!box) return;
    const mode = CMP[S.opts.sortBy] ? S.opts.sortBy : 'added', rev = !!S.opts.sortRev;
    const ents = [...box.querySelectorAll('.qcard')].map((el, i) => ({ el, i, t:S.byId.get(el.dataset.id) })).filter(e => e.t);
    if(!ents.length) return;
    ents.sort(CMP[mode]); if(rev) ents.reverse();
    const grp = mode === 'trader' ? e => e.t.trader || 'Unknown' : mode === 'map' ? e => mapLabelOf(e.t) : null;
    const counts = new Map();
    if(grp) ents.forEach(e => counts.set(grp(e), (counts.get(grp(e)) || 0) + 1));
    let last = null;
    ents.forEach(e => {
      box.appendChild(e.el);
      if(grp){
        const g = grp(e);
        if(g !== last){ e.el.insertAdjacentHTML('beforebegin', '<div class="qgrp">' + esc(g) + '<span>' + counts.get(g) + '</span></div>'); last = g; }
      }
      if(mode === 'exp'){
        const sm = e.el.querySelector('.qname small');
        if(sm) sm.insertAdjacentHTML('beforeend', ' · ' + (e.t.exp || 0).toLocaleString() + ' XP');
      }
    });
  }
  { const _rq = renderQuests;
    renderQuests = function(){ _rq(); applySort(); }; }

  $('#quests').insertAdjacentHTML('beforebegin',
    '<div class="sortbar"><label for="sortSel">Sort</label><select id="sortSel">' +
    '<option value="added">Order added</option><option value="name">Name A–Z</option><option value="trader">Trader</option>' +
    '<option value="map">Map</option><option value="exp">Experience gained</option></select>' +
    '<button id="sortRev" class="quiet" title="Reverse the order" aria-pressed="false">↕ Reverse</button></div>');
  const sel = $('#sortSel'), rv = $('#sortRev');
  sel.value = CMP[S.opts.sortBy] ? S.opts.sortBy : 'added';
  const syncRev = () => { rv.classList.toggle('on', !!S.opts.sortRev); rv.setAttribute('aria-pressed', String(!!S.opts.sortRev)); };
  syncRev();
  const redo = () => {
    saveOpts();
    const open = [...document.querySelectorAll('.qcard[open]')].map(c => c.dataset.id);
    renderQuests();
    open.forEach(id => { const c = document.querySelector('.qcard[data-id="' + CSS.escape(id) + '"]'); if(c) c.open = true; });
  };
  sel.addEventListener('change', () => { S.opts.sortBy = sel.value; redo(); });
  rv.addEventListener('click', () => { S.opts.sortRev = !S.opts.sortRev; syncRev(); redo(); });
})();

"""

with open(path, encoding="utf-8") as f:
    src = f.read()
if "wireSort" in src:
    print("Quest sorting already applied - skipping.")
    sys.exit(0)
marker = "/* ============ wiring ============ */"
if src.count(marker) != 1:
    sys.exit("Could not patch: wiring marker not found exactly once. Is this the right HTML file?")
for needed in ("function normalizeTasks(", "function renderQuests", 'id="quests"'):
    if needed not in src:
        sys.exit("Could not patch: missing " + needed + " - run patch_app.py first and use the r4 HTML.")
shutil.copyfile(path, path + ".sort.bak")
with open(path, "w", encoding="utf-8") as f:
    f.write(src.replace(marker, JS + marker))
print("Patched", path, "(backup:", path + ".sort.bak)")
