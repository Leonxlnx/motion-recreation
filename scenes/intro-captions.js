// Per-word transforms and ink are measured independently. The artwork remains
// the same reusable sentence contours; these surfaces are generated masks.
import {drawVectorType,loadVectorType} from './vector-type.js';
let data,pending,masks,tints,lastTime=-1,lastMode='',lastCommon=0;
const styles=new Map();
const SCALE=4,TOP=220,HEIGHT=96;
const make=(w,h)=>typeof OffscreenCanvas==='function'?new OffscreenCanvas(w,h):Object.assign(document.createElement('canvas'),{width:w,height:h});
const layer=make(720*SCALE,HEIGHT*SCALE),paint=layer.getContext('2d');let resolution=SCALE;
const mix=(a,b,t)=>a+(b-a)*t;
export function loadIntroCaptions(){
  if(!pending)pending=Promise.all([loadVectorType(),fetch(new URL('../assets/intro-word-tracks.json',import.meta.url)).then(r=>r.json())]).then(([,d])=>{data=d;prepareMasks();styleAt(51);styleAt(52);});
  return pending;
}
function prepareMasks(){
  if(masks)return;
  const source=make(690*SCALE,40*SCALE),ctx=source.getContext('2d');ctx.scale(SCALE,SCALE);drawVectorType(ctx,'sentence',4,4,{color:'#fff'});
  masks=[];tints=[];
  for(let i=0;i<data.bounds.length-1;i++){
    const lo=data.bounds[i],hi=data.bounds[i+1],surface=make((hi-lo)*SCALE,31*SCALE);
    surface.getContext('2d').drawImage(source,(lo+4)*SCALE,2*SCALE,surface.width,surface.height,0,0,surface.width,surface.height);
    masks.push(surface);tints.push(make(surface.width,surface.height));
  }
}
function styleAt(frame){
  if(styles.has(frame)){const value=styles.get(frame);styles.delete(frame);styles.set(frame,value);return value;}
  const entries=data.frames[frame],value=entries.map((d,i)=>{
    if(!d)return null;
    const mask=masks[i],surface=make(mask.width,mask.height),c=surface.getContext('2d'),g=d.gain??1;
    c.globalAlpha=Math.min(1,g);c.drawImage(mask,0,0);
    if(g>1){c.globalCompositeOperation='lighter';c.globalAlpha=g-1;c.drawImage(mask,0,0);}
    c.globalAlpha=1;c.globalCompositeOperation='source-in';c.fillStyle=`rgb(${d.color.map(v=>Math.max(0,Math.min(255,v))).join(',')})`;c.fillRect(0,0,surface.width,surface.height);return surface;
  });
  while(styles.size>=4){const [key,old]=styles.entries().next().value;styles.delete(key);for(const surface of old)if(surface)surface.width=1;}
  styles.set(frame,value);return value;
}
function sample(frame){
  const index=Math.floor(frame),a=data.frames[index],b=data.frames[index+1]||a,t=frame-index;
  return a.map((item,i)=>{if(!item)return null;const next=b[i]||item;return {pose:item.pose.map((v,j)=>mix(v,next.pose[j],t))};});
}
function revealAt(frame){return frame<90?678:frame<91?mix(678,616,frame-90):frame<92?mix(616,510,frame-91):frame<93?mix(510,313,frame-92):313;}
export function drawMeasuredIntroCaption(ctx,frame,{blurMode='hybrid'}={}){
  if(!data||frame<51||frame>=94)return false;
  prepareMasks();
  const matrix=ctx.getTransform(),destinationScale=Math.hypot(matrix.a,matrix.b),requiredResolution=Math.min(SCALE,Math.max(1,Math.ceil(destinationScale)));
  if(requiredResolution!==resolution){resolution=requiredResolution;layer.width=720*resolution;layer.height=HEIGHT*resolution;lastTime=-1;}
  if(frame!==lastTime||blurMode!==lastMode){
    const entries=sample(frame),reveal=revealAt(frame),optics=entries.slice(3,8).filter(Boolean).map(d=>d.pose[4]).sort((a,b)=>a-b);
    const index=Math.floor(frame),t=frame-index,first=styleAt(index),second=styleAt(data.frames[index+1]?index+1:index);
    const common=blurMode==='individual'?0:blurMode==='shared'?(optics[Math.floor(optics.length/2)]||0):Math.min(...entries.filter(Boolean).map(d=>d.pose[4]));
    paint.setTransform(1,0,0,1,0,0);paint.clearRect(0,0,layer.width,layer.height);paint.setTransform(resolution,0,0,resolution,0,-TOP*resolution);
    for(let i=0;i<entries.length;i++){
      const d=entries[i],remaining=Math.min(data.bounds[i+1]-data.bounds[i],reveal-data.bounds[i]);if(!d||remaining<=0)continue;
      const surface=tints[i],p=d.pose,c=surface.getContext('2d');
      c.clearRect(0,0,surface.width,surface.height);c.globalCompositeOperation='lighter';c.globalAlpha=1-t;c.drawImage(first[i],0,0);if(t){c.globalAlpha=t;c.drawImage(second[i]||first[i],0,0);}c.globalAlpha=1;
      const extra=blurMode==='shared'?0:Math.sqrt(Math.max(0,p[4]*p[4]-common*common));
      paint.save();paint.filter=extra<.025?'none':`blur(${extra*resolution}px)`;paint.translate(p[0],p[1]);paint.scale(p[2],p[3]);
      paint.drawImage(surface,0,0,remaining*SCALE,surface.height,0,-2,remaining,surface.height/SCALE);paint.restore();
    }
    lastTime=frame;lastMode=blurMode;lastCommon=common;
  }
  ctx.save();ctx.filter=lastCommon<.025?'none':`blur(${lastCommon*destinationScale}px)`;ctx.drawImage(layer,0,TOP,720,HEIGHT);ctx.restore();return true;
}
