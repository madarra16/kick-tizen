/* Sign-in like Kick's TV app: the TV shows kick.com/tv/login?uuid=..&code=.. as a QR code, the
   Kick phone app approves it, and /api/tv/link/authenticate/<uuid> {key: code} then returns a
   token. Tokens stay on this TV (localStorage) until "Log out". Several accounts can be signed
   in; one is in use at a time (Account › Switch account). */
(function (K) {
  'use strict';

  var KEY = 'kick.auth', LIST = 'kick.accounts', CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', POLL_MS = 3000, EXPIRE_MS = 10 * 60 * 1000;
  var saved = K.store.get(KEY, null) || {}, accounts = K.store.get(LIST, []);
  if (saved.token && !accounts.some(function (a) { return a.token === saved.token; })) { accounts.unshift({ token: saved.token, user: saved.user || null }); }

  function code() {
    var b = new Uint8Array(6), out = '', i;
    if (window.crypto && crypto.getRandomValues) { crypto.getRandomValues(b); } else { for (i = 0; i < 6; i++) { b[i] = Math.floor(Math.random() * 256); } }
    for (i = 0; i < 6; i++) { out += CODE_CHARS.charAt(b[i] % CODE_CHARS.length); }
    return out;
  }

  var auth = K.auth = {
    token: saved.token || null,
    user: saved.user || null,

    signedIn: function () { return !!auth.token; },

    // Every signed-in account, the one in use first.
    accounts: function () { return accounts.slice(); },

    // The account in use, and its entry in the list (the same person signed in twice keeps one).
    save: function () {
      var me = { token: auth.token, user: auth.user };
      accounts = accounts.filter(function (a) { return a.token !== me.token && !(me.user && a.user && a.user.name === me.user.name); });
      if (me.token) { accounts.unshift(me); }
      K.store.set(LIST, accounts);
      if (me.token) { K.store.set(KEY, me); } else { K.store.del(KEY); }
    },

    use: function (token) {
      var a = accounts.filter(function (x) { return x.token === token; })[0];
      if (!a || a.token === auth.token) { return; }
      auth.token = a.token;
      auth.user = a.user;
      auth.save();
      K.app.authChanged();
      auth.refreshUser();
    },

    // Logs out the account in use; the next signed-in one (if any) takes over.
    signOut: function () {
      var gone = auth.token, next = accounts.filter(function (a) { return a.token !== gone; })[0];
      accounts = accounts.filter(function (a) { return a.token !== gone; });
      auth.token = next ? next.token : null;
      auth.user = next ? next.user : null;
      auth.save();
      K.app.authChanged();
      if (next) { auth.refreshUser(); }
    },

    // Username and picture for the profile button. Accounts without their own picture fall back to
    // their channel's picture, then to Kick's default avatar. lastError tells Account what failed.
    refreshUser: function (cb) {
      if (!auth.token) { if (cb) { cb(); } return; }
      K.api.me(auth.token, function (err, d) {
        d = d && d.data && d.data.username ? d.data : d;
        if (err || !d || !d.username) {
          auth.lastError = err ? (err.status ? 'HTTP ' + err.status : 'no connection') : 'unexpected answer';
          if (cb) { cb(err); }
          return;
        }
        auth.lastError = null;
        var slug = (d.streamer_channel && d.streamer_channel.slug) || d.username;
        function done(pic) {
          auth.user = { name: d.username, slug: slug, avatar: pic || null };
          auth.save();
          K.app.authChanged();
          if (cb) { cb(); }
        }
        if (d.profilepic || d.profile_pic) { return done(d.profilepic || d.profile_pic); }
        K.api.channel(slug, function (e, ch) { done(ch && ch.user && ch.user.profile_pic); });
      });
    },

    // onState({ phase: 'waiting'|'expired'|'success', url, code, note }). Returns { stop }.
    link: function (onState) {
      var uuid = K.uuid(), key = code(), url = 'https://kick.com/tv/login?uuid=' + uuid + '&code=' + key;
      var stopped = false, timer = null, started = Date.now();
      function poll() {
        if (stopped) { return; }
        if (Date.now() - started > EXPIRE_MS) { onState({ phase: 'expired', url: url, code: key }); return; }
        K.api.tvLink(uuid, key, function (err, d) {
          if (stopped) { return; }
          var token = d && (d.token || (d.data && d.data.token));
          if (!err && token) {
            stopped = true;
            auth.token = token;
            auth.user = null;
            auth.save();
            auth.refreshUser(function () { onState({ phase: 'success' }); });
            return;
          }
          // 403 "Invalid setup UUID and Key" just means: not approved on the phone yet.
          var note = err && err.status && err.status !== 403 ? K.t('Kick answered {n}. Still waiting…', { n: err.status + (d && d.message ? ' (' + d.message + ')' : '') }) : null;
          onState({ phase: 'waiting', url: url, code: key, note: note });
          timer = setTimeout(poll, POLL_MS);
        });
      }
      onState({ phase: 'waiting', url: url, code: key });
      timer = setTimeout(poll, POLL_MS);
      return { stop: function () { stopped = true; clearTimeout(timer); } };
    }
  };
})(window.K);
