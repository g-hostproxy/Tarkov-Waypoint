"""Build quest_data.json for Raid Route from the json.tarkov.dev downloads.

Needs these files in the same folder (download them from json.tarkov.dev):
    tasks.json  tasks_en.json  maps_data.json  maps_en.json  traders_en.json  items_en.json
Optional (for trader photos):
    traders.json
Usage:
    python build_quest_data.py
"""
import json
import re
import sys


def load(name, hint=None):
    try:
        with open(name, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        sys.exit("Missing file: " + name + ("\n" + hint if hint else ""))


tasks_raw = load("tasks.json")["data"]["tasks"]
maps_raw = load("maps_data.json")["data"]["maps"]
mobs_raw = load("maps_data.json")["data"].get("mobs") or {}
tasks_tr = load("tasks_en.json")["data"]
maps_tr = load("maps_en.json")["data"]
traders_tr = load("traders_en.json")["data"]
items_tr = load(
    "items_en.json",
    "Download it in PowerShell:\n  Invoke-WebRequest https://json.tarkov.dev/regular/items_en -OutFile items_en.json",
)["data"]

traders_raw = {}
try:
    with open("traders.json", encoding="utf-8") as f:
        _d = json.load(f)
    _d = _d.get("data", _d)
    _t = _d.get("traders", _d) if isinstance(_d, dict) else _d
    if isinstance(_t, dict):
        traders_raw = {k: v for k, v in _t.items() if isinstance(v, dict)}
    elif isinstance(_t, list):
        traders_raw = {x["id"]: x for x in _t if isinstance(x, dict) and x.get("id")}
except FileNotFoundError:
    print("Note: traders.json not found - trader photos will show initials instead.\n"
          "  (PowerShell: Invoke-WebRequest https://json.tarkov.dev/regular/traders -OutFile traders.json)")


def trader_image(tid):
    t = traders_raw.get(tid) or {}
    for k in ("imageLink", "image4xLink", "image", "imageUrl"):
        v = t.get(k)
        if isinstance(v, str) and v.startswith("http"):
            return v
    return ""


map_name = {mid: m.get("normalizedName") for mid, m in maps_raw.items()}


def canon_map(n):
    """Same grouping the page uses: day/night Factory and the Ground Zero variants are one map."""
    if not n:
        return None
    return "factory" if "factory" in n else "ground-zero" if n.startswith("ground-zero") else n


# key id -> the maps where that key actually opens something (from the lock data)
key_maps = {}
for _m in maps_raw.values():
    for _l in _m.get("locks") or []:
        if _l.get("key"):
            key_maps.setdefault(str(_l["key"]), set()).add(canon_map(_m.get("normalizedName")))
unresolved = set()


def tr(table, key, fallback=""):
    v = table.get(key)
    return v if v else fallback


def iname(i):
    """Readable item name for an item id (or {id,name} object)."""
    if isinstance(i, dict):
        return i.get("name") or iname(i.get("id"))
    for table in (items_tr, tasks_tr):
        for suffix in (" Name", " ShortName"):
            v = table.get(str(i) + suffix)
            if v:
                return v
    unresolved.add(str(i))
    return str(i)


def map_ref(mid):
    n = map_name.get(mid)
    return {"normalizedName": n} if n else None


def clean_pos(p):
    if not p or p.get("x") is None or p.get("z") is None:
        return None
    return {"x": p["x"], "y": p.get("y", 0), "z": p["z"]}


def iid(i):
    return str(i.get("id")) if isinstance(i, dict) else str(i)


def name_ids(ids):
    """Parallel lists (names, item ids), de-duplicated by name."""
    seen, ns, idl = set(), [], []
    for i in ids or []:
        n = iname(i)
        if n not in seen:
            seen.add(n)
            ns.append(n)
            idl.append(iid(i))
    return ns, idl


def names(ids):
    return name_ids(ids)[0]


def build_req(o):
    """What the player must have/do for this objective: keys, items to bring, items to find/hand in.
    Every entry has "names" and a parallel "ids" list (item ids, used for item photos)."""
    t = o.get("type")
    cnt = o.get("count") or 1
    req = {}

    # keys: outer list = all required, inner list = any one of these keys works
    kg = [name_ids(g) for g in (o.get("requiredKeys") or []) if g]
    if kg:
        req["keys"] = [g[0] for g in kg]
        req["keyIds"] = [g[1] for g in kg]
        # maps where any key of the group has a door/container (empty = unknown). The page only shows the
        # key on those maps, so a multi-map objective does not ask for a key on a map where it is useless.
        req["keyMaps"] = [sorted(set().union(*[key_maps.get(i, set()) for i in g[1]])) for g in kg]

    bring, find = [], []
    if t == "plantItem" and o.get("items"):
        n, i = name_ids(o["items"])
        bring.append({"names": n, "ids": i, "count": cnt, "note": "to plant", "fir": bool(o.get("foundInRaid"))})
    elif t == "mark" and o.get("markerItem"):
        n, i = name_ids([o["markerItem"]])
        bring.append({"names": n, "ids": i, "count": 1, "note": "to mark", "fir": False})
    elif t == "useItem" and o.get("useAny"):
        n, i = name_ids(o["useAny"])
        bring.append({"names": n, "ids": i, "count": cnt, "note": "to use", "fir": False})
    elif t in ("findItem", "giveItem") and o.get("items"):
        extra = []
        if o.get("dogTagLevel"):
            extra.append("dog tag level %s+" % o["dogTagLevel"])
        mn, mx = o.get("minDurability"), o.get("maxDurability")
        if mn:
            extra.append("durability %s%%+" % mn)
        if mx and mx < 100:
            extra.append("durability up to %s%%" % mx)
        n, i = name_ids(o["items"])
        find.append({"names": n, "ids": i, "count": cnt, "fir": bool(o.get("foundInRaid")),
                     "note": "hand in" if t == "giveItem" else "find", "extra": ", ".join(extra)})
    elif t == "findQuestItem" and o.get("questItem"):
        n, i = name_ids([o["questItem"]])
        find.append({"names": n, "ids": i, "count": cnt, "fir": True, "note": "quest item", "extra": ""})

    if bring:
        req["bring"] = bring
    if find:
        req["find"] = find

    # weapon / clothing / build conditions are shown using the objective's own text
    if t == "buildWeapon" or (t == "shoot" and any(o.get(k) for k in ("usingWeapon", "usingWeaponMods", "wearing", "notWearing"))):
        req["gear"] = True
    return req or None


tasks = []
dropped_keys = []
used_traders = {}
for t in tasks_raw.values():
    name = tr(tasks_tr, t["name"])
    if not name:
        continue
    objs = []
    for o in t.get("objectives", []):
        zones = []
        for z in o.get("zones") or []:
            m = map_ref(z.get("map"))
            if not m:
                continue
            zones.append({
                "id": z.get("id"),
                "map": m,
                "position": clean_pos(z.get("position")),
                "outline": [clean_pos(p) for p in (z.get("outline") or []) if clean_pos(p)],
            })
        pls = []
        for pl in o.get("possibleLocations") or []:
            m = map_ref(pl.get("map"))
            if not m:
                continue
            pls.append({"map": m, "positions": [clean_pos(p) for p in pl.get("positions", []) if clean_pos(p)]})
        obj = {
            "id": o["id"],
            "type": o.get("type"),
            "description": tr(tasks_tr, o.get("description"), o.get("type") or ""),
            "optional": bool(o.get("optional")),
            "maps": [m for m in (map_ref(x) for x in o.get("maps") or []) if m],
            "zones": zones,
            "possibleLocations": pls,
        }
        req = build_req(o)
        if req:
            obj["req"] = req
        objs.append(obj)
    needed = []
    for nk in t.get("neededKeys") or []:
        m = map_name.get(nk.get("map"))
        good = []
        for k in nk.get("keys") or []:
            lm = key_maps.get(iid(k))
            if lm and canon_map(m) not in lm:      # the key has doors, but none on this map: bad upstream data
                dropped_keys.append((name, iname(k), m))
                continue
            good.append(k)
        ks = names(good)
        if m and ks:
            needed.append({"map": m, "names": ks})
    used_traders[str(t.get("trader"))] = tr(traders_tr, str(t.get("trader")) + " Nickname")
    tasks.append({
        "id": t["id"],
        "name": name,
        "minPlayerLevel": t.get("minPlayerLevel"),
        "wikiLink": t.get("wikiLink") or "",
        "kappaRequired": bool(t.get("kappaRequired")),
        "experience": t.get("experience") or 0,
        "trader": {"id": str(t.get("trader")), "name": tr(traders_tr, str(t.get("trader")) + " Nickname")},
        "map": map_ref(t.get("map")),
        "keys": needed,
        "objectives": objs,
    })

# ---------------------------------------------------------------------------------------------
# Hand-checked corrections for places where the tarkov.dev quest data is stale or wrong.
# Each entry says what is wrong and why; add your own the same way. If a fix no longer matches
# (tarkov.dev fixed it, or the quest changed), the build prints a note and skips it.
#   maps       - keep this objective only on these maps (also trims its zones and spawn locations)
#   drop_keys  - the objective needs no key
#   drop_task_keys - the quest needs no key at all
# ---------------------------------------------------------------------------------------------
TASK_FIXES = {
    # Vitamins is a BEAR quest on Factory (container on the lab's 2nd floor, no key). tarkov.dev still lists
    # the old Shoreline container and its "Health Resort west wing room 112" key.
    "5b478eca86f7744642012254": {
        "name": "Vitamins",
        "objectives": {"5b478f6886f774464201225a": {"maps": ["factory", "night-factory"], "drop_keys": True}},
        "drop_task_keys": True,
    },
}


def apply_fixes(task_list):
    done = []
    by_id = {t["id"]: t for t in task_list}
    for tid, fx in TASK_FIXES.items():
        t = by_id.get(tid)
        if not t:
            print("Note: data fix for '%s' skipped (quest id not found)." % fx["name"])
            continue
        for oid, ofx in fx.get("objectives", {}).items():
            o = next((x for x in t["objectives"] if x["id"] == oid), None)
            if not o:
                print("Note: data fix for '%s' skipped one objective (id not found)." % fx["name"])
                continue
            keep = set(ofx.get("maps") or [])
            if keep:
                o["maps"] = [m for m in o["maps"] if m["normalizedName"] in keep]
                o["zones"] = [z for z in o["zones"] if z["map"]["normalizedName"] in keep]
                o["possibleLocations"] = [p for p in o["possibleLocations"] if p["map"]["normalizedName"] in keep]
            if ofx.get("drop_keys") and o.get("req"):
                for k in ("keys", "keyIds", "keyMaps"):
                    o["req"].pop(k, None)
                if not o["req"]:
                    del o["req"]
        if fx.get("drop_task_keys"):
            t["keys"] = []
        done.append(fx["name"])
    return done


fixed = apply_fixes(tasks)


def pretty_zone(z):
    import re
    z = re.sub(r"^(Bot)?Zone_?", "", z or "")
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])|_", " ", z).strip() or (z or "")


def boss_name(mob):
    n = maps_tr.get(mob)
    if n:
        return n
    nn = (mobs_raw.get(mob) or {}).get("normalizedName")
    return nn.replace("-", " ").title() if nn else mob


def r1(p):
    return {"x": round(p["x"], 1), "y": round(p.get("y") or 0, 1), "z": round(p["z"], 1)}


def pmc_spawns(m):
    """Where a PMC can spawn: player spawn points usable by PMCs (side 'pmc' or 'all')."""
    out, seen = [], set()
    for sp in m.get("spawns") or []:
        if "player" not in (sp.get("categories") or []):
            continue
        if not ({"pmc", "all"} & set(sp.get("sides") or [])):
            continue
        p = clean_pos(sp.get("position"))
        if not p:
            continue
        key = (round(p["x"]), round(p["z"]))
        if key in seen:
            continue
        seen.add(key)
        out.append(r1(p))
    return out


def boss_spawns(m):
    """One entry per boss spawn zone. Positions come from the boss data, or from the map's boss spawn points."""
    zone_pts = {}
    for sp in m.get("spawns") or []:
        if "boss" in (sp.get("categories") or []) and clean_pos(sp.get("position")):
            zone_pts.setdefault(sp.get("zoneName"), []).append(r1(clean_pos(sp["position"])))
    out = []
    for b in m.get("bosses") or []:
        mob = b.get("mob")
        for loc in b.get("spawnLocations") or []:
            pts = [r1(clean_pos(p)) for p in loc.get("positions") or [] if clean_pos(p)] or zone_pts.get(loc.get("name")) or zone_pts.get(loc.get("spawnKey")) or []
            entry = {"mob": mob, "name": boss_name(mob), "chance": b.get("spawnChance"), "zoneChance": loc.get("chance"),
                     "zone": tr(maps_tr, loc.get("name"), pretty_zone(loc.get("name"))), "positions": pts}
            if b.get("spawnTrigger"):
                entry["trigger"] = str(b["spawnTrigger"])
            out.append(entry)
    return out


# ---------------------------------------------------------------------------------------------
# Loose-loot spawn points that can hold rare items or keys.
#   Edit these lists to change what counts as "rare" or "high value".
# ---------------------------------------------------------------------------------------------
RARE_NAMES = {
    "Antique teapot", "Antique vase", "Chain with Prokill medallion", "Gingy keychain", "Gold skull ring",
    "Golden egg", "Golden neck chain", "Graphics card", "LEDX Skin Transilluminator", "Mazoni golden dumbbell",
    "Military COFDM Wireless Signal Transmitter", "Ophthalmoscope", "Physical Bitcoin",
    "Roler Submariner gold wrist watch", "Silver Badge", "Tetriz portable game console",
    "VPX Flash Storage Module", "Veritas guitar pick",
}
RARE_RE = re.compile(r"figurine", re.I)              # every figurine counts as rare
HIGH_VALUE_KEYS = {
    "TerraGroup Labs access keycard", "TerraGroup Labs keycard (Red)", "TerraGroup Labs keycard (Violet)",
    "TerraGroup Labs keycard (Black)", "TerraGroup Labs keycard (Blue)", "TerraGroup Labs keycard (Green)",
    "Object #11SR keycard", "Object #21WS keycard", "Kiba Arms inner grate door key", "Rusted bloody key",
}
HV_KEY_RE = re.compile(r"marked key", re.I)         # every "marked key" counts as high value
KEY_RE = re.compile(r"\bkey(card)?s?\b", re.I)
KEY_SKIP = re.compile(r"case|holder|tool|keychain", re.I)


def _key_ids(g):
    return [iid(k) for k in g or []]


quest_key_ids = set()
for _t in tasks_raw.values():
    for _o in _t.get("objectives", []):
        for _g in _o.get("requiredKeys") or []:
            quest_key_ids.update(_key_ids(_g))
    for _nk in _t.get("neededKeys") or []:
        quest_key_ids.update(_key_ids(_nk.get("keys")))

_cls = {}


def classify(i):
    """None, or {"n": name, "c": "rare" | "hv" | "key", "q": True if some quest needs this key}."""
    if i in _cls:
        return _cls[i]
    n = iname(i)
    r = None
    if n in RARE_NAMES or RARE_RE.search(n):
        r = {"n": n, "c": "rare"}
    elif KEY_RE.search(n) and not KEY_SKIP.search(n):
        r = {"n": n, "c": "hv" if (n in HIGH_VALUE_KEYS or HV_KEY_RE.search(n)) else "key"}
        if i in quest_key_ids:
            r["q"] = True
    _cls[i] = r
    return r


def loot_points(m):
    """Loose-loot spawn points that can hold a rare item or a key -> (points, item table)."""
    pts, meta = [], {}
    for ll in m.get("lootLoose") or []:
        p = clean_pos(ll.get("position"))
        if not p:
            continue
        ids = []
        for i in ll.get("items") or []:
            c = classify(str(i))
            if c:
                ids.append(str(i))
                meta[str(i)] = c
        if ids:
            q = r1(p)
            q["i"] = sorted(set(ids))
            pts.append(q)
    return pts, meta


maps = []
for mid, m in maps_raw.items():
    exts = []
    for e in m.get("extracts") or []:
        p = clean_pos(e.get("position"))
        if not p:
            continue
        exts.append({"name": tr(maps_tr, e.get("name"), e.get("name") or "Extract"),
                     "faction": e.get("faction") or "shared", "position": p})
    for tz in m.get("transits") or []:      # transits to other maps: drawn like extracts, own legend toggle
        p = clean_pos(tz.get("position"))
        if p:
            exts.append({"name": tr(maps_tr, tz.get("description"), "Transit"), "faction": "transit", "position": p})
    locks = []
    for l in m.get("locks") or []:
        p = clean_pos(l.get("position"))
        if not p or not l.get("key"):
            continue
        locks.append({"id": l.get("id"), "keyId": str(l["key"]), "key": iname(l["key"]),
                      "type": l.get("lockType") or "door", "power": bool(l.get("needsPower")), "position": p})
    lp, lmeta = loot_points(m)
    maps.append({"normalizedName": m.get("normalizedName"), "name": tr(maps_tr, mid + " Name", m.get("normalizedName")),
                 "extracts": exts, "locks": locks, "spawns": pmc_spawns(m), "bosses": boss_spawns(m),
                 "loot": lp, "lootItems": lmeta})

traders = [{"id": tid, "name": nm, "image": trader_image(tid)} for tid, nm in used_traders.items() if nm]
with open("quest_data.json", "w", encoding="utf-8") as f:
    json.dump({"tasks": tasks, "maps": maps, "traders": traders}, f, separators=(",", ":"))
print("Locks:", sum(len(m["locks"]) for m in maps), "door/container locks for", len({l["keyId"] for m in maps for l in m["locks"]}), "keys")
print("PMC spawns:", sum(len(m["spawns"]) for m in maps), "| boss spawn zones:", sum(len(m["bosses"]) for m in maps), "(%d with map positions)" % sum(1 for m in maps for b in m["bosses"] if b["positions"]))
_lc = {"rare": 0, "hv": 0, "key": 0}
for _m in maps:
    for _p in _m["loot"]:
        for _c in {_m["lootItems"][i]["c"] for i in _p["i"]}:
            _lc[_c] += 1
print("Loot spawn points: %d with rare items, %d with high-value keys, %d with other keys (%d key ids are quest keys)" % (_lc["rare"], _lc["hv"], _lc["key"], len(quest_key_ids)))
print("Transits:", sum(1 for m in maps for e in m["extracts"] if e["faction"] == "transit"))
if fixed:
    print("Applied data fixes:", ", ".join(fixed))
for _q, _k, _m in dropped_keys:
    print("Ignored bad key data: %s lists '%s' on %s, but that key has no doors there." % (_q, _k, _m))
print("Traders:", len(traders), "(%d with photos)" % sum(1 for t in traders if t["image"]))
print("Wrote quest_data.json:", len(tasks), "quests,", sum(len(m["extracts"]) for m in maps), "extracts")
if unresolved:
    print("WARNING: %d item ids had no English name (shown as raw ids). Is items_en.json the right file?" % len(unresolved))
