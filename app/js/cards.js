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
      }, { root: K.$('screens'), rootMargin: '400px 1300px' });  // #screens clips, so watch it rather than the page
    }
    img.setAttribute('data-src', url);
    if (io) { io.observe(img); } else { show(img); }
    return img;
  }
  // Through the helper once it runs: the TV's own name lookups cost 5-10 s per image server.
  function show(img) { K.helper.wait(function () { img.src = K.helper.url(img.getAttribute('data-src')); }); }

  function img(cls, src) { var i = K.el('img', cls); i.src = src; return i; }
  function icon(name) { return K.el('span', 'icon i-' + name); }

  // "*Categories* For You" -> highlighted first part (KickRowTitle).
  function heading(text) {
    var h = K.el('h2');
    h.innerHTML = K.esc(text).replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return h;
  }

  var cards = K.cards = { lazy: lazy, heading: heading, icon: icon };

  cards.stream = function (s) {
    var c = K.el('div', 'card f'), info = K.el('div', 'info'), lines = K.el('div', 'lines'), count = K.el('div', 'count'), meta = K.el('div', 'meta');
    c.appendChild(lazy(K.el('img', 'thumb'), s.thumb));
    c.appendChild(K.el('div', 'shade'));
    c.appendChild(img('live', 'img/ic_live_badge.svg'));
    count.appendChild(icon('viewers'));
    count.appendChild(document.createTextNode(K.count(s.viewers)));
    c.appendChild(count);
    info.appendChild(lazy(K.el('img', 'avatar'), s.avatar));
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
    var c = K.el('div', 'cat f' + (big ? ' big' : ''));
    if (cat.image) { c.appendChild(lazy(K.el('img'), cat.image)); } else { c.appendChild(K.el('div', 'noart', cat.name)); }
    c._data = cat;
    c._select = function () { K.app.push(K.screens.category(cat)); };
    return c;
  };
  cards.bigCategory = function (cat) { return cards.category(cat, true); };

  // Channel circle: live channels get the green ring and LIVE pill.
  cards.channel = function (ch, sub, small) {
    var c = K.el('div', 'chan f' + (ch.live ? ' live' : '') + (small ? ' small' : '')), ring = K.el('div', 'ring'), name = K.el('div', 'name');
    ring.appendChild(lazy(K.el('img', 'avatar'), ch.avatar));
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

  // Clip or past broadcast: duration and views on the picture, title and date below the gradient.
  cards.vod = function (it) {
    var c = K.el('div', 'card vod f'), info = K.el('div', 'info'), lines = K.el('div', 'lines'), count = K.el('div', 'count'), meta = K.el('div', 'meta');
    c.appendChild(lazy(K.el('img', 'thumb'), it.thumb));
    c.appendChild(K.el('div', 'shade'));
    if (it.duration) { c.appendChild(K.el('span', 'dur', K.hms(it.duration))); }
    count.appendChild(icon('viewers'));
    count.appendChild(document.createTextNode(K.count(it.views)));
    c.appendChild(count);
    lines.appendChild(K.el('div', 'vtitle', it.title || K.t(it.kind === 'clip' ? 'Clip' : 'Past broadcast')));
    if (it.category) { meta.appendChild(K.el('span', '', it.category)); }
    if (it.created) { meta.appendChild(K.el('span', '', K.ago(it.created))); }
    lines.appendChild(meta);
    info.appendChild(lines);
    c.appendChild(info);
    c._data = it;
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

  cards.skeleton = function (n) {
    var f = document.createDocumentFragment(), i;
    for (i = 0; i < n; i++) { f.appendChild(K.el('div', 'card skeleton')); }
    return f;
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
