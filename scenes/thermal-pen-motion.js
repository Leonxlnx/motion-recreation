// One editable vertical stroke moves and changes focus through measured poses.
const lerp=(a,b,t)=>a+(b-a)*t;
function erf(x){
 const sign=x<0?-1:1,t=1/(1+.3275911*Math.abs(x));
 return sign*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x));
}
export function createThermalPenMotion(data){
 const track=data.motions?.whiteBar,cache=new Map(),omitted=new Map();
 if(track)for(const[n,indices]of Object.entries(track.omittedBands))omitted.set(+n,new Set(indices));
 function stamp(values){
  const [x,y,height,sx,sy,opacity,green,blue]=values,res=4,padX=6*sx+2,padY=height*.5+6*sy+2,left=Math.floor((x-padX)*res)/res,top=Math.floor((y-padY)*res)/res;
  const canvas=document.createElement('canvas');canvas.width=Math.ceil((x+padX-left)*res);canvas.height=Math.ceil((y+padY-top)*res);const ctx=canvas.getContext('2d'),im=ctx.createImageData(canvas.width,canvas.height),pixels=im.data;
  const ax=Array.from({length:canvas.width},(_,i)=>{const d=left+(i+.5)/res-x;return .5*(erf((d+.5)/(Math.SQRT2*sx))-erf((d-.5)/(Math.SQRT2*sx)));});
  const ay=Array.from({length:canvas.height},(_,i)=>{const d=top+(i+.5)/res-y;return .5*(erf((d+height*.5)/(Math.SQRT2*sy))-erf((d-height*.5)/(Math.SQRT2*sy)));});
  for(let iy=0;iy<canvas.height;iy++)for(let ix=0;ix<canvas.width;ix++){const i=(iy*canvas.width+ix)*4;pixels[i]=255;pixels[i+1]=green;pixels[i+2]=blue;pixels[i+3]=Math.min(1,ax[ix]*ay[iy]*opacity)*255;}
  ctx.putImageData(im,0,0);return {canvas,x:left,y:top,width:canvas.width/res,height:canvas.height/res};
 }
 return {
  omitBand(zeroBasedSample,index){return omitted.get(zeroBasedSample+1)?.has(index)||false;},
  draw(ctx,zeroBasedFrame){
   if(!track)return;const frame=zeroBasedFrame+1,n=Math.floor(frame+1e-7),t=Math.max(0,Math.min(1,frame-n));
   if(frame<=95||frame>=104)return;
   const a=track.frames[n]||track.frames[96],b=track.frames[n+1]||a,values=a.values.map((v,i)=>lerp(v,b.values[i],t));
   if(n===95)values[5]*=t;else if(n===103)values[5]*=1-t;
   const key=frame.toFixed(7);let art=cache.get(key);
   if(!art){art=stamp(values);cache.set(key,art);while(cache.size>16){const[first,old]=cache.entries().next().value;cache.delete(first);old.canvas.width=1;old.canvas.height=1;}}
   ctx.save();ctx.filter='none';ctx.drawImage(art.canvas,art.x,art.y,art.width,art.height);ctx.restore();
  }
 };
}
