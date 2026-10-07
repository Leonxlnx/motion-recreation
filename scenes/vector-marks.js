// Transparent annotation caches are generated from the editable vector paths.
// Tight bounds avoid a full-frame canvas for every annotation keyframe.
let outro=null,intro=null,pending=null,totalBytes=0,mixSurface=null;
const RESOLUTION=2,PADDING=2;
const GROUPS=['ghost','black','arrow','red'];
const canvas=(w,h)=>typeof OffscreenCanvas==='function'?new OffscreenCanvas(w,h):Object.assign(document.createElement('canvas'),{width:w,height:h});
function findBounds(item){
  if(item.bounds)return item.bounds;
  let x0=720,y0=540,x1=0,y1=0;
  for(const color of GROUPS)for(const layer of item[color]||[]){const numbers=layer.d.match(/-?\d+(?:\.\d+)?/g)||[];for(let i=0;i<numbers.length;i+=2){const x=+numbers[i],y=+numbers[i+1];x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}}
  return x1<x0?[0,0,1,1]:[x0,y0,x1,y1];
}
function compile(data){
  data.rasters=new Map();
  for(const [n,item] of Object.entries(data.frames)){
    if(item.groupResolutions){
      // Soft distant writing needs fewer cached samples than the thin pen.
      const groups=[];
      for(const color of GROUPS){
        if(!item[color]?.length)continue;
        const resolution=item.groupResolutions[color]??item.resolution??RESOLUTION;
        const [x0,y0,x1,y1]=item.groupBounds[color],x=Math.floor(x0-PADDING),y=Math.floor(y0-PADDING);
        const w=Math.max(1,Math.ceil((x1+PADDING-x)*resolution)),h=Math.max(1,Math.ceil((y1+PADDING-y)*resolution));
        const surface=canvas(w,h),c=surface.getContext('2d');c.scale(resolution,resolution);c.translate(-x,-y);c.fillStyle='#fff';
        for(const layer of item[color]){c.globalAlpha=layer.alpha;c.fill(new Path2D(layer.d),'evenodd');}
        c.globalAlpha=1;c.globalCompositeOperation='source-in';c.fillStyle=item[color+'Color']||data[color+'Color']||'#211811';c.fillRect(x,y,w/resolution,h/resolution);
        groups.push({materialGroup:color,canvas:surface,x,y,width:w/resolution,height:h/resolution});totalBytes+=w*h*4;
      }
      data.rasters.set(+n,{groups});continue;
    }
    const resolution=item.resolution??RESOLUTION;
    const blur=item.blur??(({415:4,416:3.5,417:3,418:2.5,419:2,420:1.5,421:1,422:.7,423:.5})[n]||0);
    const pad=PADDING+Math.ceil(blur*3);
    const [x0,y0,x1,y1]=findBounds(item),x=Math.floor(x0-pad),y=Math.floor(y0-pad);
    const w=Math.max(1,Math.ceil((x1+pad-x)*resolution)),h=Math.max(1,Math.ceil((y1+pad-y)*resolution));
    const surface=canvas(w,h),ctx=surface.getContext('2d');ctx.scale(resolution,resolution);ctx.translate(-x,-y);
    let underRed=null;
    if(item.inkUnderRed){
      const mask=canvas(w,h),m=mask.getContext('2d',{willReadFrequently:true});m.scale(resolution,resolution);m.translate(-x,-y);m.fillStyle='#fff';
      if(item.inkUnderRedRegions){m.beginPath();for(const [x0,y0,x1,y1]of item.inkUnderRedRegions)m.rect(x0,y0,x1-x0,y1-y0);m.clip();}
      for(const layer of item.red||[]){m.globalAlpha=layer.alpha;m.fill(new Path2D(layer.d),'evenodd');}
      underRed=m.getImageData(0,0,w,h).data;mask.width=mask.height=1;
    }
    for(const color of GROUPS){
      if(!item[color]?.length)continue;
      const ink=canvas(w,h),c=ink.getContext('2d');c.scale(resolution,resolution);c.translate(-x,-y);c.fillStyle='#fff';
      for(const layer of item[color]){c.globalAlpha=layer.alpha;c.fill(new Path2D(layer.d),'evenodd');}
      if(color==='black'&&underRed){
        const pixels=c.getImageData(0,0,w,h),p=pixels.data;
        for(let i=3;i<p.length;i+=4)p[i]=Math.round(Math.min(1,(p[i]/255)/Math.max(.15,1-item.inkUnderRed*underRed[i]/255))*255);
        c.putImageData(pixels,0,0);
      }
      c.globalAlpha=1;c.globalCompositeOperation='source-in';c.fillStyle=item[color+'Color']||data[color+'Color']||'#211811';c.fillRect(x,y,w/resolution,h/resolution);
      if(color==='red'&&item.inkUnderRedRegions&&item.inkUnderRedColor){c.globalCompositeOperation='source-atop';c.fillStyle=item.inkUnderRedColor;for(const [x0,y0,x1,y1]of item.inkUnderRedRegions)c.fillRect(x0,y0,x1-x0,y1-y0);}

      ctx.drawImage(ink,x,y,w/resolution,h/resolution);ink.width=1;ink.height=1;
    }
    let cached=surface;
    if(blur){cached=canvas(w,h);const smooth=cached.getContext('2d');smooth.filter=`blur(${blur*resolution}px)`;smooth.drawImage(surface,0,0);surface.width=1;surface.height=1;}
    data.rasters.set(+n,{canvas:cached,x,y,width:w/resolution,height:h/resolution});totalBytes+=w*h*4;
  }
  // The source JSON remains editable; parsed path strings can be released.
  delete data.frames;return data;
}
export function loadVectorMarks(){
  if(!pending)pending=Promise.all(['outro-marks','intro-marks'].map(name=>fetch(new URL(`../assets/${name}.json`,import.meta.url)).then(r=>{if(!r.ok)throw new Error(`Unable to load ${name}`);return r.json()}))).then(([a,b])=>{outro=compile(a);intro=compile(b)});
  return pending;
}
export function vectorMarksCacheStats(){return {bytes:totalBytes,transientBytes:mixSurface?mixSurface.width*mixSurface.height*4:0,frames:(outro?.rasters.size||0)+(intro?.rasters.size||0),resolution:RESOLUTION};}
function stamp(ctx,r){ctx.drawImage(r.canvas,r.x,r.y,r.width,r.height);}
function frame(ctx,data,n,opacity){
  const r=data.rasters.get(n);if(!r||opacity<=0)return;const inherited=ctx.globalAlpha;ctx.globalAlpha=inherited*opacity;
  if(!r.groups)stamp(ctx,r);
  else if(opacity===1&&inherited===1){for(const group of r.groups)stamp(ctx,group);}
  else{
    // Apply a frame fade after its pigment groups are combined. One reusable
    // surface keeps overlapping pen/ghost opacity coherent between keyframes.
    const m=ctx.getTransform(),resolution=Math.max(1,Math.min(4,Math.ceil(Math.hypot(m.a,m.b))));
    if(!mixSurface||mixSurface.width!==720*resolution){mixSurface=canvas(720*resolution,540*resolution);}
    const c=mixSurface.getContext('2d');c.setTransform(resolution,0,0,resolution,0,0);c.clearRect(0,0,720,540);for(const group of r.groups)stamp(c,group);ctx.drawImage(mixSurface,0,0,720,540);
  }
  ctx.globalAlpha=inherited;
}
function draw(ctx,data,f){if(!data)return false;const n=f+1,a=Math.floor(n),mix=n-a;ctx.save();frame(ctx,data,a,1-mix);if(mix>.0001)frame(ctx,data,a+1,mix);ctx.restore();return data.rasters.has(a);}
export function drawOutroMarks(ctx,zeroBasedFrame){return draw(ctx,outro,zeroBasedFrame);}
export function drawIntroMarks(ctx,zeroBasedFrame){return draw(ctx,intro,zeroBasedFrame);}

// Grain coverage follows the existing editable ghost and pen artwork.
// Coverage is a material boundary, independent of visible ink opacity.
const ghostGrainMasks=new Map();
function ghostGrainMask(n){
 if(ghostGrainMasks.has(n))return ghostGrainMasks.get(n);
 const groups=intro?.rasters.get(n)?.groups,ghost=groups?.find(g=>g.materialGroup==='ghost');if(!ghost)return null;
 const resolution=2,w=Math.ceil(ghost.width*resolution),h=Math.ceil(ghost.height*resolution),surface=canvas(w,h),c=surface.getContext('2d');
 c.drawImage(ghost.canvas,0,0,w,h);const pixels=c.getImageData(0,0,w,h);
 c.clearRect(0,0,w,h);c.setTransform(resolution,0,0,resolution,-ghost.x*resolution,-ghost.y*resolution);c.filter='blur(4px)';
 for(const group of groups)if(group.materialGroup==='black'||group.materialGroup==='arrow')stamp(c,group);
 const pen=c.getImageData(0,0,w,h).data;
 for(let i=3;i<pixels.data.length;i+=4){const alpha=pixels.data[i]/255,t=Math.max(0,Math.min(1,(alpha-.02)/.04)),coverage=t*t*(3-2*t);pixels.data[i]=pen[i]>0?0:Math.round(coverage*255);pixels.data[i-3]=pixels.data[i-2]=pixels.data[i-1]=255;}
 c.setTransform(1,0,0,1,0,0);c.filter='none';c.putImageData(pixels,0,0);const result={canvas:surface,x:ghost.x,y:ghost.y,width:ghost.width,height:ghost.height};totalBytes+=w*h*4;ghostGrainMasks.set(n,result);return result;
}
export function drawGhostGrainMask(ctx,f){
 if(!ctx)return;const n=f+1,a=Math.floor(n),t=n-a;ctx.save();ctx.setTransform(ctx.canvas.width/720,0,0,ctx.canvas.height/540,0,0);ctx.globalCompositeOperation='lighter';
 for(const [frame,opacity] of [[a,1-t],[a+1,t]]){if(opacity<=0)continue;const mask=ghostGrainMask(frame);if(mask){ctx.globalAlpha=opacity;stamp(ctx,mask);}}
 ctx.restore();
}

// Material coverage is derived from the existing editable ink, independent of pigment color.
const outroMaterialMasks=new Map();
function outroMaterialMask(n){
 if(outroMaterialMasks.has(n))return outroMaterialMasks.get(n);
 const r=outro?.rasters.get(n);if(!r||!r.canvas)return null;
 const surface=canvas(r.canvas.width,r.canvas.height),c=surface.getContext('2d',{willReadFrequently:true});c.drawImage(r.canvas,0,0);const pixels=c.getImageData(0,0,surface.width,surface.height);
 for(let i=0;i<pixels.data.length;i+=4){const t=Math.max(0,Math.min(1,(pixels.data[i+3]/255-.003)/.022));pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=255;pixels.data[i+3]=Math.round(255*t*t*(3-2*t));}
 c.putImageData(pixels,0,0);const mask={canvas:surface,x:r.x,y:r.y,width:r.width,height:r.height};outroMaterialMasks.set(n,mask);if(outroMaterialMasks.size>4){const key=outroMaterialMasks.keys().next().value,out=outroMaterialMasks.get(key);outroMaterialMasks.delete(key);out.canvas.width=out.canvas.height=1;}return mask;
}
export function drawOutroMaterialMask(ctx,f){
 if(!ctx)return;const n=f+1,a=Math.floor(n),t=n-a;ctx.save();ctx.setTransform(ctx.canvas.width/720,0,0,ctx.canvas.height/540,0,0);ctx.globalCompositeOperation='lighter';
 for(const [frame,opacity]of [[a,1-t],[a+1,t]]){if(opacity<=0)continue;const mask=outroMaterialMask(frame);if(mask){ctx.globalAlpha=opacity;stamp(ctx,mask);}}ctx.restore();
}
