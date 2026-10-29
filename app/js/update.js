/* Update check: once a day the app asks GitHub for the latest release of this app. A newer
   version shows in Account › Updates (and as a dot on the profile button), with its changelog.
   Installing happens through TV-Store when it's on this TV, else with Apps2Samsung on a phone or
   PC (QR code): a TV app can't install packages itself. */
(function (K) {
  'use strict';

  var REPO = 'madarra16/kick-tizen', KEY = 'kick.update', DAY = 24 * 3600 * 1000, TV_STORE = 'A2STVStore.Store';
  var saved = K.store.get(KEY, null);

  function parts(v) { return String(v || '').replace(/^v/, '').split('.').map(function (n) { return parseInt(n, 10) || 0; }); }
  // 1 if a is newer than b, -1 if older, 0 if the same.
  function compare(a, b) {
    var x = parts(a), y = parts(b);
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] || 0) !== (y[i] || 0)) { return (x[i] || 0) > (y[i] || 0) ? 1 : -1; }
    }
    return 0;
  }

  var update = K.update = {
    releasesUrl: 'https://github.com/' + REPO + '/releases',
    latest: function () { return saved; },
    available: function () { return !!saved && compare(saved.version, K.VERSION) > 0; },

    // cb(err) after asking GitHub; force skips the once-a-day limit.
    check: function (cb, force) {
      if (!force && saved && Date.now() - saved.at < DAY) { if (cb) { cb(null); } return; }
      K.http('GET', 'https://api.github.com/repos/' + REPO + '/releases/latest', { timeout: 15000 }, function (err, d) {
        if (!err && d && d.tag_name) {
          saved = { at: Date.now(), version: String(d.tag_name).replace(/^v/, ''), notes: d.body || '', url: d.html_url || update.releasesUrl };
          K.store.set(KEY, saved);
        }
        if (cb) { cb(err); }
      });
    },

    // Release notes as [{ head }, { item }] up to the install instructions.
    changes: function () {
      var out = [];
      String((saved && saved.notes) || '').split(/\r?\n/).some(function (line) {
        var t = line.replace(/^\s+|\s+$/g, ''), head = /^\*\*([^*]+)\*\*$/.exec(t) || /^#+\s*(.+)$/.exec(t);
        if (head && /install/i.test(head[1])) { return true; }
        if (head) { out.push({ head: head[1] }); } else if (/^[-*]\s+/.test(t)) { out.push({ item: t.replace(/^[-*]\s+/, '').replace(/\*\*|`/g, '') }); }
        return false;
      });
      return out;
    },

    tvStore: function () {
      try { tizen.application.getAppInfo(TV_STORE); return true; } catch (e) { return false; }
    },
    openTvStore: function () {
      try { tizen.application.launch(TV_STORE); } catch (e) { /* not installed */ }
    }
  };
})(window.K);
