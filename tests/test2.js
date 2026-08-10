const C = require('../src/core.js');
const crypto = require('crypto');

(async()=>{
  // 1) flags survive the header roundtrip
  const file=new Uint8Array(crypto.randomBytes(5000));
  const c=C.buildContainer('a.bin','application/octet-stream',file);
  const enc=C.makeEncoder(c,600,777,C.FLAG_ENC|C.FLAG_GZ);
  const h=C.parseHeader(enc.frame(1));
  console.log('flags roundtrip:', h.flags===(C.FLAG_ENC|C.FLAG_GZ), 'ver-1 frames rejected:', C.parseHeader(new Uint8Array(20))===null);

  // 2) gzip roundtrip + it actually shrinks text
  const text=new TextEncoder().encode('SELECT * FROM ledger WHERE status="pending";\n'.repeat(400));
  const gz=await C.gzipBytes(text);
  const back=await C.gunzipBytes(gz);
  console.log('gzip:', gz.length, '<', text.length, 'roundtrip:', Buffer.compare(Buffer.from(back),Buffer.from(text))===0);

  // 3) encrypt/decrypt roundtrip; wrong passphrase must throw
  const ct=await C.encryptBytes('tiger-42',text);
  const pt=await C.decryptBytes('tiger-42',ct);
  let wrongThrew=false;
  try{ await C.decryptBytes('tiger-43',ct); }catch(e){ wrongThrew=true; }
  console.log('aes-gcm:', Buffer.compare(Buffer.from(pt),Buffer.from(text))===0, 'wrong-pass throws:', wrongThrew, 'ct-overhead:', ct.length-text.length);

  // 4) full pipeline: container -> gzip -> encrypt -> fountain @30% loss -> decrypt -> gunzip -> open
  const bigText=new TextEncoder().encode(JSON.stringify({rows:Array.from({length:3000},(_,i)=>({i,v:'invoice-'+i}))}));
  const cont=C.buildContainer('ledger.json','application/json',bigText);
  let payload=await C.gzipBytes(cont); let flags=C.FLAG_GZ;
  payload=await C.encryptBytes('hunter2',payload); flags|=C.FLAG_ENC;
  const session=(Math.random()*4294967295)>>>0;
  const e2=C.makeEncoder(payload,600,session,flags);
  const d2=C.makeDecoder(session,payload.length,600);
  let seed=1,sent=0;
  while(!d2.isDone()){
    const f=e2.frame(seed++); sent++;
    if(Math.random()<0.3) continue;
    d2.push(C.base45Decode(C.base45Encode(f)));
    if(sent>e2.K*30) throw new Error('no convergence');
  }
  const hh=C.parseHeader(e2.frame(999999));
  let buf=d2.assemble();
  if(hh.flags&C.FLAG_ENC) buf=await C.decryptBytes('hunter2',buf);
  if(hh.flags&C.FLAG_GZ) buf=await C.gunzipBytes(buf);
  const out=C.openContainer(buf);
  const same=Buffer.compare(Buffer.from(out.data),Buffer.from(bigText))===0;
  console.log('pipeline:', 'orig='+cont.length, 'wire='+payload.length, 'K='+e2.K, 'sent='+sent,
    'crc='+out.ok, 'bytes='+same, 'name='+out.meta.n);
  console.log('compression win:', (100*payload.length/cont.length).toFixed(0)+'% of original on the wire');

  // 5) sha256 helper matches node's
  const mine=await C.sha256Hex(file);
  const ref=crypto.createHash('sha256').update(file).digest('hex');
  console.log('sha256:', mine===ref);
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
