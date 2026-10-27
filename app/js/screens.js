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

  // Endless grid: loads page after page as focus nears the end.
  function pagedGrid(s, grid, fetch, build, filter) {
    var page = 0, more = true, loading = false, items = [];
    function next() {
      if (loading || !more) { return; }
      loading = true;
      page++;
      fetch(page, function (err, list, hasMore) {
        loading = false;
        more = !err && hasMore;
        if (err && !items.length) { grid.appendChild(K.cards.empty(K.t('Could not load'), K.t('Kick did not answer.'))); return; }
        K.cards.append(grid, list.filter(filter), function (it, i, all) {
          var c = build(it, i, all);
          c._focus = function () { if (i >= all.length - 8) { next(); } };
          return c;
        }, items);
        if (items.length < 12 && more) { next(); } else if (!items.length) { grid.appendChild(K.cards.empty('', K.t('Nothing live here right now.'))); }
        s.ready();
      });
    }
    next();
  }

  // ---- Home: featured carousel (FeaturedCarouselRow) + rows ----
  screens.home = function () {
    var s = base('home', true), sc = s.scroller, featured = [], index = 0, timer = null;
    var hero = K.el('div', 'hero f'), heroImg = K.el('img', 'hero-img'), badges = K.el('div', 'hero-badges'), head = K.el('div', 'hero-head'), dots = K.el('div', 'hero-dots');
    hero.appendChild(heroImg);
    hero.appendChild(K.el('div', 'hero-grad'));
    hero.appendChild(badges);
    hero.appendChild(head);
    hero.appendChild(dots);
    sc.appendChild(hero);

    function show(i) {
      if (!featured.length) { return; }
      index = (i + featured.length) % featured.length;
      var st = featured[index];
      badges.innerHTML = '<img class="live" src="img/ic_live_badge.svg"><span class="count">' + K.esc(K.count(st.viewers)) + '</span>';
      head.innerHTML = (st.avatar ? '<img class="avatar" src="' + K.esc(K.helper.url(st.avatar)) + '">' : '') + '<div class="lines"><div class="name">' + K.esc(st.name) +
        '</div><div class="cat-lang">' + K.esc([st.category, st.lang].filter(Boolean).join(' · ')) + '</div><div class="title">' + K.esc(st.title) + '</div></div>';
      dots.innerHTML = featured.map(function (x, n) { return n === index ? '<i class="on"></i>' : '<i></i>'; }).join('');
      // One request per picture: the <img> fades in once it has loaded.
      heroImg.classList.remove('on');
      heroImg.onload = function () { if (featured[index] === st) { heroImg.classList.add('on'); } };
      heroImg.src = K.helper.url(st.thumbLarge || st.thumb) || '';
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

    var cats = K.cards.row(K.t('*Categories* For You'), [], null), streams = K.cards.row(K.t('*Streams* For You'), [], null);
    streams._track.appendChild(K.cards.skeleton(4));
    sc.appendChild(cats);
    sc.appendChild(streams);

    K.api.featured(function (err, list) {
      featured = list.filter(K.allowStream);
      if (featured.length) { show(0); restartTimer(); } else { head.innerHTML = '<div class="lines"><div class="name">' + K.esc(K.t('No featured streams right now')) + '</div></div>'; }
      s.ready();
    });
    K.api.popular(function (err, list) { fillOrNote(streams, list.filter(K.allowStream), K.cards.streamBuilder(), err); s.ready(); });
    K.api.topCategories(function (err, list) {
      list = list.filter(K.allowCategory);
      fillOrNote(cats, list, function (c) { return K.cards.category(c); }, err);
      list.slice(0, 4).forEach(function (cat) {
        var row = K.cards.row(K.t('Live in *{name}*', { name: cat.name }), [], null);
        row._track.appendChild(K.cards.skeleton(4));
        sc.appendChild(row);
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

  // ---- Categories: box-art grid, 6 per row ----
  screens.categories = function () {
    var s = base('categories', true), grid = K.el('div', 'grid cats');
    s.scroller.appendChild(grid);
    pagedGrid(s, grid, K.api.categories, K.cards.bigCategory, K.allowCategory);
    return s;
  };

  // ---- Live: all live channels, most viewers first ----
  screens.live = function () {
    var s = base('live', true), grid = K.el('div', 'grid');
    s.scroller.appendChild(grid);
    pagedGrid(s, grid, function (page, cb) { K.api.streams(null, page, cb); }, K.cards.streamBuilder(), K.allowStream);
    return s;
  };

  // ---- Category detail (from a category card) ----
  screens.category = function (cat) {
    var s = base('category', false), sc = s.scroller, head = K.el('div', 'cat-head sec'), grid = K.el('div', 'grid');
    head.innerHTML = (cat.image ? '<img src="' + K.esc(K.helper.url(cat.image)) + '">' : '') + '<div><h1>' + K.esc(cat.name) + '</h1><div class="sub">' +
      K.esc(K.t('{n} viewers', { n: K.count(cat.viewers) })) + '</div>' + (cat.tags || []).slice(0, 4).map(function (t) { return '<span class="tag">' + K.esc(t) + '</span>'; }).join('') + '</div>';
    sc.appendChild(head);
    sc.appendChild(grid);
    pagedGrid(s, grid, function (page, cb) { K.api.streams(cat.id, page, cb); }, K.cards.streamBuilder(), K.allowStream);
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
    var loading = K.cards.empty('', K.t('Loading…'));
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
        sc.appendChild(buttonRow([[K.t('Go to Live'), function () { K.app.go('live'); }, true]]));
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

    function recent() {
      var rec = K.store.get('kick.recentSearch', []), sec = section(rec.length ? K.t('Recent Search') : '');
      if (!rec.length) { sec.appendChild(K.cards.empty('', K.t('Type at least 2 characters to search channels, categories and livestreams.'))); }
      rec.forEach(function (r) {
        sec.appendChild(K.cards.button(r, function () { text = r; query.textContent = r; query.classList.remove('placeholder'); run(); }));
      });
      results.appendChild(sec);
    }

    function run() {
      var q = text.replace(/^\s+|\s+$/g, ''), my = ++gen;
      results.textContent = '';
      results._off = 0;
      results.style.transform = '';
      if (req) { req.abort(); req = null; }
      if (q.length < 2) { recent(); return; }
      results.appendChild(K.cards.empty('', K.t('Searching…')));
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

    function header(ch) {
      var u = (ch && ch.user) || {}, ls = ch && ch.livestream, img = (ch && (ch.banner_image || ch.offline_banner_image)) || {};
      var bannerUrl = img.url || img.src;
      me.name = u.username || me.name;
      me.avatar = u.profile_pic || me.avatar;
      banner.innerHTML = bannerUrl ? '<img src="' + K.esc(K.helper.url(bannerUrl)) + '">' : '';
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
      text.appendChild(buttons);
      head.appendChild(av);
      head.appendChild(text);
      s.ready();
    }
    // A request that failed is asked once more before the page shows it as empty.
    function twice(call, done) {
      call(function (err) { if (!err) { return done.apply(null, arguments); } setTimeout(function () { call(done); }, 1500); });
    }
    header(null);
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
    s.el.appendChild(K.el('div', 'acct-fade'));  // rows scrolled up fade out under the top bar

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
      K.modal.show({ title: title, text: K.t('Visit {url}', { url: url }), image: 'img/' + image + '.svg', buttons: [[K.t('Done'), null, true]] });
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
    } else {
      row('ic_profile', K.t('Sign in'), K.t('Use the Kick app on your phone'), function () { K.app.push(screens.login()); });
    }

    section(K.t('Preferences'));
    // The app's language; streams are listed in the same language.
    row('ic_language', K.t('Language'), K.languageName(K.prefs.language), function () {
      K.modal.options(K.t('Language'), K.LANGUAGES.map(function (l) { return { id: l[0], label: l[1] }; }), K.prefs.language, K.setLanguage);
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
    // Which streams Kick lists; follows the app language until chosen here.
    function contentLanguageName() { return K.contentLanguage() === 'all' ? K.t('All languages') : K.languageName(K.contentLanguage()); }
    row('ic_language', K.t('Content language'), contentLanguageName(), function (v) {
      var list = K.LANGUAGES.map(function (l) { return { id: l[0], label: l[1] }; }).concat([{ id: 'all', label: K.t('All languages') }]);
      K.modal.options(K.t('Content language'), list, K.contentLanguage(), function (id) {
        K.prefs.contentLanguage = id;
        K.savePrefs();
        K.app.prefsChanged('language');
        v.textContent = contentLanguageName();
      });
    });

    section(K.t('Help & Legal'));
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
          K.toast(K.auth.user ? K.t('Signed in as {name}', { name: K.auth.user.name }) : K.t('Signed in'));
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
