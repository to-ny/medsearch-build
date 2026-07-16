import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { queryAll } from "../db";
import {
  layout, esc, ml, label, badge, entityUrl,
  localized, infoRow, summaryCard, formatDate, section,
} from "../html";

export function generateChapterIVPages(dist: string) {
  console.log("\nGenerating Chapter IV pages...");

  // Get all active paragraphs
  const paragraphs = queryAll(`
    SELECT chapter_name, paragraph_name, key_string,
      process_type, process_type_overrule, paragraph_version,
      modification_status, start_date, end_date
    FROM chapter_iv_paragraph
    WHERE end_date IS NULL OR end_date > date('now')
    ORDER BY chapter_name, paragraph_name`);

  for (const ch of paragraphs) {
    const legalRefPath = `${ch.chapter_name}/${ch.paragraph_name}`;

    // Build verse hierarchy from legal_text (same approach as medsearch)
    const verses = queryAll(`
      WITH RECURSIVE
      text_hierarchy AS (
        SELECT key, parent_text_key, 1 as verse_level
        FROM legal_text
        WHERE legal_reference_path = ?
          AND parent_text_key IS NULL
          AND (end_date IS NULL OR end_date > date('now'))
        UNION ALL
        SELECT lt.key, lt.parent_text_key, h.verse_level + 1
        FROM legal_text lt
        JOIN text_hierarchy h ON lt.parent_text_key = h.key
        WHERE lt.legal_reference_path = ?
          AND (lt.end_date IS NULL OR lt.end_date > date('now'))
      ),
      numbered_texts AS (
        SELECT
          lt.key,
          lt.parent_text_key,
          lt.content,
          lt.sequence_nr,
          lt.start_date,
          th.verse_level,
          ROW_NUMBER() OVER (ORDER BY lt.sequence_nr, lt.key) as verse_seq
        FROM legal_text lt
        JOIN text_hierarchy th ON th.key = lt.key
        WHERE lt.legal_reference_path = ?
          AND (lt.end_date IS NULL OR lt.end_date > date('now'))
      )
      SELECT
        t.content as text,
        t.verse_seq as verseSeq,
        t.verse_seq as verseNum,
        COALESCE(p.verse_seq, 0) as verseSeqParent,
        t.verse_level as verseLevel,
        t.start_date
      FROM numbered_texts t
      LEFT JOIN numbered_texts p ON p.key = t.parent_text_key
      ORDER BY t.verse_seq`, [legalRefPath, legalRefPath, legalRefPath]);

    // Get linked products count and sample
    const linkedProducts = queryAll(`
      SELECT ampp.cti_extended, ampp.prescription_name, ampp.pack_display_value
      FROM ampp
      WHERE ampp.cti_extended IN (
        SELECT DISTINCT d.ampp_cti_extended FROM dmpp_chapter_iv dc
        JOIN dmpp d ON d.code = dc.dmpp_code AND d.delivery_environment = dc.delivery_environment
        WHERE dc.chapter_name = ? AND dc.paragraph_name = ?
          AND (d.end_date IS NULL OR d.end_date > date('now'))
      ) AND (ampp.end_date IS NULL OR ampp.end_date > date('now'))
      ORDER BY json_extract(ampp.prescription_name, '$.en')
      LIMIT 20`, [ch.chapter_name, ch.paragraph_name]);

    const countRow = queryAll(`
      SELECT count(DISTINCT d.ampp_cti_extended) as cnt
      FROM dmpp_chapter_iv dc JOIN dmpp d ON d.code = dc.dmpp_code AND d.delivery_environment = dc.delivery_environment
      WHERE dc.chapter_name = ? AND dc.paragraph_name = ?
        AND (d.end_date IS NULL OR d.end_date > date('now'))`,
      [ch.chapter_name, ch.paragraph_name]);

    const linked_products_count = countRow[0]?.cnt || 0;

    const dir = join(dist, "chapter-iv", ch.chapter_name, ch.paragraph_name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), renderChapterIV({
      ...ch,
      verses,
      linked_products: linkedProducts,
      linked_products_count,
    }));
  }
  console.log(`  ${paragraphs.length} Chapter IV pages`);
}

const PROCESS_TYPES: Record<string, string> = {
  "1": "Automatic Agreement",
  "2": "Simplified Procedure",
  "3": "Prior Authorization",
  "4": "Specific Authorization",
};

const MOD_STATUSES: Record<string, string> = { E: "Active", C: "Modified", S: "Ended" };

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
        const pName = p.prescription_name || { en: p.pack_display_value || p.cti_extended };
        return `<a href="${entityUrl.ampp(pName, p.cti_extended)}" class="rel-item">${badge("ampp")}<div class="rel-item-content"><span class="rel-item-name">${ml(pName)}</span></div><span class="rel-item-arrow">›</span></a>`;
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
<div class="detail-grid"><div class="main-col">
<div class="entity-header">${badge("chapter_iv")}
<h1>${esc(title)}</h1>
${ch.key_string ? `<p class="entity-code">${ml(ch.key_string)}</p>` : ""}
</div>
${overview}${versesHtml}${productsHtml}
</div>${sidebar}</div></div>`, { description: `${title} — ${keyStr}` });
}

function renderVerseTree(verses: any[]): string {
  return `<div class="verse-tree">${verses.map((v) => {
    const text = v.text ? localized(v.text, "en") || "" : "";
    return `<div class="verse-item" style="margin-left:${((v.verseLevel || 1) - 1) * 1}rem">${text ? ml(v.text) : ""}</div>`;
  }).join("")}</div>`;
}
