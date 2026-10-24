// Consistent copy of the database while the app is running: `node scripts/backup.mjs [dir]` (default $DATA_DIR/backups).
// Uses SQLite's VACUUM INTO, which is safe to run on a live database. Keeps the 14 newest copies.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dataDir = process.env.DATA_DIR ?? './data';
const dest = process.argv[2] ?? join(dataDir, 'backups');
const source = join(dataDir, 'leads.db');
if (!existsSync(source)) { console.error(`no database at ${source}`); process.exit(1); }
mkdirSync(dest, { recursive: true });
const file = join(dest, `leads-${new Date().toISOString().slice(0, 10)}.db`);
rmSync(file, { force: true }); // VACUUM INTO refuses to overwrite
const db = new DatabaseSync(source);
db.exec(`vacuum into '${file.replace(/'/g, "''")}'`);
db.close();
const old = readdirSync(dest).filter((f) => /^leads-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -14);
for (const f of old) rmSync(join(dest, f));
console.log(`backup written: ${file}${old.length ? ` (removed ${old.length} old)` : ''}`);
