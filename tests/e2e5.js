const fs=require('fs');
const puppeteer=require(process.env.PUPPETEER_PATH || 'puppeteer');
const http=require('http'),pathx=require('path');
const SRV_ROOT=pathx.join(__dirname,'..','src');
const srv=http.createServer((req,res)=>{try{res.end(fs.readFileSync(pathx.join(SRV_ROOT,req.url.slice(1))))}catch(e){res.statusCode=404;res.end()}});
(async()=>{
 await new Promise(r=>srv.listen(8129,'127.0.0.1',r));
 const b=await puppeteer.launch({headless:'shell',executablePath:process.env.CHROME_PATH || undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 const p=await b.newPage();
 const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
 // hard-block anything not localhost — proves the embedded wasm needs no network
 let external=0;
 await p.setRequestInterception(true);
 p.on('request',r=>{ if(!r.url().startsWith('http://127.0.0.1:8129')){external++; r.abort();} else r.continue(); });
 await p.goto('http://127.0.0.1:8129/test-copy.html',{waitUntil:'load'});

 // engine must resolve to bundled zxing (headless-shell lacks BarcodeDetector)
 const kind=await p.evaluate(async()=>({hasNative:'BarcodeDetector' in window, kind:(await window.__engine()).kind}));
 console.log('engine', JSON.stringify(kind), 'externalRequests:', external);

 // sender: test-signal button at 2x2/1000B — incompressible, so gzip must be skipped
 await p.evaluate(()=>{const g=document.getElementById('grid');g.value=2;g.dispatchEvent(new Event('change'));
   document.getElementById('bs').value=1000; document.getElementById('testSig').click();});
 await new Promise(r=>setTimeout(r,1800));
 const snd=await p.evaluate(()=>({wire:document.getElementById('sWire').textContent,
   K:document.getElementById('sK').textContent, cells:window.__cells().length,
   sent:+document.getElementById('sSent').textContent}));
 console.log('test-signal sender', JSON.stringify(snd));

 // composite the 4 live cells into ONE frame (as a camera would see) and decode via the app's own zx engine
 const multi=await p.evaluate(async()=>{
   const cells=window.__cells();
   const cw=cells[0].width, scale=5, gap=10*scale, M=40;
   const S=cw*scale, T=2*S+gap+2*M;
   const t=document.createElement('canvas'); t.width=T; t.height=T;
   const g=t.getContext('2d'); g.imageSmoothingEnabled=false;
   g.fillStyle='#fff'; g.fillRect(0,0,T,T);
   const pos=[[M,M],[M+S+gap,M],[M,M+S+gap],[M+S+gap,M+S+gap]];
   cells.forEach((cv,i)=>g.drawImage(cv,pos[i][0],pos[i][1],S,S));
   const img=g.getImageData(0,0,T,T);
   const rs=await ZXingWASM.readBarcodes(img,{formats:['QRCode'],tryHarder:true,maxNumberOfSymbols:16});
   const parsed=rs.map(r=>{
     const bytes=LW.base45Decode(r.text);
     const h=LW.parseHeader(bytes);
     const w=Math.hypot(r.position.topRight.x-r.position.topLeft.x, r.position.topRight.y-r.position.topLeft.y);
     return {seed:h&&h.seed, session:h&&h.session, w:Math.round(w), ecc:(h.flags>>2)&3};
   });
   return {found:rs.length, expectW:S, parsed};
 });
 console.log('one-frame multi-decode', JSON.stringify(multi));

 // feed frames WITH geometry through handleFrame -> ppm + verdict must populate; complete a session
 const ppmTest=await p.evaluate(async()=>{
   const file=new Uint8Array(40000); for(let i=0;i<file.length;i++)file[i]=(i*97)&255;
   const payload=LW.buildContainer('probe.bin','application/octet-stream',file);
   const flags=(0&3)<<2; // ecc L
   const enc=LW.makeEncoder(payload,1000,909090,flags);
   const text1=LW.base45Encode(enc.frame(1));
   // pretend the camera sees 117-module codes at 410px wide -> ppm 3.5
   let seed=1;
   while(!(window.__dec()&&window.__dec().isDone())){
     window.__hf(LW.base45Encode(enc.frame(seed++)),410);
     if(seed>enc.K*40) return {error:1};
   }
   await new Promise(r=>setTimeout(r,600));
   return {ppm:window.__ppm().toFixed(2),
     ppmCell:document.getElementById('rPpm').textContent,
     verdict:document.getElementById('rVerdict').textContent,
     eng:document.getElementById('rEng').textContent,
     title:document.getElementById('doneTitle').textContent};
 });
 console.log('ppm-verdict', JSON.stringify(ppmTest));
 await p.screenshot({path:__dirname+'/shot5-diag.png',fullPage:true});
 console.log('errors:', errs.length?errs:'none', 'externalRequests:', external);
 await b.close(); srv.close();
})().catch(e=>{console.error('E2E FAIL',e);process.exit(1)});
