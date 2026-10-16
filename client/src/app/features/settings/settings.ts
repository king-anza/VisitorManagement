import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RetentionPreview } from '../../core/models';
import { Operations } from '../../core/operations';
import { Session } from '../../core/session';

@Component({selector:'app-settings',standalone:true,imports:[ReactiveFormsModule],templateUrl:'./settings.html',styleUrl:'./settings.css'})
export class Settings implements OnInit {
  private readonly api=inject(Operations);
  private readonly fb=inject(FormBuilder);
  private readonly session=inject(Session);
  readonly retention=signal<RetentionPreview|null>(null);
  readonly error=signal('');
  readonly message=signal('');
  readonly busy=signal(false);
  readonly form=this.fb.nonNullable.group({
    organisationName:['',Validators.required],siteName:['',Validators.required],
    privacyNotice:['',Validators.required],biometricNotice:['',Validators.required],
    categories:['',Validators.required],company:[false],email:[false],phone:[false],
    destination:[false],expectedDeparture:[false],vehicle:[false],
    capacityLimit:[250,[Validators.required,Validators.min(1),Validators.max(100000)]],
    retentionDays:[365,[Validators.required,Validators.min(30),Validators.max(3650)]],
    queueRetentionDays:[90,[Validators.required,Validators.min(1),Validators.max(3650)]],
    kioskTimeoutSeconds:[120,[Validators.required,Validators.min(30),Validators.max(1800)]]
  });

  async ngOnInit():Promise<void>{await this.load();}
  async load():Promise<void>{
    try{
      const [s,r]=await Promise.all([this.api.settings(),this.api.retention()]);
      const required=new Set(s.requiredFields);
      this.form.reset({
        organisationName:s.organisationName,siteName:s.siteName,privacyNotice:s.privacyNotice,
        biometricNotice:s.biometricNotice||'Biometric verification is optional. You may choose manual assistance instead.',
        categories:s.categories.join('\n'),company:required.has('company'),email:required.has('email'),
        phone:required.has('phone'),destination:required.has('destination'),
        expectedDeparture:required.has('expectedDeparture'),vehicle:required.has('vehicle'),
        capacityLimit:s.capacityLimit,retentionDays:s.retentionDays||365,queueRetentionDays:s.queueRetentionDays||90,kioskTimeoutSeconds:s.kioskTimeoutSeconds||120
      });
      this.retention.set(r);
    }catch(e){this.fail(e);}
  }
  async save():Promise<void>{
    if(this.form.invalid){this.form.markAllAsTouched();return;}
    this.busy.set(true);this.error.set('');
    try{
      const v=this.form.getRawValue();
      const fields=['company','email','phone','destination','expectedDeparture','vehicle'].filter(k=>v[k as keyof typeof v]===true);
      const saved=await this.api.saveSettings({
        organisationName:v.organisationName,siteName:v.siteName,privacyNotice:v.privacyNotice,
        biometricNotice:v.biometricNotice,categories:v.categories.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),
        requiredFields:fields,capacityLimit:v.capacityLimit,retentionDays:v.retentionDays,queueRetentionDays:v.queueRetentionDays,kioskTimeoutSeconds:v.kioskTimeoutSeconds
      });
      this.session.settings.set(saved);this.message.set('Workspace settings saved.');await this.load();
    }catch(e){this.fail(e);}finally{this.busy.set(false);}
  }
  async runRetention():Promise<void>{
    if(!confirm('Permanently anonymise all eligible completed visitor records?'))return;
    this.busy.set(true);
    try{const result=await this.api.runRetention() as {anonymized:number;queueAnonymized?:number};this.message.set(`${result.anonymized} visitor records and ${result.queueAnonymized||0} queue tickets anonymised.`);await this.load();}
    catch(e){this.fail(e);}finally{this.busy.set(false);}
  }
  private fail(e:unknown):void{const v=e as {error?:{error?:string},message?:string};this.error.set(v?.error?.error||v?.message||'Unable to update settings.');}
}
