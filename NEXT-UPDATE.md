# Next update: to-do list

Things to change before the next release. When they're all done, publish with:

```powershell
powershell -ExecutionPolicy Bypass -File publish.ps1 -NotesFile notes.md
```

## To do

- **YouTube Music search: long videos / audio show wrong details.** Lengths show 0:00 (YouTube lists some results with a play count or date instead of a length, especially long videos, mixes and podcast episodes), and the Artist column can show a date ("Aug 30") for episodes. Read the length from the right place (or from the player once it plays) and keep dates out of the Artist column.
- **YouTube Music artist pages** show only the artist's top 5 songs; load the full song list.
- **YouTube Music right-click menus on albums / artists / playlists** in search still offer Spotify-style actions that don't work there.

- **Faster update downloads (look into):** updating 1.0.330 to 1.0.331 took about 25 minutes on this PC (about 100 KB/s), while a normal download here is several times faster. Find out whether the app's downloader or GitHub is the slow part.
- Later (once nobody is on 1.0.327-1.0.329): remove the old-name launcher from the installer (`installer\oldname.cs`, the OldNameLauncher component in `installer\Soranix.wxs`, its lines in `build-msi.ps1`).

## Done (shipped in 1.0.332)

- **Mixed playlists / My playlists** (both modes): the playlist window shows every song in its service's colour (Spotify green, YouTube Music red) and takes songs by drag and drop from the library (rows and Discover covers) or right-click > Add to Soranix playlist. The MY LISTS button (next to LIST OPTS) opens the My playlists window: your own lists on this PC, Spotify and YouTube Music songs together (counts in green / red): New, Save playlist window, Play, Add to playlist window, Rename, Delete; drag songs onto a list; right-click a song: Play from here, Move up / down, Remove. Right-click any song > Add to My playlists also works. (Not in the library anymore.) Playing: only one service runs; when the next song is from the other service Soranix switches over (about a second) and plays it there, both by itself at a song's end and with Next / a click. Spotify only gets its own songs in its play list. Switching is quick: 20 s before a Spotify song hands over to YouTube Music, the YouTube Music window loads in the background and gets the song ready silently, and switches start just before a song ends (0.9 s before for YouTube Music, 1.3 s before for Spotify), so they overlap its last moment. Measured: Spotify to YouTube Music 3.3 s -> 1.3 s from the start of the switch (about 0.4 s of silence); YouTube Music to Spotify about 1.4 s (mostly Spotify's player starting). 0 requests to open or edit. Tested: Spotify song started from YouTube Music mode, then YouTube Music took over at its end by itself. (Planned extras not built: reordering by dragging, import / export as a file.)

- **Discover new music opens first** in both modes, and Spotify's Discover is now a cover grid like YouTube Music's (bigger covers come with the lists Spotify already sends). Its last mix is kept, so opening it (also at every start or switch) costs no requests; New mix makes a fresh one (20 songs, 2 searches). Measured: first start 4 requests, switching back and forth afterwards 0. More adds the next 20 songs of the same mix (2 requests, only when pressed; added to the kept mix). **Not tested live yet** (to save requests): check More once.

- **YouTube Music > Discover** (under Find music): YouTube Music's home page as a grid of covers, one section at a time with buttons in the filter row: Listen again, Music videos for you, Featured playlists for you, Albums for you, New releases, Mixed for you plus Song mixes and Trending (any Trending section), whichever YouTube Music sends (it changes them from one request to the next). More adds to the selected section: its More page where YouTube has one (New releases 10 -> 137, Mixed for you 6 -> 43), your history for Listen again (8 -> 201), fresh picks for the others until nothing new comes. A song plays with the rest of the section after it; a mix, album, playlist or artist opens. Kept 30 minutes. Also: Log out @name replaces Switch to Spotify in the YouTube Music library; the logo on the Choose your music buttons; the YouTube Music window item is gone from the library.

- **YouTube Music filter buttons** under the search box: All, Songs, Videos, Albums, Artists, Playlists (each search kept a day). Albums, artists and playlists from a search open to their songs. Liked music and playlists get All / Songs / Videos, filtered from what's loaded (no requests). "All" songs under YouTube's top-result card get their artist from the card.
- **Covers in the library lists** (Spotify and YouTube Music): each song's cover next to its number. The cover addresses come with the lists Soranix already loads (and its saved copies), and the pictures come from the image servers, not the Web API: measured 0 Spotify requests. The room comes from the Title column, so the table still fits. Settings > Song covers in the library lists turns them off (on by default).

- **Liked Songs opens from its saved copy (Spotify):** the first page is now saved too; under 30 minutes old (like the playlist list), opening Liked Songs, also when Soranix starts or switches back from YouTube Music, costs no request. Liking / unliking in Soranix refreshes it. Measured: a switch to Spotify went from 1 Soranix request to 0 (Spotify's player itself still makes its 2 start-up calls, as on every start).

- **No stutter when a searched song starts its mix (Spotify):** the mix used to be handed to Spotify as soon as it was ready, which restarts playback mid-song (a 0.5-1 s stutter); later additions did the same at the start of a song. Now it is handed over in the last moment of the playing song, starting with the next one (same single request; Next hands it over too). Tested: no position jump mid-song, next song came from the mix.

- **YouTube Music (test, not for release yet):** at start Soranix asks Spotify or YouTube Music ("Remember my choice", and Settings > Music service to switch). With YouTube Music a hidden YouTube Music window plays and Soranix's skin controls it (ytm.js, ytm-bridge.js); all green text turns red. Spotify gets no requests in this mode.
  - Works (tested): picker, search, play / pause / seek / next / previous, the next song starting by itself, shuffle and repeat (kept by Soranix), Now Playing with cover, synced lyrics, Up Next, playlist window, right-click menus without Spotify-only entries, red theme, Google's sign-in page opens.
  - Fixed while testing: wrong song name after Next, "connect Spotify" texts, green volume slider and logo, Spotify-only menu entries, an ad showing the previous song.
  - Google sign-in works (the window presents itself as Firefox; Google blocked it before). Signed in, tested: Liked music (100 songs), your playlists (8), playing from them, Next.
  - Fixed after signing in: balance slider still green, logo badge turned into a blue square.
  - No ads: YouTube's answer about each song lists the ads to play; ytm-preload.js takes that list out before the web player reads it (the same reason Limusic has no ads: it never acts on that list). Tested: 6 songs in a row, 20 ad lists removed, no ad played.
  - The logo on the player opens a small MUSIC SERVICE switch (SPOTIFY | YOUTUBE MUSIC); picking the other side switches right away, without the start-up question. Volume and balance sliders are plain red and the logo pure red in YouTube Music mode.
  - Logo recoloured pixel by pixel to the exact red of the text. Red theme copies only colour parts of rules (fixed a lyrics glitch). Now Playing > Video (YouTube Music): the music video plays where the cover was (frames copied from the hidden window ~24 a second while shown); audio-only songs switch to their music video (found with YouTube Music's Videos search) and still count as the song.
  - Lyrics in YouTube Music mode come first from Limusic's lyrics service (lyrics.limusic.app/v1/lyrics/<video id>, fetched by main.js because the service doesn't answer web pages), timed to the exact song with line ends; LRCLIB when it has none. Spotify mode still uses LRCLIB only. The footer says which.
  - Always the audio version: a row that is a video (official music video or upload) plays its audio track, found with YouTube Music's Songs search and used only on a sure match (same title and version, same artist; featured-artist notes ignored); otherwise the upload itself plays. With Now Playing > Video on, the video plays (a video row plays itself). Lyrics follow the audio track.
  - Memory: only one service runs. YouTube Music mode never loads Spotify's player or its DRM decoder; Spotify mode closes the YouTube Music window. The hidden window loads no pictures, ads or trackers and no service worker (was a page process of its own, ~120 MB). Chromium's spare page process and back/forward page cache are off. Measured, settled: YouTube Music mode ~990 MB (was ~1150), Spotify mode ~1010-1070 MB.
  - Switching Spotify <-> YouTube Music: faster (0.15 s knob pause, YouTube Music window starts loading before the player restarts, readiness checked 4x a second; ~0.6 s to Spotify, ~1.2 s to YouTube Music) and no flicker: the page is marked as the desktop app before its first paint (the whole screen area used to flash the browser background), windows stay hidden until placed and coloured (Chromium keeps the old picture meanwhile), the red logo is kept once drawn. Filmed frame by frame both ways.
  - Saved answers for YouTube Music (same saved-copies store as Spotify, tidied the same way): playlist list, Liked music and playlists 30 minutes (refresh button asks again), searches a day, audio-track / music-video lookups and lyrics 30 days; failed answers are never kept. Measured: second opens 0 YouTube Music calls and 1-2 ms instead of 200-400 ms; also after a restart.
  - Add to queue works in YouTube Music mode: Soranix plays its own queue (kept apart from the Spotify queue): queued songs play next in order (Next or when a song ends), then the playlist goes on where it was; Up Next and the Queue window show them, clicking one jumps to it. Tested.
  - Known gaps: lyrics are timed for the song version, so they can be off while a music video with a long intro plays; only the first 100 songs of Liked music or a long playlist load; no artist or album pages; Song info (the "I" button) is Spotify-only; what happens after the last song of the list (YouTube may continue with its own picks).

- **What's new window:** on the first start after an update, a "What's new in Soranix 1.0.x" window shows that version's notes once (sections spaced out, the install steps left out). Settings > What's new in this version shows it again any time. The notes are saved when Install is pressed, so no request is needed; for a copy installed by hand they come from GitHub once (no Spotify requests). A brand-new install doesn't get it. Updating from 1.0.331 shows it too, using GitHub.
- **Pop-ups show in mini mode:** in mini mode, pop-ups (update prompt, confirmations, What's new...) were hidden while their invisible backdrop still blocked the screen. Fixed. (This bug is in 1.0.331.)
- **Mini mode bars work:** the yellow position bar (click or drag to seek) and the green volume bar (click or drag) now respond, with a bigger invisible area around them so the thin bars are easy to grab. (They didn't respond at all in 1.0.331.)
- **Update progress on the player's display:** after pressing Install, the display takes turns: 5 seconds "DOWNLOADING UPDATE 1.0.x: 35%", 5 seconds the song, and so on (also in mini mode), until it installs. It shows from the next update on, because the version doing the download is the one that shows it.
- **Live taskbar and Alt-Tab previews:** the preview picture of the player is refreshed about 15 times a second while a preview can be on screen: mouse on the taskbar (also when it hides itself, and on a second screen's taskbar) or on a preview, or Alt / the Windows key held (Alt-Tab, Win+Tab). Otherwise it stays at one refresh every 8 seconds, so it costs nothing while you're not looking. The sound helper tells the app when (it reads only Alt and the Windows key, and the mouse position).

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
