/* Kick endpoints. Public lists need no account; following/user need the TV sign-in token.
   Three endpoint families return streams in different shapes; norm* turn them into one:
   { slug, name, avatar, title, viewers, category, categorySlug, categoryParent, lang, thumb, thumbLarge, start, mature } */
(function (K) {
  'use strict';

  var WEB = 'https://web.kick.com/api/v1', SITE = 'https://kick.com';

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

  function normCategory(c) {
    var b = c.banner || {};
    return { id: c.id, name: c.name, slug: c.slug, viewers: c.viewers || 0, parent: (c.category || {}).name || '', tags: c.tags || [],
      image: K.pickImage(b.srcset || b.responsive, b.src || b.url, 280) };
  }

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
    streams: function (categoryId, page, cb) {
      var key = (categoryId || '') + '|' + K.contentLanguage() + '|', cursor = page > 1 ? cursors[key + page] : '';
      if (page > 1 && !cursor) { return cb(null, [], false); }
      var url = WEB + '/livestreams?limit=24&sort=viewer_count_desc' + langParam() + (categoryId ? '&category_id=' + categoryId : '') +
        (cursor ? '&after=' + encodeURIComponent(cursor) : '');
      K.http('GET', url, null, function (err, d) {
        var data = d && d.data, next = data && data.pagination && data.pagination.next_cursor;
        if (next) { cursors[key + (page + 1)] = next; }
        cb(err, err ? [] : list(data && data.livestreams, normWeb), !!next);
      });
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
            created: x.start_time || x.created_at, url: x.source, category: cat.name || '', lang: K.langName(x.language), kind: 'video',
            thumb: K.pickImage(th.srcset, th.src, 600) };
        }).filter(function (v) { return v.url; });
        cb(err, list);
      });
    },

    // Most viewed clips first. cursor: the previous page's `next`. cb(err, clips, next)
    clips: function (slug, cursor, cb) {
      var url = SITE + '/api/v2/channels/' + encodeURIComponent(slug) + '/clips?sort=view&time=all' + (cursor ? '&cursor=' + encodeURIComponent(JSON.stringify(cursor)) : '');
      K.http('GET', url, null, function (err, d) {
        var clips = ((d && d.clips) || []).map(function (c) {
          var ch = c.channel || {};
          return { id: c.id, title: c.title || '', url: c.clip_url || c.video_url, thumb: c.thumbnail_url, duration: Number(c.duration) || 0,
            views: c.views || c.view_count || 0, created: c.created_at, category: (c.category || {}).name || '', kind: 'clip',
            channel: { slug: ch.slug, name: ch.username, avatar: ch.profile_picture } };
        }).filter(function (c) { return c.url; });
        cb(err, clips, d && d.nextCursor);
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

    // Kick's TV sign-in: the phone app approves uuid+code, then this returns { token }.
    tvLink: function (uuid, key, cb) { K.http('POST', SITE + '/api/tv/link/authenticate/' + uuid, { body: { key: key }, timeout: 10000 }, cb); }
  };
})(window.K);
