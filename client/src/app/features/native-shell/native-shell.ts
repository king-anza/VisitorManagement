import { Component, computed, ElementRef, inject, OnDestroy, OnInit, signal, ViewChild } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Session } from '../../core/session';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({selector:'app-native-shell',standalone:true,imports:[RouterOutlet,RouterLink,RouterLinkActive,ReactiveFormsModule],templateUrl:'./native-shell.html',styleUrl:'./native-shell.css'})
export class NativeShell implements OnInit,OnDestroy {
  readonly session=inject(Session);private readonly router=inject(Router);private readonly fb=inject(FormBuilder);@ViewChild('passwordDialog')passwordDialog?:ElementRef<HTMLDialogElement>;readonly initial=computed(()=>this.session.user()?.name.trim()[0]?.toUpperCase()||'R');readonly admin=computed(()=>this.session.user()?.role==='admin');readonly passwordError=signal('');readonly passwordBusy=signal(false);readonly passwordForm=this.fb.nonNullable.group({currentPassword:['',Validators.required],password:['',[Validators.required,Validators.minLength(12)]]});private timer?:number;
  ngOnInit():void{this.timer=window.setInterval(()=>void this.checkSession(),30000);}ngOnDestroy():void{clearInterval(this.timer);}
  async logout():Promise<void>{await this.session.logout();await this.router.navigateByUrl('/sign-in');}
  openPassword():void{this.passwordForm.reset();this.passwordError.set('');this.passwordDialog?.nativeElement.showModal();}
  async changePassword():Promise<void>{if(this.passwordForm.invalid){this.passwordForm.markAllAsTouched();return;}this.passwordBusy.set(true);try{const v=this.passwordForm.getRawValue();await this.session.changePassword(v.currentPassword,v.password);this.passwordDialog?.nativeElement.close();}catch(e){const v=e as {error?:{error?:string},message?:string};this.passwordError.set(v?.error?.error||v?.message||'Unable to change password.');}finally{this.passwordBusy.set(false);}}
  private async checkSession():Promise<void>{try{const value=await this.session.load();if(!value.user)await this.router.navigateByUrl('/sign-in');}catch{/* The active screen keeps its last successful data and exposes request errors. */}}
}
