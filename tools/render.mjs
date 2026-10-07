import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {checkAssets} from './check-assets.mjs';
const require=createRequire(import.meta.url);
let playwrightPath=process.env.PLAYWRIGHT_PATH;
if(!playwrightPath)playwrightPath=require.resolve('playwright');
const {chromium}=require(playwrightPath);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
checkAssets(root);
const dest=path.resolve(process.argv[2]||path.join(root,'renders','native.mp4'));
const width=Number(process.argv[3]||720),fps=Number(process.argv[4]||24000/1001);
const crf=Number(process.env.VIDEO_CRF||10);
const encoderThreads=Number(process.env.VIDEO_THREADS||2);
if(!Number.isFinite(width)||width<72||width%8||!Number.isFinite(fps)||fps<=0||fps>240)throw new Error('Width must be a positive multiple of 8; fps must be between 0 and 240.');
if(!Number.isFinite(crf)||crf<0||crf>51)throw new Error('VIDEO_CRF must be between 0 and 51.');
if(!Number.isInteger(encoderThreads)||encoderThreads<1||encoderThreads>64)throw new Error('VIDEO_THREADS must be an integer between1 and64.');
const total=Math.ceil(489/(24000/1001)*fps);
const selected=process.argv[5]?process.argv[5].split(',').map(Number).map(n=>n-1):Array.from({length:total},(_,i)=>i);
const isVideo=/\.(mp4|mkv)$/i.test(dest);
const codec=process.env.VIDEO_CODEC||(/\.mkv$/i.test(dest)?'ffv1':'h264');
const auditEnabled=process.env.RENDER_AUDIT==='1',frameAudit=[];
const profiles={
 h264:['-c:v','libx264','-preset','slow','-crf',String(crf),'-threads',String(encoderThreads),'-pix_fmt','yuv420p'],
 'vp9-lossless':['-c:v','libvpx-vp9','-lossless','1','-pix_fmt','gbrp','-deadline','good','-cpu-used','4','-row-mt','1','-threads','4'],
 ffv1:['-c:v','ffv1','-level','3','-coder','1','-context','1','-g','1','-slices','16','-slicecrc','1','-pix_fmt','bgr0']
};
if(isVideo&&!profiles[codec])throw new Error('VIDEO_CODEC must be h264, vp9-lossless, or ffv1.');
if(isVideo&&codec==='ffv1'&&!/\.mkv$/i.test(dest))throw new Error('FFV1 requires an .mkv destination.');
if(isVideo&&process.argv[5])throw new Error('Selected frame export requires a directory destination.');
fs.mkdirSync(isVideo?path.dirname(dest):dest,{recursive:true});
let encoder,encoding;
if(isVideo){
 const rate=Math.abs(fps-24000/1001)<1e-7?'24000/1001':String(fps);
 const container=/\.mp4$/i.test(dest)?['-video_track_timescale','24000','-movflags','+faststart']:[];
 encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',rate,'-c:v','png','-i','pipe:0','-i',path.join(root,'assets','soundtrack.m4a'),'-map','0:v:0','-map','1:a:0',...profiles[codec],'-c:a','copy',...container,dest],{stdio:['pipe','ignore','pipe'],windowsHide:true});
 let encoderErrors='';encoder.stderr.on('data',data=>encoderErrors+=data);
 encoding=new Promise((resolve,reject)=>{encoder.on('error',reject);encoder.on('exit',code=>code===0?resolve():reject(new Error(`FFmpeg failed: ${encoderErrors}`)))});
}
const executablePath=process.env.CHROME_PATH||undefined;
const browser=await chromium.launch({headless:true,executablePath,args:['--allow-file-access-from-files','--disable-gpu-sandbox']});
try{
 const page=await browser.newPage({viewport:{width,height:Math.round(width*.75)},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e));
 await page.goto(`${pathToFileURL(path.join(root,'index.html')).href}?clean&width=${width}`,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.recreation?.ready,null,{timeout:120000});
 for(const i of selected){
  const raw=await page.evaluate(async({t,native,audit})=>{
   await(window.recreation.renderExact||window.recreation.render)(t,{native});
   const canvas=window.recreation.canvas,pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
   let sum=0,sum2=0,count=0;
   for(let p=0;p<pixels.length;p+=4096)for(let c=0;c<3;c++){const value=pixels[p+c];sum+=value;sum2+=value*value;count++;}
   const mean=sum/count,std=Math.sqrt(sum2/count-mean*mean);
   if(mean<2||std<.5)throw new Error(`Invalid black or flat render at ${t.toFixed(6)} seconds; export stopped.`);
   const rgbaSHA256=audit?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))).map(v=>v.toString(16).padStart(2,'0')).join(''):null;
   return {png:canvas.toDataURL('image/png').split(',')[1],mean,std,rgbaSHA256};
  },{t:i/fps,native:fps<25,audit:auditEnabled});
  if(errors.length)throw errors[0];
  const bytes=Buffer.from(raw.png,'base64');
  if(auditEnabled){frameAudit.push({frame:i+1,seconds:i/fps,mean:raw.mean,std:raw.std,rgbaSHA256:raw.rgbaSHA256});if(i%24===0)fs.writeFileSync(dest+'.frames.json',JSON.stringify({width,height:width*.75,fps,complete:false,frames:frameAudit},null,2));}
  if(isVideo){if(!encoder.stdin.write(bytes))await once(encoder.stdin,'drain');}
  else fs.writeFileSync(path.join(dest,`${String(i+1).padStart(4,'0')}.png`),bytes);
  if(i%24===0)console.log(`${i+1}/${total}`);
 }
 console.log(`Rendered ${selected.length} frames at ${width} × ${width*.75}, ${fps} fps to ${dest}`);
 if(isVideo){encoder.stdin.end();await encoding;console.log('Video encoding complete.');}
 if(auditEnabled)fs.writeFileSync(dest+'.frames.json',JSON.stringify({width,height:width*.75,fps,complete:true,frames:frameAudit},null,2));
}finally{await browser.close();if(encoder&&!encoder.killed&&encoder.exitCode===null)encoder.kill();}
