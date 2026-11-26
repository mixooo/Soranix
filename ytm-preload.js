// Runs in the hidden YouTube Music window before its pages.
// 1) The window introduces itself as Firefox (see main.js), so Google's sign-in accepts it;
//    Firefox has no navigator.userAgentData, so the page shouldn't see one either.
// 2) No ads: YouTube's answer about each song lists the ads to play first (adPlacements,
//    playerAds, adSlots...). Only the web player acts on that list; clients that play the audio
//    themselves, like Limusic, never read it. Here the list is taken out of every answer
//    before the player reads it, so there is nothing to play but the song.
const { webFrame } = require('electron');
webFrame.executeJavaScript(`(() => {
  try { Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true }); } catch (e) {}
  // YouTube pauses after a long time without clicks or keys on its page ("Video paused. Continue
  // watching?"), and nobody clicks this hidden page: it's told someone was just here, every 30 s
  setInterval(() => { try { window._lact = Date.now(); } catch (e) {} }, 30000);
  const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams', 'adBreakParams'];
  window.__sxAdsRemoved = 0;
  const prune = o => {
    if (!o || typeof o !== 'object') return o;
    for (const k of AD_KEYS) if (k in o) { delete o[k]; window.__sxAdsRemoved++; }
    if (o.playerResponse) prune(o.playerResponse);
    if (Array.isArray(o)) for (const x of o) if (x && typeof x === 'object' && (x.playerResponse || x.adPlacements)) prune(x);
    return o;
  };
  const parse = JSON.parse;
  JSON.parse = function (...a) { return prune(parse.apply(this, a)); };
  const json = Response.prototype.json;
  Response.prototype.json = async function (...a) { return prune(await json.apply(this, a)); };
  let first;
  try { Object.defineProperty(window, 'ytInitialPlayerResponse', { configurable: true, get: () => first, set: v => { first = prune(v); } }); } catch (e) {}
})();`);
