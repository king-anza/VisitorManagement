import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { QueueTracking } from '../../core/models';
import { QueueApi } from '../../core/queue';
import { PublicI18n } from '../../core/public-i18n';

@Component({selector:'app-ticket-status',standalone:true,templateUrl:'./ticket-status.html',styleUrl:'./ticket-status.css'})
export class TicketStatus implements OnInit,OnDestroy {
  private readonly api=inject(QueueApi);
  private readonly route=inject(ActivatedRoute);
  readonly i18n=inject(PublicI18n);
  readonly ticket=signal<QueueTracking|null>(null);
  readonly error=signal('');
  readonly busy=signal(false);
  private readonly id=this.route.snapshot.paramMap.get('id')||'';
  private readonly token=this.route.snapshot.queryParamMap.get('token')||'';
  private timer?:number;

  ngOnInit():void{const language=this.route.snapshot.queryParamMap.get('lang');if(language)this.i18n.setLanguage(language);void this.load();this.timer=window.setInterval(()=>void this.load(),10000);}
  ngOnDestroy():void{clearInterval(this.timer);}
  t(key:string,params:Record<string,string|number>={}):string{return this.i18n.t(key,params);}
  changeLanguage(event:Event):void{this.i18n.setLanguage((event.target as HTMLSelectElement).value);}
  async load():Promise<void>{try{this.ticket.set(await this.api.track(this.id,this.token));this.error.set('');}catch(e){this.fail(e);clearInterval(this.timer);}}
  async cancel():Promise<void>{if(!confirm(this.t('cancelConfirm')))return;this.busy.set(true);try{this.ticket.set(await this.api.cancelTracked(this.id,this.token));}catch(e){this.fail(e);}finally{this.busy.set(false);}}
  private fail(e:unknown):void{const v=e as {error?:{error?:string},message?:string};this.error.set(v?.error?.error||v?.message||this.t('loadFailed'));}
}
