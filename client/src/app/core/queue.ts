import { inject, Injectable } from '@angular/core';
import { Api } from './api';
import { KioskConfig, QueueNotificationStatus, QueueReport, QueueService, QueueStat, QueueTicket, QueueTracking } from './models';
type Payload=Record<string,unknown>;
@Injectable({providedIn:'root'}) export class QueueApi{
 private readonly api=inject(Api);
 kioskConfig():Promise<KioskConfig>{return this.api.get('/api/kiosk/config');}
 verifyBiometric(image:string,identification:string,consent:boolean):Promise<{verified:true;token:string;expiresInSeconds:number}>{return this.api.post('/api/kiosk/biometric/verify',{image,identification,consent});}
 join(value:Payload):Promise<QueueTicket>{return this.api.post('/api/kiosk/tickets',value);}
 remoteJoin(value:Payload):Promise<QueueTicket>{return this.api.post('/api/public/queue/tickets',value);}
 track(id:string,token:string):Promise<QueueTracking>{return this.api.get(`/api/kiosk/tickets/${id}/status?${new URLSearchParams({token})}`);}
 cancelTracked(id:string,token:string):Promise<QueueTracking>{return this.api.post(`/api/kiosk/tickets/${id}/status`,{token});}
 display():Promise<Array<Pick<QueueTicket,'ticketNumber'|'status'|'desk'|'serviceName'>>>{return this.api.get('/api/kiosk/display');}
 services():Promise<QueueService[]>{return this.api.get('/api/queue/services');}
 saveService(value:Payload,id?:string):Promise<QueueService>{return id?this.api.put(`/api/queue/services/${id}`,value):this.api.post('/api/queue/services',value);}
 availability(service:QueueService,acceptingTickets:boolean,reason=''):Promise<QueueService>{return this.api.post(`/api/queue/services/${service.id}/availability`,{version:service.version,acceptingTickets,reason});}
 tickets(status='active'):Promise<QueueTicket[]>{return this.api.get(`/api/queue/tickets?${new URLSearchParams({status})}`);}
 next(serviceId:string,desk:string):Promise<QueueTicket>{return this.api.post('/api/queue/next',{serviceId,desk});}
 action(ticket:QueueTicket,action:'start'|'complete'|'cancel'|'no-show'|'recall'|'transfer',extra:Payload={}):Promise<QueueTicket>{return this.api.post(`/api/queue/tickets/${ticket.id}/${action}`,{version:ticket.version,...extra});}
 stats():Promise<QueueStat[]>{return this.api.get('/api/queue/stats');}
 notifications():Promise<QueueNotificationStatus>{return this.api.get('/api/queue/notifications');}
 retryNotifications():Promise<{queued:number}>{return this.api.post('/api/queue/notifications/retry',{});}
 report(from:string,to:string):Promise<QueueReport>{return this.api.get(`/api/queue/report?${new URLSearchParams({from,to})}`);}
 reportExport(from:string,to:string):Promise<Blob>{return this.api.blob(`/api/queue/report/export?${new URLSearchParams({from,to})}`);}
}
