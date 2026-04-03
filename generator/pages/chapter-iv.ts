import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Pool } from "pg";
import {
  layout, esc, ml, label, badge, entityUrl,
  localized, infoRow, summaryCard, formatDate, section,
} from "../html";

export async function generateChapterIVPages(pool: Pool, dist: string) {
  console.log("\nGenerating Chapter IV pages...");

  const { rows } = await pool.query(`
    SELECT cp.chapter_name, cp.paragraph_name, cp.key_string,
      cp.process_type, cp.process_type_overrule, cp.paragraph_version,
      cp.modification_status, cp.start_date, cp.end_date,
      (SELECT COALESCE(json_agg(json_build_object(
        'verseSeq', v.verse_seq, 'verseNum', v.verse_num,
        'verseSeqParent', v.verse_seq_parent, 'verseLevel', v.verse_level,
        'text', v.text, 'requestType', v.request_type,
        'agreementTermQuantity', v.agreement_term_quantity,
        'agreementTermUnit', v.agreement_term_unit
      ) ORDER BY v.verse_seq), '[]'::json)
      FROM chapter_iv_verse v
      WHERE v.chapter_name = cp.chapter_name AND v.paragraph_name = cp.paragraph_name) as verses,
      (SELECT count(DISTINCT d.ampp_cti_extended)::int
       FROM dmpp_chapter_iv dc JOIN dmpp d ON d.code = dc.dmpp_code AND d.delivery_environment = dc.delivery_environment
       WHERE dc.chapter_name = cp.chapter_name AND dc.paragraph_name = cp.paragraph_name
         AND (d.end_date IS NULL OR d.end_date > CURRENT_DATE)) as linked_products_count,
      (SELECT COALESCE(json_agg(json_build_object(
        'ctiExtended', sub.cti_extended, 'prescriptionName', sub.prescription_name,
        'packDisplayValue', sub.pack_display_value
      )), '[]'::json)
      FROM (
        SELECT ampp.cti_extended, ampp.prescription_name, ampp.pack_display_value
        FROM ampp
        WHERE ampp.cti_extended IN (
          SELECT DISTINCT d.ampp_cti_extended FROM dmpp_chapter_iv dc
          JOIN dmpp d ON d.code = dc.dmpp_code AND d.delivery_environment = dc.delivery_environment
          WHERE dc.chapter_name = cp.chapter_name AND dc.paragraph_name = cp.paragraph_name
            AND (d.end_date IS NULL OR d.end_date > CURRENT_DATE)
        ) AND (ampp.end_date IS NULL OR ampp.end_date > CURRENT_DATE)
        ORDER BY ampp.prescription_name->>'en'
        LIMIT 20
      ) sub) as linked_products
    FROM chapter_iv_paragraph cp
    WHERE cp.end_date IS NULL OR cp.end_date > CURRENT_DATE
    ORDER BY cp.chapter_name, cp.paragraph_name`);

  for (const ch of rows) {
    const dir = join(dist, "chapter-iv", ch.chapter_name, ch.paragraph_name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), renderChapterIV(ch));
  }
  console.log(`  ${rows.length} Chapter IV pages`);
}

const PROCESS_TYPES: Record<string, string> = {
  "1": "Automatic Agreement",
  "2": "Simplified Procedure",
  "3": "Prior Authorization",
  "4": "Specific Authorization",
};

const MOD_STATUSES: Record<string, string> = { E: "Active", C: "Modified", S: "Ended" };
const TERM_UNITS: Record<string, string> = { D: "days", W: "weeks", M: "months", Y: "years" };

function renderChapterIV(ch: any): string {
  const keyStr = localized(ch.key_string, "en") || `§${ch.paragraph_name}`;
  const title = `Chapter ${ch.chapter_name} — §${ch.paragraph_name}`;

  const overviewRows: string[] = [];
  if (ch.process_type) overviewRows.push(infoRow("chapterIV.processType", esc(PROCESS_TYPES[ch.process_type] || ch.process_type)));
  if (ch.process_type_overrule) overviewRows.push(infoRow("chapterIV.processOverride", esc(PROCESS_TYPES[ch.process_type_overrule] || ch.process_type_overrule)));
  if (ch.paragraph_version) overviewRows.push(infoRow("chapterIV.version", String(ch.paragraph_version)));
  if (ch.modification_status) overviewRows.push(infoRow("chapterIV.modificationStatus", esc(MOD_STATUSES[ch.modification_status] || ch.modification_status)));
  if (ch.start_date || ch.end_date) overviewRows.push(infoRow("detail.validity", `${formatDate(ch.start_date)} — ${ch.end_date ? formatDate(ch.end_date) : "∞"}`));
  const overview = overviewRows.length ? section("detail.overview", `<dl class="info-list">${overviewRows.join("")}</dl>`) : "";

  // Verses — render as indented tree
  const versesHtml = ch.verses.length > 0
    ? section("chapterIV.requirementsConditions", renderVerseTree(ch.verses))
    : "";

  // Linked products
  const productsHtml = ch.linked_products.length > 0
    ? section("chapterIV.coveredProducts", `<div class="rel-list">${ch.linked_products.map((p: any) => {
        const pName = p.prescriptionName || { en: p.packDisplayValue || p.ctiExtended };
        return `<a href="${entityUrl.ampp(pName, p.ctiExtended)}" class="rel-item">${badge("ampp")}<div class="rel-item-content"><span class="rel-item-name">${ml(pName)}</span></div><span class="rel-item-arrow">›</span></a>`;
      }).join("")}</div>${ch.linked_products_count > 20 ? `<p class="text-muted">${ch.linked_products_count - 20} more products</p>` : ""}`,
      { count: ch.linked_products_count })
    : "";

  const sidebar = summaryCard([
    ch.process_type ? { labelKey: "chapterIV.processType", value: esc(PROCESS_TYPES[ch.process_type] || ch.process_type) } : null,
    ch.paragraph_version ? { labelKey: "chapterIV.version", value: String(ch.paragraph_version) } : null,
    { labelKey: "chapterIV.conditions", value: String(ch.verses.length) },
    { labelKey: "chapterIV.coveredProducts", value: String(ch.linked_products_count) },
    { labelKey: "detail.validity", value: ch.end_date && new Date(ch.end_date) < new Date() ? label("sidebar.expired") : label("sidebar.active") },
  ].filter(Boolean) as any[]);

  return layout(title, `
<div class="container page-content">
<nav class="breadcrumbs" aria-label="Breadcrumb" data-pagefind-ignore>
<a href="/">Home</a><span class="sep">›</span><span aria-current="page">${esc(title)}</span>
</nav>
<div class="detail-grid"><div class="main-col">
<div class="entity-header" data-pagefind-body>${badge("chapter_iv")}
<h1 data-pagefind-meta="title">${esc(title)}</h1>
${ch.key_string ? `<p class="entity-code">${ml(ch.key_string)}</p>` : ""}
</div>
${overview}${versesHtml}${productsHtml}
</div>${sidebar}</div></div>`, { description: `${title} — ${keyStr}` });
}

function renderVerseTree(verses: any[]): string {
  return `<div class="verse-tree">${verses.map((v) => {
    const text = localized(v.text, "en") || "";
    const meta: string[] = [];
    if (v.requestType === "N") meta.push('<span class="verse-tag">New</span>');
    if (v.requestType === "P") meta.push('<span class="verse-tag">Prolongation</span>');
    if (v.agreementTermQuantity && v.agreementTermUnit)
      meta.push(`<span class="verse-tag">${v.agreementTermQuantity} ${TERM_UNITS[v.agreementTermUnit] || v.agreementTermUnit}</span>`);
    return `<div class="verse-item" style="margin-left:${((v.verseLevel || 1) - 1) * 1}rem">${text ? ml(v.text) : ""}${meta.length ? `<span class="verse-meta">${meta.join("")}</span>` : ""}</div>`;
  }).join("")}</div>`;
}
