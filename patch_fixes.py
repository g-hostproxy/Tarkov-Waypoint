"""Accuracy fixes for raid-route_3.html (run after patch_polish.py).

  * Arena objectives (matches and kills in Arena modes) are not raid objectives. They used to be listed under
    "Any map (found in raid)"; now they are listed with the hand-ins / other objectives.
  * Objectives on maps that have no map view in this page (The Labyrinth, Icebreaker ...) used to be
    hidden everywhere. They now get their own box at the bottom of the right panel, so no quest
    objective silently disappears.

  * Pre-raid check: "This map" no longer lists hand-ins or weapon builds (Hell on Earth - Part 1 and the other
    "modify a gun" quests were showing on every map). Weapon builds get their own section in the
    "All my quests" view. A key is only listed on maps where it actually opens something.
  * Route rows only show a key on maps where it opens something.

Usage:  python patch_fixes.py raid-route_3.html
(A backup is saved as <file>.fixes.bak.)
"""
import shutil
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "raid-route_3.html"


PREP_EDITS = [
    ("pre-raid: relevance",
     "const rel = o => scope === 'all' || o.maps.has(k) || o.flex || o.nonmap;",
     "const rel = o => scope === 'all' || o.maps.has(k) || o.flex;      /* turn-ins and workbench builds (o.nonmap) are not tied to a raid */"),
    ("pre-raid: keys per map",
     "      (q.keys || []).forEach(g => { g.forEach(n => covered.add(n)); bump(R.keys, 'k|' + g.join('|'), { names:g }, 0, t.name, labels(o)); });",
     """      (q.keys || []).forEach((g, i) => {
        const km = (q.keyMaps || [])[i];
        if(scope !== 'all' && km && km.length && !km.includes(k)) return;      /* this key opens nothing on the map you are viewing */
        g.forEach(n => covered.add(n)); bump(R.keys, 'k|' + g.join('|'), { names:g }, 0, t.name, labels(o));
      });"""),
    ("pre-raid: weapon builds",
     "      if(q.gear) R.gear.push({ quest:t.name, text:o.desc, maps:labels(o), sig:'g|' + t.id + '|' + o.id });",
     """      if(q.gear){
        const g = { quest:t.name, text:o.desc, maps:labels(o), sig:'g|' + t.id + '|' + o.id };
        if(o.type === 'buildWeapon') (R.builds = R.builds || []).push(g); else R.gear.push(g);
      }"""),
    ("pre-raid: weapon builds section",
     "  return { html:h, ids };",
     """  if(R.builds && R.builds.length) h += '<h3>Weapon builds (hideout workbench, no raid needed)</h3>' + R.builds.map(g =>
    row(g.sig, '', esc(g.text), esc(g.quest))).join('');
  return { html:h, ids };"""),
]

JS = r"""/* ============ accuracy fixes ============ */
(function wireFixes(){
  /* Arena objectives have no map and are not done in a raid */
  { const _nt = normalizeTasks;
    normalizeTasks = function(raw){
      const out = _nt(raw);
      out.forEach(t => {
        if(!/\[PVP ZONE\]/i.test(t.name)) return;
        /* only the objectives that are played in Arena (some [PVP ZONE] quests are ordinary raid kills) */
        t.objs.forEach(o => { if(!o.maps.size && /\bArena\b|TeamFight|BlastGang|CheckPoint|Last ?Hero|\bmatch(es)?\b/.test(o.desc)){ o.nonmap = true; o.flex = false; } });
      });
      return out;
    }; }

  /* objectives on maps this page has no map for */
  const pretty = k => String(k).split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
  function addOffMap(){
    const box = $('#route'), an = S.an; if(!box || !an || !an.act) return;
    const old = box.querySelector('.offmap'); if(old) old.remove();
    const rows = [];
    an.act.forEach(t => t.objs.forEach(o => {
      if(S.done.has(o.id) || (!S.opts.optional && o.optional) || !o.maps.size) return;
      if([...o.maps].some(m => SVG_FILES[m])) return;
      rows.push('<div style="margin:4px 0"><span class="swatch" style="display:inline-block;background:' + qColor(t) + ';margin-right:6px"></span><b>' + esc(t.name) +
        '</b> \u2014 ' + esc(o.desc) + ' <span class="tag">' + esc([...o.maps].map(pretty).join(', ')) + '</span></div>');
    }));
    if(rows.length) box.insertAdjacentHTML('beforeend',
      '<div class="listbox offmap"><h3>On maps without a map view</h3><div class="muted" style="margin-bottom:4px">No map art for these, so they are listed here instead of on a route.</div>' + rows.join('') + '</div>');
  }
  { const _rr = renderRoute;
    renderRoute = function(){ _rr(); addOffMap(); }; }
})();

"""

with open(path, encoding="utf-8") as f:
    src = f.read()
if "wireFixes" in src:
    print("Accuracy fixes already applied - skipping.")
    sys.exit(0)
marker = "/* ============ wiring ============ */"
if src.count(marker) != 1:
    sys.exit("Could not patch: wiring marker not found exactly once. Is this the right HTML file?")
for needed in ("function normalizeTasks(", "function renderRoute(", "const qColor"):
    if needed not in src:
        sys.exit("Could not patch: missing " + needed + " - run the earlier patches first.")
for label, old, new in PREP_EDITS:
    if src.count(old) != 1:
        sys.exit("Could not patch (%s): expected text not found exactly once. Is this the right HTML file?" % label)
    src = src.replace(old, new)
shutil.copyfile(path, path + ".fixes.bak")
with open(path, "w", encoding="utf-8") as f:
    f.write(src.replace(marker, JS + marker))
print("Patched", path, "(backup:", path + ".fixes.bak)")
