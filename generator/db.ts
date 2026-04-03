import { Database } from "bun:sqlite";

const DB_PATH = process.env.DB_PATH || "data/medsearch.sqlite";

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    _db = new Database(DB_PATH, { readonly: true });
    _db.exec("PRAGMA journal_mode = WAL");
  }
  return _db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/** Query all rows, auto-parsing JSON TEXT columns into objects */
export function queryAll(sql: string, ...params: any[]): any[] {
  const rows = getDb().prepare(sql).all(...params);
  return rows.map(parseJsonFields);
}

/** Query a single row */
export function queryOne(sql: string, ...params: any[]): any | null {
  const row = getDb().prepare(sql).get(...params);
  return row ? parseJsonFields(row) : null;
}

/** Parse JSON text fields in a row */
function parseJsonFields(row: any): any {
  for (const [key, val] of Object.entries(row)) {
    if (typeof val === "string" && val.length > 1) {
      const c = val[0];
      if (c === "{" || c === "[") {
        try {
          row[key] = JSON.parse(val);
        } catch {}
      }
    }
  }
  return row;
}
