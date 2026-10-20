# Raid Route Companion (Windows, alpha)

A small tray app that runs beside Escape from Tarkov. It only **reads**:

- the game's log files (`<game>\Logs\log_*\`) for quest started/finished/failed, the map you load into, the server, the raid start/end;
- the names of the files in your Screenshots folder (the game writes your position into each name).

No memory reading, no key presses, no game files changed. It talks to the Raid Route website over a local link (`127.0.0.1:47831`) that only works after you type the 6-digit code shown in the app once.

## For you (the site owner)

1. Copy `companion-release.yml` to `.github/workflows/companion-release.yml` in the repo.
2. Run it from GitHub: Actions > Build companion app > Run workflow. It builds `Raid Route Companion Setup x.y.z.exe` and publishes a release.
3. Download links go on the site's Play page (it points at the latest release automatically).
4. To ship an update: raise `version` in `companion/package.json`, run the workflow again. Installed copies download it by themselves and show "Restart to update".

Run the checks anywhere with Node: `node test/parse.test.js && node test/core.test.js`.

## Known unknowns

The log wording is read from memory of how the game writes it and has not yet been checked against a real log. Every pattern lives in `src/parse.js`, is forgiving, and ignores lines it does not know. If something does not tick, send me a few lines from `application.log` / `notifications.log`.
