import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlDir = path.resolve(__dirname, "../../sql");

async function runMigrations() {
  const files = (await fs.readdir(sqlDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = await fs.readFile(path.join(sqlDir, file), "utf8");
    await pool.query(sql);
    console.log(`Applied migration ${file}`);
  }

  await pool.end();
}

runMigrations().catch(async (err) => {
  console.error("Migration failed", err);
  await pool.end();
  process.exit(1);
});
