// Optical response of the existing generated vector coverage. This contains no
// source raster artwork: each colored glyph is generated from reusable paths.
import {drawVectorType,vectorTypeMetrics} from './vector-type.js';
const cache=new Map(),RESOLUTION=4,PADDING=6,MAX_BYTES=8*1024*1024;
let cacheBytes=0;
function generatedGlyph(char,color,opacity,coverageGain,gammaRGB,backgroundRGB){
 const key=JSON.stringify([char,color,opacity,coverageGain,gammaRGB,backgroundRGB]);
 if(cache.has(key)){const item=cache.get(key);cache.delete(key);cache.set(key,item);return item;}
 const metrics=vectorTypeMetrics(char),width=Math.ceil((metrics.width+PADDING*2)*RESOLUTION),height=Math.ceil((metrics.height+PADDING*2)*RESOLUTION);
 const surface=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):Object.assign(document.createElement('canvas'),{width,height});
 const c=surface.getContext('2d',{willReadFrequently:true});c.scale(RESOLUTION,RESOLUTION);
 drawVectorType(c,char,PADDING,PADDING,{color:'#fff',opacity,coverageGain});
 const image=c.getImageData(0,0,width,height),pixels=image.data;
 for(let i=0;i<pixels.length;i+=4){
  const a=pixels[i+3]/255;if(a===0)continue;
  const channel=gammaRGB.map(g=>Math.pow(a,g)),maximum=Math.max(...channel);
  for(let k=0;k<3;k++)pixels[i+k]=(color[k]*channel[k]+backgroundRGB[k]*(maximum-channel[k]))/maximum;
  pixels[i+3]=maximum*255;
 }
 c.setTransform(1,0,0,1,0,0);c.putImageData(image,0,0);
 const item={canvas:surface,width:width/RESOLUTION,height:height/RESOLUTION,bytes:width*height*4};
 while(cache.size&&cacheBytes+item.bytes>MAX_BYTES){const [oldKey,old]=cache.entries().next().value;cache.delete(oldKey);cacheBytes-=old.bytes;old.canvas.width=old.canvas.height=1;}
 cache.set(key,item);cacheBytes+=item.bytes;return item;
}
export function drawLoveOpticalType(ctx,char,{color,opacity=1,coverageGain=1,gammaRGB=[1,1,1],backgroundRGB=[20,20,20]}){
 const item=generatedGlyph(char,color,opacity,coverageGain,gammaRGB,backgroundRGB);
 ctx.drawImage(item.canvas,-PADDING,-PADDING,item.width,item.height);
}
export function loveOpticsCacheStats(){return{entries:cache.size,bytes:cacheBytes,maximumBytes:MAX_BYTES};}


// Crossfade only while entering/leaving the optional optical treatment. Both
// small layers start with the generated scene underneath, so opaque compositing
// preserves coverage and tends exactly to the existing renderer at either end.
// These are transient generated glyph layers, never reference-video images.
let transitionLayers;
export function drawLoveOpticalBlend(ctx,char,{baseColor,mixWeight=1,...optical}){
 const weight=Math.max(0,Math.min(1,mixWeight));
 if(weight>=1){drawLoveOpticalType(ctx,char,optical);return;}
 const ordinary=q=>drawVectorType(q,char,0,0,{color:'rgb('+baseColor.join(',')+')',opacity:optical.opacity,coverageGain:optical.coverageGain});
 if(weight<=0){ordinary(ctx);return;}
 const metrics=vectorTypeMetrics(char),m=ctx.getTransform(),sigma=Number(/blur\(([\d.e+-]+)px\)/.exec(ctx.filter)?.[1]||0),margin=6*sigma+2;
 const points=[[-PADDING,-PADDING],[metrics.width+PADDING,-PADDING],[-PADDING,metrics.height+PADDING],[metrics.width+PADDING,metrics.height+PADDING]].map(([x,y])=>[m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f]);
 const left=Math.max(0,Math.floor(Math.min(...points.map(p=>p[0]))-margin)),top=Math.max(0,Math.floor(Math.min(...points.map(p=>p[1]))-margin));
 const right=Math.min(ctx.canvas.width,Math.ceil(Math.max(...points.map(p=>p[0]))+margin)),bottom=Math.min(ctx.canvas.height,Math.ceil(Math.max(...points.map(p=>p[1]))+margin));
 const width=right-left,height=bottom-top;if(width<=0||height<=0)return;
 if(!transitionLayers)transitionLayers=[new OffscreenCanvas(width,height),new OffscreenCanvas(width,height)];
 for(let index=0;index<2;index++){
  const layer=transitionLayers[index];if(layer.width!==width)layer.width=width;if(layer.height!==height)layer.height=height;
  const q=layer.getContext('2d');q.setTransform(1,0,0,1,0,0);q.globalAlpha=1;q.filter='none';q.globalCompositeOperation='copy';q.drawImage(ctx.canvas,left,top,width,height,0,0,width,height);
  q.setTransform(m.a,m.b,m.c,m.d,m.e-left,m.f-top);q.globalAlpha=ctx.globalAlpha;q.globalCompositeOperation='source-over';q.filter=ctx.filter;q.imageSmoothingEnabled=ctx.imageSmoothingEnabled;q.imageSmoothingQuality=ctx.imageSmoothingQuality;
  if(index===0)ordinary(q);else drawLoveOpticalType(q,char,optical);
 }
 ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.filter='none';ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;ctx.drawImage(transitionLayers[0],left,top);ctx.globalAlpha=weight;ctx.drawImage(transitionLayers[1],left,top);ctx.restore();
}
