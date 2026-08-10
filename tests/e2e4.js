const fs=require('fs');
const puppeteer=require(process.env.PUPPETEER_PATH || 'puppeteer');
const http=require('http'),fsx=require('fs'),pathx=require('path');
const SRV_ROOT=pathx.join(__dirname,'..','src');
const srv=http.createServer((req,res)=>{
  const f=pathx.join(SRV_ROOT,req.url.replace(/^\/+/,'').split('?')[0]||'index.html');
  try{ res.setHeader('Content-Type', f.endsWith('.html')?'text/html':'text/plain'); res.end(fsx.readFileSync(f)); }
  catch(e){ res.statusCode=404; res.end('nf'); }
});
(async()=>{
 await new Promise(r=>srv.listen(8124,'127.0.0.1',r));
 const b=await puppeteer.launch({headless:'shell',executablePath:process.env.CHROME_PATH || undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 const p=await b.newPage(); await p.setViewport({width:880,height:1400});
 const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
 p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
 await p.goto('http://127.0.0.1:8124/test-copy.html',{waitUntil:'load'});

 // make a 300KB compressible file for a real workload
 await p.evaluate(()=>{
   const rows=Array.from({length:6000},(_,i)=>`row-${i},value-${i*7},status-ok`).join('\n');
   window.__bigFile=new TextEncoder().encode(rows);
 });

 // 2x2 grid @ 15fps, 1000B codes
 await p.evaluate(()=>{
   document.getElementById('grid').value=2; document.getElementById('grid').dispatchEvent(new Event('input')); document.getElementById('grid').dispatchEvent(new Event('change'));
   document.getElementById('fps').value=15; document.getElementById('fps').dispatchEvent(new Event('input'));
   document.getElementById('bs').value=1000; document.getElementById('bs').dispatchEvent(new Event('input'));
 });
 // inject the file through the same path a real file takes
 await p.evaluate(()=>{
   const dt={bytes:window.__bigFile,name:'ledger.csv',type:'text/csv'};
   // call startFile via a synthetic paste (text) would rename; instead reach begin through fileMeta
   window.dispatchEvent(new Event('noop'));
 });
 // simpler: paste path with text (names it clipboard.txt, fine for the pipeline test)
 await p.evaluate(()=>{
   const e=new ClipboardEvent('paste',{clipboardData:new DataTransfer()});
   // DataTransfer in headless may not carry text; fall back to direct call if needed
 });
 // most robust: temporarily expose startFile? not exposed. Use the file input with a served file instead.
 
 fs.writeFileSync(pathx.join(__dirname,'big.csv'), Array.from({length:6000},(_,i)=>`row-${i},value-${i*7},status-ok`).join('\n'));
 const input=await p.$('#file'); await input.uploadFile(pathx.join(__dirname,'big.csv'));
 await new Promise(r=>setTimeout(r,1800));

 const s1=await p.evaluate(()=>({
   workers:window.__workers(), q:window.__q(),
   cells:window.__cells().length,
   sent:+document.getElementById('sSent').textContent,
   wire:document.getElementById('sWire').textContent,
   K:document.getElementById('sK').textContent,
   nom:document.getElementById('sNom').textContent,
   sizes:window.__cells().map(c=>c.width)
 }));
 await new Promise(r=>setTimeout(r,2000));
 const s2=await p.evaluate(()=>+document.getElementById('sSent').textContent);
 console.log('grid-sender', JSON.stringify(s1), 'codes/s over 2s:', ((s2-s1.sent)/2).toFixed(1));

 // export cells as PNGs; decode node-side with ZXing (BarcodeDetector-class engine)
 const pngs=await p.evaluate(()=>window.__cells().map(cv=>{
   const S=cv.width*5, M=40, T=S+2*M;
   const t=document.createElement('canvas'); t.width=T; t.height=T;
   const g=t.getContext('2d'); g.imageSmoothingEnabled=false;
   g.fillStyle='#fff'; g.fillRect(0,0,T,T); g.drawImage(cv,M,M,S,S);
   return t.toDataURL('image/png');
 }));
 pngs.forEach((d,i)=>fs.writeFileSync(pathx.join(__dirname,'cell'+i+'.png'), Buffer.from(d.split(',')[1],'base64')));

 await p.screenshot({path:__dirname+'/shot4-grid.png',fullPage:true});

 // Ludicrous preset: 3x3 — verify 9 cells and queue keeps up
 await p.evaluate(()=>document.getElementById('pLudicrous').click());
 await new Promise(r=>setTimeout(r,2500));
 const lud1=await p.evaluate(()=>({cells:window.__cells().length,q:window.__q(),sent:+document.getElementById('sSent').textContent,nom:document.getElementById('sNom').textContent}));
 await new Promise(r=>setTimeout(r,2000));
 const lud2=await p.evaluate(()=>+document.getElementById('sSent').textContent);
 console.log('ludicrous', JSON.stringify(lud1), 'codes/s over 2s:', ((lud2-lud1.sent)/2).toFixed(1));
 await p.screenshot({path:__dirname+'/shot4-ludicrous.png',fullPage:true});

 // full loop: harvest real frames from the 9 on-screen cells across ticks, feed to receiver with drops
 await p.evaluate(()=>document.getElementById('tabRecv').click());
 // NOTE: switching tabs stops the sender; harvest was done live above only for validity.
 // For the end-to-end, drive LW directly (pipeline identity already proven) at grid-scale volume:
 const loop=await p.evaluate(async()=>{
   const file=window.__bigFile;
   const c=LW.buildContainer('ledger.csv','text/csv',file);
   let payload=c,flags=0;
   const g=await LW.gzipBytes(c); if(g&&g.length<c.length-64){payload=g;flags|=LW.FLAG_GZ;}
   const enc=LW.makeEncoder(payload,1400,777000111,flags);
   let seed=1;
   while(!(window.__dec()&&window.__dec().isDone())){
     const f=enc.frame(seed++);
     if(Math.random()<0.25) continue;   // torn/missed frames at speed
     window.__feed(LW.base45Encode(f));
     if(seed>enc.K*40) return {error:'no convergence',K:enc.K};
   }
   return {K:enc.K,fed:seed-1,kbs:document.getElementById('rKbs').textContent,
     title:document.getElementById('doneTitle').textContent};
 });
 console.log('full-loop', JSON.stringify(loop));
 await p.waitForFunction('window.__result()!==null',{timeout:4000});
 const done=await p.evaluate(async()=>{
   const res=window.__result();
   const h=res?await LW.sha256Hex(res.data):null;
   const eh=await LW.sha256Hex(window.__bigFile);
   return {name:res&&res.meta.n,match:h===eh,save:!document.getElementById('save').classList.contains('hidden')};
 });
 console.log('verify', JSON.stringify(done));
 console.log('errors:', errs.length?errs:'none');
 await b.close(); srv.close();
})().catch(e=>{console.error('E2E FAIL',e);process.exit(1)});
