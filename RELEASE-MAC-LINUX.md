Unofficial Mac and Linux builds of Soranix (the classic-style desktop player for Spotify Premium). Built automatically by GitHub Actions. **Test builds:** they start, but haven't been tried on a real Mac or Linux PC yet.

## Downloads

| System | File |
|---|---|
| Mac with Apple Silicon (M1 and later) | `Soranix-<version>-arm64.dmg` |
| Mac with Intel | `Soranix-<version>-x64.dmg` |
| Ubuntu / Debian / Mint | `soranix_<version>_amd64.deb` |
| Other Linux (x64) | `Soranix-<version>-x86_64.AppImage` |

## Mac

1. Open the `.dmg` and drag Soranix to Applications.
2. The app isn't signed by Apple, so macOS calls it "damaged". Run this once in Terminal:
   `xattr -cr /Applications/Soranix.app`
3. MilkDrop asks for Screen Recording permission, which it needs to hear the music.

**Spotify playback on Mac needs the castLabs VMP signature.** If the build log said "VMP signing SKIPPED", this Mac build opens but won't play music.

## Linux

- `.deb`: `sudo apt install ./soranix_<version>_amd64.deb`, then open Soranix from your app menu.
- AppImage: `chmod +x Soranix-*.AppImage` and run it. On Ubuntu 24.04+ it may only start with `--no-sandbox`.
- On Wayland desktops it runs through XWayland, because the see-through windows need X11.

## Not on Mac / Linux (yet)

- Balance slider (uses a Windows-only helper)
- Automatic updates (they install the Windows MSI). Download new builds here.
- Taskbar preview buttons. Media keys and the system's now-playing controls still work.
