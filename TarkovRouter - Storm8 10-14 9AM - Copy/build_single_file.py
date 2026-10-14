"""Build RaidRoute.html: one file anyone can open by double-clicking.

Run in the folder with raid-route_3.html (already patched with patch_app.py)
and quest_data.json:

    python build_single_file.py            # quest data embedded; map art/calibration still load online
    python build_single_file.py --offline  # also downloads + embeds map art, calibration and Leaflet

Output: RaidRoute.html  (send/share just this file)
"""
import json
import re
import sys
import urllib.request

SRC = "raid-route_3.html"
QUEST = "quest_data.json"
OUT = "RaidRoute.html"

MAPS_JSON = "https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json"
SVG_BASE = "https://raw.githubusercontent.com/the-hideout/tarkov-dev-svg-maps/main/"
SVG_FILES = {
    "customs": "Customs", "woods": "Woods", "shoreline": "Shoreline", "interchange": "Interchange",
    "reserve": "Reserve", "lighthouse": "Lighthouse", "streets-of-tarkov": "StreetsOfTarkov",
    "factory": "Factory", "the-lab": "Labs", "ground-zero": "GroundZero",
}
LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"
LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css"


def fetch_text(url):
    print("  downloading", url)
    req = urllib.request.Request(url, headers={"User-Agent": "raid-route-build/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def fetch_data_uri(url):
    import base64
    print("  downloading", url)
    req = urllib.request.Request(url, headers={"User-Agent": "raid-route-build/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
        mime = r.headers.get_content_type() or "image/webp"
    return "data:%s;base64,%s" % (mime, base64.b64encode(data).decode("ascii"))


ICON_URL = "https://assets.tarkov.dev/%s-icon.webp"


def item_ids_in_use(quest):
    """Every item id the page shows a photo for: quest requirements and rare-item / key spawns."""
    ids = set()
    for t in quest.get("tasks", []):
        for o in t.get("objectives", []):
            r = o.get("req") or {}
            for grp in (r.get("find") or []) + (r.get("bring") or []):
                ids.update((grp.get("ids") or [])[:3])      # the page shows at most 3 photos per line
            for g in r.get("keyIds") or []:
                ids.update(g[:3])
    for m in quest.get("maps", []):
        ids.update((m.get("lootItems") or {}).keys())
        ids.update(l["keyId"] for l in m.get("locks") or [] if l.get("keyId"))      # key photos on key-route pins
    return sorted(i for i in ids if i)


def fetch_item_icons(quest):
    """Download item photos so the offline file shows them without internet (best effort)."""
    import base64
    from concurrent.futures import ThreadPoolExecutor
    ids = item_ids_in_use(quest)
    print("  downloading %d item photos..." % len(ids))

    def one(i):
        try:
            req = urllib.request.Request(ICON_URL % i, headers={"User-Agent": "raid-route-build/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
                mime = r.headers.get_content_type() or "image/webp"
            return i, "data:%s;base64,%s" % (mime, base64.b64encode(data).decode("ascii"))
        except Exception:
            return i, None

    with ThreadPoolExecutor(max_workers=8) as ex:
        res = dict(ex.map(one, ids))
    got = {k: v for k, v in res.items() if v}
    print("  got %d of %d item photos (missing ones fall back to the online link)" % (len(got), len(ids)))
    return got


def js_json(obj):
    # safe to place inside a <script> tag
    return json.dumps(obj, separators=(",", ":")).replace("</", "<\\/")


def replace_once(src, old, new, label):
    if src.count(old) != 1:
        sys.exit("Could not patch (%s): expected text not found exactly once. "
                 "Make sure the HTML was patched with patch_app.py first." % label)
    return src.replace(old, new)


def build(src, quest, cal_raw=None, svgs=None, leaflet=None, icons=None):
    # 1) quest data
    src = replace_once(
        src,
        "const r = await fetch(file, { cache:'no-store' });\n    if(!r.ok) throw new Error('HTTP '+r.status);\n    data = await r.json();",
        "data = EMBEDDED_QUEST_DATA;",
        "quest loader",
    )
    embed = "<script>\nconst EMBEDDED_QUEST_DATA = %s;\n" % js_json(quest)

    # 2) optional offline pieces
    if cal_raw is not None:
        src = replace_once(
            src,
            "const r = await fetch(MAPS_JSON); if(!r.ok) throw new Error('HTTP '+r.status);\n    j = await r.json();",
            "j = EMBEDDED_CAL_RAW;",
            "calibration loader",
        )
        embed += "const EMBEDDED_CAL_RAW = %s;\n" % js_json(cal_raw)
    if svgs is not None:
        src = replace_once(src, "svgCache: {}", "svgCache: EMBEDDED_SVGS", "svg cache")
        embed += "const EMBEDDED_SVGS = %s;\n" % js_json(svgs)
    if icons:
        embed += "const EMBEDDED_ICONS = %s;\n" % js_json(icons)
    embed += "</script>\n"

    if leaflet is not None:
        js, css = leaflet
        src = re.sub(r'<link rel="stylesheet" href="https://cdnjs\.cloudflare\.com/ajax/libs/leaflet/[^"]*leaflet\.css">',
                     lambda m: "<style>\n" + css + "\n</style>", src, count=1)
        src = re.sub(r'<script src="https://cdnjs\.cloudflare\.com/ajax/libs/leaflet/[^"]*leaflet\.js"></script>',
                     lambda m: "<script>\n" + js.replace("</script", "<\\/script") + "\n</script>", src, count=1)

    # put embedded data right before the app's main script (the last <script> block)
    idx = src.rfind("<script>")
    if idx < 0:
        sys.exit("Could not find the main <script> block.")
    return src[:idx] + embed + src[idx:]


def main():
    offline = "--offline" in sys.argv
    src_path = SRC
    if "--src" in sys.argv:
        src_path = sys.argv[sys.argv.index("--src") + 1]
    with open(src_path, encoding="utf-8") as f:
        src = f.read()
    with open(QUEST, encoding="utf-8") as f:
        quest = json.load(f)

    cal_raw = svgs = leaflet = None
    if offline:
        print("Downloading everything for offline use...")
        cal_raw = json.loads(fetch_text(MAPS_JSON))
        svgs = {k: fetch_text(SVG_BASE + v + ".svg") for k, v in SVG_FILES.items()}
        leaflet = (fetch_text(LEAFLET_JS), fetch_text(LEAFLET_CSS))
        for tr in quest.get("traders", []):
            if tr.get("image", "").startswith("http"):
                try:
                    tr["image"] = fetch_data_uri(tr["image"])
                except Exception as e:  # keep the online link; the page falls back to initials if it fails
                    print("  could not embed photo for %s: %s" % (tr.get("name"), e))

    icons = None
    if offline:
        icons = fetch_item_icons(quest)
    out = build(src, quest, cal_raw, svgs, leaflet, icons)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(out)
    print("Wrote %s (%.1f MB)%s" % (OUT, len(out.encode("utf-8")) / 1e6,
                                    " - fully offline except fonts" if offline else " - needs internet for map art"))


if __name__ == "__main__":
    main()
