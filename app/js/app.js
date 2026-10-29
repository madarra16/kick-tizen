/* App shell: top navigation (KickTopNavigationBar), screen stack, dialogs, remote keys, start-up. */
(function (K) {
  'use strict';

  var KEYS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter', 10009: 'back', 27: 'back', 8: 'back',
    427: 'chup', 428: 'chdown', 33: 'chup', 34: 'chdown', 10252: 'playpause', 415: 'play', 19: 'pause', 413: 'stop' };
  var nav = K.$('nav'), host = K.$('screens'), user = K.$('navUser'), roots = {}, stack = [], inNav = false;
  var TAB_PREVIEW_MS = 350, previewTimer = null;

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
      // { title, text, url, body (element), qr (link), image (QR picture), logo, cls, buttons: [[label, fn, primary]], onClose }
      // A QR dialog is laid out like the official QR screen: the code on top (white on the dark
      // page), then title, text and address; beside a body (the changelog) it sits on the right.
      show: function (o) {
        open(function (d) {
          var code = null;
          if (o.qr || o.image) {
            code = o.qr ? K.qr(o.qr, 360, true) : K.el('img');
            if (o.image) { code.src = o.image; }
            code.className = 'qr-code';
            d.className += o.body ? '' : ' qr';
          }
          if (o.cls) { d.className += ' ' + o.cls; }
          if (o.logo) { var logo = K.el('img', 'dialog-logo'); logo.src = 'img/ic_kick_logo.svg'; d.appendChild(logo); }
          if (code && !o.body) { d.appendChild(code); }
          if (o.title) { d.appendChild(K.el('h2', '', o.title)); }
          if (o.text) { d.appendChild(K.el('p', '', o.text)); }
          if (o.url) { d.appendChild(K.el('div', 'qr-url', o.url)); }
          if (code && o.body) { d.appendChild(code); }
          if (o.body) { d.appendChild(o.body); }
          var row = K.el('div', 'dialog-buttons');
          (o.buttons || [[K.t('Close')]]).forEach(function (b) {
            row.appendChild(K.cards.button(b[0], function () { close(true); if (b[1]) { b[1](); } }, b[2]));
          });
          d.appendChild(row);
        }, o.onClose);
      },
      // A long list scrolls inside the dialog, following the focus, with a slim scrollbar.
      options: function (title, opts, selected, pick) {
        open(function (d) {
          var wrap = K.el('div', 'opts-wrap'), list = K.el('div', 'opts'), bar = K.el('div', 'scrollbar'), thumb = K.el('i');
          d.appendChild(K.el('h2', '', title));
          function follow(e) {
            var top = e.offsetTop, bottom = top + e.offsetHeight;
            if (top < list.scrollTop) { list.scrollTop = top; } else if (bottom > list.scrollTop + list.clientHeight) { list.scrollTop = bottom - list.clientHeight; }
            bar.hidden = list.scrollHeight <= list.clientHeight + 2;
            thumb.style.height = Math.round(list.clientHeight / list.scrollHeight * 100) + '%';
            thumb.style.top = Math.round(list.scrollTop / list.scrollHeight * 100) + '%';
          }
          opts.forEach(function (o) {
            var e = K.el('div', 'opt f' + (o.id === selected ? ' sel' : ''), o.label);
            e._select = function () { close(true); pick(o.id); };
            e._focus = follow;
            list.appendChild(e);
          });
          bar.appendChild(thumb);
          wrap.appendChild(list);
          wrap.appendChild(bar);
          d.appendChild(wrap);
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
    navAway((s.scroller && s.scroller._off) || 0);
    if (!inNav && !K.player.isOpen() && !K.modal.isOpen()) { K.focus.setScope(s.el); }
  }

  // ---- top bar ----
  // Scrolled down a screen: the bar slides away; it comes back at the top or when it's used.
  function navAway(y) { nav.classList.toggle('away', y > 40 && !inNav); }

  function enterNav() {
    inNav = true;
    nav.classList.add('in');
    navAway(0);
    K.focus.setScope(nav, nav.querySelector('.nav-tab.active') || nav.querySelector('.nav-tab[data-go="home"]'));
  }
  function leaveNav() {
    inNav = false;
    nav.classList.remove('in');
    clearTimeout(previewTimer);
    if (current()) { navAway(current().scroller._off || 0); K.focus.setScope(current().el); }
  }
  // Moving along the tabs opens each one shortly after it's reached; OK or down goes into it.
  function previewTab() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      var name = inNav && K.focus.current && K.focus.current.getAttribute('data-go');
      if (name && !(stack.length === 1 && stack[0].name === name)) { app.go(name); }
    }, TAB_PREVIEW_MS);
  }

  function clock() {
    var d = new Date(), el = K.$('navClock');
    try { el.textContent = d.toLocaleTimeString(K.prefs.language, { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { el.textContent = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }
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
    user.classList.toggle('update', K.update.available());
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
    push: function (s) { inNav = false; nav.classList.remove('in'); stack.push(s); show(s); },
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

    authChanged: function () { updateUser(); app.reload('home'); app.reload('following'); app.reload('settings'); },
    updateChanged: function () { updateUser(); },
    scrolled: function (scroller, y) { if (current() && current().scroller === scroller) { navAway(y); } },

    prefsChanged: function (key) {
      if (key === 'hideGambling' || key === 'hideMature' || key === 'hidePools' || key === 'language') {
        ['home', 'categories', 'live', 'search'].forEach(function (n) { if (roots[n] && stack[0] !== roots[n]) { destroy(roots[n]); delete roots[n]; } });
      }
    },

    playerOpened: function () { inNav = false; nav.classList.remove('in'); clearTimeout(previewTimer); },
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
      clearTimeout(previewTimer);
      if (!(stack.length === 1 && stack[0].name === name)) { app.go(name); }
      leaveNav();
    };
  });

  // Staying is the default: OK right away (or Back) keeps watching.
  function confirmExit() {
    K.modal.show({ cls: 'exit', logo: true, title: K.t('Leave Kick?'), text: K.t('See you next time!'), buttons: [[K.t('Stay'), null, true], [K.t('Exit'), function () {
      try { tizen.application.getCurrentApplication().exit(); } catch (e) { /* not on a TV */ }
    }]] });
  }

  function back() {
    if (inNav) {
      if (stack[0].name !== 'home') { app.go('home'); leaveNav(); } else { confirmExit(); }
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
      var cur = K.focus.current;
      if (k === 'back') { K.modal.close(); } else if (k === 'enter') { select(); } else if (arrow && !(cur && cur._dir && cur._dir(k))) { K.focus.move(k); }
      return;
    }
    if (K.player.isOpen()) { K.player.key(k); return; }
    if (k === 'enter') { select(); return; }
    if (k === 'back') { back(); return; }
    if (!arrow) { return; }
    if (inNav) {
      if (k === 'down') { leaveNav(); } else if (K.focus.move(k)) { previewTab(); }
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
  clock();
  setInterval(clock, 15000);
  // After a language change the app reloads; it comes back to Account. The first start waits
  // for the country's language so the first lists are already in it.
  var reopen = K.store.get('kick.reopen', null);
  K.store.del('kick.reopen');
  K.detectCountry(function () {
    app.go(reopen === 'settings' ? 'settings' : 'home');
    if (K.auth.signedIn()) { K.auth.refreshUser(); }
    setTimeout(function () { K.update.check(function () { app.updateChanged(); }); }, 30000);
  });
})(window.K);
