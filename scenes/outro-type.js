// Two reusable letter states: small original labels and the enlarged sharp outro.
// Per-frame poses/blur are measured, then interpolated continuously during play.
import {drawVectorType,vectorTypeMetrics} from './vector-type.js';
let tracks=null,pending=null;
export function loadRefinedOutro(){
  if(!pending)pending=fetch(new URL('../assets/outro-type-tracks.json',import.meta.url)).then(r=>{if(!r.ok)throw new Error('Unable to load outro letter poses');return r.json()}).then(data=>{tracks=data.frames});
  return pending;
}
export function drawRefinedOutro(ctx,oneBasedFrame){
  if(!tracks||oneBasedFrame<421||oneBasedFrame>=489)return false;
  const lo=Math.floor(oneBasedFrame),hi=Math.min(488,lo+1),t=oneBasedFrame-lo;
  const deviceScale=Math.hypot(ctx.getTransform().a,ctx.getTransform().b);
  for(const name of ['L','O','V','E']){
    const a=tracks[lo][name],b=tracks[hi][name],v=a.values.map((x,i)=>x+(b.values[i]-x)*t);
    const [x,y,r,s,blur,anisotropy,shear]=v;
    ctx.save();ctx.translate(x,y);ctx.rotate(r);ctx.transform(Math.exp(anisotropy),0,shear*Math.exp(-anisotropy),Math.exp(-anisotropy),0,0);ctx.filter=blur>.001?`blur(${blur*deviceScale}px)`:'none';
    const inherited=ctx.globalAlpha;
    for(const [asset,opacity] of a.asset===b.asset?[[a.asset,1]]:[[a.asset,1-t],[b.asset,t]]){
      if(opacity<=0)continue;const metrics=vectorTypeMetrics(asset);ctx.globalAlpha=inherited*opacity;drawVectorType(ctx,asset,-metrics.width*s/2,-metrics.height*s/2,{color:'#211811',scale:s});
    }
    ctx.restore();
  }
  return true;
}
