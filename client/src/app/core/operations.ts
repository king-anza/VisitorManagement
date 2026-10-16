import { inject, Injectable } from '@angular/core';
import { Api } from './api';
import { Appointment, AuditEntry, Backup, Emergency, EmergencyVisitor, Employee, Page, PublicSettings, RetentionPreview, Visitor, VisitorProfile, WorkspaceUser } from './models';

type Payload = Record<string, unknown>;
@Injectable({ providedIn: 'root' })
export class Operations {
  private readonly api = inject(Api);
  profiles(q:string):Promise<VisitorProfile[]>{return this.api.get(`/api/visitor-profiles?${new URLSearchParams({q})}`);}
  appointments(status='all'):Promise<Appointment[]>{return this.api.get(`/api/appointments?${new URLSearchParams({status})}`);}
  saveAppointment(value:Payload,id?:string):Promise<Appointment>{return id?this.api.put(`/api/appointments/${id}`,value):this.api.post('/api/appointments',value);}
  appointmentAction(item:Appointment,action:'arrive'|'cancel'|'no-show',extra:Payload={}):Promise<Appointment|Visitor>{return this.api.post(`/api/appointments/${item.id}/${action}`,{version:item.version,...extra});}
  employees():Promise<Employee[]>{return this.api.get('/api/employees');}
  saveEmployee(value:Payload,id?:string):Promise<Employee>{return id?this.api.put(`/api/employees/${id}`,value):this.api.post('/api/employees',value);}
  users():Promise<WorkspaceUser[]>{return this.api.get('/api/users');}
  saveUser(value:Payload,id?:string):Promise<WorkspaceUser>{return id?this.api.put(`/api/users/${id}`,value):this.api.post('/api/users',value);}
  onsite():Promise<Visitor[]>{return this.api.get('/api/safety/onsite');}
  emergencies():Promise<Emergency[]>{return this.api.get('/api/emergencies');}
  startEmergency(name:string):Promise<Emergency>{return this.api.post('/api/emergencies',{name});}
  closeEmergency(item:Emergency,confirmUnaccounted:boolean):Promise<Emergency>{return this.api.post(`/api/emergencies/${item.id}/close`,{confirmUnaccounted});}
  updateRollcall(emergencyId:string,visitorId:string,status:EmergencyVisitor['status'],notes=''):Promise<EmergencyVisitor>{return this.api.put(`/api/emergencies/${emergencyId}/visitors/${visitorId}`,{status,notes});}
  audit(page:number,q:string):Promise<Page<AuditEntry>>{return this.api.get(`/api/audit?${new URLSearchParams({page:String(page),q})}`);}
  backups():Promise<Backup[]>{return this.api.get('/api/backups');}
  createBackup():Promise<Backup>{return this.api.post('/api/backups');}
  downloadBackup(name:string):Promise<Blob>{return this.api.blob(`/api/backups/${encodeURIComponent(name)}`);}
  settings():Promise<PublicSettings>{return this.api.get('/api/settings');}
  saveSettings(value:Payload):Promise<PublicSettings>{return this.api.put('/api/settings',value);}
  retention():Promise<RetentionPreview>{return this.api.get('/api/retention/preview');}
  runRetention():Promise<{anonymized:number}>{return this.api.post('/api/retention/run',{confirm:true});}
}
