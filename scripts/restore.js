import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function restoreBackup(source, destination) {
  const input = path.resolve(source), target = path.resolve(destination);
  if (!fs.existsSync(input) || !fs.statSync(input).isFile()) throw new Error('Backup file not found.');
  if (fs.existsSync(target)) throw new Error('Destination must be a new directory. Existing data will not be overwritten.');
  const sourceDb = new DatabaseSync(input, { readOnly: true });
  try {
    if (sourceDb.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup failed integrity verification.');
    const version = sourceDb.prepare('PRAGMA user_version').get().user_version;
    if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(version)) throw new Error('Unsupported backup schema version.');
    const tables = ['visitors', 'employees', 'users', 'sessions', 'audit', 'metadata'];
    if (version >= 2) tables.push('visitor_profiles', 'appointments');
    if (version >= 3) tables.push('emergencies', 'emergency_visitors');
    if (version >= 5) tables.push('queue_services', 'queue_counters', 'queue_tickets', 'queue_events');
    if (version >= 9) tables.push('queue_notifications');
    for (const name of tables) sourceDb.prepare(`SELECT * FROM ${name} LIMIT 0`).all();
    if (sourceDb.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup contains broken record relationships.');
    fs.mkdirSync(target, { recursive: true });
    // VACUUM INTO produces a consistent standalone file, including committed WAL data.
    sourceDb.prepare('VACUUM INTO ?').run(path.join(target, 'visitors.sqlite'));
  } finally { sourceDb.close(); }
  const restored = new DatabaseSync(path.join(target, 'visitors.sqlite'));
  try {
    restored.exec('DELETE FROM sessions;');
    restored.prepare('INSERT INTO audit(at,actorName,action,details) VALUES(?,?,?,?)').run(new Date().toISOString(), 'System', 'backup.restored', JSON.stringify({ source: path.basename(input) }));
    if (restored.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Restored database failed verification.');
  } finally { restored.close(); }
  return target;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node scripts/restore.js <backup.sqlite> <new-data-directory>');
    const target = restoreBackup(process.argv[2], process.argv[3]);
    console.log(`Verified backup restored to ${target}. Set DATA_DIR to this folder before starting the server. Sign in with an account from the backup.`);
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}

