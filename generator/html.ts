import { tRaw, type Lang, LANGS } from "./i18n";

/** HTML-escape a string */
export function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Get localized text from JSONB name object, with fallback chain */
export function localized(
  name: Record<string, string> | null | undefined,
  lang: Lang
): string {
  if (!name) return "";
  return name[lang] || name.en || name.nl || name.fr || name.de || "";
}

/** Resolve text for a language with fallback, returns [text, isFallback] */
function resolveWithFallback(
  name: Record<string, string>,
  lang: Lang
): [string, boolean] {
  if (name[lang]) return [name[lang], false];
  const fb = name.en || name.nl || name.fr || name.de || "";
  return [fb, !!fb];
}

/** Emit a multilingual text span — always emits all 4 langs with fallback */
export function ml(name: Record<string, string> | null | undefined): string {
  if (!name) return "";
  const vals = LANGS.map((l) => name[l]).filter(Boolean);
  const unique = new Set(vals);
  if (unique.size <= 1) return esc(vals[0] || "");

  return LANGS.map((l) => {
    const [text, isFallback] = resolveWithFallback(name, l);
    if (!text) return "";
    if (isFallback) {
      return `<span class="i18n-${l}"><span class="fallback">${esc(text)}</span></span>`;
    }
    return `<span class="i18n-${l}">${esc(text)}</span>`;
  }).join("");
}

/** Emit a translated UI label */
export function label(key: string): string {
  return LANGS.map(
    (l) => `<span class="i18n-${l}">${esc(tRaw(key, l))}</span>`
  ).join("");
}

/** Format price in EUR */
export function formatPrice(amount: number | null): string {
  if (amount == null) return "";
  return new Intl.NumberFormat("de-BE", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

/** Slugify text for URLs */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/** Generate entity slug: name_code */
export function entitySlug(
  name: Record<string, string> | null | undefined,
  code: string
): string {
  const text = localized(name, "en");
  if (!text) return code;
  return `${slugify(text)}_${code}`;
}

/** URL path helpers for each entity type */
export const entityUrl = {
  vtm: (name: Record<string, string>, code: string) =>
    `/substances/${entitySlug(name, code)}/`,
  vmp: (name: Record<string, string>, code: string) =>
    `/generics/${entitySlug(name, code)}/`,
  amp: (name: Record<string, string>, code: string) =>
    `/medications/${entitySlug(name, code)}/`,
  ampp: (name: Record<string, string>, code: string) =>
    `/packages/${entitySlug(name, code)}/`,
  company: (name: string, actorNr: string) =>
    `/companies/${slugify(name)}_${actorNr}/`,
  substance: (name: Record<string, string>, code: string) =>
    `/ingredients/${entitySlug(name, code)}/`,
  vmpGroup: (name: Record<string, string>, code: string) =>
    `/therapeutic-groups/${entitySlug(name, code)}/`,
  atc: (code: string) => `/classifications/${code.toLowerCase()}_${code}/`,
  chapterIV: (chapter: string, paragraph: string) =>
    `/chapter-iv/${chapter}/${paragraph}/`,
};

/** Entity type badge colors */
const ENTITY_COLORS: Record<string, string> = {
  vtm: "#7C3AED",
  vmp: "#3B82F6",
  amp: "#10B981",
  ampp: "#F97316",
  company: "#6B7280",
  vmp_group: "#14B8A6",
  substance: "#8B5CF6",
  atc: "#6366F1",
  chapter_iv: "#EF4444",
};

const ENTITY_LABEL_KEYS: Record<string, string> = {
  vtm: "entityLabels.substance",
  vmp: "entityLabels.generic",
  amp: "entityLabels.brand",
  ampp: "entityLabels.package",
  company: "entityLabels.company",
  vmp_group: "entityLabels.group",
  substance: "entityLabels.ingredient",
  atc: "entityLabels.atc",
  chapter_iv: "entityLabels.chapterIV",
};

/** Render entity type badge */
export function badge(type: string): string {
  const color = ENTITY_COLORS[type] || "#6B7280";
  return `<span class="badge" style="background:${color}20;color:${color}">${label(ENTITY_LABEL_KEYS[type] || type)}</span>`;
}

/** Render a section with title and optional count */
export function section(
  titleKey: string,
  content: string,
  opts?: { count?: number; pagefindIgnore?: boolean }
): string {
  const ignore = opts?.pagefindIgnore !== false ? ' data-pagefind-ignore' : "";
  const countHtml =
    opts?.count != null ? ` <span class="count">(${opts.count})</span>` : "";
  return `<section class="section"${ignore}><h2 class="section-title">${label(titleKey)}${countHtml}</h2>${content}</section>`;
}

/** Render a relationship list (VMPs, AMPs, etc.) */
export function relationshipList(
  titleKey: string,
  items: {
    type: string;
    url: string;
    name: Record<string, string>;
    subtitle?: string;
  }[]
): string {
  if (items.length === 0) return "";
  const INITIAL = 10;
  const listItems = items
    .map(
      (item, i) =>
        `<a href="${item.url}" class="rel-item${i >= INITIAL ? " hidden-item" : ""}">${badge(item.type)}<div class="rel-item-content"><span class="rel-item-name">${ml(item.name)}</span>${item.subtitle ? `<span class="rel-item-subtitle">${esc(item.subtitle)}</span>` : ""}</div><span class="rel-item-arrow" aria-hidden="true">›</span></a>`
    )
    .join("");

  const showMore =
    items.length > INITIAL
      ? `<button class="show-more-btn" onclick="toggleList(this)">${label("common.showAll")} (${items.length})</button>`
      : "";

  return section(titleKey, `<div class="rel-list">${listItems}</div>${showMore}`, {
    count: items.length,
  });
}

/** Render info row for overview sections */
export function infoRow(labelKey: string, value: string): string {
  return `<div class="info-row"><dt>${label(labelKey)}</dt><dd>${value}</dd></div>`;
}

/** Format a date */
export function formatDate(d: string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Render the sidebar summary card */
export function summaryCard(
  rows: { labelKey: string; value: string; isLink?: boolean }[]
): string {
  const rowsHtml = rows
    .filter((r) => r.value)
    .map(
      (r) =>
        `<div class="summary-row"><span class="summary-label">${label(r.labelKey)}</span><span class="summary-value${r.isLink ? " link-text" : ""}">${r.value}</span></div>`
    )
    .join("");
  return `<aside class="sidebar"><div class="summary-card"><h3>${label("detail.summary")}</h3><div class="summary-rows">${rowsHtml}</div></div></aside>`;
}

/** Minify HTML — collapse whitespace between tags */
export function minify(html: string): string {
  return html
    .replace(/\n\s*\n/g, "\n")
    .replace(/>\s+</g, "> <")
    .replace(/^\s+/gm, "");
}

/** Wrap content in the full page layout */
export function layout(
  title: string,
  content: string,
  options?: { description?: string; pagefindMeta?: string }
): string {
  const desc =
    options?.description ||
    `${title} - MedSearch Belgium Medication Database`;
  return minify(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | MedSearch</title>
<meta name="description" content="${esc(desc)}">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="header">
<div class="container header-inner">
<a href="/" class="logo">
<div class="logo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L12 22M2 12L22 12" stroke-linecap="round"/></svg></div>
<span class="logo-text">MedSearch</span>
</a>
<nav class="header-nav"></nav>
<button id="theme-toggle" class="theme-btn" aria-label="Toggle theme">
<svg class="icon-sun" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clip-rule="evenodd"/></svg>
<svg class="icon-moon" viewBox="0 0 20 20" fill="currentColor"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/></svg>
</button>
<select id="lang-select" aria-label="Language">
<option value="en">English</option>
<option value="nl">Nederlands</option>
<option value="fr">Français</option>
<option value="de">Deutsch</option>
</select>
</div>
</header>
<main>
${content}
</main>
<footer class="footer">
<div class="container footer-inner">
<p>${label("footer.disclaimer")}</p>
</div>
</footer>
<script src="/lang.js"></script>
</body>
</html>`);
}
