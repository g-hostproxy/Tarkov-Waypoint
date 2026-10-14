"""Add a "Kappa only" button to raid-route_3.html.

When on, quests that are not required for the Kappa container are hidden everywhere:
search, trader lists, paste-a-list, your active quests, the maps ranking, routes,
the pre-raid check and the key suggestions. Your selections are kept and come back
when the button is switched off.

Usage:  python patch_kappa.py raid-route_3.html
(Run patch_app.py first. A backup is saved as <file>.kappa.bak.)
"""
import shutil
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "raid-route_3.html"

JS = r"""/* ============ kappa filter ============ */
(function wireKappa(){
  /* quest lookups by id hide non-Kappa quests while the filter is on (everything that lists active quests goes through S.byId.get) */
  let full = S.byId;
  const view = {
    get(id){ const t = full.get(id); return (S.opts.kappaOnly && t && !t.kappa) ? undefined : t; },
    has(id){ return full.has(id); },
    get size(){ return full.size; }
  };
  Object.defineProperty(S, 'byId', { get(){ return view; }, set(m){ full = m; }, configurable:true });

  /* pickers (search, trader list, paste-a-list) only see Kappa quests while the filter is on */
  const withKappa = fn => function(){
    if(!S.opts.kappaOnly) return fn.apply(this, arguments);
    const all = S.tasks; S.tasks = all.filter(t => t.kappa);
    try{ return fn.apply(this, arguments); } finally { S.tasks = all; }
  };
  if(typeof updateSugg0 === 'function') updateSugg0 = withKappa(updateSugg0); else updateSugg = withKappa(updateSugg);
  if(typeof traderGroups === 'function') traderGroups = withKappa(traderGroups);
  matchTask = withKappa(matchTask);

  /* note above the quest list while filtering */
  { const _rq = renderQuests;
    renderQuests = function(){
      _rq();
      if(!S.opts.kappaOnly) return;
      const box = $('#quests'); if(!box) return;
      const kap = new Map(S.tasks.map(t => [t.id, t.kappa]));
      const hidden = [...S.active].filter(id => kap.get(id) === false).length;
      const total = S.tasks.filter(t => t.kappa).length;
      box.insertAdjacentHTML('afterbegin', '<div class="listbox muted">Kappa only: showing the ' + total + ' quests required for Kappa.' +
        (hidden ? ' ' + hidden + ' of your selected quest' + (hidden === 1 ? ' is' : 's are') + ' hidden because ' + (hidden === 1 ? 'it is' : 'they are') + ' not needed for Kappa.' : '') + '</div>');
    }; }

  $('#bulk').insertAdjacentHTML('afterend', '<button id="kappaBtn" title="Hide every quest that is not required for the Kappa container">Kappa only</button>');
  const btn = $('#kappaBtn');
  const sync = () => { const on = !!S.opts.kappaOnly; btn.classList.toggle('primary', on); btn.setAttribute('aria-pressed', String(on)); btn.textContent = on ? 'Kappa only ✓' : 'Kappa only'; };
  btn.addEventListener('click', () => {
    S.opts.kappaOnly = !S.opts.kappaOnly; saveOpts(); sync();
    $('#sugg').hidden = true;
    refresh();
  });
  sync();
})();

"""

with open(path, encoding="utf-8") as f:
    src = f.read()
if "wireKappa" in src:
    print("Kappa filter already applied - skipping.")
    sys.exit(0)
marker = "/* ============ wiring ============ */"
if src.count(marker) != 1:
    sys.exit("Could not patch: wiring marker not found exactly once. Is this the right HTML file?")
for needed in ("function matchTask(", "function renderQuests", "function updateSugg", 'id="bulk"'):
    if needed not in src:
        sys.exit("Could not patch: missing " + needed + " - run patch_app.py first and use the r4 HTML.")
shutil.copyfile(path, path + ".kappa.bak")
with open(path, "w", encoding="utf-8") as f:
    f.write(src.replace(marker, JS + marker))
print("Patched", path, "(backup:", path + ".kappa.bak)")
