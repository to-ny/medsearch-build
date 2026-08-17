import { tRaw, type Lang, LANGS } from "./i18n";
import { hashedAsset } from "./assets";

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
  opts?: { count?: number; id?: string }
): string {
  const countHtml =
    opts?.count != null ? ` <span class="count">(${opts.count})</span>` : "";
  const idAttr = opts?.id ? ` id="${opts.id}"` : "";
  return `<section class="section"${idAttr}><h2 class="section-title">${label(titleKey)}${countHtml}</h2>${content}</section>`;
}

/** A related-entity list item */
export interface RelItem {
  type: string;
  url: string;
  name: Record<string, string>;
  subtitle?: string;
}

/** Lowercased searchable text for a rel item (all langs + subtitle) */
function relSearchText(item: RelItem): string {
  const names = Object.values(item.name || {}).join(" ");
  return `${names} ${item.subtitle || ""}`.trim().toLowerCase();
}

/** Render a single relationship list item (anchor row) */
export function relItem(
  item: RelItem,
  opts?: { hidden?: boolean; search?: boolean }
): string {
  const cls = `rel-item${opts?.hidden ? " hidden-item" : ""}`;
  const dataF = opts?.search ? ` data-f="${esc(relSearchText(item))}"` : "";
  return `<a href="${item.url}" class="${cls}"${dataF}>${badge(item.type)}<div class="rel-item-content"><span class="rel-item-name">${ml(item.name)}</span>${item.subtitle ? `<span class="rel-item-subtitle">${esc(item.subtitle)}</span>` : ""}</div><span class="rel-item-arrow" aria-hidden="true">›</span></a>`;
}

/** Render a relationship list (VMPs, AMPs, etc.) */
export function relationshipList(
  titleKey: string,
  items: RelItem[],
  opts?: { id?: string }
): string {
  if (items.length === 0) return "";
  const INITIAL = 10;
  const listItems = items
    .map((item, i) => relItem(item, { hidden: i >= INITIAL }))
    .join("");

  const showMore =
    items.length > INITIAL
      ? `<button class="show-more-btn" onclick="toggleList(this)">${label("common.showAll")} (${items.length})</button>`
      : "";

  return section(titleKey, `<div class="rel-list">${listItems}</div>${showMore}`, {
    count: items.length,
    id: opts?.id,
  });
}

/** Render info row for overview sections */
export function infoRow(labelKey: string, value: string): string {
  return `<div class="info-row"><dt>${label(labelKey)}</dt><dd>${value}</dd></div>`;
}

/** Parse a date value tolerant of JSON-quoted strings (some tables store `"2016-…Z"`). */
function parseDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const s = typeof d === "string" ? d.replace(/^"+|"+$/g, "").trim() : String(d);
  if (!s) return null;
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

/** Format a date (returns "" if unparseable) */
export function formatDate(d: string | null): string {
  const dt = parseDate(d);
  if (!dt) return "";
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** True if the end-date is in the past. */
export function isExpired(endDate: string | null | undefined): boolean {
  const dt = parseDate(endDate);
  return dt ? dt < new Date() : false;
}

/** Breadcrumb trail (hierarchical parents; last item = current page, unlinked) */
export function breadcrumb(items: { html: string; url?: string }[]): string {
  if (items.length === 0) return "";
  const parts = items.map((it, i) => {
    const last = i === items.length - 1;
    return it.url && !last
      ? `<a href="${it.url}">${it.html}</a>`
      : `<span class="breadcrumb-current"${last ? ' aria-current="page"' : ""}>${it.html}</span>`;
  });
  return `<nav class="breadcrumb">${parts.join('<span class="breadcrumb-sep" aria-hidden="true">›</span>')}</nav>`;
}

/** Quick-glance status pills (expired, orphan, enhanced monitoring, …) */
export function statusPills(
  pills: { labelKey: string; kind?: "warn" | "muted" | "expired" }[]
): string {
  if (!pills.length) return "";
  return `<div class="status-pills">${pills
    .map((p) => `<span class="status-pill status-${p.kind || "muted"}">${label(p.labelKey)}</span>`)
    .join("")}</div>`;
}

/** Consistent entity identity header */
export function entityHeader(opts: {
  type: string;
  nameHtml: string;
  codesHtml: string;
  pillsHtml?: string;
}): string {
  return `<div class="entity-header"><div class="entity-header-top">${badge(opts.type)}${opts.pillsHtml || ""}</div>
<h1>${opts.nameHtml}</h1>
${opts.codesHtml}</div>`;
}

/** A body section of label/value info-rows (Details, Key figures, …) */
export function infoSection(titleKey: string, rows: string[]): string {
  const filtered = rows.filter(Boolean);
  if (!filtered.length) return "";
  return section(titleKey, `<dl class="info-list">${filtered.join("")}</dl>`);
}

/** Body info-row whose label is arbitrary HTML (e.g. a linked ingredient name) */
export function infoRowRaw(labelHtml: string, value: string): string {
  return `<div class="info-row"><dt>${labelHtml}</dt><dd>${value}</dd></div>`;
}

/** Sidebar link to a multi-item collection (e.g. Packages → 12). The ONLY sidebar element. */
export interface RelatedColl { labelKey: string; count: number; url: string; }

/** Sidebar: only multi-item relationship collections, one uniform link shape. */
export function sidebar(collections: RelatedColl[]): string {
  if (!collections.length) return "";
  const rows = collections
    .map((c) => `<a class="related-link" href="${c.url}"><span class="related-count">${c.count}</span><span class="related-type">${label(c.labelKey)}</span><span class="rel-item-arrow" aria-hidden="true">›</span></a>`)
    .join("");
  return `<aside class="sidebar"><div class="summary-card related-card"><h3>${label("related.title")}</h3><div class="related-group">${rows}</div></div></aside>`;
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
  options?: { description?: string }
): string {
  const desc =
    options?.description ||
    `${title} - MedSearch Belgium Medication Database`;
  return minify(`<!DOCTYPE html>
<html lang="en" data-page-title="${esc(title)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | MedSearch</title>
<meta name="description" content="${esc(desc)}">
<link rel="stylesheet" href="${hashedAsset("style.css")}">
</head>
<body>
<header class="header">
<div class="container header-inner">
<a href="/" class="logo">
<span class="logo-text">Med<span class="logo-search">Search</span></span>
</a>
<span class="header-subtitle">${label("home.subtitle")}</span>
<nav class="header-nav"></nav>
<select id="lang-select" aria-label="Language">
<option value="en">English</option>
<option value="nl">Nederlands</option>
<option value="fr">Français</option>
<option value="de">Deutsch</option>
</select>
<button id="theme-toggle" class="theme-btn" aria-label="Toggle theme">
<svg class="icon-sun" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clip-rule="evenodd"/></svg>
<svg class="icon-moon" viewBox="0 0 20 20" fill="currentColor"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/></svg>
</button>
<a href="/help/" class="theme-btn help-btn" aria-label="Help">
<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zM10 15a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg>
</a>
</div>
</header>
<main>
${content}
</main>
<footer class="footer">
<div class="container footer-inner">
<div class="footer-left"><p>${label("footer.disclaimer")}</p><a href="https://www.famhp.be/en" target="_blank" rel="noopener noreferrer" class="sam-badge" title="SAM — Belgium's official medication database by FAMHP/AFMPS"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>Official SAM Data<span id="sam-version"></span></a></div>
<p>Made with &#10084;&#65039; by <a href="https://to-ny.github.io/" target="_blank" rel="noopener noreferrer">to-ny</a></p>
</div>
</footer>
<script src="${hashedAsset("lang.js")}"></script>
</body>
</html>`);
}
