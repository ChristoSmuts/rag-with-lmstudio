import { Database } from "bun:sqlite";
import { DB_PATH } from "../src/lib/db/paths";

const table = process.argv[2];
const limit = Number(process.argv[3] ?? 10);

const db = new Database(DB_PATH, { readonly: true });

if (!table) {
  const tables = db
    .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;

  console.log(`Database: ${DB_PATH}\n`);
  for (const { name } of tables) {
    const { n } = db
      .query(`SELECT COUNT(*) as n FROM "${name}"`)
      .get() as { n: number };
    console.log(`  ${name.padEnd(16)} ${n} rows`);
  }
  console.log("\nUsage: bun scripts/inspect-db.ts <table> [limit]");
  console.log("Example: bun scripts/inspect-db.ts messages 5");
  process.exit(0);
}

const rows = db
  .query(`SELECT * FROM "${table}" LIMIT ?`)
  .all(limit) as Record<string, unknown>[];

console.log(`\n${table} (up to ${limit} rows):\n`);
console.log(JSON.stringify(rows, null, 2));
