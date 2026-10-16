import { Component, computed, ElementRef, inject, OnDestroy, OnInit, signal, ViewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HostListener } from '@angular/core';
import { CameraCapture } from '../../core/camera';
import { KioskConfig, QueueTicket } from '../../core/models';
import { QueueApi } from '../../core/queue';
import { IdScanner } from '../../core/id-scanner';
import { CameraBarcodeScanner } from '../../core/barcode-scanner';
import { PublicI18n } from '../../core/public-i18n';

@Component({selector:'app-kiosk',standalone:true,imports:[ReactiveFormsModule],templateUrl:'./kiosk.html',styleUrl:'./kiosk.css'})
export class Kiosk implements OnInit,OnDestroy {
  private readonly api=inject(QueueApi);
  private readonly fb=inject(FormBuilder);
  readonly camera=inject(CameraCapture);
  readonly scanner=inject(IdScanner);
  readonly barcode=inject(CameraBarcodeScanner);
  readonly i18n=inject(PublicI18n);
  @ViewChild('video') video?:ElementRef<HTMLVideoElement>;
  @ViewChild('scanVideo') scanVideo?:ElementRef<HTMLVideoElement>;
  @ViewChild('scanDialog') scanDialog?:ElementRef<HTMLDialogElement>;
  readonly config=signal<KioskConfig|null>(null);
  readonly ticket=signal<QueueTicket|null>(null);
  readonly photo=signal('');
  readonly biometricToken=signal('');
  readonly biometricVerified=signal(false);
  readonly error=signal('');
  readonly busy=signal(false);
  readonly scannerReady=signal(false);
  readonly scannedFormat=signal('');
  readonly online=signal(navigator.onLine);
  readonly serverReachable=signal(true);
  readonly secondsRemaining=signal(120);
  readonly available=computed(()=>this.config()?.services.some(service=>!!service.acceptingTickets&&service.waiting<service.maxWaiting)??false);
  readonly form=this.fb.nonNullable.group({serviceId:['',Validators.required],name:['',[Validators.required,Validators.maxLength(120)]],phone:['',[Validators.maxLength(120)]],identification:['',[Validators.maxLength(120)]],priority:[false],notificationConsent:[false],photoConsent:[false],biometricConsent:[false]});
  private lastActivity=Date.now();
  private requestKey='';
  private trackingToken='';
  private ticker?:number;
  private refreshTimer?:number;
  private readonly wentOnline=()=>{this.online.set(true);void this.loadConfig(true);this.activity();};
  private readonly wentOffline=()=>{this.online.set(false);this.serverReachable.set(false);};

  async ngOnInit():Promise<void>{
    window.addEventListener('online',this.wentOnline);window.addEventListener('offline',this.wentOffline);
    await this.loadConfig();
    this.activity();
    this.ticker=window.setInterval(()=>this.updateCountdown(),1000);
    this.refreshTimer=window.setInterval(()=>{if(!this.ticket()&&this.online())void this.loadConfig(true);},30000);
  }
  ngOnDestroy():void{this.camera.stop();this.barcode.stop();clearInterval(this.ticker);clearInterval(this.refreshTimer);window.removeEventListener('online',this.wentOnline);window.removeEventListener('offline',this.wentOffline);}
  @HostListener('document:pointerdown') onPointerActivity():void{this.activity();}
  @HostListener('document:keydown') onKeyboardActivity():void{this.activity();}
  activity():void{this.lastActivity=Date.now();this.secondsRemaining.set(this.config()?.kioskTimeoutSeconds||120);}
  async loadConfig(silent=false):Promise<void>{if(!navigator.onLine){this.online.set(false);this.serverReachable.set(false);return;}try{this.config.set(await this.api.kioskConfig());this.serverReachable.set(true);this.online.set(true);if(!silent)this.error.set('');}catch(e){this.serverReachable.set(false);if(!silent)this.fail(e);}}
  t(key:string,params:Record<string,string|number>={}):string{return this.i18n.t(key,params);}
  changeLanguage(event:Event):void{this.i18n.setLanguage((event.target as HTMLSelectElement).value);this.activity();}
  trackingHref(item:QueueTicket):string{return `/ticket/${item.id}?${new URLSearchParams({token:item.trackingToken||'',lang:this.i18n.language()})}`;}
  async startCamera():Promise<void>{this.activity();if(!this.form.controls.biometricConsent.value){this.error.set(this.t('acceptCamera'));return;}if(this.video)await this.camera.start(this.video.nativeElement);}
  takePhoto():void{this.activity();if(this.video){this.photo.set(this.camera.capture(this.video.nativeElement));this.biometricToken.set('');this.biometricVerified.set(false);this.camera.stop();}}
  async verifyBiometric():Promise<void>{this.activity();if(!this.photo()||!this.form.controls.biometricConsent.value)return;this.busy.set(true);this.error.set('');try{const result=await this.api.verifyBiometric(this.photo(),this.form.controls.identification.value,true);this.biometricToken.set(result.token);this.biometricVerified.set(true);}catch(e){this.fail(e);}finally{this.busy.set(false);}}
  scanned(event:KeyboardEvent):void{this.activity();if(event.key==='Enter'){event.preventDefault();const value=this.scanner.normalise(this.form.controls.identification.value);this.form.controls.identification.setValue(value);this.scannerReady.set(!!value);}}
  pasted(event:ClipboardEvent):void{this.activity();const value=this.scanner.fromPaste(event);if(value){event.preventDefault();this.form.controls.identification.setValue(value);this.scannerReady.set(true);}}
  openCodeScanner():void{this.activity();this.scannedFormat.set('');this.scanDialog?.nativeElement.showModal();queueMicrotask(()=>{if(this.scanVideo)void this.barcode.start(this.scanVideo.nativeElement,(value,format)=>{const normalized=this.scanner.normalise(value);this.form.controls.identification.setValue(normalized);this.scannerReady.set(!!normalized);this.scannedFormat.set(format);this.scanDialog?.nativeElement.close();this.activity();});});}
  closeCodeScanner():void{this.barcode.stop();this.scanDialog?.nativeElement.close();this.activity();}
  async submit():Promise<void>{
    this.activity();if(this.form.invalid){this.form.markAllAsTouched();return;}if(!this.online()||!this.serverReachable()){this.error.set(this.t('offlineSubmit'));return;}
    this.busy.set(true);this.error.set('');this.requestKey||=crypto.randomUUID();this.trackingToken||=crypto.randomUUID();
    try{const value=this.form.getRawValue(),method=this.biometricToken()?'biometric':this.photo()?'camera':value.identification?'card':'manual';const ticket=await this.api.join({...value,verificationMethod:method,biometricConsent:['camera','biometric'].includes(method)?value.biometricConsent:false,biometricToken:this.biometricToken(),requestKey:this.requestKey,trackingToken:this.trackingToken});this.ticket.set(ticket);this.requestKey='';this.trackingToken='';this.camera.stop();this.serverReachable.set(true);}catch(e){this.fail(e);this.serverReachable.set((e as {status?:number}).status!==0&&navigator.onLine);}finally{this.busy.set(false);}
  }
  reset():void{this.ticket.set(null);this.photo.set('');this.biometricToken.set('');this.biometricVerified.set(false);this.scannerReady.set(false);this.scannedFormat.set('');this.requestKey='';this.trackingToken='';this.error.set('');this.form.reset({serviceId:'',name:'',phone:'',identification:'',priority:false,notificationConsent:false,photoConsent:false,biometricConsent:false});this.camera.stop();this.barcode.stop();this.scanDialog?.nativeElement.close();this.activity();void this.loadConfig(true);}
  private updateCountdown():void{if(this.busy())return;const timeout=this.config()?.kioskTimeoutSeconds||120,remaining=Math.max(0,timeout-Math.floor((Date.now()-this.lastActivity)/1000));this.secondsRemaining.set(remaining);if(remaining===0)this.reset();}
  private fail(e:unknown):void{const v=e as {error?:{error?:string},message?:string};this.error.set(v?.error?.error||v?.message||this.t('requestFailed'));}
}
