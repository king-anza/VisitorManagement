# Visitor Management System â€” improvement backlog

This file tracks every improvement proposed in the product review. A checked box means the feature is implemented and verified; an unchecked box remains planned. Scope notes distinguish a foundation from the more advanced work that still remains.

## Current milestone â€” reception and administration foundations

- [x] Visitor detail and correction screens, with a correction reason and conflict detection.
- [x] Employee directory and host selection.
- [x] History date, host, company, department, purpose and status filters; sorting and pagination.
- [x] SQLite storage with migration from the original JSON records.
- [x] First-administrator setup, login/logout and administrator/receptionist/host/security permissions.
- [x] Audit trail for changes, authentication, detail access and exports.
- [x] Automatic and manual database backups, verification and documented restore procedure.
- [x] Automated tests and updated operating instructions.

## 1. Accounts and access

- [x] Login and logout.
- [x] Administrator, receptionist, host and security roles.
- [ ] Visitor-facing accounts and permissions.
- [x] Server-enforced permissions for viewing, editing, exporting and administration; deletion permission when deletion is introduced.
- [x] Separate staff accounts.
- [x] Administrator-assisted password reset and own-password changes.
- [ ] Self-service password recovery.
- [ ] Multifactor authentication.
- [ ] Organisation single sign-on.
- [x] Automatic logout after inactivity.
- [x] Suspend departed employees' accounts.
- [x] Login history.
- [ ] Suspicious login alerts.

## 2. Visitor records

- [x] Detail screen showing contact details and notes according to permissions.
- [x] Edit incorrect visitor information.
- [x] Record the operator, correction reason and changed fields.
- [x] Returning visitor profiles and reusable details.
- [ ] Duplicate visitor detection.
- [ ] Optional visitor photographs.
- [x] Vehicle registration. Parking allocation remains planned.
- [x] Configurable visitor categories.
- [ ] Group visitors by company or booking.
- [ ] Custom visitor fields.
- [x] Configurable required contact, destination, expected-departure and vehicle fields.
- [ ] Document attachments.
- [ ] Cancellation, refused-entry and accidental-check-in records.
- [x] Link repeat visits to a visitor profile.

## 3. Check-in and check-out

- [x] Pre-registration.
- [ ] Visitor invitation links.
- [ ] QR check-in.
- [ ] Booking reference lookup.
- [ ] Group check-in and check-out.
- [ ] Delivery, contractor and interview workflows.
- [x] Expected departure time.
- [x] Overdue visit labels in visitor and safety rosters. Proactive notifications remain planned.
- [ ] Highlight overnight visitors.
- [ ] Controlled missed-check-out corrections.
- [ ] Re-entry tracking.
- [ ] Self-service check-out.
- [ ] Host approval before entry.
- [x] Separate expected, arrived, cancelled and no-show appointment states. Awaiting approval and admitted entry states remain planned.
- [x] Visitor destination. Configurable arrival instructions remain planned.

## 4. Employee and host directory

- [x] Employee directory.
- [x] Departments, office locations and contact details.
- [x] Searchable directory-backed host selection.
- [ ] Host availability and backup contacts.
- [ ] Host delegates.
- [x] Hosts can view only their own visitor history.
- [ ] Hosts manage expected visitors.
- [ ] Employee spreadsheet import.
- [ ] Company directory synchronisation.

## 5. Invitations and appointments

- [x] Future appointments.
- [x] Expected-today dashboard.
- [ ] Recurring appointments.
- [ ] Multi-visitor invitations.
- [ ] Appointment approvals.
- [x] Appointment rescheduling and cancellation with reasons and audit history.
- [ ] Arrival reminders.
- [ ] Invitation directions, parking and reception instructions.
- [ ] Invitation delivery and response tracking.
- [x] No-show status. Automatic late-arrival labels remain planned.
- [ ] Appointment capacity limits.
- [ ] Meeting room reservations.

## 6. Notifications

- [ ] Notify hosts of arrivals.
- [ ] Notify reception of host acknowledgement.
- [ ] Escalation to backup contacts.
- [ ] Email, SMS and workplace messaging channels.
- [ ] Departure notifications.
- [ ] Appointment change notifications.
- [ ] Message templates.
- [ ] Preferences and quiet hours.
- [ ] Delivery status and failed-delivery retries.
- [ ] Minimise sensitive information in notifications.
- [x] Optional queue lifecycle SMS/webhook adapter with explicit visitor opt-in.
- [x] Durable queue-notification outbox, delivery state, bounded retry and staff retry control.
- [x] Queue messages exclude visitor names and are deleted by queue retention.

## 7. Reception interface

- [x] Server-side pagination.
- [x] Sort by visitor, host, arrival, departure and duration.
- [x] Date-range filtering.
- [x] Company, host, department and purpose filters.
- [ ] Saved filter views.
- [x] Visit duration in table.
- [x] Quick visitor details.
- [x] Loading indicators.
- [x] Connection status and last refresh time.
- [x] Retry after load failures.
- [x] Informative errors.
- [x] In-app confirmation dialogs.
- [x] Preserve filters during navigation.
- [ ] Reception keyboard shortcuts.
- [x] Improved tablet and phone layouts.
- [ ] Dark mode.
- [ ] Configurable logo and welcome text. Organisation and site names are configurable.

## 8. Self-service kiosk

- [x] Dedicated public kiosk screen.
- [x] Touch-friendly controls.
- [x] English, Afrikaans and isiZulu on the self-service kiosk and private ticket-tracking page, with a persisted visitor preference and language-aware links.
- [x] Translated visitor instructions and assistance prompts for the kiosk flow. Site-configured privacy and biometric notices remain administrator-authored text.
- [x] Configurable inactivity reset with a visible final countdown.
- [x] Clear personal information after every completed session.
- [x] Prevent kiosk access to history through server-enforced unauthenticated routes.
- [x] Native camera QR/barcode scanning when the browser supports BarcodeDetector, with keyboard/manual fallback.
- [x] Optional consent-gated camera capture.
- [x] Accessible labelled kiosk interactions and status messages. Formal assistive-technology testing remains planned.
- [ ] Attendant override.
- [x] Online/offline and server-availability indicators, recovery action and automatic service refresh. Offline ticket buffering remains planned.

## 8A. Queue management

- [x] Configurable services, ticket prefixes, estimated service times and priority support.
- [x] Self-queuing by manual entry or keyboard-wedge USB/Bluetooth ID scanner.
- [x] Dedicated scanner-input adapter for Enter-terminated and pasted keyboard-wedge payloads, with WebHID/WebUSB capability detection for future vendor drivers.
- [x] Store only an ID hash and final four characters; never expose identity data on public displays.
- [x] Consent-aware camera capture and a pluggable external biometric-verification adapter.
- [x] Disable automated biometric claims when no provider is configured.
- [x] Staff call-next, recall, start, complete, cancel, no-show and transfer actions.
- [x] Desk assignment and a privacy-safe public queue display.
- [x] Waiting counts and average-wait analytics foundation.
- [x] Per-ticket wait estimates captured at joining time.
- [x] Private ticket tracking with live position and recalculated wait estimate.
- [x] Token-authorised visitor self-cancellation while waiting.
- [x] Date-bounded service reports covering totals, completion, cancellation, no-shows, wait and service times.
- [x] Camera/biometric consent receipts with notice fingerprints and expiring public receipt lookup.
- [x] Separate configurable queue retention with automatic personal-data anonymisation.
- [x] Queue lifecycle audit events and role-enforced operations.
- [x] Idempotent kiosk submission and kiosk request rate limiting.
- [x] Reuse idempotency and private tracking keys after interrupted or response-lost kiosk submissions.
- [x] Operational pause/resume with visitor-facing reasons and audit events.
- [x] Per-service maximum waiting capacity enforced transactionally.
- [x] Configurable waiting-time SLA thresholds and staff breach indicators.
- [x] Kiosk availability handling for paused and full queues.
- [x] Optional mobile updates for join, call, recall, transfer, cancellation and no-show events.
- [x] Staff visibility into pending, sent and failed queue updates.
- [ ] Vendor-specific smart-card/chip readers through WebHID, WebUSB or native device middleware.
- [ ] Vendor-specific magnetic-stripe and national-ID parsers. Native camera detection supports QR, PDF417, Code 128, Code 39, EAN-13 and Data Matrix where the browser exposes those formats.
- [ ] Production biometric provider certification, liveness detection, accuracy thresholds and human review.
- [ ] Cryptographically signed consent receipts and consent-withdrawal workflow. Receipt identifiers, notice fingerprints and biometric-specific retention automation are implemented.
- [x] Advance remote ticket issuance with arrival confirmation, required mobile contact, private live tracking, idempotent retries, rate limits and kiosk-versus-remote reporting.
- [ ] Queue appointments, scheduled arrival windows and arrival geofencing.
- [ ] Multiple branches, cross-branch routing and central queue supervision.
- [ ] Offline kiosk ticket buffering and printer integration.
- [x] Opt-in browser voice announcements and ARIA live announcements on the public display. SMS updates remain planned.
- [x] Abandonment reporting and accessible graphical daily trends, with date-bounded service rates, outcome summaries, tabular equivalents and CSV outcome classification.

## 9. Visitor badges

- [x] Printable badges.
- [x] Company branding and visitor name.
- [x] Host, destination and visit date.
- [x] Badge expiry time when an expected departure is recorded.
- [ ] Controlled QR lookup/check-out.
- [ ] Category-specific badge designs.
- [ ] Optional visitor photograph.
- [ ] Badge printer integration.
- [ ] Reprint audit history.
- [ ] Physical badge issuance and return tracking.
- [ ] Lost-badge records.
- [x] Minimise sensitive badge information.

## 10. Safety and on-site accountability

- [x] Dedicated live occupancy list.
- [ ] Building/floor occupancy.
- [x] Emergency evacuation roll call with a fixed occupancy snapshot.
- [x] Mark visitors accounted for, left site, or unaccounted.
- [x] Printable emergency roster.
- [x] Restricted assistance-needs information.
- [x] Escort requirements.
- [x] Assigned escorts.
- [x] Safety induction acknowledgements.
- [ ] Visit-linked incident reports.
- [x] Configurable on-site capacity alert.
- [ ] Distinguish reception records from verified physical entry.

## 11. Contractor management

- [ ] Contractor company profiles.
- [ ] Approved work dates and hours.
- [ ] Assigned work locations.
- [ ] Site induction completion.
- [ ] Documents and qualifications.
- [ ] Document expiry reminders.
- [ ] Permit-to-work references.
- [ ] Supervisor information.
- [ ] Equipment brought on-site.
- [ ] Contractor-specific approvals.
- [ ] Separate contractor reporting.

## 12. Privacy and record handling

- [x] Configurable registration privacy notice.
- [ ] Review data collection for necessity.
- [x] Configurable retention periods.
- [x] Automatic and administrator-triggered anonymisation with preview. Deletion remains intentionally unsupported.
- [x] Role-based restriction of visitor contact details and internal notes.
- [x] Export permissions.
- [x] Detail access and export audit events.
- [ ] Formal data access, correction and deletion procedures.
- [ ] HTTPS for shared deployment.
- [ ] Encryption and access protection for stored data and backups.
- [ ] Visitor-visible information separate from internal notes.
- [ ] Review applicable regional privacy requirements before deployment.

## 13. Database and reliability

- [x] Transactional database replacing JSON storage.
- [x] Search indexes.
- [x] Versioned schema and JSON migration.
- [x] Visit-state consistency rules.
- [x] Idempotent check-in retry handling.
- [x] Concurrent-edit conflict handling.
- [x] Automatic backups.
- [x] Tested restoration.
- [x] Corruption detection and recovery documentation.
- [ ] Disk-full and write-failure fault testing.
- [x] Health endpoint.
- [x] Graceful shutdown.
- [x] Error logs without visitor payloads or credentials.
- [ ] Automatic startup after machine restart.

## 14. Security hardening

- [x] Server-side authorisation on each operation.
- [x] Authentication rate limiting.
- [ ] General API rate limiting.
- [x] Request-size limits and strict input validation.
- [x] Secure session handling.
- [x] Forged-request protection for authenticated writes.
- [ ] Upload security when attachments are introduced.
- [x] Password hashing and credential handling.
- [x] Administrative and visitor audit events.
- [x] Access-control and data-exposure tests.
- [ ] Runtime/dependency update procedure.
- [ ] Shared-service secure deployment configuration.
- [ ] Separate development, test and production environments.

## 15. Reporting and analytics

- [ ] Daily, weekly and monthly totals.
- [ ] Busiest arrival times.
- [ ] Duration by purpose/department.
- [ ] Most-visited hosts.
- [ ] New/returning visitor reporting.
- [ ] Expected versus actual arrivals.
- [x] No-show, cancellation and combined queue-abandonment rates.
- [x] Queue waiting time before service, by service and exported ticket.
- [ ] Overdue visit reports.
- [ ] Occupancy trends.
- [ ] Location/category reports.
- [x] Downloadable CSV queue reports. Printable visitor-management reports remain planned.
- [ ] Scheduled reports.
- [ ] Dashboard widgets.
- [x] Metric definitions.

## 16. CSV import and export

- [ ] Visitor import.
- [ ] Import preview.
- [ ] Row validation and clear errors.
- [ ] Duplicate detection during import.
- [ ] Choose export fields.
- [x] Permission-aware server-side export.
- [x] Consistent timezone/date formats.
- [x] Export audit events.
- [ ] Streaming/background exports for very large datasets.
- [ ] Employee and appointment import/export.

## 17. Multiple sites and offices

- [ ] Locations, buildings and reception desks.
- [ ] Location-scoped permissions.
- [ ] Opening hours and holidays.
- [ ] Location timezones.
- [ ] Site-specific forms and policies.
- [ ] Central multi-site dashboard.
- [ ] Shared/separate visitor directories.
- [ ] Inter-site movement tracking.
- [ ] Site-specific badges and notifications.

## 18. Integrations

- [ ] Company calendars.
- [ ] Employee directories.
- [ ] Email services.
- [ ] SMS providers.
- [ ] Workplace messaging.
- [ ] Room booking systems.
- [ ] Access control/turnstiles.
- [ ] Parking systems.
- [ ] Badge printers and scanners.
- [ ] CRM systems.
- [ ] Documented integration API.
- [ ] Arrival/approval/departure webhooks.
- [ ] Integration monitoring and retries.

## 19. Accessibility and localisation

- [ ] Screen-reader testing.
- [ ] Full keyboard navigation review.
- [ ] Visible keyboard focus review.
- [x] Status labels independent of colour.
- [ ] Contrast audit.
- [ ] Accessible validation errors.
- [ ] Zoom and large-text testing.
- [ ] Reduced motion preference.
- [ ] Multiple interface languages. English, Afrikaans and isiZulu are implemented for the public kiosk and private tracking flow; staff workspace localisation remains planned.
- [ ] Local date, time and phone formatting.
- [x] Explicit timezone label.
- [ ] Long-name and international-character testing.

## 20. Testing and operations

- [x] Automated browser reception workflow tests.
- [x] Search, filter and export tests.
- [x] Overnight and timezone-boundary tests.
- [x] Simultaneous-user tests.
- [ ] Failed-save and interrupted-server tests.
- [x] Authentication and permission tests.
- [ ] Automated accessibility checks.
- [ ] Large-history performance testing.
- [x] Backup restoration tests.
- [ ] Release automation/CI.
- [x] Installation and deployment instructions.
- [x] Administrator settings page.
- [ ] Operational monitoring and alerts.
- [x] Reception training guide.
- [ ] Clearly fictional demo mode.

## Implementation notes

- [x] Split the Angular-bundled workspace controller into typed Angular feature components, reactive forms, routes and API services. Angular owns the production interface; no runtime legacy endpoint remains.
  - [x] Typed Angular HTTP API and session services.
  - [x] Angular-owned application startup and session restoration.
  - [x] Guarded, lazy-loaded authentication and workspace routes.
  - [x] Reactive first-administrator setup and sign-in form with accessible validation.
  - [x] Typed visitor data service for lists, statistics, facets, detail, check-in, correction, checkout and export.
  - [x] Typed Angular operations service for appointments, profiles, employees, accounts, safety, audit, backups, settings and retention.
  - [x] Native Angular visitor list foundation with signals, filters, statistics, pagination and checkout.
  - [x] Native reactive visitor check-in/detail/correction form with profiles, host selection and configured required fields.
  - [x] Native Angular workspace shell and role-aware navigation foundation.
  - [x] Native employee directory and reactive create/edit form.
  - [x] Native expected-visitor list, reactive scheduling/edit form and arrival/cancellation/no-show lifecycle.
  - [x] Native administrator account list and reactive create/edit/password-reset form.
  - [x] Native live safety roster and evacuation roll-call workflow.
  - [x] Native audit log with search and pagination.
  - [x] Native backup creation, listing and authenticated download.
  - [x] Native reactive workspace settings and retention workflow.
  - [x] Angular password-change dialog, session polling and administrator route guards.
  - [x] Angular workspace navigation and layout component.
  - [x] Angular visitor dashboard, history, filters and pagination.
  - [x] Angular visitor check-in, detail, correction, checkout and badge components.
  - [x] Angular appointments and returning-visitor components.
  - [x] Angular employee and account administration components.
  - [x] Angular safety roster and evacuation components.
  - [x] Angular audit, backup and settings components.
  - [x] Remove the compatibility HTML loader and bundled DOM controller after feature parity.
- Angular migration completed on 2026-10-08. Production now uses standalone lazy-loaded components, typed services, signals and reactive forms only. Validation: production build, Angular unit tests, eleven backend integration suites, and the native Angular browser workflow across desktop/mobile and administrator/host permissions.
- Foundation milestone completed on 2026-10-08. The current combined suite has nine backend integration tests and a real Chrome browser workflow, including mobile overflow and role visibility checks.
- Visitor profiles and expected-arrival milestone completed on 2026-10-08. Validation: nine backend integration tests plus the browser workflow for pre-registration and arrival conversion.
- On-site safety and badge milestone completed on 2026-10-08. Validation: ten backend integration tests and browser coverage for badge preview, the live roster, and evacuation roll call.
- Privacy and workspace-settings milestone completed on 2026-10-08. Validation: eleven backend integration tests and browser coverage for branding/settings updates.
- Permissions cover implemented operations. Visitor deletion is still planned and has no API.
- Login history is recorded in the administrator audit log; suspicious-login notifications remain planned.
- Basic local installation and recovery are documented; shared deployment hardening remains planned.
- Transaction rollback is tested using an injected audit write failure. Full disk-exhaustion and mid-write power-loss fault testing remain planned.
- SQLite indexes cover arrival, departure, host, company and department; free-text search is substring-based rather than a full-text index.

- Biometric verification uses a disabled-by-default provider adapter. It contacts only the explicitly configured HTTPS endpoint; provider selection, credentials and production assessment remain deployment responsibilities.
- Completed foundation items do not imply production certification or completion of unchecked follow-on work.
- The original check-in/check-out, overview, text search, status filters and CSV export form the existing baseline.
