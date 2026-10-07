import {drawVectorType} from './vector-type.js';

// The first pale caption has a red optical fringe. Reuse the same editable
// glyphs for both passes; the subsequent thermal blur takes over at frame333.
const source={x:127.6621221698,y:259.3058158995,sx:1.0000920756,sy:.9970370864,
  blur:.0210465511,color:[233.238631,234.350039,234.801613],
  glowBlur:1.6600631441,glowColor:[189.699683,0,0],glowOpacity:.6};
const mix=(a,b,t)=>a+(b-a)*t;
export function drawCaptionTransition(ctx,frame){
  if(frame<332||frame>=333)return false;
  const t=frame-332,scale=Math.hypot(ctx.getTransform().a,ctx.getTransform().b);
  const x=mix(source.x,122,t),y=mix(source.y,259.5,t),sx=mix(source.sx,1,t),sy=mix(source.sy,1,t);
  function word(color,blur,opacity){
    ctx.save();ctx.filter=`blur(${blur*scale}px)`;ctx.translate(x,y);ctx.scale(sx,sy);
    drawVectorType(ctx,'through-ones',0,0,{color:`rgb(${color.join(',')})`,opacity,revealWidth:90});ctx.restore();
  }
  word(source.glowColor,mix(source.glowBlur,6,t),source.glowOpacity*(1-t));
  word(source.color.map((v,i)=>mix(v,[238,234,226][i],t)),mix(source.blur,6,t),1);
  return true;
}
