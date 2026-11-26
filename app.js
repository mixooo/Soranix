'use strict';
/* Soranix — a classic-style desktop player for your Spotify account.
   Auth: Authorization Code + PKCE (no server secret). Audio: Spotify Web Playback SDK. */

if (location.hostname === 'localhost') location.replace(location.href.replace('//localhost', '//127.0.0.1'));

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LS = {
  get(k, d) { try { const v = localStorage.getItem('spotamp.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { localStorage.setItem('spotamp.' + k, JSON.stringify(v)); },
  del(k) { localStorage.removeItem('spotamp.' + k); },
};
const REDIRECT = location.origin + location.pathname;
const API = 'https://api.spotify.com/v1';
const SCOPES = [
  'streaming', 'user-read-email', 'user-read-private',
  'user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing',
  'playlist-read-private', 'playlist-read-collaborative',
  'user-library-read', 'user-library-modify', 'user-top-read', 'user-read-recently-played',
  'playlist-modify-public', 'playlist-modify-private', 'user-follow-read', 'user-read-playback-position', 'ugc-image-upload', 'user-follow-modify',
].join(' ');
const fmt = ms => {
  let s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; s %= 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------------------------------------------ state */
const S = {
  me: null, player: null, deviceId: null, activated: false,
  track: null, paused: true, stopped: true, pos: 0, dur: 0, ts: 0, shuffle: false, repeat: 0,
  vol: LS.get('vol', 70), remaining: LS.get('remaining', false), visMode: LS.get('visMode', 0),
  seeking: false, msg: null, msgUntil: 0, marqX: 0, marqT: 0, marqBase: '',
  pl: LS.get('pl', []), plSel: new Set(), plAnchor: -1,
  // what's playing: the playlist window ('pl') or a list from the library ('lib', kept apart so
  // playing from the library doesn't fill the playlist window)
  src: LS.get('plSrc', 'pl'), lib: LS.get('plLib', []),
  playlists: [],
};
// the list that's playing right now (the playlist window, or the library list a song came from)
Object.defineProperty(S, 'now', { get: () => (S.src === 'lib' ? S.lib : S.pl), set: v => { if (S.src === 'lib') S.lib = v; else S.pl = v; } });
const saveNow = () => { LS.set('plSrc', S.src); LS.set('plLib', S.src === 'lib' ? S.lib : []); };
/* play a list from the library (or Discover, a menu...): it plays as it is, and the playlist
   window keeps your own songs */
function playList(tracks, i = 0) {
  S.src = 'lib'; S.lib = tracks.filter(t => t && t.type === 'track').map(t => ({ ...t }));
  RADIO.on = false; saveNow(); renderPL(false);
  return playIndex(Math.max(0, i));
}
/* play from the playlist window: from now on it's the list that plays */
function playFromPl(i) {
  if (S.src !== 'pl') { S.src = 'pl'; RADIO.on = false; saveNow(); }
  return playIndex(i);
}

/* ------------------------------------------------------------------ auth (PKCE) */
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function login() {
  const cid = ($('#cid').value.trim() || LS.get('clientId', '')).trim();
  if (!/^[0-9a-f]{32}$/i.test(cid)) return loginError('That does not look like a Client ID (32 letters/numbers).');
  LS.set('clientId', cid);
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(64)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem('spotamp.verifier', verifier);
  sessionStorage.setItem('spotamp.state', state);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: cid, response_type: 'code', redirect_uri: REDIRECT, scope: SCOPES,
    code_challenge_method: 'S256', code_challenge: challenge, state,
  });
  // desktop app: Spotify's login opens in a small pop-up window; when you're done it closes and
  // Soranix finishes connecting. In a browser the page itself goes to Spotify and comes back.
  if (window.desktop?.openLogin) { showMsg('LOG IN TO SPOTIFY IN THE POP-UP WINDOW', 4000); window.desktop.openLogin(url); }
  else location.href = url;
}
async function tokenRequest(params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || 'Token request failed (' + r.status + ')');
  const tok = { access: j.access_token, refresh: j.refresh_token || LS.get('token', {})?.refresh, exp: Date.now() + (j.expires_in - 60) * 1000 };
  LS.set('token', tok);
  return tok;
}
async function exchangeCode(code, state) {
  if (state !== sessionStorage.getItem('spotamp.state')) throw new Error('Login state mismatch, please try again.');
  await tokenRequest({
    grant_type: 'authorization_code', code, redirect_uri: REDIRECT,
    client_id: LS.get('clientId'), code_verifier: sessionStorage.getItem('spotamp.verifier'),
  });
}
let refreshing = null;
async function getToken() {
  const t = LS.get('token');
  if (!t) throw new Error('Not connected to Spotify');
  if (Date.now() < t.exp) return t.access;
  refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: LS.get('clientId') })
    .finally(() => { refreshing = null; });
  try { return (await refreshing).access; } catch (e) { logout('Session expired, please connect again.'); throw e; }
}
function logout(reason) {
  LS.del('token'); LS.del('me');
  try { S.player?.disconnect(); } catch {}
  S.player = null; S.deviceId = null; S.me = null; S.track = null;
  $('#acct').classList.remove('on');
  showLogin(reason);
}

/* ------------------------------------------------------------------ Web API */
/* ------------------------------------------------------------------ Spotify request queue
   Every request goes through one line: at most 3 at a time, a short gap between them, and
   "bulk" jobs (loading a whole playlist, copying songs) one at a time with a longer gap, so they
   never crowd out what you're clicking. When Spotify says "too many requests" it also says how
   long to wait (Retry-After): the whole line waits exactly that long. A long wait (or Spotify's
   "quota used up") pauses only that kind of request, e.g. the playlist list. */
const REQ = { active: 0, last: 0, pauseUntil: 0, keyPause: LS.get('reqPause', {}) };
/* the kind of request, with Spotify IDs left out: /artists/abc123/albums -> /artists/x/albums
   (Spotify's quotas are per kind, so one pause covers every artist) */
const reqKey = path => String(path).replace(API, '').split('?')[0].replace(/\/[0-9A-Za-z]{22}(?=\/|$)/g, '/x');
/* Safe limits: Spotify blocks some kinds of request for an hour or more once an app asks too
   often. Soranix counts those kinds and, past a safe number per half hour, uses another way
   (Search) before Spotify ever has to block. The counts survive restarts. */
const BUDGET = { '/artists/x/albums': 20, '/artists/x': 30, '/me/playlists': 6, '/playlists/x/items': 60 };
REQ.hist = LS.get('reqHist', {});
function countRecent(kind) {
  const h = REQ.hist[kind] || [], from = Date.now() - 30 * 60000;
  while (h.length && h[0] < from) h.shift();
  return h.length;
}
const overBudget = kind => BUDGET[kind] != null && countRecent(kind) >= BUDGET[kind];
function noteRequest(kind) {
  if (BUDGET[kind] == null) return;
  countRecent(kind); (REQ.hist[kind] ||= []).push(Date.now()); LS.set('reqHist', REQ.hist);
}
// drop pauses saved by older versions under a single artist's or playlist's ID
for (const k of Object.keys(REQ.keyPause)) if (reqKey(k) !== k || REQ.keyPause[k] < Date.now()) delete REQ.keyPause[k];
/* ms Spotify still wants us to wait before this kind of request (0 = go ahead) */
function pausedFor(pathOrKey) {
  const k = pathOrKey.startsWith('/') && !pathOrKey.includes('?') && REQ.keyPause[pathOrKey] != null ? pathOrKey : reqKey(pathOrKey);
  return Math.max(0, (REQ.keyPause[k] || 0) - Date.now(), REQ.pauseUntil - Date.now());
}
async function reqSlot(bulk) {
  for (;;) {
    const now = Date.now();
    if (REQ.pauseUntil > now) { await sleep(Math.min(REQ.pauseUntil - now, 1000)); continue; }
    const gap = (bulk ? 350 : 110) - (now - REQ.last);
    if (REQ.active < (bulk ? 1 : 3) && gap <= 0) { REQ.active++; REQ.last = now; return; }
    await sleep(Math.max(25, gap));
  }
}
async function api(path, { method = 'GET', body, bulk = false, cache = 0 } = {}, attempt = 0) {
  // YouTube Music mode: Spotify is never asked for anything
  if (YT.on) throw Object.assign(new Error('not available with YouTube Music'), { status: 0, ytm: true });
  // answers that rarely change are kept on this PC: no request while the saved one is fresh
  if (cache && method === 'GET' && attempt === 0) {
    const c = await DB.get('get:' + path);
    if (c && Date.now() - c.at < cache) return c.j;
  }
  const key = reqKey(path);
  const held = (REQ.keyPause[key] || 0) - Date.now();
  if (held > 0) {   // Spotify told us to leave this kind of request alone for a while
    const e = new Error(`Spotify asked to wait ${Math.ceil(held / 60000)} min`); e.status = 429; e.waitMs = held; throw e;
  }
  const tok = await getToken();
  await reqSlot(bulk);
  noteRequest(key);
  let r;
  try {
    r = await fetch(path.startsWith('http') ? path : API + path, {
      method,
      headers: { Authorization: 'Bearer ' + tok, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } finally { REQ.active--; }
  if (r.status === 401 && attempt < 1) { const t = LS.get('token'); if (t) { t.exp = 0; LS.set('token', t); } return api(path, { method, body, bulk, cache }, attempt + 1); }
  if (r.status === 429) {
    const txt429 = await r.clone().text().catch(() => '');
    const quota = /QUOTA_EXCEEDED/.test(txt429);
    const ra = parseInt(r.headers.get('Retry-After'), 10);          // seconds, now readable
    const waitMs = (Number.isFinite(ra) && ra > 0 ? ra : quota ? 1800 : [2, 6, 15][Math.min(attempt, 2)]) * 1000;
    console.log('[api] 429', key, 'retry-after', Number.isFinite(ra) ? ra + 's' : '(none)', quota ? 'QUOTA_EXCEEDED' : '', 'attempt', attempt);
    if (quota || waitMs > 60000) {
      // long wait: pause just this kind of request (remembered across restarts), don't retry
      REQ.keyPause[key] = Date.now() + waitMs; LS.set('reqPause', REQ.keyPause);
      if (key === '/me/playlists') renderTree();
      const e = new Error(`Spotify asked to wait ${Math.ceil(waitMs / 60000)} min`); e.status = 429; e.waitMs = waitMs; throw e;
    }
    // short wait: everyone waits, then try again
    REQ.pauseUntil = Math.max(REQ.pauseUntil, Date.now() + waitMs);
    if (attempt < 3) return api(path, { method, body, bulk, cache }, attempt + 1);
  }
  const txt = r.status === 204 ? '' : await r.text();
  let j = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
  if (!r.ok) {
    // Dev-mode apps may have a lower page-size cap: retry once with limit=10.
    if (r.status === 400 && /limit=50/.test(path) && attempt < 1) return api(path.replace('limit=50', 'limit=10'), { method, body, bulk, cache }, attempt + 1);
    const e = new Error(j?.error?.message || j?.error_description || 'HTTP ' + r.status); e.status = r.status; throw e;
  }
  if (REQ.keyPause[key]) { delete REQ.keyPause[key]; LS.set('reqPause', REQ.keyPause); }
  if (cache && method === 'GET' && j) saveAnswer(path, j);
  return j;
}

/* ------------------------------------------------------------------ playback (Web Playback SDK) */
function loadSDK() {
  if (window.Spotify) return initPlayer();
  window.onSpotifyWebPlaybackSDKReady = initPlayer;
  const s = document.createElement('script');
  s.src = 'https://sdk.scdn.co/spotify-player.js';
  document.head.appendChild(s);
}
function initPlayer() {
  if (S.player) return;
  const p = new Spotify.Player({ name: 'Soranix', getOAuthToken: cb => getToken().then(cb).catch(() => {}), volume: S.vol / 100 });
  S.player = p;
  p.addListener('ready', ({ device_id }) => { S.deviceId = device_id; showMsg('SORANIX READY - PRESS PLAY', 2500); switchDone('Spotify'); mixResume(); });
  p.addListener('not_ready', () => { S.deviceId = null; showMsg('PLAYER WENT OFFLINE', 2500); });
  p.addListener('initialization_error', ({ message }) => playerError('This browser cannot play Spotify audio (' + message + '). Use Chrome, Edge or Firefox.'));
  p.addListener('authentication_error', ({ message }) => playerError('Spotify rejected the login: ' + message));
  p.addListener('account_error', () => playerError('Spotify says this account cannot stream here. A Premium account is required.'));
  // When Spotify refuses a song it jumps to the next one, which can chain through the whole
  // playlist. Two refusals within 15 seconds: stop and explain instead of skipping on.
  let errs = [];
  p.addListener('playback_error', ({ message }) => {
    console.log('[sdk] playback_error', message);
    const now = Date.now(); errs = errs.filter(t => now - t < 15000); errs.push(now);
    if (errs.length >= 2) {
      errs = [];
      p.pause().catch(() => {});
      showMsg('SPOTIFY REFUSED TO PLAY HERE - STOPPED', 6000);
      libStatus('Spotify refused to play songs in this player (DRM check failed), so playback was stopped instead of skipping through your list.');
    } else showMsg('PLAYBACK ERROR: ' + message.toUpperCase(), 3000);
  });
  p.addListener('autoplay_failed', () => { console.log('[sdk] autoplay_failed'); showMsg('CLICK PLAY TO START AUDIO', 3000); });
  p.addListener('player_state_changed', onState);
  p.connect();
}
function playerError(text) { showMsg(text.toUpperCase(), 6000); libStatus(text); }
function onState(s) {
  if (s && s.track_window?.current_track?.uri !== S.track?.uri) console.log('[track]', s.track_window?.current_track?.name);
  if (!s) { Object.assign(S, { track: null, paused: true, stopped: true, pos: 0, dur: 0 }); renderStatus(); renderPL(); return; }
  const t = s.track_window?.current_track;
  const changed = (S.track?.uri) !== (t?.uri);
  Object.assign(S, { track: t, paused: s.paused, pos: s.position, dur: s.duration, ts: performance.now(), shuffle: s.shuffle, repeat: s.repeat_mode });
  if (!s.paused) S.stopped = false;
  if (changed && S.track && S.sleepEnd) { S.sleepEnd = false; S.player?.pause(); showMsg('SLEEP TIMER: GOOD NIGHT', 4000); }
  if (changed) { S.marqX = 0; renderPL(); markLibCurrent(); lyricsForCurrent(); queuePlayed(t); upNextSoon(); setTimeout(() => reportPlayer(), 1500); notePlayContext(s, t); }
  if (RADIO.on) radioTick(changed, s.paused);
  osMedia(changed);
  renderStatus();
}
setInterval(() => { S.player?.getCurrentState().then(s => s && onState(s)).catch(() => {}); }, 1000);
const curPos = () => (S.paused ? S.pos : Math.min(S.dur, S.pos + performance.now() - S.ts));

function ready() {
  if (YT.on) { if (!YT.ready) showMsg(YT.blocked ? 'SOUNDCLOUD IS BLOCKING THIS CONNECTION FOR NOW - TRY AGAIN LATER' : W().up + ' IS STILL STARTING - ONE MOMENT', 2500); return YT.ready; }
  if (!LS.get('token')) { showMsg('CONNECT SPOTIFY FIRST', 2000); showWin('lib', true); return false; }
  if (!S.deviceId) { showMsg('PLAYER STILL STARTING - TRY AGAIN IN A SECOND', 2500); return false; }
  if (!S.activated) { S.activated = true; S.player.activateElement?.(); }
  return true;
}
async function playBody(body) {
  if (!ready()) return;
  try { await api(`/me/player/play?device_id=${S.deviceId}`, { method: 'PUT', body }); S.stopped = false; }
  catch (e) { showMsg('ERROR: ' + e.message.toUpperCase(), 3500); libStatus('Could not play: ' + e.message); }
}
/* The playlist window is the source of truth (like the classic players): we hand Spotify
   the exact songs around the chosen row, and jump to that row by position. */
const sameTrack = (x, t) => !!(x && t && (x.uri === t.uri || (x.id && x.id === t.id) || (t.linked_from?.uri && x.uri === t.linked_from.uri)));
function plIndexOfCurrent() {
  if (!S.track) return -1;
  // YouTube Music: a song from your queue doesn't move the playlist, even if it's in it too
  if (YT.on && YT.queuedId && S.track.id === YT.queuedId) return -1;
  if (sameTrack(S.now[S.plCur], S.track)) return S.plCur;
  return (S.plCur = S.now.findIndex(x => sameTrack(x, S.track)));
}
function playIndex(i) {
  console.log('[play] index', i, new Error().stack.split(String.fromCharCode(10)).slice(2, 4).join(' | '));
  const t = S.now[i]; if (!t) return;
  // a mixed playlist: a song from the other service is played there (Soranix switches over)
  if (svcOfRow(t) !== curRow()) return mixHandoff(i);
  if (YT.on) return ytPlayIndex(i);
  S.plCur = i;
  RADIO.resync = false;   // the list sent below includes everything added to the mix
  // only the Spotify songs around it (in a mixed playlist the others play on YouTube Music)
  let a = i, b = i;
  while (a > Math.max(0, i - 20) && svcOfRow(S.now[a - 1]) === 'sp') a--;
  while (b + 1 < S.now.length && b + 1 < a + 100 && svcOfRow(S.now[b + 1]) === 'sp') b++;
  return playBody({ uris: S.now.slice(a, b + 1).map(x => x.uri), offset: { position: i - a } });
}
const T = {
  play() {
    if (!ready()) return;
    if (S.track && S.paused) return S.player.resume();
    if (S.track && !S.paused) return S.player.seek(0);
    // (from a stop: the first song of the service you're on, never a switch to another service)
    const sel = S.plSel.size ? Math.min(...S.plSel) : 0;
    const first = S.pl.findIndex((t, i) => i >= sel && svcOfRow(t) === curRow());
    if (first >= 0) return playFromPl(first);
    if (S.pl.length) return showMsg(`NO ${YT.on ? W().up : 'SPOTIFY'} SONGS IN THE PLAYLIST - PRESS EJECT TO PICK SOMETHING`, 3000);
    showMsg('PLAYLIST EMPTY - PRESS EJECT TO ADD MUSIC', 2500);
  },
  pause() { if (ready() && S.track) S.player.togglePlay(); },
  async stop() { if (!ready() || !S.track) return; await S.player.pause(); await S.player.seek(0); S.stopped = true; S.pos = 0; renderStatus(); },
  next() {
    console.log('[cmd] next', new Error().stack.split(String.fromCharCode(10)).slice(2, 4).join(' | '));
    if (!ready()) return;
    if (YT.on) return S.player.nextTrack();   // YouTube Music: the queue first, then the playlist (ytm.js)
    const i = plIndexOfCurrent();
    if (i < 0 || S.shuffle || S.repeat === 2) return S.player.nextTrack();
    if (i + 1 < S.now.length) return playIndex(i + 1);
    if (S.repeat === 1) return playIndex(0);
  },
  prev() {
    if (!ready()) return;
    if (S.track && curPos() > 3000) return S.player.seek(0);
    const i = plIndexOfCurrent();
    if (i > 0 && !S.shuffle) return playIndex(i - 1);
    S.player.previousTrack();
  },
  eject() { showWin('lib', !isShown('lib') || document.activeElement === $('#q')); if (isShown('lib') && S.me) $('#q').focus(); },
  async shuffle() {
    if (!ready()) return;
    const v = !S.shuffle;
    if (YT.on) { S.shuffle = v; renderStatus(); return showMsg('SHUFFLE: ' + (v ? 'ON' : 'OFF')); }
    try { await api(`/me/player/shuffle?state=${v}&device_id=${S.deviceId}`, { method: 'PUT' }); S.shuffle = v; renderStatus(); showMsg('SHUFFLE: ' + (v ? 'ON' : 'OFF')); }
    catch (e) { showMsg('START A SONG FIRST, THEN TOGGLE SHUFFLE', 2500); }
  },
  async repeat() {
    if (!ready()) return;
    const next = (S.repeat + 1) % 3, name = ['off', 'context', 'track'][next];
    if (YT.on) { S.repeat = next; renderStatus(); return showMsg('REPEAT: ' + ['OFF', 'ALL', 'ONE SONG'][next]); }
    try { await api(`/me/player/repeat?state=${name}&device_id=${S.deviceId}`, { method: 'PUT' }); S.repeat = next; renderStatus(); showMsg('REPEAT: ' + ['OFF', 'ALL', 'ONE SONG'][next]); }
    catch (e) { showMsg('START A SONG FIRST, THEN TOGGLE REPEAT', 2500); }
  },
};

/* ------------------------------------------------------------------ main window */
const ICON = {
  // drawn as thin outlines, like the classic light buttons
  prev: '<svg viewBox="0 0 12 10"><path d="M1.5 1v8M6.5 1.2v7.6L2.4 5zM11 1.2v7.6L6.9 5z"/></svg>',
  play: '<svg viewBox="0 0 12 10"><path d="M3 1v8l7-4z"/></svg>',
  pause: '<svg viewBox="0 0 12 10"><path d="M2.5 1h2.5v8H2.5zM7 1h2.5v8H7z"/></svg>',
  stop: '<svg viewBox="0 0 12 10"><path d="M2 1.5h8v7H2z"/></svg>',
  next: '<svg viewBox="0 0 12 10"><path d="M1 1.2v7.6L5.1 5zM5.5 1.2v7.6L9.6 5zM10.5 1v8"/></svg>',
  eject: '<svg viewBox="0 0 12 10"><path d="M6 1l4.5 4.5h-9zM1.5 7.5h9V9h-9z"/></svg>',
};
function setupMain() {
  for (const k of ['prev', 'play', 'pause', 'stop', 'next', 'eject']) {
    const b = $('#b-' + k); b.innerHTML = ICON[k]; b.onclick = () => T[k]();
  }
  $('#tog-shuf').onclick = () => T.shuffle();
  $('#tog-dc').onclick = () => toggleDiscord();
  $('#tog-dc').classList.toggle('on', DCA.on);
  $('#tog-rep').onclick = () => T.repeat();
  $('#tog-eq').onclick = () => showWin('eq', !isShown('eq'));
  $('#tog-pl').onclick = () => showWin('pl', !isShown('pl'));
  // the logo shows / hides the Spotify library window
  // the logo: in the desktop app, a switch between Spotify and YouTube Music; in a browser, the library
  $('#acct').onclick = () => (window.desktop?.ytm ? serviceSwitch() : showWin('lib', !isShown('lib')));
  $('#timecv').onclick = () => { S.remaining = !S.remaining; LS.set('remaining', S.remaining); };
  // single click: next mini visualizer style (bars / scope / off); double click: MilkDrop.
  // The single click waits a moment so a double click doesn't also change the style.
  const cycleVis = () => { S.visMode = (S.visMode + 1) % 3; LS.set('visMode', S.visMode); showMsg('VISUALIZER: ' + ['BARS', 'SCOPE', 'OFF'][S.visMode]); };
  let visClick = 0;
  $('#viscv').onclick = () => { clearTimeout(visClick); visClick = setTimeout(cycleVis, 260); };
  $('#viscv').ondblclick = () => { clearTimeout(visClick); toggleMilkdrop(); };
  setupClutter();

  setVol(S.vol, true);
  hDrag($('#vol'), f => setVol(Math.round(f * 100)));
  let bal = LS.get('bal', 0); setBal(bal);
  hDrag($('#bal'), f => {
    bal = Math.round(f * 200 - 100); if (Math.abs(bal) < 10) bal = 0; setBal(bal);
    showMsg('BALANCE: ' + (bal === 0 ? 'CENTER' : Math.abs(bal) + '% ' + (bal < 0 ? 'LEFT' : 'RIGHT')) + (window.desktop?.setBalance ? '' : ' (DESKTOP APP ONLY)'));
  });
  hDrag($('#seek'), f => {
    if (!S.track) return;
    S.seeking = true; S.seekFrac = f; placeH($('#seek'), f);
    showMsg('SEEK TO: ' + fmt(f * S.dur) + '/' + fmt(S.dur));
  }, f => {
    if (!S.seeking) return;
    S.seeking = false;
    if (S.track && S.player) { const ms = f * S.dur; S.player.seek(ms); S.pos = ms; S.ts = performance.now(); }
  });
  $('#marquee').onclick = () => showWin('pl', true);
}
/* custom horizontal sliders (volume, balance, position bar) */
const THUMB = { vol: [68, 14], bal: [38, 14], seek: [248, 29], mvol: [52, 0], mseek: [269, 0] };
function placeH(el, f) {
  const [w, t] = THUMB[el.id];
  const v = Math.round(Math.max(0, Math.min(1, f)) * (w - 2 - t)) + 'px';
  if (el.firstElementChild.style.left !== v) el.firstElementChild.style.left = v;
}
function hDrag(el, onMove, onEnd) {
  const frac = ev => {
    const r = el.getBoundingClientRect(), [w, t] = THUMB[el.id], k = r.width / w;
    return Math.max(0, Math.min(1, (ev.clientX - r.left - (t / 2) * k) / ((w - t) * k)));
  };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    onMove(frac(e));
    const mv = ev => onMove(frac(ev));
    const up = ev => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); onEnd?.(frac(ev)); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
}
function setVol(v, quiet, fromRemote) {
  S.vol = Math.max(0, Math.min(100, Math.round(v))); LS.set('vol', S.vol);
  placeH($('#vol'), S.vol / 100);
  $('#vol').style.setProperty('--h', Math.round(120 - S.vol * 1.2));
  if (!fromRemote) { S.volSetAt = Date.now(); S.player?.setVolume(S.vol / 100); }
  if (!quiet) showMsg('VOLUME: ' + S.vol + '%');
}
/* Follow volume changes made elsewhere: the Spotify app on this PC or a phone
   (Spotify Connect) changes this player's volume directly, so we read it back
   a few times a second and move the slider to match. */
setInterval(() => {
  // only while a song is loaded on this player: before that, the player reports 0 and that
  // would wrongly mute Soranix
  if (!S.player || !S.deviceId || !S.track || Date.now() - (S.volSetAt || 0) < 1000) return;
  S.player.getVolume().then(v => {
    if (typeof v !== 'number' || Date.now() - (S.volSetAt || 0) < 1000) return;
    const pct = Math.round(v * 100);
    if (pct !== S.vol) setVol(pct, false, true);
  }).catch(() => {});
}, 300);
function setBal(b) {
  LS.set('bal', b);
  window.desktop?.setBalance?.(b); // pans Soranix's sound in Windows
  placeH($('#bal'), (b + 100) / 200);
  $('#bal').style.setProperty('--h', Math.round(120 - Math.abs(b) * 1.2));
}
function showMsg(text, ms = 1200) { S.msg = text; S.msgUntil = performance.now() + ms; }
function renderStatus() {
  const st = $('#playstate');
  st.className = 'playstate ' + (!S.track || S.stopped ? 'stopped' : S.paused ? 'paused' : 'playing');
  $('#tog-shuf').classList.toggle('on', !!S.shuffle);
  $('#tog-rep').classList.toggle('on', S.repeat > 0);
  $('#tog-rep b').textContent = S.repeat === 2 ? '1' : '↻';
  const on = !!S.track && !S.stopped;
  setPx($('#kbps'), on ? '256' : '');
  setPx($('#khz'), on ? '44' : '');
  $('#ind-stereo').classList.toggle('on', on);
  if (S.track) {
    const idx = S.now.findIndex(x => x.uri === S.track.uri || x.id === S.track.id);
    S.marqBase = `${idx >= 0 ? idx + 1 + '. ' : ''}${S.track.artists.map(a => a.name).join(', ')} - ${S.track.name} (${fmt(S.dur)})`;
  } else {
    S.marqBase = YT.on ? `SORANIX - ${W().up} - PRESS EJECT TO PICK SOMETHING` : S.me ? 'SORANIX - PRESS EJECT OR PL TO PICK SOMETHING' : 'SORANIX - CONNECT YOUR SPOTIFY ACCOUNT IN THE LIBRARY WINDOW';
  }
}

/* 7-segment time display */
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function digit(c, x, d, lit) {
  const w = 9, h = 13, k = 2, y = 1, mid = y + (h - k) / 2;
  const R = { a: [x + 1, y, w - 2, k], d: [x + 1, y + h - k, w - 2, k], g: [x + 1, mid, w - 2, k], f: [x, y + 1, k, h / 2 - 1], b: [x + w - k, y + 1, k, h / 2 - 1], e: [x, mid + 1, k, h / 2 - 1], c: [x + w - k, mid + 1, k, h / 2 - 1] };
  for (const s in R) { c.fillStyle = lit && SEG[d]?.includes(s) ? '#00e000' : '#0b2a0b'; c.fillRect(...R[s]); }
}
let lastTimeKey = '';
function drawTime() {
  const cv = $('#timecv'), c = cv.getContext('2d');
  const has = !!S.track && !S.stopped;
  const blinkOff = has && S.paused && Math.floor(performance.now() / 500) % 2;
  const ms = S.remaining ? S.dur - curPos() : curPos();
  const sec = Math.max(0, Math.floor(ms / 1000)), m = Math.min(99, Math.floor(sec / 60)), s = sec % 60;
  const lit = has && !blinkOff;
  const key = `${m}:${s}:${lit}:${S.remaining}`;
  if (key === lastTimeKey) return; // nothing changed: no repaint
  lastTimeKey = key;
  c.clearRect(0, 0, cv.width, cv.height);
  c.fillStyle = lit && S.remaining ? '#00e000' : '#0b2a0b'; c.fillRect(1, 7, 5, 2);
  const str = String(m).padStart(2, '0') + String(s).padStart(2, '0');
  [8, 20, 35, 47].forEach((x, i) => digit(c, x, str[i], lit));
  c.fillStyle = lit ? '#00e000' : '#0b2a0b'; c.fillRect(31, 4, 2, 2); c.fillRect(31, 10, 2, 2);
}

/* Visualizer. Spotify's audio is DRM-protected, so browsers never expose the waveform:
   this is a simulated analyzer that moves with play/pause. */
const vis = { bars: new Array(19).fill(0), peaks: new Array(19).fill(0), phase: [...Array(19)].map(() => Math.random() * 6.28) };
let visIdle = false;
function drawVis() {
  const cv = $('#viscv'), c = cv.getContext('2d'), W = cv.width, H = cv.height;
  const playing = S.track && !S.paused && !S.stopped, t = performance.now() / 1000;
  const settled = !playing && vis.bars.every(b => b < 0.01) && vis.peaks.every(p => p < 0.02);
  if (settled && visIdle) return; // already blank: no repaint
  visIdle = settled;
  c.clearRect(0, 0, W, H);
  if (S.visMode === 2) return;
  if (playing && audioLive()) return drawRealVis(c, W, H);
  if (S.visMode === 1) {
    c.fillStyle = '#00e000';
    for (let x = 0; x < W; x++) {
      const a = playing ? Math.sin(x * 0.35 + t * 9) * 0.45 + Math.sin(x * 0.11 - t * 5) * 0.35 + (Math.random() - 0.5) * 0.3 : 0;
      c.fillRect(x, Math.round(H / 2 + a * (H / 2 - 1)), 1, 1);
    }
    return;
  }
  const beat = Math.exp(-((t * 1000) % 500) / 110);
  for (let i = 0; i < 19; i++) {
    let target = 0;
    if (playing) {
      const bass = 1 - i / 22;
      target = (0.35 + 0.3 * Math.sin(t * (2 + i * 0.37) + vis.phase[i]) + 0.25 * Math.random()) * (0.55 + 0.45 * bass) + beat * bass * 0.5;
      target = Math.min(1, Math.max(0, target));
    }
    vis.bars[i] = target > vis.bars[i] ? target : Math.max(0, vis.bars[i] - 0.05);
    vis.peaks[i] = vis.bars[i] > vis.peaks[i] ? vis.bars[i] : Math.max(0, vis.peaks[i] - 0.012);
    const bh = Math.round(vis.bars[i] * H), x = i * 4;
    for (let y = 0; y < bh; y++) { const f = y / H; c.fillStyle = f > 0.8 ? '#e02000' : f > 0.55 ? '#e0c000' : '#00c000'; c.fillRect(x, H - 1 - y, 3, 1); }
    if (vis.peaks[i] > 0.02) { c.fillStyle = '#a8a8c8'; c.fillRect(x, H - 1 - Math.round(vis.peaks[i] * (H - 1)), 3, 1); }
  }
}
function drawMarquee(now) {
  const box = $('#marquee'), span = $('#marqtext');
  if (S.msg && now < S.msgUntil) {
    if (span.dataset.mode !== 'msg' || span.dataset.txt !== S.msg) { span.dataset.mode = 'msg'; setPx(span, S.msg); span.style.transform = ''; }
    return;
  }
  const ub = updateBanner(now);
  if (ub) {
    if (span.dataset.mode !== 'msg' || span.dataset.txt !== ub) { span.dataset.mode = 'msg'; setPx(span, ub); span.style.transform = ''; }
    return;
  }
  const loop = S.marqBase + '  ***  ';
  if (span.dataset.mode !== 'scroll' || span.dataset.base !== loop) {
    span.dataset.mode = 'scroll'; span.dataset.base = loop; setPx(span, loop + loop); S.marqX = 0;
  }
  const half = span.offsetWidth / 2;
  if (half <= box.clientWidth) { if (span.dataset.txt !== S.marqBase) setPx(span, S.marqBase); span.dataset.base = ''; span.style.transform = ''; return; }
  if (now - S.marqT > 140) { S.marqT = now; S.marqX = (S.marqX + 2) % half; span.style.transform = `translateX(${-S.marqX}px)`; }
}
let lastFrame = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (document.visibilityState === 'hidden') return;          // minimized: draw nothing
  if (now - lastFrame < 1000 / 30 - 2) return;                // ~30 frames a second is plenty
  lastFrame = now;
  drawTime(); drawVis(); drawMarquee(now); lyricsTick();
  if (MINI.on) drawMini(now);
  if (VL.on || VL.cur !== -2) visLyricsTick();
  const sk = $('#seek');
  const empty = !S.track || !S.dur; if (sk.classList.contains('empty') !== empty) sk.classList.toggle('empty', empty);
  if (!S.seeking) placeH(sk, S.dur ? curPos() / S.dur : 0);
  const pc = S.track && !S.stopped ? fmt(curPos()) : ':';
  if ($('#plcur').dataset.txt !== pc) setPx($('#plcur'), pc);
}

/* ------------------------------------------------------------------ playlist window */
function setupPL() {
  const box = $('#pllist');
  box.onclick = e => {
    const r = e.target.closest('.plrow'); if (!r) return;
    const i = +r.dataset.i;
    if (e.shiftKey && S.plAnchor >= 0) { S.plSel.clear(); for (let k = Math.min(i, S.plAnchor); k <= Math.max(i, S.plAnchor); k++) S.plSel.add(k); }
    else if (e.ctrlKey || e.metaKey) { S.plSel.has(i) ? S.plSel.delete(i) : S.plSel.add(i); S.plAnchor = i; }
    else { S.plSel = new Set([i]); S.plAnchor = i; }
    // only flip the highlight; redrawing the rows here would swap the element under the
    // mouse between the two clicks, and the double-click would never register
    $$('.plrow', box).forEach(row => row.classList.toggle('sel', S.plSel.has(+row.dataset.i)));
    updPlTime();
  };
  box.ondblclick = e => { const r = e.target.closest('.plrow'); if (r) playFromPl(+r.dataset.i); };
  $('#pl-add').onclick = () => { showWin('lib', true); if (S.me) $('#q').focus(); };
  $('#pl-rem').onclick = plRemove;
  $('#pl-sel').onclick = () => { S.plSel = new Set(S.pl.map((_, i) => i)); renderPL(false); };
  $('#pl-misc').onclick = e => openMenu(e, [
    ['Clear playlist', () => { S.pl = []; S.plSel.clear(); renderPL(); }],
    ['Remove duplicates', () => { const seen = new Set(); S.pl = S.pl.filter(t => !seen.has(t.uri) && seen.add(t.uri)); S.plSel.clear(); renderPL(); }],
    ['Randomize order', () => { for (let i = S.pl.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [S.pl[i], S.pl[j]] = [S.pl[j], S.pl[i]]; } S.plSel.clear(); renderPL(); }],
    ['Reverse order', () => { S.pl.reverse(); S.plSel.clear(); renderPL(); }],
    ['Sort by title', () => { S.pl.sort((a, b) => a.name.localeCompare(b.name)); S.plSel.clear(); renderPL(); }],
    ['Sort by artist', () => { S.pl.sort((a, b) => a.artist.localeCompare(b.artist)); S.plSel.clear(); renderPL(); }],
  ]);
  $('#pl-list').onclick = e => openMenu(e, [
    ['Open library...', () => showWin('lib', true)],
    ['Select none', () => { S.plSel.clear(); renderPL(false); }],
    ['Clear playlist', () => { S.pl = []; S.plSel.clear(); renderPL(); }],
  ]);
  $$('.mini span').forEach(s => { s.innerHTML = ICON[s.dataset.t]; s.onclick = () => T[s.dataset.t](); });
  renderPL();
}
function plRemove() {
  if (!S.plSel.size) return;
  S.pl = S.pl.filter((_, i) => !S.plSel.has(i)); S.plSel.clear(); renderPL();
}
function renderPL(save = true) {
  const box = $('#pllist');
  // the playing song is marked only while the window is what plays
  const cur = S.src === 'pl' ? S.track : null;
  if (!S.pl.length) {
    box.innerHTML = '<div class="plempty">Playlist is empty.<br>Press ADD or Eject to open your library.</div>';
  } else {
    box.innerHTML = S.pl.map((t, i) =>
      `<div class="plrow${S.plSel.has(i) ? ' sel' : ''}${cur && (t.uri === cur.uri || t.id === cur.id) ? ' cur' : ''}${' svc-' + svcOfRow(t)}" data-i="${i}">` +
      `<span class="t">${i + 1}. ${esc(t.artist)} - ${esc(t.name)}</span><span class="d">${fmt(t.dur)}</span></div>`).join('');
  }
  updPlTime();
  if (save) LS.set('pl', S.pl);
  renderStatus();
}
/* "selected time / total time" box under the playlist */
function updPlTime() {
  const total = S.pl.reduce((a, t) => a + (t.dur || 0), 0);
  const sel = [...S.plSel].reduce((a, i) => a + (S.pl[i]?.dur || 0), 0);
  setPx($('#pltime'), `${fmt(sel)}/${fmt(total)}`);
}
function plAdd(tracks, replace) {
  const clean = tracks.filter(t => t && t.type === 'track');
  if (replace) { S.pl = clean.map(t => ({ ...t })); S.plSel.clear(); RADIO.on = false; }
  else S.pl.push(...clean.map(t => ({ ...t, ctx: null })));
  if (!replace) S.pl.forEach(t => { if (t.ctx && !S.pl.every(x => x.ctx === t.ctx)) t.ctx = null; });
  renderPL();
  showWin('pl', true);
  return clean.length;
}

/* ------------------------------------------------------------------ mixed playlists
   Your own lists, kept on this PC, that can hold Spotify and YouTube Music songs together. Each
   song shows in its service's colour (Spotify green, YouTube Music red). Only one service runs
   at a time: when the next song is from the other one, Soranix switches over (about a second)
   and goes on playing there. Opening or editing a list costs no requests. */
const MIX = { lists: LS.get('mixLists', []), handing: false };
// (svcOfRow, the service of a row, is in ytm.js)
const mixSave = () => { LS.set('mixLists', MIX.lists); if (isShown('mx')) renderMyLists(); };
const mixById = id => MIX.lists.find(l => l.id === id);
const mixSong = t => ({ type: 'track', uri: t.uri, id: t.id, url: t.url, name: t.name, artist: t.artist, artists: t.artists, album: t.album, albumId: t.albumId, dur: t.dur, img: t.img, imgLarge: t.imgLarge, mvt: t.mvt, mix: true });
function mixTreeNodes() {
  return [['grp', 'Mixed playlists' + (MIX.lists.length ? ` (${MIX.lists.length})` : '')],
    ...MIX.lists.map(l => ['mix:' + l.id, l.name, 1]), ['mixnew', '+ New mixed playlist', 1]];
}
async function mixNew(tracks = []) {
  const name = await winPrompt('Name for the new mixed playlist:', 'My mix', { title: 'NEW MIXED PLAYLIST', ok: 'Create' });
  if (!name) return null;
  const l = { id: Date.now().toString(36), name, songs: tracks.filter(t => t?.type === 'track').map(mixSong) };
  MIX.lists.push(l); mixSave(); renderTree();
  showMsg(tracks.length ? `ADDED ${songs(l.songs.length).toUpperCase()} TO ${name.toUpperCase()}` : 'MIXED PLAYLIST CREATED', 2000);
  return l;
}
function mixAdd(l, tracks) {
  const have = new Set(l.songs.map(s => s.uri));
  const add = tracks.filter(t => t?.type === 'track' && !have.has(t.uri)).map(mixSong);
  l.songs.push(...add); mixSave();
  if (L.view?.mixId === l.id) mixOpen(l.id, false);
  showMsg(add.length ? `ADDED ${songs(add.length).toUpperCase()} TO ${l.name.toUpperCase()}` : 'ALREADY IN ' + l.name.toUpperCase(), 2000);
}
function mixMenu(tracks) {
  return [{ label: 'New mixed playlist...', fn: () => mixNew(tracks) }, ...(MIX.lists.length ? ['-'] : []),
    ...MIX.lists.map(l => ({ label: l.name, fn: () => mixAdd(l, tracks) }))];
}
function mixOpen(id, push = true) {
  const l = mixById(id); if (!l) return;
  const n = { sp: 0, yt: 0, sc: 0 }; l.songs.forEach(s => n[svcOfRow(s)]++);
  setView({ node: 'mix:' + id, mixId: id, kind: 'track', title: l.name, rows: l.songs.map(s => ({ ...s, mix: true })),
    sub: `${songs(l.songs.length)}: ${n.sp} on Spotify (green), ${n.yt} on YouTube Music (red), ${n.sc} on SoundCloud (orange)`,
    empty: 'Empty. Right-click any song > Add to mixed playlist.',
    actions: [['Rename', () => mixRename(l)], ['Delete', () => mixDelete(l)]] }, push);
}
async function mixRename(l) {
  const r = await winDialog({ title: 'RENAME', message: 'New name:', fields: [{ value: l.name, required: true }], ok: 'Rename' });
  if (!r) return; l.name = r[0]; mixSave(); renderTree(); mixOpen(l.id, false);
}
async function mixDelete(l) {
  if (!(await winConfirm(`Delete the mixed playlist "${l.name}"? This can't be undone.`, { title: 'DELETE', ok: 'Delete', danger: true }))) return;
  MIX.lists = MIX.lists.filter(x => x !== l); mixSave();
}
function mixRemove(l, tracks) {
  const gone = new Set(tracks.map(t => t.uri));
  l.songs = l.songs.filter(s => !gone.has(s.uri)); mixSave(); mixOpen(l.id, false);
}
function mixMove(l, t, d) {
  const i = l.songs.findIndex(s => s.uri === t.uri), j = i + d;
  if (i < 0 || j < 0 || j >= l.songs.length) return;
  [l.songs[i], l.songs[j]] = [l.songs[j], l.songs[i]]; mixSave(); mixOpen(l.id, false);
  L.sel = new Set([j]); renderView();
}
/* the next song is from the other service: switch over and play it there */
function mixHandoff(i) {
  if (MIX.handing) return; MIX.handing = true;
  const to = ROW_SVC[svcOfRow(S.now[i])];
  S.plCur = i; LS.set('pl', S.pl); saveNow();
  LS.set('mixResume', { i, uri: S.now[i].uri, at: Date.now() });
  showMsg(`NEXT SONG IS ON ${SVC_NAME[to].toUpperCase()} - SWITCHING...`, 3000);
  try { S.player?.pause?.(); } catch {}
  setTimeout(() => switchService(to), 30);
}
/* after the switch: the player is ready, play the song we switched for */
function mixResume() {
  const r = LS.get('mixResume'); if (!r) return;
  LS.del('mixResume');
  if (Date.now() - r.at > 60000) return;
  const i = S.now[r.i]?.uri === r.uri ? r.i : S.now.findIndex(x => x.uri === r.uri);
  if (i >= 0) { MIX.wait = { uri: r.uri, from: r.at }; playIndex(i); }
}
// how long a switch for a mixed playlist took, until the next song really plays (in the log)
setInterval(() => {
  const w = MIX.wait; if (!w || !S.track || S.paused || S.track.uri !== w.uri || curPos() < 50) return;
  MIX.wait = null;
  console.log(`[mix] next song playing ${Date.now() - w.from} ms after the switch started (now ${YT.on ? W().name : 'Spotify'})`);
}, 100);
/* Spotify: its own list only holds the Spotify songs around the playing one; in the last moment
   of the last of those, hand over to the other service for the next song */
setInterval(() => {
  if (YT.on || MIX.handing || S.paused || !S.track || !S.dur || S.repeat === 2) return;
  const i = plIndexOfCurrent(); const n = i >= 0 ? S.now[i + 1] : null;
  // the YouTube Music / SoundCloud window got ready for a song that won't come next after all: close it
  if (MIX.warm && MIX.warm !== S.track.uri) { MIX.warm = null; webCall(MIX.warmSvc, 'stop').catch(() => {}); }
  if (!n || svcOfRow(n) === 'sp') return;
  const left = S.dur - curPos(), to = ROW_SVC[svcOfRow(n)];
  // 20 s before the end: the other service's window loads in the background and gets the next
  // song ready (silently), so switching over takes a moment instead of a few seconds
  if (left < 20000 && !MIX.warm && window.desktop?.[to]) {
    MIX.warm = S.track.uri; MIX.warmSvc = to;
    webCall(to, 'hello').then(() => webCall(to, 'cue', n.id, n.url)).catch(() => {});
  }
  // the switch starts just before the end, so it overlaps the song's last moment
  if (left < 900) { MIX.warm = null; mixHandoff(i + 1); }
}, 250);

/* ------------------------------------------------------------------ My playlists window
   The MY LISTS button (playlist window, next to LIST OPTS) opens your own lists: Spotify and
   YouTube Music songs together, each in its service's colour. Drag songs from the library onto
   a list (or onto the playlist window), save what's in the playlist window as a list, and play
   a list or add it to the playlist window. All kept on this PC: no requests. */
const MXV = { sel: null, song: -1 };
let DRAG = null;   // songs being dragged from the library / Discover
function toggleMyLists(on = !isShown('mx')) {
  showWin('mx', on); if (!on) return;
  const w = winEl('mx');
  if (!wasMoved('mx')) placeFree(w); else fitOnScreen(w);
  if (!mixById(MXV.sel)) MXV.sel = MIX.lists[0]?.id || null;
  renderMyLists();
}
function renderMyLists() {
  const box = $('#mx-lists'); if (!box) return;
  box.innerHTML = MIX.lists.length ? MIX.lists.map(l => {
    const n = { sp: 0, yt: 0, sc: 0 }; l.songs.forEach(s => n[svcOfRow(s)]++);
    return `<div class="mx-list${l.id === MXV.sel ? ' sel' : ''}" data-id="${esc(l.id)}" title="${esc(l.name)}">` +
      `<span class="n">${esc(l.name)}</span><span class="c"><b class="svc-sp" title="Spotify songs">${n.sp}</b> <b class="svc-yt" title="YouTube Music songs">${n.yt}</b> <b class="svc-sc" title="SoundCloud songs">${n.sc}</b></span></div>`;
  }).join('') : '<div class="mx-empty">No lists yet.<br>Press New, or Save playlist window.</div>';
  const l = mixById(MXV.sel);
  $('#mx-head').textContent = l ? `${l.name}  \u00B7  ${songs(l.songs.length)}` : '';
  $('#mx-songs').innerHTML = !l ? '<div class="mx-empty">Pick a list on the left.</div>'
    : !l.songs.length ? '<div class="mx-empty">Empty. Drag songs here from the library,<br>or right-click a song > Add to My playlists.</div>'
    : l.songs.map((s, i) => `<div class="mx-song svc-${svcOfRow(s)}${i === MXV.song ? ' sel' : ''}" data-i="${i}" title="${esc(s.artist)} - ${esc(s.name)}">` +
      `<span class="t">${i + 1}. ${esc(s.artist)} - ${esc(s.name)}</span><span class="d">${fmt(s.dur)}</span></div>`).join('');
  for (const id of ['mx-play', 'mx-add', 'mx-ren', 'mx-del']) $('#' + id).disabled = !l;
  $('#mx-save').disabled = !S.pl.length;
}
function mixToPlaylist(l, play, from = 0) {
  if (!l?.songs.length) return showMsg('THIS LIST IS EMPTY', 1500);
  const rows = l.songs.map(s => ({ ...s }));
  if (play) { plAdd(rows, true); playFromPl(from); } else { const n = plAdd(rows, false); showMsg(`ADDED ${songs(n).toUpperCase()} TO THE PLAYLIST WINDOW`, 2000); }
}
async function mixSavePlaylistWindow() {
  if (!S.pl.length) return;
  const l = await mixNew(S.pl);
  if (l) { MXV.sel = l.id; renderMyLists(); }
}
function setupMyLists() {
  $('#pl-my').onclick = () => toggleMyLists();
  // it was open: open it again (after switching between Spotify and YouTube Music, or a restart)
  if (LS.get('shown', {}).mx) { winEl('mx').classList.add('hidden'); setTimeout(() => toggleMyLists(true), 0); }
  $('#mx-new').onclick = async () => { const l = await mixNew(); if (l) { MXV.sel = l.id; MXV.song = -1; renderMyLists(); } };
  $('#mx-save').onclick = mixSavePlaylistWindow;
  $('#mx-play').onclick = () => mixToPlaylist(mixById(MXV.sel), true);
  $('#mx-add').onclick = () => mixToPlaylist(mixById(MXV.sel), false);
  $('#mx-ren').onclick = async () => { const l = mixById(MXV.sel); if (l) { await mixRename(l); renderMyLists(); } };
  $('#mx-del').onclick = async () => { const l = mixById(MXV.sel); if (l) { await mixDelete(l); MXV.sel = MIX.lists[0]?.id || null; renderMyLists(); } };
  $('#mx-lists').onclick = e => { const it = e.target.closest('.mx-list'); if (it) { MXV.sel = it.dataset.id; MXV.song = -1; renderMyLists(); } };
  $('#mx-lists').ondblclick = e => { const it = e.target.closest('.mx-list'); if (it) mixToPlaylist(mixById(it.dataset.id), true); };
  const songsBox = $('#mx-songs');
  songsBox.onclick = e => { const r = e.target.closest('.mx-song'); if (r) { MXV.song = +r.dataset.i; renderMyLists(); } };
  songsBox.ondblclick = e => { const r = e.target.closest('.mx-song'); if (r) mixToPlaylist(mixById(MXV.sel), true, +r.dataset.i); };
  songsBox.addEventListener('contextmenu', e => {
    const r = e.target.closest('.mx-song'), l = mixById(MXV.sel); if (!r || !l) return;
    e.preventDefault();
    const i = +r.dataset.i, s = l.songs[i];
    openMenu(e, [
      ['Play from here', () => mixToPlaylist(l, true, i)],
      ['Move up', () => { if (i > 0) { [l.songs[i - 1], l.songs[i]] = [l.songs[i], l.songs[i - 1]]; MXV.song = i - 1; mixSave(); renderMyLists(); } }],
      ['Move down', () => { if (i + 1 < l.songs.length) { [l.songs[i + 1], l.songs[i]] = [l.songs[i], l.songs[i + 1]]; MXV.song = i + 1; mixSave(); renderMyLists(); } }],
      '-',
      ['Remove from this list', () => { l.songs.splice(i, 1); MXV.song = -1; mixSave(); renderMyLists(); }],
    ]);
  });
  // drag songs from the library (table rows, Discover covers) onto a list, its songs or the playlist window
  const pickDrag = e => {
    const tr = e.target.closest('#grid tbody tr[data-i]'), card = e.target.closest('#cards .ytcard');
    const i = +(tr || card)?.dataset.i; if (Number.isNaN(i)) return null;
    const v = L.view; if (!v) return null;
    const picked = tr && L.sel.has(i) ? [...L.sel].sort((a, b) => a - b).map(k => v.rows[k]) : [v.rows[i]];
    return picked.filter(r => r?.type === 'track');
  };
  document.addEventListener('dragstart', e => {
    DRAG = pickDrag(e);
    if (!DRAG?.length) { DRAG = null; return; }
    e.dataTransfer.setData('text/plain', DRAG.map(t => `${t.artist} - ${t.name}`).join('\n'));
    e.dataTransfer.effectAllowed = 'copy';
  });
  document.addEventListener('dragend', () => { DRAG = null; $$('.drop-on').forEach(x => x.classList.remove('drop-on')); });
  const dropZone = (el, onDrop) => {
    el.addEventListener('dragover', e => { if (!DRAG) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('drop-on'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop-on'));
    el.addEventListener('drop', e => { if (!DRAG) return; e.preventDefault(); el.classList.remove('drop-on'); const t = DRAG; DRAG = null; onDrop(t, e); });
  };
  dropZone($('#pllist'), t => { const n = plAdd(t, false); showMsg(`ADDED ${songs(n).toUpperCase()} TO THE PLAYLIST WINDOW`, 1800); });
  dropZone(songsBox, async t => { let l = mixById(MXV.sel); if (!l) { l = await mixNew(t); if (l) { MXV.sel = l.id; renderMyLists(); } return; } mixAdd(l, t); renderMyLists(); });
  dropZone($('#mx-lists'), (t, e) => { const it = e.target.closest('.mx-list'); const l = it ? mixById(it.dataset.id) : mixById(MXV.sel); if (l) { mixAdd(l, t); MXV.sel = l.id; renderMyLists(); } });
}

/* ------------------------------------------------------------------ library window */
const L = { node: null, view: null, history: [], sel: new Set(), anchor: -1, tab: 'track', q: '' };
const mapTrack = (t, x = {}) => t && t.uri && !t.is_local && t.type !== 'episode' ? {
  type: 'track', uri: t.uri, id: t.id, name: t.name,
  artist: (t.artists || []).map(a => a.name).join(', '), artistId: t.artists?.[0]?.id,
  artists: (t.artists || []).map(a => ({ id: a.id, name: a.name })),
  album: t.album?.name || x.album || '', albumId: t.album?.id || x.albumId, dur: t.duration_ms, ctx: x.ctx || null,
  img: t.album?.images?.at(-1)?.url || x.img,
  imgLarge: (t.album?.images?.[1] || t.album?.images?.[0])?.url || x.imgLarge,   // (for cover grids)
} : null;
const mapArtist = a => a && { type: 'artist', uri: a.uri, id: a.id, name: a.name, genres: (a.genres || []).join(', '), img: a.images?.at(-1)?.url };
const mapAlbum = a => a && { type: 'album', uri: a.uri, id: a.id, name: a.name, artist: (a.artists || []).map(x => x.name).join(', '), year: (a.release_date || '').slice(0, 4), count: a.total_tracks, img: a.images?.at(-1)?.url, imgMid: (a.images?.[1] || a.images?.[0])?.url };
const mapPlaylist = p => p && { type: 'playlist', uri: p.uri, id: p.id, snapshot: p.snapshot_id, name: p.name, owner: p.owner?.display_name || p.owner?.id || '', ownerId: p.owner?.id, collab: p.collaborative, public: p.public, count: p.items?.total ?? p.tracks?.total ?? '', img: p.images?.at(-1)?.url, imgLarge: p.images?.[0]?.url };
const COLS = {
  track: [['#', 'num', (r, i) => i + 1], ['Title', '', r => r.name], ['Artist', '', r => r.artist], ['Album', '', r => r.album], ['Time', 'dur', r => r.dur ? fmt(r.dur) : '']],
  artist: [['Artist', '', r => r.name], ['Genres', '', r => r.genres]],
  album: [['Album', '', r => r.name], ['Artist', '', r => r.artist], ['Year', 'dur', r => r.year], ['Tracks', 'dur', r => r.count]],
  playlist: [['Playlist', '', r => r.name], ['Owner', '', r => r.owner], ['Tracks', 'dur', r => r.count]],
  show: [['Podcast', '', r => r.name], ['Publisher', '', r => r.owner], ['Episodes', 'dur', r => r.count]],
};

function setupLib() {
  $('#redir').textContent = REDIRECT;
  // empty until you've connected once (then your own Client ID is remembered)
  $('#cid').value = LS.get('clientId', '');
  $('#b-login').onclick = login;
  $('#cid').onkeydown = e => { if (e.key === 'Enter') login(); };
  // Liked Songs / a playlist open: search inside it; anywhere else: search all of Spotify
  $('#b-search').onclick = () => doSearch();
  $('#q').onkeydown = e => {
    if (e.key === 'Enter') doSearch();
    else if (e.key === 'Escape' && listSearchable(L.view)) { $('#q').value = ''; filterView(''); }
  };
  let typing = 0;
  $('#q').addEventListener('input', () => {   // inside a list, results update as you type
    if (!listSearchable(L.view)) return;
    clearTimeout(typing); typing = setTimeout(() => filterView($('#q').value), 250);
  });
  $('#lib-back').onclick = libBack;
  $('#lib-play').onclick = () => libSend(true);
  $('#lib-enq').onclick = () => libSend(false);
  $('#lib-more').onclick = loadMore;
  $('#lib-newmix').onclick = () => openDiscover(true);
  const grid = $('#grid tbody');
  grid.onclick = e => {
    const tr = e.target.closest('tr[data-i]'); if (!tr) return;
    const i = +tr.dataset.i;
    if (e.shiftKey && L.anchor >= 0) { L.sel.clear(); for (let k = Math.min(i, L.anchor); k <= Math.max(i, L.anchor); k++) L.sel.add(k); }
    else if (e.ctrlKey || e.metaKey) { L.sel.has(i) ? L.sel.delete(i) : L.sel.add(i); L.anchor = i; }
    else { L.sel = new Set([i]); L.anchor = i; }
    $$('#grid tbody tr[data-i]').forEach(r => r.classList.toggle('sel', L.sel.has(+r.dataset.i)));
  };
  grid.ondblclick = e => { const tr = e.target.closest('tr[data-i]'); if (tr) activateRow(+tr.dataset.i); };
  $('#tree').onclick = e => { const n = e.target.closest('.node[data-id]'); if (n) openNode(n.dataset.id); };
}
function showLogin(reason) {
  $('#login').style.display = ''; $('#libmain').style.display = 'none';
  if (location.protocol === 'file:') loginError('Open this through start.bat (it serves the app at http://127.0.0.1:8888). Spotify login does not work from a file.');
  else loginError(reason || '');
  showWin('lib', true);
}
function loginError(t) { $('#loginerr').textContent = t || ''; }
function libStatus(t) { $('#libstatus').textContent = t || ''; }

async function onConnected() {
  const savedMe = LS.get('me');
  try { S.me = savedMe && Date.now() - savedMe.at < DAY ? savedMe.me : await api('/me'); LS.set('me', { at: savedMe?.me === S.me ? savedMe.at : Date.now(), me: S.me }); }
  catch (e) {
    if (savedMe && (!e.status || e.status === 429 || e.status >= 500)) { S.me = savedMe.me; }
    else {
    // Spotify busy or no internet: keep the login and try again shortly, don't log out
    if (!e.status || e.status === 429 || e.status >= 500) {
      showMsg('SPOTIFY IS BUSY - RETRYING IN 30 SECONDS', 5000);
      setTimeout(onConnected, 30000);
      return;
    }
    const hint = e.status === 403 ? '\nIn your Spotify dashboard app, open User Management and add the email of the Spotify account you log in with.' : '';
    return logout('Spotify refused access: ' + e.message + hint);
    }
  }
  $('#login').style.display = 'none'; $('#libmain').style.display = '';
  $('#acct').classList.add('on'); $('#acct').title = 'Connected as ' + (S.me.display_name || S.me.id);
  showMsg('WELCOME ' + (S.me.display_name || S.me.id).toUpperCase(), 2500);
  renderStatus();
  loadSDK();
  renderTreeHead(); renderTree();
  // show the playlists remembered from last time right away, then refresh from Spotify
  if (!S.playlists.length) { S.playlists = LS.get('playlistsCache', []); renderTree(); }
  const cachedAt = LS.get('playlistsCacheAt', 0);
  try { if (!S.playlists.length || Date.now() - cachedAt > PL_REFRESH) await syncPlaylists(true); }
  catch (e) {
    libStatus('Spotify is busy, showing your saved playlist list. Soranix will try again later.');
  }
  renderTree();
  if (!L.node) openNode('discover');   // opens with Discover new music (its kept mix: no requests)
  // keep the playlist list in step with Spotify: changes made in the Spotify app (or on a
  // phone) show up within half a minute, or as soon as you come back to Soranix
  // refresh the playlist list every 30 minutes (or press the refresh button in the library)
  // (skipped while you're away: nothing playing and no clicks or keys for 20 minutes;
  //  it catches up as soon as you're back)
  const stale = () => Date.now() - LS.get('playlistsCacheAt', 0) > PL_REFRESH - 5000;
  setInterval(() => { if (!S.paused) S.activeAt = Date.now(); if (stale() && !away()) syncPlaylists().catch(() => {}); }, 60000);
  const back = () => { const was = away(); S.activeAt = Date.now(); if (was && stale()) syncPlaylists().catch(() => {}); };
  addEventListener('pointerdown', back, true); addEventListener('keydown', back, true);
  setInterval(renderTree, 60000); // keeps "updated N min ago" current
  setTimeout(cleanSaved, 60000);   // tidy up saved copies (once a day)
}
/* Fetch the full playlist list from Spotify and update the sidebar if anything changed
   (new, deleted, renamed, new cover, track count). Keeps the order Spotify uses. */
let syncing = null;
const PL_REFRESH = 30 * 60000;
function syncPlaylists(first = false, full = false) {
  if (!S.me) return Promise.resolve();
  if (pausedFor('/me/playlists') > 0) return Promise.resolve(); // Spotify asked us to wait
  // close to the point where Spotify would block the list: keep showing the saved one
  if (overBudget('/me/playlists')) { console.log('[playlists] safe limit reached, using the saved list'); return Promise.resolve(); }
  return (syncing ??= (async () => {
    // (cover links are compared without the server name: Spotify sends the same picture from different servers)
    const sig = list => list.map(p => [p.id, p.snapshot, p.name, p.count, (p.img || '').replace(/^https?:\/\/[^/]+/, ''), p.public, p.collab].join('|')).join('\n');
    // Ask for the first page only. If it matches the saved list and the count is the same,
    // the rest is very likely unchanged too, so it isn't asked for (a full check still runs
    // at least every 6 hours, and whenever you press refresh).
    const j1 = await api('/me/playlists?limit=50');
    let fresh = j1.items.filter(Boolean).map(mapPlaylist);
    const fullDue = full || Date.now() - LS.get('plFullAt', 0) > 6 * 3600000;
    // (Spotify's total also counts entries it can't show, so compare with the total it gave last time)
    const same = !fullDue && j1.total === LS.get('plTotal', -1) && sig(fresh) === sig(S.playlists.slice(0, fresh.length));
    if (same) fresh = fresh.concat(S.playlists.slice(fresh.length).map(p => ({ ...p })));
    else {
      let url = j1.next, n = 1;
      while (url && n++ < 20) { const j = await api(url, { bulk: true }); fresh.push(...j.items.filter(Boolean).map(mapPlaylist)); url = j.next; }
      LS.set('plFullAt', Date.now()); LS.set('plTotal', j1.total);
    }
    LS.set('playlistsCacheAt', Date.now());
    if (first || sig(fresh) !== sig(S.playlists)) {
      const old = new Map(S.playlists.map(p => [p.id, p]));
      // keep details only Soranix knows (like an edited description) for playlists that still exist
      S.playlists = fresh.map(p => (old.has(p.id) ? Object.assign(old.get(p.id), p) : p));
      savePlaylistList();
      renderTree();
      // the playlist you're looking at was deleted somewhere else
      if (L.view?.node?.startsWith('pl:') && !S.playlists.some(p => 'pl:' + p.id === L.view.node)) openNode('liked');
    }
  })().finally(() => { syncing = null; }));
}
/* library header: + (new playlist) and filter chips, like a modern player's sidebar */
const CHIPS = [['playlists', 'Playlists'], ['podcasts', 'Podcasts'], ['albums', 'Albums'], ['artists', 'Artists']];
const LIBX = { filter: null, albums: null, artists: null, shows: null, err: {} };
function renderTreeHead() {
  if (YT.on) return ytTreeHead();
  $('#treehead').innerHTML =
    `<div class="th-top"><span class="th-title">Your Library</span>` +
    `<button class="btn sm th-plus" id="th-refresh" title="Refresh your playlists from Spotify">\u27F3</button>` +
    `<button class="btn sm th-plus" id="th-new" title="Create playlist">+</button></div>` +
    `<div class="chips">${LIBX.filter ? `<button class="btn sm chip x" data-chip="" title="Show everything">×</button>` : ''}` +
    CHIPS.filter(([k]) => !LIBX.filter || LIBX.filter === k)
      .map(([k, n]) => `<button class="btn sm chip${LIBX.filter === k ? ' on' : ''}" data-chip="${k}">${n}</button>`).join('') +
    (LIBX.filter === 'playlists' ? `<button class="btn sm chip sub${LIBX.byYou ? ' on' : ''}" id="chip-byyou">By you</button>` : '') +
    (LIBX.filter === 'playlists' && LIBX.byYou ? `<button class="btn sm chip sub${LS.get('plSort', '') ? ' on' : ''}" id="chip-sort" title="Click to change the order">\u21C5 ${(PL_SORTS.find(([k]) => k === LS.get('plSort', '')) || PL_SORTS[0])[1]}</button>` : '') + '</div>';
  $$('#treehead .chip[data-chip]').forEach(b => b.onclick = () => { LIBX.byYou = false; setFilter(b.dataset.chip && b.dataset.chip !== LIBX.filter ? b.dataset.chip : null); });
  const by = $('#chip-byyou');
  if (by) by.onclick = () => { LIBX.byYou = !LIBX.byYou; renderTreeHead(); renderTree(); };
  const so = $('#chip-sort');
  if (so) so.onclick = () => {
    const i = PL_SORTS.findIndex(([k]) => k === LS.get('plSort', ''));
    const next = PL_SORTS[(i + 1) % PL_SORTS.length][0];
    LS.set('plSort', next); renderTreeHead(); renderTree();
    if (next) seedPlayCounts();
  };
  $('#th-new').onclick = createPlaylist;
  $('#th-refresh').onclick = refreshPlaylistsNow;
}
const LIBKEY = { albums: 'albums', artists: 'artists', podcasts: 'shows' };
async function setFilter(f) {
  LIBX.filter = f; renderTreeHead(); renderTree();
  const load = { albums: loadSavedAlbums, artists: loadFollowed, podcasts: loadShows }[f];
  if (load && LIBX[LIBKEY[f]] == null) { await load(); renderTree(); }
}
async function loadAll(url, pick, map, key) {
  const out = []; let n = 0;
  try {
    while (url && n++ < 10) { const j = pick(await api(url)); out.push(...(j.items || []).map(map).filter(Boolean)); url = j.next; }
    LIBX.err[key] = null;
  } catch (e) { LIBX.err[key] = e; }
  return out;
}
/* saved albums, followed artists and podcasts are kept on this PC for 6 hours
   (the refresh button or your own changes fetch them again sooner) */
const LIB_KEEP = 6 * 3600000;
async function loadLib(key, url, pick, map) {
  const c = await DB.get('lib:' + key);
  if (c && Date.now() - c.at < LIB_KEEP) { LIBX.err[key] = null; return c.rows; }
  const rows = await loadAll(url, pick, map, key);
  if (!LIBX.err[key]) DB.set('lib:' + key, { at: Date.now(), rows });
  return rows;
}
const loadSavedAlbums = async () => { LIBX.albums = await loadLib('albums', '/me/albums?limit=50', j => j, it => mapAlbum(it.album)); };
const loadFollowed = async () => { LIBX.artists = await loadLib('artists', '/me/following?type=artist&limit=50', j => j.artists, mapArtist); };
const loadShows = async () => { LIBX.shows = await loadLib('shows', '/me/shows?limit=50', j => j, it => mapShow(it.show)); };
const mapShow = s => s && { type: 'show', uri: s.uri, id: s.id, name: s.name, owner: s.publisher || '', img: s.images?.at(-1)?.url, imgLarge: (s.images?.[1] || s.images?.[0])?.url, count: s.total_episodes ?? '' };
const mapEpisode = (e, show) => e && e.uri ? { type: 'track', uri: e.uri, id: e.id, name: e.name, artist: show?.name || e.show?.name || '', album: e.release_date || '', dur: e.duration_ms, episode: true } : null;
async function createPlaylist() {
  if (!S.me) return;
  const name = await winPrompt('Name for the new playlist:', 'My Soranix playlist', { title: 'CREATE PLAYLIST', ok: 'Create' });
  if (!name) return;
  act('Create playlist', async () => {
    const p = mapPlaylist(await api('/me/playlists', { method: 'POST', body: { name, public: false, description: 'Made with Soranix' } }));
    S.playlists.unshift(p); renderTree(); openPlaylist(p); showMsg('CREATED ' + name.toUpperCase(), 2000); setTimeout(() => syncPlaylists().catch(() => {}), 3000);
  });
}
function filteredNodes() {
  const f = LIBX.filter;
  const list = (key, items, prefix) => {
    const e = LIBX.err[key];
    if (e) return [[e.status === 403 ? 'reconnect' : 'retry:' + key, e.status === 403 ? 'Click to give Soranix permission' : 'Could not load (click to retry)']];
    if (items == null) return [['none', 'Loading...']];
    if (!items.length) return [['none', 'Nothing saved yet']];
    return items.map(x => [prefix + x.id, x.name, 0]);
  };
  const count = a => (a?.length ? ` (${a.length})` : '');
  if (f === 'playlists') {
    const pls = LIBX.byYou ? S.playlists.filter(p => p.ownerId === S.me?.id) : S.playlists;
    return [['grp', (LIBX.byYou ? 'Made by you' : 'Playlists') + count(pls)],
      ...(pls.length ? pinFirst(LIBX.byYou ? sortByListening(pls) : pls).map(p => ['pl:' + p.id, pinLabel(p)]) : [['none', LIBX.byYou ? 'No playlists made by you yet' : 'No playlists yet']])];
  }
  if (f === 'albums') return [['grp', 'Saved albums' + count(LIBX.albums)], ...list('albums', LIBX.albums, 'al:')];
  if (f === 'artists') return [['grp', 'Artists you follow' + count(LIBX.artists)], ...list('artists', LIBX.artists, 'ar:')];
  if (f === 'podcasts') return [['grp', 'Your podcasts' + count(LIBX.shows)], ...list('shows', LIBX.shows, 'sh:')];
  return null;
}
function renderTree() {
  if (YT.on) return ytRenderTree();
  const nodes = filteredNodes() || [
    ['grp', 'Find music'], ['search', 'Search Spotify'], ['discover', 'Discover new music'], ['pdiscover', 'Discover podcasts'],
    ['grp', 'Your library'], ['liked', 'Liked Songs'], ['recent', 'Recently Played'], ['toptracks', 'Your Top Songs'], ['topartists', 'Your Top Artists'], ['savedalbums', 'Saved Albums'],
    ['grp', 'Playlists' + (S.playlists.length ? ` (${S.playlists.length})` : '')],
    ...pinFirst(S.playlists).map(p => ['pl:' + p.id, pinLabel(p), 1]),
    ['plrefresh', playlistsStatus(), 1],
    ['grp', 'Account'], ['logout', 'Log out' + (S.me ? ' (' + (S.me.display_name || S.me.id) + ')' : '')],
  ];
  $('#tree').innerHTML = nodes.map(([id, label, lvl]) => id === 'grp'
    ? `<div class="node grp">${esc(label)}</div>` : id === 'none' ? `<div class="node grp dim">${esc(label)}</div>`
    : `<div class="node${L.node === id ? ' sel' : ''}" data-id="${esc(id)}" style="--lvl:${lvl || 0}" title="${esc(label)}">${esc(label)}</div>`).join('');
}

/* views */
function setView(v, push = true) {
  if (!v.tabs && !v.filter && $('#q')) $('#q').value = ''; // new list: start with an empty search box
  if (push && L.view) { L.history.push(L.view); L.fwd = []; }
  if (L.history.length > 30) L.history.shift();
  L.view = v; L.sel.clear(); L.anchor = -1;
  if (v.node) { L.node = v.node; renderTree(); }
  renderView();
}
function renderView() {
  const v = L.view;
  $('#lib-back').disabled = !L.history.length;
  // (a view can bring its own filter buttons: YouTube Music's All / Songs / Videos...)
  $('#tabs').innerHTML = v.tabs ? v.tabs.map(([k, label]) => `<button class="btn sm${(v.tabKey ?? L.tab) === k ? ' on' : ''}" data-tab="${k}">${label}</button>`).join('') : '';
  $$('#tabs button').forEach(b => b.onclick = () => {
    if (v.onTab) { v.tabKey = b.dataset.tab; return v.onTab(b.dataset.tab); }
    L.tab = b.dataset.tab; runSearch(L.q, false);
  });
  $('#viewhead').innerHTML = (v.img ? `<img src="${esc(v.img)}" alt="">` : '') +
    `<div>${esc(v.title || '')}${v.sub ? `<div class="sub">${esc(v.sub)}</div>` : ''}</div>` +
    (v.actions || []).map((a, i) => `<button class="btn sm" data-a="${i}">${esc(a[0])}</button>`).join('') +
    `<button class="btn sm yellow lyr-btn" id="lyr-open" title="Cover art and lyrics for the playing song">Now Playing</button>`;
  $$('#viewhead button[data-a]').forEach(b => b.onclick = () => v.actions[+b.dataset.a][1]());
  $('#lyr-open').onclick = () => toggleLyrics();
  // a grid of covers instead of the table (YouTube Music's Discover)
  const cardsMode = v.kind === 'cards';
  if (!cardsMode) $('#lib-newmix').style.display = 'none';
  $('#grid').style.display = cardsMode ? 'none' : '';
  let cards = $('#cards');
  if (!cards) { cards = document.createElement('div'); cards.id = 'cards'; cards.className = 'ytcards'; $('.tablewrap').appendChild(cards); }
  cards.style.display = cardsMode ? '' : 'none';
  if (cardsMode) {
    cards.innerHTML = v.loading ? '<div class="cards-msg">Loading...</div>' : !v.rows.length ? `<div class="cards-msg">${esc(v.empty || 'Nothing here.')}</div>`
      : v.rows.map((r, i) => {
        const wide = r.type === 'track' && r.mvt && r.mvt !== 'MUSIC_VIDEO_TYPE_ATV';   // videos: 16:9
        const sub = r.type === 'track' ? r.artist : r.artist || r.owner || r.genres || '';
        return `<div class="ytcard${wide ? ' wide' : ''}" data-i="${i}"${r.type === 'track' ? ' draggable="true"' : ''} title="${esc(r.name)}${sub ? ' - ' + esc(sub) : ''}">` +
          `<div class="art">${r.imgLarge || r.img ? `<img src="${esc(r.imgLarge || r.img)}" alt="" loading="lazy">` : ''}</div>` +
          `<div class="t">${esc(r.name)}</div><div class="s">${esc(sub)}</div></div>`;
      }).join('');
    cards.onclick = e => { const c = e.target.closest('.ytcard'); if (c) (YT.on ? ytCardClick : activateRow)(+c.dataset.i); };
    if (cards.dataset.tab !== String(v.tabKey) || cards.dataset.node !== v.node) cards.scrollTop = 0;   // (More keeps your place)
    cards.dataset.tab = String(v.tabKey); cards.dataset.node = v.node;
    $('#lib-more').disabled = !v.canMore?.();
    // Spotify's Discover: New mix sits next to More
    $('#lib-newmix').style.display = v.newMix ? '' : 'none';
    $('#lib-newmix').disabled = !!v.loading;
    $('#q').placeholder = 'Search songs, artists, albums, playlists...'; $('#b-search').textContent = 'Search';
    libStatus(v.loading ? '' : `${v.rows.length} item${v.rows.length === 1 ? '' : 's'}`);
    return;
  }
  const cols = COLS[v.kind] || COLS.track;
  $('#grid thead').innerHTML = '<tr>' + cols.map(([h, cls], i) => `<th class="${cls}">${h}${i < cols.length - 1 ? '<span class="colrz" title="Drag to resize"></span>' : ''}</th>`).join('') + '</tr>';
  applyColWidths(v.kind);
  const body = $('#grid tbody');
  if (v.loading) body.innerHTML = `<tr class="msg"><td colspan="${cols.length}">Loading...</td></tr>`;
  else if (!v.rows.length) body.innerHTML = `<tr class="msg"><td colspan="${cols.length}">${esc(v.empty || 'Nothing here.')}</td></tr>`;
  // (songs of a mixed playlist: green for Spotify, red for YouTube Music)
  else body.innerHTML = v.rows.map((r, i) => `<tr data-i="${i}"${r.type === 'track' ? ' draggable="true"' : ''} class="${r.uri && S.track?.uri === r.uri ? 'cur' : ''}${r.mix ? ' svc-' + svcOfRow(r) : ''}">` +
    cols.map(([, cls, f]) => `<td class="${cls}" title="${esc(f(r, i))}">` +
      // each song's cover next to its number (the address comes with the list: no extra requests)
      (cls === 'num' && r.img && rowArt() ? `<img class="rowart" src="${esc(r.img)}" alt="" loading="lazy">` : '') +
      `${esc(f(r, i))}</td>`).join('') + '</tr>').join('');
  $('#lib-more').disabled = !v.next;
  $('#q').placeholder = listSearchable(v) ? `Search in ${v.title}...` : 'Search songs, artists, albums, playlists...';
  $('#b-search').textContent = listSearchable(v) ? 'Find' : 'Search';
  libStatus(v.loading ? '' : v.filter != null && v.filter !== ''
    ? `${v.rows.length} of ${v.all.length} songs match "${v.filter}"  (Esc clears)`
    : `${v.rows.length} item${v.rows.length === 1 ? '' : 's'}${v.next ? ' (more available)' : ''}${v.savedAt ? '  \u00B7  saved copy, ' + ago(v.savedAt) : ''}`);
}
function markLibCurrent() {
  if (!L.view) return;
  $$('#grid tbody tr[data-i]').forEach(tr => tr.classList.toggle('cur', L.view.rows[+tr.dataset.i]?.uri === S.track?.uri));
}
async function loadPaged(v, url, map, pick = j => j) {
  setView({ ...v, rows: [], loading: true, map, pick });
  const view = L.view;
  try {
    const j = pick(await api(url, { cache: v.cache }));
    view.rows = (j.items || []).map((it, i) => map(it, (j.offset || 0) + i)).filter(Boolean); view.next = j.next;
  } catch (e) { view.rows = []; view.empty = 'Error: ' + e.message; }
  view.loading = false;
  if (L.view === view) renderView();
}
/* Liked Songs: shown from the saved copy when it's under 30 minutes old (the whole list, or its
   first page), so opening it, also right after Soranix (re)starts, costs no request. Liking or
   unliking a song in Soranix updates the whole copy and drops the first-page one. */
/* Settings > Song covers in the library lists: on by default (they cost no requests) */
const rowArt = () => LS.get('rowArt', true);
function setRowArt(on) {
  LS.set('rowArt', on);
  document.documentElement.classList.toggle('no-rowart', !on);
  if (L.view) renderView();
  showMsg(on ? 'SONG COVERS: ON' : 'SONG COVERS: OFF', 1500);
}
if (!rowArt()) document.documentElement.classList.add('no-rowart');
async function openLiked() {
  const base = { node: 'liked', kind: 'track', title: 'Liked Songs' }, map = it => mapTrack(it.track), pick = j => j;
  const full = await DB.get('liked'), first = await DB.get('liked1'), fresh = c => c?.rows?.length && Date.now() - c.at < PL_REFRESH;
  if (fresh(full)) return setView({ ...base, rows: full.rows.slice(), next: null, map, pick, savedAt: full.at });
  if (fresh(first)) return setView({ ...base, rows: first.rows.slice(), next: first.next, map, pick, savedAt: first.at });
  await loadPaged(base, '/me/tracks?limit=50', map);
  const v = L.view;
  if (v?.node === 'liked' && v.rows.length) DB.set('liked1', { at: Date.now(), rows: v.rows, next: v.next || null });
}
async function loadMore() {
  if (L.view?.onMore) return L.view.onMore();   // YouTube Music's Discover: more of the selected section
  const v = L.view; if (!v?.next) return;
  $('#lib-more').disabled = true;
  try { const j = v.pick(await api(v.next, { cache: v.cache })); v.rows.push(...(j.items || []).map((it, i) => v.map(it, (j.offset || 0) + i)).filter(Boolean)); v.next = j.next; if (v.node?.startsWith('pl:')) savePlaylistPart(v); }
  catch (e) { libStatus('Error: ' + e.message); }
  if (L.view === v) renderView();
}

async function openNode(id) {
  if (id === 'mixnew') { const l = await mixNew(); if (l) mixOpen(l.id); return; }
  if (id.startsWith('mix:')) { L.node = id; renderTree(); return mixOpen(id.slice(4)); }
  if (YT.on) return ytOpenNode(id);
  if (id === 'logout') { if (await winConfirm('Log out of Spotify in Soranix?', { title: 'LOG OUT', ok: 'Log out' })) logout('Logged out.'); return; }
  L.node = id; renderTree();
  if (id === 'search') {
    $('#q').focus();
    return setView({ node: id, kind: 'track', title: 'Search Spotify', sub: 'Type in the box above and press Enter.', rows: [], empty: 'Search for any song, artist, album or playlist.' });
  }
  if (id === 'liked') return openLiked();
  if (id === 'recent') return loadPaged({ node: id, kind: 'track', title: 'Recently Played' }, '/me/player/recently-played?limit=50', it => mapTrack(it.track));
  if (id === 'savedalbums') return loadPaged({ node: id, kind: 'album', title: 'Saved Albums' }, '/me/albums?limit=50', it => mapAlbum(it.album));
  if (id.startsWith('toptracks')) return openTop('tracks', id.split(':')[1] || 'medium_term');
  if (id.startsWith('topartists')) return openTop('artists', id.split(':')[1] || 'medium_term');
  if (id === 'discover') return openDiscover();
  if (id === 'pdiscover') return openPodDiscover();
  if (id === 'plrefresh') return refreshPlaylistsNow();
  if (id === 'reconnect') { if (await askReconnect()) login(); return; }
  if (id.startsWith('retry:')) { const k = id.slice(6); LIBX[k] = null; return setFilter(k === 'shows' ? 'podcasts' : k); }
  if (id.startsWith('al:')) return openAlbum(LIBX.albums.find(a => a.id === id.slice(3)), id);
  if (id.startsWith('ar:')) return openArtist(LIBX.artists.find(a => a.id === id.slice(3)), id);
  if (id.startsWith('sh:')) return openShow(LIBX.shows.find(a => a.id === id.slice(3)), id);
  if (id.startsWith('pl:')) return openPlaylist(S.playlists.find(p => p.id === id.slice(3)) || { id: id.slice(3), name: 'Playlist' });
}
function openTop(type, range) {
  const node = type === 'tracks' ? 'toptracks' : 'topartists';
  const names = { short_term: 'last 4 weeks', medium_term: 'last 6 months', long_term: 'all time' };
  return loadPaged({
    node, kind: type === 'tracks' ? 'track' : 'artist', title: 'Your Top ' + (type === 'tracks' ? 'Songs' : 'Artists'), sub: names[range], cache: DAY,
    actions: Object.entries(names).map(([k, n]) => [n, () => openTop(type, k)]),
  }, `/me/top/${type}?limit=50&time_range=${range}`, type === 'tracks' ? t => mapTrack(t) : mapArtist);
}
function openShow(sh, node) {
  return loadPaged({ node, kind: 'track', title: sh.name, sub: sh.owner, img: sh.img },
    `/shows/${sh.id}/episodes?limit=50`, e => mapEpisode(e, sh));
}
function openPlaylist(p) {
  const mine = S.me && (p.ownerId === S.me.id || p.collab);
  if (!mine) {
    return setView({
      node: 'pl:' + p.id, kind: 'track', title: p.name, sub: 'by ' + (p.owner || 'someone else'), img: p.img, ctx: p.uri, rows: [],
      empty: "Spotify only lets apps list the songs of playlists you made or collaborate on. You can still press Play to hear this one.",
    });
  }
  return openOwnPlaylist(p);
}
async function openOwnPlaylist(p) {
  const node = 'pl:' + p.id;
  const mapItem = (it, pos) => { const r = mapTrack(it.item || it.track, { ctx: p.uri }); if (r) r.pos = pos; return r; };
  const base = { node, kind: 'track', title: p.name, sub: 'by ' + p.owner, img: p.img, ctx: p.uri };
  const c = await DB.get(node);
  if (c && p.snapshot && c.snapshot === p.snapshot) {
    // nothing changed on Spotify since we saved it: no requests at all (More continues where the saved part ends)
    return setView({ ...base, rows: c.rows.slice(), next: c.next || null, map: mapItem, pick: j => j, savedAt: c.at });
  }
  // Only the first page is downloaded; more pages come when you ask for them (More, or searching
  // inside the playlist), and every page you've seen is saved with Spotify's version stamp.
  await loadPaged(base, `/playlists/${p.id}/items?limit=50`, mapItem);
  const v = L.view; if (v?.node !== node || !v.rows.length) return;
  savePlaylistPart(v);
}
/* save what's loaded of a playlist (all of it, or the first pages plus where to continue) */
function savePlaylistPart(v) {
  const p = plById(v.node.slice(3)); if (!p?.snapshot || v.filter) return;
  DB.set(v.node, { snapshot: p.snapshot, at: Date.now(), rows: v.all || v.rows, next: v.next || null });
}
async function openArtist(a, node) {
  setView({
    node, kind: 'album', title: a.name, sub: a.genres || 'Albums and singles', img: a.img, rows: [], loading: true,
    actions: [['Search their songs', () => { $('#q').value = `artist:"${a.name}"`; L.tab = 'track'; runSearch($('#q').value); }]],
  });
  const view = L.view;
  try {
    const d = await artistReleases(a);
    view.rows = d.rows.slice();
    if (d.viaSearch) view.sub = 'Albums and singles (found through Search while Spotify limits artist pages)';
    if (!view.rows.length) view.empty = 'No albums found.';
  } catch (e) { view.rows = []; view.empty = 'Error: ' + e.message; }
  view.loading = false;
  if (L.view === view) renderView();
}
/* An artist's profile (name, picture, link), kept on this PC for a week. When Spotify limits
   artist pages, the same profile is found through Search by the artist's name. */
async function artistProfile(id) {
  const c = await DB.get('artist:' + id);
  if (c && Date.now() - c.at < 7 * 864e5) return c.a;
  const viaSearch = async () => {
    const name = knownArtistName(id);
    if (!name) throw new Error('Spotify is limiting artist pages right now. Try again later.');
    const j = await api(`/search?q=${encodeURIComponent(`artist:"${name}"`)}&type=artist&limit=10`);
    const hit = (j?.artists?.items || []).find(x => x.id === id);
    if (!hit) throw new Error('Spotify is limiting artist pages right now. Try again later.');
    return hit;
  };
  let a;
  if (pausedFor('/artists/' + id) > 0 || overBudget('/artists/x')) a = await viaSearch();
  else { try { a = await api('/artists/' + id); } catch (e) { if (e.status === 429) a = await viaSearch(); else throw e; } }
  const keep = { id: a.id, name: a.name, uri: a.uri, images: a.images, genres: a.genres };
  DB.set('artist:' + id, { at: Date.now(), a: keep });
  return keep;
}
/* the artist's name from anything already on screen or saved, so it can be searched */
function knownArtistName(id) {
  const uri = 'spotify:artist:' + id;
  for (const list of [[S.track], S.pl, S.lib, L.view?.rows, LIBX.artists, UPN.items, QU.items]) {
    for (const r of list || []) {
      if (!r) continue;
      if (r.type === 'artist' && r.id === id) return r.name;
      const hit = (r.artists || []).find(x => x.id === id || x.uri === uri);
      if (hit) return hit.name;
    }
  }
  return null;
}
async function isFollowing(a) {
  const list = LIBX.artists || (await DB.get('lib:artists'))?.rows;
  if (list && list.length < 500) return list.some(x => x.id === a.id);
  const c = await DB.get('follow:' + a.id);   // asked before (kept a day)
  if (c && Date.now() - c.at < 864e5) return c.on;
  const on = await isLiked([a.uri]);
  if (on != null) DB.set('follow:' + a.id, { at: Date.now(), on });
  return on;
}
/* An artist's albums and singles, shared by the library and the artist window and kept on this
   PC for 3 days. If Spotify has paused its artist-albums list (it has a quota), the same
   releases are found through Search instead, which Spotify counts separately. */
async function artistReleases(a) {
  const key = 'disc:' + a.id;
  const c = await DB.get(key);
  if (c && (c.until ? Date.now() < c.until : Date.now() - c.at < 7 * 864e5)) return c;
  const viaSearch = async () => {
    const rows = [], seen = new Set();
    for (const off of [0, 10, 20]) {
      const j = await api(`/search?q=${encodeURIComponent(`artist:"${a.name}"`)}&type=album&limit=10&offset=${off}`, { bulk: off > 0 });
      const items = j?.albums?.items || [];
      items.filter(x => x && x.artists?.some(r => r.id === a.id) && !seen.has(x.id) && seen.add(x.id)).forEach(x => rows.push(mapAlbum(x)));
      if (items.length < 10) break;
    }
    rows.sort((x, y) => (y.year || '').localeCompare(x.year || ''));
    // kept only until Spotify's pause ends, then the full list is fetched
    const d = { at: Date.now(), until: Date.now() + Math.max(pausedFor(`/artists/${a.id}/albums`), 10 * 60000), rows, total: rows.length, viaSearch: true };
    DB.set(key, d);
    return d;
  };
  // blocked, or close to the point where Spotify would block: use Search instead
  if (pausedFor(`/artists/${a.id}/albums`) > 0 || overBudget('/artists/x/albums')) return viaSearch();
  try {
    const rows = []; let total = 0, n = 0;
    let url = `/artists/${a.id}/albums?include_groups=album,single,compilation&limit=50`;
    while (url && n++ < 2) { const j = await api(url, { bulk: n > 1 }); total = j.total ?? total; rows.push(...(j.items || []).map(mapAlbum).filter(Boolean)); url = j.next; }
    const d = { at: Date.now(), rows, total: total || rows.length };
    DB.set(key, d);
    return d;
  } catch (e) {
    if (e.status === 429) return viaSearch();
    throw e;
  }
}
function openAlbum(a, node) {
  // an album's songs never change after release: downloaded once, then kept
  return loadPaged({ node, kind: 'track', title: a.name, sub: [a.artist, a.year].filter(Boolean).join(' - '), img: a.img, ctx: a.uri, cache: 90 * DAY },
    `/albums/${a.id}/tracks?limit=50`, t => mapTrack(t, { album: a.name, albumId: a.id, ctx: a.uri, img: a.img }));
}
function runSearch(q, push = true) {
  q = (q || '').trim(); if (!q) return;
  L.q = q; L.node = 'search'; renderTree();
  const types = { track: 'Songs', artist: 'Artists', album: 'Albums', playlist: 'Playlists', show: 'Podcasts' };
  if (!types[L.tab]) L.tab = 'track';
  const map = { track: t => mapTrack(t), artist: mapArtist, album: mapAlbum, playlist: mapPlaylist, show: mapShow }[L.tab];
  if (!push && L.view) L.view = null;
  return loadPaged({
    kind: L.tab, title: `Search: ${q}`, sub: types[L.tab], tabs: Object.entries(types), cache: DAY,
  }, `/search?q=${encodeURIComponent(q)}&type=${L.tab}&limit=10${L.tab === 'show' ? '&market=from_token' : ''}`, map, j => j[L.tab + 's'] || { items: [] });
}
/* Discover new music: shown as a grid of covers. The last mix is kept, so opening it again (and
   at start, where it opens first) costs no requests; New mix makes a fresh one (4 searches). */
async function openDiscover(fresh = false) {
  const base = { node: 'discover', kind: 'cards', newMix: true, empty: 'Nothing found this time. Press New mix.' };
  const kept = !fresh && await DB.get('discoverMix');
  if (kept?.rows?.length) { setView({ ...base, title: kept.title, sub: kept.sub, rows: kept.rows.slice(), savedAt: kept.at }); return discoverMore(L.view, kept.more); }
  setView({ ...base, title: 'Discover new music', rows: [], loading: true });
  const view = L.view;
  const known = new Set(); let genres = [];
  // your top artists barely change: keep them for a day instead of asking every mix
  let top = await DB.get('topArtists');
  if (!top || Date.now() - top.at > 24 * 3600000) {
    try {
      const j = await api('/me/top/artists?limit=50&time_range=medium_term');
      top = { at: Date.now(), ids: j.items.map(a => a.id), genres: j.items.flatMap(a => a.genres || []) };
      DB.set('topArtists', top);
    } catch {}
  }
  if (top) { top.ids.forEach(id => known.add(id)); genres = top.genres.slice(); }
  const fallback = !genres.length;
  if (fallback) genres = ['indie', 'alternative', 'hip hop', 'electronic', 'r&b', 'soul', 'house', 'jazz', 'rock', 'afrobeats', 'lo-fi', 'funk'];
  const g = genres[Math.floor(Math.random() * genres.length)];
  const off = Math.floor(Math.random() * 60);
  const search = q => Promise.all([0, 10].map(o => api(`/search?q=${encodeURIComponent(q)}&type=track&limit=10&offset=${off + o}`).catch(() => null)));
  let q = `genre:"${g}"`;
  let pages = await search(q);
  let rows = pages.flatMap(p => p?.tracks?.items || []);
  if (!rows.length) { q = g; rows = (await search(g)).flatMap(p => p?.tracks?.items || []); }
  const seen = new Set();
  view.rows = rows.filter(t => t && !(t.artists || []).some(a => known.has(a.id)) && !seen.has(t.id) && seen.add(t.id)).map(t => mapTrack(t)).filter(Boolean);
  view.title = 'Discover: ' + g;
  view.sub = (fallback ? 'A random genre' : 'A genre from artists you like') + ', with your top artists filtered out.';
  const more = { q, next: off + 20, done: !rows.length };
  if (view.rows.length) DB.set('discoverMix', { at: Date.now(), title: view.title, sub: view.sub, rows: view.rows, more });
  view.loading = false;
  discoverMore(view, more);
  if (L.view === view) renderView();
}
/* Discover's More: the next 20 songs of the same search (2 requests, 10 songs each: Spotify's
   limit for apps like this), only when pressed. They're added to the kept mix, so they come
   back at the next start without asking again. Spotify's search goes up to 1,000 results. */
/* Discover podcasts: podcasts on Spotify as a grid of covers, a topic at a time (the buttons above).
   Spotify no longer lets apps browse its podcast categories, so each topic is a podcast search: 10
   podcasts per request, kept for 3 days (opening a topic again costs nothing); More adds the next 10.
   A podcast opens to its episodes. */
const POD_TOPICS = [['podcast', 'Popular'], ['comedy', 'Comedy'], ['true crime', 'True crime'], ['news', 'News'], ['sports', 'Sports'],
  ['business', 'Business'], ['health', 'Health'], ['technology', 'Technology'], ['culture', 'Society & culture'], ['history', 'History'],
  ['education', 'Education'], ['music', 'Music']];
async function openPodDiscover(topic = LS.get('podTopic', 'podcast'), push = true) {
  if (!POD_TOPICS.some(t => t[0] === topic)) topic = 'podcast';
  LS.set('podTopic', topic);
  const view = { node: 'pdiscover', kind: 'cards', title: 'Discover podcasts', sub: 'Podcasts on Spotify: ' + POD_TOPICS.find(t => t[0] === topic)[1],
    rows: [], loading: true, tabs: POD_TOPICS, tabKey: topic, onTab: k => openPodDiscover(k, false), empty: 'No podcasts found here right now.' };
  setView(view, push);
  const more = { next: 0, done: false, busy: false };
  const load = async () => {
    const j = await api(`/search?q=${encodeURIComponent(topic)}&type=show&market=from_token&limit=10&offset=${more.next}`, { cache: 3 * DAY });
    const items = (j?.shows?.items || []).filter(Boolean);
    more.next += 10;
    if (!j?.shows?.next || !items.length) more.done = true;
    const seen = new Set(view.rows.map(r => r.id));
    view.rows.push(...items.map(mapShow).filter(s => s && !seen.has(s.id) && seen.add(s.id)));
  };
  try { await load(); } catch (e) { view.empty = 'Could not load podcasts: ' + e.message; }
  view.loading = false;
  view.canMore = () => !more.done && !more.busy && more.next < 200;
  view.onMore = async () => {
    if (!view.canMore()) return;
    more.busy = true; renderView(); libStatus('Loading more podcasts...');
    try { await load(); libStatus(''); } catch (e) { libStatus('Could not load more: ' + e.message); }
    more.busy = false;
    if (L.view === view) renderView();
  };
  if (L.view === view) renderView();
}
function discoverMore(view, more) {
  if (!more?.q) return;
  view.canMore = () => !more.done && !more.busy && more.next < 1000;
  view.onMore = async () => {
    if (!view.canMore()) return;
    more.busy = true; renderView(); libStatus('Loading more...');
    try {
      const top = await DB.get('topArtists'), known = new Set(top?.ids || []);
      const pages = await Promise.all([0, 10].map(o => api(`/search?q=${encodeURIComponent(more.q)}&type=track&limit=10&offset=${more.next + o}`).catch(() => null)));
      const found = pages.flatMap(p => p?.tracks?.items || []);
      more.next += 20;
      const seen = new Set(view.rows.map(r => r.id)), before = view.rows.length;
      view.rows.push(...found.filter(t => t && !(t.artists || []).some(a => known.has(a.id)) && !seen.has(t.id) && seen.add(t.id)).map(t => mapTrack(t)).filter(Boolean));
      if (!found.length) more.done = true;
      if (view.rows.length > before) DB.set('discoverMix', { at: Date.now(), title: view.title, sub: view.sub, rows: view.rows, more: { q: more.q, next: more.next, done: more.done } });
    } catch (e) { libStatus('Could not load more: ' + e.message); }
    more.busy = false;
    if (L.view === view) renderView();
  };
}
function activateRow(i) {
  const r = L.view.rows[i];
  if (YT.on && r.type !== 'track') return ytOpenItem(r);   // a YouTube Music album, artist or playlist
  if (r.type === 'track') {
    // a song from Search: play it, then a mix of similar music instead of the other results
    if (!YT.on && L.view.tabs && L.view.title?.startsWith('Search') && radioEnabled()) return playWithRadio(r);
    const tracks = L.view.rows.filter(x => x.type === 'track');
    playList(tracks, tracks.indexOf(r));
  } else if (r.type === 'artist') openArtist(r);
  else if (r.type === 'album') openAlbum(r);
  else if (r.type === 'playlist') openPlaylist(r);
  else if (r.type === 'show') openShow(r, L.node);
}
async function tracksOf(r) {
  if (r.type === 'track') return [r];
  const all = []; let url, map;
  if (r.type === 'album') { url = `/albums/${r.id}/tracks?limit=50`; map = t => mapTrack(t, { album: r.name, ctx: r.uri }); }
  else if (r.type === 'playlist' && S.me && (r.ownerId === S.me.id || r.collab)) {
    // saved copy still matches Spotify's version stamp: no requests needed
    const snap = plById(r.id)?.snapshot || r.snapshot, c = await DB.get('pl:' + r.id);
    if (c && snap && c.snapshot === snap && !c.next) return c.rows.slice();
    url = `/playlists/${r.id}/items?limit=50`; map = (it, pos) => { const t = mapTrack(it.item || it.track, { ctx: r.uri }); if (t) t.pos = pos; return t; };
  }
  else return [];
  let n = 0;
  while (url && n++ < 20) { const j = await api(url, { bulk: n > 1, cache: r.type === 'album' ? 90 * DAY : 0 }); all.push(...j.items.map((it, i) => map(it, (j.offset || 0) + i)).filter(Boolean)); url = j.next; }
  const snap = r.type === 'playlist' && (plById(r.id)?.snapshot || r.snapshot);
  if (!url && snap) DB.set('pl:' + r.id, { snapshot: snap, at: Date.now(), rows: all });
  return all;
}
async function libSend(replace) {
  const v = L.view; if (!v) return;
  const picked = L.sel.size ? [...L.sel].sort((a, b) => a - b).map(i => v.rows[i]) : v.rows;
  if (YT.on && picked.some(r => r.type !== 'track')) return ytOpenItem(picked.find(r => r.type !== 'track'));
  if (!picked.length) {
    if (replace && v.ctx) { showMsg('PLAYING ' + v.title.toUpperCase(), 2000); return playBody({ context_uri: v.ctx }); }
    return libStatus('Nothing to send.');
  }
  const containers = picked.filter(r => r.type !== 'track');
  if (containers.some(r => r.type === 'artist')) {
    if (picked.length === 1) return openArtist(picked[0]);
    return libStatus('Open an artist to pick their albums.');
  }
  if (replace && picked.length === 1 && picked[0].type === 'playlist' && !(picked[0].ownerId === S.me?.id || picked[0].collab)) {
    return playBody({ context_uri: picked[0].uri });
  }
  libStatus('Loading songs...');
  let tracks = [];
  try { for (const r of picked) tracks.push(...await tracksOf(r)); } catch (e) { return libStatus('Error: ' + e.message); }
  if (!tracks.length) return libStatus('No songs Spotify lets this app list there. Try Play instead.');
  const startAt = replace && L.sel.size === 1 && picked[0].type === 'track' ? v.rows.filter(x => x.type === 'track').indexOf(picked[0]) : 0;
  if (replace && L.sel.size === 1 && picked[0].type === 'track') tracks = v.rows.filter(x => x.type === 'track');
  if (replace) { libStatus(`Playing ${songs(tracks.length)}.`); return playList(tracks, startAt); }
  const n = plAdd(tracks, false);
  libStatus(`Added ${n} song${n === 1 ? '' : 's'} to the playlist window.`);
}

/* ------------------------------------------------------------------ windows */
const WINS = ['main', 'eq', 'pl', 'lib', 'lyr', 'art', 'md', 'qu', 'mx'];
let zTop = 10;
const winEl = k => $(`.win[data-win="${k}"]`);
const isShown = k => !winEl(k).classList.contains('hidden');
function showWin(k, on) {
  winEl(k).classList.toggle('hidden', !on);
  const vis = LS.get('shown', { eq: false, pl: false, lib: true }); vis[k] = on; LS.set('shown', vis);
  $('#tog-eq').classList.toggle('on', isShown('eq')); $('#tog-pl').classList.toggle('on', isShown('pl'));
  if (on) focusWin(winEl(k));
  reportPlayer();
}
function focusWin(el) {
  if (MINI.on && el.dataset.win !== 'main') toggleMini(false); // another window was opened: full player again
  $$('.win').forEach(w => w.classList.toggle('active', w === el)); el.style.zIndex = ++zTop;
}
function setZoom(z) {
  const old = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1;
  const k = z / old, m = winEl('main'), ax = m.offsetLeft, ay = m.offsetTop;
  // every window keeps its place relative to the player, scaled like the classic windows, so
  // windows docked to each other stay docked
  for (const key of WINS) {
    const w = winEl(key);
    w.style.left = Math.round(ax + (w.offsetLeft - ax) * k) + 'px';
    w.style.top = Math.round(ay + (w.offsetTop - ay) * k) + 'px';
  }
  document.documentElement.style.setProperty('--z', z); LS.set('zoom', z);
  savePos(); keepVisible(); updateClutter();
}
/* Size that maps one drawn pixel to exactly N screen pixels (crisp, no blur) on this monitor. */
const crispZoom = n => +(n / (window.devicePixelRatio || 1)).toFixed(4);
/* Monitors' usable areas in page coordinates. In the desktop app the page spans every
   monitor; in a browser it's just the page. */
function displays() {
  return S.displays?.length ? S.displays : [{ x: 0, y: 0, w: innerWidth, h: innerHeight, primary: true }];
}
const primaryDisplay = () => displays().find(d => d.primary) || displays()[0];
const displayOf = el => {
  const cx = el.offsetLeft + Math.min(el.offsetWidth / 2, 60), cy = el.offsetTop + 8;
  return displays().find(d => cx >= d.x && cx < d.x + d.w && cy >= d.y && cy < d.y + d.h) || null;
};
/* After a monitor is unplugged or rearranged, bring back any window whose title bar
   is no longer on a screen. */
function keepVisible() {
  let n = 0;
  for (const k of WINS) {
    const el = winEl(k);
    if (el.classList.contains('hidden') || displayOf(el)) continue;
    const d = primaryDisplay();
    el.style.left = d.x + 24 + n * 24 + 'px'; el.style.top = d.y + 24 + n * 24 + 'px'; n++;
  }
  if (n) savePos();
}
function layoutDefault() {
  const m = winEl('main'), e = winEl('eq'), p = winEl('pl'), l = winEl('lib');
  const d = primaryDisplay(), X = d.x + 16, Y = d.y + 16;
  const place = (el, x, y) => { el.style.left = x + 'px'; el.style.top = y + 'px'; };
  place(m, X, Y);
  place(e, X, Y + m.offsetHeight);
  place(p, X, Y + m.offsetHeight + (isShown('eq') ? e.offsetHeight : 0));
  place(l, Math.min(X + m.offsetWidth + 16, Math.max(X, d.x + d.w - l.offsetWidth - 16)), Y);
  placeLyrics();
  savePos();
}
/* Tell the desktop shell where the main player window is, so its taskbar / Alt-Tab window can
   sit under it and show its picture (just the player, never the EQ, playlist or others). */
function reportPlayer(dragging = false) {
  if (!window.desktop?.playerRect) return;
  const els = [winEl('main')];
  const rs = els.map(el => el.getBoundingClientRect());
  const L = Math.min(...rs.map(r => r.left)), T = Math.min(...rs.map(r => r.top));
  const R = Math.max(...rs.map(r => r.right)), B = Math.max(...rs.map(r => r.bottom));
  window.desktop.playerRect({ x: L, y: T, w: R - L, h: B - T, dragging });
}
/* Desktop app: tell the shell which parts of the screen Soranix actually covers (its visible
   windows, open menus, or everything while a dialog is up), so the see-through layer is shaped
   like the windows and screenshot tools / window pickers see what's behind everywhere else. */
let lastShape = '';
function reportShape() {
  if (!window.desktop?.layerShape) return;
  let rects;
  if ($('.dlg-back')) rects = [{ x: 0, y: 0, width: innerWidth, height: innerHeight }];
  else {
    const M = 10; // room for the soft shadow under each window
    rects = [...$$('.win:not(.hidden)'), ...$$('.menu'), ...$$('.svcfly')].map(el => {
      const r = el.getBoundingClientRect();
      const x = Math.max(0, Math.floor(r.left) - M), y = Math.max(0, Math.floor(r.top) - M);
      return { x, y, width: Math.ceil(r.right) + M - x, height: Math.ceil(r.bottom) + M - y };
    }).filter(r => r.width > 0 && r.height > 0);
  }
  const key = JSON.stringify(rects);
  if (key !== lastShape) { lastShape = key; window.desktop.layerShape(rects); }
}
// cheap check a few times a second (windows move, menus open, dialogs appear, sizes change)
if (window.desktop) setInterval(reportShape, 150);
function savePos() { LS.set('pos', Object.fromEntries(WINS.map(k => [k, [winEl(k).offsetLeft, winEl(k).offsetTop]]))); reportPlayer(); }
// the music service of this start, once chosen (windows reopened at start wait for it)
S.svcChosen = new Promise(r => { S.svcChosenNow = r; });
function setupWindows() {
  // (the monitor list arrives a moment after start: anything placed at start waits for it, or it
  // would land on the main monitor, the only one known until then)
  S.displaysReady = Promise.resolve();
  if (window.desktop?.getDisplays) {
    S.displaysReady = window.desktop.getDisplays().then(d => { S.displays = d; keepVisible(); reportPlayer(); }).catch(() => {});
    window.desktop.onDisplays(d => { S.displays = d; keepVisible(); reportPlayer(); });
    setTimeout(() => reportPlayer(), 800);
  }
  // desktop app: classic 1x size by default (the size you use); browser: fit the window
  // desktop app: crisp double size (every drawn pixel = 2x2 screen pixels, like the classic
  // player's double-size mode). One-time switch for anyone still on the older smooth size.
  if (window.desktop && !LS.get('crispV1')) { LS.set('crispV1', true); LS.set('zoom', crispZoom(2)); LS.del('pos'); }
  const z = LS.get('zoom', window.desktop ? crispZoom(2) : innerHeight >= 980 ? 2 : innerHeight >= 760 ? 1.5 : 1);
  document.documentElement.style.setProperty('--z', z);
  const vis = LS.get('shown', { eq: false, pl: false, lib: true });
  for (const k of ['eq', 'pl', 'lib']) winEl(k).classList.toggle('hidden', !vis[k]);
  $('#tog-eq').classList.toggle('on', isShown('eq')); $('#tog-pl').classList.toggle('on', isShown('pl'));
  const pos = LS.get('pos');
  if (pos) WINS.forEach(k => { const el = winEl(k); if (!pos[k]) return k === 'lyr' && requestAnimationFrame(placeLyrics); el.style.left = pos[k][0] + 'px'; el.style.top = pos[k][1] + 'px'; });
  else requestAnimationFrame(layoutDefault);
  focusWin(winEl('main'));
  setupResizing();
  restoreShades();
  if (LS.get('onTop', false)) window.desktop?.setOnTop?.(true);

  $$('.win').forEach(w => {
    w.addEventListener('pointerdown', () => focusWin(w));
    const title = $('.title', w);
    // double-click any title bar: roll the window up into just its title bar (and back)
    title.addEventListener('dblclick', e => { if (!e.target.closest('.tbtn')) toggleShade(w); });
    title.addEventListener('pointerdown', e => {
      if (e.target.closest('.tbtn') || e.button !== 0) return;
      e.preventDefault();
      const sx = e.clientX - w.offsetLeft, sy = e.clientY - w.offsetTop;
      // Dragging the main player by its title bar takes every window docked to it along
      // (touching edge to edge, directly or through another docked window), like the classic
      // player. Any other window moves on its own, which also undocks it.
      const group = w.dataset.win === 'main' ? dockedGroup(w) : [w];
      const offs = group.map(g => [g, g.offsetLeft - w.offsetLeft, g.offsetTop - w.offsetTop]);
      const bx0 = Math.min(...offs.map(o => o[1])), by0 = Math.min(...offs.map(o => o[2]));
      const BW = Math.max(...offs.map(([g, dx]) => dx + g.offsetWidth)) - bx0;
      const BH = Math.max(...offs.map(([g, , dy]) => dy + g.offsetHeight)) - by0;
      const others = $$('.win').filter(o => !group.includes(o) && !o.classList.contains('hidden'));
      const move = ev => {
        // snap the whole group's outline (just the window itself when it moves alone)
        let x = ev.clientX - sx + bx0, y = ev.clientY - sy + by0;
        const W = BW, H = BH, SN = 10;
        const xs = [], ys = [];
        // snap to the edges of every monitor, not just the main one
        for (const d of displays()) { xs.push(d.x, d.x + d.w - W); ys.push(d.y, d.y + d.h - H); }
        others.forEach(o => { const ox = o.offsetLeft, oy = o.offsetTop, ow = o.offsetWidth, oh = o.offsetHeight; xs.push(ox, ox + ow, ox - W, ox + ow - W); ys.push(oy, oy + oh, oy - H, oy + oh - H); });
        for (const c of xs) if (Math.abs(x - c) < SN) { x = c; break; }
        for (const c of ys) if (Math.abs(y - c) < SN) { y = c; break; }
        const mx = Math.round(x - bx0), my = Math.round(Math.max(0, y) - by0);
        for (const [g, dx, dy] of offs) { g.style.left = mx + dx + 'px'; g.style.top = my + dy + 'px'; }
        if (group.includes(winEl('main'))) reportPlayer(true);
        reportShape();
      };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); group.forEach(g => markMoved(g.dataset.win)); savePos(); keepVisible(); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
    $$('.tbtn', w).forEach(b => b.addEventListener('click', e => {
      const act = b.dataset.act, k = w.dataset.win;
      if (act === 'shade') toggleShade(w);
      else if (act === 'mini') toggleMini();
      else if (act === 'menu') mainMenu(e);
      else if (act === 'minimize') { if (window.desktop) window.desktop.minimize(); else w.classList.toggle('shaded'); }
      else if (act === 'close') {
        if (k !== 'main') showWin(k, false);
        else if (window.desktop) window.desktop.quit(); // closing the main window quits, like a classic player
        else ['eq', 'pl', 'lib'].forEach(x => showWin(x, false));
      }
    }));
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.menu')) closeMenus(); });
  document.addEventListener('contextmenu', e => { if (!e.target.closest('input')) e.preventDefault(); });
  addEventListener('blur', () => closeMenus());
}

/* ------------------------------------------------------------------ classic popup menus
   item: '-' | [label, fn] | { label, fn, key, sub: [...] | () => [...], disabled, check } */
let MENU = null; // { stack: [{ el, items }] }
const normItem = it => it === '-' ? it : Array.isArray(it) ? { label: it[0], fn: it[1] } : it;
function closeMenus(depth = 0) {
  if (!MENU) return;
  MENU.stack.splice(depth).forEach(m => m.el.remove());
  if (!depth) MENU = null;
}
function openMenu(e, items) {
  e.stopPropagation?.(); e.preventDefault?.();
  closeMenus();
  MENU = { stack: [] };
  if (YT.on) items = ytMenuItems(items);
  showMenuLevel(items, e.clientX, e.clientY, 0);
}
function showMenuLevel(items, x, y, depth, parentRect) {
  items = items.map(normItem);
  const el = document.createElement('div');
  el.className = 'menu';
  el.innerHTML = items.map((it, i) => it === '-' ? '<hr>' :
    `<div class="mi${it.disabled ? ' dis' : ''}${it.sub ? ' has-sub' : ''}" data-i="${i}">` +
    `<span class="ck">${it.check ? '✓' : ''}</span><span class="lb">${esc(it.label)}</span>` +
    `<span class="ky">${esc(it.key || '')}</span><span class="ar">${it.sub ? '▶' : ''}</span></div>`).join('');
  $('#desktop').appendChild(el);
  el.style.display = 'block';
  const W = el.offsetWidth, H = el.offsetHeight;
  if (parentRect) { x = parentRect.right - 3; y = parentRect.top - 3; if (x + W > innerWidth) x = parentRect.left - W + 3; }
  el.style.left = Math.max(2, Math.min(x, innerWidth - W - 2)) + 'px';
  el.style.top = Math.max(2, Math.min(y, innerHeight - H - 2)) + 'px';
  MENU.stack[depth] = { el, items };
  let hoverTimer = 0;
  el.addEventListener('mouseover', ev => {
    const d = ev.target.closest('.mi'); if (!d) return;
    $$('.mi.hot', el).forEach(n => n !== d && n.classList.remove('hot'));
    d.classList.add('hot');
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      closeMenus(depth + 1); MENU && (MENU.stack.length = depth + 1);
      const it = items[+d.dataset.i];
      if (it.sub && !it.disabled) openSub(it, d, depth);
    }, 120);
  });
  el.addEventListener('click', ev => {
    const d = ev.target.closest('.mi'); if (!d) return;
    const it = items[+d.dataset.i];
    if (it.disabled) return;
    if (it.sub) { closeMenus(depth + 1); MENU.stack.length = depth + 1; openSub(it, d, depth); return; }
    closeMenus(); it.fn?.();
  });
}
async function openSub(it, d, depth) {
  let sub = typeof it.sub === 'function' ? await it.sub() : it.sub;
  if (!MENU || !d.isConnected) return;
  if (!sub.length) sub = [{ label: '(empty)', disabled: true }];
  showMenuLevel(sub, 0, 0, depth + 1, d.getBoundingClientRect());
}
function menuKey(e) {
  if (!MENU) return false;
  if (e.key === 'Escape') { closeMenus(); return true; }
  const top = MENU.stack[MENU.stack.length - 1];
  const want = (e.altKey ? 'Alt ' : '') + (e.key.length === 1 ? e.key.toUpperCase() : e.key === 'Delete' ? 'Del' : e.key);
  const i = top.items.findIndex(it => it !== '-' && it.key && it.key.replace('+', ' ') === want && !it.disabled);
  if (i < 0) return true;
  const it = top.items[i];
  if (it.sub) { const d = $(`.mi[data-i="${i}"]`, top.el); closeMenus(MENU.stack.length); openSub(it, d, MENU.stack.length - 1); }
  else { closeMenus(); it.fn?.(); }
  return true;
}

/* ------------------------------------------------------------------ song actions (right-click) */
const NEED_SCOPE = 'Soranix needs one more permission from Spotify for this. Reconnect now? (You will come right back.)';
async function act(label, fn) {
  try { await fn(); }
  catch (e) {
    if (e.status === 403 && /scope/i.test(e.message)) { if (await askReconnect()) login(); return; }
    showMsg('ERROR: ' + e.message.toUpperCase(), 3000); libStatus(label + ' failed: ' + e.message);
  }
}
const idOf = uri => (uri || '').split(':').pop();
async function chunked(list, n, fn) { for (let i = 0; i < list.length; i += n) await fn(list.slice(i, i + n)); }
const songs = n => `${n} song${n === 1 ? '' : 's'}`;

function addToQueue(tracks) {
  return act('Add to queue', async () => {
    if (!ready()) return;
    for (const t of tracks) {
      // YouTube Music mode: Soranix plays the queue itself (see ytm.js), Spotify isn't asked
      if (!YT.on) await api(`/me/player/queue?uri=${encodeURIComponent(t.uri)}&device_id=${S.deviceId}`, { method: 'POST' });
      QU.items.push({ type: 'track', uri: t.uri, id: t.id, name: t.name, artist: t.artist, album: t.album, albumId: t.albumId, artists: t.artists, dur: t.dur, img: t.img || t.imgMid, imgLarge: t.imgLarge, mvt: t.mvt, added: Date.now() });
    }
    saveQueue(); renderQueue();
    showMsg('QUEUED: ' + (tracks.length === 1 ? tracks[0].name.toUpperCase() : songs(tracks.length).toUpperCase()), 2000);
    upNextSoon(800);
  });
}
function addToPlaylist(tracks, p) {
  return act('Add to playlist', async () => {
    await chunked(tracks.map(t => t.uri), 100, uris => api(`/playlists/${p.id}/items`, { method: 'POST', body: { uris }, bulk: tracks.length > 100 }));
    DB.del('pl:' + p.id); // its saved copy is out of date now
    showMsg(`ADDED ${songs(tracks.length).toUpperCase()} TO ${p.name.toUpperCase()}`, 2500);
    if (L.view?.node === 'pl:' + p.id) openNode(L.view.node);
  });
}
async function newPlaylistWith(tracks) {
  const name = await winPrompt(`Name for the new playlist (${songs(tracks.length)} will be added):`,
    tracks.length === 1 ? tracks[0].name + ' mix' : 'Soranix mix', { title: 'CREATE PLAYLIST', ok: 'Create' });
  if (!name) return;
  return act('New playlist', async () => {
    const p = mapPlaylist(await api('/me/playlists', { method: 'POST', body: { name, public: false, description: 'Made with Soranix' } }));
    S.playlists.unshift(p); savePlaylistList(); renderTree();
    await addToPlaylist(tracks, p);
  });
}
async function removeFromSpotifyPlaylist(tracks, p) {
  if (!await winConfirm(`Remove ${songs(tracks.length)} from "${p.name}" on Spotify?`, { title: 'REMOVE SONGS', ok: 'Remove', danger: true })) return;
  return act('Remove from playlist', async () => {
    await chunked(tracks.map(t => ({ uri: t.uri })), 100, items => api(`/playlists/${p.id}/items`, { method: 'DELETE', body: { items }, bulk: tracks.length > 100 }));
    DB.del('pl:' + p.id);
    const gone = new Set(tracks.map(t => t.uri));
    if (L.view?.node === 'pl:' + p.id) { L.view.rows = L.view.rows.filter(r => !gone.has(r.uri)); L.sel.clear(); renderView(); }
    showMsg('REMOVED FROM ' + p.name.toUpperCase(), 2000);
  });
}
function setLiked(tracks, like) {
  return act(like ? 'Save to Liked Songs' : 'Remove from Liked Songs', async () => {
    await chunked(tracks.map(t => t.uri), 40, uris => api(`/me/library?uris=${encodeURIComponent(uris.join(','))}`, { method: like ? 'PUT' : 'DELETE' }));
    // keep the saved Liked Songs list up to date instead of throwing it away
    DB.del('liked1');
    const lk = await DB.get('liked');
    if (lk?.rows) {
      const uris = new Set(tracks.map(t => t.uri));
      const rows = like ? [...tracks.filter(t => t.type === 'track' && !lk.rows.some(r => r.uri === t.uri)).map(t => ({ ...t })), ...lk.rows] : lk.rows.filter(r => !uris.has(r.uri));
      DB.set('liked', { at: lk.at, rows });
    }
    if (tracks.some(t => /^spotify:album:/.test(t.uri))) { DB.del('lib:albums'); LIBX.albums = null; }
    if (tracks.some(t => /^spotify:show:/.test(t.uri))) { DB.del('lib:shows'); LIBX.shows = null; }
    showMsg(like ? 'SAVED TO LIKED SONGS' : 'REMOVED FROM LIKED SONGS', 2000);
    if (!like && L.view?.node === 'liked') { const gone = new Set(tracks.map(t => t.uri)); L.view.rows = L.view.rows.filter(r => !gone.has(r.uri)); L.sel.clear(); renderView(); }
  });
}
async function isLiked(uris) {
  // songs: answer from the saved Liked Songs list when it's recent (no request)
  if (uris.length && uris.every(u => /^spotify:track:/.test(u))) {
    const lk = await DB.get('liked');
    if (lk?.rows && Date.now() - lk.at < DAY) { const have = new Set(lk.rows.map(r => r.uri)); return uris.every(u => have.has(u)); }
  }
  try { const r = await api(`/me/library/contains?uris=${encodeURIComponent(uris.slice(0, 40).join(','))}`); return Array.isArray(r) ? r.every(Boolean) : null; }
  catch { return null; }
}
function goArtist(id) { return openArtistInfo(id); }
function goAlbum(t) {
  return act('Go to album', async () => {
    let id = t.albumId;
    if (!id) id = (await api('/tracks/' + (t.id || idOf(t.uri)))).album.id;
    const a = await api('/albums/' + id); showWin('lib', true); openAlbum(mapAlbum(a));
  });
}
function copyText(text, what) {
  navigator.clipboard.writeText(text).then(() => showMsg(what + ' COPIED', 1500),
    () => winDialog({ title: 'COPY', message: 'Copy this:', fields: [{ value: text }], ok: 'Close', cancel: null }));
}
function setSleep(min) {
  clearTimeout(S.sleepTimer); S.sleepTimer = 0; S.sleepEnd = false; S.sleepAt = 0;
  if (min === 'end') { S.sleepEnd = true; showMsg('SLEEP TIMER: END OF THIS SONG', 2000); }
  else if (min) {
    S.sleepAt = Date.now() + min * 60000;
    S.sleepTimer = setTimeout(() => { S.player?.pause(); S.sleepAt = 0; showMsg('SLEEP TIMER: GOOD NIGHT', 4000); }, min * 60000);
    showMsg(`SLEEP TIMER: ${min} MINUTES`, 2000);
  } else showMsg('SLEEP TIMER: OFF', 1500);
}
function sleepMenu() {
  const left = S.sleepAt ? Math.ceil((S.sleepAt - Date.now()) / 60000) : 0;
  return [
    ...[5, 15, 30, 45, 60].map(m => ({ label: m + ' minutes', fn: () => setSleep(m), check: S.sleepAt && left <= m && left > m - (m === 5 ? 5 : m === 15 ? 10 : 15) })),
    { label: '1 hour 30', fn: () => setSleep(90) },
    { label: 'End of this song', fn: () => setSleep('end'), check: S.sleepEnd },
    '-',
    { label: S.sleepAt ? `Turn off (${left} min left)` : 'Turn off', fn: () => setSleep(0), disabled: !S.sleepAt && !S.sleepEnd },
  ];
}
/* the menu itself. src: { from: 'pl' | 'lib' | 'now', indices?, playlist? } */
async function songMenu(e, tracks, src) {
  e.preventDefault(); e.stopPropagation();
  if (!tracks.length) return;
  const one = tracks.length === 1 ? tracks[0] : null;
  const pos = { clientX: e.clientX, clientY: e.clientY };
  const ownPl = src.playlist && S.me && (src.playlist.ownerId === S.me.id || src.playlist.collab) ? src.playlist : null;
  const mine = S.playlists.filter(p => S.me && (p.ownerId === S.me.id || p.collab));
  const likeItem = { label: 'Save to Liked Songs', key: 'L', fn: () => setLiked(tracks, true) };
  const artists = one?.artists?.length ? one.artists : one?.artistId ? [{ id: one.artistId, name: one.artist }] : [];
  const items = [
    { label: tracks.length > 1 ? `Play ${songs(tracks.length)}` : 'Play', key: 'Enter', fn: () => {
      if (src.from === 'pl') return playFromPl(src.indices[0]);
      playList(tracks, 0);
    } },
    { label: 'Add to queue', key: 'Q', fn: () => addToQueue(tracks) },
    src.from !== 'pl' && { label: 'Add to Soranix playlist', key: 'E', fn: () => { const n = plAdd(tracks, false); showMsg(`ADDED ${songs(n).toUpperCase()} TO PLAYLIST`); } },
    { label: 'Add to My playlists', key: 'M', sub: () => mixMenu(tracks) },
    src.from === 'lib' && L.view?.mixId && { label: 'Remove from this mixed playlist', key: 'Del', fn: () => mixRemove(mixById(L.view.mixId), tracks) },
    src.from === 'lib' && L.view?.mixId && one && { label: 'Move up', fn: () => mixMove(mixById(L.view.mixId), one, -1) },
    src.from === 'lib' && L.view?.mixId && one && { label: 'Move down', fn: () => mixMove(mixById(L.view.mixId), one, 1) },
    '-',
    { label: 'Add to playlist', key: 'P', sub: () => [
      { label: 'New playlist...', fn: () => newPlaylistWith(tracks) }, '-',
      ...mine.map(p => ({ label: p.name, fn: () => addToPlaylist(tracks, p) })),
    ] },
    ownPl && { label: 'Remove from this playlist', key: 'Del', fn: () => removeFromSpotifyPlaylist(tracks, ownPl) },
    src.from === 'pl' && { label: 'Remove from Soranix playlist', key: 'Del', fn: plRemove },
    likeItem,
    // YouTube Music / SoundCloud: their own Liked music / Likes and your playlists there
    ...(YT.on ? webSongMenuItems(tracks, src) : []),
    '-',
    { label: 'Sleep timer', key: 'T', sub: sleepMenu },
    '-',
    artists.length > 1
      ? { label: 'Go to artist', key: 'Alt+A', sub: artists.map(a => ({ label: a.name, fn: () => (YT.on ? openWebArtist({ name: a.name }) : goArtist(a.id)) })) }
      : { label: 'Go to artist', key: 'Alt+A', disabled: YT.on ? !artists[0]?.name : !artists[0]?.id, fn: () => (YT.on ? openWebArtist({ name: artists[0].name }) : goArtist(artists[0].id)) },
    { label: 'Go to album', key: 'A', disabled: !one || one.episode, fn: () => goAlbum(one) },
    '-',
    { label: 'Share', key: 'S', disabled: !one, sub: () => [
      { label: 'Copy song link', fn: () => copyText('https://open.spotify.com/track/' + (one.id || idOf(one.uri)), 'LINK') },
      { label: 'Copy Spotify URI', fn: () => copyText(one.uri, 'URI') },
      { label: 'Copy "Artist - Title"', fn: () => copyText(`${one.artist} - ${one.name}`, 'TITLE') },
    ] },
  ].filter(Boolean);
  openMenu(pos, items);
  // open instantly, then flip the Like item once Spotify answers
  const menu = MENU;
  if (S.me && tracks.every(t => svcOfRow(t) === 'sp') && (await isLiked(tracks.map(t => t.uri))) === true && MENU === menu) {
    likeItem.label = 'Remove from Liked Songs'; likeItem.fn = () => setLiked(tracks, false);
    const lb = $(`.mi[data-i="${items.indexOf(likeItem)}"] .lb`, MENU.stack[0].el);
    if (lb) lb.textContent = likeItem.label;
  }
}
function containerMenu(e, r) {
  if (YT.on) return openMenu(e, webContainerMenu(r));   // (YouTube Music / SoundCloud: ytm.js)
  const items = [
    { label: 'Open', key: 'Enter', fn: () => activateRow(L.view.rows.indexOf(r)) },
    r.type !== 'artist' && { label: 'Play', fn: () => { L.sel = new Set([L.view.rows.indexOf(r)]); libSend(true); } },
    r.type !== 'artist' && { label: 'Add to Soranix playlist', key: 'E', fn: () => { L.sel = new Set([L.view.rows.indexOf(r)]); libSend(false); } },
    '-',
    { label: 'Share', key: 'S', sub: [
      { label: 'Copy link', fn: () => copyText(`https://open.spotify.com/${r.type}/${r.id}`, 'LINK') },
      { label: 'Copy Spotify URI', fn: () => copyText(r.uri, 'URI') },
    ] },
  ].filter(Boolean);
  openMenu(e, items);
}
/* the song that is playing right now, as a track row */
function nowTrack() {
  const t = S.track; if (!t) return null;
  return {
    type: 'track', uri: t.uri, id: t.id || idOf(t.uri), name: t.name,
    artist: t.artists.map(a => a.name).join(', '), artists: t.artists.map(a => ({ id: idOf(a.uri), name: a.name })),
    albumId: idOf(t.album?.uri), album: t.album?.name || '', dur: S.dur,
  };
}
function setupContextMenus() {
  $('#pllist').addEventListener('contextmenu', e => {
    const r = e.target.closest('.plrow'); if (!r) return;
    const i = +r.dataset.i;
    if (!S.plSel.has(i)) { S.plSel = new Set([i]); S.plAnchor = i; renderPL(false); }
    const idx = [...S.plSel].sort((a, b) => a - b);
    songMenu(e, idx.map(k => S.pl[k]), { from: 'pl', indices: idx });
  });
  $('#grid tbody').addEventListener('contextmenu', e => {
    const tr = e.target.closest('tr[data-i]'); if (!tr) return;
    const i = +tr.dataset.i;
    if (!L.sel.has(i)) { L.sel = new Set([i]); L.anchor = i; $$('#grid tbody tr[data-i]').forEach(x => x.classList.toggle('sel', L.sel.has(+x.dataset.i))); }
    const rows = [...L.sel].sort((a, b) => a - b).map(k => L.view.rows[k]);
    const tracks = rows.filter(x => x.type === 'track');
    if (!tracks.length) return rows[0].type === 'playlist' ? playlistMenu(e, rows[0]) : containerMenu(e, rows[0]);
    const pl = L.view.node?.startsWith('pl:') ? S.playlists.find(p => 'pl:' + p.id === L.view.node) : null;
    songMenu(e, tracks, { from: 'lib', playlist: pl });
  });
  const nowMenu = e => { const t = nowTrack(); if (t) songMenu(e, [t], { from: 'now' }); else e.preventDefault(); };
  $('#marquee').addEventListener('contextmenu', nowMenu);
  $('#lcd').addEventListener('contextmenu', nowMenu);
}
function mainMenu(e) {
  openMenu(e, [
    ['Library window   (L)', () => showWin('lib', true)],
    ['Playlist window', () => showWin('pl', !isShown('pl'))],
    ['Up Next window', () => showWin('eq', !isShown('eq'))],
    ['Queue window', () => toggleQueueWin()],
    ['Now Playing window', () => toggleLyrics()],
    '-',
    { label: 'Size', sub: () => {
      const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1;
      return [['Normal', 1], ['Medium', 2], ['Large', 3]].map(([n, k]) => ({
        label: n, check: Math.abs(cur - crispZoom(k)) < 0.01, fn: () => { setZoom(crispZoom(k)); showMsg('SIZE: ' + n.toUpperCase()); },
      }));
    } },
    { label: 'Mini mode   (Ctrl+M)', check: MINI.on, fn: () => toggleMini() },
    { label: 'Settings   (Ctrl+P)', sub: settingsItems },
    '-',
    ['Time: elapsed / remaining', () => { S.remaining = !S.remaining; LS.set('remaining', S.remaining); }],
    ['Log out of Spotify', () => openNode('logout')],
    ['About Soranix', showAbout],
  ]);
}

function settingsItems() {
  return [
    { label: 'Music service: ' + (YT.on ? W().name : 'Spotify'), sub: serviceMenu },
    { label: 'Discord activity...', fn: discordSettings },
    '-',
    { label: 'Always on top', check: LS.get('onTop', false), disabled: !window.desktop?.setOnTop, fn: () => setOnTop(!LS.get('onTop', false)) },
    { label: `Global hotkeys (${keyName(GK.got.toggle) || 'Ctrl+Alt+Space'}, Ctrl+Alt+arrows), also in games`, check: LS.get('globalKeys', false), disabled: !window.desktop?.globalKeys, fn: () => setGlobalKeys(!LS.get('globalKeys', false)) },
    { label: 'Song covers in the library lists', check: rowArt(), fn: () => setRowArt(!rowArt()) },
    { label: 'Lyrics on the MilkDrop visualizer', check: VL.on, fn: () => setVisLyrics(!VL.on) },
    { label: 'Lower music while someone talks (Discord, TeamSpeak...)', disabled: !window.desktop?.setDuck, sub: () =>
      [['Off', 0], ['A little (50%)', 50], ['A lot (80%)', 80], ['Silent', 100]].map(([n, v]) => ({ label: n, check: LS.get('duck', 0) === v, fn: () => setDuck(v) })) },
    { label: 'After a searched song, play similar music', check: radioEnabled(), fn: () => { LS.set('songRadio', !radioEnabled()); showMsg(radioEnabled() ? 'SEARCHED SONGS: SIMILAR MUSIC PLAYS NEXT' : 'SEARCHED SONGS: THE OTHER RESULTS PLAY NEXT', 2500); } },
    '-',
    { label: 'Reset windows to default (positions and sizes)', fn: resetWindows },
    { label: 'Reset table column widths', fn: resetColumns },
    { label: 'Reset library sidebar width', fn: () => { LS.del('treeW'); $('.treecol').style.width = ''; showMsg('SIDEBAR WIDTH RESET'); } },
    '-',
    { label: 'Reset everything above', fn: () => { resetWindows(); resetColumns(); LS.del('treeW'); $('.treecol').style.width = ''; } },
    '-',
    { label: 'Clear saved playlists and songs (cache)', fn: clearCache },
    '-',
    { label: "What's new in this version", disabled: !APP_VERSION, fn: () => showWhatsNew(true) },
    { label: 'Check for updates' + (APP_VERSION ? ` (you have ${APP_VERSION})` : ''), disabled: !window.desktop?.checkUpdate, fn: () => { showMsg('CHECKING FOR UPDATES...', 1500); window.desktop.checkUpdate(); } },
  ];
}

/* ------------------------------------------------------------------ keyboard */
function setupKeys() {
  addEventListener('keydown', e => {
    if (menuKey(e)) { e.preventDefault(); return; }
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey && !e.metaKey;
    // Ctrl+K / Ctrl+L / Ctrl+F only move you to the search box, so they work even while typing
    if (ctrl && !e.altKey && !e.shiftKey && (k === 'k' || k === 'l' || k === 'f')) { focusSearch(k === 'f' ? 'list' : 'spotify'); e.preventDefault(); return; }
    // typing in a box (search, playlist name, Client ID...): every other key belongs to the box
    if (e.target.matches('input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
    if (ctrl && !e.altKey) {
      const act = {
        arrowright: () => T.next(), arrowleft: () => T.prev(),
        arrowup: () => { setVol(S.vol + 5); showMsg('VOLUME: ' + S.vol + '%', 1000); },
        arrowdown: () => (e.shiftKey ? toggleMute() : (setVol(S.vol - 5), showMsg('VOLUME: ' + S.vol + '%', 1000))),
        s: () => T.shuffle(), r: () => T.repeat(),
        n: () => { if (S.me) createPlaylist(); else showMsg('CONNECT SPOTIFY FIRST', 2000); },
        p: () => openSettingsMenu(),
        m: () => toggleMini(),
      }[k];
      // Ctrl+Shift is only used for mute; Ctrl+A in the playlist window is handled below
      if (act && (!e.shiftKey || k === 'arrowdown')) { act(); e.preventDefault(); return; }
    }
    if (e.altKey && !e.ctrlKey && (k === 'arrowleft' || k === 'arrowright')) { (k === 'arrowleft' ? libBack : libForward)(); e.preventDefault(); return; }
    if (k === ' ' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      // Space: play / pause (and never "clicks" the button that happens to have focus)
      if (S.track) T.pause(); else T.play();
      e.preventDefault(); return;
    }
    const plFocused = document.activeElement === $('#pllist');
    if (plFocused && (k === 'delete' || k === 'backspace')) { plRemove(); e.preventDefault(); return; }
    if (plFocused && k === 'a' && (e.ctrlKey || e.metaKey)) { S.plSel = new Set(S.pl.map((_, i) => i)); renderPL(false); e.preventDefault(); return; }
    if (plFocused && k === 'enter' && S.plSel.size) { playFromPl(Math.min(...S.plSel)); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const map = { z: T.prev, x: T.play, c: T.pause, v: T.stop, b: T.next, s: T.shuffle, r: T.repeat, l: T.eject };
    if (map[k]) { map[k](); e.preventDefault(); return; }
    if (k === 'arrowleft' || k === 'arrowright') {
      if (S.track && S.player) { const ms = Math.max(0, Math.min(S.dur, curPos() + (k === 'arrowleft' ? -5000 : 5000))); S.player.seek(ms); S.pos = ms; S.ts = performance.now(); showMsg('SEEK: ' + fmt(ms)); }
      e.preventDefault();
    }
    if (k === 'arrowup' || k === 'arrowdown') {
      setVol(S.vol + (k === 'arrowup' ? 5 : -5)); e.preventDefault();
    }
  });
}

/* ------------------------------------------------------------------ boot */
/* The windows stay invisible until they're in their places and in the right colours. Until then
   Chromium keeps showing the previous picture, so restarting the player (switching between
   Spotify and YouTube Music) doesn't flash windows at their default spots for a moment. */
function reveal() { document.documentElement.classList.add('ready'); }
setTimeout(reveal, 3000);   // whatever happens, never stay invisible
async function boot() {
  setupPixelText(); setupWindows(); setupMain(); setupUpNext(); setupPL(); setupLib(); setupKeys(); setupContextMenus(); setupLyrics(); setupNowPlaying(); setupPlaylistMenus(); setupArtistWindow(); setupMilkdrop(); setupQueueWin(); setupReorder(); setupMini(); setupMyLists();
  renderStatus();
  requestAnimationFrame(frame);
  const p = new URLSearchParams(location.search);
  // Spotify or YouTube Music (coming back from Spotify's login page: Spotify, of course)
  // (Choose your music opens on the player's monitor: the monitors must be known first)
  await Promise.race([S.displaysReady, sleep(1500)]);
  const svc = p.has('code') || p.has('error') ? 'spotify' : await chooseService();
  setTimeout(S.svcChosenNow, 0);   // (YouTube Music / SoundCloud: once ytStart below has begun)
  // (each start shows the windows after its first, instant part: red theme, library, account)
  if (WEB[svc]) { const started = ytStart(svc); reveal(); return started; }
  window.desktop?.ytm?.('stop'); window.desktop?.sc?.('stop');
  if (p.has('code') || p.has('error')) {
    reveal();
    history.replaceState(null, '', REDIRECT);
    if (p.get('error')) { showLogin('Spotify login was cancelled or failed: ' + p.get('error')); return; }
    try { await exchangeCode(p.get('code'), p.get('state')); }
    catch (e) { showLogin(e.message); return; }
  }
  if (LS.get('token')) { const connected = onConnected(); reveal(); await connected; } else { showLogin(); reveal(); }
}

/* ------------------------------------------------------------------ lyrics window
   Spotify's API has no lyrics, so they come from LRCLIB (lrclib.net), a free, open lyrics
   database. Only the song title, artist, album and length are sent to it. */
const AR_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LYR = { cache: new Map(), key: null, lines: null, plain: null, cur: -1, offset: LS.get('lyrOffset2', 0) };
// lyrics follow the song's own timing; the Earlier / Later counter shifts them (0.0s = no shift)
const LYR_BASE = 0;
function placeLyrics() {
  const l = winEl('lib'), y = winEl('lyr');
  const d = displayOf(l) || primaryDisplay();
  let x = l.offsetLeft + l.offsetWidth + 8;
  if (x + y.offsetWidth > d.x + d.w) x = Math.max(d.x, d.x + d.w - y.offsetWidth - 8);
  y.style.left = x + 'px'; y.style.top = l.offsetTop + 'px';
  if (l.offsetHeight && !LS.get('sizes', {}).lyr) y.style.height = l.offsetHeight + 'px';
  savePos();
}
function toggleLyrics(on = !isShown('lyr')) {
  showWin('lyr', on);
  if (on) {
    const l = winEl('lib'), y = winEl('lyr');
    if (l.offsetHeight && !LS.get('sizes', {}).lyr) y.style.height = l.offsetHeight + 'px';
    // beside the library until you drag it somewhere yourself; always fully on screen
    if (!wasMoved('lyr')) { placeLyrics(); if (!inside(rectOf(y), displayOf(y) || primaryDisplay())) placeFree(y); }
    else fitOnScreen(y);
    if (NP.video && YT.on) ytVideoMode(false);
    NP.cover = NP.lyrics = true; NP.video = false; applyNpMode(); // opens with cover art and lyrics
    LYR.key = null; lyricsForCurrent();
  }
}
const cleanTitle = n => n.replace(/\s*[-–]\s*(\d{4}\s*)?(remaster|remastered|live|mono|stereo|radio edit|single version|edit)\b.*$/i, '')
  .replace(/\s*[\(\[](feat|ft|with)\.?\s[^\)\]]*[\)\]]/ig, '').trim();
function parseLRC(text) {
  const out = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) out.push({ t: (+m[1] * 60 + +m[2]) * 1000, text: words });
  }
  return out.sort((a, b) => a.t - b.t);
}
async function fetchLyrics(info) {
  const base = 'https://lrclib.net/api/';
  try {
    const r = await fetch(base + 'get?' + new URLSearchParams({
      track_name: info.name, artist_name: info.artist, album_name: info.album, duration: Math.round(info.dur / 1000),
    }));
    if (r.ok) { const j = await r.json(); if (j.syncedLyrics || j.plainLyrics || j.instrumental) return j; }
  } catch {}
  const r = await fetch(base + 'search?' + new URLSearchParams({ track_name: cleanTitle(info.name), artist_name: info.artist }));
  if (!r.ok) throw new Error('Lyrics service error ' + r.status);
  const list = (await r.json()).filter(x => x.syncedLyrics || x.plainLyrics || x.instrumental);
  const sec = info.dur / 1000;
  list.sort((a, b) => (Math.abs(a.duration - sec) - Math.abs(b.duration - sec)) || (!!b.syncedLyrics - !!a.syncedLyrics));
  return list.find(x => Math.abs(x.duration - sec) < 8) || null;
}
async function lyricsForCurrent() {
  if (!isShown('lyr')) return;
  const t = S.track;
  const box = $('#lyr-text');
  renderNowInfo();
  if (!t) { LYR.key = null; box.innerHTML = '<div class="lyr-msg">Play a song and its lyrics show up here.</div>'; return; }
  const key = t.uri;
  if (LYR.key === key) return;
  LYR.key = key; LYR.lines = null; LYR.plain = null; LYR.cur = -1;
  const info = { name: t.name, artist: t.artists?.[0]?.name || '', album: t.album?.name || '', dur: S.dur || t.duration_ms || 0 };
  box.innerHTML = '<div class="lyr-msg">Looking for lyrics...</div>';
  let j = LYR.cache.get(key);
  if (j === undefined) {
    try { j = YT.on ? await ytLyrics(t, info) : await fetchLyrics(info); LYR.cache.set(key, j); }
    catch (e) { if (LYR.key === key) box.innerHTML = `<div class="lyr-msg">Could not reach the lyrics service.<br>${esc(e.message)}</div>`; LYR.key = null; return; }
  }
  if (LYR.key !== key) return;
  // where these lyrics came from (YouTube Music mode tries lyrics timed to the exact song first)
  $('.lyr-src').textContent = j?.limusic ? 'lyrics: synced to this song' : j ? 'lyrics: lrclib.net' : 'lyrics: none found';
  $('.lyr-src').title = j?.limusic ? 'Lyrics timed to this exact song on YouTube Music'
    : j ? 'From LRCLIB (lrclib.net)' : 'No lyrics were found for this song';
  if (!j) { box.innerHTML = '<div class="lyr-msg">No lyrics found for this song.</div>'; return; }
  if (j.instrumental) { box.innerHTML = '<div class="lyr-msg">♪ Instrumental ♪</div>'; return; }
  const synced = j.limusic || parseLRC(j.syncedLyrics);
  if (synced.length) {
    LYR.lines = synced;
    box.innerHTML = `<div class="lyr-line intro" data-i="-1"><span>\u25CF \u25CF \u25CF</span></div>` +
      synced.map((l, i) => {
        // Every line fills word by word in sung order, so a line that wraps onto two rows
        // finishes the first row before starting the second. Arabic words fill right to left,
        // Latin words left to right; lines containing Arabic are laid out right to left.
        if (!l.text.trim()) return `<div class="lyr-line" data-i="${i}"><span>\u266A</span></div>`;
        const ar = AR_RE.test(l.text);
        const parts = l.text.split(/(\s+)/), total = l.text.replace(/\s+/g, '').length || 1;
        let done = 0;
        const html = parts.map(w => {
          if (!w.trim()) return w;
          const a = done / total; done += w.length;
          return `<span class="w${AR_RE.test(w) ? ' ar' : ''}" data-a="${a.toFixed(4)}" data-b="${(done / total).toFixed(4)}">${esc(w)}</span>`;
        }).join('');
        return `<div class="lyr-line words${ar ? ' rtl' : ''}" data-i="${i}"><span${ar ? ' dir="rtl"' : ''}>${html}</span></div>`;
      }).join('');
    pixelizeLyrics(box);
    padLyrics();
  } else {
    LYR.plain = j.plainLyrics;
    box.innerHTML = `<div class="lyr-plain">${esc(j.plainLyrics)}</div><div class="lyr-msg small">These lyrics are not time-synced.</div>`;
  }
  box.scrollTop = 0;
  $('#lyr-mode').textContent = synced.length ? 'SYNCED' : 'TEXT';
}
/* half-height padding above and below so the first and last lines can sit in the middle */
function padLyrics() {
  // Clear the old padding before measuring: a box can't shrink below its padding, so padding
  // sized for the tall lyrics-only view would otherwise push the window's bottom bar off
  // when switching back to cover + lyrics.
  const box = $('#lyr-text');
  box.style.paddingTop = box.style.paddingBottom = '0px';
  const h = Math.round(box.clientHeight / 2) - 14;
  box.style.paddingTop = box.style.paddingBottom = Math.max(20, h) + 'px';
}
function lyricsTick() {
  if (!LYR.lines || !isShown('lyr')) return;
  const L2 = LYR.lines, pos = curPos() + LYR_BASE + LYR.offset;
  let i = -1;
  for (let k = 0; k < L2.length && L2[k].t <= pos; k++) i = k;
  const box = $('#lyr-text');
  // karaoke fill: how far we are between this line and the next one
  // A line is usually sung faster than the gap before the next line (pauses, instrumental
  // breaks), so the fill runs at a singing pace (~85 ms per letter, at least 1.2 s) instead of
  // stretching across the whole gap, which made words light up late.
  const start = i < 0 ? 0 : L2[i].t;
  const gapEnd = i + 1 < L2.length ? L2[i + 1].t : Math.max(start + 4000, S.dur);
  const sung = i < 0 ? Infinity : Math.max(1200, L2[i].text.replace(/\s+/g, '').length * 85);
  // (Limusic's lyrics say when each line ends; otherwise it's estimated)
  const end = i >= 0 && L2[i].end > start ? L2[i].end : Math.min(gapEnd, start + sung);
  const frac = Math.max(0, Math.min(1, (pos - start) / Math.max(1, end - start)));
  if (i !== LYR.cur) {
    LYR.cur = i;
    $$('.lyr-line', box).forEach(el => {
      const k = +el.dataset.i;
      el.classList.toggle('on', k === i);
      el.classList.toggle('past', k < i);
      el.classList.toggle('next', k === i + 1);
    });
    LYR.onEl = $(`.lyr-line[data-i="${i}"]`, box);
    if (LYR.onEl && LYR.follow !== false) box.scrollTo({ top: LYR.onEl.offsetTop - box.clientHeight / 2 + LYR.onEl.offsetHeight / 2, behavior: 'smooth' });
  }
  if (!LYR.onEl) return;
  if (LYR.onEl.classList.contains('words')) {
    for (const w of LYR.onEl.querySelectorAll('.w')) {
      const a = +w.dataset.a, b = +w.dataset.b;
      w.style.setProperty('--p', (Math.max(0, Math.min(1, (frac - a) / Math.max(0.0001, b - a))) * 100).toFixed(1) + '%');
    }
  } else LYR.onEl.style.setProperty('--p', (frac * 100).toFixed(1) + '%');
}
addEventListener('resize', () => { if (LYR.lines) { padLyrics(); LYR.cur = -2; } });
function setupLyrics() {
  const box = $('#lyr-text');
  box.addEventListener('click', e => {
    const l = e.target.closest('.lyr-line'); if (!l || !LYR.lines || !S.track || !S.player) return;
    const i = +l.dataset.i;
    const ms = i < 0 ? 0 : Math.max(0, LYR.lines[i].t - LYR_BASE - LYR.offset);
    S.player.seek(ms); S.pos = ms; S.ts = performance.now(); showMsg('SEEK: ' + fmt(ms));
  });
  // scrolling by hand pauses auto-follow for a few seconds
  let t = 0;
  box.addEventListener('wheel', () => { LYR.follow = false; clearTimeout(t); t = setTimeout(() => { LYR.follow = true; LYR.cur = -2; }, 4000); }, { passive: true });
  const off = d => { LYR.offset += d; LS.set('lyrOffset2', LYR.offset); $('#lyr-off').textContent = (LYR.offset > 0 ? '+' : '') + (LYR.offset / 1000).toFixed(1) + 's'; LYR.cur = -2; };
  $('#lyr-early').onclick = () => off(-500);
  $('#lyr-late').onclick = () => off(500);
  off(0);
  $('#lyr-retry').onclick = () => { if (S.track) LYR.cache.delete(S.track.uri); LYR.key = null; lyricsForCurrent(); };
  $('#lyr-theme').onclick = () => {
    const i = LYR_THEMES.findIndex(([k]) => k === LS.get('lyrTheme', 'green'));
    setLyricsTheme(LYR_THEMES[(i + 1) % LYR_THEMES.length][0]);
  };
  setLyricsTheme(LS.get('lyrTheme', 'green'), true);
}
/* lyrics themes: Green (the original), Player (the player's own LCD display and pixel font)
   and Sunset. Switching re-draws the saved lyrics, so it costs no requests. */
const LYR_THEMES = [['green', 'Green'], ['player', 'Player'], ['sunset', 'Sunset']];
function setLyricsTheme(k, quiet = false) {
  if (!LYR_THEMES.some(([x]) => x === k)) k = 'green';
  LS.set('lyrTheme', k);
  const b = $('.lyr-body');
  for (const [x] of LYR_THEMES) b.classList.toggle('lyrth-' + x, x === k);
  $('#lyr-theme').title = 'Lyrics theme: ' + LYR_THEMES.find(([x]) => x === k)[1] + ' (click for the next one)';
  if (!quiet) {
    showMsg('LYRICS THEME: ' + LYR_THEMES.find(([x]) => x === k)[1].toUpperCase(), 1500);
    if (LYR.lines) { LYR.key = null; lyricsForCurrent(); }
  }
}
/* Player theme: words the pixel font has are drawn in it (others keep the normal font) */
function pixelizeLyrics(box) {
  if (LS.get('lyrTheme', 'green') !== 'player') return;
  for (const el of $$('.lyr-line .w, .lyr-line:not(.words) > span', box)) {
    if (el.children.length) continue;
    const svg = pxSVG(el.textContent);
    if (svg) el.innerHTML = svg;
  }
}


/* ------------------------------------------------------------------ now playing: cover art + lyrics
   Two toggles that show / hide each part. The window opens with both on; turning both off
   closes it. */
const NP = { cover: true, lyrics: true, video: false };
// the picture area shows the cover art, or (YouTube Music) the video
const npArt = () => NP.cover || NP.video;
function npMode() { return npArt() && NP.lyrics ? 'both' : npArt() ? 'cover' : 'lyrics'; }
function npToggle(part) {
  NP[part] = !NP[part];
  if (part === 'video' && NP.video) NP.cover = false;   // the video takes the cover's place
  if (part === 'cover' && NP.cover) NP.video = false;
  if (!npArt() && !NP.lyrics) {
    NP.cover = NP.lyrics = true; NP.video = false; applyNpMode();
    if (YT.on) ytVideoMode(false);
    return toggleLyrics(false);
  }
  applyNpMode();
  if (YT.on && (part === 'video' || part === 'cover')) ytVideoMode(NP.video);
}
function applyNpMode() {
  const b = $('.lyr-body');
  b.classList.remove('mode-both', 'mode-cover', 'mode-lyrics');
  b.classList.add('mode-' + npMode());
  $('#np-cover').classList.toggle('on', NP.cover);
  $('#np-lyr').classList.toggle('on', NP.lyrics);
  $('#np-video').classList.toggle('on', NP.video);
  b.classList.toggle('show-video', NP.video);
  if (LYR.lines) { padLyrics(); LYR.cur = -2; }
}
function renderNowInfo() {
  const t = S.track;
  $('#np-title').textContent = t ? t.name : 'Nothing playing';
  $('#np-artist').innerHTML = t
    ? t.artists.map(a => `<a class="art-name-link" data-id="${esc(idOf(a.uri))}" data-name="${esc(a.name)}" title="About ${esc(a.name)}">${esc(a.name)}</a>`).join(', ')
    : 'Pick a song and press play';
  const imgs = t?.album?.images || [];
  // biggest cover available (the SDK gives sizes as width/height or as SMALL/LARGE)
  const score = i => i.width || i.height || ({ LARGE: 640, UNKNOWN: 300, SMALL: 64 }[i.size] ?? 0);
  const url = imgs.reduce((m, i) => (!m || score(i) > score(m) ? i : m), null)?.url;
  const img = $('#np-img');
  if (url) { if (img.getAttribute('src') !== url) img.src = url; img.style.display = ''; $('#np-art').classList.remove('empty'); }
  else { img.removeAttribute('src'); img.style.display = 'none'; $('#np-art').classList.add('empty'); }
  $('#np-art').title = t?.album?.name || '';
}
function setupNowPlaying() {
  // it was open: open it again (after switching between Spotify and YouTube Music, or a restart)
  if (LS.get('shown', {}).lyr) { winEl('lyr').classList.add('hidden'); setTimeout(() => toggleLyrics(true), 0); }
  $('#np-cover').onclick = () => npToggle('cover');
  $('#np-lyr').onclick = () => npToggle('lyrics');
  $('#np-video').onclick = () => npToggle('video');
  $('#np-art').onclick = () => { if (!YT.on && S.track?.album?.uri) { showWin('lib', true); goAlbum({ albumId: idOf(S.track.album.uri), id: idOf(S.track.uri), uri: S.track.uri }); } };
  applyNpMode();
  renderNowInfo();
}

/* ------------------------------------------------------------------ playlist right-click menu */
const PINS = new Set(LS.get('pins', []));
const pinFirst = list => [...list.filter(p => PINS.has(p.id)), ...list.filter(p => !PINS.has(p.id))];
const pinLabel = p => (PINS.has(p.id) ? '\u{1F4CC} ' : '') + p.name;
const plById = id => S.playlists.find(p => p.id === id);
function togglePin(p) {
  PINS.has(p.id) ? PINS.delete(p.id) : PINS.add(p.id);
  LS.set('pins', [...PINS]); renderTree();
  showMsg((PINS.has(p.id) ? 'PINNED: ' : 'UNPINNED: ') + p.name.toUpperCase(), 1500);
}
function updatePlaylistLocal(p, changes) {
  Object.assign(p, changes);
  const mine = plById(p.id); if (mine && mine !== p) Object.assign(mine, changes);
  savePlaylistList();
  renderTree();
  if (L.view?.node === 'pl:' + p.id) { L.view.title = p.name; renderView(); }
}
async function editPlaylist(p) {
  const r = await winDialog({ title: 'EDIT DETAILS', ok: 'Save',
    image: { url: p.imgLarge || p.img },
    note: 'Click the picture to choose a new cover (JPEG, PNG or WebP). Make sure you have the right to use the picture you upload.',
    fields: [
      { label: 'Name', value: p.name, required: true },
      { label: 'Description', value: p.description || '', placeholder: 'Add an optional description' },
    ] });
  if (!r) return;
  const [name, description] = r;
  act('Edit details', async () => {
    if (name !== p.name || description !== (p.description || '')) {
      await api('/playlists/' + p.id, { method: 'PUT', body: { name, description } });
      updatePlaylistLocal(p, { name, description });
    }
    if (r.image) {
      showMsg('UPLOADING COVER...', 4000);
      await uploadCover(p.id, r.image.b64);
      updatePlaylistLocal(p, { img: r.image.url, imgLarge: r.image.url });
    }
    showMsg(r.image ? 'PLAYLIST UPDATED - NEW COVER CAN TAKE A MINUTE TO SHOW ON SPOTIFY' : 'PLAYLIST UPDATED', 3000);
  });
}
function setPlaylistFlags(p, flags) {
  act('Change playlist', async () => {
    await api('/playlists/' + p.id, { method: 'PUT', body: flags });
    updatePlaylistLocal(p, { public: flags.public ?? p.public, collab: flags.collaborative ?? p.collab });
    showMsg(flags.collaborative === true ? 'NOW COLLABORATIVE' : flags.collaborative === false ? 'NO LONGER COLLABORATIVE'
      : flags.public ? 'PLAYLIST IS NOW PUBLIC' : 'PLAYLIST IS NOW PRIVATE', 2000);
  });
}
async function removePlaylist(p, mine) {
  const q = mine
    ? `Delete "${p.name}"?\n\nIt will be removed from your Spotify library. (Spotify keeps deleted playlists recoverable for a while at spotify.com/account/recover-playlists.)`
    : `Remove "${p.name}" from Your Library?`;
  if (!await winConfirm(q, { title: mine ? 'DELETE PLAYLIST' : 'REMOVE PLAYLIST', ok: mine ? 'Delete' : 'Remove', danger: true })) return;
  act(mine ? 'Delete playlist' : 'Remove from library', async () => {
    await api(`/me/library?uris=${encodeURIComponent(p.uri)}`, { method: 'DELETE' });
    S.playlists = S.playlists.filter(x => x.id !== p.id); savePlaylistList(); DB.del('pl:' + p.id);
    PINS.delete(p.id); LS.set('pins', [...PINS]);
    renderTree();
    if (L.view?.node === 'pl:' + p.id) openNode('liked');
    showMsg((mine ? 'DELETED: ' : 'REMOVED: ') + p.name.toUpperCase(), 2000);
  });
}
function followPlaylist(p) {
  act('Add to library', async () => {
    await api(`/me/library?uris=${encodeURIComponent(p.uri)}`, { method: 'PUT' });
    if (!plById(p.id)) S.playlists.push({ ...p });
    renderTree(); showMsg('ADDED TO YOUR LIBRARY: ' + p.name.toUpperCase(), 2000);
  });
}
async function playlistTracks(p) {
  try { return await tracksOf(p); } catch (e) { libStatus('Could not load songs: ' + e.message); return []; }
}
function playlistMenu(e, p) {
  e.preventDefault?.(); e.stopPropagation?.();
  const mine = !!S.me && p.ownerId === S.me.id;
  const canList = mine || !!p.collab;
  const inLib = !!plById(p.id);
  const noList = "Spotify only lets apps read songs from playlists you made or collaborate on";
  const items = [
    { label: 'Play', key: 'Enter', fn: async () => {
      if (!canList) return playBody({ context_uri: p.uri });
      const t = await playlistTracks(p); if (t.length) playList(t, 0);
    } },
    { label: 'Add to queue', key: 'Q', disabled: !canList, fn: async () => { const t = await playlistTracks(p); if (t.length) addToQueue(t); } },
    { label: 'Add to Soranix playlist', key: 'E', disabled: !canList, fn: async () => { const t = await playlistTracks(p); const n = plAdd(t, false); showMsg(`ADDED ${songs(n).toUpperCase()}`); } },
    '-',
    mine && { label: 'Edit details', fn: () => editPlaylist(p) },
    inLib
      ? { label: mine ? 'Delete' : 'Remove from Your Library', key: 'Del', fn: () => removePlaylist(p, mine) }
      : { label: 'Add to Your Library', fn: () => followPlaylist(p) },
    '-',
    { label: 'Create playlist', fn: createPlaylist },
    '-',
    mine && { label: p.public ? 'Make private' : 'Make public', fn: () => setPlaylistFlags(p, { public: !p.public }) },
    mine && (p.collab
      ? { label: 'Stop collaborating', fn: () => setPlaylistFlags(p, { collaborative: false }) }
      : { label: 'Make collaborative', fn: () => setPlaylistFlags(p, { collaborative: true, public: false }) }),
    { label: 'Add to other playlist', key: 'P', disabled: !canList, sub: () => [
      { label: 'New playlist...', fn: async () => { const t = await playlistTracks(p); if (t.length) newPlaylistWith(t); } }, '-',
      ...S.playlists.filter(x => x.id !== p.id && S.me && (x.ownerId === S.me.id || x.collab))
        .map(x => ({ label: x.name, fn: async () => { const t = await playlistTracks(p); if (t.length) addToPlaylist(t, x); } })),
    ] },
    { label: PINS.has(p.id) ? 'Unpin playlist' : 'Pin playlist', fn: () => togglePin(p) },
    '-',
    { label: 'Share', key: 'S', sub: [
      { label: 'Copy playlist link', fn: () => copyText('https://open.spotify.com/playlist/' + p.id, 'LINK') },
      { label: 'Copy Spotify URI', fn: () => copyText(p.uri, 'URI') },
    ] },
  ].filter(Boolean);
  if (!canList) libStatus(noList + '. Play still works.');
  openMenu(e, items);
}
function setupPlaylistMenus() {
  $('#tree').addEventListener('contextmenu', e => {
    const n = e.target.closest('.node[data-id^="pl:"]'); if (!n) return;
    const p = plById(n.dataset.id.slice(3)); if (p) playlistMenu(e, p);
  });
}

/* ------------------------------------------------------------------ in-app dialogs (instead of browser pop-ups)
   winDialog resolves true/false for a question, or the list of field values (null if cancelled). */
function winDialog({ title = 'SORANIX', message = '', fields = [], ok = 'OK', cancel = 'Cancel', danger = false, image = null, note = '', wide = false, cover = '' }) {
  return new Promise(resolve => {
    closeMenus();
    const back = document.createElement('div');
    back.className = 'dlg-back';
    // centered on the monitor the player is on (not across all monitors, which puts it on the
    // seam between two screens)
    const d = (isShown('main') && displayOf(winEl('main'))) || primaryDisplay();
    Object.assign(back.style, { inset: 'auto', left: d.x + 'px', top: d.y + 'px', width: d.w + 'px', height: d.h + 'px' });
    back.innerHTML =
      `<div class="win dlg active${image || wide ? ' wide' : ''}" role="dialog" aria-label="${esc(title)}">` +
      `<div class="title"><span class="ridge"></span><span class="tname">${esc(title)}</span><span class="ridge"></span><span class="tbtn" data-x title="Close">&times;</span></div>` +
      `<div class="dlg-body">` +
      (cover ? `<img class="dlg-cover" src="${esc(cover)}" alt="">` : '') +
      (message ? `<div class="dlg-msg">${esc(message).replace(/\n/g, '<br>')}</div>` : '') +
      (image ? `<div class="dlg-row"><div class="dlg-img" data-pick title="Choose a photo">` +
        `${image.url ? `<img src="${esc(image.url)}" alt="">` : '<img alt="" style="display:none">'}` +
        `<span class="dlg-imgtxt">\u270E Choose photo</span></div><div class="dlg-fields">` : '') +
      fields.map((f, i) => `<label class="dlg-f">${f.label ? `<span>${esc(f.label)}</span>` : ''}` +
        `<input data-i="${i}"${f.type ? ` type="${esc(f.type)}"` : ''} value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" spellcheck="false" autocomplete="off"></label>`).join('') +
      (image ? `</div></div><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-file hidden>` : '') +
      (note ? `<div class="dlg-note">${esc(note)}</div>` : '') +
      `<div class="dlg-btns">${cancel ? `<button class="btn" data-c>${esc(cancel)}</button>` : ''}` +
      `<button class="btn ${danger ? 'danger' : 'yellow'}" data-ok>${esc(ok)}</button></div></div></div>`;
    $('#desktop').appendChild(back);
    const no = fields.length ? null : false;
    const inputs = $$('input[data-i]', back);
    let picked = null;
    if (image) {
      const file = $('[data-file]', back), img = $('.dlg-img img', back), txt = $('.dlg-imgtxt', back);
      $('[data-pick]', back).onclick = () => file.click();
      file.onchange = async () => {
        const f = file.files[0]; if (!f) return;
        txt.textContent = 'Preparing...';
        try { picked = await makeCoverJpeg(f); img.src = picked.url; img.style.display = ''; txt.textContent = '\u270E Change photo'; }
        catch (e) { picked = null; txt.textContent = e.message; }
      };
    }
    const done = v => { back.remove(); removeEventListener('keydown', key, true); resolve(v); };
    const submit = () => {
      if (!fields.length) return done(true);
      const vals = inputs.map(x => x.value);
      const miss = fields.findIndex((f, i) => f.required && !vals[i].trim());
      if (miss >= 0) { inputs[miss].focus(); inputs[miss].classList.add('need'); return; }
      const out = vals.map(v => v.trim());
      if (image) out.image = picked;
      done(out);
    };
    const key = e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); done(no); }
      else if (e.key === 'Enter') { e.preventDefault(); submit(); }
    };
    addEventListener('keydown', key, true);
    $('[data-ok]', back).onclick = submit;
    $('[data-c]', back)?.addEventListener('click', () => done(no));
    $('[data-x]', back).onclick = () => done(no);
    back.addEventListener('pointerdown', e => { if (e.target === back) { const d = $('.dlg', back); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake'); } });
    if (inputs[0]) { inputs[0].focus(); inputs[0].select(); } else $('[data-ok]', back).focus();
  });
}
const winConfirm = (message, o = {}) => winDialog({ message, ...o });
const winAlert = (message, o = {}) => winDialog({ message, cancel: null, ...o });
async function winPrompt(message, value = '', o = {}) {
  const r = await winDialog({ message, fields: [{ value, required: true }], ...o });
  return r ? r[0] : null;
}
const askReconnect = () => winConfirm(NEED_SCOPE, { title: 'PERMISSION NEEDED', ok: 'Reconnect' });

/* ------------------------------------------------------------------ playlist cover upload
   Spotify takes a square JPEG, base64-encoded, at most 256 KB. We crop the middle square,
   scale it down and lower the quality until it fits. */
async function makeCoverJpeg(file) {
  if (!/^image\//.test(file.type)) throw new Error('Pick a picture file');
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error("Can't read that picture"); }
  const side = Math.min(bmp.width, bmp.height);
  for (const size of [640, 512, 400, 300]) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.min(size, side);
    const c = cv.getContext('2d');
    c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
    c.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, cv.width, cv.height);
    for (const q of [0.92, 0.85, 0.75, 0.65, 0.55]) {
      const url = cv.toDataURL('image/jpeg', q);
      const b64 = url.slice(url.indexOf(',') + 1);
      if (b64.length <= 250000) return { url, b64 };
    }
  }
  throw new Error('Picture too large');
}
async function uploadCover(id, b64) {
  const r = await fetch(`${API}/playlists/${id}/images`, {
    method: 'PUT', headers: { Authorization: 'Bearer ' + await getToken(), 'Content-Type': 'image/jpeg' }, body: b64,
  });
  if (!r.ok) {
    let msg = 'HTTP ' + r.status;
    try { const j = await r.json(); msg = j?.error?.message || msg; } catch {}
    if (r.status === 401 || r.status === 403) msg += ' (scope)';
    const e = new Error(msg); e.status = 403; throw e;
  }
}

/* ------------------------------------------------------------------ artist window
   Spotify's API gives the name, photo, genres and releases. Follower counts, monthly
   listeners, bios and social links aren't available to apps, so the "About" part comes from
   MusicBrainz (an open music database: type, origin, years active, official links) and
   Wikipedia (bio). Only the artist's name / Spotify id is sent to them. */
const ART = { cur: null, cache: new Map(), placed: false };
const MUSIC_RE = /\b(musician|singer|rapper|band|group|producer|dj|composer|songwriter|duo|trio|vocalist|trackmaker|idol|artist|guitarist|pianist|orchestra)\b/i;
const LINK_KINDS = [
  [/instagram\.com/, 'Instagram'], [/(^|\.)(twitter|x)\.com/, 'X'], [/youtube\.com|youtu\.be/, 'YouTube'],
  [/tiktok\.com/, 'TikTok'], [/soundcloud\.com/, 'SoundCloud'], [/bandcamp\.com/, 'Bandcamp'], [/facebook\.com/, 'Facebook'],
  [/music\.apple\.com|itunes\.apple\.com/, 'Apple Music'], [/twitch\.tv/, 'Twitch'], [/patreon\.com/, 'Patreon'],
  [/genius\.com/, 'Genius'], [/discogs\.com/, 'Discogs'], [/last\.fm/, 'Last.fm'], [/wikipedia\.org/, 'Wikipedia'],
];
async function mbGet(path, tries = 2) {
  const r = await fetch('https://musicbrainz.org/ws/2/' + path + (path.includes('?') ? '&' : '?') + 'fmt=json');
  if (r.status === 503 && tries > 1) { await sleep(2500); return mbGet(path, tries - 1); } // busy / rate limited
  if (!r.ok) throw new Error('MusicBrainz ' + r.status);
  return r.json();
}
async function externalArtist(a) {
  if (ART.cache.has(a.id)) return ART.cache.get(a.id);
  const saved = await DB.get('ext:' + a.id);   // bio and links, kept for a week
  if (saved && Date.now() - saved.at < 7 * 864e5) { ART.cache.set(a.id, saved.out); return saved.out; }
  const out = await externalArtistFetch(a);
  if (out.mb || out.wiki) DB.set('ext:' + a.id, { at: Date.now(), out });
  return out;
}
async function externalArtistFetch(a) {
  const out = { mb: null, links: [], wiki: null };
  try {
    let mbid = null;
    // (a Spotify artist is found by its Spotify link; a YouTube Music / SoundCloud one by its name)
    if (a.spotify !== false) {
      try {
        const u = await mbGet('url?resource=' + encodeURIComponent('https://open.spotify.com/artist/' + a.id) + '&inc=artist-rels');
        mbid = (u.relations || []).find(r => r.artist)?.artist?.id || null;
      } catch {}
      await sleep(1100); // MusicBrainz asks for at most one request per second
    }
    if (!mbid) {
      const q = await mbGet('artist?query=' + encodeURIComponent(`artist:"${a.name}"`) + '&limit=5');
      mbid = (q.artists || []).find(x => x.score >= 95 && x.name.toLowerCase() === a.name.toLowerCase())?.id || null;
      if (mbid) await sleep(1100);
    }
    if (mbid) out.mb = await mbGet(`artist/${mbid}?inc=url-rels`);
  } catch {}
  for (const r of out.mb?.relations || []) {
    const url = r.url?.resource; if (!url) continue;
    const kind = LINK_KINDS.find(([re]) => re.test(url))?.[1] || (r.type === 'official homepage' ? 'Website' : null);
    if (kind && !out.links.some(l => l.kind === kind)) out.links.push({ kind, url });
  }
  try {
    const urls = (out.mb?.relations || []).map(r => r.url?.resource || '');
    let title = null, lang = 'en', trusted = false;
    const wp = urls.find(u => /\.wikipedia\.org\/wiki\//.test(u));
    const wd = urls.find(u => /wikidata\.org\/wiki\/Q\d+/.test(u));
    if (wp) { const m = wp.match(/\/\/([\w-]+)\.wikipedia\.org\/wiki\/(.+)$/); lang = m[1]; title = decodeURIComponent(m[2]); trusted = true; }
    else if (wd) {
      const qid = wd.match(/Q\d+/)[0];
      const j = await (await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`)).json();
      const sl = j.entities?.[qid]?.sitelinks || {};
      const pick = sl.enwiki || sl.jawiki || Object.values(sl).find(x => /^[a-z_]+wiki$/.test(x.site) && !/^(commons|species|meta|wikidata)wiki$/.test(x.site));
      if (pick) { title = pick.title; lang = pick.site.replace(/wiki$/, '').replace(/_/g, '-'); trusted = true; }
    }
    if (!title) title = a.name;
    const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
    if (r.ok) {
      const j = await r.json();
      if (j.type !== 'disambiguation' && j.extract && (trusted || MUSIC_RE.test((j.description || '') + ' ' + j.extract.slice(0, 300)))) {
        const ow = j.originalimage?.width || 0, thumb = j.thumbnail?.source || '';
        const img = ow > 800 && /\/\d+px-/.test(thumb) ? thumb.replace(/\/\d+px-/, '/800px-') : j.originalimage?.source || thumb;   // (800 px: the original can be huge)
        out.wiki = { text: j.extract, url: j.content_urls?.desktop?.page, lang, img: img || '' };
        if (!out.links.some(l => l.kind === 'Wikipedia') && out.wiki.url) out.links.push({ kind: 'Wikipedia', url: out.wiki.url });
      }
    }
  } catch {}
  ART.cache.set(a.id, out);
  return out;
}
function placeArtistWin() { placeFree(winEl('art')); }
async function openArtistInfo(id) {
  if (!id) return;
  showWin('art', true);
  LS.set('artLast', id);   // reopened with this artist after a switch or a restart
  // until you drag it somewhere yourself, open it in a free spot next to the other windows
  if (!wasMoved('art')) placeArtistWin(); else fitOnScreen(winEl('art'));
  ART.cur = id;
  const body = $('#art-body');
  body.innerHTML = '<div class="art-msg">Loading artist...</div>';
  body.scrollTop = 0;
  let a;
  try { a = await artistProfile(id); }
  catch (e) { if (ART.cur === id) body.innerHTML = `<div class="art-msg">Could not load this artist.<br>${esc(e.message)}</div>`; return; }
  if (ART.cur !== id) return;
  $('#art-title').textContent = 'SORANIX ARTIST: ' + a.name.toUpperCase();
  const img = a.images?.[0]?.url;
  body.innerHTML =
    `<div class="art-hero"${img ? ` style="background-image:url('${esc(img)}')"` : ''}><div class="art-shade"></div>` +
    `<div class="art-hname">${esc(a.name)}</div></div>` +
    `<div class="art-actions">` +
    `<button class="btn yellow" id="art-play">▶ Play</button>` +
    `<button class="btn" id="art-follow" disabled>Follow</button>` +
    `<button class="btn" id="art-albums">Albums in library</button>` +
    `<button class="btn" id="art-link" title="Copy artist link">Share</button></div>` +
    ((a.genres || []).length ? `<div class="art-genres">${a.genres.map(g => `<span>${esc(g)}</span>`).join('')}</div>` : '') +
    `<div class="art-sec"><div class="art-h">About</div><div id="art-about" class="art-about"><span class="dim">Looking up info...</span></div></div>` +
    `<div class="art-sec"><div class="art-h">Artist details</div><ul id="art-facts" class="art-facts"><li class="dim">Loading...</li></ul></div>` +
    `<div class="art-sec" id="art-links-sec" hidden><div class="art-h">Links</div><div id="art-links" class="art-links"></div></div>` +
    `<div class="art-sec"><div class="art-h">Discography</div><div id="art-disc" class="art-disc"><span class="dim">Loading...</span></div></div>` +
    `<div class="art-src">Info: Spotify, MusicBrainz, Wikipedia</div>`;
  $('#art-play').onclick = () => playBody({ context_uri: a.uri });
  $('#art-albums').onclick = () => { showWin('lib', true); openArtist(mapArtist(a)); };
  $('#art-link').onclick = () => copyText('https://open.spotify.com/artist/' + a.id, 'LINK');

  // follow state
  // (read from your saved list of followed artists when there is one: no request)
  isFollowing(a).then(f => {
    if (ART.cur !== id) return;
    const b = $('#art-follow'); let on = f === true;
    const draw = () => { b.textContent = on ? '✓ Following' : '+ Follow'; b.classList.toggle('on', on); b.disabled = false; };
    draw();
    b.onclick = () => act(on ? 'Unfollow' : 'Follow', async () => {
      await api(`/me/library?uris=${encodeURIComponent(a.uri)}`, { method: on ? 'DELETE' : 'PUT' });
      on = !on; draw(); showMsg((on ? 'FOLLOWING ' : 'UNFOLLOWED ') + a.name.toUpperCase(), 1800);
      // update the saved list in place instead of downloading it again
      DB.set('follow:' + a.id, { at: Date.now(), on });
      const list = LIBX.artists || (await DB.get('lib:artists'))?.rows;
      if (list) {
        const next = on ? [mapArtist(a), ...list.filter(x => x.id !== a.id)] : list.filter(x => x.id !== a.id);
        if (LIBX.artists) LIBX.artists = next;
        DB.set('lib:artists', { at: Date.now(), rows: next });
        if (LIBX.filter === 'artists') renderTree();
      }
    });
  });

  // discography from Spotify
  const facts = [];
  let rel = [];
  try {
    const d = await artistReleases(a);   // same saved copy the library uses
    rel = d.rows; const total = d.total;
    if (ART.cur !== id) return;
    const years = rel.map(r => +r.year).filter(Boolean);
    if (rel.length) facts.push(`Has released music since ${Math.min(...years)}, with ${total || rel.length} albums, EPs and singles on Spotify.`);
    const albums = rel.filter(r => r.count > 6).length;
    if (albums) facts.push(`${albums} full-length album${albums === 1 ? '' : 's'}, latest in ${Math.max(...years)}.`);
    $('#art-disc').innerHTML = rel.length ? rel.map((r, i) =>
      `<div class="art-rel" data-i="${i}" title="${esc(r.name)}">${(r.imgMid || r.img) ? `<img src="${esc(r.imgMid || r.img)}" alt="" loading="lazy">` : '<div class="noimg">♪</div>'}` +
      `<div class="t">${esc(r.name)}</div><div class="y">${esc(r.year)} · ${r.count > 6 ? 'Album' : r.count > 1 ? 'EP' : 'Single'}</div></div>`).join('')
      : '<span class="dim">No releases found.</span>';
    $$('.art-rel', $('#art-disc')).forEach(el => el.onclick = () => { showWin('lib', true); openAlbum(rel[+el.dataset.i]); });
  } catch (e) { $('#art-disc').innerHTML = `<span class="dim">Could not load releases: ${esc(e.message)}</span>`; }
  const renderFacts = (more = []) => {
    const all = [...more, ...facts];
    $('#art-facts').innerHTML = all.length ? all.map(f => `<li>${esc(f)}</li>`).join('') : '<li class="dim">No details found.</li>';
  };
  renderFacts();

  // about + links from MusicBrainz / Wikipedia (slower, fills in when ready)
  const ext = await externalArtist(a);
  if (ART.cur !== id) return;
  $('#art-about').innerHTML = ext.wiki
    ? `${esc(ext.wiki.text)}${ext.wiki.url ? ` <a href="${esc(ext.wiki.url)}" target="_blank" rel="noopener">Read more on Wikipedia ↗</a>` : ''}`
    : '<span class="dim">No bio found for this artist.</span>';
  const mb = ext.mb, more = [];
  if (mb) {
    const kind = mb.type === 'Group' ? 'Group' : mb.type === 'Person' ? 'Solo artist' : mb.type;
    const from = mb.area?.name || mb['begin-area']?.name;
    if (kind || from) more.push([kind, from && 'from ' + from].filter(Boolean).join(' ') + '.');
    const b = mb['life-span']?.begin?.slice(0, 4), e = mb['life-span']?.ended ? mb['life-span']?.end?.slice(0, 4) : null;
    if (b) more.push(mb.type === 'Person' ? `Born ${mb['life-span'].begin}.` : `Active since ${b}${e ? `, until ${e}` : ''}.`);
    if (mb.disambiguation) more.push(mb.disambiguation.charAt(0).toUpperCase() + mb.disambiguation.slice(1) + '.');
  }
  renderFacts(more);
  if (ext.links.length) {
    $('#art-links-sec').hidden = false;
    $('#art-links').innerHTML = ext.links.map(l => `<a class="btn sm" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.kind)} ↗</a>`).join('');
  }
}
function setupArtistWindow() {
  // it was open: open it again on the same artist (its details are kept for a week: no requests)
  // (once it's known which service plays: a YouTube Music / SoundCloud artist is shown by name)
  if (LS.get('shown', {}).art) {
    winEl('art').classList.add('hidden');
    S.svcChosen.then(() => { if (YT.on) { const w = LS.get('artLastWeb'); if (w?.name) openWebArtist(w); } else if (LS.get('artLast')) openArtistInfo(LS.get('artLast')); });
  }
  $('#np-artist').addEventListener('click', e => { const a = e.target.closest('.art-name-link'); if (!a) return; YT.on ? openWebArtist({ name: a.dataset.name }) : openArtistInfo(a.dataset.id); });
}

/* ------------------------------------------------------------------ smart placement for pop-up windows
   (Artist, Now Playing): open next to the player in a spot that is free and fully on screen,
   unless you've already dragged that window somewhere yourself. */
function markMoved(k) { if (k) { const m = LS.get('moved', {}); m[k] = true; LS.set('moved', m); } }
function wasMoved(k) { return !!LS.get('moved', {})[k]; }
function rectOf(el) { return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }; }
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, d) => a.x >= d.x && a.y >= d.y && a.x + a.w <= d.x + d.w && a.y + a.h <= d.y + d.h;
function fitOnScreen(el) {
  const d = displayOf(el) || primaryDisplay();
  const r = rectOf(el);
  const x = Math.min(Math.max(r.x, d.x), Math.max(d.x, d.x + d.w - r.w));
  const y = Math.min(Math.max(r.y, d.y), Math.max(d.y, d.y + d.h - r.h));
  if (x !== r.x || y !== r.y) { el.style.left = x + 'px'; el.style.top = y + 'px'; savePos(); }
}
function placeFree(el) {
  const others = WINS.map(winEl).filter(o => o !== el && !o.classList.contains('hidden')).map(rectOf);
  const W = el.offsetWidth, H = el.offsetHeight, GAP = 6;
  const home = displayOf(winEl('main')) || primaryDisplay();
  const ds = [home, ...displays().filter(d => d !== home)];
  // try right of / below / left of each visible window, on the player's screen first
  const spots = [];
  for (const o of others) spots.push([o.x + o.w + GAP, o.y], [o.x, o.y + o.h + GAP], [o.x - W - GAP, o.y]);
  for (const d of ds) {
    for (const [x, y] of spots) {
      const r = { x, y, w: W, h: H };
      if (inside(r, d) && !others.some(o => overlaps(r, o))) { el.style.left = x + 'px'; el.style.top = y + 'px'; savePos(); return; }
    }
  }
  // no free spot: centre it on the player's screen, fully visible
  el.style.left = Math.round(home.x + Math.max(0, (home.w - W) / 2)) + 'px';
  el.style.top = Math.round(home.y + Math.max(0, (home.h - H) / 2)) + 'px';
  savePos();
}

/* ------------------------------------------------------------------ pixel font
   A small hand-drawn 5-pixel-high font (Soranix's own), drawn as crisp squares so labels
   look like classic pixel art. Lowercase is shown as small capitals. Text with characters it
   doesn't have (Japanese, Arabic, emoji...) falls back to the normal font. */
const PXF = (() => {
  const g = {
    A: '.#.|#.#|###|#.#|#.#', B: '##.|#.#|##.|#.#|##.', C: '.##|#..|#..|#..|.##', D: '##.|#.#|#.#|#.#|##.',
    E: '###|#..|##.|#..|###', F: '###|#..|##.|#..|#..', G: '.##|#..|#.#|#.#|.##', H: '#.#|#.#|###|#.#|#.#',
    I: '###|.#.|.#.|.#.|###', J: '..#|..#|..#|#.#|.#.', K: '#.#|#.#|##.|#.#|#.#', L: '#..|#..|#..|#..|###',
    M: '#...#|##.##|#.#.#|#...#|#...#', N: '#..#|##.#|#.##|#..#|#..#', O: '.#.|#.#|#.#|#.#|.#.',
    P: '##.|#.#|##.|#..|#..', Q: '.#.|#.#|#.#|#.#|.##', R: '##.|#.#|##.|#.#|#.#', S: '.##|#..|.#.|..#|##.',
    T: '###|.#.|.#.|.#.|.#.', U: '#.#|#.#|#.#|#.#|###', V: '#.#|#.#|#.#|#.#|.#.', W: '#...#|#...#|#.#.#|##.##|#...#',
    X: '#.#|#.#|.#.|#.#|#.#', Y: '#.#|#.#|.#.|.#.|.#.', Z: '###|..#|.#.|#..|###',
    0: '###|#.#|#.#|#.#|###', 1: '.#.|##.|.#.|.#.|###', 2: '##.|..#|.#.|#..|###', 3: '##.|..#|.#.|..#|##.',
    4: '#.#|#.#|###|..#|..#', 5: '###|#..|##.|..#|##.', 6: '.##|#..|###|#.#|###', 7: '###|..#|.#.|.#.|.#.',
    8: '###|#.#|###|#.#|###', 9: '###|#.#|###|..#|##.',
    ' ': '..|..|..|..|..', '.': '.|.|.|.|#', ',': '.|.|.|#|#', ':': '.|#|.|#|.', ';': '.|#|.|#|#',
    '-': '...|...|###|...|...', '+': '...|.#.|###|.#.|...', '=': '...|###|...|###|...', '_': '...|...|...|...|###',
    '/': '..#|..#|.#.|#..|#..', '\\': '#..|#..|.#.|..#|..#', '(': '.#|#.|#.|#.|.#', ')': '#.|.#|.#|.#|#.',
    '[': '##|#.|#.|#.|##', ']': '##|.#|.#|.#|##', '*': '...|#.#|.#.|#.#|...', "'": '#|#|.|.|.', '"': '#.#|#.#|...|...|...',
    '!': '#|#|#|.|#', '?': '##.|..#|.#.|...|.#.', '&': '.#.|#.#|.#.|#.#|.##', '%': '#.#|..#|.#.|#..|#.#',
    '#': '#.#|###|#.#|###|#.#', '<': '..#|.#.|#..|.#.|..#', '>': '#..|.#.|..#|.#.|#..', '@': '###|#.#|#.#|#..|.##',
    '~': '....|.#.#|#.#.|....|....', '|': '#|#|#|#|#', '$': '.##|##.|.#.|.##|##.',
  };
  const out = {};
  for (const [ch, rows] of Object.entries(g)) out[ch] = rows.split('|');
  return out;
})();
/* SVG for text in the pixel font, or null if a character isn't in it. */
function pxSVG(text, bold = false) {
  let x = 0, d = '';
  for (const raw of String(text)) {
    const glyph = PXF[raw.toUpperCase()];
    if (!glyph) return null;
    const w = glyph[0].length;
    glyph.forEach((row, y) => {
      for (let c = 0; c < w; c++) if (row[c] === '#') d += `M${x + c} ${y}h${bold ? 2 : 1}v1h-${bold ? 2 : 1}z`;
    });
    x += w + (bold ? 2 : 1);
  }
  const W = Math.max(1, x - 1);
  return `<svg class="pxs" width="${W}" height="5" viewBox="0 0 ${W} 5" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
}
/* Put text into an element using the pixel font (falls back to normal text). */
function setPx(el, text, bold = el?.dataset?.pxBold === '1') {
  if (!el) return;
  text = String(text ?? '');
  el.dataset.txt = text;
  el.setAttribute('aria-label', text);
  const svg = text === '' ? '' : pxSVG(text, bold);
  if (svg === null) { el.classList.add('pxfallback'); el.textContent = text; }
  else { el.classList.remove('pxfallback'); el.innerHTML = svg; }
}
/* Static labels marked data-px in the page. */
function setupPixelText() {
  $$('[data-px]').forEach(el => setPx(el, el.dataset.px || el.textContent));
}

/* ------------------------------------------------------------------ resizable windows, columns, sidebar
   Library, Now Playing, Artist: drag the right edge, bottom edge or bottom-right corner.
   Playlist: drag its bottom-right corner (classic style). Main and EQ keep their fixed classic
   size (use Size in the menu). Sizes are remembered; Settings > Reset puts everything back. */
const RESIZABLE = { lib: [480, 300], lyr: [260, 280], art: [340, 320], md: [320, 240] };
function applySizes() {
  const sz = LS.get('sizes', {});
  for (const k of Object.keys(RESIZABLE)) {
    const el = winEl(k);
    if (sz[k]) { el.style.width = sz[k][0] + 'px'; el.style.height = sz[k][1] + 'px'; }
  }
  if (sz.pl) { $('#w-pl .zoom').style.width = sz.pl[0] + 'px'; $('#pllist').style.height = sz.pl[1] + 'px'; }
  if (sz.qu) { $('#w-qu .zoom').style.width = sz.qu[0] + 'px'; $('#qu-list').style.height = sz.qu[1] + 'px'; }
  const tw = LS.get('treeW'); if (tw) $('.treecol').style.width = tw + 'px';
}
function saveSize(k, w, h) { const sz = LS.get('sizes', {}); sz[k] = [Math.round(w), Math.round(h)]; LS.set('sizes', sz); markMoved(k); }
function dragResize(handle, onMove, onDone) {
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY;
    const move = ev => onMove(ev.clientX - sx, ev.clientY - sy);
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); onDone?.(); savePos(); };
    onMove.start?.();
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  });
}
function setupResizing() {
  for (const [k, [minW, minH]] of Object.entries(RESIZABLE)) {
    const el = winEl(k);
    for (const dir of ['r', 'b', 'rb']) {
      const h = document.createElement('div');
      h.className = 'rz rz-' + dir; el.appendChild(h);
      let w0, h0;
      const mv = (dx, dy) => {
        if (dir.includes('r')) el.style.width = Math.max(minW, w0 + dx) + 'px';
        if (dir.includes('b')) el.style.height = Math.max(minH, h0 + dy) + 'px';
        if (k === 'lyr' && LYR.lines) padLyrics();
      };
      mv.start = () => { w0 = el.offsetWidth; h0 = el.offsetHeight; };
      dragResize(h, mv, () => { saveSize(k, el.offsetWidth, el.offsetHeight); if (k === 'lyr') LYR.cur = -2; });
    }
  }
  // playlist: classic grip in the bottom-right corner; sizes in drawn pixels (the window is zoomed)
  const z = $('#w-pl .zoom'), list = $('#pllist');
  const grip = document.createElement('div'); grip.className = 'plgrip'; grip.title = 'Drag to resize'; z.appendChild(grip);
  let pw0, ph0;
  const pmv = (dx, dy) => {
    const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1;
    z.style.width = Math.max(275, Math.round(pw0 + dx / k)) + 'px';
    list.style.height = Math.max(58, Math.round(ph0 + dy / k)) + 'px';
  };
  pmv.start = () => { pw0 = z.offsetWidth; ph0 = list.offsetHeight; };
  dragResize(grip, pmv, () => saveSize('pl', z.offsetWidth, list.offsetHeight));
  // queue: same classic grip
  {
    const qz = $('#w-qu .zoom'), ql = $('#qu-list');
    const qg = document.createElement('div'); qg.className = 'plgrip'; qg.title = 'Drag to resize'; qz.appendChild(qg);
    let qw0, qh0;
    const qmv = (dx, dy) => {
      const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1;
      qz.style.width = Math.max(275, Math.round(qw0 + dx / k)) + 'px';
      ql.style.height = Math.max(33, Math.round(qh0 + dy / k)) + 'px';
    };
    qmv.start = () => { qw0 = qz.offsetWidth; qh0 = ql.offsetHeight; };
    dragResize(qg, qmv, () => saveSize('qu', qz.offsetWidth, ql.offsetHeight));
  }
  // library sidebar divider
  const split = $('#libsplit'), tree = $('.treecol');
  let tw0;
  const smv = dx => { tree.style.width = Math.min(420, Math.max(140, tw0 + dx)) + 'px'; };
  smv.start = () => { tw0 = tree.offsetWidth; };
  dragResize(split, smv, () => LS.set('treeW', tree.offsetWidth));
  applySizes();
}
function resetWindows() {
  LS.del('sizes'); LS.del('moved'); LS.del('pos');
  for (const k of Object.keys(RESIZABLE)) { winEl(k).style.width = ''; winEl(k).style.height = ''; }
  $('#w-pl .zoom').style.width = ''; $('#pllist').style.height = '';
  $('#w-qu .zoom').style.width = ''; $('#qu-list').style.height = '';
  layoutDefault();
  if (isShown('lyr')) placeLyrics();
  if (isShown('art')) placeArtistWin();
  if (LYR.lines) { padLyrics(); LYR.cur = -2; }
  showMsg('WINDOWS RESET TO DEFAULT', 2000);
}
/* table columns: drag the little grip at the right edge of a column header */
function applyColWidths(kind) {
  const ths = $$('#grid thead th');
  let saved = LS.get('cols', {})[kind];
  // the number column also holds a cover: widths saved before that borrow the room from the title
  if (kind === 'track' && saved?.length > 1 && rowArt()) { saved = saved.slice(); const d = Math.max(0, 64 - saved[0]); saved[0] += d; saved[1] = Math.max(80, saved[1] - d); }
  const table = $('#grid');
  if (saved && saved.length === ths.length) {
    ths.forEach((th, i) => { th.style.width = saved[i] + 'px'; });
    table.style.width = saved.reduce((a, b) => a + b, 0) + 'px';
  } else { ths.forEach(th => { th.style.width = ''; }); table.style.width = ''; }
  ths.forEach((th, i) => {
    const g = th.querySelector('.colrz'); if (!g) return;
    let widths;
    const mv = dx => {
      widths[i] = Math.max(30, widths.start[i] + dx);
      ths.forEach((t, j) => { t.style.width = widths[j] + 'px'; });
      table.style.width = widths.reduce((a, b) => a + b, 0) + 'px';
    };
    mv.start = () => { widths = ths.map(t => t.offsetWidth); widths.start = widths.slice(); };
    dragResize(g, mv, () => {
      const all = LS.get('cols', {}); all[kind] = widths.slice(0, ths.length); LS.set('cols', all);
    });
  });
}
function resetColumns() { LS.del('cols'); if (L.view) renderView(); showMsg('COLUMN WIDTHS RESET', 1500); }

/* ------------------------------------------------------------------ docking
   Windows count as docked when they touch edge to edge (a pixel or two of slack) and overlap
   along that edge. The group is every window reachable from the start window that way. */
function touching(a, b, slack = 2) {
  const A = rectOf(a), B = rectOf(b);
  const overlapY = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y) > slack;
  const overlapX = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) > slack;
  const nearX = Math.abs(A.x + A.w - B.x) <= slack || Math.abs(B.x + B.w - A.x) <= slack;
  const nearY = Math.abs(A.y + A.h - B.y) <= slack || Math.abs(B.y + B.h - A.y) <= slack;
  return (nearX && overlapY) || (nearY && overlapX);
}
function dockedGroup(start) {
  const all = $$('.win').filter(o => !o.classList.contains('hidden'));
  const group = [start];
  for (let i = 0; i < group.length; i++)
    for (const o of all) if (!group.includes(o) && touching(group[i], o)) group.push(o);
  return group;
}

/* ------------------------------------------------------------------ About box */
async function showAbout() {
  // the real version (the one in package.json, same as the updater and the GitHub release)
  const ver = APP_VERSION || (await window.desktop?.appVersion?.().catch(() => '')) || '';
  winAlert([
    `SORANIX ${ver}`.trim(),
    'A classic-style desktop music player for your Spotify account.',
    '',
    'UNOFFICIAL SOFTWARE',
    'Soranix is an unofficial, fan-made project for personal use. It is not made, endorsed or supported by Spotify. "Spotify" is a trademark of Spotify AB.',
    '',
    'WHAT YOU NEED',
    '- A Spotify Premium account (needed for playback through Spotify\'s Web Playback SDK)',
    '- Your own Spotify developer app (Client ID), since Spotify only allows a handful of users per app in development mode',
    '',
    'KEYBOARD',
    'Space: play / pause      Ctrl+Right / Ctrl+Left: next / previous',
    'Ctrl+S shuffle   Ctrl+R repeat   Ctrl+Up / Ctrl+Down volume   Ctrl+Shift+Down mute',
    'Ctrl+K or Ctrl+L: search Spotify   Ctrl+F: search inside the open playlist / Liked Songs',
    'Ctrl+N new playlist   Alt+Left / Alt+Right back / forward   Ctrl+P settings',
    'Classic keys: Z prev  X play  C pause  V stop  B next  S shuffle  R repeat  L library',
    'Left / Right: seek 5 s      Up / Down: volume',
    'Playlist window: Enter plays, Del removes, Ctrl+A selects all',
    'While you type in a box, keys go to the box (Ctrl+K / L / F just jump to search)',
    '',
    'TIPS',
    '- Drag a window next to another to dock it; dragging the main player\'s title bar moves everything docked to it',
    '- The logo button (bottom right) shows / hides the Spotify library',
    '- Right-click songs and playlists for more options',
    '- Click the time display to switch elapsed / remaining; click the visualizer to change its style',
    '- Library, Now Playing, Artist and Playlist windows can be resized; columns too',
    '- Menu > Settings resets window positions, sizes and column widths',
    '',
    'GOOD TO KNOW',
    '- Balance really pans Soranix\'s sound (left / right) through Windows',
    '- Up Next (the UP button) shows what plays next: double-click a song to jump to it',
    '- Spotify limits how many requests an app may make, so Soranix keeps copies of your playlists and lists on this PC and asks Spotify as rarely as it can. If Spotify asks to wait, saved copies keep working',
    '- Updates: Soranix checks for new versions and asks before installing (Settings > Check for updates)',
    '- Windows media controls, media keys and the taskbar preview buttons control Soranix too',
    '- Your login and settings are stored only on this PC. Troubleshooting log: %APPDATA%\\Soranix\\soranix.log',
    '',
    'CREDITS',
    'Music and playback: Spotify Web API and Web Playback SDK',
    'Lyrics: LRCLIB (lrclib.net)',
    'Artist info: MusicBrainz and Wikipedia',
    'Similar music: Deezer (related artists)',
    'Visualizer: Butterchurn (MilkDrop presets)',
    'Desktop app: Electron (castLabs build with Widevine)',
    'github.com/mixooo/Soranix',
  ].join('\n'), { title: 'ABOUT SORANIX', ok: 'Close', wide: true });
}

/* ------------------------------------------------------------------ real sound for the visualizers
   The desktop app listens to what the PC is playing (Windows loopback) and analyses it locally.
   If Spotify's protected audio turns out to be silent in that capture, the visualizers fall back
   to the simulated beat. */
const AUD = { ctx: null, src: null, an: null, freq: null, time: null, tried: false, ok: false, heardAt: 0 };
async function startAudioCapture() {
  if (AUD.tried) return AUD.ok;
  AUD.tried = true;
  if (!window.desktop || !navigator.mediaDevices?.getDisplayMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    stream.getVideoTracks().forEach(t => t.stop()); // only the sound is used
    const tracks = stream.getAudioTracks();
    if (!tracks.length) throw new Error('no sound track');
    AUD.ctx = new AudioContext();
    AUD.src = AUD.ctx.createMediaStreamSource(new MediaStream(tracks));
    AUD.an = AUD.ctx.createAnalyser(); AUD.an.fftSize = 2048; AUD.an.smoothingTimeConstant = 0.55;
    AUD.src.connect(AUD.an); // analysed only, never played back
    AUD.freq = new Uint8Array(AUD.an.frequencyBinCount); AUD.time = new Uint8Array(AUD.an.fftSize);
    AUD.ok = true;
    console.log('[audio] listening to system sound');
  } catch (e) { console.log('[audio] system sound capture not available:', e.message); }
  return AUD.ok;
}
/* true while the capture actually hears something (checked a few times a second) */
function audioLive() {
  if (!AUD.ok) return false;
  AUD.an.getByteTimeDomainData(AUD.time);
  let peak = 0;
  for (let i = 0; i < AUD.time.length; i += 8) peak = Math.max(peak, Math.abs(AUD.time[i] - 128));
  if (peak > 2) AUD.heardAt = performance.now();
  return performance.now() - AUD.heardAt < 1500;
}
function drawRealVis(c, W, H) {
  if (S.visMode === 2) return;
  if (S.visMode === 1) {
    c.fillStyle = '#00e000';
    for (let x = 0; x < W; x++) {
      const v = (AUD.time[Math.floor(x / W * AUD.time.length)] - 128) / 128;
      c.fillRect(x, Math.round(H / 2 + v * (H / 2 - 1)), 1, 1);
    }
    return;
  }
  AUD.an.getByteFrequencyData(AUD.freq);
  const N = 19, bins = AUD.freq.length, lo = 2, hi = Math.floor(bins * 0.7);
  for (let i = 0; i < N; i++) {
    // log-spaced bands, bass on the left like the classic analyser
    const a = Math.floor(lo * Math.pow(hi / lo, i / N)), b = Math.max(a + 1, Math.floor(lo * Math.pow(hi / lo, (i + 1) / N)));
    let m = 0; for (let k = a; k < b; k++) m = Math.max(m, AUD.freq[k]);
    const target = Math.min(1, m / 230);
    vis.bars[i] = target > vis.bars[i] ? target : Math.max(0, vis.bars[i] - 0.06);
    vis.peaks[i] = vis.bars[i] > vis.peaks[i] ? vis.bars[i] : Math.max(0, vis.peaks[i] - 0.012);
    const bh = Math.round(vis.bars[i] * H), x = i * 4;
    for (let y = 0; y < bh; y++) { const f = y / H; c.fillStyle = f > 0.8 ? '#e02000' : f > 0.55 ? '#e0c000' : '#00c000'; c.fillRect(x, H - 1 - y, 3, 1); }
    if (vis.peaks[i] > 0.02) { c.fillStyle = '#a8a8c8'; c.fillRect(x, H - 1 - Math.round(vis.peaks[i] * (H - 1)), 3, 1); }
  }
}
if (window.desktop) setTimeout(() => startAudioCapture(), 1500);

/* ------------------------------------------------------------------ MilkDrop (Butterchurn)
   Butterchurn is an open-source WebGL remake of MilkDrop that runs the original presets. */
const MD = { vis: null, presets: null, names: [], idx: 0, auto: LS.get('mdAuto', true), autoAt: 0, raf: 0, size: '', fake: null, full: null };
function loadScript(src) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some(s => s.src.endsWith(src))) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}
/* Without real sound, feed MilkDrop a silent made-up beat so it still moves with the music. */
function fakeAudio(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
  const g = ctx.createGain(); g.gain.value = 0;
  noise.connect(lp); lp.connect(g); noise.start();
  setInterval(() => {
    const playing = S.track && !S.paused && !S.stopped, t = performance.now() / 1000;
    const beat = Math.exp(-((t * 1000) % 500) / 120);
    g.gain.setTargetAtTime(playing ? 0.25 + beat * 0.75 : 0, ctx.currentTime, 0.02);
  }, 30);
  return g;
}
async function ensureMilkdrop() {
  if (MD.vis) return true;
  const msg = $('#md-msg');
  msg.textContent = 'Loading MilkDrop...';
  try {
    await loadScript('vendor/butterchurn.min.js');
    await loadScript('vendor/butterchurnPresets.min.js');
    await loadScript('vendor/butterchurnPresetsExtra.min.js');
  } catch (e) { msg.textContent = 'MilkDrop could not load: ' + e.message; return false; }
  const bc = window.butterchurn?.default || window.butterchurn;
  const pk = x => (x?.default || x)?.getPresets?.() || {};
  MD.presets = Object.assign({}, pk(window.butterchurnPresets), pk(window.butterchurnPresetsExtra));
  MD.names = Object.keys(MD.presets).sort((a, b) => a.localeCompare(b));
  await startAudioCapture();
  const ctx = AUD.ctx || new AudioContext();
  const cv = $('#mdcv');
  const w = Math.max(64, cv.clientWidth), h = Math.max(48, cv.clientHeight);
  cv.width = Math.round(w * devicePixelRatio); cv.height = Math.round(h * devicePixelRatio);
  // Butterchurn draws in real screen pixels: give it the canvas's pixel size
  try { MD.vis = bc.createVisualizer(ctx, cv, { width: cv.width, height: cv.height, pixelRatio: 1, textureRatio: 1 }); }
  catch (e) { msg.textContent = 'Your graphics card did not start WebGL: ' + e.message; return false; }
  if (AUD.src) MD.vis.connectAudio(AUD.src); else MD.vis.connectAudio(MD.fake = fakeAudio(ctx));
  MD.size = w + 'x' + h;
  msg.textContent = '';
  mdPreset(Math.floor(Math.random() * MD.names.length), 0);
  return true;
}
function mdPreset(i, blend = 2.7) {
  if (!MD.vis || !MD.names.length) return;
  MD.idx = (i + MD.names.length) % MD.names.length;
  const name = MD.names[MD.idx];
  try { MD.vis.loadPreset(MD.presets[name], blend); } catch (e) { console.log('[milkdrop] preset failed', name, e.message); }
  $('#md-name').textContent = name; $('#md-name').title = name;
  MD.autoAt = performance.now();
}
let mdLast = 0;
function mdFrame(now) {
  if (!MD.vis || !isShown('md')) { MD.raf = 0; return; }
  if (document.visibilityState === 'hidden' || now - mdLast < 1000 / 60 - 2) { MD.raf = requestAnimationFrame(mdFrame); return; }
  mdLast = now;
  const cv = $('#mdcv'), w = cv.clientWidth, h = cv.clientHeight, key = w + 'x' + h;
  if (key !== MD.size && w > 0 && h > 0) {
    MD.size = key; cv.width = Math.round(w * devicePixelRatio); cv.height = Math.round(h * devicePixelRatio);
    MD.vis.setRendererSize(cv.width, cv.height);
  }
  if (MD.auto && performance.now() - MD.autoAt > 20000) mdPreset(Math.floor(Math.random() * MD.names.length));
  try { MD.vis.render(); } catch {}
  MD.raf = requestAnimationFrame(mdFrame);
}
async function toggleMilkdrop(on = !isShown('md')) {
  showWin('md', on);
  if (!on) { if (MD.full) mdFullscreen(false); return; }
  const w = winEl('md');
  if (!wasMoved('md')) placeFree(w); else fitOnScreen(w);
  if (await ensureMilkdrop() && !MD.raf) MD.raf = requestAnimationFrame(mdFrame);
}
/* Settings > Lyrics on the visualizer: the line being sung floats over MilkDrop (also in
   fullscreen), karaoke style. Lyrics come from LRCLIB like the Now Playing window (and share
   its saved copies), so this costs no Spotify requests. Off by default. */
const VL = { on: LS.get('mdLyrics', false), key: null, lines: null, cur: -2, size: 0 };
function setVisLyrics(on) {
  VL.on = on; LS.set('mdLyrics', on); VL.cur = -2;
  $('#md-lyr').classList.toggle('on', false);
  showMsg(on ? 'LYRICS ON THE VISUALIZER: ON' : 'LYRICS ON THE VISUALIZER: OFF', 2000);
}
async function visLyricsLoad(t) {
  const key = t.uri;
  VL.key = key; VL.lines = null; VL.cur = -2;
  let j = LYR.cache.get(key);
  if (j === undefined) {
    const info = { name: t.name, artist: t.artists?.[0]?.name || '', album: t.album?.name || '', dur: S.dur || t.duration_ms || 0 };
    try { j = YT.on ? await ytLyrics(t, info) : await fetchLyrics(info); LYR.cache.set(key, j); } catch { j = null; }
  }
  if (VL.key === key) VL.lines = j && !j.instrumental ? j.limusic || parseLRC(j.syncedLyrics) : [];
}
function visLyricsTick() {
  const box = $('#md-lyr');
  const show = VL.on && isShown('md') && !!S.track && !S.stopped;
  if (!show) { if (box.classList.contains('on')) box.classList.remove('on'); return; }
  if (VL.key !== S.track.uri) { visLyricsLoad(S.track); }
  const L2 = VL.lines;
  if (!L2 || !L2.length) { if (box.classList.contains('on')) box.classList.remove('on'); return; }
  // text size follows the stage, so fullscreen gets big lyrics
  const h = $('#md-stage').clientHeight, size = Math.round(Math.max(13, Math.min(64, h / 11)));
  if (size !== VL.size) { VL.size = size; box.style.setProperty('--lyr-size', size + 'px'); }
  const pos = curPos() + LYR_BASE + LYR.offset;
  let i = -1;
  for (let k = 0; k < L2.length && L2[k].t <= pos; k++) i = k;
  if (i === VL.cur) return;
  VL.cur = i;
  const cur = i >= 0 ? L2[i].text.trim() : '', nxt = (L2[i + 1]?.text || '').trim();
  box.classList.add('on');
  $('.cur', box).textContent = cur || (i >= 0 ? '\u266A' : '');
  $('.nxt', box).textContent = nxt;
}

/* "Fullscreen": the window fills the screen it is on; Esc or double-click to go back. */
function mdFullscreen(on = !MD.full) {
  const w = winEl('md');
  if (on) {
    const d = displayOf(w) || primaryDisplay();
    MD.full = { l: w.style.left, t: w.style.top, w: w.style.width, h: w.style.height };
    Object.assign(w.style, { left: d.x + 'px', top: d.y + 'px', width: d.w + 'px', height: d.h + 'px' });
    w.classList.add('md-full'); focusWin(w);
  } else if (MD.full) {
    Object.assign(w.style, { left: MD.full.l, top: MD.full.t, width: MD.full.w, height: MD.full.h });
    MD.full = null; w.classList.remove('md-full');
  }
  $('#md-full').textContent = MD.full ? 'Exit fullscreen' : 'Fullscreen';
}
function setupMilkdrop() {
  // it was open: open it again (after switching between Spotify and YouTube Music, or a restart)
  if (LS.get('shown', {}).md) { winEl('md').classList.add('hidden'); setTimeout(() => toggleMilkdrop(true), 0); }
  $('#md-prev').onclick = () => mdPreset(MD.idx - 1);
  $('#md-next').onclick = () => mdPreset(MD.idx + 1);
  $('#md-rand').onclick = () => mdPreset(Math.floor(Math.random() * MD.names.length));
  $('#md-auto').classList.toggle('on', MD.auto);
  $('#md-auto').onclick = () => { MD.auto = !MD.auto; LS.set('mdAuto', MD.auto); $('#md-auto').classList.toggle('on', MD.auto); MD.autoAt = performance.now(); };
  $('#md-full').onclick = () => mdFullscreen();
  $('#md-stage').addEventListener('dblclick', () => mdFullscreen());
  addEventListener('keydown', e => { if (e.key === 'Escape' && MD.full) { mdFullscreen(false); e.preventDefault(); } }, true);
  // opened last time? reopen it
  if (isShown('md')) { winEl('md').classList.add('hidden'); toggleMilkdrop(true); }
}

/* Settings > Always on top: Soranix's windows stay above other apps (clicks elsewhere still
   go to the app behind). Remembered after restarts. */
function setOnTop(on) {
  LS.set('onTop', on);
  updateClutter();
  window.desktop?.setOnTop?.(on);
  showMsg(on ? 'ALWAYS ON TOP: ON' : 'ALWAYS ON TOP: OFF', 1800);
}

/* ------------------------------------------------------------------ Up Next (Spotify's queue)
   Loaded once per song change (and when the window opens or you press RELOAD), so it costs
   Spotify's rate limits almost nothing. */
const UPN = { items: [], timer: 0, loading: false, at: 0 };
function upNextSoon(ms = 1200) { clearTimeout(UPN.timer); UPN.timer = setTimeout(loadUpNext, ms); }
/* What plays next, worked out here when the song is from Soranix's playlist (or a mix) and
   shuffle is off: your queued songs first, then the rest of the list. No request needed.
   Otherwise (shuffle, or music started elsewhere) Spotify is asked. */
function localUpNext() {
  if (!S.track) return QU.items.slice();   // nothing playing here: only what you queued
  if (S.shuffle) return null;
  // (YouTube Music: while a queued song plays, the playlist goes on after the song before it)
  const i = plIndexOfCurrent() >= 0 ? plIndexOfCurrent() : YT.on && S.now[S.plCur] ? S.plCur : -1; if (i < 0) return null;
  // only songs of the service you're on (a mixed playlist's others play after a switch)
  // (SoundCloud Go+ songs, which are skipped, aren't coming up)
  const mine = t => svcOfRow(t) === curRow() && !(t.mvt === 'SNIP' && svcOfRow(t) === 'sc');
  const rest = S.now.slice(i + 1).filter(mine).slice(0, 30);
  if (S.repeat === 1 && rest.length < 30) rest.push(...S.now.slice(0, i + 1).filter(mine).slice(0, 30 - rest.length));
  return [...QU.items.filter(mine), ...rest];
}
async function loadUpNext(fromSpotify = false) {
  if ((!S.me && !YT.on) || !(isShown('eq') || isShown('qu')) || UPN.loading) return;
  const local = !fromSpotify && localUpNext();
  if (local) {
    const seen = new Set([S.track?.uri, songKey({ name: S.track?.name, artist: S.track?.artists?.[0]?.name })]);
    UPN.items = local.filter(t => { if (!t?.uri) return false; const k = songKey(t); if (seen.has(t.uri) || seen.has(k)) return false; seen.add(t.uri); seen.add(k); return true; });
    UPN.at = Date.now();
    renderUpNext(); renderQueue();
    return;
  }
  if (pausedFor('/me/player/queue') > 0) return; // Spotify asked us to wait
  UPN.loading = true;
  try {
    const j = await api('/me/player/queue');
    // Spotify pads its queue by repeating songs (short list, repeat on), so show each song once,
    // and not the one that's playing right now
    const seen = new Set();
    const cur = j?.currently_playing;
    if (cur?.uri) { seen.add(cur.uri); seen.add(songKey({ name: cur.name, artist: cur.artists?.[0]?.name || cur.show?.name })); }
    UPN.items = (j?.queue || []).map(t => (t?.type === 'episode'
      ? { type: 'track', uri: t.uri, id: t.id, name: t.name, artist: t.show?.name || '', album: '', dur: t.duration_ms, episode: true, img: t.images?.at(-1)?.url }
      : { ...mapTrack(t), img: t?.album?.images?.at(-1)?.url })).filter(t => {
      if (!t || !t.uri) return false;
      const k = songKey(t);
      if (seen.has(t.uri) || seen.has(k)) return false;
      seen.add(t.uri); seen.add(k);
      return true;
    });
    UPN.at = Date.now();
    pruneQueue(UPN.items);
  } catch (e) { console.log('[upnext]', e.message); }
  UPN.loading = false;
  renderUpNext(); renderQueue();
}
function renderUpNext() {
  const box = $('#upn-list');
  // (still connecting at start: nothing yet, rather than a "connect" message for a moment)
  if (!S.me && !YT.on) { box.innerHTML = LS.get('token') ? '' : '<div class="upn-empty">Connect Spotify to see what plays next.</div>'; setPx($('#upn-count'), ''); return; }
  if (!UPN.items.length) { box.innerHTML = '<div class="upn-empty">Nothing coming up yet.<br>Play something, or right-click a song &gt; Add to queue.</div>'; setPx($('#upn-count'), '0 NEXT'); return; }
  box.innerHTML = UPN.items.map((t, i) =>
    `<div class="upn-row" data-i="${i}" title="${esc(t.artist)} - ${esc(t.name)}">` +
    (t.img ? `<img src="${esc(t.img)}" alt="" loading="lazy">` : '<span class="upn-noimg">\u266A</span>') +
    `<span class="t">${i + 1}. ${esc(t.artist)} - ${esc(t.name)}</span><span class="d">${fmt(t.dur)}</span></div>`).join('');
  setPx($('#upn-count'), `${UPN.items.length} NEXT`);
}
/* Jump to a queued song: if it's in the Soranix playlist, play it from there (keeps the
   order); otherwise skip forward to it. */
async function jumpUpNext(i) {
  const t = UPN.items[i]; if (!t || !ready()) return;
  const k = S.now.findIndex(x => x.uri === t.uri);
  if (k >= 0) return playIndex(k);
  showMsg('SKIPPING TO ' + t.name.toUpperCase(), 2000);
  for (let n = 0; n <= i; n++) { await S.player.nextTrack(); await sleep(250); }
}
function setupUpNext() {
  const box = $('#upn-list');
  let sel = -1;
  box.onclick = e => {
    const r = e.target.closest('.upn-row'); if (!r) return;
    sel = +r.dataset.i;
    $$('.upn-row', box).forEach(x => x.classList.toggle('sel', +x.dataset.i === sel));
  };
  box.ondblclick = e => { const r = e.target.closest('.upn-row'); if (r) jumpUpNext(+r.dataset.i); };
  box.addEventListener('contextmenu', e => {
    const r = e.target.closest('.upn-row'); if (!r) return;
    songMenu(e, [UPN.items[+r.dataset.i]], { from: 'lib' });
  });
  $('#upn-refresh').onclick = () => { showMsg('RELOADING UP NEXT FROM SPOTIFY', 1000); loadUpNext(true); };
  $('#upn-add').onclick = () => { showWin('lib', true); if (S.me) $('#q').focus(); };
  $('#upn-queue').onclick = () => toggleQueueWin(true);
  // load when the window is opened
  new MutationObserver(() => { if (isShown('eq') && Date.now() - UPN.at > 5000) upNextSoon(100); })
    .observe(winEl('eq'), { attributes: true, attributeFilter: ['class'] });
  renderUpNext();
  setTimeout(() => upNextSoon(100), 3000);
}

/* ------------------------------------------------------------------ Queue (songs you added)
   Spotify's queue mixes the songs you add with the rest of what's playing, and doesn't say which
   is which, so Soranix remembers what you add here. A song leaves the list once it starts
   playing (or once it's no longer in Spotify's queue, e.g. cleared in the Spotify app). */
const QU = { items: LS.get('myQueue', []) };
/* same song? Spotify sometimes swaps in another copy of a song (different id), so also
   compare title + first artist */
const songKey = t => ((t?.name || '') + '|' + ((t?.artist || t?.artists?.[0]?.name || '').split(',')[0])).toLowerCase().trim();
const sameSong = (a, b) => !!a && !!b && (a.uri === b.uri || (b.linked_from?.uri && a.uri === b.linked_from.uri) || songKey(a) === songKey(b));
// (YouTube Music mode has a queue of its own: the two never mix)
function saveQueue() { LS.set(YT.on ? W().queue : 'myQueue', QU.items); }
function queuePlayed(t) {
  if (!t) return;
  const i = QU.items.findIndex(x => sameSong(x, { ...t, artist: t.artists?.map(a => a.name).join(', ') }));
  if (i >= 0) { QU.items.splice(0, i + 1); saveQueue(); renderQueue(); }
}
function pruneQueue(spotifyQueue) {
  // keep only songs Spotify still has queued (in order, counting duplicates)
  const left = spotifyQueue.slice();
  const keep = QU.items.filter(x => { const k = left.findIndex(t => sameSong(x, t)); if (k < 0) return false; left.splice(k, 1); return true; });
  // borrow the cover picture from Spotify's queue list for songs added without one
  for (const x of keep) if (!x.img) { const m = spotifyQueue.find(t => sameSong(x, t) && t.img); if (m) { x.img = m.img; saveQueue(); } }
  if (keep.length !== QU.items.length) { QU.items = keep; saveQueue(); }
}
function renderQueue() {
  const box = $('#qu-list'); if (!box) return;
  if (!QU.items.length) {
    box.innerHTML = '<div class="upn-empty">No songs queued.<br>Right-click any song &gt; Add to queue (Q).</div>';
    setPx($('#qu-count'), ''); return;
  }
  const total = QU.items.reduce((a, t) => a + (t.dur || 0), 0);
  box.innerHTML = QU.items.map((t, i) =>
    `<div class="upn-row" data-i="${i}" title="${esc(t.artist)} - ${esc(t.name)}">` +
    (t.img ? `<img src="${esc(t.img)}" alt="" loading="lazy">` : '<span class="upn-noimg">\u266A</span>') +
    `<span class="t">${i + 1}. ${esc(t.artist)} - ${esc(t.name)}</span><span class="d">${fmt(t.dur)}</span></div>`).join('');
  setPx($('#qu-count'), `${QU.items.length} QUEUED ${fmt(total)}`);
}
/* Jump to a queued song: skip forward through Spotify's queue until it plays. */
async function jumpQueue(i) {
  const t = QU.items[i]; if (!t || !ready()) return;
  if (YT.on) { QU.items.splice(0, i); saveQueue(); renderQueue(); return ytPlayQueued(); }
  const k = UPN.items.findIndex(x => sameSong(t, x));
  showMsg('SKIPPING TO ' + t.name.toUpperCase(), 2000);
  for (let n = 0; n <= Math.max(0, k); n++) { await S.player.nextTrack(); await sleep(250); }
}
function toggleQueueWin(on = !isShown('qu')) {
  showWin('qu', on);
  if (!on) return;
  const w = winEl('qu');
  if (!wasMoved('qu')) placeFree(w); else fitOnScreen(w);
  renderQueue(); upNextSoon(100);
}
function setupQueueWin() {
  const box = $('#qu-list');
  let sel = -1;
  box.onclick = e => {
    const r = e.target.closest('.upn-row'); if (!r) return;
    sel = +r.dataset.i; $$('.upn-row', box).forEach(x => x.classList.toggle('sel', +x.dataset.i === sel));
  };
  box.ondblclick = e => { const r = e.target.closest('.upn-row'); if (r) jumpQueue(+r.dataset.i); };
  box.addEventListener('contextmenu', e => {
    const r = e.target.closest('.upn-row'); if (!r) return;
    songMenu(e, [QU.items[+r.dataset.i]], { from: 'lib' });
  });
  $('#qu-add').onclick = () => { showWin('lib', true); if (S.me) $('#q').focus(); };
  $('#qu-clear').onclick = async () => {
    if (!QU.items.length) return;
    if (!await winConfirm('Forget the songs in this list?\n\nSpotify doesn\'t let apps remove songs from its queue, so they will still play; they just won\'t be listed here.', { title: 'CLEAR QUEUE LIST', ok: 'Clear' })) return;
    QU.items = []; saveQueue(); renderQueue();
  };
  renderQueue();
  // was open last time: opened again once the monitors are known (where it was, on its own monitor)
  if (LS.get('shown', {}).qu) { winEl('qu').classList.add('hidden'); Promise.race([S.displaysReady, sleep(1500)]).then(() => toggleQueueWin(true)); }
}

/* ------------------------------------------------------------------ Discord activity
   The Discord button (next to shuffle) shows "Listening to Spotify / YouTube Music / SoundCloud"
   on your Discord profile, like Discord's own Spotify activity: the song, artist, cover, a
   progress bar and the service's logo. The title is the name of a Discord application, one per
   service, that you make in Discord's Developer Portal (Settings > Discord activity takes their
   ids). Nothing is sent while paused or stopped, and only to the Discord app on this PC. */
const DCA = { on: LS.get('discord', false), last: '', sentAt: 0, warned: '', cleared: false };
const DC_LOGO = 'https://raw.githubusercontent.com/mixooo/Soranix/main/icons/';
const DC_LOGOS = { spotify: DC_LOGO + 'discord-spotify.png', ytm: DC_LOGO + 'discord-ytm.png', sc: DC_LOGO + 'discord-sc.png' };
const dcSvc = () => (YT.on ? YT.svc : 'spotify');
const dcAppId = () => String(LS.get('discordApps', {})[dcSvc()] || '').trim();
function dcActivity() {
  const t = S.track;
  if (!t || S.paused || S.stopped) return null;
  const pos = curPos(), dur = S.dur || 0, now = Date.now();
  const txt = x => { x = String(x || '').slice(0, 128); return x.length < 2 ? (x + '  ').slice(0, 2) : x; };   // (Discord wants 2-128 characters)
  const cover = (t.album?.images || []).reduce((m, i) => (!m || (i.width || 0) > (m.width || 0) ? i : m), null)?.url || '';
  const a = { type: 2, details: txt(t.name), state: txt((t.artists || []).map(x => x.name).join(', ')), assets: {} };
  if (dur) a.timestamps = { start: Math.round(now - pos), end: Math.round(now - pos + dur) };
  if (/^https:\/\//.test(cover) && cover.length <= 256) { a.assets.large_image = cover; if (t.album?.name) a.assets.large_text = txt(t.album.name); }
  // (no small service logo for YouTube Music / SoundCloud: the title already says which)
  if (DC_LOGOS[dcSvc()] && !YT.on) { a.assets.small_image = DC_LOGOS[dcSvc()]; a.assets.small_text = SVC_NAME[dcSvc()]; }
  return a;
}
const DC_SAY = {
  'no-discord': 'DISCORD ISN\'T RUNNING - OPEN IT TO SHOW YOUR ACTIVITY',
  'refused': 'DISCORD DIDN\'T ACCEPT THE APP ID - CHECK SETTINGS > DISCORD ACTIVITY',
  'bad-id': 'THAT DISCORD APP ID DOESN\'T LOOK RIGHT - CHECK SETTINGS > DISCORD ACTIVITY',
};
async function dcUpdate(force = false) {
  if (!DCA.on || !window.desktop?.discord) return;
  const id = dcAppId();
  // no app id for this service: an activity left from the other service is taken away
  if (!id) { if (!DCA.cleared) { DCA.cleared = true; DCA.last = ''; window.desktop.discord('', null).catch(() => {}); } return; }
  DCA.cleared = false;
  const act = dcActivity();
  // sent only when what it shows changes: the song, play / pause, a jump in position (Discord takes
  // at most 5 changes in 20 seconds)
  const key = act ? `${act.details}|${act.state}|${Math.round((act.timestamps?.start || 0) / 4000)}` : 'none';
  if (!force && (key === DCA.last || Date.now() - DCA.sentAt < 4000)) return;
  DCA.last = key; DCA.sentAt = Date.now();
  const r = await window.desktop.discord(id, act).catch(() => 'no-discord');
  if (r === 'ok') DCA.warned = '';
  else { DCA.last = ''; if (DCA.warned !== r) { DCA.warned = r; showMsg(DC_SAY[r] || 'DISCORD: ' + r, 4000); } }
}
setInterval(() => dcUpdate(false), 2000);
function toggleDiscord() {
  if (!window.desktop?.discord) return showMsg('DISCORD ACTIVITY NEEDS THE DESKTOP APP', 2500);
  if (!DCA.on && !dcAppId()) { showMsg(`ADD THE DISCORD APP ID FOR ${SVC_NAME[dcSvc()].toUpperCase()} FIRST`, 3000); return discordSettings(); }
  DCA.on = !DCA.on; LS.set('discord', DCA.on);
  $('#tog-dc').classList.toggle('on', DCA.on);
  DCA.last = ''; DCA.warned = ''; DCA.cleared = false;
  if (DCA.on) { showMsg('DISCORD ACTIVITY: ON', 1800); dcUpdate(true); }
  else { showMsg('DISCORD ACTIVITY: OFF', 1800); window.desktop.discord('', null).catch(() => {}); }
}
async function discordSettings() {
  const ids = LS.get('discordApps', {});
  const r = await winDialog({ title: 'DISCORD ACTIVITY', wide: true, ok: 'Save',
    message: 'Your Discord profile can show "Listening to ..." with the song, cover and a progress bar. The title is the name of a Discord application, so make one per service:\n\n' +
      '1. Open discord.com/developers/applications and press New Application.\n' +
      '2. Name it exactly as the title should read: YouTube Music, SoundCloud or Spotify.\n' +
      '3. Copy its Application ID (General Information) into the matching box below.\n\n' +
      'Leave a box empty to show nothing in that mode. (Spotify: Discord already shows your Spotify listening by itself when Spotify is connected in Discord > Settings > Connections.) Then press the Discord button next to shuffle.',
    fields: [
      { label: 'YouTube Music app ID', value: ids.ytm || '', placeholder: 'e.g. 1234567890123456789' },
      { label: 'SoundCloud app ID', value: ids.sc || '', placeholder: 'e.g. 1234567890123456789' },
      { label: 'Spotify app ID (optional)', value: ids.spotify || '', placeholder: 'leave empty to use Discord\'s own Spotify activity' },
    ] });
  if (!r) return;
  const clean = v => String(v || '').replace(/\D/g, '');
  LS.set('discordApps', { ytm: clean(r[0]), sc: clean(r[1]), spotify: clean(r[2]) });
  showMsg('DISCORD APP IDS SAVED', 1800);
  DCA.last = ''; DCA.warned = ''; DCA.cleared = false;
  if (DCA.on) dcUpdate(true);
}

/* ------------------------------------------------------------------ mini mode
   The player as one slim bar (song, time, buttons, volume, position), for a corner of a second
   screen. The other windows are only hidden, not closed, and come back where they were; windows
   docked to the player move along if the bar was moved. Remembered after restarts. */
const MINI = { on: false };
function toggleMini(on = !MINI.on, save = true) {
  const m = winEl('main');
  if (on === MINI.on) return;
  if (on) {
    if (m.classList.contains('shaded')) toggleShade(m, false);
    const group = dockedGroup(m).filter(w => w !== m).map(w => w.dataset.win);
    LS.set('mini', { on: true, group, x: m.offsetLeft, y: m.offsetTop });
  }
  MINI.on = on;
  m.classList.toggle('minibar', on);
  document.body.classList.toggle('mini-mode', on);
  if (!on) {
    // the bar was moved: windows that were docked to the player come along
    const st = LS.get('mini', {}), dx = m.offsetLeft - (st.x ?? m.offsetLeft), dy = m.offsetTop - (st.y ?? m.offsetTop);
    if (dx || dy) for (const k of st.group || []) { const w = winEl(k); if (!w) continue; w.style.left = (w.offsetLeft + dx) + 'px'; w.style.top = (w.offsetTop + dy) + 'px'; }
    LS.set('mini', { on: false });
    focusWin(m);
    if (save) { savePos(); keepVisible(); }
  }
  MINI.timeKey = MINI.textKey = '';
  reportPlayer(); reportShape();
  if (save && on) showMsg('MINI MODE  -  CTRL+M OR DOUBLE-CLICK FOR THE FULL PLAYER', 2500);
}
function setupMini() {
  for (const b of $$('.mini-body .mb')) { b.innerHTML = ICON[b.dataset.m]; b.onclick = () => T[b.dataset.m](); }
  $('#mini-time').onclick = () => { S.remaining = !S.remaining; LS.set('remaining', S.remaining); };
  $('#mini-marq').ondblclick = () => toggleMini(false);
  hDrag($('#mvol'), f => setVol(Math.round(f * 100)));
  hDrag($('#mseek'), f => { if (S.track) { S.seeking = true; S.seekFrac = f; showMsg('SEEK TO: ' + fmt(f * S.dur) + '/' + fmt(S.dur)); } }, f => {
    if (!S.seeking) return;
    S.seeking = false;
    if (S.track && S.player) { const ms = f * S.dur; S.player.seek(ms); S.pos = ms; S.ts = performance.now(); }
  });
  if (LS.get('mini', {}).on) toggleMini(true, false);
}
function drawMini(now) {
  const has = !!S.track && !S.stopped;
  const ms = S.remaining ? S.dur - curPos() : curPos();
  const t = has ? (S.remaining ? '-' : '') + fmt(Math.max(0, ms)) : '';
  if (MINI.timeKey !== t) { MINI.timeKey = t; setPx($('#mini-time'), t); }
  $('#mini-time').style.visibility = has && S.paused && Math.floor(now / 500) % 2 ? 'hidden' : '';
  const box = $('#mini-marq'), span = $('#mini-text');
  const text = S.msg && now < S.msgUntil ? S.msg : updateBanner(now) || S.marqBase;
  if (MINI.textKey !== text) { MINI.textKey = text; MINI.x = 0; setPx(span, text + '  ***  ' + text); span.style.transform = ''; MINI.wide = 0; }
  if (!MINI.wide) MINI.wide = span.offsetWidth / 2 || 1;
  if (MINI.wide <= box.clientWidth) { if (span.dataset.txt !== text) setPx(span, text); }
  else if (now - (MINI.t || 0) > 140) { MINI.t = now; MINI.x = (MINI.x + 2) % MINI.wide; span.style.transform = `translateX(${-MINI.x}px)`; }
  const f = S.seeking ? S.seekFrac : S.dur ? curPos() / S.dur : 0;
  $('#mseek i').style.width = (has ? Math.max(0, Math.min(1, f)) * 100 : 0) + '%';
  $('#mvol i').style.width = S.vol + '%';
}

/* ------------------------------------------------------------------ listening counts per playlist
   Spotify doesn't tell apps how much you listen to each playlist, so Soranix counts it here: a
   song that plays 30 seconds or more from one of your playlists adds a play (and the time) to
   it. Playlists > By you can then be sorted by Most listened or Recently listened. Costs no
   requests; once, the last 50 plays from Spotify (Recently Played, 1 request) give it a head start. */
const PLAYS = { counts: LS.get('plPlays', {}), cur: null };
const PL_SORTS = [['', 'Spotify order'], ['most', 'Most listened'], ['recent', 'Recently listened']];
function notePlayContext(s, t) {
  // Spotify names the playlist when it plays one itself; when Soranix hands it the songs (its
  // playlist window, a mix) the context is "webapi", and the songs remember their playlist instead
  PLAYS.cur = t ? { uri: t.uri, ctx: /^spotify:playlist:/.test(s?.context?.uri || '') ? s.context.uri : '', counted: false } : null;
}
function countPlayTick() {
  const c = PLAYS.cur;
  if (!c || c.counted || !S.track || S.track.uri !== c.uri || S.paused || curPos() < 30000) return;
  const ctx = c.ctx || S.now.find(x => x.uri === c.uri)?.ctx || '';
  const m = /^spotify:playlist:(\w+)$/.exec(ctx);
  c.counted = true;
  if (!m) return;
  c.id = m[1];
  const e = PLAYS.counts[c.id] || (PLAYS.counts[c.id] = { n: 0, last: 0 });
  e.n++; e.last = Date.now();
  LS.set('plPlays', PLAYS.counts);
  if (LIBX.byYou && LS.get('plSort', '')) renderTree();
}
setInterval(countPlayTick, 5000);
async function seedPlayCounts() {
  if (LS.get('plPlaysSeeded', false) || !S.me) return;
  LS.set('plPlaysSeeded', true);
  try {
    const j = await api('/me/player/recently-played?limit=50');
    for (const it of j?.items || []) {
      const m = /^spotify:playlist:(\w+)$/.exec(it.context?.uri || ''); if (!m) continue;
      const e = PLAYS.counts[m[1]] || (PLAYS.counts[m[1]] = { n: 0, last: 0 });
      e.n++; e.last = Math.max(e.last, Date.parse(it.played_at) || 0);
    }
    LS.set('plPlays', PLAYS.counts);
    renderTree();
  } catch { LS.del('plPlaysSeeded'); }
}
function sortByListening(pls) {
  const mode = LS.get('plSort', '');
  if (!mode) return pls;
  const k = p => PLAYS.counts[p.id] || { n: 0, last: 0 };
  // never played from Soranix: below the rest, in Spotify's order
  return pls.map((p, i) => [p, i]).sort(([a, i], [b, j]) => {
    const x = k(a), y = k(b);
    const d = mode === 'most' ? (y.n - x.n) || (y.last - x.last) : (y.last - x.last) || (y.n - x.n);
    return d || i - j;
  }).map(([p]) => p);
}

/* ------------------------------------------------------------------ roll up (window shade)
   A rolled-up window shows only its title bar. Windows docked underneath it (directly or in a
   chain) slide up to close the gap, and back down when it unrolls, so everything stays docked.
   Remembered after restarts. */
function toggleShade(w, on = !w.classList.contains('shaded'), save = true) {
  if (w.dataset.win === 'main' && MINI.on) return toggleMini(false); // double-click on the mini bar: full player
  if (w.classList.contains('shaded') === on) return;
  const before = w.offsetHeight, top = w.offsetTop, bottom = top + before;
  // windows stacked underneath it: touching its bottom edge (and overlapping it sideways),
  // then whatever is stacked under those, and so on
  const all = $$('.win').filter(o => o !== w && !o.classList.contains('hidden'));
  const below = [];
  for (let i = -1; i < below.length; i++) {
    const a = rectOf(i < 0 ? w : below[i]);
    for (const o of all) {
      if (below.includes(o)) continue;
      const b = rectOf(o);
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (Math.abs(a.y + a.h - b.y) <= 2 && overlapX > 2) below.push(o);
    }
  }
  w.classList.toggle('shaded', on);
  const delta = w.offsetHeight - before;
  for (const o of below) o.style.top = Math.round(o.offsetTop + delta) + 'px';
  if (save) {
    const sh = LS.get('shadedWins', {}); sh[w.dataset.win] = on; LS.set('shadedWins', sh);
    savePos();
  }
  reportPlayer(); reportShape();
  if (w.dataset.win === 'lyr' && !on && LYR.lines) { padLyrics(); LYR.cur = -2; }
}
function restoreShades() {
  const sh = LS.get('shadedWins', {});
  for (const k of WINS) if (sh[k]) winEl(k).classList.add('shaded'); // positions were saved rolled up
}

/* ------------------------------------------------------------------ O A I D V (the little letters left of the time)
   O options menu, A always on top, I song info, D double size, V visualization menu. */
const isDouble = () => (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1) > crispZoom(1) + 0.01;
function updateClutter() {
  const el = k => document.querySelector(`.clutter [data-cl="${k}"]`);
  el('a')?.classList.toggle('on', !!LS.get('onTop', false));
  el('d')?.classList.toggle('on', isDouble());
}
function visMenu(e) {
  const pick = m => { S.visMode = m; LS.set('visMode', m); showMsg('VISUALIZER: ' + ['BARS', 'SCOPE', 'OFF'][m]); };
  openMenu(e, [
    { label: 'Spectrum analyzer (bars)', check: S.visMode === 0, fn: () => pick(0) },
    { label: 'Oscilloscope', check: S.visMode === 1, fn: () => pick(1) },
    { label: 'Off', check: S.visMode === 2, fn: () => pick(2) },
    '-',
    { label: isShown('md') ? 'Close MilkDrop' : 'Open MilkDrop', fn: () => toggleMilkdrop() },
    { label: 'MilkDrop fullscreen', disabled: !isShown('md'), fn: () => mdFullscreen(true) },
    { label: 'MilkDrop: random preset', disabled: !MD.vis, fn: () => mdPreset(Math.floor(Math.random() * MD.names.length)) },
    { label: 'MilkDrop: change preset every 20 s', check: MD.auto, fn: () => $('#md-auto').click() },
  ]);
}
async function showSongInfo() {
  const t = S.track;
  if (!t) return showMsg('NOTHING IS PLAYING', 1500);
  const id = t.id || idOf(t.uri);
  let d = null;
  // a song's details never change: ask Spotify once, then keep them
  d = await DB.get('track:' + id);
  if (!d) {
    try {
      const x = await api('/tracks/' + id);
      const a = x.album || {};
      d = { artists: (x.artists || []).map(r => ({ name: r.name })), track_number: x.track_number, disc_number: x.disc_number, duration_ms: x.duration_ms, explicit: x.explicit,
        external_ids: { isrc: x.external_ids?.isrc }, album: { name: a.name, release_date: a.release_date, album_type: a.album_type, total_tracks: a.total_tracks, images: a.images } };
      DB.set('track:' + id, d);
    } catch (e) { /* show what the player already knows */ }
  }
  const al = d?.album || {};
  const date = al.release_date || '';
  const nice = date.length === 10 ? new Date(date + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : date;
  const kind = { album: 'Album', single: 'Single', compilation: 'Compilation' }[al.album_type] || '';
  const lines = [
    t.name,
    (d?.artists || t.artists || []).map(a => a.name).join(', '),
    '',
    'Album:      ' + (al.name || t.album?.name || '?') + (kind ? `  (${kind})` : ''),
    'Released:   ' + (nice || '?'),
    'Track:      ' + (d?.track_number ? `${d.track_number}${al.total_tracks ? ' of ' + al.total_tracks : ''}` : '?') + (d?.disc_number > 1 ? `  (disc ${d.disc_number})` : ''),
    'Length:     ' + fmt(d?.duration_ms || S.dur),
    'Explicit:   ' + (d ? (d.explicit ? 'Yes' : 'No') : '?'),
    d?.external_ids?.isrc ? 'ISRC:       ' + d.external_ids.isrc : null,
    'Spotify:    https://open.spotify.com/track/' + id,
  ].filter(x => x !== null);
  const cover = (al.images || t.album?.images || []).reduce((m, i) => (!m || (i.width || 0) > (m.width || 0) ? i : m), null)?.url || '';
  winAlert(lines.join('\n'), { title: 'SONG INFO', ok: 'Close', cover, wide: true });
}
function setupClutter() {
  const act = {
    o: e => mainMenu(e),
    a: () => setOnTop(!LS.get('onTop', false)),
    i: () => showSongInfo(),
    d: () => { const dbl = isDouble(); setZoom(crispZoom(dbl ? 1 : 2)); showMsg(dbl ? 'DOUBLESIZE: OFF' : 'DOUBLESIZE: ON'); },
    v: e => visMenu(e),
  };
  $$('.clutter [data-cl]').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); act[el.dataset.cl](e); });
    el.addEventListener('mousedown', e => e.stopPropagation());
  });
  updateClutter();
}

/* ------------------------------------------------------------------ drag to reorder
   Press on a song and drag up or down: a green line shows where it will land. Works in the
   Soranix playlist window and in Spotify playlists you made (saved to Spotify). */
function enableReorder(box, rowSel, { canDrag = () => true, selected = () => [], onDrop, scroller = box }) {
  let st = null;
  // the green line lives on top of everything (lists get redrawn, so it can't live inside them)
  const line = document.createElement('div'); line.className = 'drop-line'; line.hidden = true;
  $('#desktop').appendChild(line);
  const rows = () => $$(rowSel, box);
  const gapAt = y => {               // index of the gap (0 = before the first row) nearest to y
    const rs = rows();
    for (let i = 0; i < rs.length; i++) { const r = rs[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return i; }
    return rs.length;
  };
  const showLine = g => {
    const rs = rows(); if (!rs.length) return;
    const sr = scroller.getBoundingClientRect();
    let y = g < rs.length ? rs[g].getBoundingClientRect().top : rs[rs.length - 1].getBoundingClientRect().bottom;
    y = Math.max(sr.top, Math.min(sr.bottom - 2, y - 1));
    Object.assign(line.style, { left: sr.left + 'px', width: sr.width + 'px', top: y + 'px' });
    line.hidden = false;
  };
  box.addEventListener('pointerdown', e => {
    const row = e.target.closest(rowSel);
    if (!row || e.button !== 0 || e.shiftKey || e.ctrlKey || !canDrag()) return;
    st = { i: +row.dataset.i, y: e.clientY, on: false };
  });
  const move = e => {
    if (!st) return;
    if (!st.on) { if (Math.abs(e.clientY - st.y) < 5) return; st.on = true; document.body.classList.add('dragging'); }
    // scroll the list when dragging near its top or bottom edge
    const sr = scroller.getBoundingClientRect();
    if (e.clientY < sr.top + 14) scroller.scrollTop -= 10; else if (e.clientY > sr.bottom - 14) scroller.scrollTop += 10;
    st.gap = gapAt(e.clientY); showLine(st.gap);
  };
  const up = () => {
    if (!st) return;
    const done = st; st = null; line.hidden = true; document.body.classList.remove('dragging');
    if (!done.on || done.gap == null) return;
    const sel = selected(); const picked = sel.includes(done.i) ? sel.slice() : [done.i];
    picked.sort((a, b) => a - b);
    // dropping right where it already is changes nothing
    const first = picked[0], last = picked[picked.length - 1];
    if (picked.length === last - first + 1 && done.gap >= first && done.gap <= last + 1) return;
    box.addEventListener('click', ev => ev.stopPropagation(), { capture: true, once: true }); // no click after a drag
    onDrop(picked, done.gap);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}
/* move items (by index) so they sit before position `gap`; returns the new list and where they went */
function moveBlock(list, idx, gap) {
  const set = new Set(idx), block = idx.map(i => list[i]);
  const rest = list.filter((_, i) => !set.has(i));
  const at = gap - idx.filter(i => i < gap).length;
  rest.splice(at, 0, ...block);
  return { list: rest, at };
}
function setupReorder() {
  // Soranix playlist window
  enableReorder($('#pllist'), '.plrow', {
    selected: () => [...S.plSel],
    onDrop: (idx, gap) => {
      const { list, at } = moveBlock(S.pl, idx, gap);
      S.pl = list; S.plSel = new Set(idx.map((_, k) => at + k)); S.plAnchor = at;
      renderPL();
      showMsg(idx.length > 1 ? `MOVED ${idx.length} SONGS` : 'MOVED: ' + S.pl[at].name.toUpperCase(), 1500);
    },
  });
  // Spotify playlists you made: reorder on Spotify too
  const ownPl = () => {
    const v = L.view; if (!v?.node?.startsWith('pl:') || v.kind !== 'track') return null;
    const p = S.playlists.find(x => 'pl:' + x.id === v.node);
    return p && S.me && (p.ownerId === S.me.id || p.collab) ? p : null;
  };
  enableReorder($('#grid tbody'), 'tr[data-i]', {
    scroller: $('.tablewrap'),
    canDrag: () => !!ownPl() && !L.view.filter && L.view.rows.every(r => r.pos != null),
    selected: () => [...L.sel],
    onDrop: async (idx, gap) => {
      const p = ownPl(), v = L.view; if (!p) return;
      // Spotify moves one continuous run of songs at a time
      const run = idx.every((x, k) => k === 0 || x === idx[k - 1] + 1) ? idx : [idx[0]];
      const rows = v.rows;
      const from = rows[run[0]].pos;
      const before = gap < rows.length ? rows[gap].pos : rows[rows.length - 1].pos + 1;
      const { list, at } = moveBlock(rows, run, gap);
      v.rows = list; L.sel = new Set(run.map((_, k) => at + k)); renderView(); // show it right away
      await act('Reorder playlist', async () => {
        const r = await api(`/playlists/${p.id}/items`, { method: 'PUT', body: { range_start: from, insert_before: before, range_length: run.length } });
        // positions follow the new order; keep Spotify's new version stamp so the saved copy stays valid
        v.rows.forEach((row, k) => { row.pos = k; });
        if (r?.snapshot_id) { updatePlaylistLocal(p, { snapshot: r.snapshot_id }); DB.set('pl:' + p.id, { snapshot: r.snapshot_id, at: Date.now(), rows: v.rows, next: v.next || null }); }
        else DB.del('pl:' + p.id);
        showMsg('PLAYLIST ORDER SAVED TO SPOTIFY', 1500);
      });
    },
  });
}

/* ------------------------------------------------------------------ search inside a list
   With Liked Songs or a playlist open, the search box finds songs in that list (title, artist
   or album). The whole list is loaded once for this, gently, then kept while the list is open. */
function listSearchable(v) {
  return !!v && v.kind === 'track' && !v.tabs && (v.node === 'liked' || !!v.node?.startsWith('pl:')) && (v.rows.length > 0 || !!v.all);
}
const norm = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function doSearch() {
  const q = $('#q').value;
  if (listSearchable(L.view)) return filterView(q);
  if (YT.on) return ytSearch(q);
  runSearch(q);
}
async function filterView(q) {
  const v = L.view; if (!v) return;
  q = q.trim();
  if (!v.all && v.node === 'liked') {
    const c = await DB.get('liked');
    if (c && Date.now() - c.at < PL_REFRESH && c.rows?.length >= v.rows.length) { v.all = c.rows.slice(); v.next = null; }
  }
  if (!v.all) {
    // load the rest of the list first (once), about 50 songs per request
    v.all = v.rows.slice();
    let pages = 0;
    while (v.next && pages++ < 60) {
      if (v.node?.startsWith('pl:') && overBudget('/playlists/x/items')) { libStatus('Loaded as much as is safe for now. Search again in a few minutes for the rest.'); break; }
      libStatus(`Loading ${v.title} to search it... ${v.all.length} songs so far`);
      try {
        const j = v.pick(await api(v.next, { bulk: true }));
        v.all.push(...(j.items || []).map((it, i) => v.map(it, (j.offset || 0) + i)).filter(Boolean));
        v.next = j.next;
      } catch (e) { libStatus('Could not load everything: ' + e.message); break; }
      if (L.view !== v) return;   // you moved to another list meanwhile
    }
    if (!v.next && v.node === 'liked') DB.set('liked', { at: Date.now(), rows: v.all });
    if (!v.next && v.node?.startsWith('pl:')) { const p = plById(v.node.slice(3)); if (p?.snapshot) DB.set(v.node, { snapshot: p.snapshot, at: Date.now(), rows: v.all }); }
  }
  if (L.view !== v) return;
  v.filter = q;
  const words = norm(q).split(/\s+/).filter(Boolean);
  v.rows = !words.length ? v.all.slice() : v.all.filter(r => {
    const hay = norm(`${r.name} ${r.artist} ${r.album}`);
    return words.every(w => hay.includes(w));
  });
  L.sel.clear();
  renderView();
  if (words.length && !v.rows.length) {
    $('#grid tbody').innerHTML = `<tr class="msg"><td colspan="5">No songs in ${esc(v.title)} match "${esc(q)}". Press Esc to see them all, or open Search Spotify to look everywhere.</td></tr>`;
  }
}

/* ------------------------------------------------------------------ saved copies (IndexedDB)
   Playlists are kept on this PC with Spotify's version stamp (snapshot_id). A playlist is only
   downloaded again when its stamp changes, so opening it is instant and costs no requests. */
const DB = (() => {
  let opening;
  const openDb = name => new Promise((res, rej) => {
    const r = indexedDB.open(name, 1); let fresh = false;
    r.onupgradeneeded = () => { fresh = true; r.result.createObjectStore('kv'); };
    r.onsuccess = () => res({ db: r.result, fresh }); r.onerror = () => rej(r.error);
  });
  const open = () => (opening ??= (async () => {
    const { db, fresh } = await openDb('soranix');
    // the app used to be called Winampify: bring its saved copies over once (no requests)
    if (fresh && ((await indexedDB.databases?.()) || []).some(d => d.name === 'winampify')) {
      try {
        const { db: old } = await openDb('winampify');
        const all = await new Promise((res, rej) => {
          const out = [], c = old.transaction('kv').objectStore('kv').openCursor();
          c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else res(out); };
          c.onerror = () => rej(c.error);
        });
        await new Promise((res, rej) => {
          const t = db.transaction('kv', 'readwrite'), st = t.objectStore('kv');
          for (const [k, v] of all) st.put(v, k);
          t.oncomplete = res; t.onerror = () => rej(t.error);
        });
        old.close(); indexedDB.deleteDatabase('winampify');
      } catch {}
    }
    return db;
  })());
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', mode), req = fn(t.objectStore('kv'));
      t.oncomplete = () => res(req?.result); t.onerror = () => rej(t.error);
    });
  };
  // when each saved item was last used (for the cleanup below)
  const used = LS.get('dbUsed', {}); let flush = 0;
  const touch = k => { used[k] = Date.now(); clearTimeout(flush); flush = setTimeout(() => LS.set('dbUsed', used), 5000); };
  return {
    used,
    get: k => run('readonly', st => st.get(k)).then(v => { if (v !== undefined) touch(k); return v; }).catch(() => undefined),
    set: (k, v) => { touch(k); return run('readwrite', st => st.put(JSON.parse(JSON.stringify(v)), k)).catch(() => {}); },
    del: k => { delete used[k]; return run('readwrite', st => st.delete(k)).catch(() => {}); },
    clear: () => { for (const k in used) delete used[k]; LS.set('dbUsed', used); return run('readwrite', st => st.clear()).catch(() => {}); },
    keys: () => run('readonly', st => st.getAllKeys()).catch(() => []),
  };
})();
function savePlaylistList() { LS.set('playlistsCache', S.playlists); }
const ago = t => {
  const m = Math.round((Date.now() - t) / 60000);
  return !t ? 'never' : m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
/* the small line under "Playlists": when they were refreshed, or how long Spotify wants us to wait */
function playlistsStatus() {
  const wait = pausedFor('/me/playlists');
  if (wait > 0) return `\u23F3 Spotify asks to wait ${Math.ceil(wait / 60000)} min${S.playlists.length ? ' (showing saved list)' : ''}`;
  return `\u27F3 Refresh  \u00B7  updated ${ago(LS.get('playlistsCacheAt', 0))}`;
}
/* Settings > Clear cache: forget every saved playlist and song list on this PC. They are
   downloaded again from Spotify the next time they're needed. */
async function clearCache() {
  await DB.clear();
  LS.del('playlistsCacheAt');
  if (L.view?.all) { L.view.all = null; L.view.filter = null; }
  const wait = pausedFor('/me/playlists');
  if (wait > 0) { renderTree(); return showMsg(`CACHE CLEARED - PLAYLISTS RELOAD IN ${Math.ceil(wait / 60000)} MIN (SPOTIFY ASKED TO WAIT)`, 4000); }
  showMsg('CACHE CLEARED - RELOADING PLAYLISTS...', 2000);
  syncPlaylists(true, true).then(() => showMsg('CACHE CLEARED', 1500)).catch(() => {}).finally(renderTree);
}
async function refreshPlaylistsNow() {
  // showing albums / artists / podcasts? refresh that list instead
  const k = LIBKEY[LIBX.filter];
  if (k && LIBX.filter !== 'playlists') {
    await DB.del('lib:' + k); LIBX[k] = null;
    showMsg('REFRESHING ' + LIBX.filter.toUpperCase() + '...', 1500);
    return setFilter(LIBX.filter);
  }
  const wait = pausedFor('/me/playlists');
  if (wait > 0) return showMsg(`SPOTIFY ASKS TO WAIT ${Math.ceil(wait / 60000)} MIN BEFORE REFRESHING PLAYLISTS`, 3500);
  const since = Date.now() - LS.get('playlistsCacheAt', 0);
  if (since < 2 * 60000) return showMsg(`PLAYLISTS WERE UPDATED ${Math.max(1, Math.round(since / 1000))} SEC AGO - ALREADY UP TO DATE`, 2500);
  if (overBudget('/me/playlists')) return showMsg('REFRESHED A LOT LATELY - SHOWING THE SAVED LIST FOR A FEW MINUTES', 3500);
  showMsg('REFRESHING PLAYLISTS...', 1500);
  try { await syncPlaylists(true, true); showMsg('PLAYLISTS UPDATED', 1500); }
  catch (e) { showMsg(e.status === 429 ? 'SPOTIFY IS BUSY - TRY AGAIN LATER' : 'COULD NOT REFRESH: ' + e.message.toUpperCase(), 3000); }
  renderTree();
}

/* ------------------------------------------------------------------ similar music after a searched song
   Play a song from Search and a mix follows it: artists related to that song's artist (Deezer's
   free public list, since Spotify no longer gives apps genres or related artists), a few songs
   each found on Spotify. How the mix is put together:
   - it stays close to the song you started from: refills mostly use artists related to that song,
     plus a couple related to what's playing now
   - the same artist never plays twice within 4 songs
   - karaoke, instrumental, live and similar versions are left out (nightcore and sped-up stay),
     unless the song you started from is one
   - a few of your Liked Songs by those artists are mixed in (from the saved copy: no requests)
   - songs a mix played in the last 3 days are skipped (it remembers the last 200)
   - skip an artist's song in the first 30 seconds and the mix plays less of them; skip twice
     and they're dropped from this mix
   Related artists and their songs are kept on this PC for a week. */
const RADIO = { on: false, busy: false, resync: false, now: false, idx: -1, syncing: false, seen: new Set(), seed: '', seedTrack: null, down: {}, last: null };
const radioEnabled = () => LS.get('songRadio', true);
const shuffleArr = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const WEEK = 7 * 864e5;
const primaryArtist = t => t?.artists?.[0]?.name || (t?.artist || '').split(',')[0].trim();
async function relatedArtists(name) {
  const key = 'rel:' + norm(name);
  const c = await DB.get(key); if (c && Date.now() - c.at < WEEK) return c.names;
  const J = async u => { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
  try {
    const s = await J('https://api.deezer.com/search/artist?limit=10&q=' + encodeURIComponent(name));
    // same name, and the best-known one if several artists share it
    const a = (s.data || []).filter(x => norm(x.name) === norm(name)).sort((x, y) => (y.nb_fan || 0) - (x.nb_fan || 0))[0];
    const names = a ? ((await J(`https://api.deezer.com/artist/${a.id}/related?limit=20`)).data || []).map(x => x.name) : [];
    DB.set(key, { at: Date.now(), names });
    return names;
  } catch (e) { console.log('[mix] related artists:', e.message); return []; }
}
async function songsBy(name) {
  const key = 'by:' + norm(name);
  const c = await DB.get(key); if (c && Date.now() - c.at < WEEK) return c.rows;
  const j = await api(`/search?q=${encodeURIComponent(`artist:"${name}"`)}&type=track&limit=10`, { bulk: true });
  const rows = (j?.tracks?.items || []).filter(t => t.artists?.some(a => norm(a.name) === norm(name))).map(t => mapTrack(t)).filter(Boolean);
  DB.set(key, { at: Date.now(), rows });
  return rows;
}
/* versions that rarely belong in a mix (nightcore and sped-up are fine) */
const ODD_VERSION = /\b(karaoke|instrumental|a ?cappella|acapella|originally performed|in the style of|tribute to|backing track|music box|lullaby)\b/i;
const LIVE_VERSION = /(\(|\[|- )live\b|\blive (at|in|from|on)\b|\(live\)/i;
function fitsMix(t) {
  const seed = RADIO.seedTrack || {};
  const me = `${t.name} ${t.album}`, them = `${seed.name || ''} ${seed.album || ''}`;
  if (ODD_VERSION.test(me) && !ODD_VERSION.test(them)) return false;
  if (LIVE_VERSION.test(me) && !LIVE_VERSION.test(them)) return false;
  return true;
}
/* what mixes played lately: song -> when (the last 200) */
function notePlayed(t) {
  const h = LS.get('mixHistory', {});
  h[songKey(t)] = Date.now();
  for (const k of Object.keys(h).sort((a, b) => h[b] - h[a]).slice(200)) delete h[k];
  LS.set('mixHistory', h);
}
async function likedBy(names) {
  const c = await DB.get('liked'); if (!c?.rows) return [];
  const want = new Set(names.map(norm));
  return c.rows.filter(r => (r.artists || []).some(a => want.has(norm(a.name))) || want.has(norm(primaryArtist(r))));
}
/* order songs so no artist comes back within 4 songs (counting what's already queued) */
function spreadArtists(list, before = []) {
  const left = list.slice(), out = [], placed = before.map(t => norm(primaryArtist(t)));
  const art = t => norm(primaryArtist(t));
  while (left.length) {
    const recent = new Set(placed.slice(-4));
    const remaining = {}; left.forEach(t => { remaining[art(t)] = (remaining[art(t)] || 0) + 1; });
    let pick = -1;
    const allowed = left.map((t, k) => k).filter(k => !recent.has(art(left[k])));
    if (allowed.length) {
      // the artist with the most songs still waiting goes first, so nobody gets stuck at the end
      const most = Math.max(...allowed.map(k => remaining[art(left[k])]));
      const best = allowed.filter(k => remaining[art(left[k])] === most);
      pick = best[Math.floor(Math.random() * best.length)];
    } else {
      // every artist left was just played: take the one played longest ago
      const lastAt = t => placed.lastIndexOf(art(t));
      pick = left.reduce((b, t, k) => (lastAt(t) < lastAt(left[b]) ? k : b), 0);
    }
    const [t] = left.splice(pick, 1); out.push(t); placed.push(art(t));
  }
  return out;
}
async function buildMix(cur) {
  const seedName = RADIO.seed; if (!seedName) return [];
  const curName = primaryArtist(cur);
  const hist = LS.get('mixHistory', {});
  const ok = t => { const k = songKey(t); return !RADIO.seen.has(k) && !(hist[k] && Date.now() - hist[k] < 3 * 864e5) && fitsMix(t); };
  const down = n => RADIO.down[norm(n)] || 0;
  // mostly artists related to the song you started from, a couple related to what's playing now
  const fromSeed = await relatedArtists(seedName);
  const fromCur = curName && norm(curName) !== norm(seedName) ? await relatedArtists(curName) : [];
  const pool = [...new Set([...shuffleArr(fromSeed.slice(0, 15)).slice(0, 5), ...shuffleArr(fromCur.slice(0, 10)).slice(0, 2)])]
    .filter(n => down(n) < 2 && norm(n) !== norm(seedName));
  const out = [];
  for (const n of pool) {
    try { out.push(...shuffleArr((await songsBy(n)).filter(ok)).slice(0, down(n) ? 1 : 3)); }
    catch (e) { if (e.status === 429) break; }
  }
  // a couple more by the artist you started with (more if little else was found)
  if (down(seedName) < 2) { try { out.push(...shuffleArr((await songsBy(seedName)).filter(ok)).slice(0, out.length < 5 ? 6 : 2)); } catch {} }
  // a few songs you already like by these artists
  out.push(...shuffleArr((await likedBy([seedName, ...pool])).filter(ok)).slice(0, 3));
  const uniq = out.filter(t => { const k = songKey(t); if (RADIO.seen.has(k)) return false; RADIO.seen.add(k); return true; });
  return spreadArtists(uniq, S.now.slice(-4));
}
async function playWithRadio(r) {
  S.src = 'lib'; S.lib = [{ ...r }]; saveNow(); renderPL(false);
  Object.assign(RADIO, { on: true, seen: new Set([songKey(r)]), seed: primaryArtist(r), seedTrack: r, down: {}, last: null });
  extendRadio(r, true);            // start building the mix while the song starts
  await playIndex(0);
  showMsg('MAKING A MIX OF SIMILAR MUSIC...', 2500);
}
async function extendRadio(cur, now) {
  if (RADIO.busy) return; RADIO.busy = true;
  try {
    const mix = await buildMix(cur);
    if (!RADIO.on) return;
    if (!mix.length) return showMsg('NO SIMILAR MUSIC FOUND FOR THIS SONG', 2500);
    S.now.push(...mix); saveNow();
    // Spotify hears about the new songs at the end of the song that's playing (see radioHandover):
    // handing it a new list restarts playback, which in the middle of a song is an audible stutter
    RADIO.resync = true;
    showMsg(`UP NEXT: ${mix.length} SONGS LIKE ${RADIO.seed}`.toUpperCase(), 3000);
  } finally { RADIO.busy = false; }
}
/* The mix reaches Spotify in the last moment of the song that's playing: the next song starts from
   the new list (one request, as before), and nothing restarts in the middle of a song. Pressing
   Next or picking a song hands it over too (playIndex sends the whole list). */
setInterval(() => {
  if (!RADIO.on || !RADIO.resync || RADIO.syncing || S.paused || !S.track || !S.dur) return;
  if (S.dur - curPos() > 900) return;
  const i = plIndexOfCurrent(); if (i < 0 || i + 1 >= S.now.length) return;
  RADIO.syncing = true;
  Promise.resolve(playIndex(i + 1)).finally(() => { RADIO.syncing = false; upNextSoon(1500); });
}, 250);
/* skipped twice: take that artist's remaining songs out of this mix */
function dropUpcoming(artist, from) {
  const k = norm(artist);
  const before = S.now.length;
  S.now = S.now.filter((t, n) => n <= from || norm(primaryArtist(t)) !== k);
  if (S.now.length !== before) { saveNow(); renderPL(false); RADIO.resync = true; RADIO.now = true; }
}
function radioTick(changed, paused) {
  const i = plIndexOfCurrent();
  // the song before was skipped early: play less of that artist
  if (changed && RADIO.last?.inMix && RADIO.last.pos < 30000 && RADIO.last.dur > 45000) {
    const k = norm(RADIO.last.artist);
    RADIO.down[k] = (RADIO.down[k] || 0) + 1;
    console.log('[mix] skipped', RADIO.last.artist, 'x' + RADIO.down[k]);
    if (RADIO.down[k] >= 2 && i >= 0) dropUpcoming(RADIO.last.artist, i);
  }
  if (i < 0) {
    // the mix wasn't handed over in time and Spotify went on to something of its own: back to the mix
    if (changed && RADIO.resync && RADIO.idx >= 0 && RADIO.idx + 1 < S.now.length && !RADIO.syncing) { RADIO.resync = false; playIndex(RADIO.idx + 1); return; }
    if (changed) RADIO.on = false; return;   // something else is playing now
  }
  RADIO.idx = i;
  if (changed) notePlayed(S.now[i]);
  RADIO.last = { artist: primaryArtist(S.now[i]), pos: curPos(), dur: S.dur, inMix: i > 0 };
  if (changed && i >= S.now.length - 3) extendRadio(S.now[i], false);
}

/* ------------------------------------------------------------------ saved answers
   Some Spotify answers are kept on this PC (search results for a day, album tracklists for
   good, your top lists for a day). At most 400 are kept; the oldest go first. */
const DAY = 864e5;
function saveAnswer(path, j) {
  DB.set('get:' + path, { at: Date.now(), j });
  const idx = LS.get('savedAnswers', []).filter(p => p !== path);
  idx.push(path);
  while (idx.length > 400) DB.del('get:' + idx.shift());
  LS.set('savedAnswers', idx);
}
/* ------------------------------------------------------------------ Windows media controls
   The song, artist and cover show in Windows' media flyout (volume / lock screen), and its
   buttons and your keyboard's media keys control Soranix.
   The music itself plays inside Spotify's player frame, which Windows would describe only as
   "Soranix", so this page plays a silent sound alongside it: that makes Windows read the
   details from here. No Spotify requests: everything comes from the player. */
const OSM = { el: null, key: '', playing: null, posAt: 0 };
function silentTrack() {
  if (OSM.el) return OSM.el;
  const rate = 8000, n = rate, b = new ArrayBuffer(44 + n * 2), d = new DataView(b);   // 1 s of silence (WAV)
  const w = (o, s) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, rate, true); d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, n * 2, true);
  const el = document.createElement('audio');
  el.src = URL.createObjectURL(new Blob([b], { type: 'audio/wav' })); el.loop = true; el.volume = 0.01;
  document.body.appendChild(el);
  return (OSM.el = el);
}
function osMedia(changed) {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession, t = S.track;
  if (!t) { if (OSM.key) { OSM.key = ''; ms.metadata = null; ms.playbackState = 'none'; OSM.el?.pause(); } return; }
  const key = t.uri;
  if (changed || key !== OSM.key) {
    OSM.key = key;
    ms.metadata = new MediaMetadata({
      title: t.name, artist: (t.artists || []).map(a => a.name).join(', '), album: t.album?.name || '',
      artwork: (t.album?.images || []).filter(i => i?.url).map(i => ({ src: i.url, sizes: i.width ? `${i.width}x${i.height}` : '640x640', type: 'image/jpeg' })),
    });
  }
  const playing = !S.paused;
  if (playing !== OSM.playing || changed) {
    OSM.playing = playing;
    ms.playbackState = playing ? 'playing' : 'paused';
    const el = silentTrack();
    if (playing) el.play().catch(() => {}); else el.pause();
  }
  // the time bar (only when something changed or every 10 s; Windows moves it on by itself)
  if (S.dur && (changed || Date.now() - OSM.posAt > 10000)) {
    OSM.posAt = Date.now();
    try { ms.setPositionState({ duration: S.dur / 1000, position: Math.min(S.dur, curPos()) / 1000, playbackRate: 1 }); } catch {}
  }
}
function setupOsMedia() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const h = {
    play: () => { if (S.track && S.paused) S.player.resume(); else if (!S.track) T.play(); },
    pause: () => { if (S.track && !S.paused) S.player.pause(); },
    stop: () => T.stop(),
    previoustrack: () => T.prev(),
    nexttrack: () => T.next(),
    seekto: d => { if (S.track && d.seekTime != null) S.player.seek(Math.round(d.seekTime * 1000)); },
  };
  for (const [a, fn] of Object.entries(h)) { try { ms.setActionHandler(a, d => { S.activeAt = Date.now(); OSM.posAt = 0; fn(d); }); } catch {} }
}
setupOsMedia();

/* ------------------------------------------------------------------ updates
   Soranix checks GitHub for a newer release twice a day and asks before installing it. "Later"
   hides that version for a day; Settings > Check for updates asks right away. */
let APP_VERSION = '';
/* While an update downloads, the player's display takes turns: 5 seconds of the download's
   progress, 5 seconds of the song, and so on, so it's clear the update is on its way. */
const UPDL = { on: false, version: '', pct: 0, t0: 0 };
function updateBanner(now) {
  if (!UPDL.on || Math.floor((now - UPDL.t0) / 5000) % 2) return null;
  return `DOWNLOADING UPDATE${UPDL.version ? ' ' + UPDL.version : ''}: ${UPDL.pct}%`;
}
window.desktop?.appVersion?.().then(v => { APP_VERSION = v || ''; setTimeout(whatsNewAfterUpdate, 2500); });
// an update downloading while the player restarted (a switch to YouTube Music / SoundCloud and back):
// its progress shows again right away, in every mode
window.desktop?.updateProgress?.().then(d => { if (d) Object.assign(UPDL, { on: true, version: d.version || '', pct: d.pct || 0, t0: performance.now() }); }).catch(() => {});

/* What's new: on the first start after an update, the new version's release notes show once.
   They were saved when you pressed Install, so no request is needed; otherwise (installed by
   hand) they come from GitHub once and are kept. Settings > What's new shows them again. */
const notesText = md => String(md || '').replace(/\r/g, '')
  .split(/^#+\s*install\b/im)[0]                     // the install steps aren't news
  .replace(/^#+\s*/gm, '').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .split('\n').map(l => l.trim()).filter(l => l && !/^what'?s new:?$/i.test(l))
  // bullets as dots, and a gap above each heading
  .map((l, i) => (/^[-*]\s/.test(l) ? '• ' + l.slice(2) : (i ? '\n' : '') + l.toUpperCase())).join('\n');
async function notesFor(version) {
  const saved = LS.get('notes:' + version);
  if (saved) return saved;
  const r = await fetch(`https://api.github.com/repos/mixooo/Soranix/releases/tags/v${version}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error('GitHub answered ' + r.status);
  const text = notesText((await r.json()).body);
  if (text) LS.set('notes:' + version, text);
  return text;
}
async function showWhatsNew(manual = false) {
  const v = APP_VERSION;
  if (!v) return;
  let text = '';
  try { text = await notesFor(v); }
  catch (e) { if (manual) return winAlert(`The notes for Soranix ${v} couldn't be loaded (${e.message}).\n\nThey're also on github.com/mixooo/Soranix/releases`, { title: "WHAT'S NEW" }); return; }
  if (!text) { if (manual) winAlert(`No notes were published for Soranix ${v}.`, { title: "WHAT'S NEW" }); return; }
  winAlert(text, { title: `WHAT'S NEW IN SORANIX ${v}`, ok: 'Close', wide: true });
}
function whatsNewAfterUpdate() {
  const v = APP_VERSION, seen = LS.get('seenVersion');
  if (!v || seen === v) return;
  LS.set('seenVersion', v);
  // a brand-new install (nothing saved yet) doesn't need the news, only people who updated
  if (!seen && !LS.get('pos') && !LS.get('me')) return;
  // old saved notes aren't needed any more
  for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (/^spotamp\.notes:/.test(k) && k !== 'spotamp.notes:' + v) localStorage.removeItem(k); }
  showWhatsNew();
}
const plainNotes = md => String(md || '')
  .replace(/\r/g, '').replace(/^#+\s*/gm, '').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .split('\n').map(l => l.trim()).filter(l => l && !/^what'?s new:?$/i.test(l)).slice(0, 10).join('\n');
window.desktop?.onUpdate?.(async m => {
  if (m.state === 'available') {
    const later = LS.get('updLater');
    if (!m.manual && later?.version === m.version && Date.now() - later.at < DAY) return;
    const notes = plainNotes(m.notes);
    const yes = await winConfirm(
      `Soranix ${m.version} is available (you have ${m.current}).\n\n` +
      (notes ? `What's new:\n${notes}\n\n` : '') +
      `Install it now? Soranix downloads it (${m.sizeMB} MB), checks it, closes, updates and starts again.`,
      { title: 'UPDATE AVAILABLE', ok: 'Install', cancel: 'Later', wide: true });
    if (yes) { LS.set('notes:' + m.version, notesText(m.notes)); Object.assign(UPDL,{ on: true, version: m.version, pct: 0, t0: performance.now() }); window.desktop.installUpdate(); }
    else LS.set('updLater', { version: m.version, at: Date.now() });
  } else if (m.state === 'downloading') { UPDL.pct = m.pct; if (m.version) UPDL.version = m.version; if (!UPDL.on) Object.assign(UPDL, { on: true, t0: performance.now() }); }
  else if (m.state === 'installing') { UPDL.on = false; showMsg(`INSTALLING SORANIX ${m.version} - BACK IN A FEW SECONDS`, 8000); }
  else if (m.state === 'none') showMsg(`SORANIX ${m.version} IS THE LATEST VERSION`, 2500);
  else if (m.state === 'error') (UPDL.on = false), winAlert('The update could not be installed:\n' + m.message + '\n\nYou can also download it from github.com/mixooo/Soranix/releases', { title: 'UPDATE' });
});

/* buttons under the taskbar preview (point at Soranix on the taskbar) */
window.desktop?.onThumbCmd?.(cmd => {
  S.activeAt = Date.now();
  if (cmd === 'play') { if (S.track && !S.paused) return; return T.play(); }   // already playing: don't restart the song
  // from the global hotkeys
  if (cmd === 'toggle') return S.track ? T.pause() : T.play();
  if (cmd === 'volup' || cmd === 'voldown') { setVol(S.vol + (cmd === 'volup' ? 5 : -5)); return showMsg('VOLUME: ' + S.vol + '%', 1000); }
  if (T[cmd]) T[cmd]();
});
/* Settings > Lower music while someone talks: the desktop app's sound helper watches voice chat
   apps (Discord, TeamSpeak, Mumble, Teams...) and turns Soranix down while one plays sound, then
   back up. Off by default. (A game's own voice chat is part of the game's sound, so it can't be
   told apart from the game.) */
function setDuck(v, quiet = false) {
  LS.set('duck', v);
  window.desktop?.setDuck?.(v);
  if (!quiet) showMsg(v ? `VOICE CHAT: MUSIC ${v === 100 ? 'SILENT' : v + '% QUIETER'} WHILE SOMEONE TALKS` : 'VOICE CHAT DUCKING: OFF', 2500);
}
if (LS.get('duck', 0)) setDuck(LS.get('duck', 0), true);
/* Settings > Global hotkeys: Ctrl+Alt+Space play / pause, Ctrl+Alt+Right / Left next / previous,
   Ctrl+Alt+Up / Down volume, even while a game or another app has the keyboard. Off by default,
   so they never take keys a game uses. */
const GK = { got: {} };
const keyName = k => (k || '').replace(/Control/g, 'Ctrl');
async function setGlobalKeys(on, quiet = false) {
  if (!window.desktop?.globalKeys) return;
  LS.set('globalKeys', on);
  GK.got = (await window.desktop.globalKeys(on)) || {};
  if (!on) return quiet || showMsg('GLOBAL HOTKEYS OFF', 2000);
  const names = { toggle: 'Play / pause', next: 'Next', prev: 'Previous', volup: 'Volume up', voldown: 'Volume down' };
  const missing = Object.keys(names).filter(c => !GK.got[c]);
  if (quiet) return;
  winAlert('Global hotkeys are on. They work even while a game or another app is in front:\n\n' +
    Object.entries(names).map(([c, n]) => `${n}: ${GK.got[c] ? keyName(GK.got[c]) : '(taken by another program)'}`).join('\n') +
    (missing.length ? '\n\nAnother program on this PC already uses the missing keys.' : ''), { title: 'GLOBAL HOTKEYS' });
}
if (LS.get('globalKeys', false)) setGlobalKeys(true, true);
/* you're away: nothing playing and no clicks or keys for 20 minutes */
const away = () => S.paused !== false && Date.now() - (S.activeAt || Date.now()) > 20 * 60000;

/* ------------------------------------------------------------------ cleanup of saved copies
   Once a day: anything not opened for 60 days is deleted, and if Soranix's storage ever goes
   over 50 MB, the least recently used quarter goes too. */
async function cleanSaved() {
  if (Date.now() - LS.get('dbCleanAt', 0) < DAY) return;
  LS.set('dbCleanAt', Date.now());
  const keys = (await DB.keys()).map(String), now = Date.now(), used = DB.used;
  for (const k of keys) if (!used[k]) used[k] = now;           // saved before this was tracked
  for (const k of Object.keys(used)) if (!keys.includes(k)) delete used[k];
  const old = keys.filter(k => now - used[k] > 60 * DAY);
  for (const k of old) await DB.del(k);
  const est = await navigator.storage?.estimate?.().catch(() => null);
  let trimmed = 0;
  if (est?.usage > 50 * 1048576) {
    const rest = keys.filter(k => !old.includes(k)).sort((a, b) => used[a] - used[b]);
    for (const k of rest.slice(0, Math.ceil(rest.length / 4))) { await DB.del(k); trimmed++; }
  }
  LS.set('dbUsed', used);
  LS.set('savedAnswers', LS.get('savedAnswers', []).filter(p => used['get:' + p]));
  console.log('[cleanup] saved items:', keys.length, 'removed unused:', old.length, 'trimmed:', trimmed, 'storage MB:', est ? (est.usage / 1048576).toFixed(1) : '?');
}

/* ------------------------------------------------------------------ shortcut helpers */
/* Ctrl+K / Ctrl+L: search all of Spotify. Ctrl+F: search inside the open list (Liked Songs or a
   playlist); anywhere else it searches Spotify too. */
function focusSearch(where) {
  if (!S.me) return showMsg('CONNECT SPOTIFY FIRST', 2000);
  showWin('lib', true);
  if (where === 'spotify' && listSearchable(L.view)) openNode('search');
  if (where === 'list' && !listSearchable(L.view)) showMsg('OPEN LIKED SONGS OR A PLAYLIST TO SEARCH INSIDE IT', 2500);
  const q = $('#q'); q.focus(); q.select();
}
function libBack() {
  const v = L.history.pop(); if (!v) return;
  if (L.view) (L.fwd ||= []).push(L.view);
  setView(v, false);
}
function libForward() {
  const v = L.fwd?.pop(); if (!v) return;
  if (L.view) L.history.push(L.view);
  setView(v, false);
}
function toggleMute() {
  if (S.vol > 0) { S.unmuteVol = S.vol; setVol(0); showMsg('MUTED  (CTRL+SHIFT+DOWN AGAIN TO UNMUTE)', 1800); }
  else { setVol(S.unmuteVol || 50); showMsg('VOLUME: ' + S.vol + '%', 1000); }
}
/* Ctrl+P: the Settings menu, opened at the main window's options button */
function openSettingsMenu() {
  const o = $('[data-cl="o"]') || $('#w-main');
  const r = o.getBoundingClientRect();
  openMenu({ clientX: r.right, clientY: r.top }, settingsItems());
}

/* start after every section above is defined (keep this the last line) */
boot();
