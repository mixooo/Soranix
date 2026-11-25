/* Soranix: YouTube Music (test).
   At start you pick Spotify or YouTube Music. With YouTube Music, a hidden YouTube Music window
   (see ytm-bridge.js) plays the music and Soranix's skin controls it: the same player, playlist
   window, lyrics, mini mode and media keys, with red text instead of green. Spotify isn't asked
   for anything in this mode. Loaded before app.js; everything here runs once app.js is loaded. */
const YT = { on: false, ready: false, signedIn: false, playlists: [], st: null, last: null, advancing: 0,
  video: false, framing: false, altOf: {}, videoOf: {}, audioOf: {} };   // altOf: music video id -> its song id
const ytCall = (fn, ...args) => window.desktop.ytm(fn, args);

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
      `<div class="win dlg active" role="dialog" aria-label="Choose your music">` +
      `<div class="title"><span class="ridge"></span><span class="tname">CHOOSE YOUR MUSIC</span><span class="ridge"></span></div>` +
      `<div class="dlg-body"><div class="dlg-msg">What should Soranix play?</div>` +
      `<div class="svc-pick"><button class="btn svc-btn svc-sp" data-s="spotify"><i class="svc-logo"></i>Spotify</button>` +
      `<button class="btn svc-btn svc-yt" data-s="ytm"><i class="svc-logo"></i>YouTube Music</button></div>` +
      `<label class="svc-remember"><input type="checkbox" data-r${saved && !LS.get('serviceAsk', true) ? ' checked' : ''}> Remember my choice (change it later in Settings)</label>` +
      `<div class="dlg-note">YouTube Music is a test: it may have rough edges.</div></div></div>`;
    $('#desktop').appendChild(back);
    // the player's logo on each button: green for Spotify, red for YouTube Music
    redLogoUrl(url => { const i = back.querySelector('.svc-yt .svc-logo'); if (i) i.style.backgroundImage = `url(${url})`; });
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
  if (s === 'ytm') {
    // start the YouTube Music window now: it loads while the player restarts (it lives on in the
    // background process, so the restarted player finds it already loading)
    window.desktop?.ytm?.('hello').catch(() => {});
    setTimeout(() => location.reload(), 30);
  } else {
    window.desktop?.ytm?.('stop');
    location.reload();
  }
}
function serviceMenu() {
  const cur = YT.on ? 'ytm' : 'spotify';
  return [
    { label: 'Spotify', check: cur === 'spotify', fn: () => cur !== 'spotify' && switchService('spotify') },
    { label: 'YouTube Music (test)', check: cur === 'ytm', disabled: !window.desktop?.ytm, fn: () => cur !== 'ytm' && switchService('ytm') },
    '-',
    { label: 'Ask every time Soranix starts', check: LS.get('serviceAsk', true), fn: () => LS.set('serviceAsk', !LS.get('serviceAsk', true)) },
  ];
}

/* ---------- the logo: a two-position switch, Spotify / YouTube Music ----------
   Click the logo on the player: a small switch slides out. Pick the other side and Soranix
   switches over (its player restarts in the other service). */
function serviceSwitch() {
  const old = $('.svcfly'); if (old) { old.remove(); reportShape(); return; }
  const cur = YT.on ? 'ytm' : 'spotify';
  const el = document.createElement('div');
  el.className = 'svcfly';
  // (the outer box is placed in screen pixels; the inner one is zoomed like the player)
  el.innerHTML = `<div class="svcfly-in"><div class="svcfly-title">MUSIC SERVICE</div>` +
    `<div class="svc-toggle on-${cur}"><i class="knob"></i>` +
    `<span data-s="spotify" title="Play Spotify">SPOTIFY</span><span data-s="ytm" title="Play YouTube Music (test)">YOUTUBE MUSIC</span></div></div>`;
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
    showMsg(s === 'ytm' ? 'SWITCHING TO YOUTUBE MUSIC...' : 'SWITCHING TO SPOTIFY...', 3000);
    setTimeout(() => switchService(s), 150);
  });
}

/* ---------- red theme ----------
   Every green in the style sheets gets a red twin while YouTube Music is used. Nothing in the
   style sheets changes; these are added on top. The canvases (time digits, mini visualizer) are
   tinted the same way. */
function redTheme() {
  document.body.classList.add('svc-ytm');
  const hex = n => n.toString(16).padStart(2, '0');
  const toRed = (r, g, b, a) => {
    const R = r / 255, G = g / 255, B = b / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2, dd = mx - mn;
    if (!dd) return null;
    const s = dd / (1 - Math.abs(2 * l - 1));
    let h = mx === R ? ((G - B) / dd) % 6 : mx === G ? (B - R) / dd + 2 : (R - G) / dd + 4; h *= 60; if (h < 0) h += 360;
    if (h < 70 || h > 170 || s < 0.25) return null;          // only greens
    h = (h - 120 + 360) % 360;                              // green -> red, same lightness / strength
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
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
    if (/^(:root|html)$/.test(s)) return 'body.svc-ytm';
    if (/^html[.:\[]/.test(s)) return s.replace(/^(html\S*)/, '$1 body.svc-ytm');
    if (/^body\b/.test(s)) return s.replace(/^body/, 'body.svc-ytm');
    return 'body.svc-ytm ' + s;
  }).join(',');
  const css = [];
  const scan = rules => {
    for (const r of rules) {
      if (r.cssRules && !r.selectorText) { scan(r.cssRules); continue; }   // @media and the like
      // the logo is tinted as a whole below (recolouring its rules too would hide the picture)
      if (!r.selectorText || !r.style || /\.badge|#acct|svc-sp|svc-yt/.test(r.selectorText)) continue;   // (mixed playlists keep green / red)
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
  css.push('body.svc-ytm #timecv,body.svc-ytm #viscv{filter:hue-rotate(-120deg) saturate(1.1)}');
  // volume and balance: a plain red line (in Spotify mode their colour follows the level)
  css.push('body.svc-ytm .hslider.vol::before,body.svc-ytm .hslider.bal::before{background:linear-gradient(#ff5a5a,#c01818)!important}');
  const st = document.createElement('style'); st.id = 'svc-red'; st.textContent = css.join('\n');
  document.head.appendChild(st);
  redLogo();
}
/* The logo, redrawn pixel by pixel: every green becomes the exact red of the text (the same
   hue as the text's red; each pixel keeps its own light and shade). */
function redLogo() {
  redLogoUrl(url => { const st = document.createElement('style'); st.textContent = `body.svc-ytm #acct{background-image:url(${url})!important}`; document.head.appendChild(st); });
}
function redLogoUrl(use) {
  // drawn once, then kept: the red logo is there from the first moment after that
  const kept = LS.get('redLogo', '');
  if (kept) return use(kept);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i] / 255, gg = p[i + 1] / 255, b = p[i + 2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), dd = mx - mn;
      if (!dd || p[i + 3] < 8) continue;
      let h = mx === r ? ((gg - b) / dd) % 6 : mx === gg ? (b - r) / dd + 2 : (r - gg) / dd + 4; h *= 60; if (h < 0) h += 360;
      if (h < 70 || h > 170) continue;                          // greens only
      // same light and strength, hue 0: like the text, whose green turns into pure red
      const l = (mx + mn) / 2, s = dd / (1 - Math.abs(2 * l - 1)), C = (1 - Math.abs(2 * l - 1)) * s, m = l - C / 2;
      p[i] = Math.round((C + m) * 255); p[i + 1] = Math.round(m * 255); p[i + 2] = Math.round(m * 255);
    }
    g.putImageData(d, 0, 0);
    const url = c.toDataURL();
    LS.set('redLogo', url); use(url);
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
    const c = await DB.get('ytm:' + key);
    if (c && Date.now() - c.at < keepFor) return c.v;
  }
  const v = await load();
  DB.set('ytm:' + key, { at: Date.now(), v });
  return v;
}
async function ytForgetLists() {
  for (const k of await DB.keys()) if (/^ytm:(liked|playlists|pl:)/.test(k)) await DB.del(k);
}

/* ---------- the player: Spotify's player object, played by YouTube Music ---------- */
const ytPlayer = {
  connect() {}, addListener() {}, activateElement() {},
  async togglePlay() { const st = await ytCall('state'); return ytCall(st && st.ps === 1 ? 'pause' : 'play'); },
  pause: () => ytCall('pause'), resume: () => ytCall('play'),
  seek: ms => ytCall('seek', Math.max(0, ms)),
  setVolume: f => ytCall('vol', Math.round(f * 100)),
  getVolume: () => Promise.resolve(S.vol / 100),
  nextTrack() {
    if (S.repeat === 2 && S.track) return ytCall('seek', 0);
    if (QU.items.length) return ytPlayQueued();
    if (S.shuffle && S.pl.length) return playIndex(Math.floor(Math.random() * S.pl.length));
    // after a queued song: the playlist goes on after the song that played before it
    if (S.pl[S.plCur + 1]) return playIndex(S.plCur + 1);
    if (S.repeat === 1 && S.pl.length) return playIndex(0);
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
      showMsg('AD ON YOUTUBE MUSIC - YOUR SONG COMES RIGHT AFTER', 1500);
      const want = S.pl[S.plCur];
      if (!want) return YT.last;
      return { paused: true, position: 0, duration: want.dur || 0, shuffle: S.shuffle, repeat_mode: S.repeat, context: null,
        track_window: { current_track: { uri: want.uri, id: want.id, name: want.name, duration_ms: want.dur,
          artists: want.artists.map(a => ({ name: a.name, uri: '' })), album: { name: want.album, uri: '', images: want.imgLarge ? [{ url: want.imgLarge, width: 544 }] : [] } } } };
    }
    // playing a song's music video (Video view): it still counts as that song
    const sid = YT.altOf[st.id] || st.id;
    const item = S.pl.find(x => x.id === sid) || QU.items.find(x => x.id === sid) || (YT.queuedItem?.id === sid ? YT.queuedItem : null);
    const big = st.art.reduce((m, a) => (!m || a.size > m.size ? a : m), null);
    YT.last = {
      paused: !(st.ps === 1 || st.ps === 3), position: st.pos, duration: st.dur || item?.dur || 0,
      shuffle: S.shuffle, repeat_mode: S.repeat, context: null,
      track_window: { current_track: {
        // a song from Soranix's own list: its title, artists, album and cover are known exactly
        uri: 'ytm:' + sid, id: sid, name: item?.name || st.title || '', duration_ms: st.dur,
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
  type: 'track', uri: 'ytm:' + s.videoId, id: s.videoId, name: s.title,
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
  if (YT.video && isShown('lyr')) return isVideoRow(t) ? self : (await ytVideoId(t)) || self;
  return isVideoRow(t) ? (await ytAudioId(t)) || self : self;
}
async function ytPlayIndex(i) {
  const t = S.pl[i]; if (!t) return;
  S.plCur = i; S.stopped = false; YT.queuedId = null;
  YT.advancing = Date.now();
  try {
    const v = await ytVersion(t);
    if (v.videoId !== t.id) YT.altOf[v.videoId] = t.id;
    await ytCall('load', v.videoId);
  } catch (e) { showMsg('YOUTUBE MUSIC: ' + e.message.toUpperCase(), 3500); }
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
    await ytCall('load', v.videoId);
    showMsg('FROM YOUR QUEUE: ' + t.name.toUpperCase(), 2000);
  } catch (e) { showMsg('YOUTUBE MUSIC: ' + e.message.toUpperCase(), 3500); }
}

/* ---------- lyrics (YouTube Music mode only) ----------
   First from Limusic's lyrics service: filed by YouTube video id, so they're timed to the exact
   song that plays (often word by word). Asked with the song's own id, also while its music
   video plays. Songs it doesn't have: LRCLIB, like Spotify mode. */
async function ytLyrics(t, info) {
  // a video row: its audio track's lyrics (that's what plays, and it has the clean title)
  const row = S.pl.find(x => x.id === t.id) || t;
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
  YT.video = on;
  const st = YT.st, item = S.pl[S.plCur];
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
function ytWatch() {
  const st = YT.st;
  if (!st || st.ad || Date.now() - YT.advancing < 3000) return;
  const cur = S.pl[S.plCur], sid = YT.altOf[st.id] || st.id;
  // mixed playlist, next song on Spotify: start switching just before the end (Spotify's player
  // needs about a second and a half to start), so the gap stays short
  const nx = S.pl[S.plCur + 1];
  if (st.ps === 1 && cur && cur.id === sid && !QU.items.length && S.repeat !== 2 && nx && svcOfRow(nx) === 'sp' && st.dur && st.dur - st.pos < 1300) {
    YT.advancing = Date.now(); return mixHandoff(S.plCur + 1);
  }
  // a song of ours ended (from the playlist, or one you queued): next one
  if (st.ps === 0 && ((cur && cur.id === sid) || YT.queuedId === sid)) {
    YT.advancing = Date.now();
    if (S.repeat === 2) { ytCall('seek', 0); ytCall('play'); return; }
    if (QU.items.length) return ytPlayQueued();
    if (S.plCur + 1 < S.pl.length || S.repeat === 1 || S.shuffle) ytPlayer.nextTrack();
  }
}

/* right-click menus: leave out what only works with Spotify (its playlists, Liked Songs, artist
   and album pages, Spotify links, song details), and separators left doubled by that */
const SPOTIFY_ONLY = /^(Add to playlist|Add to other playlist|Save to Liked Songs|Remove from Liked Songs|Go to artist|Go to album|Share|Song info|About the artist|Similar music|Play similar|Start a mix|Edit details|Delete playlist|Make (public|private)|Pin|Unpin|Copy link|Open in Spotify|Follow|Unfollow|Log out)/i;
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
    `<div class="th-top"><span class="th-title">YouTube Music</span>` +
    `<button class="btn sm th-plus" id="th-refresh" title="Load your playlists again">⟳</button></div>`;
  $('#th-refresh').onclick = () => ytLoadPlaylists(true);
}
function ytRenderTree() {
  const nodes = [
    ['grp', 'Find music'], ['ytsearch', 'Search YouTube Music'], ['ythome', 'Discover new music'],
    ['grp', 'Your library'],
    ...(YT.signedIn ? [['ytliked', 'Liked music'], ['grp', 'Playlists' + (YT.playlists.length ? ` (${YT.playlists.length})` : '')],
      ...YT.playlists.map(p => ['ytpl:' + p.id, p.name, 1])] : [['ytlogin', 'Sign in to YouTube Music']]),
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
    if (localTabs && view.rows.length) {
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
  if (id === 'ytsearch') { $('#q').focus(); return setView({ node: id, kind: 'track', title: 'Search YouTube Music', sub: 'Type in the box above and press Enter.', rows: [], empty: 'Search for any song or artist.' }); }
  if (id === 'ytliked') return ytList({ node: id, title: 'Liked music', sub: 'YouTube Music' }, () => ytCached('liked', YT_KEEP.list, () => ytCall('liked')), { localTabs: true });
  if (id.startsWith('ytpl:')) {
    const p = YT.playlists.find(x => 'ytpl:' + x.id === id);
    return ytList({ node: id, title: p?.name || 'Playlist', sub: p?.sub || 'YouTube Music', img: p?.img }, () => ytCached('pl:' + id.slice(5), YT_KEEP.list, () => ytCall('playlist', id.slice(5))), { localTabs: true });
  }
  if (id === 'ytlogin') { libStatus('Sign in to Google in the window that opened. It closes by itself when you\'re done.'); return ytCall('login'); }
  if (id === 'ytshow') return ytCall('show');
  if (id === 'ytlogout') {
    if (!(await winConfirm(`Log out of YouTube Music${YT.account ? ' (' + YT.account + ')' : ''}?\n\nYour Google sign-in in Soranix is removed; you can sign in again from the library.`, { title: 'LOG OUT', ok: 'Log out' }))) return;
    await ytCall('logout').catch(() => {});
    for (const k of await DB.keys()) if (/^ytm:(liked|playlists|pl:|account)/.test(k)) await DB.del(k);   // your lists go with the account
    Object.assign(YT, { signedIn: false, account: '', playlists: [] });
    ytAccount(); ytRenderTree(); ytOpenNode('ytsearch');
    return showMsg('LOGGED OUT OF YOUTUBE MUSIC', 2500);
  }
  if (id === 'ytspotify') { if (await winConfirm('Switch to Spotify? Soranix restarts its player.', { title: 'SWITCH TO SPOTIFY', ok: 'Switch' })) switchService('spotify'); }
}
/* Search, with YouTube Music's filter buttons: All, Songs, Videos, Albums, Artists, Playlists.
   Each kind of answer is kept for a day, like any search. */
const YT_TABS = [['all', 'All'], ['songs', 'Songs'], ['videos', 'Videos'], ['albums', 'Albums'], ['artists', 'Artists'], ['playlists', 'Playlists']];
const subParts = sub => String(sub || '').split(' \u2022 ').map(s => s.trim()).filter(s => s && !/^(album|single|ep|artist|playlist|song|video)$/i.test(s));
function ytItem(it) {
  if (it.kind === 'track') return ytRow(it);
  const parts = subParts(it.sub), year = (it.sub.match(/\b(19|20)\d\d\b/) || [''])[0];
  if (it.type === 'album') return { type: 'album', uri: 'ytm-album:' + it.id, id: it.id, name: it.name, artist: parts.find(p => p !== year) || '', year, count: '', img: it.img, imgLarge: it.imgLarge };
  if (it.type === 'artist') return { type: 'artist', uri: 'ytm-artist:' + it.id, id: it.id, name: it.name, genres: parts.join(' \u2022 '), img: it.img };
  return { type: 'playlist', uri: 'ytm-pl:' + it.id, id: it.id, name: it.name, owner: parts[0] || '', count: parts.slice(1).join(' \u2022 '), img: it.img };
}
async function ytSearch(q, filter = YT.searchTab || 'all', push = true) {
  q = String(q || '').trim(); if (!q) return;
  L.q = q; YT.searchTab = filter;
  const kind = { albums: 'album', artists: 'artist', playlists: 'playlist' }[filter] || 'track';
  const view = { node: 'ytsearch', title: 'Search: ' + q, sub: 'YouTube Music', kind, rows: [], loading: true, tabs: YT_TABS, tabKey: filter, onTab: k => ytSearch(q, k, false) };
  setView(view, push);
  try {
    const items = await ytCached(`q:${filter}:${q.toLowerCase()}`, YT_KEEP.search, () => ytCall('find', q, filter === 'all' ? '' : filter));
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
  const view = { node: 'ythome', title: 'Discover new music', sub: 'Picked for you by YouTube Music', kind: 'cards', rows: [], loading: true };
  setView(view);
  try {
    const shelves = await ytCached('home', YT_KEEP.list, () => ytCall('home'));
    const same = (a, b) => a.toLowerCase().replace(/\s+/g, ' ').trim() === b.toLowerCase();
    // ("Trending songs for you" is sometimes "Trending community playlists": any Trending one)
    const match = (s, w) => same(s.title, w) || (/^trending/i.test(w) && /^trending/i.test(s.title));
    let list = HOME_WANT.map(w => shelves.find(s => match(s, w))).filter(Boolean);
    if (!list.length) list = shelves.slice(0, 6);   // YouTube Music named them differently: its first ones
    // each section keeps what it has loaded; More adds the next part of the selected one
    const st = list.map(s => ({ title: s.title, rows: s.items.map(ytItem).filter(Boolean), more: s.more, next: null, opened: false, busy: false, done: false }));
    const show = k => { view.tabKey = String(k); view.rows = st[k]?.rows || []; view.empty = 'Nothing here right now.'; };
    const cur = () => st[+view.tabKey];
    // sections with a "More" page use it; the others (Listen again: your history; the rest: fresh
    // picks from YouTube Music) add what's new, until there's nothing new
    view.canMore = () => { const c = cur(); return !!c && !c.busy && !c.done && (c.more ? (c.opened ? !!c.next : true) : true); };
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
  plAdd(tracks, true); playIndex(tracks.indexOf(r));
}

/* an album, artist or playlist from the search: its songs */
function ytOpenItem(r) {
  if (r.type === 'album') return ytList({ node: 'ytsearch', title: r.name, sub: [r.artist, r.year].filter(Boolean).join(' - ') || 'Album', img: r.img },
    async () => (await ytCached('album:' + r.id, YT_KEEP.lookup, () => ytCall('album', r.id)))
      .map(s => ({ ...s, img: s.img || r.img, imgLarge: s.imgLarge || r.imgLarge, album: s.album || r.name, artists: s.artists.length ? s.artists : [r.artist].filter(Boolean) })));
  if (r.type === 'artist') return ytList({ node: 'ytsearch', title: r.name, sub: 'Songs', img: r.img }, () => ytCached('artist:' + r.id, YT_KEEP.list, () => ytCall('artist', r.id)), { localTabs: true });
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
  if (!YT.signedIn) { $('#acct').title = 'Not signed in to YouTube Music'; return; }
  $('#acct').title = 'Connected to YouTube Music';
  const a = await ytCached('account', 864e5, () => ytCall('account')).catch(() => null);
  if (a && (a.handle || a.name)) {
    YT.account = a.handle || a.name;
    $('#acct').title = 'Connected as ' + YT.account;
    ytRenderTree();   // "Log out @name" in the library
  }
}

/* ---------- start ---------- */
async function ytStart() {
  YT.on = true;
  QU.items = LS.get('myQueueYT', []);   // YouTube Music's own queue
  redTheme();
  renderStatus();   // the display's idle text was written for Spotify before the choice
  $('.lyr-src').textContent = 'lyrics';
  $('#login').style.display = 'none'; $('#libmain').style.display = '';
  S.player = ytPlayer; S.deviceId = 'ytm'; S.activated = true;
  showMsg('YOUTUBE MUSIC - STARTING...', 4000);
  ytTreeHead(); ytRenderTree(); ytOpenNode('ythome');   // opens with Discover new music
  for (let i = 0; i < 80 && !YT.ready; i++) {
    try { const h = await ytCall('hello'); if (h?.hasPlayer) { YT.ready = true; YT.signedIn = h.signedIn; switchDone('YouTube Music'); } }
    catch {}
    if (!YT.ready) await sleep(250);
  }
  if (!YT.ready) { showMsg('YOUTUBE MUSIC DID NOT START - CHECK YOUR INTERNET', 6000); return; }
  ytCall('vol', S.vol);
  mixResume();   // switched over for the next song of a mixed playlist: play it
  ytAccount();
  showMsg(YT.signedIn ? 'YOUTUBE MUSIC READY - PRESS EJECT TO PICK SOMETHING' : 'YOUTUBE MUSIC READY - SIGN IN FROM THE LIBRARY FOR YOUR MUSIC', 4000);
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
