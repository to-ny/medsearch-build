import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Pool } from "pg";
import {
  layout, esc, ml, label, badge, entitySlug, entityUrl, formatPrice,
  localized, infoRow, summaryCard, formatDate, section,
} from "../html";

export async function generateAMPPPages(pool: Pool, dist: string) {
  console.log("\nGenerating AMPP pages...");
  const dir = join(dist, "packages");
  mkdirSync(dir, { recursive: true });

  // Batch in chunks of 20K to manage memory
  const countResult = await pool.query(
    `SELECT count(*)::int as c FROM ampp WHERE end_date IS NULL OR end_date > CURRENT_DATE`
  );
  const total = countResult.rows[0].c;
  const CHUNK = 20000;
  let generated = 0;

  for (let offset = 0; offset < total; offset += CHUNK) {
    const { rows } = await pool.query(`
      SELECT p.cti_extended, p.amp_code, p.prescription_name, p.authorisation_nr,
        p.orphan, p.pack_display_value, p.status, p.ex_factory_price, p.atc_code,
        p.start_date, p.end_date, p.leaflet_url, p.spc_url,
        (SELECT json_build_object('code', a.code, 'name', a.name, 'companyActorNr', a.company_actor_nr,
          'companyName', (SELECT denomination FROM company WHERE actor_nr = a.company_actor_nr))
         FROM amp a WHERE a.code = p.amp_code) as amp,
        (SELECT json_build_object('code', atc.code, 'description', atc.description)
         FROM atc_classification atc WHERE atc.code = p.atc_code) as atc,
        (SELECT COALESCE(json_agg(json_build_object(
          'code', d.code, 'deliveryEnvironment', d.delivery_environment,
          'price', d.price, 'cheap', d.cheap, 'cheapest', d.cheapest, 'reimbursable', d.reimbursable
        ) ORDER BY d.delivery_environment, d.code), '[]'::json)
        FROM dmpp d WHERE d.ampp_cti_extended = p.cti_extended
          AND (d.end_date IS NULL OR d.end_date > CURRENT_DATE)) as cnk_codes,
        (SELECT COALESCE(json_agg(json_build_object(
          'chapterName', dc.chapter_name, 'paragraphName', dc.paragraph_name,
          'keyString', cp.key_string
        )), '[]'::json)
        FROM dmpp_chapter_iv dc
        JOIN chapter_iv_paragraph cp ON cp.chapter_name = dc.chapter_name AND cp.paragraph_name = dc.paragraph_name
        JOIN dmpp d ON d.code = dc.dmpp_code AND d.delivery_environment = dc.delivery_environment
        WHERE d.ampp_cti_extended = p.cti_extended
          AND (d.end_date IS NULL OR d.end_date > CURRENT_DATE)) as chapter_iv
      FROM ampp p
      WHERE p.end_date IS NULL OR p.end_date > CURRENT_DATE
      ORDER BY p.prescription_name->>'en', p.cti_extended
      LIMIT ${CHUNK} OFFSET ${offset}`);

    for (const ampp of rows) {
      const pName = ampp.prescription_name || { en: ampp.pack_display_value || ampp.cti_extended };
      const slug = entitySlug(pName, ampp.cti_extended);
      const pageDir = join(dir, slug);
      mkdirSync(pageDir, { recursive: true });
      writeFileSync(join(pageDir, "index.html"), renderAMPP(ampp));
    }
    generated += rows.length;
    process.stdout.write(`  ${generated}/${total} AMPP pages\r`);
  }
  console.log(`  ${generated} AMPP pages    `);
}

function renderAMPP(p: any): string {
  const pName = p.prescription_name || { en: p.pack_display_value || p.cti_extended };
  const name = localized(pName, "en");

  const overviewRows: string[] = [];
  if (p.pack_display_value) overviewRows.push(infoRow("detail.pack", esc(p.pack_display_value)));
  if (p.authorisation_nr) overviewRows.push(infoRow("detail.authorisationNr", esc(p.authorisation_nr)));
  if (p.orphan) overviewRows.push(infoRow("detail.orphanDrug", label("common.yes")));
  if (p.start_date || p.end_date) overviewRows.push(infoRow("detail.validity", `${formatDate(p.start_date)} — ${p.end_date ? formatDate(p.end_date) : "∞"}`));
  if (p.status) overviewRows.push(infoRow("detail.status", esc(p.status)));
  const overview = overviewRows.length ? section("detail.overview", `<dl class="info-list">${overviewRows.join("")}</dl>`) : "";

  // AMP link
  const ampLink = p.amp ? section("detail.brandInformation",
    `<a href="${entityUrl.amp(p.amp.name, p.amp.code)}" class="rel-item">${badge("amp")}<div class="rel-item-content"><span class="rel-item-name">${ml(p.amp.name)}</span>${p.amp.companyName ? `<span class="rel-item-subtitle">${esc(p.amp.companyName)}</span>` : ""}</div><span class="rel-item-arrow">›</span></a>`) : "";

  // ATC
  const atcLink = p.atc ? section("detail.atcClassification",
    `<a href="${entityUrl.atc(p.atc.code)}" class="rel-item">${badge("atc")}<div class="rel-item-content"><span class="rel-item-name">${esc(p.atc.code)} — ${esc(p.atc.description)}</span></div><span class="rel-item-arrow">›</span></a>`) : "";

  // CNK codes / pricing table
  const cnkHtml = p.cnk_codes.length > 0 ? section("detail.pricingCnkCodes",
    `<div class="rel-list">${p.cnk_codes.map((d: any) => {
      const envLabel = d.deliveryEnvironment === "H" ? "H" : "P";
      const badges = [
        d.cheapest ? '<span class="badge" style="background:#22C55E20;color:#22C55E">Cheapest</span>' : "",
        d.cheap ? '<span class="badge" style="background:#3B82F620;color:#3B82F6">Cheap</span>' : "",
        d.reimbursable ? '<span class="badge" style="background:#7C3AED20;color:#7C3AED">Reimbursable</span>' : "",
      ].filter(Boolean).join(" ");
      return `<div class="rel-item"><div class="rel-item-content"><span class="rel-item-name">CNK ${esc(d.code)} <span class="badge" style="background:var(--card-bg);color:var(--text-secondary)">${envLabel}</span></span><span class="rel-item-subtitle">${d.price != null ? formatPrice(d.price) : "—"} ${badges}</span></div></div>`;
    }).join("")}</div>`, { count: p.cnk_codes.length }) : "";

  // Chapter IV
  const chapterIVHtml = p.chapter_iv.length > 0 ? section("detail.chapterIVRequirements",
    `<div class="rel-list">${[...new Map(p.chapter_iv.map((c: any) => [`${c.chapterName}-${c.paragraphName}`, c])).values()].map((c: any) =>
      `<a href="${entityUrl.chapterIV(c.chapterName, c.paragraphName)}" class="rel-item">${badge("chapter_iv")}<div class="rel-item-content"><span class="rel-item-name">§${esc(c.paragraphName)}</span>${c.keyString ? `<span class="rel-item-subtitle">${ml(c.keyString)}</span>` : ""}</div><span class="rel-item-arrow">›</span></a>`
    ).join("")}</div>`) : "";

  // Documents
  const docs: string[] = [];
  if (p.leaflet_url) docs.push(infoRow("detail.packageLeaflet", renderDocLinks(p.leaflet_url)));
  if (p.spc_url) docs.push(infoRow("detail.smpc", renderDocLinks(p.spc_url)));
  const docsHtml = docs.length ? section("detail.documents", `<dl class="info-list">${docs.join("")}</dl>`) : "";

  const sidebar = summaryCard([
    p.amp ? { labelKey: "detail.brandInformation", value: `<a href="${entityUrl.amp(p.amp.name, p.amp.code)}">${ml(p.amp.name)}</a>`, isLink: true } : null,
    p.atc ? { labelKey: "detail.atcClassification", value: esc(p.atc.code) } : null,
    { labelKey: "detail.pricingCnkCodes", value: p.cnk_codes.length ? String(p.cnk_codes.length) : "" },
    p.ex_factory_price != null ? { labelKey: "detail.exFactoryPrice", value: formatPrice(p.ex_factory_price) } : null,
    { labelKey: "detail.validity", value: p.end_date && new Date(p.end_date) < new Date() ? label("sidebar.expired") : label("sidebar.active") },
  ].filter(Boolean) as any[]);

  return layout(name, `
<div class="container page-content">
<nav class="breadcrumbs" aria-label="Breadcrumb" data-pagefind-ignore>
<a href="/">Home</a><span class="sep">›</span><span aria-current="page">${ml(pName)}</span>
</nav>
<div class="detail-grid"><div class="main-col">
<div class="entity-header" data-pagefind-body>${badge("ampp")}
<h1 data-pagefind-meta="title">${ml(pName)}</h1>
<div class="entity-code"><span class="code-label">CTI</span> <code>${esc(p.cti_extended)}</code></div>
</div>
${overview}${ampLink}${atcLink}${cnkHtml}${chapterIVHtml}${docsHtml}
</div>${sidebar}</div></div>`, { description: `${name} — Medication package.` });
}

function renderDocLinks(urls: Record<string, string>): string {
  return Object.entries(urls)
    .filter(([, url]) => url)
    .map(([lang, url]) => `<a href="${esc(url as string)}" target="_blank" rel="noopener">${lang.toUpperCase()}</a>`)
    .join(" · ");
}
