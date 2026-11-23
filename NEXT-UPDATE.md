# Next update: to-do list

Things to change before the next release. When they're all done, publish with:

```powershell
powershell -ExecutionPolicy Bypass -File publish.ps1 -NotesFile notes.md
```

## To do

- **Around 2026-11-30: rename the GitHub repo to Soranix** (`gh repo rename Soranix`, then `git remote set-url origin https://github.com/mixooo/Soranix.git`). Not before: copies still on 1.0.327-1.0.329 only accept updates from a repo named Winampify, so they need time to update first. Until then, Soranix's own update check (repo Soranix) finds nothing.
- Later (once nobody is on 1.0.327-1.0.329): remove the old-name launcher from the installer (`installer\oldname.cs`, the OldNameLauncher component in `installer\Soranix.wxs`, its lines in `build-msi.ps1`).

## Done (shipped in 1.0.330)

- Renamed to Soranix everywhere: app, windows, About, installer, shortcuts, README, screenshots.
- Login, settings and saved copies move over from the old folder and database by themselves.
- Updating from the old version restarts the app (small launcher at the old install path).

## Done (shipped in 1.0.329)

- About Soranix shows the real version (it always said 1.0.0).
- Pop-ups (About, update prompt, confirmations, and other dialogs) open centered on the monitor Soranix's player is on, instead of on the seam between two screens. Tall ones scroll instead of running off the screen.
- About text updated: all keyboard shortcuts, auto-update, saved copies, media controls, credits.
