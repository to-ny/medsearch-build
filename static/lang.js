// Language toggle
(function () {
  var LANGS = ['en', 'nl', 'fr', 'de'];
  var stored = localStorage.getItem('lang');
  var browserLang = (navigator.language || '').slice(0, 2);
  var lang = LANGS.indexOf(stored) !== -1 ? stored : LANGS.indexOf(browserLang) !== -1 ? browserLang : 'en';
  document.documentElement.lang = lang;
  var sel = document.getElementById('lang-select');
  if (sel) {
    sel.value = lang;
    sel.addEventListener('change', function () {
      document.documentElement.lang = this.value;
      localStorage.setItem('lang', this.value);
    });
  }
})();

// Theme toggle
(function () {
  var stored = localStorage.getItem('theme');
  if (stored) document.documentElement.setAttribute('data-theme', stored);
  var btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme');
      var isDark = current === 'dark' || (!current && window.matchMedia('(prefers-color-scheme: dark)').matches);
      var next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
    });
  }
})();

// Show more / show less toggle
function toggleList(btn) {
  var section = btn.closest('.section');
  var items = section.querySelectorAll('.hidden-item');
  var expanded = btn.getAttribute('data-expanded') === 'true';
  items.forEach(function (el) { el.style.display = expanded ? 'none' : 'flex'; });
  btn.setAttribute('data-expanded', expanded ? 'false' : 'true');
  var spans = btn.querySelectorAll('span[class^="i18n-"]');
  if (spans.length > 0) {
    var showAll = { en: 'Show all', nl: 'Alles tonen', fr: 'Afficher tout', de: 'Alle anzeigen' };
    var showLess = { en: 'Show less', nl: 'Minder tonen', fr: 'Afficher moins', de: 'Weniger anzeigen' };
    spans.forEach(function (span) {
      var l = span.className.replace('i18n-', '');
      span.textContent = expanded ? showAll[l] : showLess[l];
    });
  }
}
