import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Session } from '../../core/session';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule],
  selector: 'app-auth',
  styleUrl: './auth.css',
  templateUrl: './auth.html',
})
export class Auth {
  private readonly fb = inject(FormBuilder);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  readonly setup = this.session.setupRequired;
  readonly settings = this.session.settings;
  readonly busy = signal(false);
  readonly error = signal('');
  readonly title = computed(() => this.setup() ? 'Set up your reception.' : 'Welcome back.');
  readonly description = computed(() => this.setup() ? 'Create the first administrator to open your workspace.' : 'Sign in to manage your visitor workspace.');
  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.maxLength(120)]], username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(120)]], password: ['', [Validators.required, Validators.maxLength(128)]]
  });
  async submit(): Promise<void> {
    if (this.setup()) { this.form.controls.password.addValidators(Validators.minLength(12)); this.form.controls.name.addValidators(Validators.required); }
    this.form.updateValueAndValidity();
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.busy.set(true); this.error.set(''); const { name, username, password } = this.form.getRawValue();
    try { if (this.setup()) await this.session.setup(name, username, password); else await this.session.login(username, password); await this.router.navigateByUrl('/'); }
    catch (error) { const value = error as { error?: { error?: string }, message?: string }; this.error.set(value?.error?.error || value?.message || 'Sign in failed.'); }
    finally { this.busy.set(false); }
  }
}
