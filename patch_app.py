"""Patch raid-route_3.html so quests/extracts load from local quest_data.json
instead of api.tarkov.dev.

Usage (in the folder with the HTML file):
    python patch_app.py raid-route_3.html
A backup is saved as <file>.bak first.
"""
import shutil
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "raid-route_3.html"
START = "async function loadTasks(force){"
END = "async function loadCal(force){"

NEW = r"""async function loadTasks(force){
  setOv('Loading local quest data…');
  const file = S.mode === 'pve' ? 'quest_data_pve.json' : 'quest_data.json';
  let data;
  try{
    const r = await fetch(file, { cache:'no-store' });
    if(!r.ok) throw new Error('HTTP '+r.status);
    data = await r.json();
  }catch(e){
    throw new Error('Could not load '+file+' ('+e.message+').\n\nPut it in the same folder as this HTML file and open the page through "python proxy.py" at http://localhost:8000/' + (S.mode === 'pve' ? '\n\nOnly PvP (regular) quest data has been built. Switch back to PvP.' : ''));
  }
  if(!data || !data.tasks || !data.tasks.length) throw new Error(file+' contains no quests.');
  S.tasks = normalizeTasks(data.tasks);
  S.extracts = normalizeExtracts(data.maps || []);
  S.stamp = Date.now();
}
"""

with open(path, encoding="utf-8") as f:
    src = f.read()

if "quest_data.json" in src and START in src and "Loading local quest data" in src:
    print("Quest-data patch already applied - skipping."); sys.exit(0)

i, j = src.find(START), src.find(END)
if i < 0 or j < 0 or j < i:
    sys.exit("Could not find loadTasks/loadCal in " + path + ". Is this the r4 file?")

shutil.copyfile(path, path + ".bak")
out = src[:i] + NEW + "\n" + src[j:]
with open(path, "w", encoding="utf-8") as f:
    f.write(out)
print("Patched", path, "(backup:", path + ".bak)")
