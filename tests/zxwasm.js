const fs=require('fs');
const puppeteer=require('/home/claude/.npm-global/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer');
const http=require('http'),pathx=require('path');
const SRV_ROOT=pathx.join(__dirname,'..','src');
const srv=http.createServer((req,res)=>{try{res.end(fs.readFileSync(pathx.join(SRV_ROOT,req.url.slice(1))))}catch(e){res.statusCode=404;res.end()}});
(async()=>{
 await new Promise(r=>srv.listen(8127,'127.0.0.1',r));
 const b=await puppeteer.launch({headless:'shell',executablePath:'/home/claude/.cache/puppeteer/chrome-headless-shell/linux-131.0.6778.204/chrome-headless-shell-linux64/chrome-headless-shell',args:['--no-sandbox']});
 const p=await b.newPage();
 p.on('console',m=>console.log('[page]',m.text()));
 await p.goto('http://127.0.0.1:8127/test-copy.html',{waitUntil:'load'});
 try{
   await p.addScriptTag({url:'https://cdn.jsdelivr.net/npm/zxing-wasm@2/dist/iife/reader/index.js'});
 }catch(e){ console.log('cdn load failed:',e.message); }
 console.log('globals:', await p.evaluate(()=>({ZXingWASM:typeof ZXingWASM, ZXing:typeof ZXing, zxingWasm:typeof zxingWasm})));
 // set up sender: 2x2 @1000B like before
 fs.writeFileSync(pathx.join(__dirname,'big.csv'), Array.from({length:6000},(_,i)=>`row-${i},v${i}`).join('\n'));
 await p.evaluate(()=>{const g=document.getElementById('grid');g.value=2;g.dispatchEvent(new Event('change'));
   document.getElementById('bs').value=1000;});
 await (await p.$('#file')).uploadFile(pathx.join(__dirname,'big.csv'));
 await new Promise(r=>setTimeout(r,1600));
 const res=await p.evaluate(async()=>{
   const api=(typeof ZXingWASM!=='undefined')?ZXingWASM:(typeof zxingWasm!=='undefined'?zxingWasm:null);
   if(!api||!api.readBarcodes) return {error:'no zxing-wasm api'};
   const out=[];
   for(const cv of window.__cells()){
     const S=cv.width*5,M=40,T=S+2*M;
     const t=document.createElement('canvas');t.width=T;t.height=T;
     const g=t.getContext('2d');g.imageSmoothingEnabled=false;
     g.fillStyle='#fff';g.fillRect(0,0,T,T);g.drawImage(cv,M,M,S,S);
     const img=g.getImageData(0,0,T,T);
     try{
       const rs=await api.readBarcodes(img,{formats:['QRCode'],tryHarder:true});
       if(!rs.length){out.push({ok:false});continue;}
       const bytes=LW.base45Decode(rs[0].text);
       const h=LW.parseHeader(bytes);
       out.push({ok:true,seed:h&&h.seed,session:h&&h.session,bs:h&&h.blockSize});
     }catch(e){ out.push({ok:false,err:String(e).slice(0,60)}); }
   }
   return out;
 });
 console.log('zxing-wasm cells:', JSON.stringify(res));
 if(Array.isArray(res)){
   const seeds=res.map(r=>r.seed);
   console.log('allValid:',res.every(r=>r.ok),'distinctSeeds:',new Set(seeds).size===seeds.length,
     'sameSession:',new Set(res.map(r=>r.session)).size===1);
 }
 await b.close(); srv.close();
})();
