/* Remote-control focus. Anything with class "f" can take focus; arrow keys move to the nearest
   focusable in that direction inside the active scope (screen, side menu, player or dialog).
   Rows (.track) and grids (.grid) only move sideways within their own row; other layouts
   (keyboard, buttons) fall back to the nearest item in that direction. */
(function (K) {
  'use strict';

  var focus = K.focus = { current: null, scope: null };

  function rect(el) { return el.getBoundingClientRect(); }
  function visible(el) { return el.getClientRects().length > 0; }
  function strictRows(el) { return !!(el.closest('.track') || el.closest('.grid')); }

  focus.items = function (scope) {
    return Array.prototype.filter.call((scope || focus.scope || document).querySelectorAll('.f'), visible);
  };

  focus.setScope = function (scope, el) {
    focus.scope = scope;
    focus.set(el && visible(el) ? el : (scope._last && scope.contains(scope._last) && visible(scope._last) ? scope._last : focus.items(scope)[0]));
  };

  focus.set = function (el, noScroll) {
    if (focus.current && focus.current !== el) { focus.current.classList.remove('focused'); }
    focus.current = el || null;
    if (!el) { return; }
    el.classList.add('focused');
    if (focus.scope) { focus.scope._last = el; }
    if (!noScroll) { focus.reveal(el); }
    if (el._focus) { el._focus(el); }
  };

  focus.move = function (dir) {
    var cur = focus.current;
    if (!cur || !focus.scope || !focus.scope.contains(cur) || !visible(cur)) { focus.setScope(focus.scope); return !!focus.current; }
    var r = rect(cur), rcx = (r.left + r.right) / 2, rcy = (r.top + r.bottom) / 2, best = null, bestScore = Infinity, loose = null, looseScore = Infinity;
    focus.items().forEach(function (c) {
      if (c === cur) { return; }
      var q = rect(c), qcx = (q.left + q.right) / 2, qcy = (q.top + q.bottom) / 2, gap, side, score;
      var overlapY = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
      var spanX = Math.max(0, q.left - r.right, r.left - q.right);
      if (dir === 'left' || dir === 'right') {
        if (dir === 'left' ? qcx >= rcx - 1 : qcx <= rcx + 1) { return; }
        gap = dir === 'left' ? r.left - q.right : q.left - r.right;
        if (overlapY > 0) {
          score = gap + Math.abs(qcy - rcy) * 0.1;
          if (score < bestScore) { bestScore = score; best = c; }
        } else {
          score = Math.abs(qcx - rcx) + Math.abs(qcy - rcy) * 2;
          if (score < looseScore) { looseScore = score; loose = c; }
        }
      } else {
        if (dir === 'up' ? qcy >= rcy - 1 : qcy <= rcy + 1) { return; }
        gap = Math.max(0, dir === 'up' ? r.top - q.bottom : q.top - r.bottom);
        side = spanX * 1.5 + Math.abs(qcx - rcx) * 0.05;
        score = gap + side;
        if (score < bestScore) { bestScore = score; best = c; }
      }
    });
    if (!best && loose && !strictRows(cur)) { best = loose; }
    if (best) { focus.set(best); return true; }
    return false;
  };

  function offsetWithin(el, ancestor) {
    var top = 0, left = 0;
    while (el && el !== ancestor) { top += el.offsetTop; left += el.offsetLeft; el = el.offsetParent; }
    return { top: top, left: left };
  }

  // Keep the focused card inside its row, and its row (or grid line) inside the screen. Lists
  // (data-scroll="list") move only as far as needed. Nothing scrolls past the end of the page.
  focus.reveal = function (el) {
    var track = el.closest('.track');
    if (track) {
      var viewW = track.parentNode.clientWidth, off = track._off || 0, item = el;
      while (item.parentNode !== track) { item = item.parentNode; }
      var left = item.offsetLeft, right = left + item.offsetWidth;
      if (left - off < 0) { off = left; } else if (right - off > viewW - 160) { off = right - viewW + 160; }
      off = Math.max(0, off);
      if (off !== track._off) { track._off = off; track.style.transform = 'translateX(' + -off + 'px)'; }
    }
    var scroller = el.closest('.scroller');
    if (scroller) {
      var anchor = el.closest('.grid') || el.closest('.slist') ? el : (el.closest('.sec') || el), pos = offsetWithin(anchor, scroller);
      var bottom = pos.top + anchor.offsetHeight, y = pos.top - 110, cur = scroller._off || 0;
      if (scroller.getAttribute('data-scroll') === 'list') {
        y = pos.top - cur < 150 ? pos.top - 150 : bottom - cur > 1080 - 60 ? bottom - 1080 + 60 : cur;
      } else if (bottom <= 1080 - 70 || anchor.hasAttribute('data-top')) { y = 0; }
      y = Math.max(0, Math.min(y, scroller.offsetHeight - 1080));
      if (y !== scroller._off) { scroller._off = y; scroller.style.transform = 'translateY(' + -y + 'px)'; if (K.app) { K.app.scrolled(scroller, y); } }
    }
  };
})(window.K);
