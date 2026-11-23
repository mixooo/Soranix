# Builds Soranix's icons from icons\logo-source.webp using Windows' own image codecs
# (no extra installs): makes the outer white background transparent, then writes
# PNGs for the app window / taskbar and a multi-size soranix.ico for shortcuts.
Add-Type -AssemblyName PresentationCore, WindowsBase
Add-Type -ReferencedAssemblies PresentationCore, WindowsBase, System.Xaml -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

public static class IconMaker {
    static BitmapSource Load(string path) {
        var dec = BitmapDecoder.Create(new Uri(path), BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
        return new FormatConvertedBitmap(dec.Frames[0], PixelFormats.Bgra32, null, 0);
    }
    // Flood-fill the near-white area touching the border and make it transparent,
    // fading the anti-aliased edge so the outline stays smooth.
    static BitmapSource ClearBackground(BitmapSource src) {
        int w = src.PixelWidth, h = src.PixelHeight, stride = w * 4;
        var px = new byte[h * stride];
        src.CopyPixels(px, stride, 0);
        Func<int, int> light = i => Math.Min(px[i], Math.Min(px[i + 1], px[i + 2]));
        var seen = new bool[w * h];
        var q = new Queue<int>();
        for (int x = 0; x < w; x++) { q.Enqueue(x); q.Enqueue((h - 1) * w + x); }
        for (int y = 0; y < h; y++) { q.Enqueue(y * w); q.Enqueue(y * w + w - 1); }
        while (q.Count > 0) {
            int p = q.Dequeue();
            if (p < 0 || p >= w * h || seen[p]) continue;
            int i = p * 4;
            if (light(i) < 200) continue;          // reached the black outline
            seen[p] = true;
            px[i + 3] = 0;
            int x = p % w;
            if (x > 0) q.Enqueue(p - 1);
            if (x < w - 1) q.Enqueue(p + 1);
            q.Enqueue(p - w); q.Enqueue(p + w);
        }
        // soften: grey edge pixels next to cleared area get partial transparency
        var copy = (byte[])px.Clone();
        for (int y = 1; y < h - 1; y++) for (int x = 1; x < w - 1; x++) {
            int p = y * w + x, i = p * 4;
            if (seen[p]) continue;
            bool edge = seen[p - 1] || seen[p + 1] || seen[p - w] || seen[p + w];
            if (!edge) continue;
            int l = light(i);
            if (l > 60) {
                int a = Math.Max(0, Math.Min(255, (255 - l) * 255 / 195));
                copy[i + 3] = (byte)a;
                copy[i] = copy[i + 1] = copy[i + 2] = 0;
            }
        }
        return BitmapSource.Create(w, h, 96, 96, PixelFormats.Bgra32, null, copy, stride);
    }
    // Draw the logo centred on a square canvas with a little padding.
    static BitmapSource Square(BitmapSource src, int size, double pad) {
        var dv = new DrawingVisual();
        RenderOptions.SetBitmapScalingMode(dv, BitmapScalingMode.HighQuality);
        using (var dc = dv.RenderOpen()) {
            double inner = size * (1 - 2 * pad);
            double scale = inner / Math.Max(src.PixelWidth, src.PixelHeight);
            double dw = src.PixelWidth * scale, dh = src.PixelHeight * scale;
            dc.DrawImage(src, new Rect((size - dw) / 2, (size - dh) / 2, dw, dh));
        }
        var rt = new RenderTargetBitmap(size, size, 96, 96, PixelFormats.Pbgra32);
        rt.Render(dv);
        return rt;
    }
    static byte[] Png(BitmapSource b) {
        var enc = new PngBitmapEncoder();
        enc.Frames.Add(BitmapFrame.Create(b));
        using (var ms = new MemoryStream()) { enc.Save(ms); return ms.ToArray(); }
    }
    public static void Build(string srcPath, string outDir) {
        var clean = ClearBackground(Load(srcPath));
        foreach (int s in new[] { 512, 192, 64, 32 })
            File.WriteAllBytes(Path.Combine(outDir, "icon-" + s + ".png"), Png(Square(clean, s, 0.04)));
        // .ico with PNG-compressed entries (supported since Windows Vista)
        int[] sizes = { 256, 64, 48, 32, 24, 16 };
        var images = new List<byte[]>();
        foreach (int s in sizes) images.Add(Png(Square(clean, s, s <= 24 ? 0.0 : 0.03)));
        using (var fs = File.Create(Path.Combine(outDir, "soranix.ico")))
        using (var bw = new BinaryWriter(fs)) {
            bw.Write((short)0); bw.Write((short)1); bw.Write((short)sizes.Length);
            int offset = 6 + 16 * sizes.Length;
            for (int k = 0; k < sizes.Length; k++) {
                int s = sizes[k];
                bw.Write((byte)(s >= 256 ? 0 : s)); bw.Write((byte)(s >= 256 ? 0 : s));
                bw.Write((byte)0); bw.Write((byte)0);
                bw.Write((short)1); bw.Write((short)32);
                bw.Write(images[k].Length); bw.Write(offset);
                offset += images[k].Length;
            }
            foreach (var img in images) bw.Write(img);
        }
    }
}
'@
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
[IconMaker]::Build((Join-Path $dir 'logo-source.webp'), $dir)
Get-ChildItem $dir -Filter 'icon-*.png' | Select-Object Name, Length
Get-Item (Join-Path $dir 'soranix.ico') | Select-Object Name, Length
