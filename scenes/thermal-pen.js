import {createThermalPenMotion} from './thermal-pen-motion.js';
// Native vector coverage for the isolated orbit ink. The thermal body remains
// the separately editable mesh; existing non-orbit edge marks are retained.
let pending;
export function createThermalPen(){
 return pending||(pending=fetch(new URL('../assets/thermal-pen.json',import.meta.url)).then(r=>{if(!r.ok)throw new Error('Unable to load thermal pen paths');return r.json();}).then(data=>{
  const rasters=new Map();
  for(const[n,frame]of Object.entries(data.frames)){
   const [x0,y0,x1,y1]=frame.bounds;let left=x0,top=y0,right=x1,bottom=y1;
   for(const band of frame.preservedBands)for(let i=0;i<band.points.length;i+=2){left=Math.min(left,band.points[i]);right=Math.max(right,band.points[i]);top=Math.min(top,band.points[i+1]);bottom=Math.max(bottom,band.points[i+1]);}
   left=Math.floor(left)-2;top=Math.floor(top)-2;right=Math.ceil(right)+2;bottom=Math.ceil(bottom)+2;
   const scale=frame.resolution||4,surface=document.createElement('canvas');surface.width=(right-left)*scale;surface.height=(bottom-top)*scale;const ctx=surface.getContext('2d');ctx.setTransform(scale,0,0,scale,-left*scale,-top*scale);ctx.filter=`blur(${.18*scale}px)`;
   for(const band of frame.preservedBands){ctx.beginPath();for(let i=0;i<band.points.length;i+=2){if(i)ctx.lineTo(band.points[i],band.points[i+1]);else ctx.moveTo(band.points[i],band.points[i+1]);}ctx.closePath();ctx.fillStyle=`rgb(${band.color.join(',')})`;ctx.fill();}
   const ink=document.createElement('canvas');ink.width=(x1-x0)*scale;ink.height=(y1-y0)*scale;const c=ink.getContext('2d');c.scale(scale,scale);c.fillStyle='#fff';
   if(frame.proceduralTrail){
    const fit=frame.proceduralTrail,[left,right,cy,sl,sr,sy,tilt,decay,amplitude,green,blue]=fit.values,im=c.createImageData(ink.width,ink.height),d=im.data;
    for(let y=0;y<ink.height;y++)for(let x=0;x<ink.width;x++){
     const X=x0+(x+.5)/scale,Y=y0+(y+.5)/scale,u=Math.max(0,(X-left)/(right-left)),v=(Y-cy-tilt*(X-left))/sy,alpha=amplitude/(1+Math.exp(-(X-left)/sl))/(1+Math.exp(-(right-X)/sr))*Math.exp(-.5*v*v-decay*u),i=(y*ink.width+x)*4;
     d[i]=255;d[i+1]=green;d[i+2]=blue;d[i+3]=alpha*255;
    }
    c.putImageData(im,0,0);
   }else{
   for(const path of frame.layers){c.globalAlpha=path.alpha;c.fill(new Path2D(path.d),'evenodd');}
   c.globalAlpha=1;c.globalCompositeOperation='source-in';c.fillStyle=`rgb(${frame.color.join(',')})`;c.fillRect(0,0,x1-x0,y1-y0);
   }
   ctx.filter='none';ctx.drawImage(ink,x0,y0,x1-x0,y1-y0);ink.width=1;ink.height=1;
   rasters.set(+n,{surface,x:left,y:top,width:right-left,height:bottom-top});
  }
  const motion=createThermalPenMotion(data);
  return {drawMotion:motion.draw,omitBand:motion.omitBand,draw(ctx,zeroBasedSample){const art=rasters.get(zeroBasedSample+1);if(!art)return false;ctx.filter='none';ctx.drawImage(art.surface,art.x,art.y,art.width,art.height);return true;}};
 }));
}
