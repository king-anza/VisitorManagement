import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { openStore } from './lib/store.js';
import { createAuth, passwordHash, verifyPassword, publicUser, roles } from './lib/auth.js';
import { createBiometricProvider } from './lib/biometric.js';
import { createQueueNotificationProvider } from './lib/queue-notifications.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const store = openStore(process.env.DATA_DIR || path.join(root, 'data'));
const { db, get, all, run, transaction, audit } = store;
const auth = createAuth(store);
const biometricProvider=createBiometricProvider();
const notificationProvider=createQueueNotificationProvider();
const biometricVerifications=new Map();
const defaultSettings = { organisationName: 'Welcome', siteName: 'Main reception', privacyNotice: 'Your details are collected to manage this visit and site safety.', biometricNotice: 'Biometric verification is optional. You may choose manual assistance instead.', categories: ['Visitor', 'Client', 'Contractor', 'Interviewee', 'Delivery', 'Personal'], requiredFields: [], retentionDays: 365, queueRetentionDays: 90, kioskTimeoutSeconds:120, capacityLimit: 250 };
function settings() { try { return { ...defaultSettings, ...JSON.parse(get("SELECT value FROM metadata WHERE key='app-settings'")?.value || '{}') }; } catch { return { ...defaultSettings }; } }
const publicSettings = value => ({ organisationName: value.organisationName, siteName: value.siteName, privacyNotice: value.privacyNotice, categories: value.categories, requiredFields: value.requiredFields, capacityLimit: value.capacityLimit });
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const now = () => new Date().toISOString();
const allow = (user, permitted) => { if (!permitted.includes(user.role)) fail(403, 'Your role does not permit this action.'); };
const operators = ['admin', 'receptionist'];
const queueOperators = ['admin', 'receptionist', 'security'];
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function body(req, limit = 32000) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'JSON required.');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) fail(413, 'Request too large.'); chunks.push(chunk); }
  let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'Invalid JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Expected an object.');
  if (req.authorizedSession) {
    const current = auth.session(req);
    if (!current || current.user.version !== req.authorizedSession.user.version) fail(401, 'Your account changed. Sign in again.');
  }
  return data;
}
function text(input, field, required = false, max = 120) {
  if (input[field] != null && typeof input[field] !== 'string') fail(400, `Invalid ${field}.`);
  const value = (input[field] || '').trim();
  if (value.length > max || (required && !value)) fail(400, `${field} ${required && !value ? 'is required' : 'is too long'}.`);
  return value;
}
function email(input) { const value = text(input, 'email'); if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail(400, 'Enter a valid email address.'); return value; }
function version(input, record) { if (!Number.isInteger(input.version) || input.version !== record.version) fail(409, 'This record has changed. Reload it before saving.'); }
function employee(input) { return { name: text(input, 'name', true), email: email(input), phone: text(input, 'phone'), department: text(input, 'department'), location: text(input, 'location') }; }
function visitor(input, previous) {
  const hostId = text(input, 'hostId', true);
  const host = get('SELECT * FROM employees WHERE id=?', hostId);
  if (!host || (!host.active && previous?.hostId !== hostId)) fail(400, 'Select an active employee as host.');
  const sameHost = previous?.hostId === hostId;
  const category = text(input, 'category') || 'Visitor';
  const configuration = settings();
  if (!configuration.categories.includes(category)) fail(400, 'Invalid visitor category.');
  if (input.escortRequired != null && typeof input.escortRequired !== 'boolean' && ![0, 1].includes(input.escortRequired)) fail(400, 'Invalid escort requirement.');
  if (input.inductionAccepted != null && typeof input.inductionAccepted !== 'boolean') fail(400, 'Invalid induction acknowledgement.');
  const expectedDeparture = input.expectedDeparture ? iso(input.expectedDeparture, 'expected departure') : null;
  if (expectedDeparture && expectedDeparture <= (previous?.checkedIn || now())) fail(400, 'Expected departure must be after check-in.');
  const inductionAcceptedAt = input.inductionAccepted == null ? (previous?.inductionAcceptedAt || null) : input.inductionAccepted ? (previous?.inductionAcceptedAt || now()) : null;
  const escortRequired = input.escortRequired == null ? Number(previous?.escortRequired || 0) : Number(!!input.escortRequired);
  const record = { name: text(input, 'name', true), company: text(input, 'company'), email: email(input), phone: text(input, 'phone'), hostId, host: sameHost ? previous.host : host.name, department: sameHost ? previous.department : host.department, purpose: text(input, 'purpose', true), category, vehicle: text(input, 'vehicle'), destination: text(input, 'destination'), expectedDeparture, badgeCode: previous?.badgeCode || null, escortRequired, escortName: text(input, 'escortName'), inductionAcceptedAt, assistanceNotes: text(input, 'assistanceNotes', false, 500), notes: text(input, 'notes', false, 500) };
  for (const field of configuration.requiredFields) if (!record[field]) fail(400, `${field} is required by workspace settings.`);
  return record;
}
function profileFor(record, preferredId = null) {
  let profile = preferredId ? get('SELECT * FROM visitor_profiles WHERE id=?', preferredId) : null;
  if (!profile && record.email) profile = get('SELECT * FROM visitor_profiles WHERE email=? COLLATE NOCASE', record.email);
  if (!profile && record.phone) profile = get('SELECT * FROM visitor_profiles WHERE phone=?', record.phone);
  if (!profile) {
    const id = randomUUID(), at = now();
    run('INSERT INTO visitor_profiles(id,name,company,email,phone,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)', id, record.name, record.company, record.email, record.phone, at, at);
    profile = get('SELECT * FROM visitor_profiles WHERE id=?', id);
  } else {
    run('UPDATE visitor_profiles SET name=?,company=?,email=?,phone=?,version=version+1,updatedAt=? WHERE id=?', record.name, record.company, record.email, record.phone, now(), profile.id);
    profile = get('SELECT * FROM visitor_profiles WHERE id=?', profile.id);
  }
  return profile;
}
function appointment(input, previous) {
  const record = visitor(input, previous);
  const scheduledFor = iso(input.scheduledFor, 'scheduled time');
  const expectedEnd = input.expectedEnd ? iso(input.expectedEnd, 'expected end') : null;
  if (expectedEnd && expectedEnd <= scheduledFor) fail(400, 'Expected end must be after the scheduled time.');
  return { ...record, expectedDeparture: null, badgeCode: null, scheduledFor, expectedEnd };
}
const visitValues = record => [record.name, record.company, record.email, record.phone, record.hostId, record.host, record.department, record.purpose, record.category, record.vehicle, record.destination, record.expectedDeparture, record.badgeCode, record.escortRequired, record.escortName, record.inductionAcceptedAt, record.assistanceNotes, record.notes];
const appointmentValues = record => [record.name, record.company, record.email, record.phone, record.hostId, record.host, record.department, record.purpose, record.category, record.vehicle, record.destination, record.escortRequired, record.escortName, record.inductionAcceptedAt, record.assistanceNotes, record.notes, record.scheduledFor, record.expectedEnd];
function visible(record, user) {
  const { requestKey, ...result } = record;
  if (!operators.includes(user.role)) { delete result.notes; if (user.role === 'host') delete result.assistanceNotes; if (user.role === 'security') { delete result.email; delete result.phone; } }
  return result;
}
function findVisitor(id, user) { const record = get('SELECT * FROM visitors WHERE id=?', id); if (!record || (user.role === 'host' && record.hostId !== user.employeeId)) fail(404, 'Visitor not found.'); return record; }
function iso(value, label) { if (!value || !Number.isFinite(Date.parse(value))) fail(400, `Invalid ${label}.`); return new Date(value).toISOString(); }
function queryVisitors(params, user) {
  const conditions = [], args = [];
  const add = (sql, ...values) => { conditions.push(sql); args.push(...values); };
  if (user.role === 'host') add('hostId=?', user.employeeId || '');
  const q = (params.get('q') || '').trim();
  if (q.length > 120) fail(400, 'Search is too long.');
  if (q) {
    const fields = ['name', 'company', 'host', 'purpose', ...(user.role === 'security' ? [] : ['email', 'phone'])];
    add(`(${fields.map(field => `instr(lower(${field}),lower(?)) > 0`).join(' OR ')})`, ...fields.map(() => q));
  }
  const status = params.get('status') || 'all';
  if (!['all', 'inside', 'out'].includes(status)) fail(400, 'Invalid status.');
  if (status !== 'all') add(`checkedOut IS ${status === 'inside' ? '' : 'NOT '}NULL`);
  for (const field of ['hostId', 'company', 'department', 'purpose']) if (params.get(field)) add(`${field}=?`, params.get(field));
  const from = params.get('from') ? iso(params.get('from'), 'start date') : null;
  const to = params.get('to') ? iso(params.get('to'), 'end date') : null;
  if (from && to && from >= to) fail(400, 'End date must be on or after start date.');
  if (params.get('view') === 'dashboard') {
    if (!from || !to) fail(400, 'Dashboard date boundaries required.');
    add('((checkedIn >= ? AND checkedIn < ?) OR checkedOut IS NULL)', from, to);
  } else { if (from) add('checkedIn >= ?', from); if (to) add('checkedIn < ?', to); }
  const sorts = { newest: 'checkedIn DESC, id', oldest: 'checkedIn ASC, id', name: 'name COLLATE NOCASE, id', host: 'host COLLATE NOCASE, id', checkout: 'checkedOut DESC, id', duration: '(julianday(COALESCE(checkedOut,CURRENT_TIMESTAMP))-julianday(checkedIn)) DESC, id' };
  const sort = params.get('sort') || 'newest';
  if (!sorts[sort]) fail(400, 'Invalid sort order.');
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', args, order: sorts[sort] };
}
function pageNumber(params) { const page = Number(params.get('page') || 1); if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) fail(400, 'Invalid page.'); return page; }
function queueService(input) {
  const prefix = text(input, 'prefix', true, 6).toUpperCase();
  if (!/^[A-Z0-9]{1,6}$/.test(prefix)) fail(400, 'Queue prefix must contain 1Ã¢â‚¬â€œ6 letters or numbers.');
  if (!Number.isInteger(input.estimatedMinutes) || input.estimatedMinutes < 1 || input.estimatedMinutes > 480) fail(400, 'Estimated service time must be 1Ã¢â‚¬â€œ480 minutes.');
  if (typeof input.active !== 'boolean' || typeof input.priorityEnabled !== 'boolean') fail(400, 'Invalid queue service options.');
  const acceptingTickets=input.acceptingTickets===undefined?true:input.acceptingTickets;if(typeof acceptingTickets!=='boolean')fail(400,'Invalid queue availability.');
  const maxWaiting=input.maxWaiting===undefined?100:input.maxWaiting,slaMinutes=input.slaMinutes===undefined?30:input.slaMinutes;if(!Number.isInteger(maxWaiting)||maxWaiting<1||maxWaiting>10000)fail(400,'Maximum waiting capacity must be 1â€“10,000.');if(!Number.isInteger(slaMinutes)||slaMinutes<1||slaMinutes>1440)fail(400,'Service level threshold must be 1â€“1,440 minutes.');
  return { name: text(input, 'name', true), description: text(input, 'description', false, 500), prefix, active: Number(input.active), acceptingTickets:Number(acceptingTickets), pausedReason:acceptingTickets?'':text(input,'pausedReason',false,300), maxWaiting, slaMinutes, estimatedMinutes: input.estimatedMinutes, priorityEnabled: Number(input.priorityEnabled) };
}
function identity(value) { const normalized = String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase(); return normalized ? { hash: createHash('sha256').update(normalized).digest('hex'), last4: normalized.slice(-4) } : { hash: null, last4: '' }; }
function publicTicket(row) { const { identificationHash, consentNoticeHash, trackingTokenHash, notes, requestKey, ...ticket } = row; return ticket; }
function queueNotification(ticket,event,message){if(!notificationProvider.configured||!ticket.notificationConsentAt||!ticket.phone)return;const at=now();run('INSERT INTO queue_notifications(id,ticketId,event,destination,message,nextAttemptAt,createdAt) VALUES(?,?,?,?,?,?,?)',randomUUID(),ticket.id,event,ticket.phone,message.slice(0,500),at,at);}
let notificationProcessing=false;
async function processQueueNotifications(){if(notificationProcessing||!notificationProvider.configured)return;notificationProcessing=true;try{for(const item of all("SELECT * FROM queue_notifications WHERE status='pending' AND nextAttemptAt<=? ORDER BY createdAt LIMIT 10",now())){try{const result=await notificationProvider.send({channel:'sms',destination:item.destination,message:item.message,event:item.event,reference:item.ticketId});run("UPDATE queue_notifications SET status='sent',attempts=attempts+1,providerReference=?,lastError='',sentAt=? WHERE id=?",result.reference,now(),item.id);}catch(error){const attempts=item.attempts+1,failed=error?.permanent||attempts>=5,next=new Date(Date.now()+Math.min(60,2**attempts)*60000).toISOString();run('UPDATE queue_notifications SET status=?,attempts=?,nextAttemptAt=?,lastError=? WHERE id=?',failed?'failed':'pending',attempts,next,String(error?.message||'Delivery failed').slice(0,300),item.id);}}}finally{notificationProcessing=false;if(notificationProvider.configured&&get("SELECT id FROM queue_notifications WHERE status='pending' AND nextAttemptAt<=? LIMIT 1",now()))setTimeout(()=>void processQueueNotifications(),0);}}
function trackingStatus(ticket){const service=get('SELECT name,estimatedMinutes FROM queue_services WHERE id=?',ticket.serviceId);let position=0;if(ticket.status==='waiting')position=get("SELECT COUNT(*) count FROM queue_tickets WHERE serviceId=? AND status='waiting' AND (priority>? OR (priority=? AND checkedInAt<?))",ticket.serviceId,ticket.priority,ticket.priority,ticket.checkedInAt).count+1;const activeAhead=get("SELECT COUNT(*) count FROM queue_tickets WHERE serviceId=? AND status IN ('called','serving')",ticket.serviceId).count;return {id:ticket.id,ticketNumber:ticket.ticketNumber,service:service.name,status:ticket.status,desk:ticket.desk,position,estimatedWaitMinutes:ticket.status==='waiting'?Math.max(0,(position-1+activeAhead)*service.estimatedMinutes):0,checkedInAt:ticket.checkedInAt,calledAt:ticket.calledAt,completedAt:ticket.completedAt};}
function createQueueTicket(input, actor = null, source = 'kiosk') {
  if(!['kiosk','remote','staff'].includes(source))fail(400,'Invalid queue source.');
  const service = get('SELECT * FROM queue_services WHERE id=? AND active=1 AND acceptingTickets=1', text(input, 'serviceId', true)); if (!service) fail(409, 'That service is not currently accepting tickets.');
  const name = text(input, 'name', true), phone = text(input, 'phone'), method = text(input, 'verificationMethod') || 'manual';
  if(input.notificationConsent!==undefined&&typeof input.notificationConsent!=='boolean')fail(400,'Invalid notification consent.');if(input.notificationConsent===true&&!notificationProvider.configured)fail(503,'Mobile queue updates are not configured.');if(input.notificationConsent===true&&!phone)fail(400,'A mobile number is required for queue updates.');
  if (!['manual', 'card', 'camera', 'biometric'].includes(method)) fail(400, 'Invalid verification method.');
  const requestKey = text(input, 'requestKey', true); if (!/^[a-f0-9-]{36}$/.test(requestKey)) fail(400, 'Invalid queue request key.');
  const trackingToken=text(input,'trackingToken')||randomUUID();if(!/^[a-f0-9-]{36}$/.test(trackingToken))fail(400,'Invalid tracking token.');const trackingTokenHash=createHash('sha256').update(trackingToken).digest('hex');
  const existing = get('SELECT * FROM queue_tickets WHERE requestKey=?', requestKey); if (existing) {if(existing.trackingTokenHash!==trackingTokenHash)fail(409,'This queue request was already completed.');return {...publicTicket(existing),trackingToken};}
  if (['camera', 'biometric'].includes(method) && input.biometricConsent !== true) fail(400, 'Explicit biometric consent is required.');
  const identification = identity(input.identification);
  if(method==='biometric'){const token=text(input,'biometricToken',true),verification=biometricVerifications.get(token);if(!verification||verification.expiresAt<Date.now()||verification.identificationHash!==identification.hash)fail(400,'Biometric verification has expired or is invalid.');biometricVerifications.delete(token);}
  const priority = service.priorityEnabled && input.priority === true ? 10 : 0, id = randomUUID(), at = now(), businessDate = at.slice(0, 10);
  const ahead = get("SELECT COUNT(*) count FROM queue_tickets WHERE serviceId=? AND status IN ('waiting','called','serving')", service.id).count;
  const estimatedWaitMinutes = ahead * service.estimatedMinutes, consentReceiptId = ['camera','biometric'].includes(method) ? randomUUID() : null;
  const consentNoticeHash = consentReceiptId ? createHash('sha256').update(settings().biometricNotice).digest('hex') : null;
  transaction(() => {
    if(get("SELECT COUNT(*) count FROM queue_tickets WHERE serviceId=? AND status='waiting'",service.id).count>=service.maxWaiting)fail(409,'This queue is currently full. Ask reception for assistance.');
    run('INSERT INTO queue_counters(serviceId,businessDate,value) VALUES(?,?,1) ON CONFLICT(serviceId,businessDate) DO UPDATE SET value=value+1', service.id, businessDate);
    const number = get('SELECT value FROM queue_counters WHERE serviceId=? AND businessDate=?', service.id, businessDate).value, ticketNumber = `${service.prefix}-${String(number).padStart(3, '0')}`;
    run('INSERT INTO queue_tickets(id,ticketNumber,serviceId,name,phone,source,identificationHash,identificationLast4,verificationMethod,biometricConsentAt,photoConsentAt,notificationConsentAt,consentReceiptId,consentNoticeHash,estimatedWaitMinutes,trackingTokenHash,priority,checkedInAt,requestKey) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, ticketNumber, service.id, name, phone, source, identification.hash, identification.last4, method, ['camera','biometric'].includes(method) ? at : null, method === 'camera' ? at : null, input.notificationConsent===true?at:null, consentReceiptId, consentNoticeHash, estimatedWaitMinutes, trackingTokenHash, priority, at, requestKey);
    queueNotification(get('SELECT * FROM queue_tickets WHERE id=?',id),'joined',`Ticket ${ticketNumber} joined ${service.name}. Estimated wait ${estimatedWaitMinutes} minutes.`);
    run('INSERT INTO queue_events(ticketId,at,actorId,actorName,action,details) VALUES(?,?,?,?,?,?)', id, at, actor?.id || null, actor?.name || (source==='remote'?'Remote visitor':'Self-service kiosk'), 'queue.joined', JSON.stringify({ serviceId: service.id, method, priority: !!priority, source }));
    audit(actor, 'queue.joined', id, { serviceId: service.id, method, source, selfService: !actor });
  });
  return {...publicTicket(get('SELECT * FROM queue_tickets WHERE id=?', id)),trackingToken};
}
function applyRetention(actor = null, kind = 'manual') {
  const configuration = settings(), cutoff = new Date(Date.now() - configuration.retentionDays * 86400000).toISOString(), ids = all('SELECT id,profileId FROM visitors WHERE checkedOut IS NOT NULL AND checkedOut<? AND anonymizedAt IS NULL', cutoff), at = now();
  const queueCutoff = new Date(Date.now() - configuration.queueRetentionDays * 86400000).toISOString();
  const queueIds = all("SELECT id FROM queue_tickets WHERE completedAt IS NOT NULL AND completedAt<? AND anonymizedAt IS NULL", queueCutoff);
  transaction(() => {
    for (const row of ids) run("UPDATE visitors SET name='Anonymised visitor',company='',email='',phone='',vehicle='',badgeCode=NULL,escortName='',assistanceNotes='',notes='',anonymizedAt=?,version=version+1 WHERE id=?", at, row.id);
    for (const profileId of [...new Set(ids.map(row => row.profileId).filter(Boolean))]) if (!get('SELECT id FROM visitors WHERE profileId=? AND anonymizedAt IS NULL LIMIT 1', profileId)) run("UPDATE visitor_profiles SET name='Anonymised visitor',company='',email='',phone='',anonymizedAt=?,version=version+1,updatedAt=? WHERE id=?", at, at, profileId);
    for (const row of queueIds){run('DELETE FROM queue_notifications WHERE ticketId=?',row.id);run("UPDATE queue_tickets SET name='Anonymised queue visitor',phone='',identificationHash=NULL,identificationLast4='',notificationConsentAt=NULL,consentReceiptId=NULL,consentNoticeHash=NULL,trackingTokenHash=NULL,anonymizedAt=?,version=version+1 WHERE id=?", at, row.id);}
    run("INSERT INTO metadata(key,value) VALUES('last-retention-run',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", at);
    audit(actor, 'retention.applied', '', { count: ids.length, queueCount: queueIds.length, cutoff, queueCutoff, retentionDays: configuration.retentionDays, queueRetentionDays: configuration.queueRetentionDays, kind });
  });
  return { anonymized: ids.length, queueAnonymized: queueIds.length, cutoff, queueCutoff };
}
const failedLogins = new Map();
const kioskRequests = new Map();
const trackingRequests = new Map();
const remoteQueueRequests = new Map();
const dummyHash = await passwordHash('unavailable-account-dummy-password');
const angularRoot = path.join(root, 'client', 'dist', 'client', 'browser');
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('Cache-Control', 'no-store');
  try {
    const url = new URL(req.url, 'http://localhost'), route = url.pathname;
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) fail(403, 'Invalid host.');
    const write = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
    if (write && ((req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site')) fail(403, 'Untrusted origin.');
    if (req.method === 'GET' && !route.startsWith('/api/')) {
      const requested = route === '/' ? 'index.html' : route.slice(1);
      if (/^[a-zA-Z0-9._/-]+$/.test(requested) && !requested.split('/').includes('..')) {
        const file = path.resolve(angularRoot, requested);
        if (fs.existsSync(file) && fs.statSync(file).isFile()) { const type = contentTypes[path.extname(file)] || 'application/octet-stream'; res.writeHead(200, { 'Content-Type': `${type}${type.startsWith('text/') ? '; charset=utf-8' : ''}`, 'Cache-Control': requested === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable' }); return res.end(fs.readFileSync(file)); }
        if (!path.extname(requested)) { const index = path.join(angularRoot, 'index.html'); if (fs.existsSync(index)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(fs.readFileSync(index)); } }
      }
      fail(404, 'Angular application asset not found. Run npm.cmd run build.');
    }
    if (route === '/api/health' && req.method === 'GET') { get('SELECT 1'); return json(res, 200, { status: 'ok' }); }
    if (route === '/api/auth/session' && req.method === 'GET') { const session = auth.session(req); return json(res, 200, { setupRequired: !get('SELECT id FROM users LIMIT 1'), user: session?.user || null, csrf: session?.csrf || null, settings: publicSettings(settings()) }); }
    if (route === '/api/kiosk/config' && req.method === 'GET') {
      const configuration = settings(); return json(res, 200, { organisationName: configuration.organisationName, siteName: configuration.siteName, privacyNotice: configuration.privacyNotice, biometricNotice: configuration.biometricNotice, biometricAvailable:biometricProvider.configured, notificationAvailable:notificationProvider.configured, kioskTimeoutSeconds:configuration.kioskTimeoutSeconds, services: all("SELECT s.id,s.name,s.description,s.estimatedMinutes,s.priorityEnabled,s.acceptingTickets,s.pausedReason,s.maxWaiting,(SELECT COUNT(*) FROM queue_tickets q WHERE q.serviceId=s.id AND q.status='waiting') waiting FROM queue_services s WHERE s.active=1 ORDER BY s.name COLLATE NOCASE") });
    }
    if(route==='/api/kiosk/biometric/verify'&&req.method==='POST'){
      if(!biometricProvider.configured)fail(503,'Biometric verification is not configured. Use card or manual assistance.');const input=await body(req,750000);if(input.consent!==true)fail(400,'Explicit biometric consent is required.');if(typeof input.image!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(input.image)||input.image.length>700000)fail(400,'Provide a valid camera image.');const identification=identity(input.identification),result=await biometricProvider.verify({image:input.image,identificationHash:identification.hash});if(!result.verified)fail(401,'Biometric verification did not match. Use manual assistance.');const token=randomUUID();biometricVerifications.set(token,{expiresAt:Date.now()+2*60000,identificationHash:identification.hash});return json(res,200,{verified:true,token,expiresInSeconds:120});
    }
    if (route === '/api/kiosk/tickets' && req.method === 'POST') {
      const key = req.socket.remoteAddress || 'local', at = Date.now(), recent = (kioskRequests.get(key) || []).filter(value => at - value < 60000); if (recent.length >= 20) fail(429, 'Too many kiosk requests. Ask reception for assistance.'); recent.push(at); kioskRequests.set(key, recent);
      const created=createQueueTicket(await body(req),null,'kiosk');void processQueueNotifications();return json(res, 201, created);
    }
    if (route === '/api/public/queue/tickets' && req.method === 'POST') {
      const key = req.socket.remoteAddress || 'local', at = Date.now(), recent = (remoteQueueRequests.get(key) || []).filter(value => at - value < 60000); if (recent.length >= 10) fail(429, 'Too many remote queue requests. Try again shortly.'); recent.push(at); remoteQueueRequests.set(key, recent);
      const input=await body(req);if(input.arrivalConfirmed!==true)fail(400,'Confirm that you can arrive before joining remotely.');if(!text(input,'phone'))fail(400,'A mobile number is required for remote queuing.');input.verificationMethod='manual';delete input.identification;delete input.biometricToken;delete input.biometricConsent;const created=createQueueTicket(input,null,'remote');void processQueueNotifications();return json(res,201,created);
    }
    if (route === '/api/kiosk/display' && req.method === 'GET') return json(res, 200, all("SELECT q.ticketNumber,q.status,q.desk,s.name AS service FROM queue_tickets q JOIN queue_services s ON s.id=q.serviceId WHERE q.status IN ('called','serving') AND q.checkedInAt>=? ORDER BY COALESCE(q.calledAt,q.checkedInAt) DESC LIMIT 20", new Date(Date.now()-86400000).toISOString()));
    const trackingMatch=route.match(/^\/api\/kiosk\/tickets\/([a-f0-9-]{36})\/status$/);
    if(trackingMatch&&['GET','POST'].includes(req.method)){
      const key=req.socket.remoteAddress||'local',at=Date.now(),recent=(trackingRequests.get(key)||[]).filter(value=>at-value<60000);if(recent.length>=120)fail(429,'Too many tracking requests. Try again shortly.');recent.push(at);trackingRequests.set(key,recent);
      const token=req.method==='GET'?url.searchParams.get('token'):text(await body(req),'token',true),tokenHash=createHash('sha256').update(token||'').digest('hex'),ticket=get('SELECT * FROM queue_tickets WHERE id=? AND trackingTokenHash IS NOT NULL',trackingMatch[1]);
      if(!ticket||!timingSafeEqual(Buffer.from(tokenHash,'hex'),Buffer.from(ticket.trackingTokenHash,'hex')))fail(404,'Ticket not found or tracking link is invalid.');
      if(req.method==='POST'){if(ticket.status!=='waiting')fail(409,'Only a waiting ticket can be cancelled online.');const changedAt=now();transaction(()=>{run("UPDATE queue_tickets SET status='cancelled',completedAt=?,version=version+1 WHERE id=?",changedAt,ticket.id);queueNotification(ticket,'cancelled',`Ticket ${ticket.ticketNumber} was cancelled.`);run('INSERT INTO queue_events(ticketId,at,actorName,action,details) VALUES(?,?,?,?,?)',ticket.id,changedAt,'Ticket holder','queue.self_cancelled','{}');audit(null,'queue.self_cancelled',ticket.id);});void processQueueNotifications();return json(res,200,trackingStatus(get('SELECT * FROM queue_tickets WHERE id=?',ticket.id)));}
      return json(res,200,trackingStatus(ticket));
    }
    const consentMatch=route.match(/^\/api\/kiosk\/consent\/([a-f0-9-]{36})$/);
    if(consentMatch&&req.method==='GET'){const receipt=get('SELECT consentReceiptId,biometricConsentAt,verificationMethod,ticketNumber FROM queue_tickets WHERE consentReceiptId=? AND anonymizedAt IS NULL',consentMatch[1]);if(!receipt)fail(404,'Consent receipt not found or expired.');return json(res,200,receipt);}
    if (['/api/auth/setup', '/api/auth/login'].includes(route) && req.method === 'POST') {
      const input = await body(req);
      const key = req.socket.remoteAddress;
      let limit = failedLogins.get(key);
      if (!limit || limit.until < Date.now()) { limit = { count: 0, until: Date.now() + 15 * 60000 }; failedLogins.set(key, limit); }
      if (limit.count >= 10) { res.setHeader('Retry-After', Math.ceil((limit.until - Date.now()) / 1000)); fail(429, 'Too many login attempts. Try again in 15 minutes.'); }
      limit.count++;
      const username = text(input, 'username', true).toLowerCase();
      if (!/^[a-z0-9._@-]{3,120}$/.test(username)) fail(400, 'Username must have 3â€“120 letters, numbers, dots, @, underscores or hyphens.');
      if (route.endsWith('setup')) {
        if (get('SELECT id FROM users LIMIT 1')) fail(409, 'Administrator setup is already complete.');
        const name = text(input, 'name', true), hash = await passwordHash(input.password), id = randomUUID();
        transaction(() => { if (get('SELECT id FROM users LIMIT 1')) fail(409, 'Administrator setup is already complete.'); run('INSERT INTO users(id,name,username,passwordHash,role,createdAt) VALUES(?,?,?,?,?,?)', id, name, username, hash, 'admin', now()); audit({ id, name }, 'account.created', id, { role: 'admin', setup: true }); });
        failedLogins.delete(key);
        return json(res, 201, auth.login(res, get('SELECT * FROM users WHERE id=?', id)));
      }
      const user = get('SELECT * FROM users WHERE username=?', username);
      const correct = await verifyPassword(input.password, user?.passwordHash || dummyHash);
      const current = user && get('SELECT * FROM users WHERE id=?', user.id);
      if (!current?.active || !correct || current.passwordHash !== user.passwordHash) { audit(null, 'auth.failed'); fail(401, 'Invalid username or password.'); }
      failedLogins.delete(key);
      return json(res, 200, auth.login(res, current));
    }
    if (!route.startsWith('/api/')) fail(404, 'Not found.');
    const session = auth.session(req);
    if (!session) fail(401, 'Please sign in. Your session may have expired.');
    const { user } = session;
    req.authorizedSession = session;
    if (write && req.headers['x-csrf-token'] !== session.csrf) fail(403, 'Invalid session token. Refresh and try again.');
    if (route === '/api/auth/logout' && req.method === 'POST') { run('DELETE FROM sessions WHERE tokenHash=?', session.tokenHash); audit(user, 'auth.logout', user.id); res.setHeader('Set-Cookie', auth.cookie('', true)); return json(res, 200, { ok: true }); }
    if (route === '/api/auth/password' && req.method === 'POST') {
      const input = await body(req), current = get('SELECT * FROM users WHERE id=?', user.id);
      if (!await verifyPassword(input.currentPassword, current.passwordHash)) fail(400, 'Current password is incorrect.');
      const hash = await passwordHash(input.password);
      if (!auth.session(req) || get('SELECT passwordHash FROM users WHERE id=?', user.id).passwordHash !== current.passwordHash) fail(409, 'Account changed. Sign in again.');
      transaction(() => { run('UPDATE users SET passwordHash=?,version=version+1 WHERE id=?', hash, user.id); run('DELETE FROM sessions WHERE userId=?', user.id); audit(user, 'account.password_changed', user.id); });
      return json(res, 200, auth.login(res, get('SELECT * FROM users WHERE id=?', user.id)));
    }
    if (route === '/api/settings' && req.method === 'GET') { allow(user, ['admin']); return json(res, 200, settings()); }
    if (route === '/api/settings' && req.method === 'PUT') {
      allow(user, ['admin']); const input = await body(req), current = settings();
      const organisationName = text(input, 'organisationName', true), siteName = text(input, 'siteName', true), privacyNotice = text(input, 'privacyNotice', true, 1000), biometricNotice = input.biometricNotice === undefined ? current.biometricNotice : text(input, 'biometricNotice', true, 1000);
      if (!Array.isArray(input.categories) || !input.categories.length || input.categories.length > 20 || input.categories.some(value => typeof value !== 'string' || !value.trim() || value.trim().length > 40)) fail(400, 'Provide 1â€“20 categories of up to 40 characters.');
      const categories = [...new Set(input.categories.map(value => value.trim()))];
      const allowedRequired = ['company', 'email', 'phone', 'destination', 'expectedDeparture', 'vehicle'];
      if (!Array.isArray(input.requiredFields) || input.requiredFields.some(value => !allowedRequired.includes(value))) fail(400, 'Invalid required fields.');
      if (!Number.isInteger(input.retentionDays) || input.retentionDays < 30 || input.retentionDays > 3650) fail(400, 'Retention must be between 30 and 3650 days.');
      const queueRetentionDays=input.queueRetentionDays===undefined?current.queueRetentionDays:input.queueRetentionDays;if (!Number.isInteger(queueRetentionDays) || queueRetentionDays < 1 || queueRetentionDays > 3650) fail(400, 'Queue retention must be between 1 and 3650 days.');
      const kioskTimeoutSeconds=input.kioskTimeoutSeconds===undefined?current.kioskTimeoutSeconds:input.kioskTimeoutSeconds;if(!Number.isInteger(kioskTimeoutSeconds)||kioskTimeoutSeconds<30||kioskTimeoutSeconds>1800)fail(400,'Kiosk timeout must be between 30 and 1,800 seconds.');
      if (!Number.isInteger(input.capacityLimit) || input.capacityLimit < 1 || input.capacityLimit > 100000) fail(400, 'Capacity must be between 1 and 100,000.');
      const next = { organisationName, siteName, privacyNotice, biometricNotice, categories, requiredFields: [...new Set(input.requiredFields)], retentionDays: input.retentionDays, queueRetentionDays, kioskTimeoutSeconds, capacityLimit: input.capacityLimit };
      run("INSERT INTO metadata(key,value) VALUES('app-settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(next));
      audit(user, 'settings.updated', '', { fields: Object.keys(next).filter(field => JSON.stringify(next[field]) !== JSON.stringify(current[field])) });
      return json(res, 200, next);
    }
    if (route === '/api/retention/preview' && req.method === 'GET') {
      allow(user, ['admin']); const configuration = settings(), cutoff = new Date(Date.now() - configuration.retentionDays * 86400000).toISOString();
      const queueCutoff=new Date(Date.now()-configuration.queueRetentionDays*86400000).toISOString();
      return json(res, 200, { retentionDays: configuration.retentionDays, queueRetentionDays:configuration.queueRetentionDays, cutoff, queueCutoff, visits: get('SELECT COUNT(*) AS count FROM visitors WHERE checkedOut IS NOT NULL AND checkedOut<? AND anonymizedAt IS NULL', cutoff).count, queueTickets:get("SELECT COUNT(*) count FROM queue_tickets WHERE completedAt IS NOT NULL AND completedAt<? AND anonymizedAt IS NULL",queueCutoff).count });
    }
    if (route === '/api/retention/run' && req.method === 'POST') {
      allow(user, ['admin']); const input = await body(req); if (input.confirm !== true) fail(400, 'Explicit confirmation is required.');
      return json(res, 200, applyRetention(user));
    }
    if (route === '/api/queue/services' && req.method === 'GET') { allow(user, queueOperators); return json(res, 200, all('SELECT * FROM queue_services ORDER BY active DESC,name COLLATE NOCASE')); }
    if (route === '/api/queue/services' && req.method === 'POST') {
      allow(user, ['admin']); const record = queueService(await body(req)), id = randomUUID(), at = now();
      transaction(() => { run('INSERT INTO queue_services(id,name,description,prefix,active,acceptingTickets,pausedReason,maxWaiting,slaMinutes,estimatedMinutes,priorityEnabled,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', id, ...Object.values(record), at, at); audit(user, 'queue.service_created', id); });
      return json(res, 201, get('SELECT * FROM queue_services WHERE id=?', id));
    }
    const availabilityMatch=route.match(/^\/api\/queue\/services\/([a-f0-9-]+)\/availability$/);
    if(availabilityMatch&&req.method==='POST'){allow(user,queueOperators);const input=await body(req),service=get('SELECT * FROM queue_services WHERE id=?',availabilityMatch[1]);if(!service)fail(404,'Queue service not found.');version(input,service);if(typeof input.acceptingTickets!=='boolean')fail(400,'Invalid queue availability.');const reason=input.acceptingTickets?'':text(input,'reason',true,300),at=now();transaction(()=>{run('UPDATE queue_services SET acceptingTickets=?,pausedReason=?,version=version+1,updatedAt=? WHERE id=?',Number(input.acceptingTickets),reason,at,service.id);audit(user,input.acceptingTickets?'queue.service_resumed':'queue.service_paused',service.id,{reason});});return json(res,200,get('SELECT * FROM queue_services WHERE id=?',service.id));}
    const queueServiceMatch = route.match(/^\/api\/queue\/services\/([a-f0-9-]+)$/);
    if (queueServiceMatch && req.method === 'PUT') {
      allow(user, ['admin']); const input = await body(req), previous = get('SELECT * FROM queue_services WHERE id=?', queueServiceMatch[1]); if (!previous) fail(404, 'Queue service not found.'); version(input, previous); const record = queueService(input);
      transaction(() => { run('UPDATE queue_services SET name=?,description=?,prefix=?,active=?,acceptingTickets=?,pausedReason=?,maxWaiting=?,slaMinutes=?,estimatedMinutes=?,priorityEnabled=?,version=version+1,updatedAt=? WHERE id=?', ...Object.values(record), now(), previous.id); audit(user, 'queue.service_updated', previous.id); });
      return json(res, 200, get('SELECT * FROM queue_services WHERE id=?', previous.id));
    }
    if (route === '/api/queue/tickets' && req.method === 'GET') {
      allow(user, queueOperators); const status = url.searchParams.get('status') || 'active'; if (!['active','waiting','called','serving','completed','cancelled','no_show','all'].includes(status)) fail(400, 'Invalid queue status.');
      const where = status === 'active' ? "WHERE q.status IN ('waiting','called','serving')" : status === 'all' ? '' : 'WHERE q.status=?', args = ['active','all'].includes(status) ? [] : [status];
      return json(res, 200, all(`SELECT q.*,s.name AS serviceName,s.estimatedMinutes,CASE WHEN q.status='waiting' AND (julianday('now')-julianday(q.checkedInAt))*1440>s.slaMinutes THEN 1 ELSE 0 END slaBreached FROM queue_tickets q JOIN queue_services s ON s.id=q.serviceId ${where} ORDER BY CASE q.status WHEN 'serving' THEN 0 WHEN 'called' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END,q.priority DESC,q.checkedInAt`, ...args).map(publicTicket));
    }
    if (route === '/api/queue/tickets' && req.method === 'POST') { allow(user, queueOperators);const created=createQueueTicket(await body(req), user);void processQueueNotifications();return json(res, 201, created); }
    if (route === '/api/queue/next' && req.method === 'POST') {
      allow(user, queueOperators); const input = await body(req), serviceId = text(input, 'serviceId', true), desk = text(input, 'desk', true), calledAt = now(); let selected;
      transaction(() => { selected = get("SELECT * FROM queue_tickets WHERE serviceId=? AND status='waiting' ORDER BY priority DESC,checkedInAt LIMIT 1", serviceId); if (!selected) fail(404, 'No visitors are waiting for this service.'); run("UPDATE queue_tickets SET status='called',calledAt=?,assignedUserId=?,desk=?,version=version+1 WHERE id=?", calledAt, user.id, desk, selected.id);queueNotification(selected,'called',`Ticket ${selected.ticketNumber}, please proceed to ${desk}.`); run('INSERT INTO queue_events(ticketId,at,actorId,actorName,action,details) VALUES(?,?,?,?,?,?)', selected.id, calledAt, user.id, user.name, 'queue.called', JSON.stringify({ desk })); audit(user, 'queue.called', selected.id, { desk }); });
      void processQueueNotifications();return json(res, 200, publicTicket(get('SELECT q.*,s.name AS serviceName FROM queue_tickets q JOIN queue_services s ON s.id=q.serviceId WHERE q.id=?', selected.id)));
    }
    const queueTicketMatch = route.match(/^\/api\/queue\/tickets\/([a-f0-9-]+)\/(start|complete|cancel|no-show|recall|transfer)$/);
    if (queueTicketMatch && req.method === 'POST') {
      allow(user, queueOperators); const input = await body(req), ticket = get('SELECT * FROM queue_tickets WHERE id=?', queueTicketMatch[1]); if (!ticket) fail(404, 'Queue ticket not found.'); version(input, ticket); const action = queueTicketMatch[2], at = now(); let status=ticket.status, serviceId=ticket.serviceId, desk=ticket.desk;
      if (action==='start' && ticket.status==='called') status='serving'; else if (action==='complete' && ticket.status==='serving') status='completed'; else if (action==='cancel' && ['waiting','called'].includes(ticket.status)) status='cancelled'; else if (action==='no-show' && ticket.status==='called') status='no_show'; else if (action==='recall' && ticket.status==='called') status='called'; else if (action==='transfer' && ['called','serving'].includes(ticket.status)) { const target=get('SELECT id FROM queue_services WHERE id=? AND active=1',text(input,'serviceId',true));if(!target)fail(400,'Select an available destination service.');serviceId=target.id;status='waiting';desk=''; } else fail(409, 'That queue transition is not allowed.');
      transaction(() => { run('UPDATE queue_tickets SET serviceId=?,status=?,desk=?,calledAt=?,serviceStartedAt=?,completedAt=?,assignedUserId=?,version=version+1 WHERE id=?', serviceId,status,desk,status==='waiting'?null:ticket.calledAt,status==='serving'?(ticket.serviceStartedAt||at):ticket.serviceStartedAt,['completed','cancelled','no_show'].includes(status)?at:ticket.completedAt,status==='waiting'?null:user.id,ticket.id);if(action==='recall')queueNotification(ticket,'recalled',`Ticket ${ticket.ticketNumber}, please proceed to ${desk}.`);if(action==='cancel')queueNotification(ticket,'cancelled',`Ticket ${ticket.ticketNumber} was cancelled.`);if(action==='no-show')queueNotification(ticket,'no_show',`Ticket ${ticket.ticketNumber} was closed as no-show. Ask reception if you still need help.`);if(action==='transfer'){const destination=get('SELECT name FROM queue_services WHERE id=?',serviceId);queueNotification(ticket,'transferred',`Ticket ${ticket.ticketNumber} was transferred to ${destination.name}.`);} run('INSERT INTO queue_events(ticketId,at,actorId,actorName,action,details) VALUES(?,?,?,?,?,?)',ticket.id,at,user.id,user.name,`queue.${action}`,JSON.stringify({from:ticket.status,to:status,serviceId})); audit(user,`queue.${action}`,ticket.id,{from:ticket.status,to:status}); });
      void processQueueNotifications();return json(res,200,publicTicket(get('SELECT q.*,s.name AS serviceName FROM queue_tickets q JOIN queue_services s ON s.id=q.serviceId WHERE q.id=?',ticket.id)));
    }
    if (route === '/api/queue/stats' && req.method === 'GET') { allow(user, queueOperators); const since=new Date(Date.now()-86400000).toISOString(); return json(res,200,all("SELECT s.id,s.name,COUNT(CASE WHEN q.status='waiting' THEN 1 END) waiting,COUNT(CASE WHEN q.status='serving' THEN 1 END) serving,COUNT(CASE WHEN q.status='waiting' AND (julianday('now')-julianday(q.checkedInAt))*1440>s.slaMinutes THEN 1 END) breached,COUNT(CASE WHEN q.status='completed' THEN 1 END) completed,COUNT(CASE WHEN q.status='no_show' THEN 1 END) noShow,AVG(CASE WHEN q.calledAt IS NOT NULL THEN (julianday(q.calledAt)-julianday(q.checkedInAt))*1440 END) averageWaitMinutes,AVG(CASE WHEN q.completedAt IS NOT NULL AND q.serviceStartedAt IS NOT NULL THEN (julianday(q.completedAt)-julianday(q.serviceStartedAt))*1440 END) averageServiceMinutes FROM queue_services s LEFT JOIN queue_tickets q ON q.serviceId=s.id AND q.checkedInAt>=? GROUP BY s.id ORDER BY s.name",since)); }
    if(route==='/api/queue/notifications'&&req.method==='GET'){allow(user,queueOperators);const counts=get("SELECT COUNT(CASE WHEN status='pending' THEN 1 END) pending,COUNT(CASE WHEN status='sent' THEN 1 END) sent,COUNT(CASE WHEN status='failed' THEN 1 END) failed FROM queue_notifications");return json(res,200,{configured:notificationProvider.configured,...counts});}
    if(route==='/api/queue/notifications/retry'&&req.method==='POST'){allow(user,['admin','receptionist']);const changed=run("UPDATE queue_notifications SET status='pending',nextAttemptAt=?,lastError='' WHERE status='failed'",now());audit(user,'queue.notifications_retried','',{count:Number(changed.changes)});void processQueueNotifications();return json(res,200,{queued:Number(changed.changes)});}
    if(route==='/api/queue/report/export'&&req.method==='GET'){allow(user,queueOperators);const from=url.searchParams.get('from')?iso(url.searchParams.get('from'),'report start'):new Date(Date.now()-30*86400000).toISOString(),to=url.searchParams.get('to')?iso(url.searchParams.get('to'),'report end'):now();if(from>=to||Date.parse(to)-Date.parse(from)>366*86400000)fail(400,'Report range must be valid and no longer than 366 days.');const fields=['ticketNumber','service','source','status','outcome','priority','verificationMethod','checkedInAt','calledAt','serviceStartedAt','completedAt','desk','waitMinutes','serviceMinutes'],rows=all("SELECT q.ticketNumber,s.name service,q.source,q.status,CASE WHEN q.status='completed' THEN 'served' WHEN q.status IN ('cancelled','no_show') THEN 'abandoned' ELSE 'open' END outcome,q.priority,q.verificationMethod,q.checkedInAt,q.calledAt,q.serviceStartedAt,q.completedAt,q.desk,CASE WHEN q.calledAt IS NOT NULL THEN ROUND((julianday(q.calledAt)-julianday(q.checkedInAt))*1440,1) END waitMinutes,CASE WHEN q.completedAt IS NOT NULL AND q.serviceStartedAt IS NOT NULL THEN ROUND((julianday(q.completedAt)-julianday(q.serviceStartedAt))*1440,1) END serviceMinutes FROM queue_tickets q JOIN queue_services s ON s.id=q.serviceId WHERE q.checkedInAt>=? AND q.checkedInAt<? ORDER BY q.checkedInAt",from,to),cell=value=>{let valueText=String(value??'');if(/^\s*[=+@-]/.test(valueText)||/^[\t\r\n]/.test(valueText))valueText="'"+valueText;return '"'+valueText.replace(/"/g,'""')+'"';};audit(user,'queue.report_exported','',{from,to,count:rows.length});res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="queue-report.csv"'});return res.end('\uFEFF'+[fields.map(cell).join(','),...rows.map(row=>fields.map(field=>cell(row[field])).join(','))].join('\r\n'));}
    if(route==='/api/queue/report'&&req.method==='GET'){allow(user,queueOperators);const from=url.searchParams.get('from')?iso(url.searchParams.get('from'),'report start'):new Date(Date.now()-30*86400000).toISOString(),to=url.searchParams.get('to')?iso(url.searchParams.get('to'),'report end'):now();if(from>=to||Date.parse(to)-Date.parse(from)>366*86400000)fail(400,'Report range must be valid and no longer than 366 days.');const services=all("SELECT s.id,s.name,COUNT(q.id) total,COUNT(CASE WHEN q.source='kiosk' THEN 1 END) kiosk,COUNT(CASE WHEN q.source='remote' THEN 1 END) remote,COUNT(CASE WHEN q.status='completed' THEN 1 END) completed,COUNT(CASE WHEN q.status='cancelled' THEN 1 END) cancelled,COUNT(CASE WHEN q.status='no_show' THEN 1 END) noShow,COUNT(CASE WHEN q.status IN ('cancelled','no_show') THEN 1 END) abandoned,COUNT(CASE WHEN q.status IN ('completed','cancelled','no_show') THEN 1 END) terminal,ROUND(100.0*COUNT(CASE WHEN q.status IN ('cancelled','no_show') THEN 1 END)/NULLIF(COUNT(CASE WHEN q.status IN ('completed','cancelled','no_show') THEN 1 END),0),1) abandonmentRate,AVG(CASE WHEN q.calledAt IS NOT NULL THEN (julianday(q.calledAt)-julianday(q.checkedInAt))*1440 END) averageWaitMinutes,AVG(CASE WHEN q.completedAt IS NOT NULL AND q.serviceStartedAt IS NOT NULL THEN (julianday(q.completedAt)-julianday(q.serviceStartedAt))*1440 END) averageServiceMinutes FROM queue_services s LEFT JOIN queue_tickets q ON q.serviceId=s.id AND q.checkedInAt>=? AND q.checkedInAt<? GROUP BY s.id ORDER BY s.name",from,to);const daily=all("SELECT substr(checkedInAt,1,10) day,COUNT(*) total,COUNT(CASE WHEN source='kiosk' THEN 1 END) kiosk,COUNT(CASE WHEN source='remote' THEN 1 END) remote,COUNT(CASE WHEN status='completed' THEN 1 END) completed,COUNT(CASE WHEN status='cancelled' THEN 1 END) cancelled,COUNT(CASE WHEN status='no_show' THEN 1 END) noShow,COUNT(CASE WHEN status IN ('cancelled','no_show') THEN 1 END) abandoned,COUNT(CASE WHEN status IN ('completed','cancelled','no_show') THEN 1 END) terminal,ROUND(100.0*COUNT(CASE WHEN status IN ('cancelled','no_show') THEN 1 END)/NULLIF(COUNT(CASE WHEN status IN ('completed','cancelled','no_show') THEN 1 END),0),1) abandonmentRate FROM queue_tickets WHERE checkedInAt>=? AND checkedInAt<? GROUP BY day ORDER BY day",from,to);const summary=services.reduce((value,item)=>({total:value.total+item.total,kiosk:value.kiosk+item.kiosk,remote:value.remote+item.remote,completed:value.completed+item.completed,cancelled:value.cancelled+item.cancelled,noShow:value.noShow+item.noShow,abandoned:value.abandoned+item.abandoned,terminal:value.terminal+item.terminal}),{total:0,kiosk:0,remote:0,completed:0,cancelled:0,noShow:0,abandoned:0,terminal:0});summary.abandonmentRate=summary.terminal?Math.round(summary.abandoned/summary.terminal*1000)/10:null;audit(user,'queue.report_viewed','',{from,to});return json(res,200,{from,to,summary,services,daily});}
    if (route === '/api/employees' && req.method === 'GET') return json(res, 200, all('SELECT * FROM employees ORDER BY active DESC,name COLLATE NOCASE'));
    if (route === '/api/employees' && req.method === 'POST') {
      allow(user, operators); const record = employee(await body(req)), id = randomUUID();
      transaction(() => { run('INSERT INTO employees(id,name,email,phone,department,location) VALUES(?,?,?,?,?,?)', id, ...Object.values(record)); audit(user, 'employee.created', id); });
      return json(res, 201, get('SELECT * FROM employees WHERE id=?', id));
    }
    const employeeMatch = route.match(/^\/api\/employees\/([a-f0-9-]+)$/);
    if (employeeMatch && req.method === 'PUT') {
      allow(user, operators); const input = await body(req), previous = get('SELECT * FROM employees WHERE id=?', employeeMatch[1]);
      if (!previous) fail(404, 'Employee not found.'); version(input, previous);
      const record = employee(input); if (typeof input.active !== 'boolean') fail(400, 'Invalid employee status.');
      transaction(() => { run('UPDATE employees SET name=?,email=?,phone=?,department=?,location=?,active=?,version=version+1 WHERE id=?', ...Object.values(record), Number(input.active), previous.id); audit(user, 'employee.updated', previous.id, { fields: [...Object.keys(record).filter(key => record[key] !== previous[key]), ...(Number(input.active) !== previous.active ? ['active'] : [])] }); });
      return json(res, 200, get('SELECT * FROM employees WHERE id=?', previous.id));
    }
    if (route === '/api/stats' && req.method === 'GET') {
      const start = iso(url.searchParams.get('from'), 'start date'), end = iso(url.searchParams.get('to'), 'end date');
      if (start >= end) fail(400, 'Invalid date range.');
      const scoped = user.role === 'host' ? 'WHERE hostId=?' : '', args = user.role === 'host' ? [user.employeeId || ''] : [];
      return json(res, 200, get(`SELECT COUNT(CASE WHEN checkedIn>=? AND checkedIn<? THEN 1 END) AS today, COUNT(CASE WHEN checkedOut IS NULL THEN 1 END) AS inside, COUNT(CASE WHEN checkedOut>=? AND checkedOut<? THEN 1 END) AS departed, AVG(CASE WHEN checkedOut>=? AND checkedOut<? THEN (julianday(checkedOut)-julianday(checkedIn))*1440 END) AS average FROM visitors ${scoped}`, start, end, start, end, start, end, ...args));
    }
    if (route === '/api/visitor-filters' && req.method === 'GET') {
      const where = user.role === 'host' ? 'WHERE hostId=?' : '', args = user.role === 'host' ? [user.employeeId || ''] : [];
      const facets = {}; for (const field of ['company', 'department', 'purpose']) facets[field] = all(`SELECT DISTINCT ${field} AS value FROM visitors ${where} ORDER BY ${field} COLLATE NOCASE`, ...args).map(row => row.value).filter(Boolean);
      return json(res, 200, facets);
    }
    if (route === '/api/visitor-profiles' && req.method === 'GET') {
      allow(user, operators); const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2) return json(res, 200, []);
      if (q.length > 120) fail(400, 'Search is too long.');
      const pattern = `%${q.replace(/[%_]/g, value => `\\${value}`)}%`;
      return json(res, 200, all("SELECT id,name,company,email,phone,visitCount,lastVisitAt,version FROM visitor_profiles WHERE name LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' ORDER BY lastVisitAt DESC LIMIT 10", pattern, pattern, pattern, pattern));
    }
    if (route === '/api/appointments' && req.method === 'GET') {
      const conditions = [], args = [];
      if (user.role === 'host') { conditions.push('hostId=?'); args.push(user.employeeId || ''); }
      const status = url.searchParams.get('status') || 'expected';
      if (!['all', 'expected', 'arrived', 'cancelled', 'no_show'].includes(status)) fail(400, 'Invalid appointment status.');
      if (status !== 'all') { conditions.push('status=?'); args.push(status); }
      if (url.searchParams.get('from')) { conditions.push('scheduledFor>=?'); args.push(iso(url.searchParams.get('from'), 'start date')); }
      if (url.searchParams.get('to')) { conditions.push('scheduledFor<?'); args.push(iso(url.searchParams.get('to'), 'end date')); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      return json(res, 200, all(`SELECT * FROM appointments ${where} ORDER BY scheduledFor ASC LIMIT 500`, ...args).map(row => visible(row, user)));
    }
    if (route === '/api/appointments' && req.method === 'POST') {
      allow(user, operators); const input = await body(req), record = appointment(input), id = randomUUID(), createdAt = now();
      transaction(() => {
        const profile = profileFor(record, text(input, 'profileId') || null);
        run('INSERT INTO appointments(id,profileId,name,company,email,phone,hostId,host,department,purpose,category,vehicle,destination,escortRequired,escortName,inductionAcceptedAt,assistanceNotes,notes,scheduledFor,expectedEnd,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, profile.id, ...appointmentValues(record), createdAt, createdAt);
        audit(user, 'appointment.created', id, { scheduledFor: record.scheduledFor });
      });
      return json(res, 201, visible(get('SELECT * FROM appointments WHERE id=?', id), user));
    }
    const appointmentMatch = route.match(/^\/api\/appointments\/([a-f0-9-]+)(\/(arrive|cancel|no-show))?$/);
    if (appointmentMatch) {
      const previous = get('SELECT * FROM appointments WHERE id=?', appointmentMatch[1]);
      if (!previous || (user.role === 'host' && previous.hostId !== user.employeeId)) fail(404, 'Appointment not found.');
      if (req.method === 'PUT' && !appointmentMatch[2]) {
        allow(user, operators); const input = await body(req); version(input, previous);
        if (previous.status !== 'expected') fail(409, 'Only expected appointments can be edited.');
        const record = appointment(input, previous), reason = text(input, 'reason', true, 300);
        transaction(() => {
          const profile = profileFor(record, text(input, 'profileId') || previous.profileId);
          run('UPDATE appointments SET profileId=?,name=?,company=?,email=?,phone=?,hostId=?,host=?,department=?,purpose=?,category=?,vehicle=?,destination=?,escortRequired=?,escortName=?,inductionAcceptedAt=?,assistanceNotes=?,notes=?,scheduledFor=?,expectedEnd=?,version=version+1,updatedAt=? WHERE id=?', profile.id, ...appointmentValues(record), now(), previous.id);
          audit(user, 'appointment.updated', previous.id, { reason });
        });
        return json(res, 200, visible(get('SELECT * FROM appointments WHERE id=?', previous.id), user));
      }
      if (req.method === 'POST' && appointmentMatch[3]) {
        allow(user, operators); const input = await body(req); version(input, previous);
        if (previous.status !== 'expected') fail(409, 'This appointment is no longer expected.');
        if (appointmentMatch[3] === 'arrive') {
          const key = text(input, 'requestKey', true); if (!/^[a-f0-9-]{36}$/.test(key)) fail(400, 'Invalid arrival request key.');
          const visitorId = randomUUID(), arrivedAt = now();
          transaction(() => {
            const badgeCode = `V-${randomUUID().slice(0, 8).toUpperCase()}`;
            run('INSERT INTO visitors(id,profileId,appointmentId,name,company,email,phone,hostId,host,department,purpose,category,vehicle,destination,expectedDeparture,badgeCode,escortRequired,escortName,inductionAcceptedAt,assistanceNotes,notes,checkedIn,requestKey) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', visitorId, previous.profileId, previous.id, previous.name, previous.company, previous.email, previous.phone, previous.hostId, previous.host, previous.department, previous.purpose, previous.category, previous.vehicle, previous.destination, previous.expectedEnd, badgeCode, previous.escortRequired, previous.escortName, previous.inductionAcceptedAt, previous.assistanceNotes, previous.notes, arrivedAt, key);
            run("UPDATE appointments SET status='arrived',visitorId=?,version=version+1,updatedAt=? WHERE id=?", visitorId, arrivedAt, previous.id);
            run('UPDATE visitor_profiles SET visitCount=visitCount+1,lastVisitAt=?,updatedAt=? WHERE id=?', arrivedAt, arrivedAt, previous.profileId);
            audit(user, 'appointment.arrived', previous.id, { visitorId }); audit(user, 'visitor.checked_in', visitorId, { appointmentId: previous.id });
          });
          return json(res, 201, visible(get('SELECT * FROM visitors WHERE id=?', visitorId), user));
        }
        const nextStatus = appointmentMatch[3] === 'cancel' ? 'cancelled' : 'no_show', reason = text(input, 'reason', true, 300);
        transaction(() => { run('UPDATE appointments SET status=?,version=version+1,updatedAt=? WHERE id=?', nextStatus, now(), previous.id); audit(user, `appointment.${nextStatus}`, previous.id, { reason }); });
        return json(res, 200, visible(get('SELECT * FROM appointments WHERE id=?', previous.id), user));
      }
    }
    if (route === '/api/safety/onsite' && req.method === 'GET') {
      allow(user, ['admin', 'receptionist', 'security']);
      const rows = all('SELECT * FROM visitors WHERE checkedOut IS NULL ORDER BY checkedIn ASC').map(row => visible(row, user));
      audit(user, 'safety.roster_viewed', '', { count: rows.length });
      return json(res, 200, rows);
    }
    if (route === '/api/emergencies' && req.method === 'GET') {
      allow(user, ['admin', 'receptionist', 'security']);
      const emergencies = all('SELECT * FROM emergencies ORDER BY startedAt DESC LIMIT 50');
      return json(res, 200, emergencies.map(emergency => ({ ...emergency, visitors: all('SELECT * FROM emergency_visitors WHERE emergencyId=? ORDER BY status DESC,visitorName COLLATE NOCASE', emergency.id).map(row => user.role === 'security' ? row : row) })));
    }
    if (route === '/api/emergencies' && req.method === 'POST') {
      allow(user, ['admin', 'receptionist', 'security']); const input = await body(req);
      if (get("SELECT id FROM emergencies WHERE status='active'")) fail(409, 'An evacuation roll call is already active.');
      const id = randomUUID(), startedAt = now(), name = text(input, 'name') || `Evacuation ${new Date().toLocaleString('en-ZA')}`;
      transaction(() => {
        run('INSERT INTO emergencies(id,name,startedAt,startedBy) VALUES(?,?,?,?)', id, name, startedAt, user.name);
        for (const visitorRecord of all('SELECT * FROM visitors WHERE checkedOut IS NULL')) run('INSERT INTO emergency_visitors(emergencyId,visitorId,visitorName,host,destination,assistanceNotes) VALUES(?,?,?,?,?,?)', id, visitorRecord.id, visitorRecord.name, visitorRecord.host, visitorRecord.destination, visitorRecord.assistanceNotes);
        audit(user, 'emergency.started', id, { occupants: get('SELECT COUNT(*) AS count FROM emergency_visitors WHERE emergencyId=?', id).count });
      });
      return json(res, 201, { ...get('SELECT * FROM emergencies WHERE id=?', id), visitors: all('SELECT * FROM emergency_visitors WHERE emergencyId=?', id) });
    }
    const emergencyMatch = route.match(/^\/api\/emergencies\/([a-f0-9-]+)(\/(close|visitors\/([a-f0-9-]+)))?$/);
    if (emergencyMatch) {
      allow(user, ['admin', 'receptionist', 'security']); const emergency = get('SELECT * FROM emergencies WHERE id=?', emergencyMatch[1]);
      if (!emergency) fail(404, 'Emergency roll call not found.');
      if (req.method === 'POST' && emergencyMatch[3] === 'close') {
        if (emergency.status !== 'active') fail(409, 'This roll call is already closed.');
        const input = await body(req), unaccounted = get("SELECT COUNT(*) AS count FROM emergency_visitors WHERE emergencyId=? AND status='unaccounted'", emergency.id).count;
        if (unaccounted && input.confirmUnaccounted !== true) fail(409, `${unaccounted} visitors remain unaccounted for. Confirm before closing.`);
        transaction(() => { run("UPDATE emergencies SET status='closed',endedAt=? WHERE id=?", now(), emergency.id); audit(user, 'emergency.closed', emergency.id, { unaccounted }); });
        return json(res, 200, get('SELECT * FROM emergencies WHERE id=?', emergency.id));
      }
      if (req.method === 'PUT' && emergencyMatch[4]) {
        if (emergency.status !== 'active') fail(409, 'This roll call is closed.');
        const input = await body(req), status = text(input, 'status', true), notes = text(input, 'notes', false, 300);
        if (!['unaccounted', 'accounted', 'left'].includes(status)) fail(400, 'Invalid roll-call status.');
        const attendee = get('SELECT * FROM emergency_visitors WHERE emergencyId=? AND visitorId=?', emergency.id, emergencyMatch[4]); if (!attendee) fail(404, 'Visitor is not part of this roll call.');
        run('UPDATE emergency_visitors SET status=?,accountedAt=?,accountedBy=?,notes=? WHERE emergencyId=? AND visitorId=?', status, status === 'unaccounted' ? null : now(), status === 'unaccounted' ? null : user.name, notes, emergency.id, attendee.visitorId);
        audit(user, 'emergency.visitor_updated', emergency.id, { visitorId: attendee.visitorId, status });
        return json(res, 200, get('SELECT * FROM emergency_visitors WHERE emergencyId=? AND visitorId=?', emergency.id, attendee.visitorId));
      }
    }
    if (['/api/visitors', '/api/visitors/export'].includes(route) && req.method === 'GET') {
      if (route.endsWith('export')) allow(user, operators);
      const { where, args, order } = queryVisitors(url.searchParams, user), total = get(`SELECT COUNT(*) AS count FROM visitors ${where}`, ...args).count;
      if (route.endsWith('export')) {
        if (total > 50000) fail(400, 'Please narrow the export to 50,000 visits or fewer.');
        const fields = ['name', 'company', 'email', 'phone', 'host', 'department', 'purpose', 'category', 'vehicle', 'destination', 'expectedDeparture', 'badgeCode', 'escortRequired', 'escortName', 'inductionAcceptedAt', 'assistanceNotes', 'checkedIn', 'checkedOut', 'notes'];
        const cell = value => { let valueText = String(value ?? ''); if (/^\s*[=+@-]/.test(valueText) || /^[\t\r\n]/.test(valueText)) valueText = "'" + valueText; return '"' + valueText.replace(/"/g, '""') + '"'; };
        const rows = all(`SELECT * FROM visitors ${where} ORDER BY ${order}`, ...args);
        audit(user, 'visitors.exported', '', { count: total });
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="visitors.csv"' });
        return res.end('\uFEFF' + [fields.map(cell).join(','), ...rows.map(row => fields.map(field => cell(row[field])).join(','))].join('\r\n'));
      }
      const pageSize = 20, page = Math.min(pageNumber(url.searchParams), Math.max(1, Math.ceil(total / pageSize)));
      return json(res, 200, { items: all(`SELECT * FROM visitors ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...args, pageSize, (page - 1) * pageSize).map(row => visible(row, user)), total, page, pageSize });
    }
    if (route === '/api/visitors' && req.method === 'POST') {
      allow(user, operators); const input = await body(req), record = visitor(input), key = text(input, 'requestKey', true);
      if (!/^[a-f0-9-]{36}$/.test(key)) fail(400, 'Invalid check-in request key.');
      const existing = get('SELECT * FROM visitors WHERE requestKey=?', key);
      if (existing) {
        if (Object.keys(record).filter(field => field !== 'badgeCode').some(field => existing[field] !== record[field])) fail(409, 'This check-in was already saved with different details. Refresh the list before starting another visit.');
        return json(res, 200, visible(existing, user));
      }
      const id = randomUUID();
      transaction(() => {
        const arrivedAt = now(), profile = profileFor(record, text(input, 'profileId') || null); record.badgeCode = `V-${randomUUID().slice(0, 8).toUpperCase()}`;
        run('INSERT INTO visitors(id,profileId,name,company,email,phone,hostId,host,department,purpose,category,vehicle,destination,expectedDeparture,badgeCode,escortRequired,escortName,inductionAcceptedAt,assistanceNotes,notes,checkedIn,requestKey) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, profile.id, ...visitValues(record), arrivedAt, key);
        run('UPDATE visitor_profiles SET visitCount=visitCount+1,lastVisitAt=?,updatedAt=? WHERE id=?', arrivedAt, arrivedAt, profile.id);
        audit(user, 'visitor.checked_in', id, { returning: profile.visitCount > 0 });
      });
      return json(res, 201, visible(get('SELECT * FROM visitors WHERE id=?', id), user));
    }
    const visitorMatch = route.match(/^\/api\/visitors\/([a-f0-9-]+)(\/checkout)?$/);
    if (visitorMatch) {
      if (req.method === 'GET' && !visitorMatch[2]) { const record = findVisitor(visitorMatch[1], user); audit(user, 'visitor.viewed', record.id); return json(res, 200, visible(record, user)); }
      if (req.method === 'PUT' && !visitorMatch[2]) {
        allow(user, operators); const input = await body(req), previous = findVisitor(visitorMatch[1], user); version(input, previous);
        const record = visitor(input, previous), reason = text(input, 'reason', true, 300);
        transaction(() => { run('UPDATE visitors SET name=?,company=?,email=?,phone=?,hostId=?,host=?,department=?,purpose=?,category=?,vehicle=?,destination=?,expectedDeparture=?,badgeCode=?,escortRequired=?,escortName=?,inductionAcceptedAt=?,assistanceNotes=?,notes=?,version=version+1 WHERE id=?', ...visitValues(record), previous.id); audit(user, 'visitor.corrected', previous.id, { reason, fields: Object.keys(record).filter(key => previous[key] !== record[key]) }); });
        return json(res, 200, visible(get('SELECT * FROM visitors WHERE id=?', previous.id), user));
      }
      if (req.method === 'POST' && visitorMatch[2]) {
        allow(user, [...operators, 'security']); const input = await body(req), previous = findVisitor(visitorMatch[1], user); version(input, previous);
        if (previous.checkedOut) fail(409, 'Visitor already checked out.');
        transaction(() => { run('UPDATE visitors SET checkedOut=?,version=version+1 WHERE id=?', now(), previous.id); audit(user, 'visitor.checked_out', previous.id); });
        return json(res, 200, visible(get('SELECT * FROM visitors WHERE id=?', previous.id), user));
      }
    }
    if (route.startsWith('/api/users')) {
      allow(user, ['admin']);
      if (route === '/api/users' && req.method === 'GET') return json(res, 200, all('SELECT * FROM users ORDER BY name COLLATE NOCASE').map(publicUser));
      if ((route === '/api/users' && req.method === 'POST') || (/^\/api\/users\/[a-f0-9-]+$/.test(route) && req.method === 'PUT')) {
        const input = await body(req), id = req.method === 'POST' ? randomUUID() : route.split('/').at(-1), previous = req.method === 'PUT' ? get('SELECT * FROM users WHERE id=?', id) : null;
        if (req.method === 'PUT' && !previous) fail(404, 'Account not found.');
        if (previous) version(input, previous);
        const name = text(input, 'name', true), username = text(input, 'username', true).toLowerCase(), role = text(input, 'role', true), employeeId = text(input, 'employeeId') || null;
        if (!/^[a-z0-9._@-]{3,120}$/.test(username)) fail(400, 'Invalid username.');
        if (!roles.includes(role)) fail(400, 'Invalid role.');
        if (employeeId && !get('SELECT id FROM employees WHERE id=? AND active=1', employeeId) && employeeId !== previous?.employeeId) fail(400, 'Select an active employee.');
        if (role === 'host' && !employeeId) fail(400, 'Host accounts must be linked to an employee.');
        const active = input.active ?? true; if (typeof active !== 'boolean') fail(400, 'Invalid account status.');
        if (id === user.id && (!active || role !== 'admin')) fail(400, 'You cannot suspend or demote your own administrator account.');
        if (get('SELECT id FROM users WHERE username=? AND id<>?', username, id)) fail(409, 'That username is already in use.');
        const hash = (!previous || input.password) ? await passwordHash(input.password) : previous.passwordHash;
        const currentSession = auth.session(req); if (!currentSession || currentSession.user.role !== 'admin') fail(403, 'Administrator session is no longer valid.');
        if (previous) version(input, get('SELECT * FROM users WHERE id=?', id));
        if (get('SELECT id FROM users WHERE username=? AND id<>?', username, id)) fail(409, 'That username is already in use.');
        transaction(() => {
          if (previous) { run('UPDATE users SET name=?,username=?,passwordHash=?,role=?,employeeId=?,active=?,version=version+1 WHERE id=?', name, username, hash, role, employeeId, Number(active), id); run('DELETE FROM sessions WHERE userId=?', id); }
          else run('INSERT INTO users(id,name,username,passwordHash,role,employeeId,active,createdAt) VALUES(?,?,?,?,?,?,?,?)', id, name, username, hash, role, employeeId, Number(active), now());
          audit(user, previous ? 'account.updated' : 'account.created', id, { role, active, passwordReset: !!previous && !!input.password });
        });
        return json(res, previous ? 200 : 201, publicUser(get('SELECT * FROM users WHERE id=?', id)));
      }
    }
    if (route === '/api/audit' && req.method === 'GET') {
      allow(user, ['admin']); const page = pageNumber(url.searchParams), q = (url.searchParams.get('q') || '').slice(0, 120), where = q ? 'WHERE instr(lower(action || actorName || entityId),lower(?))>0' : '', args = q ? [q] : [];
      return json(res, 200, { items: all(`SELECT * FROM audit ${where} ORDER BY id DESC LIMIT 30 OFFSET ?`, ...args, (page - 1) * 30).map(row => ({ ...row, details: JSON.parse(row.details) })), total: get(`SELECT COUNT(*) AS count FROM audit ${where}`, ...args).count, page, pageSize: 30 });
    }
    if (route === '/api/backups' && req.method === 'GET') { allow(user, ['admin']); return json(res, 200, store.listBackups()); }
    if (route === '/api/backups' && req.method === 'POST') { allow(user, ['admin']); return json(res, 201, await store.createBackup(user)); }
    const backupMatch = route.match(/^\/api\/backups\/(backup-[\w-]+\.sqlite)$/);
    if (backupMatch && req.method === 'GET') {
      allow(user, ['admin']); const file = store.listBackups().find(item => item.name === backupMatch[1]); if (!file) fail(404, 'Backup not found.');
      audit(user, 'backup.downloaded', file.name); res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${file.name}"` }); return res.end(fs.readFileSync(path.join(store.backupDir, file.name)));
    }
    fail(404, 'Not found.');
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(`Request failed: ${err.code || err.name}`);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Unable to complete the operation. Please retry; contact your administrator if it persists.' : err.message });
    else res.end();
  }
});
async function automaticBackup() {
  if (!get('SELECT id FROM users LIMIT 1')) return;
  const latest = get("SELECT value FROM metadata WHERE key='last-backup'")?.value;
  if (!latest || Date.now() - Date.parse(latest) >= 24 * 60 * 60000) await store.createBackup(null, 'automatic');
}
function automaticRetention() {
  if (!get('SELECT id FROM users LIMIT 1')) return;
  const latest = get("SELECT value FROM metadata WHERE key='last-retention-run'")?.value;
  if (!latest || Date.now() - Date.parse(latest) >= 24 * 60 * 60000) applyRetention(null, 'automatic');
}
await automaticBackup().catch(() => console.error('Automatic backup failed. Check storage and create a manual backup.'));
try { automaticRetention(); } catch { console.error('Automatic retention failed. Review storage and retention settings.'); }
const backupTimer = setInterval(() => automaticBackup().catch(() => console.error('Automatic backup failed. Check storage and create a manual backup.')), 60000);
backupTimer.unref();
const retentionTimer = setInterval(() => { try { automaticRetention(); } catch { console.error('Automatic retention failed. Review storage and retention settings.'); } }, 60000);
retentionTimer.unref();
void processQueueNotifications();
const notificationTimer=setInterval(()=>void processQueueNotifications(),5000);notificationTimer.unref();
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`Visitor Management System: http://localhost:${server.address().port}`));
let stopping = false;
async function shutdown() { if (stopping) return; stopping = true; clearInterval(backupTimer); clearInterval(retentionTimer);clearInterval(notificationTimer); server.close(async () => { try { await store.pendingBackup(); } finally { db.close(); } }); server.closeIdleConnections(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);


