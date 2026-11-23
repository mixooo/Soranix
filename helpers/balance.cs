// Soranix balance helper.
// Sets the left/right volume of Soranix's own sound in Windows (per-app channel volume, the
// same thing the Windows volume mixer controls), so the balance slider really pans the music.
// Reads lines like "pan -40" from stdin (-100 = full left, 0 = centre, 100 = full right) and
// re-applies the current value every second, because Windows creates the app's sound session
// only once something plays. Usage: balance.exe <process name without .exe>
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

static class Balance {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr guid, int flags, out IntPtr ctl);
    int GetSimpleAudioVolume(IntPtr guid, int flags, out IntPtr vol);
    int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    int GetCount(out int count);
    int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);
  }
  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int s); int GetDisplayName(out IntPtr n); int SetDisplayName(string n, ref Guid c);
    int GetIconPath(out IntPtr p); int SetIconPath(string p, ref Guid c); int GetGroupingParam(out Guid g);
    int SetGroupingParam(ref Guid g, ref Guid c); int RegisterAudioSessionNotification(IntPtr n); int UnregisterAudioSessionNotification(IntPtr n);
    int GetSessionIdentifier(out IntPtr id); int GetSessionInstanceIdentifier(out IntPtr id);
    int GetProcessId(out uint pid);
  }
  [ComImport, Guid("1C158861-B533-4B30-B1CF-E853E51C59B8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IChannelAudioVolume {
    int GetChannelCount(out uint count);
    int SetChannelVolume(uint index, float level, ref Guid ctx);
    int GetChannelVolume(uint index, out float level);
  }

  static volatile int pan = 0;
  static string procName;

  static void Apply() {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice dev;
    if (en.GetDefaultAudioEndpoint(0 /*render*/, 1 /*multimedia*/, out dev) != 0 || dev == null) return;
    var iid = typeof(IAudioSessionManager2).GUID; object o;
    if (dev.Activate(ref iid, 23 /*CLSCTX_ALL*/, IntPtr.Zero, out o) != 0) return;
    IAudioSessionEnumerator se; ((IAudioSessionManager2)o).GetSessionEnumerator(out se);
    int n; se.GetCount(out n);
    float p = pan / 100f;
    float left = p > 0 ? 1 - p : 1, right = p < 0 ? 1 + p : 1;
    var ctx = Guid.Empty;
    for (int i = 0; i < n; i++) {
      object s; se.GetSession(i, out s);
      uint pid; ((IAudioSessionControl2)s).GetProcessId(out pid);
      string name = "";
      try { name = Process.GetProcessById((int)pid).ProcessName; } catch { }
      if (!string.Equals(name, procName, StringComparison.OrdinalIgnoreCase)) continue;
      var ch = s as IChannelAudioVolume; if (ch == null) continue;
      uint count; ch.GetChannelCount(out count);
      if (count < 2) continue;
      float l0, r0; ch.GetChannelVolume(0, out l0); ch.GetChannelVolume(1, out r0);
      if (Math.Abs(l0 - left) > 0.001f) ch.SetChannelVolume(0, left, ref ctx);
      if (Math.Abs(r0 - right) > 0.001f) ch.SetChannelVolume(1, right, ref ctx);
    }
  }

  [STAThread]
  static void Main(string[] args) {
    procName = args.Length > 0 ? args[0] : "Soranix";
    var reader = new Thread(() => {
      string line;
      while ((line = Console.ReadLine()) != null) {
        var parts = line.Trim().Split(' ');
        int v;
        if (parts.Length == 2 && parts[0] == "pan" && int.TryParse(parts[1], out v)) pan = Math.Max(-100, Math.Min(100, v));
      }
      Environment.Exit(0); // Soranix closed
    });
    reader.IsBackground = true; reader.Start();
    int last = int.MinValue; var timer = Stopwatch.StartNew();
    while (true) {
      if (pan != last || timer.ElapsedMilliseconds > 1000) {
        try { Apply(); } catch { }
        last = pan; timer.Restart();
      }
      Thread.Sleep(50);
    }
  }
}
