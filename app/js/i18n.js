/* App language. K.t('<English text>', { vars }) gives the text in the chosen language (texts in
   js/i18n-data.js); English is the source and the fallback. The same
   language also picks which streams Kick lists, until a content language is chosen
   (K.prefs.contentLanguage, 'all' = every language). Elements with data-i18n get
   their text at start-up. Changing the language reloads the app. */
(function (K) {
  'use strict';

  // Each language in its own script, like the official app's language list.
  K.LANGUAGES = [['es', 'Español'], ['en', 'English'], ['de', 'Deutsch'], ['pt', 'Português'], ['fr', 'Français'],
    ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어'], ['hi', 'हिन्दी'], ['ar', 'العربية']];

  var known = K.LANGUAGES.some(function (l) { return l[0] === K.prefs.language; });
  if (!known) { K.prefs.language = 'en'; K.savePrefs(); }
  var dict = (window.K_I18N || {})[K.prefs.language] || {};

  K.t = function (en, vars) {
    var s = dict[en] || en;
    return vars ? s.replace(/\{(\w+)\}/g, function (all, k) { return vars[k] !== undefined ? String(vars[k]) : all; }) : s;
  };

  // Language of the listed streams: Account › Content language, else the app language.
  K.contentLanguage = function () { return K.prefs.contentLanguage || K.prefs.language; };

  K.languageName = function (code) {
    var l = K.LANGUAGES.filter(function (x) { return x[0] === code; })[0];
    return l ? l[1] : code;
  };

  K.setLanguage = function (code) {
    if (code === K.prefs.language) { return; }
    K.prefs.language = code;
    K.savePrefs();
    K.store.set('kick.reopen', 'settings');  // come back to Account after the reload
    location.reload();
  };

  // lang picks the right CJK glyph shapes in the system fonts.
  document.documentElement.lang = K.prefs.language;
  Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) { el.textContent = K.t(el.getAttribute('data-i18n')); });
})(window.K);
