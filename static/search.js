// MedSearch — Client-side search with MiniSearch
(function () {
  var TYPES = [
    { key: 'amp', label: { en: 'Medications', nl: 'Geneesmiddelen', fr: 'Médicaments', de: 'Arzneimittel' }, color: '#10B981' },
    { key: 'ampp', label: { en: 'Packages', nl: 'Verpakkingen', fr: 'Conditionnements', de: 'Packungen' }, color: '#F97316' },
    { key: 'vmp', label: { en: 'Generics', nl: 'Generiek', fr: 'Génériques', de: 'Generika' }, color: '#3B82F6' },
    { key: 'vtm', label: { en: 'Substances', nl: 'Stoffen', fr: 'Substances', de: 'Substanzen' }, color: '#7C3AED' },
    { key: 'company', label: { en: 'Companies', nl: 'Bedrijven', fr: 'Entreprises', de: 'Unternehmen' }, color: '#6B7280' },
    { key: 'substance', label: { en: 'Ingredients', nl: 'Ingrediënten', fr: 'Ingrédients', de: 'Zutaten' }, color: '#8B5CF6' },
    { key: 'vmp-group', label: { en: 'Therapeutic Groups', nl: 'Therapeutische Groepen', fr: 'Groupes Thérapeutiques', de: 'Therapeutische Gruppen' }, color: '#14B8A6' },
    { key: 'atc', label: { en: 'Classifications', nl: 'Classificaties', fr: 'Classifications', de: 'Klassifikationen' }, color: '#6366F1' },
    { key: 'chapter-iv', label: { en: 'Chapter IV', nl: 'Hoofdstuk IV', fr: 'Chapitre IV', de: 'Kapitel IV' }, color: '#EF4444' },
  ];

  var PLACEHOLDERS = {
    amp: { en: 'Search brand name, code...', nl: 'Zoek merknaam, code...', fr: 'Rechercher marque, code...', de: 'Markenname, Code suchen...' },
    ampp: { en: 'Search package, CNK code...', nl: 'Zoek verpakking, CNK-code...', fr: 'Rechercher conditionnement, code CNK...', de: 'Packung, CNK-Code suchen...' },
    vmp: { en: 'Search generic name...', nl: 'Zoek generieke naam...', fr: 'Rechercher nom générique...', de: 'Generischen Namen suchen...' },
    vtm: { en: 'Search substance...', nl: 'Zoek stof...', fr: 'Rechercher substance...', de: 'Substanz suchen...' },
    company: { en: 'Search company...', nl: 'Zoek bedrijf...', fr: 'Rechercher entreprise...', de: 'Unternehmen suchen...' },
    substance: { en: 'Search ingredient...', nl: 'Zoek ingredient...', fr: 'Rechercher ingrédient...', de: 'Zutat suchen...' },
    'vmp-group': { en: 'Search therapeutic group...', nl: 'Zoek therapeutische groep...', fr: 'Rechercher groupe thérapeutique...', de: 'Therapeutische Gruppe suchen...' },
    atc: { en: 'Search ATC code or description...', nl: 'Zoek ATC-code of beschrijving...', fr: 'Rechercher code ATC ou description...', de: 'ATC-Code oder Beschreibung suchen...' },
    'chapter-iv': { en: 'Search paragraph...', nl: 'Zoek paragraaf...', fr: 'Rechercher paragraphe...', de: 'Paragraph suchen...' },
  };

  var indexCache = {};
  var msCache = {};
  var currentType = 'amp';
  var debounceTimer = null;

  function lang() { return document.documentElement.lang || 'en'; }

  function ml(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    var l = lang();
    return obj[l] || obj.en || obj.nl || obj.fr || obj.de || '';
  }

  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function formatPrice(n) {
    if (n == null) return '';
    return new Intl.NumberFormat('de-BE', { style: 'currency', currency: 'EUR' }).format(n);
  }

  function typeConfig(key) {
    return TYPES.find(function (t) { return t.key === key; }) || TYPES[0];
  }

  function buildMiniSearch(type, data) {
    var fields = ['n', 'code'];
    if (type === 'amp') fields.push('company');
    if (type === 'ampp') fields.push('cnk', 'company');
    if (type === 'company') fields = ['n', 'code'];

    var ms = new MiniSearch({
      fields: fields,
      storeFields: ['id', 'n', 'code', 'sub', 'company', 'cnk', 'pack', 'price', 'reimb', 'bt', 'count', 'group', 'url'],
      searchOptions: {
        prefix: true,
        fuzzy: 0.2,
        boost: { n: 2, cnk: 3, code: 1.5 },
      },
    });
    ms.addAll(data);
    return ms;
  }

  function loadIndex(type, cb) {
    if (msCache[type]) return cb(msCache[type]);
    if (indexCache[type]) {
      msCache[type] = buildMiniSearch(type, indexCache[type]);
      return cb(msCache[type]);
    }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/_indexes/' + type + '.json');
    xhr.onload = function () {
      if (xhr.status === 200) {
        var data = JSON.parse(xhr.responseText);
        indexCache[type] = data;
        msCache[type] = buildMiniSearch(type, data);
        cb(msCache[type]);
      }
    };
    xhr.send();
  }

  function doSearch(query) {
    var resultsEl = document.getElementById('search-results');
    var countEl = document.getElementById('search-count');
    if (!query || query.length < 2) {
      resultsEl.innerHTML = '';
      countEl.textContent = '';
      return;
    }
    loadIndex(currentType, function (ms) {
      var results = ms.search(query, { prefix: true, fuzzy: 0.2 });
      var top = results.slice(0, 30);
      countEl.textContent = results.length + ' ' + ml(typeConfig(currentType).label).toLowerCase();
      if (top.length === 0) {
        resultsEl.innerHTML = '<div class="search-empty">' + esc(ml({
          en: 'No results found',
          nl: 'Geen resultaten gevonden',
          fr: 'Aucun résultat trouvé',
          de: 'Keine Ergebnisse gefunden',
        })) + '</div>';
        return;
      }
      resultsEl.innerHTML = top.map(function (r) { return renderCard(r, currentType, query); }).join('');
    });
  }

  function highlight(text, query) {
    if (!text || !query) return esc(text);
    var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    var escaped = esc(text);
    terms.forEach(function (term) {
      var re = new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      escaped = escaped.replace(re, '<mark>$1</mark>');
    });
    return escaped;
  }

  function renderCard(r, type, query) {
    var cfg = typeConfig(type);
    var name = r.n || '';
    var badge = '';

    var meta = [];
    if (r.code) meta.push('<span class="result-code">' + esc(r.code) + '</span>');
    if (r.cnk) meta.push('<span class="result-code">CNK ' + esc(r.cnk.split(' ')[0]) + '</span>');

    var details = [];
    if (r.sub) details.push('<span class="result-sub">' + highlight(r.sub, query) + '</span>');
    if (r.company) details.push('<span class="result-company">' + highlight(r.company, query) + '</span>');
    if (r.group) details.push('<span class="result-group">' + esc(r.group) + '</span>');
    if (r.pack) details.push('<span class="result-pack">' + esc(r.pack) + '</span>');

    var right = [];
    if (r.price != null) right.push('<span class="result-price">' + formatPrice(r.price) + '</span>');
    if (r.reimb) right.push('<span class="result-reimb">Reimbursable</span>');
    if (r.bt) right.push('<span class="result-bt" title="Enhanced monitoring">▲</span>');
    if (r.count) right.push('<span class="result-count">' + r.count + ' products</span>');

    return '<a href="' + esc(r.url) + '" class="result-card">'
      + '<div class="result-left">'
      + badge
      + '<div class="result-info">'
      + '<span class="result-name">' + highlight(name, query) + '</span>'
      + (meta.length ? '<span class="result-meta">' + meta.join(' ') + '</span>' : '')
      + (details.length ? '<div class="result-details">' + details.join('<span class="result-sep">·</span>') + '</div>' : '')
      + '</div>'
      + '</div>'
      + (right.length ? '<div class="result-right">' + right.join('') + '</div>' : '')
      + '<span class="result-arrow">›</span>'
      + '</a>';
  }

  window.initSearch = function () {
    var select = document.getElementById('type-select');
    var input = document.getElementById('search-input');
    if (!select || !input) return;

    TYPES.forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t.key;
      opt.textContent = ml(t.label);
      select.appendChild(opt);
    });
    select.value = currentType;
    updatePlaceholder();

    loadIndex(currentType, function () {});

    if (window.onLangChange) {
      window.onLangChange(function () {
        updatePlaceholder();
        TYPES.forEach(function (t, i) {
          if (select.options[i]) select.options[i].textContent = ml(t.label);
        });
      });
    }

    select.addEventListener('change', function () {
      currentType = this.value;
      updatePlaceholder();
      // Preload index for new type
      loadIndex(currentType, function () {
        if (input.value.length >= 2) doSearch(input.value);
      });
    });

    input.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      var q = this.value;
      debounceTimer = setTimeout(function () { doSearch(q); }, 150);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { this.blur(); }
    });

    // URL query param support
    var params = new URLSearchParams(location.search);
    var q = params.get('q');
    var t = params.get('type');
    if (t && TYPES.some(function (x) { return x.key === t; })) {
      currentType = t;
      select.value = t;
      updatePlaceholder();
    }
    if (q) {
      input.value = q;
      doSearch(q);
    }
  };

  window.fillSearch = function (q, type) {
    var input = document.getElementById('search-input');
    var select = document.getElementById('type-select');
    if (type && select) {
      currentType = type;
      select.value = type;
      updatePlaceholder();
    }
    if (input) {
      input.value = q;
      input.focus();
      doSearch(q);
    }
  };

  function updatePlaceholder() {
    var input = document.getElementById('search-input');
    if (input) {
      var ph = PLACEHOLDERS[currentType];
      input.placeholder = ph ? ml(ph) : '';
    }
  }

})();
