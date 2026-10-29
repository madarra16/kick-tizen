/* Screens in the layout of Kick's Android TV app: home (featured carousel + rows), categories,
   live, following, search, settings, plus category detail and sign-in. Each returns
   { name, root, el, scroller } and optionally destroy(); K.app shows and stacks them. */
(function (K) {
  'use strict';

  var screens = K.screens = {};
  var CAROUSEL_MS = 8000;

  function base(name, root) {
    var el = K.el('div', 'screen'), sc = K.el('div', 'scroller'), s = { name: name, root: root, el: el, scroller: sc };
    el.appendChild(sc);
    s.ready = function () { K.app.screenReady(s); };
    return s;
  }

  function section(title) {
    var sec = K.el('div', 'sec');
    if (title) { sec.appendChild(K.cards.heading(title)); }
    return sec;
  }

  function buttonRow(buttons) {
    var row = K.el('div', 'sec');
    buttons.forEach(function (b) { row.appendChild(K.cards.button(b[0], b[1], b[2])); });
    return row;
  }

  function fillOrNote(sec, items, build, err) {
    if (items.length) { K.cards.fillRow(sec, items, build); return; }
    sec._track.textContent = '';
    sec._track.appendChild(K.cards.empty('', K.t(err ? 'Kick did not answer. Open Home again in a moment.' : 'Nothing live here right now.')));
  }

  // Endless grid: loads page after page as focus nears the end. reset() starts it over (a new
  // sort order or clip range); answers for the old one are dropped.
  function pagedGrid(s, grid, fetch, build, filter, emptyText, skeleton) {
    var page = 0, more = true, loading = false, items = [], gen = 0;
    function next() {
      if (loading || !more) { return; }
      var my = gen;
      loading = true;
      page++;
      if (!items.length) { grid.appendChild(K.cards.skeleton(skeleton === 'cat big' ? 12 : 6, skeleton)); }
      fetch(page, function (err, list, hasMore) {
        if (my !== gen) { return; }
        K.cards.unskeleton(grid);
        loading = false;
        more = !err && hasMore;
        if (err && !items.length) { grid.appendChild(K.cards.empty(K.t('Could not load'), K.t('Kick did not answer.'))); return; }
        K.cards.append(grid, list.filter(filter), function (it, i, all) {
          var c = build(it, i, all);
          c._focus = function () { if (i >= all.length - 8) { next(); } };
          return c;
        }, items);
        if (items.length < 12 && more) { next(); } else if (!items.length) { grid.appendChild(K.cards.empty('', emptyText || K.t('Nothing live here right now.'))); }
        s.ready();
      });
    }
    next();
    return { reset: function () { gen++; page = 0; more = true; loading = false; items = []; grid.textContent = ''; next(); } };
  }

  // A row of pill buttons (sort orders, clip ranges); the chosen one is highlighted.
  function pills(options, current, pick) {
    var row = K.el('div', 'sec pills');
    options.forEach(function (o) {
      var b = K.cards.button(o[1], function () {
        Array.prototype.forEach.call(row.children, function (x) { x.classList.toggle('primary', x === b); });
        pick(o[0]);
      }, o[0] === current);
      row.appendChild(b);
    });
    return row;
  }
  function sortPills(pick) {
    return pills([['viewer_count_desc', K.t('Viewers (High to Low)')], ['viewer_count_asc', K.t('Viewers (Low to High)')], ['featured', K.t('Featured')]],
      'viewer_count_desc', pick);
  }

  // Clip or past broadcast card that opens the player with its whole row.
  function vodBuilder(list) {
    return function (it, i, all) {
      var c = K.cards.vod(it);
      c._select = function () { K.player.openVod(it, list || all, i); };
      return c;
    };
  }

  // ---- Home: featured carousel (FeaturedCarouselRow) + rows ----
  screens.home = function () {
    var s = base('home', true), sc = s.scroller, featured = [], index = 0, timer = null, front = 0;
    var hero = K.el('div', 'hero f loading'), imgs = [K.el('img', 'hero-img'), K.el('img', 'hero-img')], info = K.el('div', 'hero-info'),
      badges = K.el('div', 'hero-badges'), head = K.el('div', 'hero-head'), dots = K.el('div', 'hero-dots');
    hero.appendChild(imgs[0]);
    hero.appendChild(imgs[1]);
    hero.appendChild(K.el('div', 'hero-grad'));
    info.appendChild(badges);
    info.appendChild(head);
    hero.appendChild(info);
    hero.appendChild(dots);
    sc.appendChild(hero);

    function text(st) {
      badges.innerHTML = '<img class="live" src="img/ic_live_badge.svg"><span class="count">' + K.esc(K.count(st.viewers)) + '</span>';
      head.innerHTML = (st.avatar ? '<img class="avatar" src="' + K.esc(K.helper.url(st.avatar)) + '">' : '') + '<div class="lines"><div class="name">' + K.esc(st.name) +
        '</div><div class="cat-lang">' + K.esc([st.category, st.lang].filter(Boolean).join(' · ')) + '</div><div class="title">' + K.esc(st.title) + '</div></div>';
      // Restart the text's fade-in.
      info.classList.remove('swap');
      void info.offsetWidth;
      info.classList.add('swap');
    }
    // The next picture loads behind the current one, then the two crossfade (with a slow zoom)
    // and the text changes with it; a picture that doesn't load still gets its text.
    function show(i, now) {
      if (!featured.length) { return; }
      index = (i + featured.length) % featured.length;
      var st = featured[index], back = imgs[1 - front], texted = false;
      if (now) { texted = true; text(st); hero.classList.remove('loading'); }
      dots.innerHTML = featured.map(function (x, n) { return n === index ? '<i class="on"></i>' : '<i></i>'; }).join('');
      function showText() {
        if (texted || featured[index] !== st) { return; }
        texted = true;
        text(st);
        hero.classList.remove('loading');
      }
      back.classList.remove('on');
      back.onload = function () {
        if (featured[index] !== st) { return; }
        showText();
        back.classList.add('on');
        imgs[front].classList.remove('on');
        front = 1 - front;
      };
      back.onerror = showText;
      back.src = K.helper.url(st.thumbLarge || st.thumb) || '';
      setTimeout(showText, 2500);
    }
    function restartTimer() {
      clearInterval(timer);
      timer = setInterval(function () { if (!K.player.isOpen()) { show(index + 1); } }, CAROUSEL_MS);
    }
    hero._dir = function (k) {
      if (k !== 'left' && k !== 'right' || featured.length < 2) { return false; }
      show(index + (k === 'right' ? 1 : -1));
      restartTimer();
      return true;
    };
    hero._select = function () { if (featured.length) { K.player.open(featured[index], featured, index); } };

    var cats = K.cards.row(K.t('*Categories* For You'), [], null), streams = K.cards.row(K.t('*Streams* For You'), [], null), resume = null;
    cats._track.appendChild(K.cards.skeleton(9, 'cat'));
    streams._track.appendChild(K.cards.skeleton(4));
    sc.appendChild(cats);
    sc.appendChild(streams);

    // Continue Watching: past broadcasts left part-way. Rebuilt when the player closes.
    s.refresh = function () {
      var items = K.resume.list().map(function (e) { var it = e.item; it.progress = e.dur ? e.sec / e.dur : 0; return it; }).filter(K.allowStream);
      var hadFocus = resume && K.focus.current && resume.contains(K.focus.current), row = items.length ? K.cards.row(K.t('Continue Watching'), items, vodBuilder()) : null;
      if (resume) { sc.removeChild(resume); }
      resume = row;
      if (row) { sc.insertBefore(row, cats); if (hadFocus) { s.el._last = row._track.firstChild; } }
    };
    s.refresh();

    // Signed in: Kick's personal recommendations, as the official app; otherwise (or if they
    // don't load) the most watched categories and streams.
    function withFallback(personal, general, cb) {
      if (!K.auth.signedIn()) { return general(cb); }
      personal(K.auth.token, function (err, list) { if (err || !list.length) { general(cb); } else { cb(null, list); } });
    }

    K.api.featured(function (err, list) {
      featured = list.filter(K.allowStream);
      if (featured.length) { show(0, true); restartTimer(); } else { hero.classList.remove('loading'); head.innerHTML = '<div class="lines"><div class="name">' + K.esc(K.t('No featured streams right now')) + '</div></div>'; }
      s.ready();
    });
    withFallback(K.api.recommendedStreams, K.api.popular, function (err, list) { fillOrNote(streams, list.filter(K.allowStream), K.cards.streamBuilder(), err); s.ready(); });
    // The four "Live in <category>" rows are in place (shimmering) from the start, so the page
    // doesn't grow row by row; each gets its title and streams when they arrive.
    var liveRows = [0, 1, 2, 3].map(function () {
      var row = K.cards.row('', [], null), h = K.el('div', 'ph ph-h');
      h.appendChild(K.el('i', 'shine run'));
      row.insertBefore(h, row.firstChild);
      row._track.appendChild(K.cards.skeleton(4));
      sc.appendChild(row);
      return row;
    });
    withFallback(K.api.recommendedCategories, K.api.topCategories, function (err, list) {
      list = list.filter(K.allowCategory);
      fillOrNote(cats, list, function (c) { return K.cards.category(c); }, err);
      liveRows.forEach(function (row, i) {
        var cat = list[i];
        if (!cat) { sc.removeChild(row); return; }
        row.replaceChild(K.cards.heading(K.t('Live in *{name}*', { name: cat.name })), row.firstChild);
        K.api.streams(cat.id, 1, function (err2, items) {
          items = items.filter(K.allowStream);
          if (!items.length) { sc.removeChild(row); return; }
          K.cards.fillRow(row, items, K.cards.streamBuilder());
          s.ready();
        });
      });
      s.ready();
    });
    s.destroy = function () { clearInterval(timer); };
    return s;
  };

  // ---- Categories: box-art grid, 6 per row; or Kick-wide top clips (kick.com Browse › Clips) ----
  screens.categories = function () {
    var s = base('categories', true), sc = s.scroller, body = K.el('div'), mode = 'categories', time = 'day';
    sc.appendChild(pills([['categories', K.t('Categories')], ['clips', K.t('Clips')]], mode, function (v) { if (v !== mode) { mode = v; render(); } }));
    sc.appendChild(body);
    function render() {
      body.textContent = '';
      if (mode === 'categories') {
        var grid = K.el('div', 'grid cats');
        body.appendChild(grid);
        pagedGrid(s, grid, K.api.categories, K.cards.bigCategory, K.allowCategory, null, 'cat big');
        return;
      }
      var clips = K.el('div', 'grid'), cursor = null, g = null;
      body.appendChild(pills([['day', K.t('Today')], ['week', K.t('This week')], ['month', K.t('This month')], ['all', K.t('All Time')]], time,
        function (v) { time = v; g.reset(); }));
      body.appendChild(clips);
      g = pagedGrid(s, clips, function (page, cb) {
        if (page === 1) { cursor = null; }
        K.api.topClips(time, cursor, function (err, list, next) { cursor = next || null; cb(err, list, !!next); });
      }, vodBuilder(), K.allowStream, K.t('No clips available'));
    }
    render();
    return s;
  };

  // ---- Live: all live channels in the content language, sortable ----
  screens.live = function () {
    var s = base('live', true), grid = K.el('div', 'grid'), sort = 'viewer_count_desc', g = null;
    s.scroller.appendChild(sortPills(function (v) { sort = v; g.reset(); }));
    s.scroller.appendChild(grid);
    g = pagedGrid(s, grid, function (page, cb) { K.api.streams(null, page, cb, sort); }, K.cards.streamBuilder(), K.allowStream);
    return s;
  };

  // ---- Category detail (from a category card) ----
  screens.category = function (cat) {
    var s = base('category', false), sc = s.scroller, head = K.el('div', 'cat-head sec'), grid = K.el('div', 'grid');
    head.innerHTML = (cat.image ? '<img src="' + K.esc(K.helper.url(cat.image)) + '">' : '') + '<div><h1>' + K.esc(cat.name) + '</h1><div class="sub">' +
      K.esc(K.t('{n} viewers', { n: K.count(cat.viewers) })) + '</div>' + (cat.tags || []).slice(0, 4).map(function (t) { return '<span class="tag">' + K.esc(t) + '</span>'; }).join('') + '</div>';
    var sort = 'viewer_count_desc', g = null;
    sc.appendChild(head);
    sc.appendChild(sortPills(function (v) { sort = v; g.reset(); }));
    sc.appendChild(grid);
    g = pagedGrid(s, grid, function (page, cb) { K.api.streams(cat.id, page, cb, sort, cat.slug); }, K.cards.streamBuilder(), K.allowStream);
    return s;
  };

  // ---- Following ----
  screens.following = function () {
    var s = base('following', true), sc = s.scroller;
    if (!K.auth.signedIn()) {
      sc.appendChild(K.cards.empty(K.t("You haven't signed into your account yet"), K.t('Please sign in to see your following content.')));
      sc.appendChild(buttonRow([[K.t('Sign in'), function () { K.app.push(screens.login()); }, true]]));
      return s;
    }
    var loading = K.cards.row(K.t('Live channels'), [], null);
    loading._track.appendChild(K.cards.skeleton(3));
    sc.appendChild(loading);
    K.api.followed(K.auth.token, function (err, rows) {
      sc.removeChild(loading);
      if (err) {
        var why = err.status === 401 || err.status === 403 ? K.t('Kick did not accept the sign-in (HTTP {n}). Log out and sign in again in Account.', { n: err.status })
          : K.t('Kick did not answer ({n}).', { n: err.status || K.t('network error') });
        sc.appendChild(K.cards.empty(K.t('Could not load your follows'), why));
        sc.appendChild(buttonRow([[K.t('Try again'), function () { K.app.reload('following'); }, true]]));
        s.ready();
        return;
      }
      var live = rows.filter(function (c) { return c.live; }).sort(function (a, b) { return b.viewers - a.viewers; }).slice(0, 24);
      var offline = rows.filter(function (c) { return !c.live; });
      if (!rows.length) {
        sc.appendChild(K.cards.empty(K.t("You haven't followed any channels"), K.t('Discover new streamers.')));
        sc.appendChild(buttonRow([[K.t('Go to Browse'), function () { K.app.go('categories'); }, true]]));
        s.ready();
        return;
      }
      var liveRow = K.cards.row(K.t('Live channels'), [], null);
      sc.appendChild(liveRow);
      if (!live.length) { liveRow._track.appendChild(K.cards.empty(K.t('At the moment, no one is streaming'), '')); }
      else {
        liveRow._track.appendChild(K.cards.skeleton(Math.min(live.length, 3)));
        var streams = [], left = live.length;
        live.forEach(function (c, i) {
          K.api.livestream(c.slug, function (e, ls) {
            ls = ls || { title: c.title, viewers: c.viewers, category: c.category, lang: '', thumb: c.avatar };
            ls.slug = c.slug; ls.name = c.name; ls.avatar = c.avatar;
            streams[i] = ls;
            if (--left === 0) {
              streams = streams.filter(Boolean).sort(function (a, b) { return b.viewers - a.viewers; });
              K.cards.fillRow(liveRow, streams, K.cards.streamBuilder());
              s.ready();
            }
          });
        });
      }
      // Followed categories, between live and offline channels as in the official app.
      var catRow = K.cards.row(K.t('Categories'), [], null);
      catRow._track.appendChild(K.cards.skeleton(7, 'cat'));
      sc.appendChild(catRow);
      K.api.followedCategories(K.auth.token, function (e, cats) {
        cats = (cats || []).filter(K.allowCategory);
        if (!cats.length) { sc.removeChild(catRow); } else { K.cards.fillRow(catRow, cats, function (c) { return K.cards.category(c); }); }
        s.ready();
      });
      if (offline.length) {
        sc.appendChild(K.cards.row(K.t('Offline channels'), offline, function (c) { return K.cards.channel(c, null, true); }));
      }
      s.ready();
    });
    return s;
  };

  // ---- Search (SearchLetterButton keyboard on the left, results on the right) ----
  var LAYOUTS = {
    abc: 'abcdefghijklmnopqrstuvwxyz1234567890'.split(''),
    sym: '_-.@#&!?+*/:;()\'"=$%,~^[]{}<>|\\'.split('').slice(0, 36),
    acc: 'àáâäãåèéêëìíîïòóôöõùúûüñçßýÿæœøðþ'.split('').slice(0, 36)
  };
  screens.search = function () {
    var s = base('search', true), text = '', timer = null, req = null, gen = 0, layout = 'abc';
    var kbd = K.el('div', 'kbd'), query = K.el('div', 'query placeholder', K.t('Search')), keys = K.el('div', 'keys'), results = s.scroller;
    results.classList.add('search-results');
    results.setAttribute('data-scroll', 'list');
    kbd.appendChild(query);
    kbd.appendChild(keys);
    s.el.appendChild(kbd);

    function type(value) {
      text = value === null ? text.slice(0, -1) : value === '' ? '' : (text + value).slice(0, 40);
      query.textContent = text || K.t('Search');
      query.classList.toggle('placeholder', !text);
      clearTimeout(timer);
      timer = setTimeout(run, 450);
    }
    function key(content, value, cls) {
      var k = K.el('span', 'key f' + (cls ? ' ' + cls : ''));
      if (typeof content === 'string') { k.textContent = content; } else { k.appendChild(content); }
      k._select = typeof value === 'function' ? value : function () { type(value); };
      keys.appendChild(k);
      return k;
    }
    function build() {
      var focused = K.focus.current && keys.contains(K.focus.current) ? Array.prototype.indexOf.call(keys.children, K.focus.current) : -1;
      keys.textContent = '';
      LAYOUTS[layout].forEach(function (c) { key(c, c); });
      key(K.cards.icon('clear'), '', 'w2');
      key(K.cards.icon('space'), ' ', 'w2');
      key(K.cards.icon('backspace'), null, 'w2');
      key(layout === 'sym' ? 'abc' : '@#&', function () { layout = layout === 'sym' ? 'abc' : 'sym'; build(); }, 'w3');
      key(layout === 'acc' ? 'abc' : 'ÀÈÜ', function () { layout = layout === 'acc' ? 'abc' : 'acc'; build(); }, 'w3');
      if (focused >= 0) { K.focus.set(keys.children[Math.min(focused, keys.children.length - 1)]); }
    }
    build();

    function remember(q) {
      var rec = K.store.get('kick.recentSearch', []).filter(function (x) { return x !== q; });
      rec.unshift(q);
      K.store.set('kick.recentSearch', rec.slice(0, 8));
    }
    function remembering(q, el) { var sel = el._select; el._select = function () { remember(q); sel(); }; return el; }

    // Before typing: recent searches, then who's live right now (as in the Kick phone app).
    function recent() {
      var rec = K.store.get('kick.recentSearch', []), my = gen;
      if (rec.length) {
        var sec = section(K.t('Recent Search'));
        rec.forEach(function (r) {
          sec.appendChild(K.cards.button(r, function () { text = r; query.textContent = r; query.classList.remove('placeholder'); run(); }));
        });
        results.appendChild(sec);
      }
      var live = section(K.t('Live channels')), list = K.el('div', 'slist');
      for (var i = 0; i < 7; i++) {
        var ph = K.el('div', 'srow skeleton'), ring = K.el('span', 'ring'), lines = K.el('div', 'lines');
        ring.appendChild(K.el('i', 'shine run'));
        ['ph-l1', 'ph-l2'].forEach(function (c) { var b = K.el('div', 'ph ' + c); b.appendChild(K.el('i', 'shine run')); lines.appendChild(b); });
        ph.appendChild(ring);
        ph.appendChild(lines);
        list.appendChild(ph);
      }
      live.appendChild(list);
      results.appendChild(live);
      K.api.streams(null, 1, function (err, items) {
        if (my !== gen) { return; }
        items = (items || []).filter(K.allowStream).slice(0, 20);
        list.textContent = '';
        if (!items.length) { list.appendChild(K.cards.empty('', K.t('Type at least 2 characters to search channels, categories and livestreams.'))); return; }
        items.forEach(function (st, n) {
          var row = K.cards.liveItem(st);
          row._select = function () { K.player.open(st, items, n); };
          list.appendChild(row);
        });
        s.ready();
      });
    }

    function run() {
      var q = text.replace(/^\s+|\s+$/g, ''), my = ++gen;
      results.textContent = '';
      results._off = 0;
      results.style.transform = '';
      if (req) { req.abort(); req = null; }
      if (q.length < 2) { recent(); return; }
      var wait = K.cards.row(K.t('Channels'), [], null);
      wait._track.appendChild(K.cards.skeleton(6, 'chan'));
      results.appendChild(wait);
      req = K.api.search(q, function (err, r) {
        if (my !== gen) { return; }
        results.textContent = '';
        if (err) { results.appendChild(K.cards.empty(K.t('Search failed'), K.t('Kick did not answer.'))); return; }
        var cats = r.categories.filter(K.allowCategory), live = r.channels.filter(function (c) { return c.live; });
        if (!r.channels.length && !cats.length) { results.appendChild(K.cards.empty(K.t("We couldn't find any matches for '{q}'", { q: q }), K.t('Try searching for a different term.'))); return; }
        if (r.channels.length) {
          results.appendChild(K.cards.row(K.t('Channels'), r.channels, function (c) { return remembering(q, K.cards.channel(c, K.t('{n} followers', { n: K.count(c.followers) }))); }));
        }
        if (cats.length) { results.appendChild(K.cards.row(K.t('Categories'), cats, function (c) { return remembering(q, K.cards.category(c)); })); }
        if (live.length) {
          var row = K.cards.row(K.t('Livestreams'), [], null), streams = [], left = Math.min(live.length, 8);
          results.appendChild(row);
          live.slice(0, 8).forEach(function (c, i) {
            K.api.livestream(c.slug, function (e, ls) {
              if (my !== gen) { return; }
              if (ls) { ls.slug = c.slug; ls.name = c.name; ls.avatar = c.avatar; streams[i] = ls; }
              if (--left === 0) {
                streams = streams.filter(Boolean);
                if (streams.length) { K.cards.fillRow(row, streams, function (st, n, all) { return remembering(q, K.cards.streamBuilder()(st, n, all)); }); }
                else { results.removeChild(row); }
              }
            });
          });
        }
      });
    }
    recent();
    return s;
  };

  // ---- Streamer page: header, Watch Live, clips (most viewed) and past broadcasts ----
  screens.channel = function (c) {
    var s = base('channel', false), sc = s.scroller, me = { slug: c.slug, name: c.name, avatar: c.avatar };
    var banner = K.el('div', 'ch-banner'), head = K.el('div', 'ch-head sec'), clipsRow = K.cards.row(K.t('Clips'), [], null), vodsRow = K.cards.row(K.t('Recent broadcasts'), [], null);
    sc.appendChild(banner);
    sc.appendChild(head);
    sc.appendChild(clipsRow);
    sc.appendChild(vodsRow);
    clipsRow._track.appendChild(K.cards.skeleton(3));
    vodsRow._track.appendChild(K.cards.skeleton(3));
    // Filled once the channel is known; each stays hidden when it has nothing to show.
    var schedRow = K.cards.row(K.t('Schedule'), [], null), recentRow = K.cards.row(K.t('Recently streamed categories'), [], null), about = K.el('section', 'sec');
    [schedRow, recentRow, about].forEach(function (e) { e.hidden = true; sc.appendChild(e); });

    function header(ch) {
      var u = (ch && ch.user) || {}, ls = ch && ch.livestream, img = (ch && (ch.banner_image || ch.offline_banner_image)) || {};
      var bannerUrl = img.url || img.src;
      me.name = u.username || me.name;
      me.avatar = u.profile_pic || me.avatar;
      banner.textContent = '';
      if (bannerUrl) { var bi = K.el('img'); banner.appendChild(bi); K.cards.shine(banner, bi); bi.src = K.helper.url(bannerUrl); }
      banner.appendChild(K.el('div', 'ch-shade'));
      head.textContent = '';
      var av = K.el('img', 'avatar' + (ls ? ' live' : ''));
      av.src = me.avatar ? K.helper.url(me.avatar) : 'img/default_avatar.png';
      var text = K.el('div', 'ch-text'), name = K.el('div', 'ch-name', me.name || c.slug), sub = K.el('div', 'ch-sub');
      if (ch && ch.verified) { var v = K.el('img'); v.src = 'img/ic_verified.svg'; name.appendChild(v); }
      sub.textContent = (ch ? K.t('{n} followers', { n: K.count(ch.followers_count || 0) }) : '') + (ls ? '' : (ch ? ' · ' + K.t('Offline') : ''));
      if (ls) {
        var live = K.el('span', 'ch-live');
        live.textContent = K.t('LIVE') + ' · ' + K.t('{n} viewers', { n: K.count(ls.viewer_count) }) + (((ls.categories || [])[0] || {}).name ? ' · ' + ls.categories[0].name : '');
        sub.appendChild(document.createTextNode(' · '));
        sub.appendChild(live);
      }
      text.appendChild(name);
      text.appendChild(sub);
      if (ls && ls.session_title) { text.appendChild(K.el('div', 'ch-title', ls.session_title)); }
      else if (u.bio) { text.appendChild(K.el('div', 'ch-bio', u.bio)); }
      var buttons = K.el('div', 'ch-buttons');
      if (ls) { buttons.appendChild(K.cards.button(K.t('Watch Live'), function () { K.player.open({ slug: c.slug, name: me.name, avatar: me.avatar }); }, true)); }
      buttons.appendChild(K.cards.button(K.t('Follow'), function () {
        K.modal.show({ title: K.t('Follow {name}', { name: me.name }), text: K.t('Scan the QR code with your phone to follow {name} in the Kick app.', { name: me.name }),
          qr: 'https://kick.com/' + c.slug + '?follow=true', buttons: [[K.t('Done'), null, true]] });
      }, !ls));
      buttons.appendChild(K.cards.button(K.t('Subscribe'), function () {
        K.modal.show({ title: K.t('Subscribe to {name}', { name: me.name }), text: K.t('Scan the QR code with your phone to subscribe to {name} in the Kick app.', { name: me.name }),
          qr: 'https://kick.com/' + c.slug + '?subscribe=true', buttons: [[K.t('Done'), null, true]] });
      }));
      text.appendChild(buttons);
      head.appendChild(av);
      head.appendChild(text);
      if (ch) { extras(ch); }
      s.ready();
    }

    // Schedule, recently streamed categories and About (bio and social links), as on kick.com.
    var extrasDone = false;
    function extras(ch) {
      if (extrasDone) { return; }
      extrasDone = true;
      K.api.schedule(ch.id, function (e, events) {
        if (!events || !events.length) { return; }
        K.cards.fillRow(schedRow, events, function (ev) {
          var card = K.cards.schedule(ev);
          if (ev.live || (ch.livestream && ev.start <= Date.now())) { card._select = function () { K.player.open({ slug: c.slug, name: me.name, avatar: me.avatar }); }; }
          return card;
        });
        schedRow.hidden = false;
        s.ready();
      });
      K.api.recentCategories(c.slug, function (e, cats) {
        cats = (cats || []).filter(K.allowCategory);
        if (!cats.length) { return; }
        K.cards.fillRow(recentRow, cats, function (x) { return K.cards.category(x); });
        recentRow.hidden = false;
        s.ready();
      });
      var u = ch.user || {}, links = [['Instagram', 'instagram.com/', u.instagram], ['X', 'x.com/', u.twitter], ['YouTube', 'youtube.com/', u.youtube],
        ['Discord', 'discord.gg/', u.discord], ['TikTok', 'tiktok.com/@', u.tiktok], ['Facebook', 'facebook.com/', u.facebook]].filter(function (l) { return l[2]; });
      if (!u.bio && !links.length) { return; }
      about.textContent = '';
      about.appendChild(K.cards.heading(K.t('About {name}', { name: me.name })));
      var box = K.el('div', 'about f');  // focusable, so the page can scroll down to it
      if (u.bio) { box.appendChild(K.el('p', '', u.bio)); }
      links.forEach(function (l) {
        var row = K.el('div', 'link');
        row.appendChild(K.el('b', '', l[0]));
        row.appendChild(document.createTextNode(l[1] + String(l[2]).replace(/^@|\/$/g, '')));
        box.appendChild(row);
      });
      about.appendChild(box);
      about.hidden = false;
    }
    // A request that failed is asked once more before the page shows it as empty.
    function twice(call, done) {
      call(function (err) { if (!err) { return done.apply(null, arguments); } setTimeout(function () { call(done); }, 1500); });
    }
    // While the channel loads: the header's shape, shimmering.
    function loadingHeader() {
      banner.textContent = '';
      banner.appendChild(K.el('i', 'shine run'));
      head.textContent = '';
      var av = K.el('div', 'avatar ph'), text = K.el('div', 'ch-text'), buttons = K.el('div', 'ch-buttons');
      av.appendChild(K.el('i', 'shine run'));
      head.appendChild(av);
      ['ph-name', 'ph-sub', 'ph-line'].forEach(function (cls) { var e = K.el('div', 'ph ' + cls); e.appendChild(K.el('i', 'shine run')); text.appendChild(e); });
      [0, 1, 2].forEach(function () { var e = K.el('span', 'ph ph-btn'); e.appendChild(K.el('i', 'shine run')); buttons.appendChild(e); });
      text.appendChild(buttons);
      head.appendChild(text);
    }
    loadingHeader();
    twice(function (cb) { K.api.channel(c.slug, cb); }, function (err, ch) { header(err ? null : ch); });

    // Clips: more pages load as focus nears the end of the row.
    var clips = [], next = null, loading = false;
    function addClips(items) {
      var startAt = clips.length;
      if (!startAt) { clipsRow._track.textContent = ''; }
      items.forEach(function (it) { clips.push(it); });
      items.forEach(function (it, n) {
        var i = startAt + n, card = K.cards.vod(it);
        card._select = function () { K.player.openVod(it, clips, i); };
        card._focus = function () { if (i >= clips.length - 4) { moreClips(); } };
        clipsRow._track.appendChild(card);
      });
      if (!clips.length) { clipsRow._track.appendChild(K.cards.empty('', K.t('No clips available'))); }
      s.ready();
    }
    function moreClips() {
      if (loading || (clips.length && !next)) { return; }
      loading = true;
      twice(function (cb) { K.api.clips(c.slug, next, cb); }, function (err, items, cursor) { loading = false; next = cursor || null; addClips(err ? [] : items); });
    }
    moreClips();

    twice(function (cb) { K.api.channelVideos(c.slug, cb); }, function (err, vids) {
      var past = vids.filter(function (v) { return !v.live; });
      past.forEach(function (v) { v.channel = me; });
      vodsRow._track.textContent = '';
      if (!past.length) { vodsRow._track.appendChild(K.cards.empty('', K.t('No videos available'))); }
      past.forEach(function (v, i) {
        var card = K.cards.vod(v);
        card._select = function () { K.player.openVod(v, past, i); };
        vodsRow._track.appendChild(card);
      });
      s.ready();
    });
    return s;
  };

  // ---- Account (the TV's settings, laid out like the Kick app's Account screen; the texts,
  // switches and QR codes of the help and legal rows are the official TV app's) ----
  screens.settings = function () {
    var s = base('settings', true), sc = s.scroller, wrap = K.el('div', 'acct'), signedIn = K.auth.signedIn(), user = K.auth.user || {};
    sc.setAttribute('data-scroll', 'list');
    sc.appendChild(wrap);

    function maskIcon(file) { var i = K.el('span', 'icon'); i.style.webkitMaskImage = 'url(img/' + file + '.svg)'; return i; }
    function section(text) { wrap.appendChild(K.el('div', 'acct-sec', text)); }
    function row(icon, label, value, action, end) {
      var r = K.el('div', 'acct-row f'), v = K.el('span', 'value', value || '');
      r.appendChild(icon.tagName ? icon : maskIcon(icon));
      r.appendChild(K.el('span', 'label', label));
      r.appendChild(v);
      r.appendChild(end || maskIcon('ic_chevron_right'));
      r._select = function () { action(v); };
      wrap.appendChild(r);
      return r;
    }
    // KickSwitch: OK flips it.
    function toggle(icon, label, get, set) {
      var sw = K.el('span', 'switch'), r = row(icon, label, '', function () { set(!get()); sw.classList.toggle('on', get()); }, sw);
      sw.appendChild(K.el('span', 'knob'));
      sw.classList.toggle('on', get());
      return r;
    }
    function qrPage(title, url, image) {
      K.modal.show({ title: title, text: K.t('On your phone or computer, visit:'), url: url, image: 'img/' + image + '.svg', buttons: [[K.t('Done'), null, true]] });
    }
    function playbackValue() { return (K.prefs.quality === 'auto' ? K.t('Auto') : K.prefs.quality + 'p') + ' · ' + K.t('Chat') + ' ' + K.t(K.prefs.chat ? 'On' : 'Off'); }
    function options(label, opts, current, pick, v, value) {
      K.modal.options(label, opts.map(function (o) { return { id: o[0], label: o[1] }; }), current, function (id) { pick(id); K.savePrefs(); v.textContent = value(); });
    }
    function content(key) {
      return function (on) { K.prefs[key] = on; K.savePrefs(); K.app.prefsChanged(key); };
    }

    section(K.t('Account'));
    if (signedIn) {
      var av = K.el('img', 'acct-avatar'), slug = user.slug || user.name;
      av.src = user.avatar ? K.helper.url(user.avatar) : 'img/default_avatar.png';
      row(av, user.name || K.t('Kick account'), K.t(K.auth.lastError ? 'Profile not loaded · OK to retry' : 'Your channel'), function () {
        if (!user.name) { K.auth.refreshUser(function () { K.app.reload('settings'); }); return; }
        K.app.push(screens.channel({ slug: slug, name: user.name, avatar: user.avatar }));
      });
      // Other signed-in accounts, and adding one (the QR sign-in again).
      var others = K.auth.accounts().slice(1);
      row('ic_profile', K.t(others.length ? 'Switch account' : 'Add account'),
        others.length ? K.t('{n} accounts on this TV', { n: others.length + 1 }) : K.t('Use another Kick account'), function () {
          if (!others.length) { K.app.push(screens.login()); return; }
          var list = K.auth.accounts().map(function (a) { return { id: a.token, label: (a.user && a.user.name) || K.t('Kick account') }; });
          list.push({ id: '+', label: '+ ' + K.t('Add account') });
          K.modal.options(K.t('Switch account'), list, K.auth.token, function (id) {
            if (id === '+') { K.app.push(screens.login()); } else { K.auth.use(id); }
          });
        });
    } else {
      row('ic_profile', K.t('Sign in'), K.t('Use the Kick app on your phone'), function () { K.app.push(screens.login()); });
    }

    section(K.t('Preferences'));
    // The app's language; streams are listed in the same language.
    row('ic_language', K.t('Language'), (K.prefs.languageChosen ? '' : K.t('Automatic') + ' · ') + K.languageName(K.prefs.language), function () {
      var list = [{ id: 'auto', label: K.t('Automatic') + ' (' + K.languageName(K.deviceLanguage()) + ')' }].concat(K.LANGUAGES.map(function (l) { return { id: l[0], label: l[1] }; }));
      K.modal.options(K.t('Language'), list, K.prefs.languageChosen ? K.prefs.language : 'auto', K.setLanguage);
    });
    var res = K.t('Resolution') + ': ';
    row('ic_play', K.t('Playback'), playbackValue(), function (v) {
      options(K.t('Playback'), [['auto', res + K.t('Auto')], ['1080', res + '1080p'], ['720', res + '720p'], ['480', res + '480p'],
        ['360', res + '360p'], ['chat', K.t('Chat when a stream starts') + ': ' + (K.prefs.chat ? K.t('On') + ' → ' + K.t('Off') : K.t('Off') + ' → ' + K.t('On'))]], K.prefs.quality, function (id) {
        if (id === 'chat') { K.prefs.chat = !K.prefs.chat; } else { K.prefs.quality = id; }
      }, v, playbackValue);
    });

    section(K.t('Content Preferences'));
    wrap.appendChild(K.el('div', 'acct-note', K.t("Customize your experience by selecting the types of content you'd like to hide")));
    toggle('ic_content', K.t('Hide gambling streams'), function () { return K.prefs.hideGambling; }, content('hideGambling'));
    toggle('ic_content', K.t('Hide 18+ streams'), function () { return K.prefs.hideMature; }, content('hideMature'));
    toggle('ic_content', K.t('Hide Pools, Hot Tubs & Bikinis'), function () { return K.prefs.hidePools; }, content('hidePools'));
    // Which streams Kick lists; follows the app language until chosen here.
    // Which streams Kick lists: chosen here, or automatic (the country's language, else the app's).
    function languageLabel(code) { return code === 'all' ? K.t('All languages') : K.langName(code); }
    function contentLanguageName() { return (K.prefs.contentLanguage ? '' : K.t('Automatic') + ' · ') + languageLabel(K.contentLanguage()); }
    row('ic_language', K.t('Content language'), contentLanguageName(), function (v) {
      var auto = K.prefs.countryLanguage || K.prefs.language;
      var list = [{ id: '', label: K.t('Automatic') + ' (' + languageLabel(auto) + ')' }, { id: 'all', label: K.t('All languages') }]
        .concat(K.streamLanguages.map(function (c) { return { id: c, label: K.langName(c) }; }).sort(function (a, b) { return a.label.localeCompare(b.label); }));
      K.modal.options(K.t('Content language'), list, K.prefs.contentLanguage || '', function (id) {
        if (id) { K.prefs.contentLanguage = id; } else { delete K.prefs.contentLanguage; }
        K.savePrefs();
        K.app.prefsChanged('language');
        v.textContent = contentLanguageName();
      });
    });

    section(K.t('Help & Legal'));
    // Updates: the latest release from GitHub and its changelog.
    function updateValue() {
      var l = K.update.latest();
      return K.update.available() ? K.t('Update available: {v}', { v: l.version }) : l ? K.t('Up to date') : K.t('Check for updates');
    }
    var upd = row('ic_information', K.t('Updates'), updateValue(), function (v) {
      v.textContent = K.t('Checking…');
      K.update.check(function (err) {
        v.textContent = err ? K.t('Could not check') : updateValue();
        upd.classList.toggle('has-update', K.update.available());
        K.app.updateChanged();
        if (!err) { changelog(); }
      }, true);
    });
    upd.classList.toggle('has-update', K.update.available());
    function changelog() {
      var l = K.update.latest(), wrap = K.el('div', 'changelog-wrap'), box = K.el('div', 'changelog f'), bar = K.el('div', 'scrollbar'), thumb = K.el('i'), list = K.update.changes();
      bar.appendChild(thumb);
      wrap.appendChild(box);
      wrap.appendChild(bar);
      list.forEach(function (c) { box.appendChild(c.head ? K.el('h3', '', c.head) : K.el('div', 'item', c.item)); });
      if (!list.length) { box.appendChild(K.el('div', 'item', K.t('No changelog for this version.'))); }
      // Up/down scroll a long changelog; past its end, focus moves on to the buttons.
      // A slim scrollbar beside a list that's longer than its box (green while focused).
      function more() {
        var h = box.scrollHeight, v = box.clientHeight;
        bar.hidden = h <= v + 2;
        thumb.style.height = Math.round(v / h * 100) + '%';
        thumb.style.top = Math.round(box.scrollTop / h * 100) + '%';
      }
      box._dir = function (k) {
        if (k !== 'up' && k !== 'down') { return false; }
        var before = box.scrollTop;
        box.scrollTop += k === 'down' ? 140 : -140;
        more();
        return box.scrollTop !== before;
      };
      setTimeout(more, 0);
      // OK on the list does what the first button does (update, or Done).
      box._select = function () { var first = K.$('modal').querySelector('.dialog-buttons .btn'); if (first) { first._select(); } };
      var newer = K.update.available(), store = newer && K.update.tvStore(), buttons = [[K.t('Done'), null, !store]];
      if (store) { buttons.unshift([K.t('Update with TV-Store'), K.update.openTvStore, true]); }
      K.modal.show({
        cls: newer ? 'wide' : 'notes', title: newer ? K.t("What's new in {v}", { v: l.version }) : K.t('Kick {v} · up to date', { v: K.VERSION }),
        text: !newer ? null : store ? K.t('Install it with TV-Store on this TV, or with Apps2Samsung on your phone or PC.')
          : K.t('Scan the QR code and install it with Apps2Samsung on your phone or PC.'),
        body: wrap, qr: newer ? l.url : null, buttons: buttons
      });
    }

    // Report a problem: a GitHub issue for this app, with the TV and version already filled in.
    row('ic_report', K.t('Report a problem'), 'GitHub', function () {
      var title = '[' + K.deviceName().replace(/^Samsung /, '') + '] Kick ' + K.VERSION + ': ';
      var body = '**TV:** ' + K.deviceName() + '\n**App:** Kick ' + K.VERSION + '\n**Language:** ' + K.prefs.language + ' / ' + K.contentLanguage() +
        '\n\n**What happened?**\n\n\n**What did you expect?**\n';
      var url = 'https://github.com/madarra16/kick-tizen/issues/new?title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
      K.modal.show({ title: K.t('Report a problem'), text: K.t('Scan the QR code and describe what went wrong. Your TV model and app version are already filled in.'),
        qr: url, buttons: [[K.t('Done'), null, true]] });
    });
    row('ic_information', K.t('Find Help online'), 'help.kick.com', function () { qrPage(K.t('Help'), 'help.kick.com', 'qr_help'); });
    row('ic_lock', K.t('Privacy Policy'), 'kick.com/privacy-policy', function () { qrPage(K.t('Privacy Policy'), 'kick.com/privacy-policy', 'qr_privacy'); });
    row('ic_pen', K.t('Terms of Service'), 'kick.com/terms-of-service', function () { qrPage(K.t('Terms of Service'), 'kick.com/terms-of-service', 'qr_terms_of_service'); });
    row('ic_mod_actions', K.t('Open Source Licences'), K.t('Licensing information'), function () {
      K.modal.show({ title: K.t('Open Source Licences'), text: 'Inter typeface · SIL Open Font License 1.1\nqrcode-generator · MIT License', buttons: [[K.t('Done'), null, true]] });
    });
    row('ic_device', K.t('App information'), K.t('Version {v}', { v: K.VERSION }), function () {
      K.modal.show({ title: K.t('App information'), text: K.t('Kick for Samsung Smart TV') + '\n' + K.t('Version {v}', { v: K.VERSION }) + '\n' + K.deviceName(), buttons: [[K.t('Done'), null, true]] });
    });

    var logo = K.el('img', 'acct-logo');
    logo.src = 'img/ic_kick_logo.svg';
    wrap.appendChild(logo);
    if (signedIn) {
      var out = K.el('div', 'acct-logout f');
      out.appendChild(maskIcon('ic_logout'));
      out.appendChild(K.el('span', '', K.t('Log out')));
      out._select = function () {
        K.modal.show({ title: K.t('Log out?'), text: K.t('Your Kick sign-in will be removed from this TV.'), buttons: [[K.t('Log out'), function () { K.auth.signOut(); }, true], [K.t('Cancel')]] });
      };
      wrap.appendChild(out);
    }
    return s;
  };

  // ---- Sign in (QR + code, approved in the Kick phone app) ----
  screens.login = function () {
    var s = base('login', false), sc = s.scroller, ctl = null, shownUrl = null;
    var wrap = K.el('div', 'login'), steps = K.el('div', 'login-steps'), right = K.el('div', 'login-qr'),
      box = K.el('div', 'qr-box'), code = K.el('div', 'login-code'), state = K.el('div', 'login-state');
    steps.appendChild(K.el('h1', '', K.t('Sign in')));
    [['img/signin_step1_img.svg', 'Make sure you have the Kick mobile app and are signed in'],
     ['', 'Scan the QR code with your smartphone camera'],
     ['img/signin_step3_img.svg', 'Confirm the code below matches with the one on your KICK mobile app']].forEach(function (st, i) {
      var row = K.el('div', 'step'), txt = K.el('div');
      if (st[0]) { var im = K.el('img'); im.src = st[0]; row.appendChild(im); } else { row.appendChild(K.el('div', '', '')).style.cssText = 'width:150px;margin-right:28px'; }
      txt.appendChild(K.el('div', 'n', K.t('Step {n}', { n: i + 1 })));
      txt.appendChild(K.el('div', 't', K.t(st[1])));
      row.appendChild(txt);
      steps.appendChild(row);
    });
    steps.appendChild(buttonRow([[K.t('New code'), start], [K.t('Back'), function () { K.app.pop(); }]]));
    right.appendChild(box);
    right.appendChild(code);
    right.appendChild(state);
    wrap.appendChild(steps);
    wrap.appendChild(right);
    sc.appendChild(wrap);

    function start() {
      if (ctl) { ctl.stop(); }
      ctl = K.auth.link(function (st) {
        if (st.phase === 'success') {
          K.app.pop();
          K.app.authChanged();
          return;
        }
        if (st.url !== shownUrl) {
          shownUrl = st.url;
          box.textContent = '';
          box.appendChild(K.qr(st.url, 368));
          code.textContent = st.code;
        }
        state.textContent = st.phase === 'expired' ? K.t('The code expired. Choose "New code".') : (st.note || K.t('Logging in… waiting for your phone'));
      });
    }
    start();
    s.destroy = function () { if (ctl) { ctl.stop(); } };
    return s;
  };
})(window.K);
