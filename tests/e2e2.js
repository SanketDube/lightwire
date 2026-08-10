const puppeteer=require(process.env.PUPPETEER_PATH || 'puppeteer');
const http=require('http'),fsx=require('fs'),pathx=require('path');
const SRV_ROOT=pathx.join(__dirname,'..','src');
const srv=http.createServer((req,res)=>{try{res.end(fsx.readFileSync(pathx.join(SRV_ROOT,req.url.slice(1))))}catch(e){res.statusCode=404;res.end()}});
(async()=>{
 await new Promise(r=>srv.listen(8128,'127.0.0.1',r));
 const b=await puppeteer.launch({headless:'shell',executablePath:process.env.CHROME_PATH || undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 const p=await b.newPage(); await p.setViewport({width:860,height:1250});
 const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
 p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
 await p.goto('http://127.0.0.1:8128/test-copy.html',{waitUntil:'load'});

 // secure context: subtle + CompressionStream present in-page
 console.log('ctx', await p.evaluate(()=>({secure:window.isSecureContext, subtle:LW.subtleOK(), gz:typeof CompressionStream!=='undefined'})));

 // A) sender UI with passphrase + compression on a compressible file
 await p.evaluate(()=>{ document.getElementById('pass').value='tiger-42'; document.getElementById('pass').dispatchEvent(new Event('input')); });
 const input=await p.$('#file'); await input.uploadFile(pathx.join(__dirname,'..','src','core.js'));
 await new Promise(r=>setTimeout(r,2500)); // pbkdf2 250k + gzip
 const s=await p.evaluate(()=>({
   panel:!document.getElementById('sendPanel').classList.contains('hidden'),
   wire:document.getElementById('sWire').textContent,
   K:document.getElementById('sK').textContent,
   sent:+document.getElementById('sSent').textContent,
   hash:document.getElementById('sHash').textContent,
   passState:document.getElementById('passState').textContent
 }));
 console.log('sender', JSON.stringify(s));
 await p.screenshot({path:__dirname+'/shot3-send.png',fullPage:true});

 // B) receiver flow: feed an encrypted+gzipped stream with 25% loss via the page's own handler
 await p.evaluate(()=>document.getElementById('tabRecv').click());
 const feed=await p.evaluate(async()=>{
   const text='const ROWS='+JSON.stringify(Array.from({length:1500},(_,i)=>({i,tag:'row-'+i})))+';';
   const file=new TextEncoder().encode(text);
   window.__expectHash=await LW.sha256Hex(file);
   const c=LW.buildContainer('rows.js','text/javascript',file);
   let payload=c, flags=0;
   const g=await LW.gzipBytes(c); if(g&&g.length<c.length-64){payload=g;flags|=LW.FLAG_GZ;}
   payload=await LW.encryptBytes('tiger-42',payload); flags|=LW.FLAG_ENC;
   const enc=LW.makeEncoder(payload,600,313370042,flags);
   let seed=1,pushed=0;
   while(!(window.__dec()&&window.__dec().isDone())){
     const f=enc.frame(seed++);
     if(Math.random()<0.25) continue;
     window.__feed(LW.base45Encode(f)); pushed++;
     if(seed>enc.K*40) return {error:'no convergence',K:enc.K};
   }
   return {K:enc.K, pushed, origLen:c.length, wireLen:payload.length};
 });
 console.log('feed', JSON.stringify(feed));
 await new Promise(r=>setTimeout(r,300));
 const locked=await p.evaluate(()=>({
   done:!document.getElementById('donePanel').classList.contains('hidden'),
   title:document.getElementById('doneTitle').textContent,
   unlockShown:!document.getElementById('unlockRow').classList.contains('hidden'),
   saveHidden:document.getElementById('save').classList.contains('hidden')
 }));
 console.log('locked-state', JSON.stringify(locked));
 await p.screenshot({path:__dirname+'/shot3-locked.png',fullPage:true});

 // C) wrong passphrase → error, still locked
 await p.evaluate(()=>{ document.getElementById('rpass').value='wrong'; document.getElementById('unlock').click(); });
 await new Promise(r=>setTimeout(r,2200));
 const wrong=await p.evaluate(()=>({
   msg:document.getElementById('unlockMsg').textContent,
   msgShown:!document.getElementById('unlockMsg').classList.contains('hidden'),
   stillLocked:!document.getElementById('unlockRow').classList.contains('hidden')
 }));
 console.log('wrong-pass', JSON.stringify(wrong));

 // D) right passphrase → verified, fingerprint matches, save works
 await p.evaluate(()=>{ document.getElementById('rpass').value='tiger-42'; document.getElementById('unlock').click(); });
 await new Promise(r=>setTimeout(r,2500));
 const ok=await p.evaluate(async()=>{
   const res=window.__result();
   const gotHash=res?await LW.sha256Hex(res.data):null;
   return {
     title:document.getElementById('doneTitle').textContent,
     msg:document.getElementById('doneMsg').textContent,
     hashLine:document.getElementById('doneHash').textContent,
     saveShown:!document.getElementById('save').classList.contains('hidden'),
     name:res&&res.meta.n, size:res&&res.meta.s,
     hashMatch:gotHash===window.__expectHash
   };
 });
 console.log('unlocked', JSON.stringify(ok));
 await p.screenshot({path:__dirname+'/shot3-done.png',fullPage:true});

 // E) plain (no pass, no gz benefit skipped path) still works end to end
 const plain=await p.evaluate(async()=>{
   const file=crypto.getRandomValues(new Uint8Array(30*1024)); // random: gzip won't help → plain path
   const c=LW.buildContainer('rand.bin','application/octet-stream',file);
   let payload=c, flags=0;
   const g=await LW.gzipBytes(c); if(g&&g.length<c.length-64){payload=g;flags|=LW.FLAG_GZ;}
   const enc=LW.makeEncoder(payload,600,424242,flags);
   const dec=LW.makeDecoder(424242,payload.length,600);
   let seed=1;
   while(!dec.isDone()){ const f=enc.frame(seed++); if(Math.random()<0.2)continue; dec.push(LW.base45Decode(LW.base45Encode(f))); if(seed>enc.K*40)return{error:1}; }
   const out=LW.openContainer(dec.assemble());
   let same=out.data.length===file.length; for(let i=0;same&&i<file.length;i++) if(out.data[i]!==file[i]) same=false;
   return {gzUsed:!!(flags&LW.FLAG_GZ), ok:out.ok, same};
 });
 console.log('plain-random', JSON.stringify(plain));

 console.log('errors:', errs.length?errs:'none');
 await b.close(); srv.close();
})().catch(e=>{console.error('E2E FAIL',e);process.exit(1)});
