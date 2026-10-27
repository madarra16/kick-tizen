/* Full-screen player for live streams, rewinding a live stream, and videos (clips, past
   broadcasts). AVPlay on Tizen 5 can't read Kick's gzip playlists, so playlists go through the
   local helper (service/helper.js), and so do the video segments (it keeps them in memory).
   Rewinding switches to the running stream's recording (from the channel's videos list): it
   holds the whole stream so far. The helper cuts it to start at the segment holding the target
   (`&from=`), so AVPlay doesn't load the recording's beginning first; state.base is where the
   cut playlist starts. Modes: 'live', 'dvr' (rewound live stream), 'vod' (clip or past broadcast). */
(function (K) {
  'use strict';

  var IDLE_MS = 4 * 3600 * 1000, OVERLAY_MS = 6000, SEEK_APPLY_MS = 800, LIVE_SNAP_S = 20, RETRIES = 2, START_MS = 25000;
  var state = null, seq = 0, shown = false, paused = false, seek = null;
  var overlayTimer = null, refreshTimer = null, idleTimer = null, clockTimer = null, seekTimer = null, startTimer = null;

  function av() { return window.webapis && webapis.avplay; }
  function errText(e) { return e && typeof e === 'object' ? (e.message || e.name || String(e)) : String(e); }

  function proxied(url) {
    return K.helper.ready() && url.indexOf(K.HELPER) !== 0 ? K.HELPER + '/p.m3u8?u=' + encodeURIComponent(url) : url;
  }

  function avStop() {
    var p = av();
    if (!p) { return; }
    try {
      var s = p.getState();
      if (s === 'PLAYING' || s === 'PAUSED' || s === 'READY') { p.stop(); }
      if (p.getState() !== 'NONE') { p.close(); }
    } catch (e) { /* already closed */ }
  }

  function setMode(mode) {
    state.mode = mode;
    var pl = K.$('player');
    ['live', 'dvr', 'vod'].forEach(function (m) { pl.classList.toggle('mode-' + m, m === mode); });
  }

  // ---- status screen (loading / error / offline / ended) ----
  function status(kind, title, detail, buttons) {
    var ps = K.$('playerStatus'), old = ps.querySelector('.ps-buttons');
    ps.className = 'player-status ' + (kind || '');
    ps.querySelector('.ps-title').textContent = title || '';
    ps.querySelector('.ps-detail').textContent = detail || '';
    if (old) { ps.removeChild(old); }
    ps.hidden = false;
    if (buttons && buttons.length) {
      var row = K.el('div', 'ps-buttons');
      buttons.forEach(function (b) { row.appendChild(K.cards.button(b[0], b[1], b[2])); });
      ps.appendChild(row);
      hideOverlay();
      K.focus.setScope(row);
    }
  }
  function statusButtons() { var ps = K.$('playerStatus'); return !ps.hidden && ps.querySelector('.ps-buttons'); }

  // A first attempt sometimes fails (Kick's servers, the Wi-Fi): try again quietly twice before
  // asking. Failures after 20 s of playback start a fresh count.
  function fail(title, detail, final) {
    seq++;
    avStop();
    clearTimeout(startTimer);
    if (!state) { return; }
    if (shown && Date.now() - state.shownAt > 20000) { state.retries = 0; }
    if (shown && state.mode === 'dvr') { state.dvrTarget = position(); }
    if (!final && state.retries < RETRIES) {
      var my = seq;
      state.retries++;
      shown = false;
      hideOverlay();
      status('', channelInfo().name, K.t('Reconnecting…'));
      setTimeout(function () { if (my === seq) { retry(); } }, 1000 * state.retries);
      return;
    }
    status('error', title, detail, [[K.t('Try again'), function () { state.retries = 0; retry(); }, true], [K.t('Back'), close]]);
  }
  function retry() { if (state.mode === 'dvr') { startDvr(state.dvrTarget); } else { reload(); } }

  // ---- what is playing ----
  function channelInfo() {
    if (state.kind === 'vod') { var c = state.item.channel || {}; return { slug: c.slug, name: c.name || '', avatar: c.avatar, verified: false }; }
    var ch = state.channel || {}, u = ch.user || {};
    return { slug: ch.slug || state.stream.slug, name: u.username || state.stream.name || state.stream.slug, avatar: u.profile_pic || state.stream.avatar, verified: !!ch.verified };
  }

  function liveEdge() {
    var t = K.parseTime(((state.channel || {}).livestream || {}).start_time);
    return isNaN(t) ? 0 : (Date.now() - t) / 1000;
  }
  function position() { return state.mode === 'live' ? liveEdge() : (state.base || 0) + (state.pos || 0) / 1000; }
  function maxPosition() { return state.mode === 'vod' ? (state.durationMs || 0) / 1000 : liveEdge(); }

  // ---- overlay ----
  function fillOverlay() {
    var c = channelInfo(), viewers = K.$('ovViewers'), ls = (state.channel || {}).livestream || {}, it = state.item || {};
    if (c.avatar) { K.$('ovAvatar').src = K.helper.url(c.avatar); }
    K.$('ovName').textContent = c.name;
    K.$('overlay').querySelector('.verified').hidden = !c.verified;
    var count = state.kind === 'vod' ? it.views : ls.viewer_count;
    viewers.textContent = '';
    if (count !== undefined && count !== null) {
      viewers.appendChild(K.cards.icon('viewers'));
      viewers.appendChild(document.createTextNode(K.count(count)));
    }
    if (state.kind === 'vod') {
      K.$('ovTitle').textContent = it.title;
      K.$('ovCategory').textContent = it.category || '';
      K.$('ovLanguage').textContent = K.t(it.kind === 'clip' ? 'Clip' : 'Past broadcast') + (it.created ? ' · ' + K.ago(it.created) : '');
    } else {
      K.$('ovTitle').textContent = ls.session_title || '';
      K.$('ovCategory').textContent = ((ls.categories || [])[0] || {}).name || '';
      K.$('ovLanguage').textContent = ls.language ? K.langName(ls.language) : '';
    }
    drawSeek();
  }

  // Timeline: live = full bar + uptime; rewound = how far behind live; video = position / length.
  function drawSeek() {
    if (!state) { return; }
    var max = maxPosition(), pos = seek ? seek.target : position(), frac = max > 0 ? Math.min(1, Math.max(0, pos / max)) : 1;
    var end = K.$('seekEnd'), live = state.mode === 'live' && !seek;
    K.$('seekFill').style.width = (frac * 100) + '%';
    K.$('seekKnob').style.left = (frac * 100) + '%';
    K.$('ovUptime').textContent = K.hms(pos);
    K.$('seekBar').classList.toggle('seeking', !!seek);
    if (state.mode === 'vod') { end.textContent = '/ ' + K.hms(max); end.className = 'seek-end'; }
    else if (live) { end.textContent = K.t('LIVE'); end.className = 'seek-end live'; }
    else { end.textContent = K.t('{t} behind live', { t: '−' + K.hms(max - pos) }); end.className = 'seek-end behind'; }
  }

  // Clips come in one resolution only: the label then names it (as AVPlay reports it).
  function qualityLabel() {
    if ((state.qualities || []).length < 2) { return state.source || K.t('Original'); }
    var q = state.qualities.filter(function (x) { return x.id === state.quality; })[0];
    return q ? q.label : K.t('Auto');
  }

  function sourceLabel(p) {
    try {
      var v = p.getCurrentStreamInfo().filter(function (t) { return t.type === 'VIDEO'; })[0], x = v && JSON.parse(v.extra_info);
      var h = x && Number(x.Height), fps = x && Math.round(Number(x.fps || x.FrameRate) || 0);
      return h ? h + 'p' + (fps > 30 ? fps : '') : null;
    } catch (e) { return null; }
  }

  // Round toolbar buttons (ToolbarAvatarButton / PlayerToolbarIconButton) in the official order:
  // channel, follow, resolution, chat (live). The focused one shows its label.
  function buildButtons(focusSeek) {
    var row = K.$('ovButtons'), prev = K.focus.current && K.focus.current.getAttribute('data-b'), c = channelInfo(), list = [];
    if (state.mode === 'dvr') { list.push(['golive', K.t('Go live'), goLive, 'golive']); }
    list.push(['channel', c.name || K.t('Channel'), openChannelPage, null]);
    if (c.slug) { list.push(['follow', K.t(state.following ? 'Unfollow' : 'Follow'), follow, state.following ? 'following' : 'follow']); }
    list.push(['quality', K.t('Resolution') + ': ' + qualityLabel(), chooseQuality, 'hd']);
    if (state.kind === 'live') { list.push(['chat', K.t(state.chat ? 'Hide chat' : 'Chat'), toggleChat, 'chat']); }
    row.textContent = '';
    list.forEach(function (b) {
      var e = K.el('div', 'tb f');
      if (b[3] === 'golive') { var pill = K.el('img', 'golive'); pill.src = 'img/ic_live_badge_inverse.svg'; e.appendChild(pill); }
      else if (b[3]) { e.appendChild(K.cards.icon(b[3])); }
      else { var a = K.el('img', 'avatar'); a.src = K.$('ovAvatar').src; e.appendChild(a); }
      e.appendChild(K.el('div', 'label', b[1]));
      e.setAttribute('data-b', b[0]);
      e._select = b[2];
      row.appendChild(e);
    });
    placeLabels();
    var target = focusSeek ? K.$('seekBar') : row.querySelector('[data-b="' + (prev || (state.kind === 'live' ? 'chat' : 'channel')) + '"]') || row.lastChild;
    K.focus.setScope(K.$('overlay'), target);
  }

  // Each label sits centred over its button, moved in where it would leave the screen.
  function placeLabels() {
    Array.prototype.forEach.call(K.$('ovButtons').querySelectorAll('.tb .label'), function (l) {
      var b = l.parentNode.getBoundingClientRect(), w = l.offsetWidth, left = b.left + b.width / 2 - w / 2;
      left = Math.max(48, Math.min(left, 1920 - 48 - w));
      l.style.left = Math.round(left - b.left) + 'px';
    });
  }

  function openChannelPage() {
    var c = channelInfo();
    if (!c.slug) { return; }
    close();
    K.app.push(K.screens.channel(c));
  }

  // Following happens on the phone (QR, as in the official app); Done asks Kick again.
  function follow() {
    var c = channelInfo(), un = state.following;
    K.modal.show({ title: K.t(un ? 'Unfollow {name}' : 'Follow {name}', { name: c.name }),
      text: K.t(un ? 'Scan the QR code with your phone to unfollow {name} in the Kick app.' : 'Scan the QR code with your phone to follow {name} in the Kick app.', { name: c.name }),
      qr: 'https://kick.com/' + c.slug + '?follow=' + !un, buttons: [[K.t('Done'), function () { followed = null; checkFollow(); }, true]] });
  }

  // Signed in: a filled heart when this channel is already followed.
  var followed = null;
  function checkFollow() {
    var st = state, slug = String(channelInfo().slug || '').toLowerCase();
    if (!st || !slug || !K.auth.signedIn()) { return; }
    function apply() {
      if (state !== st) { return; }
      st.following = followed.slugs.indexOf(slug) >= 0;
      var b = K.$('ovButtons').querySelector('[data-b="follow"]');
      if (b) { b.replaceChild(K.cards.icon(st.following ? 'following' : 'follow'), b.firstChild); b.querySelector('.label').textContent = K.t(st.following ? 'Unfollow' : 'Follow'); placeLabels(); }
    }
    if (followed && Date.now() - followed.at < 120000) { return apply(); }
    K.api.followed(K.auth.token, function (err, rows) {
      if (err) { return; }
      followed = { at: Date.now(), slugs: rows.map(function (r) { return String(r.slug).toLowerCase(); }) };
      apply();
    });
  }

  function showOverlay(focusSeek) {
    if (!state || (state.kind === 'live' && !state.channel)) { return; }
    fillOverlay();
    var wasHidden = K.$('overlay').hidden;
    K.$('overlay').hidden = false;
    // Opening the overlay focuses the timeline: left/right seek, OK pauses, up reaches the buttons.
    if (wasHidden || focusSeek) { buildButtons(true); }
    armOverlay();
    clearInterval(clockTimer);
    clockTimer = setInterval(drawSeek, 1000);
  }
  function armOverlay() {
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(function () { if (K.modal.isOpen() || seek || paused) { armOverlay(); } else { hideOverlay(); } }, OVERLAY_MS);
  }
  function hideOverlay() { clearTimeout(overlayTimer); clearInterval(clockTimer); K.$('overlay').hidden = true; }

  function reveal() {
    if (shown) { return; }
    shown = true;
    state.shownAt = Date.now();
    clearTimeout(startTimer);
    K.$('playerStatus').hidden = true;
    showOverlay();
    warmRec();
  }

  // ---- chat ----
  function startChat() {
    var ch = state.channel;
    K.$('chat').hidden = false;
    K.$('player').classList.add('chat-on');
    K.chat.start({ channelId: ch.id, roomId: ch.chatroom && ch.chatroom.id, slug: ch.slug, subBadges: ch.subscriber_badges || [] });
  }
  function stopChat() { K.chat.stop(); K.$('chat').hidden = true; K.$('player').classList.remove('chat-on'); }
  function toggleChat() {
    state.chat = !state.chat;
    K.prefs.chat = state.chat;
    K.savePrefs();
    if (state.chat) { startChat(); } else { stopChat(); }
    buildButtons();
    armOverlay();
  }

  // ---- resolution ----
  function parseQualities(text) {
    var lines = text.split(/\r?\n/), out = [], seen = {}, i, attrs, m, h;
    for (i = 0; i < lines.length - 1; i++) {
      if (lines[i].indexOf('#EXT-X-STREAM-INF:') !== 0) { continue; }
      attrs = {};
      lines[i].slice(18).replace(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g, function (all, k, v) { attrs[k] = v.replace(/^"|"$/g, ''); return all; });
      m = /^(\d+)x(\d+)$/.exec(attrs.RESOLUTION || '');
      if (!m || (attrs.CODECS && !/avc1/i.test(attrs.CODECS))) { continue; }
      h = Number(m[2]);
      if (h > 1080 || seen[h]) { continue; }
      seen[h] = true;
      var fps = Math.round(Number(attrs['FRAME-RATE']) || 30);
      out.push({ id: String(h), label: h + 'p' + (fps > 30 ? fps : ''), url: lines[i + 1].trim(), height: h });
    }
    return out.sort(function (a, b) { return b.height - a.height; });
  }

  // Resolutions of a master playlist (fetched through the helper); a media playlist gives just "Auto".
  function loadQualities(master, done) {
    var url = proxied(master), x = new XMLHttpRequest(), list = [{ id: 'auto', label: K.t('Auto'), url: url }];
    x.open('GET', url, true);
    x.timeout = 12000;
    x.onload = function () {
      if (x.status === 200 && x.responseText.indexOf('#EXTM3U') === 0) { list = list.concat(parseQualities(x.responseText)); }
      done(list);
    };
    x.onerror = x.ontimeout = function () { done(list); };
    x.send();
  }

  function pick(list) { return list.filter(function (x) { return x.id === state.quality; })[0] || list[0]; }

  function chooseQuality() {
    var single = state.qualities.length < 2;
    var opts = single ? [{ id: 'source', label: qualityLabel() }] : state.qualities.map(function (q) { return { id: q.id, label: q.label }; });
    K.modal.options(K.t('Resolution'), opts, single ? 'source' : state.quality, function (id) {
      if (single || id === state.quality) { return; }
      state.quality = id;
      K.prefs.quality = id;
      K.savePrefs();
      shown = false;
      if (state.mode === 'dvr') { return startDvr(position()); }
      status('', K.$('ovName').textContent, K.t('Switching to {q}…', { q: qualityLabel() }));
      start(pick(state.qualities), ++seq, state.mode === 'live' ? 0 : position());
    });
  }

  // ---- playback ----
  // Open one playlist URL; startSec > 0 seeks there (from the playlist's start) before playing.
  function start(q, my, startSec) {
    var p = av();
    avStop();
    setPaused(false);
    if (!p) { return fail('Video player unavailable', 'Samsung AVPlay is only available on the TV.', true); }
    armStart(my);
    try {
      p.open(q.url);
      p.setDisplayRect(0, 0, 1920, 1080);
      p.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      p.setListener({
        onbufferingstart: function () {},
        onbufferingprogress: function (pct) { if (my === seq && !shown) { K.$('playerStatus').querySelector('.ps-detail').textContent = K.t('Buffering {n} %', { n: pct }); } },
        onbufferingcomplete: function () { if (my === seq) { reveal(); } },
        oncurrentplaytime: function (ms) { if (my === seq) { state.pos = ms; if (!shown) { reveal(); } } },
        onstreamcompleted: function () { if (my === seq) { completed(); } },
        onerror: function (e) { if (my === seq) { fail(K.t('Playback error'), errText(e)); } },
        onevent: function () {}, onsubtitlechange: function () {}, ondrmevent: function () {}
      });
      p.prepareAsync(function () {
        if (my !== seq) { return; }
        function go() { if (my === seq) { try { p.play(); } catch (e) { fail(K.t('Cannot play'), errText(e)); } } }
        if (state.mode !== 'live') { try { state.durationMs = p.getDuration() || state.durationMs; } catch (e) { /* unknown length */ } }
        state.source = sourceLabel(p);
        if (startSec > 0) {
          var ms = Math.floor(startSec * 1000);
          if (state.durationMs) { ms = Math.min(ms, state.durationMs - (state.mode === 'dvr' ? 20000 : 2000)); }
          state.pos = Math.max(0, ms);
          try { p.seekTo(state.pos, go, go); } catch (e) { go(); }
        } else { go(); }
      }, function (e) { if (my === seq) { fail(K.t('Cannot start'), errText(e)); } });
    } catch (e) { fail(K.t('Cannot start'), errText(e)); }
  }

  // Nothing on screen START_MS after a step began (Kick's API, the playlist, the video): a failure,
  // retried quietly by fail(). Each step re-arms it.
  function armStart(my) {
    clearTimeout(startTimer);
    startTimer = setTimeout(function () { if (my === seq && !shown) { fail(K.t('The video did not start'), K.t('Nothing arrived within {n} seconds.', { n: START_MS / 1000 })); } }, START_MS);
  }

  function completed() {
    if (state.mode === 'dvr') { K.toast(K.t('Back to live'), 1500); goLive(); return; }
    if (state.mode === 'vod') {
      if (state.index < state.list.length - 1) { zap(1); return; }
      seq++;
      avStop();
      status('ended', K.t('Video ended'), state.item.title, [[K.t('Replay'), function () { state.pos = 0; loadVod(0); }, true], [K.t('Back'), close]]);
      return;
    }
    K.player.ended();
  }

  function loadLive() {
    var my = ++seq, s = state.stream;
    avStop();
    shown = false;
    setPaused(false);
    hideOverlay();
    setMode('live');
    state.base = 0;
    armStart(my);
    status('', s.name || s.slug, K.t('Loading stream…'));
    K.api.channel(s.slug, function (err, ch) {
      if (my !== seq) { return; }
      if (err || !ch || typeof ch !== 'object') { return fail(K.t('Kick did not answer.'), err && err.status ? 'HTTP ' + err.status : K.t('Check the network connection.')); }
      state.channel = ch;
      fillOverlay();
      checkFollow();
      var ls = ch.livestream;
      if (!ls || ls.is_live === false || !ch.playback_url) {
        clearTimeout(startTimer);
        stopChat();
        return status('ended', K.t('{name} is offline', { name: (ch.user || {}).username || s.name }), K.t('This channel is not live right now.'),
          [[K.t('Channel'), openChannelPage, true], [K.t('Back'), close]]);
      }
      if (state.chat) { startChat(); }
      // The running stream's recording, for rewinding.
      K.api.channelVideos(ch.slug, function (e, vids) {
        var cur = (vids || []).filter(function (v) { return v.live; })[0];
        if (state && state.channel === ch) { state.rec = cur ? { master: cur.url, qualities: null } : null; warmRec(); }
      });
      K.helper.wait(function () {
        if (my !== seq) { return; }
        if (!K.helper.ready()) { return fail(K.t('Helper did not start'), K.t('The stream helper service is not running. Try again.')); }
        loadQualities(ch.playback_url, function (list) {
          if (my !== seq) { return; }
          state.liveQualities = state.qualities = list;
          start(pick(list), my, 0);
        });
      }, true);
    });
  }

  function loadVod(atSec) {
    var my = ++seq, it = state.item;
    avStop();
    shown = false;
    setPaused(false);
    hideOverlay();
    setMode('vod');
    state.base = 0;
    armStart(my);
    state.durationMs = (it.duration || 0) * 1000;
    status('', it.title || (it.channel || {}).name, K.t(it.kind === 'clip' ? 'Loading clip…' : 'Loading video…'));
    checkFollow();
    K.helper.wait(function () {
      if (my !== seq) { return; }
      loadQualities(it.url, function (list) {
        if (my !== seq) { return; }
        state.qualities = list;
        start(pick(list), my, atSec || 0);
      });
    }, true);
  }

  function reload() { if (state.kind === 'vod') { loadVod(position()); } else { loadLive(); } }

  // ---- rewinding and seeking ----
  function segmentTimes(text) {
    var starts = [], t = 0, re = /#EXTINF:([\d.]+)/g, m;
    while ((m = re.exec(text))) { starts.push(t); t += parseFloat(m[1]) || 0; }
    return { starts: starts, end: t };
  }

  // The running stream's recording: its resolutions and segment start times (the resolutions
  // share them). Loaded once live playback runs, refreshed when a rewind needs newer parts.
  function recInfo(rec, needSec, done) {
    if (rec.starts && (rec.end >= needSec + 15 || Date.now() - rec.at < 10000)) { return done(); }
    if (rec.waiting) { return rec.waiting.push(done); }
    rec.waiting = [done];
    function finish() { var w = rec.waiting; rec.waiting = null; w.forEach(function (f) { f(); }); }
    function times() {
      var x = new XMLHttpRequest();
      x.open('GET', (rec.qualities[1] || rec.qualities[0]).url, true);
      x.timeout = 12000;
      x.onload = function () {
        var t = x.status === 200 ? segmentTimes(x.responseText) : null;
        if (t && t.starts.length) { rec.starts = t.starts; rec.end = t.end; rec.at = Date.now(); }
        finish();
      };
      x.onerror = x.ontimeout = finish;
      x.send();
    }
    if (rec.qualities && rec.qualities.length > 1) { times(); } else { loadQualities(rec.master, function (list) { rec.qualities = list; times(); }); }
  }
  function warmRec() {
    if (state && state.rec && shown && state.kind === 'live' && K.helper.ready()) { recInfo(state.rec, 0, function () {}); }
  }

  function startDvr(targetSec) {
    var my = ++seq, rec = state.rec;
    shown = false;
    state.dvrTarget = targetSec;
    setMode('dvr');
    armStart(my);
    status('', channelInfo().name, K.t('Rewinding…'));
    recInfo(rec, targetSec, function () {
      if (my !== seq) { return; }
      if (!rec.starts) { return fail(K.t("Can't rewind"), K.t("Kick's recording of this stream did not load.")); }
      var i = rec.starts.length - 1;
      while (i > 0 && rec.starts[i] > targetSec) { i--; }
      var from = rec.starts[i];
      state.base = from;
      state.qualities = rec.qualities.map(function (q) { return { id: q.id, label: q.label, url: q.url + '&from=' + from }; });
      start(pick(state.qualities), my, targetSec - from);
    });
  }

  function goLive() {
    var my = ++seq;
    shown = false;
    state.pos = 0;
    state.base = 0;
    setMode('live');
    status('', channelInfo().name, K.t('Back to live…'));
    state.qualities = state.liveQualities;
    start(pick(state.liveQualities), my, 0);
  }

  // Left/right: 10 s steps, 30 s after a few presses, 2 min when held; applied after a short pause.
  function nudge(dir) {
    if (!shown) { return; }
    if (state.mode === 'live' && !seek && dir > 0) { K.toast(K.t("You're watching live"), 1200); return; }
    if (state.mode === 'live' && !state.rec) { K.toast(K.t("Rewinding isn't available for this stream"), 2000); return; }
    if (!seek) { seek = { target: position(), presses: 0 }; }
    seek.presses++;
    var step = seek.presses > 8 ? 120 : seek.presses > 3 ? 30 : 10;
    seek.target = Math.max(0, Math.min(maxPosition(), seek.target + dir * step));
    if (state.rec && state.kind === 'live') { recInfo(state.rec, seek.target, function () {}); }
    showOverlay(true);
    drawSeek();
    clearTimeout(seekTimer);
    seekTimer = setTimeout(applySeek, SEEK_APPLY_MS);
  }

  function applySeek() {
    clearTimeout(seekTimer);
    if (!seek || !state) { return; }
    var target = seek.target;
    seek = null;
    if (state.mode === 'live') { if (target < liveEdge() - LIVE_SNAP_S) { startDvr(target); } else { drawSeek(); } return; }
    if (state.mode === 'dvr' && target >= liveEdge() - LIVE_SNAP_S) { goLive(); return; }
    var p = av(), ms = Math.floor((target - (state.base || 0)) * 1000);
    // Before the cut recording starts, or past the part it had when it opened: cut it again.
    if (state.mode === 'dvr' && (ms < 0 || (state.durationMs && ms > state.durationMs - 5000))) { startDvr(target); return; }
    if (state.durationMs) { ms = Math.min(ms, state.durationMs - 1000); }
    state.pos = Math.max(0, ms);
    try { p.seekTo(state.pos, function () {}, function () { K.toast(K.t("Can't jump there"), 1500); }); } catch (e) { K.toast(K.t("Can't jump there"), 1500); }
    drawSeek();
  }

  function cancelSeek() { clearTimeout(seekTimer); seek = null; drawSeek(); }

  // ---- live upkeep ----
  // Keep viewers/title fresh and notice when the stream ends.
  function refresh() {
    if (!state || !shown || state.kind !== 'live') { return; }
    var my = seq;
    K.api.channel(state.stream.slug, function (err, ch) {
      if (my !== seq || err || !ch || !state) { return; }
      state.channel = ch;
      if (!ch.livestream && state.mode === 'live') { K.player.ended(); } else if (!K.$('overlay').hidden) { fillOverlay(); }
    });
  }

  function checkIdle() {
    if (!state || !shown || K.modal.isOpen() || Date.now() - K.app.lastInput < IDLE_MS) { return; }
    seq++;
    avStop();
    stopChat();
    K.modal.show({ title: K.t('Are you still watching?'), buttons: [[K.t('Yes'), reload, true], [K.t('No'), close]], onClose: close });
  }

  function zap(delta) {
    if (!state || state.list.length < 2) { return; }
    var i = (state.index + delta + state.list.length) % state.list.length, next = state.list[i];
    K.toast(next.title && state.kind === 'vod' ? next.title : (next.name || next.slug), 1500);
    if (state.kind === 'vod') { K.player.openVod(next, state.list, i); } else { K.player.open(next, state.list, i); }
  }

  // Paused: the official play icon in the middle, and the overlay stays up until playback resumes.
  function setPaused(on) {
    paused = on;
    K.$('pauseBadge').hidden = !on;
  }
  function togglePause() {
    var p = av();
    if (!p || !shown) { return; }
    try {
      if (paused) { p.play(); } else { p.pause(); }
      setPaused(!paused);
      showOverlay();
    } catch (e) { /* not in a pausable state */ }
  }

  function close() {
    if (!state) { return; }
    seq++;
    clearTimeout(seekTimer);
    clearTimeout(startTimer);
    seek = null;
    avStop();
    stopChat();
    hideOverlay();
    clearInterval(refreshTimer);
    clearInterval(idleTimer);
    state = null;
    K.$('player').hidden = true;
    document.documentElement.classList.remove('playing');
    K.app.playerClosed();
  }

  document.addEventListener('visibilitychange', function () {
    if (!state) { return; }
    if (document.hidden) { state.resumeAt = state.mode === 'live' ? 0 : position(); seq++; avStop(); K.chat.stop(); }
    else if (state.kind === 'vod') { loadVod(state.resumeAt); } else { loadLive(); }
  });

  function begin() {
    if (state) { return; }
    K.app.playerOpened();
    document.documentElement.classList.add('playing');
    K.$('player').hidden = false;
    clearInterval(refreshTimer);
    clearInterval(idleTimer);
    refreshTimer = setInterval(refresh, 60000);
    idleTimer = setInterval(checkIdle, 60000);
  }

  K.player = {
    warm: function () { K.helper.wait(function () {}); },
    isOpen: function () { return !!state; },

    // Live stream: stream = { slug, name, avatar, ... }; list/index for CH+/CH-.
    open: function (stream, list, index) {
      var chat = state ? state.chat : K.prefs.chat;
      begin();
      state = { kind: 'live', stream: stream, list: list || [stream], index: index || 0, channel: null, qualities: [], quality: K.prefs.quality, chat: chat, retries: 0, base: 0 };
      loadLive();
    },

    // Clip or past broadcast: item = { kind: 'clip'|'video', url, title, duration, views, created, category, channel: { slug, name, avatar } }.
    openVod: function (item, list, index) {
      begin();
      stopChat();
      state = { kind: 'vod', item: item, list: list || [item], index: index || 0, qualities: [], quality: K.prefs.quality, chat: false, pos: 0, retries: 0, base: 0 };
      loadVod(0);
    },

    ended: function () {
      if (!state) { return; }
      seq++;
      avStop();
      stopChat();
      status('ended', K.t('Stream ended.'), K.t('{name} is no longer live.', { name: K.$('ovName').textContent }), [[K.t('Back'), close, true], [K.t('Channel'), openChannelPage]]);
    },

    close: close,

    key: function (k) {
      var overlayOpen = !K.$('overlay').hidden, onSeek = overlayOpen && K.focus.current === K.$('seekBar');
      if (k === 'back') {
        if (seek) { cancelSeek(); } else if (overlayOpen) { hideOverlay(); } else { close(); }
        return;
      }
      if (statusButtons()) {
        if (k === 'enter') { if (K.focus.current && K.focus.current._select) { K.focus.current._select(); } }
        else if (k === 'left' || k === 'right' || k === 'up' || k === 'down') { K.focus.move(k); }
        return;
      }
      if (k === 'chup' || k === 'chdown') { zap(k === 'chup' ? -1 : 1); return; }
      if (k === 'playpause' || k === 'play' || k === 'pause') { togglePause(); return; }
      if (k === 'stop') { close(); return; }
      if ((k === 'left' || k === 'right') && (!overlayOpen || onSeek)) { nudge(k === 'left' ? -1 : 1); return; }
      if (!overlayOpen) { showOverlay(); return; }
      armOverlay();
      if (k === 'enter') {
        if (onSeek) { if (seek) { applySeek(); } else { togglePause(); } } else if (K.focus.current && K.focus.current._select) { K.focus.current._select(); }
      } else { K.focus.move(k); }
    }
  };
})(window.K);
