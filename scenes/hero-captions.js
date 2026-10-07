import {loadVectorType,drawVectorType,vectorTypeMetrics} from './vector-type.js';

// Three reusable word outlines and analytic rectangles. All changing values
// are pose, ink, reveal and optical parameters; no caption frame is an image.
let tracks=null,pending=null,opticalCanvas=null;
const mix=(a,b,t)=>a+(b-a)*t;
const ink=rgb=>'rgb('+rgb.map(v=>Math.max(0,Math.min(255,v))).join(',')+')';
const canvas=(w,h)=>typeof OffscreenCanvas==='function'?new OffscreenCanvas(w,h):Object.assign(document.createElement('canvas'),{width:w,height:h});
export function loadHeroCaptions(){
  if(!pending)pending=Promise.all([loadVectorType(),fetch(new URL('../assets/hero-caption-tracks.json',import.meta.url)).then(r=>{if(!r.ok)throw new Error('Unable to load hero caption tracks');return r.json();})]).then(([,data])=>{tracks=data.frames;});
  return pending;
}
function interpolate(a,b,t){
  if(!b||t<=0)return a;
  const result={};
  for(const [key,value]of Object.entries(a))result[key]=typeof value==='number'?mix(value,b[key],t):Array.isArray(value)?value.map((n,i)=>mix(n,b[key][i],t)):value;
  return result;
}
function word(ctx,name,w,reveal,color){
  ctx.save();ctx.translate(w.x,w.y);ctx.scale(w.sx,w.sy);
  drawVectorType(ctx,name,0,0,{color,coverageGain:w.gain,revealWidth:reveal/w.sx});
  ctx.restore();
}
function brightBlurredWord(ctx,name,w,reveal,scale){
  const metrics=vectorTypeMetrics(name),padding=Math.max(8,w.blur*4),left=Math.floor(w.x-padding),top=Math.floor(w.y-padding);
  const width=Math.ceil(metrics.width*w.sx+padding*2+2),height=Math.ceil(metrics.height*w.sy+padding*2+2);
  const surface=opticalCanvas||(opticalCanvas=canvas(1,1));surface.width=Math.ceil(width*scale);surface.height=Math.ceil(height*scale);
  const c=surface.getContext('2d');c.setTransform(scale,0,0,scale,-left*scale,-top*scale);c.filter=`blur(${w.blur*scale}px)`;
  word(c,name,w,reveal,'#fff');c.resetTransform();c.filter='none';
  // Add a fraction of the generated coverage to itself, then tint once.
  // This preserves the bright optical edge without an impossible ink color.
  c.globalCompositeOperation='lighter';c.globalAlpha=w.opticalGain-1;c.drawImage(surface,0,0);
  c.globalAlpha=1;c.globalCompositeOperation='source-in';c.fillStyle=ink(w.color);c.fillRect(0,0,surface.width,surface.height);
  ctx.drawImage(surface,left,top,width,height);
}
export function drawHeroCaption(ctx,oneBasedFrame){
  let lo=Math.floor(oneBasedFrame),t=oneBasedFrame-lo;
  if(t>1-1e-7){lo++;t=0;}else if(t<1e-7)t=0;
  const a=tracks?.[lo];if(!a)return false;
  const next=tracks[lo+1],b=next?.name===a.name?next:null;
  const w=interpolate(a.word,b?.word,t),c=interpolate(a.cursor,b?.cursor,t),scale=Math.max(1,Math.hypot(ctx.getTransform().a,ctx.getTransform().b));
  const reveal=c.rect[0]-w.x;
  ctx.save();ctx.filter='none';
  if(reveal>0){
    if(w.opticalGain>1.0001)brightBlurredWord(ctx,a.name,w,reveal,scale);
    else{ctx.filter=`blur(${w.blur*scale}px)`;word(ctx,a.name,w,reveal,ink(w.color));}
  }
  ctx.filter=`blur(${c.blur*scale}px)`;ctx.fillStyle=ink(c.color);ctx.fillRect(...c.rect);ctx.restore();
  return true;
}
