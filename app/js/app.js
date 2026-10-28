/* App shell: top navigation (KickTopNavigationBar), screen stack, dialogs, remote keys, start-up. */
(function (K) {
  'use strict';

  var KEYS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter', 10009: 'back', 27: 'back', 8: 'back',
    427: 'chup', 428: 'chdown', 33: 'chup', 34: 'chdown', 10252: 'playpause', 415: 'play', 19: 'pause', 413: 'stop' };
  var nav = K.$('nav'), host = K.$('screens'), user = K.$('navUser'), roots = {}, stack = [], inNav = false;

  // ---- dialogs ----
  K.modal = (function () {
    var m = K.$('modal'), prev = null, onClose = null;
    function open(build, close) {
      prev = { scope: K.focus.scope, el: K.focus.current };
      m.textContent = '';
      var d = K.el('div', 'dialog');
      build(d);
      m.appendChild(d);
      m.hidden = false;
      onClose = close || null;
      K.focus.setScope(m);
    }
    function close(skipCallback) {
      if (m.hidden) { return; }
      m.hidden = true;
      m.textContent = '';
      var cb = onClose;
      onClose = null;
      if (prev && prev.scope) { K.focus.setScope(prev.scope, prev.el); }
      if (cb && !skipCallback) { cb(); }
    }
    return {
      isOpen: function () { return !m.hidden; },
      close: function () { close(false); },
      // { title, text, qr, buttons: [[label, fn, primary]], onClose }
      show: function (o) {
        open(function (d) {
          if (o.title) { d.appendChild(K.el('h2', '', o.title)); }
          if (o.text) { d.appendChild(K.el('p', '', o.text)); }
          if (o.qr) { var box = K.el('div', 'qr-box'); box.appendChild(K.qr(o.qr, 368)); d.appendChild(box); }
          if (o.image) { var pic = K.el('img', 'qr-image'); pic.src = o.image; d.appendChild(pic); }
          var row = K.el('div');
          (o.buttons || [[K.t('Close')]]).forEach(function (b) {
            row.appendChild(K.cards.button(b[0], function () { close(true); if (b[1]) { b[1](); } }, b[2]));
          });
          d.appendChild(row);
        }, o.onClose);
      },
      options: function (title, opts, selected, pick) {
        open(function (d) {
          var list = K.el('div', 'opts');
          d.appendChild(K.el('h2', '', title));
          opts.forEach(function (o) {
            var e = K.el('div', 'opt f' + (o.id === selected ? ' sel' : ''), o.label);
            e._select = function () { close(true); pick(o.id); };
            list.appendChild(e);
          });
          d.appendChild(list);
        });
        var sel = m.querySelector('.opt.sel');
        if (sel) { K.focus.set(sel); }
      }
    };
  })();

  // ---- screens ----
  function current() { return stack[stack.length - 1]; }

  function destroy(s) {
    if (s.destroy) { s.destroy(); }
    if (s.el.parentNode) { s.el.parentNode.removeChild(s.el); }
  }

  function show(s) {
    if (!s.el.parentNode) { host.appendChild(s.el); }
    Array.prototype.forEach.call(host.children, function (c) { c.hidden = c !== s.el; });
    var root = stack[0] && stack[0].name;
    Array.prototype.forEach.call(nav.querySelectorAll('[data-go]'), function (n) { n.classList.toggle('active', n.getAttribute('data-go') === root); });
    if (!inNav && !K.player.isOpen() && !K.modal.isOpen()) { K.focus.setScope(s.el); }
  }

  function enterNav() {
    inNav = true;
    K.focus.setScope(nav, nav.querySelector('.nav-tab.active') || nav.querySelector('.nav-tab[data-go="home"]'));
  }
  function leaveNav() {
    inNav = false;
    if (current()) { K.focus.setScope(current().el); }
  }

  function updateUser() {
    var u = K.auth.user;
    user.textContent = '';
    // Profile picture (Kick's default avatar without one) or Connect; both open Account.
    if (K.auth.signedIn()) {
      var img = K.el('img');
      img.src = u && u.avatar ? K.helper.url(u.avatar) : 'img/default_avatar.png';
      user.appendChild(img);
    } else {
      var c = K.el('div', 'connect');
      c.appendChild(K.cards.icon('device'));
      c.appendChild(document.createTextNode(K.t('Connect')));
      user.appendChild(c);
    }
  }

  var app = K.app = {
    lastInput: Date.now(),

    go: function (name) {
      stack.forEach(function (s) { if (!s.root) { destroy(s); } });
      var fresh = !roots[name], s = roots[name] || (roots[name] = K.screens[name]());
      stack = [s];
      if (!fresh && s.refresh) { s.refresh(); }
      show(s);
    },
    push: function (s) { inNav = false; stack.push(s); show(s); },
    pop: function () { if (stack.length > 1) { destroy(stack.pop()); show(current()); } },

    // Rebuild a root screen now if it's showing, otherwise the next time it's opened.
    reload: function (name) {
      if (roots[name]) { destroy(roots[name]); delete roots[name]; }
      if (stack.length === 1 && stack[0].name === name) { app.go(name); }
    },

    screenReady: function (s) {
      if (s !== current() || inNav || K.player.isOpen() || K.modal.isOpen()) { return; }
      if (!K.focus.current || !s.el.contains(K.focus.current)) { K.focus.setScope(s.el); }
    },

    authChanged: function () { updateUser(); app.reload('following'); app.reload('settings'); },

    prefsChanged: function (key) {
      if (key === 'hideGambling' || key === 'hideMature' || key === 'hidePools' || key === 'language') {
        ['home', 'categories', 'live', 'search'].forEach(function (n) { if (roots[n] && stack[0] !== roots[n]) { destroy(roots[n]); delete roots[n]; } });
      }
    },

    playerOpened: function () { inNav = false; },
    playerClosed: function () {
      var s = current();
      if (!s) { return; }
      if (s.refresh) { s.refresh(); }  // Home's Continue Watching
      K.focus.setScope(s.el);
    }
  };

  Array.prototype.forEach.call(nav.querySelectorAll('[data-go]'), function (n) {
    n._select = function () {
      var name = n.getAttribute('data-go');
      inNav = false;
      if (stack.length === 1 && stack[0].name === name) { K.focus.setScope(stack[0].el); } else { app.go(name); }
    };
  });

  function confirmExit() {
    K.modal.show({ title: K.t('Exit Kick?'), buttons: [[K.t('Exit'), function () {
      try { tizen.application.getCurrentApplication().exit(); } catch (e) { /* not on a TV */ }
    }, true], [K.t('Cancel')]] });
  }

  function back() {
    if (inNav) {
      if (stack[0].name !== 'home') { inNav = false; app.go('home'); } else { confirmExit(); }
      return;
    }
    if (stack.length > 1) { app.pop(); return; }
    enterNav();
  }

  function select() { var c = K.focus.current; if (c && c._select) { c._select(); } }

  document.addEventListener('keydown', function (e) {
    var k = KEYS[e.keyCode];
    app.lastInput = Date.now();
    if (!k) { return; }
    e.preventDefault();
    var arrow = k === 'left' || k === 'right' || k === 'up' || k === 'down';
    if (K.modal.isOpen()) {
      if (k === 'back') { K.modal.close(); } else if (k === 'enter') { select(); } else if (arrow) { K.focus.move(k); }
      return;
    }
    if (K.player.isOpen()) { K.player.key(k); return; }
    if (k === 'enter') { select(); return; }
    if (k === 'back') { back(); return; }
    if (!arrow) { return; }
    if (inNav) {
      if (k === 'down') { leaveNav(); } else { K.focus.move(k); }
      return;
    }
    var cur = K.focus.current;
    if (cur && cur._dir && cur._dir(k)) { return; }
    if (!K.focus.move(k) && k === 'up') { enterNav(); }
  });

  try {
    ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'ChannelUp', 'ChannelDown'].forEach(function (n) { tizen.tvinputdevice.registerKey(n); });
  } catch (e) { /* not on a TV */ }

  K.player.warm();
  updateUser();
  // After a language change the app reloads; it comes back to Account.
  var reopen = K.store.get('kick.reopen', null);
  K.store.del('kick.reopen');
  app.go(reopen === 'settings' ? 'settings' : 'home');
  if (K.auth.signedIn()) { K.auth.refreshUser(); }
})(window.K);
