import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {checkAssets} from './check-assets.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
checkAssets(root);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--allow-file-access-from-files']});
const result={errors:[],frames:[],controls:{}};
try{
 const page=await browser.newPage({viewport:{width:1200,height:1000}});
 page.on('pageerror',error=>result.errors.push(String(error)));
 await page.goto(pathToFileURL(path.join(root,'index.html')).href,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.recreation?.ready,null,{timeout:120000});
 for(const frame of [1,117,254,325,489]){
  const stat=await page.evaluate(async frame=>{
   await window.recreation.renderExact((frame-1)*1001/24000,{native:true});
   const c=window.recreation.canvas,p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
   let sum=0,sum2=0,n=0;for(let i=0;i<p.length;i+=4096)for(let ch=0;ch<3;ch++){sum+=p[i+ch];sum2+=p[i+ch]**2;n++;}
   const mean=sum/n;return{frame,mean,std:Math.sqrt(sum2/n-mean**2)};
  },frame);
  assert(stat.mean>2&&stat.std>.5,`Blank frame ${frame}`);result.frames.push(stat);
 }
 await page.locator('#seek').fill('14.25');await page.locator('#seek').dispatchEvent('input');
 result.controls.seek=await page.locator('#time').textContent();assert(result.controls.seek.startsWith('14.25'));
 await page.locator('#play').click();await page.waitForTimeout(350);await page.locator('#play').click();
 result.controls.afterPlay=await page.locator('#time').textContent();assert(parseFloat(result.controls.afterPlay)>14.25);
 await page.locator('#timing').selectOption('native');await page.keyboard.press('ArrowRight');
 result.controls.afterStep=await page.locator('#time').textContent();
 await page.locator('#sound').click();result.controls.sound=await page.locator('#sound').textContent();assert(result.controls.sound.toLowerCase().includes('on'));
 await page.setViewportSize({width:390,height:844});
 fs.mkdirSync(path.join(root,'renders'),{recursive:true});await page.screenshot({path:path.join(root,'renders','mobile-preview.png')});
 assert.equal(result.errors.length,0);console.log(JSON.stringify(result,null,2));
}finally{await browser.close()}
