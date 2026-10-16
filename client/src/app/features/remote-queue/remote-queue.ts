import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { KioskConfig, QueueTicket } from '../../core/models';
import { PublicI18n } from '../../core/public-i18n';
import { QueueApi } from '../../core/queue';

@Component({selector:'app-remote-queue',standalone:true,imports:[ReactiveFormsModule],templateUrl:'./remote-queue.html',styleUrl:'./remote-queue.css'})
export class RemoteQueue implements OnInit{
  private readonly api=inject(QueueApi);private readonly fb=inject(FormBuilder);readonly i18n=inject(PublicI18n);
  readonly config=signal<KioskConfig|null>(null);readonly ticket=signal<QueueTicket|null>(null);readonly busy=signal(false);readonly error=signal('');
  readonly available=computed(()=>this.config()?.services.some(service=>!!service.acceptingTickets&&service.waiting<service.maxWaiting)??false);
  readonly form=this.fb.nonNullable.group({serviceId:['',Validators.required],name:['',[Validators.required,Validators.maxLength(120)]],phone:['',[Validators.required,Validators.maxLength(120)]],priority:[false],notificationConsent:[false],arrivalConfirmed:[false,Validators.requiredTrue]});
  private requestKey='';private trackingToken='';
  ngOnInit():void{void this.load();}
  t(key:string,params:Record<string,string|number>={}):string{return this.i18n.t(key,params);}
  changeLanguage(event:Event):void{this.i18n.setLanguage((event.target as HTMLSelectElement).value);}
  async load():Promise<void>{try{this.config.set(await this.api.kioskConfig());this.error.set('');}catch(e){this.fail(e);}}
  async submit():Promise<void>{if(this.form.invalid){this.form.markAllAsTouched();return;}this.busy.set(true);this.error.set('');this.requestKey||=crypto.randomUUID();this.trackingToken||=crypto.randomUUID();try{this.ticket.set(await this.api.remoteJoin({...this.form.getRawValue(),requestKey:this.requestKey,trackingToken:this.trackingToken}));this.requestKey='';this.trackingToken='';}catch(e){this.fail(e);}finally{this.busy.set(false);}}
  trackingHref(item:QueueTicket):string{return `/ticket/${item.id}?${new URLSearchParams({token:item.trackingToken||'',lang:this.i18n.language()})}`;}
  reset():void{this.ticket.set(null);this.error.set('');this.form.reset({serviceId:'',name:'',phone:'',priority:false,notificationConsent:false,arrivalConfirmed:false});void this.load();}
  private fail(e:unknown):void{const v=e as {error?:{error?:string},message?:string};this.error.set(v?.error?.error||v?.message||this.t('remoteUnavailable'));}
}
