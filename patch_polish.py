"""Small interface improvements for raid-route_3.html.

  * (Extract names are drawn by patch_legend.py now.)
  * The route stops (right panel and the bubble you get when you click a stop on the map) now list what to
    pick up / hand in / bring / unlock for each objective, with item photos. The same goes for the
    "Anywhere", "Any map" and "Hand-ins" boxes.
  * The "Not on this map" box in the right panel is removed.
  * The Pre-raid check no longer lists "Find in raid / hand in" items (they are not pre-raid; they now
    show in the route instead). Keys, items to bring and gear conditions stay.

Usage:  python patch_polish.py raid-route_3.html
(Run it last, after patch_loot.py - it uses itemImg() from there. A backup is saved as <file>.polish.bak.)
"""
import shutil
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "raid-route_3.html"

JS = r"""/* ============ polish: extract labels, item info in routes ============ */
(function wirePolish(){
  const st = document.createElement('style');
  st.textContent = `
.rq{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:3px 0 1px;font-size:12px;line-height:1.25;color:inherit}
.rq .rv{font-weight:600;opacity:.8;margin-right:1px}
.rq .rn{min-width:0}
.pop .fir{color:#8a6d1c;border-color:#8a6d1c}
`;
  document.head.appendChild(st);

  /* ---- what to find / hand in / bring / unlock for an objective, with photos ---- */
  const row = (verb, ns, ids, count, extra) => {
    const label = ns.slice(0, 3).join(' / ') + (ns.length > 3 ? ' / +' + (ns.length - 3) + ' more' : '');
    return '<div class="rq" title="' + esc(ns.join(' / ')) + '"><span class="rv">' + esc(verb) + '</span>' +
      (ids || []).slice(0, 3).map(id => itemImg(id, 26)).join('') +
      '<span class="rn">' + (count ? '<b>' + count + '\u00d7</b> ' : '') + esc(label) + '</span>' + (extra || '') + '</div>';
  };
  function reqHTML(o){
    const q = o && o.req; if(!q) return '';
    let h = '';
    (q.find || []).forEach(f => {
      const verb = f.note === 'hand in' ? 'Hand in' : f.note === 'quest item' ? 'Find quest item' : 'Find';
      h += row(verb, f.names, f.ids, f.count || 1,
        (f.fir ? '<span class="fir">FIR</span>' : '') + (f.extra ? ' <span class="muted">(' + esc(f.extra) + ')</span>' : ''));
    });
    (q.bring || []).forEach(b => {
      h += row('Bring ' + b.note, b.names, b.ids, b.count || 1, b.fir ? '<span class="fir">FIR</span>' : '');
    });
    (q.keys || []).forEach((g, i) => {
      const km = (q.keyMaps || [])[i];
      if(km && km.length && S.curMap && !km.includes(S.curMap)) return;      /* key opens nothing on this map */
      h += row('Key', g, (q.keyIds || [])[i], 0, '');
    });
    return h;
  }

  { const _pf = popupFor;
    popupFor = function(items, extra){
      const el = _pf(items, extra);
      const rows = el.querySelectorAll('.pi');
      items.forEach((it, i) => {
        const h = reqHTML(it.o); if(!h || !rows[i]) return;
        const b = rows[i].querySelector('button');
        if(b) b.insertAdjacentHTML('beforebegin', h); else rows[i].insertAdjacentHTML('beforeend', h);
      });
      return el;
    }; }

  function addRouteReqs(){
    const an = S.an, k = S.curMap, a = an && k && an.A[k];
    if(!a) return;
    if(a.route) document.querySelectorAll('#route .steps li[data-i]').forEach(li => {
      const stop = a.route.stops[+li.dataset.i]; if(!stop) return;
      li.querySelectorAll('.it').forEach((el, j) => {
        const it = stop.items[j];
        if(it && !el.querySelector('.rq')) el.insertAdjacentHTML('beforeend', reqHTML(it.g.o));
      });
    });
    document.querySelectorAll('#route .listbox').forEach(lb => {
      const h = lb.querySelector('h3'); if(!h) return;
      const t = h.textContent;
      const list = t === 'Any map (found in raid)' ? an.flex : t === 'Anywhere on ' + (MAP_LABEL[k] || k) ? a.anywhere : null;
      if(list){
        [...lb.children].filter(c => c.tagName === 'DIV').forEach((r, i) => {
          if(list[i] && !r.querySelector('.rq')) r.insertAdjacentHTML('beforeend', reqHTML(list[i].o));
        });
      } else if(t === 'Hand-ins and other'){
        const d = lb.querySelector('.muted');
        if(d && !d.dataset.rq){
          d.dataset.rq = '1'; d.classList.remove('muted');
          d.innerHTML = an.turnin.map(x => '<div style="margin:4px 0"><b>' + esc(x.t.name) + '</b> \u2014 ' + esc(x.o.desc) + reqHTML(x.o) + '</div>').join('');
        }
      }
    });
  }
  { const _rr = renderRoute;
    renderRoute = function(){ _rr(); addRouteReqs(); }; }
})();

"""

REMOVE = [
    ("    const elsewhere = an.act.filter(t => !a.full.has(t.id) && !a.part.has(t.id) && t.objs.some(o => !S.done.has(o.id) && o.maps.size));\n", ""),
    ("    if(elsewhere.length) html += `<div class=\"listbox\"><h3>Not on this map</h3><div class=\"muted\">${elsewhere.map(t => esc(t.name)).join(', ')}</div></div>`;\n", ""),
]

def strip_find_from_prep(src):
    """Remove the find / hand-in section from the Pre-raid check (works whether or not it is already gone)."""
    if "Find in raid / hand in" not in src and "perTask" not in src:
        return src
    edits = [
        ("const R = { keys:new Map(), bring:new Map(), find:new Map(), gear:[] };",
         "const R = { keys:new Map(), bring:new Map(), gear:[] };"),
        ("    const perTask = new Map();\n", ""),
        ("""      (q.find || []).forEach(f => {
        const sig = 'f|' + f.names.join('|');
        const cur = perTask.get(sig);
        if(!cur) perTask.set(sig, { f, count:f.count || 1, notes:new Set([f.note]) });
        else { cur.count = Math.max(cur.count, f.count || 1); cur.notes.add(f.note); }
      });
""", ""),
        ("    perTask.forEach((v, sig) => bump(R.find, sig, { names:v.f.names, fir:v.f.fir, extra:v.f.extra, notes:new Set() }, v.count, t.name, []).notes.add([...v.notes].join(' + ')));\n", ""),
        ("what your selected quests need on this map, plus items you can find on any map.", "what your selected quests need on this map: keys, items to bring and gear."),
        ("Everything your selected quests need, across all maps.", "Everything to bring for your selected quests, across all maps."),
    ]
    for old, new in edits:
        if src.count(old) != 1:
            sys.exit("Could not update the Pre-raid check: expected text not found exactly once (%s...). Is this the right HTML file?" % old[:50].strip())
        src = src.replace(old, new)
    a = src.find("  const find = [...R.find.values()]")
    b = src.find("  return { html:h, ids };", a)
    if a < 0 or b < 0:
        sys.exit("Could not update the Pre-raid check: find section not found.")
    return src[:a] + src[b:]


with open(path, encoding="utf-8") as f:
    src = f.read()
if "wirePolish" in src:
    print("Polish already applied - skipping.")
    sys.exit(0)
marker = "/* ============ wiring ============ */"
if src.count(marker) != 1:
    sys.exit("Could not patch: wiring marker not found exactly once. Is this the right HTML file?")
for needed in ("function popupFor(", "function drawOverlay(", "function renderRoute(", "function itemImg("):
    if needed not in src:
        sys.exit("Could not patch: missing " + needed + " - run the earlier patches first (patch_loot.py provides itemImg).")
src = strip_find_from_prep(src)
for old, new in REMOVE:
    if src.count(old) != 1:
        sys.exit("Could not remove the \"Not on this map\" box: expected text not found exactly once. Is this the right HTML file?")
    src = src.replace(old, new)
shutil.copyfile(path, path + ".polish.bak")
with open(path, "w", encoding="utf-8") as f:
    f.write(src.replace(marker, JS + marker))
print("Patched", path, "(backup:", path + ".polish.bak)")
