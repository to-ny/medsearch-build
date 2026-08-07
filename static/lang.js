// Language toggle
(function () {
  var LANGS = ['en', 'nl', 'fr', 'de'];
  var SITE_TITLES = {
    en: 'Belgium Medication Database',
    nl: 'Belgische Geneesmiddelendatabank',
    fr: 'Base de données des médicaments belges',
    de: 'Belgische Arzneimitteldatenbank'
  };
  var stored = localStorage.getItem('lang');
  var browserLang = (navigator.language || '').slice(0, 2);
  var lang = LANGS.indexOf(stored) !== -1 ? stored : LANGS.indexOf(browserLang) !== -1 ? browserLang : 'en';

  function applyLang(l) {
    document.documentElement.lang = l;
    var pageTitle = document.documentElement.getAttribute('data-page-title');
    document.title = (pageTitle || 'MedSearch') + ' | MedSearch — ' + (SITE_TITLES[l] || SITE_TITLES.en);
    // Notify listeners (e.g. search.js)
    if (window._langListeners) {
      window._langListeners.forEach(function (fn) { fn(l); });
    }
  }

  window.onLangChange = function (fn) {
    window._langListeners = window._langListeners || [];
    window._langListeners.push(fn);
  };

  applyLang(lang);
  var sel = document.getElementById('lang-select');
  if (sel) {
    sel.value = lang;
    sel.addEventListener('change', function () {
      localStorage.setItem('lang', this.value);
      applyLang(this.value);
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

// SAM version — injected from /version.json so it isn't baked into every page
// (a SAM bump then changes one file, keeping incremental deploys small).
(function () {
  var el = document.getElementById('sam-version');
  if (!el) return;
  fetch('/version.json')
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d.sam) el.textContent = ' v' + d.sam; })
    .catch(function () {});
})();

// Listing-page filter (client-side, over rows already in the DOM)
(function () {
  var input = document.getElementById('list-filter');
  if (!input) return;
  var PH = { en: 'Filter…', nl: 'Filteren…', fr: 'Filtrer…', de: 'Filtern…' };
  var RES = { en: 'results', nl: 'resultaten', fr: 'résultats', de: 'Ergebnisse' };
  var items = Array.prototype.slice.call(document.querySelectorAll('.listing-list .rel-item'));
  var countEl = document.getElementById('list-filter-count');
  function lang() { return document.documentElement.lang || 'en'; }
  function render() {
    var q = input.value.trim().toLowerCase();
    var shown = 0;
    for (var i = 0; i < items.length; i++) {
      var t = items[i].getAttribute('data-f') || '';
      var match = !q || t.indexOf(q) !== -1;
      items[i].style.display = match ? 'flex' : 'none';
      if (match) shown++;
    }
    if (countEl) countEl.textContent = shown + ' ' + (RES[lang()] || RES.en);
  }
  input.addEventListener('input', render);
  input.placeholder = PH[lang()] || PH.en;
  render();
  if (window.onLangChange) {
    window.onLangChange(function () { input.placeholder = PH[lang()] || PH.en; render(); });
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
