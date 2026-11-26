# Soranix

**A classic-style desktop music player for Spotify Premium, YouTube Music and SoundCloud on Windows, now also on Mac and Linux (test builds).**
Skinned, dockable windows, a real playlist editor, MilkDrop-style visuals, synced lyrics, playlists that mix songs from all three services, a Discord "Listening to" activity, and a design built around one goal: use as few Spotify requests as possible, so you don't hit Spotify's cooldowns.

**Spotify mode** (green):

![Soranix in Spotify mode: the player, Up Next, queue, library, playlist editor, Now Playing with lyrics and the MilkDrop visualizer](docs/screenshots/spotify.webp)

**YouTube Music mode** (red):

![Soranix in YouTube Music mode: the same windows in red, with a YouTube Music search open in the library](docs/screenshots/youtube-music.webp)

**SoundCloud mode** (orange):

<p align="center"><img src="docs/screenshots/soundcloud-player.png" alt="The Soranix player in SoundCloud orange, playing a SoundCloud song" width="440"> <img src="docs/screenshots/soundcloud-discover.png" alt="SoundCloud's Discover sections as a grid of covers in the Soranix library" width="430"></p>

**Mixed playlist:** Spotify songs in green, YouTube Music songs in red, one after the other.

<p align="center"><img src="docs/screenshots/mixed-playlist.png" alt="The playlist window with two Spotify songs in green and two YouTube Music songs in red" width="600"></p>

> Unofficial, fan-made project. Not made, endorsed or supported by Spotify, YouTube, SoundCloud or Discord. "Spotify" is a trademark of Spotify AB; "YouTube Music" is a trademark of Google LLC; "SoundCloud" is a trademark of SoundCloud Global Limited & Co. KG; "Discord" is a trademark of Discord Inc.

## Download

Everything is on the [Releases page](../../releases/latest).

| System | File |
|---|---|
| Windows | `Soranix-<version>.msi` |
| Mac with Apple Silicon (M1 or newer) | `Soranix-<version>-arm64.dmg` |
| Mac with Intel | `Soranix-<version>-x64.dmg` |
| Ubuntu / Debian / Mint | `soranix_<version>_amd64.deb` |
| Other Linux (x64) | `Soranix-<version>-x86_64.AppImage` |

### Windows

Download the `.msi` and run it.

- Installs for your Windows user only (no administrator rights) into `%LOCALAPPDATA%\Programs\Soranix`, with Start menu and Desktop shortcuts.
- The MSI isn't code-signed, so SmartScreen may say "Unknown publisher" the first time: **More info > Run anyway**.
- A newer MSI upgrades the installed copy. Uninstalling keeps your login and settings (`%APPDATA%\Soranix`).
- **Updates:** from version 1.0.327 on, Soranix checks this repo's Releases twice a day and **asks before installing** anything. When you press **Install**, it downloads the new MSI, checks its SHA-256 fingerprint against the one published with the release, then closes, updates and starts again. **Settings > Check for updates** checks right away.

### Mac (test build)

1. Open the `.dmg` and drag **Soranix** to **Applications**.
2. The app isn't signed by Apple yet, so run this once in Terminal:
   ```
   xattr -cr /Applications/Soranix.app
   ```
3. MilkDrop asks for **Screen Recording** permission, which it needs to hear the music.

> [!WARNING]
> Spotify doesn't play in the Mac build yet. It still needs the castLabs VMP signature.

### Linux (test build)

- **.deb** (Ubuntu, Debian, Mint): install it with
  ```
  sudo apt install ./soranix_<version>_amd64.deb
  ```
  then open Soranix from your app menu.
- **AppImage** (other distributions): make it executable and run it. On Ubuntu 24.04 or newer it may need `--no-sandbox`:
  ```
  chmod +x Soranix-<version>-x86_64.AppImage
  ./Soranix-<version>-x86_64.AppImage --no-sandbox
  ```
- On Wayland desktops Soranix runs through XWayland, because its see-through windows need X11.

### Not on Mac and Linux yet

- Balance
- Automatic updates (download new versions from the Releases page)
- Taskbar preview buttons

Media keys and the system's now-playing controls work on all three.

## One-time setup (about 3 minutes)

Soranix talks to Spotify through **your own** free Spotify developer app:

1. Go to <https://developer.spotify.com/dashboard>, log in and click **Create app**.
   - Name and description: anything you like.
   - **Redirect URI**: `http://127.0.0.1:8888/` (exactly like this), then **Add**.
   - Tick **Web API** and **Web Playback SDK**, then save.
2. Open the app's **Settings** and copy the **Client ID**.
3. Start Soranix, paste the Client ID in the library window and click **Connect**. You log in on Spotify's own page; Soranix never sees your password.
4. Getting a "403" error? In the dashboard, open **User Management** and add the email of the Spotify account you log in with.

Needs **Spotify Premium** (Spotify's rule for playback in third-party apps).

**YouTube Music needs no setup:** pick **YouTube Music** when Soranix starts (or click the logo on the player to switch). Sign in with your Google account from the library to get your Liked music and playlists; searching and Discover work without signing in.

**SoundCloud needs no setup either:** pick **SoundCloud**; searching, Discover and playing work right away. For your Likes and playlists, use **Sign in with authorized token** in the library (SoundCloud refuses its own sign-in inside apps): open soundcloud.com in Firefox or Chrome, signed in, press F12 and copy the value of the `oauth_token` cookie (Firefox: Storage > Cookies; Chrome: Application > Cookies), then paste it into Soranix. It stays on your PC, is only sent to SoundCloud, and lasts about a day; Log out removes it.

## Features

**Player and windows**
- Main window with 7-segment time, scrolling title, visualizer, volume, balance, seek and the classic transport buttons.
- Windows snap and dock together, can be resized, rolled up (double-click a title bar) and moved across monitors.
- Sizes: Normal, Medium, Large. Optional **Always on top**.
- Clicks pass through empty space to the apps behind it.

**Your music**
- **Library**: Liked Songs, Recently Played, Top Songs and Top Artists, Saved Albums, followed artists, podcasts, and all your playlists.
- **Search**: Spotify-wide search. With Liked Songs or a playlist open, the search box searches inside that list instead.
- **Playlist editor** and **Spotify playlists you made**: drag songs to reorder (saved to Spotify), add and remove songs, create, rename and delete playlists.
- **Up Next** and **Queue** windows show what plays next and the songs you queued.
- **Similar music after a search**: play a song from Search and a mix of related artists follows it instead of the other search results. Artists are spaced apart, karaoke and instrumental versions are left out, a few of your liked songs are mixed in, recently played songs aren't repeated, and skipping an artist early plays less of them.
- **Artist window**: bio and links (MusicBrainz, Wikipedia), discography, follow and unfollow.
- **Song info**, synced **lyrics** (LRCLIB) and a **MilkDrop** visualizer (Butterchurn) that reacts to your PC's sound.
- **Discover new music**: a grid of covers with a mix made for you. **New mix** and **More** each take 20 songs.

**YouTube Music (in test)**
- Pick Spotify or YouTube Music at start, or switch any time with the logo. The whole skin turns red in YouTube Music mode.
- Same windows and controls: playlist, Up Next, queue, Now Playing, lyrics, mini mode, media keys and hotkeys.
- No ads. Discover (YouTube Music's picks for you), search with All / Songs / Videos / Albums / Artists / Playlists filters, Liked music and your playlists.
- Always the audio version of a song; **Video** in Now Playing shows the music video instead of the cover.
- Only the service you use runs, so YouTube Music mode never sends Spotify a request.

**SoundCloud (in test)**
- A third service, with the skin in SoundCloud orange. Same windows and controls as the other two.
- Search with Everything / Tracks / People / Albums / Playlists, Discover (SoundCloud's own sections as a grid of covers), your Likes and playlists.
- Right-click a song to like it or add it to one of your SoundCloud playlists; right-click an album, artist or playlist to play, queue or add it without opening it.
- Songs only on SoundCloud Go+ are marked "(Go+)" and skipped. If SoundCloud asks to check you're human, **Verify SoundCloud** appears in the library.

**Artists (YouTube Music and SoundCloud)**
- Clicking an artist opens the artist window with a Wikipedia bio, details and links (MusicBrainz), looked up by name.

**Discord activity**
- The Discord button (next to shuffle) shows **"Listening to YouTube Music"** or **"Listening to SoundCloud"** on your Discord profile, with the song, artist, cover and a progress bar. Nothing shows while paused.
- One-time setup in **Settings > Discord activity...**: make a Discord application per service in Discord's Developer Portal (named "YouTube Music" / "SoundCloud", which is what the title shows) and paste its Application ID. For Spotify, Discord already shows your listening by itself when Spotify is connected in Discord.

**Mixed playlists**
- The playlist window shows each song in its service's colour: Spotify green, YouTube Music red, SoundCloud orange. Drag songs in from the library or Discover.
- **MY LISTS** (next to LIST OPTS): your own lists, saved on your PC, with songs from all three services side by side.
- When the next song is from the other service, Soranix switches over by itself, usually in under a second. Your open windows stay open.

**Windows integration**
- Song, artist and cover in Windows' media flyout and lock screen. Its buttons and your keyboard's media keys control Soranix.
- Previous, Play, Pause, Stop and Next buttons in the taskbar preview.
- Shows in the taskbar and Alt-Tab like any app.

## Keyboard shortcuts

| Action | Keys |
|---|---|
| Play / pause | `Space` |
| Next / previous track | `Ctrl + →` / `Ctrl + ←` |
| Shuffle / repeat | `Ctrl + S` / `Ctrl + R` |
| Volume up / down | `Ctrl + ↑` / `Ctrl + ↓` (or `↑` / `↓`) |
| Mute / unmute | `Ctrl + Shift + ↓` |
| Seek 5 seconds | `←` / `→` |
| Search Spotify | `Ctrl + K` or `Ctrl + L` |
| Search inside the open playlist or Liked Songs | `Ctrl + F` |
| Create a new playlist | `Ctrl + N` |
| Back / forward in the library | `Alt + ←` / `Alt + →` |
| Settings | `Ctrl + P` |
| Classic keys | `Z` previous, `X` play, `C` pause, `V` stop, `B` next, `S` shuffle, `R` repeat, `L` library |

While you're typing in a box (search, a playlist name, a dialog), keys go to the box. The only exceptions are `Ctrl + K`, `Ctrl + L` and `Ctrl + F`, which just move you to the search box.

## Built to avoid Spotify's cooldowns

Spotify apps in developer mode get blocked for an hour or more when they ask too often. Soranix is designed to ask as rarely as possible:

- **Saved copies on your PC.** Playlists are saved together with Spotify's version stamp, so a playlist only downloads again when it actually changed. Albums, artists, search results, top lists and song details are saved too, each for as long as it makes sense.
- **One request line.** Requests go out a few at a time with small gaps. Big jobs run slowest. When Spotify asks to wait, Soranix waits exactly as long as Spotify says (the `Retry-After` header) and pauses only that kind of request.
- **Safe limits.** Kinds of request that Spotify blocks for long periods are counted. Past a safe number per half hour, Soranix uses its saved copy or another route (Search) before Spotify would block.
- **No wasted requests.** Up Next is worked out locally. The playlist list refreshes every 30 minutes, checks its first page before fetching the rest, and pauses while you're away. Your own changes update the saved copies directly instead of downloading again.
- **Still usable during a block.** Saved playlists, albums and artists keep opening while Spotify makes you wait.

Saved copies take very little space (well under 1 MB for a typical library). Anything unused for 60 days is cleaned up automatically, and **Settings > Clear cache** empties it all.

## Spotify's limits (not bugs)

- **Playlists by other people:** since February 2026, Spotify only lets apps list the songs of playlists you made or collaborate on. Other playlists still play with **Play**.
- **Search results:** 10 per page; **More** loads the next page.
- **Accounts:** development-mode Spotify apps work for the owner plus up to 5 users added in User Management.
- **Genres:** Spotify no longer gives apps genres or related artists, so the similar-music mix gets related artists from Deezer's free public API (only the artist's name is sent).

## Privacy

- Your login and settings stay on your PC (`%APPDATA%\Soranix`). There's no Soranix server.
- The visualizers analyse your PC's sound output locally. Nothing is recorded or sent anywhere.
- Outside Spotify, Soranix only contacts public music databases: LRCLIB (lyrics), MusicBrainz and Wikipedia (artist info) and Deezer (related artists). It sends them song or artist names only.
- In YouTube Music mode, Soranix plays through YouTube Music's own website in a hidden window, signed in with your Google account (if you sign in). Lyrics there also come from a public lyrics service, looked up by the song's YouTube ID.
- In SoundCloud mode, Soranix asks SoundCloud's web API itself (with the public client ID SoundCloud's website uses) and plays SoundCloud's own stream links. Your SoundCloud token, if you add one, is kept on your PC and only sent to SoundCloud.
- The Discord activity is only sent to the Discord app on your PC (its local connection), and only while it's on and something plays.

## Building from source

Needs Node.js, plus a [castLabs EVS](https://github.com/castlabs/electron-releases/wiki/EVS) account to VMP-sign the app (Spotify's DRM refuses to play in unsigned builds).

```powershell
npm install
node build.js                                                      # release\Soranix\Soranix.exe
powershell -ExecutionPolicy Bypass -File installer\build-msi.ps1   # dist\Soranix-<version>.msi (needs WiX 3 in tools\wix3)
```

- `npm start` runs the app straight from the source folder.
- `powershell -ExecutionPolicy Bypass -File publish.ps1 -NotesFile notes.md` publishes a release in one step. It raises the version, builds the exe and MSI, writes the MSI's `.sha256` fingerprint, pushes, and creates the GitHub release that installed copies update from.
- Set `SORANIX_DEBUG=1` to open remote debugging on port 9229.

**Mac and Linux:** GitHub Actions builds them (Actions > **Build Mac & Linux** > Run workflow). Tick **Also publish a GitHub Release** to add the `.dmg`, `.deb` and AppImage files to this version's release. For Spotify to play on Mac, add the castLabs EVS account as the repository secrets `EVS_ACCOUNT_NAME` and `EVS_PASSWD`. On a Mac or Linux machine you can also build locally:

```bash
npm ci
npx electron-builder@26.18.0 --mac     # or --linux; files land in dist/
```

**Project layout**

| Path | What it is |
|---|---|
| `main.js` | Electron main process: windows, the built-in local server on `127.0.0.1:8888`, taskbar buttons |
| `preload.js` | The bridge between the page and Windows |
| `app.js` | The player: Spotify login (PKCE), playback, library, request queue, saved copies |
| `ytm.js` | YouTube Music and SoundCloud modes: service picker, colour themes, library, search, Discover, playback (SoundCloud streams via hls.js in `vendor/`) |
| `ytm-bridge.js`, `ytm-preload.js` | Run inside the hidden YouTube Music window: player control, YouTube Music's own API, ad removal |
| `index.html`, `style.css` | Windows and theme |
| `helpers/balance.cs` | The small Windows helper for left/right balance |
| `installer/` | WiX installer definition and build script |
| `electron-builder.yml`, `scripts/vmp-sign.js` | Mac and Linux packaging, and castLabs signing for Mac |
| `.github/workflows/build-mac-linux.yml` | The GitHub Actions build for Mac and Linux |
| `icons/` | App icons and the scripts that make them |

## Credits

Electron ([castLabs build with Widevine](https://github.com/castlabs/electron-releases), MIT), [Butterchurn](https://github.com/jberg/butterchurn) and Butterchurn presets (MIT), [LRCLIB](https://lrclib.net), [MusicBrainz](https://musicbrainz.org), Wikipedia, Deezer API.

This software is provided "as is", without warranty of any kind.
