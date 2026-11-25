// Soranix desktop shell (castLabs Electron, which can play Spotify's protected audio).
//
// One frameless, see-through window covers the screen's work area. Only the Soranix
// windows drawn by the page are visible; everywhere else the mouse passes straight
// through to the desktop and other apps, so the player windows float freely like a
// classic desktop player. The page is served from http://127.0.0.1:8888/ (the Redirect
// URI registered with Spotify) by a tiny built-in server, so no Python is needed.
const { app, BrowserWindow, components, screen, ipcMain, shell, Menu, session, desktopCapturer } = require('electron');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// The app used to be called Winampify and kept its login, settings and saved copies in a
// "winampify" folder (%APPDATA%, ~/Library/Application Support or ~/.config). Move them to the
// new folder once, so nobody has to log in or download their playlists again. If the move
// fails, keep using the old folder this time.
(() => {
  const neu = app.getPath('userData');
  const old = ['winampify', 'Winampify'].map(n => path.join(app.getPath('appData'), n)).find(d => fs.existsSync(d));
  if (!old || path.resolve(old).toLowerCase() === path.resolve(neu).toLowerCase()) return;
  if (fs.existsSync(path.join(neu, 'Local Storage'))) return; // already moved
  try {
    if (!fs.existsSync(neu)) fs.renameSync(old, neu);
    else {
      // caches are rebuilt by themselves; leave them (and the old log) behind
      const skip = /[\\/](Crashpad|Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|GrShaderCache|ShaderCache|lockfile|SingletonLock|SingletonSocket|SingletonCookie|winampify\.log)$/i;
      fs.cpSync(old, neu, { recursive: true, force: true, filter: s => !skip.test(s) });
    }
  } catch (e) {
    try { fs.rmSync(path.join(neu, 'Local Storage'), { recursive: true, force: true }); } catch {}
    app.setPath('userData', old);
    return;
  }
  try { fs.rmSync(old, { recursive: true, force: true }); } catch {}
})();

const PORT = 8888;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';
const ICON = path.join(ROOT, 'icons', IS_WIN ? 'soranix.ico' : 'icon-512.png');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp',
};
// only the app's own files are served (never node_modules or anything else in the folder)
const PUBLIC = new Set(['index.html', 'app.js', 'ytm.js', 'style.css', 'manifest.json']);
const isPublic = rel => PUBLIC.has(rel) || /^icons\/[\w.-]+\.(png|ico|webp)$/.test(rel) || /^vendor\/[\w.-]+\.js$/.test(rel);
// where updates come from (GitHub releases of this repository, nothing else)
const REPO = 'mixooo/Soranix';
const fromRepo = u => typeof u === 'string' && u.startsWith(`https://github.com/${REPO}/releases/download/`);
const isNewer = (a, b) => {
  const p = v => String(v).split('.').map(n => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
const ghText = async url => { const r = await fetch(url, { headers: { 'User-Agent': 'Soranix-Updater', Accept: 'application/vnd.github+json' } }); if (!r.ok) throw new Error('GitHub answered ' + r.status); return r.text(); };
const ghJson = async url => JSON.parse(await ghText(url));
// where the MSI installs Soranix (per-user), started again after an update
const installedExe = () => path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Soranix', 'Soranix.exe');
// Links clicked in the app open in your browser, but only web and email links: a link from
// public data (artist pages come from MusicBrainz / Wikipedia, which anyone can edit) must never
// be able to open a file or start a program on this PC (file:, ms-*:, search-ms: and the like).
function openLink(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') return shell.openExternal(u.href);
  } catch {}
  console.log('[security] blocked a link that is not a web address:', String(url).slice(0, 80));
}

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let rel;
      try { rel = decodeURIComponent(new URL(req.url, ORIGIN).pathname).replace(/^\/+/, '') || 'index.html'; }
      catch { res.writeHead(400); return res.end(); }
      if (!isPublic(rel)) { res.writeHead(404); return res.end('Not found'); }
      fs.readFile(path.join(ROOT, rel), (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    srv.once('error', reject);
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}
// Port already taken? If it's Soranix's own Python server (start.bat), just use it.
function isOurServer() {
  return new Promise(resolve => {
    http.get(ORIGIN + '/manifest.json', res => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => resolve(res.statusCode === 200 && /"Soranix"/.test(body)));
    }).on('error', () => resolve(false));
  });
}

// troubleshooting only: set SORANIX_DEBUG=1 to allow a local debugger on port 9229
if (process.env.SORANIX_DEBUG) app.commandLine.appendSwitch('remote-debugging-port', '9229');

// a music player keeps running at full speed in the background
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Chromium keeps an empty page process ready, and old pages alive for the Back button (about
// 100 MB each), so web pages open faster;
// Soranix almost never opens a new page, so that memory is saved
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,BackForwardCache');
// macOS 13+: let MilkDrop / the visualizer hear what the Mac is playing (asks for Screen Recording permission)
if (IS_MAC) app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');

// Linux: the see-through, click-through layer needs X11 window shapes. Under Wayland,
// start again through XWayland (the .deb launcher already passes this switch).
if (IS_LINUX && !app.commandLine.hasSwitch('ozone-platform') && process.env.XDG_SESSION_TYPE === 'wayland') {
  app.relaunch({ execPath: process.env.APPIMAGE || process.execPath, args: process.argv.slice(1).concat('--ozone-platform=x11') });
  app.exit(0);
}

// The taskbar preview and Alt-Tab show a picture of the player. Normally it is refreshed now and
// then; while a preview can be on screen (mouse over the taskbar, Alt or the Windows key held)
// it is refreshed about 15 times a second, so the preview looks live.
const PREVIEW = { until: 0, keys: false };
let win = null;   // the see-through layer that draws every Soranix window
let host = null;  // small player-sized window: the one the taskbar and Alt-Tab show
if (IS_WIN) app.setAppUserModelId('Soranix');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (host) { if (host.isMinimized()) host.restore(); host.show(); } if (win) win.focus(); });
app.on('window-all-closed', () => app.quit());
// macOS: clicking the Dock icon brings the player back
app.on('activate', () => { if (host && host.isMinimized()) host.restore(); if (win && !win.isDestroyed()) { win.show(); win.focus(); } });

app.whenReady().then(async () => {
  // macOS keeps a small menu so Cmd+Q and copy / paste (Spotify login) work; elsewhere none
  Menu.setApplicationMenu(IS_MAC ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]) : null);
  // Spotify says how long to wait in a "Retry-After" header, but browsers hide it from the
  // page unless the response allows it. Allow it, so Soranix waits exactly as long as asked.
  // (Electron keeps only one such hook, so it also lets the page read Deezer's public
  // "related artists" lists, used for the mix of similar music after a searched song.)
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://api.spotify.com/*', 'https://api.deezer.com/*'] }, (d, cb) => {
    const h = d.responseHeaders || {};
    if (d.url.startsWith('https://api.deezer.com/')) {
      for (const k of Object.keys(h)) if (k.toLowerCase() === 'access-control-allow-origin') delete h[k];
      h['Access-Control-Allow-Origin'] = ['*'];
      return cb({ responseHeaders: h });
    }
    const key = Object.keys(h).find(k => k.toLowerCase() === 'access-control-expose-headers');
    const cur = key ? [].concat(h[key]).join(', ') : '';
    if (key) delete h[key];
    h['Access-Control-Expose-Headers'] = [cur ? cur + ', Retry-After' : 'Retry-After'];
    cb({ responseHeaders: h });
  });
  // MilkDrop and the visualizer listen to what your PC is playing (Windows "loopback" capture).
  // Only Soranix's own page can ask, it never opens a picker, and the sound stays on this PC.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!String(request.securityOrigin || request.frame?.url || '').startsWith(ORIGIN)) return callback({});
    desktopCapturer.getSources({ types: ['screen'] })
      .then(sources => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
      .catch(() => callback({}));
  });
  try { await components.whenReady(); } catch (e) { console.error('Widevine component:', e); }
  try { await startServer(); }
  catch (e) {
    if (e.code !== 'EADDRINUSE' || !(await isOurServer())) {
      const { dialog } = require('electron');
      dialog.showErrorBox('Soranix', `Soranix needs port ${PORT}, but another program is using it.\nClose that program (or run stop-server.bat) and try again.`);
      return app.quit();
    }
  }

  // The see-through layer spans every monitor (the box around all their work areas), so
  // Soranix windows can be dragged from one screen to another like normal windows.
  const span = () => {
    const ds = screen.getAllDisplays();
    const L = Math.min(...ds.map(d => d.workArea.x)), T = Math.min(...ds.map(d => d.workArea.y));
    const R = Math.max(...ds.map(d => d.workArea.x + d.workArea.width)), B = Math.max(...ds.map(d => d.workArea.y + d.workArea.height));
    const prim = screen.getPrimaryDisplay().id;
    return {
      bounds: { x: L, y: T, width: R - L, height: B - T },
      // each monitor's usable area in page coordinates, for snapping and keeping windows visible
      displays: ds.map(d => ({ x: d.workArea.x - L, y: d.workArea.y - T, w: d.workArea.width, h: d.workArea.height, primary: d.id === prim })),
    };
  };
  const first = span().bounds;

  // Like the classic player, Soranix has one main window that the taskbar and Alt-Tab know
  // about, sized to just the player. It sits right underneath the player and shows a picture
  // of it (that picture is what Alt-Tab and the taskbar preview display). The full-screen
  // layer is "owned" by it: it stays on top of it, minimizes and restores with it, and is
  // left out of Alt-Tab and the taskbar.
  host = new BrowserWindow({
    x: first.x + 16, y: first.y + 16, width: 275, height: 232,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, maximizable: false, fullscreenable: false,
    title: 'Soranix', icon: ICON, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  host.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!DOCTYPE html><html><head><title>Soranix</title><style>html,body{margin:0;background:transparent;overflow:hidden}' +
    'img{display:block;width:100vw;height:100vh;visibility:hidden}img.on{visibility:visible}</style></head>' +
    "<body><img id=\"i\" alt=\"\" onload=\"this.classList.add('on')\" onerror=\"this.classList.remove('on')\"></body></html>"));
  if (IS_WIN) host.setAppDetails({
    appId: 'Soranix', appIconPath: ICON, appIconIndex: 0,
    // packaged Soranix.exe relaunches itself; the dev copy needs the folder path too
    relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${ROOT}"`, relaunchDisplayName: 'Soranix',
  });
  // picked from the taskbar or Alt-Tab: put the real player in front and give it the keyboard
  // A taskbar click while Soranix is already in front first takes the keyboard away from the
  // player, then hands it to this window. Seeing those two right after each other means
  // "click to minimize", like any other app.
  let playerBlurAt = 0;
  host.on('focus', () => {
    if (!win || win.isDestroyed()) return;
    if (IS_WIN && Date.now() - playerBlurAt < 400) { playerBlurAt = 0; host.minimize(); return; }
    win.moveTop(); win.focus();
  });
  app.on('browser-window-blur', (_e, w) => { if (w === win) playerBlurAt = Date.now(); });
  host.on('closed', () => app.quit());

  // Buttons under the taskbar preview (point at Soranix on the taskbar):
  // previous, play, pause, stop, next. They work without bringing Soranix to the front.
  const thumbIcons = {};
  const drawIcon = shapes => {
    // 32x32 picture (shown at 16x16 on normal screens), white shapes, smoothed edges
    const W = 32, S = 4, buf = Buffer.alloc(W * W * 4);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      let hit = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S;
        if (shapes.some(f => f(px, py))) hit++;
      }
      const a = Math.round(255 * hit / (S * S)), o = (y * W + x) * 4;
      buf[o] = buf[o + 1] = buf[o + 2] = a; buf[o + 3] = a;   // premultiplied white
    }
    return require('electron').nativeImage.createFromBitmap(buf, { width: W, height: W, scaleFactor: 2 });
  };
  const rect = (x1, y1, x2, y2) => (x, y) => x >= x1 && x <= x2 && y >= y1 && y <= y2;
  const triR = (x1, y1, x2, y2) => (x, y) => x >= x1 && x <= x2 && Math.abs(y - (y1 + y2) / 2) <= ((y2 - y1) / 2) * (x2 - x) / (x2 - x1);
  const triL = (x1, y1, x2, y2) => (x, y) => x >= x1 && x <= x2 && Math.abs(y - (y1 + y2) / 2) <= ((y2 - y1) / 2) * (x - x1) / (x2 - x1);
  const getIcons = () => {
    if (thumbIcons.play) return thumbIcons;
    thumbIcons.prev = drawIcon([rect(6, 7, 9, 25), triL(9, 7, 26, 25)]);
    thumbIcons.play = drawIcon([triR(8, 6, 26, 26)]);
    thumbIcons.pause = drawIcon([rect(8, 7, 13, 25), rect(19, 7, 24, 25)]);
    thumbIcons.stop = drawIcon([rect(8, 8, 24, 24)]);
    thumbIcons.next = drawIcon([triR(6, 7, 23, 25), rect(23, 7, 26, 25)]);
    return thumbIcons;
  };
  const send = cmd => () => { if (win && !win.isDestroyed()) win.webContents.send('thumb-cmd', cmd); };
  function setThumbar() {
    if (!host || host.isDestroyed() || process.platform !== 'win32') return;
    const i = getIcons();
    host.setThumbarButtons([
      { tooltip: 'Previous', icon: i.prev, click: send('prev') },
      { tooltip: 'Play', icon: i.play, click: send('play') },
      { tooltip: 'Pause', icon: i.pause, click: send('pause') },
      { tooltip: 'Stop', icon: i.stop, click: send('stop') },
      { tooltip: 'Next', icon: i.next, click: send('next') },
    ]);
  }

  win = new BrowserWindow({
    // macOS drags child windows along with their parent, and the host moves under the
    // player, so there the layer stands alone and follows the host's minimize / restore
    parent: IS_MAC ? undefined : host, skipTaskbar: true,
    x: first.x, y: first.y, width: first.width, height: first.height,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, maximizable: false, fullscreenable: false,
    title: 'Soranix', icon: ICON, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required', // a music player may start audio without an extra click
      backgroundThrottling: false,                // keep playback and timers running when the app isn't focused
    },
  });
  // Windows / macOS: clicks pass through until the mouse is over a Soranix window (the page
  // reports it). Linux can't forward mouse moves to an ignoring window, so there the layer's
  // X11 shape alone decides what it covers (see setShape below); start with almost nothing.
  if (IS_LINUX) { try { win.setShape([{ x: 0, y: 0, width: 1, height: 1 }]); } catch {} }
  else win.setIgnoreMouseEvents(true, { forward: true });
  if (IS_MAC) {
    host.on('minimize', () => { if (win && !win.isDestroyed()) win.hide(); });
    host.on('restore', () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } });
  }
  win.once('ready-to-show', () => { host.show(); win.show(); setThumbar(); });
  // Windows forgets the buttons when the taskbar restarts or the window is restored: set them again
  host.on('show', setThumbar); host.on('restore', setThumbar);

  // page log, for troubleshooting: %APPDATA%/soranix/soranix.log (kept small)
  const logFile = path.join(app.getPath('userData'), 'soranix.log');
  try { if (fs.statSync(logFile).size > 2e6) fs.unlinkSync(logFile); } catch {}
  win.webContents.on('console-message', (e) => {
    const msg = e.message ?? '';
    fs.appendFile(logFile, new Date().toISOString() + ' ' + msg + String.fromCharCode(10), () => {});
  });

  // links that open in a new tab (Wikipedia, artist links, Spotify dashboard) go to the real browser
  win.webContents.setWindowOpenHandler(({ url }) => { openLink(url); return { action: 'deny' }; });
  // stay on Soranix or Spotify's login page; anything else opens in the browser
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN) || url.startsWith('https://accounts.spotify.com/') || url.startsWith('https://challenge.spotify.com/')) return;
    e.preventDefault(); openLink(url);
  });

  // The layer's real shape: just the Soranix windows (plus open menus / dialogs), so
  // screenshot tools and other window pickers see the desktop and other apps everywhere else.
  // Spotify's login page gets the full rectangle.
  let shapeKey = '', shapeRects = [];
  const setShape = rects => {
    if (!win || win.isDestroyed()) return;
    const key = JSON.stringify(rects || []);
    if (key === shapeKey) return;
    shapeKey = key; shapeRects = rects || [];
    try { win.setShape(rects && rects.length ? rects : []); } catch (e) { console.error('setShape', e); }
  };
  // an empty shape means "the whole rectangle"; on Linux, where the shape is the only thing
  // letting clicks through, nothing visible must mean (almost) nothing covered instead
  ipcMain.on('layer-shape', (_e, rects) => setShape(IS_LINUX && !(rects && rects.length) ? [{ x: 0, y: 0, width: 1, height: 1 }] : rects));
  win.webContents.on('did-start-navigation', (d) => { if (d.isMainFrame && !String(d.url).startsWith(ORIGIN)) setShape([]); });

  // Spotify login pop-up: a small window just for Spotify's sign-in page. When Spotify sends
  // you back to Soranix's address, the pop-up closes and the player picks up the login.
  let loginWin = null;
  ipcMain.on('open-login', (_e, url) => {
    if (!String(url).startsWith('https://accounts.spotify.com/')) return;
    if (loginWin && !loginWin.isDestroyed()) { loginWin.loadURL(url); loginWin.focus(); return; }
    const W = 500, H = 720;
    const area = screen.getDisplayMatching(host.getBounds()).workArea;
    loginWin = new BrowserWindow({
      width: W, height: H, x: Math.round(area.x + (area.width - W) / 2), y: Math.round(area.y + Math.max(0, (area.height - H) / 2)),
      parent: IS_MAC ? undefined : host, modal: false, minimizable: false, maximizable: false, fullscreenable: false,
      title: 'Soranix - Log in to Spotify', icon: ICON, backgroundColor: '#121212', autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    loginWin.setMenu(null);
    const showSite = () => {
      let site = ''; try { site = new URL(loginWin.webContents.getURL()).host; } catch {}
      loginWin.setTitle(`Soranix - Log in to Spotify (${site || 'loading'})`);
    };
    loginWin.webContents.on('did-navigate', showSite);
    // show which site you're on in the title, so you can see it's really Spotify
    loginWin.webContents.on('page-title-updated', ev => { ev.preventDefault(); showSite(); });
    const finish = (ev, to) => {
      if (!String(to).startsWith(ORIGIN)) return;
      ev.preventDefault();
      loginWin.close();
      win.loadURL(to); // the player reloads with Spotify's answer and finishes connecting
    };
    loginWin.webContents.on('will-redirect', finish);
    loginWin.webContents.on('will-navigate', finish);
    // links inside the login page that open new windows (help, sign up) go to the real browser
    loginWin.webContents.setWindowOpenHandler(({ url: u }) => { openLink(u); return { action: 'deny' }; });
    loginWin.on('closed', () => { loginWin = null; });
    loginWin.loadURL(url);
  });

  // Clicks reach the layer only while the mouse is over a Soranix window. The page reports that
  // from its mouse moves, but while another app (a game, say) has the keyboard, Windows sends
  // the page no mouse moves, so the first click fell through and only brought Soranix forward.
  // So the mouse position is also checked here against the areas the page covers.
  let pageOver = false, polledOver = false;
  const applyHover = () => { if (!IS_LINUX && win && !win.isDestroyed()) win.setIgnoreMouseEvents(!(pageOver || polledOver), { forward: true }); };
  ipcMain.on('ui-hover', (_e, over) => { pageOver = !!over; applyHover(); });
  if (!IS_LINUX) setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint(), b = win.getBounds(), x = p.x - b.x, y = p.y - b.y;
    const over = shapeRects.some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
    if (over !== polledOver) { polledOver = over; applyHover(); }
    // over the taskbar (the part of a screen outside its work area): a preview may show
    const d = screen.getDisplayNearestPoint(p), wa = d.workArea;
    if (p.x < wa.x || p.y < wa.y || p.x >= wa.x + wa.width || p.y >= wa.y + wa.height || PREVIEW.keys) PREVIEW.until = Date.now() + 1500;
  }, 40);
  // Balance: a tiny helper sets the left/right volume of Soranix's own sound in Windows
  // (the same per-app volume the Windows mixer uses). It quits when Soranix does.
  let balancer = null;
  try {
    const exe = path.join(ROOT, 'helpers', 'balance.exe');
    if (IS_WIN && fs.existsSync(exe)) {
      balancer = spawn(exe, [path.parse(process.execPath).name], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      // the helper says when Alt or the Windows key is held (Alt-Tab / Win+Tab show previews)
      let buf = '';
      balancer.stdout.on('data', d => {
        buf += d; const lines = buf.split(/\r?\n/); buf = lines.pop();
        for (const l of lines) if (l.startsWith('preview ')) { PREVIEW.keys = l.endsWith('1'); if (PREVIEW.keys) PREVIEW.until = Date.now() + 1500; }
      });
      balancer.on('error', () => { balancer = null; });
      balancer.on('exit', () => { balancer = null; });
    }
  } catch { balancer = null; }
  // Settings > Global hotkeys: these work even while another app or a game has the keyboard.
  // Each command takes the first of its key combinations that no other program uses yet.
  // Answers which keys each command got (none: every choice was taken).
  const HOTKEYS = [
    ['toggle', ['Control+Alt+Space', 'Control+Alt+P', 'Control+Alt+Home']],
    ['next', ['Control+Alt+Right']], ['prev', ['Control+Alt+Left']],
    ['volup', ['Control+Alt+Up']], ['voldown', ['Control+Alt+Down']],
  ];
  const { globalShortcut } = require('electron');
  ipcMain.handle('global-keys', (_e, on) => {
    globalShortcut.unregisterAll();
    if (!on) return {};
    const send = cmd => () => { if (win && !win.isDestroyed()) win.webContents.send('thumb-cmd', cmd); };
    const got = {};
    for (const [cmd, keys] of HOTKEYS) got[cmd] = keys.find(k => { try { return globalShortcut.register(k, send(cmd)); } catch { return false; } }) || null;
    return got;
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  // Settings > Always on top: keep the Soranix windows above other apps
  ipcMain.on('on-top', (_e, on) => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!on, 'floating'); });

  // Settings > Lower music while someone talks: how much quieter (0 = off)
  ipcMain.on('duck', (_e, v) => {
    const n = Math.max(0, Math.min(100, Math.round(+v || 0)));
    try { balancer?.stdin.write(`duck ${n}\n`); } catch {}
  });
  ipcMain.on('balance', (_e, v) => {
    const n = Math.max(-100, Math.min(100, Math.round(+v || 0)));
    try { balancer?.stdin.write(`pan ${n}\n`); } catch {}
  });
  app.on('before-quit', () => { try { balancer?.kill(); } catch {} });

  ipcMain.on('app-cmd', (_e, cmd) => { if (cmd === 'minimize') host.minimize(); else if (cmd === 'quit') app.quit(); });

  // ---------------------------------------------------------------- YouTube Music (test)
  // When YouTube Music is picked, a hidden window runs music.youtube.com and plays the music;
  // the player page controls it through ytm-bridge.js. It has its own session, so the Google
  // login stays separate from everything else. It is only created when YouTube Music is used.
  let ytm = null, ytmLoggingIn = false, quitting = false;
  app.on('before-quit', () => { quitting = true; });
  const YTM_URL = 'https://music.youtube.com/';
  const YTM_BRIDGE = fs.readFileSync(path.join(ROOT, 'ytm-bridge.js'), 'utf8');
  const YTM_CALLS = new Set(['hello', 'state', 'play', 'pause', 'seek', 'vol', 'next', 'prev', 'load', 'search', 'liked', 'playlists', 'playlist', 'frame', 'videoFor', 'songFor', 'account', 'find', 'album', 'artist', 'home', 'shelfMore', 'history', 'cue', 'like', 'unlike', 'addToPlaylist']);
  function ytmWindow() {
    if (ytm && !ytm.isDestroyed()) return ytm;
    const ses = session.fromPartition('persist:ytm');
    // Google's sign-in refuses browsers built into apps ("This browser or app may not be
    // secure"). This window introduces itself as Firefox, and without the Chrome-only
    // "client hints" that would give it away; YouTube Music works the same in Firefox.
    ses.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0');
    // Nobody looks at this window, so it doesn't load pictures (thumbnails, avatars; Soranix shows
    // covers itself) or ad and tracking requests: less memory, processor and network for music.
    // (While its sign-in page is shown, everything loads as normal.)
    const NOT_NEEDED = /doubleclick\.net|googlesyndication\.com|googleadservices\.com|google-analytics\.com|googletagmanager\.com|\/pagead\/|\/ptracking|\/api\/stats\/(ads|qoe|atr)|\/youtubei\/v1\/log_event|play\.google\.com\/log/;
    // YouTube Music's service worker (a background script for offline use and notifications)
    // would keep a page process of its own running (about 120 MB): not installed, and removed
    ses.clearStorageData({ storages: ['serviceworkers'] }).catch(() => {});
    ses.webRequest.onBeforeRequest((d, cb) => {
      if (/^https:\/\/music\.youtube\.com\/sw\.js/.test(d.url)) return cb({ cancel: true });
      if (ytm && !ytm.isDestroyed() && ytm.isVisible()) return cb({});
      cb({ cancel: d.resourceType === 'image' || NOT_NEEDED.test(d.url) });
    });
    ses.webRequest.onBeforeSendHeaders((d, cb) => {
      const h = d.requestHeaders;
      for (const k of Object.keys(h)) if (/^sec-ch-ua/i.test(k)) delete h[k];
      cb({ requestHeaders: h });
    });
    ytm = new BrowserWindow({
      width: 1100, height: 760, show: false, title: 'Soranix - YouTube Music', icon: ICON, autoHideMenuBar: true,
      webPreferences: { session: ses, preload: path.join(ROOT, 'ytm-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    ytm.on('close', e => { if (!quitting) { e.preventDefault(); ytm.hide(); } }); // closing just hides it
    ytm.webContents.setWindowOpenHandler(({ url }) => { openLink(url); return { action: 'deny' }; });
    // signed in: Google sends the window back to YouTube Music; hide it again and tell the player
    ytm.webContents.on('did-navigate', (_e, url) => {
      if (ytmLoggingIn && url.startsWith(YTM_URL)) { ytmLoggingIn = false; ytm.hide(); if (win && !win.isDestroyed()) win.webContents.send('ytm-event', 'login-done'); }
    });
    ytm.loadURL(YTM_URL);
    return ytm;
  }
  // Lyrics from Limusic's lyrics service (lyrics.limusic.app), filed by YouTube video id, timed
  // to the exact upload. Used in YouTube Music mode only; asked from here because the service
  // doesn't answer web pages directly.
  ipcMain.handle('limusic-lyrics', async (_e, id) => {
    if (!/^[\w-]{11}$/.test(String(id))) return null;
    try {
      const r = await fetch(`https://lyrics.limusic.app/v1/lyrics/${id}`, {
        headers: { 'User-Agent': 'Soranix (https://github.com/mixooo/Soranix)' }, signal: AbortSignal.timeout(4000),
      });
      if (r.status === 404) return { none: true };
      if (!r.ok) return null;
      const j = await r.json();
      return { origin: String(j.origin || ''), lines: (j.lines || []).map(l => ({ t: Math.max(0, +l.time_ms || 0), end: +l.end_time_ms || 0, text: String(l.text || '') })) };
    } catch { return null; }
  });
  ipcMain.handle('ytm', async (_e, fn, args) => {
    if (fn === 'stop') { if (ytm && !ytm.isDestroyed()) ytm.destroy(); ytm = null; return true; }
    const w = ytmWindow();
    if (fn === 'login') {
      ytmLoggingIn = true;
      w.loadURL('https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue=' +
        encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&app=desktop&next=' + encodeURIComponent(YTM_URL)));
      w.show(); w.focus();
      return true;
    }
    if (fn === 'show') { w.show(); w.focus(); return true; }
    // log out: everything the YouTube Music window keeps (its Google sign-in included) is cleared
    if (fn === 'logout') { await w.webContents.session.clearStorageData(); w.loadURL(YTM_URL); return true; }
    if (!YTM_CALLS.has(fn)) throw new Error('unknown YouTube Music call');
    if (w.webContents.isLoading() || !w.webContents.getURL().startsWith(YTM_URL)) {
      await new Promise(res => { const t = setTimeout(res, 20000); w.webContents.once('did-finish-load', () => { clearTimeout(t); res(); }); });
    }
    await w.webContents.executeJavaScript(YTM_BRIDGE);
    return w.webContents.executeJavaScript(`window.__sx.${fn}(...${JSON.stringify(Array.isArray(args) ? args : [])})`);
  });

  // ---------------------------------------------------------------- SoundCloud (test)
  // Like Aurora: Soranix asks SoundCloud's web API itself (api-v2.soundcloud.com, the API the
  // site's own player uses), with the site's public client id, and plays SoundCloud's own stream
  // links in its player (see ytm.js). You sign in with an authorized token from your own browser
  // (library > Sign in with authorized token): SoundCloud's own sign-in refuses browsers built
  // into apps. A SoundCloud browser window only opens for SoundCloud's human check; its session
  // keeps the SoundCloud login (and the check's pass) apart from everything else.
  let scw = null;
  const SC_URL = 'https://soundcloud.com/';
  const SC_WEB = 'https://soundcloud.com', SC_API = 'https://api-v2.soundcloud.com';
  // a desktop Chrome (the mobile site's page carries no list of scripts to find the client id in)
  const SC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const SC_VERIFY = 'SoundCloud wants to check that you are human: open Verify SoundCloud in the library and pass its check.';
  function scWindow() {
    if (scw && !scw.isDestroyed()) return scw;
    const ses = session.fromPartition('persist:sc');
    // a plain Chrome, which is what this is (only the app's name is left out)
    ses.setUserAgent(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`);
    scw = new BrowserWindow({
      width: 1100, height: 760, show: false, title: 'Soranix - SoundCloud', icon: ICON, autoHideMenuBar: true,
      webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    scw.on('close', e => { if (!quitting) { e.preventDefault(); scw.hide(); } }); // closing just hides it
    scw.webContents.setWindowOpenHandler(({ url }) => { openLink(url); return { action: 'deny' }; });
    return scw;
  }
  ipcMain.handle('sc', async (_e, fn) => {
    if (fn === 'stop') { if (scw && !scw.isDestroyed()) scw.destroy(); scw = null; return true; }
    // log out: your login (and everything else the SoundCloud session keeps) is cleared
    if (fn === 'logout') { await session.fromPartition('persist:sc').clearStorageData(); return true; }
    const w = scWindow();
    if (fn === 'show') { w.show(); w.focus(); return true; }
    if (fn === 'hide') { w.hide(); return true; }
    // SoundCloud's human check: its page, shown, so you can pass the check yourself
    if (fn === 'verify') { w.loadURL(SC_URL); w.show(); w.focus(); return true; }
    throw new Error('unknown SoundCloud call');
  });

  // ---- SoundCloud's web API, asked from here (like Aurora's own HTTP client)
  const scSes = () => session.fromPartition('persist:sc');
  const SC_ID_FILE = path.join(app.getPath('userData'), 'soundcloud-client.json');
  let scCid = '';
  async function scText(url, headers = {}) {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`SoundCloud request failed (${r.status}). Try again later.`);
    return r.text();
  }
  // the client id: in one of the last scripts soundcloud.com loads; kept, and found again when it stops working
  async function scClientId(fresh) {
    if (!fresh && !scCid) { try { scCid = JSON.parse(fs.readFileSync(SC_ID_FILE, 'utf8')).id || ''; } catch {} }
    if (!fresh && scCid) return scCid;
    const page = await scText(SC_WEB, { 'User-Agent': SC_UA });
    const scripts = [...page.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js/g)].map(m => m[0]).reverse();
    for (const s of scripts) {
      const m = /client_id[:=]"?([a-zA-Z0-9]{32})/.exec(await scText(s, { 'User-Agent': SC_UA }));
      if (m) { scCid = m[1]; try { fs.writeFileSync(SC_ID_FILE, JSON.stringify({ id: scCid })); } catch {} return scCid; }
    }
    throw new Error('Could not reach SoundCloud. Please retry.');
  }
  // your SoundCloud login (from signing in in the SoundCloud window) and the human check's pass
  async function scCookies() {
    const out = {};
    for (const c of await scSes().cookies.get({ url: SC_WEB })) out[c.name] = c;
    return out;
  }
  const scTokenExp = tok => { try { return JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).exp || 0; } catch { return 0; } };
  // the login lasts a day; the site swaps its refresh cookie for a new one the same way
  async function scRefresh() {
    const c = await scCookies();
    if (!c.oauth_token) return false;
    const r = await fetch(SC_WEB + '/n/api/refresh-token', { method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { Cookie: Object.values(c).map(x => `${x.name}=${x.value}`).join('; '), Origin: SC_WEB, Referer: SC_WEB + '/', 'User-Agent': SC_UA } }).catch(() => null);
    if (!r?.ok) return false;
    for (const h of r.headers.getSetCookie?.() || []) {
      const [pair, ...attrs] = h.split(';'), i = pair.indexOf('='); if (i < 1) continue;
      const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
      const was = c[name], gone = !value || /max-age=0/i.test(attrs.join(';'));
      if (gone) await scSes().cookies.remove(SC_WEB, name).catch(() => {});
      else await scSes().cookies.set({ url: SC_WEB, name, value, domain: was?.domain, path: was?.path || '/', secure: true, httpOnly: was?.httpOnly ?? true,
        expirationDate: Math.floor(Date.now() / 1000) + 30 * 86400 }).catch(() => {});
    }
    return true;
  }
  const scGet = (pathOrUrl, retry = false) => scReq('GET', pathOrUrl, null, retry);
  async function scReq(method, pathOrUrl, body = null, retry = false) {
    const u = new URL(String(pathOrUrl).startsWith('https://') ? pathOrUrl : SC_API + pathOrUrl);
    if (u.origin !== SC_API) throw new Error('not a SoundCloud address');
    u.searchParams.set('client_id', await scClientId(retry));
    let c = await scCookies();
    // (renewed only when it says it runs out within 5 minutes; a login without a date isn't renewed ahead)
    const exp = c.oauth_token ? scTokenExp(c.oauth_token.value) : 0;
    if (exp && exp - Date.now() / 1000 < 300) { await scRefresh(); c = await scCookies(); }
    const headers = { Accept: 'application/json', Origin: SC_WEB, Referer: SC_WEB + '/', 'User-Agent': SC_UA };
    if (body) headers['Content-Type'] = 'application/json';
    if (c.oauth_token) headers.Authorization = 'OAuth ' + c.oauth_token.value;
    if (c.datadome) headers.Cookie = 'datadome=' + c.datadome.value;   // (a passed human check counts)
    let r;
    try { r = await fetch(u, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error('Could not connect to SoundCloud. Please retry.'); }
    const text = await r.text();
    if (r.status === 403 && /captcha-delivery\.com/.test(text)) throw new Error(SC_VERIFY);
    // a stale client id is refused like a bad login: once more with a fresh id (and a fresh login)
    if ((r.status === 401 || r.status === 403) && !retry) { if (r.status === 401 && c.oauth_token) await scRefresh(); return scReq(method, pathOrUrl, body, true); }
    if (r.status === 401) throw new Error(c.oauth_token ? 'Your SoundCloud login ran out: use Sign in with authorized token again (library).' : 'Sign in to SoundCloud to do this.');
    if (r.status === 403) throw new Error('SoundCloud did not allow this request. Please try again.');
    if (r.status === 404) throw new Error('SoundCloud could not find this.');
    if (!r.ok) throw new Error(`SoundCloud request failed (${r.status}). Try again later.`);
    return text ? JSON.parse(text) : null;
  }
  // what Soranix gets: songs in the same shape as from YouTube Music
  const scPath = url => { try { return new URL(url).pathname.replace(/\/$/, ''); } catch { return ''; } };
  const scArt = (u, size) => String(u || '').replace(/-(large|t\d+x\d+|crop|original)\.(jpg|png)/, `-${size}.$2`);
  const scList = j => (Array.isArray(j) ? j : j?.collection || []);
  function scSong(a) {
    if (!a || a.kind !== 'track' || a.policy === 'BLOCK') return null;
    const pm = a.publisher_metadata || {}, user = a.user || {}, cover = a.artwork_url || user.avatar_url || '';
    return { kind: 'track', videoId: String(a.id), url: scPath(a.permalink_url), type: a.policy === 'SNIP' ? 'SNIP' : '',
      title: a.title || '', artists: [pm.artist || user.username || ''].filter(Boolean), album: pm.album_title || '',
      dur: a.full_duration || a.duration || 0, img: scArt(cover, 't67x67'), imgLarge: scArt(cover, 't500x500') };
  }
  function scCard(a) {
    if (!a) return null;
    if (a.kind === 'track') return scSong(a);
    const pic = a.artwork_url || a.avatar_url || a.calculated_artwork_url || a.user?.avatar_url, img = scArt(pic, 't200x200'), imgLarge = scArt(pic, 't500x500');
    if (a.kind === 'user') return { type: 'artist', id: scPath(a.permalink_url), name: a.username || a.full_name || '', sub: [a.city, a.followers_count != null ? `${Number(a.followers_count).toLocaleString('en')} followers` : ''].filter(Boolean).join(' • '), img, imgLarge };
    if (/playlist/.test(a.kind || '')) {
      const album = /album|ep|single|compilation/i.test(a.set_type || '');
      return { type: album ? 'album' : 'playlist', id: a.kind === 'system-playlist' && a.urn ? 'urn:' + a.urn : scPath(a.permalink_url), name: a.title || a.short_title || '',
        sub: [album ? 'Album' : 'Playlist', a.user?.username || a.made_for?.username || '', a.release_date ? String(a.release_date).slice(0, 4) : a.track_count ? `${a.track_count} songs` : ''].filter(Boolean).join(' • '), img, imgLarge };
    }
    return null;
  }
  // a playlist's songs come partly as bare ids: the rest are asked for, 50 at a time
  async function scFullTracks(tracks) {
    const have = new Map(tracks.filter(t => t?.title).map(t => [String(t.id), t]));
    const need = tracks.filter(t => t && !t.title).map(t => String(t.id));
    for (let i = 0; i < need.length && i < 500; i += 50) for (const t of scList(await scGet('/tracks?ids=' + need.slice(i, i + 50).join(',')))) have.set(String(t.id), t);
    return tracks.map(t => have.get(String(t?.id))).map(scSong).filter(Boolean);
  }
  const scResolve = p => scGet('/resolve?url=' + encodeURIComponent(SC_WEB + String(p)));
  const SC_FN = {
    async signedIn() { return !!(await scCookies()).oauth_token; },
    // your login, pasted from your own browser (Firefox / Chrome: the soundcloud.com cookie
    // "oauth_token"), for when SoundCloud's sign-in refuses Soranix's built-in browser. Kept in the
    // SoundCloud session like a sign-in there, and checked with SoundCloud right away.
    async setLogin(value) {
      let v = String(value || '').trim().replace(/^oauth_token\s*[=:]\s*/i, '').replace(/^["']|["']$/g, '');
      if (!/^[\w.\-~+/=]{20,4096}$/.test(v)) throw new Error('That doesn\'t look like the oauth_token value. Copy only its Value.');
      const exp = scTokenExp(v), ses = scSes();
      await ses.cookies.set({ url: SC_WEB, name: 'oauth_token', value: v, domain: '.soundcloud.com', path: '/', secure: true,
        expirationDate: exp > Date.now() / 1000 ? exp : Math.floor(Date.now() / 1000) + 86400 });
      try { const me = await scGet('/me'); return { name: me.username || me.full_name || '', handle: me.permalink ? '@' + me.permalink : '' }; }
      catch (e) {
        await ses.cookies.remove(SC_WEB, 'oauth_token').catch(() => {});
        throw new Error(/ran out|Sign in/.test(e.message) ? 'SoundCloud didn\'t accept that login (it may have run out): copy it again from your browser.' : e.message);
      }
    },
    // a small question, to see whether SoundCloud answers again (after its human check)
    async ping() { await scGet('/search/tracks?q=a&limit=1'); return true; },
    async find(q, filter) {
      const p = { songs: '/search/tracks', artists: '/search/users', albums: '/search/albums', playlists: '/search/playlists_without_albums' }[filter] || '/search';
      return scList(await scGet(`${p}?q=${encodeURIComponent(String(q))}&limit=40`)).map(scCard).filter(Boolean).slice(0, 60);
    },
    // Discover: the sections of SoundCloud's Discover page (its "mixed selections")
    async home() {
      return scList(await scGet('/mixed-selections?limit=12')).map(s => ({ title: s.title || s.short_title || '', items: scList(s.items).map(scCard).filter(Boolean), more: null }))
        .filter(s => s.title && s.items.length);
    },
    async playlist(id) {
      const pl = String(id).startsWith('urn:') ? await scGet('/system-playlists/' + encodeURIComponent(String(id).slice(4))) : await scResolve(id);
      return scFullTracks(pl?.tracks || []);
    },
    async album(id) { return SC_FN.playlist(id); },
    async artist(p) { const u = await scResolve(p); return scList(await scGet(`/users/${u.id}/toptracks?limit=50`)).map(scSong).filter(Boolean); },
    async liked() { const me = await scGet('/me'); return scList(await scGet(`/users/${me.id}/track_likes?limit=200`)).map(x => scSong(x.track)).filter(Boolean); },
    async playlists() {
      return scList(await scGet('/me/library/all?limit=50')).map(x => scCard(x.playlist || x.system_playlist)).filter(Boolean).map(p => ({ id: p.id, name: p.name, sub: p.sub, img: p.img }));
    },
    // your Likes and your playlists (signed in): what SoundCloud's own buttons do
    async like(ids) { const me = await scGet('/me'); for (const id of ids || []) await scReq('PUT', `/users/${me.id}/track_likes/${encodeURIComponent(String(id))}`); return true; },
    async unlike(ids) { const me = await scGet('/me'); for (const id of ids || []) await scReq('DELETE', `/users/${me.id}/track_likes/${encodeURIComponent(String(id))}`); return true; },
    async addToPlaylist(id, ids) {
      if (String(id).startsWith('urn:')) throw new Error('SoundCloud\'s own mixes can\'t be changed');
      const pl = await scResolve(id), me = await scGet('/me');
      if (String(pl?.user_id ?? pl?.user?.id) !== String(me.id)) throw new Error('you can only add songs to your own playlists');
      const have = (pl.tracks || []).map(t => Number(t.id)), add = (ids || []).map(Number).filter(n => n && !have.includes(n));
      if (!add.length) return true;
      await scReq('PUT', `/playlists/${pl.id}`, { playlist: { tracks: [...have, ...add] } });
      return true;
    },
    async account() { if (!(await scCookies()).oauth_token) return null; const a = await scGet('/me'); return { name: a.username || a.full_name || '', handle: a.permalink ? '@' + a.permalink : '' }; },
    // a song's stream: SoundCloud's signed link to it (HLS or a plain file), like Aurora; previews
    // (Go+ songs) and encrypted streams can't be played here
    async stream(id) {
      const t = await scGet('/tracks/' + encodeURIComponent(String(id)));
      const all = t?.media?.transcodings || [];
      const ok = all.filter(x => !x.snipped && x.url && ['hls', 'progressive'].includes(x.format?.protocol) && !/ogg|opus/i.test(x.format?.mime_type || ''));
      const pick = ok.find(x => x.format.protocol === 'progressive') || ok[0];
      if (!pick) throw new Error(all.some(x => x.snipped) || t?.policy === 'SNIP' ? 'Go+ only - skipped' : 'SoundCloud only streams this song encrypted (Go+) - skipped');
      const s = await scGet(pick.url + (pick.url.includes('?') ? '&' : '?') + 'track_authorization=' + encodeURIComponent(t.track_authorization || ''));
      if (!/^https:\/\//.test(s?.url || '')) throw new Error('SoundCloud gave no stream for this song');
      return { url: s.url, hls: pick.format.protocol === 'hls', track: scSong(t) };
    },
  };
  ipcMain.handle('scapi', async (_e, fn, args) => {
    if (!Object.hasOwn(SC_FN, fn)) throw new Error('unknown SoundCloud call');
    return SC_FN[fn](...(Array.isArray(args) ? args : []));
  });

  // ---------------------------------------------------------------- updates
  // Twice a day Soranix asks GitHub whether a newer release exists. If so, the page asks you
  // first; only when you press Install is the new MSI downloaded, checked against the SHA-256
  // fingerprint published with the release, and installed (Soranix closes, updates, restarts).
  const UPD = { latest: null, busy: false };
  const say = m => { if (win && !win.isDestroyed()) win.webContents.send('update', m); };
  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.on('update-check', () => checkForUpdate(true));
  ipcMain.on('update-install', () => installUpdate());
  async function checkForUpdate(manual = false) {
    if (UPD.busy) return;
    // the self-updater installs MSI packages, so it only runs on Windows
    if (!IS_WIN) { if (manual) say({ state: 'error', message: 'automatic updates are Windows-only; get new Mac / Linux builds from GitHub releases' }); return; }
    try {
      const rel = await ghJson(`https://api.github.com/repos/${REPO}/releases/latest`);
      const version = String(rel.tag_name || '').replace(/^v/, '');
      const msi = (rel.assets || []).find(a => /\.msi$/i.test(a.name));
      const sum = (rel.assets || []).find(a => /\.msi\.sha256$/i.test(a.name));
      if (!isNewer(version, app.getVersion()) || !msi || !sum || !fromRepo(msi.browser_download_url) || !fromRepo(sum.browser_download_url)) {
        if (manual) say({ state: 'none', version: app.getVersion() });
        return;
      }
      UPD.latest = { version, name: msi.name, size: msi.size, msiUrl: msi.browser_download_url, sumUrl: sum.browser_download_url };
      say({ state: 'available', manual, version, current: app.getVersion(), sizeMB: Math.round(msi.size / 1048576), notes: String(rel.body || '') });
    } catch (e) {
      console.log('[update] check failed:', e.message);
      if (manual) say({ state: 'error', message: e.message });
    }
  }
  async function installUpdate() {
    const u = UPD.latest; if (!u || UPD.busy) return;
    UPD.busy = true;
    try {
      const dir = path.join(app.getPath('temp'), 'Soranix-update');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, u.name.replace(/[^\w.-]/g, '_'));
      // the fingerprint published next to the MSI
      const expect = (await ghText(u.sumUrl)).trim().split(/\s+/)[0].toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(expect)) throw new Error('the release has no valid fingerprint');
      // download, hashing as it arrives
      const r = await fetch(u.msiUrl, { headers: { 'User-Agent': 'Soranix-Updater' } });
      if (!r.ok || !r.body) throw new Error('download failed (' + r.status + ')');
      const hash = require('crypto').createHash('sha256'), out = fs.createWriteStream(file);
      const total = +r.headers.get('content-length') || u.size || 0;
      let got = 0, lastPct = -1;
      for await (const chunk of r.body) {
        hash.update(chunk); got += chunk.length;
        if (!out.write(chunk)) await new Promise(res => out.once('drain', res));
        const pct = total ? Math.floor(got * 100 / total) : 0;
        if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; say({ state: 'downloading', pct }); }
      }
      await new Promise((res, rej) => out.end(err => (err ? rej(err) : res())));
      if (hash.digest('hex') !== expect) { fs.rmSync(file, { force: true }); throw new Error('the download did not match its fingerprint, so it was not installed'); }
      say({ state: 'installing', version: u.version });
      // after Soranix has closed: install quietly (progress bar only), then start the new version
      const exe = installedExe();
      const cmd = `ping -n 4 127.0.0.1 >nul & msiexec /i "${file}" /passive /norestart /l*v "${path.join(dir, 'install.log')}" & start "" "${exe}"`;
      spawn('cmd.exe', ['/d', '/s', '/c', `"${cmd}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
      setTimeout(() => app.quit(), 800);
    } catch (e) {
      UPD.busy = false;
      console.log('[update] install failed:', e.message);
      say({ state: 'error', message: e.message });
    }
  }
  if (app.isPackaged && IS_WIN) {
    setTimeout(() => checkForUpdate(false), 20000);
    setInterval(() => checkForUpdate(false), 12 * 3600000);
  }

  // The page reports where the player is (main + EQ + playlist). Keep the main window under
  // it and refresh the picture Alt-Tab shows. While a window is being dragged the picture is
  // cleared, so no ghost of the old position shows through.
  let player = null, dragging = false, shotTimer = 0, lastShot = '';
  // while dragging: make the picture window fully see-through, so it never shows a stale or
  // empty picture behind the moving player (it comes back with a fresh picture afterwards)
  const blank = () => { try { host.setOpacity(0); } catch {} host.webContents.executeJavaScript("document.getElementById('i').classList.remove('on')").catch(() => {}); };
  let snapping = false;
  const snap = async () => {
    if (snapping || !player || dragging || !win.isVisible() || host.isMinimized()) return;
    snapping = true;
    try {
      const img = await win.webContents.capturePage({ x: Math.round(player.x), y: Math.round(player.y), width: Math.round(player.w), height: Math.round(player.h) });
      if (img.isEmpty()) return;
      const url = img.toDataURL();
      if (url === lastShot) return;
      lastShot = url;
      await host.webContents.executeJavaScript(`document.getElementById('i').src=${JSON.stringify(url)}`);
      try { host.setOpacity(1); } catch {}
    } catch {} finally { snapping = false; }
  };
  ipcMain.on('player-rect', (_e, r) => {
    if (!r || !host || host.isDestroyed()) return;
    player = r;
    const ob = win.getBounds();
    const b = { x: Math.round(ob.x + r.x), y: Math.round(ob.y + r.y), width: Math.max(1, Math.round(r.w)), height: Math.max(1, Math.round(r.h)) };
    if (!host.isMinimized()) host.setBounds(b);
    if (r.dragging && !dragging) { lastShot = ''; blank(); }
    dragging = !!r.dragging;
    clearTimeout(shotTimer);
    if (!dragging) shotTimer = setTimeout(snap, 250);
  });
  setInterval(snap, 8000); // keeps the picture fresh without costly constant captures
  setInterval(() => { if (Date.now() < PREVIEW.until) snap(); }, 66); // live while a preview can show

  const fit = () => {
    if (!win || win.isDestroyed()) return;
    const sp = span();
    win.setBounds(sp.bounds);
    win.webContents.send('displays', sp.displays);
  };
  let fitTimer = 0;
  const fitSoon = () => { clearTimeout(fitTimer); fitTimer = setTimeout(fit, 300); };
  screen.on('display-metrics-changed', fitSoon);
  screen.on('display-added', fitSoon);
  screen.on('display-removed', fitSoon);
  ipcMain.handle('get-displays', () => span().displays);
  win.webContents.on('did-finish-load', fit);

  // sound (Chromium's audio service) and Spotify's decryption (the Widevine CDM) get an
  // above-normal priority, so the music keeps flowing smoothly while other apps work hard
  const os = require('os');
  const boosted = new Set();
  const boost = () => {
    for (const m of app.getAppMetrics()) {
      const name = String(m.serviceName || m.name || '');
      if (boosted.has(m.pid) || !(m.type === 'Utility' && /audio|cdm|media/i.test(name))) continue;
      try { os.setPriority(m.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL); boosted.add(m.pid); } catch {}
    }
  };
  setInterval(boost, 5000);

  win.loadURL(ORIGIN + '/');
});
