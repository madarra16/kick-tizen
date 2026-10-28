/* Kick for Tizen: shared helpers. ES5 for Tizen 5 (Chromium 63). */
(function () {
  'use strict';

  var K = window.K = { VERSION: '1.1.0', HELPER: 'http://127.0.0.1:47820', HELPER_IMAGES: 'http://127.0.0.1:47821', HELPER_ID: 'KickLive01.Helper' };

  K.$ = function (id) { return document.getElementById(id); };

  K.el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined && text !== null) { e.textContent = text; }
    return e;
  };

  K.esc = function (s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  // localStorage can throw or be empty; nothing here may depend on it working.
  K.store = {
    get: function (key, fallback) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set: function (key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ } },
    del: function (key) { try { localStorage.removeItem(key); } catch (e) { /* blocked */ } }
  };

  var PREF_DEFAULTS = { hideGambling: true, hideMature: false, hidePools: false, language: 'en', quality: 'auto', chat: true };
  K.prefs = K.store.get('kick.prefs', {});
  Object.keys(PREF_DEFAULTS).forEach(function (k) { if (!(k in K.prefs)) { K.prefs[k] = PREF_DEFAULTS[k]; } });
  K.savePrefs = function () { K.store.set('kick.prefs', K.prefs); };

  // The helper service (service/helper.js) also fetches Kick's API and images: the TV's own name
  // lookup waits 5-10 s for every new server name, the helper's takes ~50 ms. It starts with the
  // app (~2.5 s); until then requests wait, and if it never comes up they go direct.
  K.helper = (function () {
    var state = 'idle', waiting = [], KICK = /^https:\/\/([a-z0-9-]+\.)*kick\.com\//i;
    function settle(ok) { state = ok ? 'ready' : 'failed'; var w = waiting; waiting = []; w.forEach(function (f) { f(); }); }
    function start() {
      state = 'starting';
      try {
        tizen.application.launchAppControl(new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service'), K.HELPER_ID, null, null);
      } catch (e) { /* not on a TV, or already running */ }
      var tries = 0;
      (function ping() {
        var x = new XMLHttpRequest();
        function retry() { if (++tries < 15) { setTimeout(ping, 400); } else { settle(false); } }
        x.open('GET', K.HELPER + '/ping', true);
        x.timeout = 500;
        x.onload = function () { if (x.status === 200) { settle(true); } else { retry(); } };
        x.onerror = x.ontimeout = retry;
        try { x.send(); } catch (e) { retry(); }
      })();
    }
    return {
      ready: function () { return state === 'ready'; },
      // cb runs once the helper is up or has given up; retry restarts a failed helper.
      wait: function (cb, retry) {
        if (state === 'ready' || (state === 'failed' && !retry)) { return cb(); }
        waiting.push(cb);
        if (state !== 'starting') { start(); }
      },
      // Pictures use a second port: the browser opens at most 6 connections per address, and a
      // screenful of thumbnails must not hold up the API calls behind it.
      url: function (u) {
        if (state !== 'ready' || !KICK.test(u || '')) { return u; }
        return (/\/api\/|\/stream\/livestreams/.test(u) ? K.HELPER : K.HELPER_IMAGES) + '/f?u=' + encodeURIComponent(u);
      }
    };
  })();

  // JSON over XHR. cb(err, data, status); err is null for 2xx. Returns { abort }.
  K.http = function (method, url, opts, cb) {
    var handle = { xhr: null, aborted: false, abort: function () { handle.aborted = true; if (handle.xhr) { handle.xhr.abort(); } } };
    K.helper.wait(function () { if (!handle.aborted) { handle.xhr = send(method, K.helper.url(url), opts || {}, cb); } });
    return handle;
  };

  function send(method, url, opts, cb) {
    var x = new XMLHttpRequest(), done = false;
    function finish(err, data) { if (!done) { done = true; cb(err, data, x.status); } }
    x.open(method, url, true);
    x.timeout = opts.timeout || 15000;
    x.setRequestHeader('Accept', 'application/json');
    Object.keys(opts.headers || {}).forEach(function (h) { x.setRequestHeader(h, opts.headers[h]); });
    x.onload = function () {
      var data = null;
      try { data = JSON.parse(x.responseText); } catch (e) { data = x.responseText; }
      if (x.status >= 200 && x.status < 300) { finish(null, data); } else { finish({ status: x.status, data: data }, data); }
    };
    x.onerror = function () { finish({ status: 0, network: true }); };
    x.ontimeout = function () { finish({ status: 0, timeout: true }); };
    var body = null;
    if (opts.body !== undefined) { x.setRequestHeader('Content-Type', 'application/json'); body = JSON.stringify(opts.body); }
    try { x.send(body); } catch (e) { finish({ status: 0, network: true }); }
    return x;
  }

  // 950 -> "950", 4682 -> "4.7K", 30971 -> "31K", 1371059 -> "1.4M"
  K.count = function (n) {
    n = Number(n) || 0;
    if (n < 1000) { return String(n); }
    if (n < 10000) { return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'; }
    if (n < 1000000) { return Math.round(n / 1000) + 'K'; }
    return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  };

  // Kick sends both "2026-10-26T17:31:08Z" and "2026-10-26 17:31:08" (UTC).
  K.parseTime = function (s) {
    if (!s) { return NaN; }
    s = String(s);
    if (s.indexOf('T') < 0) { s = s.replace(' ', 'T') + 'Z'; }
    return Date.parse(s);
  };

  // 3725 -> "1:02:05", 45 -> "0:45"
  K.hms = function (sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  };

  // "3 days ago"
  K.ago = function (time) {
    var t = K.parseTime(time);
    if (isNaN(t)) { return ''; }
    var s = Math.max(0, (Date.now() - t) / 1000), units = [[31536000, 'year', 'a'], [2592000, 'month', 'a'], [86400, 'day', 'a'], [3600, 'hour', 'an'], [60, 'minute', 'a']];
    for (var i = 0; i < units.length; i++) {
      var n = Math.floor(s / units[i][0]);
      if (n === 1) { return K.t(units[i][2] + ' ' + units[i][1] + ' ago'); }
      if (n > 1) { return K.t('{n} ' + units[i][1] + 's ago', { n: n }); }
    }
    return K.t('just now');
  };

  K.uptime = function (start) {
    var t = K.parseTime(start);
    if (isNaN(t)) { return ''; }
    var m = Math.max(0, Math.floor((Date.now() - t) / 60000)), h = Math.floor(m / 60);
    return h ? h + 'h ' + (m % 60) + 'm' : m + 'm';
  };

  // Pick the smallest srcset candidate at least `width` wide ("url 1280w, url 640w, ...").
  K.pickImage = function (srcset, fallback, width) {
    var best = null, largest = null;
    String(srcset || '').split(',').forEach(function (part) {
      var m = /^\s*(\S+)\s+(\d+)w\s*$/.exec(part);
      if (!m) { return; }
      var w = Number(m[2]);
      if (!largest || w > largest.w) { largest = { u: m[1], w: w }; }
      if (w >= width && (!best || w < best.w)) { best = { u: m[1], w: w }; }
    });
    return (best || largest || {}).u || fallback || '';
  };

  // Kick sends either an ISO code ("en") or a name ("English").
  var LANGS = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', pt: 'Portuguese', it: 'Italian', tr: 'Turkish', ru: 'Russian',
    ar: 'Arabic', pl: 'Polish', nl: 'Dutch', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', hi: 'Hindi', id: 'Indonesian', vi: 'Vietnamese',
    fi: 'Finnish', sv: 'Swedish', no: 'Norwegian', da: 'Danish', cs: 'Czech', ro: 'Romanian', el: 'Greek', hu: 'Hungarian', uk: 'Ukrainian', th: 'Thai' };
  K.langEnglish = function (code) { return LANGS[String(code || '').toLowerCase()] || ''; };
  // The app's own languages by their own names (as in the language list), others in English.
  K.langName = function (l) {
    l = String(l || '');
    var code = l.toLowerCase(), own = K.languageName(code);
    return own !== code ? own : LANGS[code] || (l.length > 3 ? l : l.toUpperCase());
  };

  var GAMBLING = /slots|casino|gambl|poker|blackjack|roulette|sportsbook|betting|stake/i;
  K.isGambling = function (name, parent) { return GAMBLING.test(name || '') || /gambl/i.test(parent || ''); };

  // Kick's "Pools, Hot Tubs & Bikinis" category (id 16), the official TV app's third content filter.
  K.isPools = function (name, slug) { return slug === 'pools-hot-tubs-bikinis' || /^pools, hot tubs/i.test(name || ''); };

  // Respects the content settings; used for every list of streams, clips or categories.
  K.allowStream = function (s) {
    if (K.prefs.hideGambling && K.isGambling(s.category, s.categoryParent)) { return false; }
    if (K.prefs.hidePools && K.isPools(s.category, s.categorySlug)) { return false; }
    if (K.prefs.hideMature && s.mature) { return false; }
    return true;
  };
  K.allowCategory = function (c) {
    return !(K.prefs.hideGambling && K.isGambling(c.name, c.parent)) && !(K.prefs.hidePools && K.isPools(c.name, c.slug));
  };

  // Where each past broadcast was left (Continue Watching). Entries for a few seconds in, or near
  // the end, are dropped: those are finished or barely started.
  K.resume = (function () {
    var KEY = 'kick.resume', MAX = 20;
    function all() { return K.store.get(KEY, []); }
    function id(item) { return item.kind + ':' + (item.id || item.url); }
    return {
      get: function (item) { var k = id(item), e = all().filter(function (x) { return x.key === k; })[0]; return e ? e.sec : 0; },
      save: function (item, sec, dur) {
        var k = id(item), list = all().filter(function (x) { return x.key !== k; });
        if (sec >= 30 && (!dur || sec < dur - 60)) {
          var keep = {};
          ['id', 'kind', 'url', 'title', 'thumb', 'duration', 'views', 'created', 'category', 'channel', 'mature'].forEach(function (f) { keep[f] = item[f]; });
          list.unshift({ key: k, sec: Math.floor(sec), dur: dur || item.duration || 0, at: Date.now(), item: keep });
        }
        K.store.set(KEY, list.slice(0, MAX));
      },
      list: function () { return all(); }
    };
  })();

  // "Samsung UE55RU7379 · Tizen 5.0" for App information, like the official "Device information".
  K.deviceName = function () {
    var model = '', version = '';
    try { model = webapis.productinfo.getRealModel() || webapis.productinfo.getModel(); } catch (e) { /* not on a TV */ }
    try { version = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version'); } catch (e) { /* not on a TV */ }
    return 'Samsung ' + (model || 'Smart TV') + (version ? ' · Tizen ' + version : '');
  };

  K.uuid = function () {
    var b = new Uint8Array(16), i, h = [];
    if (window.crypto && crypto.getRandomValues) { crypto.getRandomValues(b); } else { for (i = 0; i < 16; i++) { b[i] = Math.floor(Math.random() * 256); } }
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    for (i = 0; i < 16; i++) { h.push((b[i] + 0x100).toString(16).slice(1)); }
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' + h.slice(10).join('');
  };

  // QR code as an <img> (qrcode-generator, MIT).
  K.qr = function (text, px) {
    var q = window.qrcode(0, 'M');
    q.addData(text);
    q.make();
    var img = K.el('img');
    img.src = q.createDataURL(Math.max(2, Math.floor(px / (q.getModuleCount() + 8))), 4);
    return img;
  };

  K.tizen = window.tizen || null;
})();
