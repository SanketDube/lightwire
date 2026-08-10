const {PNG}=require('pngjs');
const fs=require('fs');
const {MultiFormatReader,BarcodeFormat,DecodeHintType,RGBLuminanceSource,BinaryBitmap,HybridBinarizer}=require('@zxing/library');
const C=require('../src/core.js');
const hints=new Map([[DecodeHintType.POSSIBLE_FORMATS,[BarcodeFormat.QR_CODE]],[DecodeHintType.TRY_HARDER,true]]);
const reader=new MultiFormatReader(); reader.setHints(hints);
const out=[];
for(let i=0;;i++){
  const f='cell'+i+'.png';
  if(!fs.existsSync(f)) break;
  const png=PNG.sync.read(fs.readFileSync(f));
  const lum=new Uint8ClampedArray(png.width*png.height);
  for(let p=0,j=0;p<png.data.length;p+=4,j++) lum[j]=(png.data[p]*299+png.data[p+1]*587+png.data[p+2]*114)/1000;
  try{
    const res=reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum,png.width,png.height))));
    const bytes=C.base45Decode(res.getText());
    const h=C.parseHeader(bytes);
    out.push({i,ok:true,seed:h&&h.seed,session:h&&h.session,blockSize:h&&h.blockSize});
  }catch(e){ out.push({i,ok:false,err:e.message||String(e)}); }
  reader.reset();
}
const okAll=out.every(o=>o.ok);
const seeds=out.map(o=>o.seed);
console.log(JSON.stringify(out));
console.log('allValid:',okAll,'distinctSeeds:',new Set(seeds).size===seeds.length,
  'sameSession:',new Set(out.map(o=>o.session)).size===1);
process.exit(okAll?0:1);
