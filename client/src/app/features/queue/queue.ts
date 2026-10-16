import { Component, computed, ElementRef, inject, OnDestroy, OnInit, signal, ViewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { QueueNotificationStatus, QueueReport, QueueService, QueueStat, QueueTicket } from '../../core/models';
import { QueueApi } from '../../core/queue';
import { Session } from '../../core/session';

@Component({selector:'app-queue',standalone:true,imports:[ReactiveFormsModule,DatePipe,DecimalPipe],templateUrl:'./queue.html',styleUrl:'./queue.css'})
export class Queue implements OnInit,OnDestroy {
  private readonly api=inject(QueueApi);
  private readonly fb=inject(FormBuilder);
  readonly session=inject(Session);
  @ViewChild('serviceDialog') serviceDialog?:ElementRef<HTMLDialogElement>;
  readonly services=signal<QueueService[]>([]);
  readonly tickets=signal<QueueTicket[]>([]);
  readonly stats=signal<QueueStat[]>([]);
  readonly report=signal<QueueReport|null>(null);
  readonly notifications=signal<QueueNotificationStatus|null>(null);
  readonly selectedService=signal<QueueService|null>(null);
  readonly error=signal('');
  readonly busy=signal(false);
  readonly admin=computed(()=>this.session.user()?.role==='admin');
  readonly canRetryNotifications=computed(()=>['admin','receptionist'].includes(this.session.user()?.role||''));
  readonly desk=this.fb.nonNullable.control(localStorage.getItem('queue-desk')||'Reception 1',[Validators.required,Validators.maxLength(120)]);
  readonly reportForm=this.fb.nonNullable.group({from:[this.dateValue(-30)],to:[this.dateValue(1)]});
  readonly serviceForm=this.fb.nonNullable.group({
    name:['',Validators.required],description:[''],
    prefix:['',[Validators.required,Validators.pattern(/^[A-Za-z0-9]{1,6}$/)]],
    active:[true],acceptingTickets:[true],pausedReason:[''],maxWaiting:[100,[Validators.required,Validators.min(1),Validators.max(10000)]],slaMinutes:[30,[Validators.required,Validators.min(1),Validators.max(1440)]],estimatedMinutes:[10,[Validators.required,Validators.min(1),Validators.max(480)]],
    priorityEnabled:[true]
  });
  private timer?:number;

  ngOnInit():void{void this.load();void this.loadReport();this.timer=window.setInterval(()=>void this.load(),10000);}
  ngOnDestroy():void{clearInterval(this.timer);}
  async load():Promise<void>{try{const [services,tickets,stats,notifications]=await Promise.all([this.api.services(),this.api.tickets(),this.api.stats(),this.api.notifications()]);this.services.set(services);this.tickets.set(tickets);this.stats.set(stats);this.notifications.set(notifications);}catch(e){this.fail(e);}}
  async retryNotifications():Promise<void>{try{await this.api.retryNotifications();await this.load();}catch(e){this.fail(e);}}
  async loadReport():Promise<void>{try{const v=this.reportForm.getRawValue();this.report.set(await this.api.report(new Date(v.from+'T00:00:00').toISOString(),new Date(v.to+'T00:00:00').toISOString()));}catch(e){this.fail(e);}}
  async exportReport():Promise<void>{try{const v=this.reportForm.getRawValue(),blob=await this.api.reportExport(new Date(v.from+'T00:00:00').toISOString(),new Date(v.to+'T00:00:00').toISOString()),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='queue-report.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){this.fail(e);}}
  trendHeight(value:number):number{const maximum=Math.max(1,...this.report()?.daily.map(day=>day.total)||[1]);return Math.max(value?6:0,Math.round(value/maximum*100));}
  waiting(serviceId:string):QueueTicket[]{return this.tickets().filter(x=>x.serviceId===serviceId&&x.status==='waiting');}
  active(serviceId:string):QueueTicket[]{return this.tickets().filter(x=>x.serviceId===serviceId&&['called','serving'].includes(x.status));}
  async callNext(service:QueueService):Promise<void>{if(this.desk.invalid){this.desk.markAsTouched();return;}this.busy.set(true);this.error.set('');try{localStorage.setItem('queue-desk',this.desk.value);await this.api.next(service.id,this.desk.value);await this.load();}catch(e){this.fail(e);}finally{this.busy.set(false);}}
  async action(ticket:QueueTicket,action:'start'|'complete'|'cancel'|'no-show'|'recall'):Promise<void>{try{await this.api.action(ticket,action);await this.load();await this.loadReport();}catch(e){this.fail(e);}}
  async transfer(ticket:QueueTicket,event:Event):Promise<void>{const serviceId=(event.target as HTMLSelectElement).value;if(!serviceId)return;try{await this.api.action(ticket,'transfer',{serviceId});await this.load();}catch(e){this.fail(e);}}
  async toggleAvailability(service:QueueService):Promise<void>{const opening=!service.acceptingTickets,reason=opening?'':prompt('Why is this queue being paused? Visitors will see this message.')?.trim();if(!opening&&!reason)return;try{await this.api.availability(service,opening,reason||'');await this.load();}catch(e){this.fail(e);}}
  openService(item:QueueService|null=null):void{this.selectedService.set(item);this.serviceForm.reset({name:item?.name||'',description:item?.description||'',prefix:item?.prefix||'',active:item?!!item.active:true,acceptingTickets:item?!!item.acceptingTickets:true,pausedReason:item?.pausedReason||'',maxWaiting:item?.maxWaiting||100,slaMinutes:item?.slaMinutes||30,estimatedMinutes:item?.estimatedMinutes||10,priorityEnabled:item?!!item.priorityEnabled:true});queueMicrotask(()=>this.serviceDialog?.nativeElement.showModal());}
  async saveService():Promise<void>{if(this.serviceForm.invalid){this.serviceForm.markAllAsTouched();return;}this.busy.set(true);try{const item=this.selectedService(),value:Record<string,unknown>={...this.serviceForm.getRawValue()};if(item)value['version']=item.version;await this.api.saveService(value,item?.id);this.serviceDialog?.nativeElement.close();await this.load();}catch(e){this.fail(e);}finally{this.busy.set(false);}}
  private dateValue(offset:number):string{const d=new Date(Date.now()+offset*86400000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);}
  private fail(e:unknown):void{const v=e as {error?:{error?:string},message?:string};this.error.set(v?.error?.error||v?.message||'Unable to update the queue.');}
}
