"""Add undo, a completed-quests history and wiki links to raid-route_3.html.

What it adds
  * Undo button (and Ctrl+Z) for every change to your quest list: ticking or unticking an
    objective, completing, removing or adding quests, "Remove all", reopening, clearing history.
    A small "Undo" toast also pops up whenever a quest gets completed.
  * Completing a quest: a green check button on each quest card, and a quest is completed
    automatically when its last required (non-optional) objective is ticked. Completed quests
    leave the active list and are saved (in this browser, per game mode) with the date.
  * "Completed" button: shows everything you have finished, with search, XP / Kappa totals and a
    Reopen button. Completed quests no longer show up in search or the trader lists.
  * Wiki links on the route dots' popups, on the stops in the route list and on each quest card.
    Uses the wikiLink stored in quest_data.json (rebuild it with the latest build_quest_data.py);
    falls back to a link made from the quest name if the data has none.

Usage:  python patch_extras.py raid-route_3.html
(Run it after the other patch_*.py files. A backup is saved as <file>.extras.bak.)
"""
import shutil
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "raid-route_3.html"

JS = r"""/* ============ undo, completed quests, wiki links ============ */
(function wireExtras(){
  const st = document.createElement('style');
  st.textContent = `
.histbar{display:flex;gap:8px;align-items:center;padding:8px 14px;border-bottom:1px solid var(--line);background:var(--panel)}
.histbar button:disabled{opacity:.4;cursor:default;border-color:var(--line)}
.wikilink{color:var(--accent);font-size:12px;text-decoration:none;white-space:nowrap;margin-left:8px}
.wikilink:hover{text-decoration:underline}
.qwiki{margin:2px 0 6px}
.qwiki .wikilink{margin-left:0}
button.quiet.qdone{color:var(--ok)}
button.quiet.qdone:hover{border-color:var(--ok);color:var(--ok)}
#toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:5000;display:flex;gap:14px;align-items:center;max-width:92vw;background:var(--panel2);border:1px solid var(--accent);border-radius:6px;padding:8px 12px;box-shadow:0 6px 24px #000a}
#toast[hidden]{display:none}
#doneDlg{width:min(700px,94vw)}
#doneDlg[open]{display:flex;flex-direction:column;max-height:88vh}
.done-h{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.done-h h2{margin:0}
.done-h input{flex:1;min-width:160px;max-width:280px;background:var(--bg);border:1px solid var(--line);border-radius:5px;padding:6px 10px}
#doneBody{overflow-y:auto;min-height:0;flex:1;margin:8px 0;border:1px solid var(--line);border-radius:5px}
.drow{display:flex;gap:10px;align-items:center;padding:7px 10px;border-bottom:1px solid var(--line)}
.drow:last-child{border-bottom:0}
.drow .dn{flex:1;min-width:0}
.drow .dn small{display:block;color:var(--mute);font-size:12px}
.drow .dx{color:var(--accent);font-size:12px;white-space:nowrap}
`;
  document.head.appendChild(st);

  /* ---- lookups that ignore the Kappa filter ---- */
  let fullKey = null, fullMap = new Map();
  const taskById = id => {
    if(fullKey !== S.tasks){ fullKey = S.tasks; fullMap = new Map(S.tasks.map(t => [t.id, t])); }
    return fullMap.get(id);
  };

  /* ---- wiki links ---- */
  { const _nt = normalizeTasks;
    normalizeTasks = function(raw){
      const out = _nt(raw), by = new Map(raw.map(r => [r.id, r]));
      out.forEach(t => {
        const r = by.get(t.id);
        t.wiki = (r && r.wikiLink) || '';
        if(t.exp == null) t.exp = (r && r.experience) || 0;
      });
      return out;
    }; }
  const wikiUrl = t => t.wiki || ('https://escapefromtarkov.fandom.com/wiki/' + encodeURIComponent(String(t.name).replace(/ /g, '_')));
  const wikiA = (t, text) => '<a class="wikilink" href="' + esc(wikiUrl(t)) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Open the wiki page for ' + esc(t.name) + '">' + (text || 'Wiki') + ' ↗</a>';

  { const _pf = popupFor;
    popupFor = function(items, extra){
      const el = _pf(items, extra);
      const rows = el.querySelectorAll('.pi');
      items.forEach((it, i) => { if(rows[i]) rows[i].insertAdjacentHTML('beforeend', wikiA(it.t)); });
      return el;
    }; }
  function addRouteWiki(){
    const a = S.an && S.curMap && S.an.A[S.curMap];
    if(!a || !a.route) return;
    document.querySelectorAll('#route .steps li[data-i]').forEach(li => {
      const stop = a.route.stops[+li.dataset.i]; if(!stop) return;
      li.querySelectorAll('.it').forEach((el, j) => { const it = stop.items[j]; if(it) el.insertAdjacentHTML('beforeend', wikiA(it.g.t)); });
    });
  }
  { const _rr = renderRoute;
    renderRoute = function(){ _rr(); addRouteWiki(); }; }

  /* ---- completed quests (saved per game mode) ---- */
  const compAll = (() => { const v = LS.get('rr_completed', {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; })();
  const comp = () => compAll[S.mode] || (compAll[S.mode] = {});
  const saveComp = () => LS.set('rr_completed', compAll);

  /* ---- undo history: snapshot the quest state around every refresh() ---- */
  let last = null, lastSig = '', nextLabel = null;
  const hist = [];
  const snap = () => ({ m:S.mode, a:[...S.active], d:[...S.done], c:Object.assign({}, comp()) });
  const sigOf = s => JSON.stringify([s.m, s.a, s.d.slice().sort(), Object.keys(s.c).sort()]);
  const nm = id => { const t = taskById(id); return t ? '\u201c' + t.name + '\u201d' : 'a quest'; };
  const list = ids => ids.length === 1 ? nm(ids[0]) : ids.length + ' quests';
  function describe(a, b){
    const addC = Object.keys(b.c).filter(id => !(id in a.c)), delC = Object.keys(a.c).filter(id => !(id in b.c));
    const addA = b.a.filter(id => !a.a.includes(id)), delA = a.a.filter(id => !b.a.includes(id));
    if(addC.length) return 'completed ' + list(addC);
    if(delC.length) return 'reopened ' + list(delC);
    if(delA.length) return 'removed ' + list(delA);
    if(addA.length) return 'added ' + list(addA);
    const dd = b.d.length - a.d.length;
    return dd > 0 ? 'ticked an objective' : dd < 0 ? 'unticked an objective' : 'last change';
  }
  { const _rf = refresh;
    refresh = function(){
      const c = comp(); let fix = false;
      S.active.forEach(id => { if(c[id]){ delete c[id]; fix = true; } });   /* a quest you add again is no longer "completed" */
      if(fix) saveComp();
      const cur = snap(), sig = sigOf(cur);
      if(last && last.m !== cur.m) hist.length = 0;
      else if(last && sig !== lastSig){ hist.push({ s:last, label:nextLabel || describe(last, cur) }); if(hist.length > 60) hist.shift(); }
      last = cur; lastSig = sig; nextLabel = null;
      _rf.apply(this, arguments);
      updateHistUI();
    }; }

  const openIds = () => [...document.querySelectorAll('.qcard[open]')].map(c => c.dataset.id);
  const reopenCards = ids => ids.forEach(id => { const c = document.querySelector('.qcard[data-id="' + CSS.escape(id) + '"]'); if(c) c.open = true; });

  let toastTimer = 0;
  function toast(msg, canUndo){
    const el = $('#toast'); if(!el) return;
    el.innerHTML = '<span></span>' + (canUndo ? '<button id="toastUndo">Undo</button>' : '');
    el.firstChild.textContent = msg; el.hidden = false;
    if(canUndo) $('#toastUndo').addEventListener('click', undo);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 7000);
  }
  function undo(){
    const e = hist.pop(); if(!e) return;
    const s = e.s, c = comp(), open = openIds();
    S.active.clear(); s.a.forEach(id => { if(taskById(id)) S.active.add(id); });
    S.done.clear(); s.d.forEach(id => S.done.add(id));
    Object.keys(c).forEach(k => delete c[k]); Object.assign(c, s.c);
    saveActive(); saveComp();
    last = snap(); lastSig = sigOf(last);     /* so refresh() does not record the undo itself */
    refresh(); reopenCards(open);
    toast('Undid: ' + e.label, false);
  }

  /* ---- completing quests ---- */
  const finishQuest = id => { comp()[id] = Date.now(); S.active.delete(id); };
  function completeNow(id){
    const t = taskById(id), open = openIds();
    finishQuest(id); saveActive(); saveComp(); refresh(); reopenCards(open);
    if(t) toast('Completed \u201c' + t.name + '\u201d', true);
  }
  toggleDone = function(oid, val){
    const v = val === undefined ? !S.done.has(oid) : val;
    if(v) S.done.add(oid); else S.done.delete(oid);
    let fin = null;
    if(v){
      const t = [...S.active].map(taskById).find(t => t && t.objs.some(o => o.id === oid));
      if(t){ const req = t.objs.filter(o => !o.optional); if(req.length && req.every(o => S.done.has(o.id))) fin = t; }
    }
    if(fin) finishQuest(fin.id);
    saveActive(); saveComp();
    const open = openIds();
    refresh(); reopenCards(open);
    if(fin) toast('Completed \u201c' + fin.name + '\u201d', true);
  };

  /* ---- completed quests never come back through search or the trader lists ---- */
  const hideDone = fn => function(){
    const done = Object.keys(comp());
    if(!done.length) return fn.apply(this, arguments);
    const real = S.active; S.active = new Set([...real, ...done]);
    try{ return fn.apply(this, arguments); } finally { S.active = real; }
  };
  if(typeof updateSugg0 === 'function') updateSugg0 = hideDone(updateSugg0);
  if(typeof renderTraderBar === 'function'){
    const _tb = renderTraderBar;
    renderTraderBar = hideDone(function(){
      _tb.apply(this, arguments);
      const c = comp();
      document.querySelectorAll('#traderList .trow').forEach(r => { if(c[r.dataset.id]){ const ta = r.querySelector('.ta'); if(ta) ta.textContent = '\u2713 completed'; } });
    });
  }

  /* ---- quest cards: complete button + wiki link ---- */
  function decorateCards(){
    document.querySelectorAll('#quests .qcard').forEach(card => {
      const t = taskById(card.dataset.id); if(!t) return;
      const rm = card.querySelector('.rm');
      if(rm && !card.querySelector('.qdone')){
        const b = document.createElement('button');
        b.className = 'quiet qdone'; b.textContent = '\u2713'; b.title = 'Mark quest completed'; b.setAttribute('aria-label', 'Mark ' + t.name + ' completed');
        b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); completeNow(t.id); });
        rm.before(b);
      }
      const objs = card.querySelector('.objs');
      if(objs && !objs.querySelector('.qwiki')) objs.insertAdjacentHTML('afterbegin', '<div class="qwiki">' + wikiA(t, 'Wiki page') + '</div>');
    });
  }
  { const _rq = renderQuests;
    renderQuests = function(){
      if(!last || last.m !== S.mode){ last = snap(); lastSig = sigOf(last); hist.length = 0; }   /* first render, or game mode switched */
      _rq(); decorateCards(); updateHistUI();
    }; }

  /* ---- UI: undo + completed buttons, completed dialog, toast ---- */
  const bar = '<div class="histbar"><button id="undoBtn" disabled>\u21b6 Undo</button><button id="doneBtn" title="Quests you have finished">\u2713 Completed</button></div>';
  const anchor = document.querySelector('.sortbar') || $('#quests');
  anchor.insertAdjacentHTML('beforebegin', bar);
  document.body.insertAdjacentHTML('beforeend',
    '<dialog id="doneDlg"><div class="done-h"><h2>Completed quests</h2><input id="doneQ" type="search" placeholder="Filter by name or trader" autocomplete="off"></div>' +
    '<p class="muted" id="doneSub" style="margin:0"></p><div id="doneBody"></div>' +
    '<div class="row" style="justify-content:space-between;margin-top:0"><button id="doneClear" class="quiet">Clear history</button><button id="doneClose" class="primary">Close</button></div></dialog>' +
    '<div id="toast" role="status" hidden></div>');

  function updateHistUI(){
    const u = $('#undoBtn'), d = $('#doneBtn'); if(!u || !d) return;
    const top = hist[hist.length - 1];
    u.disabled = !top; u.title = top ? 'Undo: ' + top.label + ' (Ctrl+Z)' : 'Nothing to undo';
    const n = Object.keys(comp()).filter(taskById).length;
    d.textContent = '\u2713 Completed' + (n ? ' (' + n + ')' : '');
    if($('#doneDlg').open) renderDone();
  }
  function renderDone(){
    const c = comp(), q = norm($('#doneQ').value), words = q ? q.split(' ') : [];
    const all = Object.keys(c).map(id => ({ t:taskById(id), ts:c[id] })).filter(r => r.t);
    const rows = all.filter(r => words.every(w => norm(r.t.name + ' ' + r.t.trader).includes(w))).sort((a, b) => b.ts - a.ts);
    const xp = all.reduce((s, r) => s + (r.t.exp || 0), 0);
    const kTot = S.tasks.filter(t => t.kappa).length, kDone = all.filter(r => r.t.kappa).length;
    $('#doneSub').textContent = all.length ? all.length + ' completed \u00b7 ' + xp.toLocaleString() + ' XP \u00b7 Kappa quests: ' + kDone + ' of ' + kTot : '';
    $('#doneBody').innerHTML = rows.length ? rows.map(r =>
      '<div class="drow" data-id="' + esc(r.t.id) + '">' + avatarHTML(r.t.traderId || r.t.trader, 30) +
      '<span class="dn"><b>' + esc(r.t.name) + '</b><small>' + esc(r.t.trader) + (r.t.level ? ' \u00b7 level ' + r.t.level : '') + ' \u00b7 ' +
      esc(new Date(r.ts).toLocaleString([], { dateStyle:'medium', timeStyle:'short' })) + '</small></span>' +
      ((r.t.exp || 0) ? '<span class="dx">' + r.t.exp.toLocaleString() + ' XP</span>' : '') + wikiA(r.t) +
      '<button class="reopen" title="Put this quest back in your active list">Reopen</button></div>').join('')
      : '<div class="empty"><b>' + (all.length ? 'No matches' : 'Nothing completed yet') + '</b>' +
        (all.length ? 'Try a different search.' : 'Quests you complete are saved here. Use the \u2713 button on a quest, or tick its last objective.') + '</div>';
  }

  $('#undoBtn').addEventListener('click', undo);
  $('#doneBtn').addEventListener('click', () => { $('#doneQ').value = ''; $('#doneDlg').showModal(); renderDone(); });
  $('#doneClose').addEventListener('click', () => $('#doneDlg').close());
  $('#doneQ').addEventListener('input', renderDone);
  $('#doneClear').addEventListener('click', () => {
    if(!Object.keys(comp()).length || !confirm('Clear your completed-quest history?')) return;
    const c = comp(); Object.keys(c).forEach(k => delete c[k]);
    saveComp(); nextLabel = 'cleared completed history'; refresh();
  });
  $('#doneBody').addEventListener('click', e => {
    const b = e.target.closest('button.reopen'); if(!b) return;
    const id = b.closest('.drow').dataset.id;
    delete comp()[id]; S.active.add(id); saveActive(); saveComp(); refresh();
  });
  document.addEventListener('keydown', e => {
    if(!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
    if(/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || document.querySelector('dialog[open]')) return;
    e.preventDefault(); undo();
  });
  updateHistUI();
})();

"""

with open(path, encoding="utf-8") as f:
    src = f.read()
if "wireExtras" in src:
    print("Undo / completed quests / wiki links already applied - skipping.")
    sys.exit(0)
marker = "/* ============ wiring ============ */"
if src.count(marker) != 1:
    sys.exit("Could not patch: wiring marker not found exactly once. Is this the right HTML file?")
for needed in ("function normalizeTasks(", "function renderQuests", "function refresh(", "function toggleDone(",
               "function popupFor(", "function renderRoute(", "function renderTraderBar(", "function updateSugg0(",
               'id="quests"'):
    if needed not in src:
        sys.exit("Could not patch: missing " + needed + " - run patch_app.py, patch_prep.py and patch_traders.py first.")
shutil.copyfile(path, path + ".extras.bak")
with open(path, "w", encoding="utf-8") as f:
    f.write(src.replace(marker, JS + marker))
print("Patched", path, "(backup:", path + ".extras.bak)")
