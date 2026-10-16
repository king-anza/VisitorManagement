import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Session } from './session';

export const authGuard: CanActivateFn = () => inject(Session).authenticated() || inject(Router).createUrlTree(['/sign-in']);
export const guestGuard: CanActivateFn = () => !inject(Session).authenticated() || inject(Router).createUrlTree(['/']);
export const adminGuard: CanActivateFn = () => inject(Session).user()?.role==='admin' || inject(Router).createUrlTree(['/native/visitors']);
