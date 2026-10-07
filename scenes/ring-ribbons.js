// These transparent caches are rendered once from separately editable ribbon paths.
let rasters=null,pending=null;
export function loadRingRibbons(){
  if(!pending)pending=fetch(new URL('../assets/ring-ribbons.json',import.meta.url)).then(r=>r.json()).then(data=>{
    rasters=new Map();
    for(const [n,frame]of Object.entries(data.frames)){
      const [x0,y0,x1,y1]=frame.bounds,x=x0-2,y=y0-2,w=x1-x0+4,h=y1-y0+4;
      const resolution=frame.resolution||2;const canvas=new OffscreenCanvas(w*resolution,h*resolution),ctx=canvas.getContext('2d');ctx.scale(resolution,resolution);ctx.translate(-x,-y);ctx.fillStyle='#fff';
      for(const layer of frame.layers){ctx.globalAlpha=layer.alpha;ctx.fill(new Path2D(layer.d),'evenodd');}
      ctx.globalAlpha=1;ctx.globalCompositeOperation='source-in';ctx.fillStyle=data.color;ctx.fillRect(x,y,w,h);
      rasters.set(+n,{canvas,x,y,w,h});
    }
  });
  return pending;
}
export function drawRingRibbons(ctx,zeroBasedFrame){
  if(!rasters)return false;const f=zeroBasedFrame+1,a=Math.floor(f),t=f-a,alpha=ctx.globalAlpha;
  for(const [n,weight]of [[a,1-t],[a+1,t]]){const r=rasters.get(n);if(r&&weight>0){ctx.globalAlpha=alpha*weight;ctx.drawImage(r.canvas,r.x,r.y,r.w,r.h);}}
  ctx.globalAlpha=alpha;return rasters.has(a);
}
