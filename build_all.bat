@echo off
REM Rebuilds RaidRoute.html from scratch. Put this file in the same folder as:
REM   raid-route_3.html (your original page) and all the .py files.
REM Data files are downloaded automatically if missing. To refresh quest data after a
REM game patch, delete the .json files first, then run this again.
cd /d "%~dp0"
if not exist raid-route_3.html (echo Missing raid-route_3.html & pause & exit /b 1)

if not exist tasks.json       powershell -NoProfile -Command "Invoke-WebRequest https://json.tarkov.dev/regular/tasks -OutFile tasks.json"
if not exist tasks_en.json    powershell -NoProfile -Command "Invoke-WebRequest https://json.tarkov.dev/regular/tasks_en -OutFile tasks_en.json"
if not exist maps_data.json   powershell -NoProfile -Command "Invoke-WebRequest https://json.tarkov.dev/regular/maps -OutFile maps_data.json"
if not exist maps_en.json     powershell -NoProfile -Command "Invoke-WebRequest https://json.tarkov.dev/regular/maps_en -OutFile maps_en.json"
if not exist traders.json     powershell -NoProfile -Command "Invoke-WebRequest https://json.tarkov.dev/regular/traders -OutFile traders.json"
if not exist traders_en.json  powershell -NoProfile -Command "Invoke-WebRequest https://json.tarkov.dev/regular/traders_en -OutFile traders_en.json"
if not exist items_en.json    powershell -NoProfile -Command "Invoke-WebRequest https://json.tarkov.dev/regular/items_en -OutFile items_en.json"

copy /y raid-route_3.html raid-route_work.html >nul
python build_quest_data.py || (pause & exit /b 1)
python patch_app.py raid-route_work.html || (pause & exit /b 1)
python patch_prep.py raid-route_work.html || (pause & exit /b 1)
python patch_traders.py raid-route_work.html || (pause & exit /b 1)
python patch_keys.py raid-route_work.html || (pause & exit /b 1)
python patch_kappa.py raid-route_work.html || (pause & exit /b 1)
python patch_sort.py raid-route_work.html || (pause & exit /b 1)
python patch_extras.py raid-route_work.html || (pause & exit /b 1)
python patch_legend.py raid-route_work.html || (pause & exit /b 1)
python patch_loot.py raid-route_work.html || (pause & exit /b 1)
python patch_polish.py raid-route_work.html || (pause & exit /b 1)
python patch_fixes.py raid-route_work.html || (pause & exit /b 1)
python patch_chain.py raid-route_work.html || (pause & exit /b 1)
python patch_ui.py raid-route_work.html || (pause & exit /b 1)
python patch_keyinfo.py raid-route_work.html || (pause & exit /b 1)
python build_single_file.py --offline --src raid-route_work.html || (pause & exit /b 1)
echo.
echo Done. Open RaidRoute.html
pause
