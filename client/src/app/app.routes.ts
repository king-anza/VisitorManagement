import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/session.guard';

export const routes: Routes = [
  { path: 'kiosk', loadComponent: () => import('./features/kiosk/kiosk').then(m => m.Kiosk) },
  { path: 'join-queue', loadComponent: () => import('./features/remote-queue/remote-queue').then(m => m.RemoteQueue) },
  { path: 'queue-display', loadComponent: () => import('./features/queue-display/queue-display').then(m => m.QueueDisplay) },
  { path: 'ticket/:id', loadComponent: () => import('./features/ticket-status/ticket-status').then(m => m.TicketStatus) },
  { path: 'sign-in', canActivate: [guestGuard], loadComponent: () => import('./features/auth/auth').then(m => m.Auth) },
  { path: 'native', canActivate: [authGuard], loadComponent: () => import('./features/native-shell/native-shell').then(m => m.NativeShell), children: [
    { path: 'visitors', loadComponent: () => import('./features/visitors/visitors').then(m => m.Visitors) },
    { path: 'employees', loadComponent: () => import('./features/employees/employees').then(m => m.Employees) },
    { path: 'appointments', loadComponent: () => import('./features/appointments/appointments').then(m => m.Appointments) },
    { path: 'users', canActivate:[adminGuard], loadComponent: () => import('./features/users/users').then(m => m.Users) },
    { path: 'safety', loadComponent: () => import('./features/safety/safety').then(m => m.Safety) },
    { path: 'queue', loadComponent: () => import('./features/queue/queue').then(m => m.Queue) },
    { path: 'audit', canActivate:[adminGuard], loadComponent: () => import('./features/audit/audit').then(m => m.Audit) },
    { path: 'backups', canActivate:[adminGuard], loadComponent: () => import('./features/backups/backups').then(m => m.Backups) },
    { path: 'settings', canActivate:[adminGuard], loadComponent: () => import('./features/settings/settings').then(m => m.Settings) },
    { path: '', pathMatch: 'full', redirectTo: 'visitors' }
  ] },
  { path: '', pathMatch: 'full', redirectTo: 'native' },
  { path: '**', redirectTo: '' }
];
