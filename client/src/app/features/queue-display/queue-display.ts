import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { QueueTicket } from '../../core/models';
import { QueueApi } from '../../core/queue';

type DisplayTicket=Pick<QueueTicket,'ticketNumber'|'status'|'desk'>&{service:string};

@Component({selector:'app-queue-display',standalone:true,templateUrl:'./queue-display.html',styleUrl:'./queue-display.css'})
export class QueueDisplay implements OnInit,OnDestroy {
  private readonly api=inject(QueueApi);
  readonly items=signal<DisplayTicket[]>([]);
  readonly time=signal(new Date());
  readonly announcements=signal(localStorage.getItem('queue-announcements')==='1');
  readonly announcement=signal('');
  private seen=new Set<string>();
  private timer?:number;

  ngOnInit():void{void this.load();this.timer=window.setInterval(()=>void this.load(),5000);}
  ngOnDestroy():void{clearInterval(this.timer);window.speechSynthesis?.cancel();}
  toggleAnnouncements():void{this.announcements.update(v=>!v);localStorage.setItem('queue-announcements',this.announcements()?'1':'0');if(this.announcements()){const current=this.items().find(x=>x.status==='called');if(current)this.speak(current);}}
  async load():Promise<void>{
    try{
      const next=await this.api.display() as DisplayTicket[];
      if(this.seen.size&&this.announcements())for(const item of next)if(item.status==='called'&&!this.seen.has(item.ticketNumber))this.speak(item);
      this.items.set(next);this.seen=new Set(next.map(x=>x.ticketNumber));this.time.set(new Date());
    }catch{/* Keep the most recent display during a short connection loss. */}
  }
  private speak(item:DisplayTicket):void{const message=`Ticket ${item.ticketNumber.split('').join(' ')}, please proceed to ${item.desk||'the service desk'}.`;this.announcement.set(message);if('speechSynthesis'in window){window.speechSynthesis.cancel();window.speechSynthesis.speak(new SpeechSynthesisUtterance(message));}}
}
