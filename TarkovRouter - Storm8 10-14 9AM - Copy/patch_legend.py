"""Add a map legend with PMC spawns, boss spawns and extracts (each can be toggled) to raid-route_3.html.

What it adds, on every map:
  * PMC spawns   - small white dots at every point a PMC can spawn.
  * Boss spawns  - red skull markers where bosses (and boss-like groups such as Raiders, Rogues,
                   Cultists, Goons' Knight) can spawn. Click one for names, spawn chance and zone.
                   Bosses that have no fixed spawn point on the map are still listed in the legend.
  * Extracts     - extract diamonds with their names always shown next to them, plus tick boxes for
                   PMC exits, Scav exits and transits (circles). The old "Extracts" tick box is replaced by
                   the legend. "Spawn as" still decides which exit the route ends at.
  * A legend box at the top right of the map with a tick box for each layer, plus one for every boss on
    the current map. Your choices are remembered.

Needs quest_data.json built with the latest build_quest_data.py (it now includes spawns and bosses).

Usage:  python patch_legend.py raid-route_3.html
(Run it after patch_app.py. A backup is saved as <file>.legend.bak.)
"""
import shutil
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "raid-route_3.html"

JS = r"""/* ============ legend: PMC spawns, boss spawns, extracts ============ */
(function wireLegend(){
  const st = document.createElement('style');
  st.textContent = `
#legend{min-width:210px;max-width:260px;padding:0}
#legend>summary{list-style:none;cursor:pointer;padding:6px 10px;font:600 15px var(--f-head);letter-spacing:.04em;text-transform:uppercase}
#legend>summary::-webkit-details-marker{display:none}
#legend>summary::after{content:' \u25be';color:var(--mute)}
#legend:not([open])>summary::after{content:' \u25b8'}
#legend .lgb{padding:0 10px 8px;display:flex;flex-direction:column;gap:6px}
#legend .lgr{display:flex;gap:7px;align-items:center;cursor:pointer}
#legend .lgr .cnt{margin-left:auto;color:var(--mute);font-size:12px;white-space:nowrap}
#legend .lgr.dis{opacity:.55;cursor:default}
#legend small{display:block;color:var(--mute);font-size:12px;line-height:1.3;margin:0 0 0 21px}
#legend .sw{flex:none;width:16px;display:inline-flex;justify-content:center;align-items:center;gap:2px}
#legend .sw i.d{display:block;width:8px;height:8px;transform:rotate(45deg);border:1.5px solid #fff;box-shadow:0 0 0 1px #000}
#legend .sw i.d.pmc{background:#58c47a}#legend .sw i.d.scav{background:#5ba3e0}#legend .sw i.d.shared{background:#e0a24a}
#legend .sw i.dot{display:block;width:9px;height:9px;border-radius:50%;background:#e9e4d4;border:1px solid #0b1210}
#legend .sw i.sk{display:grid;place-items:center;width:15px;height:15px;border-radius:50%;background:#c0352b;border:1.5px solid #fff;box-shadow:0 0 0 1px #000;color:#fff;font:normal 9px/1 var(--f-body)}
#legend .sw i.d.transit{background:#b57be0;border-radius:50%;transform:none}
#lgEx{display:flex;flex-direction:column;gap:5px;margin:-2px 0 0 21px}
.extx{background:none;border:0}
.extx .dm{position:absolute;left:0;top:0;display:block;width:13px;height:13px;transform:rotate(45deg);border:2px solid #fff;box-shadow:0 0 0 1px #000}
.extx.pmc .dm{background:#58c47a}.extx.scav .dm{background:#5ba3e0}.extx.shared .dm{background:#e0a24a}
.extx.transit .dm{background:#b57be0;border-radius:50%;transform:none}
.extx .xl{position:absolute;left:24px;top:50%;transform:translateY(-50%);white-space:nowrap;pointer-events:none;background:rgba(10,16,14,.6);color:#e9e4d4;font:600 10px/1.1 var(--f-body);letter-spacing:.02em;padding:1px 4px;border-radius:3px}
#lgBosses{display:flex;flex-direction:column;gap:5px;max-height:34vh;overflow-y:auto;padding-left:0;margin-top:2px;border-top:1px solid var(--line);padding-top:6px}
#lgBosses:empty{display:none}
.bossm{background:none;border:0}
.bossm span{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#c0352b;border:2px solid #fff;box-shadow:0 0 0 1px #000;color:#fff;font-size:12px;line-height:1}
`;
  document.head.appendChild(st);

  /* ---- data: spawns and bosses per map (day/night factory etc. are merged like the extracts) ---- */
  S.spawns = {}; S.bosses = {};
  { const _ne = normalizeExtracts;
    normalizeExtracts = function(raw){
      S.spawns = {}; S.bosses = {};
      (raw || []).forEach(m => {
        const k = canon(m.normalizedName); if(!k || !SVG_FILES[k]) return;
        const sa = S.spawns[k] = S.spawns[k] || [];
        (m.spawns || []).forEach(p => { if(p && p.x != null && !sa.some(a => Math.abs(a.x - p.x) < 1 && Math.abs(a.z - p.z) < 1)) sa.push({ x:p.x, y:p.y || 0, z:p.z }); });
        const variant = /night/.test(m.normalizedName || '') ? 'night raid' : /-21$/.test(m.normalizedName || '') ? 'level 21+' : '';
        const ba = S.bosses[k] = S.bosses[k] || [];
        (m.bosses || []).forEach(b => ba.push(Object.assign({}, b, { variant })));
      });
      return _ne(raw);
    }; }

  const pct = c => c == null ? '' : Math.round(c * 100) + '%';
  const hidden = () => S.opts.hideBoss || (S.opts.hideBoss = {});
  const on = key => S.opts[key] !== false;

  /* ---- drawing ---- */
  function drawLayers(k){
    if(on('showSpawns')) (S.spawns[k] || []).forEach(p => {
      L.circleMarker([p.z, p.x], { radius:4, color:'#0b1210', weight:1, fillColor:'#e9e4d4', fillOpacity:.9 })
        .bindTooltip('PMC spawn').addTo(S.layer).bringToBack();
    });
    if(on('showBosses')){
      /* entries that share the same spawn points form one zone; big zones get one marker plus an outline */
      const zones = new Map();
      (S.bosses[k] || []).forEach(b => {
        if(hidden()[b.mob] || !(b.positions || []).length) return;
        const sig = b.positions.map(p => Math.round(p.x) + ',' + Math.round(p.z)).sort().join(';');
        if(!zones.has(sig)) zones.set(sig, { pos:b.positions, list:[] });
        zones.get(sig).list.push(b);
      });
      const hull = pts => {
        const P = pts.map(p => [p.x, p.z]).sort((a, c) => a[0] - c[0] || a[1] - c[1]);
        if(P.length < 3) return P;
        const cr = (o, a, c) => (a[0] - o[0]) * (c[1] - o[1]) - (a[1] - o[1]) * (c[0] - o[0]);
        const lo = [], up = [];
        P.forEach(p => { while(lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
        [...P].reverse().forEach(p => { while(up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); });
        return lo.slice(0, -1).concat(up.slice(0, -1));
      };
      zones.forEach(z => {
        const seen = new Set(), rows = [];
        z.list.forEach(b => {
          const line = '<div class="pi"><b>' + esc(b.name) + (b.variant ? ' <span class="muted">(' + esc(b.variant) + ')</span>' : '') + '</b>' +
            (b.chance != null ? pct(b.chance) + ' spawn chance' : '') + (b.zone ? ' \u00b7 ' + esc(b.zone) + (b.zoneChance != null && b.zoneChance < 1 ? ' (' + pct(b.zoneChance) + ' of spawns)' : '') : '') + '</div>';
          if(!seen.has(line)){ seen.add(line); rows.push(line); }
        });
        const names = [...new Set(z.list.map(b => b.name))].join(', ');
        const big = z.pos.length > 3;
        const head = '<b>Boss spawn' + (big ? ' area' : '') + '</b>' + (big ? '<div class="muted">' + z.pos.length + ' possible spawn points</div>' : '');
        const at = big ? cent(z.pos) : null;
        if(big){
          const h = hull(z.pos);
          if(h.length > 2) L.polygon(h.map(q => [q[1], q[0]]), { color:'#e8453c', weight:1.5, dashArray:'5 4', opacity:.85, fillOpacity:.08, interactive:false }).addTo(S.layer).bringToBack();
        }
        (big ? [at] : z.pos).forEach(p =>
          L.marker([p.z, p.x], { icon:L.divIcon({ className:'bossm', html:'<span>\u2620</span>', iconSize:[22,22] }), zIndexOffset:-300 })
            .bindTooltip(names).bindPopup('<div class="pop">' + head + rows.join('') + '</div>').addTo(S.layer));
      });
    }
  }
  /* ---- extracts: PMC / Scav / transit toggles; the name is part of the marker so it always stays ---- */
  const exOn = key => S.opts[key] === undefined
    ? (key === 'showScavEx' ? S.opts.faction === 'scav' : key === 'showPmcEx' ? S.opts.faction !== 'scav' : true)
    : S.opts[key] !== false;
  const exShown = e => e.faction === 'pmc' ? exOn('showPmcEx') : e.faction === 'scav' ? exOn('showScavEx')
    : e.faction === 'transit' ? exOn('showTransit') : (exOn('showPmcEx') || exOn('showScavEx'));      /* shared = open to both */
  const EX_KIND = { pmc:'PMC exit', scav:'Scav exit', shared:'Shared exit (PMC and Scav)', transit:'Transit to another map' };
  function drawExtracts(k){
    const old = [];
    S.layer.eachLayer(l => { const ic = l instanceof L.Marker && l.options && l.options.icon; if(ic && /^ext\b/.test(ic.options.className || '')) old.push(l); });
    old.forEach(l => S.layer.removeLayer(l));
    if(!S.opts.extracts) return;
    (S.extracts[k] || []).filter(exShown).forEach(e =>
      L.marker([e.p.z, e.p.x], { icon:L.divIcon({ className:'extx ' + e.faction, html:'<i class="dm"></i><b class="xl">' + esc(e.name) + '</b>', iconSize:[16, 16] }), zIndexOffset:-500 })
        .bindPopup('<div class="pop"><b>' + esc(e.name) + '</b>' + (EX_KIND[e.faction] || '') + '</div>').addTo(S.layer));
  }
  { const _do = drawOverlay;
    drawOverlay = function(){
      _do();
      if(S.map && S.layer){ drawExtracts(S.curMap); drawLayers(S.curMap); }
      renderLegend();
    }; }

  /* ---- legend UI ---- */
  $('#viewtools').insertAdjacentHTML('afterbegin',
    '<details class="pill" id="legend" open><summary>Legend</summary><div class="lgb">' +
    '<label class="lgr"><input type="checkbox" data-l="extracts"><span class="sw"><i class="d pmc"></i><i class="d scav"></i><i class="d transit"></i></span>Extracts</label>' +
    '<div id="lgEx">' +
    '<label class="lgr"><input type="checkbox" data-l="showPmcEx"><span class="sw"><i class="d pmc"></i></span>PMC exits<span class="cnt" id="lgPmcCnt"></span></label>' +
    '<label class="lgr"><input type="checkbox" data-l="showScavEx"><span class="sw"><i class="d scav"></i></span>Scav exits<span class="cnt" id="lgScavCnt"></span></label>' +
    '<label class="lgr"><input type="checkbox" data-l="showTransit"><span class="sw"><i class="d transit"></i></span>Transits<span class="cnt" id="lgTrCnt"></span></label>' +
    '<small>Orange exits are open to both and show with PMC or Scav. Switching "Spawn as" resets PMC / Scav.</small></div>' +
    '<label class="lgr"><input type="checkbox" data-l="showSpawns"><span class="sw"><i class="dot"></i></span>PMC spawns<span class="cnt" id="lgSpawnCnt"></span></label>' +
    '<label class="lgr"><input type="checkbox" data-l="showBosses"><span class="sw"><i class="sk">\u2620</i></span>Boss spawns<span class="cnt" id="lgBossCnt"></span></label>' +
    '<div id="lgBosses"></div></div></details>');
  { const old = $('#optExt'); if(old && old.closest('label')) old.closest('label').style.display = 'none'; }

  function renderLegend(){
    const lg = $('#legend'); if(!lg) return;
    const k = S.curMap, sp = (S.spawns && S.spawns[k]) || [], bs = (S.bosses && S.bosses[k]) || [];
    lg.querySelector('[data-l="extracts"]').checked = !!S.opts.extracts;
    ['showPmcEx', 'showScavEx', 'showTransit'].forEach(key => { const cb = lg.querySelector('[data-l="' + key + '"]'); if(cb) cb.checked = exOn(key); });
    const ec = { pmc:0, scav:0, shared:0, transit:0 };
    (S.extracts[k] || []).forEach(e => { if(e.faction in ec) ec[e.faction]++; });
    $('#lgPmcCnt').textContent = (ec.pmc + ec.shared) || '';
    $('#lgScavCnt').textContent = (ec.scav + ec.shared) || '';
    $('#lgTrCnt').textContent = ec.transit || '';
    lg.querySelector('[data-l="showSpawns"]').checked = on('showSpawns');
    lg.querySelector('[data-l="showBosses"]').checked = on('showBosses');
    $('#lgSpawnCnt').textContent = sp.length || '';
    const g = new Map();
    bs.forEach(b => {
      if(!g.has(b.mob)) g.set(b.mob, { mob:b.mob, name:b.name, chances:new Set(), zones:new Set(), pos:0, variants:new Set() });
      const r = g.get(b.mob);
      if(b.chance != null) r.chances.add(b.chance);
      if(b.zone) r.zones.add(b.zone);
      if(b.variant) r.variants.add(b.variant);
      r.pos += (b.positions || []).length;
    });
    $('#lgBossCnt').textContent = g.size || '';
    const fm = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.boss;
    $('#lgBosses').innerHTML = [...g.values()].sort((a, b) => Math.max(...b.chances) - Math.max(...a.chances) || a.name.localeCompare(b.name)).map(r => {
      const ch = [...r.chances].sort((a, b) => b - a).map(pct).join(' / ');
      const none = !r.pos;
      return '<div><label class="lgr ' + (none ? 'dis' : '') + '" title="' + (none ? 'No fixed spawn point on the map for this boss' : 'Show or hide ' + esc(r.name)) + '">' +
        '<input type="checkbox" data-boss="' + esc(r.mob) + '" ' + (none || hidden()[r.mob] ? '' : 'checked') + ' ' + (none ? 'disabled' : '') + '>' +
        '<span><b>' + esc(r.name) + '</b></span><span class="cnt">' + esc(ch) + '</span></label>' +
        '<small>' + esc([...r.zones].join(', ')) + (r.variants.size ? ' \u00b7 ' + esc([...r.variants].join(', ')) : '') + (none ? ' \u00b7 no map position' : '') + '</small></div>';
    }).join('');
    if(fm){ const el = lg.querySelector('[data-boss="' + CSS.escape(fm) + '"]'); if(el) el.focus(); }
  }
  $('#legend').addEventListener('change', e => {
    const t = e.target; if(!t || t.type !== 'checkbox') return;
    if(t.dataset.boss){ if(t.checked) delete hidden()[t.dataset.boss]; else hidden()[t.dataset.boss] = true; }
    else if(t.dataset.l === 'extracts'){ S.opts.extracts = t.checked; const o = $('#optExt'); if(o) o.checked = t.checked; }
    else if(t.dataset.l){ S.opts[t.dataset.l] = t.checked; }
    saveOpts();
    if(S.map) drawOverlay(); else renderLegend();
  });
  $('#optFac').addEventListener('change', e => { const sc = e.target.value === 'scav'; S.opts.showPmcEx = !sc; S.opts.showScavEx = sc; });
  renderLegend();
})();

"""

with open(path, encoding="utf-8") as f:
    src = f.read()
if "wireLegend" in src:
    print("Legend already applied - skipping.")
    sys.exit(0)
marker = "/* ============ wiring ============ */"
if src.count(marker) != 1:
    sys.exit("Could not patch: wiring marker not found exactly once. Is this the right HTML file?")
for needed in ("function normalizeExtracts(", "function drawOverlay(", 'id="viewtools"', 'id="optExt"'):
    if needed not in src:
        sys.exit("Could not patch: missing " + needed + " - run patch_app.py first and use the r4 HTML.")
shutil.copyfile(path, path + ".legend.bak")
with open(path, "w", encoding="utf-8") as f:
    f.write(src.replace(marker, JS + marker))
print("Patched", path, "(backup:", path + ".legend.bak)")
