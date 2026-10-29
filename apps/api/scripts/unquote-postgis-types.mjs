// drizzle-kit quotes custom column types that contain parentheses, which turns
// `geography(point, 4326)` into an identifier Postgres rejects. Unquote them.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../drizzle/', import.meta.url));
const pattern = /"((?:geography|geometry)\([a-z]+, \d+\))"/g;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
  const path = join(dir, file);
  const sql = readFileSync(path, 'utf8');
  const fixed = sql.replace(pattern, '$1');
  if (fixed !== sql) {
    writeFileSync(path, fixed);
    console.log(`unquoted PostGIS types in ${file}`);
  }
}
