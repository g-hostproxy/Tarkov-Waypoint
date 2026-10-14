"""Add trader search + trader photos to raid-route_3.html.

Usage:  python patch_traders.py raid-route_3.html
(Run patch_app.py first. A backup is saved as <file>.traders.bak.)
"""
import shutil
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "raid-route_3.html"

CSS = r"""
.av{position:relative;display:inline-grid;place-items:center;width:var(--s,24px);height:var(--s,24px);border-radius:50%;background:var(--panel2);border:1px solid var(--line);font-weight:600;font-size:calc(var(--s,24px)*.42);font-family:var(--f-head);color:var(--mute);overflow:hidden;flex:none;vertical-align:middle;text-transform:uppercase}
.av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
#sugg li small.tr{display:flex;align-items:center;gap:6px}
.qname small.tr .av{margin-right:5px}
#traderBar{margin-top:10px}
.tchips{display:flex;flex-wrap:wrap;gap:6px}
.tchip{display:flex;flex-direction:column;align-items:center;gap:2px;width:58px;padding:5px 2px 4px;background:var(--panel2)}
.tchip small{font-size:11px;color:var(--mute);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tchip.on{border-color:var(--accent);background:#2a2515}
.tchip.on small{color:var(--text)}
.tchip.on .av{border-color:var(--accent)}
.tlist-h{display:flex;align-items:baseline;gap:8px;margin:10px 0 4px}
.tlist-h .muted{flex:1}
#traderList{max-height:280px;overflow-y:auto;border:1px solid var(--line);border-radius:5px}
.trow{display:flex;gap:8px;align-items:center;width:100%;text-align:left;border:0;border-bottom:1px solid var(--line);border-radius:0;background:none;padding:6px 8px}
.trow:hover:not(:disabled){background:var(--panel2)}
.trow .lv{flex:none;width:42px;color:var(--mute);font-size:12px}
.trow .tn{flex:1;min-width:0}
.trow .ta{flex:none;font-size:12px;color:var(--accent)}
.trow.added{opacity:.5;cursor:default}
.trow.added .ta{color:var(--ok)}
"""

JS = r"""/* ============ trader search + photos ============ */
let traderSel = null, traderQ = '';
const traderOf = key => (S.traders || []).find(t => t.id === key) || null;
function avatarHTML(key, size){
  const tr = traderOf(key);
  const ini = esc(((tr && tr.name) || '?').slice(0, 2));
  const img = tr && tr.image ? '<img src="' + esc(tr.image) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
  return '<span class="av" style="--s:' + size + 'px">' + ini + img + '</span>';
}
function traderGroups(){
  const g = new Map();
  S.tasks.forEach(t => {
    const k = t.traderId || t.trader; if(!k) return;
    if(!g.has(k)) g.set(k, { key:k, name:t.trader || k, tasks:[] });
    g.get(k).tasks.push(t);
  });
  return [...g.values()].sort((a, b) => b.tasks.length - a.tasks.length);
}
function renderTraderBar(){
  const bar = $('#traderBar'); if(!bar || !S.tasks.length) return;
  const groups = traderGroups();
  let sel = groups.find(g => g.key === traderSel) || null;
  if(!sel) traderSel = null;
  const prevList = $('#traderList'), prev = prevList ? prevList.scrollTop : 0;
  let h = '<div class="tchips" role="group" aria-label="Browse quests by trader">' + groups.map(g =>
    '<button class="tchip ' + (g.key === traderSel ? 'on' : '') + '" data-t="' + esc(g.key) + '" title="' + esc(g.name) + ' · ' + g.tasks.length +
    ' quests" aria-pressed="' + (g.key === traderSel) + '">' + avatarHTML(g.key, 34) + '<small>' + esc(g.name) + '</small></button>').join('') + '</div>';
  if(sel){
    const q = norm(traderQ), words = q ? q.split(' ') : [];
    const rows = sel.tasks.filter(t => words.every(w => norm(t.name).includes(w)))
      .sort((a, b) => (a.level || 0) - (b.level || 0) || a.name.localeCompare(b.name));
    h += '<div class="tlist-h"><b>' + esc(sel.name) + '</b><span class="muted">' + rows.length + ' of ' + sel.tasks.length + ' quests' +
      (q ? ' match' : '') + '</span><button class="quiet" id="tClear">Clear</button></div><div id="traderList">' +
      (rows.map(t => {
        const on = S.active.has(t.id);
        return '<button class="trow ' + (on ? 'added' : '') + '" data-id="' + esc(t.id) + '" ' + (on ? 'disabled' : '') + '><span class="lv">' +
          (t.level ? 'Lv ' + t.level : '') + '</span><span class="tn">' + esc(t.name) + '</span><span class="ta">' + (on ? '✓ added' : '+ add') + '</span></button>';
      }).join('') || '<div class="muted" style="padding:8px">No quests match.</div>') + '</div>';
  }
  bar.innerHTML = h;
  const nl = $('#traderList'); if(nl) nl.scrollTop = prev;
}
function renderQuests(){ renderQuests0(); renderTraderBar(); }
function updateSugg(){
  if(traderSel){ traderQ = $('#q').value; $('#sugg').hidden = true; suggList = []; renderTraderBar(); return; }
  updateSugg0();
}
(function wireTraders(){
  $('#q').closest('.combo').insertAdjacentHTML('afterend', '<div id="traderBar"></div>');
  const bar = $('#traderBar');
  bar.addEventListener('click', e => {
    const chip = e.target.closest('.tchip');
    if(chip){
      traderSel = traderSel === chip.dataset.t ? null : chip.dataset.t;
      traderQ = traderSel ? $('#q').value : '';
      $('#sugg').hidden = true; renderTraderBar(); return;
    }
    if(e.target.closest('#tClear')){ traderSel = null; traderQ = ''; renderTraderBar(); updateSugg(); return; }
    const row = e.target.closest('.trow');
    if(row && !row.disabled){ S.active.add(row.dataset.id); saveActive(); refresh(); }
  });
  $('#q').addEventListener('keydown', e => {
    if(e.key !== 'Enter' || !traderSel) return;
    const row = document.querySelector('#traderList .trow:not(:disabled)');
    if(row){ $('#q').value = ''; traderQ = ''; row.click(); }
  });
})();

"""

EDITS = [
    ("trader id",
     "trader:(t.trader && t.trader.name) || '', level:t.minPlayerLevel",
     "trader:(t.trader && t.trader.name) || '', traderId:(t.trader && t.trader.id) || '', level:t.minPlayerLevel"),
    ("traders data",
     "S.extracts = normalizeExtracts(data.maps || []);",
     "S.extracts = normalizeExtracts(data.maps || []);\n  S.traders = data.traders || [];"),
    ("search by trader name",
     "words.every(w => norm(t.name).includes(w))",
     "words.every(w => norm(t.name + ' ' + t.trader).includes(w))"),
    ("search hook", "function updateSugg(){", "function updateSugg0(){"),
    ("suggestion photo",
     "${esc(t.name)}<small>${esc(t.trader)}</small></li>",
     "${esc(t.name)}<small class=\"tr\">${avatarHTML(t.traderId || t.trader, 18)}${esc(t.trader)}</small></li>"),
    ("quest card photo",
     "<small>${esc(t.trader)}${t.level ?",
     "<small class=\"tr\">${avatarHTML(t.traderId || t.trader, 16)}${esc(t.trader)}${t.level ?"),
    ("quests hook", "function renderQuests(){", "function renderQuests0(){"),
    ("styles", "</style>", CSS + "</style>"),
    ("script", "/* ============ wiring ============ */", JS + "/* ============ wiring ============ */"),
]

with open(path, encoding="utf-8") as f:
    src = f.read()
if "wireTraders" in src:
    print("Trader search already applied - skipping."); sys.exit(0)
for label, old, new in EDITS:
    if src.count(old) != 1:
        sys.exit("Could not patch (%s): expected text not found exactly once. "
                 "Run patch_app.py first, and make sure this is the right HTML file." % label)
    src = src.replace(old, new)
shutil.copyfile(path, path + ".traders.bak")
with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("Patched", path, "(backup:", path + ".traders.bak)")
