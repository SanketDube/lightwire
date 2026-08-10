const puppeteer=require('/home/claude/.npm-global/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer');
const http=require('http'),fsx=require('fs'),pathx=require('path');
const SRV_ROOT=pathx.join(__dirname,'..','src');
const srv=http.createServer((req,res)=>{try{res.end(fsx.readFileSync(pathx.join(SRV_ROOT,req.url.slice(1))))}catch(e){res.statusCode=404;res.end()}});
(async()=>{
 await new Promise(r=>srv.listen(8125,'127.0.0.1',r));
 const b=await puppeteer.launch({headless:'shell',executablePath:'/home/claude/.cache/puppeteer/chrome-headless-shell/linux-131.0.6778.204/chrome-headless-shell-linux64/chrome-headless-shell',args:['--no-sandbox']});
 const p=await b.newPage();
 await p.goto('http://127.0.0.1:8125/test-copy.html',{waitUntil:'load'});
 fsx.writeFileSync(pathx.join(__dirname,'big.csv'), Array.from({length:6000},(_,i)=>`row-${i},v${i}`).join('\n'));
 await p.evaluate(()=>{const g=document.getElementById('grid');g.value=2;g.dispatchEvent(new Event('change'));
   const bs=document.getElementById('bs');bs.value=1000;});
 await (await p.$('#file')).uploadFile(pathx.join(__dirname,'big.csv'));
 await new Promise(r=>setTimeout(r,1500));
 const out=await p.evaluate(()=>{
   const cv=window.__cells()[0];
   const tryScale=(scale,inv)=>{
     const S=cv.width*scale,M=8*scale,T=S+2*M;
     const t=document.createElement('canvas');t.width=T;t.height=T;
     const g=t.getContext('2d');g.imageSmoothingEnabled=false;
     g.fillStyle='#fff';g.fillRect(0,0,T,T);g.drawImage(cv,M,M,S,S);
     const im=g.getImageData(0,0,T,T);
     const r=jsQR(im.data,T,T,{inversionAttempts:inv});
     return !!r;
   };
   // control: same-length text through main-thread drawQR, identical harness
   const text=LW.base45Encode(new Uint8Array(1016));
   const ctl=document.createElement('canvas');
   (function(){const q=qrcode(0,'L');q.addData(text,'Alphanumeric');q.make();
     const n=q.getModuleCount(),pad=4,size=n+pad*2;ctl.width=size;ctl.height=size;
     const g=ctl.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,size,size);g.fillStyle='#000';
     for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(q.isDark(r,c))g.fillRect(c+pad,r+pad,1,1);})();
   const ctlTry=(scale)=>{const S=ctl.width*scale,M=8*scale,T=S+2*M;
     const t=document.createElement('canvas');t.width=T;t.height=T;
     const g=t.getContext('2d');g.imageSmoothingEnabled=false;
     g.fillStyle='#fff';g.fillRect(0,0,T,T);g.drawImage(ctl,M,M,S,S);
     const im=g.getImageData(0,0,T,T);
     return !!jsQR(im.data,T,T,{inversionAttempts:'dontInvert'});};
   // pixel sanity on the worker cell
   const g0=cv.getContext('2d');const d=g0.getImageData(0,0,cv.width,cv.height).data;
   let black=0,white=0,other=0;
   for(let i=0;i<d.length;i+=4){const v=d[i];if(v===0)black++;else if(v===255)white++;else other++;}
   return {cellSize:cv.width, black,white,other,
     cell_s4:tryScale(4,'dontInvert'), cell_s6:tryScale(6,'dontInvert'),
     cell_s8:tryScale(8,'dontInvert'), cell_s6_both:tryScale(6,'attemptBoth'),
     ctlSize:ctl.width, ctl_s4:ctlTry(4), ctl_s6:ctlTry(6)};
 });
 console.log(JSON.stringify(out,null,1));
 await b.close(); srv.close();
})();
