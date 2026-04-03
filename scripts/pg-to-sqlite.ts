#!/usr/bin/env bun
/**
 * One-time utility: dump PostgreSQL data into SQLite for testing.
 * Not part of the main pipeline — just for bootstrapping.
 */
import { Database } from "bun:sqlite";
import pg from "pg";

const PG_URL = process.env.DATABASE_URL || "postgres://medsearch:REDACTED@localhost:15432/medsearch?sslmode=disable";
const DB_PATH = process.env.DB_PATH || "data/medsearch.sqlite";

const TABLES = [
  "vtm", "vmp_group", "vmp", "substance", "company",
  "pharmaceutical_form", "route_of_administration", "atc_classification",
  "amp", "amp_component", "amp_ingredient",
  "ampp", "dmpp", "reimbursement_context", "copayment",
  "chapter_iv_paragraph", "chapter_iv_verse", "dmpp_chapter_iv",
  "standard_dosage", "dosage_parameter", "dosage_parameter_bounds",
  "legal_basis", "legal_reference", "legal_text",
  "sync_metadata",
];

async function main() {
  console.log("Dumping PostgreSQL → SQLite");
  console.log(`  PG: ${PG_URL.replace(/:[^@]+@/, ":***@")}`);
  console.log(`  SQLite: ${DB_PATH}`);

  // Create SQLite database from schema
  const { mkdirSync, readFileSync } = await import("fs");
  const { dirname } = await import("path");
  mkdirSync(dirname(DB_PATH), { recursive: true });

  // Remove existing database
  try { (await import("fs")).unlinkSync(DB_PATH); } catch {}

  const sqlite = new Database(DB_PATH);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA synchronous = OFF");
  sqlite.exec("PRAGMA foreign_keys = OFF"); // Disable during import
  sqlite.exec("PRAGMA cache_size = -64000");

  // Load schema
  const schema = readFileSync("scripts/schema.sql", "utf-8");
  sqlite.exec(schema);

  // Connect to PG
  const pool = new pg.Pool({ connectionString: PG_URL });

  for (const table of TABLES) {
    try {
      // Get column info from PG
      const colResult = await pool.query(`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = $1 ORDER BY ordinal_position`, [table]);

      if (colResult.rows.length === 0) {
        console.log(`  [SKIP] ${table} (not found in PG)`);
        continue;
      }

      const pgCols = colResult.rows.map((r: any) => r.column_name);

      // Get SQLite columns
      const sqliteCols = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[])
        .map((c: any) => c.name);

      // Use intersection of columns (handle schema differences)
      const cols = pgCols.filter((c: string) => sqliteCols.includes(c));
      if (cols.length === 0) {
        console.log(`  [SKIP] ${table} (no matching columns)`);
        continue;
      }

      // Fetch all rows
      const { rows } = await pool.query(`SELECT ${cols.map((c: string) => `"${c}"`).join(", ")} FROM "${table}"`);

      if (rows.length === 0) {
        console.log(`  [SKIP] ${table} (empty)`);
        continue;
      }

      // Prepare insert
      const placeholders = cols.map(() => "?").join(", ");
      const insertSql = `INSERT OR REPLACE INTO "${table}" (${cols.map((c: string) => `"${c}"`).join(", ")}) VALUES (${placeholders})`;
      const stmt = sqlite.prepare(insertSql);

      // Batch insert in transaction
      const insert = sqlite.transaction((rows: any[]) => {
        for (const row of rows) {
          const values = cols.map((col: string) => {
            const val = row[col];
            if (val === null || val === undefined) return null;
            if (typeof val === "object") return JSON.stringify(val);
            if (typeof val === "boolean") return val ? 1 : 0;
            if (val instanceof Date) return val.toISOString().split("T")[0];
            return val;
          });
          stmt.run(...values);
        }
      });

      insert(rows);
      console.log(`  [OK] ${table}: ${rows.length} rows (${cols.length} cols)`);
    } catch (err: any) {
      console.error(`  [ERR] ${table}: ${err.message}`);
    }
  }

  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.close();
  await pool.end();

  // Show file size
  const { statSync } = await import("fs");
  const size = statSync(DB_PATH).size;
  console.log(`\nDone! SQLite database: ${(size / 1024 / 1024).toFixed(1)}MB`);
}

main().catch(console.error);
