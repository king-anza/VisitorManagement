import { computed, inject, Injectable, signal } from '@angular/core';
import { Api } from './api';
import { SessionResponse, WorkspaceUser } from './models';
@Injectable({providedIn:'root'})
export class Session {
  private readonly api=inject(Api); readonly user=signal<WorkspaceUser|null>(null); readonly settings=signal<SessionResponse['settings']|null>(null); readonly setupRequired=signal(false); readonly authenticated=computed(()=>!!this.user());
  async load():Promise<SessionResponse>{const value=await this.api.get<SessionResponse>('/api/auth/session');this.apply(value);return value;}
  async login(username:string,password:string):Promise<void>{const value=await this.api.post<Pick<SessionResponse,'user'|'csrf'>>('/api/auth/login',{username,password});this.user.set(value.user);this.api.csrf.set(value.csrf);await this.load();}
  async setup(name:string,username:string,password:string):Promise<void>{const value=await this.api.post<Pick<SessionResponse,'user'|'csrf'>>('/api/auth/setup',{name,username,password});this.user.set(value.user);this.api.csrf.set(value.csrf);await this.load();}
  async logout():Promise<void>{await this.api.post('/api/auth/logout');this.user.set(null);this.api.csrf.set(null);}
  async changePassword(currentPassword:string,password:string):Promise<void>{const value=await this.api.post<Pick<SessionResponse,'user'|'csrf'>>('/api/auth/password',{currentPassword,password});this.user.set(value.user);this.api.csrf.set(value.csrf);}
  private apply(value:SessionResponse):void{this.user.set(value.user);this.settings.set(value.settings);this.setupRequired.set(value.setupRequired);this.api.csrf.set(value.csrf);}
}
