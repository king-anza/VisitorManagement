# Welcome â€” Visitor Management System

An Angular 22 reception workspace with a Node.js/SQLite API, self-service queues, accounts and roles, an employee directory, reusable visitor profiles, pre-registration, printable badges, live occupancy and evacuation roll calls, visitor check-in/check-out, audited corrections, searchable history, filtered CSV exports and verified backups.

## Start

Requires **Node.js 24.13 or newer** (tested with 24.19). Install the Angular dependencies once, then build and start from this folder:

```powershell
cd client
npm.cmd install
cd ..
npm.cmd start
```

`npm.cmd start` creates the production Angular bundle and starts the API/server. Open **http://localhost:3000**. On the first launch, create your administrator account. There is no preset password. Choose a password of 12â€“128 characters and keep it somewhere safe. Stop the server with Ctrl+C. Use `npm.cmd run serve` to start an already-built bundle without rebuilding.

The app binds to the local computer (`127.0.0.1`). It does not publish the visitor database or create a network service for other devices.

## Angular architecture

The Angular workspace lives in `client/` and uses a standalone root component, strict TypeScript, Angular CLI production builds and hashed bundles. The Node server serves `client/dist/client/browser` and keeps all data operations under `/api`.

The production interface is implemented with standalone Angular feature components, lazy routes, signals, typed services and reactive forms. Angular owns authentication, visitors, appointments, employees, accounts, safety, audit, backups and settings. There is no runtime legacy page, injected HTML document, or global DOM controller.

For Angular development, run the API and Angular development server in separate terminals:

```powershell
npm.cmd run serve
npm.cmd --prefix client start
```

Open **http://localhost:4200**. The Angular dev server proxies `/api` to the local backend.

## First-time setup

1. Create the first administrator through the setup screen.
2. Open **Employees** and add hosts with their department, contact information and office location.
3. Open **Accounts** if other staff need their own login. Link each host account to the correct employee.
4. Open **Overview â†’ Check in visitor**. Name, host and purpose are required; other fields are optional.
5. Use **Expected visitors â†’ Schedule visitor** to pre-register a future arrival. Mark the appointment **Arrived** when reception admits them.
6. Open **Settings** to review the privacy notice, visitor categories, required fields, site capacity and retention period.
7. Open **Backups â†’ Create backup** and download a copy to another protected location.

## Reception workflow

- **Overview** includes today's arrivals and everyone still on-site, including overnight visitors. Statistics describe the signed-in user's accessible visits, independently of the table filters.
- The **expected today** strip shows pre-registered visitors scheduled for the current local day. Open **Expected visitors** to add, edit, reschedule, cancel, mark no-show, or convert an expected appointment into a checked-in visit. Status changes and reasons are audited.
- **Visitor history** includes all dates. Use arrival dates, host, company, department, purpose, status and text search to narrow the list. The end date includes that entire local calendar day.
- The table supports 20 records per page and sorting by arrival, visitor, host, departure or duration. Filter values are retained as you move between Overview and Visitor history; date limits apply only in history.
- Click a visitor's **name** or **Details** to inspect a visit. Receptionists and administrators can correct fields, supplying a reason. Check-in and check-out timestamps cannot be edited through this form.
- If another operator changes the same record first, the app rejects your stale save. Use **Reload record**, review the current details, and reapply the intended correction. Employee/account conflicts require closing and reopening the form after a refresh.
- **Check out** opens a confirmation dialog and records the departure. It does not delete the visit.
- Check-in and pre-registration can record category, destination, vehicle registration, expected departure, escort, induction acknowledgement and restricted assistance needs. Overdue visitors are labelled in the visitor and safety rosters.
- Select **Badge** beside an on-site visitor to preview and print a badge. Badges show the visitor, company, category, host, destination, validity and opaque badge code; they exclude contact details and notes.
- **Export CSV** downloads every matching row across pages, not only the displayed page. It includes contact details and internal notes and is limited to 50,000 matching records per export. Narrow the filters for larger histories. Spreadsheet formula-like values are neutralised.
- Search **Returning visitor** while checking in or scheduling to reuse a previous visitor's contact and company details. Exact email or phone matches also link new visits to the existing profile, while each arrival remains a separate visit.

## Self-service queues

The kiosk and private ticket-tracking flow support English, Afrikaans and isiZulu. Visitors choose **Language** at the top of either page; the browser remembers the choice and the private tracking link carries it to the status page. The page language is also exposed to assistive technology. Service names plus the administrator-configured privacy, biometric and paused-service wording remain organisation-authored text, so administrators should enter wording suitable for their audience.

Administrators configure services in **Service queues**, including the ticket prefix, expected service time, maximum waiting capacity, SLA waiting threshold and whether priority assistance is supported. Administrators, receptionists and security staff can choose their desk, pause or resume intake with a visitor-facing reason, call the next visitor, recall or start a ticket, complete it, mark a no-show, cancel it, or transfer it to another service. The screen highlights tickets over the configured SLA and includes current waiting totals, wait and service averages, completion/no-show counts, a date-bounded service-performance report and privacy-limited CSV export.

Queue reports include outcome summaries, kiosk-versus-remote demand, service-level abandonment rates and a daily completed-versus-abandoned trend with an accessible text description and data table. An **abandoned** ticket is a cancelled or no-show ticket. Its rate is calculated against terminal outcomesâ€”completed, cancelled and no-show ticketsâ€”so tickets still waiting or being served do not distort the result. CSV exports classify each row as `served`, `abandoned` or `open` while retaining the specific ticket status and issuance source.

Open `/kiosk` on a locked-down kiosk device for self-service entry, `/join-queue` for the mobile remote queue, and `/queue-display` on a waiting-room display. The public display shows only ticket number, service and desk. The kiosk can accept manual ID entry or USB/Bluetooth scanners that behave like a keyboard and finish a scan with Enter. The database retains a SHA-256 identity hash and the final four characters, never the original scanned number.

The remote queue is a responsive public page for visitors who can reach the site before their turn. It requires a name, mobile number and explicit arrival confirmation, then issues the same private live-tracking link used by the kiosk. The endpoint has a stricter per-address request limit, reuses idempotency and capacity controls, and ignores attempted ID, camera or biometric fields. Staff see a **remote** label beside waiting tickets. Reports and CSV exports separate kiosk and remote demand. Share the HTTPS `/join-queue` URL or a QR code pointing to it only after deciding the operating radius, no-show policy and visitor instructions; scheduled arrival windows and geofencing remain planned.

On browsers that expose the native `BarcodeDetector` API, the kiosk can scan QR, PDF417, Code 128, Code 39, EAN-13 and Data Matrix codes with the device camera. The actual enabled list is detected at runtime because browser and operating-system support varies. The camera closes immediately after a result or cancellation, and no frame is stored. If detection or camera permission is unavailable, the kiosk explains the fallback and continues to support keyboard-style scanners and manual entry. Production camera use on another device requires HTTPS.

Paused services remain visible with the operator's explanation but cannot be selected. Full services are also disabled. Capacity is checked again inside the database transaction when the visitor submits, preventing simultaneous kiosks from exceeding the configured limit. Existing waiting tickets remain available to staff when intake is paused.

The kiosk refreshes service availability every 30 seconds and reacts to browser online/offline events. It blocks submission while disconnected, shows a recovery control, and automatically refreshes after connectivity returns. If a connection drops after the server saves a ticket but before the response reaches the kiosk, retrying reuses the same request and tracking secrets so the server returns the original ticket instead of creating a duplicate.

The kiosk clears the form, captured image, consent state, ticket confirmation and pending retry secrets after the configured inactivity period. A warning appears during the final 15 seconds and any keyboard or touch/pointer activity restarts the timer. Administrators can set the timeout from 30 to 1,800 seconds in **Settings**; 120 seconds is the default.

After joining, a visitor receives a private tracking link showing their live position, recalculated estimate and call status. They can cancel their own ticket while it is still waiting. The URL contains a random secret; only its SHA-256 hash is stored, status responses contain no visitor identity, requests are rate limited, and the site sends a no-referrer policy. Visitors should still treat the link as private. Old tracking access is removed when queue retention anonymises the ticket.

The waiting-room display supports optional spoken calls. A person must select **Enable announcements** once because browsers restrict automatic audio. New calls are also written to an assertive ARIA live region. Speech uses the display device's browser and installed system voice; production sites should test pronunciation, volume and fallback signage in the actual waiting area.

When a queue notification provider is configured, visitors with a mobile number can explicitly opt in to lifecycle updates. Messages cover joining, calls, recalls, transfers, cancellations and no-shows. The durable SQLite outbox retries temporary failures with bounded backoff, stops after five attempts or a permanent provider rejection, and exposes delivery totals plus a staff retry action. Message payloads use the ticket number and operational instructions without the visitor's name. Queue retention deletes the destination, consent timestamp and related outbox records.

Camera capture requires explicit consent. The confirmation provides a receipt identifier, consent time and verification method; the database also fingerprints the notice text shown at consent time. When no biometric provider is configured, the kiosk describes the photo as camera-assisted only and permits card or manual verification. With a provider configured, the captured image is sent directly to that provider, the application keeps only a short-lived verification token bound to the supplied ID hash, and it does not persist the image or provider response. A production deployment must select and assess its provider, liveness controls, matching thresholds, consent wording, retention rules and a manual fallback for failed or declined matching.

Kiosk browser permissions require a secure context when accessed from another device, so shared deployment should use HTTPS. Restrict the kiosk browser to its public route using the device's kiosk/assigned-access mode; application API permissions still prevent it from reading staff data.

## Roles

| Capability | Administrator | Receptionist | Host | Security |
|---|---|---|---|---|
| View visitors | All | All | Linked employee's visits only | All |
| Visitor contact information | Yes | Yes | Own visitors | No |
| Internal visitor notes | Yes | Yes | No | No |
| Check in / correct visits | Yes | Yes | No | No |
| Check out visits | Yes | Yes | No | Yes |
| Export visitors | Yes | Yes | No | No |
| Read employee directory | Yes | Yes | Yes | Yes |
| Add/edit/inactivate employees | Yes | Yes | No | No |
| Operate service queues | Yes | Yes | No | Yes |
| Configure queue services | Yes | No | No | No |
| Accounts, audit, backups | Yes | No | No | No |

Administrators, receptionists and security staff can open the live safety roster and operate an evacuation roll call. Security can see assistance needs for emergency accountability but cannot see visitor email, phone or internal reception notes. Hosts cannot access the organisation-wide safety roster.

## On-site safety and evacuation

**On-site safety** shows everyone whose visit has not been checked out, oldest arrival first. It includes destination, expected departure, overdue status, escort information and restricted assistance needs.

Select **Start evacuation roll call** to capture a fixed snapshot. Later arrivals do not alter that incident record. Mark each visitor **Accounted**, **Left site**, or reset them to **Unaccounted**. The roster records the operator and time. Closing with unaccounted visitors requires explicit confirmation and preserves those statuses. Closed roll calls remain available through the API and audit history; a dedicated incident-report screen is still planned.

Use **Print emergency roster** for a paper copy. Browser print settings control the final layout. This reception roster supports accountability but does not prove physical entry or exit until an access-control integration is added.

Permissions are checked by the server. Changing HTML or calling an API directly does not grant additional access. Visitor-facing accounts are not implemented.

Inactive employees cannot receive new check-ins but remain linked to past visits. Historic host names and departments are retained when an employee is renamed. Inactivating an employee does **not** suspend a login; suspend it separately in **Accounts**.

Administrators can create accounts, change roles, suspend access and reset passwords. Leaving the password blank on an existing account keeps its current password. Account updates end that account's existing sessions. You cannot suspend or demote your own administrator account. Keep a second trusted administrator for assisted recovery; email-based recovery is not implemented.

Use **Password** in the header to change your own password. This signs out other sessions. Sessions expire after 30 minutes of inactivity or 12 hours in total. Background refresh does not keep an unattended session alive. The interface checks session status every 30 seconds, including while a dialog is open; browser suspension or loss of connectivity can delay the visible lock screen, but the server still rejects expired sessions.

## Data and migration

The database is `data/visitors.sqlite`. SQLite uses transactions, foreign keys, indexes and a versioned schema. The `-wal` and `-shm` sidecar files can exist while the server is running; do not copy only the main database file as a live backup.

On the first launch of this version, an existing `data/visitors.json` is imported transactionally. Hosts are added to the employee directory, visit IDs and timestamps are preserved, and the original JSON file is left unchanged. Migration runs once. Invalid legacy data stops migration without partially importing rows. Do not continue using the old server after migration: future JSON changes will not be imported automatically.

Passwords use salted scrypt hashes. Session cookies are HttpOnly and SameSite=Strict; the database stores hashed session tokens. Authenticated writes require a CSRF token. Authentication attempts are rate limited. The audit log records operators, actions, record identifiers and correction reasons/field names, rather than copies of passwords or visitor notes. Detail access and CSV/backup downloads are audited; routine list refreshes are not individually logged.

This is a local application, not a hardened shared deployment. HTTPS, SSO/MFA, encrypted backup storage, organisational retention policies and broader operational monitoring remain in [TODO.md](TODO.md). Database files and downloads contain personal information; protect access using your operating system and storage policies.

## Workspace settings and retention

Administrators can configure the organisation/site names, visitor-facing privacy notice, visitor categories, required check-in fields, on-site capacity and retention period. Required fields are enforced by the server for both walk-ins and appointments. Capacity is a warning threshold; it does not block emergency or authorised entry.

Queue records have a separate retention period, defaulting to 90 days. Completed, cancelled and no-show tickets older than this limit are anonymised by the same daily retention process. Names, phone numbers, ID hashes, ID suffixes and consent receipt identifiers are removed while ticket timing and status remain available for aggregate reporting.

Retention accepts 30â€“3650 days. The Settings page previews how many completed visits are eligible. Running anonymisation permanently removes visitor names, company/contact details, vehicle, badge, escort, assistance information and notes while retaining host, purpose, category and timestamps for operational statistics. Profiles are anonymised once none of their visits retain personal data. Active visits are never anonymised.

The server checks retention daily. It creates/checks the daily backup before applying automatic retention during startup. A manual change to the retention period should be reviewed using the preview and applied with the Settings button when appropriate. Both manual and automatic runs are audited, including zero-record runs. Restoration of an earlier backup can reintroduce data that was later anonymised, so backup retention and access must follow the same privacy policy.

## Backups and restoration

An automatic backup is made when no previous backup exists, and thereafter when the latest backup is at least 24 hours old. The server checks this on startup and every minute while running. The first backup after initial administrator setup occurs within a minute. A manual backup resets the daily interval.

Backups appear in **Backups** and are stored under `data/backups`. Each copy is created using SQLite's backup API, passes an integrity check, and excludes active sessions. Backups include user accounts/password hashes as well as visitor and audit data. They are retained until you remove them manually; automatic retention is still planned. Keep an additional protected copy on another deviceâ€”copies on the same disk do not protect against disk failure.

Restore into a **new directory** so the current workspace is preserved:

```powershell
# Stop the running server first with Ctrl+C.
# Replace the example backup filename with your actual file.
node scripts/restore.js ".\data\backups\backup-EXAMPLE.sqlite" ".\data-restored"
$env:DATA_DIR = (Resolve-Path ".\data-restored").Path
node server.js
```

The restore tool refuses an existing destination, checks database integrity/schema/relationships, creates a standalone database, clears sessions and records the restoration. Sign in with an account that existed at the time of the backup. Verify the restored records before choosing to use that directory permanently. The environment variable above lasts for the current terminal session; set it again on future starts, or configure it in your launcher.

If a backup fails, check available disk space and filesystem access, then retry a manual backup. Startup performs a quick integrity check; if corruption is detected, preserve the damaged folder and restore a verified backup into a different directory.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Local HTTP port |
| `DATA_DIR` | `data` beside `server.js` | Database and backup directory |
| `COOKIE_SECURE` | unset | Set to `1` only when cookies are served over HTTPS; shared hosting needs additional configuration |
| `BROWSER_PATH` | Installed Chrome/Edge on Windows | Browser executable for browser checks |
| `BIOMETRIC_PROVIDER_URL` | unset | HTTPS endpoint for an approved biometric verification provider; localhost HTTP is allowed for development |
| `BIOMETRIC_PROVIDER_API_KEY` | unset | Optional bearer token sent only to the configured biometric provider |
| `QUEUE_NOTIFICATION_PROVIDER_URL` | unset | HTTPS endpoint for an SMS or messaging adapter; localhost HTTP is allowed for development |
| `QUEUE_NOTIFICATION_PROVIDER_API_KEY` | unset | Optional bearer token sent only to the notification provider |

The biometric endpoint receives JSON in the form `{ "image": "data:image/jpeg;base64,...", "identificationHash": "..." }` and must return `{ "verified": true, "reference": "provider-reference" }`. A negative result leaves the visitor unverified. Provider failures return an operational error and do not silently approve a match. Keep provider credentials outside source control and configure outbound network access, timeouts and monitoring in the deployment environment.

The queue notification endpoint receives `{ "channel": "sms", "destination": "+27...", "message": "...", "event": "called", "reference": "ticket-id" }`. Return a successful 2xx response with optional JSON `{ "reference": "provider-message-id" }`. HTTP 4xx responses are treated as permanent failures; network, timeout and 5xx failures retry up to five attempts. Use an adapter under your control to translate this contract to the chosen SMS vendor, validate destination formats and enforce regional messaging requirements.

Run one server process per data directory. Use separate `DATA_DIR` values for development/demo data; tests always create isolated temporary directories. There is no scheduled operating-system service yet, so keep the server running during reception hours.

## Verification

```powershell
npm.cmd run build
npm.cmd run test:angular
npm.cmd test
npm.cmd run test:browser
```

Backend tests cover authentication, idle expiry, CSRF, role and field restrictions, employee management, visitor profiles, appointment states, badges, safety fields, evacuation snapshots, corrections and audit records, idempotent check-in, queue privacy and lifecycle, remote ticket issuance, private tracking and self-cancellation, opt-in queue messages and durable delivery state, queue source and abandonment metrics, report export, unavailable biometric-provider behavior, concurrent edits, date boundaries, pagination, CSV safety, legacy migration, persistence, backup restoration and login throttling.

Browser checks use installed Chrome/Edge in headless mode with disposable test data. They exercise visitor language selection and persistence, service configuration, kiosk self-queuing, private ticket tracking, staff queue handling, administrator setup, the employee directory, appointments, visitor entry/corrections/check-out, badge preview, safety and evacuation workflows, history filtering, accounts, audit, backups, host restrictions and mobile page overflow. Screenshots are saved under ignored `browser-artifacts/`. The browser harness disables the browser sandbox for this restricted local test environment and only opens its disposable local test server; do not reuse it to browse untrusted sites.

## Roadmap

[TODO.md](TODO.md) is the complete improvement backlog. Checked items are implemented; unchecked items remain planned. The reception, administration and self-service queue foundations are implemented. Invitations, notifications, QR check-in, advanced hardware adapters, multi-site features and external integrations remain later milestones.

SQLite API reference: [Node.js SQLite documentation](https://nodejs.org/api/sqlite.html).
#   V i s i t o r M a n a g e m e n t  
 