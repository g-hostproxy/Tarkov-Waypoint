"""Add rare-item spawns and key spawns (high-value / quest / other) to the map legend.

What it adds, on every map:
  * Rare items       - gold star markers at loose-loot spawn points that can hold a rare item
                       (figurines, bitcoin, GPUs, LEDX, golden items ...). A "Choose which rare items"
                       list in the legend lets you hide individual items.
  * High-value keys  - Labs keycards, marked keys and a few other expensive keys.
  * Quest keys       - keys that any quest needs. A cyan ring marks keys your ACTIVE quests need.
  * Other keys       - every other key. (off by default - there are a lot of them)
  Click a marker to see which items can spawn there, with photos. Every layer has its own tick box in the
  Legend and your choices are remembered.

Also defines itemImg(id, px): the photo of an item (assets.tarkov.dev, or embedded by the offline build).

Needs quest_data.json built with the latest build_quest_data.py (it now has "loot" and "lootItems").
What counts as "rare" / "high value" is set by the lists near the top of build_quest_data.py.

Usage:  python patch_loot.py raid-route_3.html
(Run it after patch_legend.py. A backup is saved as <file>.loot.bak.)
"""
import shutil
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "raid-route_3.html"

JS = r"""/* ============ item photos + loot spawns (rare items, keys) ============ */
function itemIconUrl(id){
  const e = (typeof EMBEDDED_ICONS !== 'undefined' && EMBEDDED_ICONS) || null;
  return (e && e[id]) || ('https://assets.tarkov.dev/' + id + '-icon.webp');
}
function itemImg(id, px){
  px = px || 24;
  return '<img class="ii" src="' + esc(itemIconUrl(id)) + '" alt="" width="' + px + '" height="' + px + '" loading="lazy" onerror="this.remove()">';
}
(function wireLoot(){
  const st = document.createElement('style');
  st.textContent = `
img.ii{object-fit:contain;background:#2a2d28;border:1px solid #0007;border-radius:3px;flex:none;vertical-align:middle}
.lootm{background:none;border:0}
.lootm span{display:grid;place-items:center;width:18px;height:18px;color:#10130f;font:700 11px/1 var(--f-body);border:1.5px solid #0b1210;box-shadow:0 0 0 1px #000a}
.lootm.rare span{background:#f2c14e;border-radius:50%;font-size:12px}
.lootm.hv span{background:#e0568f;border-radius:4px;color:#fff}
.lootm.quest span{background:#8b6fd6;border-radius:4px;color:#fff}
.lootm.other span{background:#8a9a94;border-radius:4px}
.lootm.need span{box-shadow:0 0 0 2px #4fd1e0,0 0 0 3px #000}
.lootpop{max-width:280px}
.lootpop .lg{margin:6px 0 2px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;opacity:.7}
.lootpop .lti{display:flex;gap:6px;align-items:center;margin:2px 0;font-size:12px}
.lootpop .lti em{color:#0f7c8a;font-style:normal;font-size:11px}
.lootpop .note{font-size:11px;opacity:.7;margin-top:6px}
#legend{max-height:78vh;overflow-y:auto}
#legend .sw i.lt{display:grid;place-items:center;width:15px;height:15px;color:#10130f;font:700 10px/1 var(--f-body);border:1.5px solid #0b1210;box-shadow:0 0 0 1px #000a}
#legend .sw i.lt.rare{background:#f2c14e;border-radius:50%}
#legend .sw i.lt.hv{background:#e0568f;border-radius:3px;color:#fff}
#legend .sw i.lt.quest{background:#8b6fd6;border-radius:3px;color:#fff}
#legend .sw i.lt.other{background:#8a9a94;border-radius:3px}
#lgLoot{display:flex;flex-direction:column;gap:6px;margin-top:2px;border-top:1px solid var(--line);padding-top:6px}
#lgRareList{margin:-2px 0 0 21px}
#lgRareList>summary{cursor:pointer;color:var(--mute);font-size:12px}
#lgRareItems{display:flex;flex-direction:column;gap:3px;max-height:26vh;overflow-y:auto;margin-top:4px}
#lgRareItems .lgr{font-size:12px;gap:5px}
#lgRareItems .lgbtns{display:flex;gap:6px}
#lgRareItems .lgbtns button{padding:1px 8px;font-size:11px}
`;
  document.head.appendChild(st);

  /* ---- data: loot spawn points per map (day/night etc. merged like the extracts) ---- */
  S.loot = {}; S.lootItems = {};
  { const _ne = normalizeExtracts;
    normalizeExtracts = function(raw){
      S.loot = {}; S.lootItems = {};
      (raw || []).forEach(m => {
        const k = canon(m.normalizedName); if(!k || !SVG_FILES[k]) return;
        const arr = S.loot[k] = S.loot[k] || [];
        Object.assign(S.lootItems[k] = S.lootItems[k] || {}, m.lootItems || {});
        (m.loot || []).forEach(p => {
          if(p.x == null || p.z == null) return;
          const hit = arr.find(a => Math.abs(a.x - p.x) < 1 && Math.abs(a.z - p.z) < 1);
          if(hit) (p.i || []).forEach(i => { if(!hit.i.includes(i)) hit.i.push(i); });
          else arr.push({ x:p.x, y:p.y || 0, z:p.z, i:(p.i || []).slice() });
        });
      });
      return _ne(raw);
    }; }

  /* ---- categories: rare | hv (high-value key) | quest (key some quest needs) | other (key) ---- */
  const PRI = ['rare', 'hv', 'quest', 'other'];
  const OPT = { rare:'showRare', hv:'showHV', quest:'showQKeys', other:'showOKeys' };
  const LABEL = { rare:'Rare items', hv:'High-value keys', quest:'Quest keys', other:'Other keys' };
  const optOn = c => c === 'other' ? S.opts.showOKeys === true : S.opts[OPT[c]] !== false;
  const hiddenRare = () => S.opts.hideRare || (S.opts.hideRare = {});
  const catsOf = e => !e ? [] : e.c === 'rare' ? ['rare'] : e.c === 'hv' ? (e.q ? ['hv', 'quest'] : ['hv']) : (e.q ? ['quest'] : ['other']);
  /* the one category an item is listed under (first enabled one, in the order above) */
  const catOf = (id, meta) => {
    const e = meta[id]; if(!e) return null;
    if(e.c === 'rare' && hiddenRare()[id]) return null;
    const cs = catsOf(e); return PRI.find(c => cs.includes(c) && optOn(c)) || null;
  };

  function drawLoot(k){
    const meta = S.lootItems[k] || {};
    const need = typeof neededKeyNames === 'function' ? neededKeyNames() : new Map();
    (S.loot[k] || []).forEach(p => {
      const groups = {};
      p.i.forEach(id => { const c = catOf(id, meta); if(c) (groups[c] = groups[c] || []).push(id); });
      const top = PRI.find(c => groups[c]); if(!top) return;
      const wanted = [].concat(...PRI.map(c => groups[c] || [])).filter(id => meta[id].c !== 'rare' && need.has(meta[id].n));
      const glyph = top === 'rare' ? '\u2605' : top === 'other' ? 'k' : 'K';
      const el = document.createElement('div'); el.className = 'pop lootpop';
      let h = '<b>' + (top === 'rare' ? 'Rare item spawn' : 'Key spawn') + '</b>';
      PRI.forEach(c => {
        const ids = groups[c]; if(!ids) return;
        h += '<div class="lg">' + LABEL[c] + ' (' + ids.length + ')</div>' +
          ids.slice(0, 12).map(id => '<div class="lti">' + itemImg(id, 28) + '<span>' + esc(meta[id].n) +
            (need.has(meta[id].n) && c !== 'rare' ? ' <em>needed for your quests</em>' : '') + '</span></div>').join('') +
          (ids.length > 12 ? '<div class="lti"><span>+ ' + (ids.length - 12) + ' more</span></div>' : '');
      });
      h += '<div class="note">One spot in the loose-loot pool: any of these can spawn here, none is guaranteed.</div>';
      el.innerHTML = h;
      const all = [].concat(...PRI.map(c => groups[c] || []));
      const tip = all.slice(0, 3).map(id => meta[id].n).join(', ') + (all.length > 3 ? ' +' + (all.length - 3) + ' more' : '');
      L.marker([p.z, p.x], { icon:L.divIcon({ className:'lootm ' + top + (wanted.length ? ' need' : ''), html:'<span>' + glyph + '</span>', iconSize:[18, 18] }), zIndexOffset:-200 })
        .bindTooltip(tip).bindPopup(el).addTo(S.layer);
    });
  }

  /* ---- legend rows ---- */
  $('#lgBosses').insertAdjacentHTML('beforebegin',
    '<div id="lgLoot" title="Loose-loot spawn points only: keys can also be in containers or on Scavs. A cyan ring marks keys your active quests need.">' +
    '<label class="lgr"><input type="checkbox" data-l="showRare"><span class="sw"><i class="lt rare">\u2605</i></span>Rare items<span class="cnt" id="lgRareCnt"></span></label>' +
    '<details id="lgRareList"><summary>Choose which rare items</summary><div id="lgRareItems"></div></details>' +
    '<label class="lgr"><input type="checkbox" data-l="showHV"><span class="sw"><i class="lt hv">K</i></span>High-value keys<span class="cnt" id="lgHVCnt"></span></label>' +
    '<label class="lgr"><input type="checkbox" data-l="showQKeys"><span class="sw"><i class="lt quest">K</i></span>Quest keys<span class="cnt" id="lgQCnt"></span></label>' +
    '<label class="lgr"><input type="checkbox" data-l="showOKeys"><span class="sw"><i class="lt other">k</i></span>Other keys<span class="cnt" id="lgOCnt"></span></label>' +
    '</div>');

  function renderLootLegend(){
    const lg = $('#legend'); if(!lg || !$('#lgLoot')) return;
    const k = S.curMap, pts = S.loot[k] || [], meta = S.lootItems[k] || {};
    PRI.forEach(c => { const cb = lg.querySelector('[data-l="' + OPT[c] + '"]'); if(cb) cb.checked = optOn(c); });
    const cnt = { rare:0, hv:0, quest:0, other:0 }, rare = new Map();
    pts.forEach(p => {
      const seen = new Set();
      p.i.forEach(id => {
        const e = meta[id]; if(!e) return;
        catsOf(e).forEach(c => seen.add(c));
        if(e.c === 'rare') rare.set(id, (rare.get(id) || 0) + 1);
      });
      seen.forEach(c => cnt[c]++);
    });
    $('#lgRareCnt').textContent = cnt.rare || '';
    $('#lgHVCnt').textContent = cnt.hv || '';
    $('#lgQCnt').textContent = cnt.quest || '';
    $('#lgOCnt').textContent = cnt.other || '';
    const hid = hiddenRare();
    $('#lgRareItems').innerHTML = rare.size
      ? '<div class="lgbtns"><button class="quiet" data-all="1">All</button><button class="quiet" data-all="0">None</button></div>' +
        [...rare.entries()].sort((a, b) => meta[a[0]].n.localeCompare(meta[b[0]].n)).map(([id, n]) =>
          '<label class="lgr"><input type="checkbox" data-loot="' + esc(id) + '" ' + (hid[id] ? '' : 'checked') + '>' + itemImg(id, 20) +
          '<span>' + esc(meta[id].n) + '</span><span class="cnt">' + n + '</span></label>').join('')
      : '<span class="muted" style="font-size:12px">No rare item spawns on this map.</span>';
  }

  { const _do = drawOverlay;
    drawOverlay = function(){
      _do();
      if(S.map && S.layer) drawLoot(S.curMap);
      renderLootLegend();
    }; }

  /* per-item filter (capture phase so the choice is stored before the legend redraws the map) */
  $('#legend').addEventListener('change', e => {
    const t = e.target; if(!t || !t.dataset || !t.dataset.loot) return;
    if(t.checked) delete hiddenRare()[t.dataset.loot]; else hiddenRare()[t.dataset.loot] = true;
  }, true);
  $('#lgRareItems').addEventListener('click', e => {
    const b = e.target.closest('button[data-all]'); if(!b) return;
    const meta = S.lootItems[S.curMap] || {}, hid = hiddenRare();
    Object.keys(meta).forEach(id => { if(meta[id].c === 'rare'){ if(b.dataset.all === '1') delete hid[id]; else hid[id] = true; } });
    saveOpts();
    if(S.map) drawOverlay(); else renderLootLegend();
  });
  renderLootLegend();
})();

"""

with open(path, encoding="utf-8") as f:
    src = f.read()
if "wireLoot" in src:
    print("Loot spawns already applied - skipping.")
    sys.exit(0)
marker = "/* ============ wiring ============ */"
if src.count(marker) != 1:
    sys.exit("Could not patch: wiring marker not found exactly once. Is this the right HTML file?")
for needed in ("function normalizeExtracts(", "function drawOverlay(", "wireLegend", "const saveOpts"):
    if needed not in src:
        sys.exit("Could not patch: missing " + needed + " - run patch_app.py and patch_legend.py first.")
shutil.copyfile(path, path + ".loot.bak")
with open(path, "w", encoding="utf-8") as f:
    f.write(src.replace(marker, JS + marker))
print("Patched", path, "(backup:", path + ".loot.bak)")
