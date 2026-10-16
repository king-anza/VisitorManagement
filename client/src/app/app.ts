import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { Session } from './core/session';

@Component({ selector: 'app-root', standalone: true, imports: [RouterOutlet], templateUrl: './app.html', styleUrl: './app.css' })
export class App implements OnInit {
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  readonly loading = signal(true);
  readonly startupError = signal('');
  private readonly requestedPath=window.location.pathname;

  async ngOnInit(): Promise<void> {
    try {
      const value = await this.session.load();
      const requested=this.requestedPath,publicRoute=requested.startsWith('/kiosk')||requested.startsWith('/join-queue')||requested.startsWith('/queue-display')||requested.startsWith('/ticket/');
      if(!publicRoute)await this.router.navigateByUrl(value.user ? requested : '/sign-in');
    } catch (error) {
      this.startupError.set(error instanceof Error ? error.message : 'The reception server could not be reached.');
    } finally {
      this.loading.set(false);
    }
  }
}
