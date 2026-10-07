// The four canonical vector letters settle independently after entering. Ink
// changes during the flash sequence are calibrated at the source frame times.
import {drawVectorType} from './vector-type.js';
import {drawLoveOpticalBlend} from './love-optics.js';
let tracks;
export async function loadLoveCaptions(){tracks=(await(await fetch(new URL('../assets/love-caption-tracks.json',import.meta.url))).json()).frames;}
const mix=(a,b,t)=>a+(b-a)*t;
export function drawLoveCaptions(ctx,frame){
  if(!tracks||frame<384||frame>=415)return false;
  const index=Math.floor(frame),low=tracks[index],high=tracks[index+1]||low,t=frame-index,m=ctx.getTransform(),resolution=Math.hypot(m.a,m.b);
  for(const [char,a] of Object.entries(low)){
    const b=high[char]||a,p=a.pose.map((v,i)=>mix(v,b.pose[i],t)),color=a.color.map((v,i)=>mix(v,b.color[i],t)),gain=mix(a.gain,b.gain,t);
    ctx.save();ctx.filter=`blur(${p[4]*resolution}px)`;ctx.translate(p[0],p[1]);ctx.scale(p[2],p[3]);
    if((a.optics&&t<1)||(b.optics&&t>0)){const gammaRGB=[0,1,2].map(i=>mix(a.optics?.gammaRGB[i]??1,b.optics?.gammaRGB[i]??1,t)),ink=color.map((v,i)=>v+mix(a.optics?.coreOffsetRGB[i]??0,b.optics?.coreOffsetRGB[i]??0,t));drawLoveOpticalBlend(ctx,char,{baseColor:color,mixWeight:mix(a.optics?1:0,b.optics?1:0,t),color:ink,opacity:Math.min(1,gain),coverageGain:Math.max(1,gain),gammaRGB,backgroundRGB:[20,20,20]});}else drawVectorType(ctx,char,0,0,{color:`rgb(${color.join(',')})`,opacity:Math.min(1,gain),coverageGain:Math.max(1,gain)});ctx.restore();
  }
  return true;
}
