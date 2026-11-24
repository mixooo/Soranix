// Runs inside the Soranix window before the page. It tells the desktop shell whether the
// mouse is over a Soranix window (catch the click) or over empty space (let the click
// fall through to whatever is behind), and exposes minimize / quit to the page.
const { contextBridge, ipcRenderer } = require('electron');

const OURS = location.origin === 'http://127.0.0.1:8888';
let over = null;
const setOver = v => { if (v !== over) { over = v; ipcRenderer.send('ui-hover', v); } };

contextBridge.exposeInMainWorld('desktop', {
  minimize: () => ipcRenderer.send('app-cmd', 'minimize'),
  quit: () => ipcRenderer.send('app-cmd', 'quit'),
  // monitors' usable areas in page coordinates; the callback runs again when monitors change
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  onDisplays: cb => ipcRenderer.on('displays', (_e, d) => cb(d)),
  // where the player (main + EQ + playlist) is, in page coordinates
  playerRect: r => ipcRenderer.send('player-rect', r),
  // the areas the layer should actually cover: Soranix windows, menus, dialogs
  layerShape: rects => ipcRenderer.send('layer-shape', rects),
  // Spotify login in a small pop-up window
  openLogin: url => ipcRenderer.send('open-login', url),
  // left/right balance of Soranix's sound (-100 left ... 100 right)
  setBalance: v => ipcRenderer.send('balance', v),
  // lower the music while a voice chat app plays sound (0 = off, 50, 80, 100 = silent)
  setDuck: v => ipcRenderer.send('duck', v),
  // keep Soranix above other apps
  setOnTop: on => ipcRenderer.send('on-top', !!on),
  // Settings > Global hotkeys (Ctrl+Alt+Space / arrows anywhere); answers the ones it couldn't take
  globalKeys: on => ipcRenderer.invoke('global-keys', !!on),
  // the buttons under the taskbar preview (prev / play / pause / stop / next)
  onThumbCmd: cb => ipcRenderer.on('thumb-cmd', (_e, cmd) => cb(cmd)),
  // updates from GitHub releases: told when one is available, installed only when asked
  appVersion: () => ipcRenderer.invoke('app-version'),
  onUpdate: cb => ipcRenderer.on('update', (_e, m) => cb(m)),
  checkUpdate: () => ipcRenderer.send('update-check'),
  installUpdate: () => ipcRenderer.send('update-install'),
});

if (!OURS) {
  // Spotify's login page fills the window and needs every click
  setOver(true);
} else {
  const mark = () => document.documentElement && document.documentElement.classList.add('desktop');
  mark();
  window.addEventListener('DOMContentLoaded', mark);
  const UI = '.win:not(.hidden), .menu, .dlg-back';
  const check = e => {
    if (e.buttons) return setOver(true); // keep the mouse while dragging a window or slider
    const el = document.elementFromPoint(e.clientX, e.clientY);
    setOver(!!(el && el.closest(UI)));
  };
  window.addEventListener('mousemove', check, true);
  window.addEventListener('mouseup', check, true);
  document.addEventListener('mouseleave', () => setOver(false));
}
