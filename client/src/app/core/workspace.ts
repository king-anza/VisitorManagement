import { computed, Injectable, signal } from '@angular/core';

export type WorkspaceView='dashboard'|'history'|'appointments'|'safety'|'employees'|'users'|'audit'|'backups'|'settings';
const copy:Record<WorkspaceView,[string,string]>={
  dashboard:['Visitor overview','A little organisation. A better welcome.'],history:['Visitor history','Every arrival and departure, all in one place.'],appointments:['Expected visitors','Prepare arrivals before they reach reception.'],safety:['On-site safety','A live occupancy roster and evacuation roll call.'],employees:['Employee directory','Connect every arrival with the right person.'],users:['Accounts & access','Give each member of your team the access they need.'],audit:['Audit log','A recorded history of changes and sensitive actions.'],backups:['Database backups','Keep a verified recovery copy of your workspace.'],settings:['Workspace settings','Branding, visitor fields, capacity, privacy and retention.']
};
@Injectable({providedIn:'root'})
export class Workspace {
  readonly view=signal<WorkspaceView>('dashboard'); readonly title=computed(()=>copy[this.view()][0]); readonly description=computed(()=>copy[this.view()][1]); readonly busy=signal(false); readonly message=signal(''); readonly error=signal('');
  navigate(view:WorkspaceView):void{this.view.set(view);this.message.set('');this.error.set('');}
  fail(error:unknown):void{const value=error as {error?:{error?:string},message?:string};this.error.set(value?.error?.error||value?.message||'Unable to complete the operation.');}
}
