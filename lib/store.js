import { DatabaseSync, backup } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function openStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const databasePath = path.join(dataDir, 'visitors.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (err) { db.exec('ROLLBACK'); throw err; }
  }
  let version = get('PRAGMA user_version').user_version;
  if (version > 10) throw new Error('Database was created by a newer application version.');
  if (version === 0) transaction(() => {
    db.exec(`
      CREATE TABLE employees (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE COLLATE NOCASE, passwordHash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','receptionist','host','security')), employeeId TEXT REFERENCES employees(id), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL);
      CREATE TABLE visitor_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', visitCount INTEGER NOT NULL DEFAULT 0, lastVisitAt TEXT, anonymizedAt TEXT, version INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
      CREATE TABLE appointments (id TEXT PRIMARY KEY, profileId TEXT REFERENCES visitor_profiles(id), name TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', hostId TEXT NOT NULL REFERENCES employees(id), host TEXT NOT NULL, department TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Visitor', vehicle TEXT NOT NULL DEFAULT '', destination TEXT NOT NULL DEFAULT '', escortRequired INTEGER NOT NULL DEFAULT 0 CHECK(escortRequired IN (0,1)), escortName TEXT NOT NULL DEFAULT '', inductionAcceptedAt TEXT, assistanceNotes TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', scheduledFor TEXT NOT NULL, expectedEnd TEXT, status TEXT NOT NULL DEFAULT 'expected' CHECK(status IN ('expected','arrived','cancelled','no_show')), visitorId TEXT REFERENCES visitors(id), version INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, CHECK(expectedEnd IS NULL OR expectedEnd >= scheduledFor));
      CREATE TABLE visitors (id TEXT PRIMARY KEY, profileId TEXT REFERENCES visitor_profiles(id), appointmentId TEXT REFERENCES appointments(id), name TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', hostId TEXT REFERENCES employees(id), host TEXT NOT NULL, department TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Visitor', vehicle TEXT NOT NULL DEFAULT '', destination TEXT NOT NULL DEFAULT '', expectedDeparture TEXT, badgeCode TEXT UNIQUE, escortRequired INTEGER NOT NULL DEFAULT 0 CHECK(escortRequired IN (0,1)), escortName TEXT NOT NULL DEFAULT '', inductionAcceptedAt TEXT, assistanceNotes TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', checkedIn TEXT NOT NULL, checkedOut TEXT, anonymizedAt TEXT, version INTEGER NOT NULL DEFAULT 1, requestKey TEXT UNIQUE, CHECK(checkedOut IS NULL OR checkedOut >= checkedIn), CHECK(expectedDeparture IS NULL OR expectedDeparture >= checkedIn));
      CREATE TABLE emergencies (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')), startedAt TEXT NOT NULL, endedAt TEXT, startedBy TEXT NOT NULL);
      CREATE TABLE emergency_visitors (emergencyId TEXT NOT NULL REFERENCES emergencies(id), visitorId TEXT NOT NULL REFERENCES visitors(id), visitorName TEXT NOT NULL, host TEXT NOT NULL, destination TEXT NOT NULL DEFAULT '', assistanceNotes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'unaccounted' CHECK(status IN ('unaccounted','accounted','left')), accountedAt TEXT, accountedBy TEXT, notes TEXT NOT NULL DEFAULT '', PRIMARY KEY(emergencyId,visitorId));
      CREATE TABLE sessions (tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, lastSeen INTEGER NOT NULL, expiresAt INTEGER NOT NULL);
      CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actorId TEXT, actorName TEXT NOT NULL, action TEXT NOT NULL, entityId TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX visitor_arrival ON visitors(checkedIn);
      CREATE INDEX visitor_host ON visitors(hostId, checkedIn);
      CREATE INDEX visitor_departure ON visitors(checkedOut);
      CREATE INDEX visitor_company ON visitors(company);
      CREATE INDEX visitor_department ON visitors(department);
      CREATE INDEX visitor_profile ON visitors(profileId, checkedIn);
      CREATE INDEX profile_email ON visitor_profiles(email COLLATE NOCASE);
      CREATE INDEX profile_phone ON visitor_profiles(phone);
      CREATE INDEX appointment_schedule ON appointments(scheduledFor, status);
      CREATE INDEX appointment_host ON appointments(hostId, scheduledFor);
      CREATE INDEX visitor_expected_departure ON visitors(expectedDeparture, checkedOut);
      CREATE INDEX emergency_status ON emergencies(status, startedAt);
      CREATE INDEX employee_name ON employees(name);
      CREATE INDEX audit_time ON audit(at);
      CREATE TABLE queue_services (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, description TEXT NOT NULL DEFAULT '', prefix TEXT NOT NULL UNIQUE COLLATE NOCASE, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), acceptingTickets INTEGER NOT NULL DEFAULT 1 CHECK(acceptingTickets IN (0,1)), pausedReason TEXT NOT NULL DEFAULT '', maxWaiting INTEGER NOT NULL DEFAULT 100 CHECK(maxWaiting BETWEEN 1 AND 10000), slaMinutes INTEGER NOT NULL DEFAULT 30 CHECK(slaMinutes BETWEEN 1 AND 1440), estimatedMinutes INTEGER NOT NULL DEFAULT 10 CHECK(estimatedMinutes BETWEEN 1 AND 480), priorityEnabled INTEGER NOT NULL DEFAULT 1 CHECK(priorityEnabled IN (0,1)), version INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
      CREATE TABLE queue_counters (serviceId TEXT NOT NULL REFERENCES queue_services(id), businessDate TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY(serviceId,businessDate));
      CREATE TABLE queue_tickets (id TEXT PRIMARY KEY, ticketNumber TEXT NOT NULL, serviceId TEXT NOT NULL REFERENCES queue_services(id), visitorId TEXT REFERENCES visitors(id), name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'kiosk' CHECK(source IN ('kiosk','remote','staff')), identificationHash TEXT, identificationLast4 TEXT NOT NULL DEFAULT '', verificationMethod TEXT NOT NULL DEFAULT 'manual' CHECK(verificationMethod IN ('manual','card','camera','biometric')), biometricConsentAt TEXT, photoConsentAt TEXT, notificationConsentAt TEXT, consentReceiptId TEXT UNIQUE, consentNoticeHash TEXT, estimatedWaitMinutes INTEGER NOT NULL DEFAULT 0, trackingTokenHash TEXT, anonymizedAt TEXT, status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','called','serving','completed','cancelled','no_show')), priority INTEGER NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 100), checkedInAt TEXT NOT NULL, calledAt TEXT, serviceStartedAt TEXT, completedAt TEXT, assignedUserId TEXT REFERENCES users(id), desk TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, requestKey TEXT UNIQUE, UNIQUE(ticketNumber,checkedInAt));
      CREATE TABLE queue_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ticketId TEXT NOT NULL REFERENCES queue_tickets(id), at TEXT NOT NULL, actorId TEXT, actorName TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE queue_notifications (id TEXT PRIMARY KEY, ticketId TEXT NOT NULL REFERENCES queue_tickets(id), event TEXT NOT NULL, destination TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')), attempts INTEGER NOT NULL DEFAULT 0, nextAttemptAt TEXT NOT NULL, providerReference TEXT NOT NULL DEFAULT '', lastError TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL, sentAt TEXT);
      CREATE INDEX queue_ticket_state ON queue_tickets(serviceId,status,priority DESC,checkedInAt);
      CREATE INDEX queue_ticket_identity ON queue_tickets(identificationHash,checkedInAt);
      CREATE INDEX queue_ticket_source ON queue_tickets(source,checkedInAt);
      CREATE INDEX queue_event_ticket ON queue_events(ticketId,at);
      CREATE INDEX queue_retention ON queue_tickets(completedAt,anonymizedAt);
      CREATE INDEX queue_tracking_token ON queue_tickets(trackingTokenHash) WHERE trackingTokenHash IS NOT NULL;
      CREATE INDEX queue_notification_delivery ON queue_notifications(status,nextAttemptAt);
      PRAGMA user_version=10;
    `);
    version = 10;
  });
  if (version === 1) transaction(() => {
    db.exec(`
      CREATE TABLE visitor_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', visitCount INTEGER NOT NULL DEFAULT 0, lastVisitAt TEXT, version INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
      ALTER TABLE visitors ADD COLUMN profileId TEXT REFERENCES visitor_profiles(id);
      ALTER TABLE visitors ADD COLUMN appointmentId TEXT;
      CREATE TABLE appointments (id TEXT PRIMARY KEY, profileId TEXT REFERENCES visitor_profiles(id), name TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', hostId TEXT NOT NULL REFERENCES employees(id), host TEXT NOT NULL, department TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', scheduledFor TEXT NOT NULL, expectedEnd TEXT, status TEXT NOT NULL DEFAULT 'expected' CHECK(status IN ('expected','arrived','cancelled','no_show')), visitorId TEXT REFERENCES visitors(id), version INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, CHECK(expectedEnd IS NULL OR expectedEnd >= scheduledFor));
      CREATE INDEX visitor_profile ON visitors(profileId, checkedIn);
      CREATE INDEX profile_email ON visitor_profiles(email COLLATE NOCASE);
      CREATE INDEX profile_phone ON visitor_profiles(phone);
      CREATE INDEX appointment_schedule ON appointments(scheduledFor, status);
      CREATE INDEX appointment_host ON appointments(hostId, scheduledFor);
      PRAGMA user_version=2;
    `);
    version = 2;
  });
  if (version === 2) transaction(() => {
    db.exec(`
      ALTER TABLE visitors ADD COLUMN category TEXT NOT NULL DEFAULT 'Visitor';
      ALTER TABLE visitors ADD COLUMN vehicle TEXT NOT NULL DEFAULT '';
      ALTER TABLE visitors ADD COLUMN destination TEXT NOT NULL DEFAULT '';
      ALTER TABLE visitors ADD COLUMN expectedDeparture TEXT;
      ALTER TABLE visitors ADD COLUMN badgeCode TEXT;
      ALTER TABLE visitors ADD COLUMN escortRequired INTEGER NOT NULL DEFAULT 0 CHECK(escortRequired IN (0,1));
      ALTER TABLE visitors ADD COLUMN escortName TEXT NOT NULL DEFAULT '';
      ALTER TABLE visitors ADD COLUMN inductionAcceptedAt TEXT;
      ALTER TABLE visitors ADD COLUMN assistanceNotes TEXT NOT NULL DEFAULT '';
      ALTER TABLE appointments ADD COLUMN category TEXT NOT NULL DEFAULT 'Visitor';
      ALTER TABLE appointments ADD COLUMN vehicle TEXT NOT NULL DEFAULT '';
      ALTER TABLE appointments ADD COLUMN destination TEXT NOT NULL DEFAULT '';
      ALTER TABLE appointments ADD COLUMN escortRequired INTEGER NOT NULL DEFAULT 0 CHECK(escortRequired IN (0,1));
      ALTER TABLE appointments ADD COLUMN escortName TEXT NOT NULL DEFAULT '';
      ALTER TABLE appointments ADD COLUMN inductionAcceptedAt TEXT;
      ALTER TABLE appointments ADD COLUMN assistanceNotes TEXT NOT NULL DEFAULT '';
      CREATE UNIQUE INDEX visitor_badge_code ON visitors(badgeCode) WHERE badgeCode IS NOT NULL;
      CREATE INDEX visitor_expected_departure ON visitors(expectedDeparture, checkedOut);
      CREATE TABLE emergencies (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')), startedAt TEXT NOT NULL, endedAt TEXT, startedBy TEXT NOT NULL);
      CREATE TABLE emergency_visitors (emergencyId TEXT NOT NULL REFERENCES emergencies(id), visitorId TEXT NOT NULL REFERENCES visitors(id), visitorName TEXT NOT NULL, host TEXT NOT NULL, destination TEXT NOT NULL DEFAULT '', assistanceNotes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'unaccounted' CHECK(status IN ('unaccounted','accounted','left')), accountedAt TEXT, accountedBy TEXT, notes TEXT NOT NULL DEFAULT '', PRIMARY KEY(emergencyId,visitorId));
      CREATE INDEX emergency_status ON emergencies(status, startedAt);
      PRAGMA user_version=3;
    `);
    version = 3;
  });
  if (version === 3) transaction(() => {
    db.exec(`
      ALTER TABLE visitors ADD COLUMN anonymizedAt TEXT;
      ALTER TABLE visitor_profiles ADD COLUMN anonymizedAt TEXT;
      PRAGMA user_version=4;
    `);
    version = 4;
  });
  if (version === 4) transaction(() => {
    db.exec(`
      CREATE TABLE queue_services (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, description TEXT NOT NULL DEFAULT '', prefix TEXT NOT NULL UNIQUE COLLATE NOCASE, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), estimatedMinutes INTEGER NOT NULL DEFAULT 10 CHECK(estimatedMinutes BETWEEN 1 AND 480), priorityEnabled INTEGER NOT NULL DEFAULT 1 CHECK(priorityEnabled IN (0,1)), version INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
      CREATE TABLE queue_counters (serviceId TEXT NOT NULL REFERENCES queue_services(id), businessDate TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY(serviceId,businessDate));
      CREATE TABLE queue_tickets (id TEXT PRIMARY KEY, ticketNumber TEXT NOT NULL, serviceId TEXT NOT NULL REFERENCES queue_services(id), visitorId TEXT REFERENCES visitors(id), name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', identificationHash TEXT, identificationLast4 TEXT NOT NULL DEFAULT '', verificationMethod TEXT NOT NULL DEFAULT 'manual' CHECK(verificationMethod IN ('manual','card','camera','biometric')), biometricConsentAt TEXT, photoConsentAt TEXT, status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','called','serving','completed','cancelled','no_show')), priority INTEGER NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 100), checkedInAt TEXT NOT NULL, calledAt TEXT, serviceStartedAt TEXT, completedAt TEXT, assignedUserId TEXT REFERENCES users(id), desk TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, requestKey TEXT UNIQUE, UNIQUE(ticketNumber,checkedInAt));
      CREATE TABLE queue_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ticketId TEXT NOT NULL REFERENCES queue_tickets(id), at TEXT NOT NULL, actorId TEXT, actorName TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}');
      CREATE INDEX queue_ticket_state ON queue_tickets(serviceId,status,priority DESC,checkedInAt);
      CREATE INDEX queue_ticket_identity ON queue_tickets(identificationHash,checkedInAt);
      CREATE INDEX queue_event_ticket ON queue_events(ticketId,at);
      PRAGMA user_version=5;
    `);
    version = 5;
  });
  if (version === 5) transaction(() => {
    db.exec(`
      ALTER TABLE queue_tickets ADD COLUMN consentReceiptId TEXT;
      ALTER TABLE queue_tickets ADD COLUMN consentNoticeHash TEXT;
      ALTER TABLE queue_tickets ADD COLUMN estimatedWaitMinutes INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE queue_tickets ADD COLUMN anonymizedAt TEXT;
      CREATE UNIQUE INDEX queue_consent_receipt ON queue_tickets(consentReceiptId) WHERE consentReceiptId IS NOT NULL;
      CREATE INDEX queue_retention ON queue_tickets(completedAt,anonymizedAt);
      PRAGMA user_version=6;
    `);
    version = 6;
  });
  if (version === 6) transaction(() => {
    db.exec(`
      ALTER TABLE queue_tickets ADD COLUMN trackingTokenHash TEXT;
      CREATE INDEX queue_tracking_token ON queue_tickets(trackingTokenHash) WHERE trackingTokenHash IS NOT NULL;
      PRAGMA user_version=7;
    `);
    version = 7;
  });
  if (version === 7) transaction(() => {
    db.exec(`
      ALTER TABLE queue_services ADD COLUMN acceptingTickets INTEGER NOT NULL DEFAULT 1 CHECK(acceptingTickets IN (0,1));
      ALTER TABLE queue_services ADD COLUMN pausedReason TEXT NOT NULL DEFAULT '';
      ALTER TABLE queue_services ADD COLUMN maxWaiting INTEGER NOT NULL DEFAULT 100 CHECK(maxWaiting BETWEEN 1 AND 10000);
      ALTER TABLE queue_services ADD COLUMN slaMinutes INTEGER NOT NULL DEFAULT 30 CHECK(slaMinutes BETWEEN 1 AND 1440);
      PRAGMA user_version=8;
    `);
    version = 8;
  });
  if (version === 8) transaction(() => {
    db.exec(`
      ALTER TABLE queue_tickets ADD COLUMN notificationConsentAt TEXT;
      CREATE TABLE queue_notifications (id TEXT PRIMARY KEY, ticketId TEXT NOT NULL REFERENCES queue_tickets(id), event TEXT NOT NULL, destination TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')), attempts INTEGER NOT NULL DEFAULT 0, nextAttemptAt TEXT NOT NULL, providerReference TEXT NOT NULL DEFAULT '', lastError TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL, sentAt TEXT);
      CREATE INDEX queue_notification_delivery ON queue_notifications(status,nextAttemptAt);
      PRAGMA user_version=9;
    `);
    version = 9;
  });
  if (version === 9) transaction(() => {
    db.exec(`
      ALTER TABLE queue_tickets ADD COLUMN source TEXT NOT NULL DEFAULT 'kiosk' CHECK(source IN ('kiosk','remote','staff'));
      CREATE INDEX queue_ticket_source ON queue_tickets(source,checkedInAt);
      PRAGMA user_version=10;
    `);
    version = 10;
  });
  function audit(actor, action, entityId = '', details = {}) {
    run('INSERT INTO audit(at,actorId,actorName,action,entityId,details) VALUES(?,?,?,?,?,?)', new Date().toISOString(), actor?.id || null, actor?.name || 'System', action, entityId, JSON.stringify(details));
  }
  const oldFile = path.join(dataDir, 'visitors.json');
  if (!get("SELECT value FROM metadata WHERE key='json-migration'")) {
    const legacy = fs.existsSync(oldFile) ? JSON.parse(fs.readFileSync(oldFile, 'utf8')) : [];
    if (!Array.isArray(legacy)) throw new Error('Legacy visitor file must contain an array. Original file has been left unchanged.');
    transaction(() => {
      for (const record of legacy) {
        if (!record || !record.id || !record.name || !record.host || !record.purpose || !Number.isFinite(Date.parse(record.checkedIn)) || (record.checkedOut && (!Number.isFinite(Date.parse(record.checkedOut)) || Date.parse(record.checkedOut) < Date.parse(record.checkedIn)))) throw new Error('Invalid legacy visitor. Migration cancelled; original JSON is unchanged.');
        let host = get('SELECT id FROM employees WHERE name=? COLLATE NOCASE', record.host);
        if (!host) { host = { id: randomUUID() }; run('INSERT INTO employees(id,name) VALUES(?,?)', host.id, record.host); }
        run('INSERT INTO visitors(id,name,company,email,phone,hostId,host,purpose,notes,checkedIn,checkedOut) VALUES(?,?,?,?,?,?,?,?,?,?,?)', record.id, record.name, record.company || '', record.email || '', record.phone || '', host.id, record.host, record.purpose, record.notes || '', new Date(record.checkedIn).toISOString(), record.checkedOut ? new Date(record.checkedOut).toISOString() : null);
      }
      run("INSERT INTO metadata(key,value) VALUES('json-migration',?)", new Date().toISOString());
      if (legacy.length) audit(null, 'data.migrated', '', { records: legacy.length, source: 'visitors.json' });
    });
  }
  if (!get("SELECT value FROM metadata WHERE key='profile-backfill'")) {
    transaction(() => {
      for (const visit of all('SELECT * FROM visitors WHERE profileId IS NULL ORDER BY checkedIn')) {
        let profile = visit.email ? get('SELECT * FROM visitor_profiles WHERE email=? COLLATE NOCASE', visit.email) : null;
        if (!profile && visit.phone) profile = get('SELECT * FROM visitor_profiles WHERE phone=?', visit.phone);
        if (!profile) {
          profile = { id: randomUUID() };
          run('INSERT INTO visitor_profiles(id,name,company,email,phone,visitCount,lastVisitAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)', profile.id, visit.name, visit.company, visit.email, visit.phone, 0, null, visit.checkedIn, visit.checkedIn);
        }
        run('UPDATE visitors SET profileId=? WHERE id=?', profile.id, visit.id);
        run('UPDATE visitor_profiles SET visitCount=visitCount+1,lastVisitAt=?,updatedAt=? WHERE id=?', visit.checkedIn, visit.checkedIn, profile.id);
      }
      run("INSERT INTO metadata(key,value) VALUES('profile-backfill',?)", new Date().toISOString());
    });
  }
  if (get('PRAGMA quick_check').quick_check !== 'ok') throw new Error('Database integrity check failed. Restore a verified backup.');
  const backupDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  let backupJob = null;
  function listBackups() {
    return fs.readdirSync(backupDir).filter(name => /^backup-[\w-]+\.sqlite$/.test(name)).map(name => { const stat = fs.statSync(path.join(backupDir, name)); return { name, bytes: stat.size, createdAt: stat.mtime.toISOString() }; }).sort((a, b) => b.name.localeCompare(a.name));
  }
  function createBackup(actor = null, kind = 'manual') {
    if (backupJob) return backupJob;
    backupJob = (async () => {
      const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.sqlite`;
      const target = path.join(backupDir, name);
      await backup(db, target + '.pending');
      const copy = new DatabaseSync(target + '.pending');
      try {
        if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity check failed');
        copy.exec('DELETE FROM sessions; PRAGMA journal_mode=DELETE;');
      } finally { copy.close(); }
      fs.renameSync(target + '.pending', target);
      audit(actor, 'backup.created', name, { kind });
      run("INSERT INTO metadata(key,value) VALUES('last-backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", new Date().toISOString());
      return listBackups().find(item => item.name === name);
    })().finally(() => { backupJob = null; });
    return backupJob;
  }
  return { db, get, all, run, transaction, audit, createBackup, listBackups, backupDir, databasePath, pendingBackup: () => backupJob };
}

