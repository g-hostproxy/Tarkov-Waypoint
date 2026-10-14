"""Key route pins: show the key photo, the key to use, a wiki link and (when available) a door photo.

When you click a numbered key-route pin on the map, the bubble now shows for every lock at that stop:
  * a photo of the KEY that opens it, its name, and whether it is a door or a trunk / container (and "needs power")
  * a "Wiki" link for that key (opens the key's page on the Escape from Tarkov wiki; the wiki page has screenshots
    of where its doors are)
  * a photo of the DOOR, if you have one. The tarkov.dev data has no door photos, so this is optional: put a
    door_photos.json next to quest_data.json (see below) or add "photo" to a lock in quest_data.json.
    Without one, the bubble shows a "Door photos on the wiki" link instead of an empty picture box.
The same key photo + wiki link also appear in the key route list in the right panel.

door_photos.json format (lock id -> image url or data: uri; ids are the "id" of each entry in quest_data.json "locks"):
    { "2170d1b52aa6d61ee5d3a8f65183be4e0750e873": "https://example.com/factory-door.jpg" }
It is loaded if present and silently ignored if not. The single-file build does not embed it (links work online).

Usage:  python patch_keyinfo.py raid-route_work.html      (run after patch_ui.py; backup <file>.keyinfo.bak)
"""
import shutil
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "raid-route_3.html"

JS = r"""/* ============ key pins: key photo, wiki link, door photo ============ */
(function wireKeyInfo(){
  const st = document.createElement('style');
  st.textContent = `
.kpop{min-width:200px;max-width:260px}
.kpop .kp-h{font-weight:600;margin-bottom:4px}
.kpop .kp-l{margin:6px 0 0;padding-top:6px;border-top:1px solid #0002}
.kpop .kp-l:first-of-type{border-top:0;padding-top:0}
.kpop .kp-door{display:block;width:100%;max-height:150px;object-fit:cover;border-radius:4px;border:1px solid #0004;margin:0 0 5px;background:#2a2d28}
.kpop .kp-key{display:flex;gap:8px;align-items:center}
.kpop .kp-key b{display:block;color:#1c6f78;font-weight:600;line-height:1.2}
.kpop .kp-key small{display:block;opacity:.75;font-size:11px;margin-top:1px}
.kpop .kp-lab{font-size:10px;letter-spacing:.05em;text-transform:uppercase;opacity:.65;margin-bottom:2px}
.kpop .kp-links{margin-top:4px;display:flex;gap:10px;flex-wrap:wrap}
.kwiki{color:var(--accent);font-size:12px;text-decoration:none;white-space:nowrap}
.kwiki:hover{text-decoration:underline}
.ksteps .kwiki{margin-left:6px}
.ksteps img.ii{margin-right:5px}
`;
  document.head.appendChild(st);

  /* optional door photos: door_photos.json (lock id -> url). Missing file = no photos. */
  S.doorPhotos = {};
  if(typeof fetch === 'function' && location.protocol !== 'file:'){
    fetch('door_photos.json', { cache:'no-store' }).then(r => r.ok ? r.json() : {}).then(j => { if(j && typeof j === 'object') S.doorPhotos = j; }).catch(() => {});
  }
  { const _nl = normalizeLocks;
    normalizeLocks = function(raw){
      const out = _nl(raw), photo = {};
      (raw || []).forEach(m => (m.locks || []).forEach(l => { if(l.photo) photo[l.id] = l.photo; }));
      Object.keys(out).forEach(k => out[k].forEach(l => { if(photo[l.id]) l.photo = photo[l.id]; }));
      return out;
    }; }

  const wikiUrl = name => 'https://escapefromtarkov.fandom.com/wiki/' + encodeURIComponent(String(name).replace(/ /g, '_'));
  const wikiA = name => '<a class="kwiki" href="' + esc(wikiUrl(name)) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Open the wiki page for ' + esc(name) + '">Wiki \u2197</a>';
  const doorPhoto = l => l.photo || (S.doorPhotos && S.doorPhotos[l.id]) || '';

  function lockHTML(l){
    const ph = doorPhoto(l);
    const kind = l.type === 'trunk' ? 'Trunk / container' : 'Door';
    return '<div class="kp-l">' +
      (ph ? '<img class="kp-door" src="' + esc(ph) + '" alt="' + esc(kind) + ' opened by ' + esc(l.key) + '" loading="lazy" onerror="this.remove()">' : '') +
      '<div class="kp-lab">' + kind + (l.power ? ' \u00b7 needs power' : '') + ' \u2014 key to use</div>' +
      '<div class="kp-key">' + itemImg(l.keyId, 44) + '<div><b>' + esc(l.key) + '</b>' +
        '<small>Opens this ' + kind.toLowerCase() + '</small></div></div>' +
      '<div class="kp-links">' + wikiA(l.key) +
        (ph ? '' : '<a class="kwiki" href="' + esc(wikiUrl(l.key) + '#Location') + '" target="_blank" rel="noopener" title="No door photo stored. The wiki key page shows where its doors are.">Door photos on the wiki \u2197</a>') +
      '</div></div>';
  }

  { const _dk = drawKeys;
    drawKeys = function(){
      _dk();
      const r = S.map && S.curMap && S.opts.showKeys !== false ? keyRoute(S.curMap) : null;
      if(!r || !S.keyMarkers) return;
      r.stops.forEach((s, i) => {
        const mk = S.keyMarkers[i]; if(!mk) return;
        const el = document.createElement('div'); el.className = 'pop kpop';
        el.innerHTML = '<div class="kp-h">Key stop ' + (i + 1) + (s.items.length > 1 ? ' \u00b7 ' + s.items.length + ' locks here' : '') + '</div>' +
          s.items.map(it => lockHTML(it.g.lock)).join('');
        mk.setPopupContent(el);
      });
    }; }

  /* right-panel key route list: key photo + wiki link on each lock */
  function decorateList(){
    const r = S.curMap && S.opts.showKeys !== false && S.myKeys.size ? keyRoute(S.curMap) : null;
    if(!r) return;
    document.querySelectorAll('#keyroute .ksteps li[data-i]').forEach(li => {
      const s = r.stops[+li.dataset.i]; if(!s) return;
      li.querySelectorAll('.it').forEach((el, j) => {
        const it = s.items[j]; if(!it || el.querySelector('.kwiki')) return;
        el.insertAdjacentHTML('afterbegin', itemImg(it.g.lock.keyId, 24));
        el.insertAdjacentHTML('beforeend', wikiA(it.g.lock.key));
      });
    });
  }
  { const _rk = renderKeyRoute;
    renderKeyRoute = function(){ _rk(); decorateList(); }; }
})();

"""

with open(path, encoding="utf-8", newline="") as f:
    src = f.read()
if "wireKeyInfo" in src:
    print("Key pin info already applied - skipping.")
    sys.exit(0)
marker = "/* ============ wiring ============ */"
if src.count(marker) != 1:
    sys.exit("Could not patch: wiring marker not found exactly once. Is this the right HTML file?")
for needed in ("function drawKeys(", "function renderKeyRoute(", "function normalizeLocks(", "function itemImg("):
    if needed not in src:
        sys.exit("Could not patch: missing " + needed + " - run the earlier patches first (this one goes after patch_ui.py).")
shutil.copyfile(path, path + ".keyinfo.bak")
with open(path, "w", encoding="utf-8", newline="") as f:
    f.write(src.replace(marker, JS + marker))
print("Patched", path, "(backup:", path + ".keyinfo.bak)")
