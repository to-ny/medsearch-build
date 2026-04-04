import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { queryAll } from "../db";
import {
  layout, esc, ml, label, badge, slugify, entityUrl, localized,
  relationshipList, infoRow, summaryCard, formatDate, section,
} from "../html";

export function generateCompanyPages(dist: string) {
  console.log("\nGenerating Company pages...");
  const dir = join(dist, "companies");
  mkdirSync(dir, { recursive: true });

  const rows = queryAll(`
    SELECT c.actor_nr, c.denomination, c.legal_form, c.vat_country_code, c.vat_number,
      c.street_name, c.street_num, c.postbox, c.postcode, c.city, c.country_code,
      c.phone, c.language, c.start_date, c.end_date,
      (SELECT count(*) FROM amp WHERE company_actor_nr = c.actor_nr
        AND (end_date IS NULL OR end_date > date('now'))) as product_count,
      (SELECT COALESCE(json_group_array(json_object(
        'code', a.code, 'name', json(a.name)
      )), '[]')
      FROM amp a WHERE a.company_actor_nr = c.actor_nr
        AND (a.end_date IS NULL OR a.end_date > date('now'))
      ORDER BY json_extract(a.name, '$.en')) as products
    FROM company c WHERE c.end_date IS NULL OR c.end_date > date('now')
    ORDER BY c.denomination`);

  for (const co of rows) {
    const slug = `${slugify(co.denomination)}_${co.actor_nr}`;
    const pageDir = join(dir, slug);
    mkdirSync(pageDir, { recursive: true });
    writeFileSync(join(pageDir, "index.html"), renderCompany(co));
  }
  console.log(`  ${rows.length} Company pages`);
}

function renderCompany(c: any): string {
  const name = c.denomination;
  const address = [c.street_name, c.street_num, c.postbox].filter(Boolean).join(" ");
  const cityLine = [c.postcode, c.city].filter(Boolean).join(" ");

  const contactRows: string[] = [];
  if (address) contactRows.push(infoRow("company.address", `${esc(address)}${cityLine ? `<br>${esc(cityLine)}` : ""}${c.country_code ? `<br>${esc(c.country_code)}` : ""}`));
  if (c.phone) contactRows.push(infoRow("company.phone", esc(c.phone)));
  if (c.language) contactRows.push(infoRow("company.preferredLanguage", esc(c.language)));
  const contact = contactRows.length ? section("detail.contactInformation", `<dl class="info-list">${contactRows.join("")}</dl>`) : "";

  const legalRows: string[] = [];
  if (c.legal_form) legalRows.push(infoRow("company.legalForm", esc(c.legal_form)));
  if (c.vat_number) legalRows.push(infoRow("company.vat", `${c.vat_country_code || ""}${esc(c.vat_number)}`));
  if (c.start_date || c.end_date) legalRows.push(infoRow("detail.validity", `${formatDate(c.start_date)} — ${c.end_date ? formatDate(c.end_date) : "∞"}`));
  const legal = legalRows.length ? section("detail.legalInformation", `<dl class="info-list">${legalRows.join("")}</dl>`) : "";

  const products = relationshipList("detail.products", c.products.map((p: any) => ({
    type: "amp", url: entityUrl.amp(p.name, p.code), name: p.name,
  })));

  const sidebar = summaryCard([
    { labelKey: "detail.products", value: String(c.product_count) },
    c.country_code ? { labelKey: "company.country", value: esc(c.country_code) } : null,
    { labelKey: "detail.validity", value: c.end_date && new Date(c.end_date) < new Date() ? label("sidebar.expired") : label("sidebar.active") },
  ].filter(Boolean) as any[]);

  return layout(name, `
<div class="container page-content">
<div class="detail-grid"><div class="main-col">
<div class="entity-header" data-pagefind-body>${badge("company")}
<h1 data-pagefind-meta="title">${esc(name)}</h1>
<div class="entity-code"><span class="code-label">${label("codes.actorNr")}</span> <code>${esc(c.actor_nr)}</code></div>
</div>
${contact}${legal}${products}
</div>${sidebar}</div></div>`, { description: `${name} — Pharmaceutical company with ${c.product_count} products.` });
}
