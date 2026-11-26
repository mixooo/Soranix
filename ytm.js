/* Soranix: YouTube Music (test).
   At start you pick Spotify or YouTube Music. With YouTube Music, a hidden YouTube Music window
   (see ytm-bridge.js) plays the music and Soranix's skin controls it: the same player, playlist
   window, lyrics, mini mode and media keys, with red text instead of green. Spotify isn't asked
   for anything in this mode. Loaded before app.js; everything here runs once app.js is loaded. */
const YT = { on: false, svc: 'ytm', ready: false, signedIn: false, playlists: [], st: null, last: null, advancing: 0,
  video: false, framing: false, altOf: {}, videoOf: {}, audioOf: {} };   // altOf: music video id -> its song id
/* The services played through a hidden website window: YouTube Music (red) and SoundCloud
   (orange). Both work the same way here; YT.svc says which one this start plays. */
const WEB = {
  // hue: the service's colour; lf: lightness factor (SoundCloud: the text green #3f3 becomes exactly #FF5500)
  ytm: { name: 'YouTube Music', up: 'YOUTUBE MUSIC', pre: 'ytm:', row: 'yt', cls: 'svc-ytm', hue: 0, lf: 1, logo: 'redLogo3', logoColor: '#FF0033', queue: 'myQueueYT', liked: 'Liked music' },
  // (snap: every ordinary text green, whatever its exact shade, becomes exactly #FF5500)
  sc: { name: 'SoundCloud', up: 'SOUNDCLOUD', pre: 'sc:', row: 'sc', cls: 'svc-sc', color: '#FF9F27', snap: true, logo: 'scLogo5', logoColor: '#FF9F27', queue: 'myQueueSC', liked: 'Likes' },
};
// a service with an exact text colour: its hue, and how light / strong it is (the text green #3f3 becomes exactly it)
const hexHsl = hex => {
  const [r, g, b] = [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  let h = !d ? 0 : mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360;
  return [h, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l];
};
for (const w of Object.values(WEB)) if (w.color) { const [h, s, l] = hexHsl(w.color); Object.assign(w, { hue: h, lf: l / 0.6, snapS: s, snapL: l }); }
const W = () => WEB[YT.svc];
// (errors arrive as "Error invoking remote method 'sc': Error: ...": only the message itself is kept)
/* ---------- SoundCloud's player (like Aurora): SoundCloud's own stream links, played here ----------
   main.js asks SoundCloud's web API for the song's stream (a plain file, or HLS, which hls.js plays);
   no SoundCloud page runs for this. It answers the same calls as the YouTube Music window does
   (state, play, pause, seek...), so the rest of Soranix treats both alike. */
const SCP = { a: null, hls: null, id: '', meta: null, ended: false, err: '', cued: null };
function scAudio() {
  if (SCP.a) return SCP.a;
  const a = SCP.a = new Audio();
  a.preload = 'auto';
  a.addEventListener('ended', () => { SCP.ended = true; });
  a.addEventListener('playing', () => { SCP.ended = false; });
  // a stream that fails counts as finished, so the next song plays
  a.addEventListener('error', () => { SCP.err = a.error?.message || 'stream failed'; SCP.ended = true; });
  return a;
}
const loadHlsJs = () => window.Hls ? Promise.resolve() : new Promise((ok, no) => {
  const s = document.createElement('script'); s.src = 'vendor/hls.min.js'; s.onload = ok; s.onerror = () => no(new Error('could not load the HLS player'));
  document.head.appendChild(s);
});
const scApi = (fn, ...args) => window.desktop.scapi(fn, args);
const SC_LOCAL = {
  async hello() { return { signedIn: await scApi('signedIn').catch(() => false), hasPlayer: true }; },
  state() {
    const a = SCP.a; if (!a || !SCP.id) return { id: '', ps: -1 };
    const m = SCP.meta || {};
    return {
      id: SCP.id, ps: SCP.ended ? 0 : a.paused ? 2 : 1, ad: false,
      pos: Math.round(a.currentTime * 1000), dur: isFinite(a.duration) && a.duration > 0 ? Math.round(a.duration * 1000) : m.dur || 0,
      title: m.title || '', artist: (m.artists || [])[0] || '', album: m.album || '',
      art: m.imgLarge ? [{ url: m.imgLarge, size: 500 }] : [], signedIn: YT.signedIn, mvType: '',
    };
  },
  play() { if (SCP.ended) { SCP.ended = false; SCP.a.currentTime = 0; } return SCP.a?.play().catch(() => {}); },
  pause() { SCP.a?.pause(); },
  seek(ms) { if (SCP.a) { SCP.a.currentTime = Math.max(0, Number(ms) || 0) / 1000; SCP.ended = false; } },
  vol(v) { scAudio().volume = Math.max(0, Math.min(1, Number(v) / 100)); },
  next() {}, prev() {},   // (Soranix picks the songs itself)
  // play a song: its stream from SoundCloud (got ready in advance when it's the next one)
  async load(id, startMs) {
    const a = scAudio();
    const s = SCP.cued?.id === String(id) && Date.now() - SCP.cued.at < 60000 ? SCP.cued.s : await scApi('stream', String(id));
    SCP.cued = null;
    SCP.hls?.destroy(); SCP.hls = null;
    SCP.id = String(id); SCP.meta = s.track; SCP.ended = false; SCP.err = '';
    if (s.hls && !a.canPlayType('application/vnd.apple.mpegurl')) {
      await loadHlsJs();
      if (!window.Hls?.isSupported()) throw new Error('this computer cannot play SoundCloud streams');
      const h = SCP.hls = new window.Hls({ startPosition: (Number(startMs) || 0) / 1000 });
      h.on(window.Hls.Events.ERROR, (_e, d) => { if (d.fatal) { SCP.err = d.details || 'stream failed'; SCP.ended = true; } });
      h.loadSource(s.url); h.attachMedia(a);
    } else {
      a.src = s.url;
      if (Number(startMs) > 0) a.addEventListener('loadedmetadata', () => { a.currentTime = Number(startMs) / 1000; }, { once: true });
    }
    await a.play().catch(e => { if (!/interrupted|aborted/i.test(e.message)) throw e; });
    return true;
  },
  // get the next song's stream ready (asked a little before it's needed)
  async cue(id) { try { SCP.cued = { id: String(id), at: Date.now(), s: await scApi('stream', String(id)) }; } catch {} return true; },
};
// the SoundCloud window: only for signing in and the human check
const SC_WINDOW = new Set(['verify', 'logout', 'show', 'hide', 'stop']);
const scRoute = (fn, args) => (fn in SC_LOCAL ? Promise.resolve().then(() => SC_LOCAL[fn](...args))
  : SC_WINDOW.has(fn) ? window.desktop.sc(fn, args) : window.desktop.scapi(fn, args));
const webCall = (svc, fn, ...args) => (svc === 'sc' ? scRoute(fn, args) : window.desktop.ytm(fn, args))
  .catch(e => {
    const msg = String(e?.message || e).replace(/^Error invoking remote method '\w+': (Error: )?/, '');
    // SoundCloud wants its human check (or is blocking): Verify SoundCloud shows up in the library
    if (svc === 'sc' && YT.on && YT.svc === 'sc' && /Verify SoundCloud|blocking this connection/.test(msg) && !YT.blocked) { YT.blocked = true; ytRenderTree(); }
    throw new Error(msg);
  });
const ytCall = (fn, ...args) => webCall(YT.svc, fn, ...args);
// the service a row belongs to ('sp' Spotify, 'yt' YouTube Music, 'sc' SoundCloud), and the one playing
const svcOfRow = t => { const u = t?.uri || ''; return /^ytm:/.test(u) ? 'yt' : /^sc:/.test(u) ? 'sc' : 'sp'; };
const curRow = () => (YT.on ? W().row : 'sp');
const ROW_SVC = { sp: 'spotify', yt: 'ytm', sc: 'sc' }, SVC_NAME = { spotify: 'Spotify', ytm: 'YouTube Music', sc: 'SoundCloud' };

/* ---------- choosing the service ---------- */
// how long a switch took, from the click until the new service can play (in the log)
function switchDone(name) {
  const at = LS.get('switchAt', 0); if (!at) return;
  LS.del('switchAt');
  console.log(`[switch] ${name} ready ${Date.now() - at} ms after the click`);
}
function chooseService() {
  const saved = LS.get('service', '');
  if (!window.desktop?.ytm) return Promise.resolve('spotify');       // browser copy: Spotify only
  // just switched with the logo or Settings: no need to ask again
  const now = LS.get('serviceNow', '');
  if (now) { LS.del('serviceNow'); return Promise.resolve(now); }
  if (saved && !LS.get('serviceAsk', true)) return Promise.resolve(saved);
  // no "Connect your Spotify account" behind the question: it shows only once Spotify is picked
  // (and only if Spotify isn't connected yet)
  $('#login').style.display = 'none';
  reveal();   // the question needs the windows visible
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'dlg-back';
    const d = (isShown('main') && displayOf(winEl('main'))) || primaryDisplay();
    Object.assign(back.style, { inset: 'auto', left: d.x + 'px', top: d.y + 'px', width: d.w + 'px', height: d.h + 'px' });
    back.innerHTML =
      `<div class="win dlg svc-dlg active" role="dialog" aria-label="Choose your music">` +
      `<div class="title"><span class="ridge"></span><span class="tname">CHOOSE YOUR MUSIC</span><span class="ridge"></span></div>` +
      `<div class="dlg-body"><div class="dlg-msg">What should Soranix play?</div>` +
      `<div class="svc-pick"><button class="btn svc-btn svc-sp" data-s="spotify"><i class="svc-logo"></i>Spotify</button>` +
      `<button class="btn svc-btn svc-yt" data-s="ytm"><i class="svc-logo"></i>YouTube Music</button>` +
      `<button class="btn svc-btn svc-sc" data-s="sc"><i class="svc-logo"></i>SoundCloud</button></div>` +
      `<label class="svc-remember"><input type="checkbox" data-r${saved && !LS.get('serviceAsk', true) ? ' checked' : ''}> Remember my choice (change it later in Settings)</label>` +
      `<div class="dlg-note">YouTube Music and SoundCloud are tests: they may have rough edges.</div></div></div>`;
    $('#desktop').appendChild(back);
    // the player's logo on each button: green for Spotify, red for YouTube Music
    redLogoUrl(url => { const i = back.querySelector('.svc-yt .svc-logo'); if (i) i.style.backgroundImage = `url(${url})`; }, 'ytm');
    redLogoUrl(url => { const i = back.querySelector('.svc-sc .svc-logo'); if (i) i.style.backgroundImage = `url(${url})`; }, 'sc');
    // the last choice gets the keyboard, so Enter repeats it
    (back.querySelector(`[data-s="${saved || 'spotify'}"]`) || back.querySelector('[data-s]')).focus();
    back.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
      const s = b.dataset.s;
      LS.set('service', s); LS.set('serviceAsk', !back.querySelector('[data-r]').checked);
      back.remove(); resolve(s);
    });
  });
}
function switchService(s) {
  LS.set('service', s); LS.set('serviceNow', s); LS.set('switchAt', Date.now());
  // only one service runs: the other website windows close
  for (const o of ['ytm', 'sc']) if (o !== s) window.desktop?.[o]?.('stop');
  if (WEB[s]) {
    // start the service's window now: it loads while the player restarts (it lives on in the
    // background process, so the restarted player finds it already loading)
    webCall(s, 'hello').catch(() => {});
    setTimeout(() => location.reload(), 30);
  } else location.reload();
}
function serviceMenu() {
  const cur = YT.on ? YT.svc : 'spotify';
  return [
    { label: 'Spotify', check: cur === 'spotify', fn: () => cur !== 'spotify' && switchService('spotify') },
    { label: 'YouTube Music (test)', check: cur === 'ytm', disabled: !window.desktop?.ytm, fn: () => cur !== 'ytm' && switchService('ytm') },
    { label: 'SoundCloud (test)', check: cur === 'sc', disabled: !window.desktop?.sc, fn: () => cur !== 'sc' && switchService('sc') },
    '-',
    { label: 'Ask every time Soranix starts', check: LS.get('serviceAsk', true), fn: () => LS.set('serviceAsk', !LS.get('serviceAsk', true)) },
  ];
}

/* ---------- the logo: a two-position switch, Spotify / YouTube Music ----------
   Click the logo on the player: a small switch slides out. Pick the other side and Soranix
   switches over (its player restarts in the other service). */
function serviceSwitch() {
  const old = $('.svcfly'); if (old) { old.remove(); reportShape(); return; }
  const cur = YT.on ? YT.svc : 'spotify';
  const el = document.createElement('div');
  el.className = 'svcfly';
  // (the outer box is placed in screen pixels; the inner one is zoomed like the player)
  el.innerHTML = `<div class="svcfly-in"><div class="svcfly-title">MUSIC SERVICE</div>` +
    `<div class="svc-toggle on-${cur}"><i class="knob"></i>` +
    `<span data-s="spotify" title="Play Spotify">SPOTIFY</span><span data-s="ytm" title="Play YouTube Music (test)">YT MUSIC</span><span data-s="sc" title="Play SoundCloud (test)">SOUNDCLOUD</span></div></div>`;
  $('#desktop').appendChild(el);
  // under the logo, right edges lined up, kept on the player's screen
  const r = $('#acct').getBoundingClientRect(), d = displayOf(winEl('main')) || primaryDisplay();
  const box = el.getBoundingClientRect(), w = box.width, h = box.height;
  el.style.left = Math.round(Math.min(Math.max(d.x, r.right - w), d.x + d.w - w)) + 'px';
  el.style.top = Math.round(r.bottom + 4 + h > d.y + d.h ? r.top - h - 4 : r.bottom + 4) + 'px';
  reportShape();
  const close = () => { el.remove(); removeEventListener('pointerdown', away, true); removeEventListener('keydown', esc, true); reportShape(); };
  const away = e => { if (!el.contains(e.target) && e.target !== $('#acct')) close(); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('pointerdown', away, true); addEventListener('keydown', esc, true);
  el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
    const s = b.dataset.s;
    if (s === cur) return close();
    el.querySelector('.svc-toggle').className = 'svc-toggle on-' + s;   // the knob slides over
    showMsg(`SWITCHING TO ${SVC_NAME[s].toUpperCase()}...`, 3000);
    setTimeout(() => switchService(s), 150);
  });
}

/* ---------- red theme ----------
   Every green in the style sheets gets a red twin while YouTube Music is used. Nothing in the
   style sheets changes; these are added on top. The canvases (time digits, mini visualizer) are
   tinted the same way. */
function redTheme() {
  const CLS = W().cls, HUE = W().hue, LF = W().lf, SNAP = !!W().snap;
  document.body.classList.add(CLS);
  const hex = n => n.toString(16).padStart(2, '0');
  const toRed = (r, g, b, a) => {
    const R = r / 255, G = g / 255, B = b / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2, dd = mx - mn;
    if (!dd) return null;
    let s = dd / (1 - Math.abs(2 * l - 1));
    let h = mx === R ? ((G - B) / dd) % 6 : mx === G ? (B - R) / dd + 2 : (R - G) / dd + 4; h *= 60; if (h < 0) h += 360;
    if (h < 70 || h > 170 || s < 0.25) return null;          // only greens
    let l2 = Math.min(1, l * LF);
    if (SNAP && l >= 0.33 && l <= 0.7) { l2 = W().snapL; s = W().snapS; }   // a text green: exactly the service's colour
    else if (SNAP) l2 = l;                                      // dark and light greens keep their shade
    h = (h - 120 + HUE + 360) % 360;                        // green -> the service's colour, same lightness / strength
    const c = (1 - Math.abs(2 * l2 - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l2 - c / 2;
    const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    const out = [r1, g1, b1].map(v => Math.round((v + m) * 255));
    return a == null ? '#' + out.map(hex).join('') : `rgba(${out.join(',')},${a})`;
  };
  const conv = val => {
    let changed = false;
    const v = val.replace(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\(([^)]+)\)/gi, (all, h, args) => {
      let r, g, b, a = null;
      if (h) {
        const f = h.length <= 4 ? [...h].map(c => c + c).join('') : h;
        r = parseInt(f.slice(0, 2), 16); g = parseInt(f.slice(2, 4), 16); b = parseInt(f.slice(4, 6), 16);
        if (f.length === 8) a = +(parseInt(f.slice(6, 8), 16) / 255).toFixed(3);
      } else {
        const p = args.split(/[\s,/]+/).filter(Boolean).map(parseFloat);
        [r, g, b] = p; if (p.length > 3) a = p[3];
      }
      const red = toRed(r, g, b, a);
      if (!red) return all;
      changed = true; return red;
    });
    return changed ? v : null;
  };
  const prefix = sel => sel.split(',').map(s => {
    s = s.trim();
    if (/^(:root|html)$/.test(s)) return 'body.' + CLS;
    if (/^html[.:\[]/.test(s)) return s.replace(/^(html\S*)/, '$1 body.' + CLS);
    if (/^body\b/.test(s)) return s.replace(/^body/, 'body.' + CLS);
    return `body.${CLS} ` + s;
  }).join(',');
  const css = [];
  const scan = rules => {
    for (const r of rules) {
      if (r.cssRules && !r.selectorText) { scan(r.cssRules); continue; }   // @media and the like
      // the logo is tinted as a whole below (recolouring its rules too would hide the picture)
      if (!r.selectorText || !r.style || /\.badge|#acct|svc-sp|svc-yt|svc-sc/.test(r.selectorText)) continue;   // (mixed playlists keep each service's colour)
      const decl = [];
      // a rule with green in it is copied whole (its other parts too), so the red copies
      // override each other in the same order as the originals do
      let green = false;
      for (let i = 0; i < r.style.length; i++) {
        const p = r.style[i], v = r.style.getPropertyValue(p), red = conv(v);
        if (red) green = true;
        // colour parts only: layout (sizes, spacing) stays exactly as the original decides
        if (red || /color|background|shadow|fill|stroke|filter|clip/.test(p)) decl.push(`${p}:${red || v}${r.style.getPropertyPriority(p) ? ' !important' : ''}`);
      }
      if (!green) continue;
      if (decl.length) css.push(`${prefix(r.selectorText)}{${decl.join(';')}}`);
    }
  };
  for (const sh of document.styleSheets) { try { scan(sh.cssRules); } catch {} }
  // drawn or coloured by code (time digits, mini visualizer, the volume slider's colour, the logo)
  css.push(`body.${CLS} #timecv,body.${CLS} #viscv{filter:hue-rotate(${HUE - 120}deg) saturate(1.1)${LF < 1 ? ` brightness(${LF.toFixed(2)})` : ''}}`);
  // volume and balance: a plain line in the service's colour (in Spotify mode their colour follows the level)
  css.push(`body.${CLS} .hslider.vol::before,body.${CLS} .hslider.bal::before{background:linear-gradient(hsl(${HUE},100%,68%),hsl(${HUE},78%,42%))!important}`);
  const st = document.createElement('style'); st.id = 'svc-red'; st.textContent = css.join('\n');
  document.head.appendChild(st);
  redLogo();
}
/* The logo, redrawn pixel by pixel: every green becomes the exact red of the text (the same
   hue as the text's red; each pixel keeps its own light and shade). */
function redLogo() {
  const CLS = W().cls;
  redLogoUrl(url => { const st = document.createElement('style'); st.textContent = `body.${CLS} #acct{background-image:url(${url})!important}`; document.head.appendChild(st); }, YT.svc);
}
function redLogoUrl(use, svc = YT.svc) {
  // drawn once, then kept: the logo in the service's colour is there from the first moment after that
  const KEY = WEB[svc].logo;
  const kept = LS.get(KEY, '');
  if (kept) return use(kept);
  // the logo's own colour, exactly (YouTube Music #FF0033, SoundCloud #FF5500): its main green
  // becomes that colour, and every other green pixel keeps its shade relative to the main one
  const hex = WEB[svc].logoColor, T = [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16) / 255);
  const tMx = Math.max(...T), tMn = Math.min(...T), tD = tMx - tMn, tL = (tMx + tMn) / 2, tS = tD / (1 - Math.abs(2 * tL - 1));
  let tH = tMx === T[0] ? ((T[1] - T[2]) / tD) % 6 : tMx === T[1] ? (T[2] - T[0]) / tD + 2 : (T[0] - T[1]) / tD + 4; tH *= 60; if (tH < 0) tH += 360;
  const hsl = (h, s, l) => { const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return [0, 8, 4].map(n => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255)); };
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    const greens = [];
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i] / 255, gg = p[i + 1] / 255, b = p[i + 2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), dd = mx - mn;
      if (!dd || p[i + 3] < 8) continue;
      let h = mx === r ? ((gg - b) / dd) % 6 : mx === gg ? (b - r) / dd + 2 : (r - gg) / dd + 4; h *= 60; if (h < 0) h += 360;
      if (h < 70 || h > 170) continue;                          // greens only
      const l = (mx + mn) / 2; greens.push([i, l, dd / (1 - Math.abs(2 * l - 1))]);
    }
    // the logo's body (its mid greens) becomes exactly the colour; its darker edge and its
    // highlight stay darker / lighter in the same colour, so it keeps a little depth
    for (const [i, l] of greens) {
      const L = l < 0.38 ? tL * (l / 0.38) * 0.85 : l > 0.62 ? tL + (1 - tL) * ((l - 0.62) / 0.38) * 0.8 : tL;
      const [R, G, B] = hsl(tH, tS, Math.min(1, Math.max(0, L))); p[i] = R; p[i + 1] = G; p[i + 2] = B;
    }
    g.putImageData(d, 0, 0);
    const url = c.toDataURL();
    LS.set(KEY, url); use(url);
  };
  img.src = 'icons/badge.png';
}

/* ---------- saved answers (YouTube Music) ----------
   Like Spotify mode, answers are kept on this PC (the same saved-copies store, tidied the same
   way) so YouTube Music isn't asked again and again, which could make it suspicious of the
   window: your playlist list, Liked music and playlists for 30 minutes (the refresh button
   asks again), searches for a day, which audio track / music video belongs to a song and the
   lyrics for a month. Failed answers are never kept. */
const YT_KEEP = { list: 30 * 60000, search: 864e5, lookup: 30 * 864e5 };   // 30 minutes, a day, 30 days
async function ytCached(key, keepFor, load, fresh = false) {
  if (!fresh) {
    const c = await DB.get(YT.svc + ':' + key);
    if (c && Date.now() - c.at < keepFor) return c.v;
  }
  const v = await load();
  DB.set(YT.svc + ':' + key, { at: Date.now(), v });
  return v;
}
async function ytForgetLists() {
  for (const k of await DB.keys()) if (k.startsWith(YT.svc + ':') && /^\w+:(liked|playlists|pl:)/.test(k)) await DB.del(k);
}

/* ---------- the player: Spotify's player object, played by YouTube Music ---------- */
const ytPlayer = {
  connect() {}, addListener() {}, activateElement() {},
  async togglePlay() { const st = await ytCall('state'); if (st && st.ps === 1) YT.userPause = Date.now(); return ytCall(st && st.ps === 1 ? 'pause' : 'play'); },
  pause: () => { YT.userPause = Date.now(); return ytCall('pause'); }, resume: () => ytCall('play'),
  seek: ms => ytCall('seek', Math.max(0, ms)),
  setVolume: f => ytCall('vol', Math.round(f * 100)),
  getVolume: () => Promise.resolve(S.vol / 100),
  nextTrack() {
    if (S.repeat === 2 && S.track) return ytCall('seek', 0);
    if (QU.items.length) return ytPlayQueued();
    if (S.shuffle && S.now.length) return playIndex(Math.floor(Math.random() * S.now.length));
    // after a queued song: the playlist goes on after the song that played before it
    if (S.now[S.plCur + 1]) return playIndex(S.plCur + 1);
    if (S.repeat === 1 && S.now.length) return playIndex(0);
    return ytCall('next');
  },
  previousTrack: () => ytCall('prev'),
  async getCurrentState() {
    const st = await ytCall('state').catch(() => null);
    if (!st || !st.id) return null;
    YT.st = st;
    YT.signedIn = st.signedIn;
    if (st.ad) {
      // an ad plays first: show the song that's coming (waiting at 0:00), not the one before
      showMsg(`AD ON ${W().up} - YOUR SONG COMES RIGHT AFTER`, 1500);
      const want = S.now[S.plCur];
      if (!want) return YT.last;
      return { paused: true, position: 0, duration: want.dur || 0, shuffle: S.shuffle, repeat_mode: S.repeat, context: null,
        track_window: { current_track: { uri: want.uri, id: want.id, name: want.name, duration_ms: want.dur,
          artists: want.artists.map(a => ({ name: a.name, uri: '' })), album: { name: want.album, uri: '', images: want.imgLarge ? [{ url: want.imgLarge, width: 544 }] : [] } } } };
    }
    // playing a song's music video (Video view): it still counts as that song
    const sid = YT.altOf[st.id] || st.id;
    const item = S.now.find(x => x.id === sid) || QU.items.find(x => x.id === sid) || (YT.queuedItem?.id === sid ? YT.queuedItem : null);
    const big = st.art.reduce((m, a) => (!m || a.size > m.size ? a : m), null);
    YT.last = {
      paused: !(st.ps === 1 || st.ps === 3), position: st.pos, duration: st.dur || item?.dur || 0,
      shuffle: S.shuffle, repeat_mode: S.repeat, context: null,
      track_window: { current_track: {
        // a song from Soranix's own list: its title, artists, album and cover are known exactly
        uri: W().pre + sid, id: sid, name: item?.name || st.title || '', duration_ms: st.dur,
        artists: item ? item.artists.map(a => ({ name: a.name, uri: '' }))
          : (st.artist || '').split(/\s*,\s*|\s+&\s+/).filter(Boolean).map(n => ({ name: n, uri: '' })),
        album: { name: item?.album || st.album || '', uri: '', images: item?.imgLarge ? [{ url: item.imgLarge, width: 544 }] : big ? [{ url: big.url, width: big.size }] : [] },
      } },
    };
    return YT.last;
  },
};
/* songs from YouTube Music as Soranix rows */
const ytRow = s => s && ({
  // (SoundCloud Go+ songs, which SoundCloud only plays for Go+ members, are marked)
  type: 'track', uri: W().pre + s.videoId, id: s.videoId, name: s.title + (s.type === 'SNIP' ? ' (Go+)' : ''), url: s.url || '',
  artist: s.artists.join(', '), artists: s.artists.map(n => ({ id: '', name: n })),
  album: s.album || '', dur: s.dur, img: s.img, imgLarge: s.imgLarge, ctx: null,
  mvt: s.type || '',   // ATV = audio track; OMV / UGC = a video
});
/* Which upload to play for a row: always the audio track (a video's audio track is looked up
   once), or with Now Playing > Video on, the music video. Either way it counts as the row. */
const isVideoRow = t => (t.mvt || (YT.st?.id === t.id ? YT.st.mvType : '')).replace('MUSIC_VIDEO_TYPE_', '') in { OMV: 1, UGC: 1 };
const ytAudioId = async t => (t.id in YT.audioOf ? YT.audioOf[t.id]
  : (YT.audioOf[t.id] = await ytCached('audio:' + t.id, YT_KEEP.lookup, () => ytCall('songFor', t.name, t.artist)).catch(() => null)));
async function ytVersion(t) {
  const self = { videoId: t.id, dur: t.dur };
  if (YT.svc !== 'ytm') return self;   // (SoundCloud: songs only, played as they are)
  if (YT.video && isShown('lyr')) return isVideoRow(t) ? self : (await ytVideoId(t)) || self;
  return isVideoRow(t) ? (await ytAudioId(t)) || self : self;
}
// SoundCloud Go+ songs (marked in the list) don't play here: the next song that does, from i on
const playableFrom = i => { while (S.now[i] && svcOfRow(S.now[i]) === 'sc' && S.now[i].mvt === 'SNIP') i++; return i; };
async function ytPlayIndex(i) {
  if (YT.svc === 'sc' && S.now[i]?.mvt === 'SNIP') {
    const j = playableFrom(i);
    if (!S.now[j]) return showMsg('GO+ ONLY - NOTHING PLAYABLE AFTER THIS', 3000);
    showMsg(`SKIPPED ${songs(j - i).toUpperCase()} ONLY ON SOUNDCLOUD GO+`, 2000);
    return playIndex(j);
  }
  const t = S.now[i]; if (!t) return;
  S.plCur = i; S.stopped = false; YT.queuedId = null;
  YT.advancing = Date.now();
  try {
    const v = await ytVersion(t);
    if (v.videoId !== t.id) YT.altOf[v.videoId] = t.id;
    await ytCall('load', v.videoId, 0, t.url);
    YT.skips = 0;
  } catch (e) {
    showMsg(W().up + ': ' + e.message.toUpperCase(), 3500);
    // a song SoundCloud won't play here (Go+ only): on to the next one (not endlessly)
    if (/GO\+/i.test(e.message) && (YT.skips = (YT.skips || 0) + 1) < 15 && i + 1 < S.now.length) setTimeout(() => playIndex(i + 1), 700);
  }
}

/* ---------- the queue (YouTube Music mode) ----------
   Songs you add with Add to queue play next, in order, then the playlist goes on where it was.
   Soranix plays them itself (with Spotify, Spotify's own queue does). A song leaves the queue
   once it starts, as in Spotify mode. */
async function ytPlayQueued() {
  const t = QU.items[0]; if (!t) return;
  YT.queuedId = t.id; YT.queuedItem = t; YT.advancing = Date.now(); S.stopped = false;
  try {
    const v = await ytVersion(t);
    if (v.videoId !== t.id) YT.altOf[v.videoId] = t.id;
    await ytCall('load', v.videoId, 0, t.url);
    showMsg('FROM YOUR QUEUE: ' + t.name.toUpperCase(), 2000);
  } catch (e) { showMsg(W().up + ': ' + e.message.toUpperCase(), 3500); }
}

/* ---------- lyrics (YouTube Music mode only) ----------
   First from Limusic's lyrics service: filed by YouTube video id, so they're timed to the exact
   song that plays (often word by word). Asked with the song's own id, also while its music
   video plays. Songs it doesn't have: LRCLIB, like Spotify mode. */
async function ytLyrics(t, info) {
  if (YT.svc !== 'ytm') return fetchLyrics(info);   // (SoundCloud: LRCLIB, as in Spotify mode)
  // a video row: its audio track's lyrics (that's what plays, and it has the clean title)
  const row = S.now.find(x => x.id === t.id) || t;
  const a = isVideoRow(row) ? await ytAudioId(row) : null;
  return ytCached('lyr:' + (a ? a.videoId : t.id), YT_KEEP.lookup, async () => {
    const lm = await window.desktop.limusicLyrics?.(a ? a.videoId : t.id).catch(() => null);
    if (lm?.lines?.some(l => l.text.trim())) return { limusic: lm.lines, via: lm.origin };
    return fetchLyrics(a ? { ...info, name: a.title, artist: a.artists[0] || info.artist, album: a.album || '', dur: a.dur || info.dur } : info);
  });
}

/* ---------- Video (Now Playing) ----------
   Shows the music video where the cover art would be. Songs on YouTube Music are often
   audio-only (a still picture); then their music video plays instead, from the same moment,
   and still counts as the song. The picture is copied from the hidden window about 24 times a
   second, only while it's on screen. */
const ytVideoId = async t => (t.id in YT.videoOf ? YT.videoOf[t.id]
  : (YT.videoOf[t.id] = await ytCached('video:' + t.id, YT_KEEP.lookup, () => ytCall('videoFor', t.name, t.artist)).catch(() => null)));
async function ytVideoMode(on) {
  if (YT.svc !== 'ytm') return;   // (YouTube Music only)
  YT.video = on;
  const st = YT.st, item = S.now[S.plCur];
  if (on) ytFrames();
  if (!st || !item || (YT.altOf[st.id] || st.id) !== item.id) return;
  if (on) showMsg('LOOKING FOR THE MUSIC VIDEO...', 2000);
  const v = await ytVersion(item);
  if (v.videoId === st.id) { if (on && st.mvType === 'MUSIC_VIDEO_TYPE_ATV') showMsg('NO MUSIC VIDEO FOUND FOR THIS SONG', 2500); return; }
  if (v.videoId !== item.id) YT.altOf[v.videoId] = item.id;
  YT.advancing = Date.now();
  // the same moment, unless one version is much longer than the other (a video's intro, say)
  await ytCall('load', v.videoId, Math.abs((v.dur || 0) - (st.dur || 0)) < 8000 ? st.pos : 0);
}
async function ytFrames() {
  if (YT.framing) return;
  YT.framing = true;
  const img = $('#np-vid');
  while (YT.on && YT.video && isShown('lyr') && document.visibilityState !== 'hidden') {
    const t0 = performance.now();
    const w = Math.round(Math.min(960, ($('#np-art').clientWidth || 320) * (devicePixelRatio || 1)));
    const url = await ytCall('frame', w).catch(() => null);
    if (url) img.src = url;
    await sleep(Math.max(5, 41 - (performance.now() - t0)));
  }
  YT.framing = false;
}
document.addEventListener('visibilitychange', () => { if (YT.video) ytFrames(); });
/* when a song ends, the next row of the playlist window plays (YouTube Music would otherwise
   pick something itself) */
/* YouTube Music pausing by itself (reported: "randomly stops playing"): a pause you didn't make,
   in the middle of a song, is written down (LS ytmStops, the last 20: when, where in the song,
   what the page showed) and playback goes on (at most 3 times in 10 minutes, so a real problem
   isn't hidden by an endless loop). */
function ytStoppedByItself(st, cur, sid) {
  const prev = YT.lastPs; YT.lastPs = st.ps;
  if (YT.svc !== 'ytm' || prev !== 1 || st.ps !== 2 || st.ad || S.stopped) return;
  if (Date.now() - (YT.userPause || 0) < 4000 || Date.now() - YT.advancing < 3000) return;   // you paused, or a song is starting
  if (!cur || cur.id !== sid || !st.dur || st.dur - st.pos < 2500) return;                    // not ours, or just the end
  const log = LS.get('ytmStops', []);
  log.push({ at: new Date().toISOString(), song: cur.name, pos: st.pos, dur: st.dur, still: st.stillThere || 0, ads: st.adsRemoved || 0, url: st.url || '', signedIn: !!st.signedIn });
  LS.set('ytmStops', log.slice(-20));
  console.warn('[ytm] paused by itself', log.at(-1));
  YT.resumes = (YT.resumes || []).filter(t => Date.now() - t < 600000);
  if (YT.resumes.length >= 3) return showMsg('YOUTUBE MUSIC KEEPS PAUSING BY ITSELF - PRESS PLAY', 4000);
  YT.resumes.push(Date.now());
  showMsg('YOUTUBE MUSIC PAUSED BY ITSELF - PLAYING ON', 2500);
  ytCall('play').catch(() => {});
}
function ytWatch() {
  const st = YT.st;
  if (!st) return;
  const cur = S.now[S.plCur], sid = YT.altOf[st.id] || st.id;
  ytStoppedByItself(st, cur, sid);
  if (st.ad || Date.now() - YT.advancing < 3000) return;
  // mixed playlist, next song on another service: start switching just before the end (the other
  // player needs a moment to start), so the gap stays short
  const nx = S.now[S.plCur + 1];
  // SoundCloud: the next song's page is opened in the background while this one plays, so it
  // starts right away at the end (SoundCloud forgets songs from pages you've left)
  const nxOk = YT.svc === 'sc' ? S.now[playableFrom(S.plCur + 1)] : null;
  if (nxOk && st.ps === 1 && st.pos > 4000 && svcOfRow(nxOk) === 'sc' && YT.cued !== nxOk.id && !QU.items.length) {
    // (a stream link is only good for a while: asked about 20 s before the end)
    if (st.dur && st.dur - st.pos < 20000) { YT.cued = nxOk.id; ytCall('cue', nxOk.id, nxOk.url).catch(() => {}); }
  }
  if (st.ps === 1 && cur && cur.id === sid && !QU.items.length && S.repeat !== 2 && nx && svcOfRow(nx) !== W().row && st.dur && st.dur - st.pos < 1300) {
    YT.advancing = Date.now(); return mixHandoff(S.plCur + 1);
  }
  // a song of ours ended (from the playlist, or one you queued): next one
  if (st.ps === 0 && ((cur && cur.id === sid) || YT.queuedId === sid)) {
    YT.advancing = Date.now();
    if (S.repeat === 2) { ytCall('seek', 0); ytCall('play'); return; }
    if (QU.items.length) return ytPlayQueued();
    if (S.plCur + 1 < S.now.length || S.repeat === 1 || S.shuffle) ytPlayer.nextTrack();
  }
}

/* right-click menus: leave out what only works with Spotify (its playlists, Liked Songs, artist
   and album pages, Spotify links, song details), and separators left doubled by that */
const SPOTIFY_ONLY = /^(Add to playlist|Add to other playlist|Save to Liked Songs|Remove from Liked Songs|Go to album|Share|Song info|About the artist|Similar music|Play similar|Start a mix|Edit details|Delete playlist|Make (public|private)|Pin|Unpin|Copy link|Open in Spotify|Follow|Unfollow|Log out)/i;
function ytMenuItems(items) {
  const out = [];
  for (const it of items) {
    const label = Array.isArray(it) ? it[0] : it?.label;
    if (it !== '-' && label && SPOTIFY_ONLY.test(label)) continue;
    if (it === '-' && (!out.length || out.at(-1) === '-')) continue;
    out.push(it);
  }
  while (out.at(-1) === '-') out.pop();
  return out;
}

/* ---------- library ---------- */
function ytTreeHead() {
  $('#treehead').innerHTML =
    `<div class="th-top"><span class="th-title">${W().name}</span>` +
    `<button class="btn sm th-plus" id="th-refresh" title="Load your playlists again">⟳</button></div>`;
  $('#th-refresh').onclick = () => ytLoadPlaylists(true);
}
function ytRenderTree() {
  const nodes = [
    ['grp', 'Find music'],
    ...(YT.svc === 'sc' && YT.blocked ? [['scverify', 'Verify SoundCloud (bot check)']] : []),
    ['ytsearch', 'Search ' + W().name], ['ythome', 'Discover new music'],
    ['grp', 'Your library'],
    ...(YT.signedIn ? [['ytliked', W().liked], ['grp', 'Playlists' + (YT.playlists.length ? ` (${YT.playlists.length})` : '')],
      ...YT.playlists.map(p => ['ytpl:' + p.id, p.name, 1])]
      // (SoundCloud: its own sign-in refuses Soranix's built-in browser, so a token from your browser)
      : YT.svc === 'sc' ? [['scpaste', 'Sign in with authorized token']] : [['ytlogin', 'Sign in to ' + W().name]]),
    // (the YouTube Music window itself stays hidden; it only shows for signing in, when you're signed out)
    ...(YT.signedIn ? [['grp', 'Account'], ['ytlogout', 'Log out' + (YT.account ? ' ' + YT.account : '')]] : []),
  ];
  $('#tree').innerHTML = nodes.map(([id, label, lvl]) => id === 'grp'
    ? `<div class="node grp">${esc(label)}</div>`
    : `<div class="node${L.node === id ? ' sel' : ''}" data-id="${esc(id)}" style="--lvl:${lvl || 0}" title="${esc(label)}">${esc(label)}</div>`).join('');
}
async function ytList(base, load, { localTabs = false, push = true } = {}) {
  const view = { ...base, kind: 'track', rows: [], loading: true };
  setView(view, push);
  try {
    view.rows = (await load()).map(ytRow).filter(Boolean);
    if (!view.rows.length) view.empty = 'Nothing here.';
    // Liked music and playlists: All / Songs / Videos, picked from what's already loaded (no requests)
    if (localTabs && view.rows.length && YT.svc === 'ytm') {
      const all = view.rows.slice();
      Object.assign(view, { tabs: [['all', 'All'], ['songs', 'Songs'], ['videos', 'Videos']], tabKey: 'all', onTab: k => {
        view.rows = k === 'all' ? all.slice() : all.filter(r => (r.mvt === 'MUSIC_VIDEO_TYPE_ATV') === (k === 'songs'));
        view.all = null; view.filter = ''; $('#q').value = ''; L.sel.clear();
        view.empty = k === 'songs' ? 'No songs here (only videos).' : 'No videos here (only songs).';
        renderView();
      } });
    }
  }
  catch (e) { view.empty = 'Could not load: ' + e.message; }
  view.loading = false;
  if (L.view === view) renderView();
}
async function ytOpenNode(id) {
  L.node = id; ytRenderTree();
  if (id === 'ythome') return ytHome();
  if (id === 'ytsearch') { $('#q').focus(); return setView({ node: id, kind: 'track', title: 'Search ' + W().name, sub: 'Type in the box above and press Enter.', rows: [], empty: 'Search for any song or artist.' }); }
  if (id === 'ytliked') return ytList({ node: id, title: W().liked, sub: W().name }, () => ytCached('liked', YT_KEEP.list, () => ytCall('liked')), { localTabs: true });
  if (id.startsWith('ytpl:')) {
    const p = YT.playlists.find(x => 'ytpl:' + x.id === id);
    return ytList({ node: id, title: p?.name || 'Playlist', sub: p?.sub || W().name, img: p?.img }, () => ytCached('pl:' + id.slice(5), YT_KEEP.list, () => ytCall('playlist', id.slice(5))), { localTabs: true });
  }
  if (id === 'scpaste') {
    const r = await winDialog({ title: 'SOUNDCLOUD LOGIN', wide: true, ok: 'Connect',
      message: 'SoundCloud refuses to sign in inside Soranix, but you can bring your login over from your own browser:\n\n' +
        'Firefox: open soundcloud.com (signed in) > press F12 > Storage tab > Cookies > https://soundcloud.com > click oauth_token > double-click its Value, Ctrl+C.\n\n' +
        'Chrome: open soundcloud.com (signed in) > press F12 > Application tab > Cookies > https://soundcloud.com > click oauth_token > copy its Cookie Value.\n\n' +
        'Paste it below. It is your SoundCloud login: keep it to yourself. It stays on this PC and is only sent to SoundCloud. It lasts about a day; paste it again when Soranix says it ran out.',
      fields: [{ label: 'oauth_token value', type: 'password', placeholder: 'paste here', required: true }] });
    if (!r?.[0]) return;
    libStatus('Checking the login with SoundCloud...');
    try {
      const a = await scApi('setLogin', r[0]);
      YT.signedIn = true; YT.blocked = false;
      await DB.del('sc:account');
      if (a?.handle || a?.name) YT.account = a.handle || a.name;
      libStatus('Connected to SoundCloud' + (YT.account ? ' as ' + YT.account : '') + '.');
      showMsg('SOUNDCLOUD CONNECTED' + (YT.account ? ' AS ' + YT.account.toUpperCase() : ''), 3000);
      ytAccount(); ytLoadPlaylists(); ytRenderTree();
    } catch (e) { libStatus(e.message); showMsg('SOUNDCLOUD: ' + e.message.toUpperCase(), 4000); }
    return;
  }
  if (id === 'scverify') {
    libStatus('SoundCloud\'s check opened in a window: pass it there. Soranix carries on by itself once SoundCloud lets you in. (A plain "You have been blocked" page has nothing to pass: that one only lifts with time.)');
    ytCall('verify').catch(() => {});
    for (let i = 0; i < 100; i++) {   // up to 10 minutes, one small question every 6 s
      await sleep(6000);
      if (!(await scApi('ping').then(() => true, () => false))) continue;
      await ytCall('hide').catch(() => {});
      showMsg('SOUNDCLOUD LET YOU IN - STARTING AGAIN...', 3000);
      return setTimeout(() => switchService('sc'), 800);
    }
    return;
  }
  if (id === 'ytlogin') {
    libStatus('Sign in to Google in the window that opened. It closes by itself when you\'re done.'); return ytCall('login');
  }
  if (id === 'ytshow') return ytCall('show');
  if (id === 'ytlogout') {
    if (!(await winConfirm(`Log out of ${W().name}${YT.account ? ' (' + YT.account + ')' : ''}?\n\nYour ${YT.svc === 'sc' ? 'SoundCloud' : 'Google'} sign-in in Soranix is removed; you can sign in again from the library.`, { title: 'LOG OUT', ok: 'Log out' }))) return;
    await ytCall('logout').catch(() => {});
    for (const k of await DB.keys()) if (k.startsWith(YT.svc + ':') && /^\w+:(liked|playlists|pl:|account)/.test(k)) await DB.del(k);   // your lists go with the account
    Object.assign(YT, { signedIn: false, account: '', playlists: [] });
    ytAccount(); ytRenderTree(); ytOpenNode('ytsearch');
    return showMsg('LOGGED OUT OF ' + W().up, 2500);
  }
  if (id === 'ytspotify') { if (await winConfirm('Switch to Spotify? Soranix restarts its player.', { title: 'SWITCH TO SPOTIFY', ok: 'Switch' })) switchService('spotify'); }
}
/* Search, with YouTube Music's filter buttons: All, Songs, Videos, Albums, Artists, Playlists.
   Each kind of answer is kept for a day, like any search. */
const YT_TABS = [['all', 'All'], ['songs', 'Songs'], ['videos', 'Videos'], ['albums', 'Albums'], ['artists', 'Artists'], ['playlists', 'Playlists']];
const SC_TABS = [['all', 'Everything'], ['songs', 'Tracks'], ['artists', 'People'], ['albums', 'Albums'], ['playlists', 'Playlists']];
const subParts = sub => String(sub || '').split(' \u2022 ').map(s => s.trim()).filter(s => s && !/^(album|single|ep|artist|playlist|song|video)$/i.test(s));
function ytItem(it) {
  if (it.kind === 'track') return ytRow(it);
  const parts = subParts(it.sub), year = (it.sub.match(/\b(19|20)\d\d\b/) || [''])[0];
  if (it.type === 'album') return { type: 'album', uri: YT.svc + '-album:' + it.id, id: it.id, name: it.name, artist: parts.find(p => p !== year) || '', year, count: '', img: it.img, imgLarge: it.imgLarge };
  if (it.type === 'artist') return { type: 'artist', uri: YT.svc + '-artist:' + it.id, id: it.id, name: it.name, genres: parts.join(' \u2022 '), img: it.img };
  return { type: 'playlist', uri: YT.svc + '-pl:' + it.id, id: it.id, name: it.name, owner: parts[0] || '', count: parts.slice(1).join(' \u2022 '), img: it.img };
}
async function ytSearch(q, filter = YT.searchTab || 'all', push = true) {
  q = String(q || '').trim(); if (!q) return;
  L.q = q; YT.searchTab = filter;
  const kind = { albums: 'album', artists: 'artist', playlists: 'playlist' }[filter] || 'track';
  const view = { node: 'ytsearch', title: 'Search: ' + q, sub: W().name, kind, rows: [], loading: true, tabs: YT.svc === 'sc' ? SC_TABS : YT_TABS, tabKey: filter, onTab: k => ytSearch(q, k, false) };
  setView(view, push);
  try {
    const items = await ytCached(`q2:${filter}:${q.toLowerCase()}`, YT_KEEP.search, () => ytCall('find', q, filter === 'all' ? '' : filter));
    view.rows = items.map(ytItem).filter(r => r && r.type === kind);
    if (!view.rows.length) view.empty = 'Nothing found.';
  } catch (e) { view.empty = 'Could not search: ' + e.message; }
  view.loading = false;
  if (L.view === view) renderView();
}
/* Discover: YouTube Music's home page as a grid of covers, one section at a time (the buttons
   above: Listen again, Music videos for you, Featured playlists for you, Albums for you, New
   releases, Mixed for you; whichever YouTube Music has for you). Kept for 30 minutes. A song
   plays when clicked; an album, playlist or artist opens. */
const HOME_WANT = ['Listen again', 'Music videos for you', 'Featured playlists for you', 'Albums for you', 'New releases', 'Mixed for you', 'Song mixes', 'Trending songs for you'];
async function ytHome() {
  const view = { node: 'ythome', title: 'Discover new music', sub: 'Picked for you by ' + W().name, kind: 'cards', rows: [], loading: true };
  setView(view);
  try {
    const shelves = await ytCached('home', YT_KEEP.list, () => ytCall('home'));
    const same = (a, b) => a.toLowerCase().replace(/\s+/g, ' ').trim() === b.toLowerCase();
    // ("Trending songs for you" is sometimes "Trending community playlists": any Trending one)
    const match = (s, w) => same(s.title, w) || (/^trending/i.test(w) && /^trending/i.test(s.title));
    let list = YT.svc === 'ytm' ? HOME_WANT.map(w => shelves.find(s => match(s, w))).filter(Boolean) : shelves.slice(0, 10);
    if (!list.length) list = shelves.slice(0, 6);   // YouTube Music named them differently: its first ones
    // each section keeps what it has loaded; More adds the next part of the selected one
    const st = list.map(s => ({ title: s.title, rows: s.items.map(ytItem).filter(Boolean), more: s.more, next: null, opened: false, busy: false, done: false }));
    const show = k => { view.tabKey = String(k); view.rows = st[k]?.rows || []; view.empty = 'Nothing here right now.'; };
    const cur = () => st[+view.tabKey];
    // sections with a "More" page use it; the others (Listen again: your history; the rest: fresh
    // picks from YouTube Music) add what's new, until there's nothing new
    view.canMore = () => { const c = cur(); return YT.svc === 'ytm' && !!c && !c.busy && !c.done && (c.more ? (c.opened ? !!c.next : true) : true); };
    view.onMore = async () => {
      const c = cur(); if (!c || c.busy || !view.canMore()) return;
      c.busy = true; renderView(); libStatus('Loading more...');
      try {
        let items;
        if (c.more) { const r = c.opened ? await ytCall('shelfMore', null, null, c.next) : await ytCall('shelfMore', c.more.id, c.more.params); items = r.items; c.opened = true; c.next = r.next; if (!r.next) c.done = !items.length; }
        else if (/^listen again$/i.test(c.title)) { items = c.opened ? [] : await ytCall('history'); c.opened = true; }
        else { const fresh = await ytCall('home'); items = (fresh.find(s => s.title === c.title)?.items) || []; }
        const seen = new Set(c.rows.map(x => x.uri)), before = c.rows.length;
        c.rows.push(...items.map(ytItem).filter(x => x && !seen.has(x.uri) && seen.add(x.uri)));
        if (c.rows.length === before) { c.done = true; libStatus('Nothing more in ' + c.title + ' right now.'); }
      } catch (e) { libStatus('Could not load more: ' + e.message); }
      c.busy = false;
      if (cur() === c) view.rows = c.rows;
      if (L.view === view) renderView();
    };
    Object.assign(view, { tabs: list.map((s, i) => [String(i), s.title]), onTab: k => { show(+k); renderView(); } });
    show(0);
    if (!list.length) view.empty = 'Nothing to discover right now. Try again later.';
  } catch (e) { view.empty = 'Could not load: ' + e.message; }
  view.loading = false;
  if (L.view === view) renderView();
}
/* a cover in Discover was clicked: a song plays (with the rest of the section after it),
   anything else opens */
function ytCardClick(i) {
  const v = L.view, r = v.rows[i]; if (!r) return;
  if (r.type !== 'track') return ytOpenItem(r);
  const tracks = v.rows.filter(x => x.type === 'track');
  playList(tracks, tracks.indexOf(r));
}

/* an album, artist or playlist from the search: its songs */
function ytOpenItem(r, noInfo = false) {
  if (r.type === 'album') return ytList({ node: 'ytsearch', title: r.name, sub: [r.artist, r.year].filter(Boolean).join(' - ') || 'Album', img: r.img },
    async () => (await ytCached('album:' + r.id, YT_KEEP.lookup, () => ytCall('album', r.id)))
      .map(s => ({ ...s, img: s.img || r.img, imgLarge: s.imgLarge || r.imgLarge, album: s.album || r.name, artists: s.artists.length ? s.artists : [r.artist].filter(Boolean) })));
  if (r.type === 'artist') {
    // their songs in the library, and who they are (Wikipedia) in the artist window
    if (!noInfo) openWebArtist({ name: r.name, img: r.imgLarge || r.img, id: r.id });
    return ytList({ node: 'ytsearch', title: r.name, sub: 'Songs', img: r.img }, () => ytCached('artist:' + r.id, YT_KEEP.list, () => ytCall('artist', r.id)), { localTabs: true });
  }
  if (r.type === 'playlist') return ytList({ node: 'ytsearch', title: r.name, sub: r.owner || 'Playlist', img: r.img }, () => ytCached('pl:' + r.id, YT_KEEP.list, () => ytCall('playlist', r.id)), { localTabs: true });
}
async function ytLoadPlaylists(fresh) {
  if (!YT.signedIn) return ytRenderTree();
  try {
    // the refresh button: your lists are asked for again (playlist list now, the others when opened)
    if (fresh) await ytForgetLists();
    YT.playlists = await ytCached('playlists', YT_KEEP.list, () => ytCall('playlists'), fresh);
    if (fresh) showMsg('PLAYLISTS LOADED', 1500);
  }
  catch (e) { libStatus('Could not load your YouTube Music playlists: ' + e.message); }
  ytRenderTree();
}

/* the logo's hover text: which Google account YouTube Music uses ("Connected as @handle"),
   kept for a day */
async function ytAccount() {
  $('#acct').classList.toggle('on', YT.signedIn);
  if (!YT.signedIn) { $('#acct').title = 'Not signed in to ' + W().name; return; }
  $('#acct').title = 'Connected to ' + W().name;
  const a = await ytCached('account', 864e5, () => ytCall('account')).catch(() => null);
  if (a && (a.handle || a.name)) {
    YT.account = a.handle || a.name;
    $('#acct').title = 'Connected as ' + YT.account;
    ytRenderTree();   // "Log out @name" in the library
  }
}

/* ---------- start ---------- */
async function ytStart(svc = 'ytm') {
  YT.on = true; YT.svc = svc;
  QU.items = LS.get(W().queue, []);   // the service's own queue
  redTheme();
  renderStatus();   // the display's idle text was written for Spotify before the choice
  $('.lyr-src').textContent = 'lyrics';
  $('#login').style.display = 'none'; $('#libmain').style.display = '';
  S.player = ytPlayer; S.deviceId = 'ytm'; S.activated = true;
  showMsg(W().up + ' - STARTING...', 4000);
  ytTreeHead(); ytRenderTree(); ytOpenNode('ythome');   // opens with Discover new music
  for (let i = 0; i < 80 && !YT.ready && !YT.blocked; i++) {
    try { const h = await ytCall('hello'); if (h?.blocked) YT.blocked = true; else if (h?.hasPlayer) { YT.ready = true; YT.signedIn = h.signedIn; switchDone(W().name); } }
    catch {}
    if (!YT.ready && !YT.blocked) await sleep(250);
  }
  // SoundCloud's bot protection is blocking this connection: said plainly, on the display and in the library
  if (YT.blocked) {
    showMsg('SOUNDCLOUD IS BLOCKING THIS CONNECTION FOR NOW - TRY AGAIN LATER', 15000);
    libStatus('SoundCloud is blocking this connection for now (its bot protection). If it shows a check you can pass, open Verify SoundCloud above; otherwise it usually lifts by itself after a while.');
    ytRenderTree();
    if (L.view) { L.view.loading = false; L.view.rows = []; L.view.empty = 'SoundCloud is blocking this connection for now (its bot protection). It usually lifts by itself after a while: try again later. Switch to another service with the logo meanwhile.'; renderView(); }
    $('#acct').title = 'SoundCloud is blocking this connection for now';
    return;
  }
  if (!YT.ready) { showMsg(W().up + ' DID NOT START - CHECK YOUR INTERNET', 6000); return; }
  ytCall('vol', S.vol);
  mixResume();   // switched over for the next song of a mixed playlist: play it
  ytAccount();
  showMsg(W().up + (YT.signedIn ? ' READY - PRESS EJECT TO PICK SOMETHING' : ' READY - SIGN IN FROM THE LIBRARY FOR YOUR MUSIC'), 4000);
  ytLoadPlaylists();
  setInterval(ytWatch, 500);
  window.desktop.onYtm?.(async m => {
    if (m !== 'login-done') return;
    const h = await ytCall('hello').catch(() => null);
    YT.signedIn = !!h?.signedIn; libStatus(YT.signedIn ? 'Signed in to YouTube Music.' : 'Not signed in yet.');
    if (YT.signedIn) await DB.del('ytm:account');   // a new sign-in: ask whose it is
    ytAccount();
    ytLoadPlaylists();
  });
}

/* ---------- the artist window (YouTube Music / SoundCloud) ----------
   Clicking an artist (search, Discover, Now Playing, right-click > Go to artist) shows who they are,
   like in Spotify mode: a bio from Wikipedia and details and links from MusicBrainz, looked up by
   the artist's name (kept for a week). Nothing is asked of Spotify, YouTube Music or SoundCloud. */
async function openWebArtist(w) {
  const name = String(w?.name || '').trim(); if (!name) return;
  const key = 'web:' + name.toLowerCase();
  showWin('art', true);
  LS.set('artLastWeb', { name, img: w.img || '', id: w.id || '' });   // reopened after a switch or a restart
  if (!wasMoved('art')) placeArtistWin(); else fitOnScreen(winEl('art'));
  ART.cur = key;
  $('#art-title').textContent = 'SORANIX ARTIST: ' + name.toUpperCase();
  const body = $('#art-body'); body.scrollTop = 0;
  const hero = img => `<div class="art-hero"${img ? ` style="background-image:url('${esc(img)}')"` : ''}><div class="art-shade"></div><div class="art-hname">${esc(name)}</div></div>`;
  body.innerHTML = hero(w.img) +
    `<div class="art-actions"><button class="btn yellow" id="art-songs">\u25B6 Songs on ${esc(W().name)}</button></div>` +
    `<div class="art-sec"><div class="art-h">About</div><div id="art-about" class="art-about"><span class="dim">Looking up info...</span></div></div>` +
    `<div class="art-sec"><div class="art-h">Artist details</div><ul id="art-facts" class="art-facts"><li class="dim">Loading...</li></ul></div>` +
    `<div class="art-sec" id="art-links-sec" hidden><div class="art-h">Links</div><div id="art-links" class="art-links"></div></div>` +
    `<div class="art-src">Info: MusicBrainz, Wikipedia</div>`;
  // their songs: the artist's own page when known, otherwise a search for the name
  $('#art-songs').onclick = () => {
    showWin('lib', true);
    if (w.id) return ytOpenItem({ type: 'artist', id: w.id, name, img: w.img }, true);
    $('#q').value = name; ytSearch(name, 'songs');
  };
  let ext = { mb: null, links: [], wiki: null };
  try { ext = await externalArtist({ id: 'name:' + name.toLowerCase(), name, spotify: false }); } catch {}
  if (ART.cur !== key) return;
  if (!w.img && ext.wiki?.img) body.querySelector('.art-hero').style.backgroundImage = `url('${ext.wiki.img.replace(/'/g, '%27')}')`;
  $('#art-about').innerHTML = ext.wiki
    ? `${esc(ext.wiki.text)}${ext.wiki.url ? ` <a href="${esc(ext.wiki.url)}" target="_blank" rel="noopener">Read more on Wikipedia \u2197</a>` : ''}`
    : '<span class="dim">No Wikipedia article found for this artist.</span>';
  const mb = ext.mb, facts = [];
  if (mb) {
    const kind = mb.type === 'Group' ? 'Group' : mb.type === 'Person' ? 'Solo artist' : mb.type;
    const from = mb.area?.name || mb['begin-area']?.name;
    if (kind || from) facts.push([kind, from && 'from ' + from].filter(Boolean).join(' ') + '.');
    const b = mb['life-span']?.begin?.slice(0, 4), e = mb['life-span']?.ended ? mb['life-span']?.end?.slice(0, 4) : null;
    if (b) facts.push(mb.type === 'Person' ? `Born ${mb['life-span'].begin}.` : `Active since ${b}${e ? `, until ${e}` : ''}.`);
    if (mb.disambiguation) facts.push(mb.disambiguation.charAt(0).toUpperCase() + mb.disambiguation.slice(1) + '.');
  }
  $('#art-facts').innerHTML = facts.length ? facts.map(f => `<li>${esc(f)}</li>`).join('') : '<li class="dim">No details found.</li>';
  if (ext.links.length) {
    $('#art-links-sec').hidden = false;
    $('#art-links').innerHTML = ext.links.map(l => `<a class="btn sm" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.kind)} \u2197</a>`).join('');
  }
}

/* ---------- right-click: Liked music / Likes and your playlists (YouTube Music / SoundCloud) ----------
   For songs of the service you're on, signed in: save them to (or remove them from) Liked music /
   your SoundCloud Likes, or add them to one of your playlists there. The saved copies of those lists
   are dropped, so they show the change next time. */
function webSongMenuItems(tracks, src) {
  const mine = tracks.filter(t => svcOfRow(t) === W().row && t.id);
  if (!mine.length) return [];
  const sc = YT.svc === 'sc', inLiked = src?.from === 'lib' && L.view?.node === 'ytliked';
  return [
    inLiked
      ? { label: sc ? 'Remove from Likes' : 'Remove from Liked music', key: 'L', disabled: !YT.signedIn, fn: () => webLike(mine, false) }
      : { label: sc ? 'Like on SoundCloud' : 'Save to Liked music', key: 'L', disabled: !YT.signedIn, fn: () => webLike(mine, true) },
    { label: `Add to ${W().name} playlist`, key: 'P', disabled: !YT.signedIn || !YT.playlists.length,
      sub: () => YT.playlists.map(p => ({ label: p.name, fn: () => webAddToPlaylist(mine, p) })) },
  ];
}
async function webLike(tracks, on) {
  if (!YT.signedIn) return showMsg(`SIGN IN TO ${W().up} FIRST (LIBRARY)`, 3000);
  const n = tracks.length, what = YT.svc === 'sc' ? 'LIKES' : 'LIKED MUSIC';
  try {
    await ytCall(on ? 'like' : 'unlike', tracks.map(t => t.id));
    await DB.del(YT.svc + ':liked');
    showMsg(on ? `SAVED ${songs(n).toUpperCase()} TO ${what}` : `REMOVED ${songs(n).toUpperCase()} FROM ${what}`, 2500);
    if (!on && L.view?.node === 'ytliked') { const gone = new Set(tracks.map(t => t.id)); L.view.rows = L.view.rows.filter(r => !gone.has(r.id)); L.sel.clear(); renderView(); }
  } catch (e) { showMsg(W().up + ': ' + e.message.toUpperCase(), 4500); }
}
async function webAddToPlaylist(tracks, p) {
  try {
    await ytCall('addToPlaylist', p.id, tracks.map(t => t.id));
    await DB.del(YT.svc + ':pl:' + p.id);
    showMsg(`ADDED ${songs(tracks.length).toUpperCase()} TO ${p.name.toUpperCase()}`, 2500);
  } catch (e) { showMsg(W().up + ': ' + e.message.toUpperCase(), 4500); }
}

/* ---------- right-click on an album, artist or playlist (YouTube Music / SoundCloud) ----------
   Its songs (the same saved copies opening it uses) can be played, queued or added to the playlist
   window without opening it first; an artist also has their Wikipedia info; and a link to it. */
async function webItemSongs(r) {
  const list = await (r.type === 'album' ? ytCached('album:' + r.id, YT_KEEP.lookup, () => ytCall('album', r.id))
    : r.type === 'artist' ? ytCached('artist:' + r.id, YT_KEEP.list, () => ytCall('artist', r.id))
      : ytCached('pl:' + r.id, YT_KEEP.list, () => ytCall('playlist', r.id)));
  return list.map(s => (r.type === 'album' ? { ...s, img: s.img || r.img, imgLarge: s.imgLarge || r.imgLarge, album: s.album || r.name, artists: s.artists?.length ? s.artists : [r.artist].filter(Boolean) } : s))
    .map(ytRow).filter(Boolean);
}
function webItemLink(r) {
  if (YT.svc === 'sc') return String(r.id).startsWith('urn:') ? '' : 'https://soundcloud.com' + r.id;
  return r.type === 'playlist' ? 'https://music.youtube.com/playlist?list=' + r.id : 'https://music.youtube.com/browse/' + r.id;
}
function webContainerMenu(r) {
  const withSongs = fn => async () => {
    libStatus(`Loading ${r.name}...`);
    try { const t = await webItemSongs(r); if (!t.length) return libStatus('No songs found in ' + r.name + '.'); libStatus(''); fn(t); }
    catch (e) { libStatus('Could not load ' + r.name + ': ' + e.message); }
  };
  const link = webItemLink(r);
  return [
    { label: 'Open', key: 'Enter', fn: () => ytOpenItem(r) },
    { label: 'Play', fn: withSongs(t => playList(t, 0)) },
    { label: 'Add to queue', key: 'Q', fn: withSongs(t => addToQueue(t)) },
    { label: 'Add to Soranix playlist', key: 'E', fn: withSongs(t => { const n = plAdd(t, false); showMsg(`ADDED ${songs(n).toUpperCase()} TO PLAYLIST`); }) },
    r.type === 'artist' && { label: 'Artist info (Wikipedia)', fn: () => openWebArtist({ name: r.name, img: r.imgLarge || r.img, id: r.id }) },
    link && '-',
    link && { label: `Copy ${W().name} link`, fn: () => copyText(link, 'LINK') },
  ].filter(Boolean);
}
