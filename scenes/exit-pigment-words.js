// Two reusable word drawings preserve the warm optical edge. Measured word
// poses and pigment gains interpolate during the nine-state typing sequence.
let assets,frames,pending;
const caches=new Map(),surface=(w,h)=>typeof OffscreenCanvas==='function'?new OffscreenCanvas(w,h):Object.assign(document.createElement('canvas'),{width:w,height:h});
export function loadExitPigmentWords(){return pending||(pending=Promise.all(['exit-pigment-words','exit-pigment-tracks'].map(name=>fetch(new URL(`../assets/${name}.json`,import.meta.url)).then(r=>r.json()))).then(([art,tracks])=>{assets=art.assets;frames=tracks;for(const asset of Object.values(assets)){const image=surface(asset.width*4,asset.height*4),ctx=image.getContext('2d');for(const group of asset.groups){const layer=surface(image.width,image.height),c=layer.getContext('2d');c.scale(4,4);c.fillStyle='#fff';for(const path of group.layers){c.globalAlpha=path.alpha;c.fill(new Path2D(path.d),'evenodd');}c.globalAlpha=1;c.globalCompositeOperation='source-in';c.fillStyle=`rgb(${group.color.join(',')})`;c.fillRect(0,0,asset.width,asset.height);ctx.drawImage(layer,0,0);layer.width=layer.height=1;}asset.canvas=image;delete asset.groups;}}));}
function prepared(name,n,state){const key=`${name}:${n}`;if(caches.has(key))return caches.get(key);const a=assets[name],c=surface(a.canvas.width,a.canvas.height),ctx=c.getContext('2d');ctx.drawImage(a.canvas,0,0);const d=ctx.getImageData(0,0,c.width,c.height);for(let i=0;i<d.data.length;i+=4)for(let k=0;k<3;k++)d.data[i+k]*=state.gainsRGB[k];ctx.putImageData(d,0,0);caches.set(key,c);return c;}
const mixes=new Map();let closing=null,oldClosing=null;
function paintRefined(ctx,frame){
 const n=Math.floor(frame+1e-7),states=frames[n],next=frames[n+1]||states,t=Math.max(0,Math.min(1,frame-n)),device=Math.hypot(ctx.getTransform().a,ctx.getTransform().b);
 for(const name of new Set([...Object.keys(states),...Object.keys(next)])){
  const a=states[name],b=next[name]||a,first=a||b,asset=assets[name],p=first.pose.map((v,i)=>v+(b.pose[i]-v)*t);let image=prepared(name,a?n:n+1,first);
  if(a&&b!==a&&t){let c=mixes.get(name);if(!c){c=surface(image.width,image.height);mixes.set(name,c);}const q=c.getContext('2d');q.globalAlpha=1;q.globalCompositeOperation='copy';q.clearRect(0,0,c.width,c.height);q.globalAlpha=1-t;q.drawImage(image,0,0);q.globalCompositeOperation='lighter';q.globalAlpha=t;q.drawImage(prepared(name,n+1,b),0,0);q.globalAlpha=1;q.globalCompositeOperation='source-over';image=c;}
  ctx.save();ctx.globalAlpha*=a?1:t;ctx.filter=p[4]?`blur(${p[4]*device}px)`:'none';ctx.translate(p[0],p[1]);ctx.scale(p[2],p[3]);ctx.drawImage(image,0,0,asset.width,asset.height);ctx.restore();
 }
}
export function drawExitPigmentWords(ctx,frame,drawOldWords){
 const n=Math.floor(frame+1e-7);if(!frames?.[n])return false;
 const t=Math.max(0,frame-n);
 if(frames[n+1]||!t){paintRefined(ctx,frame);return true;}
 // Blend the complete first-two-word layer back into the existing later
 // phrase. Additive premultiplied mixing keeps overlapping edges coherent.
 closing||=surface(118*4,60*4);oldClosing||=surface(118*4,60*4);
 const c=closing.getContext('2d'),old=oldClosing.getContext('2d');for(const q of[c,old]){q.setTransform(4,0,0,4,-89*4,-240*4);q.clearRect(89,240,118,60);}
 paintRefined(c,frame);drawOldWords(old);
 c.save();c.setTransform(1,0,0,1,0,0);c.globalCompositeOperation='destination-in';c.globalAlpha=1-t;c.fillStyle='#fff';c.fillRect(0,0,closing.width,closing.height);c.globalCompositeOperation='lighter';c.globalAlpha=t;c.drawImage(oldClosing,0,0);c.restore();
 ctx.drawImage(closing,89,240,118,60);return true;
}
export function exitPigmentCacheStats(){const all=[...Object.values(assets||{}).map(a=>a.canvas),...caches.values(),...mixes.values(),closing,oldClosing].filter(Boolean);return {preparedWords:caches.size,bytes:all.reduce((sum,c)=>sum+c.width*c.height*4,0)};}
