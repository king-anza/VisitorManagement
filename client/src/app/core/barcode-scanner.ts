import { Injectable, signal } from '@angular/core';

interface BarcodeResult { rawValue?:string; format?:string; }
interface BarcodeDetectorInstance { detect(source:HTMLVideoElement):Promise<BarcodeResult[]>; }
interface BarcodeDetectorConstructor {
  new(options?:{formats?:string[]}):BarcodeDetectorInstance;
  getSupportedFormats?():Promise<string[]>;
}

@Injectable({providedIn:'root'})
export class CameraBarcodeScanner {
  readonly active=signal(false);
  readonly error=signal('');
  readonly formats=signal<string[]>([]);
  private stream?:MediaStream;
  private detector?:BarcodeDetectorInstance;
  private frame?:number;
  private scanning=false;

  supported():boolean{return typeof window!=='undefined'&&'BarcodeDetector'in window&&!!navigator.mediaDevices?.getUserMedia;}

  async prepare():Promise<string[]>{
    if(!this.supported()){this.formats.set([]);return [];}
    const Type=(window as unknown as {BarcodeDetector:BarcodeDetectorConstructor}).BarcodeDetector;
    const supported=Type.getSupportedFormats?await Type.getSupportedFormats():['qr_code'];
    const preferred=['qr_code','pdf417','code_128','code_39','ean_13','data_matrix'].filter(format=>supported.includes(format));
    this.formats.set(preferred);return preferred;
  }

  async start(video:HTMLVideoElement,onResult:(value:string,format:string)=>void):Promise<void>{
    this.stop();this.error.set('');
    try{
      const formats=await this.prepare();if(!formats.length)throw new Error('Camera barcode scanning is not supported by this browser. Use a keyboard-style scanner or enter the number.');
      const Type=(window as unknown as {BarcodeDetector:BarcodeDetectorConstructor}).BarcodeDetector;
      this.detector=new Type({formats});
      this.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
      video.srcObject=this.stream;await video.play();this.active.set(true);
      const scan=async()=>{if(!this.active()||!this.detector)return;if(!this.scanning&&video.readyState>=2){this.scanning=true;try{const results=await this.detector.detect(video),match=results.find(item=>item.rawValue?.trim());if(match){onResult(match.rawValue!.trim(),match.format||'barcode');this.stop();return;}}catch{/* Frames can be temporarily unavailable while the camera starts. */}finally{this.scanning=false;}}if(this.active())this.frame=requestAnimationFrame(scan);};
      this.frame=requestAnimationFrame(scan);
    }catch(error){this.stop();const name=(error as DOMException)?.name;this.error.set(name==='NotAllowedError'?'Camera permission was declined. Allow access or use a keyboard-style scanner.':error instanceof Error?error.message:'Unable to start the barcode scanner.');}
  }

  stop():void{this.active.set(false);if(this.frame)cancelAnimationFrame(this.frame);this.frame=undefined;this.stream?.getTracks().forEach(track=>track.stop());this.stream=undefined;this.detector=undefined;this.scanning=false;}
}
