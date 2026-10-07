import {drawVectorType} from './vector-type.js';
// Three reusable phrase drawings retain separate white, amber and red pigment
// paths. Per-frame data controls their measured pose, focus and ink response.
let assets,frames,pending;
const colored=new Map(),mixes=new Map(),RESOLUTION=4,MAX_BYTES=16*1024*1024;
let bytes=0;
const surface=(w,h)=>typeof OffscreenCanvas==='function'?new OffscreenCanvas(w,h):Object.assign(document.createElement('canvas'),{width:w,height:h});
const lerp=(a,b,t)=>a+(b-a)*t;
function compile(a){
 const out=surface(Math.ceil(a.width*RESOLUTION),Math.ceil(a.height*RESOLUTION)),ctx=out.getContext('2d');ctx.scale(RESOLUTION,RESOLUTION);
 for(const group of a.groups){
  const layer=surface(out.width,out.height),c=layer.getContext('2d');c.scale(RESOLUTION,RESOLUTION);c.fillStyle='#fff';
  for(const path of group.layers){c.globalAlpha=path.alpha;c.fill(new Path2D(path.d),'evenodd');}
  c.globalAlpha=1;c.globalCompositeOperation='source-in';c.fillStyle=`rgb(${group.color.join(',')})`;c.fillRect(0,0,a.width,a.height);ctx.drawImage(layer,0,0,a.width,a.height);
  if(group.name==='white')a.neutral=layer;else{layer.width=1;layer.height=1;}
 }
 a.canvas=out;delete a.groups;return a;
}
export function loadThermalCaptionPigments(){
 return pending||(pending=Promise.all(['thermal-type-pigments','thermal-type-pigment-tracks'].map(name=>fetch(new URL(`../assets/${name}.json`,import.meta.url)).then(r=>{if(!r.ok)throw new Error(`Unable to load ${name}`);return r.json();}))).then(([art,motion])=>{
  assets=art.assets;frames=motion.frames;for(const a of Object.values(assets))compile(a);
 }));
}
function prepared(name,n,state){
 const key=`${name}:${n}`;
 if(colored.has(key)){const entry=colored.get(key);colored.delete(key);colored.set(key,entry);return entry.canvas;}
 const a=assets[name],base=state.variant==='neutral'?a.neutral:a.canvas,c=surface(base.width,base.height),ctx=c.getContext('2d');ctx.drawImage(base,0,0);
 const pixels=ctx.getImageData(0,0,c.width,c.height);
 for(let i=0;i<pixels.data.length;i+=4)for(let channel=0;channel<3;channel++)pixels.data[i+channel]*=state.gainsRGB[channel];
 ctx.putImageData(pixels,0,0);
 if(state.revealWidth!==null&&state.revealWidth!==undefined)ctx.clearRect(state.revealWidth*RESOLUTION,0,c.width,c.height);
 const size=c.width*c.height*4;
 while(colored.size&&bytes+size>MAX_BYTES){const[key,item]=colored.entries().next().value;colored.delete(key);bytes-=item.bytes;item.canvas.width=1;item.canvas.height=1;}
 colored.set(key,{canvas:c,bytes:size});bytes+=size;return c;
}
function blended(name,n,a,b,t){
 const first=prepared(name,n,a);if(!t||a===b)return first;
 const next=prepared(name,n+1,b);let mixed=mixes.get(name);
 if(!mixed){mixed=surface(first.width,first.height);mixes.set(name,mixed);}
 const ctx=mixed.getContext('2d');ctx.globalAlpha=1;ctx.globalCompositeOperation='copy';ctx.clearRect(0,0,mixed.width,mixed.height);ctx.globalAlpha=1-t;ctx.drawImage(first,0,0);ctx.globalCompositeOperation='lighter';ctx.globalAlpha=t;ctx.drawImage(next,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';return mixed;
}
function paint(ctx,image,asset,pose){
 const scale=Math.hypot(ctx.getTransform().a,ctx.getTransform().b);ctx.save();ctx.filter=pose[4]?`blur(${pose[4]*scale}px)`:'none';ctx.translate(pose[0],pose[1]);ctx.scale(pose[2],pose[3]);ctx.drawImage(image,0,0,asset.width,asset.height);ctx.restore();
}
const optical=new Map();
function opticalExposure(name,frame,a,b,t,pose,image,asset){
 const key=`${name}:${frame.toFixed(8)}`;
 if(optical.has(key))return optical.get(key);
 const res=RESOLUTION,pad=Math.ceil(pose[4]*3+2),x=Math.floor((pose[0]-pad)*res)/res,y=Math.floor((pose[1]-pad)*res)/res;
 const width=Math.ceil((pose[0]+asset.width*pose[2]+pad-x)*res),height=Math.ceil((pose[1]+asset.height*pose[3]+pad-y)*res),canvas=surface(width,height),q=canvas.getContext('2d');
 q.setTransform(res,0,0,res,-x*res,-y*res);paint(q,asset.canvas,asset,pose);
 const pixels=q.getImageData(0,0,width,height),gain=a.gainsRGB.map((v,i)=>lerp(v,b.gainsRGB[i],t)),maximum=Math.max(...gain),d=pixels.data;
 for(let i=0;i<d.length;i+=4){const oldAlpha=d[i+3]/255,newAlpha=Math.min(1,oldAlpha*maximum);if(!newAlpha)continue;for(let channel=0;channel<3;channel++)d[i+channel]*=gain[channel]*oldAlpha/newAlpha;d[i+3]=newAlpha*255;}
 q.putImageData(pixels,0,0);
 const weight=lerp(a.postBlurExposure?1:0,b.postBlurExposure?1:0,t);
 if(weight<1){
  const normal=surface(width,height),c=normal.getContext('2d');c.setTransform(res,0,0,res,-x*res,-y*res);paint(c,image,asset,pose);
  q.save();q.setTransform(1,0,0,1,0,0);q.globalCompositeOperation='destination-in';q.globalAlpha=weight;q.fillRect(0,0,width,height);q.globalCompositeOperation='lighter';q.globalAlpha=1-weight;q.drawImage(normal,0,0);q.restore();normal.width=1;normal.height=1;
 }
 const result={canvas,x,y,width:width/res,height:height/res};optical.set(key,result);
 while(optical.size>4){const[first,cached]=optical.entries().next().value;optical.delete(first);cached.canvas.width=1;cached.canvas.height=1;}
 return result;
}
function paintOptical(ctx,art){ctx.save();ctx.filter='none';ctx.drawImage(art.canvas,art.x,art.y,art.width,art.height);ctx.restore();}
export function drawThermalCaptionPigment(ctx,name,frame){
 const n=Math.floor(frame+1e-7),a=frames?.[n]?.[name];if(!a)return false;
 const b=frames[n+1]?.[name]||a,t=Math.max(0,Math.min(1,frame-n)),pose=a.pose.map((v,i)=>lerp(v,b.pose[i],t)),image=blended(name,n,a,b,t),asset=assets[name];
 const exposed=a.postBlurExposure||b.postBlurExposure?opticalExposure(name,frame,a,b,t,pose,image,asset):null;
 if(exposed)paintOptical(ctx,exposed);else paint(ctx,image,asset,pose);
 if(name==='own-ability'&&frame>=379){
  // The final typed word reuses its existing canonical glyph slice.
  const gain=a.gainsRGB.map((v,i)=>lerp(v,b.gainsRGB[i],t)),scale=Math.hypot(ctx.getTransform().a,ctx.getTransform().b);ctx.save();ctx.filter=`blur(${pose[4]*scale}px)`;ctx.translate(pose[0],pose[1]);ctx.scale(pose[2],pose[3]);drawVectorType(ctx,'thermal-tail-to',128.5,10.5,{color:`rgb(${gain.map(v=>v*244).join(',')})`});ctx.restore();
 }
 const target=ctx.grainExclusionContext;
 if(target){
  const ratio=target.canvas.width/ctx.canvas.width,m=ctx.getTransform();target.save();target.setTransform(m.a*ratio,m.b*ratio,m.c*ratio,m.d*ratio,m.e*ratio,m.f*ratio);target.globalAlpha=ctx.globalAlpha;if(exposed)paintOptical(target,exposed);else paint(target,image,asset,pose);target.restore();
 }
 return true;
}
export function thermalCaptionPigmentCacheStats(){return {coloredEntries:colored.size,coloredBytes:bytes,limitBytes:MAX_BYTES,opticalEntries:optical.size,opticalBytes:[...optical.values()].reduce((sum,a)=>sum+a.canvas.width*a.canvas.height*4,0)};}
