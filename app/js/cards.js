/* Cards in the TV app's style: stream thumbnails with the info on the picture
   (KickThumbnailStream), box-art categories (KickThumbnailCategory), channel circles.
   Images load as they come near the screen. */
(function (K) {
  'use strict';

  var io = null;
  function lazy(img, url) {
    if (!url) { return img; }
    if (!io && window.IntersectionObserver) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { show(e.target); io.unobserve(e.target); }
        });
      }, { root: K.$('screens'), rootMargin: '540px 1300px' });  // #screens clips, so watch it rather than the page
    }
    img.setAttribute('data-src', url);
    if (io) { io.observe(img); } else { show(img); }
    return img;
  }
  // Through the helper once it runs: the TV's own name lookups cost 5-10 s per image server.
  function show(img) { K.helper.wait(function () { img.src = K.helper.url(img.getAttribute('data-src')); }); }

  function img(cls, src) { var i = K.el('img', cls); i.src = src; return i; }
  // A shimmer over the picture's place until the picture has loaded (or failed).
  function shine(holder, pic) {
    var s = K.el('i', 'shine');
    function done() { if (s.parentNode) { s.parentNode.removeChild(s); } }
    pic.addEventListener('load', done);
    pic.addEventListener('error', done);
    holder.appendChild(s);
    return s;
  }
  function icon(name) { return K.el('span', 'icon i-' + name); }

  // "*Categories* For You" -> highlighted first part (KickRowTitle).
  function heading(text) {
    var h = K.el('h2');
    h.innerHTML = K.esc(text).replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return h;
  }

  var cards = K.cards = { lazy: lazy, heading: heading, icon: icon, shine: shine };

  cards.stream = function (s) {
    var c = K.el('div', 'card f'), info = K.el('div', 'info'), lines = K.el('div', 'lines'), count = K.el('div', 'count'), meta = K.el('div', 'meta'), th = K.el('img', 'thumb');
    c.appendChild(lazy(th, s.thumb));
    if (s.thumb) { shine(c, th); }
    c.appendChild(K.el('div', 'shade'));
    c.appendChild(img('live', 'img/ic_live_badge.svg'));
    count.appendChild(icon('viewers'));
    count.appendChild(document.createTextNode(K.count(s.viewers)));
    c.appendChild(count);
    var av = K.el('span', 'av'), avi = K.el('img', 'avatar');
    av.appendChild(lazy(avi, s.avatar));
    if (s.avatar) { shine(av, avi); }
    info.appendChild(av);
    lines.appendChild(K.el('div', 'name', s.name));
    lines.appendChild(K.el('div', 'title', s.title));
    if (s.category) { meta.appendChild(K.el('span', '', s.category)); }
    if (s.lang) { meta.appendChild(K.el('span', '', s.lang)); }
    lines.appendChild(meta);
    info.appendChild(lines);
    c.appendChild(info);
    c._data = s;
    return c;
  };

  cards.category = function (cat, big) {
    var c = K.el('div', 'cat f' + (big ? ' big' : '')), art = K.el('img');
    if (cat.image) { c.appendChild(lazy(art, cat.image)); shine(c, art); } else { c.appendChild(K.el('div', 'noart', cat.name)); }
    c._data = cat;
    c._select = function () { K.app.push(K.screens.category(cat)); };
    return c;
  };
  cards.bigCategory = function (cat) { return cards.category(cat, true); };

  // Channel circle: live channels get the green ring and LIVE pill.
  cards.channel = function (ch, sub, small) {
    var c = K.el('div', 'chan f' + (ch.live ? ' live' : '') + (small ? ' small' : '')), ring = K.el('div', 'ring'), name = K.el('div', 'name');
    var av = K.el('img', 'avatar');
    ring.appendChild(lazy(av, ch.avatar));
    if (ch.avatar) { shine(ring, av); }
    if (ch.live) { ring.appendChild(img('pill', 'img/ic_live_badge_inverse.svg')); }
    c.appendChild(ring);
    name.appendChild(K.el('span', '', ch.name));
    if (ch.verified) { name.appendChild(img('', 'img/ic_verified.svg')); }
    c.appendChild(name);
    if (sub) { c.appendChild(K.el('div', 'sub', sub)); }
    c._data = ch;
    c._select = function () { K.app.push(K.screens.channel({ slug: ch.slug, name: ch.name, avatar: ch.avatar })); };
    return c;
  };

  // A live channel as a list row (search, before typing): ringed avatar, name, category, viewers.
  cards.liveItem = function (s) {
    var c = K.el('div', 'srow f'), av = K.el('span', 'ring'), pic = K.el('img', 'avatar'), lines = K.el('div', 'lines');
    av.appendChild(lazy(pic, s.avatar));
    if (s.avatar) { shine(av, pic); }
    c.appendChild(av);
    lines.appendChild(K.el('div', 'name', s.name));
    lines.appendChild(K.el('div', 'sub', s.category || ''));
    c.appendChild(lines);
    c.appendChild(K.el('div', 'viewers', K.count(s.viewers)));
    c._data = s;
    return c;
  };

  // Clip or past broadcast: duration and views on the picture, title and date below the gradient.
  cards.vod = function (it) {
    var c = K.el('div', 'card vod f'), info = K.el('div', 'info'), lines = K.el('div', 'lines'), count = K.el('div', 'count'), meta = K.el('div', 'meta'), th = K.el('img', 'thumb');
    c.appendChild(lazy(th, it.thumb));
    if (it.thumb) { shine(c, th); }
    c.appendChild(K.el('div', 'shade'));
    if (it.duration) { c.appendChild(K.el('span', 'dur', K.hms(it.duration))); }
    count.appendChild(icon('viewers'));
    count.appendChild(document.createTextNode(K.count(it.views)));
    c.appendChild(count);
    if (it.progress > 0) { var bar = K.el('div', 'progress'), fill = K.el('i'); fill.style.width = Math.min(100, Math.round(it.progress * 100)) + '%'; bar.appendChild(fill); c.appendChild(bar); }
    lines.appendChild(K.el('div', 'vtitle', it.title || K.t(it.kind === 'clip' ? 'Clip' : 'Past broadcast')));
    if (it.category) { meta.appendChild(K.el('span', '', it.category)); }
    if (it.created) { meta.appendChild(K.el('span', '', K.ago(it.created))); }
    lines.appendChild(meta);
    info.appendChild(lines);
    c.appendChild(info);
    c._data = it;
    return c;
  };

  // A scheduled stream: day and time (in the TV's time zone), title and category.
  cards.schedule = function (ev) {
    var c = K.el('div', 'sched f' + (ev.live ? ' live' : '')), d = new Date(ev.start), now = new Date(), lang = K.prefs.language, day, time;
    var dayDiff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    try { day = d.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' }); time = d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { day = d.toDateString(); time = d.toTimeString().slice(0, 5); }
    if (dayDiff === 0) { day = K.t('Today'); } else if (dayDiff === 1) { day = K.t('Tomorrow'); }
    c.appendChild(K.el('div', 'when', ev.live ? K.t('LIVE') : day + ' · ' + time));
    c.appendChild(K.el('div', 'stitle', ev.title || K.t('Scheduled stream')));
    if (ev.category) { c.appendChild(K.el('div', 'scat', ev.category)); }
    c._data = ev;
    return c;
  };

  // Streams open the player with the whole list, so CH+/CH- can switch between them.
  cards.streamBuilder = function () {
    return function (s, i, list) {
      var c = cards.stream(s);
      c._select = function () { K.player.open(s, list, i); };
      return c;
    };
  };

  // Shimmering placeholders in the shape of what's coming: 'card' (default), 'cat', 'cat big', 'chan'.
  cards.skeleton = function (n, kind) {
    var f = document.createDocumentFragment(), i, e;
    for (i = 0; i < n; i++) {
      e = K.el('div', (kind || 'card') + ' skeleton');
      if (kind === 'chan') { e.appendChild(K.el('div', 'ring')); e.appendChild(K.el('div', 'bar')); }
      f.appendChild(e);
    }
    return f;
  };
  cards.unskeleton = function (parent) {
    Array.prototype.forEach.call(parent.querySelectorAll('.skeleton'), function (e) { e.parentNode.removeChild(e); });
  };

  // Horizontal row section. build(item, index, items) -> element.
  cards.row = function (title, items, build) {
    var sec = K.el('section', 'sec'), view = K.el('div', 'rowview'), track = K.el('div', 'track');
    if (title) { sec.appendChild(heading(title)); }
    items.forEach(function (it, i) { track.appendChild(build(it, i, items)); });
    view.appendChild(track);
    sec.appendChild(view);
    sec._track = track;
    return sec;
  };

  cards.fillRow = function (sec, items, build) {
    sec._track.textContent = '';
    items.forEach(function (it, i) { sec._track.appendChild(build(it, i, items)); });
  };

  cards.append = function (grid, items, build, all) {
    var f = document.createDocumentFragment(), start = all.length;
    items.forEach(function (it) { all.push(it); });
    items.forEach(function (it, i) { f.appendChild(build(it, start + i, all)); });
    grid.appendChild(f);
  };

  cards.empty = function (title, text) {
    var e = K.el('div', 'empty');
    if (title) { e.appendChild(K.el('b', '', title)); }
    if (text) { e.appendChild(document.createTextNode(text)); }
    return e;
  };

  cards.button = function (label, action, primary) {
    var b = K.el('span', 'btn f' + (primary ? ' primary' : ''), label);
    b._select = action;
    return b;
  };
})(window.K);
