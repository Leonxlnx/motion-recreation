import {loadExitPigmentWords,drawExitPigmentWords} from './exit-pigment-words.js';
import {drawVectorType} from './vector-type.js';

// Four word slices reference the same editable canonical phrase. Only pose,
// optical softness and ink change during the thermal transition.
let tracks,pending;
export function loadThermalCaptions(){
  return pending||(pending=fetch(new URL('../assets/thermal-caption-tracks.json',import.meta.url))
    .then(r=>{if(!r.ok)throw new Error('Unable to load thermal caption tracks');return r.json();})
    .then(async data=>{tracks=data.frames;await loadExitPigmentWords();}));
}
const mix=(a,b,t)=>a+(b-a)*t;
function paintExitWords(ctx,frame,wordFrom=0,wordTo=Infinity){
  if(frame<129||frame>=153)return false;
  const n=Math.floor(frame+1e-7),a=tracks?.[n];if(!a)return false;
  const b=tracks[n+1]||a,t=Math.max(0,frame-n),p=a.pose.map((v,i)=>mix(v,b.pose[i],t));
  const scale=Math.hypot(ctx.getTransform().a,ctx.getTransform().b);
  ctx.save();ctx.filter=`blur(${p[4]*scale}px)`;ctx.translate(p[0],p[1]);ctx.scale(p[2],p[3]);
  for(let i=wordFrom;i<Math.min(wordTo,Math.max(a.wordColors.length,b.wordColors.length));i++){
    const ac=a.wordColors[i],bc=b.wordColors[i]||ac,opacity=ac?1:t;
    if(!bc||!opacity)continue;
    const color=(ac||bc).map((v,c)=>Math.max(0,Math.min(255,mix(v,bc[c],t))));
    drawVectorType(ctx,'thermal-word-'+i,0,0,{color:`rgb(${color.join(',')})`,opacity});
  }
  ctx.restore();return true;
}

export function drawThermalExitCaption(ctx,frame){if(frame<129||frame>=153||!tracks)return false;const refined=drawExitPigmentWords(ctx,frame,target=>paintExitWords(target,frame,0,2));paintExitWords(ctx,frame,refined?2:0);return true;}
