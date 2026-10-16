import { Component, computed, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { debounceTime } from 'rxjs';
import { Employee, Visitor, VisitorFilters, VisitorQuery, VisitorSort, VisitorStats, VisitorStatus } from '../../core/models';
import { Visitors as VisitorApi } from '../../core/visitors';
import { Session } from '../../core/session';
import { VisitorForm } from './visitor-form';

@Component({selector:'app-visitors',standalone:true,imports:[ReactiveFormsModule,DatePipe,DecimalPipe,VisitorForm],templateUrl:'./visitors.html',styleUrl:'./visitors.css'})
export class Visitors implements OnInit {
  @ViewChild('badgeDialog') private badgeDialog?:ElementRef<HTMLDialogElement>;
  private readonly api=inject(VisitorApi); readonly session=inject(Session);
  readonly items=signal<Visitor[]>([]); readonly stats=signal<VisitorStats>({today:0,inside:0,departed:0,average:null}); readonly total=signal(0); readonly page=signal(1); readonly loading=signal(false); readonly error=signal(''); readonly history=signal(false);
  readonly formOpen=signal(false);readonly selected=signal<Visitor|null>(null);
  readonly badge=signal<Visitor|null>(null);readonly employees=signal<Employee[]>([]);readonly facets=signal<VisitorFilters>({company:[],department:[],purpose:[]});private lastQuery!:VisitorQuery;
  readonly pages=computed(()=>Math.max(1,Math.ceil(this.total()/20))); readonly canEdit=computed(()=>['admin','receptionist'].includes(this.session.user()?.role||'')); readonly canCheckout=computed(()=>['admin','receptionist','security'].includes(this.session.user()?.role||''));
  readonly filter=new FormGroup({q:new FormControl('',{nonNullable:true}),status:new FormControl<VisitorStatus>('all',{nonNullable:true}),sort:new FormControl<VisitorSort>('newest',{nonNullable:true}),from:new FormControl('',{nonNullable:true}),to:new FormControl('',{nonNullable:true}),hostId:new FormControl('',{nonNullable:true}),company:new FormControl('',{nonNullable:true}),department:new FormControl('',{nonNullable:true}),purpose:new FormControl('',{nonNullable:true})});
  ngOnInit():void{this.filter.valueChanges.pipe(debounceTime(250)).subscribe(()=>{this.page.set(1);void this.load();});void this.load();}
  setHistory(value:boolean):void{this.history.set(value);this.page.set(1);void this.load();}
  setStatus(value:VisitorStatus):void{this.filter.controls.status.setValue(value);}
  move(delta:number):void{this.page.update(value=>Math.min(this.pages(),Math.max(1,value+delta)));void this.load();}
  async checkout(visitor:Visitor):Promise<void>{if(!confirm(`Check out ${visitor.name}?`))return;try{await this.api.checkout(visitor);await this.load();}catch(error){this.show(error);}}
  openVisitor(visitor:Visitor|null=null):void{this.selected.set(visitor);this.formOpen.set(true);}
  async saved():Promise<void>{this.formOpen.set(false);await this.load();}
  async export():Promise<void>{try{const blob=await this.api.export(this.lastQuery),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='visitors.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){this.show(error);}}
  printBadge():void{window.print();}
  openBadge(visitor:Visitor):void{this.badge.set(visitor);setTimeout(()=>this.badgeDialog?.nativeElement.showModal());}
  async load():Promise<void>{this.loading.set(true);this.error.set('');try{const now=new Date(),start=new Date(now);start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);const value=this.filter.getRawValue();const query:VisitorQuery={view:this.history()?'history':'dashboard',page:this.page(),status:value.status,sort:value.sort,q:value.q,hostId:value.hostId,company:value.company,department:value.department,purpose:value.purpose};if(this.history()){if(value.from)query.from=new Date(`${value.from}T00:00:00`).toISOString();if(value.to){const through=new Date(`${value.to}T00:00:00`);through.setDate(through.getDate()+1);query.to=through.toISOString();}}else{query.from=start.toISOString();query.to=end.toISOString();}this.lastQuery=query;const [result,stats,employees,facets]=await Promise.all([this.api.list(query),this.api.stats(start.toISOString(),end.toISOString()),this.api.employees(),this.api.filters()]);this.items.set(result.items);this.total.set(result.total);this.page.set(result.page);this.stats.set(stats);this.employees.set(employees);this.facets.set(facets);}catch(error){this.show(error);}finally{this.loading.set(false);}}
  duration(visitor:Visitor):string{const minutes=Math.max(0,Math.floor(((visitor.checkedOut?new Date(visitor.checkedOut):new Date()).getTime()-new Date(visitor.checkedIn).getTime())/60000));return minutes<60?`${minutes} min`:`${Math.floor(minutes/60)}h ${minutes%60}m`;}
  initials(name:string):string{return name.trim().split(/\s+/).slice(0,2).map(value=>value[0]).join('').toUpperCase();}
  private show(error:unknown):void{const value=error as {error?:{error?:string},message?:string};this.error.set(value?.error?.error||value?.message||'Unable to load visitors.');}
}
