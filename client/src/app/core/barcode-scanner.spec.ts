import { CameraBarcodeScanner } from './barcode-scanner';
import { IdScanner } from './id-scanner';

describe('scanner adapters',()=>{
  it('normalises keyboard-wedge and pasted control characters without changing the payload',()=>{
    const scanner=new IdScanner();
    expect(scanner.normalise('\r\n]C1ABC-123\t')).toBe(']C1ABC-123');
  });

  it('reports an empty format list when native camera detection is unavailable',async()=>{
    const original=(window as unknown as Record<string,unknown>)['BarcodeDetector'];
    delete (window as unknown as Record<string,unknown>)['BarcodeDetector'];
    try{
      const scanner=new CameraBarcodeScanner();
      expect(scanner.supported()).toBe(false);
      await expect(scanner.prepare()).resolves.toEqual([]);
      scanner.stop();
      expect(scanner.active()).toBe(false);
    }finally{if(original)(window as unknown as Record<string,unknown>)['BarcodeDetector']=original;}
  });
});
