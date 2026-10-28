/* Read-only live chat over Kick's Pusher websocket (like the official TV app, sending happens on
   the phone). Messages are rendered in batches so busy chats don't stall the TV. With the chat
   hidden it still listens (quiet), for the stream ending and for raids. */
(function (K) {
  'use strict';

  var FALLBACK = { key: '34bf7a0ff419a2a775b9', cluster: 'us2' };  // Kick's public web chat key
  var MAX_LINES = 80, FLUSH_MS = 300;
  // Kick badge type -> the TV app's own badge drawable (img/badges/*.svg).
  var BADGES = { broadcaster: 'host', moderator: 'moderator', vip: 'vip', og: 'og', founder: 'founder', verified: 'verified',
    staff: 'staff', sidekick: 'sidekick', bot: 'bot', admin: 'admin', subscriber: 'subscriber' };

  var ws = null, gen = 0, info = null, queue = [], flushTimer = null, pingTimer = null, retryTimer = null;

  function listEl() { return K.$('chatList'); }

  function badge(b) {
    var url = (b.type === 'subscriber' && K.helper.url(subBadge(b.count))) || (BADGES[b.type] && 'img/badges/' + BADGES[b.type] + '.svg');
    if (!url) { return null; }
    var img = K.el('img', 'badge');
    img.src = url;
    return img;
  }

  // Channel subscriber badge for `months`: the largest tier not above it.
  function subBadge(months) {
    var best = null;
    (info && info.subBadges || []).forEach(function (b) {
      if (b.months <= (months || 1) && (!best || b.months > best.months)) { best = b; }
    });
    return best && best.badge_image && best.badge_image.src;
  }

  function content(parent, text) {
    var re = /\[emote:(\d+):([^\]]*)\]/g, last = 0, m;
    text = String(text || '');
    while ((m = re.exec(text))) {
      if (m.index > last) { parent.appendChild(document.createTextNode(text.slice(last, m.index))); }
      var img = K.el('img', 'emote');
      img.src = K.helper.url('https://files.kick.com/emotes/' + m[1] + '/fullsize');
      img.alt = m[2];
      parent.appendChild(img);
      last = re.lastIndex;
    }
    if (last < text.length) { parent.appendChild(document.createTextNode(text.slice(last))); }
  }

  function line(m) {
    var d = K.el('div', 'msg'), s = m.sender || {}, id = s.identity || {};
    d.setAttribute('data-id', m.id || '');
    (id.badges || []).forEach(function (b) { var e = badge(b); if (e) { d.appendChild(e); } });
    // Newer global badges (level): shown only when the chatter switched them on, as on kick.com.
    (id.badges_v2 || []).forEach(function (b) {
      if (!b.selected || !b.image_url || BADGES[b.name]) { return; }
      var img = K.el('img', 'badge');
      img.src = K.helper.url(b.image_url);
      d.appendChild(img);
    });
    var u = K.el('span', 'u', s.username || '');
    u.style.color = /^#[0-9a-f]{3,8}$/i.test(id.color || '') ? id.color : '#53fc18';
    d.appendChild(u);
    d.appendChild(document.createTextNode(': '));
    content(d, m.content);
    return d;
  }

  function note(text, cls) { var d = K.el('div', 'msg ' + (cls || 'event'), text); queue.push(d); }

  function flush() {
    if (!queue.length) { return; }
    var list = listEl(), f = document.createDocumentFragment();
    if (queue.length > MAX_LINES) { queue = queue.slice(-MAX_LINES); }
    queue.forEach(function (d) { f.appendChild(d); });
    queue = [];
    list.appendChild(f);
    while (list.childNodes.length > MAX_LINES) { list.removeChild(list.firstChild); }
  }

  function pinned(msg) {
    var p = K.$('chatPinned');
    if (!msg) { p.hidden = true; return; }
    p.textContent = '';
    var head = K.el('small'), pin = K.el('img');
    pin.src = 'img/pinned.svg';
    head.appendChild(pin);
    head.appendChild(document.createTextNode(K.t('Pinned from {name}', { name: (msg.sender || {}).username || '' })));
    p.appendChild(head);
    content(p, msg.content);
    p.hidden = false;
  }

  function handle(evt, data) {
    var d = data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
    switch (evt) {
      case 'App\\Events\\ChatMessageEvent': if (!info.quiet) { queue.push(line(d)); } break;
      case 'App\\Events\\MessageDeletedEvent':
        var gone = d.message && listEl().querySelector('[data-id="' + String(d.message.id).replace(/"/g, '') + '"]');
        if (gone) { gone.parentNode.removeChild(gone); }
        break;
      case 'App\\Events\\PinnedMessageCreatedEvent': pinned(d.message); break;
      case 'App\\Events\\PinnedMessageDeletedEvent': pinned(null); break;
      case 'App\\Events\\ChatroomClearEvent': listEl().textContent = ''; queue = []; break;
      case 'App\\Events\\SubscriptionEvent': note(K.t('{name} has subscribed', { name: d.username || K.t('Someone') })); break;
      case 'App\\Events\\GiftedSubscriptionsEvent':
        note(K.t('{name} gifted {n} subs', { name: d.gifter_username || K.t('Someone'), n: (d.gifted_usernames || []).length || 1 })); break;
      case 'App\\Events\\StreamHostEvent': note(K.t('{name} hosted with {n} viewers', { name: d.host_username || K.t('Someone'), n: d.number_viewers || 0 })); break;
      case 'App\\Events\\StopStreamBroadcast': if (K.player.ended) { K.player.ended(); } break;
      // A raid: kick.com moves viewers to the hosted channel after a countdown.
      case 'App\\Events\\ChatMoveToSupportedChannelEvent':
        if (d.hosted && d.hosted.slug && d.hosted.slug !== info.slug && K.player.raid) { K.player.raid(d.hosted); }
        break;
    }
  }

  function connect(myGen, cred) {
    if (myGen !== gen) { return; }
    try { ws = new WebSocket('wss://ws-' + cred.cluster + '.pusher.com/app/' + cred.key + '?protocol=7&client=js&version=8.4.0&flash=false'); }
    catch (e) { return retry(myGen, cred); }
    ws.onmessage = function (e) {
      if (myGen !== gen) { return; }
      var msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.event === 'pusher:connection_established') {
        ['chatrooms.' + info.roomId + '.v2', 'channel.' + info.channelId].forEach(function (ch) {
          ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: ch } }));
        });
      } else if (msg.event === 'pusher:ping') {
        ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      } else {
        handle(msg.event, msg.data);
      }
    };
    ws.onclose = function () { if (myGen === gen) { retry(myGen, cred); } };
  }

  function retry(myGen, cred) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function () { connect(myGen, cred); }, 5000);
  }

  K.chat = {
    // opts: { channelId, roomId, slug, subBadges, quiet }
    start: function (opts) {
      K.chat.stop();
      var myGen = gen;
      info = opts;
      listEl().textContent = '';
      pinned(null);
      note(K.t('Welcome to the chat room!'), 'sys');
      K.api.messages(opts.channelId, function (err, d) {
        if (myGen !== gen || err || !d || !d.data || opts.quiet) { return; }
        var msgs = (d.data.messages || []).slice().sort(function (a, b) { return K.parseTime(a.created_at) - K.parseTime(b.created_at); });
        var lines = msgs.slice(-30).map(line);
        queue = lines.concat(queue);
        pinned(d.data.pinned_message && (d.data.pinned_message.message || d.data.pinned_message));
      });
      K.api.chatConnection(opts.channelId, function (err, d) {
        var cred = null;
        ((d && d.data && d.data.connections) || []).forEach(function (c) {
          var k = c.credentials || {};
          if (!cred && c.provider === 'pusher' && /^[a-zA-Z0-9]{8,64}$/.test(k.app_key || '') && /^[a-z0-9-]{1,24}$/.test(k.cluster || '')) {
            cred = { key: k.app_key, cluster: k.cluster };
          }
        });
        connect(myGen, cred || FALLBACK);
      });
      flushTimer = setInterval(flush, FLUSH_MS);
      pingTimer = setInterval(function () {
        if (ws && ws.readyState === 1) { ws.send(JSON.stringify({ event: 'pusher:ping', data: {} })); }
      }, 60000);
    },

    stop: function () {
      gen++;
      clearInterval(flushTimer);
      clearInterval(pingTimer);
      clearTimeout(retryTimer);
      queue = [];
      if (ws) { try { ws.onclose = null; ws.close(); } catch (e) { /* already closed */ } ws = null; }
    }
  };
})(window.K);
