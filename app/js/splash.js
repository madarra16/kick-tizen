/* The Kick intro while the app starts. Where the TV plays it as its own loading screen
   (config.xml video_splash_screen, ready when window.screen.show() is called), this only ends it;
   elsewhere the page plays it over itself. Either way it stays until Home has drawn its lists. */
(function (K) {
  'use strict';

  var INTRO_MS = 1000, LONGEST_MS = 8000, T0 = Date.now();
  var cover = K.$('splash'), video = cover.querySelector('video'), native = typeof window.screen.show === 'function', ended = false, ready = false, gone = false;

  function finish() {
    if (gone) { return; }
    gone = true;
    if (native) { try { window.screen.show(); } catch (e) { /* shown anyway */ } }
    cover.classList.add('out');
    setTimeout(function () {
      video.removeAttribute('src');
      video.load();  // frees the decoder for the player
      if (cover.parentNode) { cover.parentNode.removeChild(cover); }
    }, 400);
  }
  function check() { if (ended && ready) { finish(); } }

  if (native) {
    cover.hidden = true;
    setTimeout(function () { ended = true; check(); }, Math.max(0, INTRO_MS - (Date.now() - T0)));
  } else {
    video.onended = video.onerror = function () { ended = true; check(); };
    video.src = 'media/splash.mp4';
    try { video.play(); } catch (e) { ended = true; }
  }
  setTimeout(function () { ended = ready = true; check(); }, LONGEST_MS);

  K.splash = { native: native, done: function () { ready = true; check(); } };
})(window.K);
