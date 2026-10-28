/* Kick endpoints. Public lists need no account; following/user need the TV sign-in token.
   Three endpoint families return streams in different shapes; norm* turn them into one:
   { slug, name, avatar, title, viewers, category, categorySlug, categoryParent, lang, thumb, thumbLarge, start, mature } */
(function (K) {
  'use strict';

  var WEB = 'https://web.kick.com/api/v1', SITE = 'https://kick.com', TV = 'https://tv.kick.com/api/v1';

  function auth(token) { return token ? { Authorization: 'Bearer ' + token } : {}; }

  function normWeb(x) {
    var ch = x.channel || {}, cat = x.category || {}, th = x.thumbnail || {};
    return { slug: ch.slug, name: ch.username || ch.slug, avatar: ch.profile_pic, title: x.title || '', viewers: x.viewer_count,
      category: cat.name || '', categorySlug: cat.slug, categoryParent: '', start: x.start_time, mature: !!x.is_mature, lang: K.langName(x.language),
      thumb: K.pickImage(th.srcset, th.src, 600), thumbLarge: K.pickImage(th.srcset, th.src, 1600) };
  }

  function normSite(x) {
    var ch = x.channel || {}, user = ch.user || {}, cat = (x.categories || [])[0] || {}, th = x.thumbnail || {};
    return { slug: ch.slug, name: user.username || ch.slug, avatar: user.profilepic || user.profile_pic, title: x.session_title || '',
      viewers: x.viewer_count, category: cat.name || '', categorySlug: cat.slug, categoryParent: (cat.category || {}).name || '',
      start: x.start_time, mature: !!x.is_mature, lang: K.langName(x.language),
      thumb: K.pickImage(th.srcset, th.src || th.url, 600), thumbLarge: K.pickImage(th.srcset, th.src || th.url, 1600) };
  }

  // Categories come with a `banner`, recommended ones with a `thumbnail` (an object or a plain URL).
  function normCategory(c) {
    var b = c.banner || c.thumbnail || {};
    if (typeof b === 'string') { b = { src: b }; }
    return { id: c.id, name: c.name, slug: c.slug, viewers: c.viewers || 0, parent: (c.category || {}).name || '', tags: c.tags || [],
      image: K.pickImage(b.srcset || b.responsive, b.src || b.url, 280) };
  }

  function normClip(c) {
    var ch = c.channel || {}, cat = c.category || {};
    return { id: c.id, title: c.title || '', url: c.clip_url || c.video_url, thumb: c.thumbnail_url, duration: Number(c.duration) || 0,
      views: c.views || c.view_count || 0, created: c.created_at, category: cat.name || '', categorySlug: cat.slug, categoryParent: cat.parent_category || '',
      mature: !!c.is_mature, kind: 'clip', channel: { slug: ch.slug, name: ch.username, avatar: ch.profile_picture } };
  }
  function clipList(d) { return ((d && d.clips) || []).map(normClip).filter(function (c) { return c.url; }); }

  function list(arr, fn) { return (arr || []).map(fn).filter(function (s) { return s.slug; }); }

  // Stream lists are in the content language (Account › Content Preferences); 'all' = every language.
  function langParam() { var l = K.contentLanguage(); return l === 'all' ? '' : '&language=' + l; }
  var cursors = {};

  K.api = {
    normCategory: normCategory,

    featured: function (cb) {
      var lang = K.contentLanguage() === 'all' ? K.prefs.language : K.contentLanguage();
      K.http('GET', WEB + '/livestreams/featured?language=' + lang, null, function (err, d) {
        cb(err, err ? [] : list(d && d.data && d.data.livestreams, normWeb));
      });
    },

    popular: function (cb) {
      K.http('GET', WEB + '/livestreams?limit=24&sort=viewer_count_desc' + langParam(), null, function (err, d) {
        cb(err, err ? [] : list(d && d.data && d.data.livestreams, normWeb));
      });
    },

    // Live streams, optionally in one category (its id), most viewers first. page starts at 1 and
    // pages come in order: each answer has the cursor of the next. (kick.com/stream/livestreams
    // ignores the language, so this uses web.kick.com.)
    // sort: viewer_count_desc (default), viewer_count_asc or featured. web.kick.com accepts but
    // ignores ascending order, so that one comes from kick.com's older list (needs the slug).
    streams: function (categoryId, page, cb, sort, categorySlug) {
      sort = sort || 'viewer_count_desc';
      if (sort === 'viewer_count_asc') { return K.api.streamsAsc(categorySlug, page, cb); }
      var key = (categoryId || '') + '|' + K.contentLanguage() + '|' + sort + '|', cursor = page > 1 ? cursors[key + page] : '';
      if (page > 1 && !cursor) { return cb(null, [], false); }
      var url = WEB + '/livestreams?limit=24&sort=' + sort + langParam() + (categoryId ? '&category_id=' + categoryId : '') +
        (cursor ? '&after=' + encodeURIComponent(cursor) : '');
      K.http('GET', url, null, function (err, d) {
        var data = d && d.data, next = data && data.pagination && data.pagination.next_cursor;
        if (next) { cursors[key + (page + 1)] = next; }
        cb(err, err ? [] : list(data && data.livestreams, normWeb), !!next);
      });
    },

    // Smallest streams first, from kick.com's list that sorts this right but ignores the language:
    // filtered here by the content language, reading at most a few pages per call.
    streamsAsc: function (categorySlug, page, cb) {
      var key = 'asc|' + (categorySlug || '') + '|' + K.contentLanguage(), lang = K.contentLanguage(), name = (lang === 'all' ? '' : K.langEnglish(lang)).toLowerCase();
      var out = [], scanned = 0;
      if (page === 1) { cursors[key] = 1; }
      (function next() {
        var p = cursors[key];
        K.http('GET', SITE + '/stream/livestreams/en?limit=24&sort=asc&page=' + p + (categorySlug ? '&subcategory=' + encodeURIComponent(categorySlug) : ''), null, function (err, d) {
          if (err) { return cb(err, out, false); }
          var more = !!(d && d.next_page_url);
          cursors[key] = p + 1;
          scanned++;
          list(d && d.data, normSite).forEach(function (s) { if (!name || String(s.lang).toLowerCase().indexOf(name) === 0) { out.push(s); } });
          if (out.length >= 12 || !more || scanned >= 6) { cb(null, out, more); } else { next(); }
        });
      })();
    },

    topCategories: function (cb) {
      K.http('GET', SITE + '/api/v1/categories/top', null, function (err, d) { cb(err, err ? [] : (d || []).map(normCategory)); });
    },

    categories: function (page, cb) {
      K.http('GET', SITE + '/api/v1/subcategories?limit=28&page=' + page, null, function (err, d) {
        cb(err, err ? [] : (d && d.data || []).map(normCategory), !!(d && d.next_page_url));
      });
    },

    channel: function (slug, cb) { K.http('GET', SITE + '/api/v2/channels/' + encodeURIComponent(slug), null, cb); },

    // A channel's videos. The running stream is included (live: true) while it lasts: its source is
    // the recording so far, which the player uses for rewinding. Duration is in seconds.
    channelVideos: function (slug, cb) {
      K.http('GET', SITE + '/api/v2/channels/' + encodeURIComponent(slug) + '/videos', null, function (err, d) {
        var list = (Array.isArray(d) ? d : []).map(function (x) {
          var th = x.thumbnail || {}, cat = (x.categories || [])[0] || {};
          return { id: x.id, live: !!x.is_live, title: x.session_title || '', duration: (Number(x.duration) || 0) / 1000, views: x.views || 0,
            created: x.start_time || x.created_at, url: x.source, category: cat.name || '', categorySlug: cat.slug, mature: !!x.is_mature,
            lang: K.langName(x.language), kind: 'video',
            thumb: K.pickImage(th.srcset, th.src, 600) };
        }).filter(function (v) { return v.url; });
        cb(err, list);
      });
    },

    // Most viewed clips first. cursor: the previous page's `next`. cb(err, clips, next)
    clips: function (slug, cursor, cb) {
      var url = SITE + '/api/v2/channels/' + encodeURIComponent(slug) + '/clips?sort=view&time=all' + (cursor ? '&cursor=' + encodeURIComponent(JSON.stringify(cursor)) : '');
      K.http('GET', url, null, function (err, d) { cb(err, clipList(d), d && d.nextCursor); });
    },

    // Kick-wide most viewed clips, as on kick.com Browse › Clips. time: day, week, month or all.
    topClips: function (time, cursor, cb) {
      var url = SITE + '/api/v2/clips?sort=view&time=' + time + (cursor ? '&cursor=' + encodeURIComponent(JSON.stringify(cursor)) : '');
      K.http('GET', url, null, function (err, d) { cb(err, clipList(d), d && d.nextCursor); });
    },

    // Categories a channel streamed lately (the official app's channel page has the same row).
    recentCategories: function (slug, cb) {
      K.http('GET', SITE + '/api/v2/channels/' + encodeURIComponent(slug) + '/recent-categories', null, function (err, d) {
        cb(err, Array.isArray(d) ? d.map(normCategory) : []);
      });
    },

    // A channel's scheduled streams for the next four weeks (kick.com's Schedule tab; Kick allows
    // at most 28 days per request). [{ title, start, end, live, categoryId }], soonest first.
    schedule: function (channelId, cb) {
      var from = new Date(), to = new Date(from.getTime() + 27 * 86400000);
      K.http('GET', WEB + '/channels/' + channelId + '/calendar/events?from_utc=' + from.toISOString() + '&to_utc=' + to.toISOString(), null, function (err, d) {
        var events = ((d && d.data && d.data.events) || []).map(function (e) {
          var start = K.parseTime(e.utc_start_datetime || e.event_utc_start_datetime || e.start_at), end = K.parseTime(e.utc_end_datetime);
          if (isNaN(end) && e.duration_minutes) { end = start + e.duration_minutes * 60000; }
          return { title: e.title || e.name || '', start: start, end: end, live: !!e.is_live, categoryId: e.category_id,
            category: (e.category && e.category.name) || e.category_name || '' };
        }).filter(function (e) { return !isNaN(e.start) && (isNaN(e.end) || e.end > Date.now()); });
        cb(err, events.sort(function (a, b) { return a.start - b.start; }));
      });
    },

    // Current stream of one channel (thumbnail, category, language), null when offline.
    livestream: function (slug, cb) {
      K.http('GET', SITE + '/api/v2/channels/' + encodeURIComponent(slug) + '/livestream', null, function (err, d) {
        var x = d && d.data, th = (x && x.thumbnail) || {}, cat = (x && x.category) || {};
        if (err || !x || !x.slug) { cb(err, null); return; }
        cb(null, { title: x.session_title || '', viewers: x.viewers || 0, category: cat.name || '', categorySlug: cat.slug, lang: K.langName(x.language),
          start: x.created_at, mature: !!x.is_mature, thumb: K.pickImage(th.srcset, th.src, 600), thumbLarge: K.pickImage(th.srcset, th.src, 1600) });
      });
    },

    search: function (q, cb) {
      return K.http('GET', SITE + '/api/search?searched_word=' + encodeURIComponent(q), null, function (err, d) {
        var channels = ((d && d.channels) || []).map(function (c) {
          var u = c.user || {};
          return { slug: c.slug, name: u.username || c.slug, avatar: u.profilePic || u.profile_pic, live: !!c.isLive, verified: !!c.verified,
            followers: c.followersCount || c.followers_count || 0 };
        });
        var cats = ((d && d.categories) || []).map(normCategory);
        cb(err, { channels: channels, categories: cats });
      });
    },

    messages: function (channelId, cb) { K.http('GET', SITE + '/api/v2/channels/' + channelId + '/messages', null, cb); },

    chatConnection: function (channelId, cb) {
      K.http('POST', WEB + '/realtime/channels/' + encodeURIComponent(channelId) + '/chat/connection',
        { timeout: 6000, body: { client: { id: K.uuid(), type: 'web' }, capabilities: { accepted_providers: [{ provider: 'pusher' }] } } }, cb);
    },

    // Signed-in calls. Field names are read in both snake_case and camelCase.
    followed: function (token, cb) {
      K.http('GET', SITE + '/api/v2/channels/followed', { headers: auth(token) }, function (err, d) {
        var rows = ((d && d.channels) || []).map(function (c) {
          return { slug: c.channel_slug || c.channelSlug, name: c.user_username || c.userUsername, avatar: c.profile_picture || c.profilePicture,
            live: !!(c.is_live || c.isLive), viewers: c.viewer_count || c.viewerCount || 0, title: c.session_title || c.sessionTitle || '',
            category: c.category_name || c.categoryName || '' };
        }).filter(function (c) { return c.slug; });
        cb(err, rows);
      });
    },

    me: function (token, cb) { K.http('GET', SITE + '/api/v1/user', { headers: auth(token) }, cb); },

    // Categories the signed-in user follows (the official app's getUserFollowedCategories).
    followedCategories: function (token, cb) {
      K.http('GET', SITE + '/api/v1/user/categories/top?sort=viewer_count_desc', { headers: auth(token) }, function (err, d) {
        var rows = Array.isArray(d) ? d : (d && d.data) || [];
        cb(err, rows.map(normCategory).filter(function (c) { return c.slug; }));
      });
    },

    // Personal recommendations for a signed-in user, from the TV API the official app uses.
    recommendedStreams: function (token, cb) {
      var lang = K.contentLanguage() === 'all' ? K.prefs.language : K.contentLanguage();
      K.http('GET', TV + '/recommendations/livestreams?lang_code=' + lang, { headers: auth(token) }, function (err, d) {
        cb(err, err ? [] : list(d && d.data, normWeb));
      });
    },
    recommendedCategories: function (token, cb) {
      var lang = K.contentLanguage() === 'all' ? K.prefs.language : K.contentLanguage();
      K.http('GET', TV + '/recommendations/categories?lang_code=' + lang, { headers: auth(token) }, function (err, d) {
        cb(err, err ? [] : ((d && d.data) || []).map(normCategory).filter(function (c) { return c.slug; }));
      });
    },

    // Kick's TV sign-in: the phone app approves uuid+code, then this returns { token }.
    tvLink: function (uuid, key, cb) { K.http('POST', SITE + '/api/tv/link/authenticate/' + uuid, { body: { key: key }, timeout: 10000 }, cb); }
  };
})(window.K);
