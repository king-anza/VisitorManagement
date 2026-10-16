import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const roles = ['admin', 'receptionist', 'host', 'security'];
export const hashToken = token => createHash('sha256').update(token).digest('hex');
export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw Object.assign(new Error('Use a password of 12–128 characters.'), { status: 400 });
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, expected] = stored.split(':');
  const key = await derive(password, salt, 64);
  const bytes = Buffer.from(expected, 'hex');
  return bytes.length === key.length && timingSafeEqual(key, bytes);
}
export const publicUser = user => ({ id: user.id, name: user.name, username: user.username, role: user.role, employeeId: user.employeeId, active: !!user.active, version: user.version, createdAt: user.createdAt });
export function createAuth(store) {
  const { get, run, audit } = store;
  const idleMs = 30 * 60000;
  const absoluteMs = 12 * 60 * 60000;
  const cookie = (token, expires = false) => `vms_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expires ? 0 : absoluteMs / 1000}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`;
  function session(req) {
    const token = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('vms_session='))?.slice(12);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const tokenHash = hashToken(token);
    const row = get('SELECT s.csrf,s.lastSeen,s.expiresAt,u.* FROM sessions s JOIN users u ON u.id=s.userId WHERE s.tokenHash=?', tokenHash);
    if (!row || !row.active || row.expiresAt <= Date.now() || row.lastSeen + idleMs <= Date.now()) { run('DELETE FROM sessions WHERE tokenHash=?', tokenHash); return null; }
    if (req.headers['x-user-activity'] === '1') run('UPDATE sessions SET lastSeen=? WHERE tokenHash=?', Date.now(), tokenHash);
    return { user: publicUser(row), csrf: row.csrf, tokenHash };
  }
  function login(res, user) {
    const token = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex');
    run('DELETE FROM sessions WHERE expiresAt < ? OR lastSeen < ?', Date.now(), Date.now() - idleMs);
    run('INSERT INTO sessions(tokenHash,userId,csrf,lastSeen,expiresAt) VALUES(?,?,?,?,?)', hashToken(token), user.id, csrf, Date.now(), Date.now() + absoluteMs);
    res.setHeader('Set-Cookie', cookie(token));
    audit(user, 'auth.login', user.id);
    return { user: publicUser(user), csrf };
  }
  return { session, login, cookie };
}
