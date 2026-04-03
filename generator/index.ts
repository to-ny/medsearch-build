import { mkdirSync, cpSync, rmSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { generateVTMPages } from "./pages/vtm";
import { generateVMPPages } from "./pages/vmp";
import { generateAMPPages } from "./pages/amp";
import { generateAMPPPages } from "./pages/ampp";
import { generateCompanyPages } from "./pages/company";
import { generateSubstancePages } from "./pages/substance";
import { generateVMPGroupPages } from "./pages/vmp-group";
import { generateATCPages } from "./pages/atc";
import { generateChapterIVPages } from "./pages/chapter-iv";
import { generateHomePage } from "./pages/home";

const DIST = join(import.meta.dir, "..", "dist");
const STATIC = join(import.meta.dir, "..", "static");

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://medsearch:REDACTED@localhost:15432/medsearch?sslmode=disable";

async function main() {
  const start = Date.now();
  console.log("MedSearch Static Site Generator");
  console.log("================================\n");

  // Clean & create dist
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  cpSync(STATIC, DIST, { recursive: true });
  console.log("Copied static assets");

  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const timeResult = await pool.query("SELECT NOW()");
    console.log(`Connected to database at ${timeResult.rows[0].now}`);

    const stats = await getStats(pool);
    console.log(`Database: ${stats.vtm} VTMs, ${stats.vmp} VMPs, ${stats.amp} AMPs, ${stats.ampp} AMPPs, ${stats.company} Companies, ${stats.substance} Substances, ${stats.vmp_group} VMP Groups, ${stats.atc} ATCs, ${stats.chapter_iv} Chapter IVs`);

    // Generate all entity pages
    await generateVTMPages(pool, DIST);
    await generateVMPPages(pool, DIST);
    await generateAMPPages(pool, DIST);
    await generateAMPPPages(pool, DIST);
    await generateCompanyPages(pool, DIST);
    await generateSubstancePages(pool, DIST);
    await generateVMPGroupPages(pool, DIST);
    await generateATCPages(pool, DIST);
    await generateChapterIVPages(pool, DIST);

    // Home page (with search)
    generateHomePage(DIST, stats);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n================================`);
    console.log(`Done in ${elapsed}s. Run 'pagefind --site dist' to build search index.`);
  } finally {
    await pool.end();
  }
}

async function getStats(pool: Pool) {
  const result = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM vtm WHERE end_date IS NULL OR end_date > CURRENT_DATE) as vtm,
      (SELECT count(*)::int FROM vmp WHERE end_date IS NULL OR end_date > CURRENT_DATE) as vmp,
      (SELECT count(*)::int FROM amp WHERE end_date IS NULL OR end_date > CURRENT_DATE) as amp,
      (SELECT count(*)::int FROM ampp WHERE end_date IS NULL OR ampp.end_date > CURRENT_DATE) as ampp,
      (SELECT count(*)::int FROM company WHERE end_date IS NULL OR end_date > CURRENT_DATE) as company,
      (SELECT count(*)::int FROM substance WHERE end_date IS NULL OR end_date > CURRENT_DATE) as substance,
      (SELECT count(*)::int FROM vmp_group WHERE end_date IS NULL OR end_date > CURRENT_DATE) as vmp_group,
      (SELECT count(*)::int FROM atc_classification) as atc,
      (SELECT count(*)::int FROM chapter_iv_paragraph WHERE end_date IS NULL OR end_date > CURRENT_DATE) as chapter_iv
  `);
  return result.rows[0];
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
