const C = require('../src/core.js');
const qrcode = require('../src/vendor/qrcode-generator.js');
const crypto = require('crypto');

function run(size, blockSize, loss, label){
  const file = crypto.randomBytes(size);
  const fileArr = new Uint8Array(file);
  const container = C.buildContainer('report.pdf','application/pdf',fileArr);
  const session = (Math.random()*4294967295)>>>0;
  const enc = C.makeEncoder(container, blockSize, session);
  const dec = C.makeDecoder(session, container.length, blockSize);
  let sent=0, received=0, seed=1;
  while(!dec.isDone()){
    const frame = enc.frame(seed++); sent++;
    if(Math.random()<loss) continue;
    const txt = C.base45Encode(frame);
    const back = C.base45Decode(txt);
    if(Buffer.compare(Buffer.from(frame),Buffer.from(back))!==0) throw new Error('base45 roundtrip fail');
    dec.push(back); received++;
    if(sent>enc.K*20){throw new Error('did not converge K='+enc.K+' solved='+dec.solvedCount);}
  }
  const out = C.openContainer(dec.assemble());
  const okBytes = Buffer.compare(Buffer.from(out.data), file)===0;
  console.log(`${label} K=${enc.K} sent=${sent} decoded=${received} overhead=${(received/enc.K).toFixed(2)}x crc=${out.ok} bytes=${okBytes} name=${out.meta.n}`);
  if(!okBytes||!out.ok) process.exit(1);
}

run(1200, 600, 0, 'tiny/noloss  ');
run(50*1024, 600, 0, '50KB/noloss ');
run(50*1024, 600, 0.2, '50KB/20%loss');
run(50*1024, 600, 0.5, '50KB/50%loss');
run(500*1024, 900, 0.15, '500KB/15%   ');
run(2*1024*1024, 1100, 0.1, '2MB/10%     ');
run(400, 600, 0.3, 'single-block');

// QR capacity check
for(const bs of [400,600,800,1000,1200,1400]){
  const bytes = new Uint8Array(16+bs);
  const txt = C.base45Encode(bytes);
  let ok=null;
  for(const ecc of ['L','M']){
    try{ const q=qrcode(0,ecc); q.addData(txt,'Alphanumeric'); q.make(); ok=(ok||'')+` ${ecc}:${q.getModuleCount()}mod`; }
    catch(e){ ok=(ok||'')+` ${ecc}:FAIL`; }
  }
  console.log(`blockSize=${bs} -> ${txt.length} chars ->${ok}`);
}
