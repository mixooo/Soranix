// Runs inside the hidden YouTube Music window (music.youtube.com). Soranix's player calls these
// to control playback and to read songs, the liked list and playlists. It uses YouTube Music's
// own player and the same internal API the website uses (with the website's own login).
// Only data is returned; nothing here can reach Soranix itself.
if (!window.__sx) window.__sx = (() => {
  const P = () => document.getElementById('movie_player');
  const V = () => document.querySelector('video');
  const txt = r => (r?.runs || []).map(x => x.text).join('') || r?.simpleText || '';
  const toMs = s => { const p = String(s || '').trim().split(':').map(Number); return p.length > 1 && !p.some(isNaN) ? p.reduce((a, b) => a * 60 + b, 0) * 1000 : 0; };
  const big = url => String(url || '').replace(/=w\d+-h\d+[^&?]*$/, '=w544-h544-l90-rj');
  // every object stored under `key` anywhere inside `o`
  const walk = (o, key, out = []) => {
    if (o && typeof o === 'object') {
      if (Array.isArray(o)) { for (const x of o) walk(x, key, out); return out; }
      for (const k in o) { if (k === key) out.push(o[k]); else walk(o[k], key, out); }
    }
    return out;
  };
  const pageType = run => run?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';

  async function call(endpoint, body) {
    const cfg = window.ytcfg;
    if (!cfg?.get) throw new Error('YouTube Music is still loading');
    const headers = { 'content-type': 'application/json', 'x-goog-authuser': '0', 'x-origin': location.origin };
    // signed in: the website signs its requests like this
    const sid = (document.cookie.match(/(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=([^;]+)/) || [])[1];
    if (sid) {
      const ts = Math.floor(Date.now() / 1000);
      const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${sid} ${location.origin}`));
      headers.authorization = `SAPISIDHASH ${ts}_${[...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')}`;
    }
    const r = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST', headers, credentials: 'include', body: JSON.stringify({ context: cfg.get('INNERTUBE_CONTEXT'), ...body }),
    });
    if (!r.ok) throw new Error('YouTube Music answered ' + r.status);
    return r.json();
  }

  function song(r) {
    const we = walk(r.overlay, 'watchEndpoint')[0] || walk(r.flexColumns, 'watchEndpoint')[0];
    const id = r.playlistItemData?.videoId || we?.videoId;
    if (!id) return null;
    // ATV = the audio track of a song (a still picture); OMV / UGC = a video
    const type = we?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType || '';
    const cols = (r.flexColumns || []).map(c => c.musicResponsiveListItemFlexColumnRenderer?.text);
    const runs = cols.slice(1).flatMap(c => c?.runs || []);
    let artists = runs.filter(x => /ARTIST|USER_CHANNEL/.test(pageType(x))).map(x => x.text);
    const album = runs.find(x => /ALBUM/.test(pageType(x)))?.text || '';
    const durText = txt(r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text) || runs.map(x => x.text).find(t => /^\d+:\d\d(:\d\d)?$/.test(t.trim())) || '';
    if (!artists.length) {
      // search results: "Song • Artist • Album • 3:21" (an episode: "Episode • Apr 13, 2025 • Show");
      // skip the type, lengths, dates, and view / play counts
      const parts = runs.map(x => x.text).join('').split(' • ').map(s => s.trim()).filter(Boolean);
      const a = parts.find(p => !/^(song|video|episode|podcast|playlist|album|single|ep|artist)$/i.test(p) && !/^\d+:\d\d/.test(p)
        && !/\b(views?|plays?|subscribers?|listeners?|songs?|episodes?)$/i.test(p) && !/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(p) && !/^\d{4}$/.test(p) && !/\bago$/i.test(p));
      if (a) artists = [a];
    }
    const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
    return { videoId: id, type, title: txt(cols[0]), artists, album, dur: toMs(durText), img: thumbs[0]?.url || '', imgLarge: big(thumbs.at(-1)?.url) };
  }
  const songs = j => walk(j, 'musicResponsiveListItemRenderer').map(song).filter(Boolean);
  // a cover in a shelf or grid (YouTube Music home and its "More" pages)
    const two = r => {
      const ne = r.navigationEndpoint || {}, we = ne.watchEndpoint, be = ne.browseEndpoint;
      const thumbs = r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
      const name = txt(r.title), sub = txt(r.subtitle), img = thumbs[0]?.url || '', imgLarge = big(thumbs.at(-1)?.url);
      if (we?.videoId) {
        const parts = sub.split(' • ').map(s => s.trim()).filter(s => s && !/^(song|video|single|ep|album)$/i.test(s) && !/views?$|plays?$/i.test(s));
        return { kind: 'track', videoId: we.videoId, type: we.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType || '',
          title: name, artists: parts.slice(0, 1), album: '', dur: 0, img: imgLarge || img, imgLarge };
      }
      if (be?.browseId) {
        const pt = be.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';
        return { type: /ALBUM/.test(pt) ? 'album' : /ARTIST/.test(pt) ? 'artist' : 'playlist', id: String(be.browseId).replace(/^VL/, ''), name, sub, img, imgLarge };
      }
      return null;
    };
  const cards = j => [...walk(j, 'musicTwoRowItemRenderer').map(two), ...walk(j, 'musicResponsiveListItemRenderer').map(r => (x => x && { ...x, kind: 'track' })(song(r)))].filter(Boolean);

  return {
    hello() { return { signedIn: !!window.ytcfg?.get?.('LOGGED_IN'), hasPlayer: !!P()?.getPlayerState }; },
    state() {
      const p = P(); if (!p?.getPlayerState) return null;
      // the "Video paused. Continue watching?" prompt came anyway: answered (Yes) and playing on
      const still = document.querySelector('ytmusic-you-there-renderer, yt-confirm-dialog-renderer');
      if (still && still.offsetParent !== null && /still|continue|paused/i.test(still.innerText || '')) {
        (still.querySelector('#confirm-button button, #main button, yt-button-renderer button, tp-yt-paper-button, button'))?.click();
        window.__sxStillThere = (window.__sxStillThere || 0) + 1;
        p.playVideo?.();
      }
      const d = p.getVideoData?.() || {}, v = V(), m = navigator.mediaSession?.metadata;
      return {
        id: d.video_id || '', ps: p.getPlayerState(), ad: p.classList.contains('ad-showing'),
        pos: v ? Math.round(v.currentTime * 1000) : 0, dur: v && isFinite(v.duration) ? Math.round(v.duration * 1000) : 0,
        // the video's own details are always current; the media info (album, cover) only when
        // it's about the same song (it can lag behind after a song is loaded directly)
        title: d.title || m?.title || '', artist: (d.author || m?.artist || '').replace(/ - Topic$/, ''),
        album: m && m.title === d.title ? m.album || '' : '',
        art: m && m.title === d.title ? (m.artwork || []).map(a => ({ url: a.src, size: parseInt(a.sizes) || 0 })) : [],
        signedIn: !!window.ytcfg?.get?.('LOGGED_IN'),
        adsRemoved: window.__sxAdsRemoved || 0,   // ad lists taken out of YouTube's answers (ytm-preload.js)
        stillThere: window.__sxStillThere || 0,   // "Continue watching?" prompts answered
        url: location.pathname,
        // ATV = audio-only track (a still picture), OMV / UGC = a real video
        mvType: p.getPlayerResponse?.()?.videoDetails?.musicVideoType || '',
      };
    },
    // the video's current picture, as a small JPEG (for Now Playing's Video view)
    frame(width) {
      const v = V(); if (!v || !v.videoWidth) return null;
      const w = Math.min(Number(width) || 640, v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth);
      const c = window.__sxCanvas || (window.__sxCanvas = document.createElement('canvas'));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      c.getContext('2d').drawImage(v, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.75);
    },
    // the audio track (song) of a video: YouTube Music's "Songs" search with the video's title
    // cleaned up ("Artist - Title | Lyrics (Official Video)" -> "Artist - Title")
    async songFor(title, artist) {
      // tags that only describe the upload ("(Official Video)", "[Lyrics]", "| 2016 Top Songs");
      // anything else in brackets ("(Slowed)", "(Remix)", "(Live)") is a different version and must match
      const TAG = /\s*[\(\[](official|music video|lyric|lyrics|audio|video|visualizer|hd|hq|4k|mv|m\/v)[^\)\]]*[\)\]]/gi;
      const clean = x => String(x).split(/\s+[|\u2022]\s+/)[0].replace(TAG, '')
        .replace(/\s*-?\s*(official (music )?video|lyrics?|audio)\s*$/i, '').replace(/\s+/g, ' ').trim();
      // featured artists are written differently from upload to upload, and don't make another version
      const noFeat = x => x.replace(/\s*[\(\[](feat|ft|featuring|with)\.?\s[^\)\]]*[\)\]]|\s+(feat|ft|featuring)\.?\s.*$/gi, '').trim();
      const t = clean(title), dash = /\s-\s/.test(t);
      const name = noFeat(dash ? t.split(/\s-\s/).slice(1).join(' - ') : t).toLowerCase();
      // the artist: "Artist - Title" in the title, otherwise the row's artist (often just the uploader)
      const by = (dash ? t.split(/\s-\s/)[0] : String(artist)).toLowerCase();
      const sameArtist = s => s.artists.some(a => { a = a.toLowerCase(); return a.length > 1 && (by.includes(a) || a.includes(by)); });
      const list = songs(await call('search', { query: dash ? t : `${t} ${artist}`, params: 'EgWKAQIIAWoMEA4QChADEAQQCRAF' }))
        .filter(s => s.type === 'MUSIC_VIDEO_TYPE_ATV' || !s.type);
      // only a sure match: same title (version included) and the same artist; otherwise the
      // upload itself plays (game soundtracks, slowed edits and the like often have no song)
      return list.find(s => noFeat(clean(s.title)).toLowerCase() === name && sameArtist(s)) || null;
    },
    // the music video of a song (YouTube Music's "Videos" search, best title match)
    async videoFor(title, artist) {
      const j = await call('search', { query: `${title} ${artist}`, params: 'EgWKAQIQAWoMEA4QChADEAQQCRAF' });
      const list = songs(j);
      const t = String(title).toLowerCase().replace(/\s*\(.*?\)|\s*\[.*?\]/g, '').trim();
      return list.find(s => s.title.toLowerCase().includes(t)) || list[0] || null;
    },
    play() { P()?.playVideo(); }, pause() { P()?.pauseVideo(); },
    seek(ms) { P()?.seekTo(ms / 1000, true); }, vol(v) { P()?.setVolume(v); P()?.unMute?.(); },
    next() { P()?.nextVideo(); }, prev() { P()?.previousVideo(); },
    load(id, startMs) { P()?.loadVideoById(String(id), (Number(startMs) || 0) / 1000); },
    // get a song ready without playing it (a mixed playlist switching over in a moment)
    cue(id) { P()?.cueVideoById(String(id)); return true; },
    async search(q) {
      // the "Songs" filter of YouTube Music's search
      let j = await call('search', { query: String(q), params: 'EgWKAQIIAWoMEA4QChADEAQQCRAF' });
      let out = songs(j);
      if (!out.length) out = songs(await call('search', { query: String(q) }));
      return out.slice(0, 60);
    },
    // Search by type, like YouTube Music's own filter buttons. "all" gives the mixed results.
    // Songs and videos come back as songs (see song()); albums, artists and playlists as
    // { type, id, name, sub, img }.
    async find(q, filter) {
      const P_ = { songs: 'EgWKAQIIAWoMEA4QChADEAQQCRAF', videos: 'EgWKAQIQAWoMEA4QChADEAQQCRAF', albums: 'EgWKAQIYAWoMEA4QChADEAQQCRAF',
        artists: 'EgWKAQIgAWoMEA4QChADEAQQCRAF', playlists: 'EgeKAQQoAEABagwQDhAKEAMQBBAJEAU=' };
      const j = await call('search', P_[filter] ? { query: String(q), params: P_[filter] } : { query: String(q) });
      const out = [];
      // "All": the top-result card lists songs without their artist (the card is the artist)
      const byCard = new Map();
      for (const card of walk(j, 'musicCardShelfRenderer')) for (const r of walk(card.contents, 'musicResponsiveListItemRenderer')) byCard.set(r, txt(card.title));
      for (const r of walk(j, 'musicResponsiveListItemRenderer')) {
        const be = r.navigationEndpoint?.browseEndpoint, pt = be?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';
        if (be && /ALBUM|ARTIST|PLAYLIST/.test(pt)) {
          const cols = (r.flexColumns || []).map(c => c.musicResponsiveListItemFlexColumnRenderer?.text);
          const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
          out.push({ type: /ALBUM/.test(pt) ? 'album' : /ARTIST/.test(pt) ? 'artist' : 'playlist', id: String(be.browseId || '').replace(/^VL/, ''),
            name: txt(cols[0]), sub: cols.slice(1).map(txt).filter(Boolean).join(' • '), img: thumbs[0]?.url || '', imgLarge: big(thumbs.at(-1)?.url) });
        } else {
          const s = song(r); if (!s) continue;
          if (!s.artists.length && byCard.get(r)) s.artists = [byCard.get(r)];
          out.push({ ...s, type: s.type || 'MUSIC_VIDEO_TYPE_ATV', kind: 'track' });
        }
      }
      // "All" lists songs and videos without their length or album (and episodes with a date where
      // the artist goes): one more request gets all of those for the whole list at once
      const miss = out.filter(s => s.kind === 'track' && (!s.dur || !s.album)).slice(0, 60);
      if (miss.length) {
        try {
          const info = new Map(walk(await call('music/get_queue', { videoIds: miss.map(s => s.videoId) }), 'playlistPanelVideoRenderer').map(p => [p.videoId, p]));
          for (const s of miss) {
            const p = info.get(s.videoId); if (!p) continue;
            const by = p.longBylineText?.runs || [];
            s.dur = s.dur || toMs(txt(p.lengthText));
            s.album = s.album || by.find(x => /ALBUM/.test(pageType(x)))?.text || '';
            const who = by.filter(x => /ARTIST|USER_CHANNEL|PODCAST/.test(pageType(x))).map(x => x.text);
            if (who.length) s.artists = who;
          }
        } catch {}
      }
      return out.slice(0, 60);
    },
    // YouTube Music's home page, the way its Discover view (and Limusic's) shows it: shelves like
    // "Listen again", "Mixed for you", "Albums for you", each a row of covers. Songs and videos
    // come back as songs; albums, playlists and artists as { type, id, name, sub, img }.
    async home() {
      const shelves = [];
      const take = j => {
        for (const sh of walk(j, 'musicCarouselShelfRenderer')) {
          const title = txt(sh.header?.musicCarouselShelfBasicHeaderRenderer?.title);
          const items = (sh.contents || []).map(c => c.musicTwoRowItemRenderer ? two(c.musicTwoRowItemRenderer)
            : c.musicResponsiveListItemRenderer ? (s => s && { ...s, kind: 'track' })(song(c.musicResponsiveListItemRenderer)) : null).filter(Boolean);
          // its "More" button leads to a page with the whole section
          const more = sh.header?.musicCarouselShelfBasicHeaderRenderer?.moreContentButton?.buttonRenderer?.navigationEndpoint?.browseEndpoint;
          if (title && items.length) shelves.push({ title, items, more: more ? { id: more.browseId, params: more.params || '' } : null });
        }
      };
      let j = await call('browse', { browseId: 'FEmusic_home' }); take(j);
      // the page loads more shelves as you scroll: a few more of those
      for (let n = 0; n < 4; n++) {
        const tok = walk(j, 'nextContinuationData')[0]?.continuation; if (!tok) break;
        j = await call('browse', { continuation: tok }); take(j);
      }
      return shelves;
    },
    // what you played lately (YouTube Music's History page): more for "Listen again"
    async history() { return songs(await call('browse', { browseId: 'FEmusic_history' })).map(s => ({ ...s, kind: 'track' })); },
    // more of a home section: its "More" page (first time), then that page's next part each time
    async shelfMore(id, params, next) {
      const j = next ? await call('browse', { continuation: String(next) }) : await call('browse', params ? { browseId: String(id), params: String(params) } : { browseId: String(id) });
      return { items: cards(j), next: walk(j, 'nextContinuationData')[0]?.continuation || walk(j, 'continuationCommand')[0]?.token || null };
    },
    // an album's songs (they share its cover) and an artist's songs (their page's song list)
    async album(id) { return songs(await call('browse', { browseId: String(id) })); },
    // an artist's songs: their page only lists the top 5, so its "Top songs" link is followed to the
    // full list (100 a page; up to 300), like the website's See all
    async artist(id) {
      const j = await call('browse', { browseId: String(id) });
      const sh = walk(j, 'musicShelfRenderer')[0];
      const all = sh?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || sh?.bottomEndpoint?.browseEndpoint?.browseId;
      if (!all) return songs(j);
      let page = await call('browse', { browseId: all });
      const out = songs(page);
      for (let n = 0; n < 2; n++) {
        const tok = walk(page, 'continuationCommand')[0]?.token || walk(page, 'nextContinuationData')[0]?.continuation;
        if (!tok) break;
        page = await call('browse', { continuation: tok });
        out.push(...songs(page));
      }
      const seen = new Set();
      return (out.length ? out : songs(j)).filter(s => !seen.has(s.videoId) && seen.add(s.videoId));
    },
    // the signed-in account: its name and @handle, as the website's account menu shows them
    async account() {
      const h = walk(await call('account/account_menu', {}), 'activeAccountHeaderRenderer')[0];
      return h ? { name: txt(h.accountName), handle: txt(h.channelHandle) } : null;
    },
    async liked() { return songs(await call('browse', { browseId: 'VLLM' })); },
    async playlists() {
      const j = await call('browse', { browseId: 'FEmusic_liked_playlists' });
      return walk(j, 'musicTwoRowItemRenderer').map(r => {
        const id = r.navigationEndpoint?.browseEndpoint?.browseId || '';
        if (!id.startsWith('VL')) return null;
        const t = r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
        return { id: id.slice(2), name: txt(r.title), sub: txt(r.subtitle), img: t[0]?.url || '' };
      }).filter(p => p && p.id !== 'LM' && p.id !== 'SE');
    },
    async playlist(id) { return songs(await call('browse', { browseId: 'VL' + String(id) })); },
    // Liked music and your playlists: the same requests the website's own buttons send
    async like(ids) { for (const id of ids || []) await call('like/like', { target: { videoId: String(id) } }); return true; },
    async unlike(ids) { for (const id of ids || []) await call('like/removelike', { target: { videoId: String(id) } }); return true; },
    async addToPlaylist(pid, ids) {
      const j = await call('browse/edit_playlist', { playlistId: String(pid), actions: (ids || []).map(v => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: String(v), dedupeOption: 'DEDUPE_OPTION_SKIP' })) });
      if (j?.status && j.status !== 'STATUS_SUCCEEDED') throw new Error('YouTube Music did not add them (' + String(j.status).replace(/^STATUS_/, '').toLowerCase() + ')');
      return true;
    },
  };
})();
true;
