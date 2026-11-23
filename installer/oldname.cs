// Starts Soranix. Installed as %LOCALAPPDATA%\Programs\Winampify\Winampify.exe for a while,
// because copies from before the rename (1.0.327-1.0.329) restart that path after an update.
// Without it, Windows would show "cannot find Winampify.exe" instead of starting the new version.
// Remove it from the installer once nobody updates from those versions any more.
using System;
using System.Diagnostics;
using System.IO;

static class OldName {
    static void Main() {
        string dir = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName);
        string exe = Path.GetFullPath(Path.Combine(dir, "..", "Soranix", "Soranix.exe"));
        if (File.Exists(exe)) Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = Path.GetDirectoryName(exe), UseShellExecute = false });
    }
}
