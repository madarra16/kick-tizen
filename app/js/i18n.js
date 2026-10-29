/* App language. K.t('<English text>', { vars }) gives the text in the chosen language (texts in
   js/i18n-data.js); English is the source and the fallback. Until a language is chosen in
   Account, the app speaks the TV's language (English if the app doesn't have it). Kick lists
   streams in the content language: the one chosen in Account, else the language of the
   country this TV is in, else the app language ('all' = every language). Elements with
   data-i18n get their text at start-up. Changing the language reloads the app. */
(function (K) {
  'use strict';

  // Each language in its own script, like the official app's language list.
  K.LANGUAGES = [['es', 'Español'], ['en', 'English'], ['de', 'Deutsch'], ['pt', 'Português'], ['fr', 'Français'],
    ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어'], ['hi', 'हिन्दी'], ['ar', 'العربية']];

  function supported(code) { return K.LANGUAGES.some(function (l) { return l[0] === code; }); }
  // The TV's language: Tizen's locale ("de_DE", stored once read), else the browser's ("de-DE").
  function deviceLanguage() {
    var l = K.prefs.deviceLanguage || '';
    if (!l) { try { l = navigator.language || ''; } catch (e) { /* none */ } }
    return l.slice(0, 2).toLowerCase();
  }
  // The TV's language if the app has it, else English.
  K.deviceLanguage = function () { return supported(deviceLanguage()) ? deviceLanguage() : 'en'; };
  if (!K.prefs.languageChosen) { K.prefs.language = K.deviceLanguage(); }
  if (!supported(K.prefs.language)) { K.prefs.language = 'en'; }
  K.savePrefs();
  // Tizen answers asynchronously; if it disagrees with the browser, switch once (a reload).
  try {
    tizen.systeminfo.getPropertyValue('LOCALE', function (loc) {
      var l = String(loc.language || '').slice(0, 2).toLowerCase();
      if (!l || l === K.prefs.deviceLanguage) { return; }
      K.prefs.deviceLanguage = l;
      K.savePrefs();
      if (!K.prefs.languageChosen && supported(l) && l !== K.prefs.language) { location.reload(); }
    });
  } catch (e) { /* not on a TV */ }
  var dict = (window.K_I18N || {})[K.prefs.language] || {};

  K.t = function (en, vars) {
    var s = dict[en] || en;
    return vars ? s.replace(/\{(\w+)\}/g, function (all, k) { return vars[k] !== undefined ? String(vars[k]) : all; }) : s;
  };

  // Language of the listed streams: Account › Content language, else the country's, else the app language.
  K.contentLanguage = function () { return K.prefs.contentLanguage || K.prefs.countryLanguage || K.prefs.language; };

  // The country's language is looked up at every start and used from the next one (the lists
  // shouldn't change under the viewer); the very first start waits for it, at most ~4 s.
  K.detectCountry = function (cb) {
    var first = !('countryLanguage' in K.prefs);
    setTimeout(function () { K.country(done); }, first ? 0 : 20000);
    function done(country) {
      if (country || first) {
        K.prefs.country = country || '';
        K.prefs.countryLanguage = K.countryLanguage(country) || '';
        K.savePrefs();
      }
      if (first && cb) { cb(); }
    }
    if (!first && cb) { cb(); }
  };

  K.languageName = function (code) {
    var l = K.LANGUAGES.filter(function (x) { return x[0] === code; })[0];
    return l ? l[1] : code;
  };

  // 'auto' follows the TV's language again.
  K.setLanguage = function (code) {
    K.prefs.languageChosen = code !== 'auto';
    if (code === 'auto') { code = K.deviceLanguage(); }
    if (code === K.prefs.language) { K.savePrefs(); K.app.reload('settings'); return; }
    K.prefs.language = code;
    K.savePrefs();
    K.store.set('kick.reopen', 'settings');  // come back to Account after the reload
    location.reload();
  };

  // lang picks the right CJK glyph shapes in the system fonts.
  document.documentElement.lang = K.prefs.language;
  Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) { el.textContent = K.t(el.getAttribute('data-i18n')); });
})(window.K);
