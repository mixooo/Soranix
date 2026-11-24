# Next update: to-do list

Things to change before the next release. When they're all done, publish with:

```powershell
powershell -ExecutionPolicy Bypass -File publish.ps1 -NotesFile notes.md
```

## To do

- Later (once nobody is on 1.0.327-1.0.329): remove the old-name launcher from the installer (`installer\oldname.cs`, the OldNameLauncher component in `installer\Soranix.wxs`, its lines in `build-msi.ps1`).

## Done (shipped in 1.0.331)

- **Controls react on the first click while another app or a game has focus.** The app now checks the mouse position itself, because Windows sends no mouse moves to Soranix while another app is in front. (Clicking Soranix still makes it the active window, like any app.)
- **Global hotkeys** (Settings, off by default): play / pause, next, previous, volume up / down, even inside games. Play / pause is Ctrl+Alt+Space, or Ctrl+Alt+P / Ctrl+Alt+Home when another program already uses it (on this PC something does); the others are Ctrl+Alt+arrows. Turning it on shows which keys it got.
- **Mini mode** (Ctrl+M, the new title-bar button, or the main menu): the player becomes a slim bar with song, time, buttons, volume and position. Double-click it or Ctrl+M for the full player; the other windows come back where they were (moved along if the bar was moved). Remembered after restarts.
- **Lyrics on the MilkDrop visualizer** (Settings, off by default): the current line, and the next one dimmer, float over the visualizer; bigger in fullscreen. Uses LRCLIB, no Spotify requests.
- **Lower music while someone talks** (Settings, off by default): Off / 50% / 80% / Silent while Discord, TeamSpeak, Mumble, Teams, Zoom... play sound, then the music comes back. A game's own voice chat can't be told apart from the game's sound.
- **Playlists > By you sorted by listening:** a new switch next to "By you" cycles Spotify order / Most listened / Recently listened. Plays are counted on this PC (30 s or more from one of your playlists); the first time a sorted order is picked, your last 50 Spotify plays give it a head start (1 request, once).
- **Lyrics timing back to normal:** no built-in head start any more (it was 1 second); 0.0s means exactly in time.
- **Lyrics themes** (new Theme button next to Reload in Now Playing): Green (as before), Player (the player's own LCD look and pixel font) and Sunset (warm glow on a dusk sky). Remembered.
- **Now Playing timing buttons are arrows only** (◀ 0.0s ▶).
- **Now Playing opens with Cover art and Lyrics both on;** each toggle shows / hides its part, and turning both off closes the window.
- GitHub repo renamed to Soranix, so Soranix copies find their updates.

## Done (shipped in 1.0.330)

- Renamed to Soranix everywhere: app, windows, About, installer, shortcuts, README, screenshots.
- Login, settings and saved copies move over from the old folder and database by themselves.
- Updating from the old version restarts the app (small launcher at the old install path).

## Done (shipped in 1.0.329)

- About Soranix shows the real version (it always said 1.0.0).
- Pop-ups (About, update prompt, confirmations, and other dialogs) open centered on the monitor Soranix's player is on, instead of on the seam between two screens. Tall ones scroll instead of running off the screen.
- About text updated: all keyboard shortcuts, auto-update, saved copies, media controls, credits.
