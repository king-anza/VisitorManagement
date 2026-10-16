import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
@Injectable({ providedIn:'root' })
export class Api {
  private readonly http=inject(HttpClient); readonly csrf=signal<string|null>(null);
  get<T>(path:string):Promise<T>{return firstValueFrom(this.http.get<T>(path,{headers:this.headers()}));}
  post<T>(path:string,body:unknown={}):Promise<T>{return firstValueFrom(this.http.post<T>(path,body,{headers:this.headers()}));}
  put<T>(path:string,body:unknown):Promise<T>{return firstValueFrom(this.http.put<T>(path,body,{headers:this.headers()}));}
  blob(path:string):Promise<Blob>{return firstValueFrom(this.http.get(path,{headers:this.headers(),responseType:'blob'}));}
  private headers():HttpHeaders{let value=new HttpHeaders({'X-User-Activity':'1'});const token=this.csrf();return token?value.set('X-CSRF-Token',token):value;}
}
