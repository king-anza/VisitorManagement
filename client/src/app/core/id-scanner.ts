import { Injectable } from '@angular/core';

export interface ScannerCapabilities { keyboardWedge:true; webHid:boolean; webUsb:boolean; }

@Injectable({providedIn:'root'})
export class IdScanner {
  readonly capabilities:ScannerCapabilities={
    keyboardWedge:true,
    webHid:typeof navigator!=='undefined'&&'hid' in navigator,
    webUsb:typeof navigator!=='undefined'&&'usb' in navigator
  };

  normalise(raw:string):string {
    return raw.replace(/^[\u0000-\u001f]+|[\u0000-\u001f]+$/g,'').trim().slice(0,120);
  }

  fromPaste(event:ClipboardEvent):string {
    return this.normalise(event.clipboardData?.getData('text')||'');
  }
}
