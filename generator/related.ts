import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  layout, label, relItem, type RelItem, type RelatedColl,
} from "./html";
import { tRaw } from "./i18n";

export interface RelatedCollection {
  labelKey: string; // plural type-name for count>1 (e.g. "detail.brandProducts")
  singularKey: string; // singular type-name for count==1 (e.g. "detail.brandProduct")
  slug: string; // URL segment under the entity for the listing page
  items: RelItem[];
}

export interface RelatedResult {
  collections: RelatedColl[]; // sidebar links (N-valued relationships, any count ≥ 1)
}

interface BuildOpts {
  entityDir: string; // absolute dir holding the entity's own index.html
  entityBaseUrl: string; // e.g. "/companies/slug/" (trailing slash)
  entityName: string; // plain text, for <title> + back link
  entityNameHtml: string; // display HTML (ml()/esc())
  collections: RelatedCollection[];
}

/**
 * N-valued relationships always live in the sidebar (per the cardinality rule):
 *  - 0 items  → nothing
 *  - 1 item   → a sidebar link straight to that item (no listing page)
 *  - >1 items → a sidebar link to a dedicated static listing page (written here)
 * The sidebar row shape ("count + type →") is identical either way.
 */
export function buildRelated(opts: BuildOpts): RelatedResult {
  const collections: RelatedColl[] = [];

  for (const c of opts.collections) {
    const n = c.items ? c.items.length : 0;
    if (n === 0) continue;

    if (n === 1) {
      collections.push({ labelKey: c.singularKey, count: 1, url: c.items[0].url });
    } else {
      const dir = join(opts.entityDir, c.slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.html"), renderListing(opts, c));
      collections.push({ labelKey: c.labelKey, count: n, url: `${opts.entityBaseUrl}${c.slug}/` });
    }
  }

  return { collections };
}

/** Full-page browsable listing for one multi-item collection, with a client-side filter. */
function renderListing(opts: BuildOpts, c: RelatedCollection): string {
  const typeName = tRaw(c.labelKey, "en");
  const title = `${typeName} — ${opts.entityName}`;
  const rows = c.items.map((i) => relItem(i, { search: true })).join("");

  const content = `
<div class="container page-content listing-page">
<a class="listing-back" href="${opts.entityBaseUrl}">← ${opts.entityNameHtml}</a>
<div class="listing-head">
<h1>${label(c.labelKey)}</h1>
<p class="listing-sub">${opts.entityNameHtml}</p>
</div>
<div class="listing-filter">
<input id="list-filter" type="search" autocomplete="off" spellcheck="false" aria-label="Filter">
<span id="list-filter-count"></span>
</div>
<div class="rel-list listing-list">${rows}</div>
</div>`;

  return layout(title, content, { description: title });
}
