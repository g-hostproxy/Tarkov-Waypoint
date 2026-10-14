"""Always show the FULL quest in the right panel when any of its objectives must be done "in one raid".

The problem: a quest like Secrets of Polikhim has
    1. Use the transit from Customs to Factory (In one raid)
    2. Locate and obtain the precision tools package in the med lab on Customs
    3. Stash the package at the laboratory storage room on Factory
On the Customs map the right panel only showed the Customs part, so nothing warned you that the Factory
objective has to be finished in the same raid, and it was easy to fail the quest.

What this adds: when one of your selected quests has an objective that says "one raid" / "single raid", and the
quest still has something to do on the map you are viewing, the right panel gets a box
"Same-raid quests - full list" with EVERY objective of that quest (all maps), each with its map. The ones on the
map you are viewing are bold. Ticked-off objectives stay in the list, struck through. Optional objectives follow
the "optional" tick box. The map pins and the route still only show the current map (other maps cannot be drawn
on this one) - the box is what keeps the rest of the quest in front of you.

Transit quests (this version) - transit objectives, "in one raid" or not, are now part of the route:
  * "Use the transit from X to Y" gets a pin on the transit point of the map you are viewing, and it is always the
    LAST stop of that map's route (you leave the map after everything else there is done). The extract step is
    dropped in that case, because the transit is how you leave. Under it the route lists what the quest still needs
    on the next map ("Continue on Factory: ...").
  * Quest objectives are put in the order you do them: everything on the first map, then its transit, then the
    next map ... (only quests that contain a transit are reordered; this affects the left list, the full-quest box
    and the pre-raid check alike).

Usage:  python patch_chain.py raid-route_work.html
(Run it LAST, after patch_fixes.py. A backup is saved as <file>.chain.bak.)
"""
import shutil
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "raid-route_3.html"

JS = r"""/* ============ transits: route stop + quest order ============ */
(function wireTransits(){
  const st = document.createElement('style');
  st.textContent = `
.cont{margin:3px 0 1px;padding:3px 6px;border-left:3px solid #b57be0;background:rgba(181,123,224,.10);font-size:12px;line-height:1.3}
.cont b{font-weight:600}
`;
  document.head.appendChild(st);

  const ALIAS = {};
  Object.keys(MAP_LABEL).forEach(k => { ALIAS[k] = k; ALIAS[MAP_LABEL[k].toLowerCase()] = k; });
  Object.assign(ALIAS, { 'streets of tarkov':'streets-of-tarkov', 'the lab':'the-lab', 'labs':'the-lab', 'terragroup labs':'the-lab', 'ground zero 21+':'ground-zero' });
  const mapFrom = s => ALIAS[String(s || '').trim().toLowerCase()] || null;
  const TRANSIT = /\btransit from (.+?) to (.+?)\s*(?:\(|$)/i;

  /* 1) tag transit objectives; 2) put each quest's objectives in the order they are done */
  function reorder(t){
    const trs = t.objs.filter(o => o.transit);
    if(!trs.length) return;
    const stage = {};
    trs.forEach(o => { stage[o.transit.from] = 0; stage[o.transit.to] = 0; });
    const nMaps = Object.keys(stage).length;
    for(let i = 0; i <= nMaps; i++) trs.forEach(o => { stage[o.transit.to] = Math.max(stage[o.transit.to], stage[o.transit.from] + 1); });
    if(Object.values(stage).some(v => v >= nMaps)) return;                 /* A -> B -> A: no clear order, leave it as the data has it */
    const key = (o, i) => {
      if(o.transit) return { s:stage[o.transit.from], x:1, i };
      let ms = [...o.maps];
      if(!ms.length && !o.nonmap){ const m = /\bon ([A-Za-z' ]+?)\s*(?:\(|$)/.exec(o.desc || ''), k = m && mapFrom(m[1]); if(k) ms = [k]; }   /* "... on Streets of Tarkov" */
      if(ms.length !== 1 || !(ms[0] in stage)) return null;               /* hand-ins, any-map objectives ... keep their place */
      return { s:stage[ms[0]], x:o.type === 'extract' ? 1 : 0, i };
    };
    const ks = t.objs.map(key);
    const slots = ks.map((k, i) => k ? i : -1).filter(i => i >= 0);
    const sorted = slots.map(i => ({ o:t.objs[i], k:ks[i] })).sort((a, b) => a.k.s - b.k.s || a.k.x - b.k.x || a.k.i - b.k.i);
    const out = t.objs.slice();
    slots.forEach((slot, n) => { out[slot] = sorted[n].o; });
    t.objs = out;
  }
  { const _nt = normalizeTasks;
    normalizeTasks = function(raw){
      const out = _nt(raw);
      out.forEach(t => {
        t.objs.forEach(o => {
          if(o.type !== 'extract') return;
          const m = TRANSIT.exec(o.desc || ''); if(!m) return;
          const from = mapFrom(m[1]), to = mapFrom(m[2]); if(!from || !to) return;
          o.transit = { from, to, toLabel:m[2].trim() };
          o.maps = new Set([from]); o.flex = false;                       /* it happens on the map you leave, not on the one you arrive at */
        });
        reorder(t);
      });
      return out;
    }; }

  /* where the transit is: the transit point on the "from" map that leads to the "to" map */
  function resolveTransits(){
    (S.tasks || []).forEach(t => t.objs.forEach(o => {
      const tr = o.transit; if(!tr || (o.pts[tr.from] && o.pts[tr.from].length)) return;
      const ex = ((S.extracts && S.extracts[tr.from]) || []).filter(e => e.faction === 'transit');
      const to = tr.toLabel.toLowerCase();
      let hit = ex.filter(e => String(e.name).toLowerCase() === 'transit to ' + to);
      if(!hit.length) hit = ex.filter(e => String(e.name).toLowerCase().includes(to));
      if(hit.length) o.pts[tr.from] = hit.map(e => ({ x:e.p.x, y:e.p.y || 0, z:e.p.z }));
    }));
  }
  { const _an = analyze;
    analyze = function(){ resolveTransits(); return _an.apply(this, arguments); }; }

  /* the transit is always the last stop; the extract step is not needed because the transit is the way out */
  { const _br = buildRoute;
    buildRoute = function(a){
      const isT = g => g.o && g.o.transit;
      const tg = a.groups.filter(isT), rest = a.groups.filter(g => !isT(g));
      if(!tg.length) return _br(a);
      const r = rest.length ? _br(Object.assign({}, a, { groups:rest })) : { stops:[], len:0, exit:null };
      const left = tg.slice();
      while(left.length){
        const last = r.stops.length ? r.stops[r.stops.length - 1].p : null;
        let bi = 0, bp = null, bd = Infinity;
        left.forEach((g, i) => g.pts.forEach(p => { const d = last ? dist(last, p) : 0; if(d < bd){ bd = d; bi = i; bp = p; } }));
        const g = left.splice(bi, 1)[0];
        const prev = r.stops[r.stops.length - 1];
        if(prev && prev.transit && dist(prev.p, bp) < 25){ prev.items.push({ g, p:bp }); continue; }   /* two quests, same transit */
        if(last) r.len += bd;
        r.stops.push({ p:bp, items:[{ g, p:bp }], transit:true });
      }
      r.exit = null;
      return r;
    }; }

  /* under a transit step: what the quest still needs on the map you arrive at */
  function addContinuation(){
    const an = S.an, k = S.curMap, a = an && k && an.A[k];
    if(!a || !a.route) return;
    document.querySelectorAll('#route .steps li[data-i]').forEach(li => {
      const stop = a.route.stops[+li.dataset.i]; if(!stop || !stop.transit) return;
      li.querySelectorAll('.it').forEach((el, j) => {
        const it = stop.items[j], o = it && it.g.o, t = it && it.g.t; if(!o || !o.transit || el.querySelector('.cont')) return;
        const to = o.transit.to;
        const next = t.objs.filter(x => x !== o && x.maps.has(to) && !x.transit && !S.done.has(x.id) && (S.opts.optional || !x.optional));
        el.insertAdjacentHTML('beforeend', '<div class="cont"><b>Then on ' + esc(MAP_LABEL[to] || to) + (/one raid|single raid/i.test(o.desc) ? ' (same raid)' : '') + ':</b> ' +
          (next.length ? next.map(x => esc(x.desc)).join(' · ') : 'nothing more for this quest') + '</div>');
      });
    });
  }
  { const _rr = renderRoute;
    renderRoute = function(){ _rr(); addContinuation(); }; }
})();

/* ============ same-raid quests: show the full quest ============ */
(function wireRaidQuests(){
  const st = document.createElement('style');
  st.textContent = `
.oneraid .oq{margin:8px 0 4px}
.oneraid .oq-n{display:flex;align-items:center;gap:6px;font-weight:600}
.oneraid ol{margin:3px 0 0;padding-left:22px;font-size:13px;line-height:1.35}
.oneraid li{margin:2px 0}
.oneraid li.here{font-weight:600}
.oneraid li.done{opacity:.5;text-decoration:line-through;font-weight:400}
`;
  document.head.appendChild(st);

  const ONE = /\b(one|single) raid\b/i;
  const visible = (t, o) => S.opts.optional || !o.optional || S.done.has(o.id);
  const pretty = m => MAP_LABEL[m] || String(m).split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');

  function addRaidQuests(){
    const box = $('#route'), an = S.an, k = S.curMap, a = an && k && an.A[k];
    if(!box || !a) return;
    const old = box.querySelector('.oneraid'); if(old) old.remove();
    /* quests with a remaining one-raid objective that still have something to do on this map */
    const qs = an.act.filter(t => (a.full.has(t.id) || a.part.has(t.id)) &&
      t.objs.some(o => (ONE.test(o.desc) || o.transit) && !S.done.has(o.id) && visible(t, o)));
    if(!qs.length) return;
    const html = '<div class="listbox oneraid"><h3>Same-raid quests \u2014 full list</h3>' +
      '<div class="muted">These quests continue on another map (or must be finished in one raid). ' +
      'Everything each quest needs is listed in order, including the parts on other maps.</div>' +
      qs.map(t => '<div class="oq"><div class="oq-n"><span class="swatch" style="display:inline-block;background:' + qColor(t) + '"></span>' + esc(t.name) + '</div><ol>' +
        t.objs.filter(o => visible(t, o)).map(o => {
          const where = o.transit ? pretty(o.transit.from) + ' \u2192 ' + pretty(o.transit.to) : [...o.maps].map(pretty).join(', ');
          return '<li class="' + (o.maps.has(k) ? 'here' : '') + ' ' + (S.done.has(o.id) ? 'done' : '') + '">' + esc(o.desc) +
            (where ? ' <span class="tag">' + esc(where) + '</span>' : '') + (o.optional ? ' <span class="tag opt">optional</span>' : '') + '</li>';
        }).join('') + '</ol></div>').join('') + '</div>';
    const first = box.querySelector('.listbox');
    if(first) first.insertAdjacentHTML('beforebegin', html); else box.insertAdjacentHTML('beforeend', html);
  }
  { const _rr = renderRoute;
    renderRoute = function(){ _rr(); addRaidQuests(); }; }

  /* click a pin: the popup lists the WHOLE quest in order, so a transit or other-map step cannot be missed */
  const st2 = document.createElement('style');
  st2.textContent = `
.fullq{margin:6px 0 2px;padding:5px 7px;border-left:3px solid #b57be0;background:rgba(181,123,224,.10);font-size:12px;line-height:1.3}
.fullq .fq-h{font-weight:600;margin-bottom:2px}
.fullq ol{margin:2px 0 0;padding-left:18px}
.fullq li{margin:2px 0}
.fullq li.here{font-weight:600}
.fullq li.done{opacity:.5;text-decoration:line-through;font-weight:400}
.fullq .tag{margin-left:4px}
`;
  document.head.appendChild(st2);
  function fullQuestHTML(t, cur){
    if(!t.objs.some(o => (ONE.test(o.desc) || o.transit) && !S.done.has(o.id) && visible(t, o))) return '';
    return '<div class="fullq"><div class="fq-h">Full quest — do in this order' + (t.objs.some(o => ONE.test(o.desc)) ? ' (some steps must be in one raid)' : '') + '</div><ol>' +
      t.objs.filter(o => visible(t, o)).map(o => {
        const where = o.transit ? pretty(o.transit.from) + ' → ' + pretty(o.transit.to) : [...o.maps].map(pretty).join(', ');
        return '<li class="' + (o === cur ? 'here' : '') + ' ' + (S.done.has(o.id) ? 'done' : '') + '">' + esc(o.desc) +
          (where ? ' <span class="tag">' + esc(where) + '</span>' : '') + (o === cur ? ' <span class="tag">this pin</span>' : '') + '</li>';
      }).join('') + '</ol></div>';
  }
  { const _pf = popupFor;
    popupFor = function(items, extra){
      const el = _pf(items, extra);
      const rows = el.querySelectorAll('.pi'), seen = new Set();
      items.forEach((it, i) => {
        if(!rows[i] || seen.has(it.t.id)) return;
        const h = fullQuestHTML(it.t, it.o); if(!h) return;
        seen.add(it.t.id);
        const b = rows[i].querySelector('button');
        if(b) b.insertAdjacentHTML('beforebegin', h); else rows[i].insertAdjacentHTML('beforeend', h);
      });
      return el;
    }; }
})();

"""

# newline='' keeps the file's existing line endings exactly as they are
with open(path, encoding="utf-8", newline="") as f:
    src = f.read()
if "wireTransits" in src:
    print("Same-raid quests already applied - skipping.")
    sys.exit(0)
if "wireRaidQuests" in src:
    sys.exit("This file has the previous version of this patch. Rebuild from scratch with build_all.bat.")
if "wireChain" in src:
    sys.exit("This file has the OLD version of this patch (small box under the transit). Rebuild from scratch with build_all.bat.")
marker = "/* ============ wiring ============ */"
if src.count(marker) != 1:
    sys.exit("Could not patch: wiring marker not found exactly once. Is this the right HTML file?")
for needed in ("function renderRoute(", "function analyze(", "function buildRoute(", "function normalizeTasks(", "function popupFor(", "wireFixes", "const qColor", "const MAP_LABEL"):
    if needed not in src:
        sys.exit("Could not patch: missing " + needed + " - run the earlier patches first (this one goes last, after patch_fixes.py).")
shutil.copyfile(path, path + ".chain.bak")
with open(path, "w", encoding="utf-8", newline="") as f:
    f.write(src.replace(marker, JS + marker))
print("Patched", path, "(backup:", path + ".chain.bak)")
