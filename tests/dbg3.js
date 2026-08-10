const puppeteer=require(process.env.PUPPETEER_PATH || 'puppeteer');
const http=require('http'),fsx=require('fs'),pathx=require('path');
const SRV_ROOT=pathx.join(__dirname,'..','src');
const srv=http.createServer((req,res)=>{try{res.end(fsx.readFileSync(pathx.join(SRV_ROOT,req.url.slice(1))))}catch(e){res.statusCode=404;res.end()}});
(async()=>{
 await new Promise(r=>srv.listen(8126,'127.0.0.1',r));
 const b=await puppeteer.launch({headless:'shell',executablePath:process.env.CHROME_PATH || undefined,args:['--no-sandbox']});
 const p=await b.newPage();
 await p.goto('http://127.0.0.1:8126/test-copy.html',{waitUntil:'load'});
 const out=await p.evaluate(()=>{
   // replicate the worker pipeline on the main thread for a fixed frame
   const payload=new Uint8Array(20000); for(let i=0;i<payload.length;i++)payload[i]=(i*37)&255;
   const enc=LW.makeEncoder(payload,1000,555,0);
   const frame=enc.frame(12345);
   const text=LW.base45Encode(frame);

   // path A: worker-style rgba
   const q=qrcode(0,'L'); q.addData(text,'Alphanumeric'); q.make();
   const n=q.getModuleCount(),pad=4,size=n+pad*2;
   const rgba=new Uint8ClampedArray(size*size*4);
   rgba.fill(255);
   for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(q.isDark(r,c)){const o=((r+pad)*size+(c+pad))*4;rgba[o]=0;rgba[o+1]=0;rgba[o+2]=0;}
   const A=document.createElement('canvas');A.width=size;A.height=size;
   A.getContext('2d').putImageData(new ImageData(rgba,size,size),0,0);

   // path B: drawQR with pad 4
   const B=document.createElement('canvas');
   {const q2=qrcode(0,'L');q2.addData(text,'Alphanumeric');q2.make();
    const n2=q2.getModuleCount(),size2=n2+8;B.width=size2;B.height=size2;
    const g=B.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,size2,size2);g.fillStyle='#000';
    for(let r=0;r<n2;r++)for(let c=0;c<n2;c++)if(q2.isDark(r,c))g.fillRect(c+4,r+4,1,1);}

   // pixel diff
   const da=A.getContext('2d').getImageData(0,0,size,size).data;
   const db=B.getContext('2d').getImageData(0,0,size,size).data;
   let diff=0; for(let i=0;i<da.length;i+=4) if((da[i]<128)!==(db[i]<128)) diff++;

   // decode both through the same harness
   const dec=(cv)=>{const S=cv.width*6,M=48,T=S+2*M;
     const t=document.createElement('canvas');t.width=T;t.height=T;
     const g=t.getContext('2d');g.imageSmoothingEnabled=false;
     g.fillStyle='#fff';g.fillRect(0,0,T,T);g.drawImage(cv,M,M,S,S);
     const im=g.getImageData(0,0,T,T);
     const r=jsQR(im.data,T,T,{inversionAttempts:'dontInvert'});
     return r?r.data.length:0;};
   return {size, diffPixels:diff, decA:dec(A), decB:dec(B), textLen:text.length};
 });
 console.log(JSON.stringify(out));
 await b.close(); srv.close();
})();
