import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { restoreBackup } from '../scripts/restore.js';

const password = 'Test-only password 2026!';
async function fixture(legacy, extraEnv={}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'welcome-tests-'));
  if (legacy) await writeFile(path.join(dir, 'visitors.json'), JSON.stringify(legacy));
  let child, base;
  async function start(dataDirectory = dir) {
    child = spawn(process.execPath, ['server.js'], { env: { ...process.env, QUEUE_NOTIFICATION_PROVIDER_URL:'', QUEUE_NOTIFICATION_PROVIDER_API_KEY:'', ...extraEnv, PORT: '0', DATA_DIR: dataDirectory }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server start timeout')), 10000);
      let errors = '';
      child.once('error', err => { clearTimeout(timer); reject(err); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${errors}`)); });
      child.stderr.on('data', data => { errors += data; });
      child.stdout.on('data', data => { const match = data.toString().match(/http:\/\/localhost:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } });
    });
  }
  async function stop() { if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); }); }
  function client() {
    let cookie = '', csrf = '';
    return {
      async send(route, method = 'GET', data, extraHeaders = {}) {
        const response = await fetch(base + route, { method, headers: { Cookie: cookie, 'X-CSRF-Token': csrf, 'X-User-Activity': '1', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders }, body: data === undefined ? undefined : JSON.stringify(data) });
        if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        const isJSON = response.headers.get('content-type')?.includes('application/json');
        const result = isJSON ? await response.json() : Buffer.from(await response.arrayBuffer());
        if (result.csrf) csrf = result.csrf;
        return { status: response.status, data: result, headers: response.headers };
      },
      async login(username) { const result = await this.send('/api/auth/login', 'POST', { username, password }); assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; },
      async setup() { const result = await this.send('/api/auth/setup', 'POST', { name: 'Admin', username: 'admin', password }); assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data; }
    };
  }
  await start();
  return { dir, start, stop, client, async close() { await stop(); await rm(dir, { recursive: true, force: true }); } };
}
async function employee(admin, name = 'Sam Host') {
  const result = await admin.send('/api/employees', 'POST', { name, department: 'Operations', email: 'sam@example.test', location: 'Main office' });
  assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data;
}
async function visitor(admin, hostId, overrides = {}) {
  const result = await admin.send('/api/visitors', 'POST', { name: 'Alex Morgan', hostId, purpose: 'Meeting', company: 'Acme', email: 'alex@example.test', phone: '+27000000000', notes: 'Private reception note', requestKey: randomUUID(), ...overrides });
  assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data;
}
async function account(admin, username, role, employeeId) {
  const result = await admin.send('/api/users', 'POST', { name: username, username, password, role, employeeId });
  assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data;
}

test('first administrator, authentication, CSRF, password changes and session revocation', async () => {
  const f = await fixture();
  try {
    const admin = f.client(), anonymous = f.client();
    assert.equal((await anonymous.send('/api/auth/session')).data.setupRequired, true);
    assert.equal((await anonymous.send('/api/visitors')).status, 401);
    assert.equal((await admin.send('/api/auth/setup', 'POST', { name: 'A', username: 'admin', password: 'short' })).status, 400);
    const setup = await admin.setup();
    assert.equal(setup.user.role, 'admin'); assert.equal(setup.user.passwordHash, undefined);
    assert.equal((await anonymous.send('/api/auth/setup', 'POST', { name: 'B', username: 'other', password })).status, 409);
    assert.equal((await admin.send('/api/employees', 'POST', { name: 'Sam' }, { 'X-CSRF-Token': 'wrong' })).status, 403);
    assert.equal((await admin.send('/api/employees', 'POST', { name: 'Sam' }, { Origin: 'https://attacker.test' })).status, 403);
    assert.equal((await admin.send('/api/users')).data[0].passwordHash, undefined);
    const second = f.client(); await second.login('admin');
    assert.equal((await admin.send('/api/auth/password', 'POST', { currentPassword: 'wrong', password: 'New test password!' })).status, 400);
    assert.equal((await admin.send('/api/auth/password', 'POST', { currentPassword: password, password: 'New test password!' })).status, 200);
    assert.equal((await second.send('/api/users')).status, 401);
    assert.equal((await admin.send('/api/auth/logout', 'POST')).status, 200);
    assert.equal((await admin.send('/api/users')).status, 401);
    assert.equal((await anonymous.send('/api/auth/login', 'POST', { username: 'admin', password })).status, 401);
    assert.equal((await anonymous.send('/api/auth/login', 'POST', { username: 'ADMIN', password: 'New test password!' })).status, 200);
    const db = new DatabaseSync(path.join(f.dir, 'visitors.sqlite'));
    try { assert.notEqual(db.prepare('SELECT passwordHash FROM users').get().passwordHash, password); db.prepare('UPDATE sessions SET lastSeen=?').run(Date.now() - 31 * 60000); } finally { db.close(); }
    assert.equal((await anonymous.send('/api/users')).status, 401);
  } finally { await f.close(); }
});

test('directory, check-in retry, corrections, stale writes, check-out and audit history', async () => {
  const f = await fixture();
  try {
    const admin = f.client(); await admin.setup(); const host = await employee(admin);
    assert.equal((await admin.send('/api/visitors', 'POST', { name: 'Invalid', hostId: 'missing', purpose: 'Meeting', requestKey: randomUUID() })).status, 400);
    const key = randomUUID(), record = await visitor(admin, host.id, { requestKey: key });
    const duplicate = await admin.send('/api/visitors', 'POST', { ...record, requestKey: key });
    assert.equal(duplicate.status, 200); assert.equal(duplicate.data.id, record.id);
    assert.equal((await admin.send('/api/visitors', 'POST', { ...record, company: 'Changed retry', requestKey: key })).status, 409);
    assert.equal((await admin.send(`/api/visitors/${record.id}`)).status, 200);
    assert.equal((await admin.send(`/api/visitors/${record.id}`, 'PUT', { ...record, company: 'Corrected' })).status, 400);
    const corrected = await admin.send(`/api/visitors/${record.id}`, 'PUT', { ...record, company: 'Corrected', reason: 'Company supplied at reception' });
    assert.equal(corrected.status, 200); assert.equal(corrected.data.version, 2);
    assert.equal((await admin.send(`/api/visitors/${record.id}`, 'PUT', { ...record, reason: 'Stale save' })).status, 409);
    assert.equal((await admin.send(`/api/visitors/${record.id}/checkout`, 'POST', { version: 1 })).status, 409);
    const checkout = await admin.send(`/api/visitors/${record.id}/checkout`, 'POST', { version: 2 });
    assert.equal(checkout.status, 200); assert.ok(checkout.data.checkedOut);
    assert.equal((await admin.send(`/api/visitors/${record.id}/checkout`, 'POST', { version: 3 })).status, 409);
    const inactive = await admin.send(`/api/employees/${host.id}`, 'PUT', { ...host, name: 'Renamed Host', active: false });
    assert.equal(inactive.status, 200);
    assert.equal((await admin.send(`/api/employees/${host.id}`, 'PUT', { ...host, active: true })).status, 409);
    assert.equal((await admin.send('/api/visitors', 'POST', { ...record, requestKey: randomUUID() })).status, 400);
    assert.equal((await admin.send(`/api/visitors/${record.id}`)).data.host, 'Sam Host');
    const events = (await admin.send('/api/audit')).data.items;
    const correction = events.find(e => e.action === 'visitor.corrected');
    assert.equal(correction.actorName, 'Admin'); assert.equal(correction.details.reason, 'Company supplied at reception'); assert.deepEqual(correction.details.fields, ['company']);
    assert.ok(events.some(e => e.action === 'visitor.checked_out'));
    assert.ok(events.some(e => e.action === 'visitor.viewed'));
    assert.equal(JSON.stringify(events).includes('Private reception note'), false);
  } finally { await f.close(); }
});

test('roles prevent cross-host access, sensitive data exposure and unauthorised management', async () => {
  const f = await fixture();
  try {
    const admin = f.client(); await admin.setup(); const own = await employee(admin), other = await employee(admin, 'Other Host');
    const ownVisit = await visitor(admin, own.id), otherVisit = await visitor(admin, other.id, { company: 'Other company' });
    const hostAccount = await account(admin, 'host.user', 'host', own.id);
    await account(admin, 'security.user', 'security'); await account(admin, 'reception.user', 'receptionist');
    const host = f.client(), security = f.client(), receptionist = f.client(); await host.login('host.user'); await security.login('security.user'); await receptionist.login('reception.user');
    const list = await host.send('/api/visitors'); assert.equal(list.data.total, 1); assert.equal(list.data.items[0].id, ownVisit.id); assert.equal(list.data.items[0].notes, undefined);
    assert.equal((await host.send(`/api/visitors/${otherVisit.id}`)).status, 404);
    assert.equal((await host.send('/api/visitor-filters')).data.company.includes('Other company'), false);
    for (const role of [host, security]) {
      assert.equal((await role.send('/api/visitors/export')).status, 403);
      assert.equal((await role.send('/api/users')).status, 403);
      assert.equal((await role.send('/api/audit')).status, 403);
      assert.equal((await role.send('/api/backups')).status, 403);
      assert.equal((await role.send('/api/employees', 'POST', { name: 'Forbidden' })).status, 403);
      assert.equal((await role.send(`/api/visitors/${ownVisit.id}`, 'PUT', { ...ownVisit, reason: 'Forbidden' })).status, 403);
    }
    const limited = (await security.send(`/api/visitors/${ownVisit.id}`)).data;
    assert.equal(limited.email, undefined); assert.equal(limited.phone, undefined); assert.equal(limited.notes, undefined);
    assert.equal((await security.send('/api/visitors?q=alex%40example.test')).data.total, 0);
    assert.equal((await host.send(`/api/visitors/${ownVisit.id}/checkout`, 'POST', { version: 1 })).status, 403);
    assert.equal((await security.send(`/api/visitors/${ownVisit.id}/checkout`, 'POST', { version: 1 })).status, 200);
    assert.equal((await receptionist.send('/api/visitors/export')).status, 200);
    assert.equal((await receptionist.send('/api/users')).status, 403);
    assert.equal((await admin.send(`/api/users/${hostAccount.id}`, 'PUT', { ...hostAccount, active: false })).status, 200);
    assert.equal((await host.send('/api/visitors')).status, 401);
    const self = (await admin.send('/api/users')).data.find(u => u.role === 'admin');
    assert.equal((await admin.send(`/api/users/${self.id}`, 'PUT', { ...self, active: false })).status, 400);
    assert.equal((await admin.send('/api/users', 'POST', { name: 'No link', username: 'unlinked', role: 'host', password })).status, 400);
  } finally { await f.close(); }
});

test('history boundaries, scoped statistics, pagination, sorting and safe filtered CSV export', async () => {
  const f = await fixture();
  try {
    const admin = f.client(); await admin.setup(); const host = await employee(admin);
    const first = await visitor(admin, host.id, { name: '=SUM(1,2)', company: 'Boundary Co' });
    const last = await visitor(admin, host.id, { name: 'Zulu', purpose: 'Delivery' });
    const db = new DatabaseSync(path.join(f.dir, 'visitors.sqlite'));
    try {
      db.prepare('UPDATE visitors SET checkedIn=?,checkedOut=? WHERE id=?').run('2026-10-07T22:00:00.000Z', '2026-10-07T23:00:00.000Z', first.id);
      db.prepare('UPDATE visitors SET checkedIn=? WHERE id=?').run('2026-10-08T22:00:00.000Z', last.id);
    } finally { db.close(); }
    const bounds = 'from=2026-10-07T22%3A00%3A00Z&to=2026-10-08T22%3A00%3A00Z';
    const filtered = await admin.send(`/api/visitors?${bounds}&company=Boundary%20Co&purpose=Meeting&department=Operations&hostId=${host.id}`);
    assert.equal(filtered.data.total, 1); assert.equal(filtered.data.items[0].id, first.id);
    assert.equal((await admin.send('/api/visitors?from=2026-10-09&to=2026-10-08')).status, 400);
    const stats = (await admin.send(`/api/stats?${bounds}`)).data; assert.equal(stats.today, 1); assert.equal(stats.departed, 1); assert.equal(Math.round(stats.average), 60);
    const csv = await admin.send(`/api/visitors/export?${bounds}`); assert.equal(csv.status, 200); assert.ok(csv.data.toString().includes("'=SUM(1,2)")); assert.equal(csv.data.toString().includes('Zulu'), false);
    for (let index = 0; index < 22; index++) await visitor(admin, host.id, { name: `Visitor ${String(index).padStart(2, '0')}` });
    const page1 = (await admin.send('/api/visitors?sort=name')).data, page2 = (await admin.send('/api/visitors?sort=name&page=2')).data;
    assert.equal(page1.total, 24); assert.equal(page1.items.length, 20); assert.equal(page2.items.length, 4);
    assert.equal(new Set([...page1.items, ...page2.items].map(v => v.id)).size, 24);
    assert.equal((await admin.send('/api/visitors?sort=SQL')).status, 400);
    assert.equal((await admin.send('/api/visitors?page=0')).status, 400);
    assert.equal((await admin.send('/api/visitors?q=%27%20OR%201%3D1')).data.total, 0);
  } finally { await f.close(); }
});

test('legacy migration, overnight overview, restart persistence and verified restore', async () => {
  const id = randomUUID(), legacy = [{ id, name: 'Legacy Visitor', host: 'Old Host', purpose: 'Meeting', company: 'Legacy Co', email: '', phone: '', notes: 'Keep this note', checkedIn: '2026-10-06T12:00:00.000Z', checkedOut: null }];
  const f = await fixture(legacy);
  try {
    const admin = f.client(); await admin.setup();
    const migrated = (await admin.send('/api/visitors')).data.items;
    assert.equal(migrated.length, 1); assert.equal(migrated[0].id, id); assert.ok(migrated[0].hostId);
    assert.deepEqual(JSON.parse(await readFile(path.join(f.dir, 'visitors.json'), 'utf8')), legacy);
    const overview = await admin.send('/api/visitors?view=dashboard&from=2026-10-08T00%3A00%3A00Z&to=2026-10-09T00%3A00%3A00Z');
    assert.equal(overview.data.total, 1);
    const backup = await admin.send('/api/backups', 'POST'); assert.equal(backup.status, 201, JSON.stringify(backup.data));
    assert.equal((await admin.send(`/api/backups/${backup.data.name}`)).status, 200);
    const backupFile = path.join(f.dir, 'backups', backup.data.name), restoredDir = path.join(f.dir, 'restored');
    assert.equal(restoreBackup(backupFile, restoredDir), restoredDir);
    assert.throws(() => restoreBackup(backupFile, restoredDir), /new directory/);
    const restored = new DatabaseSync(path.join(restoredDir, 'visitors.sqlite'));
    try { assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM visitors').get().count, 1); assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0); assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); } finally { restored.close(); }
    await f.stop(); await f.start(); await admin.login('admin');
    assert.equal((await admin.send('/api/visitors')).data.total, 1);
    assert.equal((await admin.send('/api/visitors')).data.items[0].notes, 'Keep this note');
    assert.equal((await admin.send('/data/visitors.sqlite')).status, 404);
    await f.stop(); await f.start(restoredDir); await admin.login('admin');
    assert.equal((await admin.send('/api/visitors')).data.items[0].id, id);
    assert.ok((await admin.send('/api/audit')).data.items.some(event => event.action === 'backup.restored'));
  } finally { await f.close(); }
});

test('simultaneous corrections accept one version and reject the stale update', async () => {
  const f = await fixture();
  try {
    const admin = f.client(); await admin.setup(); const host = await employee(admin), record = await visitor(admin, host.id);
    const results = await Promise.all(['First', 'Second'].map(company => admin.send(`/api/visitors/${record.id}`, 'PUT', { ...record, company, reason: 'Concurrent correction test' })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  } finally { await f.close(); }
});

test('failed login attempts are rate limited', async () => {
  const f = await fixture();
  try {
    const admin = f.client(); await admin.setup(); const attacker = f.client();
    for (let i = 0; i < 10; i++) assert.equal((await attacker.send('/api/auth/login', 'POST', { username: 'admin', password: 'wrong' })).status, 401);
    const response = await attacker.send('/api/auth/login', 'POST', { username: 'admin', password });
    assert.equal(response.status, 429); assert.ok(response.headers.get('retry-after'));
  } finally { await f.close(); }
});

test('automatic startup backups and failed transactions preserve valid records', async () => {
  const f = await fixture();
  try {
    const admin = f.client(); await admin.setup(); const host = await employee(admin);
    const db = new DatabaseSync(path.join(f.dir, 'visitors.sqlite'));
    try {
      db.exec("CREATE TRIGGER reject_test BEFORE INSERT ON audit WHEN NEW.action='visitor.checked_in' BEGIN SELECT RAISE(ABORT, 'simulated audit write failure'); END;");
      const result = await admin.send('/api/visitors', 'POST', { name: 'Rollback visitor', hostId: host.id, purpose: 'Meeting', requestKey: randomUUID() });
      assert.equal(result.status, 500);
      assert.equal((await admin.send('/api/visitors')).data.total, 0);
      db.exec('DROP TRIGGER reject_test');
    } finally { db.close(); }
    await visitor(admin, host.id, { name: 'ZoÃ« æŽ' });
    await f.stop(); await f.start(); await admin.login('admin');
    const backups = (await admin.send('/api/backups')).data;
    assert.ok(backups.length >= 1);
    assert.ok((await admin.send('/api/audit')).data.items.some(e => e.action === 'backup.created' && e.details.kind === 'automatic'));
    assert.equal((await admin.send('/api/visitors')).data.items[0].name, 'ZoÃ« æŽ');
  } finally { await f.close(); }
});

test('returning visitor profiles and pre-registered appointment lifecycle', async () => {
  const f = await fixture();
  try {
    const admin = f.client(); await admin.setup(); const host = await employee(admin);
    const first = await visitor(admin, host.id, { name: 'Returning Person', email: 'returning@example.test' });
    const profiles = await admin.send('/api/visitor-profiles?q=returning');
    assert.equal(profiles.status, 200); assert.equal(profiles.data.length, 1); assert.equal(profiles.data[0].visitCount, 1);
    const scheduledFor = new Date(Date.now() + 3600000).toISOString(), expectedEnd = new Date(Date.now() + 7200000).toISOString();
    const created = await admin.send('/api/appointments', 'POST', { profileId: profiles.data[0].id, name: 'Returning Person', company: 'Updated Company', email: 'returning@example.test', phone: '', hostId: host.id, purpose: 'Follow-up', notes: 'Expected visitor', scheduledFor, expectedEnd });
    assert.equal(created.status, 201, JSON.stringify(created.data)); assert.equal(created.data.status, 'expected');
    const expected = await admin.send(`/api/appointments?status=expected&from=${encodeURIComponent(new Date(Date.now() - 60000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}`);
    assert.equal(expected.data.length, 1); assert.equal(expected.data[0].id, created.data.id);
    const edited = await admin.send(`/api/appointments/${created.data.id}`, 'PUT', { ...created.data, purpose: 'Planning meeting', reason: 'Agenda updated' });
    assert.equal(edited.status, 200); assert.equal(edited.data.version, 2);
    assert.equal((await admin.send(`/api/appointments/${created.data.id}`, 'PUT', { ...created.data, reason: 'Stale' })).status, 409);
    const arrived = await admin.send(`/api/appointments/${created.data.id}/arrive`, 'POST', { version: 2, requestKey: randomUUID() });
    assert.equal(arrived.status, 201); assert.equal(arrived.data.appointmentId, created.data.id); assert.equal(arrived.data.profileId, first.profileId);
    assert.equal((await admin.send(`/api/appointments/${created.data.id}/arrive`, 'POST', { version: 3, requestKey: randomUUID() })).status, 409);
    const updatedProfiles = await admin.send('/api/visitor-profiles?q=returning'); assert.equal(updatedProfiles.data[0].visitCount, 2);
    const second = await admin.send('/api/appointments', 'POST', { name: 'No Show', company: '', email: 'noshow@example.test', phone: '', hostId: host.id, purpose: 'Interview', notes: '', scheduledFor, expectedEnd: '' });
    const noShow = await admin.send(`/api/appointments/${second.data.id}/no-show`, 'POST', { version: 1, reason: 'Did not arrive' });
    assert.equal(noShow.status, 200); assert.equal(noShow.data.status, 'no_show');
    const third = await admin.send('/api/appointments', 'POST', { name: 'Cancelled Person', company: '', email: '', phone: '0123456789', hostId: host.id, purpose: 'Meeting', notes: '', scheduledFor, expectedEnd: '' });
    const cancelled = await admin.send(`/api/appointments/${third.data.id}/cancel`, 'POST', { version: 1, reason: 'Visitor requested cancellation' });
    assert.equal(cancelled.status, 200); assert.equal(cancelled.data.status, 'cancelled');
    const events = (await admin.send('/api/audit')).data.items;
    assert.ok(events.some(event => event.action === 'appointment.arrived'));
    assert.ok(events.some(event => event.action === 'appointment.no_show'));
    assert.ok(events.some(event => event.action === 'appointment.cancelled'));
  } finally { await f.close(); }
});

test('badges, safety fields, live occupancy and evacuation roll call', async () => {
  const f = await fixture();
  try {
    const admin = f.client(); await admin.setup(); const hostEmployee = await employee(admin);
    await account(admin, 'safety.user', 'security'); await account(admin, 'host.safety', 'host', hostEmployee.id);
    const expectedDeparture = new Date(Date.now() + 3600000).toISOString();
    const onsite = await visitor(admin, hostEmployee.id, { category: 'Contractor', vehicle: 'ABC 123 GP', destination: 'Workshop 2', expectedDeparture, escortRequired: true, escortName: 'Jordan', inductionAccepted: true, assistanceNotes: 'Uses the accessible assembly point' });
    assert.match(onsite.badgeCode, /^V-[A-F0-9]{8}$/); assert.equal(onsite.category, 'Contractor'); assert.ok(onsite.inductionAcceptedAt);
    const roster = await admin.send('/api/safety/onsite'); assert.equal(roster.status, 200); assert.equal(roster.data[0].assistanceNotes, 'Uses the accessible assembly point');
    const emergency = await admin.send('/api/emergencies', 'POST', { name: 'Fire drill' });
    assert.equal(emergency.status, 201); assert.equal(emergency.data.visitors.length, 1); assert.equal(emergency.data.visitors[0].status, 'unaccounted');
    assert.equal((await admin.send('/api/emergencies', 'POST', { name: 'Duplicate drill' })).status, 409);
    await visitor(admin, hostEmployee.id, { name: 'Arrived after alarm' });
    const snapshot = (await admin.send('/api/emergencies')).data[0]; assert.equal(snapshot.visitors.length, 1);
    const accounted = await admin.send(`/api/emergencies/${emergency.data.id}/visitors/${onsite.id}`, 'PUT', { status: 'accounted', notes: 'At assembly point A' });
    assert.equal(accounted.status, 200); assert.equal(accounted.data.accountedBy, 'Admin');
    const closed = await admin.send(`/api/emergencies/${emergency.data.id}/close`, 'POST', { confirmUnaccounted: false }); assert.equal(closed.status, 200); assert.equal(closed.data.status, 'closed');
    assert.equal((await admin.send(`/api/emergencies/${emergency.data.id}/visitors/${onsite.id}`, 'PUT', { status: 'left', notes: '' })).status, 409);
    const host = f.client(); await host.login('host.safety'); assert.equal((await host.send('/api/safety/onsite')).status, 403); assert.equal((await host.send('/api/emergencies')).status, 403);
    const security = f.client(); await security.login('safety.user'); assert.equal((await security.send('/api/safety/onsite')).status, 200); assert.equal((await security.send('/api/emergencies')).status, 200);
    const events = (await admin.send('/api/audit')).data.items; assert.ok(events.some(event => event.action === 'emergency.started')); assert.ok(events.some(event => event.action === 'emergency.closed'));
  } finally { await f.close(); }
});

test('workspace settings, required fields, capacity configuration and retention anonymisation', async () => {
  const f = await fixture();
  try {
    const admin = f.client(); await admin.setup(); const host = await employee(admin);
    const oldVisit = await visitor(admin, host.id, { name: 'Old Personal Record', email: 'old@example.test', company: 'Old Co', notes: 'Erase me' });
    await admin.send(`/api/visitors/${oldVisit.id}/checkout`, 'POST', { version: oldVisit.version });
    const db = new DatabaseSync(path.join(f.dir, 'visitors.sqlite'));
    try { db.prepare('UPDATE visitors SET checkedIn=?,checkedOut=? WHERE id=?').run('2020-01-01T08:00:00.000Z', '2020-01-01T09:00:00.000Z', oldVisit.id); } finally { db.close(); }
    const configuration = { organisationName: 'Acme Reception', siteName: 'Johannesburg HQ', privacyNotice: 'We use these details for access and safety.', categories: ['Guest', 'Vendor'], requiredFields: ['company', 'destination'], retentionDays: 30, kioskTimeoutSeconds:60, capacityLimit: 1 };
    const saved = await admin.send('/api/settings', 'PUT', configuration); assert.equal(saved.status, 200); assert.deepEqual(saved.data.categories, ['Guest', 'Vendor']);assert.equal(saved.data.kioskTimeoutSeconds,60);
    const publicSession = await f.client().send('/api/auth/session'); assert.equal(publicSession.data.settings.organisationName, 'Acme Reception'); assert.equal(publicSession.data.settings.retentionDays, undefined);
    assert.equal((await admin.send('/api/visitors', 'POST', { name: 'Missing fields', hostId: host.id, purpose: 'Meeting', category: 'Guest', requestKey: randomUUID() })).status, 400);
    const valid = await admin.send('/api/visitors', 'POST', { name: 'Configured Guest', company: 'New Co', destination: 'Floor 2', hostId: host.id, purpose: 'Meeting', category: 'Guest', requestKey: randomUUID() }); assert.equal(valid.status, 201);
    assert.equal((await admin.send('/api/visitors', 'POST', { name: 'Bad category', company: 'X', destination: 'Y', hostId: host.id, purpose: 'Meeting', category: 'Visitor', requestKey: randomUUID() })).status, 400);
    const preview = await admin.send('/api/retention/preview'); assert.equal(preview.data.visits, 1); assert.equal(preview.data.retentionDays, 30);
    assert.equal((await admin.send('/api/retention/run', 'POST', { confirm: false })).status, 400);
    const applied = await admin.send('/api/retention/run', 'POST', { confirm: true }); assert.equal(applied.data.anonymized, 1);
    const anonymized = (await admin.send(`/api/visitors/${oldVisit.id}`)).data; assert.equal(anonymized.name, 'Anonymised visitor'); assert.equal(anonymized.email, ''); assert.equal(anonymized.notes, ''); assert.ok(anonymized.anonymizedAt);
    assert.equal((await admin.send('/api/retention/preview')).data.visits, 0);
    assert.ok((await admin.send('/api/audit')).data.items.some(event => event.action === 'retention.applied' && event.details.count === 1));
  } finally { await f.close(); }
});

test('self-service queues protect identity data and enforce the ticket lifecycle', async () => {
  const f = await fixture();
  try {
    const admin=f.client(),kiosk=f.client();await admin.setup();
    const service=await admin.send('/api/queue/services','POST',{name:'Customer service',description:'General enquiries',prefix:'CS',active:true,acceptingTickets:true,maxWaiting:2,slaMinutes:1,estimatedMinutes:10,priorityEnabled:true});
    assert.equal(service.status,201,JSON.stringify(service.data));
    const config=await kiosk.send('/api/kiosk/config');assert.equal(config.status,200);assert.equal(config.data.services[0].name,'Customer service');assert.equal(config.data.biometricAvailable,false);assert.equal(config.data.notificationAvailable,false);assert.equal(config.data.kioskTimeoutSeconds,120);
    assert.equal((await kiosk.send('/api/kiosk/biometric/verify','POST',{image:'data:image/jpeg;base64,AA==',consent:true})).status,503);
    assert.equal((await kiosk.send('/api/queue/tickets')).status,401);
    const requestKey=randomUUID(),trackingToken=randomUUID(),joined=await kiosk.send('/api/kiosk/tickets','POST',{serviceId:service.data.id,name:'Queue Visitor',phone:'0123456789',identification:'9001015009087',verificationMethod:'card',priority:true,requestKey,trackingToken});
    assert.equal(joined.status,201);assert.equal(joined.data.ticketNumber,'CS-001');assert.equal(joined.data.identificationLast4,'9087');assert.equal(joined.data.identificationHash,undefined);assert.equal(joined.data.requestKey,undefined);assert.equal(joined.data.estimatedWaitMinutes,0);
    const duplicate=await kiosk.send('/api/kiosk/tickets','POST',{serviceId:service.data.id,name:'Queue Visitor',requestKey,trackingToken});assert.equal(duplicate.data.id,joined.data.id);assert.equal(duplicate.data.trackingToken,trackingToken);
    assert.equal((await kiosk.send('/api/kiosk/tickets','POST',{serviceId:service.data.id,name:'No consent',verificationMethod:'biometric',requestKey:randomUUID()})).status,400);
    const camera=await kiosk.send('/api/kiosk/tickets','POST',{serviceId:service.data.id,name:'Camera Visitor',verificationMethod:'camera',biometricConsent:true,requestKey:randomUUID(),trackingToken:randomUUID()});assert.equal(camera.status,201);assert.equal(camera.data.estimatedWaitMinutes,10);assert.match(camera.data.consentReceiptId,/^[a-f0-9-]{36}$/);
    const receipt=await kiosk.send(`/api/kiosk/consent/${camera.data.consentReceiptId}`);assert.equal(receipt.status,200);assert.equal(receipt.data.ticketNumber,'CS-002');assert.equal(receipt.data.verificationMethod,'camera');
    assert.equal((await kiosk.send('/api/kiosk/tickets','POST',{serviceId:service.data.id,name:'Over capacity',requestKey:randomUUID(),trackingToken:randomUUID()})).status,409);
    const tracked=await kiosk.send(`/api/kiosk/tickets/${camera.data.id}/status?token=${camera.data.trackingToken}`);assert.equal(tracked.status,200);assert.equal(tracked.data.position,2);assert.equal(tracked.data.estimatedWaitMinutes,10);assert.equal((await kiosk.send(`/api/kiosk/tickets/${camera.data.id}/status?token=${randomUUID()}`)).status,404);const selfCancelled=await kiosk.send(`/api/kiosk/tickets/${camera.data.id}/status`,'POST',{token:camera.data.trackingToken});assert.equal(selfCancelled.data.status,'cancelled');assert.equal((await kiosk.send(`/api/kiosk/tickets/${camera.data.id}/status`,'POST',{token:camera.data.trackingToken})).status,409);
    const paused=await admin.send(`/api/queue/services/${service.data.id}/availability`,'POST',{version:service.data.version,acceptingTickets:false,reason:'Lunch break'});assert.equal(paused.status,200);assert.equal(paused.data.acceptingTickets,0);assert.equal((await kiosk.send('/api/kiosk/config')).data.services[0].pausedReason,'Lunch break');assert.equal((await kiosk.send('/api/kiosk/tickets','POST',{serviceId:service.data.id,name:'Paused visitor',requestKey:randomUUID(),trackingToken:randomUUID()})).status,409);const resumed=await admin.send(`/api/queue/services/${service.data.id}/availability`,'POST',{version:paused.data.version,acceptingTickets:true});assert.equal(resumed.data.acceptingTickets,1);
    const agingDb=new DatabaseSync(path.join(f.dir,'visitors.sqlite'));try{agingDb.prepare('UPDATE queue_tickets SET checkedInAt=? WHERE id=?').run(new Date(Date.now()-2*60000).toISOString(),joined.data.id);}finally{agingDb.close();}const activeTickets=await admin.send('/api/queue/tickets');assert.equal(activeTickets.data.find(item=>item.id===joined.data.id).slaBreached,1);assert.equal((await admin.send('/api/queue/stats')).data[0].breached,1);
    const called=await admin.send('/api/queue/next','POST',{serviceId:service.data.id,desk:'Desk 2'});assert.equal(called.status,200);assert.equal(called.data.status,'called');
    const display=await kiosk.send('/api/kiosk/display');assert.deepEqual(display.data[0],{ticketNumber:'CS-001',status:'called',desk:'Desk 2',service:'Customer service'});
    const started=await admin.send(`/api/queue/tickets/${joined.data.id}/start`,'POST',{version:2});assert.equal(started.data.status,'serving');
    const completed=await admin.send(`/api/queue/tickets/${joined.data.id}/complete`,'POST',{version:3});assert.equal(completed.data.status,'completed');assert.ok(completed.data.completedAt);
    assert.equal((await kiosk.send('/api/public/queue/tickets','POST',{serviceId:service.data.id,name:'Too early',phone:'0123456789',requestKey:randomUUID(),trackingToken:randomUUID()})).status,400);assert.equal((await kiosk.send('/api/public/queue/tickets','POST',{serviceId:service.data.id,name:'No phone',arrivalConfirmed:true,requestKey:randomUUID(),trackingToken:randomUUID()})).status,400);const remoteToken=randomUUID(),remote=await kiosk.send('/api/public/queue/tickets','POST',{serviceId:service.data.id,name:'Remote Visitor',phone:'0820000000',arrivalConfirmed:true,identification:'must-not-store',verificationMethod:'biometric',requestKey:randomUUID(),trackingToken:remoteToken});assert.equal(remote.status,201);assert.equal(remote.data.source,'remote');assert.equal(remote.data.verificationMethod,'manual');assert.equal(remote.data.identificationLast4,'');assert.equal((await kiosk.send(`/api/kiosk/tickets/${remote.data.id}/status?token=${remoteToken}`)).status,200);assert.equal((await admin.send('/api/queue/tickets')).data.find(item=>item.id===remote.data.id).source,'remote');
    const reportFrom=encodeURIComponent(new Date(Date.now()-86400000).toISOString()),reportTo=encodeURIComponent(new Date(Date.now()+86400000).toISOString()),report=await admin.send(`/api/queue/report?from=${reportFrom}&to=${reportTo}`);assert.equal(report.status,200);assert.equal(report.data.services[0].total,3);assert.equal(report.data.services[0].kiosk,2);assert.equal(report.data.services[0].remote,1);assert.equal(report.data.services[0].completed,1);assert.equal(report.data.services[0].cancelled,1);assert.equal(report.data.services[0].abandoned,1);assert.equal(report.data.services[0].terminal,2);assert.equal(report.data.services[0].abandonmentRate,50);assert.deepEqual(report.data.summary,{total:3,kiosk:2,remote:1,completed:1,cancelled:1,noShow:0,abandoned:1,terminal:2,abandonmentRate:50});assert.equal(report.data.daily[0].remote,1);assert.equal(report.data.daily[0].abandoned,1);assert.equal(report.data.daily[0].abandonmentRate,50);const exported=await admin.send(`/api/queue/report/export?from=${reportFrom}&to=${reportTo}`);assert.equal(exported.status,200);assert.match(exported.data.toString('utf8'),/ticketNumber,|"ticketNumber"/);assert.match(exported.data.toString('utf8'),/"source"/);assert.match(exported.data.toString('utf8'),/"remote"/);assert.match(exported.data.toString('utf8'),/"outcome"/);assert.match(exported.data.toString('utf8'),/"abandoned"/);assert.match(exported.headers.get('content-disposition'),/queue-report\.csv/);
    const db=new DatabaseSync(path.join(f.dir,'visitors.sqlite'));try{const stored=db.prepare('SELECT identificationHash FROM queue_tickets WHERE id=?').get(joined.data.id);assert.match(stored.identificationHash,/^[a-f0-9]{64}$/);assert.equal(stored.identificationHash.includes('9001015009087'),false);db.prepare('UPDATE queue_tickets SET completedAt=? WHERE id=?').run('2020-01-01T00:00:00.000Z',joined.data.id);}finally{db.close();}
    const workspace=(await admin.send('/api/settings')).data;assert.equal((await admin.send('/api/settings','PUT',{...workspace,queueRetentionDays:1})).status,200);const retained=await admin.send('/api/retention/run','POST',{confirm:true});assert.equal(retained.data.queueAnonymized,1);const archived=(await admin.send('/api/queue/tickets?status=all')).data.find(item=>item.id===joined.data.id);assert.equal(archived.name,'Anonymised queue visitor');assert.equal(archived.identificationLast4,'');
    const auditItems=(await admin.send('/api/audit')).data.items;assert.ok(auditItems.some(event=>event.action==='queue.complete'));assert.ok(auditItems.some(event=>event.action==='queue.service_paused'));assert.ok(auditItems.some(event=>event.action==='queue.service_resumed'));
  } finally { await f.close(); }
});

test('opt-in queue messages use the durable notification outbox', async () => {
  const received=[];
  const provider=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({reference:`message-${received.length}`}));});
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const port=provider.address().port,f=await fixture(undefined,{QUEUE_NOTIFICATION_PROVIDER_URL:`http://127.0.0.1:${port}/messages`});
  try{
    const admin=f.client(),kiosk=f.client();await admin.setup();
    const service=await admin.send('/api/queue/services','POST',{name:'Licensing',description:'Licence help',prefix:'LIC',active:true,estimatedMinutes:5,priorityEnabled:true});
    assert.equal((await kiosk.send('/api/kiosk/config')).data.notificationAvailable,true);
    assert.equal((await kiosk.send('/api/kiosk/tickets','POST',{serviceId:service.data.id,name:'No phone',notificationConsent:true,requestKey:randomUUID(),trackingToken:randomUUID()})).status,400);
    const joined=await kiosk.send('/api/kiosk/tickets','POST',{serviceId:service.data.id,name:'Message Visitor',phone:'+27110001111',notificationConsent:true,requestKey:randomUUID(),trackingToken:randomUUID()});assert.equal(joined.status,201);assert.ok(joined.data.notificationConsentAt);
    await admin.send('/api/queue/next','POST',{serviceId:service.data.id,desk:'Desk 7'});
    const deadline=Date.now()+3000;while(received.length<2&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(received.length,2);assert.deepEqual(received.map(item=>item.event),['joined','called']);assert.ok(received.every(item=>item.destination==='+27110001111'));assert.ok(received.every(item=>!JSON.stringify(item).includes('Message Visitor')));
    const status=await admin.send('/api/queue/notifications');assert.equal(status.data.configured,true);assert.equal(status.data.sent,2);assert.equal(status.data.failed,0);
    const db=new DatabaseSync(path.join(f.dir,'visitors.sqlite'));try{assert.equal(db.prepare('SELECT COUNT(*) count FROM queue_notifications WHERE status=?').get('sent').count,2);}finally{db.close();}
  } finally {await f.close();await new Promise(resolve=>provider.close(resolve));}
});
