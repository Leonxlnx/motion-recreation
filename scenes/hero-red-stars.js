// Isolated editable red illustration paths, including faint optical remnants.
// Cache pixels are generated from those paths; no source frame is played back.
let frames=null,pending=null;
const RESOLUTION=2;
const canvas=(w,h)=>typeof OffscreenCanvas==='function'?new OffscreenCanvas(w,h):Object.assign(document.createElement('canvas'),{width:w,height:h});
export function loadHeroRedStars(){
  if(!pending)pending=fetch(new URL('../assets/hero-red-stars.json',import.meta.url)).then(r=>{if(!r.ok)throw new Error('Unable to load red illustration paths');return r.json();}).then(data=>{
    frames=new Map();
    for(const [n,item] of Object.entries(data.frames)){
      const [x0,y0,x1,y1]=item.bounds,x=Math.floor(x0-2),y=Math.floor(y0-2);
      const w=Math.ceil(x1+2-x),h=Math.ceil(y1+2-y),surface=canvas(w*RESOLUTION,h*RESOLUTION),ctx=surface.getContext('2d');
      ctx.scale(RESOLUTION,RESOLUTION);ctx.translate(-x,-y);ctx.fillStyle='#fff';
      for(const layer of item.red){ctx.globalAlpha=layer.alpha;ctx.fill(new Path2D(layer.d),'evenodd');}
      // Accumulate alpha before tinting. Repeated low-alpha colored fills
      // quantize premultiplied 8-bit channels and change faint red into orange.
      ctx.globalAlpha=1;
      if(item.palette){
        // A small one-dimensional pigment ramp keeps the dim patterned ribbon
        // deeper red than its bright accents; the editable coverage is shared.
        const pixels=ctx.getImageData(0,0,surface.width,surface.height),p=pixels.data,base=(item.color.match(/[\d.]+/g)||[]).map(Number);let region;
        if(item.paletteRegion){const rc=canvas(surface.width,surface.height),rx=rc.getContext('2d');rx.scale(RESOLUTION,RESOLUTION);rx.translate(-x,-y);rx.filter=`blur(${item.paletteRegion.blur*RESOLUTION}px)`;rx.fillStyle='#fff';rx.fill(new Path2D(item.paletteRegion.d));region=rx.getImageData(0,0,rc.width,rc.height).data;}
        for(let i=0;i<p.length;i+=4){if(!p[i+3])continue;const u=p[i+3]/255*(item.palette.length-1),k=Math.floor(u),a=item.palette[k],b=item.palette[Math.min(k+1,item.palette.length-1)],t=u-k,m=region?region[i+3]/255:1;for(let c=0;c<3;c++)p[i+c]=base[c]+(a[c]+(b[c]-a[c])*t-base[c])*m;}
        ctx.putImageData(pixels,0,0);
      }else{ctx.globalCompositeOperation='source-in';ctx.fillStyle=item.color;ctx.fillRect(x,y,w,h);}
      for(const accent of item.accents||[]){
        const mask=canvas(surface.width,surface.height),paint=mask.getContext('2d');
        paint.scale(RESOLUTION,RESOLUTION);paint.translate(-x,-y);paint.fillStyle='#fff';
        for(const layer of accent.layers){paint.globalAlpha=layer.alpha;paint.fill(new Path2D(layer.d),'evenodd');}
        paint.globalAlpha=1;paint.globalCompositeOperation='source-in';paint.fillStyle=accent.color;paint.fillRect(x,y,w,h);
        ctx.save();ctx.resetTransform();ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;ctx.drawImage(mask,0,0);ctx.restore();
      }
      frames.set(+n,{surface,x,y,w,h});
    }
  });
  return pending;
}
export function drawHeroRedStars(ctx,oneBasedFrame){
  if(!frames?.has(Math.floor(oneBasedFrame)))return false;
  const lo=Math.floor(oneBasedFrame),t=oneBasedFrame-lo,inherited=ctx.globalAlpha;
  ctx.save();ctx.filter='none';
  for(const [n,alpha] of [[lo,1-t],[lo+1,t]]){const item=frames.get(n);if(!item||alpha<=0)continue;ctx.globalAlpha=inherited*alpha;ctx.drawImage(item.surface,item.x,item.y,item.w,item.h);}
  ctx.restore();return true;
}
